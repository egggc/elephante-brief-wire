// One-time login for the X bookmarks module (modules/x-bookmarks): prints a link, you sign in to X with
// the editor's account and approve, X sends the browser to X_REDIRECT_URI, and you paste that address
// (or just its code) here. The tokens are saved in the database; the worker refreshes them from then on.
// Run it again only if the module reports that the login is gone (e.g. after revoking the app on X).
// Usage: node --env-file=.env scripts/x-auth.ts
//        docker compose run --rm worker node scripts/x-auth.ts
import { createInterface } from "node:readline/promises";
import { closeDb } from "@aihot/backend/db";
import { codeFrom, completeLogin, loginRequest, xApp } from "@aihot/x-bookmarks/backend/x";

const app = xApp();
if (!app) {
  console.error("Set X_CLIENT_ID, X_CLIENT_SECRET and X_REDIRECT_URI in .env first.");
  process.exit(1);
}
const login = loginRequest(app);
console.log("\n1. Open this link in a browser where you are signed in to X as the editor, and approve:\n");
console.log(login.url);
console.log(`\n2. X then opens ${app.redirectUri}?state=…&code=… — copy that whole address.\n`);
const prompt = createInterface({ input: process.stdin, output: process.stdout });
try {
  const pasted = await prompt.question("3. Paste it here and press Enter: ");
  const username = await completeLogin(app, codeFrom(pasted, login.state), login.verifier);
  console.log(`\nSaved. The worker now reads @${username}'s bookmarks every 15 minutes (COLLECT_ENABLED=true).`);
} catch (error) {
  console.error(`\nLogin failed: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  prompt.close();
  await closeDb();
}
