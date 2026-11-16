/**
 * 可替换存储层 与 数据模型（v2）。
 * v2 变更：测量项改为**表格**模型；所有可编辑实体带**修订历史**。
 * 现在：JsonFileStore（本地文件）/ MemoryStore（测试）。将来：Sites DB（同一 Store 接口）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";

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
  readonly columnMeta: ColumnMeta[];
  readonly note: string;
  readonly revision: number;
  readonly history: RevisionEntry[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LocusState {
  readonly version: number;
  readonly assets: AssetRecord[];
  readonly cards: LitCardRecord[];
  readonly tables: MeasurementTableRecord[];
}

export const STATE_VERSION = 2;

export function emptyState(): LocusState {
  return { version: STATE_VERSION, assets: [], cards: [], tables: [] };
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
      const p = JSON.parse(readFileSync(this.#path, "utf8")) as Partial<LocusState>;
      if ((p.version ?? 0) !== STATE_VERSION) return emptyState(); // 旧结构不自动迁移
      return { version: STATE_VERSION, assets: p.assets ?? [], cards: p.cards ?? [], tables: p.tables ?? [] };
    } catch {
      return emptyState();
    }
  }
  async save(state: LocusState): Promise<void> {
    mkdirSync(dirname(this.#path), { recursive: true });
    const tmp = `${this.#path}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    renameSync(tmp, this.#path);
  }
}
