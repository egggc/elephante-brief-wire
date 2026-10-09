// The claims ledger: checkable claims and forecasts the structure step extracted from selected items (who said
// what will happen, by when), listed when they are due for scoring 30 and 90 days after the item.
//   node --env-file=.env scripts/claims-due.ts                 claims due today (30 and 90 days, ±3 days)
//   node --env-file=.env scripts/claims-due.ts --days 30 --window 7 --json
import { closeDb, sql } from "@aihot/backend/db";

const arg = (name: string) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const ages = arg("days") ? [Number(arg("days"))] : [30, 90];
const window = Number(arg("window") ?? 3);
const asJson = process.argv.includes("--json");

interface Row { age: number; article_id: string; title: string; url: string; at: Date; claims: Array<{ speaker: string; claim: string; by: string | null; quote: string | null }> }

const rows: Row[] = [];
for (const age of ages) {
  rows.push(...await sql<Row[]>`
    SELECT ${age}::int AS age, p.article_id, p.title, p.url, coalesce(p.published_at, p.visible_after) AS at, an.output->'claims' AS claims
    FROM publications p
    JOIN LATERAL (SELECT output FROM analyses x WHERE x.article_id = p.article_id ORDER BY input_revision DESC, id DESC LIMIT 1) an ON true
    WHERE p.selected AND p.visibility = 'public' AND jsonb_typeof(an.output->'claims') = 'array'
      AND coalesce(p.published_at, p.visible_after) BETWEEN now() - make_interval(days => ${age + window}) AND now() - make_interval(days => ${age - window})
    ORDER BY at`);
}

if (asJson) console.log(JSON.stringify(rows, null, 2));
else if (!rows.length) console.log(`No claims due (${ages.join(" and ")} days, ±${window}).`);
else for (const r of rows) {
  console.log(`\n[${r.age} days] ${r.at.toISOString().slice(0, 10)} ${r.title}\n${r.url}`);
  for (const c of r.claims) console.log(`  - ${c.speaker}: ${c.claim}${c.by ? ` (by ${c.by})` : ""}`);
}
await closeDb();
