import test from "node:test";
import assert from "node:assert/strict";
import { knowledgeOverviewHtml, kzLibState } from "../public/lib/pages/knowledge-container.js";

const state = {
  topics: [{ id: "t1", name: "课题甲" }],
  papers: [{ id: "p1", title: "论文一" }],
  assets: [{ id: "as1", name: "原文一" }],
  cards: [{ id: "c1", paperId: "p1", audit: "confirm" }],
};

const item = {
  ref: { kind: "item", id: "ki1", revision: 2 },
  kind: "item", contentType: "claim", nature: "observation", sourceClass: "literature_report",
  reviewStatus: "confirmed", label: "响应时间 0.8 s", valueText: "0.8 s", unit: "s",
  unknownCount: 1, themeIds: ["th1"], sourceTokens: ["S1"], conditionTexts: ["温度＝25 °C", "pH＝7.0"],
};
const pending = {
  ref: { kind: "item", id: "ki2", revision: 1 },
  kind: "item", contentType: "claim", nature: "hypothesis", sourceClass: "literature_report",
  reviewStatus: "pending", label: "低温下响应更快", valueText: "未填值", unit: null,
  unknownCount: 0, themeIds: [], sourceTokens: ["S1"], conditionTexts: [],
};
const dataset = {
  ref: { kind: "dataset", id: "ds1", revision: 1 },
  kind: "dataset", contentType: null, nature: null, sourceClass: "dataset",
  reviewStatus: "pending", label: "数据集 · as1", valueText: "选定 2 行 × 3 列", unit: null,
  unknownCount: 0, themeIds: [], sourceTokens: ["S1"], conditionTexts: [],
  aggregate: { columns: 3, rows: 2, datasetRef: { kind: "dataset", id: "ds1", revision: 1 } },
};

const data = {
  viewId: "v1", scope: { topicId: "t1" }, mode: "formal",
  elements: [item, pending, dataset],
  totals: { items: 2, datasets: 1, pending: 1, notFormal: 0 },
  counts: { matched: 9, loaded: 3, totalKnown: 14 },
  undivided: [{ kind: "item", id: "ki2", revision: 1 }],
  byTheme: [{ themeId: "th1", name: "pH 与响应", memberRefs: [{ kind: "item", id: "ki1", revision: 2 }] }],
  bySource: [{ token: "S1", label: "asset as1 v1", itemRefs: [{ kind: "item", id: "ki1", revision: 2 }, { kind: "item", id: "ki2", revision: 1 }] }],
  sources: [{ token: "S1", ref: { kind: "asset", id: "as1", version: "v1", contentHash: "h" }, label: "asset as1 v1" }],
  cardIndex: [{ cardId: "c1", itemRefs: [{ kind: "item", id: "ki1", revision: 2 }] }],
  dedupNote: "去重以固定引用为准。",
  warnings: [{ message: "来源版本有更新，需复核。" }],
  hasMore: true, nextCursor: 60,
};

const ui = (patch = {}) => ({ nav: "knowledge", topicId: "t1", kzPanel: "library", ...patch });
const text = (h: string) => h.replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();

test("库总览：未读到数据时只显示真实读取态，不画数量", () => {
  const html = knowledgeOverviewHtml(state, ui());
  assert.ok(html.includes('data-state="loading"'));
  assert.ok(html.includes('aria-busy="true"'));
  assert.ok(text(html).includes("正在读取库总览"));
  assert.ok(!text(html).includes("已加载"));
  assert.equal(kzLibState(ui()), "loading");
});

test("库总览：空库、未接入、读取失败是三种不同状态", () => {
  const empty = knowledgeOverviewHtml(state, ui({ kzLib: { status: "empty", topicId: "t1", data: { ...data, elements: [], byTheme: [], bySource: [], undivided: [], totals: { items: 0, datasets: 0, pending: 0, notFormal: 0 }, counts: { matched: 0, loaded: 0, totalKnown: 0 } } } }));
  assert.ok(empty.includes('data-state="empty"'));
  assert.ok(text(empty).includes("还没有可展示的知识资产"));
  assert.ok(text(empty).includes("去导入文献") && text(empty).includes("记一条认识"));
  const withPaper = knowledgeOverviewHtml({ ...state, papers: [{ id: "p1", title: "论文一", topicIds: ["t1"] }] }, ui({ kzLib: { status: "empty", topicId: "t1", data: { ...data, elements: [], totals: { items: 0, datasets: 0, pending: 0, notFormal: 0 } } } }));
  assert.ok(text(withPaper).includes("去发起语义提取"), "课题已有文献时直接去扫描");

  const unwired = knowledgeOverviewHtml(state, ui({ kzLib: { status: "unwired", topicId: "t1" } }));
  const error = knowledgeOverviewHtml(state, ui({ kzLib: { status: "error", topicId: "t1" } }));
  assert.ok(text(unwired).includes("还没有库总览接口"));
  assert.ok(text(error).includes("暂时读不到"));
  assert.notEqual(text(unwired), text(error));
  assert.ok(!text(error).includes("fetch failed"));
});

test("库总览：已加载、匹配、全库分开写，簇与计数都来自同一响应", () => {
  const html = knowledgeOverviewHtml(state, ui({ kzLib: { status: "ready", topicId: "t1", data } }));
  const t = text(html);
  assert.ok(html.includes('data-state="ready"'));
  assert.ok(t.includes("已加载 3 项") && t.includes("匹配 9 项") && t.includes("全库 14 项"));
  assert.ok(t.includes("数据集 1 个") && t.includes("待审 1 项"));
  assert.ok(t.includes("pH 与响应") && t.includes("未分主题") && t.includes("数据集"));
  assert.ok(t.includes("当前只读取了已加载范围"));
  assert.ok(t.includes("同一知识项的多个分项按分项计数"));
  assert.ok(!t.includes("kind+id+revision"), "不把去重实现的字段名当可见文案");
  assert.ok(t.includes("有 1 条数据提醒"));
  assert.ok(html.includes('aria-label="观察；响应时间 0.8 s；已确认；1 个未知项"'));
  assert.ok(!t.includes("as1") && !t.includes("ki1") && !t.includes("ds1"), "不把内部引用 ID 当可见文本");
  assert.ok(!t.match(/\b(item|dataset|pending|confirmed|asset)\b/), "不出现英文枚举");
});

test("库总览：数据集按聚合展示，不逐单元格展开", () => {
  const html = knowledgeOverviewHtml(state, ui({ kzLib: { status: "ready", topicId: "t1", data, selected: "dataset:ds1@1" } }));
  const t = text(html);
  assert.ok(t.includes("数据集聚合（2 行 × 3 列）"));
  assert.ok(t.includes("聚合入口，不逐格展开"));
  assert.ok(html.includes('class="kzlib-dot is-pending is-dataset')); // 数据集有自己的形状
});

test("库总览：选中知识项显示值、条件、主题、来源与审阅入口", () => {
  const html = knowledgeOverviewHtml(state, ui({ kzLib: { status: "ready", topicId: "t1", data, selected: "item:ki1@2" } }));
  const t = text(html);
  assert.ok(t.includes("响应时间 0.8 s"));
  assert.ok(t.includes("值：0.8 s"));
  assert.ok(t.includes("温度＝25 °C") && t.includes("pH＝7.0"));
  assert.ok(t.includes("主题：pH 与响应"));
  assert.ok(t.includes("来源：S1 · 原文一"));
  assert.ok(t.includes("去审阅这张卡"));
  assert.ok(html.includes('data-kzlib-card="c1"'));
  assert.ok(html.includes('aria-pressed="true"'));
});

test("库总览：同源列表为键盘入口，使用同一批元素", () => {
  const html = knowledgeOverviewHtml(state, ui({ kzLib: { status: "ready", topicId: "t1", data } }));
  assert.ok(html.includes('class="kzlib-sources"'));
  const opened = knowledgeOverviewHtml(state, ui({ kzLib: { status: "ready", topicId: "t1", sourcesOpen: true, data } }));
  assert.ok(opened.includes('class="kzlib-sources" open'), "展开状态不因重绘而丢失");
  assert.ok(text(html).includes("同源列表"));
  assert.ok((html.match(/data-kzlib-el="/g) ?? []).length >= 4, "簇图与同源列表都可选中");
  assert.ok(text(html).includes("响应时间 0.8 s") && text(html).includes("低温下响应更快"));
  assert.ok(!text(html).includes("asset as1"), "不直接显示后端的来源标签");
});

test("库总览：异常文本被转义，状态映射稳定", () => {
  const evil = { ...item, label: "<img src=x onerror=alert(1)>", conditionTexts: ["<script>x</script>"] };
  const html = knowledgeOverviewHtml(state, ui({ kzLib: { status: "ready", topicId: "t1", data: { ...data, elements: [evil], byTheme: [], undivided: [], bySource: [], cardIndex: [] }, selected: "item:ki1@2" } }));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("<script>x"));
  assert.equal(kzLibState({ kzLib: { status: "unwired" } }), "unwired");
  assert.equal(kzLibState({ kzLib: { status: "weird" } }), "loading");
});