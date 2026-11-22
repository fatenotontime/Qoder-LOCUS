/**
 * 知识页最小接线 item4：「上下文地图」纯渲染 —— 节点/边只来自后端 map（不补造）；
 * 采用入口走真实状态（已采用显示徽标、未采用给按钮）；无子问题时不给采用按钮；接口未就绪明确提示。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { contextMapHtml } from "../public/lib/pages/analysis.js";

const state = {
  topics: [{ id: "t1", name: "课题甲" }],
  subquestions: [{ id: "q1", topicId: "t1", question: "子问题?" }],
  papers: [{ id: "p1", title: "论文", topicIds: ["t1"] }],
  measurements: [], tables: [],
  cards: [
    { id: "c1", paperId: "p1", audit: "confirm", rawText: "响应时间 0.8 s", scope: "", revision: 1, history: [], knowledgeItemIds: [] },
    { id: "c2", paperId: "p1", audit: "confirm", rawText: "另一条", scope: "", revision: 1, history: [], knowledgeItemIds: [] },
  ],
  adoptions: [{ id: "ad1", cardId: "c2", subquestionId: "q1", decision: "adopt" }],
};
const task = { id: "at1", topicId: "t1", title: "分析", subquestionId: "q1", core: [], optional: [], resultIds: [] };
const readyMap = (data) => ({ status: "ready", key: "t1|at1", data, dirty: false });
const MAP = {
  ok: true,
  scope: { topicId: "t1", subquestionId: "q1", taskId: "at1", frozen: false },
  nodes: [
    { key: "card:c1", kind: "card", id: "c1", label: "卡一", role: "selected", selectable: true, adoptable: true, gaps: [] },
    { key: "card:c2", kind: "card", id: "c2", label: "卡二", role: "optional", selectable: true, adoptable: true, gaps: [] },
    { key: "card:c3", kind: "card", id: "c3", label: "卡三", role: "optional", selectable: true, adoptable: false, adoptBlockedReason: "缺原文定位", gaps: [] },
    { key: "topic:t1", kind: "topic", id: "t1", label: "课题甲", role: "context", selectable: false, adoptable: false, gaps: [] },
  ],
  edges: [{ from: "card:c1", to: "topic:t1", edgeKind: "affiliation", establishedBy: "card.paperId" }],
  gaps: [], truncated: false,
};

test("item4 地图节点/边只来自后端 map（不补造），采用入口按真实状态", () => {
  const html = contextMapHtml(state, { nav: "analysis", taskId: "at1", anMap: readyMap(MAP) }, task);
  assert.match(html, /上下文地图（只读）/);
  assert.match(html, /卡一/);
  assert.match(html, /关系 1/);
  assert.match(html, /card:c1 → topic:t1/); // 唯一那条边来自 map
  assert.match(html, /已采用/); // c2 已在 adoptions 里
  assert.ok((html.match(/>采用</g) ?? []).length >= 1, "c1 未采用 → 给「采用」按钮");
  assert.match(html, /不可采用：缺原文定位/); // c3 可选但未达采用前置 → 给如实原因，不给假入口
});

test("item4 采用按钮只对 adoptable 节点：不可采用卡不给「采用」按钮", () => {
  const html = contextMapHtml(state, { nav: "analysis", taskId: "at1", anMap: readyMap(MAP) }, task);
  // c3（adoptable:false）那一行不得出现「采用」按钮
  const c3Row = html.split("card:c3")[1].split("</li>")[0];
  assert.equal(c3Row.includes(">采用<"), false);
  assert.equal(c3Row.includes("an-adopt"), false);
  assert.match(c3Row, /不可采用/);
});

test("item4 无子问题 → 不渲染采用按钮（采用必须有子问题）", () => {
  const html = contextMapHtml(state, { nav: "analysis", taskId: "at1", anMap: readyMap(MAP) }, { ...task, subquestionId: undefined });
  assert.equal(html.includes("an-adopt"), false);
});

test("item4 地图未就绪/失败 → 明确提示，不伪装成功", () => {
  const unwired = contextMapHtml(state, { nav: "analysis", taskId: "at1", anMap: { status: "unwired", key: "k", dirty: false } }, task);
  assert.match(unwired, /地图接口未就绪/);
  const err = contextMapHtml(state, { nav: "analysis", taskId: "at1", anMap: { status: "error", key: "k", dirty: false, message: "boom" } }, task);
  assert.match(err, /地图暂不可用/);
  const loading = contextMapHtml(state, { nav: "analysis", taskId: "at1", anMap: { status: "loading", key: "k", dirty: false } }, task);
  assert.match(loading, /地图加载中/);
});

test("item4 撤回采用后按真实状态呈现：排除卡标「已排除」而非「已采用」", () => {
  const excluded = { ...state, adoptions: [{ id: "ad2", cardId: "c1", subquestionId: "q1", decision: "exclude", reason: "与本研究口径不符" }] };
  const html = contextMapHtml(excluded, { nav: "analysis", taskId: "at1", anMap: readyMap(MAP) }, task);
  assert.match(html, /已排除/); // c1 现为排除态
  assert.equal(html.includes("已采用"), false); // 不得再把排除卡当作已采用
});
