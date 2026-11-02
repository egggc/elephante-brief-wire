// Batch triage (site/site.ts TRIAGE): instead of a prefilter and a score for every collected item, the model
// reads a few lists a day and picks the stories worth a full write-up.
//   1. Free, before any model call: an editorial item due for analysis waits in 'triage' (holdForTriage);
//      at each pass the waiting items and the window's earlier ones are grouped into stories by headline
//      (clusters.ts). A story already picked or analysed takes in its new reports without a call; each
//      story's coverage (distinct sources, by language) is counted for free.
//   2. The new stories, `batchSize` per call, as headline, snippet and coverage: the model returns its picks
//      with a score and a reason (prompts/triage.md, the selection standard at headline level).
//   3. The best picks across the calls, as many as the month's budget allows (pickAllowance), go back to
//      'new': the sweep queues them, and they are scored and written up like any item, the triage standing
//      in for their prefilter. The rest are left out ('skipped'); they still count as coverage later.
// Each pass records what it saw, picked and spent (triage_passes) and pings healthchecks when it completes.
import { TRIAGE } from "@aihot/site";
import { z } from "zod";
import { sql } from "../db.ts";
import { collapseWhitespace } from "../lib/text.ts";
import { pingSuccess } from "../operations/healthchecks.ts";
import { chatJson } from "../providers/llm.ts";
import { clusterItems } from "./clusters.ts";
import { modelFor } from "./models.ts";
import { promptText, promptVersion } from "./prompts.ts";

export const TRIAGE_PROMPT_VERSION = promptVersion("triage");
/** What one pick and one pass cost before there is a week of history to measure (US dollars). */
const PRIOR = { pick: 0.01, pass: 0.01 };

/**
 * Called by the analysis job (jobs/content.ts) before any model call: true when the article waits for the
 * next triage pass (or, being history, is left out). Picks and items an editor selected go through.
 */
export async function holdForTriage(articleId: string, revision: number, historical: boolean): Promise<boolean> {
  if (!TRIAGE.enabled) return false;
  const [row] = await sql<{ through: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM triage_picks WHERE article_id = ${articleId})
        OR EXISTS (SELECT 1 FROM editorial_overrides WHERE article_id = ${articleId} AND fields->'selected' = 'true'::jsonb) AS through`;
  if (row?.through) return false;
  await sql`
    UPDATE articles SET processing_state = ${historical ? "skipped" : "triage"}, processing_error = NULL, processing_attempts = 0,
      processing_retry_at = NULL, processing_queued_at = NULL
    WHERE id = ${articleId} AND revision = ${revision}`;
  return true;
}

interface Item {
  id: string;
  title: string;
  snippet: string;
  language: string | null;
  at: Date;
  source_id: string;
  tier: string;
  state: string;
  picked: boolean;
}

export interface Story {
  members: Item[];
  rep: Item;
  coverage: number;
  primary: boolean;
  languages: Record<string, number>;
}

const TIER_RANK: Record<string, number> = { T1: 0, T1_5: 1, T2: 2 };
const languageOf = (it: Item) => (it.language === "zh" || /[㐀-鿿]/.test(it.title) ? "zh" : "en");

/** The report that stands for a story: first-party before media, one with text, the earliest. */
export function storyOf(members: Item[]): Story {
  const rep = [...members].sort((a, b) => (TIER_RANK[a.tier] ?? 3) - (TIER_RANK[b.tier] ?? 3)
    || Number(!b.snippet) - Number(!a.snippet) || a.at.getTime() - b.at.getTime())[0]!;
  const languages: Record<string, number> = {};
  const seen = new Set<string>();
  for (const m of members) {
    if (seen.has(m.source_id)) continue;
    seen.add(m.source_id);
    languages[languageOf(m)] = (languages[languageOf(m)] ?? 0) + 1;
  }
  return { members, rep, coverage: seen.size, primary: members.some((m) => m.tier === "T1"), languages };
}

/** One line of a triage list: `n. [flags] headline — snippet`. */
export function storyLine(n: number, s: Story): string {
  const langs = Object.entries(s.languages).map(([l, c]) => `${l} ${c}`).join(", ");
  const flags = [s.primary ? "primary" : null, `${s.coverage} source${s.coverage === 1 ? "" : "s"}`, langs].filter(Boolean).join(" | ");
  const snippet = collapseWhitespace(s.rep.snippet);
  const short = snippet.length > 160 ? `${snippet.slice(0, 157).trimEnd()}…` : snippet;
  return `${n}. [${flags}] ${collapseWhitespace(s.rep.title)}${short ? ` — ${short}` : ""}`;
}

const TriageSchema = z.object({
  picks: z.array(z.object({
    n: z.coerce.number().int(),
    score: z.coerce.number().min(0).max(100).catch(50),
    reason: z.string().catch("").transform((r) => r.trim().slice(0, 200)),
  })).catch([]),
});

const usd = (value: string | undefined): number | null => {
  const n = value?.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
const money = (n: number) => Math.round(n * 1e6) / 1e6;

/** Model spend (service llm: the default model) since a time, in US dollars; with `purpose`, of that step only. */
async function spentSince(since: Date, purpose?: string): Promise<number> {
  const [row] = await sql<{ total: string | null }[]>`
    SELECT sum(cost) AS total FROM receipts
    WHERE service = 'llm' AND currency = 'USD' AND created_at >= ${since} ${purpose ? sql`AND purpose = ${purpose}` : sql``}`;
  return Number(row?.total ?? 0);
}

/** What one pass's triage calls cost. */
async function passCost(passId: string): Promise<number> {
  const [row] = await sql<{ total: string | null }[]>`
    SELECT sum(cost) AS total FROM receipts WHERE purpose = 'triage_batch' AND subject LIKE ${`triage:${passId}:%`} AND currency = 'USD'`;
  return Number(row?.total ?? 0);
}

/**
 * How many picks this pass may make: TRIAGE.picksPerPass, fewer when MODEL_MONTHLY_BUDGET_USD is set and
 * what is left of it, spread over the month's remaining passes, pays for fewer. A pick's cost is measured
 * over the last week (all model spend except triage, per pick, so grouping and digests are counted).
 */
export async function pickAllowance(now: Date) {
  const budget = usd(process.env.MODEL_MONTHLY_BUDGET_USD);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const spentMonth = await spentSince(monthStart);
  if (budget === null) return { picks: TRIAGE.picksPerPass, budget: null, spentMonth: money(spentMonth), costPerPick: null };
  const week = new Date(now.getTime() - 7 * 86400_000);
  const [hist] = await sql<{ picks: number; passes: number }[]>`
    SELECT (SELECT count(*)::int FROM triage_picks WHERE created_at >= ${week}) AS picks,
           (SELECT count(*)::int FROM triage_passes WHERE started_at >= ${week} AND finished_at IS NOT NULL) AS passes`;
  const triageWeek = await spentSince(week, "triage_batch");
  const otherWeek = (await spentSince(week)) - triageWeek;
  const costPerPick = hist!.picks >= 5 && otherWeek > 0 ? otherWeek / hist!.picks : PRIOR.pick;
  const costPerPass = hist!.passes >= 2 && triageWeek > 0 ? triageWeek / hist!.passes : PRIOR.pass;
  const passesLeft = Math.max(1, Math.ceil(((monthEnd.getTime() - now.getTime()) / 86400_000) * TRIAGE.times.length));
  const perPass = (budget - spentMonth) / passesLeft;
  const picks = Math.max(0, Math.min(TRIAGE.picksPerPass, Math.floor((perPass - costPerPass) / costPerPick)));
  return { picks, budget, spentMonth: money(spentMonth), perPass: money(perPass), costPerPick: money(costPerPick), costPerPass: money(costPerPass) };
}

/** The scheduled pass (apps/worker/src/schedules.ts). */
export async function triagePass(now = new Date()): Promise<Record<string, unknown>> {
  if (!TRIAGE.enabled) return { skipped: "triage is off" };
  const since = new Date(now.getTime() - TRIAGE.windowHours * 3600_000);
  // Waiting items older than the window are left out without a call.
  const aged = await sql`UPDATE articles SET processing_state = 'skipped' WHERE processing_state = 'triage' AND discovered_at < ${since} RETURNING id`;
  const items = await sql<Item[]>`
    SELECT a.id, a.title, coalesce(nullif(a.excerpt, ''), left(a.body_text, 600), '') AS snippet, a.language,
           coalesce(a.published_at, a.discovered_at) AS at, a.source_id, s.tier, a.processing_state AS state, (tp.article_id IS NOT NULL) AS picked
    FROM articles a JOIN sources s ON s.id = a.source_id LEFT JOIN triage_picks tp ON tp.article_id = a.id
    WHERE s.participation_mode = 'editorial' AND a.discovered_at >= ${since}`;
  const waiting = items.filter((it) => it.state === "triage");
  if (!waiting.length) {
    await pingSuccess("triage pass: nothing new to triage");
    return { waiting: 0, aged: aged.length };
  }

  const stories = clusterItems(items, TRIAGE.windowHours * 3600_000).filter((c) => c.some((it) => it.state === "triage")).map(storyOf);
  // A story already picked or analysed: its new reports are coverage, not a new story.
  const handled = (s: Story) => s.members.some((m) => m.picked || m.state === "analyzed");
  const covered = stories.filter(handled);
  const fresh = stories.filter((s) => !handled(s))
    .sort((a, b) => b.coverage - a.coverage || Number(b.primary) - Number(a.primary) || b.rep.at.getTime() - a.rep.at.getTime());

  const allowance = await pickAllowance(now);
  const [pass] = await sql<{ id: string }[]>`INSERT INTO triage_passes (started_at) VALUES (${now}) RETURNING id`;
  const passId = pass!.id;
  const chosen: Array<{ story: Story; score: number; reason: string; receiptId: number }> = [];
  let batches = 0;
  if (allowance.picks > 0 && fresh.length) {
    const model = await modelFor("triage");
    for (let start = 0; start < fresh.length; start += TRIAGE.batchSize) {
      const batch = fresh.slice(start, start + TRIAGE.batchSize);
      // Each list may name its share of the picks, with room to spare: the best across lists are kept.
      const k = Math.max(1, Math.min(allowance.picks, Math.ceil((1.5 * allowance.picks * batch.length) / fresh.length)));
      batches += 1;
      const res = await chatJson({
        model, purpose: "triage_batch", subject: `triage:${passId}:${batches}`, promptVersion: TRIAGE_PROMPT_VERSION,
        system: promptText("triage", { picks: String(k) }), user: batch.map((s, i) => storyLine(i + 1, s)).join("\n"),
        schema: TriageSchema, temperature: 0.2, maxTokens: 300 + k * 60, timeoutMs: 180_000,
      });
      const named = new Set<number>();
      for (const p of res.data.picks) {
        const story = batch[p.n - 1];
        if (!story || named.has(p.n) || named.size >= k) continue;
        named.add(p.n);
        chosen.push({ story, score: Math.round(p.score), reason: p.reason, receiptId: res.receiptId });
      }
    }
  }
  const picks = chosen.sort((a, b) => b.score - a.score || b.story.coverage - a.story.coverage).slice(0, allowance.picks);

  await sql.begin(async (tx) => {
    for (const p of picks) {
      await tx`
        INSERT INTO triage_picks (article_id, pass_id, score, reason, coverage, members, receipt_id)
        VALUES (${p.story.rep.id}, ${passId}, ${p.score}, ${p.reason}, ${p.story.coverage}, ${p.story.members.map((m) => m.id)}, ${p.receiptId})
        ON CONFLICT (article_id) DO NOTHING`;
      // The sweep (content.sweep, every five minutes) queues it for scoring and the write-up.
      await tx`UPDATE articles SET processing_state = 'new', processing_queued_at = NULL, processing_attempts = 0, processing_retry_at = NULL
               WHERE id = ${p.story.rep.id}`;
    }
    for (const s of covered) {
      const pick = s.members.find((m) => m.picked);
      if (pick) await tx`UPDATE triage_picks SET coverage = ${s.coverage}, members = ${s.members.map((m) => m.id)} WHERE article_id = ${pick.id}`;
    }
    const reps = picks.map((p) => p.story.rep.id);
    await tx`UPDATE articles SET processing_state = 'skipped'
             WHERE id = ANY(${waiting.map((w) => w.id).filter((id) => !reps.includes(id))}) AND processing_state = 'triage'`;
  });

  // What it cost: this pass's calls, the day's and the month's model spend, and the month at this pace.
  const triageCost = await passCost(passId);
  const day = await spentSince(new Date(now.getTime() - 86400_000));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const elapsedDays = Math.max(1, (now.getTime() - monthStart.getTime()) / 86400_000);
  const spentMonth = await spentSince(monthStart);
  const cost = {
    triage: money(triageCost),
    picksEstimate: money(picks.length * (allowance.costPerPick ?? PRIOR.pick)),
    last24h: money(day),
    monthToDate: money(spentMonth),
    monthProjected: money((spentMonth / elapsedDays) * daysInMonth),
    budget: allowance.budget,
  };
  const summary = {
    waiting: waiting.length, aged: aged.length, stories: stories.length, covered: covered.length, sent: fresh.length, batches,
    picked: picks.length, allowance, cost,
  };
  await sql`UPDATE triage_passes SET finished_at = now(), summary = ${sql.json(summary as never)}, cost_usd = ${cost.triage} WHERE id = ${passId}`;
  const line = `triage pass ${passId}: ${waiting.length} new items, ${fresh.length} new stories in ${batches} calls, ${picks.length} picked; `
    + `cost $${cost.triage.toFixed(4)} triage + ~$${cost.picksEstimate.toFixed(4)} for the picks; last 24 h $${cost.last24h.toFixed(4)}, `
    + `month $${cost.monthToDate.toFixed(2)} (at this pace $${cost.monthProjected.toFixed(2)}${cost.budget ? ` of $${cost.budget.toFixed(2)}` : ""})`;
  console.log(line);
  await pingSuccess(line);
  return summary;
}
