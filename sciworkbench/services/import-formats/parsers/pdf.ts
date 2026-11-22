/**
 * M 导入路 · PDF 正文解析（M1）。
 * 仅处理**文本型** PDF：按页保留正文与 1 基页码，逐页 Unicode 读取。
 * 无文字页 → 需 OCR；混合页 → 部分可读并明确列出待处理页。不做 OCR、不还原版面。
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { ParseResult, ParseOptions, TextBlock, Diagnostic } from "../contracts.ts";
import { PARSER_VERSIONS } from "../contracts.ts";
import { DEFAULT_OUTPUT_MAX_CHARS, DEFAULT_MAX_PDF_PAGES } from "../limits.ts";
import { sha256Hex, ImportError } from "../util.ts";
import { envelope } from "../envelope.ts";

const require = createRequire(import.meta.url);
const STANDARD_FONTS_DIR = join(dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + "/";

function joinPageItems(items: readonly { str?: string; hasEOL?: boolean }[]): { text: string; lines: string[] } {
  const lines: string[] = [];
  let cur = "";
  for (const it of items) {
    const s = typeof it.str === "string" ? it.str : "";
    cur += s;
    if (it.hasEOL) {
      lines.push(cur);
      cur = "";
    }
  }
  if (cur !== "") lines.push(cur);
  return { text: lines.join("\n"), lines };
}

export async function parsePdf(
  bytes: Uint8Array,
  fileName: string,
  options: ParseOptions = {},
  sourceId: string | null = null,
): Promise<ParseResult> {
  const warnings: Diagnostic[] = [];
  const unknowns: Diagnostic[] = [];
  let doc: pdfjs.PDFDocumentProxy;
  try {
    // 传副本，避免 pdfjs 分离调用方缓冲区
    const task = pdfjs.getDocument({
      data: bytes.slice(),
      standardFontDataUrl: STANDARD_FONTS_DIR,
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
    });
    doc = await task.promise;
  } catch (e) {
    return envelope({
      sourceId,
      originalHash: sha256Hex(bytes),
      byteLength: bytes.length,
      fileName,
      format: "pdf",
      parser: { name: "pdf", version: PARSER_VERSIONS.pdf },
      options,
      status: "failed",
      unknowns: [{ code: "pdf_unreadable", message: `PDF 无法读取（疑似损坏或非 PDF）：${(e as Error).message}` }],
    });
  }

  const maxPages = DEFAULT_MAX_PDF_PAGES;
  if (doc.numPages > maxPages) {
    throw new ImportError("pdf_too_many_pages", `PDF 共 ${doc.numPages} 页，超过上限 ${maxPages} 页，已拒绝。`);
  }

  const maxChars = options.outputMaxChars ?? DEFAULT_OUTPUT_MAX_CHARS;
  const textBlocks: TextBlock[] = [];
  const pagesWithoutText: number[] = [];
  let order = 0;
  let totalChars = 0;

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const { text, lines } = joinPageItems(content.items as never);
    totalChars += text.length;
    if (totalChars > maxChars) {
      throw new ImportError("output_too_large", `PDF 提取文本超过上限 ${maxChars} 字符，已拒绝（不截断）。`);
    }
    if (text.trim() === "") {
      pagesWithoutText.push(p);
      continue;
    }
    textBlocks.push({
      id: `tb${order}`,
      orderIndex: order++,
      origin: { kind: "pdf-page", page: p },
      text,
      lines,
    });
  }

  const readable = doc.numPages - pagesWithoutText.length;
  const status = readable === 0 ? "needs_ocr" : pagesWithoutText.length > 0 ? "partial" : "ok";

  if (pagesWithoutText.length > 0) {
    const kind = readable === 0 ? "needs_ocr" : "pages_need_ocr";
    unknowns.push({
      code: kind,
      message: `以下页码无可提取文字，需 OCR 或人工处理（未自动 OCR）：${pagesWithoutText.join("、")}。`,
    });
  }
  warnings.push({ code: "pdf_reading_order_limited", message: "PDF 文本按内容流顺序提取；多栏/复杂版面的阅读顺序可能与视觉顺序不同。" });

  return envelope({
    sourceId,
    originalHash: sha256Hex(bytes),
    byteLength: bytes.length,
    fileName,
    format: "pdf",
    parser: { name: "pdf", version: PARSER_VERSIONS.pdf },
    options,
    status,
    warnings,
    unknowns,
    textBlocks,
  });
}
