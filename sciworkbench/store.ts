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
  readonly kind: "literature" | "measurement";
  readonly name: string;
  readonly topicId?: string;
  readonly bytes: number;
  readonly hash: string;
  readonly text: string;
  readonly createdAt: string;
}

export type Extraction = "draft" | "ai";

/** 文献证据卡。 */
export interface LitCardRecord {
  readonly id: string;
  readonly assetId: string;
  readonly rawText: string;
  readonly locator: { readonly sectionQuote: string };
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
}

export const STATE_VERSION = 3;

export function emptyState(): LocusState {
  return { version: STATE_VERSION, topics: [], subquestions: [], assets: [], cards: [], tables: [] };
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
      if (v !== 2 && v !== STATE_VERSION) return emptyState();
      // v2 → v3：保留既有数据，补空 topics/subquestions（不丢用户数据）
      // hash 统一为逻辑内容口径（旧记录按 canonical 重算，保持跨路径拒重一致）
      return {
        version: STATE_VERSION,
        topics: p.topics ?? [],
        subquestions: p.subquestions ?? [],
        assets: (p.assets ?? []).map((a) => ({ ...a, hash: contentHash(a.text) })),
        cards: p.cards ?? [],
        tables: p.tables ?? [],
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
