// Elephante Brief's classification: categories, tag vocabulary, the company and institution directory, and the
// identity lexicon that keeps a model from putting a company into a headline the source never named.
// The models tag from these lists, topics (topics.json) are built on the tags, the filter bar groups by category.
// Category keys appear in URLs (/all?category=…): never change them after launch. Tags and entities can change.

/**
 * Website categories (filter bar, card badges, category RSS). key is the URL and API identity; never change it.
 * section is the heading in the daily/weekly/monthly editions (several categories can share one; this order);
 * guide tells the structure model what the category holds and where its borders are (the general rule is in
 * prompts/structure.md). commentary marks analysis: a follow-up of this kind to an event already reported takes a
 * one-line brief in the daily (unless enough sources report it). Unclassified material goes to the section of the
 * category keyed `industry` (here: Business). feedLabel names the category in RSS titles (defaults to label).
 */
export const CATEGORIES = [
  { key: "policy", label: "Policy", feedLabel: "Policy & Geopolitics", section: "Policy & Geopolitics", guide: "Government decisions, laws, regulations (draft and final), official statements, diplomacy, military and security, courts and enforcement, in either country, when the government is the actor. A rule about chips is still policy; the market's reaction to it is capital." },
  { key: "trade", label: "Trade", feedLabel: "Trade & Supply Chains", section: "Trade & Supply Chains", guide: "Tariffs, export controls, sanctions and entity lists in operation, customs data, procurement, supply-chain relocation, shipping and commodities flows between the two economies. A new tariff decision itself is policy; its effect on orders, factories and shipments is trade." },
  { key: "tech", label: "Tech", feedLabel: "Technology", section: "Technology", guide: "Semiconductors, AI, telecoms, platforms, EVs and batteries, biotech, standards and cybersecurity: what the technology or tech company did. A tech company's funding round or listing is capital; a ban on it is policy." },
  { key: "capital", label: "Capital", feedLabel: "Capital & Markets", section: "Capital & Markets", guide: "Markets with a stated cause, investment flows, listings and delistings, financing, M&A, banking, currency, property and macro data. A market move with no cause is not news." },
  { key: "industry", label: "Business", feedLabel: "Business", section: "Business", guide: "Company strategy, earnings, executives, market entry and exit, consumer brands' business results, factories and layoffs, when the company is the actor and the story is not mainly about technology or capital markets." },
  { key: "people", label: "People", feedLabel: "People & Talent", section: "People & Talent", guide: "Personnel moves in government and companies, talent and hiring shifts, students, visas, migration, detentions and travel: who is going where, and who is being let in or kept out." },
  { key: "culture", label: "Culture", feedLabel: "Culture & Consumers", section: "Culture & Consumers", guide: "Celebrity, film, TV, music, fashion, games, consumer brands, viral trends and youth taste, when they show how one side sees, buys from or imitates the other. Box office, sales and bookings data count as culture when the story is about taste." },
  { key: "opinion", label: "Analysis", feedLabel: "Analysis & Opinion", section: "Analysis", guide: "The author's explanation, argument, forecast or interview is the point. A news story with quotes is not analysis; an op-ed by an official is still analysis unless it announces a decision.", commentary: true },
] as const satisfies ReadonlyArray<{ key: string; label: string; feedLabel?: string; section: string; guide: string; commentary?: true }>;

/**
 * The most watched kind of release (for AI it was new models; here, new rules): the daily masthead's "N new rules"
 * and the recount after reclassification use it. category and tag must both match; unit follows the number.
 */
export const RELEASE: { category: string; tag: string; unit: string } | null = { category: "policy", tag: "Regulation", unit: "new rules" };

/** Words the weekly/monthly overview may use without finding them in an entry (lowercase). The site name counts automatically. */
export const PLAIN_TERMS: readonly string[] = ["us", "u.s.", "china", "chinese", "american", "beijing", "washington", "ai", "gdp", "ceo", "ipo", "etf", "ev", "evs"];

/**
 * The content types the content-understanding step assigns (prompts/content-understanding.md lists them; change both
 * together). The scoring prompt (prompts/selection-score.md) reads the same types.
 */
export const ITEM_TYPES = ["official_document", "policy_action", "corporate_move", "market_data", "news_report", "culture_signal", "analysis_opinion"] as const;

// ── Tag vocabulary ───────────────────────────────────────────────────────────────────────

/** The first tag of every item must be one of these form tags. */
export const CATEGORY_TAGS = [
  "Regulation", "Official statement", "Diplomacy", "Legal action", "Data release", "Deal/Investment", "Earnings/Results",
  "Personnel move", "Product launch", "Market move", "Trend", "Analysis", "Interview", "Other",
] as const;

/** Optional topic tags. The last four are the editorial markers the selection standard asks for. */
export const TOPIC_TAGS = [
  "Tariffs", "Export controls", "Sanctions", "Semiconductors", "AI", "EVs & batteries", "Rare earths & minerals", "Energy", "Supply chains",
  "Listings", "Capital flows", "Currency", "Property", "Banking", "Consumer", "Film & TV", "Music", "Fashion", "Social media", "Gaming",
  "Students & visas", "Taiwan", "Hong Kong", "Military & security", "Cybersecurity", "Biotech", "Agriculture",
  "one-side-only", "quiet-signal", "culture", "claim",
] as const;

/** Optional entity tags (governments, institutions, companies). */
export const ENTITY_TAGS = [
  "White House", "Commerce Dept", "Treasury", "USTR", "Congress", "Federal Reserve", "SEC",
  "Xi Jinping", "State Council", "MOFCOM", "PBOC", "CSRC", "CAC",
  "Huawei", "Nvidia", "TSMC", "Apple", "Tesla", "BYD", "TikTok/ByteDance", "Alibaba", "Tencent",
] as const;

/** Synonyms models often write, mapped to the vocabulary. */
export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  regulation: "Regulation", rule: "Regulation", rules: "Regulation", law: "Regulation", "draft rule": "Regulation", policy: "Regulation",
  statement: "Official statement", announcement: "Official statement", diplomacy: "Diplomacy", talks: "Diplomacy", summit: "Diplomacy",
  lawsuit: "Legal action", court: "Legal action", investigation: "Legal action", probe: "Legal action",
  data: "Data release", statistics: "Data release", deal: "Deal/Investment", investment: "Deal/Investment", "m&a": "Deal/Investment", acquisition: "Deal/Investment", funding: "Deal/Investment",
  earnings: "Earnings/Results", results: "Earnings/Results", personnel: "Personnel move", appointment: "Personnel move", hiring: "Personnel move",
  launch: "Product launch", product: "Product launch", markets: "Market move", market: "Market move", trend: "Trend", opinion: "Analysis", commentary: "Analysis", interview: "Interview",
  tariff: "Tariffs", "export control": "Export controls", "entity list": "Export controls", sanction: "Sanctions", chips: "Semiconductors", chip: "Semiconductors", semiconductor: "Semiconductors",
  "artificial intelligence": "AI", ev: "EVs & batteries", evs: "EVs & batteries", batteries: "EVs & batteries", "rare earths": "Rare earths & minerals", "supply chain": "Supply chains",
  ipo: "Listings", delisting: "Listings", film: "Film & TV", movies: "Film & TV", "box office": "Film & TV", visas: "Students & visas", students: "Students & visas",
  military: "Military & security", security: "Military & security", cyber: "Cybersecurity",
  "one side only": "one-side-only", "quiet signal": "quiet-signal", Culture: "culture", claims: "claim", forecast: "claim",
  TikTok: "TikTok/ByteDance", ByteDance: "TikTok/ByteDance", Xi: "Xi Jinping", "Ministry of Commerce": "MOFCOM", "People's Bank of China": "PBOC", Fed: "Federal Reserve",
};

// ── Companies and institutions ──────────────────────────────────────────────────────────

/**
 * Company topics: id → display name, the tag shown on cards (null: classified only as entity:<id>), aliases.
 * aliases go to the structure model; otherNames are the entity's own other names (accounts, sub-brands).
 */
export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[]; otherNames?: string[] }> = {
  huawei: { name: "Huawei", displayTag: "Huawei", aliases: ["Huawei", "华为", "HarmonyOS", "Ascend"], otherNames: ["鸿蒙", "昇腾"] },
  nvidia: { name: "Nvidia", displayTag: "Nvidia", aliases: ["Nvidia", "NVIDIA", "英伟达"] },
  tsmc: { name: "TSMC", displayTag: "TSMC", aliases: ["TSMC", "台积电", "Taiwan Semiconductor"] },
  apple: { name: "Apple", displayTag: "Apple", aliases: ["Apple", "苹果公司", "iPhone"] },
  tesla: { name: "Tesla", displayTag: "Tesla", aliases: ["Tesla", "特斯拉"] },
  byd: { name: "BYD", displayTag: "BYD", aliases: ["BYD", "比亚迪"] },
  bytedance: { name: "ByteDance / TikTok", displayTag: "TikTok/ByteDance", aliases: ["ByteDance", "TikTok", "字节跳动", "抖音", "Douyin"] },
  alibaba: { name: "Alibaba", displayTag: "Alibaba", aliases: ["Alibaba", "阿里巴巴", "Taobao", "Ant Group"], otherNames: ["阿里", "淘宝", "蚂蚁集团", "Alibaba Cloud", "阿里云"] },
  tencent: { name: "Tencent", displayTag: "Tencent", aliases: ["Tencent", "腾讯", "WeChat"], otherNames: ["微信"] },
  xiaomi: { name: "Xiaomi", displayTag: null, aliases: ["Xiaomi", "小米"] },
  catl: { name: "CATL", displayTag: null, aliases: ["CATL", "宁德时代", "Contemporary Amperex"] },
  smic: { name: "SMIC", displayTag: null, aliases: ["SMIC", "中芯国际"] },
  deepseek: { name: "DeepSeek", displayTag: null, aliases: ["DeepSeek", "深度求索"] },
  pdd: { name: "PDD / Temu", displayTag: null, aliases: ["PDD", "Pinduoduo", "Temu", "拼多多"] },
  shein: { name: "Shein", displayTag: null, aliases: ["Shein", "希音"] },
  boeing: { name: "Boeing", displayTag: null, aliases: ["Boeing", "波音"] },
  micron: { name: "Micron", displayTag: null, aliases: ["Micron", "美光"] },
  qualcomm: { name: "Qualcomm", displayTag: null, aliases: ["Qualcomm", "高通"] },
  intel: { name: "Intel", displayTag: null, aliases: ["Intel", "英特尔"] },
  blackrock: { name: "BlackRock", displayTag: null, aliases: ["BlackRock", "贝莱德"] },
  "pop-mart": { name: "Pop Mart", displayTag: null, aliases: ["Pop Mart", "泡泡玛特", "Labubu"] },
  luckin: { name: "Luckin Coffee", displayTag: null, aliases: ["Luckin", "瑞幸"] },
  starbucks: { name: "Starbucks", displayTag: null, aliases: ["Starbucks", "星巴克"] },
};

/**
 * Identity lexicon: a company in a headline or summary must also appear in the original, or the headline falls back
 * to the original and the summary is dropped (stops a model from misattributing). Patterns are case-sensitive
 * where the name is also an ordinary word.
 */
export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [
  { id: "huawei", name: "Huawei", patterns: [/huawei|华为|harmonyos|鸿蒙/i] },
  { id: "nvidia", name: "Nvidia", patterns: [/nvidia|英伟达/i] },
  { id: "tsmc", name: "TSMC", patterns: [/\bTSMC\b|台积电|Taiwan Semiconductor/] },
  { id: "apple", name: "Apple", patterns: [/\bApple\b|\biPhone\b|苹果公司/] },
  { id: "tesla", name: "Tesla", patterns: [/tesla|特斯拉/i] },
  { id: "byd", name: "BYD", patterns: [/\bBYD\b|比亚迪/] },
  { id: "bytedance", name: "ByteDance / TikTok", patterns: [/bytedance|tiktok|字节跳动|抖音|douyin/i] },
  { id: "alibaba", name: "Alibaba", patterns: [/alibaba|阿里巴巴|taobao|淘宝|\bAnt Group\b|蚂蚁集团/i] },
  { id: "tencent", name: "Tencent", patterns: [/tencent|腾讯|wechat|微信/i] },
  { id: "xiaomi", name: "Xiaomi", patterns: [/xiaomi|小米/i] },
  { id: "catl", name: "CATL", patterns: [/\bCATL\b|宁德时代/] },
  { id: "smic", name: "SMIC", patterns: [/\bSMIC\b|中芯国际/] },
  { id: "deepseek", name: "DeepSeek", patterns: [/deepseek|深度求索/i] },
  { id: "pdd", name: "PDD / Temu", patterns: [/\bPDD\b|pinduoduo|\bTemu\b|拼多多/i] },
  { id: "shein", name: "Shein", patterns: [/\bshein\b|希音/i] },
  { id: "boeing", name: "Boeing", patterns: [/boeing|波音/i] },
];

/** Articles on these domains are published by the entity itself (hosting platforms do not count). */
export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [
  { entityId: "huawei", domains: ["huawei.com"] },
  { entityId: "nvidia", domains: ["nvidia.com"] },
  { entityId: "tsmc", domains: ["tsmc.com"] },
  { entityId: "apple", domains: ["apple.com"] },
  { entityId: "tesla", domains: ["tesla.com"] },
  { entityId: "byd", domains: ["byd.com"] },
];

/** These spellings in the original also count as naming the entity. */
export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [];
