// Adds the editor's picks to a gold set for scripts/eval-selection.ts as "select" cases (stratum
// "editor-pick"); cases already in the file are left as they are.
// Usage: node --env-file=.env modules/x-bookmarks/scripts/gold.ts [--out .data/gold.jsonl] [--split development]
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { REPO_ROOT } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { goldRows } from "../backend/gold.ts";

const { values } = parseArgs({ options: { out: { type: "string", default: ".data/gold.jsonl" }, split: { type: "string", default: "development" } } });
const file = path.resolve(REPO_ROOT, values.out!);
const known = new Set(existsSync(file)
  ? readFileSync(file, "utf8").split("\n").filter((l) => l.trim() && !l.trim().startsWith("//")).map((l) => (JSON.parse(l) as { caseId: string }).caseId)
  : []);
try {
  const rows = (await goldRows(sql, values.split!)).filter((row) => !known.has(row.caseId));
  mkdirSync(path.dirname(file), { recursive: true });
  if (rows.length) appendFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  console.log(`${rows.length} editor's picks added to ${values.out} (${known.size} cases were there).`);
} finally {
  await closeDb();
}
