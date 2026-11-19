/**
 * 阶段③（S02-T50，T49-4/D3 路径 A）契约测试：历史文献重构全链路来源标记。
 * 覆盖：方案 reconstructed → 执行/样品/测量/表继承；上下文摘录、引用网络、
 * Word/追溯包导出均明示"非本地实测"；达尔文验收夹具端到端全链路标记。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { emptyState, type LocusState } from "../store.ts";
import { createTopic, importMeasurements, AppError } from "../services/app.ts";
import { createProtocol, startExecution, confirmPreparation, createSample, addMeasurement } from "../services/experiment.ts";
import { createAnalysisTask, submitResult, createReport, applyReportEdit, resolveFragment } from "../services/analysis.ts";
import { buildNetwork } from "../services/references.ts";
import { buildReportDocx, buildTraceabilityPackage } from "../services/export.ts";

const STEP = { id: "s1", op: "浸泡", params: {}, note: "", durationMin: null, estimated: false, branch: null, observeEnd: "" };

function reconWorld() {
  let s = emptyState();
  s = createTopic(s, { name: "重构课题", researchQuestion: "Q" }).state;
  const topicId = s.topics[0].id;
  const src = importMeasurements(s, { name: "src.csv", csv: "a,b\n1,2", topicId }); s = src.state;
  const pr = createProtocol(s, { topicId, name: "文献重构方案", sourceKind: "reconstructed", sourceAssetId: src.asset.id, purpose: "按原文重构", criteria: "原文陈述", steps: [STEP] }); s = pr.state;
  const e = startExecution(s, { topicId, protocolId: pr.protocol.id }); s = e.state;
  s = confirmPreparation(s, e.execution.id).state;
  const smp = createSample(s, { topicId, executionId: e.execution.id, shortName: "R1", amount: { value: "1", unit: "份" } }); s = smp.state;
  const m = addMeasurement(s, { topicId, sampleId: smp.sample.id, sampleStateRevision: 1, value: "90", unit: "days" }); s = m.state;
  const tab = importMeasurements(s, { name: "d.csv", csv: "g,d\nx,90", topicId, origin: "reconstructed" }); s = tab.state;
  const tableId = s.tables[s.tables.length - 1].id;
  const task = createAnalysisTask(s, { topicId, title: "重构汇总", core: [{ kind: "measurement", id: m.measurement.id }, { kind: "table", id: tableId }] }); s = task.state;
  const res = submitResult(s, task.task.id, { method: "汇总", params: "原文陈述" }); s = res.state;
  const rep = createReport(s, { topicId, taskId: task.task.id }); s = rep.state;
  s = applyReportEdit(s, rep.report.id, { baseRevision: 1, blocks: [
    { nature: "observation" as const, text: "漂浮 90 天", refs: [
      { kind: "result" as const, id: res.result.id, version: "rev 1", label: "汇总" },
      { kind: "measurement" as const, id: m.measurement.id, version: "rev 1", label: "测量 90" },
    ] },
  ], reason: "首稿" }).state;
  return { s, topicId, protoId: pr.protocol.id, execId: e.execution.id, sampleId: smp.sample.id, measId: m.measurement.id, tableId, resultId: res.result.id, reportId: rep.report.id, srcAssetId: src.asset.id };
}

test("重构-1 来源继承链：方案→执行→样品→测量；表按导入声明", () => {
  const w = reconWorld();
  const e = w.s.executions.find((x) => x.id === w.execId)!;
  assert.equal(e.origin, "reconstructed");
  assert.equal(e.sourceAssetId, w.srcAssetId);
  assert.equal(w.s.samples.find((x) => x.id === w.sampleId)!.origin, "reconstructed");
  assert.equal(w.s.measurements.find((x) => x.id === w.measId)!.origin, "reconstructed");
  assert.equal(w.s.tables.find((x) => x.id === w.tableId)!.origin, "reconstructed");
  // 普通方案不受影响（缺省 user）
  const pr2 = createProtocol(w.s, { topicId: w.topicId, name: "本地方案", purpose: "p", criteria: "c", steps: [STEP] });
  const e2 = startExecution(pr2.state, { topicId: w.topicId, protocolId: pr2.protocol.id });
  assert.equal(e2.execution.origin, "user");
});

test("重构-2 显式重构执行须有文献来源；来源不存在 → 404", () => {
  let s = emptyState();
  s = createTopic(s, { name: "T", researchQuestion: "Q" }).state;
  const topicId = s.topics[0].id;
  const pr = createProtocol(s, { topicId, name: "P", purpose: "p", criteria: "c", steps: [STEP] }); s = pr.state;
  assert.throws(() => startExecution(s, { topicId, protocolId: pr.protocol.id, origin: "reconstructed" }), (e: unknown) => e instanceof AppError && e.status === 422);
  assert.throws(() => startExecution(s, { topicId, protocolId: pr.protocol.id, origin: "reconstructed", sourceAssetId: "ast_ghost" }), (e: unknown) => e instanceof AppError && e.status === 404);
});

test("重构-3 上下文摘录明示：执行/方案/测量/表均带重构性质（交给 AI 前可见）", () => {
  const w = reconWorld();
  assert.ok(resolveFragment(w.s, { kind: "execution", id: w.execId }).excerpt.includes("历史文献重构"));
  assert.ok(resolveFragment(w.s, { kind: "protocol", id: w.protoId }).excerpt.includes("重构"));
  const mf = resolveFragment(w.s, { kind: "measurement", id: w.measId });
  assert.ok(mf.excerpt.includes("非本地测量"));
  assert.ok(mf.label.includes("文献重构"));
  assert.ok(resolveFragment(w.s, { kind: "table", id: w.tableId }).label.includes("文献重构"));
});

test("重构-4 引用网络：执行节点带重构 pending ＋ 来源原件溯源边", () => {
  const w = reconWorld();
  const net = buildNetwork(w.s);
  const en = net.nodes.get(`execution:${w.execId}`)!;
  assert.ok(en.label.includes("文献重构"));
  assert.ok(en.pending!.some((p) => p.includes("历史文献重构")));
  assert.ok(net.edges.some((e) => e.from === `asset:${w.srcAssetId}` && e.to === `execution:${w.execId}` && e.edgeKind === "provenance"));
  assert.ok(net.nodes.get(`measurement:${w.measId}`)!.label.includes("文献重构"));
  assert.ok(net.nodes.get(`sample:${w.sampleId}`)!.label.includes("文献重构"));
  assert.ok(net.nodes.get(`table:${w.tableId}`)!.label.includes("文献重构"));
});

/** 解出 docx 内 word/document.xml 文本（本地头定位＋inflate）。 */
function docxText(buf: Buffer): string {
  const i = buf.indexOf(Buffer.from("word/document.xml"));
  const start = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 3, 4]), i);
  const compSize = buf.readUInt32LE(start + 18);
  const nameLen = buf.readUInt16LE(start + 26);
  const extraLen = buf.readUInt16LE(start + 28);
  const dataStart = start + 30 + nameLen + extraLen;
  return inflateRawSync(buf.subarray(dataStart, dataStart + compSize)).toString("utf8");
}

test("重构-5 导出明示：Word 引用标注＋文首提示；追溯包版本索引带 origin（result 沿任务核心继承）", () => {
  const w = reconWorld();
  const rep = w.s.reports.find((r) => r.id === w.reportId)!;
  const xml = docxText(buildReportDocx(w.s, rep));
  assert.ok(xml.includes("历史文献重构数据"));
  assert.ok(xml.includes("历史文献重构，非本地实测"));
  const tr = buildTraceabilityPackage(w.s, w.reportId);
  const fixed = tr.versionIndex.fixedRefs as { kind: string; origin?: string }[];
  assert.equal(fixed.find((r) => r.kind === "measurement")!.origin, "reconstructed");
  assert.equal(fixed.find((r) => r.kind === "result")!.origin, "reconstructed"); // 结果沿任务核心继承
});

test("重构-6 达尔文验收夹具端到端：保存即全链路重构标记（生成到临时文件，不动现有实例）", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const out = join(tmpdir(), `locus-darwin-test-${Date.now()}.json`);
  try {
    execFileSync(process.execPath, [join(root, "scripts", "acceptance-darwin.ts"), out], { cwd: root, stdio: "pipe" });
    const s = JSON.parse(readFileSync(out, "utf8")) as LocusState;
    assert.equal(s.protocols[0].sourceKind, "reconstructed");
    assert.ok(s.protocols[0].sourceAssetId);
    const e = s.executions[0];
    assert.equal(e.origin, "reconstructed");
    assert.equal(e.sourceAssetId, s.protocols[0].sourceAssetId);
    assert.ok(e.events.every((ev) => ev.backfilled));
    assert.ok(e.events.some((ev) => ev.text.includes("历史文献重构")));
    assert.ok(s.samples.every((x) => x.origin === "reconstructed"));
    assert.ok(s.measurements.every((x) => x.origin === "reconstructed"));
    assert.ok(s.tables.every((x) => x.origin === "reconstructed"));
    assert.equal(s.reports[0].revision, 3);
    const xml = docxText(buildReportDocx(s, s.reports[0]));
    assert.ok(xml.includes("历史文献重构数据")); // result 引用沿任务核心继承标注
    //  CSV 行数保全：漂浮表逐行保留（含单格/稀疏行不删）
    const floatTable = s.tables.find((t) => t.name.startsWith("darwin-flotation.csv"))!;
    const rawLines = s.assets.find((a) => a.id === floatTable.assetId)!.text.trim().split(/\r?\n/).length;
    assert.equal(floatTable.rows.length, rawLines - 1); // 表头 1 行，其余全保留
  } finally {
    rmSync(out, { force: true });
  }
});