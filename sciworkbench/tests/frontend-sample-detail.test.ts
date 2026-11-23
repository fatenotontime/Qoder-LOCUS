/**
 * 缺陷6 样品详情子页：记录总览「样品」区可进入单个样品详情子页并返回。
 * - 纯渲染（lib/pages/record.js）：总览样品行给出「查看详情」入口；详情子页渲染
 *   身份 / 状态追加历史（逐版保留不覆盖）/ 来源回链（执行·方案·测量）/ 返回入口；
 *   来源缺失如实标注，不前端造数据。
 * - 接线（读 app.js 源码）：openSampleDetail/backToSampleOverview、ui.sampleView/ui.sampleId
 *   纳入历史栈与本地持久化；返回恢复列表态（isListView 把样品详情排除出列表态）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { recordOverviewHtml, sampleDetailHtml } from "../public/lib/pages/record.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const APP_SRC = readFileSync(`${HERE}/../public/app.js`, "utf8");

const ISO = "2026-11-18T12:35:11.046Z";
const state = {
  version: 9,
  topics: [{ id: "t1", name: "课题甲", researchQuestion: "Q" }],
  subquestions: [], assets: [], papers: [], attachments: [], cards: [], adoptions: [], mappings: [], comparisons: [],
  protocols: [{ id: "pr1", topicId: "t1", name: "方案甲", sourceKind: "ai-draft", revision: 1, revisions: [{ revision: 1, at: ISO, reason: "", purpose: "", inputs: [], steps: [{ id: "s1", op: "升温" }], conditions: [], criteria: "", unknowns: [], sourceFragments: [] }] }],
  templates: [],
  executions: [{ id: "e1", topicId: "t1", protocolId: "pr1", protocolRevision: 1, phase: "recording", status: "active", events: [], origin: "user", createdAt: ISO, updatedAt: ISO }],
  tables: [],
  samples: [{
    id: "s1", topicId: "t1", executionId: "e1", shortName: "S1", displayName: "样品甲", origin: "user",
    states: [
      { revision: 1, at: ISO, amount: { value: "10", unit: "mg", estimated: false }, handling: "", use: "", note: "" },
      { revision: 2, at: ISO, amount: { value: "12", unit: "mg", estimated: true }, handling: "分装", use: "测试", note: "二次" },
    ],
    createdAt: ISO,
  }],
  measurements: [
    { id: "m1", topicId: "t1", sampleId: "s1", sampleStateRevision: 2, time: ISO, method: "HPLC", instrument: "X", value: "12", unit: "mg", cellRef: { tableId: "tb1", row: 3, col: 2 }, origin: "user", revision: 1, history: [], createdAt: ISO },
  ],
  impacts: [], ocrs: [], analysisTasks: [], analysisResults: [], reports: [], chats: [],
};
const ui = { nav: "record", topicId: "t1", recordView: "overview", sampleView: "detail", sampleId: "s1" };
const visibleText = (h) => h.replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ");

test("记录总览「样品」区：每行给出「查看详情」入口，指向该样品", () => {
  const html = recordOverviewHtml(state, { ...ui, sampleView: "overview", sampleId: null });
  assert.ok(html.includes('data-smp-open="s1"'), "样品行要有指向该样品的详情入口");
  assert.match(html, /查看详情/);
});

test("样品详情子页：身份 + 状态追加历史（逐版保留）+ 来源回链 + 返回入口", () => {
  const html = sampleDetailHtml(state, ui);
  assert.match(html, /data-smp-back/); // 返回总览
  assert.ok(html.includes("样品甲") && html.includes("S1"), "显示身份（显示名与短号）");
  assert.match(html, /逐版保留不覆盖/);
  // 状态追加历史：每一版都在，旧版不被覆盖；当前版显式标出
  assert.match(html, /状态 第1版/);
  assert.match(html, /状态 第2版/);
  assert.match(html, /第2版 <span class="badge confirm">当前<\/span>/);
  assert.ok(html.includes("10 mg") && html.includes("12 mg"), "各版用量逐条可见");
  // 来源回链：执行 / 方案 / 测量（测量固定在其样品状态版本上，并可回链表）
  assert.ok(html.includes('data-exec="e1"'), "回链来源执行");
  // 回链须真能跳：按钮得带 app.js 委托处理器认的类名，只给 data-* 是死链（假入口）
  assert.ok(/class="[^"]*rec-exec-open[^"]*"[^>]*data-exec="e1"/.test(html), "来源执行回链按钮须带 rec-exec-open 类（app.js 委托处理器识别）");
  assert.ok(html.includes('data-proto-open="pr1"'), "回链来源方案");
  assert.match(html, /固定样品状态 第2版/);
  assert.ok(html.includes('data-tid="tb1"'), "测量回链表可打开");
});

test("样品详情：来源缺失/样品消失如实标注，不前端造数据", () => {
  const execGone = sampleDetailHtml({ ...state, executions: [] }, ui);
  assert.match(execGone, /来源执行缺失/);
  const noExec = sampleDetailHtml({ ...state, samples: [{ ...state.samples[0], executionId: undefined }] }, ui);
  assert.match(noExec, /无直接执行来源/);
  assert.equal(noExec.includes('data-exec='), false, "无来源执行则不给跳转入口");
  const gone = sampleDetailHtml(state, { ...ui, sampleId: "nope" });
  assert.match(gone, /已不存在/);
  assert.match(gone, /data-smp-back/);
});

test("样品详情可见文本不含 ISO 时间 / 英文枚举 / 裸版本号", () => {
  const text = visibleText(sampleDetailHtml(state, ui));
  assert.equal(/\d{4}-\d{2}-\d{2}T/.test(text), false, "不得出现 ISO 时间");
  assert.equal(/unreviewed|declared|exploratory|ai-draft|rev \d/.test(text), false, "不得出现英文枚举/裸版本");
});

test("app.js 接线：样品详情子页可打开/返回，状态纳入历史栈与本地持久化", () => {
  assert.match(APP_SRC, /function openSampleDetail\(/);
  assert.match(APP_SRC, /function backToSampleOverview\(/);
  assert.ok(APP_SRC.includes('ui.sampleView = "detail"'));
  assert.ok(APP_SRC.includes("data-smp-open"));
  assert.ok(APP_SRC.includes("data-smp-back"));
  assert.ok(APP_SRC.includes('closest(".rec-exec-open")'), "执行详情入口由 .rec-exec-open 委托处理器识别（样品详情来源执行回链复用同一入口）");
  assert.ok(APP_SRC.includes("content.innerHTML = sampleDetailHtml(state, ui)"), "详情由 renderMiddle 挂载");
  // 历史栈与持久化
  assert.ok(APP_SRC.includes("sampleView: ui.sampleView, sampleId: ui.sampleId"), "pageState/saveUi 带上样品子页状态");
  assert.match(APP_SRC, /ui\.sampleView = st\.sampleView/); // applyPageState
  assert.match(APP_SRC, /if \(s\.sampleView === "detail"/); // restoreUi
  // 返回恢复列表态：样品详情不算列表页 → 返回按列表键恢复滚动
  assert.match(APP_SRC, /\(ui\.nav === "record" && ui\.recordView !== "detail" && ui\.sampleView !== "detail"\)/);
});
