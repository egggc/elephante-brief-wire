// The X API v2 as the editor's bookmarks need it: OAuth 2.0 with PKCE (user context) and the bookmarks
// list. Reading the API is billed (pay-per-use credits), so every read goes through receipts and the
// x_api budget; the token endpoint is not billed. X rotates the refresh token on every refresh: the new
// one is saved in the same transaction that holds the account row, so two refreshes never race.
import { createHash, randomBytes } from "node:crypto";
import { credential } from "@aihot/backend/config";
import { sql } from "@aihot/backend/db";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { assertAccepted, paidRequest } from "@aihot/backend/providers/receipts";

export const SERVICE = "x_api";
export const SCOPES = "tweet.read users.read bookmark.read offline.access";

/** The API root; tests point it at a local stub. */
const apiBase = () => (credential("integrations", "X_API_BASE_URL") ?? "https://api.x.com").replace(/\/$/, "");

export interface XApp {
  clientId: string;
  /** Set for a confidential client (a "Web App"), which X expects to authenticate with it. */
  clientSecret: string | null;
  redirectUri: string;
}

export function xApp(): XApp | null {
  const clientId = credential("integrations", "X_CLIENT_ID");
  const redirectUri = credential("integrations", "X_REDIRECT_URI");
  if (!clientId || !redirectUri) return null;
  return { clientId, clientSecret: credential("integrations", "X_CLIENT_SECRET"), redirectUri };
}

/** The budget's default (admin → Settings → budgets changes it); a missing row would mean no limit. */
export async function ensureBudget(): Promise<void> {
  await sql`INSERT INTO budgets (service, per_minute, per_hour, per_day, note)
            VALUES (${SERVICE}, 10, 40, 200, 'X API v2: editor bookmarks (pay-per-use)') ON CONFLICT (service) DO NOTHING`;
}

interface TokenAnswer {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

async function tokenRequest(app: XApp, form: Record<string, string>): Promise<Required<Pick<TokenAnswer, "access_token">> & TokenAnswer> {
  const body = new URLSearchParams(form);
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  if (app.clientSecret) headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(app.clientId)}:${encodeURIComponent(app.clientSecret)}`).toString("base64")}`;
  else body.set("client_id", app.clientId);
  const res = await guardedFetch(`${apiBase()}/2/oauth2/token`, { method: "POST", headers, body: body.toString(), timeoutMs: 30_000, maxBytes: 64 * 1024, route: "direct" });
  const text = res.text();
  if (res.status < 200 || res.status >= 300) throw new Error(`X token HTTP ${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text) as TokenAnswer;
  if (!json.access_token) throw new Error("X token answer has no access_token");
  return { ...json, access_token: json.access_token };
}

const expiry = (seconds: number | undefined) => new Date(Date.now() + (seconds ?? 7200) * 1000);

/** One billed GET with the user's token. `identity` keeps a retry of the same read on its receipt. */
async function get<T>(path: string, token: string, request: { purpose: string; subject: string; identity: unknown; requestSummary: Record<string, unknown> }): Promise<T> {
  const receipt = await paidRequest({ service: SERVICE, ...request }, async () => {
    const res = await guardedFetch(`${apiBase()}${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" }, timeoutMs: 30_000, maxBytes: 8 * 1024 * 1024, route: "direct",
    });
    const text = res.text();
    assertAccepted(SERVICE, res.status, text);
    const json = JSON.parse(text) as { data?: unknown };
    return { response: json, usage: { objects: Array.isArray(json.data) ? json.data.length : json.data ? 1 : 0 }, cost: null };
  });
  return receipt.response as T;
}

// Login (scripts/x-auth.ts)

export function loginRequest(app: XApp): { url: string; verifier: string; state: string } {
  const verifier = randomBytes(48).toString("base64url");
  const state = randomBytes(16).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const query = new URLSearchParams({
    response_type: "code", client_id: app.clientId, redirect_uri: app.redirectUri, scope: SCOPES, state, code_challenge: challenge, code_challenge_method: "S256",
  });
  return { url: `https://x.com/i/oauth2/authorize?${query}`, verifier, state };
}

/** The code in what the person pasted: the whole address X sent them back to, or the code alone. */
export function codeFrom(pasted: string, state: string): string {
  const text = pasted.trim();
  if (!/^https?:\/\//i.test(text)) return text;
  const params = new URL(text).searchParams;
  const error = params.get("error");
  if (error) throw new Error(`X did not grant access: ${error}`);
  if (params.get("state") !== state) throw new Error("that address belongs to another login attempt; run the script again and use the new link");
  const code = params.get("code");
  if (!code) throw new Error("no code in that address");
  return code;
}

/** Exchanges the code, finds out whose account it is and saves the tokens; returns the account's handle. */
export async function completeLogin(app: XApp, code: string, verifier: string): Promise<string> {
  const token = await tokenRequest(app, { grant_type: "authorization_code", code, redirect_uri: app.redirectUri, code_verifier: verifier });
  if (!token.refresh_token) throw new Error("X returned no refresh token: the login must ask for offline.access");
  await ensureBudget();
  const me = await get<{ data?: { id: string; username: string } }>("/2/users/me", token.access_token, {
    purpose: "x_login", subject: "x-bookmarks:login", identity: { path: "/2/users/me", code }, requestSummary: { path: "/2/users/me" },
  });
  if (!me.data?.id) throw new Error("X did not say whose account this is");
  await sql`
    INSERT INTO x_bookmarks_account (id, user_id, username, access_token, refresh_token, expires_at)
    VALUES (true, ${me.data.id}, ${me.data.username}, ${token.access_token}, ${token.refresh_token}, ${expiry(token.expires_in)})
    ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, username = EXCLUDED.username, access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token, expires_at = EXCLUDED.expires_at, updated_at = now()`;
  return me.data.username;
}

/** A usable access token, refreshed (and the rotated refresh token saved) when it is about to expire. */
export async function accessToken(app: XApp): Promise<{ token: string; userId: string } | null> {
  return sql.begin(async (tx) => {
    const [row] = await tx<{ user_id: string; access_token: string; refresh_token: string; expires_at: Date }[]>`
      SELECT user_id, access_token, refresh_token, expires_at FROM x_bookmarks_account WHERE id FOR UPDATE`;
    if (!row) return null;
    if (row.expires_at.getTime() - Date.now() > 5 * 60_000) return { token: row.access_token, userId: row.user_id };
    const fresh = await tokenRequest(app, { grant_type: "refresh_token", refresh_token: row.refresh_token });
    await tx`
      UPDATE x_bookmarks_account SET access_token = ${fresh.access_token}, refresh_token = ${fresh.refresh_token ?? row.refresh_token},
        expires_at = ${expiry(fresh.expires_in)}, updated_at = now()
      WHERE id`;
    return { token: fresh.access_token, userId: row.user_id };
  });
}

// Bookmarks

export interface XUrl {
  url: string;
  expanded_url?: string;
  unwound_url?: string;
  title?: string;
  description?: string;
}

export interface XPost {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
  entities?: { urls?: XUrl[] };
  /** The full text of a post longer than 280 characters. */
  note_tweet?: { text: string; entities?: { urls?: XUrl[] } };
}

export interface BookmarksPage {
  data?: XPost[];
  includes?: { users?: Array<{ id: string; username: string; name: string }> };
  meta?: { next_token?: string };
}

/** Newest bookmark first. `window` (the run's slot) makes a retried run reuse its receipt. */
export function bookmarksPage(token: string, userId: string, opts: { pageToken: string | null; window: string; size: number }): Promise<BookmarksPage> {
  const query = new URLSearchParams({
    max_results: String(opts.size), "tweet.fields": "created_at,author_id,entities,note_tweet", expansions: "author_id", "user.fields": "username,name",
  });
  if (opts.pageToken) query.set("pagination_token", opts.pageToken);
  return get<BookmarksPage>(`/2/users/${encodeURIComponent(userId)}/bookmarks?${query}`, token, {
    purpose: "x_bookmarks", subject: `x-bookmarks:${userId}`, identity: { userId, pageToken: opts.pageToken, size: opts.size, window: opts.window },
    requestSummary: { page: opts.pageToken ? "next" : "first", size: opts.size },
  });
}
