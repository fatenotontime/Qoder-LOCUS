/**
 * 5E 契约测试：上下文地图（核心＋可取消候选）/ 冻结快照 / 方法推荐（预期产物≠结论）/
 * 结果提交（不采纳须理由；只有图/缺参数不可复现）/ 报告四类分列留历史 /
 * 对话范围限定、取消/重试边界、采纳须目标＋预览＋人工确认。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createTopic, createSubquestion, importLiterature, importMeasurements } from "../services/app.ts";
import { createProtocol, startExecution, confirmPreparation, createSample, addMeasurement } from "../services/experiment.ts";
import {
  createAnalysisTask, setTaskCandidates, buildSnapshot, snapshotInput, applyRecommendation,
  submitResult, editResult, archiveResultFile, createReport,
  previewReportEdit, applyReportEdit, confirmReportBlock, draftReportBlocks,
  createChat, chatScopeSnapshot, appendChatTurn, applyChatResponse, cancelChat, retryChat, adoptProposal, recoverInterruptedChats,
} from "../services/analysis.ts";
import { emptyState, MemoryStore, type LocusState } from "../store.ts";
import { clearAiConfig } from "../services/ai.ts";

async function world() {
  let s = emptyState();
  const t = createTopic(s, { name: "分析课题", researchQuestion: "pH 如何影响活性？" }); s = t.state;
  const q = createSubquestion(s, { topicId: t.topic.id, question: "最适 pH？" }); s = q.state;
  const p = createProtocol(s, {
    topicId: t.topic.id, name: "测活方案", purpose: "测活", criteria: "显色",
    steps: [{ id: "s1", op: "孵育", params: {}, note: "", durationMin: 30, estimated: false, branch: null, observeEnd: "" }],
  }); s = p.state;
  const e = startExecution(s, { topicId: t.topic.id, protocolId: p.protocol.id }); s = e.state;
  s = confirmPreparation(s, e.execution.id).state;
  const smp = createSample(s, { topicId: t.topic.id, executionId: e.execution.id, shortName: "S1", amount: { value: "5", unit: "mL" } }); s = smp.state;
  const m = addMeasurement(s, { topicId: t.topic.id, sampleId: smp.sample.id, sampleStateRevision: 1, value: "0.42", unit: "U/mL" }); s = m.state;
  const tab = importMeasurements(s, { name: "d.csv", csv: "t,v\n0,1\n1,2", topicId: t.topic.id }); s = tab.state;
  const lit = await importLiterature(s, { name: "lit.md", text: "段落一\n\n段落二", mode: "draft", topicId: t.topic.id }); s = lit.state;
  return {
    s, topicId: t.topic.id, subqId: q.subquestion.id, execId: e.execution.id,
    protoId: p.protocol.id, measId: m.measurement.id, tableId: s.tables[0].id, cardId: s.cards[0].id,
  };
}

const REC = { methods: [{ name: "米氏拟合", software: "Origin", rationale: "有 pH-活性数据", expectedArtifacts: ["Km-pH 曲线"], acceptanceItems: ["残差随机分布", "报告置信区间"] }], unknowns: ["温度未记录"] };

test("5E-1 任务核心须来自执行/测量；幽灵引用拒绝；候选去重核心", async () => {
  const w = await world();
  assert.throws(() => createAnalysisTask(w.s, { topicId: w.topicId, title: "x", core: [{ kind: "card", id: w.cardId }] }), /核心须来自执行或测量/);
  assert.throws(() => createAnalysisTask(w.s, { topicId: w.topicId, title: "x", core: [] }), /至少挂一个/);
  assert.throws(() => createAnalysisTask(w.s, { topicId: w.topicId, title: "x", core: [{ kind: "execution", id: "ghost" }] }), /不存在/);
  assert.throws(() => createAnalysisTask(w.s, { topicId: w.topicId, title: "", core: [{ kind: "execution", id: w.execId }] }), /标题/);
  const r = createAnalysisTask(w.s, {
    topicId: w.topicId, subquestionId: w.subqId, title: "pH-活性分析",
    core: [{ kind: "execution", id: w.execId }, { kind: "table", id: w.tableId }],
    optional: [{ kind: "card", id: w.cardId }, { kind: "execution", id: w.execId }],
  });
  assert.equal(r.task.optional.length, 1); // 与核心重复的候选被去掉
  assert.equal(r.task.optional[0].included, true);
});

test("5E-2 候选可取消；快照只含核心＋已选候选＋子问题；版本固定、hash 稳定", async () => {
  const w = await world();
  let s = createAnalysisTask(w.s, {
    topicId: w.topicId, subquestionId: w.subqId, title: "t",
    core: [{ kind: "execution", id: w.execId }], optional: [{ kind: "card", id: w.cardId }],
  }).state;
  const tid = s.analysisTasks[0].id;
  const snap1 = buildSnapshot(s, s.analysisTasks[0], "求最适 pH", "m", "analysis_recommend/v1");
  assert.equal(snap1.fragments.length, 3); // 子问题＋执行＋卡
  assert.ok(snap1.fragments.some((f) => f.ref.kind === "execution" && f.version.startsWith("r1")));
  assert.ok(snapshotInput(snap1).includes(`execution:${w.execId}`)); // 对象 ID 入上下文（提案目标可回查）
  s = setTaskCandidates(s, tid, [{ ref: { kind: "card", id: w.cardId }, included: false }]).state;
  const snap2 = buildSnapshot(s, s.analysisTasks[0], "求最适 pH", "m", "analysis_recommend/v1");
  assert.equal(snap2.fragments.length, 2); // 候选取消后不入快照
  assert.notEqual(snap1.hash, snap2.hash);
  const snap2b = buildSnapshot(s, s.analysisTasks[0], "求最适 pH", "m", "analysis_recommend/v1");
  assert.equal(snap2.hash, snap2b.hash); // 同内容 hash 稳定
  assert.throws(() => setTaskCandidates(s, tid, [{ ref: { kind: "execution", id: w.execId }, included: true }]), /核心对象不能/);
});

test("5E-3 推荐写回冻结快照；结果不采纳须理由；只有图/缺参数不可复现", async () => {
  const w = await world();
  let s = createAnalysisTask(w.s, { topicId: w.topicId, title: "t", core: [{ kind: "measurement", id: w.measId }] }).state;
  const tid = s.analysisTasks[0].id;
  const snap = buildSnapshot(s, s.analysisTasks[0], "pH 影响", "m", "analysis_recommend/v1");
  assert.throws(() => applyRecommendation(s, tid, { nope: 1 }, "raw", snap), /methods/);
  s = applyRecommendation(s, tid, REC, "raw-response", snap).state;
  assert.equal(s.analysisTasks[0].snapshot!.hash, snap.hash);
  assert.equal(s.analysisTasks[0].recommendation!.methods[0].acceptanceItems.length, 2);
  // 未采纳且无理由 → 拒绝
  assert.throws(() => submitResult(s, tid, { method: "MATLAB 自写拟合", assetIds: [] }), /理由/);
  assert.throws(() => submitResult(s, tid, { method: "", assetIds: [] }), /方法不能为空/);
  assert.throws(() => submitResult(s, tid, { method: "x", adoptedRecommendation: "不存在的方法" }), /推荐方法不存在/);
  // 只有图：可存，但不可复现
  const img = archiveResultFile(s, { name: "fit.png", content: "data:image/png;base64,aHR0cA==", topicId: w.topicId }); s = img.state;
  const r1 = submitResult(s, tid, { method: "MATLAB 自写拟合", reason: "组内惯用 MATLAB", assetIds: [img.asset.id] }); s = r1.state;
  assert.equal(r1.result.reproducible, false);
  assert.ok(r1.result.missing.some((m) => m.includes("数据文件")));
  assert.ok(r1.result.missing.some((m) => m.includes("参数")));
  // 数据＋参数 → 可复现
  const csv = archiveResultFile(s, { name: "fit.csv", content: "pH,Km\n3,0.5\n4,0.4", topicId: w.topicId }); s = csv.state;
  const r2 = submitResult(s, tid, { method: "米氏拟合", adoptedRecommendation: "米氏拟合", params: "初值 Km=0.5, 加权最小二乘", assetIds: [csv.asset.id, img.asset.id] }); s = r2.state;
  assert.equal(r2.result.reproducible, true);
  assert.equal(r2.result.reason, "");
  // 修订留历史；改空参数 → 复现性重算
  assert.throws(() => editResult(s, r2.result.id, { params: "", reason: "" }), /原因/);
  const ed = editResult(s, r2.result.id, { params: "", reason: "参数记录遗失" });
  assert.equal(ed.result.revision, 2);
  assert.equal(ed.result.history.length, 1);
  assert.equal(ed.result.reproducible, false);
  assert.equal(s.analysisTasks[0].resultIds.length, 2);
});

test("5E-4 报告：固定任务/结果/快照版本；四类分列；修订留历史", async () => {
  const w = await world();
  let s = createAnalysisTask(w.s, { topicId: w.topicId, title: "t", core: [{ kind: "execution", id: w.execId }] }).state;
  const tid = s.analysisTasks[0].id;
  const snap = buildSnapshot(s, s.analysisTasks[0], "p", "m", "analysis_recommend/v1");
  s = applyRecommendation(s, tid, REC, "raw", snap).state;
  const csv = archiveResultFile(s, { name: "r.csv", content: "a,b\n1,2", topicId: w.topicId }); s = csv.state;
  const rr = submitResult(s, tid, { method: "米氏拟合", adoptedRecommendation: "米氏拟合", params: "x", assetIds: [csv.asset.id] }); s = rr.state;
  const rep = createReport(s, { topicId: w.topicId, taskId: tid }); s = rep.state;
  assert.equal(rep.report.pinned.snapshotHash, snap.hash);
  assert.deepEqual(rep.report.pinned.resultIds, [rr.result.id]);
  // 块级 diff：非法块拒绝；无改动拒绝；预审不改状态
  assert.throws(() => previewReportEdit(s, rep.report.id, { blocks: [{ nature: "observation", text: "" }] }), /不能为空/);
  assert.throws(() => previewReportEdit(s, rep.report.id, { blocks: [{ nature: "bogus", text: "x" }] }), /性质不合法/);
  assert.throws(() => previewReportEdit(s, rep.report.id, { blocks: [] }), /至少需要一个块/);
  assert.throws(() => applyReportEdit(s, rep.report.id, { baseRevision: 1, blocks: [], reason: "r" }), /至少需要一个块/);
  const proposed = [
    { nature: "observation" as const, text: "pH4 时 Km 最低", refs: [{ kind: "result" as const, id: rr.result.id, version: "rev 1", label: "米氏拟合结果" }] },
    { nature: "hypothesis" as const, text: "质子化影响结合" },
    { nature: "interpretation" as const, text: "与文献一致", refs: [{ kind: "card", id: "card_x", version: "核对 已核对", label: "知识卡" }] },
    { nature: "to_verify" as const, text: "补 pH5 点" },
  ];
  const pv = previewReportEdit(s, rep.report.id, { blocks: proposed });
  assert.equal(pv.baseRevision, 1);
  assert.equal(pv.diff.added.length, 4);
  assert.equal(pv.diff.same, false);
  assert.equal(s.reports[0].blocks.length, 0); // 预览不改状态
  // 乐观并发：baseRevision 不符 → 409 可恢复，不覆盖
  assert.throws(() => applyReportEdit(s, rep.report.id, { baseRevision: 9, blocks: proposed, reason: "首次填写" }), /已被他处修改/);
  const ap = applyReportEdit(s, rep.report.id, { baseRevision: 1, blocks: proposed, reason: "首次填写" });
  s = ap.state;
  assert.equal(ap.diff.added.length, 4);
  assert.equal(ap.report.revision, 2);
  assert.equal(ap.report.history.length, 1);
  assert.equal(ap.report.blocks.length, 4);
  assert.deepEqual(ap.report.blocks.map((b) => b.order), [0, 1, 2, 3]);
  assert.equal(ap.report.blocks[0].nature, "observation");
  assert.equal(ap.report.blocks[0].refs[0].version, "rev 1"); // 固定版本
  assert.equal(ap.report.history[0].blocks.length, 0); // 旧版保留
  // 改一块 + 调顺序 → 只改该块记块内历史；另一块顺序变化被识别
  const b0 = ap.report.blocks[0].id, b1 = ap.report.blocks[1].id;
  const pv2 = previewReportEdit(s, rep.report.id, { blocks: [
    { id: b1, nature: "hypothesis", text: "质子化影响结合" },
    { id: b0, nature: "observation", text: "pH4 时 Km 最低（复核：n=3）", refs: [{ kind: "result", id: rr.result.id, version: "rev 1", label: "米氏拟合结果" }] },
    { id: ap.report.blocks[2].id, nature: "interpretation", text: "与文献一致", refs: [{ kind: "card", id: "card_x", version: "核对 已核对", label: "知识卡" }] },
    { id: ap.report.blocks[3].id, nature: "to_verify", text: "补 pH5 点" },
  ] });
  assert.equal(pv2.diff.changed.length, 1);
  assert.deepEqual(pv2.diff.changed[0].fields, ["text"]);
  assert.equal(pv2.diff.reordered.length, 2);
  const ap2 = applyReportEdit(s, rep.report.id, { baseRevision: 2, blocks: [
    { id: b1, nature: "hypothesis", text: "质子化影响结合" },
    { id: b0, nature: "observation", text: "pH4 时 Km 最低（复核：n=3）", refs: [{ kind: "result", id: rr.result.id, version: "rev 1", label: "米氏拟合结果" }] },
    { id: ap.report.blocks[2].id, nature: "interpretation", text: "与文献一致", refs: [{ kind: "card", id: "card_x", version: "核对 已核对", label: "知识卡" }] },
    { id: ap.report.blocks[3].id, nature: "to_verify", text: "补 pH5 点" },
  ], reason: "复核改数" });
  s = ap2.state;
  const nb0 = ap2.report.blocks.find((b) => b.id === b0)!;
  assert.equal(nb0.history.length, 1); // 仅改动块记块内历史
  assert.equal(nb0.history[0].reason, "复核改数");
  assert.equal(nb0.history[0].text, "pH4 时 Km 最低");
  assert.equal(ap2.report.blocks.find((b) => b.id === b1)!.history.length, 0);
  assert.equal(ap2.report.blocks.find((b) => b.id === b1)!.order, 0); // 顺序已生效
  // 无改动的接受 → 拒绝
  assert.throws(() => applyReportEdit(s, rep.report.id, { baseRevision: 3, blocks: s.reports[0].blocks, reason: "空" }), /未检测到块改动/);
});

test("6A-1 AI 草稿块：标 draft 待人工确认；确认后 draft=false 且留历史", async () => {
  const w = await world();
  let s = createAnalysisTask(w.s, { topicId: w.topicId, title: "t", core: [{ kind: "execution", id: w.execId }] }).state;
  const tid = s.analysisTasks[0].id;
  const snap = buildSnapshot(s, s.analysisTasks[0], "p", "m", "analysis_recommend/v1");
  s = applyRecommendation(s, tid, REC, "raw", snap).state;
  const csv = archiveResultFile(s, { name: "r.csv", content: "a,b\n1,2", topicId: w.topicId }); s = csv.state;
  const rr = submitResult(s, tid, { method: "米氏拟合", adoptedRecommendation: "米氏拟合", params: "x", assetIds: [csv.asset.id] }); s = rr.state;
  s = createReport(s, { topicId: w.topicId, taskId: tid }).state;
  const rid = s.reports[0].id;
  const draft = draftReportBlocks(s, rid);
  assert.ok(draft.blocks.length >= 1);
  assert.equal(draft.blocks.every((b) => b.draft), true);
  assert.equal(s.reports[0].blocks.length, 0); // 生成草稿不改状态
  const ap = applyReportEdit(s, rid, { baseRevision: 1, blocks: draft.blocks, reason: "AI 草稿入稿" }); s = ap.state;
  const draftBlock = s.reports[0].blocks[0];
  assert.equal(draftBlock.draft, true);
  assert.throws(() => confirmReportBlock(s, rid, "ghost", ""), /不存在/);
  const cf = confirmReportBlock(s, rid, draftBlock.id, "已核对原图");
  s = cf.state;
  assert.equal(cf.report.blocks[0].draft, false);
  assert.equal(cf.report.blocks[0].history.length, 1);
  assert.equal(cf.report.revision, 3);
  assert.throws(() => confirmReportBlock(s, rid, draftBlock.id, ""), /非 AI 草稿/);
});

test("5E-5 对话：运行中拒发；提案越界丢弃；取消/重试边界；采纳须确认且不重复", async () => {
  const w = await world();
  let s = createChat(w.s, { topicId: w.topicId, subquestionId: w.subqId, scope: [{ kind: "execution", id: w.execId }] }).state;
  const cid = s.chats[0].id;
  const turn = appendChatTurn(s, cid, "这个执行说明了什么？"); s = turn.state;
  const mid = turn.messageId;
  assert.throws(() => appendChatTurn(s, cid, "再问"), /已有消息在运行/);
  assert.throws(() => cancelChat(s, cid, "ghost"), /不存在/);
  // 提案：合法执行备注保留；幽灵目标/越界类型/空预览丢弃
  const snap = chatScopeSnapshot(s, s.chats[0], "p", "m");
  s = applyChatResponse(s, cid, mid, {
    answer: "孵育 30min 后读数。",
    sources: ["执行 · 测活方案"],
    proposals: [
      { targetKind: "execution-note", targetId: w.execId, preview: "建议补记室温" },
      { targetKind: "execution-note", targetId: "ghost", preview: "x" },
      { targetKind: "delete-everything", targetId: w.execId, preview: "x" },
      { targetKind: "execution-note", targetId: w.execId, preview: "" },
    ],
  }, snap);
  const msg = s.chats[0].messages.find((m) => m.id === mid)!;
  assert.equal(msg.status, "done");
  assert.equal(msg.proposals.length, 1);
  assert.equal(msg.snapshot!.fragments.length, 2);
  // 讨论不改对象：事件数不变
  assert.equal(s.executions[0].events.length, 0);
  // 采纳须确认
  assert.throws(() => adoptProposal(s, cid, mid, 0, false), /人工确认/);
  const ad = adoptProposal(s, cid, mid, 0, true); s = ad.state;
  assert.equal(s.executions[0].events.length, 1);
  assert.match(s.executions[0].events[0].text, /上下文对话采纳/);
  assert.throws(() => adoptProposal(s, cid, mid, 0, true), /已采纳/);
  // 取消只针对 running；重试只针对 failed/cancelled
  const t2 = appendChatTurn(s, cid, "第二问"); s = t2.state;
  assert.throws(() => retryChat(s, cid, t2.messageId), /失败\/已取消/);
  s = cancelChat(s, cid, t2.messageId);
  assert.equal(s.chats[0].messages.find((m) => m.id === t2.messageId)!.status, "cancelled");
  assert.throws(() => cancelChat(s, cid, t2.messageId), /运行中/);
  s = retryChat(s, cid, t2.messageId);
  assert.equal(s.chats[0].messages.find((m) => m.id === t2.messageId)!.status, "running");
});

test("5E-6 采纳写入报告待验证：修订留历史并标来源", async () => {
  const w = await world();
  let s = createReport(w.s, { topicId: w.topicId }).state;
  const rid = s.reports[0].id;
  s = createChat(s, { topicId: w.topicId, scope: [{ kind: "execution", id: w.execId }] }).state;
  const cid = s.chats[0].id;
  const turn = appendChatTurn(s, cid, "q"); s = turn.state;
  const snap = chatScopeSnapshot(s, s.chats[0], "p", "m");
  s = applyChatResponse(s, cid, turn.messageId, { answer: "a", sources: [], proposals: [{ targetKind: "report-toVerify", targetId: rid, preview: "补 pH5 数据点" }] }, snap);
  const r = adoptProposal(s, cid, turn.messageId, 0, true);
  assert.equal(r.state.reports[0].blocks.length, 1);
  assert.equal(r.state.reports[0].blocks[0].nature, "to_verify");
  assert.equal(r.state.reports[0].blocks[0].refs[0].label, `对话 ${cid} · 消息 ${turn.messageId}`);
  assert.equal(r.state.reports[0].revision, 2);
  assert.match(r.state.reports[0].history[0].reason, /人工确认/);
});

test("6C 稳定：服务重启后孤儿 running 消息标失败可重试（不悬挂）", async () => {
  const w = await world();
  let s = createChat(w.s, { topicId: w.topicId, scope: [{ kind: "execution", id: w.execId }] }).state;
  const cid = s.chats[0].id;
  const turn = appendChatTurn(s, cid, "问"); s = turn.state;
  assert.equal(s.chats[0].messages.find((m) => m.id === turn.messageId)!.status, "running");
  // 重启恢复：running → failed（可重试）
  const rec = recoverInterruptedChats(s);
  assert.equal(rec.recovered, 1);
  const m = rec.state.chats[0].messages.find((x) => x.id === turn.messageId)!;
  assert.equal(m.status, "failed");
  assert.match(m.error!, /服务重启/);
  // 无 running 时不误伤
  assert.equal(recoverInterruptedChats(rec.state).recovered, 0);
  // 之后可重试
  s = retryChat(rec.state, cid, turn.messageId);
  assert.equal(s.chats[0].messages.find((x) => x.id === turn.messageId)!.status, "running");
});

test("B5 修复：测量引用须用『测量记录 id』（kind=measurement）；原件 id 会被拒", async () => {
  const w = await world();
  const ok = createChat(w.s, { topicId: w.topicId, scope: [{ kind: "measurement", id: w.measId }] });
  assert.equal(ok.chat.scope.length, 1);
  assert.throws(() => createChat(w.s, { topicId: w.topicId, scope: [{ kind: "measurement", id: "ast_ghost" }] }), /测量不存在/);
});

// ── 集成：真实路由 + 假模型（按任务分流）；推荐/对话/取消/采纳 ──
const REC_JSON = JSON.stringify(REC);async function fakeAi(delayMs: number): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      setTimeout(() => {
        const isChat = body.includes("上下文讨论助手");
        let content = REC_JSON;
        if (isChat) {
          const m = body.match(/execution:(exec_[a-f0-9-]+)/);
          content = JSON.stringify({ answer: "基于冻结上下文回答。", sources: ["执行碎片"], proposals: m ? [{ targetKind: "execution-note", targetId: m[1], preview: "建议补记室温" }] : [] });
        }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ choices: [{ message: { content } }] }));
      }, delayMs);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return { server, port: (server.address() as import("node:net").AddressInfo).port };
}

test("5E-7 路由：推荐冻结快照＋重复 409；结果提交；对话采纳；取消丢弃不写回", async () => {
  const { createApp } = await import("../server.ts");
  const ai = await fakeAi(300);
  const app = await createApp(new MemoryStore());
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(app.address() as import("node:net").AddressInfo).port}`;
  const post = async (p: string, b: unknown) => {
    const res = await fetch(`${base}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    return { status: res.status, data: await res.json() as Record<string, unknown> };
  };
  const get = async (p: string) => (await fetch(`${base}${p}`)).json() as Promise<Record<string, never>>;
  const poll = async (jobId: unknown) => {
    let j: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) {
      j = await get(`/api/jobs/${jobId}`);
      if (j.status === "done" || j.status === "error") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    return j;
  };
  try {
    await post("/api/ai/config", { baseUrl: `http://127.0.0.1:${ai.port}`, model: "fake", key: "k" });
    const topicId = (await post("/api/topics", { name: "5E路由", researchQuestion: "Q" })).data.topicId as string;
    const pid = (await post("/api/protocols", { topicId, name: "方案", steps: [{ id: "s1", op: "孵育", durationMin: 30 }] })).data.protocolId as string;
    const eid = (await post("/api/executions", { topicId, protocolId: pid })).data.executionId as string;
    await post(`/api/executions/${eid}/confirm-preparation`, {});
    const tid = (await post("/api/analysis/tasks", { topicId, title: "分析", core: [{ kind: "execution", id: eid }] })).data.taskId as string;
    // 推荐：冻结快照；运行中重复 409
    const rec = await post(`/api/analysis/tasks/${tid}/recommend`, { purpose: "求最适 pH" });
    assert.equal(rec.status, 202);
    assert.ok(rec.data.snapshotHash);
    assert.equal((await post(`/api/analysis/tasks/${tid}/recommend`, { purpose: "再发" })).status, 409);
    const j1 = await poll(rec.data.jobId);
    assert.equal(j1.status, "done");
    let st = await get("/api/state");
    const task = (st.analysisTasks as { snapshot: { hash: string; fragments: unknown[] }; recommendation: { methods: unknown[] } }[])[0];
    assert.equal(task.snapshot.hash, rec.data.snapshotHash);
    assert.equal(task.recommendation.methods.length, 1);
    // 结果：只有图 → 不可复现但可存
    const r1 = await post(`/api/analysis/tasks/${tid}/result`, { method: "Origin 拟合", reason: "惯用 Origin", attachments: [{ name: "chart.png", content: "data:image/png;base64,aHR0cA==" }] });
    assert.equal(r1.status, 200);
    assert.equal(r1.data.reproducible, false);
    // 对话：发送→提案→采纳
    const cid = (await post("/api/chats", { topicId, scope: [{ kind: "execution", id: eid }] })).data.chatId as string;
    const send = await post(`/api/chats/${cid}/send`, { text: "执行说明了什么？" });
    assert.equal(send.status, 202);
    const j2 = await poll(send.data.jobId);
    assert.equal(j2.status, "done");
    st = await get("/api/state");
    const chat = (st.chats as { messages: { id: string; status: string; proposals: { targetId: string }[] }[] }[])[0];
    const am = chat.messages.find((m) => m.id === send.data.messageId)!;
    assert.equal(am.status, "done");
    assert.equal(am.proposals[0].targetId, eid);
    assert.equal((await post(`/api/chats/${cid}/messages/${am.id}/adopt`, { index: 0, confirmed: false })).status, 422);
    const ad = await post(`/api/chats/${cid}/messages/${am.id}/adopt`, { index: 0, confirmed: true });
    assert.equal(ad.status, 200);
    st = await get("/api/state");
    assert.equal((st.executions as { events: unknown[] }[])[0].events.length, 1);
    // 取消：在途结果丢弃不写回
    const send2 = await post(`/api/chats/${cid}/send`, { text: "第二问" });
    assert.equal((await post(`/api/chats/${cid}/messages/${send2.data.messageId}/cancel`, {})).status, 200);
    const j3 = await poll(send2.data.jobId);
    assert.equal(j3.status, "done");
    assert.equal((j3.result as { discarded?: boolean }).discarded, true);
    st = await get("/api/state");
    const chat2 = (st.chats as { messages: { id: string; status: string; content: string }[] }[])[0];
    const cancelled = chat2.messages.find((m) => m.id === send2.data.messageId)!;
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.content, "");
    // 重试：重新运行并写回
    const retry = await post(`/api/chats/${cid}/messages/${cancelled.id}/retry`, {});
    assert.equal(retry.status, 202);
    const j4 = await poll(retry.data.jobId);
    assert.equal(j4.status, "done");
    st = await get("/api/state");
    const retried = (st.chats as { messages: { id: string; status: string }[] }[])[0].messages.find((m) => m.id === cancelled.id)!;
    assert.equal(retried.status, "done");
    // 未配置 AI：明确拒绝（不冒充）
    await fetch(`${base}/api/ai/config`, { method: "DELETE" });
    assert.equal((await post(`/api/analysis/tasks/${tid}/recommend`, { purpose: "x" })).status, 422);
    assert.equal((await post(`/api/chats/${cid}/send`, { text: "x" })).status, 422);
  } finally { app.close(); ai.server.close(); clearAiConfig(); }
});

test("6A-1 路由：报告块 preview→apply（409 并发）→confirm；draft 本地生成", async () => {
  const { createApp } = await import("../server.ts");
  const app = await createApp(new MemoryStore());
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(app.address() as import("node:net").AddressInfo).port}`;
  const post = async (p: string, b: unknown) => {
    const res = await fetch(`${base}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    return { status: res.status, data: await res.json() as Record<string, unknown> };
  };
  const get = async (p: string) => (await fetch(`${base}${p}`)).json() as Promise<Record<string, never>>;
  try {
    const topicId = (await post("/api/topics", { name: "报告路由", researchQuestion: "Q" })).data.topicId as string;
    const rid = (await post("/api/reports", { topicId })).data.reportId as string;
    const blocks = [
      { nature: "observation", text: "pH4 时 Km 最低", refs: [{ kind: "note", label: "结果 ares_1" }] },
      { nature: "human_judgment", text: "该趋势符合酸失活预期" },
    ];
    const pv = await post(`/api/reports/${rid}/preview`, { blocks });
    assert.equal(pv.status, 200);
    assert.equal(pv.data.baseRevision, 1);
    assert.equal((pv.data.diff as { added: unknown[] }).added.length, 2);
    // 预览不改状态
    assert.equal(((await get("/api/state")).reports as { blocks: unknown[] }[])[0].blocks.length, 0);
    // 并发：错误 baseRevision → 409 且带 currentRevision
    const conflict = await post(`/api/reports/${rid}/apply`, { baseRevision: 5, blocks, reason: "x" });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.data.currentRevision, 1);
    // 正确接受 → 新版本
    const ap = await post(`/api/reports/${rid}/apply`, { baseRevision: 1, blocks, reason: "首次填写" });
    assert.equal(ap.status, 200);
    assert.equal(ap.data.revision, 2);
    let st = await get("/api/state");
    const rep = (st.reports as { blocks: { id: string; nature: string; draft: boolean }[] }[])[0];
    assert.equal(rep.blocks.length, 2);
    assert.equal(rep.blocks[1].nature, "human_judgment");
    // draft：本地生成（无钉住任务 → 空，不冒充）；手填 AI 草稿块 → 确认
    const draft = await post(`/api/reports/${rid}/draft`, {});
    assert.equal(draft.status, 200);
    assert.deepEqual(draft.data.blocks, []);
    const draftBlock = { nature: "observation", text: "（AI 草稿）峰形疑似双峰", draft: true };
    const ap2 = await post(`/api/reports/${rid}/apply`, { baseRevision: 2, blocks: [...blocks, draftBlock], reason: "AI 草稿入稿" });
    assert.equal(ap2.status, 200);
    st = await get("/api/state");
    const rep2 = (st.reports as { blocks: { id: string; draft: boolean }[] }[])[0];
    const draftId = rep2.blocks.find((b) => b.draft)!.id;
    assert.equal((await post(`/api/reports/${rid}/blocks/${draftId}/confirm`, { reason: "已核对" })).status, 200);
    st = await get("/api/state");
    assert.equal((st.reports as { blocks: { draft: boolean }[] }[])[0].blocks.every((b) => !b.draft), true);
    assert.equal((await post(`/api/reports/${rid}/blocks/ghost/confirm`, { reason: "" })).status, 404);
    // 非法块
    assert.equal((await post(`/api/reports/${rid}/preview`, { blocks: [{ nature: "bogus", text: "x" }] })).status, 422);
  } finally { app.close(); }
});