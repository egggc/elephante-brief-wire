// The X bookmarks module's addresses: the page X sends the editor back to after the one-time login.
import { defineModule } from "@aihot/contracts/modules";

export const xBookmarks = defineModule({
  name: "x-bookmarks",
  apiPaths: [/^\/api\/x-bookmarks\/callback$/],
});
