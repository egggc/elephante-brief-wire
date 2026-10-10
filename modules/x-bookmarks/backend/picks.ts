// The editor's picks: posts the editor bookmarks on X come in through the ingest path as the source
// "X — Editor's picks" and are always selected. A post that links an article brings in the article (its
// page is fetched like any bare report) with the post as context; any other post comes in as itself.
// Each pick is also a positive label for scripts/eval-selection.ts (scripts/gold.ts exports them).
import { sql } from "@aihot/backend/db";
import { ingestItems } from "@aihot/backend/ingest/items";
import { queueProcessing } from "@aihot/backend/jobs/content";
import { publishArticle } from "@aihot/backend/publication/publish";
import { accessToken, bookmarksPage, ensureBudget, xApp, type XPost, type XUrl } from "./x.ts";

export const SOURCE_ID = "x-editor-picks";
export const SOURCE_NAME = "X — Editor's picks";
export const TAG = "editor-pick";
const REASON = "Editor's pick (X bookmark)";
/** Bookmarks read per page (each run reads the newest page even when nothing is new, and X bills by posts read); a page with anything already seen ends the run. */
const PAGE_SIZE = 10;
const MAX_PAGES = 10;

/** The source, created as a first-party editorial one so its items are judged and shown. */
async function ensureSource(): Promise<void> {
  await sql`
    INSERT INTO sources (id, name, kind, config, tier, participation_mode, interval_minutes, enabled, health, tags)
    VALUES (${SOURCE_ID}, ${SOURCE_NAME}, 'external', '{}'::jsonb, 'T1', 'editorial', 15, true, 'ok', ${[TAG]})
    ON CONFLICT (id) DO NOTHING`;
}

const X_HOSTS = /^(?:[a-z0-9-]+\.)*(?:x\.com|twitter\.com|t\.co)$/i;

/** The post's full text with its t.co links written out. */
export function postText(post: XPost): string {
  let text = post.note_tweet?.text ?? post.text;
  for (const u of post.note_tweet?.entities?.urls ?? post.entities?.urls ?? []) text = text.replaceAll(u.url, u.unwound_url ?? u.expanded_url ?? u.url);
  return text.trim();
}

/** The first link to a page off X (an article), if any. */
export function linkedArticle(post: XPost): XUrl & { href: string } | null {
  for (const u of post.note_tweet?.entities?.urls ?? post.entities?.urls ?? []) {
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

/** The report the pick becomes. */
export function pickItem(post: XPost, handle: string | null) {
  const postUrl = `https://x.com/${handle ?? "i/web"}/status/${post.id}`;
  const text = postText(post);
  const by = handle ? `@${handle}` : "X";
  const link = linkedArticle(post);
  const raw = { x: { id: post.id, url: postUrl, author: handle } };
  if (link) {
    return {
      title: link.title?.trim() || headline(text) || link.href, url: link.href, publishedAt: post.created_at,
      summary: [link.description?.trim(), `Shared on X by ${by}: “${text}”`].filter(Boolean).join("\n\n"), raw,
    };
  }
  return { title: headline(text) || postUrl, url: postUrl, publishedAt: post.created_at, author: by, body: text, raw };
}

/** Marks the article as the editor's pick: always selected, tagged. */
async function markPick(articleId: string, tweetId: string, url: string, created: boolean): Promise<void> {
  await sql`
    INSERT INTO editorial_overrides (article_id, fields, reason, version, updated_by)
    VALUES (${articleId}, ${sql.json({ selected: true, addTags: [TAG] })}, ${REASON}, 1, 'x-bookmarks')
    ON CONFLICT (article_id) DO UPDATE SET fields = editorial_overrides.fields || EXCLUDED.fields, reason = EXCLUDED.reason,
      version = editorial_overrides.version + 1, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  await sql`INSERT INTO x_bookmarks_picks (tweet_id, article_id, url) VALUES (${tweetId}, ${articleId}, ${url}) ON CONFLICT (tweet_id) DO NOTHING`;
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
  await ensureSource();
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

  let taken = 0;
  for (const { post, handle } of fresh.reverse()) {
    const item = pickItem(post, handle);
    await ingestItems({ sourceId: SOURCE_ID, sourceName: SOURCE_NAME, items: [item] }, {
      prepare: async (articleId, { created }) => {
        await markPick(articleId, post.id, item.url, created);
        taken += 1;
      },
    });
    // One ingest turned away (no usable title or address) is not read again.
    await sql`INSERT INTO x_bookmarks_picks (tweet_id, article_id, url) VALUES (${post.id}, NULL, ${item.url}) ON CONFLICT (tweet_id) DO NOTHING`;
  }
  return { pages, new: fresh.length, taken };
}
