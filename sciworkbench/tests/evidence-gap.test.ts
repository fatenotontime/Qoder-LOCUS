/**
 * 阶段④ 缺失证据缺口（T47-L1 反例回归）：被引用却找不到的对象——各类原件、方案、数据表、
 * 测量、任务核心/候选、对话范围、块引用、measurement.cellRef——一律明示缺口（缺件节点＋依赖方
 * pending＋地图 gaps），不静默跳过、不补造成看似正常的实体。note/snapshot 非证据对象，不标缺。
 * 写侧 cleanRefs 保持宽容（报告引用为历史钉住指针，目标可事后消失；编辑不应因此被锁），缺口在读侧明示。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, type LocusState } from "../store.ts";
import { createTopic, createSubquestion, importMeasurements, importLiterature, reviewCard } from "../services/app.ts";
import { createProtocol, startExecution, confirmPreparation, createSample, addMeasurement } from "../services/experiment.ts";
import { createPaper, addPaperAttachment } from "../services/papers.ts";
import {
  createAnalysisTask, buildSnapshot, applyRecommendation, submitResult, archiveResultFile,
  createReport, applyReportEdit, createChat,
} from "../services/analysis.ts";
import { buildNetwork, traverseNetwork } from "../services/references.ts";
import { buildContextMap } from "../services/context-map.ts";
import { refLabel, missingTag } from "../public/lib/refs.js";

const REC = { methods: [{ name: "米氏拟合", software: "Origin", rationale: "有数据", expectedArtifacts: ["曲线"], acceptanceItems: ["残差随机"] }], unknowns: [] };

/** 完整真实链；各用例再按需把某对象改成 ghost / 删除，模拟「被引用却找不到」。 */
async function world() {
  let s = emptyState();
  const t = createTopic(s, { name: "缺口课题", researchQuestion: "Q" }); s = t.state;
  const q = createSubquestion(s, { topicId: t.topic.id, question: "子问" }); s = q.state;
  const p = createPaper(s, { title: "论文", topicIds: [t.topic.id] }); s = p.state;
  const att = addPaperAttachment(s, { paperId: p.paper.id, name: "lit.md", text: "段落原文", role: "fulltext" }); s = att.state;
  const lit = await importLiterature(s, { name: "lit.md", text: "段落：pH 4 时活性最高。", mode: "draft", topicId: t.topic.id }); s = lit.state;
  for (const c of s.cards) s = reviewCard(s, c.id, { audit: "confirm" });
  const cardId = s.cards[0].id;
  const pr = createProtocol(s, { topicId: t.topic.id, name: "方案", purpose: "测活", criteria: "显色", steps: [{ id: "s1", op: "孵育", params: {}, note: "", durationMin: 30, estimated: false, branch: null, observeEnd: "" }] }); s = pr.state;
  const e = startExecution(s, { topicId: t.topic.id, protocolId: pr.protocol.id }); s = e.state;
  s = confirmPreparation(s, e.execution.id).state;
  const smp = createSample(s, { topicId: t.topic.id, executionId: e.execution.id, shortName: "S1", amount: { value: "5", unit: "mL" } }); s = smp.state;
  const m = addMeasurement(s, { topicId: t.topic.id, sampleId: smp.sample.id, sampleStateRevision: 1, value: "0.42", unit: "U/mL" }); s = m.state;
  const tab = importMeasurements(s, { name: "d.csv", csv: "t,v\n0,1\n1,2", topicId: t.topic.id }); s = tab.state;
  const tableId = s.tables[0].id;
  const task = createAnalysisTask(s, { topicId: t.topic.id, subquestionId: q.subquestion.id, title: "分析", core: [{ kind: "measurement", id: m.measurement.id }, { kind: "table", id: tableId }], optional: [{ ref: { kind: "card", id: cardId }, included: true }] }); s = task.state;
  const taskId = s.analysisTasks[0].id;
  s = applyRecommendation(s, taskId, REC, "raw", buildSnapshot(s, s.analysisTasks[0], "目的", "m", "analysis_recommend/v1")).state;
  const csv = archiveResultFile(s, { name: "r.csv", content: "a,b\n1,2", topicId: t.topic.id }); s = csv.state;
  const rr = submitResult(s, taskId, { method: "米氏拟合", adoptedRecommendation: "米氏拟合", params: "x", assetIds: [csv.asset.id] }); s = rr.state;
  const rep = createReport(s, { topicId: t.topic.id, taskId }); s = rep.state;
  const reportId = s.reports[0].id;
  s = applyReportEdit(s, reportId, { baseRevision: 1, blocks: [{ nature: "observation", text: "观察", refs: [{ kind: "result", id: rr.result.id, version: "rev 1", label: "结果" }] }], reason: "首稿" }).state;
  const blockId = s.reports[0].blocks[0].id;
  const ch = createChat(s, { topicId: t.topic.id, scope: [{ kind: "execution", id: e.execution.id }] }); s = ch.state;
  return { s, topicId: t.topic.id, cardId, protoId: pr.protocol.id, execId: e.execution.id, measId: m.measurement.id, tableId, taskId, resultId: rr.result.id, reportId, blockId, chatId: s.chats[0].id, assetId: s.tables[0].assetId };
}

test("缺口-1 原件缺失（L1①）：表 assetId 指向 ghost → 缺件节点＋表 pending＋地图 gaps，不造正常原件", async () => {
  const w = await world();
  const s = { ...w.s, tables: w.s.tables.map((t) => ({ ...t, assetId: "ghost" })) } as LocusState;
  const net = buildNetwork(s);
  const an = net.nodes.get("asset:ghost")!;
  assert.ok(an.gap && an.label.includes("缺失原件"));
  assert.ok(net.edges.some((e) => e.from === "asset:ghost" && e.to === `table:${w.tableId}` && e.edgeKind === "provenance"));
  const tn = net.nodes.get(`table:${w.tableId}`)!;
  assert.ok(tn.pending!.some((p) => p.includes("原件缺失") && p.includes("ghost")));
  // 地图：缺口不再为空（T47 反例 gaps:[] 已修）
  const map = buildContextMap(s, { topicId: w.topicId, taskId: w.taskId });
  assert.ok(map.gaps.some((g) => g.key === "asset:ghost" && g.code === "missing"));
  assert.ok(map.gaps.some((g) => g.key === `table:${w.tableId}` && g.label.includes("原件缺失")));
});

test("缺口-2 悬空块引用（L1②）：块引用不存在的数据表 → 缺件节点＋块 pending；回查可见缺口（不 continue 吞掉）", async () => {
  const w = await world();
  // 写侧宽容接受（历史钉住指针）；读侧明示缺口
  const s = applyReportEdit(w.s, w.reportId, { baseRevision: 2, blocks: [
    { id: w.blockId, nature: "observation", text: "观察", refs: [{ kind: "result", id: w.resultId, version: "rev 1", label: "结果" }] },
    { nature: "interpretation", text: "引用缺失表", refs: [{ kind: "table", id: "missing", version: "rev 999", label: "缺失表" }] },
  ], reason: "加悬空引用" }).state;
  const net = buildNetwork(s);
  const gn = net.nodes.get("table:missing")!;
  assert.ok(gn.gap && gn.label.includes("缺失数据表"));
  const newBlock = s.reports[0].blocks[1];
  const bn = net.nodes.get(`block:${newBlock.id}`)!;
  assert.ok(bn.pending!.some((p) => p.includes("数据表缺失") && p.includes("missing")));
  // 回查从块出发：pending 含缺口（旧实现 pending 为空）
  const t = traverseNetwork(s, `block:${newBlock.id}`, { direction: "both" });
  assert.ok(t.pending.some((p) => p.includes("不存在") && p.includes("missing")));
  // 回查直接指向缺件节点：不再 404（start 存在），明示缺口
  const tg = traverseNetwork(s, "table:missing", { direction: "both" });
  assert.ok(tg.start && tg.start.gap);
});

test("缺口-3 任务核心/候选指向已消失对象：缺件节点＋任务 pending（兜底旧任务遗留）", async () => {
  const w = await world();
  // 模拟候选卡事后被删除：任务 optional 仍钉住它
  const s = { ...w.s, cards: w.s.cards.filter((c) => c.id !== w.cardId) } as LocusState;
  const net = buildNetwork(s);
  const gn = net.nodes.get(`card:${w.cardId}`)!;
  assert.ok(gn.gap && gn.label.includes("缺失知识卡"));
  const kn = net.nodes.get(`task:${w.taskId}`)!;
  assert.ok(kn.pending!.some((p) => p.includes("知识卡缺失")));
});

test("缺口-4 对话范围指向不存在对象：缺件节点＋对话 pending", async () => {
  const w = await world();
  const s = { ...w.s, chats: w.s.chats.map((c) => ({ ...c, scope: [{ kind: "execution", id: "ghost_exec" }] })) } as LocusState;
  const net = buildNetwork(s);
  assert.ok(net.nodes.get("execution:ghost_exec")!.gap);
  assert.ok(net.nodes.get(`chat:${w.chatId}`)!.pending!.some((p) => p.includes("执行缺失") && p.includes("ghost_exec")));
});

test("缺口-5 measurement.cellRef 指向不存在数据表：缺件节点＋测量 pending（不内联造正常表节点）", async () => {
  const w = await world();
  const s = { ...w.s, measurements: w.s.measurements.map((m) => ({ ...m, cellRef: { tableId: "ghost_tbl", row: 0, col: 0 } })) } as LocusState;
  const net = buildNetwork(s);
  const gn = net.nodes.get("table:ghost_tbl")!;
  assert.ok(gn.gap && gn.label.includes("缺失数据表"));
  assert.ok(net.nodes.get(`measurement:${w.measId}`)!.pending!.some((p) => p.includes("数据表缺失") && p.includes("ghost_tbl")));
});

test("缺口-6 方案来源原件 / 结果附件缺失：各自缺件节点＋依赖方 pending", async () => {
  const w = await world();
  const s = {
    ...w.s,
    protocols: w.s.protocols.map((p) => ({ ...p, sourceAssetId: "ghost_src" })),
    analysisResults: w.s.analysisResults.map((r) => ({ ...r, assetIds: ["ghost_res"] })),
  } as LocusState;
  const net = buildNetwork(s);
  assert.ok(net.nodes.get("asset:ghost_src")!.gap);
  assert.ok(net.nodes.get(`protocol:${w.protoId}`)!.pending!.some((p) => p.includes("原件缺失") && p.includes("ghost_src")));
  assert.ok(net.nodes.get("asset:ghost_res")!.gap);
  assert.ok(net.nodes.get(`result:${w.resultId}`)!.pending!.some((p) => p.includes("原件缺失") && p.includes("ghost_res")));
});

test("缺口-7 note/snapshot 非证据对象：不产生缺件节点", async () => {
  const w = await world();
  const s = applyReportEdit(w.s, w.reportId, { baseRevision: 2, blocks: [
    { id: w.blockId, nature: "observation", text: "观察", refs: [{ kind: "note", label: "备注" }, { kind: "snapshot", id: "hash123", version: "hash123", label: "快照" }] },
  ], reason: "注记与快照" }).state;
  const net = buildNetwork(s);
  assert.ok(!net.nodes.has("snapshot:hash123"));
  assert.ok(![...net.nodes.values()].some((n) => n.kind === ("note" as never)));
  assert.ok(!net.nodes.get(`block:${w.blockId}`)!.pending?.some((p) => p.includes("缺失")));
});

test("缺口-8 真实对象不误报缺件；前端 refLabel/missingTag 与后端一致", async () => {
  const w = await world();
  const net = buildNetwork(w.s);
  assert.ok(![...net.nodes.values()].some((n) => n.gap)); // 全真实链无缺件
  assert.equal(missingTag(w.s, "table", w.tableId), "");
  assert.equal(missingTag(w.s, "table", "ghost"), "（缺失）");
  assert.ok(refLabel(w.s, { kind: "table", id: "ghost" }).includes("（缺失）"));
  assert.ok(!refLabel(w.s, { kind: "table", id: w.tableId }).includes("（缺失）"));
});

test("缺口-9 只读：建网络/地图不改 state", async () => {
  const w = await world();
  const s = { ...w.s, tables: w.s.tables.map((t) => ({ ...t, assetId: "ghost" })) } as LocusState;
  const before = JSON.stringify(s);
  buildNetwork(s);
  buildContextMap(s, { topicId: w.topicId, taskId: w.taskId });
  traverseNetwork(s, `table:${w.tableId}`, { direction: "both" });
  assert.equal(JSON.stringify(s), before);
});