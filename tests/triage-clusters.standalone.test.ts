// Free story clustering ahead of batch triage (editorial/clusters.ts): reports whose headlines share most
// of their distinctive words within the window are one story; different stories sharing common words
// ("China", "export controls") stay apart.
import assert from "node:assert/strict";
import { test } from "node:test";
import { clusterItems, headlineTokens } from "@aihot/backend/editorial/clusters";

const at = new Date("2026-11-02T00:00:00Z");
const TITLES = [
  "U.S. adds 12 Chinese chip firms to entity list",
  "Commerce adds 12 Chinese chip companies to the entity list",
  "Chinese EV maker BYD opens Hungary plant",
  "China tightens export controls on rare earths",
  "China tightens export controls on graphite",
  "China eases export controls on gallium",
  "Chip stocks rally on Fed rate cut hopes",
  "Fed cuts rates by a quarter point",
  "Fed cuts rates by quarter point, signals more to come",
  "China's exports rise 8% in October",
  "China imports fall in October",
  "Xi and Trump to meet in Busan",
  "Huawei unveils Ascend 950 AI chip",
  "Nvidia earnings beat estimates on AI demand",
  "Nvidia shares fall after earnings",
  "美国商务部将12家中国芯片企业列入实体清单",
  "商务部回应美国将中国芯片企业列入实体清单",
  "中国10月出口增长8%",
];

const groupsOf = (items: Array<{ id: string; title: string; at: Date }>) =>
  clusterItems(items, 48 * 3600_000).filter((g) => g.length > 1).map((g) => g.map((it) => it.title).sort()).sort();

test("headline tokens drop stopwords, case and plurals, and read Chinese as character pairs", () => {
  assert.deepEqual([...headlineTokens("The U.S. Adds 12 Chinese Chip Firms to Entity List")].sort(), ["12", "add", "chinese", "chip", "entity", "firm", "list", "u.s"]);
  assert.deepEqual([...headlineTokens("美国新增实体清单")], ["美国", "国新", "新增", "增实", "实体", "体清", "清单"]);
});

test("reports of one story join; different stories sharing common words stay apart", () => {
  assert.deepEqual(groupsOf(TITLES.map((title, i) => ({ id: String(i), title, at }))), [
    ["Commerce adds 12 Chinese chip companies to the entity list", "U.S. adds 12 Chinese chip firms to entity list"],
    ["Fed cuts rates by a quarter point", "Fed cuts rates by quarter point, signals more to come"],
    ["商务部回应美国将中国芯片企业列入实体清单", "美国商务部将12家中国芯片企业列入实体清单"],
  ]);
});

test("only reports within the window are compared", () => {
  const items = [
    { id: "a", title: TITLES[7]!, at },
    { id: "b", title: TITLES[8]!, at: new Date(at.getTime() + 49 * 3600_000) },
  ];
  assert.deepEqual(groupsOf(items), []);
});
