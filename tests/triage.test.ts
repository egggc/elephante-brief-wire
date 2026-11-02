// Batch triage (editorial/triage.ts): collected items wait without a model call; a pass groups them into
// stories for free, counts each story's coverage, sends the new stories in one list per call, and only the
// picks go on to be scored and written up. A story already picked takes in later reports without a call.
// Every pass records its cost; a refusal for money (402) fails the healthcheck at once; a spent monthly
// budget stops the picks.
import { Reply, stub, tag } from "./setup.ts";
import { TRIAGE } from "@aihot/site";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { loadAnalyzeInput } from "@aihot/backend/editorial/input";
import { pickAllowance, triagePass } from "@aihot/backend/editorial/triage";
import { processArticle } from "@aihot/backend/jobs/content";
import { stopBoss } from "@aihot/backend/jobs/queue";

const T = tag();
const lists: string[] = [];
let refuse = false;
const model = await stub((_hit, req) => {
  const body = JSON.parse(req.body) as { messages: Array<{ role: string; content: string }> };
  const list = body.messages.at(-1)!.content;
  lists.push(list);
  if (refuse) return new Reply(402, { error: { code: 402, message: "Insufficient credits" } });
  const n = Number(/^(\d+)\. .*entity list/im.exec(list)?.[1] ?? 1);
  return { id: `stub-${lists.length}`, model: "stub", choices: [{ message: { content: JSON.stringify({ picks: [{ n, score: 88, reason: "Changes who can sell chips to China" }] }) } }],
    usage: { prompt_tokens: 2000, completion_tokens: 500, total_tokens: 2500 } };
});
const pings: Array<{ path: string; body: string }> = [];
const healthchecks = await stub((_hit, req) => { pings.push({ path: req.url, body: req.body }); return { ok: true }; });

before(async () => {
  TRIAGE.enabled = true;
  Object.assign(process.env, {
    TRIAGE_MODEL: "default", LLM_BASE_URL: `${model.url}/v1`, LLM_API_KEY: "test-key", LLM_MODEL: "minimax/minimax-m2.5",
    LLM_INPUT_USD_PER_M: "0.3", LLM_OUTPUT_USD_PER_M: "1.2", HEALTHCHECKS_URL: `${healthchecks.url}/check-${T}`,
  });
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at) VALUES
    (${`gov-${T}`}, 'Commerce Department', 'rss', 'T1', 'editorial', '2100-01-01'),
    (${`wire-${T}`}, 'A wire', 'rss', 'T2', 'editorial', '2100-01-01'),
    (${`paper-${T}`}, 'A paper', 'rss', 'T2', 'editorial', '2100-01-01')`;
});
after(async () => {
  await model.close();
  await healthchecks.close();
  await stopBoss();
  await closeDb();
});

const collect = async (source: string, title: string, slug: string) => {
  const { articleId } = await upsertMaterial({
    sourceId: `${source}-${T}`, url: `https://example.org/${T}/${slug}`, title, excerpt: `${title}. The details follow in the report.`,
    bodyText: `${title}. ${"The report gives the details. ".repeat(10)}`, bodyStatus: "ok", via: "fetch", publishedAt: new Date(),
  } as never);
  assert.equal((await processArticle(articleId)).state, "triage");
  return articleId;
};
const state = async (id: string) => (await sql<{ processing_state: string }[]>`SELECT processing_state FROM articles WHERE id = ${id}`)[0]!.processing_state;

test("a pass sends each new story once with its coverage, and only its picks go on to analysis", async () => {
  const gov = await collect("gov", "U.S. adds 12 Chinese chip firms to entity list", "gov");
  const wire = await collect("wire", "US adds 12 Chinese chip firms to entity list", "wire");
  const paper = await collect("paper", "U.S. adds 12 Chinese chip firms to the entity list", "paper");
  const other = await collect("paper", "Shanghai opens a new art museum on the Bund", "museum");
  assert.equal(lists.length, 0, "waiting costs no model call");

  const summary = await triagePass();
  assert.equal(lists.length, 1);
  assert.match(lists[0]!, /^1\. \[primary \| 3 sources \| en 3\] U\.S\. adds 12 Chinese chip firms to entity list — /m, "the story's first-party report stands for it, with its coverage");
  assert.match(lists[0]!, /^2\. \[1 source \| en 1\] Shanghai opens a new art museum/m);
  assert.deepEqual([summary.waiting, summary.stories, summary.sent, summary.picked], [4, 2, 2, 1]);

  const [pick] = await sql<{ article_id: string; coverage: number; members: string[]; score: number; reason: string }[]>`SELECT * FROM triage_picks WHERE article_id = ${gov}`;
  assert.deepEqual([pick!.coverage, [...pick!.members].sort(), pick!.score, pick!.reason], [3, [gov, wire, paper].sort(), 88, "Changes who can sell chips to China"]);
  assert.deepEqual([await state(gov), await state(wire), await state(paper), await state(other)], ["new", "skipped", "skipped", "skipped"]);
  // The pick goes through the gate now, with the triage standing in for its prefilter.
  assert.deepEqual((await loadAnalyzeInput(gov))!.triage?.reason, "Changes who can sell chips to China");

  // 2,000 input and 500 output tokens at $0.30 and $1.20 per million.
  const [pass] = await sql<{ cost_usd: string; summary: { cost: { triage: number } } }[]>`SELECT cost_usd, summary FROM triage_passes ORDER BY id DESC LIMIT 1`;
  assert.equal(Number(pass!.cost_usd), 0.0012);
  assert.equal(pass!.summary.cost.triage, 0.0012);
  assert.equal(pings.at(-1)!.path, `/check-${T}`);
  assert.match(pings.at(-1)!.body, /1 picked; cost \$0\.0012 triage/);
});

test("a later report of a picked story only adds to its coverage, without a call", async () => {
  const late = await collect("wire", "Commerce adds 12 Chinese chip firms to the entity list", "late");
  const calls = lists.length;
  const summary = await triagePass();
  assert.equal(lists.length, calls);
  assert.deepEqual([summary.covered, summary.sent, summary.picked], [1, 0, 0]);
  assert.equal(await state(late), "skipped");
  const [pick] = await sql<{ members: string[] }[]>`SELECT members FROM triage_picks WHERE coverage = 3 AND ${late} = ANY(members)`;
  assert.ok(pick, "the late report is one of the story's members; its source was already counted");
});

test("out of credit (402): the healthcheck fails at once and the items wait for the next pass", async () => {
  refuse = true;
  try {
    const waiting = await collect("paper", "Beijing sets new rules for foreign-funded film studios", "film");
    await assert.rejects(triagePass(), /HTTP 402/);
    assert.equal(pings.at(-1)!.path, `/check-${T}/fail`);
    assert.match(pings.at(-1)!.body, /HTTP 402 \(out of credit\)/);
    assert.equal(await state(waiting), "triage");
  } finally {
    refuse = false;
  }
});

test("with the month's budget spent, a pass picks nothing", async () => {
  process.env.MODEL_MONTHLY_BUDGET_USD = "0.001";
  try {
    assert.equal((await pickAllowance(new Date())).picks, 0);
    const calls = lists.length;
    const summary = await triagePass();
    assert.equal(lists.length, calls, "no triage call when no pick can be paid for");
    assert.equal(summary.picked, 0);
  } finally {
    delete process.env.MODEL_MONTHLY_BUDGET_USD;
  }
});
