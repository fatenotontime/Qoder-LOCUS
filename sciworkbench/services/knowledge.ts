/**
 * 知识提取契约（合同 §5.3/§5.4/§6）：固定 run 输入、每附件偏移分块、有界补读、
 * 模型结构整批校验（不半写）、服务端逐字定位、幂等 receipt、新壳＋知识实体同笔提交。
 * 纯函数：无网络/文件 IO；模型调用与队列编排在 server。
 */
import { randomUUID } from "node:crypto";
import type { AssetRecord, LitCardRecord, LocusState } from "../store.ts";
import { contentHash } from "../store.ts";
import {
  KNOWLEDGE_SCHEMA_VERSION, UNKNOWN_REASON_CODES, RELATION_TYPES,
  type ExtractionRunRecord, type ExtractionChunk, type ExtractionReceipt,
  type KnowledgeItem, type KnowledgeContext, type KnowledgeEvidence, type KnowledgeRelation,
  type ItemPayload, type ContextPayload, type EvidencePayload, type RelationPayload,
  type TypedValue, type Unknown, type UnknownReasonCode, type SourceRef, type KnowledgeRef,
  type ItemContentType, type ItemNature, type RelationType, type Locator,
  pendingReview, knowledgeRef,
} from "../domain/knowledge.ts";
import { AppError } from "./app.ts";
import { AiError, KNOWLEDGE_STRUCT_PROMPT_VERSION, KNOWLEDGE_STRUCT_SCHEMA_VERSION, chunkTextSpans } from "./ai.ts";
import { currentSourceRef } from "./knowledge-base.ts";

const now = () => new Date().toISOString();
const MAX_CHUNKS_PER_ASSET = 24;
const SUPPLEMENT_CAP = 4000;

export interface KnowledgeRunInput {
  paperId: string;
  attachmentIds: string[];
  purpose: string;
  topicId?: string;
  subquestionId?: string;
  idempotencyKey: string;
}

// ── 有界补读（§6.1）：仅明确表号/小节引用且选定附件内唯一定位 ──

interface SupplementHit { assetId: string; start: number; end: number }

function findSupplements(chunkText: string, chunkStart: number, chunkEnd: number, ownAssetId: string, assets: AssetRecord[]): { hits: SupplementHit[]; unresolvedLinks: string[] } {
  const ref = /(?:表|Table)\s*(\d+)/.exec(chunkText) ?? /第\s*(\d+|[一二三四五六七八九十]+)\s*节/.exec(chunkText) ?? /Section\s*(\d+)/i.exec(chunkText);
  if (!ref) return { hits: [], unresolvedLinks: [] };
  const label = ref[0].trim();
  const n = ref[1];
  const isTable = /^(?:表|Table)/i.test(label);
  const capRe = isTable
    ? new RegExp(`^\\s*(?:表|Table)\\s*${n}(?!\\d)`, "im")
    : new RegExp(`^\\s*(?:第\\s*${n}\\s*节|Section\\s*${n}(?!\\d))`, "im");
  const hits: SupplementHit[] = [];
  for (const a of assets) {
    const m = capRe.exec(a.text);
    if (!m) continue;
    const start = m.index;
    if (a.id === ownAssetId && start >= chunkStart && start < chunkEnd) continue; // 已在本块内，无需补读
    const paraEnd = a.text.indexOf("\n\n", start);
    const end = Math.min(paraEnd === -1 ? a.text.length : paraEnd, start + SUPPLEMENT_CAP);
    hits.push({ assetId: a.id, start, end });
  }
  if (hits.length === 1) return { hits, unresolvedLinks: [] };
  return { hits: [], unresolvedLinks: [`${label}：${hits.length === 0 ? "选定附件中未找到对应段落/表注" : "多处命中，无法唯一定位"}（unresolved_link，可手动指定来源）`] };
}

// ── 准备：严格校验＋冻结 run 输入（T06）──────────────────────

export function prepareKnowledgeRun(state: LocusState, input: KnowledgeRunInput): { run: ExtractionRunRecord; assets: AssetRecord[]; inputHash: string } {
  const paper = state.papers.find((p) => p.id === input.paperId);
  if (!paper) throw new AppError(404, `论文条目不存在：${input.paperId}`);
  const purpose = String(input.purpose ?? "").trim();
  if (!purpose) throw new AppError(422, "请写明研究目的：知识提取围绕具体研究问题，不是无目的拆文本。");
  const ids = input.attachmentIds;
  if (!Array.isArray(ids) || ids.length === 0) throw new AppError(422, "附件须显式选择（非空数组）；「全部」由界面展开为具体附件，不接受空/缺省解释为全选。");
  if (new Set(ids).size !== ids.length) throw new AppError(422, "附件选择含重复 ID。");
  const atts = ids.map((id) => {
    const att = state.attachments.find((a) => a.id === id);
    if (!att) throw new AppError(422, `附件不存在：${id}`);
    if (att.paperId !== paper.id) throw new AppError(422, `附件 ${id} 不属于该论文条目。`);
    return att;
  });
  const assets = atts.map((a) => {
    const asset = state.assets.find((x) => x.id === a.assetId);
    if (!asset) throw new AppError(404, `附件原件缺失：${a.assetId}`);
    return asset;
  });
  const topicId = input.topicId ? String(input.topicId) : undefined;
  const subquestionId = input.subquestionId ? String(input.subquestionId) : undefined;
  if (topicId && !state.topics.some((t) => t.id === topicId)) throw new AppError(404, `课题不存在：${topicId}`);
  if (subquestionId) {
    if (!topicId) throw new AppError(422, "指定子问题须同时指定所属课题。");
    const q = state.subquestions.find((x) => x.id === subquestionId);
    if (!q) throw new AppError(404, `子问题不存在：${subquestionId}`);
    if (q.topicId !== topicId) throw new AppError(422, "子问题不属于该课题。");
  }
  const idempotencyKey = String(input.idempotencyKey ?? "").trim();
  if (!idempotencyKey) throw new AppError(422, "缺少幂等键 idempotencyKey（由界面生成，网络重试时复用）。");

  const chunks: ExtractionChunk[] = [];
  for (const asset of assets) {
    const spans = chunkTextSpans(asset.text);
    if (spans.length === 0) throw new AppError(422, `附件 ${asset.name} 正文为空。`);
    if (spans.length > MAX_CHUNKS_PER_ASSET) throw new AppError(422, `附件 ${asset.name} 过长：需分 ${spans.length} 块，超过上限 ${MAX_CHUNKS_PER_ASSET} 块。请缩小选择范围。`);
    const ref = currentSourceRef(state, "asset", asset.id);
    if (!ref) throw new AppError(404, `附件原件缺失：${asset.id}`);
    for (const span of spans) {
      const sup = findSupplements(span.text, span.start, span.end, asset.id, assets);
      chunks.push({
        id: `chunk_${chunks.length}`,
        sourceRef: ref,
        start: span.start,
        end: span.end,
        additionalRanges: sup.hits.map((h) => ({ sourceRef: currentSourceRef(state, "asset", h.assetId)!, start: h.start, end: h.end })),
        sourceTextHash: contentHash(span.text),
        status: "pending",
      });
    }
  }
  const inputHash = contentHash(JSON.stringify({
    paperId: paper.id, paperRevision: paper.revision,
    attachments: atts.map((a, i) => ({ id: a.id, hash: assets[i].hash })),
    purpose, topicId: topicId ?? null, subquestionId: subquestionId ?? null,
    promptVersion: KNOWLEDGE_STRUCT_PROMPT_VERSION, schemaVersion: KNOWLEDGE_STRUCT_SCHEMA_VERSION,
    chunks: chunks.map((c) => ({ sourceRef: c.sourceRef, start: c.start, end: c.end, additionalRanges: c.additionalRanges, sourceTextHash: c.sourceTextHash })),
  }));
  const run: ExtractionRunRecord = {
    id: `kr_${randomUUID()}`, idempotencyKey, inputHash,
    paperRef: currentSourceRef(state, "paper", paper.id)!,
    attachmentRefs: assets.map((a) => currentSourceRef(state, "asset", a.id)!),
    purpose, topicId, subquestionId,
    promptVersion: KNOWLEDGE_STRUCT_PROMPT_VERSION, schemaVersion: KNOWLEDGE_STRUCT_SCHEMA_VERSION,
    createdAt: now(), updatedAt: now(), status: "running", chunks,
  };
  return { run, assets, inputHash };
}

// ── 模型输出整批校验（§6.2 / T12）：非法即整块拒收，不半写 ──

export interface BatchEvidence { localId: string; sourceBlockId: string; quote: string }
export interface BatchCondition { field: string; value: TypedValue; appliesTo: { subject: string; stage: string }; evidenceLocalIds: string[] }
export interface BatchContext { localId: string; subject: string; group: string; stage: string; method: string; conditions: BatchCondition[]; unknowns: string[]; evidenceLocalIds: string[] }
export interface BatchItem {
  contentType: ItemContentType; nature: ItemNature; text: string;
  subject: string; predicate: string; value: TypedValue | null;
  contextLocalIds: string[]; evidenceLocalIds: string[]; scopeText: string; unknowns: string[]; secondaryCitation: boolean;
}
export interface BatchCard { localId: string; summary: string; items: BatchItem[] }
export interface BatchRelation { fromLocalId: string; toLocalId: string; relationType: RelationType; basis: string; evidenceLocalIds: string[] }
export interface StructBatch { evidence: BatchEvidence[]; contexts: BatchContext[]; cards: BatchCard[]; relations: BatchRelation[] }

const CONTENT_TYPES = new Set(["observation", "method", "definition", "claim", "limitation", "question"]);
const NATURES = new Set(["observation", "hypothesis", "interpretation", "to_verify", "human_judgment"]);
const DECIMAL = /^-?\d+(\.\d+)?$/;
const FORBIDDEN_MODEL_KEYS = ["audit", "revision", "stableId", "history"];

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

function rejectForbiddenKeys(o: Record<string, unknown>, where: string): void {
  for (const k of FORBIDDEN_MODEL_KEYS) {
    if (k in o) throw new AiError(`${where} 含模型不可指定的字段「${k}」；整块拒收。`, true);
  }
}

function cleanTypedValue(v: unknown, where: string): TypedValue {
  if (v === null || v === undefined) throw new AiError(`${where} 缺 value（纯叙述请显式置 null）。`, true);
  const o = v as Record<string, unknown>;
  const raw = str(o.raw);
  if (!raw) throw new AiError(`${where} value 缺 raw 原文。`, true);
  const unit = o.unit === null || o.unit === undefined ? null : str(o.unit) || null;
  const dec = (x: unknown, field: string): string => {
    const s = str(x);
    if (!DECIMAL.test(s)) throw new AiError(`${where} ${field} 不是十进制数字符串：「${s}」；不强行解析。`, true);
    return s;
  };
  switch (o.kind) {
    case "scalar": {
      const value = o.value === null || o.value === undefined ? null : dec(o.value, "value");
      return { kind: "scalar", raw, value, unit };
    }
    case "bound": {
      const op = str(o.operator);
      if (!["gt", "gte", "lt", "lte"].includes(op)) throw new AiError(`${where} bound.operator 非法：${op}。`, true);
      return { kind: "bound", raw, operator: op as "gt", value: dec(o.value, "value"), unit };
    }
    case "range":
      return { kind: "range", raw, lower: dec(o.lower, "lower"), upper: dec(o.upper, "upper"), unit };
    case "category": {
      const label = str(o.label);
      if (!label) throw new AiError(`${where} category 缺 label。`, true);
      return o.unparsed_numeric === true ? { kind: "category", raw, label, unparsed_numeric: true } : { kind: "category", raw, label };
    }
    case "summary": {
      const statistic = str(o.statistic);
      if (!statistic) throw new AiError(`${where} summary 缺 statistic。`, true);
      let uncertainty: { type: "SD" | "SE" | "CI"; value: string } | undefined;
      if (o.uncertainty !== undefined && o.uncertainty !== null) {
        const u = o.uncertainty as Record<string, unknown>;
        const t = str(u.type);
        if (!["SD", "SE", "CI"].includes(t)) throw new AiError(`${where} summary.uncertainty.type 须为 SD/SE/CI。`, true);
        uncertainty = { type: t as "SD", value: dec(u.value, "uncertainty.value") };
      }
      const sampleSize = o.sampleSize === undefined || o.sampleSize === null ? undefined : Number(o.sampleSize);
      if (sampleSize !== undefined && (!Number.isInteger(sampleSize) || sampleSize < 0)) throw new AiError(`${where} sampleSize 非法。`, true);
      return { kind: "summary", raw, statistic, value: dec(o.value, "value"), unit, ...(uncertainty ? { uncertainty } : {}), ...(sampleSize !== undefined ? { sampleSize } : {}) };
    }
    case "missing": {
      const rc = str(o.reasonCode);
      if (!(UNKNOWN_REASON_CODES as readonly string[]).includes(rc)) throw new AiError(`${where} missing.reasonCode 非法：${rc}。`, true);
      return { kind: "missing", raw, reasonCode: rc as UnknownReasonCode };
    }
    default:
      throw new AiError(`${where} 非法 value.kind：${String(o.kind)}；不静默降级。`, true);
  }
}

function localIds(arr: unknown[], where: string): Set<string> {
  const seen = new Set<string>();
  for (const x of arr) {
    const id = str((x as Record<string, unknown>)?.localId);
    if (!id) throw new AiError(`${where} 含缺 localId 的项；整块拒收。`, true);
    if (seen.has(id)) throw new AiError(`${where} localId 重复：${id}；整块拒收。`, true);
    seen.add(id);
  }
  return seen;
}

function refsInto(ids: unknown, allowed: Set<string>, where: string): string[] {
  const out = strArr(ids);
  for (const id of out) if (!allowed.has(id)) throw new AiError(`${where} 悬空引用 localId：${id}；整块拒收。`, true);
  return out;
}

/**
 * 模型输出整批校验（§6.2 / T12）：任何一处不合法即**整块拒收**——不返回半套可用知识。
 * 校验内部错误统一补齐拒收说明，保证块失败原因对得上契约措辞（人审看得见"本块未写入任何知识"）。
 */
export function validateKnowledgeBatch(value: unknown, blockIds: string[]): StructBatch {
  try {
    return checkKnowledgeBatch(value, blockIds);
  } catch (e) {
    if (e instanceof AiError && !e.message.includes("整块拒收")) {
      throw new AiError(`${e.message}；整块拒收，本块未写入任何知识。`, e.recoverable, e.fatal);
    }
    throw e;
  }
}

function checkKnowledgeBatch(value: unknown, blockIds: string[]): StructBatch {
  const obj = value as Record<string, unknown> | null;
  if (!obj || typeof obj !== "object") throw new AiError("知识提取结果不是对象；整块拒收。", true);
  if (obj.schemaVersion !== KNOWLEDGE_STRUCT_SCHEMA_VERSION) throw new AiError(`知识提取结果 schemaVersion 须为 ${KNOWLEDGE_STRUCT_SCHEMA_VERSION}；整块拒收。`, true);
  const arr = (k: string): unknown[] => {
    const v = obj[k];
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) throw new AiError(`知识提取结果 ${k} 非数组；整块拒收。`, true);
    return v;
  };
  const evRaw = arr("evidence"), ctxRaw = arr("contexts"), cardRaw = arr("cards"), relRaw = arr("relations");
  const evIds = localIds(evRaw, "evidence");
  const ctxIds = localIds(ctxRaw, "contexts");
  const cardIds = localIds(cardRaw, "cards");
  // relation 自身不带 localId（合同 schema 用 from/to 指端点）：只要求端点齐全，重复与否不设限。
  for (const x of relRaw) {
    const o = x as Record<string, unknown>;
    if (!str(o.fromLocalId) || !str(o.toLocalId)) throw new AiError(`relation 缺 fromLocalId/toLocalId；整块拒收。`, true);
  }
  /**
   * 关系端点可寻址集合（合同 schema 里 item 不单带 localId）：
   * evidence/context 的 localId ＋ **只有一项**的卡 localId（等价其唯一项，无歧义）。
   * 多项卡作为端点属歧义，直接拒收而不是挑第一个（不猜）。
   */
  const endpointIds = new Set([...evIds, ...ctxIds]);
  const ambiguousCardEndpoints = new Set<string>();
  for (const x of cardRaw) {
    const o = x as Record<string, unknown>;
    const items = Array.isArray(o.items) ? o.items : [];
    const local = str(o.localId);
    if (items.length === 1) endpointIds.add(local);
    else ambiguousCardEndpoints.add(local);
  }
  const blocks = new Set(blockIds);

  const evidence: BatchEvidence[] = evRaw.map((x) => {
    const o = x as Record<string, unknown>;
    const sourceBlockId = str(o.sourceBlockId);
    if (!blocks.has(sourceBlockId)) throw new AiError(`evidence ${str(o.localId)} 的 sourceBlockId 不在本块/补读范围：${sourceBlockId}；整块拒收。`, true);
    const quote = str(o.quote);
    if (!quote) throw new AiError(`evidence ${str(o.localId)} 缺 quote；整块拒收。`, true);
    return { localId: str(o.localId), sourceBlockId, quote };
  });
  const contexts: BatchContext[] = ctxRaw.map((x) => {
    const o = x as Record<string, unknown>;
    rejectForbiddenKeys(o, `context ${str(o.localId)}`);
    const subject = str(o.subject);
    if (!subject) throw new AiError(`context ${str(o.localId)} 缺 subject；整块拒收。`, true);
    const condRaw = o.conditions === undefined || o.conditions === null ? [] : o.conditions;
    if (!Array.isArray(condRaw)) throw new AiError(`context ${str(o.localId)} conditions 非数组；整块拒收。`, true);
    const ctxEv = refsInto(o.evidenceLocalIds, evIds, `context ${str(o.localId)}`);
    const conditions: BatchCondition[] = condRaw.map((c) => {
      const co = c as Record<string, unknown>;
      const field = str(co.field);
      if (!field) throw new AiError(`context ${str(o.localId)} 条件缺 field；整块拒收。`, true);
      const appliesTo = (co.appliesTo ?? {}) as Record<string, unknown>;
      return {
        field, value: cleanTypedValue(co.value, `条件 ${field}`),
        appliesTo: { subject: str(appliesTo.subject) || subject, stage: str(appliesTo.stage) || str(o.stage) },
        evidenceLocalIds: refsInto(co.evidenceLocalIds ?? o.evidenceLocalIds, evIds, `条件 ${field}`),
      };
    });
    return { localId: str(o.localId), subject, group: str(o.group), stage: str(o.stage), method: str(o.method), conditions, unknowns: strArr(o.unknowns), evidenceLocalIds: ctxEv };
  });
  const cards: BatchCard[] = cardRaw.map((x) => {
    const o = x as Record<string, unknown>;
    rejectForbiddenKeys(o, `card ${str(o.localId)}`);
    const summary = str(o.summary);
    if (!summary) throw new AiError(`card ${str(o.localId)} 缺 summary；整块拒收。`, true);
    if (!Array.isArray(o.items) || o.items.length === 0) throw new AiError(`card ${str(o.localId)} 无 items；整块拒收。`, true);
    const items: BatchItem[] = o.items.map((it) => {
      const io = it as Record<string, unknown>;
      rejectForbiddenKeys(io, `card ${str(o.localId)} item`);
      const contentType = str(io.contentType), nature = str(io.nature), text = str(io.text);
      if (!CONTENT_TYPES.has(contentType)) throw new AiError(`item 非法 contentType：${contentType}；不静默降级。`, true);
      if (!NATURES.has(nature)) throw new AiError(`item 非法 nature：${nature}；整块拒收。`, true);
      if (!text) throw new AiError(`card ${str(o.localId)} item 缺 text；整块拒收。`, true);
      const subject = typeof io.subject === "object" && io.subject !== null ? str((io.subject as Record<string, unknown>).raw) : str(io.subject);
      const predicate = typeof io.predicate === "object" && io.predicate !== null ? str((io.predicate as Record<string, unknown>).raw) : str(io.predicate);
      if (!subject || !predicate) throw new AiError(`card ${str(o.localId)} item 缺 subject/predicate；整块拒收。`, true);
      const value = io.value === null || io.value === undefined ? null : cleanTypedValue(io.value, `item ${text.slice(0, 20)}`);
      return {
        contentType: contentType as ItemContentType, nature: nature as ItemNature, text, subject, predicate, value,
        contextLocalIds: refsInto(io.contextLocalIds, ctxIds, `item ${text.slice(0, 20)}`),
        evidenceLocalIds: refsInto(io.evidenceLocalIds, evIds, `item ${text.slice(0, 20)}`),
        scopeText: str(io.scopeText), unknowns: strArr(io.unknowns), secondaryCitation: io.secondaryCitation === true,
      };
    });
    return { localId: str(o.localId), summary, items };
  });
  const relations: BatchRelation[] = relRaw.map((x) => {
    const o = x as Record<string, unknown>;
    const from = str(o.fromLocalId), to = str(o.toLocalId);
    for (const end of [from, to]) {
      if (endpointIds.has(end)) continue;
      if (ambiguousCardEndpoints.has(end)) throw new AiError(`relation 端点「${end}」是含多项的卡，指向不明确；请让关系指向具体的上下文/证据项；整块拒收。`, true);
      throw new AiError(`relation 引用本批之外的 localId（${from}→${to}）；不接受臆造库内 ID。`, true);
    }
    const relationType = str(o.relationType);
    if (!(RELATION_TYPES as readonly string[]).includes(relationType)) throw new AiError(`relation 非法 relationType：${relationType}；整块拒收。`, true);
    return { fromLocalId: from, toLocalId: to, relationType: relationType as RelationType, basis: str(o.basis), evidenceLocalIds: refsInto(o.evidenceLocalIds, evIds, "relation") };
  });
  return { evidence, contexts, cards, relations };
}

// ── 服务端逐字定位（§6.2 / T09/T10）：只在冻结块＋允许补读内搜索 ──

export interface SearchSpace { sourceRef: SourceRef; text: string; baseOffset: number }
export interface LocatedQuote { locationStatus: EvidencePayload["locationStatus"]; locator: Locator; candidates: EvidencePayload["candidates"]; sourceRef: SourceRef }

export function locateQuote(quote: string, spaces: SearchSpace[], fallbackRef: SourceRef): LocatedQuote {
  const hits: { sourceRef: SourceRef; start: number; end: number }[] = [];
  for (const sp of spaces) {
    let idx = sp.text.indexOf(quote);
    while (idx !== -1) {
      hits.push({ sourceRef: sp.sourceRef, start: sp.baseOffset + idx, end: sp.baseOffset + idx + quote.length });
      idx = sp.text.indexOf(quote, idx + 1);
    }
  }
  if (hits.length === 1) {
    const h = hits[0];
    return { locationStatus: "matched", locator: { type: "text", start: h.start, end: h.end }, candidates: [], sourceRef: h.sourceRef };
  }
  if (hits.length > 1) {
    return {
      locationStatus: "ambiguous",
      locator: { type: "unresolved", description: `引文在允许范围内 ${hits.length} 处命中，须人工指定` },
      candidates: hits.map((h) => ({ sourceRef: h.sourceRef, locator: { type: "text", start: h.start, end: h.end } as Locator })),
      sourceRef: hits[0].sourceRef,
    };
  }
  return { locationStatus: "unmatched", locator: { type: "unresolved", description: "引文未在冻结块/补读范围内逐字匹配（来源可确定，定位不足）" }, candidates: [], sourceRef: fallbackRef };
}

// ── 冻结块读取（原文只经固定 sourceRef；hash 漂移即拒绝）────

/**
 * 冻结块读取（合同 §6.1/§6.2）：块文本与补读范围一律取自 run 冻结的 chunk 记录（重跑输入不变）；
 * unresolvedLinks 由同一规则在冻结附件范围内**重算**得到——chunk 字段固定（§5.4）不含该提示，
 * 但必须显式返回并落为 unknown，不能悄悄丢。
 */
export function chunkInputTexts(state: LocusState, run: ExtractionRunRecord, chunk: ExtractionChunk): { chunkText: string; supplements: { blockId: string; sourceRef: SourceRef; text: string; start: number }[]; spaces: SearchSpace[]; blockIds: string[]; unresolvedLinks: string[] } {
  const assetOf = (ref: SourceRef): AssetRecord => {
    const a = state.assets.find((x) => x.id === ref.id);
    if (!a) throw new AppError(409, `冻结来源原件缺失：${ref.id}`, { code: "source_missing" });
    if (`sha256:${a.hash}` !== ref.version) throw new AppError(409, `冻结来源内容已变化：${ref.id}`, { code: "content_mismatch" });
    return a;
  };
  const main = assetOf(chunk.sourceRef);
  const chunkText = main.text.slice(chunk.start, chunk.end);
  if (contentHash(chunkText) !== chunk.sourceTextHash) throw new AppError(409, "冻结块内容与归档 hash 不符（content_mismatch）。", { code: "content_mismatch" });
  const assets = run.attachmentRefs.map(assetOf);
  const supplements = chunk.additionalRanges.map((r, i) => {
    const a = assetOf(r.sourceRef);
    return { blockId: `${chunk.id}:sup${i}`, sourceRef: r.sourceRef, text: a.text.slice(r.start, r.end), start: r.start };
  });
  const spaces: SearchSpace[] = [
    { sourceRef: chunk.sourceRef, text: chunkText, baseOffset: chunk.start },
    ...supplements.map((s) => ({ sourceRef: s.sourceRef, text: s.text, baseOffset: s.start })),
  ];
  const { unresolvedLinks } = findSupplements(chunkText, chunk.start, chunk.end, main.id, assets);
  return { chunkText, supplements, spaces, blockIds: [chunk.id, ...supplements.map((s) => s.blockId)], unresolvedLinks };
}

// ── 构建知识实体＋阅读壳（全部 pending；origin 不抹原文来源）──

export interface BuiltBatch {
  cards: LitCardRecord[];
  items: KnowledgeItem[];
  contexts: KnowledgeContext[];
  evidence: KnowledgeEvidence[];
  relations: KnowledgeRelation[];
  duplicateCandidates: string[];
}

const unknownOf = (fieldPath: string, reasonCode: UnknownReasonCode, detail: string, scopeRefs: SourceRef[]): Unknown => ({
  id: `unk_${randomUUID()}`, fieldPath, reasonCode, detail, scopeRefs, evidenceRefs: [],
});

export function buildKnowledgeBatch(state: LocusState, run: ExtractionRunRecord, chunk: ExtractionChunk, batch: StructBatch, spaces: SearchSpace[], unresolvedLinks: string[] = []): BuiltBatch {
  const topicIds = run.topicId ? [run.topicId] : [];
  const subquestionIds = run.subquestionId ? [run.subquestionId] : [];
  const scope = { topicIds, subquestionIds, createdFromRunId: run.id };
  const envelope = <P>(id: string, payload: P) => ({ id, revision: 1, createdAt: now(), updatedAt: now(), payload, history: [] });

  const evByLocal = new Map<string, KnowledgeEvidence>();
  const evidence: KnowledgeEvidence[] = batch.evidence.map((e) => {
    const loc = locateQuote(e.quote, spaces, chunk.sourceRef);
    const env = envelope(`kev_${randomUUID()}`, {
      sourceRef: loc.sourceRef, locator: loc.locator, quote: e.quote,
      locationStatus: loc.locationStatus, candidates: loc.candidates,
    } satisfies EvidencePayload);
    evByLocal.set(e.localId, env);
    return env;
  });
  const evRefs = (locals: string[]): KnowledgeRef[] => locals.map((l) => knowledgeRef("evidence", evByLocal.get(l)!.id, 1));
  const evUnknowns = (locals: string[]): Unknown[] => locals.flatMap((l) => {
    const env = evByLocal.get(l)!;
    if (env.payload.locationStatus === "unmatched") return [unknownOf("evidence", "unresolved_link", `引文定位不足：${env.payload.quote.slice(0, 40)}`, [env.payload.sourceRef])];
    if (env.payload.locationStatus === "ambiguous") return [unknownOf("evidence", "ambiguous", `引文多处命中（${env.payload.candidates.length}），须人工指定`, [env.payload.sourceRef])];
    return [];
  });

  const ctxByLocal = new Map<string, KnowledgeContext>();
  const items: KnowledgeItem[] = [];
  const contexts: KnowledgeContext[] = batch.contexts.map((c) => {
    const env = envelope(`kctx_${randomUUID()}`, {
      ...scope,
      researchUnitId: `ru_${run.id}_${c.localId}`,
      subject: c.subject, groupLabel: c.group, stage: c.stage,
      methodRefs: [],
      conditions: c.conditions.map((cond) => ({
        id: `cond_${randomUUID()}`,
        field: { raw: cond.field },
        value: cond.value,
        appliesTo: cond.appliesTo,
        evidenceRefs: evRefs(cond.evidenceLocalIds),
        obtainedBy: "source_explicit" as const,
        review: pendingReview(),
      })),
      unknowns: [
        ...c.unknowns.map((u) => unknownOf("model_reported", "not_reported_in_checked_scope", u, [chunk.sourceRef])),
        ...evUnknowns(c.evidenceLocalIds),
        ...unresolvedLinks.map((u) => unknownOf("supplement", "unresolved_link", u, [chunk.sourceRef])),
      ],
      review: pendingReview(),
    } satisfies ContextPayload);
    ctxByLocal.set(c.localId, env);
    return env;
  });

  const itemByLocal = new Map<string, KnowledgeRef>();
  const duplicateCandidates: string[] = [];
  const pushItem = (cardLocal: string, it: BatchItem, cardId: string, contextRefs: KnowledgeRef[]): KnowledgeItem => {
    const sourceRefs = [chunk.sourceRef, ...it.evidenceLocalIds.map((l) => evByLocal.get(l)!.payload.sourceRef)]
      .filter((r, i, arr) => arr.findIndex((x) => x.kind === r.kind && x.id === r.id && x.version === r.version) === i);
    const env = envelope(`ki_${randomUUID()}`, {
      ...scope,
      contentType: it.contentType, nature: it.nature, text: it.text,
      subject: { raw: it.subject }, predicate: { raw: it.predicate }, value: it.value,
      contextRefs,
      evidenceRefs: it.evidenceLocalIds.map((l) => ({ ref: knowledgeRef("evidence", evByLocal.get(l)!.id, 1), fieldPaths: it.value ? ["text", "value"] : ["text"] })),
      sourceRefs,
      origin: { sourceClass: "literature_report" as const, createdBy: "model" as const, secondaryCitation: it.secondaryCitation },
      scopeText: it.scopeText,
      unknowns: [
        ...it.unknowns.map((u) => unknownOf("model_reported", "not_reported_in_checked_scope", u, [chunk.sourceRef])),
        ...evUnknowns(it.evidenceLocalIds),
      ],
      review: pendingReview(),
      cardId,
    } satisfies ItemPayload);
    items.push(env);
    itemByLocal.set(cardLocal, knowledgeRef("item", env.id, 1));
    const dup = state.knowledge.items.find((x) => x.payload.text === it.text && x.payload.predicate.raw === it.predicate);
    if (dup) duplicateCandidates.push(`新项「${it.text.slice(0, 30)}」与已有项 ${dup.id} 概述相同（仅提示，不自动合并/删除）`);
    return env;
  };

  const cards: LitCardRecord[] = batch.cards.map((card) => {
    const cardId = `card_${randomUUID()}`;
    const itemRefs: KnowledgeRef[] = [];
    for (const it of card.items) {
      const env = pushItem(`${card.localId}/${items.length}`, it, cardId, it.contextLocalIds.map((l) => knowledgeRef("context", ctxByLocal.get(l)!.id, 1)));
      itemRefs.push(knowledgeRef("item", env.id, 1));
    }
    // 单项目：卡 localId 即其唯一项，供 relation 端点解析（多项卡不在此登记，避免挑第一个）
    if (itemRefs.length === 1) itemByLocal.set(card.localId, itemRefs[0]);
    const firstMatched = evidence.find((e) => e.payload.locationStatus === "matched");
    return {
      id: cardId,
      assetId: chunk.sourceRef.id,
      paperId: run.paperRef.id,
      rawText: card.summary,
      locator: { sectionQuote: firstMatched ? firstMatched.payload.quote.slice(0, 120) : "" },
      spans: evidence.map((e) => ({ assetId: e.payload.sourceRef.id, quote: e.payload.quote, matched: e.payload.locationStatus === "matched" })),
      extracted: { fields: {}, units: [], conditions: [] },
      unknowns: [],
      secondaryCitation: card.items.some((i) => i.secondaryCitation),
      audit: "unreviewed",
      importance: null, note: "", reason: "",
      extraction: "ai", mechanical: false,
      revision: 1, history: [],
      createdAt: now(), updatedAt: now(),
      knowledgeItemIds: itemRefs.map((r) => r.id),
    };
  });

  // context.method 文字 → 方法 item（不丢来源文字；methodRefs 固定版本）
  for (const c of batch.contexts) {
    if (!c.method) continue;
    const ctxEnv = ctxByLocal.get(c.localId)!;
    const methodItem = pushItem(`${c.localId}/method`, {
      contentType: "method", nature: "observation", text: c.method,
      subject: c.subject, predicate: "方法", value: null,
      contextLocalIds: [c.localId], evidenceLocalIds: c.evidenceLocalIds,
      scopeText: "", unknowns: [], secondaryCitation: false,
    }, cards[0]?.id ?? "", [knowledgeRef("context", ctxEnv.id, 1)]);
    const idx = contexts.findIndex((x) => x.id === ctxEnv.id);
    contexts[idx] = { ...ctxEnv, payload: { ...ctxEnv.payload, methodRefs: [knowledgeRef("item", methodItem.id, 1)] } };
  }

  const refOfLocal = (local: string): KnowledgeRef => {
    if (itemByLocal.has(local)) return itemByLocal.get(local)!;
    if (ctxByLocal.has(local)) return knowledgeRef("context", ctxByLocal.get(local)!.id, 1);
    if (evByLocal.has(local)) return knowledgeRef("evidence", evByLocal.get(local)!.id, 1);
    throw new AiError(`relation 端点无法解析：${local}`, true);
  };
  const relations: KnowledgeRelation[] = batch.relations.map((r) => envelope(`krel_${randomUUID()}`, {
    from: refOfLocal(r.fromLocalId), to: refOfLocal(r.toLocalId),
    relationType: r.relationType, basis: r.basis,
    evidenceRefs: evRefs(r.evidenceLocalIds),
    establishedBy: "model", review: pendingReview(),
  } satisfies RelationPayload));

  return { cards, items, contexts, evidence, relations, duplicateCandidates };
}

// ── 同笔提交＋幂等 receipt（§5.3/§5.4 / T08）─────────────────

export interface ChunkCommitResult {
  state: LocusState;
  receipt?: ExtractionReceipt;
  replayed?: boolean;
  discarded?: boolean;
  created: number; skipped: number; createdItems: number; pendingItems: number;
  duplicateCandidates: string[];
}

/** 取消/暂停/运行状态推导（job 终态与 run.status 分开）。 */
export function deriveRunStatus(run: ExtractionRunRecord, opts: { cancelled?: boolean; paused?: boolean; settled?: boolean }): ExtractionRunRecord["status"] {
  if (opts.cancelled) return "cancelled";
  const cs = run.chunks;
  if (cs.length > 0 && cs.every((c) => c.status === "committed")) return "completed";
  if (opts.paused) return "paused";
  if (opts.settled) {
    const committed = cs.filter((c) => c.status === "committed").length;
    const failed = cs.filter((c) => c.status === "failed").length;
    if (committed > 0 && failed > 0) return "partial";
    if (failed === cs.length) return "failed";
    if (committed > 0) return "partial";
    return "failed";
  }
  return "running";
}

function patchChunk(state: LocusState, runId: string, chunkId: string, patch: Partial<ExtractionChunk>, runStatus?: ExtractionRunRecord["status"]): LocusState {
  const k = state.knowledge;
  return {
    ...state,
    knowledge: {
      ...k,
      extractionRuns: k.extractionRuns.map((r) => r.id !== runId ? r : {
        ...r, updatedAt: now(), status: runStatus ?? r.status,
        chunks: r.chunks.map((c) => c.id === chunkId ? { ...c, ...patch } : c),
      }),
    },
  };
}

/**
 * 块提交（须在 commitState 内调用）：先查已持久化 receipt——即使 run 已取消也返回原成功结果，不再写入；
 * 未命中才检查取消（在途响应丢弃）；成功则壳＋items/contexts/evidence/relations＋receipt 同笔追加。
 */
export function commitKnowledgeChunk(
  state: LocusState, runId: string, chunkId: string,
  built: BuiltBatch | null, raw: string | undefined, errorMsg?: string,
): ChunkCommitResult {
  const run = state.knowledge.extractionRuns.find((r) => r.id === runId);
  if (!run) throw new AppError(404, `提取任务不存在：${runId}`);
  const chunk = run.chunks.find((c) => c.id === chunkId);
  if (!chunk) throw new AppError(404, `块不存在：${chunkId}`);
  const zero = { created: 0, skipped: 0, createdItems: 0, pendingItems: 0, duplicateCandidates: [] as string[] };
  if (chunk.receipt) return { state, receipt: chunk.receipt, replayed: true, ...zero, created: chunk.receipt.response.created, createdItems: chunk.receipt.response.createdItems, pendingItems: chunk.receipt.response.pendingItems };
  if (errorMsg !== undefined) {
    return { state: patchChunk(state, runId, chunkId, { status: "failed", error: errorMsg }), ...zero };
  }
  if (!built || run.status === "cancelled") {
    return { state: patchChunk(state, runId, chunkId, { status: "discarded" }), discarded: true, ...zero };
  }
  const receipt: ExtractionReceipt = {
    inputHash: chunk.sourceTextHash,
    committedAt: now(),
    cardIds: built.cards.map((c) => c.id),
    itemIds: built.items.map((i) => i.id),
    contextIds: built.contexts.map((c) => c.id),
    evidenceIds: built.evidence.map((e) => e.id),
    relationIds: built.relations.map((r) => r.id),
    response: {
      created: built.cards.length, skipped: 0,
      createdItems: built.items.length,
      pendingItems: built.items.filter((i) => i.payload.review.status === "pending").length,
    },
  };
  const k = state.knowledge;
  const next: LocusState = {
    ...state,
    cards: [...state.cards, ...built.cards],
    knowledge: {
      ...k,
      items: [...k.items, ...built.items],
      contexts: [...k.contexts, ...built.contexts],
      evidence: [...k.evidence, ...built.evidence],
      relations: [...k.relations, ...built.relations],
      extractionRuns: k.extractionRuns.map((r) => r.id !== runId ? r : {
        ...r, updatedAt: now(),
        chunks: r.chunks.map((c) => c.id === chunkId ? { ...c, status: "committed" as const, rawResponse: raw, receipt } : c),
      }),
    },
  };
  return { state: next, receipt, ...zero, created: receipt.response.created, createdItems: receipt.response.createdItems, pendingItems: receipt.response.pendingItems, duplicateCandidates: built.duplicateCandidates };
}

/** run 级状态落库（循环结束/暂停/取消时调用，须在 commitState 内）。 */
export function settleRun(state: LocusState, runId: string, opts: { cancelled?: boolean; paused?: boolean; settled?: boolean }): LocusState {
  const run = state.knowledge.extractionRuns.find((r) => r.id === runId);
  if (!run) return state;
  const status = deriveRunStatus(run, opts);
  return { ...state, knowledge: { ...state.knowledge, extractionRuns: state.knowledge.extractionRuns.map((r) => r.id === runId ? { ...r, status, updatedAt: now() } : r) } };
}