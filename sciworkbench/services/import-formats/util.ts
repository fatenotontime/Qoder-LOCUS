/**
 * M 导入路 · 局部工具：哈希、编码、A1 坐标、压缩展开量。
 * 不含业务语义，不依赖 store.ts / app.ts（只读复用，不复制其拆块逻辑）。
 */
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";

/** 原始字节的 sha256（**原始 bytes**，不是提取文本/base64/规范化文本）。 */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 派生内容的 sha256（对规范化后的派生串计算，与原件 hash 分列）。 */
export function sha256Text(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export class ImportError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// ── 文本编码 ────────────────────────────────────────────────

export type TextEncoding = "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be" | "latin1-fallback";

export interface DecodedText {
  readonly text: string;
  readonly encoding: TextEncoding;
  /** 读取时的实际问题（如“非 UTF-8，按 latin1 兜底，编码未确认”）。 */
  readonly warning: string | null;
}

/** 读取文本：识别 BOM；无 BOM 时严格试 UTF-8，失败则 latin1 兜底并给出原因。 */
export function decodeText(bytes: Uint8Array): DecodedText {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "utf-8-bom", warning: null };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)), encoding: "utf-16le", warning: null };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)), encoding: "utf-16be", warning: null };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8", warning: null };
  } catch {
    return {
      text: new TextDecoder("latin1").decode(bytes),
      encoding: "latin1-fallback",
      warning: "非 UTF-8 且无 BOM，按 latin1 兜底读取，编码未能确认。",
    };
  }
}

// ── A1 坐标（1 基对外）──────────────────────────────────────

/** 0 基列号 → 字母（0→A, 25→Z, 26→AA）。 */
export function colNumberToLetter(col0: number): string {
  let n = col0 + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 1 基行列号 → A1（row1=1, col1=1 → "A1"）。 */
export function toA1(row1: number, col1: number): string {
  return `${colNumberToLetter(col1 - 1)}${row1}`;
}

// ── 压缩展开量预扫描 ────────────────────────────────────────

/** 列出 zip 内条目名（不解压内容）。返回 null 表示不是 zip。 */
export function zipEntryNames(bytes: Uint8Array): string[] | null {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return null;
  try {
    const names: string[] = [];
    unzipSync(bytes, {
      filter: (f) => {
        names.push(f.name);
        return false; // 只取目录，不 inflate
      },
    });
    return names;
  } catch {
    return null;
  }
}

/**
 * 压缩文档展开量（各条目 originalSize 之和），**不解压内容**，用于 zip 炸弹预检。
 * 无法判定时返回 null（由调用方按输出上限兜底）。
 */
export function zipExpandSize(bytes: Uint8Array): number | null {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return null;
  try {
    let total = 0;
    unzipSync(bytes, {
      filter: (f) => {
        total += f.originalSize ?? 0;
        return false;
      },
    });
    return total;
  } catch {
    return null;
  }
}
