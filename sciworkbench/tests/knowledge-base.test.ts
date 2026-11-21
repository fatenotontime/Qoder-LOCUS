/**
 * E1 知识基座契约测试：迁移、严格加载、源历史/固定版本、备份恢复。
 * 用例 ID 对应合同 §11（T01–T03、T20–T21）与 §7.3 hash 规范。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, rmSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { emptyState, JsonFileStore, STATE_VERSION } from "../store.ts";
import {
  emptyKnowledge, KNOWLEDGE_SCHEMA_VERSION, canonicalHash, refKey, sameRef,
  sourceRef as makeSourceRef, knowledgeRef as makeKnowledgeRef, assertKnowledgeShape,
} from "../domain/knowledge.ts";
import { importMeasurements, reviewTable, createTopic, makeAsset, addManualCard, reviewCard, createComparison, AppError } from "../services/app.ts";
import { chatScopeSnapshot, createAnalysisTask, createChat, resolveFragment } from "../services/analysis.ts";
import { buildWholeLibraryPackage, inspectLibraryJson, sha256 } from "../services/export.ts";
import {
  archiveSourceVersion, currentSourceRef, readSourceVersion, resolveSourceVersion, sourcePayload,
  createKnowledgeStatement, createKnowledgeTheme, describeValue, readKnowledgeVersion,
  resolveKnowledgeEvidence, reviewKnowledgeContext, reviewKnowledgeItem, structureLegacyCard,
  syncShellAudit, updateKnowledgeContext, updateKnowledgeItem, updateKnowledgeTheme,
  readKnowledge, currentViewId, createKnowledgeDataset, reviewKnowledgeDataset, readDatasetRows,
  createKnowledgeMapping, updateKnowledgeMapping, reviewKnowledgeMapping, createKnowledgeComparison, legacyComparisonViews,
  effectiveCurrentJudgments, freezeKnowledge, knowledgeAccess, assertKnowledgeAccess, upsertSourcePolicy,
  buildKnowledgeContainer, knowledgePipelineStatus,
  readSnapshotKnowledge, resolveSnapshotToken, readSnapshotDatasetRows,
} from "../services/knowledge-base.ts";
import { exportKnowledge, buildKnowledgePackage, snapshotCsv, snapshotWiki, snapshotSchemaFiles, safeFileName } from "../services/knowledge-export.ts";
import { zip } from "../services/export.ts";
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

// ══ E4 数据集／查询／比较（合同 §7.1/§7.2；判据 T17–T19、T26–T28）═════════

const itemOp = (id: string, revision = 1) => ({ type: "item" as const, ref: { kind: "item" as const, id, revision } });
const cellOp = (datasetId: string, rowIndex: number, columnIndex = 0, revision = 1) => ({ type: "cell" as const, datasetRef: { kind: "dataset" as const, id: datasetId, revision }, rowIndex, columnIndex });
const scalarOf = (raw: string, value: string, unit: string | null) => ({ kind: "scalar" as const, raw, value, unit });
const viewIdOf = (s: LocusState, topicId: string) => currentViewId(s, topicId);

/** E4 夹具（§11.1 合成 oracle）：培养时间 1 d/24 h/48 h、>90 下界、定性「立即下沉」、汇总值、同名另义、单位未知。 */
function seedE4() {
  const t = createTopic(emptyState(), { name: "合成课题甲", researchQuestion: "培养时间与萌发" });
  const topicId = t.topic.id;
  const asset = makeAsset("literature", "exp.md", "合成对象A在 1 d 与 24 h 下培养；>90 d 视为上限；立即下沉为定性描述。", topicId);
  let s: LocusState = { ...t.state, assets: [...t.state.assets, asset] };
  const srcRef = currentSourceRef(s, "asset", asset.id)!;
  s = { ...s, knowledge: archiveSourceVersion(s.knowledge, srcRef, sourcePayload(s, "asset", asset.id)) };
  s = importMeasurements(s, { name: "t.csv", csv: "时间,批注\n24,第一轮\n24,重复\n48,延长\n", topicId }).state;
  const tableId = s.tables[0].id;
  const tableRef = currentSourceRef(s, "table", tableId)!;
  s = { ...s, knowledge: archiveSourceVersion(s.knowledge, tableRef, sourcePayload(s, "table", tableId)) };

  const mkItem = (id: string, text: string, value: unknown, metricId: string, extra: Record<string, unknown> = {}) => envOf(id, {
    contentType: "observation", nature: "observation", text,
    subject: { raw: "合成对象A" }, predicate: { raw: "培养时间", metricId }, value,
    contextRefs: [], evidenceRefs: [], sourceRefs: [srcRef],
    origin: { sourceClass: "literature_report", createdBy: "model", secondaryCitation: false },
    scopeText: "", unknowns: [], topicIds: [topicId], subquestionIds: [], review: { status: "confirmed" }, ...extra,
  });
  const mkCtx = (id: string, tempRaw: string | null, tempValue: string | null) => envOf(id, {
    researchUnitId: id, subject: "合成对象A", groupLabel: "G1", stage: "培养", methodRefs: [],
    conditions: tempRaw === null ? [] : [{ id: `${id}_c1`, field: { raw: "温度" }, value: scalarOf(tempRaw, tempValue!, "°C"), appliesTo: { subject: "合成对象A", stage: "培养" }, evidenceRefs: [], obtainedBy: "human_record", review: { status: "confirmed" } }],
    unknowns: [], topicIds: [topicId], subquestionIds: [], review: { status: "confirmed" },
  });

  let k = s.knowledge;
  k = {
    ...k, items: [...k.items,
      mkItem("ki_A", "培养 1 d", scalarOf("1 d", "1", "d"), "time_germ"),
      mkItem("ki_B", "培养 24 h", scalarOf("24 h", "24", "h"), "time_germ"),
      mkItem("ki_C", "培养 48 h", scalarOf("48 h", "48", "h"), "time_germ"),
      mkItem("ki_bound", "培养上限 >90 d", { kind: "bound", raw: ">90 d", operator: "gt", value: "90", unit: "d" }, "time_germ"),
      mkItem("ki_cat", "立即下沉", { kind: "category", raw: "立即下沉", label: "立即下沉" }, "time_germ"),
      mkItem("ki_sum", "培养 24 h（均值）", { kind: "summary", raw: "24±2 h", statistic: "均值", value: "24", unit: "h" }, "time_germ"),
      mkItem("ki_alt", "培养 24 h（另一定义）", scalarOf("24 h", "24", "h"), "time_germ_alt"),
      mkItem("ki_nounit", "培养 24（单位未知）", scalarOf("24", "24", null), "time_germ"),
      mkItem("ki_T25", "25 °C 培养 24 h", scalarOf("24 h", "24", "h"), "time_germ", { contextRefs: [{ kind: "context", id: "kctx_25", revision: 1 }] }),
      mkItem("ki_T60", "60 °C 培养 24 h", scalarOf("24 h", "24", "h"), "time_germ", { contextRefs: [{ kind: "context", id: "kctx_60", revision: 1 }] }),
      mkItem("ki_noctx", "培养 24 h（未记温度）", scalarOf("24 h", "24", "h"), "time_germ"),
    ],
    contexts: [...k.contexts, mkCtx("kctx_25", "25 °C", "25"), mkCtx("kctx_60", "60 °C", "60")],
  };
  let state: LocusState = { ...s, knowledge: k };

  const ds = createKnowledgeDataset(state, {
    topicId, sourceRef: tableRef, selection: { rowIndices: [0, 1, 2], columnIndices: [0] },
    columns: [{ index: 0, originalName: "时间", standardId: "time_germ", type: "scalar", unit: "h" }],
    rowBindings: [{ rowIndex: 0 }, { rowIndex: 1 }, { rowIndex: 2 }],
  });
  state = reviewKnowledgeDataset(ds.state, ds.dataset.id, { baseRevision: 1, columnIndices: [0], decision: "confirmed", basis: "合成数据列核对" }).state;

  const mp = createKnowledgeMapping(state, { topicId, metricId: "time_germ", definition: "培养到萌发所需时间", aliases: ["培养时间"], valueKind: "scalar", targetUnit: "h", conversion: { kind: "scaleOffset", factor: "24", offset: "0", fromUnit: "d", toUnit: "h" }, basis: "1 d = 24 h" });
  state = reviewKnowledgeMapping(mp.state, mp.mapping.id, { baseRevision: 1, decision: "confirmed", basis: "换算依据核对" }).state;

  return { state, topicId, srcRef, tableRef, datasetId: ds.dataset.id, datasetRevision: (state.knowledge.datasets.find((d) => d.id === ds.dataset.id)!.revision), mappingId: mp.mapping.id, itemsBefore: state.knowledge.items.length };
}

// ── T17：1 d vs 24 h / 48 h，规范到 h；item 与 dataset 单元格两路 ──────────
test("T17 培养时间规范到 h：item 与同 dataset 两行单元格，差 0/24、比 1/2（独立 oracle）", () => {
  const f = seedE4();
  let s = f.state;

  const a = createKnowledgeComparison(s, { topicId: f.topicId, viewId: viewIdOf(s, f.topicId), question: "1 d 与 24 h 之差", metricId: "time_germ", inputRefs: [itemOp("ki_A"), itemOp("ki_B")], varyingFields: [], requiredEqualFields: [], operation: "difference", baselineRef: itemOp("ki_A") });
  assert.equal(a.decision, "computable");
  assert.equal(a.comparison.payload.computedValue?.value, "0", "规范值 24/24 → 差 0");
  const na = a.comparison.payload.normalizedInputs;
  assert.equal((na[0].rawValue as { raw: string }).raw, "1 d", "原值可回查");
  assert.equal((na[0].normalizedValue as { value: string }).value, "24", "1 d 规范为 24 h");
  assert.equal((na[0].normalizedValue as { unit: string }).unit, "h");
  assert.ok(na[0].mappingRefs.length === 1 && readKnowledgeVersion(a.state.knowledge, na[0].mappingRefs[0]) !== null, "所用映射规则可回查");
  assert.ok(a.comparison.payload.formatting.includes("12 位有效数字"));
  s = a.state;

  const b = createKnowledgeComparison(s, { topicId: f.topicId, viewId: viewIdOf(s, f.topicId), question: "1 d 与 24 h 之比", metricId: "time_germ", inputRefs: [itemOp("ki_A"), itemOp("ki_B")], varyingFields: [], requiredEqualFields: [], operation: "ratio", baselineRef: itemOp("ki_A") });
  assert.equal(b.decision, "computable");
  assert.equal(b.comparison.payload.computedValue?.value, "1");
  s = b.state;

  const c = createKnowledgeComparison(s, { topicId: f.topicId, viewId: viewIdOf(s, f.topicId), question: "1 d 与 48 h 之差", metricId: "time_germ", inputRefs: [itemOp("ki_A"), itemOp("ki_C")], varyingFields: [], requiredEqualFields: [], operation: "difference", baselineRef: itemOp("ki_A") });
  assert.equal(c.decision, "computable");
  assert.equal(c.comparison.payload.computedValue?.value, "24", "48−24=24 h");
  s = c.state;
  const d = createKnowledgeComparison(s, { topicId: f.topicId, viewId: viewIdOf(s, f.topicId), question: "1 d 与 48 h 之比", metricId: "time_germ", inputRefs: [itemOp("ki_A"), itemOp("ki_C")], varyingFields: [], requiredEqualFields: [], operation: "ratio", baselineRef: itemOp("ki_A") });
  assert.equal(d.comparison.payload.computedValue?.value, "2");
  s = d.state;

  const e1 = createKnowledgeComparison(s, { topicId: f.topicId, viewId: viewIdOf(s, f.topicId), question: "表内 24 与 24", metricId: "time_germ", inputRefs: [cellOp(f.datasetId, 0, 0, f.datasetRevision), cellOp(f.datasetId, 1, 0, f.datasetRevision)], varyingFields: [], requiredEqualFields: [], operation: "difference", baselineRef: cellOp(f.datasetId, 0, 0, f.datasetRevision) });
  assert.equal(e1.decision, "computable");
  assert.equal(e1.comparison.payload.computedValue?.value, "0");
  s = e1.state;
  const e2 = createKnowledgeComparison(s, { topicId: f.topicId, viewId: viewIdOf(s, f.topicId), question: "表内 24 与 48", metricId: "time_germ", inputRefs: [cellOp(f.datasetId, 0, 0, f.datasetRevision), cellOp(f.datasetId, 2, 0, f.datasetRevision)], varyingFields: [], requiredEqualFields: [], operation: "ratio", baselineRef: cellOp(f.datasetId, 0, 0, f.datasetRevision) });
  assert.equal(e2.decision, "computable");
  assert.equal(e2.comparison.payload.computedValue?.value, "2");
  s = e2.state;

  const rowsUsed = e2.comparison.payload.inputRefs.map((o) => (o as { rowIndex: number }).rowIndex);
  assert.equal(new Set(rowsUsed).size, 2, "两操作数取自不同行");
  const outOfRange = expectErr(() => createKnowledgeComparison(s, { topicId: f.topicId, viewId: viewIdOf(s, f.topicId), question: "越界", inputRefs: [cellOp(f.datasetId, 0, 0, f.datasetRevision), cellOp(f.datasetId, 9, 0, f.datasetRevision)], varyingFields: [], requiredEqualFields: [], operation: "difference", baselineRef: cellOp(f.datasetId, 0, 0, f.datasetRevision) }));
  assert.equal(outOfRange.status, 422);
  assert.equal(code(outOfRange), "row_out_of_selection");
  const baselineNotIn = expectErr(() => createKnowledgeComparison(s, { topicId: f.topicId, viewId: viewIdOf(s, f.topicId), question: "基线不在输入", inputRefs: [itemOp("ki_A"), itemOp("ki_B")], varyingFields: [], requiredEqualFields: [], operation: "difference", baselineRef: itemOp("ki_C") }));
  assert.equal(code(baselineNotIn), "baseline_not_in_inputs");
  assert.equal(s.knowledge.items.length, f.itemsBefore, "比较不为单元格生成虚构知识项");

  const rows = readDatasetRows(s, f.datasetId, { revision: 1 });
  assert.deepEqual(rows.rows.map((r) => r.cells[0].raw), ["24", "24", "48"]);
  assert.equal(rows.columns[0].unit, "h");
});

// ── T18：同名不同定义 / 单位未知 / summary 混用 → 不进差比，理由明确 ──────
test("T18 同名不同定义、单位未知、summary 与 scalar 混用不进入差/比，给明确理由", () => {
  const f = seedE4();
  const s = f.state;
  const run = (inputRefs: unknown[], op: "difference" | "ratio" | "display", baseline: unknown) =>
    createKnowledgeComparison(s, { topicId: f.topicId, viewId: viewIdOf(s, f.topicId), question: "q", metricId: "time_germ", inputRefs, varyingFields: [], requiredEqualFields: [], operation: op, baselineRef: baseline });

  const mismatch = run([itemOp("ki_A"), itemOp("ki_alt")], "difference", itemOp("ki_A"));
  assert.equal(mismatch.decision, "blocked");
  assert.ok(mismatch.reasonCodes.includes("metric_definition_mismatch"), "同名不同定义不取第一项");

  const nounit = run([itemOp("ki_B"), itemOp("ki_nounit")], "difference", itemOp("ki_B"));
  assert.equal(nounit.decision, "blocked");
  assert.ok(nounit.reasonCodes.includes("unit_unknown"));

  const mixed = run([itemOp("ki_B"), itemOp("ki_sum")], "difference", itemOp("ki_B"));
  assert.equal(mixed.decision, "blocked");
  assert.ok(mixed.reasonCodes.includes("value_kind_unsupported"), "summary 不参与 diff/ratio");

  const display = run([itemOp("ki_B"), itemOp("ki_sum")], "display", null);
  assert.equal(display.decision, "display_only");
  assert.ok(display.reasonCodes.includes("operation_display"));
  assert.equal(display.comparison.payload.computedValue, null, "display 不产生统计结论");
});

// ── T19：ratio 基线 0 阻断；bound/定性不参与差比 ──────────────────────────
test("T19 ratio 基线为 0 阻断；界限与定性不变 scalar 参与运算", () => {
  const f = seedE4();
  let s: LocusState = { ...f.state, knowledge: { ...f.state.knowledge, items: [...f.state.knowledge.items, envOf("ki_zero", {
    contentType: "observation", nature: "observation", text: "基线 0 h", subject: { raw: "合成对象A" }, predicate: { raw: "培养时间", metricId: "time_germ" },
    value: scalarOf("0 h", "0", "h"), contextRefs: [], evidenceRefs: [], sourceRefs: [f.srcRef],
    origin: { sourceClass: "literature_report", createdBy: "model", secondaryCitation: false },
    scopeText: "", unknowns: [], topicIds: [f.topicId], subquestionIds: [], review: { status: "confirmed" },
  })] } };
  const run = (inputRefs: unknown[], op: "difference" | "ratio", baseline: unknown) =>
    createKnowledgeComparison(s, { topicId: f.topicId, viewId: viewIdOf(s, f.topicId), question: "q", metricId: "time_germ", inputRefs, varyingFields: [], requiredEqualFields: [], operation: op, baselineRef: baseline });

  const ratio0 = run([itemOp("ki_zero"), itemOp("ki_B")], "ratio", itemOp("ki_zero"));
  assert.equal(ratio0.decision, "blocked");
  assert.ok(ratio0.reasonCodes.includes("baseline_zero"), "分母 0 阻断比值");

  const bound = run([itemOp("ki_bound"), itemOp("ki_B")], "difference", itemOp("ki_bound"));
  assert.equal(bound.decision, "blocked");
  assert.ok(bound.reasonCodes.includes("value_kind_unsupported"));
  assert.equal((s.knowledge.items.find((i) => i.id === "ki_bound")!.payload as { value: { kind: string } }).value.kind, "bound", "界限原值不变");

  const cat = run([itemOp("ki_cat"), itemOp("ki_B")], "difference", itemOp("ki_cat"));
  assert.equal(cat.decision, "blocked");
  assert.ok(cat.reasonCodes.includes("value_kind_unsupported"), "定性不参与差比");
});

// ── T26：两课题共享来源不外溢 ───────────────────────────────────────────
test("T26 两课题共享同来源：当前课题读取与比较不越界、不沿来源扩散私人判断", () => {
  const f = seedE4();
  const other = createTopic(f.state, { name: "合成课题乙", researchQuestion: "Q乙" });
  const topicB = other.topic.id;
  let s = other.state;
  const mkB = (id: string, text: string) => envOf(id, {
    contentType: "observation", nature: "human_judgment", text, subject: { raw: "合成对象A" }, predicate: { raw: "私有判断" },
    value: null, contextRefs: [{ kind: "context", id: "kctx_B", revision: 1 }], evidenceRefs: [], sourceRefs: [f.srcRef],
    origin: { sourceClass: "human_statement", createdBy: "human", secondaryCitation: false },
    scopeText: "", unknowns: [], topicIds: [topicB], subquestionIds: [], review: { status: "confirmed" },
  });
  s = {
    ...s, knowledge: {
      ...s.knowledge,
      items: [...s.knowledge.items, mkB("ki_B1", "乙的私有判断"), mkB("ki_B2", "乙的第二条判断")],
      contexts: [...s.knowledge.contexts, envOf("kctx_B", { researchUnitId: "uB", subject: "合成对象A", groupLabel: "GB", stage: "培养", methodRefs: [], conditions: [], unknowns: [], topicIds: [topicB], subquestionIds: [], review: { status: "confirmed" } })],
      relations: [...s.knowledge.relations, envOf("krel_B", { from: { kind: "item", id: "ki_B1", revision: 1 }, to: { kind: "item", id: "ki_B2", revision: 1 }, relationType: "supports", basis: "乙内部", evidenceRefs: [], establishedBy: "human", review: { status: "pending" } })],
    },
  };
  const dsB = createKnowledgeDataset(s, { topicId: topicB, sourceRef: f.tableRef, selection: { rowIndices: [0, 2], columnIndices: [0] }, columns: [{ index: 0, originalName: "时间", standardId: "time_germ", type: "scalar", unit: "h" }], rowBindings: [{ rowIndex: 0 }, { rowIndex: 2 }] });
  s = dsB.state;

  const viewA = readKnowledge(s, { source: "current", topicId: f.topicId });
  const idsA = viewA.items.map((i) => i.id);
  assert.ok(!idsA.includes("ki_B1") && !idsA.includes("ki_B2"), "甲读取不含乙的私人判断（共享来源不扩散）");
  assert.ok(!viewA.contexts.some((c) => c.id === "kctx_B"), "甲不包含乙的条件上下文");
  assert.ok(!viewA.relations.some((r) => r.id === "krel_B"), "甲不沿共享来源带回乙的关系");
  assert.ok(idsA.includes("ki_A"));

  const viewB = readKnowledge(s, { source: "current", topicId: topicB });
  assert.ok(viewB.items.map((i) => i.id).includes("ki_B1"));
  assert.ok(!viewB.items.map((i) => i.id).includes("ki_A"), "乙读取不含甲的对象");

  const cross = expectErr(() => createKnowledgeComparison(s, { topicId: f.topicId, viewId: viewIdOf(s, f.topicId), question: "跨课题取乙的单元格", inputRefs: [itemOp("ki_A"), cellOp(dsB.dataset.id, 0)], varyingFields: [], requiredEqualFields: [], operation: "difference", baselineRef: itemOp("ki_A") }));
  assert.equal(cross.status, 422);
  assert.equal(code(cross), "cross_topic_scope", "比较不取其他课题的数据集");
});

// ── T27：温度 varying 可比；requiredEqual 缺/冲突阻断 ─────────────────────
test("T27 温度作 varying 可按契约比较；作 requiredEqual 缺或冲突时阻断计算", () => {
  const f = seedE4();
  const s = f.state;
  const run = (inputRefs: unknown[], varyingFields: string[], requiredEqualFields: string[]) =>
    createKnowledgeComparison(s, { topicId: f.topicId, viewId: viewIdOf(s, f.topicId), question: "温度影响", metricId: "time_germ", inputRefs, varyingFields, requiredEqualFields, operation: "difference", baselineRef: itemOp("ki_T25") });

  const varying = run([itemOp("ki_T25"), itemOp("ki_T60")], ["温度"], []);
  assert.equal(varying.decision, "computable", "明确按 varying 契约可比");
  assert.ok(varying.comparison.payload.warnings.some((w) => w.includes("温度")));

  const conflict = run([itemOp("ki_T25"), itemOp("ki_T60")], [], ["温度"]);
  assert.equal(conflict.decision, "blocked");
  assert.ok(conflict.reasonCodes.includes("requirement_conflict"));

  const missing = run([itemOp("ki_T25"), itemOp("ki_noctx")], [], ["温度"]);
  assert.equal(missing.decision, "blocked");
  assert.ok(missing.reasonCodes.includes("requirement_missing"));

  const overlap = expectErr(() => createKnowledgeComparison(s, { topicId: f.topicId, viewId: viewIdOf(s, f.topicId), question: "重叠", inputRefs: [itemOp("ki_T25"), itemOp("ki_T60")], varyingFields: ["温度"], requiredEqualFields: ["温度"], operation: "difference", baselineRef: itemOp("ki_T25") }));
  assert.equal(code(overlap), "field_sets_overlap");
});

// ── T28：多映射命中取冲突；旧比较保留旧规则 ──────────────────────────────
test("T28 两条映射都命中不取第一条；旧比较记录与快照保留旧规则", () => {
  const f = seedE4();
  let s = f.state;
  const mp2 = createKnowledgeMapping(s, { topicId: f.topicId, metricId: "time_germ", definition: "另一口径的培养时间", valueKind: "scalar", targetUnit: "h", conversion: { kind: "scaleOffset", factor: "24", offset: "0", fromUnit: "d", toUnit: "h" }, basis: "合成第二规则" });
  s = reviewKnowledgeMapping(mp2.state, mp2.mapping.id, { baseRevision: 1, decision: "confirmed", basis: "核对" }).state;
  const conflicted = createKnowledgeComparison(s, { topicId: f.topicId, viewId: viewIdOf(s, f.topicId), question: "两条映射", metricId: "time_germ", inputRefs: [itemOp("ki_A"), itemOp("ki_B")], varyingFields: [], requiredEqualFields: [], operation: "difference", baselineRef: itemOp("ki_A") });
  assert.equal(conflicted.decision, "blocked");
  assert.ok(conflicted.reasonCodes.includes("mapping_conflict"), "命中多条不取第一条");

  const t = createTopic(emptyState(), { name: "课题丙", researchQuestion: "Q丙" });
  const asset = makeAsset("literature", "lit.md", "合成对象A在 25 °C 下培养 1 d。", t.topic.id);
  let s2: LocusState = { ...t.state, assets: [...t.state.assets, asset] };
  const card = addManualCard(s2, { assetId: asset.id, rawText: "合成对象A在 25 °C 下培养 1 d。" });
  s2 = reviewCard(card.state, card.card.id, { audit: "confirm" });
  const cmp = createComparison(s2, { topicId: t.topic.id, cardIds: [card.card.id] });
  s2 = cmp.state;
  const before = JSON.stringify(s2.comparisons);
  assert.ok(cmp.comparison.groups.length >= 1);

  const mp3 = createKnowledgeMapping(s2, { topicId: t.topic.id, metricId: "时间", definition: "培养时间", valueKind: "scalar", targetUnit: "h", conversion: { kind: "scaleOffset", factor: "24", offset: "0", fromUnit: "d", toUnit: "h" }, basis: "新规则" });
  s2 = updateKnowledgeMapping(mp3.state, mp3.mapping.id, { baseRevision: 1, patch: { basis: "改后的依据" }, reason: "修订" }).state;
  assert.equal(JSON.stringify(s2.comparisons), before, "旧比较记录与快照不随新映射改变");

  const legacy = legacyComparisonViews(s2, t.topic.id);
  assert.equal(legacy[0].decision, "display_only");
  assert.ok(legacy[0].reasonCodes.includes("legacy_no_computation"));
  assert.ok(legacy[0].reasonCodes.includes("legacy_unbound_fields"), "未绑定单位的旧条目明确标出");
});

// ── E3 遗留（E4 读取侧复检）：当前认识只取现在仍确认有效的项 ──────────────
test("E3遗留(E4) 读取侧复检：级联回退后当前认识不并入，历史引用保留", () => {
  const f = seedE4();
  const th = createKnowledgeTheme(f.state, { topicId: f.topicId, name: "培养时间主题", members: [{ kind: "item", id: "ki_A", revision: 1 }], currentJudgmentRefs: [{ kind: "item", id: "ki_A", revision: 1 }] });
  let s = th.state;
  assert.equal(effectiveCurrentJudgments(s, th.theme).length, 1);
  assert.ok(!readKnowledge(s, { source: "current", topicId: f.topicId }).warnings.some((w) => w.code === "judgment_not_live"));

  s = reviewKnowledgeItem(s, "ki_A", { baseRevision: 1, decision: "needs_info", basis: "复核条件" }).state;
  const themeNow = s.knowledge.themes.find((t) => t.id === th.theme.id)!;
  assert.equal(effectiveCurrentJudgments(s, themeNow).length, 0, "回退后不再作为当前认识（读取侧复检）");
  assert.equal((themeNow.payload as { currentJudgmentRefs: unknown[] }).currentJudgmentRefs.length, 1, "历史引用保留，不静默改写");
  assert.ok(readKnowledge(s, { source: "current", topicId: f.topicId }).warnings.some((w) => w.code === "judgment_not_live"), "读取侧给出动态提醒");
});// ══ E5 快照／wiki／知识包（合同 §7.3/§7.4/§7.5；判据 T29–T34）════════════

/** 最小 ZIP 解包（EOCD→中央目录→本地头→inflateRaw），用于「检查 ZIP 解包内容」。 */
function unzipAll(buf: Buffer): { name: string; data: string }[] {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("不是合法 ZIP（缺 EOCD）");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out: { name: string; data: string }[] = [];
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString("utf8");
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const compLen = buf.readUInt32LE(localOff + 18);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = buf.subarray(dataStart, dataStart + compLen);
    out.push({ name, data: zlibInflate(comp) });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
function zlibInflate(comp: Buffer): string {
  return inflateRawSync(comp).toString("utf8");
}

/** E5 夹具：在 E4 基础上加一条可计算比较与一个主题（含当前认识）。 */
function seedE5() {
  const f = seedE4();
  let s = f.state;
  const cmp = createKnowledgeComparison(s, { topicId: f.topicId, viewId: viewIdOf(s, f.topicId), question: "1 d 与 48 h 之比", metricId: "time_germ", inputRefs: [itemOp("ki_A"), itemOp("ki_C")], varyingFields: [], requiredEqualFields: [], operation: "ratio", baselineRef: itemOp("ki_A") });
  s = cmp.state;
  const th = createKnowledgeTheme(s, { topicId: f.topicId, name: "培养时间主题", members: [{ kind: "item", id: "ki_A", revision: 1 }], currentJudgmentRefs: [{ kind: "item", id: "ki_A", revision: 1 }] });
  s = th.state;
  return { ...f, state: s, comparisonId: cmp.comparison.id, themeId: th.theme.id };
}

// ── T29：同快照 JSON/wiki/CSV 事实一致 ＋ T17 oracle ──────────────────────
test("T29 同一快照生成 JSON/wiki/CSV：事实、单位、性质、unknowns、token 一致且过 T17 oracle", () => {
  const f = seedE5();
  const fr = freezeKnowledge(f.state, { topicId: f.topicId, viewId: viewIdOf(f.state, f.topicId) });
  const snap = fr.snapshot;

  const dsRows = snap.content.datasetRows!.find((r) => r.datasetRef.id === f.datasetId)!;
  assert.deepEqual(dsRows.rows.map((r) => r.cells[0].raw), ["24", "24", "48"], "快照内为固定表版本的实际行");

  const cmp = snap.content.comparisons.find((c) => c.id === f.comparisonId)!;
  assert.equal((cmp.payload as unknown as { computedValue: { value: string } }).computedValue.value, "2", "1 d→24 h 基线，48 h → 比 2（T17 oracle）");

  const csv = snapshotCsv(snap, { comparisonId: f.comparisonId });
  const jsonOut = exportKnowledge(snap, { format: "json" });
  const jsonObj = JSON.parse(jsonOut.data as string);
  const wiki = snapshotWiki(snap).pages.map((p) => p.markdown).join("\n");

  assert.ok(csv.content.startsWith("operand_type,item_id,dataset_id,revision,row_index,column_index,context_id,metric,raw_value,value_kind,normalized_value,unit,source_token"), "CSV 列固定");
  assert.ok(csv.content.includes("48") && csv.content.includes(",2,"), "CSV 含规范化值与比值");
  assert.ok(csv.content.includes(",h"), "CSV 单位与快照一致");
  assert.equal(jsonObj.snapshotId, snap.snapshotId);
  assert.ok(JSON.stringify(jsonObj.content).includes("培养 1 d"), "JSON 含同一事实原文");
  assert.ok(wiki.includes("秒") || wiki.includes("比"), "wiki 含比较页");
  assert.ok(wiki.includes("2"), "wiki 与本快照计算结果一致");

  const tokens = [...csv.content.matchAll(/\b([KS]\d+)\b/g)].map((m) => m[1]);
  assert.ok(tokens.length > 0, "CSV 带引用 token");
  for (const t of tokens) assert.ok(snap.content.referenceMap[t], `token ${t} 必须能在同一快照 referenceMap 解析`);

  const pgk = buildKnowledgePackage(snap);
  const names = pgk.entries.map((e) => e.name);
  for (const n of names) {
    assert.ok(/^[A-Za-z0-9._/-]+$/.test(n) && !n.includes(".."), `包内文件名安全：${n}`);
  }
  assert.ok(names.includes("snapshot.json") && names.includes("manifest.json") && names.includes("NOTICE.txt"));
  const schemaFiles = snapshotSchemaFiles();
  assert.ok(JSON.parse(schemaFiles.schema).csvColumns.length === 13);
  assert.ok(JSON.parse(schemaFiles.dictionary).valueKinds.includes("missing"));
});

// ── T30：冻结后改数据/映射/主题判断/比较 → 旧快照与 token 不变，新包变化 ──
test("T30 冻结后改映射/主题判断/比较：旧快照事实与 token 不变，新包 hash 与版本变化", () => {
  const f = seedE5();
  const fr1 = freezeKnowledge(f.state, { topicId: f.topicId, viewId: viewIdOf(f.state, f.topicId) });
  const snap1 = fr1.snapshot;
  let s = fr1.state;

  const mp2 = createKnowledgeMapping(s, { topicId: f.topicId, metricId: "time_germ", definition: "改动后的口径", valueKind: "scalar", targetUnit: "h", conversion: { kind: "scaleOffset", factor: "24", offset: "0", fromUnit: "d", toUnit: "h" }, basis: "改动" });
  s = reviewKnowledgeMapping(mp2.state, mp2.mapping.id, { baseRevision: 1, decision: "confirmed", basis: "核对" }).state;
  const th2 = updateKnowledgeTheme(s, f.themeId, { baseRevision: 1, patch: { currentJudgmentRefs: [{ kind: "item", id: "ki_C", revision: 1 }] } });
  s = th2.state;
  const cmp2 = createKnowledgeComparison(s, { topicId: f.topicId, viewId: viewIdOf(s, f.topicId), question: "24 h 与 48 h 之差", metricId: "time_germ", inputRefs: [itemOp("ki_B"), itemOp("ki_C")], varyingFields: [], requiredEqualFields: [], operation: "difference", baselineRef: itemOp("ki_B") });
  s = cmp2.state;

  const fr2 = freezeKnowledge(s, { topicId: f.topicId, viewId: viewIdOf(s, f.topicId) });
  assert.notEqual(fr2.snapshot.contentHash, snap1.contentHash, "新版确有差异（新 hash）");
  assert.equal(snap1.content.comparisons.length, 1, "旧快照只含冻结当时的比较");
  assert.equal(snap1.content.themes[0].payload.currentJudgmentRefs[0].id, "ki_A", "旧快照保留当时判断");
  assert.equal(fr2.snapshot.content.comparisons.length, 2);
  const fr1b = freezeKnowledge(f.state, { topicId: f.topicId, viewId: viewIdOf(f.state, f.topicId) });
  assert.notEqual(fr1b.snapshot.snapshotId, snap1.snapshotId, "重复冻结生成新 ID");
  assert.equal(fr1b.snapshot.contentHash, snap1.contentHash, "同内容重复冻结：ID 不同但 contentHash 相同（§7.3）");
  const wiki1 = snapshotWiki(snap1).pages.map((p) => p.markdown).join("\n");
  const wiki2 = snapshotWiki(fr2.snapshot).pages.map((p) => p.markdown).join("\n");
  assert.notEqual(wiki1, wiki2, "旧 wiki 与新版不同");
  assert.ok(wiki1.includes("1 d 与 48 h 之比"), "旧 wiki 仍是冻结当时的事实");
});

// ── T31：31 行选择末行不同 → 无前 30 行截断，coverage 准确 ────────────────
test("T31 选择表 31 行且末行不同：31 行全部在快照范围内，coverage 准确", () => {
  const t = createTopic(emptyState(), { name: "合成课题甲", researchQuestion: "Q" });
  let s = t.state;
  const csv = "时间,批注\n" + Array.from({ length: 31 }, (_, i) => `${i === 30 ? "99" : String(24 + i)},r${i}`).join("\n") + "\n";
  s = importMeasurements(s, { name: "t31.csv", csv, topicId: t.topic.id }).state;
  const tableId = s.tables[0].id;
  const tableRef = currentSourceRef(s, "table", tableId)!;
  s = { ...s, knowledge: archiveSourceVersion(s.knowledge, tableRef, sourcePayload(s, "table", tableId)) };
  const ds = createKnowledgeDataset(s, {
    topicId: t.topic.id, sourceRef: tableRef,
    selection: { rowIndices: Array.from({ length: 31 }, (_, i) => i), columnIndices: [0] },
    columns: [{ index: 0, originalName: "时间", standardId: "m", type: "scalar", unit: "h" }],
    rowBindings: Array.from({ length: 31 }, (_, i) => ({ rowIndex: i })),
  });
  s = ds.state;
  const fr = freezeKnowledge(s, { topicId: t.topic.id, viewId: viewIdOf(s, t.topic.id) });
  const rows = fr.snapshot.content.datasetRows!.find((r) => r.datasetRef.id === ds.dataset.id)!;
  assert.equal(rows.rows.length, 31, "31 行全部在范围内（没有被前 30 行截断）");
  assert.equal(rows.rows[30].cells[0].raw, "99", "末行不同且保留");
  assert.deepEqual(fr.snapshot.coverage, { selected: 0, totalAvailable: 0, processed: 0, omittedReasons: [] }, "coverage 与选择一致（课题内无知识项）");
  const csvOut = snapshotCsv(fr.snapshot, { datasetId: ds.dataset.id });
  assert.equal(csvOut.rows, 31, "数据集 CSV 为 31 条观察（逐行）");
});

// ── T32：viewId 过期 → 冻结/比较 409 ─────────────────────────────────────
test("T32 viewId 过期：冻结与比较均 409 要求刷新，不悄悄改输入", () => {
  const f = seedE5();
  const staleFreeze = expectErr(() => freezeKnowledge(f.state, { topicId: f.topicId, viewId: "bogus-view" }));
  assert.equal(staleFreeze.status, 409);
  assert.equal(code(staleFreeze), "view_stale");
  const staleCmp = expectErr(() => createKnowledgeComparison(f.state, { topicId: f.topicId, viewId: "bogus-view", question: "q", metricId: null, inputRefs: [itemOp("ki_A")], varyingFields: [], requiredEqualFields: [], operation: "display" }));
  assert.equal(code(staleCmp), "view_stale");
});

// ── T33：非法文件名 / HTML / javascript: / CSV 公式 ──────────────────────
test("T33 非法文件名、HTML/script、javascript: 链接、CSV 公式：包路径与文本安全、机器值保真", () => {
  const t = createTopic(emptyState(), { name: "合成课题甲", researchQuestion: "Q" });
  let s = t.state;
  s = importMeasurements(s, { name: "f.csv", csv: "公式,批注\n=SUM(A1),危险\n", topicId: t.topic.id }).state;
  const tableId = s.tables[0].id;
  const tableRef = currentSourceRef(s, "table", tableId)!;
  s = { ...s, knowledge: archiveSourceVersion(s.knowledge, tableRef, sourcePayload(s, "table", tableId)) };
  const asset = makeAsset("literature", "evil.md", "<script>alert(1)</script> 见 javascript:alert(1)", t.topic.id);
  s = { ...s, assets: [...s.assets, asset] };
  s = { ...s, knowledge: { ...s.knowledge, items: [...s.knowledge.items, envOf("ki_evil", {
    contentType: "claim", nature: "human_judgment", text: "<script>alert(1)</script> 参考 javascript:alert(1)",
    subject: { raw: "合成对象A" }, predicate: { raw: "危险文本" }, value: null, contextRefs: [], evidenceRefs: [],
    sourceRefs: [currentSourceRef(s, "asset", asset.id)!],
    origin: { sourceClass: "human_statement", createdBy: "human", secondaryCitation: false },
    scopeText: "", unknowns: [], topicIds: [t.topic.id], subquestionIds: [], review: { status: "confirmed" },
  })] } };
  const ds = createKnowledgeDataset(s, { topicId: t.topic.id, sourceRef: tableRef, selection: { rowIndices: [0], columnIndices: [0] }, columns: [{ index: 0, originalName: "公式", type: "scalar", unit: null }], rowBindings: [{ rowIndex: 0 }] });
  s = ds.state;

  const fr = freezeKnowledge(s, { topicId: t.topic.id, viewId: viewIdOf(s, t.topic.id) });
  const wiki = snapshotWiki(fr.snapshot).pages.map((p) => p.markdown).join("\n");
  assert.ok(!wiki.includes("<script>"), "wiki 不含 raw HTML（已转义）");
  assert.ok(!/javascript:\/\//.test(wiki), "wiki 不含 javascript: 协议");
  assert.ok(wiki.includes("&lt;script&gt;"), "尖括号被转义为实体");

  const machine = snapshotCsv(fr.snapshot, { datasetId: ds.dataset.id, variant: "machine" });
  assert.ok(machine.content.includes("=SUM(A1)"), "机器版保真，公式原文不改写");
  const safe = snapshotCsv(fr.snapshot, { datasetId: ds.dataset.id, variant: "sheet-safe" });
  assert.ok(safe.content.includes("'=SUM(A1)"), "sheet-safe 版对公式样式前置单引号");
  assert.ok(safe.filename.includes("sheet-safe"));

  assert.equal(expectErr(() => safeFileName("../evil.md")).status, 422);
  assert.equal(expectErr(() => safeFileName("a/b.md")).status, 422);
  assert.equal(safeFileName("ks_ab12.json"), "ks_ab12.json");
});

// ── T34：scope 外与密钥哨兵不进导出（ZIP 解包检查）；撤权后整包 403 不改写原快照 ──
test("T34 scope 外内容与密钥哨兵不进任何导出；撤权后整包 403 且不改写原快照", () => {
  const SENTINEL = "SECRET-SENTINEL-9f3a";
  const f = seedE5();
  const other = createTopic(f.state, { name: "合成课题乙", researchQuestion: "Q2" });
  let s: LocusState = other.state;
  s = { ...s, knowledge: { ...s.knowledge, items: [...s.knowledge.items, envOf("ki_secret", {
    contentType: "claim", nature: "human_judgment", text: `${SENTINEL} 乙的私有`,
    subject: { raw: "合成对象A" }, predicate: { raw: "哨兵" }, value: null, contextRefs: [], evidenceRefs: [],
    sourceRefs: [f.srcRef], origin: { sourceClass: "human_statement", createdBy: "human", secondaryCitation: false },
    scopeText: "", unknowns: [], topicIds: [other.topic.id], subquestionIds: [], review: { status: "confirmed" },
  })] } };

  const fr = freezeKnowledge(s, { topicId: f.topicId, viewId: viewIdOf(s, f.topicId) });
  const pkg = buildKnowledgePackage(fr.snapshot);
  for (const e of pkg.entries) assert.ok(!String(e.data).includes(SENTINEL), `条目 ${e.name} 不得含 scope 外哨兵`);
  const unzipped = unzipAll(zip(pkg.entries));
  assert.ok(unzipped.length === pkg.entries.length, "ZIP 解包条目数与打包一致");
  for (const u of unzipped) assert.ok(!u.data.includes(SENTINEL), `解包后 ${u.name} 不得含哨兵`);
  assert.ok(!unzipped.some((u) => u.name.includes("evil") || u.name.includes("secret")), "包内不含附件/私有对象名");

  // 默认（未设策略）：export 一律拒绝；显式用户允许后才放行；策略变更不改写原快照
  const before = JSON.stringify(fr.state.knowledge.snapshots);
  const denied = expectErr(() => assertKnowledgeAccess(fr.state, "export", fr.snapshot.sourceVersionRefs));
  assert.equal(denied.status, 403);
  assert.equal(code(denied), "source_access_denied");
  let st = fr.state;
  for (const r of fr.snapshot.sourceVersionRefs) {
    st = upsertSourcePolicy(st, { sourceKind: r.kind, sourceId: r.id, allowLocalRead: true, allowExport: true, allowAiSend: false, reason: "用户本次明确允许带出" }).state;
  }
  assertKnowledgeAccess(st, "export", fr.snapshot.sourceVersionRefs);
  assert.equal(JSON.stringify(st.knowledge.snapshots), before, "策略变更不改写已冻结快照");
  const deniedLocal = upsertSourcePolicy(st, { sourceKind: "asset", sourceId: f.srcRef.id, baseRevision: 1, allowLocalRead: false, allowExport: true, allowAiSend: false, reason: "禁止本地读取" });
  const noLocal = knowledgeAccess(deniedLocal.state, "localRead", [f.srcRef]);
  assert.equal(noLocal.ok, false, "撤销本地读取后该来源不可读");
  assert.equal(deniedLocal.policy.history.length, 1, "策略变更留历史");
});

// ── T34b：快照读取按固定版本，不退回当前库 ───────────────────────────────
test("T34b 快照读取：按快照内固定版本，不读当前库最新", () => {
  const f = seedE5();
  const fr = freezeKnowledge(f.state, { topicId: f.topicId, viewId: viewIdOf(f.state, f.topicId) });
  const snap = fr.snapshot;
  const item = readSnapshotKnowledge(snap, { kind: "item", id: "ki_A", revision: 1 });
  assert.ok(item && (item as { text: string }).text.includes("培养 1 d"));
  assert.equal(readSnapshotKnowledge(snap, { kind: "item", id: "ki_A", revision: 99 }), null, "快照内不存在的版本不返回");
  const tok = Object.entries(snap.content.referenceMap).find(([, e]) => e.kind === "knowledge")!;
  assert.ok(resolveSnapshotToken(snap, tok[0]));
  assert.ok(readSnapshotDatasetRows(snap, f.datasetId, f.datasetRevision).rows.length >= 1, "快照内可读数据集实际行列");
  assert.equal(expectErr(() => readSnapshotDatasetRows(snap, "ds_missing", 1)).status, 404);
});
// ══ E6.5② 固定版本审核口径反例（§4.2 / §4.6.9）════════════════════════════
// 合同要求：正式使用同时核查**被引用版本**的 review 与稳定 ID 当前是否 withdrawn/excluded。
// 本节以反例固化**当前实现行为**，便于与合同逐条对照；发现不一致处标注「待用户裁决」，
// 不在此降门槛、不自动换引用，也不据此改写合同。

function seedPinned() {
  const t = createTopic(emptyState(), { name: "合成课题甲", researchQuestion: "Q" });
  const asset = makeAsset("literature", "p.md", "合成对象A在 1 d 下培养。", t.topic.id);
  let s: LocusState = { ...t.state, assets: [...t.state.assets, asset] };
  s = importMeasurements(s, { name: "d.csv", csv: "t,v\n0,1", topicId: t.topic.id }).state;
  s = { ...s, knowledge: { ...s.knowledge, items: [...s.knowledge.items, envOf("ki_p", {
    contentType: "observation", nature: "observation", text: "合成对象A在 1 d 下培养",
    subject: { raw: "合成对象A" }, predicate: { raw: "培养时间", metricId: "time_germ" },
    value: { kind: "scalar", raw: "1 d", value: "1", unit: "d" }, contextRefs: [], evidenceRefs: [],
    sourceRefs: [currentSourceRef(s, "asset", asset.id)!],
    origin: { sourceClass: "literature_report", createdBy: "model", secondaryCitation: false },
    scopeText: "", unknowns: [], topicIds: [t.topic.id], subquestionIds: [], review: { status: "pending" },
  })] } };
  return { state: s, topicId: t.topic.id, tableId: s.tables[0].id };
}

const pickCore = (s: LocusState, tableId: string, revision: number) =>
  createAnalysisTask(s, { topicId: (s.knowledge.items.find((i) => i.id === "ki_p")!.payload as ItemPayload).topicIds[0], title: "分析", core: [{ kind: "table", id: tableId }, { kind: "item", id: "ki_p", revision }] });

test("E6.5②a 反例（待裁决）：引用钉在旧版 pending、新版已 confirmed 且未改绑时，消费者当前放行", () => {
  const f = seedPinned();
  const confirmed = reviewKnowledgeItem(f.state, "ki_p", { baseRevision: 1, decision: "confirmed", basis: "核对原文" }).state;
  const pinnedStatus = (readKnowledgeVersion(confirmed.knowledge, { kind: "item", id: "ki_p", revision: 1 }) as ItemPayload).review.status;
  const liveStatus = (confirmed.knowledge.items.find((i) => i.id === "ki_p")!.payload as ItemPayload).review.status;
  assert.equal(pinnedStatus, "pending", "被引用版本（第 1 版）仍为 pending");
  assert.equal(liveStatus, "confirmed", "当前版本（第 2 版）已 confirmed");

  // 当前实现：按最新审核态判定 → 放行。合同 §4.2 要求核查**被引用版本**的 review →
  // 「旧版 pending 且未显式改绑」应被拒绝直到改绑。此差异待用户裁决，不在此处改门槛。
  let current = "allowed";
  try {
    pickCore(confirmed, f.tableId, 1);
  } catch (e) {
    current = (e as AppError).details?.code as string ?? "rejected";
  }
  assert.equal(current, "allowed", "记录当前行为：未改绑的旧版 pending 引用被放行（与 §4.2 待裁决差异）");
});

test("E6.5②b 反例（待裁决）：引用钉在旧版 confirmed、新版改回 pending 时，消费者当前拒绝", () => {
  const f = seedPinned();
  let s = reviewKnowledgeItem(f.state, "ki_p", { baseRevision: 1, decision: "confirmed", basis: "核对" }).state;
  s = updateKnowledgeItem(s, "ki_p", { baseRevision: 2, patch: { text: "合成对象A在 1 d 下培养（修订）" }, reason: "内容修订" }).state;
  const pinned = (readKnowledgeVersion(s.knowledge, { kind: "item", id: "ki_p", revision: 2 }) as ItemPayload).review.status;
  const live = (s.knowledge.items.find((i) => i.id === "ki_p")!.payload as ItemPayload).review.status;
  assert.equal(pinned, "confirmed", "被引用版本（第 2 版）已 confirmed");
  assert.equal(live, "pending", "当前版本（第 3 版）为 pending");

  let current = "allowed";
  try {
    pickCore(s, f.tableId, 2);
  } catch (e) {
    current = (e as AppError).details?.code as string ?? "rejected";
  }
  assert.equal(current, "item_not_confirmed", "记录当前行为：被引用版本已确认但新版回 pending 时被拒（与 §4.2 固定版口径待裁决差异）");
});

test("E6.5②c 与合同一致：当前版本被撤回时，即使固定版曾确认也拒绝（§4.2 现撤回阻断）", () => {
  const f = seedPinned();
  let s = reviewKnowledgeItem(f.state, "ki_p", { baseRevision: 1, decision: "confirmed", basis: "核对" }).state;
  s = reviewKnowledgeItem(s, "ki_p", { baseRevision: 2, decision: "withdrawn", basis: "撤回" }).state;
  const err = (() => { try { pickCore(s, f.tableId, 2); return null; } catch (e) { return e as AppError; } })();
  assert.ok(err, "现撤回必须阻断正式使用");
  assert.equal(err!.details?.code, "item_not_confirmed");
});
// ══ E6-A 容器/流水线数据接线（合同 E6.2/E6.3、E6.5 子用例 ①–⑤）══════════════

test("E6-A① 计数分列：匹配/已加载/总量与元素、聚合、同源列表一致", () => {
  const f = seedE4();
  const c = buildKnowledgeContainer(f.state, { source: "current", topicId: f.topicId });
  assert.equal(c.elements.filter((e) => e.kind === "item").length, c.totals.items);
  assert.equal(c.elements.filter((e) => e.kind === "dataset").length, c.totals.datasets);
  assert.equal(c.totals.datasets, 1, "数据集进容器为聚合元素，不展开为 item");
  assert.equal(c.counts.loaded, c.elements.filter((e) => e.kind === "item").length, "已加载数=元素条数");
  assert.equal(c.counts.matched, c.totals.items, "无筛选时匹配数=本视图条数");
  assert.equal(c.counts.totalKnown, f.state.knowledge.items.length, "总量与库内条数一致（不把一页冒称全库）");
  const agg = c.elements.find((e) => e.kind === "dataset")!;
  assert.equal(agg.aggregate!.rows, 3, "聚合元素带真实行数（不改造成 item）");

  const paged = buildKnowledgeContainer(f.state, { source: "current", topicId: f.topicId, pageSize: 3 });
  assert.equal(paged.counts.loaded, 3);
  assert.equal(paged.hasMore, true);
  assert.ok(paged.nextCursor !== null);
  assert.ok(paged.counts.matched > paged.counts.loaded, "匹配数与已加载数分开明示");
});

test("E6-A② 不重复计数：卡壳多分项按分项计、同源论文一份来源、卡不另计知识", () => {
  const b = seed({ items: 2, withContext: true });
  const c = buildKnowledgeContainer(b.state, { source: "current", topicId: b.topicId, mode: "explore" });
  assert.equal(c.totals.items, 2, "两项分项各计一条");
  assert.equal(c.elements.some((e) => (e as { kind: string }).kind === "card"), false, "卡壳本身不成为知识元素");
  assert.equal(c.cardIndex.length, 1, "卡壳索引单列");
  assert.equal(c.cardIndex[0].itemRefs.length, 2, "卡壳指向其分项（不重复计为独立知识）");
  assert.equal(c.bySource.length, 1, "同源论文只呈现一份来源入口");
  assert.equal(c.bySource[0].itemRefs.length, 2, "该来源下挂两项");
  assert.ok(c.elements.every((e) => e.sourceClass !== "dataset" || e.kind === "dataset"));
});

test("E6-A③ 固定版本回查：元素 ref 可读且 revision 与当前一致；未知/条件随项带回", () => {
  const f = seedE5();
  const c = buildKnowledgeContainer(f.state, { source: "current", topicId: f.topicId });
  const el = c.elements.find((e) => e.kind === "item" && e.ref.id === "ki_A")!;
  assert.equal(el.ref.revision, 1);
  assert.ok(readKnowledgeVersion(f.state.knowledge, el.ref), "元素 ref 按固定版本可读");
  assert.equal(el.valueText, "1 d", "完整原值文本随元素（摘要只压缩显示）");
  const t25 = c.elements.find((e) => e.ref.id === "ki_T25")!;
  assert.ok(t25.conditionTexts.some((t) => t.includes("温度=25")), "条件跟随知识项");
  const dsEl = c.elements.find((e) => e.kind === "dataset")!;
  assert.ok(dsEl.sourceTokens.length >= 1, "数据集元素带来源 token 以便回查");
});

test("E6-A⑤ 作用域不串：容器只含本课题；主题筛选与未分主题单列", () => {
  const f = seedE5();
  const other = createTopic(f.state, { name: "合成课题乙", researchQuestion: "Q2" });
  let s: LocusState = other.state;
  s = { ...s, knowledge: { ...s.knowledge, items: [...s.knowledge.items, envOf("ki_bx", {
    contentType: "claim", nature: "human_judgment", text: "乙的判断", subject: { raw: "合成对象A" }, predicate: { raw: "私有" },
    value: null, contextRefs: [], evidenceRefs: [], sourceRefs: [f.srcRef],
    origin: { sourceClass: "human_statement", createdBy: "human", secondaryCitation: false },
    scopeText: "", unknowns: [], topicIds: [other.topic.id], subquestionIds: [], review: { status: "confirmed" },
  })] } };
  const c = buildKnowledgeContainer(s, { source: "current", topicId: f.topicId });
  assert.ok(!c.elements.some((e) => e.ref.id === "ki_bx"), "容器不含其他课题内容");
  const themed = buildKnowledgeContainer(s, { source: "current", topicId: f.topicId, themeId: f.themeId });
  assert.ok(themed.totals.items < c.totals.items, "主题筛选收窄视图");
  assert.ok(themed.byTheme.some((t) => t.themeId === f.themeId));
  assert.ok(Array.isArray(c.undivided), "未分主题项单列，不丢弃");
  assert.ok(c.dedupNote.includes("固定引用"));
});

test("E6-A④ 流水线状态只统计已落库回执：失败/取消/重放不重复计数", () => {
  const f = seedE4();
  const run = {
    id: "kr_x", idempotencyKey: "k1", inputHash: "h", paperRef: f.srcRef, attachmentRefs: [f.srcRef],
    purpose: "P", promptVersion: "v1", schemaVersion: 1, createdAt: "t", updatedAt: "t",
    status: "partial" as const,
    chunks: [
      { id: "chunk_0", sourceRef: f.srcRef, start: 0, end: 5, additionalRanges: [], sourceTextHash: "a", status: "committed" as const, receipt: { inputHash: "a", committedAt: "t", cardIds: ["c1"], itemIds: ["i1"], contextIds: [], evidenceIds: [], relationIds: [], response: { created: 1, skipped: 0, createdItems: 2, pendingItems: 2 } } },
      { id: "chunk_1", sourceRef: f.srcRef, start: 5, end: 10, additionalRanges: [], sourceTextHash: "b", status: "failed" as const, error: "boom" },
      { id: "chunk_2", sourceRef: f.srcRef, start: 10, end: 15, additionalRanges: [], sourceTextHash: "c", status: "discarded" as const },
    ],
  };
  const s: LocusState = { ...f.state, knowledge: { ...f.state.knowledge, extractionRuns: [...f.state.knowledge.extractionRuns, run] } };
  const st = knowledgePipelineStatus(s, "kr_x")!;
  assert.equal(st.status, "partial");
  assert.deepEqual(st.counters, { created: 1, skipped: 0, createdItems: 2, pendingItems: 2 }, "计数只来自已落库回执");
  assert.equal(st.chunks.filter((c) => c.hasReceipt).length, 1);
  assert.ok(st.notes.some((n) => n.includes("失败")), "失败块可见");
  assert.ok(st.notes.some((n) => n.includes("取消")), "丢弃块可见");
  // 重复查询（等同回执重放/刷新）不改变计数
  assert.deepEqual(knowledgePipelineStatus(s, "kr_x")!.counters, st.counters);
  assert.equal(knowledgePipelineStatus(s, "kr_missing"), null);
});
