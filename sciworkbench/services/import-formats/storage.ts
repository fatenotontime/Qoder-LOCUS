/**
 * M 导入路 · 原件存取（M0）。
 *
 * 只保存**原件字节**与本模块必要的元数据；不建课题/知识/审核库，不伪造 AssetRecord。
 * - 原件 hash 按**原始字节**计算（不以提取文本/base64/规范化文本代替）。
 * - 内部标识由模块生成（= orig_<sha256(原始字节)>），文件名只作元数据，不拼进路径。
 * - 同字节重导 → 同一标识，稳定复用；同名不同内容 → 不同标识，不覆盖旧原件。
 * - 落盘存放，**重建存取实例后仍可取回**（不只在内存 Map）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { ImportError, sha256Hex } from "./util.ts";
import { DEFAULT_ORIGINAL_MAX_BYTES } from "./limits.ts";

export interface SavedOriginal {
  readonly id: string;
  /** 原始字节 sha256。 */
  readonly hash: string;
  readonly byteLength: number;
  readonly fileName: string;
  readonly mediaTypeGuess: string;
  readonly createdAt: string;
}

const ID_RE = /^orig_[0-9a-f]{64}$/;

const MEDIA_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".text": "text/plain",
};

export function mediaTypeFor(fileName: string): string {
  return MEDIA_TYPES[extname(fileName).toLowerCase()] ?? "application/octet-stream";
}

export class OriginalStore {
  readonly root: string;
  constructor(root: string) {
    this.root = root;
    mkdirSync(root, { recursive: true });
  }

  /** 由原始字节推出的稳定标识（不落盘）。 */
  idFor(bytes: Uint8Array): string {
    return `orig_${sha256Hex(bytes)}`;
  }

  private binPath(id: string): string {
    return join(this.root, `${id}.bin`);
  }
  private metaPath(id: string): string {
    return join(this.root, `${id}.json`);
  }

  /**
   * 保存原件。同字节 → 复用既有标识（稳定去重）；同名不同内容 → 各自独立，不覆盖。
   * 超限（默认 2 MiB，可显式覆盖）→ 明确失败，不截断。
   */
  save(bytes: Uint8Array, fileName: string, opts: { maxBytes?: number } = {}): SavedOriginal {
    const max = opts.maxBytes ?? DEFAULT_ORIGINAL_MAX_BYTES;
    if (bytes.length > max) {
      throw new ImportError("original_too_large", `原件 ${bytes.length} 字节超过上限 ${max} 字节，已拒绝（不截断）。`);
    }
    const hash = sha256Hex(bytes);
    const id = `orig_${hash}`;
    const bin = this.binPath(id);
    const meta = this.metaPath(id);
    if (existsSync(bin) && existsSync(meta)) {
      return JSON.parse(readFileSync(meta, "utf8")) as SavedOriginal; // 同字节复用，保留首次元数据
    }
    const record: SavedOriginal = {
      id,
      hash,
      byteLength: bytes.length,
      fileName: fileName.trim() || "未命名",
      mediaTypeGuess: mediaTypeFor(fileName),
      createdAt: new Date().toISOString(),
    };
    writeFileSync(bin, bytes);
    writeFileSync(meta, JSON.stringify(record, null, 2), "utf8");
    return record;
  }

  has(id: string): boolean {
    return ID_RE.test(id) && existsSync(this.binPath(id)) && existsSync(this.metaPath(id));
  }

  meta(id: string): SavedOriginal {
    if (!ID_RE.test(id)) throw new ImportError("bad_original_id", `非法原件标识：${id}`);
    const meta = this.metaPath(id);
    if (!existsSync(meta)) throw new ImportError("original_not_found", `原件不存在：${id}`);
    return JSON.parse(readFileSync(meta, "utf8")) as SavedOriginal;
  }

  /** 按标识取回原件字节；校验字节与标识内 hash 一致。 */
  retrieve(id: string): Uint8Array {
    if (!ID_RE.test(id)) throw new ImportError("bad_original_id", `非法原件标识：${id}`);
    const bin = this.binPath(id);
    if (!existsSync(bin)) throw new ImportError("original_not_found", `原件不存在：${id}`);
    const bytes = new Uint8Array(readFileSync(bin));
    const expected = id.slice("orig_".length);
    if (sha256Hex(bytes) !== expected) throw new ImportError("original_corrupt", `原件字节与标识不符（疑似损坏）：${id}`);
    return bytes;
  }
}
