/**
 * 4B 文献闭环契约测试（T10–T16 + 已知疑点反例）。
 * 候选库/补卡/组审/采用独立/转引/映射/比较快照/新文献只提醒。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  AppError,
  addManualCard,
  batchConfirm,
  batchPreview,
  candidateStateOf,
  createComparison,
  createMapping,
  createSubquestion,
  createTopic,
  importLiterature,
  independentEvidenceCount,
  reviewCard,
  upsertAdoption,
} from "../services/app.ts";
import { emptyState, type LocusState } from "../store.ts";

function base() {
  let s = emptyState();
  const t = createTopic(s, { name: "酶活条件", researchQuestion: "pH 如何影响活性？" });
  s = t.state;
  const q1 = createSubquestion(s, { topicId: t.topic.id, question: "最适 pH？" });
  s = q1.state;
  const q2 = createSubquestion(s, { topicId: t.topic.id, question: "Km 报道值？", kind: "exploratory" });
  s = q2.state;
  return { s, topicId: t.topic.id, q1: q1.subquestion.id, q2: q2.subquestion.id };
}

async function lit(s: LocusState, topicId: string, text: string, name = "a.md") {
  return importLiterature(s, { name, text, mode: "draft", topicId }, null);
}

const confirm = (s: LocusState, id: string) => reviewCard(s, id, { audit: "confirm" });

test("T10 候选状态：跳过保未复核；need_info=待审；confirm=已审；采用独立维度", async () => {
  const { s, topicId, q1, q2 } = base();
  const r = await lit(s, topicId, "pH 7 时活性最高。");
  const id = r.state.cards[0].id;
  let st = r.state;
  assert.equal(candidateStateOf(st.cards[0], st.adoptions), "unreviewed");
  st = reviewCard(st, id, { audit: "skip" });
  assert.equal(candidateStateOf(st.cards[0], st.adoptions), "unreviewed"); // 跳过≠不重要≠正式依据
  st = reviewCard(st, id, { audit: "need_info" });
  assert.equal(candidateStateOf(st.cards[0], st.adoptions), "pending");
  st = confirm(st, id);
  assert.equal(candidateStateOf(st.cards[0], st.adoptions), "reviewed");
  st = upsertAdoption(st, { cardId: id, subquestionId: q1, decision: "adopt" }).state;
  assert.equal(candidateStateOf(st.cards[0], st.adoptions), "adopted");
  // 任务排除不冒充已采用：另一任务排除后，已采用任务仍在。
  st = upsertAdoption(st, { cardId: id, subquestionId: q2, decision: "exclude", reason: "条件不符" }).state;
  assert.equal(candidateStateOf(st.cards[0], st.adoptions), "adopted");
  assert.equal(st.adoptions.length, 2);
});

test("T10 一卡多任务引用；改判留修订历史", async () => {
  const { s, topicId, q1, q2 } = base();
  const r = await lit(s, topicId, "Km = 0.5 mM（pH 7）。");
  let st = confirm(r.state, r.state.cards[0].id);
  const id = st.cards[0].id;
  st = upsertAdoption(st, { cardId: id, subquestionId: q1, decision: "adopt" }).state;
  st = upsertAdoption(st, { cardId: id, subquestionId: q2, decision: "adopt" }).state;
  assert.equal(st.adoptions.length, 2);
  st = upsertAdoption(st, { cardId: id, subquestionId: q2, decision: "exclude", reason: "该任务只要 pH5 数据" }).state;
  const a = st.adoptions.find((x) => x.subquestionId === q2)!;
  assert.equal(a.decision, "exclude");
  assert.equal(a.revision, 2);
  assert.equal(a.history.some((h) => h.field === "decision" && h.before === "adopt" && h.after === "exclude"), true);
});

test("T10 手动补卡：引文须匹配原件；空引明示定位不足且不得正式采用", async () => {
  const { s, topicId, q1 } = base();
  const r = await lit(s, topicId, "原文第一段。\n原文第二段。");
  let st = r.state;
  const assetId = r.asset.id;
  const ok = addManualCard(st, { assetId, rawText: "补充观察", sectionQuote: "原文第二段", fields: { Km: "0.5" }, units: ["mM"], conditions: ["pH 7"] });
  st = ok.state;
  assert.equal(ok.card.extraction, "manual");
  assert.equal(ok.card.locator.sectionQuote, "原文第二段");
  assert.throws(() => addManualCard(st, { assetId, rawText: "x", sectionQuote: "原件中不存在的句子" }), (e: unknown) => e instanceof AppError && e.status === 422);
  const noLoc = addManualCard(st, { assetId, rawText: "完全新写的观察（原件无此句）" });
  st = noLoc.state;
  assert.equal(noLoc.card.locator.sectionQuote, "");
  st = confirm(st, noLoc.card.id);
  assert.throws(() => upsertAdoption(st, { cardId: noLoc.card.id, subquestionId: q1, decision: "adopt" }), (e: unknown) => e instanceof AppError && e.status === 422);
  // 未确认也不得采用
  assert.throws(() => upsertAdoption(st, { cardId: ok.card.id, subquestionId: q1, decision: "adopt" }), (e: unknown) => e instanceof AppError && e.status === 422);
  // 任务排除必须给原因
  assert.throws(() => upsertAdoption(st, { cardId: ok.card.id, subquestionId: q1, decision: "exclude" }), (e: unknown) => e instanceof AppError && e.status === 422);
});

test("T10 组审：先预览共享条件/缺项/异常；未 ack 拒绝整组确认", async () => {
  const { s, topicId } = base();
  const r = await lit(s, topicId, "第一句。");
  let st = r.state;
  const a = addManualCard(st, { assetId: r.asset.id, rawText: "观察A", sectionQuote: "第一句", units: ["mM"], conditions: ["pH 7", "25 °C"] });
  st = a.state;
  const b = addManualCard(st, { assetId: r.asset.id, rawText: "观察B（原件无）", unknowns: ["温度未知"] });
  st = b.state;
  const ids = [a.card.id, b.card.id];
  const p = batchPreview(st, ids);
  assert.equal(p.requiresAck, true);
  assert.deepEqual(p.sharedConditions.sort(), ["25 °C", "pH 7", "单位：mM"].sort());
  assert.deepEqual(p.missing, [b.card.id]);
  assert.deepEqual(p.anomalies, [b.card.id]);
  assert.throws(() => batchConfirm(st, ids, false), (e: unknown) => e instanceof AppError && e.status === 422);
  st = batchConfirm(st, ids, true);
  assert.equal(st.cards.find((c) => c.id === a.card.id)!.audit, "confirm");
  assert.equal(st.cards.find((c) => c.id === b.card.id)!.revision, 2);
  // 单卡不需要 ack
  const single = batchPreview(st, [a.card.id]);
  assert.equal(single.requiresAck, false);
});

test("T13 转引标记须依据；二手与未确认不计独立证据；课题备注各自保存", async () => {
  const { s, topicId } = base();
  const r = await lit(s, topicId, "综述转引：Smith 报道 Km=0.5。");
  let st = r.state;
  const id = st.cards[0].id;
  assert.throws(() => reviewCard(st, id, { secondaryCitation: true }), (e: unknown) => e instanceof AppError && e.status === 422);
  st = reviewCard(st, id, { secondaryCitation: true, reason: "综述第3节转引 Smith 2019", audit: "confirm", note: "本课题关注 pH 依赖" });
  assert.equal(independentEvidenceCount(st, topicId), 0);
  const r2 = await lit(st, topicId, "Smith 2019 原文：Km=0.5 mM。", "b.md");
  const newId = r2.state.cards[r2.state.cards.length - 1].id;
  st = confirm(r2.state, newId);
  assert.equal(independentEvidenceCount(st, topicId), 1);
  assert.equal(st.cards.find((c) => c.id === id)!.note, "本课题关注 pH 依赖");
});

test("T14 命名映射须依据；比较中保留原名＋映射名", async () => {
  const { s, topicId } = base();
  assert.throws(() => createMapping(s, { original: "α相", mapped: "alpha", basis: "" }), (e: unknown) => e instanceof AppError && e.status === 422);
  let st = createMapping(s, { original: "Km", mapped: "米氏常数", basis: "来源表1 术语表", topicId }).state;
  const r1 = await lit(st, topicId, "A 文：Km 0.5。", "a.md");
  st = r1.state;
  const c1 = addManualCard(st, { assetId: r1.asset.id, rawText: "Km 0.5", sectionQuote: "A 文：Km 0.5。", fields: { Km: "0.5" }, units: ["mM"], conditions: ["pH 7"] });
  st = confirm(c1.state, c1.card.id);
  const r2 = await lit(st, topicId, "B 文：Km 0.9。", "b.md");
  st = r2.state;
  const c2 = addManualCard(st, { assetId: r2.asset.id, rawText: "Km 0.9", sectionQuote: "B 文：Km 0.9。", fields: { Km: "0.9" }, units: ["mM"], conditions: ["pH 7"] });
  st = confirm(c2.state, c2.card.id);
  const cmp = createComparison(st, { topicId, cardIds: [c1.card.id, c2.card.id] });
  const g = cmp.comparison.groups.find((x) => x.name === "米氏常数")!;
  assert.equal(g.divergence, "value_diff");
  assert.deepEqual(g.entries.map((e) => e.originalName), ["Km", "Km"]);
  assert.deepEqual(g.entries.map((e) => e.value), ["0.5", "0.9"]); // 不自动平均/合并
});

test("T15 比较快照：未确认拒入；固定 revision；改卡标复核；新文献只提醒；口径入快照", async () => {
  const { s, topicId, q1 } = base();
  const r1 = await lit(s, topicId, "A 文数据。", "a.md");
  let st = r1.state;
  const c1 = addManualCard(st, { assetId: r1.asset.id, rawText: "Km 0.5", sectionQuote: "A 文数据。", fields: { Km: "0.5" }, units: ["mM"], conditions: ["pH 7"] });
  st = c1.state;
  assert.throws(() => createComparison(st, { topicId, cardIds: [c1.card.id] }), (e: unknown) => e instanceof AppError && e.status === 422);
  st = confirm(st, c1.card.id);
  st = upsertAdoption(st, { cardId: c1.card.id, subquestionId: q1, decision: "adopt" }).state;
  const cmp1 = createComparison(st, { topicId, cardIds: [c1.card.id], filters: ["pH=7"], conversions: ["mM→M"] });
  st = cmp1.state;
  const pinned = cmp1.comparison.groups[0].entries[0].cardRevision;
  // 修改已采用/已入快照的卡 → 标复核，快照本身不变
  st = reviewCard(st, c1.card.id, { extracted: { fields: { Km: "0.6" } }, reason: "原文表2更正" });
  const flagged = st.comparisons.find((c) => c.id === cmp1.comparison.id)!;
  assert.equal(flagged.reviewFlags.length, 1);
  assert.equal(flagged.groups[0].entries[0].value, "0.5");
  assert.equal(flagged.groups[0].entries[0].cardRevision, pinned);
  // 新文献入库 → 只提醒，不自动重比
  const r2 = await lit(st, topicId, "B 文新数据。", "b.md");
  assert.equal(r2.reminder, true);
  assert.equal(r2.state.comparisons.length, 1);
  // 不同换算口径 → 不同快照 dataRevision（P4 反例在 web 层）
  const cmp2 = createComparison(r2.state, { topicId, cardIds: [c1.card.id], filters: ["pH=7"], conversions: ["M→mM"] });
  assert.notEqual(cmp2.comparison.snapshot.dataRevision, cmp1.comparison.snapshot.dataRevision);
  // 无比较时新文献不提醒
  const fresh = base();
  const r3 = await lit(fresh.s, fresh.topicId, "独立课题文献。", "c.md");
  assert.equal(r3.reminder, false);
});

test("T15 分歧分类：值差/条件差/一致；缺项与二手明示 unresolved", async () => {
  const { s, topicId } = base();
  const r = await lit(s, topicId, "原文。", "a.md");
  let st = r.state;
  const mk = (value: string, conditions: string[], unknowns: string[] = [], secondary = false) => {
    const c = addManualCard(st, { assetId: r.asset.id, rawText: `Km ${value} ${conditions.join(",")}`, sectionQuote: "原文。", fields: { Km: value }, units: ["mM"], conditions, unknowns, secondaryCitation: secondary, reason: secondary ? "综述转引" : undefined });
    st = confirm(c.state, c.card.id);
    return c.card;
  };
  const a = mk("0.5", ["pH 7"]);
  const b = mk("0.5", ["pH 5"]);
  const c = mk("0.9", ["pH 7"], ["温度未知"]);
  const cmp = createComparison(st, { topicId, cardIds: [a.id, b.id, c.id] });
  const g = cmp.comparison.groups[0];
  assert.equal(g.divergence, "value_diff");
  assert.equal(g.unresolved.some((u) => u.includes("温度未知")), true);
  const cmp2 = createComparison(st, { topicId, cardIds: [a.id, b.id] });
  assert.equal(cmp2.comparison.groups[0].divergence, "conditions_diff");
  const d = mk("0.5", ["pH 7"]);
  const cmp3 = createComparison(st, { topicId, cardIds: [a.id, d.id] });
  assert.equal(cmp3.comparison.groups[0].divergence, "consistent");
});

test("改抽取字段须原因且留历史；单位/条件可核对编辑", async () => {
  const { s, topicId } = base();
  const r = await lit(s, topicId, "Km 0.5 mM。");
  let st = r.state;
  const id = st.cards[0].id;
  st = reviewCard(st, id, { extracted: { fields: { Km: "0.5" }, units: ["mM"], conditions: ["pH 7"] }, reason: "初次录入，对照原文" });
  assert.throws(() => reviewCard(st, id, { extracted: { fields: { Km: "0.6" } } }), (e: unknown) => e instanceof AppError && e.status === 422);
  st = reviewCard(st, id, { extracted: { fields: { Km: "0.6" } }, reason: "对照原文表2" });
  const card = st.cards.find((c) => c.id === id)!;
  assert.equal(card.extracted.fields.Km, "0.6");
  assert.equal(card.history.some((h) => h.field === "extracted.fields.Km" && h.before === "0.5" && h.after === "0.6"), true);
});

test("跨课题隔离：他课题卡不能入本课题比较；补卡拒绝数据资产", async () => {
  const { s, topicId } = base();
  const other = createTopic(s, { name: "另一课题", researchQuestion: "Q2" });
  let st = other.state;
  const rOther = await lit(st, other.topic.id, "他课题文献。", "o.md");
  st = rOther.state;
  const cOther = addManualCard(st, { assetId: rOther.asset.id, rawText: "x", sectionQuote: "他课题文献。", fields: { Km: "1" } });
  st = confirm(cOther.state, cOther.card.id);
  assert.throws(() => createComparison(st, { topicId, cardIds: [cOther.card.id] }), (e: unknown) => e instanceof AppError && e.status === 422);
  const { importMeasurements } = await import("../services/app.ts");
  const m = importMeasurements(st, { name: "d.csv", csv: "a,b\n1,2\n" });
  assert.throws(() => addManualCard(m.state, { assetId: m.asset.id, rawText: "x" }), (e: unknown) => e instanceof AppError && e.status === 422);
});

// ── HTTP 层：4B 全链路经真实路由 ────────────────────────────
test("HTTP：补卡→组审→采用→映射→比较→新文献提醒（真实路由）", async () => {
  const { createApp } = await import("../server.ts");
  const { MemoryStore } = await import("../store.ts");
  const app = await createApp(new MemoryStore());
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(app.address() as import("node:net").AddressInfo).port}`;
  const post = async (p: string, body: unknown) => {
    const res = await fetch(`${base}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, data: await res.json() as Record<string, unknown> };
  };
  const get = async (p: string) => (await fetch(`${base}${p}`)).json() as Promise<Record<string, never>>;
  try {
    const topic = await post("/api/topics", { name: "HTTP课题", researchQuestion: "Q" });
    const topicId = topic.data.topicId as string;
    const subq = await post(`/api/topics/${topicId}/subquestions`, { question: "q1" });
    const subqId = subq.data.subquestionId as string;
    const imp = await post("/api/import/literature", { name: "h.md", text: "第一句观察。", mode: "draft", topicId });
    assert.equal(imp.status, 200);
    assert.equal(imp.data.reminder, false);
    const assetId = imp.data.assetId as string;

    const mc = await post("/api/cards", { assetId, rawText: "Km 0.5", sectionQuote: "第一句观察。", fields: { Km: "0.5" }, units: ["mM"], conditions: ["pH 7"] });
    assert.equal(mc.status, 200);
    const cardId = mc.data.cardId as string;
    // 未确认不得采用
    assert.equal((await post("/api/adoptions", { cardId, subquestionId: subqId, decision: "adopt" })).status, 422);
    assert.equal((await post(`/api/cards/${cardId}/review`, { audit: "confirm" })).status, 200);
    assert.equal((await post("/api/adoptions", { cardId, subquestionId: subqId, decision: "adopt" })).status, 200);

    const st1 = await get("/api/state");
    const draftId = (st1.cards as { id: string; extraction: string }[]).find((c) => c.extraction === "draft")!.id;
    const pv = await post("/api/cards/batch-preview", { ids: [cardId, draftId] });
    assert.equal(pv.data.requiresAck, true);
    assert.equal((await post("/api/cards/batch-confirm", { ids: [cardId, draftId], ack: false })).status, 422);
    assert.equal((await post("/api/cards/batch-confirm", { ids: [cardId, draftId], ack: true })).status, 200);

    assert.equal((await post("/api/mappings", { original: "Km", mapped: "米氏常数", basis: "术语表", topicId })).status, 200);
    assert.equal((await post("/api/mappings", { original: "x", mapped: "y", basis: "" })).status, 422);
    const cmp = await post("/api/comparisons", { topicId, cardIds: [cardId], filters: ["pH=7"] });
    assert.equal(cmp.status, 200);
    const cmpId = cmp.data.comparisonId as string;

    // 新文献 → reminder=true；旧快照不变
    const imp2 = await post("/api/import/literature", { name: "h2.md", text: "新文献句子。", mode: "draft", topicId });
    assert.equal(imp2.data.reminder, true);
    const st2 = await get("/api/state");
    assert.equal((st2.comparisons as unknown[]).length, 1);
    // 改已入快照的卡 → reviewFlags
    assert.equal((await post(`/api/cards/${cardId}/review`, { extracted: { fields: { Km: "0.6" } }, reason: "更正" })).status, 200);
    const st3 = await get("/api/state");
    const flags = (st3.comparisons as { id: string; reviewFlags: unknown[] }[]).find((c) => c.id === cmpId)!.reviewFlags;
    assert.equal(flags.length, 1);
  } finally {
    app.close();
  }
});