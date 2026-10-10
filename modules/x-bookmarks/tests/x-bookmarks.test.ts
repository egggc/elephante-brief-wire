// The editor's X bookmarks become always-selected, tagged items through the ingest path; the refresh token
// rotates in the database; a bookmark is taken in once; every read is a receipt under the x_api budget.
import { stub, tag } from "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { normalizeAnalysis, type AnalysisRun } from "@aihot/backend/editorial/analyze";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { publishArticle } from "@aihot/backend/publication/publish";
import { SOURCE_ID, TAG, syncBookmarks } from "../backend/picks.ts";
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

test("new bookmarks come in as editor's picks once, with the refresh token rotated and every read under the x_api budget", async () => {
  const first = await syncBookmarks();
  assert.deepEqual(first, { pages: 1, new: 2, taken: 2 });

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

  // The linked article comes in as the article, the post as its context; a plain post as itself.
  const [linked] = await sql<{ url: string; title: string; excerpt: string; body_status: string }[]>`
    SELECT url, title, excerpt, body_status FROM articles WHERE id = ${await pickArticle(LINKED)}`;
  assert.equal(linked!.title, "New chip export rules, explained");
  assert.match(linked!.url, new RegExp(`example\\.org/${T}/export-rules`));
  assert.match(linked!.excerpt, /What the rule changes\.\n\nShared on X by @reporter: “Worth reading on chip export rules https:\/\/example\.org/);
  assert.equal(linked!.body_status, "pending", "the article page is still to be fetched");
  const [plain] = await sql<{ url: string; title: string }[]>`SELECT url, title FROM articles WHERE id = ${await pickArticle(PLAIN)}`;
  assert.deepEqual(plain, { url: `https://x.com/reporter/status/${PLAIN}`, title: "Huawei just told suppliers it will double its Ascend orders." });

  const overrides = await sql<{ fields: Record<string, unknown> }[]>`
    SELECT fields FROM editorial_overrides WHERE article_id IN (${await pickArticle(LINKED)}, ${await pickArticle(PLAIN)})`;
  assert.deepEqual(overrides.map((o) => o.fields), [{ selected: true, addTags: [TAG] }, { selected: true, addTags: [TAG] }]);

  // Read again: nothing new, nothing taken in twice, the token still valid.
  const second = await syncBookmarks(new Date(Date.now() + 15 * 60_000));
  assert.deepEqual(second, { pages: 1, new: 0, taken: 0 });
  assert.equal(tokenForms.length, 1);
  assert.equal(bookmarkReads.length, 2);
});

test("an editor's pick is selected whatever its score and keeps the model's tags beside its own", async () => {
  const id = await pickArticle(PLAIN);
  const [a] = await sql<{ revision: number }[]>`SELECT revision FROM articles WHERE id = ${id}`;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, tags, title_zh, summary_zh, score, selected)
            VALUES (${id}, ${a!.revision}, 'rule', 'pass', 'tech', ${["Semiconductors"]}, '华为加倍昇腾订单', '华为告诉供应商将把昇腾订单翻倍。', 12, false)`;
  // Grouping found it adds nothing to a story already selected: an editor's pick is shown all the same.
  await sql`UPDATE articles SET grouping_status = 'complete', grouped_at = now(), selection_adds_value = false WHERE id = ${id}`;
  await publishArticle(id);
  const [p] = await sql<{ selected: boolean; tags: string[] }[]>`SELECT selected, tags FROM publications WHERE article_id = ${id}`;
  assert.equal(p!.selected, true);
  assert.deepEqual([...p!.tags].sort(), ["Semiconductors", TAG]);

  const gold = (await goldRows(sql, "development")).find((row) => row.caseId === `x-pick:${PLAIN}`);
  assert.equal(gold?.gold.decision, "select");
  assert.equal(gold?.samplingContext.samplingStratum, "editor-pick");
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
