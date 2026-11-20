/**
 * 报告块编辑链回归（S02-T57）：
 * 覆盖 T55 嵌套根因＋N2/N3/N5 的前端可纯测部分——
 * blockRowHtml 单层/草稿旗标/引用只读与保真、repBlocksHtml 确认入口收敛、
 * reportHtml 从工作副本重渲染（未保存改动不丢）。
 * 事件链（添加→删除→调序）走 DOM，零依赖下无法自动化，按 HANDOFF §四.5 离屏人工走查。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { blockRowHtml, repBlocksHtml, reportHtml } from "../public/lib/pages/analysis.js";

const countRepRows = (h) => (h.match(/<div class="reprow"/g) ?? []).length;
/** 还原 HTML 属性值（浏览器解码实体后即 dataset 值）。 */
const attrDecode = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

test("块行：每块只产出一个顶层 .reprow（T55 嵌套根因防回归）", () => {
  const h = blockRowHtml({ id: "b1", nature: "observation", text: "t", refs: [], draft: false }, 0);
  assert.equal(countRepRows(h), 1, "一个块应只有一个 reprow");
});

test("块行：草稿旗标随 data-draft 走；确认按钮仅对已落库草稿渲染（N3）", () => {
  const draftPersisted = blockRowHtml({ id: "b1", nature: "observation", text: "t", refs: [], draft: true }, 0, undefined, true);
  assert.ok(draftPersisted.includes('data-draft="1"'));
  assert.ok(draftPersisted.includes("rep-confirm"), "已落库草稿应有确认按钮");
  const draftUnsaved = blockRowHtml({ id: "", nature: "observation", text: "t", refs: [], draft: true }, 0, undefined, false);
  assert.ok(draftUnsaved.includes('data-draft="1"'));
  assert.ok(!draftUnsaved.includes("rep-confirm"), "未落库草稿不得有确认按钮");
});

test("块行：引用为只读展示，不再是可编辑输入框（N2）", () => {
  const h = blockRowHtml({ id: "b1", nature: "observation", text: "t", refs: [{ kind: "result", id: "r1", version: "rev 2", label: "分析结果 A" }], draft: false }, 0);
  assert.ok(h.includes('<div class="rep-refs">'), "引用应为只读展示");
  assert.ok(!h.includes('<input class="rep-refs"'), "引用不应再有可编辑输入框");
  assert.ok(h.includes("分析结果 A"), "标签应可见");
});

test("块行：data-refs 保真——解码后与原始引用逐一相等（N2 证据链不再错挂）", () => {
  const refs = [
    { kind: "result", id: "r1", version: "rev 2", label: "结果一" },
    { kind: "measurement", id: "m1", version: "", label: "测量二；含分号" },
  ];
  const h = blockRowHtml({ id: "b1", nature: "observation", text: "t", refs, draft: false }, 0);
  const m = h.match(/data-refs="([^"]*)"/);
  assert.ok(m, "应带 data-refs");
  assert.deepEqual(JSON.parse(attrDecode(m[1])), refs);
});

test("块列表：已落库草稿显确认；新增/草稿（未落库）一律不显（N3＋N4 序号）", () => {
  const rep = { blocks: [{ id: "b1", nature: "observation", text: "旧", refs: [], draft: true }] };
  const blocks = [
    { id: "b1", nature: "observation", text: "旧", refs: [], draft: true },   // 已落库草稿
    { id: "", nature: "hypothesis", text: "新", refs: [], draft: false },      // 未落库新增
    { id: "", nature: "to_verify", text: "草", refs: [], draft: true },        // 未落库草稿
  ];
  const h = repBlocksHtml(blocks, undefined, rep);
  assert.equal(countRepRows(h), 3);
  assert.equal((h.match(/rep-confirm/g) ?? []).length, 1, "只有已落库草稿显确认按钮");
  assert.ok(h.includes("#1") && h.includes("#2") && h.includes("#3"), "序号连续");
});

test("reportHtml：无工作副本时按库内块渲染；有工作副本时按副本重渲染（N5 未保存不丢）", () => {
  const r = { id: "rep1", revision: 1, blocks: [{ id: "b1", nature: "observation", text: "库内文本", refs: [], draft: false }], pinned: { resultIds: [], snapshotHash: null }, history: [], taskId: null };
  assert.ok(reportHtml({}, { reportId: "rep1" }, r).includes("库内文本"));
  const ui = { reportId: "rep1", reportWorking: { rep1: [{ id: "b1", nature: "observation", text: "改后未保存", refs: [], draft: false }] } };
  const h = reportHtml({}, ui, r);
  assert.ok(h.includes("改后未保存"), "应渲染工作副本内容");
  assert.ok(!h.includes("库内文本"), "不得回落到库内旧文本");
});

test("结构守卫：两处理器经 renderRepBlocks 提交、无手建包装；collect 用直接子选择器", () => {
  const src = readFileSync(new URL("../public/lib/pages/analysis.js", import.meta.url), "utf8");
  assert.ok(!/row\.className\s*=\s*"reprow"/.test(src), "不得再手建 div.reprow 包装（T55 根因）");
  assert.ok(!/row\.dataset\.refs\s*=/.test(src), "不得再手写 dataset.refs（esc 误用地）");
  assert.match(src, /\.repblocks > \.reprow/, "collect 应用直接子选择器");
  assert.ok((src.match(/renderRepBlocks\(/g) ?? []).length >= 3, "添加/删除/调序/草稿应经 renderRepBlocks 重渲染");
});

test("可见文本：块行/整稿渲染不含禁用模式（与 frontend-text-check 同表）", () => {
  const visible = (h) => h.replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ");
  const FORBIDDEN = [
    [/\d{4}-\d{2}-\d{2}T/, "ISO 时间"],
    [/unreviewed|declared|exploratory|ai-draft|reconstructed|rev \d|fetch failed|docs\/stage/, "英文枚举/裸版本/原始报错"],
    [/fulltext|supplement|comparability|timing|execution_step|interpretation|\br\d+\b/, "附件角色/影响类别/裸版本"],
    [/\b(card|asset|task|block|attachment)\b/, "回查分组英文类型名"],
    [/（全部课题）/, "旧下拉"],
  ];
  const refs = [
    { kind: "result", id: "r1", version: "rev 2", label: "分析结果 A" },
    { kind: "measurement", id: "m1", version: "", label: "测量 B" },
    { kind: "card", id: "c1", version: "", label: "知识卡 C" },
  ];
  const rep = { id: "rep1", revision: 3, blocks: [{ id: "b1", nature: "observation", text: "正文", refs, draft: true }], pinned: { resultIds: ["r1"], snapshotHash: "abcdef123456" }, history: [{ revision: 2, at: "2026-11-18T12:35:00Z", reason: "改正文" }], taskId: null };
  const state = { executions: [], protocols: [], tables: [], measurements: [], samples: [], analysisResults: [], analysisTasks: [], subquestions: [], assets: [], cards: [], reports: [], papers: [] };
  const html = repBlocksHtml(rep.blocks, state, rep) + reportHtml(state, { reportId: "rep1" }, rep);
  const text = visible(html);
  for (const [re, label] of FORBIDDEN) {
    const m = text.match(re);
    assert.equal(m, null, `可见文本出现「${label}」：${m?.[0]}`);
  }
});

