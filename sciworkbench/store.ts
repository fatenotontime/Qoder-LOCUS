/**
 * 可替换存储层 与 数据模型（v2）。
 * v2 变更：测量项改为**表格**模型；所有可编辑实体带**修订历史**。
 * 现在：JsonFileStore（本地文件）/ MemoryStore（测试）。将来：Sites DB（同一 Store 接口）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname } from "node:path";

/** 查重口径：逻辑内容（剥 BOM + CRLF→LF），与传输编码无关；原件文本仍逐字保存。 */
export function canonicalText(t: string): string {
  return t.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}
export function contentHash(t: string): string {
  return createHash("sha256").update(canonicalText(t), "utf8").digest("hex");
}

/** 一条修订：记录字段前后值、原因与修订号（更正留历史）。 */
export interface RevisionEntry {
  readonly revision: number;
  readonly at: string;
  readonly field: string;
  readonly before: string;
  readonly after: string;
  readonly reason: string;
}

/** 一条原始素材（导入的文献摘录或实验数据文件）。原件**完整保存**；超限直接拒绝，不截断。 */
export interface AssetRecord {
  readonly id: string;
  readonly kind: "literature" | "measurement" | "image";
  readonly name: string;
  readonly topicId?: string;
  readonly bytes: number;
  readonly hash: string;
  readonly text: string;
  readonly createdAt: string;
}

export type Extraction = "draft" | "ai" | "manual";

/** 抽取内容：字段/单位/条件分开；缺项单列，不补造。 */
export interface CardExtracted {
  readonly fields: Record<string, string>;
  readonly units: string[];
  readonly conditions: string[];
}

/** 文献证据卡。 */
export interface LitCardRecord {
  readonly id: string;
  readonly assetId: string;
  readonly rawText: string;
  readonly locator: { readonly sectionQuote: string };
  readonly extracted: CardExtracted;
  readonly unknowns: string[];
  /** 综述转引（二手）：不计多份独立证据（LIT08）。 */
  readonly secondaryCitation: boolean;
  readonly audit: "unreviewed" | "confirm" | "need_info" | "exclude" | "skip";
  readonly importance: "high" | "medium" | "low" | null;
  readonly note: string;
  readonly reason: string;
  readonly extraction: Extraction;
  readonly revision: number;
  readonly history: RevisionEntry[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 任务采用/排除：独立于核对；一卡可被多任务引用（LIT01–04）。 */
export interface AdoptionRecord {
  readonly id: string;
  readonly cardId: string;
  readonly subquestionId: string;
  readonly decision: "adopt" | "exclude";
  readonly reason: string;
  readonly cardRevision: number;
  readonly revision: number;
  readonly history: RevisionEntry[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 命名映射：原名保留，映射必须有依据（LIT09）。 */
export interface NameMappingRecord {
  readonly id: string;
  readonly topicId?: string;
  readonly original: string;
  readonly mapped: string;
  readonly basis: string;
  readonly createdAt: string;
}

/** 比较快照条目：固定卡 revision，不指向 latest。 */
export interface ComparisonEntry {
  readonly cardId: string;
  readonly cardRevision: number;
  readonly originalName: string;
  readonly mappedName: string;
  readonly value: string;
  readonly unit: string;
  readonly conditions: string[];
}

export interface ComparisonGroup {
  readonly name: string;
  readonly entries: ComparisonEntry[];
  readonly divergence: "single" | "consistent" | "value_diff" | "conditions_diff";
  readonly unresolved: string[];
}

/** 条件差异/分歧比较：输入快照固定，追加式不覆盖（LIT10）。 */
export interface ComparisonRecord {
  readonly id: string;
  readonly topicId: string;
  readonly subquestionId?: string;
  readonly snapshot: {
    readonly dataRevision: string;
    readonly filters: string[];
    readonly conversions: string[];
    readonly exclusions: string[];
    readonly mappingIds: string[];
    readonly pinnedAt: string;
  };
  readonly groups: ComparisonGroup[];
  /** 已采用/已入快照的卡被修改 → 标复核，不自动改快照。 */
  readonly reviewFlags: { readonly cardId: string; readonly cardRevision: number; readonly at: string }[];
  readonly note: string;
  readonly createdAt: string;
}

/** 列级核对信息（单位、结论）。 */
export interface ColumnMeta {
  readonly name: string;
  readonly unit: string;
  readonly decision: "unreviewed" | "confirm" | "need_info";
}

/**
 * 实验数据**表格**（保留结构）：真实时间序列以表格/系列核对，
 * 不把每个单元格变成一张逐项表单。
 */
export interface MeasurementTableRecord {
  readonly id: string;
  readonly assetId: string;
  readonly name: string;
  readonly columns: string[];
  readonly rows: string[][];
  /** 块标记行下标（原件中的分块标题行，如时间块；保留原行、仅标注，非测量行）。 */
  readonly markerRows?: number[];
  readonly columnMeta: ColumnMeta[];
  readonly note: string;
  readonly revision: number;
  readonly history: RevisionEntry[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 课题：仅名称+研究问题即可建（TOP01）。 */
export interface TopicRecord {
  readonly id: string;
  readonly name: string;
  readonly researchQuestion: string;
  readonly createdAt: string;
}

// ── 4C：方案 / 模板 / 执行 / 样品 / 测量 / 影响 / OCR ────────

/** 方案步骤：相对时间（分钟，可估计）、必要支路、观察终点。 */
export interface ProtocolStep {
  readonly id: string;
  readonly op: string;
  readonly params: Record<string, string>;
  readonly note: string;
  readonly durationMin: number | null;
  readonly estimated: boolean;
  readonly branch: string | null;
  /** 支路锚点（可选，追加式）：分叉自主线哪一步之后、汇合入主线哪一步之前。未指定则明示不猜。 */
  readonly branchFrom?: string | null;
  readonly mergeInto?: string | null;
  readonly observeEnd: string;
}

/** 方案修订：整版快照，追加式；引用固定 revision，不指向 latest。 */
export interface ProtocolRevisionSnapshot {
  readonly revision: number;
  readonly at: string;
  readonly reason: string;
  readonly purpose: string;
  readonly inputs: string[];
  readonly steps: ProtocolStep[];
  readonly conditions: string[];
  readonly criteria: string;
  readonly unknowns: string[];
  readonly sourceFragments: string[];
}

export interface ProtocolRecord {
  readonly id: string;
  readonly topicId: string;
  readonly name: string;
  /** 方法来源：用户编写 / 公开材料重构（须标明）/ AI 草稿。 */
  readonly sourceKind: "user" | "reconstructed" | "ai-draft";
  readonly sourceAssetId?: string;
  readonly revision: number;
  readonly revisions: ProtocolRevisionSnapshot[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 记录模板：固定方案 revision；AI 草稿须人工确认后复用。 */
export interface RecordTemplateRecord {
  readonly id: string;
  readonly protocolId: string;
  readonly protocolRevision: number;
  readonly fields: string[];
  readonly aiDraft: boolean;
  readonly humanConfirmed: boolean;
  readonly confirmedAt?: string;
  readonly revision: number;
  readonly history: RevisionEntry[];
  readonly createdAt: string;
}

/** 执行事件：实际层；后补标 backfilled；原位编辑留历史，不改源方案。 */
export interface ExecEvent {
  readonly id: string;
  readonly at: string;
  readonly recordedAt: string;
  readonly backfilled: boolean;
  readonly kind: "start" | "step" | "pause" | "resume" | "note" | "deviation";
  readonly stepId?: string;
  readonly text: string;
  readonly actual: { readonly amount?: string; readonly durationMin?: number; readonly order?: number };
  readonly revision: number;
  readonly history: RevisionEntry[];
}

export interface ExecutionRecord {
  readonly id: string;
  readonly topicId: string;
  readonly protocolId: string;
  readonly protocolRevision: number;
  readonly templateId?: string;
  readonly status: "active" | "paused" | "done";
  readonly events: ExecEvent[];
  readonly pausedState?: {
    readonly at: string;
    readonly reason: string;
    readonly risks: string[];
    readonly resumeChecks: string[];
    readonly aiSuggested: boolean;
    readonly humanDecision?: string;
  };
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 样品状态：追加式；用量可估计；历史不被改写。 */
export interface SampleStateEntry {
  readonly revision: number;
  readonly at: string;
  readonly amount: { readonly value: string; readonly unit: string; readonly estimated: boolean };
  readonly handling: string;
  readonly use: string;
  readonly note: string;
}

export interface SampleRecord {
  readonly id: string;
  readonly topicId: string;
  readonly executionId?: string;
  /** 稳定短号：引用用 id，改名不破引用。 */
  readonly shortName: string;
  readonly displayName: string;
  readonly origin: "user" | "public";
  readonly states: SampleStateEntry[];
  readonly createdAt: string;
}

/** 独立测量：固定样品状态 revision；可回链表格单元格。 */
export interface MeasurementRecord {
  readonly id: string;
  readonly topicId: string;
  readonly sampleId: string;
  readonly sampleStateRevision: number;
  readonly time: string;
  readonly method: string;
  readonly instrument: string;
  readonly value: string;
  readonly unit: string;
  readonly cellRef?: { readonly tableId: string; readonly row: number; readonly col: number };
  readonly note: string;
  readonly revision: number;
  readonly history: RevisionEntry[];
  readonly createdAt: string;
}

export interface ImpactItem {
  readonly targetKind: string;
  readonly targetId: string;
  readonly targetRevision?: number;
  readonly category: "timing" | "execution" | "comparability" | "analysis" | "interpretation";
  readonly finding: string;
  readonly reason: string;
  readonly evidenceRefs: string[];
  readonly unknowns: string[];
  readonly suggestedAction: string;
}

/** 影响分析：确定性时间传播独立；AI 语义评估分栏；失败/未配置 ≠ 无影响；新改动 → 旧分析 stale。 */
export interface ImpactRecord {
  readonly id: string;
  readonly topicId: string;
  readonly change: { readonly entityKind: "protocol" | "execution" | "sample" | "measurement" | "table"; readonly entityId: string; readonly revision: number; readonly summary: string };
  readonly snapshotHash: string;
  readonly status: "pending" | "running" | "completed" | "failed" | "stale";
  readonly deterministic: { readonly timeShifts: { readonly stepId: string; readonly op: string; readonly deltaMin: number; readonly newTotalMin: number }[]; readonly note: string };
  readonly model?: string;
  readonly promptVersion: string;
  readonly assessment?: "impact" | "no_supported_impact_found" | "needs_review";
  readonly summary: string;
  readonly items: ImpactItem[];
  readonly error?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** OCR/手写记录：原图归档 + 识别草稿 → 人工修订 → 确认。 */
export interface OcrRecord {
  readonly id: string;
  readonly assetId: string;
  readonly extraction: "ai" | "manual";
  readonly rawText: string;
  readonly fields: Record<string, string>;
  readonly unknowns: string[];
  readonly status: "draft" | "confirmed";
  readonly revision: number;
  readonly history: RevisionEntry[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 子问题：可探索性建立，实际任务再查缺项。 */
export interface SubquestionRecord {
  readonly id: string;
  readonly topicId: string;
  readonly question: string;
  readonly kind: "declared" | "exploratory";
  readonly createdAt: string;
}

export interface LocusState {
  readonly version: number;
  readonly topics: TopicRecord[];
  readonly subquestions: SubquestionRecord[];
  readonly assets: AssetRecord[];
  readonly cards: LitCardRecord[];
  readonly tables: MeasurementTableRecord[];
  readonly adoptions: AdoptionRecord[];
  readonly mappings: NameMappingRecord[];
  readonly comparisons: ComparisonRecord[];
  readonly protocols: ProtocolRecord[];
  readonly templates: RecordTemplateRecord[];
  readonly executions: ExecutionRecord[];
  readonly samples: SampleRecord[];
  readonly measurements: MeasurementRecord[];
  readonly impacts: ImpactRecord[];
  readonly ocrs: OcrRecord[];
}

export const STATE_VERSION = 5;

export function emptyState(): LocusState {
  return { version: STATE_VERSION, topics: [], subquestions: [], assets: [], cards: [], tables: [], adoptions: [], mappings: [], comparisons: [], protocols: [], templates: [], executions: [], samples: [], measurements: [], impacts: [], ocrs: [] };
}

export interface Store {
  load(): Promise<LocusState>;
  save(state: LocusState): Promise<void>;
}

export class MemoryStore implements Store {
  #state: LocusState = emptyState();
  async load(): Promise<LocusState> {
    return structuredClone(this.#state);
  }
  async save(state: LocusState): Promise<void> {
    this.#state = structuredClone(state);
  }
}

export class JsonFileStore implements Store {
  readonly #path: string;
  constructor(path: string) {
    this.#path = path;
  }
  async load(): Promise<LocusState> {
    if (!existsSync(this.#path)) return emptyState();
    try {
      const p = JSON.parse(readFileSync(this.#path, "utf8")) as Partial<LocusState> & { version?: number };
      const v = p.version ?? 0;
      if (v !== 2 && v !== 3 && v !== 4 && v !== STATE_VERSION) return emptyState();
      // v2/v3/v4 → v5：保留既有数据，补空新实体；旧卡补默认抽取结构（不丢用户数据）
      // hash 统一为逻辑内容口径（旧记录按 canonical 重算，保持跨路径拒重一致）
      return {
        version: STATE_VERSION,
        topics: p.topics ?? [],
        subquestions: p.subquestions ?? [],
        assets: (p.assets ?? []).map((a) => ({ ...a, hash: contentHash(a.text) })),
        cards: (p.cards ?? []).map((c) => ({
          ...c,
          extracted: c.extracted ?? { fields: {}, units: [], conditions: [] },
          unknowns: c.unknowns ?? [],
          secondaryCitation: c.secondaryCitation ?? false,
        })),
        tables: p.tables ?? [],
        adoptions: p.adoptions ?? [],
        mappings: p.mappings ?? [],
        comparisons: p.comparisons ?? [],
        protocols: p.protocols ?? [],
        templates: p.templates ?? [],
        executions: p.executions ?? [],
        samples: p.samples ?? [],
        measurements: p.measurements ?? [],
        impacts: p.impacts ?? [],
        ocrs: p.ocrs ?? [],
      };
    } catch {
      return emptyState();
    }
  }
  async save(state: LocusState): Promise<void> {
    mkdirSync(dirname(this.#path), { recursive: true });
    // 唯一临时名：避免并发保存互相覆盖同一 .tmp
    const tmp = `${this.#path}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    renameSync(tmp, this.#path);
  }
}
