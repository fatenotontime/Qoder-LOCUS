/**
 * 6A-2/6A-3 契约测试：真实引用网络（按关系类型建边与遍历）＋上游改动命中。
 * 覆盖：论文→附件→卡→方案→执行→样品→测量→分析→结果→报告块；外部结果无内部 Run 显式；
 * 改数值/判据→需复核；改标题/备注→不误报；撤回→需复核。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, type LocusState } from "../store.ts";
import { createTopic, createSubquestion, importMeasurements, importLiterature } from "../services/app.ts";
import { createProtocol, startExecution, confirmPreparation, createSample, addMeasurement } from "../services/experiment.ts";
import { createPaper, addPaperAttachment } from "../services/papers.ts";
import { createAnalysisTask, buildSnapshot, applyRecommendation, submitResult, archiveResultFile, createReport, applyReportEdit } from "../services/analysis.ts";
import { buildNetwork, traverseNetwork, changeHits, classifyChange, nodeForRef } from "../services/references.ts";

const REC = { methods: [{ name: "米氏拟合", software: "Origin", rationale: "有数据", expectedArtifacts: ["曲线"], acceptanceItems: ["残差随机"] }], unknowns: [] };

/** 完整链：论文＋附件→卡；方案→执行→样品→测量；表；任务→结果→报告块。 */
async function fullWorld() {
  let s = emptyState();
  const t = createTopic(s, { name: "滑润课题", researchQuestion: "pH 如何影响活性？" }); s = t.state;
  const q = createSubquestion(s, { topicId: t.topic.id, question: "最适 pH？" }); s = q.state;
  const p = createPaper(s, { title: "Laccase pH study", topicIds: [t.topic.id] }); s = p.state;
  const att = addPaperAttachment(s, { paperId: p.paper.id, name: "lit.md", text: "An acidic optimum near pH 4 was reported.", role: "fulltext", version: "v1" }); s = att.state;
  const lit = await importLiterature(s, { name: "lit.md", text: "段落：pH 4 时活性最高。", mode: "draft", topicId: t.topic.id }); s = lit.state;
  const cardId = s.cards[0].id;
  // 让卡带 paperId（按附件关联）——直接使用既有卡（迁移/导入会经附件关联论文）
  const pr = createProtocol(s, {
    topicId: t.topic.id, name: "测活方案", purpose: "测活", criteria: "显色终止",
    steps: [{ id: "s1", op: "孵育", params: {}, note: "", durationMin: 30, estimated: false, branch: null, observeEnd: "" }],
  }); s = pr.state;
  const e = startExecution(s, { topicId: t.topic.id, protocolId: pr.protocol.id }); s = e.state;
  s = confirmPreparation(s, e.execution.id).state;
  const smp = createSample(s, { topicId: t.topic.id, executionId: e.execution.id, shortName: "S1", amount: { value: "5", unit: "mL" } }); s = smp.state;
  const m = addMeasurement(s, { topicId: t.topic.id, sampleId: smp.sample.id, sampleStateRevision: 1, value: "0.42", unit: "U/mL" }); s = m.state;
  const tab = importMeasurements(s, { name: "d.csv", csv: "t,v\n0,1\n1,2", topicId: t.topic.id }); s = tab.state;
  const task = createAnalysisTask(s, { topicId: t.topic.id, subquestionId: q.subquestion.id, title: "pH 分析", core: [{ kind: "measurement", id: m.measurement.id }, { kind: "table", id: s.tables[0].id }], optional: [{ ref: { kind: "card", id: cardId }, included: true }] }).state;
  const tid = task.analysisTasks[0].id;
  s = applyRecommendation(task, tid, REC, "raw", buildSnapshot(task, task.analysisTasks[0], "目的", "m", "analysis_recommend/v1")).state;
  const csv = archiveResultFile(s, { name: "r.csv", content: "pH,Km\n3,0.5\n4,0.4", topicId: t.topic.id }); s = csv.state;
  const rr = submitResult(s, tid, { method: "米氏拟合", adoptedRecommendation: "米氏拟合", params: "初值 Km=0.5", assetIds: [csv.asset.id] }); s = rr.state;
  const rep = createReport(s, { topicId: t.topic.id, taskId: tid }); s = rep.state;
  const rid = rep.report.id;
  const blocks = [{ nature: "observation" as const, text: "pH4 时 Km 最低", refs: [{ kind: "result" as const, id: rr.result.id, version: `rev ${rr.result.revision}`, label: "米氏拟合" }, { kind: "measurement" as const, id: m.measurement.id, version: "rev 1", label: "测量 0.42" }] }];
  s = applyReportEdit(s, rid, { baseRevision: 1, blocks, reason: "首次" }).state;
  return {
    s, topicId: t.topic.id, paperId: p.paper.id, attId: att.attachment.id, cardId,
    protoId: pr.protocol.id, execId: e.execution.id, sampleId: smp.sample.id, measId: m.measurement.id,
    tableId: s.tables[0].id, taskId: tid, resultId: rr.result.id, reportId: rid, blockId: s.reports[0].blocks[0].id,
  };
}

test("6A-2 网络：链上各段按关系类型连通；回查（双向）能从报告块回到论文", async () => {
  const w = await fullWorld();
  const net = buildNetwork(w.s);
  const has = (from: string, to: string, ek: string) => net.edges.some((e) => e.from === from && e.to === to && e.edgeKind === ek);
  assert.ok(has(`paper:${w.paperId}`, `attachment:${w.attId}`, "affiliation"));
  assert.ok(has(`attachment:${w.attId}`, `asset:${w.s.attachments[0].assetId}`, "provenance"));
  assert.ok(has(`asset:${w.s.cards[0].assetId}`, `card:${w.cardId}`, "provenance"));
  assert.ok(has(`protocol:${w.protoId}`, `execution:${w.execId}`, "lineage"));
  assert.ok(has(`execution:${w.execId}`, `sample:${w.sampleId}`, "provenance"));
  assert.ok(has(`sample:${w.sampleId}`, `measurement:${w.measId}`, "lineage"));
  assert.ok(has(`measurement:${w.measId}`, `task:${w.taskId}`, "lineage"));
  assert.ok(has(`card:${w.cardId}`, `task:${w.taskId}`, "support"));
  assert.ok(has(`task:${w.taskId}`, `result:${w.resultId}`, "lineage"));
  assert.ok(has(`result:${w.resultId}`, `block:${w.blockId}`, "support"));
  assert.ok(has(`report:${w.reportId}`, `block:${w.blockId}`, "affiliation"));
  // 回查：从报告块双向能到论文（网络，非串联链）
  const t = traverseNetwork(w.s, `block:${w.blockId}`, { direction: "both" });
  const kinds = new Set(t.nodes.map((n) => n.kind));
  assert.ok(kinds.has("result") && kinds.has("task") && kinds.has("measurement") && kinds.has("sample") && kinds.has("execution") && kinds.has("protocol"));
  assert.ok(kinds.has("report") && kinds.has("card") && kinds.has("asset") && kinds.has("attachment") && kinds.has("paper"));
  // 结果显式标 external（无内部 Run）
  const rn = t.nodes.find((n) => n.kind === "result")!;
  assert.equal(rn.external, true);
  assert.ok(rn.pending!.some((p) => p.includes("无内部 Run")));
});

test("6A-2 按关系类型限定遍历：数据链与科学依据链分开", async () => {
  const w = await fullWorld();
  // 科学依据链：卡 →（support）任务 →（support）报告块；卡没有数据链下游
  const cardLineage = traverseNetwork(w.s, `card:${w.cardId}`, { direction: "down", edgeKinds: ["lineage"] });
  assert.equal(cardLineage.nodes.length, 1); // 只有自身
  const cardSupport = traverseNetwork(w.s, `card:${w.cardId}`, { direction: "down", edgeKinds: ["support"] });
  assert.ok(cardSupport.nodes.some((n) => n.kind === "task"));
  assert.ok(!cardSupport.nodes.some((n) => n.kind === "block")); // 块在任务→结果(数据链)之后，support 过滤不跨类
  // 不限类型：卡经 任务→结果→块 可达报告块
  const cardAll = traverseNetwork(w.s, `card:${w.cardId}`, { direction: "down" });
  assert.ok(cardAll.nodes.some((n) => n.kind === "block"));
  // 数据链：测量 →（lineage）任务；报告块也直接引用了该测量（lineage），故在数据链下游
  const measLineage = traverseNetwork(w.s, `measurement:${w.measId}`, { direction: "down", edgeKinds: ["lineage"] });
  assert.ok(measLineage.nodes.some((n) => n.kind === "task"));
  assert.ok(measLineage.nodes.some((n) => n.kind === "block"));
  // 若只看溯源链，测量不带出任何下游
  const measProv = traverseNetwork(w.s, `measurement:${w.measId}`, { direction: "down", edgeKinds: ["provenance"] });
  assert.equal(measProv.nodes.length, 1);
  // 不存在节点：开始为 undefined
  assert.equal(traverseNetwork(w.s, "measurement:ghost").start, undefined);
  // nodeForRef 不补造
  assert.equal(nodeForRef(w.s, { kind: "measurement", id: "ghost" }), undefined);
});

test("6A-3 改动命中：改数值/判据→需复核且命中报告块；改标题/备注→不误报", async () => {
  const w = await fullWorld();
  // 改测量数值 → needs_review，命中任务/结果/报告块
  const hit = changeHits(w.s, { kind: "measurement", id: w.measId, fields: ["value"] });
  assert.equal(hit.category, "needs_review");
  assert.ok(hit.byKind.task?.length);
  assert.ok(hit.byKind.result?.length);
  assert.ok(hit.byKind.block?.length);
  assert.ok(hit.hits.some((h) => h.reason.includes("数据链")));
  // 改方案判据 → needs_review，命中执行链
  assert.equal(changeHits(w.s, { kind: "protocol", id: w.protoId, fields: ["criteria"] }).category, "needs_review");
  // 改标题/备注 → no_recompute，零命中
  const cosmeticTitle = changeHits(w.s, { kind: "protocol", id: w.protoId, fields: ["title", "note"] });
  assert.equal(cosmeticTitle.category, "no_recompute");
  assert.equal(cosmeticTitle.hits.length, 0);
  // 撤回 → needs_review
  assert.equal(changeHits(w.s, { kind: "card", id: w.cardId, withdrawn: true }).category, "needs_review");
  // classifyChange 直接判定
  assert.equal(classifyChange("measurement", ["value", "unit"]), "needs_review");
  assert.equal(classifyChange("sample", ["displayName", "note"]), "no_recompute");
  // 改动卡 → 命中引用它的任务与报告块（support 链）
  const cardHit = changeHits(w.s, { kind: "card", id: w.cardId, fields: ["interpretation"] });
  assert.ok(cardHit.byKind.task?.some((n) => n.id === w.taskId));
  // 改动结果参数 → 命中引用它的报告块（供结果修订后就地提示复核）
  const resHit = changeHits(w.s, { kind: "result", id: w.resultId, fields: ["params"] });
  assert.equal(resHit.category, "needs_review");
  assert.ok(resHit.byKind.block?.some((n) => n.id === w.blockId));
});
