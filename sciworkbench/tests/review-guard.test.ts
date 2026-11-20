/**
 * 锁5 全入口守卫＋编辑保护（S02-T50 阶段②，T47-L4/L5 反例转回归）：
 * 核心/候选/对话选用须人工确认；取消选择不拦；冻结前统一复检兜底旧任务；
 * 普通编辑不改 draft/历史（库内继承）；新 AI 草稿保持待确认；确认仅专用端点。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createTopic, importLiterature, importMeasurements, reviewCard } from "../services/app.ts";
import { createAnalysisTask, setTaskCandidates, buildSnapshot, createChat, chatScopeSnapshot, createReport, applyReportEdit, confirmReportBlock } from "../services/analysis.ts";
import { emptyState } from "../store.ts";
import { blockRowHtml } from "../public/lib/pages/analysis.js";

async function world() {
  let s = emptyState();
  const t = createTopic(s, { name: "守卫课题", researchQuestion: "q" }); s = t.state;
  const tab = importMeasurements(s, { name: "g.csv", csv: "x,y\n1,2", topicId: t.topic.id }); s = tab.state;
  const lit = await importLiterature(s, { name: "g.md", text: "甲段\n\n乙段", mode: "draft", topicId: t.topic.id }); s = lit.state;
  return { s, topicId: t.topic.id, tableId: s.tables[0].id, cardIds: s.cards.map((c) => c.id) };
}
const confirm = (s: ReturnType<typeof emptyState>, id: string) => reviewCard(s, id, { audit: "confirm" });

test("守卫-1 未确认卡：核心拒绝、已选候选拒绝、未选候选放行", async () => {
  const w = await world();
  const card = w.cardIds[0];
  assert.throws(() => createAnalysisTask(w.s, { topicId: w.topicId, title: "x", core: [{ kind: "table", id: w.tableId }, { kind: "card", id: card }] }), /未入候选/);
  assert.throws(() => createAnalysisTask(w.s, { topicId: w.topicId, title: "x", core: [{ kind: "table", id: w.tableId }], optional: [{ ref: { kind: "card", id: card }, included: true }] }), /未入候选/);
  const ok = createAnalysisTask(w.s, { topicId: w.topicId, title: "x", core: [{ kind: "table", id: w.tableId }], optional: [{ ref: { kind: "card", id: card }, included: false }] });
  assert.equal(ok.task.optional[0].included, false);
});

test("守卫-2 取消选择不拦；重新勾选须先确认（T47-L4 反例）", async () => {
  const w = await world();
  const card = w.cardIds[0];
  let s = confirm(w.s, card);
  s = createAnalysisTask(s, { topicId: w.topicId, title: "x", core: [{ kind: "table", id: w.tableId }], optional: [{ ref: { kind: "card", id: card }, included: true }] }).state;
  const tid = s.analysisTasks[0].id;
  s = reviewCard(s, card, { audit: "unreviewed" }); // 撤回确认
  s = setTaskCandidates(s, tid, [{ ref: { kind: "card", id: card }, included: false }]).state; // 取消：放行
  assert.throws(() => setTaskCandidates(s, tid, [{ ref: { kind: "card", id: card }, included: true }]), /未入候选/);
  s = confirm(s, card);
  s = setTaskCandidates(s, tid, [{ ref: { kind: "card", id: card }, included: true }]).state; // 确认后可复选
  assert.equal(s.analysisTasks[0].optional[0].included, true);
});

test("守卫-3 冻结前统一复检：旧任务遗留未审卡不得送 AI；确认后放行", async () => {
  const w = await world();
  const card = w.cardIds[0];
  let s = confirm(w.s, card);
  s = createAnalysisTask(s, { topicId: w.topicId, title: "x", core: [{ kind: "table", id: w.tableId }], optional: [{ ref: { kind: "card", id: card }, included: true }] }).state;
  s = reviewCard(s, card, { audit: "unreviewed" }); // 选用后被撤回 → 遗留未审候选
  assert.throws(() => buildSnapshot(s, s.analysisTasks[0], "p", "m", "v1"), /未确认知识卡/);
  s = confirm(s, card);
  const snap = buildSnapshot(s, s.analysisTasks[0], "p", "m", "v1");
  assert.ok(snap.fragments.some((f) => f.ref.kind === "card"));
});

test("守卫-4 对话范围同查；冻结前复检同样兜底", async () => {
  const w = await world();
  const card = w.cardIds[0];
  assert.throws(() => createChat(w.s, { topicId: w.topicId, scope: [{ kind: "card", id: card }] }), /未入候选/);
  let s = confirm(w.s, card);
  s = createChat(s, { topicId: w.topicId, scope: [{ kind: "card", id: card }] }).state;
  s = reviewCard(s, card, { audit: "unreviewed" });
  assert.throws(() => chatScopeSnapshot(s, s.chats[0], "p", "m"), /未确认知识卡/);
});

test("守卫-5 普通编辑不改 draft/历史；新草稿保持待确认；确认仅专用端点（T47-L5 反例）", async () => {
  const w = await world();
  let s = createReport(w.s, { topicId: w.topicId }).state;
  const rid = s.reports[0].id;
  // 新块 draft:true（生成路径）→ 落库仍待确认
  s = applyReportEdit(s, rid, { baseRevision: 1, blocks: [{ nature: "observation", text: "AI 草稿内容", refs: [], draft: true }], reason: "首稿" }).state;
  const b0 = s.reports[0].blocks[0];
  assert.equal(b0.draft, true);
  // 普通保存：省略 draft ＋ 伪造 draft:false ＋ 注入历史 → 均不生效
  const forged = [{ id: b0.id, nature: "observation", text: "AI 草稿内容（改）", refs: [], draft: false, history: [{ at: "fake", reason: "注入", text: "x", nature: "observation" }] }];
  s = applyReportEdit(s, rid, { baseRevision: 2, blocks: forged, reason: "改正文" }).state;
  const b1 = s.reports[0].blocks[0];
  assert.equal(b1.draft, true); // 编辑正文≠确认
  assert.equal(b1.history.length, 1); // 仅系统追加的一条
  assert.equal(b1.history[0].reason, "改正文");
  assert.ok(!b1.history.some((h) => h.reason === "注入"));
  // 新块 draft:false/省略 → 人工内容；新块 draft:true → 待确认（fail-closed）
  s = applyReportEdit(s, rid, { baseRevision: 3, blocks: [...forged.map(({ history, ...rest }) => rest), { nature: "hypothesis", text: "人工块", refs: [] }, { nature: "to_verify", text: "新草稿", refs: [], draft: true }], reason: "加块" }).state;
  assert.equal(s.reports[0].blocks[1].draft, false);
  assert.equal(s.reports[0].blocks[2].draft, true);
  // 专用确认端点才是唯一 draft→false 通道
  s = confirmReportBlock(s, rid, b1.id, "已人工核对").state;
  assert.equal(s.reports[0].blocks[0].draft, false);
});

test("守卫-6 前端块行携带 draft 标记（新草稿保存后仍待确认的渲染前提）", () => {
  assert.ok(blockRowHtml({ id: "b1", nature: "observation", text: "t", refs: [], draft: true }, 0).includes('data-draft="1"'));
  assert.ok(blockRowHtml({ id: "b2", nature: "observation", text: "t", refs: [], draft: false }, 0).includes('data-draft=""'));
});