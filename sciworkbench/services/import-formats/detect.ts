/**
 * M 导入路 · 格式识别。
 * 二进制格式以**内容魔数**为准；扩展名只作校验：
 * - 扩展名声称 pdf/docx/xlsx 但内容不符 → unsupported（mismatch），明确失败。
 * - 扩展名未知/缺失时，允许内容魔数获胜。
 * 文本类无魔数，按扩展名 + 分隔符嗅探判定 csv/tsv/markdown/text。
 */
import { extname } from "node:path";
import type { DetectedFormat } from "./contracts.ts";
import { zipEntryNames } from "./util.ts";

export interface Detection {
  readonly format: DetectedFormat;
  /** 扩展名与内容不符。 */
  readonly mismatch: boolean;
  readonly message: string | null;
}

const BINARY_EXT: Record<string, "pdf" | "docx" | "xlsx"> = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".xlsx": "xlsx",
};

const TEXT_EXT = new Set([".csv", ".tsv", ".md", ".markdown", ".txt", ".text", ""]);

function magicFormat(bytes: Uint8Array): "pdf" | "docx" | "xlsx" | "zip-other" | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return "pdf";
  }
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    const names = zipEntryNames(bytes);
    if (names && names.includes("word/document.xml")) return "docx";
    if (names && names.includes("xl/workbook.xml")) return "xlsx";
    return "zip-other";
  }
  return null;
}

/** 判定文本类 suspect 为 csv / tsv / markdown / text。 */
function textFormat(ext: string, bytes: Uint8Array): DetectedFormat {
  if (ext === ".md" || ext === ".markdown") return "markdown";
  if (ext === ".tsv") return "tsv";
  if (ext === ".csv") return "csv";
  // .txt / .text / 无扩展名：嗅探首个非空行是否含分隔符
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
  const first = head.split(/\r?\n/).find((l) => l.trim() !== "");
  if (first) {
    if (first.includes("\t")) return "tsv";
    if (first.includes(",")) return "csv";
  }
  return "text";
}

function hasNul(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0) return true;
  return false;
}

export function detectFormat(fileName: string, bytes: Uint8Array): Detection {
  const ext = extname(fileName).toLowerCase();
  const magic = magicFormat(bytes);
  const claimed = BINARY_EXT[ext];

  if (claimed) {
    if (magic === claimed) return { format: claimed, mismatch: false, message: null };
    return {
      format: "unsupported",
      mismatch: true,
      message: `扩展名声称 ${claimed}，但内容不是 ${claimed}（扩展名与内容不符）。`,
    };
  }

  if (magic === "pdf" || magic === "docx" || magic === "xlsx") {
    return { format: magic, mismatch: false, message: null };
  }
  if (magic === "zip-other") {
    return { format: "unsupported", mismatch: false, message: "是 zip 包，但既非 DOCX 也非 XLSX，暂不支持。" };
  }

  if (TEXT_EXT.has(ext)) {
    if (hasNul(bytes)) {
      return { format: "unsupported", mismatch: true, message: "扩展名是文本类，但内容含二进制字节（NUL），扩展名与内容不符。" };
    }
    return { format: textFormat(ext, bytes), mismatch: false, message: null };
  }

  return { format: "unsupported", mismatch: false, message: `不支持的扩展名：${ext || "（无）"}。` };
}
