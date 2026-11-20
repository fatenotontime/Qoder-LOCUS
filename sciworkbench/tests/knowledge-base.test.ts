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
import { importMeasurements, reviewTable } from "../services/app.ts";
import { buildWholeLibraryPackage, inspectLibraryJson, sha256 } from "../services/export.ts";
import {
  archiveSourceVersion, currentSourceRef, readSourceVersion, resolveSourceVersion, sourcePayload,
} from "../services/knowledge-base.ts";

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