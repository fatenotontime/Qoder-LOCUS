/**
 * A7 前端渲染自动检查：对纯渲染函数（lib/views.js）的输出断言——
 * 可见文本不得出现 ISO 时间、英文枚举、裸版本号、"docs/stage"、"（全部课题）"、"fetch failed"。
 * 只扫描「可见文本」：去掉标签（含属性值）与「详情」折叠体（原始报错允许留在详情里）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  topbarTopicHtml, emptyTopicGuideHtml, navHtml, panelErrorHtml, sidebarListHtml,
  topicOverviewHtml, topicTodosHtml, subqBlockHtml,
} from "../public/lib/views.js";
import { fmtTime, fmtEnum, fmtVersion, fmtNameOnce } from "../public/lib/format.js";

const ISO = "2026-11-18T12:35:11.046Z";
const state = {
  version: 8,
  topics: [{ id: "t1", name: "课题甲", researchQuestion: "Q" }],
  subquestions: [{ id: "q1", topicId: "t1", question: "子问题?", kind: "declared" }],
  assets: [{ id: "as1", kind: "literature", name: "n", bytes: 1, hash: "h", text: "t", topicId: "t1", createdAt: ISO }],
  papers: [{ id: "p1", title: "论文", year: "1859", doi: "", topicIds: ["t1"] }],
  attachments: [{ id: "a1", paperId: "p1", assetId: "as1", role: "fulltext", version: "v1" }],
  cards: [{ id: "c1", paperId: "p1", assetId: "as1", rawText: "x", audit: "unreviewed", importance: null, note: "", reason: "", extraction: "manual", revision: 1, history: [], locator: { sectionQuote: "x" }, unknowns: [], secondaryCitation: false, mechanical: false, createdAt: ISO, updatedAt: ISO }],
  tables: [], adoptions: [], mappings: [], comparisons: [],
  protocols: [{ id: "pr1", topicId: "t1", name: "方案", sourceKind: "ai-draft", revision: 2, revisions: [{ revision: 2, at: ISO, reason: "", purpose: "", inputs: [], steps: [{ id: "s1", op: "o" }], conditions: [], criteria: "", unknowns: [], sourceFragments: [] }] }],
  templates: [],
  executions: [{ id: "e1", topicId: "t1", protocolId: "pr1", protocolRevision: 2, phase: "preparing", preparation: { baseRevision: 2, adjustments: [{}], notes: "" }, status: "active", events: [], createdAt: ISO, updatedAt: ISO }],
  samples: [], measurements: [], impacts: [], ocrs: [],
  analysisTasks: [{ id: "at1", topicId: "t1", title: "分析", core: [], optional: [], resultIds: [], createdAt: ISO, updatedAt: ISO }],
  analysisResults: [], reports: [],
  chats: [{ id: "ch1", topicId: "t1", scope: [], messages: [], createdAt: ISO, updatedAt: ISO }],
};
const ui = { nav: "topic", topicId: "t1", paperId: "p1", protocolId: "pr1", executionId: "e1", taskId: "at1", chatId: "ch1" };

const detailStripped = (h) => h.replace(/<pre class="perr-detail-body"[\s\S]*?<\/pre>/g, " ");
const visibleText = (h) => detailStripped(h).replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ");

function allRendered() {
  const parts = [
    topbarTopicHtml(state, ui), topbarTopicHtml({ ...state, topics: [] }, ui), topbarTopicHtml({ ...state, topics: [state.topics[0], { id: "t2", name: "课题乙", researchQuestion: "R" }] }, ui),
    emptyTopicGuideHtml(), navHtml(ui, false), navHtml(ui, true),
    panelErrorHtml({ panel: "mid", message: "连不上模型，请检查网络或 Key", detail: "fetch failed: ETIMEDOUT", retry: () => {} }),
    sidebarListHtml(state, ui),
    sidebarListHtml(state, { ...ui, nav: "papers" }),
    sidebarListHtml(state, { ...ui, nav: "protocol" }),
    sidebarListHtml(state, { ...ui, nav: "record" }),
    sidebarListHtml(state, { ...ui, nav: "analysis" }),
    sidebarListHtml(state, { ...ui, nav: "chat" }),
    topicOverviewHtml(state, ui), topicTodosHtml(state, ui), subqBlockHtml(state, ui),
  ];
  return parts.join("\n");
}

const FORBIDDEN = [
  [/\d{4}-\d{2}-\d{2}T/, "ISO 时间"],
  [/unreviewed|declared|exploratory|ai-draft|rev \d|fetch failed|docs\/stage/, "英文枚举/裸版本/原始报错/文档路径"],
  [/（全部课题）/, "旧「全部课题」下拉"],
];

test("A7 纯渲染输出：可见文本不含禁用模式", () => {
  const html = allRendered();
  const text = visibleText(html);
  for (const [re, label] of FORBIDDEN) {
    const m = text.match(re);
    assert.equal(m, null, `可见文本出现「${label}」：${m?.[0]}`);
  }
});

test("A7 报错条：默认文案为中文人话；原始信息只在「详情」内", () => {
  const bar = panelErrorHtml({ panel: "mid", message: "连不上模型，请检查网络或 Key", detail: "fetch failed", retry: () => {} });
  assert.ok(visibleText(bar).includes("连不上模型"));
  assert.ok(!visibleText(bar).includes("fetch failed")); // 详情被排除
  assert.ok(bar.includes("fetch failed")); // 但原始信息确实保留在详情中
});

test("A7 格式化词表：时间/枚举/版本/去重", () => {
  const d = new Date(ISO), p = (n) => String(n).padStart(2, "0");
  assert.equal(fmtTime(ISO), `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`);
  assert.match(fmtTime(ISO), /^\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(fmtEnum("declared"), "已定");
  assert.equal(fmtEnum("unreviewed"), "待审");
  assert.equal(fmtEnum("ai-draft"), "模型草稿");
  assert.equal(fmtVersion(2), "第2版");
  assert.equal(fmtNameOnce("SEA-94", "SEA-94"), "SEA-94");
  assert.equal(fmtNameOnce("种子组", "SEA-94"), "种子组（SEA-94）");
});
