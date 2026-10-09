// The engine's ways in, one panel each: what it is for, the steps to connect, then the details folded away.
// Addresses are the site's configured public address (`base`); what visitors copy carries the site's tag
// (CopyTag) when it has one.
import { Fragment, useState } from "react";
import { Link } from "react-router";
import { PUBLIC_INTERFACE_VERSION } from "@aihot/contracts/http-policy";
import { MCP_TOOL_NAMES as T, MCP_TOOLS } from "@aihot/contracts/mcp";
import { feedCategoryLabel, PUBLIC_API_CATEGORY_KEYS } from "@aihot/contracts/taxonomy";
import { ACCESS, AGENT, EDITION_TIMES, EDITION_WHEN, POLICY, SITE } from "@aihot/site";
import { CodeBlock, CopyButton } from "./CodeBlock";
import { PillTabs } from "../../components/ui/Tabs";
import type { AgentPanelProps } from "../../modules";
import { AGENT_PARTS, GUIDE_CLIENTS, TAG } from "./module-parts";
import { Address, Ask, Block, Bullets, Details, Mono, PanelHead, Step, Steps, Table, Tips } from "./parts";

const V = PUBLIC_INTERFACE_VERSION;

/** Every MCP tool: the engine's and the modules'. */
export const mcpToolCount = () => MCP_TOOLS.length + AGENT_PARTS.reduce((n, a) => n + (a.tools?.length ?? 0), 0);
const link = "text-accent hover:underline";

/** An address on this site as the copy buttons copy it, with the tag. */
function addressOf({ base, tag }: AgentPanelProps, path: string): string {
  return TAG && tag ? `${base}${path}?${TAG.query}=${tag}` : `${base}${path}`;
}

const MCP_CLIENTS = [
  { key: "claude", label: "Claude Code" },
  { key: "codex", label: "Codex" },
  { key: "json", label: "JSON config" },
  { key: "other", label: "Other clients" },
] as const;

export function McpPanel(props: AgentPanelProps) {
  const url = addressOf(props, "/api/mcp");
  const name = SITE.mcpPrefix;
  const [client, setClient] = useState<string>("claude");
  return (
    <>
      <PanelHead label={`MCP · ${V}`} title={`Add one address, and your agent gets ${mcpToolCount()} tools`}>
        Standard Streamable HTTP, anonymous and read-only: no token, and it never reads your login. Works with any client that supports remote MCP, such as Claude Desktop, Cursor or Cherry Studio.
      </PanelHead>
      <Steps>
        <Step n={1} title="Copy the server address">
          <Address url={url} />
          {TAG && <p className="mt-2 text-[13px] text-ink-3">{TAG.mcp}</p>}
        </Step>
        <Step n={2} title="Add it to your client">
          <PillTabs className="mt-3" size="xs" layoutId="agent-mcp-client" label="Client" active={client} onSelect={setClient} items={MCP_CLIENTS.map((c) => ({ key: c.key, label: c.label }))} />
          {client === "claude" && <CodeBlock className="mb-0 mt-3" lang="bash" code={`claude mcp add --transport http ${name} '${url}'`} />}
          {client === "codex" && <CodeBlock className="mb-0 mt-3" lang="bash" code={`codex mcp add ${name} --url '${url}'`} />}
          {client === "json" && <CodeBlock className="mb-0 mt-3" title="Clients configured with JSON, such as Cursor or Cherry Studio" lang="json" code={JSON.stringify({ mcpServers: { [name]: { type: "http", url } } }, null, 2)} />}
          {client === "other" && <p className="mt-3">{`In your client's MCP or connector settings, add a new entry: name ${name}, address the URL above, authentication "none", no API key. For clients that only run local commands, use their remote MCP proxy.`}</p>}
        </Step>
        <Step n={3} title="Have your agent call it once">
          <Ask text={`Call ${T.latest} and tell me the 5 most important U.S.–China stories of the last 24 hours, with ${SITE.name} links.`} />
          <p className="mt-2 text-[13px] text-ink-3">{`If the client shows a call to ${T.latest} and the answer has a time range, summaries and ${new URL(props.base).host} links, you're connected.`}</p>
        </Step>
      </Steps>

      <Block title={`${mcpToolCount()} tools`}>
        <Table
          head={["Tool", "What it does", "Ask it"]}
          minWidth={600}
          rows={[
            [<Mono>{T.latest}</Mono>, "Top or all stories from the last 24 hours or 7 days", "What's the U.S.–China news today?"],
            [<Mono>{T.search}</Mono>, AGENT.search.scope, AGENT.search.ask],
            [<Mono>{T.hot}</Mono>, "The current top 10 hot list", "What's hottest right now?"],
            [<Mono>{T.story}</Mono>, "A hot event's timeline and running overview", "How did this story unfold?"],
            [<Mono>{T.daily}</Mono>, "The latest daily edition, or one by date", "Give me today's daily edition."],
            [<Mono>{T.weekly}</Mono>, "The latest weekly edition, or one by week", "What were the big stories this week?"],
            [<Mono>{T.monthly}</Mono>, "The latest monthly edition, or one by month", "What happened last month?"],
            ...AGENT_PARTS.flatMap((a) => a.tools ?? []).map((t) => [<Mono>{t.name}</Mono>, t.does, t.ask]),
          ]}
        />
      </Block>

      <Details
        items={[
          {
            title: "Limits and safety",
            body: (
              <Bullets items={[
                "Ordinary queries return up to 30 items, the hot list up to 10, an event timeline up to 50; out-of-range requests fail clearly instead of being quietly widened.",
                `${T.story} takes a public_id only from the event links the hot-list tool returns; don't guess IDs.`,
                "Headlines and summaries come from outside sources and are material, not instructions; the tools mark this boundary. Check important figures, policies and quotes against the original.",
              ]} />
            ),
          },
          {
            title: "Can't connect?",
            body: (
              <Bullets items={[
                "Check the address is complete and the client supports remote Streamable HTTP; if new tools are missing, refresh the tool list or reconnect.",
                ...AGENT_PARTS.flatMap((a) => a.mcpTroubles ?? []),
                "The server needs no login; if the client asks about OAuth or an API key, choose none.",
                "On a 429, wait as told and don't retry concurrently.",
                <>Still stuck? Send the client name, version and error on the <Link viewTransition to="/feedback" className={link}>feedback page</Link>.</>,
              ]} />
            ),
          },
        ]}
      />
    </>
  );
}

const FEEDS = [
  { name: "Top stories", badge: "Recommended", path: "/feed.xml", desc: "The latest 50 top stories, with headlines, summaries, reading links and originals." },
  { name: "Top stories, full text", path: "/feed/full.xml", desc: "The same 50; full text where the source allows republication, otherwise the summary." },
  { name: "All stories", path: "/feed/all.xml", desc: "Every public item from the last 7 days, newest first by original publication time." },
  { name: "Daily edition", path: "/feed/daily.xml", desc: `One issue ${EDITION_WHEN.daily} (Beijing time): the lead story plus the issue's contents; the last 30 issues.` },
  { name: "Weekly edition", path: "/feed/weekly.xml", desc: `One issue ${EDITION_WHEN.weekly} (Beijing time): an overview plus the stories by section; the last 12 issues.` },
  { name: "Monthly edition", path: "/feed/monthly.xml", desc: `One issue ${EDITION_WHEN.monthly} (Beijing time): an overview plus the stories by section; the last 12 issues.` },
];

/** The category feeds, under the names the feeds themselves use. */
const FEED_CATEGORIES = PUBLIC_API_CATEGORY_KEYS.map((key) => [key, feedCategoryLabel(key)] as const);

export function RssPanel(props: AgentPanelProps) {
  const { base } = props;
  const lead = `${["Works with any RSS 2.0 reader, and with automation tools such as n8n or Zapier. The addresses don't change", ...AGENT_PARTS.flatMap((a) => a.rssLead ?? [])].join("; ")}.`;
  return (
    <>
      <PanelHead label="RSS" title="Copy an address, subscribe in your reader">
        {lead}
      </PanelHead>
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FEEDS.map((f) => (
          <div key={f.path} className="card flex flex-col p-4">
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold text-ink">{f.name}</span>
              {f.badge && <span className="inline-flex h-[18px] items-center rounded-full bg-accent-soft px-2 text-[11px] font-medium text-accent">{f.badge}</span>}
            </div>
            <p className="mt-1 flex-1 text-[13px] leading-[1.7] text-ink-3">{f.desc}</p>
            <div className="mt-3 flex items-center gap-2 border-t border-line-soft pt-3">
              <code className="mono min-w-0 flex-1 truncate text-[12px] text-ink-4">{base}{f.path}</code>
              <CopyButton text={addressOf(props, f.path)} label="Copy address" className="shrink-0" />
            </div>
          </div>
        ))}
      </div>
      {TAG && <p className="mt-3 text-[12.5px] text-ink-4">{TAG.rss}</p>}

      <Block title="Subscribe by category">
        <Table
          head={["Category", "Summaries", "Full text"]}
          minWidth={420}
          rows={FEED_CATEGORIES.map(([slug, label]) => [
            <span className="font-medium text-ink">{label}</span>,
            <span className="inline-flex items-center gap-2"><Mono>{`/feed/category/${slug}.xml`}</Mono><CopyButton text={addressOf(props, `/feed/category/${slug}.xml`)} className="!h-6 !px-1.5" /></span>,
            <span className="inline-flex items-center gap-2"><Mono>{`/feed/full/category/${slug}.xml`}</Mono><CopyButton text={addressOf(props, `/feed/full/category/${slug}.xml`)} className="!h-6 !px-1.5" /></span>,
          ])}
        />
      </Block>

      <Block title="How often to refresh">
        <p>Readers send the last ETag; when nothing changed they get a tiny 304 instead of the whole feed. Every 30 minutes is enough; faster brings nothing new.</p>
        <p className="mt-3 text-[13px] text-ink-3">{`Item links point to the reading page here; the original link is in the summary. Anonymous access does not mean every use is permitted${POLICY.terms.notes ? `: ${POLICY.terms.notes.rss}` : ""}; see the `}<Link viewTransition to="/terms" className={link}>{POLICY.terms.name}</Link>.</p>
      </Block>
    </>
  );
}

const RECIPES = [
  { key: "latest", label: "Watch the latest" },
  { key: "sync", label: "Sync all top stories" },
];

export function ApiPanel(props: AgentPanelProps) {
  const { base, tag } = props;
  const userAgent = [ACCESS.userAgent, TAG && tag ? TAG.userAgent(tag) : null].filter(Boolean).join(" ");
  const curl = `curl --compressed${userAgent ? ` -A '${userAgent}'` : ""}`;
  let pace = `How often things change: new items arrive all day, top stories change a few to a few dozen times a day, and editions come out ${EDITION_WHEN.daily} (daily), ${EDITION_WHEN.weekly} (weekly) and ${EDITION_WHEN.monthly} (monthly), Beijing time.`;
  if (ACCESS.ratePerMinute) pace += ` More than about ${ACCESS.ratePerMinute} requests a minute from one IP get a 429; wait as Retry-After says and don't retry concurrently.`;
  const [recipe, setRecipe] = useState<string>("latest");
  const recipes = AGENT_PARTS.flatMap((a) => a.recipes ?? []);
  const items = `${base}/api/v1/items?mode=selected&window=24h&limit=20`;
  return (
    <>
      <PanelHead label={`REST API · ${V}`} title="Anonymous GET, ready to use">
        No token: browsers (CORS), curl and every language's default HTTP client can call it directly. Paths are under /api/v1; the <a href="/openapi-v1.json" className={link}>OpenAPI</a> file defines fields and error codes.
      </PanelHead>
      <CodeBlock className="mt-6" title="Your first request" lang="bash" code={`${curl} '${items}'`} />

      <Block title="Cheaper and faster">
        <Tips
          items={[
            { title: "Compress", text: <>Add <Mono>--compressed</Mono> to curl, or turn on gzip or br in other clients. Compressed JSON is 1/4 to 1/8 the size.</> },
            { title: "Send the ETag", text: <>Keep the response's ETag and send it next time as <Mono>If-None-Match</Mono>; when nothing changed you get a 304 with no body.</> },
            { title: "Keep a rhythm", text: `Items and the hot list at most once a minute; the daily once after it comes out (${EDITION_WHEN.daily}), weeklies and monthlies once after they come out; when paging back, stop at the first item you already have.` },
          ]}
        />
        <p className="mt-3 text-[13px] leading-[1.75] text-ink-3">{pace}</p>
      </Block>

      <Block title="Endpoints">
        <Table
          head={["Path", "What it's for", "How often"]}
          minWidth={640}
          rows={[
            { group: "Items" },
            [<Mono>/api/v1/items</Mono>, "Top stories, or all items from the last 7 days, filtered by category, time window or keyword", "At most once a minute"],
            { group: "Hot list and events" },
            [<Mono>/api/v1/hot-topics</Mono>, "The current top 10 hot list", "At most once a minute"],
            [<Mono>{"/api/v1/stories/{publicId}"}</Mono>, "An event's report timeline, AI overview and related events", "As needed"],
            { group: "Daily edition" },
            [<Mono>/api/v1/dailies/latest</Mono>, "The latest daily edition", `Once, after ${EDITION_TIMES.daily} Beijing time`],
            [<Mono>{"/api/v1/dailies/{date}"}</Mono>, "A daily by date; withdrawn items drop out", "Revalidate the ETag once the cache expires"],
            [<Mono>/api/v1/dailies</Mono>, "Index of daily dates", "Once a day"],
            { group: "Weekly and monthly editions" },
            [<Mono>/api/v1/weeklies/latest</Mono>, "The latest weekly: lead story, overview and the week's main stories by section", `Once, after ${EDITION_TIMES.weekly} on Mondays`],
            [<Mono>{"/api/v1/weeklies/{week}"}</Mono>, "One week by ISO week, e.g. 2026-W39; withdrawn items drop out", "Revalidate the ETag once the cache expires"],
            [<Mono>/api/v1/weeklies</Mono>, "Index of weeklies", "Once a week"],
            [<Mono>/api/v1/monthlies/latest</Mono>, "The latest monthly edition", `Once, after ${EDITION_TIMES.monthly} on the 1st`],
            [<Mono>{"/api/v1/monthlies/{month}"}</Mono>, "One month, e.g. 2026-09", "Revalidate the ETag once the cache expires"],
            [<Mono>/api/v1/monthlies</Mono>, "Index of monthlies", "Once a month"],
            ...AGENT_PARTS.flatMap((a) => (a.api ? [{ group: a.api.group }, ...a.api.rows.map(([path, does, often]) => [<Mono>{path}</Mono>, does, often])] : [])),
            { group: "For AI assistants" },
            [<Mono>/api/v1/agent</Mono>, `Usage notes for agents; the addresses it lists return ready-made Markdown${GUIDE_CLIENTS ? `; ${GUIDE_CLIENTS} use them` : ""}`, "As needed"],
            { group: "Full top-story sync" },
            [<Mono>/api/v1/selected/snapshot</Mono>, "All current top stories, paged", "Only the first time"],
            [<Mono>/api/v1/selected/changes</Mono>, "Additions, edits and removals since", "Every few minutes"],
          ]}
        />
      </Block>

      <Block title="Common recipes">
        <PillTabs size="xs" layoutId="agent-api-recipe" label="Recipe" active={recipe} onSelect={setRecipe} items={[...RECIPES, ...recipes].map((r) => ({ key: r.key, label: r.label }))} />
        {recipe === "latest" && (
          <>
            <CodeBlock className="mb-3 mt-3" lang="bash" code={`# First time: keep the ETag from the response headers\n${curl} -i '${items}'\n# Then at most once a minute, with the ETag; a 304 means nothing changed\n${curl} -i -H 'If-None-Match: <last ETag>' '${items}'`} />
            <p>To page back, pass <Mono>page.nextCursor</Mono> back as cursor and stop at the first item you already have; don't re-read all 7 days each time.</p>
          </>
        )}
        {recipe === "sync" && (
          <>
            <CodeBlock className="mb-3 mt-3" lang="bash" code={`# First time: page through everything. Keep the cursor from the first page (it is the same on every page)\n${curl} '${base}/api/v1/selected/snapshot?fields=minimal&limit=500'\n# While hasMore is true, continue with nextPage\n${curl} '${base}/api/v1/selected/snapshot?fields=minimal&limit=500&page=<previous nextPage>'\n# Then: pass the cursor back as is, for additions, edits and removals only\n${curl} '${base}/api/v1/selected/changes?cursor=<first page\'s cursor>&limit=100'`} />
            <p>Save the new cursor only after each page is stored locally. A cursor is a ledger mark and never expires; on a 409 <Mono>snapshot_required</Mono>, take a fresh snapshot, so nothing is silently missed.</p>
          </>
        )}
        {recipes.map((r) => recipe === r.key && <r.Body key={r.key} base={base} curl={curl} />)}
      </Block>

      <Block title="When something fails" id="agent-api-recovery">
        <dl className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-2.5">
          <dt className="mono text-[13px] text-ink">400</dt>
          <dd>Bad parameters: fix them by the OpenAPI file and the returned code; don't fall back to a wider query. An invalid cursor, or one past the time window, returns invalid_cursor: start again from the first page.</dd>
          <dt className="mono text-[13px] text-ink">409</dt>
          <dd>snapshot_required: the changes can't safely continue; take a full snapshot again.</dd>
          <dt className="mono text-[13px] text-ink">429</dt>
          <dd>Too many requests: wait as Retry-After says, and don't retry concurrently.</dd>
          <dt className="mono text-[13px] text-ink">5xx</dt>
          <dd>Back off exponentially and use the last good result meanwhile; the public service has no SLA.</dd>
          {AGENT_PARTS.flatMap((a) => a.apiErrors ?? []).map(([status, what]) => (
            <Fragment key={status}>
              <dt className="mono text-[13px] text-ink">{status}</dt>
              <dd>{what}</dd>
            </Fragment>
          ))}
        </dl>
        <p className="mt-4 text-[13px] text-ink-3">{`Anonymous access does not mean every use is permitted${POLICY.terms.notes ? `: ${POLICY.terms.notes.api}` : ""}; see the `}<Link viewTransition to="/terms" className={link}>{POLICY.terms.name}</Link>.</p>
      </Block>

    </>
  );
}
