/**
 * E1 知识基座契约测试：迁移、严格加载、源历史/固定版本、备份恢复。
 * 用例 ID 对应合同 §11（T01–T03、T20–T21）与 §7.3 hash 规范。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, rmSync } from "node:fs";
import { emptyState, JsonFileStore, STATE_VERSION } from "../store.ts";
import {
  emptyKnowledge, KNOWLEDGE_SCHEMA_VERSION, canonicalHash, refKey, sameRef,
  sourceRef as makeSourceRef, knowledgeRef as makeKnowledgeRef, assertKnowledgeShape,
} from "../domain/knowledge.ts";
import { importMeasurements, reviewTable, createTopic, makeAsset, addManualCard, reviewCard, AppError } from "../services/app.ts";
import { chatScopeSnapshot, createAnalysisTask, createChat, resolveFragment } from "../services/analysis.ts";
import { buildWholeLibraryPackage, inspectLibraryJson, sha256 } from "../services/export.ts";
import {
  archiveSourceVersion, currentSourceRef, readSourceVersion, resolveSourceVersion, sourcePayload,
  createKnowledgeStatement, createKnowledgeTheme, describeValue, readKnowledgeVersion,
  resolveKnowledgeEvidence, reviewKnowledgeContext, reviewKnowledgeItem, structureLegacyCard,
  syncShellAudit, updateKnowledgeContext, updateKnowledgeItem, updateKnowledgeTheme,
} from "../services/knowledge-base.ts";
import type { LocationStatus } from "../domain/knowledge.ts";
import type { LocusState } from "../store.ts";

const tmp = (n: string) => join(tmpdir(), `locus-kb-${n}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

// ── T01：v8 → v9 迁移 ───────────────────────────────────────
test("T01 v8→v9 迁移：旧实体 deepEqual，knowledge 空且版本正确，不重建 ID", async () => {
  const r = importMeasurements(emptyState(), { name: "d.csv", csv: "t,v\n0,1" });
  const topic = { id: "tp_fixed", name: "课题", researchQuestion: "Q", createdAt: "t" };
  const v9 = { ...r.state, topics: [topic] };
  const v8 = { ...v9, version: 8 } as Record<string, unknown>;
  delete v8.knowledge;
  const path = tmp("migrate");
  writeFileSync(path, JSON.stringify(v8), "utf8");
  const back = await new JsonFileStore(path).load();
  rmSync(path, { force: true });

  assert.equal(back.version, STATE_VERSION);
  assert.equal(STATE_VERSION, 9);
  assert.deepEqual(back.knowledge, emptyKnowledge());
  assert.equal(back.knowledge.schemaVersion, KNOWLEDGE_SCHEMA_VERSION);
  assert.deepEqual(back.topics[0], topic);          // 旧实体逐字段相等
  assert.equal(back.topics[0].id, "tp_fixed");       // 不重建 ID
  // 与磁盘 JSON 归一后的旧实体逐字段相等（undefined 键在 JSON 中不存在）
  assert.deepEqual(back.tables[0], JSON.parse(JSON.stringify(r.state.tables[0])));
});

// ── T02：损坏/未知/缺集合显式拒绝；不存在才新建 ─────────────
test("T02 损坏JSON/缺knowledge/缺集合/未知schemaVersion → 拒绝；文件不存在才新建", async () => {
  const bad = tmp("bad");
  writeFileSync(bad, "{ broken", "utf8");
  await assert.rejects(() => new JsonFileStore(bad).load(), /损坏/);
  rmSync(bad, { force: true });

  const noKn = tmp("nokn");
  writeFileSync(noKn, JSON.stringify({ version: 9, topics: [] }), "utf8");
  await assert.rejects(() => new JsonFileStore(noKn).load(), /缺 knowledge/);
  rmSync(noKn, { force: true });

  const missingColl = tmp("missingcoll");
  const k = emptyKnowledge() as unknown as Record<string, unknown>;
  delete k.sourceVersions;
  writeFileSync(missingColl, JSON.stringify({ ...emptyState(), knowledge: k }), "utf8");
  await assert.rejects(() => new JsonFileStore(missingColl).load(), /缺集合 sourceVersions/);
  rmSync(missingColl, { force: true });

  const badSchema = tmp("badschema");
  writeFileSync(badSchema, JSON.stringify({ ...emptyState(), knowledge: { ...emptyKnowledge(), schemaVersion: 99 } }), "utf8");
  await assert.rejects(() => new JsonFileStore(badSchema).load(), /不支持的知识 schemaVersion/);
  rmSync(badSchema, { force: true });

  const none = tmp("none");
  const fresh = await new JsonFileStore(none).load();
  assert.deepEqual(fresh, emptyState());
});

// ── T03：源纳管后更正两次，各版本可读，更早未知版不可用 ──────
test("T03 源纳管后更正两次：v1/v2/v3 各有可读 payload；未知更早版 history_unavailable", () => {
  let s = importMeasurements(emptyState(), { name: "d.csv", csv: "t,v\n0,1" }).state;
  const tableId = s.tables[0].id;
  let k = emptyKnowledge();

  const ref1 = currentSourceRef(s, "table", tableId)!;
  k = archiveSourceVersion(k, ref1, sourcePayload(s, "table", tableId));
  s = reviewTable(s, tableId, { cellUpdates: [{ row: 0, col: 1, value: "9" }], reason: "更正1" });
  const ref2 = currentSourceRef(s, "table", tableId)!;
  k = archiveSourceVersion(k, ref2, sourcePayload(s, "table", tableId));
  s = reviewTable(s, tableId, { cellUpdates: [{ row: 0, col: 1, value: "5" }], reason: "更正2" });
  const ref3 = currentSourceRef(s, "table", tableId)!;
  k = archiveSourceVersion(k, ref3, sourcePayload(s, "table", tableId));

  assert.equal(ref1.version, "r:1");
  assert.equal(ref2.version, "r:2");
  assert.equal(ref3.version, "r:3");
  assert.equal((readSourceVersion(k, ref1) as { rows: string[][] }).rows[0][1], "1");
  assert.equal((readSourceVersion(k, ref2) as { rows: string[][] }).rows[0][1], "9");
  assert.equal((readSourceVersion(k, ref3) as { rows: string[][] }).rows[0][1], "5");
  assert.equal(k.sourceVersions.length, 3); // 每键只追加一次

  // 更早的未知版本不可用（不读 latest 冒充）
  const unknownEarlier = makeSourceRef("table", tableId, "r:0", "deadbeef");
  assert.equal(resolveSourceVersion(s, k, unknownEarlier).status, "history_unavailable");
  // 已归档旧版本仍可读（即使当前已是 r:3）
  const okOld = resolveSourceVersion(s, k, ref1);
  assert.equal(okOld.status, "ok");
  assert.equal((okOld as { payload: { rows: string[][] } }).payload.rows[0][1], "1");
});

// ── T21：来源缺失 / hash 漂移 / 未纳管历史 ──────────────────
test("T21 源不存在→source_missing；已归档同版本 hash 不符→content_mismatch", () => {
  const s = importMeasurements(emptyState(), { name: "d.csv", csv: "t,v\n0,1" }).state;
  const tableId = s.tables[0].id;
  const ref = currentSourceRef(s, "table", tableId)!;
  const k = archiveSourceVersion(emptyKnowledge(), ref, sourcePayload(s, "table", tableId));

  // 已归档但篡改 ref.contentHash → content_mismatch（不覆盖存档）
  const drift = makeSourceRef("table", tableId, ref.version, "tampered");
  assert.equal(resolveSourceVersion(s, k, drift).status, "content_mismatch");

  // 来源已删除且未归档 → source_missing
  const sNoTable = { ...s, tables: [] };
  const gone = makeSourceRef("table", "tbl_missing", "r:1", "x");
  assert.equal(resolveSourceVersion(sNoTable, emptyKnowledge(), gone).status, "source_missing");
});

// ── T20：全库导出 → 隔离恢复（含 knowledge / 源历史 / run / 快照）──
test("T20 全库导出→隔离恢复：knowledge、源历史、run receipt、快照完整且 hash 有效", async () => {
  let s = importMeasurements(emptyState(), { name: "d.csv", csv: "t,v\n0,1" }).state;
  const tableId = s.tables[0].id;
  const ref = currentSourceRef(s, "table", tableId)!;
  let k = archiveSourceVersion(s.knowledge, ref, sourcePayload(s, "table", tableId));
  const snapshot = {
    snapshotId: "snap_1", createdAt: "t", schemaVersion: 1, projectionVersion: 1, mode: "formal",
    scope: { topicId: "tp1", source: "current" }, contentHash: "h", content: { items: [], contexts: [], evidence: [], relations: [], datasets: [], themes: [], mappings: [], comparisons: [], referenceMap: {} },
    sourceVersionRefs: [ref], mappingRefs: [], coverage: { selected: 1, totalAvailable: 1, processed: 1, omittedReasons: [] }, excluded: [],
  };
  const run = {
    id: "run_1", idempotencyKey: "k1", inputHash: "ih", paperRef: makeSourceRef("paper", "p1", "r:1", "x"), attachmentRefs: [],
    purpose: "目的", promptVersion: "knowledge_extract/v1", schemaVersion: 1, createdAt: "t", updatedAt: "t", status: "completed",
    chunks: [{ id: "c1", sourceRef: ref, start: 0, end: 1, additionalRanges: [], sourceTextHash: "h", status: "committed",
      receipt: { inputHash: "ih", committedAt: "t", cardIds: [], itemIds: [], contextIds: [], evidenceIds: [], relationIds: [], response: { created: 0, skipped: 0, createdItems: 0, pendingItems: 0 } } }],
  };
  k = { ...k, snapshots: [snapshot as never], extractionRuns: [run as never] };
  s = { ...s, knowledge: k };

  buildWholeLibraryPackage(s); // 生成不抛（含 knowledge）
  const stateJson = JSON.stringify(s, null, 2);
  const insp = inspectLibraryJson(stateJson, sha256(stateJson));
  assert.equal(insp.ok, true);
  assert.equal(insp.counts?.sourceVersions, 1);
  assert.equal(insp.counts?.knowledgeSnapshots, 1);
  assert.equal(insp.counts?.knowledgeRuns, 1);

  const path = tmp("restore");
  writeFileSync(path, stateJson, "utf8");
  const back = await new JsonFileStore(path).loadStrict();
  rmSync(path, { force: true });
  assert.equal(back.knowledge.sourceVersions.length, 1);
  assert.equal(back.knowledge.snapshots.length, 1);
  assert.equal(back.knowledge.extractionRuns.length, 1);
  assert.deepEqual(back.knowledge.extractionRuns[0], run);
});

// ── §7.3 hash 规范与引用不可误合并 ──────────────────────────
test("hash：键序无关、数组顺序有关；同 kind/id 不同 revision 不合并", () => {
  assert.equal(canonicalHash({ a: 1, b: 2 }), canonicalHash({ b: 2, a: 1 }));
  assert.notEqual(canonicalHash([1, 2]), canonicalHash([2, 1]));
  const r1 = makeKnowledgeRef("item", "i1", 1);
  const r2 = makeKnowledgeRef("item", "i1", 2);
  assert.equal(sameRef(r1, r2), true);
  assert.notEqual(refKey(r1), refKey(r2));
  assert.throws(() => assertKnowledgeShape({ schemaVersion: 1, items: [] }), /缺集合/);
});

// ══ E3：分项人审（合同 §4.2/§4.6/§4.7、§11 T13–T16、T25）═══════════════

const ASSET_TEXT = "石墨烯电极在25 °C下响应时间0.8 s。重复测量3次取平均值。电解液pH 7.0。对照同样pH 7.0。";
const envOf = <P>(id: string, payload: P): { id: string; revision: number; createdAt: string; updatedAt: string; payload: P; history: never[] } =>
  ({ id, revision: 1, createdAt: "t", updatedAt: "t", payload, history: [] });

function expectErr(fn: () => unknown): AppError {
  try { fn(); } catch (e) { return e as AppError; }
  throw new Error("应当拒绝，但没有抛错");
}
const code = (e: AppError): string => String((e.details as { code?: string } | undefined)?.code ?? "");

/** 夹具：课题＋原件＋数据表＋一张卡，可按需挂 N 个分项（每项一条已定位引文）。 */
function seed(over: { items?: number; withContext?: boolean; shell?: boolean } = {}) {
  const t = createTopic(emptyState(), { name: "课题甲", researchQuestion: "Q" });
  const asset = makeAsset("literature", "a1.md", ASSET_TEXT);
  let s: LocusState = { ...t.state, assets: [...t.state.assets, asset] };
  s = importMeasurements(s, { name: "d.csv", csv: "t,v\n0,1", topicId: t.topic.id }).state;
  const ref = currentSourceRef(s, "asset", asset.id)!;
  s = { ...s, knowledge: archiveSourceVersion(s.knowledge, ref, sourcePayload(s, "asset", asset.id)) };
  const card = addManualCard(s, { assetId: asset.id, rawText: "石墨烯电极在25 °C下响应时间0.8 s。" });
  s = card.state;
  const cardId = card.card.id;
  const topicId = t.topic.id;
  const base = { state: s, topicId, cardId, ref, assetId: asset.id, tableId: s.tables[0].id, card: card.card };

  const n = over.items ?? 0;
  if (!n) return base;
  let k = s.knowledge;
  const itemIds: string[] = [];
  let contextId = "";
  if (over.withContext) {
    contextId = "kctx_1";
    k = { ...k, contexts: [envOf(contextId, {
      researchUnitId: "unit1", subject: "石墨烯电极", groupLabel: "G1", stage: "测试", methodRefs: [],
      conditions: [
        { id: "kcn_1", field: { raw: "温度" }, value: { kind: "scalar", raw: "25 °C", value: "25", unit: "°C" }, appliesTo: { subject: "石墨烯电极", stage: "测试" }, evidenceRefs: [], obtainedBy: "human_record", review: { status: "pending" } },
        { id: "kcn_2", field: { raw: "电解液" }, value: { kind: "category", raw: "pH 7.0", label: "pH 7.0" }, appliesTo: { subject: "石墨烯电极", stage: "测试" }, evidenceRefs: [], obtainedBy: "human_assumption", review: { status: "pending" } },
      ],
      unknowns: [], topicIds: [topicId], subquestionIds: [], review: { status: "pending" },
    })] };
  }
  for (let i = 0; i < n; i++) {
    const evId = `kev_${i + 1}`;
    const quote = i === 0 ? "响应时间0.8 s" : "重复测量3次";
    const start = ASSET_TEXT.indexOf(quote);
    k = { ...k, evidence: [...k.evidence, envOf(evId, { sourceRef: ref, locator: { type: "text", start, end: start + quote.length }, quote, locationStatus: "matched" as LocationStatus, candidates: [] })] };
    const itemId = `ki_${i + 1}`;
    itemIds.push(itemId);
    k = { ...k, items: [...k.items, envOf(itemId, {
      contentType: "observation", nature: i === 0 ? "observation" : "to_verify",
      text: i === 0 ? "25 °C下响应时间0.8 s" : "重复测量3次取平均",
      subject: { raw: "石墨烯电极" }, predicate: { raw: i === 0 ? "响应时间" : "测量次数" },
      value: i === 0 ? { kind: "scalar", raw: "0.8 s", value: "0.8", unit: "s" } : { kind: "scalar", raw: "3次", value: "3", unit: "次" },
      contextRefs: contextId ? [{ kind: "context", id: contextId, revision: 1 }] : [],
      evidenceRefs: [{ ref: { kind: "evidence", id: evId, revision: 1 }, fieldPaths: ["quote"] }],
      sourceRefs: [ref],
      origin: { sourceClass: "literature_report", createdBy: "model", secondaryCitation: false },
      scopeText: "", unknowns: [], topicIds: [topicId], subquestionIds: [],
      review: { status: "pending" }, cardId,
    })] };
  }
  let state: LocusState = { ...s, knowledge: k, cards: s.cards.map((c) => (c.id === cardId ? { ...c, knowledgeItemIds: over.shell === false ? undefined : itemIds } : c)) };
  state = syncShellAudit(state, cardId);
  return { ...base, state, itemIds, contextId };
}

const itemPayloadOf = (s: LocusState, id: string, revision: number) =>
  readKnowledgeVersion(s.knowledge, { kind: "item", id, revision }) as { text: string; review: { status: string }; value: { value: string | null } };

// ── T13：一卡两项，一确认一待审 ────────────────────────────
test("T13 一卡两项一确认一待审：正式范围只含确认项，整卡选择不能夹带待审", () => {
  const b = seed({ items: 2 });
  assert.equal(b.state.cards[0].audit, "unreviewed", "全待审 → 派生 unreviewed");

  const r1 = reviewKnowledgeItem(b.state, b.itemIds[0], { baseRevision: 1, decision: "confirmed", basis: "逐字对照原文25 °C段" });
  const s1 = r1.state;
  assert.equal(r1.item.payload.review.status, "confirmed");
  assert.equal(s1.cards[0].audit, "need_info", "一确认一待审 → 派生 need_info，不给整卡确认");

  // 整卡选择：夹带待审项 → 422，指向分项
  const whole = expectErr(() => createAnalysisTask(s1, { topicId: b.topicId, title: "分析", core: [{ kind: "table", id: b.tableId }, { kind: "card", id: b.cardId }] }));
  assert.equal(whole.status, 422);
  assert.equal(code(whole), "structured_knowledge_required");

  // 逐项选择：已确认项可入，未确认项拒绝
  const okTask = createAnalysisTask(s1, { topicId: b.topicId, title: "分析", core: [{ kind: "table", id: b.tableId }, { kind: "item", id: b.itemIds[0], revision: 2 }] });
  assert.equal(okTask.task.core.length, 2);
  const pendingRef = expectErr(() => createAnalysisTask(s1, { topicId: b.topicId, title: "分析2", core: [{ kind: "table", id: b.tableId }, { kind: "item", id: b.itemIds[1], revision: 1 }] }));
  assert.equal(pendingRef.status, 422);
  assert.equal(code(pendingRef), "item_not_confirmed");

  // 知识项引用必须固定版本（不 latest 兜底）
  const noRev = expectErr(() => createAnalysisTask(s1, { topicId: b.topicId, title: "分析3", core: [{ kind: "table", id: b.tableId }, { kind: "item", id: b.itemIds[0] } as never] }));
  assert.equal(noRev.status, 422);
  assert.equal(code(noRev), "revision_required");

  // 对话：确认项入范围；冻结前复检，若已选项被改回待审则拒绝送模型
  const chat = createChat(s1, { topicId: b.topicId, scope: [{ kind: "item", id: b.itemIds[0], revision: 2 }] });
  const snap = chatScopeSnapshot(chat.state, chat.chat, "问答", "m");
  assert.equal(snap.fragments.length, 1);
  const demoted = reviewKnowledgeItem(chat.state, b.itemIds[0], { baseRevision: 2, decision: "needs_info", basis: "再核对单位" }).state;
  const frozenErr = expectErr(() => chatScopeSnapshot(demoted, demoted.chats[0], "问答", "m"));
  assert.equal(frozenErr.status, 422);
  assert.equal(code(frozenErr), "item_not_confirmed");

  // 第二项确认后整壳才可用，且摘录逐项呈现（不拿 rawText 概述冒充）
  const s2 = reviewKnowledgeItem(s1, b.itemIds[1], { baseRevision: 1, decision: "confirmed", basis: "对照第二句原文" }).state;
  assert.equal(s2.cards[0].audit, "confirm", "全部确认 → 派生 confirm");
  const frag = resolveFragment(s2, { kind: "card", id: b.cardId });
  assert.ok(frag.excerpt.includes("25 °C下响应时间0.8 s") && frag.excerpt.includes("重复测量3次取平均"), "整壳展开为分项内容");
  assert.ok(frag.excerpt.includes("性质：观察") && frag.excerpt.includes("引文"), "呈现性质与引文而非摘要");
  assert.ok(!frag.excerpt.startsWith("石墨烯电极在25 °C下响应时间0.8 s。"), "不退回旧 rawText 概述");
});

// ── T14：改 value/条件/来源/nature → 新版 pending；旧版可读；409 保护过期编辑 ──
test("T14 修改value/条件/来源/nature：新revision变pending，旧确认快照可读，409保护过期编辑", () => {
  const b = seed({ items: 2, withContext: true });
  // 条件未审 → 项不能确认（§4.2 先审条件）
  const blocked = expectErr(() => reviewKnowledgeItem(b.state, b.itemIds[0], { baseRevision: 1, decision: "confirmed", basis: "先看值" }));
  assert.equal(blocked.status, 422);
  assert.equal(code(blocked), "context_pending");

  const ctx = reviewKnowledgeContext(b.state, b.contextId, { baseRevision: 1, decision: "confirmed", basis: "温度按原文", conditionIds: ["kcn_1"] });
  assert.equal(ctx.context.payload.review.status, "needs_info", "只确认部分条件 → 整体仍不可用");
  assert.deepEqual(ctx.pendingConditions.sort(), ["kcn_2"]);
  const ctxAll = reviewKnowledgeContext(ctx.state, b.contextId, { baseRevision: 2, decision: "confirmed", basis: "电解液按批次记录", conditionIds: ["kcn_2"] });
  assert.equal(ctxAll.context.payload.review.status, "confirmed");

  const s0 = ctxAll.state;
  const ok = reviewKnowledgeItem(s0, b.itemIds[0], { baseRevision: 1, decision: "confirmed", basis: "逐字核对" });
  assert.equal(ok.item.revision, 2, "审核也生成新 revision");

  // 改值：新 revision + pending，旧确认版仍可读
  const upd = updateKnowledgeItem(ok.state, b.itemIds[0], { baseRevision: 2, patch: { value: { kind: "scalar", raw: "0.9 s", value: "0.9", unit: "s" } }, reason: "复算" });
  assert.equal(upd.item.revision, 3);
  assert.equal(upd.scientific, true);
  assert.equal(upd.item.payload.review.status, "pending", "科学内容更改回待审");
  assert.equal(itemPayloadOf(upd.state, b.itemIds[0], 2)!.review.status, "confirmed", "旧确认快照可读");
  assert.equal(itemPayloadOf(upd.state, b.itemIds[0], 2)!.value.value, "0.8");
  assert.equal(itemPayloadOf(upd.state, b.itemIds[0], 3)!.value.value, "0.9");
  const oldFrag = resolveFragment(upd.state, { kind: "item", id: b.itemIds[0], revision: 2 });
  assert.ok(oldFrag.excerpt.includes("0.8 s") && oldFrag.version.includes("第2版"), "固定版本呈现旧值");

  // 过期编辑 → 409（不覆盖他人编辑）
  const stale = expectErr(() => updateKnowledgeItem(upd.state, b.itemIds[0], { baseRevision: 2, patch: { value: { kind: "scalar", raw: "1.2 s", value: "1.2", unit: "s" } } }));
  assert.equal(stale.status, 409);
  assert.equal(code(stale), "stale_revision");

  // 改 nature / 来源：同样 pending；不可读来源被拒
  const nat = updateKnowledgeItem(upd.state, b.itemIds[0], { baseRevision: 3, patch: { nature: "hypothesis" } });
  assert.equal(nat.item.payload.review.status, "pending");
  const badSource = expectErr(() => updateKnowledgeItem(nat.state, b.itemIds[0], { baseRevision: 4, patch: { sourceRefs: [{ kind: "asset", id: "nope", version: "r:1", contentHash: "x" }] } }));
  assert.equal(badSource.status, 422);
  assert.equal(code(badSource), "source_missing");

  // 改条件值 → 该条件回 pending，另一条件保留审核；旧版条件仍可回查；已确认依赖项回 pending（§4.7）
  const ctxUpd = updateKnowledgeContext(ok.state, b.contextId, {
    baseRevision: 3,
    patch: { conditions: [
      { id: "kcn_1", field: { raw: "温度" }, value: { kind: "scalar", raw: "30 °C", value: "30", unit: "°C" }, appliesTo: { subject: "石墨烯电极", stage: "测试" }, evidenceRefs: [], obtainedBy: "human_record" },
      { id: "kcn_2", field: { raw: "电解液" }, value: { kind: "category", raw: "pH 7.0", label: "pH 7.0" }, appliesTo: { subject: "石墨烯电极", stage: "测试" }, evidenceRefs: [], obtainedBy: "human_assumption" },
    ] },
  });
  assert.equal(ctxUpd.context.revision, 4);
  assert.equal(ctxUpd.context.payload.review.status, "pending", "条件更改 → 整体待审");
  assert.deepEqual(ctxUpd.affectedItems, [{ id: b.itemIds[0], revision: 3 }], "已确认的依赖项被标记复审");
  assert.equal(itemPayloadOf(ctxUpd.state, b.itemIds[0], 2)!.review.status, "confirmed", "旧确认版不被改写");
  assert.equal(itemPayloadOf(ctxUpd.state, b.itemIds[0], 3)!.review.status, "pending", "最新版回到待审");
  assert.equal(ctxUpd.context.payload.conditions[0].review.status, "pending", "改动的条件回待审");
  assert.equal(ctxUpd.context.payload.conditions[1].review.status, "confirmed", "未改动的条件保留审核");
  assert.equal((readKnowledgeVersion(ctxUpd.state.knowledge, { kind: "context", id: b.contextId, revision: 3 }) as { conditions: { review: { status: string } }[] }).conditions[0].review.status, "confirmed", "旧版条件仍可回查");
});

// ── T15：重要度/备注不改科学性质；伪造生命周期不生效 ──────────
test("T15 修改重要度与普通备注不改变科学性质；更新里偷传review/history/origin不生效", () => {
  const b = seed({ items: 2 });
  const confirmed = reviewKnowledgeItem(b.state, b.itemIds[0], { baseRevision: 1, decision: "confirmed", basis: "核对原文" });
  const noted = reviewCard(confirmed.state, b.cardId, { importance: "high", note: "先看这一项" });
  const card = noted.cards.find((c) => c.id === b.cardId)!;
  assert.equal(card.importance, "high");
  assert.equal(card.audit, "need_info", "备注/重要度不改变派生审计");
  assert.equal(itemPayloadOf(noted, b.itemIds[0], 2)!.review.status, "confirmed", "分项审核不受卡片备注影响");

  for (const key of ["review", "history", "revision", "origin", "cardId", "createdFromRunId"]) {
    const e = expectErr(() => updateKnowledgeItem(noted, b.itemIds[0], { baseRevision: 2, patch: { [key]: key === "review" ? { status: "excluded" } : "x" } }));
    assert.equal(e.status, 422, `${key} 应拒绝`);
    assert.equal(code(e), "lifecycle_field_forbidden", `${key} 应给出可解释错误码`);
  }
  const stillConfirmed = itemPayloadOf(noted, b.itemIds[0], 2)!;
  assert.equal(stillConfirmed.review.status, "confirmed", "伪造尝试未写入任何东西");

  // 条件里夹带 review 同样拒绝
  const b2 = seed({ items: 1, withContext: true });
  const condErr = expectErr(() => updateKnowledgeContext(b2.state, b2.contextId, {
    baseRevision: 1,
    patch: { conditions: [{ id: "kcn_1", field: { raw: "温度" }, value: { kind: "scalar", raw: "25 °C", value: "25", unit: "°C" }, appliesTo: { subject: "x", stage: "y" }, evidenceRefs: [], obtainedBy: "human_record", review: { status: "confirmed" } }] },
  }));
  assert.equal(condErr.status, 422);
  assert.equal(code(condErr), "lifecycle_field_forbidden");

  // 非法值/枚举不猜、不静默降级
  assert.equal(expectErr(() => updateKnowledgeItem(noted, b.itemIds[0], { baseRevision: 2, patch: { value: { kind: "scalar", raw: "约0.8秒", value: "0.8s" , unit: "s" } } })).status, 422);
  assert.equal(expectErr(() => updateKnowledgeItem(noted, b.itemIds[0], { baseRevision: 2, patch: { nature: "fact" } })).status, 422);
  assert.equal(describeValue({ kind: "missing", raw: "未报", reasonCode: "not_reported_in_checked_scope" }).includes("缺失"), true);
});

// ── T16：旧卡显式结构化 ────────────────────────────────────
test("T16 旧卡无逐项绑定→显式结构化：旧版仍可回查，新结构待审，不双编辑fields", () => {
  const b = seed({});
  const before = b.state;
  const out = structureLegacyCard(before, b.cardId, {
    baseRevision: b.card.revision,
    evidence: [{ localId: "e1", quote: "响应时间0.8 s" }],
    contexts: [{ localId: "c1", subject: "石墨烯电极", groupLabel: "G1", stage: "测试", topicIds: [b.topicId], conditions: [
      { field: { raw: "温度" }, value: { kind: "scalar", raw: "25 °C", value: "25", unit: "°C" }, appliesTo: { subject: "石墨烯电极", stage: "测试" }, evidenceRefs: [], obtainedBy: "source_explicit" },
    ] }],
    items: [{ localId: "i1", contentType: "observation", nature: "observation", text: "25 °C下响应时间0.8 s", topicIds: [b.topicId], value: { kind: "scalar", raw: "0.8 s", value: "0.8", unit: "s" }, contextRefs: [{ kind: "context", localId: "c1" }], evidenceRefs: [{ localId: "e1", fieldPaths: ["quote"] }] }],
  });
  assert.equal(out.itemIds.length, 1);
  const item = out.state.knowledge.items[0];
  assert.equal(item.payload.review.status, "pending", "新结构一律待审");
  assert.equal(item.payload.cardId, b.cardId);
  assert.equal((item.payload.contextRefs[0] as { revision: number }).revision, 1);
  const cond = (out.state.knowledge.contexts[0].payload as { conditions: { obtainedBy: string; evidenceRefs: unknown[] }[] }).conditions[0];
  assert.equal(cond.obtainedBy, "source_explicit");

  const card = out.state.cards.find((c) => c.id === b.cardId)!;
  assert.deepEqual(card.knowledgeItemIds, out.itemIds);
  assert.equal(card.audit, "unreviewed", "壳审计由分项派生");
  assert.equal(card.rawText, b.card.rawText, "旧 rawText 保留不覆盖");
  assert.equal(card.revision, b.card.revision + 1);

  // 旧版仍可回查：结构化前的卡被纳管，payload 就是当时的 rawText/fields
  const oldRef = currentSourceRef(before, "card", b.cardId)!;
  const archived = out.state.knowledge.sourceVersions.find((v) => `${v.sourceRef.kind}:${v.sourceRef.id}@${v.sourceRef.version}` === `card:${b.cardId}@${oldRef.version}`);
  assert.ok(archived, "结构化前版本已纳管");
  assert.equal((archived!.payload as { rawText: string }).rawText, b.card.rawText);

  // 不双编辑：结构化后旧字段编辑入口 409
  const dbl = expectErr(() => reviewCard(out.state, b.cardId, { extracted: { fields: { 响应时间: "0.9 s" } }, reason: "改草稿" }));
  assert.equal(dbl.status, 409);

  // 幂等与前置校验
  assert.equal(code(expectErr(() => structureLegacyCard(out.state, b.cardId, { baseRevision: card.revision, items: [{ contentType: "claim", nature: "observation", text: "x" }] }))), "already_structured");
  assert.equal(expectErr(() => structureLegacyCard(before, b.cardId, { baseRevision: 99, items: [{ contentType: "claim", nature: "observation", text: "x" }] })).status, 409);
  assert.equal(code(expectErr(() => structureLegacyCard(before, b.cardId, { baseRevision: b.card.revision, items: [] }))), "items_required");

  // 结构化后的壳在未确认前不能进分析（§4.6.9）
  const taskErr = expectErr(() => createAnalysisTask(out.state, { topicId: b.topicId, title: "分析", core: [{ kind: "table", id: b.tableId }, { kind: "card", id: b.cardId }] }));
  assert.equal(taskErr.status, 422);
  assert.equal(code(taskErr), "structured_knowledge_required");
});

test("T16b 结构化引文可锚定原件：只给 {kind,id} 由服务端补版本与 hash；来源不可读即 422，不降级为卡片锚定", () => {
  const b = seed({});
  const quote = "重复测量3次"; // 在原件里存在，但不在卡片文字里 → 锚错来源就会 unmatched
  const items = [{ localId: "i1", contentType: "observation", nature: "observation", text: "重复测量3次取平均值", topicIds: [b.topicId], evidenceRefs: [{ localId: "e1" }] }];
  const out = structureLegacyCard(b.state, b.cardId, {
    baseRevision: b.card.revision,
    evidence: [{ localId: "e1", sourceRef: { kind: "asset", id: b.assetId }, quote }],
    items,
  });
  const ev = out.state.knowledge.evidence[0].payload as { sourceRef: { version: string; contentHash: string }; locationStatus: string; quote: string };
  assert.equal(ev.locationStatus, "matched", "锚定原件后逐字命中");
  assert.equal(ev.sourceRef.version, b.ref.version, "版本由服务端补齐，不接受客户端自称");
  assert.equal(ev.sourceRef.contentHash, b.ref.contentHash);
  const err = expectErr(() => structureLegacyCard(b.state, b.cardId, {
    baseRevision: b.card.revision,
    evidence: [{ localId: "e1", sourceRef: { kind: "asset", id: "ast_none" }, quote }],
    items,
  }));
  assert.equal(err.status, 422);
  assert.equal(code(err), "source_missing");
  // 结构不符（既非完整引用也非 {kind,id}）→ 422，不静默当作卡片锚定
  const bad = expectErr(() => structureLegacyCard(b.state, b.cardId, {
    baseRevision: b.card.revision,
    evidence: [{ localId: "e1", sourceRef: { kind: "asset" }, quote }],
    items,
  }));
  assert.equal(bad.status, 422);
  assert.equal(code(bad), "source_ref_invalid");
});

test("T16c 结构化的条件可引用同批引文（localId）；引文已定位后条件才能确认，来源方式不符即拒", () => {
  const b = seed({});
  const cond = {
    field: { raw: "温度" }, value: { kind: "scalar", raw: "25 °C", value: "25", unit: "°C" },
    appliesTo: { subject: "石墨烯电极", stage: "测试" },
    evidenceRefs: [{ kind: "evidence", localId: "e1" }], obtainedBy: "source_explicit",
  };
  const out = structureLegacyCard(b.state, b.cardId, {
    baseRevision: b.card.revision,
    evidence: [{ localId: "e1", quote: "响应时间0.8 s" }],
    contexts: [{ localId: "c1", subject: "石墨烯电极", topicIds: [b.topicId], conditions: [cond] }],
    items: [{ localId: "i1", contentType: "observation", nature: "observation", text: "25 °C下响应时间0.8 s", topicIds: [b.topicId], evidenceRefs: [{ localId: "e1" }] }],
  });
  const c0 = out.state.knowledge.contexts[0].payload as { conditions: { id: string; evidenceRefs: { kind: string; revision: number }[]; review: { status: string } }[] };
  assert.equal(c0.conditions[0].evidenceRefs.length, 1, "localId 已绑成真实引文引用");
  assert.equal(c0.conditions[0].evidenceRefs[0].kind, "evidence");
  assert.equal(c0.conditions[0].evidenceRefs[0].revision, 1);
  assert.equal(c0.conditions[0].review.status, "pending", "新建条件一律待审");
  const ok = reviewKnowledgeContext(out.state, out.contextIds[0], { baseRevision: 1, decision: "confirmed", basis: "与原文逐字核对", conditionIds: [c0.conditions[0].id] });
  assert.equal((ok.context.payload as unknown as { conditions: { review: { status: string } }[] }).conditions[0].review.status, "confirmed");
  // 未登记的 localId → 422，不静默丢引用
  const miss = expectErr(() => structureLegacyCard(b.state, b.cardId, {
    baseRevision: b.card.revision,
    evidence: [{ localId: "e1", quote: "响应时间0.8 s" }],
    contexts: [{ localId: "c1", subject: "石墨烯电极", topicIds: [b.topicId], conditions: [{ ...cond, evidenceRefs: [{ kind: "evidence", localId: "nope" }] }] }],
    items: [{ localId: "i1", contentType: "observation", nature: "observation", text: "x", topicIds: [b.topicId], evidenceRefs: [{ localId: "e1" }] }],
  }));
  assert.equal(miss.status, 422);
  assert.equal(code(miss), "local_ref_missing");
});

// ── T25：普通 reviewCard 不能确认新壳；旧卡正常流程仍通过 ────────
test("T25 普通reviewCard确认新壳被拒；伪造item审核不生效；旧卡正常流程仍过", () => {
  const b = seed({ items: 2 });
  const forged = expectErr(() => reviewCard(b.state, b.cardId, { audit: "confirm", reason: "整卡确认" }));
  assert.equal(forged.status, 409);
  assert.equal(b.state.cards.find((c) => c.id === b.cardId)!.audit, "unreviewed", "拒绝绕过，审计仍是派生值");

  const c1 = reviewKnowledgeItem(b.state, b.itemIds[0], { baseRevision: 1, decision: "confirmed", basis: "核对" });
  const downgrade = expectErr(() => reviewCard(c1.state, b.cardId, { audit: "unreviewed", reason: "想改回去" }));
  assert.equal(downgrade.status, 409, "壳卡审计也不能被客户端降级");

  const c2 = reviewKnowledgeItem(c1.state, b.itemIds[1], { baseRevision: 1, decision: "confirmed", basis: "核对" });
  assert.equal(c2.state.cards.find((c) => c.id === b.cardId)!.audit, "confirm");
  assert.equal(createAnalysisTask(c2.state, { topicId: b.topicId, title: "分析", core: [{ kind: "table", id: b.tableId }, { kind: "card", id: b.cardId }] }).task.core.length, 2, "全确认后的壳可用");

  // 旧卡（无逐项绑定）走原路径
  const legacy = seed({});
  const okOld = reviewCard(legacy.state, legacy.cardId, { audit: "confirm", reason: "人工核对" });
  assert.equal(okOld.cards.find((c) => c.id === legacy.cardId)!.audit, "confirm");
  assert.equal(createAnalysisTask(okOld, { topicId: legacy.topicId, title: "分析", core: [{ kind: "table", id: legacy.tableId }, { kind: "card", id: legacy.cardId }] }).task.core.length, 2);
});

// ── E3 引文改绑：定位后旧引用不自动升级，须人工改绑当前版（§4.6.9）──
test("T16d 引文定位后改绑当前版：条件与知识项钉在旧版时被拒，改绑后才能确认", () => {
  const b = seed({ items: 1, withContext: true });
  const unlocated: LocusState = {
    ...b.state,
    knowledge: { ...b.state.knowledge, evidence: b.state.knowledge.evidence.map((e) => (e.id === "kev_1"
      ? { ...e, payload: { ...e.payload, locationStatus: "unmatched", locator: { type: "unresolved", description: "未命中" } } } : e)) },
  };
  const condsOf = (s: LocusState) => (s.knowledge.contexts[0].payload as unknown as { conditions: Record<string, unknown>[] }).conditions;
  const clean = (c: Record<string, unknown>, revision: number) => ({
    id: c.id, field: c.field, value: c.value, appliesTo: c.appliesTo, obtainedBy: c.obtainedBy,
    evidenceRefs: c.id === "kcn_1" ? [{ kind: "evidence", id: "kev_1", revision }] : (c.evidenceRefs as unknown[]) ?? [],
  });
  const withRef = updateKnowledgeContext(unlocated, "kctx_1", { baseRevision: 1, patch: { conditions: condsOf(unlocated).map((c) => clean(c, 1)) }, reason: "条件绑到引文" });
  assert.equal(withRef.context.revision, 2);
  const blocked = expectErr(() => reviewKnowledgeContext(withRef.state, "kctx_1", { baseRevision: 2, decision: "confirmed", basis: "逐项核对", conditionIds: ["kcn_1"] }));
  assert.equal(code(blocked), "evidence_unresolved");
  const fixed = resolveKnowledgeEvidence(withRef.state, "kev_1", { baseRevision: 1, quote: "响应时间0.8 s", basis: "按第一句" });
  assert.equal(fixed.evidence.revision, 2);
  const still = expectErr(() => reviewKnowledgeContext(fixed.state, "kctx_1", { baseRevision: 2, decision: "confirmed", basis: "逐项核对", conditionIds: ["kcn_1"] }));
  assert.equal(code(still), "evidence_unresolved", "钉在旧版不自动升级");
  const repoint = updateKnowledgeContext(fixed.state, "kctx_1", { baseRevision: 2, patch: { conditions: condsOf(fixed.state).map((c) => clean(c, 2)) }, reason: "引文定位后改绑当前版" });
  assert.equal(repoint.context.revision, 3);
  const one = reviewKnowledgeContext(repoint.state, "kctx_1", { baseRevision: 3, decision: "confirmed", basis: "逐字核对温度", conditionIds: ["kcn_1"] });
  assert.equal(one.context.payload.conditions.find((c) => c.id === "kcn_1")?.review.status, "confirmed");
  assert.deepEqual(one.pendingConditions, ["kcn_2"], "确认一项后另一项仍待审");
  const itemBlocked = expectErr(() => reviewKnowledgeItem(one.state, "ki_1", { baseRevision: 1, decision: "confirmed", basis: "看起来对" }));
  assert.equal(code(itemBlocked), "evidence_unresolved", "知识项同样钉在旧版");
  const bindings = (one.state.knowledge.items[0].payload as unknown as { evidenceRefs: { fieldPaths?: string[] }[] }).evidenceRefs;
  const itemRepoint = updateKnowledgeItem(one.state, "ki_1", {
    baseRevision: 1,
    patch: { evidenceRefs: bindings.map((x) => ({ ref: { kind: "evidence", id: "kev_1", revision: 2 }, fieldPaths: x.fieldPaths ?? [] })) },
    reason: "引文定位后改绑当前版",
  });
  const itemOk = reviewKnowledgeItem(itemRepoint.state, "ki_1", { baseRevision: 2, decision: "confirmed", basis: "逐字核对" });
  assert.equal(itemOk.item.payload.review.status, "confirmed");
});

// ── E3 定位修订：伪造 matched 不接受，重复句须选唯一偏移 ──────────
test("E3 定位修订：服务端逐字核对，未定位不能确认，多处出现须选唯一偏移", () => {
  const b = seed({ items: 1 });
  const s0 = b.state;
  const wrong = expectErr(() => resolveKnowledgeEvidence(s0, "kev_1", { baseRevision: 1, quote: "响应时间1.2 s" }));
  assert.equal(wrong.status, 422);
  assert.equal(code(wrong), "quote_mismatch");
  const fake = expectErr(() => resolveKnowledgeEvidence(s0, "kev_1", { baseRevision: 1, candidate: { locator: { type: "text", start: 3, end: 10 } } }));
  assert.equal(code(fake), "quote_mismatch", "偏移与原文不符不采信");

  // 未定位的引文：保持 unmatched，确认被拒
  const unlocated: LocusState = {
    ...s0,
    knowledge: {
      ...s0.knowledge,
      evidence: s0.knowledge.evidence.map((e) => {
        if (e.id !== "kev_1") return e;
        return { ...e, payload: { ...e.payload, locationStatus: "unmatched", locator: { type: "unresolved", description: "未命中" } } };
      }),
    },
  };
  const gate = expectErr(() => reviewKnowledgeItem(unlocated, b.itemIds[0], { baseRevision: 1, decision: "confirmed", basis: "看起来对" }));
  assert.equal(gate.status, 422);
  assert.equal(code(gate), "evidence_unresolved");

  const fixed = resolveKnowledgeEvidence(unlocated, "kev_1", { baseRevision: 1, quote: "响应时间0.8 s", basis: "按第一句" });
  assert.equal(fixed.evidence.payload.locationStatus, "matched");
  assert.equal(fixed.evidence.revision, 2);
  // 项仍固定在旧的未定位版本上 → 只提示可更新，不自动升级
  const stillBlocked = expectErr(() => reviewKnowledgeItem(fixed.state, b.itemIds[0], { baseRevision: 1, decision: "confirmed", basis: "看起来对" }));
  assert.equal(code(stillBlocked), "evidence_unresolved");
  const repoint = updateKnowledgeItem(fixed.state, b.itemIds[0], {
    baseRevision: 1,
    patch: { evidenceRefs: [{ ref: { kind: "evidence", id: "kev_1", revision: 2 }, fieldPaths: ["quote"] }] },
    reason: "引文定位更新后重新绑定",
  });
  assert.equal(repoint.item.revision, 2);
  const confirmed = reviewKnowledgeItem(repoint.state, b.itemIds[0], { baseRevision: 2, decision: "confirmed", basis: "逐字核对" });
  assert.equal(confirmed.item.payload.review.status, "confirmed");

  // 重复句：不猜，列候选；选定后 matched
  const dup = resolveKnowledgeEvidence(repoint.state, "kev_1", { baseRevision: 2, quote: "pH 7.0" });
  assert.equal(dup.locationStatus, "ambiguous");
  assert.equal(dup.candidateOffsets.length, 1, "另一处作为候选给出");
  const pick = resolveKnowledgeEvidence(dup.state, "kev_1", { baseRevision: 3, quote: "pH 7.0", candidate: { locator: { type: "text", start: dup.candidateOffsets[0], end: dup.candidateOffsets[0] + 6 } } });
  assert.equal(pick.evidence.payload.locationStatus, "matched");
  assert.equal((pick.evidence.payload.locator as { start: number }).start, dup.candidateOffsets[0]);
});

// ── E3 主题与当前认识门槛 ──────────────────────────────────
test("E3 主题成员/当前认识：未确认不能当当前认识，跨课题须显式确认", () => {
  const b = seed({ items: 2 });
  const st = createKnowledgeStatement(b.state, { topicId: b.topicId, text: "响应时间随温度升高而下降", nature: "hypothesis", createdBy: "model" });
  assert.equal(st.item.payload.review.status, "pending", "AI 陈述只作候选，不自报已确认");
  assert.equal(st.item.payload.origin.createdBy, "model");

  const theme = createKnowledgeTheme(st.state, { topicId: b.topicId, name: "响应动力学", members: [{ kind: "item", id: b.itemIds[0], revision: 1 }, { kind: "item", id: st.item.id, revision: 1 }] });
  assert.equal(theme.theme.payload.members.length, 2);

  const notConfirmed = expectErr(() => updateKnowledgeTheme(theme.state, theme.theme.id, { baseRevision: 1, patch: { currentJudgmentRefs: [{ kind: "item", id: b.itemIds[0], revision: 1 }] } }));
  assert.equal(notConfirmed.status, 422);
  assert.equal(code(notConfirmed), "judgment_not_confirmed");

  const confirmed = reviewKnowledgeItem(theme.state, b.itemIds[0], { baseRevision: 1, decision: "confirmed", basis: "核对" });
  const judged = updateKnowledgeTheme(confirmed.state, theme.theme.id, { baseRevision: 1, patch: { currentJudgmentRefs: [{ kind: "item", id: b.itemIds[0], revision: 2 }] } });
  assert.equal(judged.theme.payload.currentJudgmentRefs.length, 1);
  assert.equal(expectErr(() => updateKnowledgeTheme(judged.state, theme.theme.id, { baseRevision: 1, patch: { name: "改名" } })).status, 409, "过期编辑保护");

  // 跨课题成员：未确认拒绝，确认后放行
  const other = createTopic(judged.state, { name: "课题乙", researchQuestion: "Q2" });
  const cross = expectErr(() => createKnowledgeTheme(other.state, { topicId: other.topic.id, name: "对照", members: [{ kind: "item", id: b.itemIds[0], revision: 2 }] }));
  assert.equal(cross.status, 422);
  assert.equal(code(cross), "cross_topic_confirmation_required");
  const allowed = createKnowledgeTheme(other.state, { topicId: other.topic.id, name: "对照", members: [{ kind: "item", id: b.itemIds[0], revision: 2 }], allowCrossTopic: true });
  assert.equal(allowed.theme.payload.members.length, 1);
});