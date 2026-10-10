// The editor's X bookmarks: a linked article becomes an always-selected, tagged item with nothing of the
// post but its address; a post without one stays private heat evidence. The refresh token rotates in the
// database; a bookmark is taken in once; every read is a receipt under the x_api budget.
import { stub, tag } from "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { normalizeAnalysis, type AnalysisRun } from "@aihot/backend/editorial/analyze";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { loadItemDetail } from "@aihot/backend/publication/detail";
import { publishArticle } from "@aihot/backend/publication/publish";
import { PRIVATE_SOURCE_ID, SOURCE_ID, TAG, syncBookmarks } from "../backend/picks.ts";
import { goldRows } from "../backend/gold.ts";
import { codeFrom, loginRequest } from "../backend/x.ts";

const T = tag();
const BASE = BigInt(Date.now()) * 1000n;
const PLAIN = String(BASE + 1n);
const LINKED = String(BASE + 2n);
const USER = `u${T}`;

const tokenForms: URLSearchParams[] = [];
const bookmarkReads: string[] = [];
const x = await stub((_hit, req) => {
  const u = new URL(req.url, "http://stub");
  if (u.pathname === "/2/oauth2/token") {
    const form = new URLSearchParams(req.body);
    tokenForms.push(form);
    return { token_type: "bearer", access_token: `access-${tokenForms.length + 1}`, refresh_token: `refresh-${tokenForms.length + 1}`, expires_in: 7200 };
  }
  if (u.pathname === `/2/users/${USER}/bookmarks`) {
    bookmarkReads.push(u.search);
    return {
      data: [
        { id: LINKED, text: "Worth reading on chip export rules https://t.co/a1", created_at: new Date().toISOString(), author_id: "9",
          entities: { urls: [{ url: "https://t.co/a1", expanded_url: `https://example.org/${T}/export-rules`, title: "New chip export rules, explained", description: "What the rule changes." }] } },
        { id: PLAIN, text: "Huawei just told suppliers it will double its Ascend orders.\nMore soon.", created_at: new Date().toISOString(), author_id: "9" },
      ],
      includes: { users: [{ id: "9", username: "reporter", name: "A Reporter" }] },
      meta: { result_count: 2 },
    };
  }
  return { error: "unexpected" };
});

before(async () => {
  process.env.X_API_BASE_URL = x.url;
  process.env.X_CLIENT_ID = "client";
  process.env.X_CLIENT_SECRET = "secret";
  process.env.X_REDIRECT_URI = "https://brief.example/api/x-bookmarks/callback";
  config.allowPrivateNetworkFetch = true;
  await sql`
    INSERT INTO x_bookmarks_account (id, user_id, username, access_token, refresh_token, expires_at)
    VALUES (true, ${USER}, 'editor', 'access-1', 'refresh-1', now() - interval '1 minute')
    ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token, expires_at = EXCLUDED.expires_at`;
});
after(async () => {
  await x.close();
  await stopBoss();
  await closeDb();
});

const pickArticle = async (tweetId: string) =>
  (await sql<{ article_id: string }[]>`SELECT article_id FROM x_bookmarks_picks WHERE tweet_id = ${tweetId}`)[0]!.article_id;

test("new bookmarks come in once, with the refresh token rotated and every read under the x_api budget", async () => {
  const first = await syncBookmarks();
  assert.deepEqual(first, { pages: 1, new: 2, articles: 1, posts: 1 });

  assert.equal(tokenForms.length, 1);
  assert.equal(tokenForms[0]!.get("grant_type"), "refresh_token");
  assert.equal(tokenForms[0]!.get("refresh_token"), "refresh-1");
  const [account] = await sql<{ access_token: string; refresh_token: string; expires_at: Date }[]>`SELECT access_token, refresh_token, expires_at FROM x_bookmarks_account`;
  assert.equal(account!.refresh_token, "refresh-2");
  assert.ok(account!.expires_at.getTime() > Date.now() + 3600_000);

  const [source] = await sql<{ name: string; tier: string; participation_mode: string; kind: string }[]>`SELECT name, tier, participation_mode, kind FROM sources WHERE id = ${SOURCE_ID}`;
  assert.deepEqual(source, { name: "X — Editor's picks", tier: "T1", participation_mode: "editorial", kind: "external" });
  const [budget] = await sql<{ per_day: number }[]>`SELECT per_day FROM budgets WHERE service = 'x_api'`;
  assert.ok(budget, "the x_api budget exists before the first read");
  const receipts = await sql`SELECT 1 FROM receipts WHERE service = 'x_api' AND subject = ${`x-bookmarks:${USER}`}`;
  assert.equal(receipts.length, 1);

  // The linked article comes in alone, from the link card and the publisher's page: no post text.
  const linkedId = await pickArticle(LINKED);
  const [linked] = await sql<{ source_id: string; url: string; title: string; excerpt: string; body_text: string | null; body_status: string }[]>`
    SELECT source_id, url, title, excerpt, body_text, body_status FROM articles WHERE id = ${linkedId}`;
  assert.equal(linked!.source_id, SOURCE_ID);
  assert.equal(linked!.title, "New chip export rules, explained");
  assert.match(linked!.url, new RegExp(`example\\.org/${T}/export-rules`));
  assert.equal(linked!.excerpt, "What the rule changes.");
  assert.equal(linked!.body_text, null);
  assert.equal(linked!.body_status, "pending", "the article page is still to be fetched");
  const [override] = await sql<{ fields: Record<string, unknown> }[]>`SELECT fields FROM editorial_overrides WHERE article_id = ${linkedId}`;
  assert.deepEqual(override!.fields, { selected: true, addTags: [TAG], reasonNote: `Editor's pick: https://x.com/reporter/status/${LINKED}` });

  // A post without an article is private heat evidence: no override, no page, not in the pool.
  const plainId = await pickArticle(PLAIN);
  const [plain] = await sql<{ source_id: string; mode: string }[]>`
    SELECT a.source_id, s.participation_mode AS mode FROM articles a JOIN sources s ON s.id = a.source_id WHERE a.id = ${plainId}`;
  assert.deepEqual(plain, { source_id: PRIVATE_SOURCE_ID, mode: "hot_signal" });
  assert.equal((await sql`SELECT 1 FROM editorial_overrides WHERE article_id = ${plainId}`).length, 0);
  await publishArticle(plainId);
  const [pub] = await sql<{ eligible: boolean; selected: boolean }[]>`SELECT eligible, selected FROM publications WHERE article_id = ${plainId}`;
  assert.deepEqual(pub, { eligible: false, selected: false });
  assert.equal((await loadItemDetail(plainId)).kind, "not_found");

  // Read again: nothing new, nothing taken in twice, the token still valid.
  const second = await syncBookmarks(new Date(Date.now() + 15 * 60_000));
  assert.deepEqual(second, { pages: 1, new: 0, articles: 0, posts: 0 });
  assert.equal(tokenForms.length, 1);
  assert.equal(bookmarkReads.length, 2);
});

test("an editor's pick is selected whatever its score, keeps the model's tags and names its post in the reason", async () => {
  const id = await pickArticle(LINKED);
  const [a] = await sql<{ revision: number }[]>`SELECT revision FROM articles WHERE id = ${id}`;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, tags, title_zh, summary_zh, reason_zh, score, selected)
            VALUES (${id}, ${a!.revision}, 'rule', 'pass', 'policy', ${["Export controls"]}, 'New chip export rules', 'The rule widens the license requirement.',
                    'It changes who can sell to China.', 12, false)`;
  // Grouping found it adds nothing to a story already selected: an editor's pick is shown all the same.
  await sql`UPDATE articles SET grouping_status = 'complete', grouped_at = now(), selection_adds_value = false WHERE id = ${id}`;
  await publishArticle(id);
  const [p] = await sql<{ selected: boolean; tags: string[]; reason: string }[]>`SELECT selected, tags, reason FROM publications WHERE article_id = ${id}`;
  assert.equal(p!.selected, true);
  assert.deepEqual([...p!.tags].sort(), ["Export controls", TAG]);
  assert.equal(p!.reason, `It changes who can sell to China. · Editor's pick: https://x.com/reporter/status/${LINKED}`);

  const gold = await goldRows(sql, "development");
  for (const tweet of [LINKED, PLAIN]) {
    const row = gold.find((r) => r.caseId === `x-pick:${tweet}`);
    assert.equal(row?.gold.decision, "select");
    assert.equal(row?.samplingContext.samplingStratum, "editor-pick");
  }
});

test("a prefilter BLOCK stops an item unless it was written up for an editor's pick", () => {
  const blocked: AnalysisRun = { prefilter: { label: "BLOCK", reason: "", model: "m", receiptId: 1, reused: false }, scores: null, writing: null, structure: null };
  assert.equal(normalizeAnalysis(blocked).relevance, "block");
  const written = { ...blocked, writing: { kind: "summarize", model: "m", titleZh: "标题", summaryZh: "摘要", reasonZh: null, receiptIds: [], reused: false } } as AnalysisRun;
  assert.equal(normalizeAnalysis(written).relevance, "pass");
});

test("the login link asks for the bookmark scopes with PKCE, and the pasted address must be from the same attempt", () => {
  const app = { clientId: "client", clientSecret: "secret", redirectUri: "https://brief.example/api/x-bookmarks/callback" };
  const login = loginRequest(app);
  const url = new URL(login.url);
  assert.equal(url.origin + url.pathname, "https://x.com/i/oauth2/authorize");
  assert.equal(url.searchParams.get("scope"), "tweet.read users.read bookmark.read offline.access");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(codeFrom(`${app.redirectUri}?state=${login.state}&code=abc`, login.state), "abc");
  assert.equal(codeFrom("  abc ", login.state), "abc");
  assert.throws(() => codeFrom(`${app.redirectUri}?state=other&code=abc`, login.state), /another login attempt/);
});
