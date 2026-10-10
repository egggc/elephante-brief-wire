// X bookmarks → editor's picks: every 15 minutes the worker reads the editor's new X bookmarks; a linked
// article becomes an always-selected item, any other post private heat evidence (backend/picks.ts). The login is a one-time step on the server
// (scripts/x-auth.ts); the callback page only shows the address to paste back into it.
import { defineServerModule } from "@aihot/backend/modules";
import { syncBookmarks } from "./backend/picks.ts";
import { xApp } from "./backend/x.ts";

const CALLBACK_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>X login</title></head>
<body style="font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem">
<h1 style="font-size:1.25rem">Almost done</h1>
<p>Copy the full address of this page from the address bar and paste it into the terminal where <code>scripts/x-auth.ts</code> is waiting.</p>
</body></html>`;

export const xBookmarksServer = defineServerModule({
  name: "x-bookmarks",
  http: (app) => {
    app.get("/api/x-bookmarks/callback", async (_req, reply) =>
      reply.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer").type("text/html; charset=utf-8").send(CALLBACK_PAGE));
  },
  schedules: [
    {
      name: "x-bookmarks.sync",
      cron: "*/15 * * * *",
      run: () => syncBookmarks(),
      when: () => process.env.COLLECT_ENABLED === "true" && xApp() !== null,
    },
  ],
});
