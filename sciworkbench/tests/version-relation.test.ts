/**
 * 阶段⑤ 版本关系改造（T47-L2，单独验证）：方案更新后，固定旧版的执行仍被 changeHits 命中复核
 * （传播路径不被版本节点切断）；回查清楚显示执行实际依据「第N版（固定）」，与当前版区分。
 * 固定==当前时复用方案主节点（保持既有直接 lineage 边，向后兼容）；固定≠当前时建独立版本节点。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, type LocusState } from "../store.ts";
import { createTopic, createSubquestion, importMeasurements } from "../services/app.ts";
import { createProtocol, editProtocol, startExecution, confirmPreparation, createSample, addMeasurement } from "../services/experiment.ts";
import { createAnalysisTask, buildSnapshot, applyRecommendation, submitResult, archiveResultFile, createReport, applyReportEdit } from "../services/analysis.ts";
import { buildNetwork, traverseNetwork, changeHits } from "../services/references.ts";

const REC = { methods: [{ name: "米氏拟合", software: "Origin", rationale: "有数据", expectedArtifacts: ["曲线"], acceptanceItems: ["残差随机"] }], unknowns: [] };
const STEP = { id: "s1", op: "孵育", params: {}, note: "", durationMin: 30, estimated: false, branch: null, observeEnd: "" };

/** 方案 r1 → 执行（固定 r1）→ 样品 → 测量 → 表 → 任务 → 结果 → 报告块。 */
async function world(opts: { secondExec?: boolean; bump?: boolean } = {}) {
  let s = emptyState();
  const t = createTopic(s, { name: "版本课题", researchQuestion: "Q" }); s = t.state;
  const q = createSubquestion(s, { topicId: t.topic.id, question: "子问" }); s = q.state;
  const pr = createProtocol(s, { topicId: t.topic.id, name: "测活方案", purpose: "测活", criteria: "显色", steps: [STEP] }); s = pr.state;
  const protoId = pr.protocol.id;
  const e1 = startExecution(s, { topicId: t.topic.id, protocolId: protoId, protocolRevision: 1 }); s = e1.state;
  s = confirmPreparation(s, e1.execution.id).state;
  const execId = e1.execution.id;
  let exec2Id: string | undefined;
  if (opts.secondExec) { const e2 = startExecution(s, { topicId: t.topic.id, protocolId: protoId, protocolRevision: 1 }); s = e2.state; s = confirmPreparation(s, e2.execution.id).state; exec2Id = e2.execution.id; }
  const smp = createSample(s, { topicId: t.topic.id, executionId: execId, shortName: "S1", amount: { value: "5", unit: "mL" } }); s = smp.state;
  const m = addMeasurement(s, { topicId: t.topic.id, sampleId: smp.sample.id, sampleStateRevision: 1, value: "0.42", unit: "U/mL" }); s = m.state;
  s = importMeasurements(s, { name: "d.csv", csv: "t,v\n0,1\n1,2", topicId: t.topic.id }).state;
  const task = createAnalysisTask(s, { topicId: t.topic.id, subquestionId: q.subquestion.id, title: "分析", core: [{ kind: "measurement", id: m.measurement.id }] }); s = task.state;
  const taskId = s.analysisTasks[0].id;
  s = applyRecommendation(s, taskId, REC, "raw", buildSnapshot(s, s.analysisTasks[0], "目的", "m", "analysis_recommend/v1")).state;
  const csv = archiveResultFile(s, { name: "r.csv", content: "a,b\n1,2", topicId: t.topic.id }); s = csv.state;
  const rr = submitResult(s, taskId, { method: "米氏拟合", adoptedRecommendation: "米氏拟合", params: "x", assetIds: [csv.asset.id] }); s = rr.state;
  const rep = createReport(s, { topicId: t.topic.id, taskId }); s = rep.state;
  const reportId = s.reports[0].id;
  s = applyReportEdit(s, reportId, { baseRevision: 1, blocks: [{ nature: "observation", text: "观察", refs: [{ kind: "measurement", id: m.measurement.id, version: "rev 1", label: "测量" }] }], reason: "首稿" }).state;
  const blockId = s.reports[0].blocks[0].id;
  if (opts.bump) s = editProtocol(s, protoId, { criteria: "新判据（更新）", reason: "更新判据" }).state; // r1 → r2
  return { s, topicId: t.topic.id, protoId, execId, exec2Id, measId: m.measurement.id, taskId, resultId: rr.result.id, blockId };
}

test("版本-1 固定旧版→独立版本节点（第1版·固定），与当前版 r2 区分；无直接方案→执行边", async () => {
  const w = await world({ bump: true });
  assert.equal(w.s.protocols[0].revision, 2);
  assert.equal(w.s.executions[0].protocolRevision, 1);
  const net = buildNetwork(w.s);
  const vkey = `protocol:${w.protoId}@r1`;
  const vn = net.nodes.get(vkey)!;
  assert.ok(vn, "应建旧版版本节点");
  assert.ok(vn.label.includes("第1版（固定）"));
  assert.ok(net.edges.some((e) => e.from === `protocol:${w.protoId}` && e.to === vkey && e.edgeKind === "lineage"));
  assert.ok(net.edges.some((e) => e.from === vkey && e.to === `execution:${w.execId}` && e.edgeKind === "lineage"));
  // 当前版固定时才有直接边；此处固定旧版，不应有直接 方案→执行 边
  assert.ok(!net.edges.some((e) => e.from === `protocol:${w.protoId}` && e.to === `execution:${w.execId}`));
  assert.ok(net.nodes.get(`protocol:${w.protoId}`)!.version!.includes("第2版")); // 主节点为当前版
});

test("版本-2 硬约束：方案更新后 changeHits 仍命中固定旧版的执行（传播不被切断）", async () => {
  const w = await world({ bump: true });
  const hit = changeHits(w.s, { kind: "protocol", id: w.protoId, fields: ["steps"] });
  assert.equal(hit.category, "needs_review");
  assert.ok(hit.byKind.execution?.some((n) => n.id === w.execId), "旧版执行必须被命中复核");
  assert.ok(hit.hits.some((h) => h.node.id === w.execId));
});

test("版本-3 回查：从执行出发清楚显示实际依据「第1版（固定）」，并见当前版方案", async () => {
  const w = await world({ bump: true });
  const t = traverseNetwork(w.s, `execution:${w.execId}`, { direction: "both" });
  const vn = t.nodes.find((n) => n.key === `protocol:${w.protoId}@r1`);
  assert.ok(vn && vn.label.includes("第1版（固定）"));
  assert.ok(t.nodes.some((n) => n.key === `protocol:${w.protoId}`)); // 当前版方案也在网络中
  // 限定数据链上游仍能回到方案实体（经版本节点）
  const up = traverseNetwork(w.s, `execution:${w.execId}`, { direction: "up", edgeKinds: ["lineage"] });
  assert.ok(up.nodes.some((n) => n.key === `protocol:${w.protoId}`));
});

test("版本-4 固定==当前：复用方案主节点，保持直接 lineage 边（向后兼容）", async () => {
  const w = await world({ bump: false });
  const net = buildNetwork(w.s);
  assert.ok(!net.nodes.has(`protocol:${w.protoId}@r1`)); // 不建版本节点
  assert.ok(net.edges.some((e) => e.from === `protocol:${w.protoId}` && e.to === `execution:${w.execId}` && e.edgeKind === "lineage"));
});

test("版本-5 多个旧版执行共享同一版本节点；方案→版本边不重复", async () => {
  const w = await world({ secondExec: true, bump: true });
  const net = buildNetwork(w.s);
  const vkey = `protocol:${w.protoId}@r1`;
  assert.ok(net.nodes.has(vkey));
  const toExecs = net.edges.filter((e) => e.from === vkey && e.to.startsWith("execution:"));
  assert.equal(toExecs.length, 2);
  const protoToVer = net.edges.filter((e) => e.from === `protocol:${w.protoId}` && e.to === vkey);
  assert.equal(protoToVer.length, 1); // 去重
  const hit = changeHits(w.s, { kind: "protocol", id: w.protoId, fields: ["criteria"] });
  assert.ok(hit.byKind.execution?.some((n) => n.id === w.execId));
  assert.ok(hit.byKind.execution?.some((n) => n.id === w.exec2Id)); // 两个旧版执行都被命中
});

test("版本-6 混合固定：旧版执行经版本节点、当前版执行直连；changeHits 两者都命中", async () => {
  const w = await world({ bump: true });
  // 追加一个固定当前版 r2 的执行
  const e2 = startExecution(w.s, { topicId: w.topicId, protocolId: w.protoId, protocolRevision: 2 });
  const s = confirmPreparation(e2.state, e2.execution.id).state;
  const net = buildNetwork(s);
  assert.ok(net.nodes.has(`protocol:${w.protoId}@r1`)); // 旧版执行 → 版本节点
  assert.ok(net.edges.some((e) => e.from === `protocol:${w.protoId}` && e.to === `execution:${e2.execution.id}`)); // 当前版直连
  const hit = changeHits(s, { kind: "protocol", id: w.protoId, fields: ["steps"] });
  assert.ok(hit.byKind.execution?.some((n) => n.id === w.execId));
  assert.ok(hit.byKind.execution?.some((n) => n.id === e2.execution.id));
});

test("版本-7 全链传播：方案更新经版本节点命中执行→样品→测量→任务→结果→报告块", async () => {
  const w = await world({ bump: true });
  const hit = changeHits(w.s, { kind: "protocol", id: w.protoId, fields: ["criteria"] });
  for (const kind of ["execution", "sample", "measurement", "task", "result", "block"]) {
    assert.ok(hit.byKind[kind]?.length, `应命中 ${kind}`);
  }
  assert.ok(hit.byKind.block.some((n) => n.id === w.blockId));
});

test("版本-8 标题/备注类改动仍不误报（即便存在版本节点）", async () => {
  const w = await world({ bump: true });
  const cos = changeHits(w.s, { kind: "protocol", id: w.protoId, fields: ["name", "note"] });
  assert.equal(cos.category, "no_recompute");
  assert.equal(cos.hits.length, 0);
});

test("版本-9 修复③：固定不存在的第999版 → 缺失版本缺口节点＋执行 pending，不画看似正常的历史版本", async () => {
  const w = await world(); // 方案仅 r1
  // 模拟直接改数据：把执行固定的版本改成实际不存在的 999
  const s = { ...w.s, executions: w.s.executions.map((e) => e.id === w.execId ? { ...e, protocolRevision: 999 } : e) } as LocusState;
  const net = buildNetwork(s);
  const vn = net.nodes.get(`protocol:${w.protoId}@r999`)!;
  assert.ok(vn, "应建版本节点");
  assert.ok(vn.gap, "不存在的版本必须是缺口节点");
  assert.ok(vn.label.includes("缺失版本"));
  assert.ok(!vn.label.includes("（固定）")); // 不画看似正常的固定历史版本
  const en = net.nodes.get(`execution:${w.execId}`)!;
  assert.ok(en.pending!.some((p) => p.includes("第999版不存在")));
  const t = traverseNetwork(s, `execution:${w.execId}`, { direction: "both" });
  assert.ok(t.pending.some((p) => p.includes("999")));
});

test("版本-10 修复③：真实存在的固定旧版仍为正常版本节点（不误报缺失）", async () => {
  const w = await world({ bump: true }); // r1→r2，执行固定 r1（真实存在）
  const net = buildNetwork(w.s);
  const vn = net.nodes.get(`protocol:${w.protoId}@r1`)!;
  assert.ok(!vn.gap);
  assert.ok(vn.label.includes("第1版（固定）"));
  assert.ok(!net.nodes.get(`execution:${w.execId}`)!.pending?.some((p) => p.includes("不存在")));
});