/**
 * 前端拆分：lib/pages/knowledge.js、lib/pages/analysis.js 需能在 node 下导入
 * （模块顶层不访问 DOM），并导出预期函数；lib/refs.js 纯函数可用。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { refLabel, topicObjects } from "../public/lib/refs.js";

test("pages/knowledge 与 pages/analysis 可在 node 下导入并导出渲染/绑定函数", async () => {
  const k = await import("../public/lib/pages/knowledge.js");
  for (const fn of ["knowledgeLeftHtml", "knowledgeWorkspaceHtml", "knowledgeQueueHtml", "renderKnowledgeForm", "bindKnowledge"]) {
    assert.equal(typeof k[fn], "function", `knowledge.${fn}`);
  }
  const a = await import("../public/lib/pages/analysis.js");
  for (const fn of ["renderAnalysisForm", "currentTask", "contextMapHtml", "snapshotHtml", "analysisRightHtml", "bindAnalysis"]) {
    assert.equal(typeof a[fn], "function", `analysis.${fn}`);
  }
});

test("lib/refs.js：refLabel / topicObjects 纯函数（无 DOM）", () => {
  const state = {
    executions: [{ id: "e1", protocolId: "p1" }], protocols: [{ id: "p1", name: "方案A" }],
    tables: [{ id: "t1", name: "表A", assetId: "as1" }], assets: [{ id: "as1", topicId: "tp1" }],
    measurements: [], samples: [], cards: [], papers: [], subquestions: [],
  };
  const ui = { topicId: "tp1" };
  assert.equal(refLabel(state, { kind: "protocol", id: "p1" }), "方案 · 方案A");
  assert.equal(refLabel(state, { kind: "execution", id: "e1" }), "执行 · 方案A");
  const o = topicObjects(state, ui);
  assert.equal(o.tables.length, 1);
});
