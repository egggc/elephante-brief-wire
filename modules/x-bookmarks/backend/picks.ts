// The editor's picks, read from the editor's X bookmarks. X's terms do not allow republishing post text,
// so no post text reaches a public surface:
// - A post that links an article brings in the article alone, through the ingest path as the source
//   "X — Editor's picks": its title and description from the link card, its page fetched from the
//   publisher like any bare report. It is always selected, tagged editor-pick, and its "why it matters"
//   line ends with "Editor's pick" and the link to the post.
// - Any other post is kept privately under "X — Editor's bookmarks", a heat-only source: it has no item
//   page and is in no list, feed, API answer or report; it only adds heat to the event it belongs to.
// Both are positive labels for scripts/eval-selection.ts (scripts/gold.ts exports them).
import { sql } from "@aihot/backend/db";
import { ingestItems } from "@aihot/backend/ingest/items";
import { queueProcessing } from "@aihot/backend/jobs/content";
import { publishArticle } from "@aihot/backend/publication/publish";
import { accessToken, bookmarksPage, ensureBudget, xApp, type XPost, type XUrl } from "./x.ts";

export const SOURCE_ID = "x-editor-picks";
export const SOURCE_NAME = "X — Editor's picks";
export const PRIVATE_SOURCE_ID = "x-editor-bookmarks";
export const PRIVATE_SOURCE_NAME = "X — Editor's bookmarks";
export const TAG = "editor-pick";
const REASON = "Editor's pick (X bookmark)";
/** Bookmarks read per page (each run reads the newest page even when nothing is new, and X bills by posts read); a page with anything already seen ends the run. */
const PAGE_SIZE = 10;
const MAX_PAGES = 10;

/** The two sources: picks first-party and editorial, so they are judged and shown; bookmarks heat only. */
async function ensureSources(): Promise<void> {
  await sql`
    INSERT INTO sources (id, name, kind, config, tier, participation_mode, interval_minutes, enabled, health, tags)
    VALUES (${SOURCE_ID}, ${SOURCE_NAME}, 'external', '{}'::jsonb, 'T1', 'editorial', 15, true, 'ok', ${[TAG]}),
           (${PRIVATE_SOURCE_ID}, ${PRIVATE_SOURCE_NAME}, 'external', '{}'::jsonb, 'T2', 'hot_signal', 15, true, 'ok', ${[TAG]})
    ON CONFLICT (id) DO NOTHING`;
}

const X_HOSTS = /^(?:[a-z0-9-]+\.)*(?:x\.com|twitter\.com|t\.co)$/i;
const linksOf = (post: XPost) => post.note_tweet?.entities?.urls ?? post.entities?.urls ?? [];

/** The post's full text with its t.co links written out (kept privately only). */
export function postText(post: XPost): string {
  let text = post.note_tweet?.text ?? post.text;
  for (const u of linksOf(post)) text = text.replaceAll(u.url, u.unwound_url ?? u.expanded_url ?? u.url);
  return text.trim();
}

/** The first link to a page off X (an article), if any. */
export function linkedArticle(post: XPost): XUrl & { href: string } | null {
  for (const u of linksOf(post)) {
    const href = u.unwound_url ?? u.expanded_url;
    if (!href) continue;
    try {
      if (!X_HOSTS.test(new URL(href).hostname)) return { ...u, href };
    } catch { /* not a URL */ }
  }
  return null;
}

const headline = (text: string) => {
  const line = text.split("\n").map((l) => l.trim()).find(Boolean) ?? text;
  return line.length > 160 ? `${line.slice(0, 157).trimEnd()}…` : line;
};

export const postUrl = (post: XPost, handle: string | null) => `https://x.com/${handle ?? "i/web"}/status/${post.id}`;

/** The report a bookmark becomes, and the source it goes to. */
export function pickItem(post: XPost, handle: string | null) {
  const link = linkedArticle(post);
  const raw = { x: { id: post.id, url: postUrl(post, handle), author: handle } };
  if (link) {
    // The publisher's own title and description, from the link card; nothing of the post.
    const item = { title: link.title?.trim() || link.href, url: link.href, publishedAt: post.created_at, summary: link.description?.trim() || undefined, raw };
    return { sourceId: SOURCE_ID, sourceName: SOURCE_NAME, item };
  }
  const text = postText(post);
  const item = { title: headline(text) || postUrl(post, handle), url: postUrl(post, handle), publishedAt: post.created_at, author: handle ? `@${handle}` : null, body: text, raw };
  return { sourceId: PRIVATE_SOURCE_ID, sourceName: PRIVATE_SOURCE_NAME, item };
}

/** Marks the article as the editor's pick: always selected, tagged, its post named in the public reason. */
async function markPick(articleId: string, post: string, created: boolean): Promise<void> {
  await sql`
    INSERT INTO editorial_overrides (article_id, fields, reason, version, updated_by)
    VALUES (${articleId}, ${sql.json({ selected: true, addTags: [TAG], reasonNote: `Editor's pick: ${post}` })}, ${REASON}, 1, 'x-bookmarks')
    ON CONFLICT (article_id) DO UPDATE SET fields = editorial_overrides.fields || EXCLUDED.fields, reason = EXCLUDED.reason,
      version = editorial_overrides.version + 1, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  if (created) return;
  // Already on the site (another source reported it first): shown as selected now; one the prefilter
  // turned away gets a new judgement, which an editor's pick passes.
  const [latest] = await sql<{ relevance: string }[]>`SELECT relevance FROM analyses WHERE article_id = ${articleId} ORDER BY input_revision DESC, id DESC LIMIT 1`;
  if (latest?.relevance === "block") await queueProcessing(articleId, { attemptTag: "editor-pick" });
  else await publishArticle(articleId);
}

/** The scheduled run: new bookmarks since the last run, oldest first. */
export async function syncBookmarks(now = new Date()): Promise<Record<string, unknown>> {
  const app = xApp();
  if (!app) return { skipped: "X_CLIENT_ID and X_REDIRECT_URI are not set" };
  await ensureBudget();
  const auth = await accessToken(app);
  if (!auth) return { skipped: "no X account: run scripts/x-auth.ts once" };
  await ensureSources();
  // The first run takes the latest page only, not the whole history of bookmarks.
  const [any] = await sql`SELECT 1 FROM x_bookmarks_picks LIMIT 1`;
  const window = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();
  const fresh: Array<{ post: XPost; handle: string | null }> = [];
  let pageToken: string | null = null;
  let pages = 0;
  do {
    const page = await bookmarksPage(auth.token, auth.userId, { pageToken, window, size: PAGE_SIZE });
    pages += 1;
    const posts = page.data ?? [];
    const users = new Map((page.includes?.users ?? []).map((u) => [u.id, u.username]));
    const seen = new Set((await sql<{ tweet_id: string }[]>`SELECT tweet_id FROM x_bookmarks_picks WHERE tweet_id = ANY(${posts.map((p) => p.id)})`).map((r) => r.tweet_id));
    for (const post of posts) if (!seen.has(post.id)) fresh.push({ post, handle: users.get(post.author_id ?? "") ?? null });
    pageToken = any && seen.size === 0 ? page.meta?.next_token ?? null : null;
  } while (pageToken && pages < MAX_PAGES);

  let articles = 0;
  let posts = 0;
  for (const { post, handle } of fresh.reverse()) {
    const { sourceId, sourceName, item } = pickItem(post, handle);
    const article = sourceId === SOURCE_ID;
    await ingestItems({ sourceId, sourceName, items: [item] }, {
      prepare: async (articleId, { created }) => {
        if (article) await markPick(articleId, postUrl(post, handle), created);
        await sql`INSERT INTO x_bookmarks_picks (tweet_id, article_id, url) VALUES (${post.id}, ${articleId}, ${item.url}) ON CONFLICT (tweet_id) DO NOTHING`;
        if (article) articles += 1;
        else posts += 1;
      },
    });
    // One ingest turned away (no usable title or address) is not read again.
    await sql`INSERT INTO x_bookmarks_picks (tweet_id, article_id, url) VALUES (${post.id}, NULL, ${item.url}) ON CONFLICT (tweet_id) DO NOTHING`;
  }
  return { pages, new: fresh.length, articles, posts };
}
