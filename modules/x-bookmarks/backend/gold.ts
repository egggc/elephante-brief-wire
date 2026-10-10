// The editor's picks as positive cases of a selection gold set (the GoldRow of scripts/eval-selection.ts).
// They are scored as ordinary media reports (T2, not first-party): the label says the story itself
// deserved selection, which is what the threshold should be calibrated to.
import type { Db } from "@aihot/backend/db";

export async function goldRows(db: Db, split: string) {
  const rows = await db<{ tweet_id: string; title: string; published_at: Date | null; language: string | null; excerpt: string | null; body_text: string | null }[]>`
    SELECT p.tweet_id, a.title, a.published_at, a.language, a.excerpt, a.body_text
    FROM x_bookmarks_picks p JOIN articles a ON a.id = p.article_id
    ORDER BY p.created_at`;
  return rows.map((r) => ({
    caseId: `x-pick:${r.tweet_id}`,
    material: {
      title: r.title, originalTitle: null, publishedAt: r.published_at?.toISOString() ?? null, sourceName: "Editor's pick",
      bodyZh: null, bodyOriginal: [r.excerpt, r.body_text].filter(Boolean).join("\n\n") || null,
    },
    sourceFacts: { sourceKind: "external", sourceTier: "T2", firstParty: false, language: r.language },
    samplingContext: { benchmarkSplit: split, samplingStratum: "editor-pick" },
    gold: { decision: "select" as const },
  }));
}
