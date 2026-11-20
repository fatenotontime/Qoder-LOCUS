/**
 * 知识领域类型（合同 §4）：类型 + 纯校验 + hash 规范辅助。
 * 无网络、无文件 IO；不生成通用对象平台，只服务 LOCUS 知识命名空间。
 */
import { createHash } from "node:crypto";

/** 知识命名空间版本（与业务 state.version 分开）。 */
export const KNOWLEDGE_SCHEMA_VERSION = 1;

/** 无量纲单位规范值（合同 §4.3）。 */
export const NONDIMENSIONAL_UNIT = "1";

// ── 引用 ────────────────────────────────────────────────────

/** 可编辑知识对象的种类。 */
export type KnowledgeKind = "item" | "context" | "evidence" | "relation" | "theme" | "mapping" | "dataset" | "comparison";
export const KNOWLEDGE_KINDS: readonly KnowledgeKind[] = ["item", "context", "evidence", "relation", "theme", "mapping", "dataset", "comparison"];

/** 知识引用：kind + id + 正整数 revision。 */
export interface KnowledgeRef {
  readonly kind: KnowledgeKind;
  readonly id: string;
  readonly revision: number;
}

/** 已纳管业务对象的来源种类。 */
export type SourceKind =
  | "topic" | "subquestion" | "paper" | "attachment" | "asset" | "card" | "table"
  | "protocol" | "template" | "execution" | "sample" | "measurement" | "result"
  | "report" | "report_block" | "chat_proposal" | "ocr";
export const SOURCE_KINDS: readonly SourceKind[] = [
  "topic", "subquestion", "paper", "attachment", "asset", "card", "table",
  "protocol", "template", "execution", "sample", "measurement", "result",
  "report", "report_block", "chat_proposal", "ocr",
];

/** 来源引用：version 为命名空间字符串（r:N 业务修订 / k:N 纳管版本 / sha256:HASH 不可变原件）。 */
export interface SourceRef {
  readonly kind: SourceKind;
  readonly id: string;
  readonly version: string;
  readonly contentHash: string;
}

export const knowledgeRef = (kind: KnowledgeKind, id: string, revision: number): KnowledgeRef => ({ kind, id, revision });
export const sourceRef = (kind: SourceKind, id: string, version: string, contentHash: string): SourceRef => ({ kind, id, version, contentHash });

export function isKnowledgeRef(x: unknown): x is KnowledgeRef {
  const o = x as Partial<KnowledgeRef> | null;
  return !!o && typeof o.kind === "string" && (KNOWLEDGE_KINDS as readonly string[]).includes(o.kind)
    && typeof o.id === "string" && o.id.length > 0 && typeof o.revision === "number" && Number.isInteger(o.revision) && o.revision > 0;
}
export function isSourceRef(x: unknown): x is SourceRef {
  const o = x as Partial<SourceRef> | null;
  return !!o && typeof o.kind === "string" && (SOURCE_KINDS as readonly string[]).includes(o.kind)
    && typeof o.id === "string" && o.id.length > 0 && typeof o.version === "string" && typeof o.contentHash === "string";
}
/** 相同 kind/id 但 revision 不同不能合并（合同 §4.2）。 */
export function sameRef(a: KnowledgeRef, b: KnowledgeRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}
export function refKey(r: KnowledgeRef): string { return `${r.kind}:${r.id}@r${r.revision}`; }
export function refSpanKey(r: KnowledgeRef): string { return `${r.kind}:${r.id}`; }

// ── 值（TypedValue）与未知项 ─────────────────────────────────

export type ValueKind = "scalar" | "bound" | "range" | "category" | "summary" | "missing";

/** 未知/缺失原因码（合同 §4.3）。 */
export type UnknownReasonCode =
  | "not_in_selected_material" | "unprocessed_source" | "not_reported_in_checked_scope"
  | "ambiguous" | "conflicting" | "not_measured" | "below_detection_limit"
  | "unparsed_numeric" | "unresolved_link";
export const UNKNOWN_REASON_CODES: readonly UnknownReasonCode[] = [
  "not_in_selected_material", "unprocessed_source", "not_reported_in_checked_scope",
  "ambiguous", "conflicting", "not_measured", "below_detection_limit",
  "unparsed_numeric", "unresolved_link",
];

interface TypedValueBase { readonly raw: string; }
export interface ScalarTypedValue extends TypedValueBase { readonly kind: "scalar"; readonly value: string | null; readonly unit: string | null; readonly flags?: readonly string[]; }
export interface BoundTypedValue extends TypedValueBase { readonly kind: "bound"; readonly operator: "gt" | "gte" | "lt" | "lte"; readonly value: string; readonly unit: string | null; }
export interface RangeTypedValue extends TypedValueBase { readonly kind: "range"; readonly lower: string; readonly upper: string; readonly unit: string | null; }
export interface CategoryTypedValue extends TypedValueBase { readonly kind: "category"; readonly label: string; readonly unparsed_numeric?: boolean; }
export interface SummaryTypedValue extends TypedValueBase {
  readonly kind: "summary"; readonly statistic: string; readonly value: string; readonly unit: string | null;
  readonly uncertainty?: { readonly type: "SD" | "SE" | "CI"; readonly value: string };
  readonly sampleSize?: number;
}
export interface MissingTypedValue extends TypedValueBase { readonly kind: "missing"; readonly reasonCode: UnknownReasonCode; }
export type TypedValue = ScalarTypedValue | BoundTypedValue | RangeTypedValue | CategoryTypedValue | SummaryTypedValue | MissingTypedValue;

/** 明确缺失（不默认 0），与“有值但缺测”的 missing 区分。 */
export function missingValue(raw: string, reasonCode: UnknownReasonCode): MissingTypedValue {
  return { kind: "missing", raw, reasonCode };
}

/** 未知项：不保存全局“有 unknown 就禁用”的标志，是否阻断由具体操作推导。 */
export interface Unknown {
  readonly id: string;
  readonly fieldPath: string;
  readonly reasonCode: UnknownReasonCode;
  readonly detail: string;
  readonly scopeRefs: Array<KnowledgeRef | SourceRef>;
  readonly evidenceRefs: KnowledgeRef[];
}

// ── 审核、来源性质、历史信封 ─────────────────────────────────

export type ReviewStatus = "pending" | "confirmed" | "needs_info" | "excluded" | "withdrawn";
export const REVIEW_STATUSES: readonly ReviewStatus[] = ["pending", "confirmed", "needs_info", "excluded", "withdrawn"];

/** 只由专用 review 操作改变；客户端不得在普通内容更新时指定。 */
export interface Review {
  readonly status: ReviewStatus;
  readonly reviewedAt?: string;
  readonly reviewedBy?: string;
  readonly basis?: string;
}
export const pendingReview = (): Review => ({ status: "pending" });

/** origin = {sourceClass, createdBy, secondaryCitation}（合同 §4.4）。 */
export type SourceClass = "literature_report" | "local_observation" | "historical_reconstruction" | "human_statement" | "model_suggestion";
export interface Origin {
  readonly sourceClass: SourceClass;
  readonly createdBy: "human" | "model" | "import";
  readonly secondaryCitation: boolean;
}

/** 可编辑知识对象的通用信封：新 revision 保存完整当前 payload；history 每项为完整旧 payload。 */
export interface KnowledgeHistoryEntry { readonly revision: number; readonly at: string; readonly reason: string; readonly payload: unknown; }
export interface KnowledgeEnvelope<P> {
  readonly id: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly payload: P;
  readonly history: KnowledgeHistoryEntry[];
}

/** 所有新科学记录 payload 共有的课题归属（合同 §4.4 末）。 */
export interface TopicScope {
  readonly topicIds: string[];
  readonly subquestionIds: string[];
  readonly createdFromRunId?: string;
}

// ── item ────────────────────────────────────────────────────

export type ItemContentType = "observation" | "method" | "definition" | "claim" | "limitation" | "question";
export type ItemNature = "observation" | "hypothesis" | "interpretation" | "to_verify" | "human_judgment";

export interface ItemPayload extends TopicScope {
  readonly contentType: ItemContentType;
  readonly nature: ItemNature;
  readonly text: string;
  readonly subject: { readonly raw: string; readonly entityRef?: KnowledgeRef | SourceRef };
  readonly predicate: { readonly raw: string; readonly metricId?: string };
  readonly value: TypedValue | null;
  readonly contextRefs: KnowledgeRef[];
  /** 引用精确指向 text/value/subject 等字段。 */
  readonly evidenceRefs: { readonly ref: KnowledgeRef; readonly fieldPaths: string[] }[];
  readonly sourceRefs: SourceRef[];
  readonly origin: Origin;
  readonly scopeText: string;
  readonly unknowns: Unknown[];
  readonly review: Review;
  readonly cardId?: string;
}
export type KnowledgeItem = KnowledgeEnvelope<ItemPayload>;

// ── context / condition ─────────────────────────────────────

export type ObtainedBy = "source_explicit" | "human_record" | "human_assumption";
export interface ConditionEntry {
  readonly id: string;
  readonly field: { readonly raw: string; readonly standardId?: string };
  readonly value: TypedValue;
  readonly appliesTo: { readonly subject: string; readonly stage: string };
  readonly evidenceRefs: KnowledgeRef[];
  readonly obtainedBy: ObtainedBy;
  readonly review: Review;
}
export interface ContextPayload extends TopicScope {
  readonly researchUnitId: string;
  readonly subject: string;
  readonly groupLabel: string;
  /** stage 为来源保持的文字，不全局推断。 */
  readonly stage: string;
  readonly methodRefs: KnowledgeRef[];
  readonly conditions: ConditionEntry[];
  readonly unknowns: Unknown[];
  readonly review: Review;
}
export type KnowledgeContext = KnowledgeEnvelope<ContextPayload>;

// ── evidence ────────────────────────────────────────────────

export interface LocatorText { readonly type: "text"; readonly start: number; readonly end: number; readonly printedPage?: string | number; readonly scanPage?: string | number; readonly section?: string; }
export interface LocatorTable { readonly type: "table"; readonly row: number; readonly column: number; readonly originalLocation?: string; }
export interface LocatorUnresolved { readonly type: "unresolved"; readonly description: string; }
export type Locator = LocatorText | LocatorTable | LocatorUnresolved;
export type LocationStatus = "matched" | "ambiguous" | "unmatched" | "source_missing";
export interface EvidencePayload {
  readonly sourceRef: SourceRef;
  readonly locator: Locator;
  readonly quote: string;
  readonly locationStatus: LocationStatus;
  readonly candidates: { readonly sourceRef: SourceRef; readonly locator: Locator }[];
}
export type KnowledgeEvidence = KnowledgeEnvelope<EvidencePayload>;

// ── relation ────────────────────────────────────────────────

export type RelationType = "belongs_to" | "derived_from" | "supports" | "contradicts" | "limits" | "uses_method" | "precondition_of" | "supersedes";
export const RELATION_TYPES: readonly RelationType[] = ["belongs_to", "derived_from", "supports", "contradicts", "limits", "uses_method", "precondition_of", "supersedes"];
export type AnyRef = KnowledgeRef | SourceRef;
export interface RelationPayload {
  readonly from: AnyRef;
  readonly to: AnyRef;
  readonly relationType: RelationType;
  readonly basis: string;
  readonly evidenceRefs: KnowledgeRef[];
  readonly establishedBy: "human" | "model" | "import";
  readonly review: Review;
}
export type KnowledgeRelation = KnowledgeEnvelope<RelationPayload>;

// ── theme ───────────────────────────────────────────────────

export interface ThemePayload {
  readonly topicId: string;
  readonly name: string;
  readonly definition: string;
  readonly subquestionIds: string[];
  /** 成员固定版本，新版本出现只提示可更新。 */
  readonly members: KnowledgeRef[];
  readonly currentJudgmentRefs: KnowledgeRef[];
}
export type KnowledgeTheme = KnowledgeEnvelope<ThemePayload>;

// ── mapping ─────────────────────────────────────────────────

export interface ConversionRule { readonly kind: "scaleOffset"; readonly factor: string; readonly offset: string; readonly fromUnit: string; readonly toUnit: string; }
export interface MappingPayload {
  readonly topicId: string;
  readonly metricId: string;
  readonly definition: string;
  readonly aliases: string[];
  readonly applicability: string;
  readonly valueKind: ValueKind;
  readonly targetUnit: string | null;
  readonly conversion: ConversionRule | null;
  readonly basis: string;
  readonly evidenceRefs: KnowledgeRef[];
  readonly review: Review;
}
export type KnowledgeMapping = KnowledgeEnvelope<MappingPayload>;

// ── dataset ─────────────────────────────────────────────────

export interface ColumnBinding { readonly index: number; readonly originalName: string; readonly standardId?: string; readonly type: ValueKind; readonly unit: string | null; readonly review: Review; }
export interface RowBinding {
  readonly rowIndex: number;
  readonly contextRef?: KnowledgeRef;
  readonly sampleStateRef?: SourceRef;
  readonly group?: string;
  readonly time?: string;
  readonly replicate?: { readonly label: string; readonly type: "technical" | "biological" | "unknown" };
}
export interface DatasetPayload extends TopicScope {
  readonly topicId: string;
  readonly sourceRef: SourceRef; // table
  readonly selection: { readonly rowIndices: number[]; readonly columnIndices: number[] };
  readonly columns: ColumnBinding[];
  readonly rowBindings: RowBinding[];
  readonly unknowns: Unknown[];
  readonly review: Review;
}
export type KnowledgeDataset = KnowledgeEnvelope<DatasetPayload>;

// ── comparison ──────────────────────────────────────────────

export interface ComparisonOperandItem { readonly type: "item"; readonly ref: KnowledgeRef; }
export interface ComparisonOperandCell { readonly type: "cell"; readonly datasetRef: KnowledgeRef; readonly rowIndex: number; readonly columnIndex: number; }
export type ComparisonOperand = ComparisonOperandItem | ComparisonOperandCell;
export type ComparisonDecision = "computable" | "display_only" | "blocked";
export type ComparisonOperation = "display" | "difference" | "ratio";
export interface NormalizedInput {
  readonly operand: ComparisonOperand;
  readonly rawValue: TypedValue | null;
  readonly normalizedValue: TypedValue | null;
  readonly mappingRefs: KnowledgeRef[];
}
export interface ComparisonPayload {
  readonly topicId: string;
  readonly question: string;
  readonly inputRefs: ComparisonOperand[];
  readonly metricId: string | null;
  readonly varyingFields: string[];
  readonly requiredEqualFields: string[];
  readonly operation: ComparisonOperation;
  readonly baselineRef: ComparisonOperand | null;
  readonly mappingRefs: KnowledgeRef[];
  readonly exclusions: string[];
  readonly decision: ComparisonDecision;
  readonly reasonCodes: string[];
  readonly normalizedInputs: NormalizedInput[];
  readonly computedValue: TypedValue | null;
  readonly formatting: string;
  readonly warnings: string[];
  readonly createdFromViewId: string;
}
export type KnowledgeComparison = KnowledgeEnvelope<ComparisonPayload>;

// ── sourcePolicies（本机用户决定，不是多租户权限系统）──────

export interface SourcePolicyHistoryEntry {
  readonly revision: number; readonly at: string;
  readonly allowLocalRead: boolean; readonly allowExport: boolean; readonly allowAiSend: boolean; readonly reason: string;
}
export interface SourcePolicyRecord {
  readonly id: string;
  readonly sourceKind: SourceKind | "knowledge_item";
  readonly sourceId: string;
  readonly revision: number;
  readonly allowLocalRead: boolean;
  readonly allowExport: boolean;
  readonly allowAiSend: boolean;
  readonly reason: string;
  readonly updatedAt: string;
  readonly history: SourcePolicyHistoryEntry[];
}

// ── extractionRuns（任务状态，不伪装成知识内容版本）─────────

export type ExtractionRunStatus = "running" | "paused" | "completed" | "partial" | "failed" | "cancelled" | "interrupted";
export type ChunkStatus = "pending" | "running" | "committed" | "failed" | "discarded";
export interface ExtractionReceipt {
  readonly inputHash: string;
  readonly committedAt: string;
  readonly cardIds: string[];
  readonly itemIds: string[];
  readonly contextIds: string[];
  readonly evidenceIds: string[];
  readonly relationIds: string[];
  readonly response: { readonly created: number; readonly skipped: number; readonly createdItems: number; readonly pendingItems: number };
}
export interface ExtractionChunk {
  readonly id: string;
  readonly sourceRef: SourceRef;
  readonly start: number;
  readonly end: number;
  readonly additionalRanges: { readonly sourceRef: SourceRef; readonly start: number; readonly end: number }[];
  readonly sourceTextHash: string;
  readonly status: ChunkStatus;
  readonly rawResponse?: string;
  readonly error?: string;
  readonly receipt?: ExtractionReceipt;
}
export interface ExtractionRunRecord {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly inputHash: string;
  readonly paperRef: SourceRef;
  readonly attachmentRefs: SourceRef[];
  readonly purpose: string;
  readonly topicId?: string;
  readonly subquestionId?: string;
  readonly promptVersion: string;
  readonly schemaVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: ExtractionRunStatus;
  readonly chunks: ExtractionChunk[];
}

// ── snapshots（保存后不可修改内容）──────────────────────────

export interface SnapshotScope { readonly topicId: string; readonly subquestionId?: string; readonly source: "current"; }
export interface SnapshotReferenceTokenMap { readonly [token: string]: { readonly kind: "knowledge" | "source"; readonly ref: KnowledgeRef | SourceRef; readonly label: string }; }
export interface SnapshotCoverage { readonly selected: number; readonly totalAvailable: number; readonly processed: number; readonly omittedReasons: string[]; }
export interface SnapshotContent {
  readonly items: KnowledgeItem[];
  readonly contexts: KnowledgeContext[];
  readonly evidence: KnowledgeEvidence[];
  readonly relations: KnowledgeRelation[];
  readonly datasets: KnowledgeDataset[];
  readonly themes: KnowledgeTheme[];
  readonly mappings: KnowledgeMapping[];
  readonly comparisons: KnowledgeComparison[];
  readonly referenceMap: SnapshotReferenceTokenMap;
}
export interface KnowledgeSnapshot {
  readonly snapshotId: string;
  readonly createdAt: string;
  readonly schemaVersion: number;
  readonly projectionVersion: number;
  readonly mode: "formal" | "explore";
  readonly scope: SnapshotScope;
  readonly contentHash: string;
  readonly content: SnapshotContent;
  readonly sourceVersionRefs: SourceRef[];
  readonly mappingRefs: KnowledgeRef[];
  readonly coverage: SnapshotCoverage;
  readonly excluded: { readonly ref: KnowledgeRef | SourceRef; readonly reason: string }[];
}

// ── sourceVersions（每个键只能追加，不可覆盖）────────────────

export interface SourceVersionRecord {
  readonly sourceRef: SourceRef;
  readonly archivedAt: string;
  readonly payload: unknown;
}

// ── 命名空间 ────────────────────────────────────────────────

export interface KnowledgeState {
  readonly schemaVersion: number;
  readonly items: KnowledgeItem[];
  readonly contexts: KnowledgeContext[];
  readonly evidence: KnowledgeEvidence[];
  readonly relations: KnowledgeRelation[];
  readonly themes: KnowledgeTheme[];
  readonly mappings: KnowledgeMapping[];
  readonly datasets: KnowledgeDataset[];
  readonly comparisons: KnowledgeComparison[];
  readonly sourcePolicies: SourcePolicyRecord[];
  readonly extractionRuns: ExtractionRunRecord[];
  readonly snapshots: KnowledgeSnapshot[];
  readonly sourceVersions: SourceVersionRecord[];
}

export function emptyKnowledge(): KnowledgeState {
  return {
    schemaVersion: KNOWLEDGE_SCHEMA_VERSION,
    items: [], contexts: [], evidence: [], relations: [], themes: [], mappings: [],
    datasets: [], comparisons: [], sourcePolicies: [], extractionRuns: [], snapshots: [], sourceVersions: [],
  };
}

const KNOWLEDGE_COLLECTIONS: readonly (keyof KnowledgeState)[] = [
  "items", "contexts", "evidence", "relations", "themes", "mappings",
  "datasets", "comparisons", "sourcePolicies", "extractionRuns", "snapshots", "sourceVersions",
];

/**
 * 知识命名空间结构校验（供严格加载与隔离恢复共用）。
 * 缺集合 / 未知 schemaVersion / 非数组集合 → 抛错（不静默补空）。
 */
export function assertKnowledgeShape(k: unknown): asserts k is KnowledgeState {
  if (!k || typeof k !== "object") throw new Error("知识命名空间缺失或非对象（不静默补空）。");
  const obj = k as Record<string, unknown>;
  const v = obj.schemaVersion;
  if (typeof v !== "number" || !Number.isInteger(v)) throw new Error("知识命名空间缺 schemaVersion（不静默补空）。");
  if (v !== KNOWLEDGE_SCHEMA_VERSION) throw new Error(`不支持的知识 schemaVersion v${v}（不静默补空）。`);
  for (const key of KNOWLEDGE_COLLECTIONS) {
    if (!Array.isArray(obj[key])) throw new Error(`知识命名空间缺集合 ${key}（不静默补空）。`);
  }
}

// ── hash 规范（合同 §7.3）：键递归排序、数组顺序稳定、UTF-8、SHA-256 ──

/** 稳定序列化：对象键递归字典序；数组保持既有顺序。 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** 内容 hash：SHA-256(UTF-8(stableStringify))。createdAt/snapshotId 由调用方在计算前剔除。 */
export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}
