/**
 * LOCUS 领域实体（阶段2 骨架）。
 * 契约：稳定 id + 追加式 revision；引用固定 revision，不指向 latest。
 * 见 docs/architecture/01_DOMAIN_SCHEMA.md
 */

export type Rev = number;

/** 指向某实体某个固定 revision 的引用。 */
export interface Ref<K extends EntityKind = EntityKind> {
  readonly kind: K;
  readonly id: string;
  readonly revision: Rev;
}

export type EntityKind =
  | "Topic"
  | "Subquestion"
  | "SourceAsset"
  | "EvidenceCard"
  | "TopicEvidence"
  | "EvidenceAdoption"
  | "NameMapping"
  | "Comparison"
  | "ProtocolRevision"
  | "RecordTemplateRevision"
  | "Execution"
  | "Session"
  | "Sample"
  | "SampleState"
  | "Measurement"
  | "ContextSnapshot"
  | "AnalysisTask"
  | "Run"
  | "ResultRevision"
  | "ReportBlock"
  | "DependencyEdge"
  | "ChangeSet"
  | "ImpactAssessment"
  | "ExportSnapshot";

export type Operator = string;
export type SourceKind = "author" | "user" | "reproduced" | "ai" | "external";

export interface EntityBase {
  readonly id: string;
  readonly revision: Rev;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly operator: Operator;
  readonly source: SourceKind;
  readonly status: string;
}

/** 复核状态与任务状态分离：succeeded ≠ confirmed。 */
export type ReviewStatus = "draft" | "reviewed" | "adopted" | "excluded" | "withdrawn";
export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface SourceAsset extends EntityBase {
  readonly fileHash: string;
  readonly mime: string;
  readonly bytes: number;
  readonly originUrl?: string;
  readonly version?: string;
  readonly license?: string;
  readonly scope?: string;
  readonly privatePath?: string;
  readonly parseStatus: "unknown" | "pending" | "ok" | "failed";
}

export interface EvidenceCard extends EntityBase {
  readonly sourceRef: Ref<"SourceAsset">;
  readonly locator: Locator;
  readonly rawText: string;
  readonly extracted: { fields: Record<string, string>; conditions?: string[]; units?: string[] };
  readonly unknowns: string[];
  readonly reviewStatus: ReviewStatus;
}

/** 来源定位（LIT06）：不强制唯一定位或精确坐标。 */
export interface Locator {
  readonly assetId: string;
  readonly revision: Rev;
  readonly kind?: "pdf" | "web" | "data";
  readonly page?: number;
  readonly region?: string;
  readonly sectionQuote?: string;
  readonly table?: { tableNo: string; row?: number; col?: number };
  readonly figureCaption?: string;
  readonly sheetName?: string;
  readonly cellRange?: string;
  readonly fieldPath?: string;
}

export interface ProtocolRevision extends EntityBase {
  readonly purpose: string;
  readonly inputs: string[];
  readonly operations: string[];
  readonly conditions: string[];
  readonly criteria?: string;
  readonly unknowns: string[];
  readonly reconstructed?: boolean;
}

export interface Execution extends EntityBase {
  readonly protocolRef: Ref<"ProtocolRevision">;
  readonly sessionIds: string[];
  readonly paused?: boolean;
}

export interface SampleState extends EntityBase {
  readonly sampleId: string;
  readonly amount?: { value: number; unit: string; estimated: boolean };
  readonly handling?: string;
  readonly note?: string;
}

export interface Measurement extends EntityBase {
  readonly sampleStateRef: Ref<"SampleState">;
  readonly sourceFileRef?: Ref<"SourceAsset">;
  readonly method?: string;
  readonly timeRecorded: string;
}

export interface ContextSnapshot extends EntityBase {
  readonly scopeRefs: readonly Ref[];
  readonly sentFragments: readonly string[];
  readonly purpose: string;
  readonly promptVersion: string;
  readonly snapshotHash: string;
}

export interface AnalysisTask extends EntityBase {
  readonly subquestionRef: Ref<"Subquestion">;
  readonly contextSnapshotRef: Ref<"ContextSnapshot">;
  readonly status: TaskStatus;
}

export interface Run extends EntityBase {
  readonly taskRef: Ref<"AnalysisTask">;
  readonly actualMethod?: string;
  readonly actualSoftware?: string;
  readonly softwareVersion?: string;
  readonly params?: Record<string, unknown>;
  readonly inputRefs: readonly Ref[];
  readonly outputRefs: readonly Ref[];
  readonly status: TaskStatus;
}

export interface ResultRevision extends EntityBase {
  readonly authorKind: "author" | "user" | "reproduced";
  readonly runRef?: Ref<"Run">;
  readonly verificationScope?: string;
  readonly pendingItems: string[];
}

export interface ReportBlock extends EntityBase {
  readonly order: number;
  readonly content: string;
  readonly explicitRefs: readonly Ref[];
  readonly contextList: readonly Ref[];
  readonly nature: "draft" | "assumption" | "human";
}
