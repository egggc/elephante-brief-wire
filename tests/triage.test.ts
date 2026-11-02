// Batch triage (editorial/triage.ts): collected items wait without a model call; a pass groups them into
// stories for free, counts each story's coverage, sends the new stories in one list per call, and its score
// decides selection: picks below the tier threshold are dropped, the rest get one call each for the
// write-up and the structure. A story already picked takes in later reports without a call. Every pass
// records its cost, cache reads included; a refusal for money (402) fails the healthcheck at once; a spent
// monthly budget stops the picks.
import { Reply, stub, tag } from "./setup.ts";
import { TRIAGE } from "@aihot/site";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { analyzeArticle, PICK_SYSTEM } from "@aihot/backend/editorial/analyze";
import { loadAnalyzeInput } from "@aihot/backend/editorial/input";
import { promptText } from "@aihot/backend/editorial/prompts";
import { pickAllowance, triagePass } from "@aihot/backend/editorial/triage";
import { processArticle } from "@aihot/backend/jobs/content";
import { stopBoss } from "@aihot/backend/jobs/queue";

const T = tag();
const TRIAGE_SYSTEM = promptText("triage");
const lists: string[] = [];
const picks: Array<{ system: unknown }> = [];
let refuse = false;
// Half of every call's input is read from the provider's cache.
const usage = { prompt_tokens: 2000, completion_tokens: 500, total_tokens: 2500, prompt_tokens_details: { cached_tokens: 1000 } };
const answer = (content: unknown) => ({ id: "stub", model: "stub", choices: [{ message: { content: JSON.stringify(content) } }], usage });
const PICK_ANSWER = {
  itemType: "policy_action", authorRole: "principal", editorialJudgment: "Moves export pressure upstream to chip tools.",
  titleEn: "U.S. adds 12 Chinese chip firms to the entity list", summaryEn: "The Commerce Department added 12 Chinese chip firms to its entity list.",
  titleZh: "美国将12家中国芯片企业列入实体清单", summaryZh: "美国商务部将12家中国芯片企业列入实体清单。",
  category: "policy", tags: ["Regulation", "Export controls"], subjects: [], scope: "single",
  fact: { title: "U.S. adds 12 Chinese chip firms to entity list", subject: "Commerce Department", action: "adds", object: "12 Chinese chip firms", occurredAt: null, evidence: null, conditions: [] },
  claims: [],
};
const model = await stub((_hit, req) => {
  const body = JSON.parse(req.body) as { messages: Array<{ role: string; content: unknown }> };
  const system = body.messages[0]!.content;
  if (refuse) return new Reply(402, { error: { code: 402, message: "Insufficient credits" } });
  const text = typeof system === "string" ? system : (system as Array<{ text: string }>)[0]!.text;
  if (text === PICK_SYSTEM) {
    picks.push({ system });
    return answer(PICK_ANSWER);
  }
  // Every triage call sends the same instructions.
  if (text !== TRIAGE_SYSTEM) return new Reply(500, { error: "unexpected system prompt" });
  const list = String(body.messages.at(-1)!.content);
  lists.push(list);
  const n = (re: RegExp) => Number(re.exec(list)?.[1] ?? 0);
  return answer({ picks: [
    { n: n(/^(\d+)\. .*entity list/im), score: 88, reason: "Changes who can sell chips to China" },
    { n: n(/^(\d+)\. .*museum/im), score: 20, reason: "Local culture news" },
  ].filter((p) => p.n > 0) });
});
const pings: Array<{ path: string; body: string }> = [];
const healthchecks = await stub((_hit, req) => { pings.push({ path: req.url, body: req.body }); return { ok: true }; });

before(async () => {
  TRIAGE.enabled = true;
  Object.assign(process.env, {
    TRIAGE_MODEL: "default", PICK_MODEL: "default", LLM_BASE_URL: `${model.url}/v1`, LLM_API_KEY: "test-key", LLM_MODEL: "minimax/minimax-m2.5",
    LLM_INPUT_USD_PER_M: "0.225", LLM_CACHED_INPUT_USD_PER_M: "0.06", LLM_OUTPUT_USD_PER_M: "0.9", HEALTHCHECKS_URL: `${healthchecks.url}/check-${T}`,
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
  assert.match(lists[0]!, /^Pick at most \d+ of these 2 stories\.$/m, "the pick count travels with the list, not in the cached instructions");
  assert.match(lists[0]!, /^1\. \[primary \| 3 sources \| en 3\] U\.S\. adds 12 Chinese chip firms to entity list — /m, "the story's first-party report stands for it, with its coverage");
  assert.match(lists[0]!, /^2\. \[1 source \| en 1\] Shanghai opens a new art museum/m);
  // The museum story scored 20, below its T2 threshold: not written up.
  assert.deepEqual([summary.waiting, summary.stories, summary.sent, summary.belowThreshold, summary.picked], [4, 2, 2, 1, 1]);

  const [pick] = await sql<{ article_id: string; coverage: number; members: string[]; score: number; reason: string }[]>`SELECT * FROM triage_picks WHERE article_id = ${gov}`;
  assert.deepEqual([pick!.coverage, [...pick!.members].sort(), pick!.score, pick!.reason], [3, [gov, wire, paper].sort(), 88, "Changes who can sell chips to China"]);
  assert.deepEqual([await state(gov), await state(wire), await state(paper), await state(other)], ["new", "skipped", "skipped", "skipped"]);
  // The pick goes through the gate now, with the triage standing in for its prefilter.
  assert.deepEqual((await loadAnalyzeInput(gov))!.triage?.reason, "Changes who can sell chips to China");

  // 1,000 fresh and 1,000 cached input tokens and 500 output tokens at $0.225, $0.06 and $0.90 per million.
  const [pass] = await sql<{ cost_usd: string; summary: { cost: { triage: number; cache24h: { hitRate: number } } } }[]>`SELECT cost_usd, summary FROM triage_passes ORDER BY id DESC LIMIT 1`;
  assert.equal(Number(pass!.cost_usd), 0.000735);
  assert.deepEqual([pass!.summary.cost.triage, pass!.summary.cost.cache24h.hitRate], [0.000735, 0.5]);
  assert.equal(pings.at(-1)!.path, `/check-${T}`);
  assert.match(pings.at(-1)!.body, /1 picked; cost \$0\.0007 triage .* cache hits 50% of 2000 input tokens in 24 h/);
});

test("a pick is selected on its triage score and written up with its structure in one call", async () => {
  const [gov] = await sql<{ article_id: string }[]>`SELECT article_id FROM triage_picks WHERE score = 88`;
  process.env.LLM_CACHE_CONTROL = "true";
  try {
    const res = await analyzeArticle(gov!.article_id);
    assert.equal(picks.length, 1, "no prefilter, no score call, no separate structure call");
    assert.deepEqual(picks[0]!.system, [{ type: "text", text: PICK_SYSTEM, cache_control: { type: "ephemeral" } }], "the instructions are marked for the cache");
    assert.deepEqual([res!.output!.selected, res!.output!.score, res!.output!.category, res!.output!.tags], [true, 88, "policy", ["Regulation", "Export controls"]]);
    assert.equal(res!.output!.reasonZh, "Moves export pressure upstream to chip tools.");
    assert.match(res!.output!.summaryZh, /^The Commerce Department added 12 Chinese chip firms to its entity list\.\n\n美国将12家中国芯片企业列入实体清单\n/);
    assert.equal(res!.receiptIds.length, 2, "the triage list's receipt and the one write-up receipt");
    const [row] = await sql<{ output: { prefilter: { reason: string }; scoreModel: string; writer: string } }[]>`SELECT output FROM analyses WHERE id = ${res!.analysisId}`;
    assert.deepEqual([row!.output.prefilter.reason, row!.output.scoreModel, row!.output.writer], ["triage: Changes who can sell chips to China", "triage", "understand"]);
  } finally {
    delete process.env.LLM_CACHE_CONTROL;
  }
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
