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
/** 原件 hash：导入时的原始字节（utf8），一经保存不再重算覆盖（5C）。 */
export function rawHash(t: string): string {
  return createHash("sha256").update(t, "utf8").digest("hex");
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
  readonly kind: "literature" | "measurement" | "image" | "protocol" | "result";
  readonly name: string;
  readonly topicId?: string;
  readonly bytes: number;
  /** 原始字节 hash（导入时固定，加载不重算）。 */
  readonly hash: string;
  /** 逻辑内容指纹（剥 BOM/CRLF 规范化），仅用于跨路径查重；与原件 hash 分开保存。 */
  readonly fingerprint?: string;
  readonly text: string;
  readonly createdAt: string;
}

/** 论文条目：题录身份 ≠ 上传文件；同一论文可有正文/补充材料/版本多个附件（5A/5C）。 */
export interface PaperEntry {
  readonly id: string;
  readonly title: string;
  readonly authors: string[];
  readonly year: string;
  readonly doi: string;
  /** 来源说明（期刊/URL/手填等）；未提供留空，不补造。 */
  readonly source: string;
  /** 许可声明；未提供留空并明示。 */
  readonly license: string;
  /** 多课题可引用同一来源；空=未归属（收藏不强制归属）。 */
  readonly topicIds: string[];
  readonly note: string;
  readonly revision: number;
  readonly history: RevisionEntry[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 论文附件：指向原件 assetId；角色/版本明确；同 DOI 不同附件/版本不互拒。 */
export interface PaperAttachment {
  readonly id: string;
  readonly paperId: string;
  readonly assetId: string;
  readonly role: "fulltext" | "supplement" | "other";
  readonly version: string;
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
  /** 语义卡（5C）：单位是研究意义。旧片段卡无 kind；数据/论据/方法/思路分开。 */
  readonly paperId?: string;
  readonly kind?: "data" | "argument" | "method" | "idea";
  /** 适用范围；原文未写明则留空并入 unknowns，不补造。 */
  readonly scope?: string;
  /** 作者解释（与数据、模型建议/研究思路分开保存）。 */
  readonly interpretation?: string;
  /** 多段来源：一卡可引多段文字/表/图；matched=false 明示定位不足。 */
  readonly spans?: { readonly assetId: string; readonly quote: string; readonly matched: boolean }[];
  /** 机械草稿（开发调试保留）：明确标记，不与真实 AI 语义提取混淆。 */
  readonly mechanical?: boolean;
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

/** 执行准备稿（5D）：基础方案固定版本引用 + 本次差异；确认快照后才进入待补记录状态。 */
export interface ExecutionPreparation {
  readonly baseRevision: number;
  readonly adjustments: { readonly stepId: string; readonly field: string; readonly before: string; readonly after: string; readonly reason: string }[];
  readonly notes: string;
  readonly confirmedAt?: string;
  readonly snapshot?: ProtocolRevisionSnapshot;
}

export interface ExecutionRecord {
  readonly id: string;
  readonly topicId: string;
  readonly protocolId: string;
  readonly protocolRevision: number;
  readonly templateId?: string;
  /** preparing=准备稿未确认；recording=已确认快照、待补/持续补记录。存量执行视为 recording。 */
  readonly phase?: "preparing" | "recording";
  readonly preparation?: ExecutionPreparation | null;
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

// ── 阶段5E：分析任务 / 上下文快照 / 处理结果 / 初步报告 / 上下文对话 ──

/** 上下文对象引用：kind＋id，版本在快照碎片中固定。 */
export interface ObjectRef {
  readonly kind: "execution" | "protocol" | "measurement" | "table" | "card" | "asset" | "subquestion";
  readonly id: string;
}

export interface ContextFragment {
  readonly ref: ObjectRef;
  readonly label: string;
  readonly version: string;
  readonly excerpt: string;
}

/** 冻结上下文快照：实际发送的碎片/版本/摘要/目的/模型/提示词版本/hash。 */
export interface ContextSnapshot {
  readonly at: string;
  readonly purpose: string;
  readonly summary: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly hash: string;
  readonly fragments: ContextFragment[];
}

export interface MethodRecommendation {
  readonly name: string;
  readonly software: string;
  readonly rationale: string;
  readonly expectedArtifacts: string[];
  readonly acceptanceItems: string[];
}

export interface AnalysisRecommendation {
  readonly methods: MethodRecommendation[];
  readonly unknowns: string[];
  readonly raw: string;
  readonly at: string;
}

export interface AnalysisTaskRecord {
  readonly id: string;
  readonly topicId: string;
  readonly subquestionId?: string;
  readonly title: string;
  readonly core: ObjectRef[];
  readonly optional: { ref: ObjectRef; included: boolean }[];
  readonly snapshot?: ContextSnapshot;
  readonly recommendation?: AnalysisRecommendation;
  readonly resultIds: string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AnalysisResultRecord {
  readonly id: string;
  readonly taskId: string;
  readonly topicId: string;
  readonly method: string;
  readonly params: string;
  readonly reason: string;
  readonly note: string;
  readonly assetIds: string[];
  readonly reproducible: boolean;
  readonly missing: string[];
  readonly adoptedRecommendation: string;
  readonly revision: number;
  readonly history: { revision: number; at: string; reason: string; method: string; params: string }[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 报告块性质：明确区分观察 / 假设 / 解释 / 待验证 / 人工判断，不混淆证据与推断。 */
export type ReportBlockNature = "observation" | "hypothesis" | "interpretation" | "to_verify" | "human_judgment";

/** 报告块引用：固定版本的明确引用（kind=note 表示旧版自由文字来源，无稳定对象）。 */
export interface ReportBlockRef {
  readonly kind: "result" | "measurement" | "table" | "card" | "execution" | "protocol" | "subquestion" | "snapshot" | "note";
  readonly id: string;
  readonly version: string;
  readonly label: string;
}

/** 报告块：显式顺序＋性质＋固定引用＋AI 草稿标记＋块内局部修改历史。 */
export interface ReportBlock {
  readonly id: string;
  readonly order: number;
  readonly nature: ReportBlockNature;
  readonly text: string;
  readonly refs: ReportBlockRef[];
  readonly draft: boolean;
  readonly history: { at: string; reason: string; text: string; nature: ReportBlockNature }[];
}

export interface PreliminaryReportRecord {
  readonly id: string;
  readonly topicId: string;
  readonly taskId?: string;
  readonly pinned: { taskId?: string; resultIds: string[]; snapshotHash?: string };
  readonly blocks: ReportBlock[];
  readonly revision: number;
  readonly history: { revision: number; at: string; reason: string; blocks: ReportBlock[] }[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ChatProposal {
  readonly targetKind: "execution-note" | "report-toVerify";
  readonly targetId: string;
  readonly preview: string;
  readonly confirmed: boolean;
  readonly adoptedAt?: string;
}
export interface ChatMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly status: "running" | "done" | "failed" | "cancelled";
  readonly error?: string;
  readonly snapshot?: ContextSnapshot;
  readonly proposals: ChatProposal[];
  readonly sources: string[];
  readonly at: string;
}
export interface ChatSessionRecord {
  readonly id: string;
  readonly topicId: string;
  readonly subquestionId?: string;
  readonly scope: ObjectRef[];
  readonly messages: ChatMessage[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LocusState {
  readonly version: number;
  readonly topics: TopicRecord[];
  readonly subquestions: SubquestionRecord[];
  readonly assets: AssetRecord[];
  readonly papers: PaperEntry[];
  readonly attachments: PaperAttachment[];
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
  readonly analysisTasks: AnalysisTaskRecord[];
  readonly analysisResults: AnalysisResultRecord[];
  readonly reports: PreliminaryReportRecord[];
  readonly chats: ChatSessionRecord[];
}

export const STATE_VERSION = 8;

export function emptyState(): LocusState {
  return { version: STATE_VERSION, topics: [], subquestions: [], assets: [], papers: [], attachments: [], cards: [], tables: [], adoptions: [], mappings: [], comparisons: [], protocols: [], templates: [], executions: [], samples: [], measurements: [], impacts: [], ocrs: [], analysisTasks: [], analysisResults: [], reports: [], chats: [] };
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
  /** 宽容加载：损坏/未知版本时返回空（旧行为），供日常启动。 */
  async load(): Promise<LocusState> {
    try { return await this.loadStrict(); } catch { return emptyState(); }
  }
  /** 严格加载：损坏/未知版本**显式报错**（不静默成空），供隔离恢复与完整性检查。 */
  async loadStrict(): Promise<LocusState> {
    if (!existsSync(this.#path)) throw new Error(`数据文件不存在：${this.#path}`);
    let p: Partial<LocusState> & { version?: number };
    try {
      p = JSON.parse(readFileSync(this.#path, "utf8")) as Partial<LocusState> & { version?: number };
    } catch {
      throw new Error("数据文件损坏：JSON 解析失败（不静默清空）。");
    }
    const v = p.version ?? 0;
    if (v !== 2 && v !== 3 && v !== 4 && v !== 5 && v !== 6 && v !== 7 && v !== STATE_VERSION) {
      throw new Error(`未知数据版本 v${v}（不静默清空）。`);
    }
    {
      // v2–v7 → v8：保留既有数据，补空新实体。
      // 原件 hash **不再加载重算**（5C）：历史 hash 原样保留；查重指纹另存（旧记录指纹=既有 hash 口径）。
      const assets = (p.assets ?? []).map((a) => ({ ...a, fingerprint: a.fingerprint ?? a.hash }));
      // 存量文献原件 → 论文条目 + 正文附件（题录未提供处留空，不补造）；已有附件的原件不重复建。
      const papers: PaperEntry[] = [...(p.papers ?? [])];
      const attachments: PaperAttachment[] = [...(p.attachments ?? [])];
      const at = new Date().toISOString();
      for (const a of assets) {
        if (a.kind !== "literature" || attachments.some((x) => x.assetId === a.id)) continue;
        const paper: PaperEntry = {
          id: `paper_${randomUUID()}`, title: a.name, authors: [], year: "", doi: "",
          source: "由存量文献原件迁移建立（题录未提供）", license: "",
          topicIds: a.topicId ? [a.topicId] : [], note: "", revision: 1, history: [], createdAt: a.createdAt, updatedAt: at,
        };
        papers.push(paper);
        attachments.push({ id: `att_${randomUUID()}`, paperId: paper.id, assetId: a.id, role: "fulltext", version: "", createdAt: at });
      }
      const paperOfAsset = new Map(attachments.map((x) => [x.assetId, x.paperId]));
      return {
        version: STATE_VERSION,
        topics: p.topics ?? [],
        subquestions: p.subquestions ?? [],
        assets,
        papers,
        attachments,
        cards: (p.cards ?? []).map((c) => ({
          ...c,
          extracted: c.extracted ?? { fields: {}, units: [], conditions: [] },
          unknowns: c.unknowns ?? [],
          secondaryCitation: c.secondaryCitation ?? false,
          // 机械草稿明确标记（5C）；旧卡补论文关联（经附件）。
          mechanical: c.mechanical ?? c.extraction === "draft",
          paperId: c.paperId ?? paperOfAsset.get(c.assetId),
        })),
        tables: p.tables ?? [],
        adoptions: p.adoptions ?? [],
        mappings: p.mappings ?? [],
        comparisons: p.comparisons ?? [],
        protocols: p.protocols ?? [],
        templates: p.templates ?? [],
        executions: (p.executions ?? []).map((e) => ({ ...e, phase: e.phase ?? "recording", preparation: e.preparation ?? null })),
        samples: p.samples ?? [],
        measurements: p.measurements ?? [],
        impacts: p.impacts ?? [],
        ocrs: p.ocrs ?? [],
        analysisTasks: p.analysisTasks ?? [],
        analysisResults: p.analysisResults ?? [],
        // v7 报告四类 sections → v8 有序块（性质映射；旧来源文字记为 note 引用；顺序按类别展开）。确定性、幂等。
        reports: (p.reports ?? []).map((r) => {
          const rep = r as Partial<PreliminaryReportRecord> & { sections?: Record<string, { text: string; sources?: string[] }[]> };
          if (Array.isArray(rep.blocks)) return rep as PreliminaryReportRecord;
          const secMap: [string, ReportBlockNature][] = [
            ["observations", "observation"], ["hypotheses", "hypothesis"],
            ["interpretations", "interpretation"], ["toVerify", "to_verify"],
          ];
          const blocks: ReportBlock[] = [];
          for (const [key, nature] of secMap) {
            for (const it of rep.sections?.[key] ?? []) {
              blocks.push({
                id: `${rep.id}#b${blocks.length}`, order: blocks.length, nature,
                text: it.text ?? "", draft: false, history: [],
                refs: (it.sources ?? []).map((s) => ({ kind: "note" as const, id: "", version: "", label: s })),
              });
            }
          }
          return { ...(rep as PreliminaryReportRecord), blocks };
        }),
        chats: p.chats ?? [],
      };
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
