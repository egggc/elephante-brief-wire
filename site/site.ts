// Site identity and the copy readers see. To make this a different site, start with this file.
// Both the web app and the backend read it; rebuild (docker compose up --build) for changes to take effect.
// The domain is not here: set SITE_URL in the environment at deploy time.

/**
 * When the daily, weekly and monthly editions come out (Beijing time, HH:mm). The daily covers the 24 hours
 * before this time, the weekly comes out on the Monday after each calendar week, the monthly on the 1st.
 * The schedule, edition windows, missing-edition alerts and every sentence that mentions a time read it
 * (files in public/ use {{dailyTime}}, {{weeklyTime}}, {{monthlyTime}}); the scheduler checks every half hour,
 * so use the hour or the half hour.
 */
export const EDITION_TIMES = { daily: "07:00", weekly: "10:00", monthly: "10:30" };

/** "daily at 07:00", "Mondays at 10:00", "on the 1st at 10:30": the edition times as written into sentences. */
export const EDITION_WHEN = {
  daily: `daily at ${EDITION_TIMES.daily}`,
  weekly: `Mondays at ${EDITION_TIMES.weekly}`,
  monthly: `on the 1st of each month at ${EDITION_TIMES.monthly}`,
};

export const SITE = {
  /** Site name: navigation, page titles, share cards, RSS, MCP and the admin all use it. */
  name: "Elephante Brief",
  /**
   * The subject word, put into default phrases such as "US–China Daily" or "all US–China news".
   */
  subject: "US–China",
  /** The home page's full title (browser tab, search results). */
  homeTitle: "Elephante Brief — the pulse of U.S.–China tech, finance and culture",
  /** Title of the topics directory (/topics). */
  topicsTitle: "U.S.–China topics: trade, capital, technology, policy, people and culture",
  /** Example text in the feedback box. */
  feedbackExample: "e.g. I searched for … and expected …",
  /** The line under the feedback page's title. */
  feedbackLead: "Bugs, missing features, things that read wrong: tell us.",
  /** Hint in the feedback form's email field. */
  feedbackEmailHint: "Leave an email if you'd like a reply",
  /** One-line description: search engines, share cards, RSS and llms.txt use it. */
  description: `A bilingual U.S.–China news brief for professionals whose decisions span both countries: the stories that change what you believe or do, in English and 简体中文, with a daily edition at ${EDITION_TIMES.daily} Beijing time.`,
  /** A longer introduction under the one-liner in llms.txt (optional). */
  llmsIntro: "Elephante Brief reads official Chinese sources and U.S., Hong Kong and Chinese media, keeps the items that will change what a U.S.–China professional believes or does in the next 90 days (or how they read the other side), and writes each one up with an English headline and summary followed by a Chinese (简体) headline and summary. Selection weighs the provenance of a claim — primary documents, filings, on-record officials, money committed — over prestige or recency." as string | null,
  /** A small line under share cards and posters. */
  tagline: "The pulse of U.S.–China tech, finance and cultural change",
  /** Keywords for search engines (home page structured data). */
  keywords: ["US-China", "China news", "U.S.-China relations", "China tech", "China finance", "中美", "bilingual news brief"] as string[],
  /** The year the site started collecting (structured data, optional). */
  since: "2026" as string | null,
  /** Interface language (HTML lang, og:locale). */
  locale: "en-US",
  /** Default address, used only when SITE_URL is not set. */
  defaultUrl: "http://localhost:3000",
  /** Icons placed at the site root besides the standard ones, file names in site/brand/ (optional). */
  rootIcons: [] as string[],
  /**
   * Prefix of the MCP tool names (lowercase letters, digits, underscores): elephante_get_latest, elephante_search…
   * Do not change it once people have connected.
   */
  mcpPrefix: "elephante",
  /**
   * Version of the public interfaces (MCP, OpenAPI, llms.txt), only ever raised.
   * Raise the major version when an existing field or meaning changes, and say so in the deploy notes.
   */
  interfaceVersion: "4.0.0",
  /** Public contact email (optional): written into llms.txt and the usage notes for agents. */
  contactEmail: "elephantepress@gmail.com" as string | null,
  /** A small line at the bottom of the about page (optional). */
  footerNote: null as string | null,
  /** Mainland China ICP filing number (optional). */
  icp: null as string | null,
  /** The source repository on GitHub (optional): shown as "Open source on GitHub" when set. */
  github: null as string | null,
  /** The site's operator in structured data (for search engines). */
  organization: {
    name: "Elephante Press",
    /** Founder (optional). */
    founder: null as null | { name: string; alternateName?: string; jobTitle?: string; description?: string; url?: string },
  },
  /** The name and version the crawler reports (in the User-Agent) when fetching sources. */
  crawlerName: "ElephanteBriefBot/1.0",
} as const;

/** The terms and privacy pages (their text is in pages/). */
export const POLICY = {
  terms: {
    /** Page name: navigation, footer and page title use it. */
    name: "Terms of Use",
    description: "Terms for using this site's pages, RSS, public API and MCP.",
    /** A sentence about this page in llms.txt (optional). */
    covers: null as string | null,
    /** The terms reminder on the agent page's RSS and API panels (optional). */
    notes: null as null | { rss: string; api: string },
    /** What uses need permission first (optional): llms goes into llms.txt, agent into the agent usage notes. */
    license: null as null | { llms: string; agent: string },
    /** Response headers declaring the terms on the public API, RSS and OpenAPI file (optional). */
    headers: null as null | Record<string, string>,
  },
  privacy: {
    description: "How this site handles browser-local data, feedback and access logs.",
    /** A sentence about this page in llms.txt (optional). */
    covers: null as string | null,
  },
  /**
   * Whether an X post's own text and images count as full text: if so they show only where the item may show
   * full text (the source allows it and the text was fetched); otherwise they always show, like a title or summary.
   */
  xPostIsFullText: true,
} as const;

/** A few phrases and displays on item cards and detail pages. */
export const ITEM_COPY = {
  /** What the model's one-line reason is called: cards, detail pages, Markdown, agent answers and pushes use it. */
  reasonLabel: "Why it matters",
  /** Whether readers see the AI score on the web and share cards. Display only: the API and MCP still carry it. */
  showScore: true,
};

/** One QR card on the about page. */
interface ContactCard {
  kind: string;
  title: string;
  note: string;
  /** A root file name linked from elsewhere (optional), e.g. qr-wechat.jpg: it always redirects to the current QR. */
  alias?: string;
}

/** About page copy. The numbers (sources, items, selections, editions) come from live statistics. */
export const ABOUT = {
  kicker: `About ${SITE.name}`,
  /** Page description (search results, share cards). */
  description: `About ${SITE.name}: ${SITE.description}`,
  /** Headline: the first line in the normal color, the second in the accent. */
  headline: ["Two countries, two languages, one feed.", "Only what changes your next move."] as [string, string],
  /** The paragraph under the headline. {sources} becomes the live source count (spaces added around it); sourcesFallback when unavailable. */
  lead: `${SITE.name} watches{sources}sources in English and Chinese: it collects, groups, scores and selects, then publishes a daily edition at ${EDITION_TIMES.daily} Beijing time. Free, no sign-up.`,
  sourcesFallback: " a dozen-plus ",
  /** The four steps under the source river animation. */
  steps: {
    collect: "Official Chinese outlets, U.S., Hong Kong and Chinese media: busier sources are checked more often, as often as every 15 minutes.",
    store: "Everything collected is kept; reports of the same event are grouped together, and the hot list is computed from them.",
    select: `A model asks whether a story matters at the U.S.–China seam and what it cost the speaker to say it, then writes an English and a Chinese headline and summary, and the ${ITEM_COPY.reasonLabel.toLowerCase()} line. PR and rewrites don't get in.`,
    publish: `The daily edition comes out ${EDITION_WHEN.daily} (Beijing time), the weekly ${EDITION_WHEN.weekly}, the monthly ${EDITION_WHEN.monthly}.`,
  },
  /**
   * Author block (optional), null hides it.
   */
  maker: null as null | {
    name: string;
    avatarSourceId?: string | null;
    greeting: string[];
    wechat?: ContactCard;
    feishu?: ContactCard;
  },
  /** Copyright and takedown notice at the bottom; the feedback link sits between the two parts. */
  copyright: [`${SITE.name} is a digest and reading index; the original articles belong to their publishers. If you are a publisher and want something corrected, removed or shown differently, tell us on the `, "."] as [string, string],
  /** Anchor id of the "Terms" link at the bottom (optional). */
  termsAnchor: null as string | null,
} as const;

/** Notes for administrators on admin pages (optional). */
export const ADMIN = {
  /** A line under the feedback page's title. */
  feedbackNote: null as string | null,
  /** A site rule added to the confirmation when banning a feedback source. */
  banNote: null as string | null,
  /** A site rule added to the confirmation when changing a paid service's request limit. */
  budgetNote: null as string | null,
};

/** Examples on the agent page. */
export const AGENT = {
  /** The "search" row of the MCP tool table: what it searches, and a sample question. */
  search: { scope: "Search the last 7 days by company, person, policy or topic", ask: "What has happened with chip export controls this week?" },
};

/** Phrases on the daily, weekly and monthly editions. */
export const REPORTS = {
  /** The publisher line under the nameplate. */
  imprint: SITE.name.toUpperCase(),
  /** A word beside the nameplate. */
  motto: SITE.subject as string,
  /** Each edition page's description (search results, share cards), no final period; llms.txt uses it too. */
  descriptions: {
    daily: `The ${SITE.name} daily edition, published ${EDITION_WHEN.daily} (Beijing time)`,
    weekly: `The weekly ${SITE.subject} review`,
    monthly: `The monthly ${SITE.subject} review`,
  },
  /**
   * What one entry is called ("4 stories"): titles without a lead story, edition counts, and the period
   * editions' fallback sentence use it. English has no measure word, so measure is empty.
   */
  entry: { measure: "", noun: "stories" },
  /** Units after the masthead's other numbers; the about and topic pages write selections and editions this way too. */
  metricUnits: { sourcesCount: "sources", firstPartyEvents: "first-party releases", selectedCount: "selected", reportsCovered: "daily editions" },
  /** The count on edition share cards. */
  shareUnit: "stories",
  /** Title and lead of a daily whose window had material judged but no new major story. */
  quiet: { title: "A quiet day: nothing major", paragraph: "From {start} to {end} Beijing time, no new major U.S.–China story." },
};

/** Phrases in operational alerts (to the site owner only) that vary by deployment. */
export const ALERTS = {
  /** Minutes without a newly collected article before the "stopped collecting" alert (at most a day); ALERT_QUIET_MINUTES wins. */
  quietMinutes: 360,
  /** A sentence on the usual volume added to that alert; null to leave it out. */
  usualFlow: null as string | null,
  /** How to read the worker's logs, in the worker-stopped alert. */
  workerLogs: "check the worker's logs (docker compose logs worker)",
  /** Which steps stop when a model service refuses or runs out of credit; unlisted services get the generic wording. */
  modelStops: {} as Record<string, string>,
};

/** Defaults for a source created in the admin. */
export const SOURCE_DEFAULTS = {
  /** Show full text on the site; false shows only the summary and the original link. */
  siteFulltext: false,
};

/**
 * Community-site sources (source ids) whose heat counts each posting account as its own participant.
 * dev is a dev.to article stream, hn a Hacker News post stream.
 */
export const COMMUNITY_FEEDS: { dev: string[]; hn: string[] } = {
  dev: [],
  hn: [],
};

/** Text on each page's share card (/og/pages/*.png). The topics directory's card is generated from the topic count. */
export const CARDS: Record<string, { kicker: string; title: string; subtitle: string; accent?: "hot" | "amber" }> = {
  site: { kicker: "Daily selection", title: SITE.tagline, subtitle: SITE.description },
  all: { kicker: "All stories", title: "Everything from every source, in one place", subtitle: "The latest from every source by time, filterable by category and tag." },
  hot: { kicker: "Hot list", title: "What people are talking about, last 48 hours", subtitle: "Heat index, trend and the public sources behind it.", accent: "hot" },
  daily: { kicker: "Daily edition", title: `Every morning at ${EDITION_TIMES.daily} Beijing time, a brief you can finish`, subtitle: "Yesterday's U.S.–China stories worth your attention." },
  weekly: { kicker: "Weekly edition", title: "The week's stories, at a glance", subtitle: "The week's main threads, key moves and what's worth a second look." },
  monthly: { kicker: "Monthly edition", title: "How the month changed things", subtitle: "The month's main threads and key events." },
  about: { kicker: "About", title: `About ${SITE.name}`, subtitle: SITE.description },
  terms: { kicker: "Terms", title: `${SITE.name} Terms of Use`, subtitle: "How the site, API, RSS and MCP may be used." },
  privacy: { kicker: "Privacy", title: `${SITE.name} Privacy`, subtitle: "Access logs, browser-local data and feedback." },
  changelog: { kicker: "Changelog", title: `${SITE.name} Changelog`, subtitle: "Updates, improvements, announcements and retirements." },
  feedback: { kicker: "Feedback", title: "Tell us what could be better", subtitle: "Content, features, integrations, or a publisher's correction or takedown request." },
  agent: { kicker: "For agents", title: `Connect ${SITE.name} to your agent`, subtitle: "MCP, RSS and API: anonymous, read-only, no API key." },
};

/** Parts of the public access terms that vary by deployment: the agent usage notes and llms.txt use them. */
export const ACCESS = {
  /** Roughly how many requests per minute per IP before a 429 with Retry-After (optional; set by the reverse proxy). */
  ratePerMinute: null as number | null,
  /** The User-Agent people who sync data should send (optional). */
  userAgent: null as string | null,
};

/** This deployment's own arrangements (optional). */
export const DEPLOYMENT = {
  /** Where the credential group files live by default, relative to the repository; AIHOT_CREDENTIALS_DIR wins. */
  credentialsDir: null as string | null,
  /** File names of the credential groups (optional): unlisted groups use "group.env". */
  credentialFiles: {} as Partial<Record<string, string>>,
  /** Extra credentials this deployment requires ([group, variable]); checked when the production API starts. */
  requiredSecrets: [] as const,
  /** The Host the production API receives (CDN origin domain, optional). */
  originHost: null as string | null,
  /** The request header a reverse proxy uses to carry the original address to the admin login (optional). */
  loginReturnHeader: null as string | null,
  /** Upstream traffic limit for the image proxy; null for none. IMGPROXY_UPSTREAM_* win. */
  imageUpstreamBudget: null as null | { mbPerMinute: number; gbPerDay: number },
  /** Domains fetched directly instead of through EGRESS_PROXY_URL, for collection and images (optional). */
  directFetchHosts: [] as string[],
  /** The gold set scripts/eval-selection.ts uses without arguments; null uses all of .data/gold.jsonl (up to 200), sweeping 40–90. */
  selectionGold: null as null | { file: string; sample: number; split: string; sweep: [number, number] },
};

/** Phrases in the RSS feeds' descriptions that vary by site. */
export const FEED_COPY = {
  /** What the "all" feed also leaves out, besides unreviewed, low-relevance and merged duplicates (optional). */
  allLeavesOut: [] as string[],
};

/**
 * Categories that differ between the public interfaces (API, RSS, MCP) and the web (optional). Do not change after launch.
 * merge: a category published as another; feedLabels: names in the category RSS titles.
 */
export const PUBLIC_CATEGORIES = {
  merge: {},
  feedLabels: {},
} as const;

/** "US–China Daily": the subject word, a space, then the noun. */
export function withSubject(noun: string): string {
  return `${SITE.subject} ${noun}`;
}

/** "All US–China stories", "Browse US–China": text, then the subject (and the noun, as withSubject joins it). */
export function subjectAfter(text: string, noun?: string): string {
  return `${text} ${noun ? withSubject(noun) : SITE.subject}`;
}
