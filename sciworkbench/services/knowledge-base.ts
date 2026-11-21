/**
 * 知识基座（合同 §5.2 源历史、§4.2 固定版本解析、§4.6/§4.7 分项人审与门槛）：
 * 源引用求值、纳管归档、固定版本解析，以及 item/context/evidence 的更新·审核·定位修订、
 * 旧卡显式结构化、主题与人工认识（statement）。
 * 共享函数，供总览/wiki/比较/AI 读取与导出复用；不做网络、不做 UI。
 *
 * 原则：
 * - 首次引用当前源时保存基线，不扫描全库复制历史（纳管范围由引用闭包决定）。
 * - sourceVersions 每个键（kind+id+version）只追加一次，不覆盖。
 * - payload 为该类型完整可回查内容，不递归包含 knowledge 自身；原件保留实际 text。
 * - 外部手工改 state 导致已归档同版本 hash 不符 → content_mismatch，不覆盖存档。
 * - 分项人审（E3）：审核状态只由专用 review 接口改变；科学内容更改 → 新 revision 且置 pending，
 *   归属/标签更改 → 新 revision 保留审核；引用固定 revision，旧版从 history 读，不用 latest 兜底。
 */
import { randomUUID } from "node:crypto";
import type { LitCardRecord, LocusState } from "../store.ts";
import { contentHash } from "../store.ts";
import {
  ITEM_CONTENT_TYPES, ITEM_NATURES, KNOWLEDGE_KINDS, LOCATION_STATUSES, NONDIMENSIONAL_UNIT,
  OBTAINED_BY, REVIEW_DECISIONS, SOURCE_CLASSES, UNCERTAINTY_TYPES, UNKNOWN_REASON_CODES,
  VALUE_KINDS, VALUE_OPERATORS,
  canonicalHash, isKnowledgeRef, isSourceRef, knowledgeRef as makeKnowledgeRef,
  pendingReview, refKey,
  sourceRef as makeSourceRef,
  type ConditionEntry, type ContextPayload, type EvidencePayload, type ItemContentType,
  type ItemNature, type ItemPayload, type KnowledgeContext, type KnowledgeEnvelope,
  type KnowledgeEvidence, type KnowledgeItem, type KnowledgeKind, type KnowledgeRef, type KnowledgeTheme,
  type KnowledgeState, type LocationStatus, type Locator, type ObtainedBy, type Origin,
  type RelationPayload, type Review, type ReviewStatus, type SourceClass, type SourceKind,
  type SourceRef, type SourceVersionRecord, type ThemePayload, type TypedValue, type Unknown,
  type UnknownReasonCode, type ValueKind,
} from "../domain/knowledge.ts";
import { AppError, isStructuredShell } from "./app.ts";

const now = () => new Date().toISOString();
const sourceKey = (r: SourceRef) => `${r.kind}:${r.id}@${r.version}`;

/** 该类型的完整可回查 payload（不递归 knowledge；不存在返回 undefined）。 */
export function sourcePayload(state: LocusState, kind: SourceKind, id: string): unknown | undefined {
  switch (kind) {
    case "topic": return state.topics.find((x) => x.id === id);
    case "subquestion": return state.subquestions.find((x) => x.id === id);
    case "paper": return state.papers.find((x) => x.id === id);
    case "attachment": return state.attachments.find((x) => x.id === id);
    case "asset": return state.assets.find((x) => x.id === id); // 含实际 text
    case "card": return state.cards.find((x) => x.id === id);
    case "table": return state.tables.find((x) => x.id === id);
    case "protocol": return state.protocols.find((x) => x.id === id);
    case "template": return state.templates.find((x) => x.id === id);
    case "execution": return state.executions.find((x) => x.id === id);
    case "sample": return state.samples.find((x) => x.id === id);
    case "measurement": return state.measurements.find((x) => x.id === id);
    case "result": return state.analysisResults.find((x) => x.id === id);
    case "report": return state.reports.find((x) => x.id === id);
    case "ocr": return state.ocrs.find((x) => x.id === id);
    case "report_block": {
      const reportId = id.includes("#") ? id.slice(0, id.indexOf("#")) : "";
      const blockId = id.includes("#") ? id.slice(id.indexOf("#") + 1) : id;
      const rep = state.reports.find((r) => r.id === reportId);
      return rep?.blocks.find((b) => b.id === blockId || b.id === id);
    }
    case "chat_proposal": {
      for (const chat of state.chats) {
        for (const m of chat.messages) {
          const p = m.proposals.find((x) => `${chat.id}/${m.id}/${x.targetId}` === id || x.targetId === id);
          if (p) return p;
        }
      }
      return undefined;
    }
    default: return undefined;
  }
}

/** 某类型当前 SourceRef 的版本标识：业务修订 r:N；无修订的纳管对象 k:N；不可变原件 sha256:HASH。 */
function currentVersion(kind: SourceKind, obj: Record<string, unknown>): string {
  if (kind === "asset") {
    const h = typeof obj.hash === "string" ? obj.hash : contentHash(String(obj.text ?? ""));
    return `sha256:${h}`;
  }
  if (kind === "attachment") return "k:1";
  if (typeof obj.revision === "number") return `r:${obj.revision}`;
  return "k:1";
}

/** 求某业务对象当前 SourceRef（version + contentHash）。对象不存在返回 null。 */
export function currentSourceRef(state: LocusState, kind: SourceKind, id: string): SourceRef | null {
  const payload = sourcePayload(state, kind, id);
  if (payload === undefined || payload === null) return null;
  const obj = payload as Record<string, unknown>;
  return makeSourceRef(kind, id, currentVersion(kind, obj), canonicalHash(payload));
}

/** 纳管：同键只追加一次；已存在即复用，不覆盖。 */
export function archiveSourceVersion(k: KnowledgeState, ref: SourceRef, payload: unknown): KnowledgeState {
  const key = sourceKey(ref);
  if (k.sourceVersions.some((v) => sourceKey(v.sourceRef) === key)) return k;
  const rec: SourceVersionRecord = { sourceRef: ref, archivedAt: now(), payload };
  return { ...k, sourceVersions: [...k.sourceVersions, rec] };
}

/** 便捷：求当前 SourceRef 并纳管（首次引用基线）。 */
export function ensureArchived(state: LocusState, k: KnowledgeState, kind: SourceKind, id: string): { ref: SourceRef; knowledge: KnowledgeState } | null {
  const ref = currentSourceRef(state, kind, id);
  if (!ref) return null;
  const payload = sourcePayload(state, kind, id);
  return { ref, knowledge: archiveSourceVersion(k, ref, payload) };
}

/** 读某固定版本 payload；不存在返回 null。 */
export function readSourceVersion(k: KnowledgeState, ref: SourceRef): unknown | null {
  const hit = k.sourceVersions.find((v) => sourceKey(v.sourceRef) === sourceKey(ref));
  return hit ? hit.payload : null;
}

export type SourceVersionResolution =
  | { readonly status: "ok"; readonly payload: unknown; readonly ref: SourceRef }
  | { readonly status: "source_missing" }
  | { readonly status: "history_unavailable"; readonly ref: SourceRef }
  | { readonly status: "content_mismatch"; readonly ref: SourceRef; readonly expected: string; readonly actual: string };

/**
 * 固定版本解析（读路径，不写库）：
 * 1. 来源对象已不存在 → source_missing（不读 latest 冒充旧版）。
 * 2. 已归档同版本 → 校验 contentHash；不符 → content_mismatch（不覆盖存档）。
 * 3. 未归档但请求的正是当前版本且 hash 相符 → ok（当前基线可读）。
 * 4. 否则 → history_unavailable（不推测补齐）。
 */
export function resolveSourceVersion(state: LocusState, k: KnowledgeState, ref: SourceRef): SourceVersionResolution {
  const payloadNow = sourcePayload(state, ref.kind, ref.id);
  const archived = k.sourceVersions.find((v) => sourceKey(v.sourceRef) === sourceKey(ref));
  if (archived) {
    const actual = canonicalHash(archived.payload);
    if (actual !== ref.contentHash) return { status: "content_mismatch", ref, expected: ref.contentHash, actual };
    return { status: "ok", payload: archived.payload, ref };
  }
  if (payloadNow === undefined || payloadNow === null) return { status: "source_missing" };
  const current = currentSourceRef(state, ref.kind, ref.id);
  if (current && current.version === ref.version && current.contentHash === ref.contentHash) {
    return { status: "ok", payload: payloadNow, ref };
  }
  return { status: "history_unavailable", ref };
}

/** 供读取闭包：给定来源种类/ID 解析其“当前”固定引用。 */
export function sourceRefOf(state: LocusState, kind: SourceKind, id: string): SourceRef {
  const ref = currentSourceRef(state, kind, id);
  if (!ref) throw new Error(`来源不存在：${kind} ${id}`);
  return ref;
}

// ══ E3 分项人审（合同 §4.2/§4.6/§4.7、§8.1）═════════════════════════════
//
// 通用约定：
// - 写操作一律 { baseRevision, patch | decision… }；baseRevision 不符 → 409 stale_revision（保护过期编辑）。
// - patch 里出现 review/history/revision/origin/cardId 等生命周期字段 → 422，不静默接受也不静默剔除。
// - 值/引用/未知项按 §4.3/§4.4 严格校验，非法即 422，不做“尽力猜测”。

type AnyEnvelope = KnowledgeEnvelope<unknown>;

const COLLECTION_BY_KIND: Record<KnowledgeKind, keyof KnowledgeState> = {
  item: "items", context: "contexts", evidence: "evidence", relation: "relations",
  theme: "themes", mapping: "mappings", dataset: "datasets", comparison: "comparisons",
};
const LIFECYCLE_KEYS = ["review", "history", "revision", "id", "stableId", "createdAt", "updatedAt", "cardId", "createdFromRunId", "origin"];
const uuid = () => randomUUID().slice(0, 8);

function envList(k: KnowledgeState, kind: KnowledgeKind): AnyEnvelope[] {
  return k[COLLECTION_BY_KIND[kind]] as unknown as AnyEnvelope[];
}
function findEnv(k: KnowledgeState, kind: KnowledgeKind, id: string): AnyEnvelope | undefined {
  return envList(k, kind).find((e) => e.id === id);
}
function replaceEnv(k: KnowledgeState, kind: KnowledgeKind, env: AnyEnvelope): KnowledgeState {
  return { ...k, [COLLECTION_BY_KIND[kind]]: envList(k, kind).map((e) => (e.id === env.id ? env : e)) } as unknown as KnowledgeState;
}
function appendEnv(k: KnowledgeState, kind: KnowledgeKind, env: AnyEnvelope): KnowledgeState {
  return { ...k, [COLLECTION_BY_KIND[kind]]: [...envList(k, kind), env] } as unknown as KnowledgeState;
}

/** append-only 版本推进：旧 payload 完整进 history，新 revision 保存完整当前 payload。 */
function bumpEnv<P>(env: KnowledgeEnvelope<P>, next: P, reason: string): KnowledgeEnvelope<P> {
  const at = now();
  return {
    id: env.id, revision: env.revision + 1, createdAt: env.createdAt, updatedAt: at,
    payload: next,
    history: [...env.history, { revision: env.revision, at, reason, payload: env.payload }],
  };
}
function newEnv<P>(kind: KnowledgeKind, id: string, payload: P): KnowledgeEnvelope<P> {
  const at = now();
  return { id, revision: 1, createdAt: at, updatedAt: at, payload, history: [] };
}

/** 固定版本读取：对象或版本不存在 → null（消费者不得用 latest 兜底）。 */
export function readKnowledgeVersion(k: KnowledgeState, ref: KnowledgeRef): unknown | null {
  if (!isKnowledgeRef(ref)) return null;
  const env = findEnv(k, ref.kind, ref.id);
  if (!env) return null;
  if (ref.revision === env.revision) return env.payload;
  const hit = env.history.find((h) => h.revision === ref.revision);
  return hit ? hit.payload ?? null : null;
}

/** 对象当前版本引用（不存在 → null）。 */
export function currentKnowledgeRef(k: KnowledgeState, kind: KnowledgeKind, id: string): KnowledgeRef | null {
  const env = findEnv(k, kind, id);
  return env ? makeKnowledgeRef(kind, env.id, env.revision) : null;
}

function assertVersionResolvable(k: KnowledgeState, ref: KnowledgeRef, field: string): unknown {
  const payload = readKnowledgeVersion(k, ref);
  if (payload === null) {
    throw new AppError(422, `${field}引用的版本不存在：${refKey(ref)}（不退回最新版，请重新选择）。`, { code: "ref_unresolvable", ref });
  }
  return payload;
}

// ── 严格输入校验（人工编辑；不同于 §6.2 的模型输出校验，这里拒绝而非清洗）──

function record(v: unknown, field: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new AppError(422, `${field}须为对象。`);
  return v as Record<string, unknown>;
}
function reqText(v: unknown, field: string, max: number): string {
  if (typeof v === "number") v = String(v);
  if (typeof v !== "string") throw new AppError(422, `${field}须为文本。`);
  const s = v.trim();
  if (!s) throw new AppError(422, `${field}不能为空。`);
  if (s.length > max) throw new AppError(422, `${field}过长（上限 ${max} 字）。`);
  return s;
}
function enumOf(v: unknown, field: string, allowed: readonly string[]): string {
  const s = reqText(v, field, 40);
  if (!allowed.includes(s)) throw new AppError(422, `${field}取值非法：${s}（允许 ${allowed.join("/")}）。`);
  return s;
}
/** 未知字段即拒绝；生命周期字段单列错误，保证“伪造审核不生效”可解释（T15）。 */
function assertKeys(o: Record<string, unknown>, allowed: readonly string[], field: string): void {
  for (const key of Object.keys(o)) {
    if (LIFECYCLE_KEYS.includes(key) && !allowed.includes(key)) {
      throw new AppError(422, `${field} 里的 ${key} 属生命周期字段，不能随内容提交，请使用专用审核接口。`, { code: "lifecycle_field_forbidden", field: key });
    }
    if (!allowed.includes(key)) throw new AppError(422, `${field} 含不支持的字段：${key}`);
  }
}
function requireBaseRevision(given: unknown, env: { revision: number }, what: string): void {
  if (typeof given !== "number" || !Number.isInteger(given)) throw new AppError(422, `${what}更新缺少 baseRevision（当前第 ${env.revision} 版）。`);
  if (given !== env.revision) {
    throw new AppError(409, `${what}已有新版本（当前第 ${env.revision} 版）。本次改动未覆盖他人编辑，请刷新后重做。`, { code: "stale_revision", currentRevision: env.revision });
  }
}
function idArray(v: unknown, field: string, max: number): string[] {
  if (!Array.isArray(v)) throw new AppError(422, `${field}须为数组。`);
  if (v.length > max) throw new AppError(422, `${field}数量过多（上限 ${max}）。`);
  const out: string[] = [];
  for (const [i, x] of v.entries()) {
    const s = reqText(x, `${field}[${i}]`, 60);
    if (!out.includes(s)) out.push(s);
  }
  return out;
}
function checkTopics(state: LocusState, ids: string[], field: string): void {
  for (const id of ids) if (!state.topics.some((t) => t.id === id)) throw new AppError(422, `${field}里的课题不存在：${id}`, { code: "topic_missing" });
}
function checkSubquestions(state: LocusState, ids: string[], topicIds: string[], field: string): void {
  for (const id of ids) {
    const q = state.subquestions.find((x) => x.id === id);
    if (!q) throw new AppError(422, `${field}里的子问题不存在：${id}`, { code: "subquestion_missing" });
    if (topicIds.length && !topicIds.includes(q.topicId)) throw new AppError(422, `${field}里的子问题不属于所填课题：${id}`, { code: "subquestion_scope_mismatch" });
  }
}

const NUMERIC = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
function numeric(v: unknown, field: string): string {
  if (typeof v !== "string" && typeof v !== "number") throw new AppError(422, `${field}须为十进制数字文本。`);
  const s = String(v).trim();
  if (!NUMERIC.test(s)) throw new AppError(422, `${field}不是合法数字：${s.slice(0, 24)}（不猜、不四舍五入、不默认 0）。`);
  return s;
}
function unitOf(v: unknown, field: string): string | null {
  if (v === null || v === undefined || v === "") return null;
  return reqText(v, `${field}.unit`, 40);
}

/** §4.3 TypedValue 严格校验（人工输入）。 */
export function strictValue(v: unknown, field: string): TypedValue {
  const o = record(v, field);
  const kind = enumOf(o.kind, `${field}.kind`, VALUE_KINDS) as ValueKind;
  const raw = reqText(o.raw, `${field}.raw`, 400);
  if (kind === "scalar") {
    assertKeys(o, ["kind", "raw", "value", "unit", "flags"], field);
    const value = o.value === null || o.value === undefined ? null : numeric(o.value, `${field}.value`);
    const flags = o.flags === undefined || o.flags === null ? undefined : idArray(o.flags, `${field}.flags`, 8);
    return { kind, raw, value, unit: unitOf(o.unit, field), ...(flags && flags.length ? { flags } : {}) };
  }
  if (kind === "bound") {
    assertKeys(o, ["kind", "raw", "operator", "value", "unit"], field);
    return { kind, raw, operator: enumOf(o.operator, `${field}.operator`, VALUE_OPERATORS) as "gt" | "gte" | "lt" | "lte", value: numeric(o.value, `${field}.value`), unit: unitOf(o.unit, field) };
  }
  if (kind === "range") {
    assertKeys(o, ["kind", "raw", "lower", "upper", "unit"], field);
    return { kind, raw, lower: numeric(o.lower, `${field}.lower`), upper: numeric(o.upper, `${field}.upper`), unit: unitOf(o.unit, field) };
  }
  if (kind === "category") {
    assertKeys(o, ["kind", "raw", "label", "unparsed_numeric"], field);
    const label = reqText(o.label, `${field}.label`, 200);
    return { kind, raw, label, ...(o.unparsed_numeric === true ? { unparsed_numeric: true } : {}) };
  }
  if (kind === "summary") {
    assertKeys(o, ["kind", "raw", "statistic", "value", "unit", "uncertainty", "sampleSize"], field);
    const out: Record<string, unknown> = { kind, raw, statistic: reqText(o.statistic, `${field}.statistic`, 60), value: numeric(o.value, `${field}.value`), unit: unitOf(o.unit, field) };
    if (o.uncertainty !== undefined && o.uncertainty !== null) {
      const u = record(o.uncertainty, `${field}.uncertainty`);
      assertKeys(u, ["type", "value"], `${field}.uncertainty`);
      out.uncertainty = { type: enumOf(u.type, `${field}.uncertainty.type`, UNCERTAINTY_TYPES) as "SD" | "SE" | "CI", value: numeric(u.value, `${field}.uncertainty.value`) };
    }
    if (o.sampleSize !== undefined && o.sampleSize !== null) {
      const n = typeof o.sampleSize === "number" ? o.sampleSize : Number(reqText(o.sampleSize, `${field}.sampleSize`, 12));
      if (!Number.isInteger(n) || n <= 0) throw new AppError(422, `${field}.sampleSize 须为正整数。`);
      out.sampleSize = n;
    }
    return out as unknown as TypedValue;
  }
  assertKeys(o, ["kind", "raw", "reasonCode"], field);
  return { kind: "missing", raw, reasonCode: enumOf(o.reasonCode, `${field}.reasonCode`, UNKNOWN_REASON_CODES) as UnknownReasonCode };
}

function strictAnyRef(v: unknown, field: string): KnowledgeRef | SourceRef {
  const o = record(v, field);
  if (isKnowledgeRef(o)) return { kind: o.kind, id: o.id, revision: o.revision };
  if (isSourceRef(o)) return { kind: o.kind, id: o.id, version: o.version, contentHash: o.contentHash };
  throw new AppError(422, `${field}须为知识引用 {kind,id,revision} 或来源引用 {kind,id,version,contentHash}。`);
}

function strictKnowledgeRefs(v: unknown, allowed: readonly KnowledgeKind[], field: string): KnowledgeRef[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new AppError(422, `${field}须为数组。`);
  if (v.length > 40) throw new AppError(422, `${field}数量过多（上限 40）。`);
  const out: KnowledgeRef[] = [];
  for (const [i, x] of v.entries()) {
    const o = record(x, `${field}[${i}]`);
    if (!isKnowledgeRef(o)) throw new AppError(422, `${field}[${i}] 须为 {kind,id,revision}，revision 为正整数。`);
    if (!allowed.includes(o.kind)) throw new AppError(422, `${field} 不支持的类型：${o.kind}（允许 ${allowed.join("/")}）。`);
    if (!out.some((r) => refKey(r) === refKey(o))) out.push({ kind: o.kind, id: o.id, revision: o.revision });
  }
  return out;
}

function strictEvidenceBindings(v: unknown, field: string): { ref: KnowledgeRef; fieldPaths: string[] }[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new AppError(422, `${field}须为数组。`);
  if (v.length > 40) throw new AppError(422, `${field}数量过多（上限 40）。`);
  const out: { ref: KnowledgeRef; fieldPaths: string[] }[] = [];
  for (const [i, x] of v.entries()) {
    const o = record(x, `${field}[${i}]`);
    assertKeys(o, ["ref", "fieldPaths"], `${field}[${i}]`);
    const ref = strictKnowledgeRefs([o.ref], ["evidence"], `${field}[${i}].ref`)[0];
    const fieldPaths = o.fieldPaths === undefined || o.fieldPaths === null ? [] : idArray(o.fieldPaths, `${field}[${i}].fieldPaths`, 8).map((s) => s.slice(0, 80));
    if (!out.some((b) => refKey(b.ref) === refKey(ref) && canonicalHash(b.fieldPaths) === canonicalHash(fieldPaths))) out.push({ ref, fieldPaths });
  }
  return out;
}

function strictSourceRefs(v: unknown, field: string): SourceRef[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new AppError(422, `${field}须为数组。`);
  if (v.length > 40) throw new AppError(422, `${field}数量过多（上限 40）。`);
  const out: SourceRef[] = [];
  for (const [i, x] of v.entries()) {
    const o = record(x, `${field}[${i}]`);
    if (!isSourceRef(o)) throw new AppError(422, `${field}[${i}] 须为 {kind,id,version,contentHash} 来源引用。`);
    if (!out.some((s) => `${s.kind}:${s.id}@${s.version}` === `${o.kind}:${o.id}@${o.version}`)) out.push({ kind: o.kind, id: o.id, version: o.version, contentHash: o.contentHash });
  }
  return out;
}

/** 来源绑定必须可读（已纳管或正是当前基线），否则拒绝而非留空。 */
function assertSourcesReadable(state: LocusState, k: KnowledgeState, refs: SourceRef[], field: string): void {
  for (const r of refs) {
    const res = resolveSourceVersion(state, k, r);
    if (res.status !== "ok") {
      throw new AppError(422, `来源版本不可读：${r.kind} ${r.id} ${r.version}（${res.status === "content_mismatch" ? "存档内容与 hash 不符" : res.status === "source_missing" ? "来源已不存在" : "旧版本未纳管"}）。`, { code: res.status, ref: r, field });
    }
  }
}

function strictSubject(v: unknown): ItemPayload["subject"] {
  const o = record(v, "subject");
  assertKeys(o, ["raw", "entityRef"], "subject");
  const raw = reqText(o.raw, "subject.raw", 300);
  return o.entityRef === undefined || o.entityRef === null ? { raw } : { raw, entityRef: strictAnyRef(o.entityRef, "subject.entityRef") };
}
function strictPredicate(v: unknown): ItemPayload["predicate"] {
  const o = record(v, "predicate");
  assertKeys(o, ["raw", "metricId"], "predicate");
  const raw = reqText(o.raw, "predicate.raw", 200);
  return o.metricId === undefined || o.metricId === null ? { raw } : { raw, metricId: reqText(o.metricId, "predicate.metricId", 80) };
}

function strictUnknowns(v: unknown, field: string): Unknown[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new AppError(422, `${field}须为数组。`);
  if (v.length > 20) throw new AppError(422, `${field}数量过多（上限 20）。`);
  return v.map((x, i) => {
    const o = record(x, `${field}[${i}]`);
    assertKeys(o, ["id", "fieldPath", "reasonCode", "detail", "scopeRefs", "evidenceRefs"], `${field}[${i}]`);
    const id = o.id === undefined || o.id === null ? `kuk_${uuid()}` : reqText(o.id, `${field}[${i}].id`, 60);
    const detail = reqText(o.detail, `${field}[${i}].detail`, 400);
    const scopeRefs = o.scopeRefs === undefined || o.scopeRefs === null ? [] : (Array.isArray(o.scopeRefs) ? o.scopeRefs : []).map((r, j) => strictAnyRef(r, `${field}[${i}].scopeRefs[${j}]`));
    return {
      id,
      fieldPath: reqText(o.fieldPath, `${field}[${i}].fieldPath`, 120),
      reasonCode: enumOf(o.reasonCode, `${field}[${i}].reasonCode`, UNKNOWN_REASON_CODES) as UnknownReasonCode,
      detail,
      scopeRefs,
      evidenceRefs: strictKnowledgeRefs(o.evidenceRefs ?? [], ["evidence"], `${field}[${i}].evidenceRefs`),
    };
  });
}

// ── 确认门槛（§4.7 正式使用门槛 + §4.6.4 未定位引文不能装成确定证据）─────

/**
 * 引文定位状态按**钉住的版本**判定（§4.6.9「逐项验证所选固定 revision」）：
 * 「定位修订」生成新版后，旧引用不自动升级，须由人在界面上显式改绑新版。
 */
function evidenceLocationStatus(k: KnowledgeState, ref: KnowledgeRef, field: string): LocationStatus {
  return (assertVersionResolvable(k, ref, field) as EvidencePayload).locationStatus;
}

/** 逐项确认门槛：证据已逐字定位、来源可读、条件已审、模型/文献项有锚点。 */
function assertItemConfirmable(state: LocusState, k: KnowledgeState, payload: ItemPayload): void {
  const unresolved: string[] = [];
  for (const b of payload.evidenceRefs) {
    if (evidenceLocationStatus(k, b.ref, "evidenceRefs") !== "matched") unresolved.push(refKey(b.ref));
  }
  if (unresolved.length) {
    throw new AppError(422, `引文尚未逐字定位（${unresolved.length} 条），不能确认为可共享知识；请用「定位修订」选定唯一位置。`, { code: "evidence_unresolved", refs: unresolved });
  }
  assertSourcesReadable(state, k, payload.sourceRefs, "sourceRefs");
  for (const c of payload.contextRefs) {
    assertVersionResolvable(k, c, "contextRefs");
    // 条件每次审阅都会产生新版本：审核态按条件对象的最新版判定，固定在旧版不应让「先审条件」永远满足不了。
    const env = findEnv(k, c.kind, c.id);
    const cp = (env ? env.payload : null) as ContextPayload | null;
    if (!cp) throw new AppError(422, `条件（${refKey(c)}）已不存在，不能作为确认依据；请重新绑定条件。`, { code: "context_missing", ref: c });
    if (cp.review.status === "pending") {
      throw new AppError(422, `条件（${refKey(c)}）尚未审阅：先逐项确认条件，再确认知识项。`, { code: "context_pending", ref: currentKnowledgeRef(k, c.kind, c.id) ?? c });
    }
    if (cp.review.status === "excluded" || cp.review.status === "withdrawn") {
      throw new AppError(422, `条件（${refKey(c)}）已排除/撤回，不能作为确认依据；请改绑新版条件。`, { code: "context_excluded", ref: currentKnowledgeRef(k, c.kind, c.id) ?? c });
    }
  }
  const modelSourced = payload.origin.createdBy !== "human" || payload.origin.sourceClass === "literature_report" || payload.origin.sourceClass === "model_suggestion";
  if (modelSourced && !payload.evidenceRefs.length && !payload.sourceRefs.length) {
    throw new AppError(422, "模型或文献来源的知识项没有引文/来源锚点，不能确认（人工记录请用「人工认识」入口）。", { code: "anchor_required" });
  }
}

function assertConditionConfirmable(state: LocusState, k: KnowledgeState, cond: ConditionEntry): void {
  const unresolved: string[] = [];
  for (const ref of cond.evidenceRefs) {
    if (evidenceLocationStatus(k, ref, "conditions.evidenceRefs") !== "matched") unresolved.push(refKey(ref));
  }
  if (unresolved.length) {
    throw new AppError(422, `条件的引文未逐字定位（${unresolved.length} 条），先修订定位再确认。`, { code: "evidence_unresolved", refs: unresolved });
  }
  if (cond.obtainedBy === "source_explicit" && !cond.evidenceRefs.length) {
    throw new AppError(422, "标注「来源明写」的条件必须有已定位引文；若为人工记录或假设，请改条件来源方式。", { code: "condition_anchor_required" });
  }
}

// ── item：更新 / 审核 ──────────────────────────────────────────────────

const ITEM_PATCH_KEYS = ["contentType", "nature", "text", "subject", "predicate", "value", "contextRefs", "evidenceRefs", "sourceRefs", "scopeText", "unknowns", "topicIds", "subquestionIds"];
const ITEM_SCIENTIFIC_KEYS = ["contentType", "nature", "text", "subject", "predicate", "value", "contextRefs", "evidenceRefs", "sourceRefs", "scopeText", "unknowns"];

/** §4.7：科学内容更改 → 新 revision 且 pending；仅归属/标签更改 → 新 revision 保留审核。 */
function applyItemPatch(state: LocusState, k: KnowledgeState, prev: ItemPayload, patch: unknown): { payload: ItemPayload; scientific: boolean } {
  const o = record(patch, "patch");
  assertKeys(o, ITEM_PATCH_KEYS, "patch");
  if (!Object.keys(o).length) throw new AppError(422, "没有需要保存的更改。");
  const next = structuredClone(prev);
  if (o.contentType !== undefined) next.contentType = enumOf(o.contentType, "contentType", ITEM_CONTENT_TYPES) as ItemContentType;
  if (o.nature !== undefined) next.nature = enumOf(o.nature, "nature", ITEM_NATURES) as ItemNature;
  if (o.text !== undefined) next.text = reqText(o.text, "text", 2000);
  if (o.subject !== undefined) next.subject = strictSubject(o.subject);
  if (o.predicate !== undefined) next.predicate = strictPredicate(o.predicate);
  if (o.value !== undefined) next.value = o.value === null ? null : strictValue(o.value, "value");
  if (o.contextRefs !== undefined) {
    next.contextRefs = strictKnowledgeRefs(o.contextRefs, ["context"], "contextRefs");
    for (const r of next.contextRefs) assertVersionResolvable(k, r, "contextRefs");
  }
  if (o.evidenceRefs !== undefined) {
    next.evidenceRefs = strictEvidenceBindings(o.evidenceRefs, "evidenceRefs");
    for (const b of next.evidenceRefs) assertVersionResolvable(k, b.ref, "evidenceRefs");
  }
  if (o.sourceRefs !== undefined) {
    next.sourceRefs = strictSourceRefs(o.sourceRefs, "sourceRefs");
    assertSourcesReadable(state, k, next.sourceRefs, "sourceRefs");
  }
  if (o.scopeText !== undefined) next.scopeText = reqText(o.scopeText, "scopeText", 2000);
  if (o.unknowns !== undefined) next.unknowns = strictUnknowns(o.unknowns, "unknowns");
  if (o.topicIds !== undefined) { next.topicIds = idArray(o.topicIds, "topicIds", 40); checkTopics(state, next.topicIds, "topicIds"); if (!next.topicIds.length) throw new AppError(422, "topicIds 不能为空：知识项至少属于一个课题。"); }
  if (o.subquestionIds !== undefined) { next.subquestionIds = idArray(o.subquestionIds, "subquestionIds", 40); checkSubquestions(state, next.subquestionIds, next.topicIds, "subquestionIds"); }
  const scientific = ITEM_SCIENTIFIC_KEYS.some((key) => canonicalHash((next as Record<string, unknown>)[key]) !== canonicalHash((prev as Record<string, unknown>)[key]));
  return { payload: next, scientific };
}

/** 分项编辑（专用 update 接口，不用旧 reviewCard）：过期编辑 → 409；夹带审核 → 422。 */
export function updateKnowledgeItem(state: LocusState, id: string, input: unknown): { state: LocusState; item: KnowledgeItem; scientific: boolean } {
  const k = state.knowledge;
  const env = findEnv(k, "item", id) as KnowledgeItem | undefined;
  if (!env) throw new AppError(404, `知识项不存在：${id}`);
  const body = record(input, "body");
  assertKeys(body, ["baseRevision", "patch", "reason"], "body");
  requireBaseRevision(body.baseRevision, env, "知识项");
  const reason = body.reason === undefined || body.reason === null ? "" : reqText(body.reason, "reason", 200);
  const { payload, scientific } = applyItemPatch(state, k, env.payload, body.patch);
  if (canonicalHash(payload) === canonicalHash(env.payload)) throw new AppError(422, "内容未变化，无需保存。");
  const nextPayload: ItemPayload = scientific ? { ...payload, review: pendingReview() } : payload;
  const suffix = reason ? `：${reason}` : "";
  const item = bumpEnv(env, nextPayload, (scientific ? "人工编辑科学内容" : "人工编辑归属") + suffix) as unknown as KnowledgeItem;
  return { state: syncShellAudit({ ...state, knowledge: replaceEnv(k, "item", item) }, nextPayload.cardId), item, scientific };
}

/** 分项审核（确认/待补/排除/撤回）：必须写依据；确认走 §4.7 门槛。 */
export function reviewKnowledgeItem(state: LocusState, id: string, input: unknown): { state: LocusState; item: KnowledgeItem } {
  const k = state.knowledge;
  const env = findEnv(k, "item", id) as KnowledgeItem | undefined;
  if (!env) throw new AppError(404, `知识项不存在：${id}`);
  const body = record(input, "body");
  assertKeys(body, ["baseRevision", "decision", "basis"], "body");
  requireBaseRevision(body.baseRevision, env, "知识项");
  const decision = enumOf(body.decision, "decision", REVIEW_DECISIONS) as ReviewStatus;
  const basis = reqText(body.basis, "核对依据", 500);
  const payload = env.payload;
  if (decision === "confirmed") assertItemConfirmable(state, k, payload);
  if (payload.review.status === decision && payload.review.basis === basis) throw new AppError(422, "审核状态与依据均未变化。");
  const review: Review = { status: decision, reviewedAt: now(), reviewedBy: "human", basis };
  const item = bumpEnv(env, { ...payload, review }, `人工审核：${decision}`) as unknown as KnowledgeItem;
  return { state: syncShellAudit({ ...state, knowledge: replaceEnv(k, "item", item) }, payload.cardId), item };
}

// ── context / condition：更新 / 审核 ────────────────────────────────────

const CONTEXT_PATCH_KEYS = ["subject", "groupLabel", "stage", "methodRefs", "conditions", "unknowns", "topicIds", "subquestionIds"];
const CONTEXT_SCIENTIFIC_KEYS = ["subject", "stage", "methodRefs", "conditions", "unknowns"];

const condScience = (c: ConditionEntry): string => canonicalHash({ ...c, review: null });

function strictConditions(state: LocusState, k: KnowledgeState, v: unknown, prev: ConditionEntry[], field: string, local?: Map<string, KnowledgeRef>): ConditionEntry[] {
  if (!Array.isArray(v)) throw new AppError(422, `${field}须为数组。`);
  if (v.length > 24) throw new AppError(422, `${field}数量过多（上限 24）。`);
  const out: ConditionEntry[] = [];
  for (const [i, x] of v.entries()) {
    const o = record(x, `${field}[${i}]`);
    assertKeys(o, ["id", "field", "value", "appliesTo", "evidenceRefs", "obtainedBy"], `${field}[${i}]`);
    const id = o.id === undefined || o.id === null ? `kcn_${uuid()}` : reqText(o.id, `${field}[${i}].id`, 60);
    const fo = record(o.field, `${field}[${i}].field`);
    assertKeys(fo, ["raw", "standardId"], `${field}[${i}].field`);
    const ao = record(o.appliesTo, `${field}[${i}].appliesTo`);
    assertKeys(ao, ["subject", "stage"], `${field}[${i}].appliesTo`);
    // 结构化提交内可用 localId 引用同批引文（与 methodRefs / items.evidenceRefs 同一约定）
    const evidenceRefs = local
      ? bindRefs(strictRefsWithLocal(o.evidenceRefs ?? [], ["evidence"], `${field}[${i}].evidenceRefs`), local, `${field}[${i}].evidenceRefs`)
      : strictKnowledgeRefs(o.evidenceRefs ?? [], ["evidence"], `${field}[${i}].evidenceRefs`);
    for (const ref of evidenceRefs) assertVersionResolvable(k, ref, `${field}[${i}].evidenceRefs`);
    const entry: ConditionEntry = {
      id,
      field: { raw: reqText(fo.raw, `${field}[${i}].field.raw`, 120), ...(fo.standardId ? { standardId: reqText(fo.standardId, `${field}[${i}].field.standardId`, 80) } : {}) },
      value: strictValue(o.value, `${field}[${i}].value`),
      appliesTo: { subject: reqText(ao.subject, `${field}[${i}].appliesTo.subject`, 80), stage: reqText(ao.stage, `${field}[${i}].appliesTo.stage`, 80) },
      evidenceRefs,
      obtainedBy: enumOf(o.obtainedBy, `${field}[${i}].obtainedBy`, OBTAINED_BY) as ObtainedBy,
      review: pendingReview(),
    };
    const before = prev.find((p) => p.id === id);
    // 条件内容不变 → 保留其审核；值/字段/适用范围/引文/来源方式任一更改 → 该条件回 pending（§4.2）
    if (before && condScience(before) === condScience(entry)) entry.review = before.review;
    if (out.some((p) => p.id === id)) throw new AppError(422, `${field} 里有重复的条件 id：${id}`);
    out.push(entry);
  }
  return out;
}

/**
 * §4.7：条件对象更改或不再是「已确认」时，依赖它的已确认知识项回 pending。
 * 只标记需复审，绝不自动确认；返回受影响项供前端提示。
 */
function demoteItemsDependingOn(state: LocusState, contextId: string, reason: string): { state: LocusState; affectedItems: { id: string; revision: number }[] } {
  const affected: { id: string; revision: number }[] = [];
  let knowledge = state.knowledge;
  for (const env of state.knowledge.items) {
    const payload = env.payload as unknown as ItemPayload;
    if (payload.review.status !== "confirmed") continue;
    if (!payload.contextRefs.some((r) => r.kind === "context" && r.id === contextId)) continue;
    const next = bumpEnv(env, { ...payload, review: pendingReview() } as ItemPayload, reason) as unknown as KnowledgeItem;
    knowledge = replaceEnv(knowledge, "item", next);
    affected.push({ id: env.id, revision: next.revision });
  }
  return { state: affected.length ? { ...state, knowledge } : state, affectedItems: affected };
}

export function updateKnowledgeContext(state: LocusState, id: string, input: unknown): { state: LocusState; context: KnowledgeContext; scientific: boolean; affectedItems: { id: string; revision: number }[] } {
  const k = state.knowledge;
  const env = findEnv(k, "context", id) as KnowledgeContext | undefined;
  if (!env) throw new AppError(404, `条件对象不存在：${id}`);
  const body = record(input, "body");
  assertKeys(body, ["baseRevision", "patch", "reason"], "body");
  requireBaseRevision(body.baseRevision, env, "条件对象");
  const reason = body.reason === undefined || body.reason === null ? "" : reqText(body.reason, "reason", 200);
  const o = record(body.patch, "patch");
  assertKeys(o, CONTEXT_PATCH_KEYS, "patch");
  if (!Object.keys(o).length) throw new AppError(422, "没有需要保存的更改。");
  const prev = env.payload;
  const next = structuredClone(prev);
  if (o.subject !== undefined) next.subject = reqText(o.subject, "subject", 300);
  if (o.groupLabel !== undefined) next.groupLabel = reqText(o.groupLabel, "groupLabel", 120);
  if (o.stage !== undefined) next.stage = reqText(o.stage, "stage", 200);
  if (o.methodRefs !== undefined) {
    next.methodRefs = strictKnowledgeRefs(o.methodRefs, ["item", "relation"], "methodRefs");
    for (const r of next.methodRefs) assertVersionResolvable(k, r, "methodRefs");
  }
  if (o.conditions !== undefined) next.conditions = strictConditions(state, k, o.conditions, prev.conditions, "conditions");
  if (o.unknowns !== undefined) next.unknowns = strictUnknowns(o.unknowns, "unknowns");
  if (o.topicIds !== undefined) { next.topicIds = idArray(o.topicIds, "topicIds", 40); checkTopics(state, next.topicIds, "topicIds"); }
  if (o.subquestionIds !== undefined) { next.subquestionIds = idArray(o.subquestionIds, "subquestionIds", 40); checkSubquestions(state, next.subquestionIds, next.topicIds, "subquestionIds"); }
  if (canonicalHash(next) === canonicalHash(prev)) throw new AppError(422, "内容未变化，无需保存。");
  const scientific = CONTEXT_SCIENTIFIC_KEYS.some((key) => canonicalHash((next as Record<string, unknown>)[key]) !== canonicalHash((prev as Record<string, unknown>)[key]));
  const payload: ContextPayload = scientific ? { ...next, review: pendingReview() } : next;
  const context = bumpEnv(env, payload, (scientific ? "人工编辑条件" : "人工编辑条件标签") + (reason ? `：${reason}` : "")) as unknown as KnowledgeContext;
  const updated: LocusState = { ...state, knowledge: replaceEnv(k, "context", context) };
  const demoted = payload.review.status === "confirmed"
    ? { state: updated, affectedItems: [] as { id: string; revision: number }[] }
    : demoteItemsDependingOn(updated, id, "引用的条件已更改，需重新确认（§4.7）");
  return { state: demoted.state, context, scientific, affectedItems: demoted.affectedItems };
}

/**
 * 条件对象审核：conditionIds 指定要确认的条件（缺省＝全部）。
 * 只有所有条件都已确认时，context 才置为已确认（§4.2 先审条件，再审 item）。
 */
export function reviewKnowledgeContext(state: LocusState, id: string, input: unknown): { state: LocusState; context: KnowledgeContext; pendingConditions: string[]; affectedItems: { id: string; revision: number }[] } {
  const k = state.knowledge;
  const env = findEnv(k, "context", id) as KnowledgeContext | undefined;
  if (!env) throw new AppError(404, `条件对象不存在：${id}`);
  const body = record(input, "body");
  assertKeys(body, ["baseRevision", "decision", "basis", "conditionIds"], "body");
  requireBaseRevision(body.baseRevision, env, "条件对象");
  const decision = enumOf(body.decision, "decision", REVIEW_DECISIONS) as ReviewStatus;
  const basis = reqText(body.basis, "核对依据", 500);
  const prev = env.payload;
  const targets = body.conditionIds === undefined || body.conditionIds === null
    ? prev.conditions.map((c) => c.id)
    : idArray(body.conditionIds, "conditionIds", 24);
  for (const t of targets) if (!prev.conditions.some((c) => c.id === t)) throw new AppError(422, `条件不存在：${t}`, { code: "condition_missing" });
  if (decision === "confirmed") {
    for (const c of prev.conditions.filter((x) => targets.includes(x.id))) assertConditionConfirmable(state, k, c);
  }
  const review: Review = { status: decision, reviewedAt: now(), reviewedBy: "human", basis };
  const conditions = prev.conditions.map((c) => (targets.includes(c.id) ? { ...c, review } : c));
  const allConfirmed = conditions.length > 0 && conditions.every((c) => c.review.status === "confirmed");
  const contextReview: Review = decision === "confirmed" && !allConfirmed
    ? { status: "needs_info", reviewedAt: now(), reviewedBy: "human", basis: `${basis}（仍有 ${conditions.filter((c) => c.review.status !== "confirmed").length} 个条件待审）` }
    : review;
  const pendingConditions = conditions.filter((c) => c.review.status !== "confirmed").map((c) => c.id);
  const payload: ContextPayload = { ...prev, conditions, review: contextReview };
  if (canonicalHash(payload) === canonicalHash(prev)) throw new AppError(422, "审核状态与依据均未变化。");
  const context = bumpEnv(env, payload, `人工审核条件：${decision}`) as unknown as KnowledgeContext;
  const updated: LocusState = { ...state, knowledge: replaceEnv(k, "context", context) };
  const demoted = contextReview.status === "confirmed"
    ? { state: updated, affectedItems: [] as { id: string; revision: number }[] }
    : demoteItemsDependingOn(updated, id, "引用的条件审核结果变化，需重新确认（§4.7）");
  return { state: demoted.state, context, pendingConditions, affectedItems: demoted.affectedItems };
}

// ── evidence：定位修订 ─────────────────────────────────────────────────

/** 在原文里找引文：唯一 → matched；多处 → candidates；没有 → 不制造 matched。 */
function scanQuote(text: string, quote: string): { readonly status: LocationStatus; readonly start: number; readonly candidates: number[] } {
  const hits: number[] = [];
  for (let i = text.indexOf(quote); i >= 0 && hits.length < 20; i = text.indexOf(quote, i + 1)) hits.push(i);
  if (!hits.length) return { status: "unmatched", start: -1, candidates: [] };
  if (hits.length === 1) return { status: "matched", start: hits[0], candidates: hits };
  return { status: "ambiguous", start: hits[0], candidates: hits };
}

function sourceTextOf(payload: unknown): string {
  const o = payload as Record<string, unknown> | null;
  if (!o) return "";
  for (const key of ["text", "rawText", "csv"]) if (typeof o[key] === "string" && (o[key] as string).length) return o[key] as string;
  return "";
}

/**
 * 定位修订（§8.1 evidence/:id/resolve）：服务端按固定来源版本逐字核对偏移，
 * 不接受客户端自称 matched；start/end 与原文不一致 → 422 quote_mismatch。
 */
export function resolveKnowledgeEvidence(state: LocusState, id: string, input: unknown): { state: LocusState; evidence: KnowledgeEvidence; locationStatus: LocationStatus; candidateOffsets: number[] } {
  const k = state.knowledge;
  const env = findEnv(k, "evidence", id) as KnowledgeEvidence | undefined;
  if (!env) throw new AppError(404, `引文不存在：${id}`);
  const body = record(input, "body");
  assertKeys(body, ["baseRevision", "candidate", "quote", "basis"], "body");
  requireBaseRevision(body.baseRevision, env, "引文");
  const prev = env.payload;
  // candidate 可为 {sourceRef, locator:{type:"text",start,end}} 或直接 {start,end}（§8.1 用候选对象表达选择）
  let chosenStart: unknown;
  let chosenEnd: unknown;
  if (body.candidate !== undefined && body.candidate !== null) {
    const cand = record(body.candidate, "candidate");
    assertKeys(cand, ["sourceRef", "locator", "start", "end"], "candidate");
    if (cand.sourceRef !== undefined && cand.sourceRef !== null) {
      const src = strictSourceRefs([cand.sourceRef], "candidate.sourceRef")[0];
      if (canonicalHash(src) !== canonicalHash(prev.sourceRef)) {
        throw new AppError(422, "候选引文的来源与本条不符：定位修订只换偏移，不换来源版本。", { code: "candidate_source_mismatch" });
      }
    }
    const loc = cand.locator !== undefined && cand.locator !== null ? record(cand.locator, "candidate.locator") : cand;
    assertKeys(loc, ["type", "start", "end", "printedPage", "scanPage", "section"], "candidate.locator");
    if (loc.type !== undefined && loc.type !== "text") throw new AppError(422, `只支持文本偏移定位：${String(loc.type)}`, { code: "locator_type_unsupported" });
    chosenStart = loc.start; chosenEnd = loc.end;
  }
  const quote = body.quote === undefined || body.quote === null ? prev.quote : reqText(body.quote, "quote", 4000);
  if (!quote) throw new AppError(422, "缺少要定位的引文。");
  const res = resolveSourceVersion(state, k, prev.sourceRef);
  if (res.status !== "ok") {
    throw new AppError(422, `来源版本不可读（${res.status === "source_missing" ? "来源已不存在" : res.status === "content_mismatch" ? "存档与 hash 不符" : "旧版本未纳管"}），不能逐字核对引文。`, { code: res.status, ref: prev.sourceRef });
  }
  const text = sourceTextOf(res.payload);
  if (!text) throw new AppError(422, "该来源没有可比对的正文（仅附件登记，未解析文本），无法逐字定位。", { code: "text_unavailable" });

  let status: LocationStatus;
  let start: number;
  let offsets: number[];
  if (chosenStart !== undefined && chosenStart !== null) {
    const s = Number(chosenStart);
    if (!Number.isInteger(s) || s < 0 || s > text.length) throw new AppError(422, `偏移不合法：${chosenStart}（原文长度 ${text.length}）。`, { code: "offset_invalid" });
    const e = chosenEnd === undefined || chosenEnd === null ? s + quote.length : Number(chosenEnd);
    if (!Number.isInteger(e) || e < s || e > text.length) throw new AppError(422, `结束偏移不合法：${String(chosenEnd)}`, { code: "offset_invalid" });
    if (text.slice(s, e) !== quote) throw new AppError(422, "所选偏移处的原文与引文不一致，不能标记为已匹配。", { code: "quote_mismatch" });
    status = "matched"; start = s; offsets = [s];
  } else {
    const scan = scanQuote(text, quote);
    status = scan.status; start = scan.start; offsets = scan.candidates;
    if (status === "unmatched") throw new AppError(422, "原文中找不到该引文（逐字比对失败），保留为未匹配待审，不制造已匹配。", { code: "quote_mismatch" });
  }
  const locator: Locator = {
    type: "text", start, end: start + quote.length,
    ...(prev.locator.type === "text" && prev.locator.printedPage !== undefined ? { printedPage: prev.locator.printedPage } : {}),
    ...(prev.locator.type === "text" && prev.locator.scanPage !== undefined ? { scanPage: prev.locator.scanPage } : {}),
    ...(prev.locator.type === "text" && prev.locator.section ? { section: prev.locator.section } : {}),
  };
  const candOffsets = offsets.filter((o) => o !== start);
  const candidates = candOffsets.map((o) => ({ sourceRef: prev.sourceRef, locator: { type: "text" as const, start: o, end: o + quote.length } }));
  const payload: EvidencePayload = { ...prev, quote, locator, locationStatus: status, candidates };
  const basis = body.basis === undefined || body.basis === null ? "" : reqText(body.basis, "核对依据", 500);
  const evidence = bumpEnv(env, payload, basis ? `人工定位修订：${basis}` : "人工定位修订") as unknown as KnowledgeEvidence;
  return { state: { ...state, knowledge: replaceEnv(k, "evidence", evidence) }, evidence, locationStatus: status, candidateOffsets: candOffsets };
}

// ── 旧卡显式结构化（§4.6.6）────────────────────────────────────────────

type RefLike = KnowledgeRef | { readonly kind: KnowledgeKind; readonly localId: string };

/** 允许本次提交内以 localId 互相引用（模型批次同款约定），避免“先建引文再抄 revision”。 */
function strictRefsWithLocal(v: unknown, allowed: readonly KnowledgeKind[], field: string): RefLike[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new AppError(422, `${field}须为数组。`);
  if (v.length > 40) throw new AppError(422, `${field}数量过多（上限 40）。`);
  const out: RefLike[] = [];
  for (const [i, x] of v.entries()) {
    const o = record(x, `${field}[${i}]`);
    if (o.localId !== undefined && o.localId !== null) {
      const kind = enumOf(o.kind, `${field}[${i}].kind`, allowed) as KnowledgeKind;
      out.push({ kind, localId: reqText(o.localId, `${field}[${i}].localId`, 40) });
      continue;
    }
    if (!isKnowledgeRef(o)) throw new AppError(422, `${field}[${i}] 须为 {kind,id,revision} 或本批 localId 引用。`);
    if (!allowed.includes(o.kind)) throw new AppError(422, `${field} 不支持的类型：${o.kind}（允许 ${allowed.join("/")}）。`);
    out.push({ kind: o.kind, id: o.id, revision: o.revision });
  }
  return out;
}
function bindRefs(refs: RefLike[], local: Map<string, KnowledgeRef>, field: string): KnowledgeRef[] {
  const out: KnowledgeRef[] = [];
  for (const r of refs) {
    if ("localId" in r) {
      const hit = local.get(`${r.kind}:${r.localId}`);
      if (!hit) throw new AppError(422, `${field} 里的 localId 没有对应对象：${r.kind} ${r.localId}`, { code: "local_ref_missing", localId: r.localId });
      out.push(hit);
    } else out.push(r);
  }
  return out.filter((r, i) => out.findIndex((x) => refKey(x) === refKey(r)) === i);
}

/**
 * 引文来源（显式结构化专用）：
 * - 完整 `{kind,id,version,contentHash}` → 原样按固定版本解析（旧口径，不放宽）。
 * - 只给 `{kind,id}` → 由**服务端**按当前版本补齐 version/contentHash（人工在界面上选“原件正文”时的锚定方式；
 *   客户端不自行声明 hash，仍不轻信）。
 * - 省略 → 锚定本卡（已归档文字）。
 */
function evidenceSourceRef(state: LocusState, v: unknown, fallback: SourceRef, field: string): SourceRef {
  if (v === undefined || v === null) return fallback;
  const o = record(v, field);
  if (isSourceRef(o)) return strictSourceRefs([o], field)[0];
  const kind = o.kind;
  const id = o.id;
  if (typeof id === "string" && id && (kind === "asset" || kind === "card" || kind === "table" || kind === "attachment")) {
    const ref = currentSourceRef(state, kind as SourceKind, id);
    if (!ref) throw new AppError(422, `${field} 指向的来源不存在：${kind} ${id}。`, { code: "source_missing" });
    return ref;
  }
  throw new AppError(422, `${field} 须为 {kind,id,version,contentHash}，或只给 {kind,id} 由服务端按当前版本锚定。`, { code: "source_ref_invalid" });
}

/**
 * 旧卡显式结构化（§4.6.6）：仅对**这一张**卡、必须由调用方显式给出分项；
 * 先固定旧版（纳管），再建 pending 的新结构，并把卡的审计改为分项派生。
 * 旧的 extracted/rawText 不删除也不双编辑：结构化后由 reviewCard 守卫拒绝语义改动。
 */
export function structureLegacyCard(state: LocusState, cardId: string, input: unknown): { state: LocusState; card: LitCardRecord; itemIds: string[]; contextIds: string[]; evidenceIds: string[] } {
  const card = state.cards.find((c) => c.id === cardId);
  if (!card) throw new AppError(404, `知识卡不存在：${cardId}`);
  if (isStructuredShell(card)) throw new AppError(409, "该卡已是结构化知识壳：分项已存在，请直接编辑分项，不重复结构化。", { code: "already_structured" });
  const body = record(input, "body");
  assertKeys(body, ["baseRevision", "evidence", "contexts", "items"], "body");
  if (typeof body.baseRevision !== "number" || !Number.isInteger(body.baseRevision)) throw new AppError(422, `缺少 baseRevision（当前第 ${card.revision} 版）。`);
  if (body.baseRevision !== card.revision) {
    throw new AppError(409, `该卡已有新版本（当前第 ${card.revision} 版），本次结构化未覆盖他人编辑，请刷新后重做。`, { code: "stale_revision", currentRevision: card.revision });
  }
  if (body.items === undefined || !Array.isArray(body.items) || !body.items.length) {
    throw new AppError(422, "显式结构化需要至少一个知识项（items）：不做全库自动转换，也不凭空补造。", { code: "items_required" });
  }
  const paper = card.paperId ? state.papers.find((p) => p.id === card.paperId) : undefined;
  const defaultTopicIds = (paper?.topicIds ?? []).slice(0, 40);

  // 固定旧版：纳管当前卡 payload，之后即使原卡继续修订也能回查结构化前的原文与草稿。
  let knowledge = state.knowledge;
  const cardRef = currentSourceRef(state, "card", cardId);
  if (!cardRef) throw new AppError(409, "来源卡无法纳管（记录异常）。", { code: "source_missing" });
  knowledge = archiveSourceVersion(knowledge, cardRef, card);

  const local = new Map<string, KnowledgeRef>();
  const evidenceIds: string[] = [];
  const evidenceInputs = body.evidence === undefined || body.evidence === null ? [] : body.evidence;
  if (!Array.isArray(evidenceInputs)) throw new AppError(422, "evidence 须为数组。");
  for (const [i, x] of evidenceInputs.entries()) {
    const o = record(x, `evidence[${i}]`);
    assertKeys(o, ["localId", "sourceRef", "quote", "start", "end"], `evidence[${i}]`);
    const quote = reqText(o.quote, `evidence[${i}].quote`, 4000);
    const src = evidenceSourceRef(state, o.sourceRef, cardRef, `evidence[${i}].sourceRef`);
    const res = resolveSourceVersion(state, knowledge, src);
    if (res.status !== "ok") throw new AppError(422, `引文来源版本不可读：${src.kind} ${src.id} ${src.version}（${res.status}）。`, { code: res.status, ref: src });
    const text = sourceTextOf(res.payload);
    let status: LocationStatus = "unmatched";
    let start = -1;
    let offsets: number[] = [];
    if (text) {
      if (o.start !== undefined && o.start !== null) {
        const s = Number(o.start);
        const e = o.end === undefined || o.end === null ? s + quote.length : Number(o.end);
        if (!Number.isInteger(s) || s < 0 || !Number.isInteger(e) || e > text.length || text.slice(s, e) !== quote) {
          throw new AppError(422, "所选偏移与原文逐字比对不一致，不能写成已匹配引文。", { code: "quote_mismatch" });
        }
        status = "matched"; start = s; offsets = [s];
      } else {
        const scan = scanQuote(text, quote);
        status = scan.status; start = scan.status === "unmatched" ? -1 : scan.start; offsets = scan.candidates;
      }
    }
    const id = `kev_${uuid()}`;
    const payload: EvidencePayload = {
      sourceRef: src,
      locator: start >= 0 ? { type: "text", start, end: start + quote.length } : { type: "unresolved", description: status === "ambiguous" ? "原文多处出现，待人工选定偏移" : "未在正文中逐字命中" },
      quote,
      locationStatus: status,
      candidates: offsets.filter((pos) => pos !== start).map((pos) => ({ sourceRef: src, locator: { type: "text" as const, start: pos, end: pos + quote.length } })),
    };
    const env = newEnv("evidence", id, payload) as unknown as KnowledgeEvidence;
    knowledge = appendEnv(knowledge, "evidence", env);
    evidenceIds.push(id);
    const lid = o.localId === undefined || o.localId === null ? id : reqText(o.localId, `evidence[${i}].localId`, 40);
    local.set(`evidence:${lid}`, makeKnowledgeRef("evidence", id, env.revision));
  }

  const contextIds: string[] = [];
  const contextInputs = body.contexts === undefined || body.contexts === null ? [] : body.contexts;
  if (!Array.isArray(contextInputs)) throw new AppError(422, "contexts 须为数组。");
  for (const [i, x] of contextInputs.entries()) {
    const o = record(x, `contexts[${i}]`);
    assertKeys(o, ["localId", "researchUnitId", "subject", "groupLabel", "stage", "methodRefs", "conditions", "unknowns", "topicIds", "subquestionIds"], `contexts[${i}]`);
    const topicIds = o.topicIds === undefined ? defaultTopicIds : idArray(o.topicIds, `contexts[${i}].topicIds`, 40);
    checkTopics(state, topicIds, `contexts[${i}].topicIds`);
    const methodRefs = bindRefs(strictRefsWithLocal(o.methodRefs, ["item", "relation"], `contexts[${i}].methodRefs`), local, `contexts[${i}].methodRefs`);
    const payload: ContextPayload = {
      researchUnitId: o.researchUnitId === undefined || o.researchUnitId === null ? `card:${cardId}` : reqText(o.researchUnitId, `contexts[${i}].researchUnitId`, 80),
      subject: reqText(o.subject ?? (card.rawText || "（未命名对象）"), `contexts[${i}].subject`, 300),
      groupLabel: o.groupLabel === undefined || o.groupLabel === null ? "" : reqText(o.groupLabel, `contexts[${i}].groupLabel`, 120),
      stage: o.stage === undefined || o.stage === null ? "" : reqText(o.stage, `contexts[${i}].stage`, 200),
      methodRefs,
      conditions: strictConditions(state, knowledge, o.conditions ?? [], [], `contexts[${i}].conditions`, local),
      unknowns: strictUnknowns(o.unknowns, `contexts[${i}].unknowns`),
      topicIds,
      subquestionIds: o.subquestionIds === undefined ? [] : idArray(o.subquestionIds, `contexts[${i}].subquestionIds`, 40),
      createdFromRunId: undefined,
      review: pendingReview(),
    };
    checkSubquestions(state, payload.subquestionIds, payload.topicIds, `contexts[${i}].subquestionIds`);
    for (const c of payload.conditions) for (const ref of c.evidenceRefs) assertVersionResolvable(knowledge, ref, `contexts[${i}].conditions.evidenceRefs`);
    const id = `kctx_${uuid()}`;
    const env = newEnv("context", id, payload) as unknown as KnowledgeContext;
    knowledge = appendEnv(knowledge, "context", env);
    contextIds.push(id);
    const lid = o.localId === undefined || o.localId === null ? id : reqText(o.localId, `contexts[${i}].localId`, 40);
    local.set(`context:${lid}`, makeKnowledgeRef("context", id, env.revision));
  }

  const itemIds: string[] = [];
  for (const [i, x] of (body.items as unknown[]).entries()) {
    const o = record(x, `items[${i}]`);
    assertKeys(o, [...ITEM_PATCH_KEYS, "localId"], `items[${i}]`);
    const topicIds = o.topicIds === undefined ? defaultTopicIds : idArray(o.topicIds, `items[${i}].topicIds`, 40);
    checkTopics(state, topicIds, `items[${i}].topicIds`);
    if (!topicIds.length) throw new AppError(422, `items[${i}] 无课题归属：该卡未关联有课题的论文，请显式填写 topicIds。`, { code: "topic_required" });
    const contextRefs = bindRefs(strictRefsWithLocal(o.contextRefs, ["context"], `items[${i}].contextRefs`), local, `items[${i}].contextRefs`);
    const evidenceBindings = Array.isArray(o.evidenceRefs ?? [])
      ? (o.evidenceRefs as unknown[]).map((b, j) => {
        const bo = record(b, `items[${i}].evidenceRefs[${j}]`);
        assertKeys(bo, ["ref", "localId", "fieldPaths"], `items[${i}].evidenceRefs[${j}]`);
        const refs = bindRefs(bo.localId !== undefined && bo.localId !== null
          ? [{ kind: "evidence" as KnowledgeKind, localId: reqText(bo.localId, `items[${i}].evidenceRefs[${j}].localId`, 40) }]
          : strictRefsWithLocal([bo.ref], ["evidence"], `items[${i}].evidenceRefs[${j}].ref`), local, `items[${i}].evidenceRefs[${j}]`);
        if (!refs.length) throw new AppError(422, `items[${i}].evidenceRefs[${j}] 缺少 ref 或 localId。`);
        return { ref: refs[0], fieldPaths: bo.fieldPaths === undefined ? [] : idArray(bo.fieldPaths, `items[${i}].evidenceRefs[${j}].fieldPaths`, 8).map((p) => p.slice(0, 80)) };
      })
      : strictEvidenceBindings(o.evidenceRefs, `items[${i}].evidenceRefs`);
    const sourceRefs = o.sourceRefs === undefined ? [cardRef] : strictSourceRefs(o.sourceRefs, `items[${i}].sourceRefs`);
    const payload: ItemPayload = {
      contentType: enumOf(o.contentType, `items[${i}].contentType`, ITEM_CONTENT_TYPES) as ItemContentType,
      nature: enumOf(o.nature, `items[${i}].nature`, ITEM_NATURES) as ItemNature,
      text: reqText(o.text, `items[${i}].text`, 2000),
      subject: o.subject === undefined ? { raw: card.rawText.slice(0, 300) || `card:${cardId}` } : strictSubject(o.subject),
      predicate: o.predicate === undefined ? { raw: "旧卡结构化条目" } : strictPredicate(o.predicate),
      value: o.value === undefined || o.value === null ? null : strictValue(o.value, `items[${i}].value`),
      contextRefs,
      evidenceRefs: evidenceBindings,
      sourceRefs,
      origin: {
        sourceClass: (card.paperId ? "literature_report" : "human_statement") as SourceClass,
        createdBy: "human",
        secondaryCitation: card.secondaryCitation === true,
      },
      scopeText: o.scopeText === undefined || o.scopeText === null ? (card.scope ?? "") : reqText(o.scopeText, `items[${i}].scopeText`, 2000),
      unknowns: strictUnknowns(o.unknowns, `items[${i}].unknowns`),
      topicIds,
      subquestionIds: o.subquestionIds === undefined ? [] : idArray(o.subquestionIds, `items[${i}].subquestionIds`, 40),
      createdFromRunId: undefined,
      review: pendingReview(),
      cardId,
    };
    checkSubquestions(state, payload.subquestionIds, payload.topicIds, `items[${i}].subquestionIds`);
    assertSourcesReadable(state, knowledge, payload.sourceRefs, `items[${i}].sourceRefs`);
    for (const r of payload.contextRefs) assertVersionResolvable(knowledge, r, `items[${i}].contextRefs`);
    for (const b of payload.evidenceRefs) assertVersionResolvable(knowledge, b.ref, `items[${i}].evidenceRefs`);
    const id = `ki_${uuid()}`;
    const env = newEnv("item", id, payload) as unknown as KnowledgeItem;
    knowledge = appendEnv(knowledge, "item", env);
    itemIds.push(id);
  }

  const at = now();
  const nextCard: LitCardRecord = {
    ...card,
    knowledgeItemIds: itemIds,
    audit: deriveShellAudit(itemIds.map((id) => (knowledge.items.find((x) => x.id === id)?.payload as ItemPayload)?.review.status ?? "pending")),
    revision: card.revision + 1,
    history: [...card.history, { revision: card.revision, at, field: "knowledgeItemIds", before: "（旧卡：无逐项绑定）", after: `${itemIds.length} 项（待逐项审阅）`, reason: "显式结构化（§4.6.6）" }],
  };
  return {
    state: { ...state, knowledge, cards: state.cards.map((c) => (c.id === cardId ? nextCard : c)) },
    card: nextCard, itemIds, contextIds, evidenceIds,
  };
}

// ── 壳审计派生 + 消费者辅助（§4.6.9）───────────────────────────────────

/** 空/全待审→unreviewed；全确认→confirm；全排除或撤回→exclude；混合→need_info。 */
function deriveShellAudit(statuses: ReviewStatus[]): LitCardRecord["audit"] {
  if (!statuses.length || statuses.every((s) => s === "pending")) return "unreviewed";
  if (statuses.every((s) => s === "confirmed")) return "confirm";
  if (statuses.every((s) => s === "excluded" || s === "withdrawn")) return "exclude";
  return "need_info";
}

/** 由分项审核状态派生壳卡 audit（唯一写入方；客户端不能对壳设整卡审计）。 */
export function syncShellAudit(state: LocusState, cardId?: string): LocusState {
  if (!cardId) return state;
  const card = state.cards.find((c) => c.id === cardId);
  if (!card || !isStructuredShell(card)) return state;
  const statuses = (card.knowledgeItemIds ?? []).map((id) => {
    const env = state.knowledge.items.find((x) => x.id === id);
    return env ? (env.payload as ItemPayload).review.status : "pending";   // 分项缺失按待审处理，不装成已确认
  });
  const audit = deriveShellAudit(statuses);
  if (audit === card.audit) return state;
  const at = now();
  const next: LitCardRecord = {
    ...card, audit, revision: card.revision + 1,
    history: [...card.history, { revision: card.revision, at, field: "audit", before: card.audit, after: audit, reason: "分项审核派生（§4.6.9）" }],
  };
  return { ...state, cards: state.cards.map((c) => (c.id === cardId ? next : c)) };
}

/** 壳卡分项的当前版本引用（旧卡返回空数组）。 */
export function shellItemRefs(state: LocusState, card: LitCardRecord | undefined): KnowledgeRef[] {
  if (!card) return [];
  return (card.knowledgeItemIds ?? [])
    .map((id) => currentKnowledgeRef(state.knowledge, "item", id))
    .filter((r): r is KnowledgeRef => !!r);
}

/** 整壳是否可展开为已确认分项（§4.6.9：全部项均满足用途门槛才可整壳选择）。 */
export function shellAllItemsConfirmed(state: LocusState, card: LitCardRecord): boolean {
  const refs = shellItemRefs(state, card);
  if (!refs.length) return false;
  return refs.every((r) => knowledgeItemConfirmedAt(state, r));
}

/** 消费者门槛：某固定版本知识项是否已确认（不存在/未确认 → false）。 */
/**
 * 消费者复检（§4.7）：固定版本必须可读，且该知识项**现在**仍为已确认。
 * 只查固定版本会让「后来改回待审/撤回」的项继续混进正式上下文；只查最新版又等于放弃固定版本读取。
 */
export function knowledgeItemConfirmedAt(state: LocusState, ref: KnowledgeRef): boolean {
  return knowledgeItemLiveStatus(state, ref) === "confirmed";
}

/** 知识项当前版本的审核状态（对象或引用不存在 → null）。 */
export function knowledgeItemLiveStatus(state: LocusState, ref: KnowledgeRef): ReviewStatus | null {
  if (!readKnowledgeVersion(state.knowledge, ref)) return null;
  const env = findEnv(state.knowledge, ref.kind, ref.id);
  const live = env?.payload as ItemPayload | undefined;
  return live ? live.review.status : null;
}

// ── 数据级呈现（后端快照/wiki/AI 读取共用；页面文案另有 public/lib/format.js）──

const NATURE_CN: Record<string, string> = { observation: "观察", hypothesis: "假设", interpretation: "解释", to_verify: "待验证", human_judgment: "人工判断" };
const REVIEW_CN: Record<string, string> = { pending: "待审", confirmed: "已确认", needs_info: "待补充", excluded: "已排除", withdrawn: "已撤回" };
const CONTENT_TYPE_CN: Record<string, string> = { observation: "观察记录", method: "方法", definition: "定义", claim: "论断", limitation: "局限", question: "问题" };
const OBTAINED_CN: Record<string, string> = { source_explicit: "来源明写", human_record: "人工记录", human_assumption: "人工假设" };
const REASON_CODE_CN: Record<string, string> = {
  not_in_selected_material: "不在所选材料内", unprocessed_source: "来源未处理",
  not_reported_in_checked_scope: "所查范围内未报告", ambiguous: "有歧义", conflicting: "相互冲突",
  not_measured: "未测量", below_detection_limit: "低于检出限", unparsed_numeric: "数值未解析", unresolved_link: "链接未解析",
};
export const describeNature = (n: string): string => NATURE_CN[n] ?? n;
export const describeReview = (s: string): string => REVIEW_CN[s] ?? s;
export const describeContentType = (t: string): string => CONTENT_TYPE_CN[t] ?? t;
export const describeObtainedBy = (o: string): string => OBTAINED_CN[o] ?? o;
export const describeUnknownReason = (r: string): string => REASON_CODE_CN[r] ?? r;

/** TypedValue → 文本：保留原始表述，缺失显式写原因，不默认 0、不猜单位。 */
export function describeValue(v: TypedValue | null | undefined): string {
  if (!v) return "（无值）";
  const hasUnit = "unit" in v && typeof v.unit === "string" && v.unit.length > 0;
  const unit = hasUnit ? ` ${(v as { unit: string }).unit}` : "unit" in v ? "（未记单位）" : "";
  switch (v.kind) {
    case "scalar": return v.value === null ? `${v.raw}${unit}` : `${v.value}${unit}`;
    case "bound": return `${v.value}${unit}（${v.operator}，原文「${v.raw}」）`;
    case "range": return `${v.lower}–${v.upper}${unit}`;
    case "category": return `${v.label}${v.unparsed_numeric ? "（数值未解析，保留原表述）" : ""}`;
    case "summary": return `${v.statistic} ${v.value}${unit}${v.uncertainty ? ` ±${v.uncertainty.value}(${v.uncertainty.type})` : ""}${v.sampleSize ? ` · n=${v.sampleSize}` : ""}`;
    case "missing": return `缺失（${describeUnknownReason(v.reasonCode)}）：${v.raw}`;
    default: return v.raw;
  }
}

/** 条件（context）→ 文本：逐项列出条件、取值方式与审核状态。 */
export function describeContext(payload: ContextPayload): string {
  const conds = payload.conditions.length
    ? payload.conditions.map((c) => `${c.field.raw}=${describeValue(c.value)}（${describeObtainedBy(c.obtainedBy)}·${describeReview(c.review.status)}）`).join("；")
    : "（未记条件）";
  return `${payload.groupLabel ? `${payload.groupLabel} · ` : ""}${payload.subject}${payload.stage ? ` · 阶段 ${payload.stage}` : ""} · 条件：${conds} · ${describeReview(payload.review.status)}`;
}

/** 知识项 → 摘录文本（正文/性质/值/适用条件/未知/引文/来源，逐项而非概述）。 */
export function describeItem(state: LocusState, payload: ItemPayload, revision: number): string {
  const lines = [
    `性质：${describeNature(payload.nature)}（${describeContentType(payload.contentType)}）· 审核：${describeReview(payload.review.status)}`,
    `内容：${payload.text}`,
    `对象：${payload.subject.raw}${payload.predicate.raw ? ` · 指标：${payload.predicate.raw}` : ""}`,
    `值：${describeValue(payload.value)}`,
    payload.scopeText ? `适用范围：${payload.scopeText}` : "适用范围：（原文未写明）",
  ];
  for (const ref of payload.contextRefs) {
    const cp = readKnowledgeVersion(state.knowledge, ref) as ContextPayload | null;
    if (cp) lines.push(`条件（${refKey(ref)}）：${describeContext(cp)}`);
  }
  for (const u of payload.unknowns) lines.push(`未知：${u.fieldPath} · ${u.detail}（${describeUnknownReason(u.reasonCode)}）`);
  for (const b of payload.evidenceRefs) {
    const ev = readKnowledgeVersion(state.knowledge, b.ref) as EvidencePayload | null;
    if (!ev) { lines.push(`引文（${refKey(b.ref)}）：版本不可读`); continue; }
    lines.push(`引文（${refKey(b.ref)}）：${ev.locationStatus === "matched" ? `已定位 ${ev.locator.type === "text" ? `${ev.locator.start}–${ev.locator.end}` : ""}` : `未定位（${ev.locationStatus}）`}「${ev.quote}」`);
  }
  for (const s of payload.sourceRefs) lines.push(`来源：${s.kind} ${s.id} ${s.version}`);
  if (payload.origin.secondaryCitation) lines.push("（二手转引：不计多份独立证据）");
  lines.push(`版本：第 ${revision} 版`);
  return lines.join("\n");
}

// ── 主题与人工认识（§4.4 theme / §8.1 statements）──────────────────────

function assertJudgmentsConfirmed(k: KnowledgeState, refs: KnowledgeRef[], field: string): void {
  const bad: string[] = [];
  for (const r of refs) {
    const payload = readKnowledgeVersion(k, r) as ItemPayload | null;
    if (!payload || payload.review.status !== "confirmed") bad.push(refKey(r));
  }
  if (bad.length) throw new AppError(422, `未确认或已排除的知识项不能进入「当前认识」：${bad.join("、")}。`, { code: "judgment_not_confirmed", refs: bad });
}

function assertMembersInTopic(k: KnowledgeState, members: KnowledgeRef[], topicId: string, allowCrossTopic: boolean): void {
  const cross: string[] = [];
  for (const r of members) {
    const payload = assertVersionResolvable(k, r, "members") as TopicScopedPayload;
    if (!(payload.topicIds ?? []).includes(topicId)) cross.push(refKey(r));
  }
  if (cross.length && !allowCrossTopic) {
    throw new AppError(422, `以下对象不属于本课题，需用户确认后才能跨课题加入主题：${cross.join("、")}。`, { code: "cross_topic_confirmation_required", refs: cross });
  }
}
type TopicScopedPayload = { readonly topicIds?: string[] };

export function createKnowledgeTheme(state: LocusState, input: unknown): { state: LocusState; theme: KnowledgeTheme } {
  const body = record(input, "body");
  assertKeys(body, ["topicId", "name", "definition", "subquestionIds", "members", "memberRefs", "currentJudgmentRefs", "allowCrossTopic"], "body");
  if (body.members === undefined && body.memberRefs !== undefined) body.members = body.memberRefs;
  const topicId = reqText(body.topicId, "topicId", 60);
  if (!state.topics.some((t) => t.id === topicId)) throw new AppError(404, `课题不存在：${topicId}`);
  const k = state.knowledge;
  const members = strictKnowledgeRefs(body.members, ["item", "relation", "dataset"], "members");
  for (const r of members) assertVersionResolvable(k, r, "members");
  assertMembersInTopic(k, members, topicId, body.allowCrossTopic === true);
  const judgments = strictKnowledgeRefs(body.currentJudgmentRefs, ["item"], "currentJudgmentRefs");
  assertJudgmentsConfirmed(k, judgments, "currentJudgmentRefs");
  const subquestionIds = body.subquestionIds === undefined ? [] : idArray(body.subquestionIds, "subquestionIds", 40);
  checkSubquestions(state, subquestionIds, [topicId], "subquestionIds");
  const payload: ThemePayload = {
    topicId,
    name: reqText(body.name, "name", 120),
    definition: body.definition === undefined || body.definition === null ? "" : reqText(body.definition, "definition", 2000),
    subquestionIds,
    members,
    currentJudgmentRefs: judgments,
  };
  const id = `ktm_${uuid()}`;
  const theme = newEnv("theme", id, payload) as unknown as KnowledgeTheme;
  return { state: { ...state, knowledge: appendEnv(k, "theme", theme) }, theme };
}

export function updateKnowledgeTheme(state: LocusState, id: string, input: unknown): { state: LocusState; theme: KnowledgeTheme } {
  const k = state.knowledge;
  const env = findEnv(k, "theme", id) as KnowledgeTheme | undefined;
  if (!env) throw new AppError(404, `主题不存在：${id}`);
  const body = record(input, "body");
  assertKeys(body, ["baseRevision", "patch", "allowCrossTopic"], "body");
  requireBaseRevision(body.baseRevision, env, "主题");
  const o = record(body.patch, "patch");
  assertKeys(o, ["name", "definition", "subquestionIds", "members", "memberRefs", "currentJudgmentRefs"], "patch");
  if (o.members === undefined && o.memberRefs !== undefined) o.members = o.memberRefs;
  if (!Object.keys(o).length) throw new AppError(422, "没有需要保存的更改。");
  const prev = env.payload;
  const next = structuredClone(prev);
  if (o.name !== undefined) next.name = reqText(o.name, "name", 120);
  if (o.definition !== undefined) next.definition = reqText(o.definition, "definition", 2000);
  if (o.subquestionIds !== undefined) { next.subquestionIds = idArray(o.subquestionIds, "subquestionIds", 40); checkSubquestions(state, next.subquestionIds, [next.topicId], "subquestionIds"); }
  if (o.members !== undefined) {
    next.members = strictKnowledgeRefs(o.members, ["item", "relation", "dataset"], "members");
    for (const r of next.members) assertVersionResolvable(k, r, "members");
    assertMembersInTopic(k, next.members, next.topicId, body.allowCrossTopic === true);
  }
  if (o.currentJudgmentRefs !== undefined) {
    next.currentJudgmentRefs = strictKnowledgeRefs(o.currentJudgmentRefs, ["item"], "currentJudgmentRefs");
    assertJudgmentsConfirmed(k, next.currentJudgmentRefs, "currentJudgmentRefs");
  }
  if (canonicalHash(next) === canonicalHash(prev)) throw new AppError(422, "内容未变化，无需保存。");
  const theme = bumpEnv(env, next, "人工编辑主题") as unknown as KnowledgeTheme;
  return { state: { ...state, knowledge: replaceEnv(k, "theme", theme) }, theme };
}

/**
 * 人工/AI 陈述 → 候选知识项（§8.1 statements）。
 * 一律 pending：AI 内容不得自报 human_confirmed，人工也要走专用 review 才算确认。
 */
export function createKnowledgeStatement(state: LocusState, input: unknown): { state: LocusState; item: KnowledgeItem } {
  const body = record(input, "body");
  assertKeys(body, ["topicId", "subquestionIds", "text", "nature", "subject", "scopeText", "scope", "contextRefs", "inputRefs", "evidenceRefs", "evidence", "sourceRefs", "unknowns", "createdBy"], "body");
  if (body.contextRefs === undefined && body.inputRefs !== undefined) body.contextRefs = body.inputRefs;
  if (body.evidenceRefs === undefined && body.evidence !== undefined) body.evidenceRefs = body.evidence;
  if (body.scopeText === undefined && body.scope !== undefined) body.scopeText = body.scope;
  const topicId = reqText(body.topicId, "topicId", 60);
  const topic = state.topics.find((t) => t.id === topicId);
  if (!topic) throw new AppError(404, `课题不存在：${topicId}`);
  const k = state.knowledge;
  const createdBy = body.createdBy === undefined || body.createdBy === null ? "human" : enumOf(body.createdBy, "createdBy", ["human", "model"]);
  const contextRefs = strictKnowledgeRefs(body.contextRefs, ["context"], "contextRefs");
  for (const r of contextRefs) assertVersionResolvable(k, r, "contextRefs");
  const evidenceRefs = strictEvidenceBindings(body.evidenceRefs, "evidenceRefs");
  for (const b of evidenceRefs) assertVersionResolvable(k, b.ref, "evidenceRefs");
  const sourceRefs = strictSourceRefs(body.sourceRefs, "sourceRefs");
  assertSourcesReadable(state, k, sourceRefs, "sourceRefs");
  const subquestionIds = body.subquestionIds === undefined ? [] : idArray(body.subquestionIds, "subquestionIds", 40);
  checkSubquestions(state, subquestionIds, [topicId], "subquestionIds");
  const payload: ItemPayload = {
    contentType: "claim",
    nature: (body.nature === undefined ? "human_judgment" : enumOf(body.nature, "nature", ITEM_NATURES)) as ItemNature,
    text: reqText(body.text, "text", 2000),
    subject: body.subject === undefined ? { raw: topic.name.slice(0, 300) } : strictSubject(body.subject),
    predicate: { raw: "当前认识" },
    value: null,
    contextRefs,
    evidenceRefs,
    sourceRefs,
    origin: createdBy === "model"
      ? { sourceClass: "model_suggestion", createdBy: "model", secondaryCitation: false }
      : { sourceClass: "human_statement", createdBy: "human", secondaryCitation: false },
    scopeText: body.scopeText === undefined || body.scopeText === null ? "" : reqText(body.scopeText, "scopeText", 2000),
    unknowns: strictUnknowns(body.unknowns, "unknowns"),
    topicIds: [topicId],
    subquestionIds,
    review: pendingReview(),
  };
  const id = `ki_${uuid()}`;
  const item = newEnv("item", id, payload) as unknown as KnowledgeItem;
  return { state: { ...state, knowledge: appendEnv(k, "item", item) }, item };
}