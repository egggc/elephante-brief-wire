// Selection thresholds. The scoring standard itself is in prompts/selection-score.md; this only decides how many
// points make the cut. Each item is scored twice, independently (0–100); when the two add up to at least
// 2 × the threshold and grouping confirms it is not a repeat of a story already selected, it is selected
// (docs/selection.md). Cards show the mean of the two scores.
//
// Elephante Brief's rubric has four axes worth 10 points together, times 10: stakes 0–3 (the higher of the
// cross-border stakes and the item's significance as U.S. or Chinese business, markets, policy or tech news, so a
// Fed decision or a big tech launch scores 3 with no China angle), the speaker's cost of being wrong 0–3, and two
// bonuses, seam asymmetry 0–2 and quiet signal 0–2. Only an item that is neither cross-border nor major business,
// markets, policy or tech news (stakes 0) is capped at 20. So a threshold of 60 means "6 of 10": real stakes plus
// well-sourced, or real stakes plus a bonus. These are starting values, not calibrated ones: label 100–200 items
// from these sources, run scripts/eval-selection.ts and move them by what it shows (docs/selection.md).

export const SELECTION = {
  /**
   * Source tier → threshold (mean score). Set each source's tier in the admin under Sources:
   *   T1 first-party (the government body or company itself) · T1_5 official and semi-official media · T2 media and individuals
   * EXCLUDE_MP and tiers not listed here are not scored for selection (they appear only in "All").
   */
  thresholds: { T1: 50, T1_5: 50, T2: 60 } as Record<string, number>,
  /**
   * Unselected items with a mean score above this are written up like selected ones (content understanding: both
   * headlines, both summaries, the "why it matters" line); the rest get the cheaper headline-and-summary prompt.
   */
  understandFloor: 40,
} as const;
