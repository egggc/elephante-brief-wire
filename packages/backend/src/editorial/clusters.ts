// Free story clustering before any model call (editorial/triage.ts): reports whose headlines share most
// of their words, within a time window, are one story. A story's coverage is the number of distinct
// sources reporting it, a heat signal that costs nothing. Headlines in different languages do not meet
// here; the triage model sees each side's coverage and judges the seam itself.

/** Words too common in headlines to say two of them tell the same story. */
const STOPWORDS = new Set((
  "a an the and or but of in on at to for from by with as is are was were be been it its this that these those " +
  "after before over under into amid against about than new news says say said report reports update live " +
  "will would could may might can has have had not no up out more most how why what who when where his her their our"
).split(" "));

/** Latin words (two letters or more, stopwords out), numbers, and pairs of adjacent Han characters. */
export function headlineTokens(title: string): Set<string> {
  const text = title.normalize("NFKC").toLowerCase();
  const tokens = new Set<string>();
  for (const word of text.match(/[a-z0-9][a-z0-9'.-]*[a-z0-9]|[0-9]/g) ?? []) {
    // Possessives and plurals fold onto the word: "exports" and "export", "Huawei's" and "Huawei".
    const w = word.replace(/'s$/, "").replace(/(?<=[a-z]{3})s$/, "");
    if (!STOPWORDS.has(w)) tokens.add(w);
  }
  for (const run of text.match(/[㐀-鿿]+/g) ?? []) {
    if (run.length === 1) tokens.add(run);
    for (let i = 0; i + 1 < run.length; i++) tokens.add(run.slice(i, i + 2));
  }
  return tokens;
}

/**
 * Same story: at least three shared tokens, and the shared ones carry at least half of the two headlines'
 * weight together (weighted Jaccard). `weight` makes words common in the window ("china", "export") count
 * for little, so two different stories sharing them stay apart. It errs towards keeping stories apart: a
 * missed duplicate costs a line in the triage list (the model is told to pick one), a false one hides a story.
 */
export function sameStory(a: Set<string>, b: Set<string>, weight: (token: string) => number = () => 1): boolean {
  let shared = 0, both = 0, all = 0;
  for (const t of a) {
    all += weight(t);
    if (b.has(t)) { shared++; both += weight(t); }
  }
  for (const t of b) if (!a.has(t)) all += weight(t);
  return shared >= 3 && both / all >= 0.5;
}

export interface ClusterItem {
  id: string;
  title: string;
  /** When it was published (or first seen); only items this close in time are compared. */
  at: Date;
}

/** Groups of item ids, each one story; items are joined when any pair of them is the same story. */
export function clusterItems<T extends ClusterItem>(items: readonly T[], windowMs: number): T[][] {
  const tokens = items.map((it) => headlineTokens(it.title));
  const parent = items.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)));
  // Only items sharing a token are compared.
  const byToken = new Map<string, number[]>();
  tokens.forEach((set, i) => { for (const t of set) byToken.set(t, [...(byToken.get(t) ?? []), i]); });
  // A token's weight: rarer in the window, heavier (inverse document frequency).
  const weight = (t: string) => Math.log(1 + items.length / (byToken.get(t)?.length ?? 1));
  const compared = new Set<string>();
  for (const list of byToken.values()) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const i = list[x]!, j = list[y]!;
        const key = `${i}:${j}`;
        if (compared.has(key)) continue;
        compared.add(key);
        if (Math.abs(items[i]!.at.getTime() - items[j]!.at.getTime()) > windowMs) continue;
        if (sameStory(tokens[i]!, tokens[j]!, weight)) parent[root(i)] = root(j);
      }
    }
  }
  const groups = new Map<number, T[]>();
  items.forEach((it, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), it]));
  return [...groups.values()];
}
