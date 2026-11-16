/**
 * 可替换存储层。
 * 现在：JsonFileStore（本地文件）/ MemoryStore（测试）。
 * 将来：Sites DB / 对象存储（只需实现同一 Store 接口）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";

/** 一条原始素材（导入的文献摘录或实验数据文件）。 */
export interface AssetRecord {
  readonly id: string;
  readonly kind: "literature" | "measurement";
  readonly name: string;
  readonly bytes: number;
  readonly hash: string;
  /** 原始文本内容（用于**原件回查**；有大小上限）。 */
  readonly text: string;
  readonly createdAt: string;
}

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
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 实验数据测量项（逐字段核对）。 */
export interface MeasurementRecord {
  readonly id: string;
  readonly assetId: string;
  /** 源定位：原文件行号 + 列名（用于原件回查）。 */
  readonly source: { readonly fileName: string; readonly rowIndex: number; readonly column: string };
  readonly value: string;
  readonly unit: string;
  readonly decision: "unreviewed" | "confirm" | "need_info";
  readonly note: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LocusState {
  readonly version: number;
  readonly assets: AssetRecord[];
  readonly cards: LitCardRecord[];
  readonly measurements: MeasurementRecord[];
}

export function emptyState(): LocusState {
  return { version: 1, assets: [], cards: [], measurements: [] };
}

export interface Store {
  load(): Promise<LocusState>;
  save(state: LocusState): Promise<void>;
}

/** 内存实现：测试与无盘运行用。 */
export class MemoryStore implements Store {
  #state: LocusState = emptyState();
  async load(): Promise<LocusState> {
    return structuredClone(this.#state);
  }
  async save(state: LocusState): Promise<void> {
    this.#state = structuredClone(state);
  }
}

/** 本地 JSON 文件实现：原子写（写临时文件再 rename）。 */
export class JsonFileStore implements Store {
  readonly #path: string;
  constructor(path: string) {
    this.#path = path;
  }
  async load(): Promise<LocusState> {
    if (!existsSync(this.#path)) return emptyState();
    try {
      const parsed = JSON.parse(readFileSync(this.#path, "utf8")) as LocusState;
      return { version: parsed.version ?? 1, assets: parsed.assets ?? [], cards: parsed.cards ?? [], measurements: parsed.measurements ?? [] };
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
