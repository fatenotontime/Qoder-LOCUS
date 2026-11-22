/**
 * M 导入路 · DOCX 正文解析（M1）。
 * 用 mammoth 转 HTML，再按**文档顺序**还原「段落—表格—段落」交错结构；
 * 段落/表格/单元格位置为**文档内序号**（0 基），不冒充原文页码。
 * 复杂对象（图片/文本框等）只警告，不杜撰正文。
 */
import mammoth from "mammoth";
import { parse as parseHtml, type HTMLElement, type Node } from "node-html-parser";
import type { ParseResult, ParseOptions, TextBlock, GridTable, RawCell, Diagnostic } from "../contracts.ts";
import { PARSER_VERSIONS } from "../contracts.ts";
import { DEFAULT_OUTPUT_MAX_CELLS, DEFAULT_OUTPUT_MAX_CHARS } from "../limits.ts";
import { sha256Hex, ImportError } from "../util.ts";
import { envelope } from "../envelope.ts";

function cellsOfRow(tr: HTMLElement): HTMLElement[] {
  return tr.childNodes.filter(
    (n: Node): n is HTMLElement =>
      n.nodeType === 1 && ["td", "th"].includes((n as HTMLElement).rawTagName?.toLowerCase?.() ?? ""),
  );
}

export async function parseDocx(
  bytes: Uint8Array,
  fileName: string,
  options: ParseOptions = {},
  sourceId: string | null = null,
): Promise<ParseResult> {
  const warnings: Diagnostic[] = [];
  const unknowns: Diagnostic[] = [];
  const maxChars = options.outputMaxChars ?? DEFAULT_OUTPUT_MAX_CHARS;
  const maxCells = options.outputMaxCells ?? DEFAULT_OUTPUT_MAX_CELLS;

  let html: string;
  let messages: { type: string; message: string }[] = [];
  try {
    const out = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
    html = out.value;
    messages = out.messages as never;
  } catch (e) {
    return envelope({
      sourceId,
      originalHash: sha256Hex(bytes),
      byteLength: bytes.length,
      fileName,
      format: "docx",
      parser: { name: "docx", version: PARSER_VERSIONS.docx },
      options,
      status: "failed",
      unknowns: [{ code: "docx_unreadable", message: `DOCX 无法读取（疑似损坏或非 DOCX）：${(e as Error).message}` }],
    });
  }
  for (const m of messages) {
    const diag: Diagnostic = { code: "docx_message", message: m.message };
    if (m.type === "error") unknowns.push(diag);
    else warnings.push(diag);
  }

  const root = parseHtml(html);
  const textBlocks: TextBlock[] = [];
  const tables: GridTable[] = [];
  let order = 0;
  let paragraphCount = 0;
  let tableCount = 0;
  let totalChars = 0;
  let totalCells = 0;

  for (const node of root.childNodes) {
    if (node.nodeType !== 1) continue;
    const el = node as HTMLElement;
    const tag = (el.rawTagName ?? "").toLowerCase();

    if (tag === "table") {
      const rowsEls = el.querySelectorAll("tr");
      const rows: string[][] = [];
      const raw: RawCell[][] = [];
      for (const tr of rowsEls) {
        const cells = cellsOfRow(tr as HTMLElement);
        const rowText: string[] = [];
        const rowRaw: RawCell[] = [];
        for (const cell of cells) {
          const t = cell.text.trim();
          rowText.push(t);
          rowRaw.push({ value: t === "" ? null : t, type: t === "" ? "empty" : "string" });
        }
        rows.push(rowText);
        raw.push(rowRaw);
      }
      totalCells += rows.reduce((n, r) => n + r.length, 0);
      if (totalCells > maxCells) {
        throw new ImportError("output_too_large", `DOCX 表格单元格超过上限 ${maxCells}，已拒绝（不截断）。`);
      }
      const too = el.querySelector("table");
      tables.push({
        id: `tbl${tableCount}`,
        orderIndex: order++,
        origin: { kind: "docx-table", blockIndex: order - 1, tableIndex: tableCount },
        name: null,
        rows,
        raw,
        gridOrigin: { kind: "docx-table", tableIndex: tableCount },
        notes: too ? ["检测到嵌套表格：仅保留外层单元格文本，内层结构未展开。"] : [],
      });
      tableCount++;
      continue;
    }

    // 段落及标题/列表等一律按文本块处理（保留文档顺序）
    const text = el.text.trim();
    if (text === "") {
      // 空段落：仅计数占位（保持块序号稳定，不产出空文本块）
      paragraphCount++;
      continue;
    }
    totalChars += text.length;
    if (totalChars > maxChars) {
      throw new ImportError("output_too_large", `DOCX 提取文本超过上限 ${maxChars} 字符，已拒绝（不截断）。`);
    }
    textBlocks.push({
      id: `tb${order}`,
      orderIndex: order++,
      origin: { kind: "docx-paragraph", blockIndex: order - 1, paragraphIndex: paragraphCount },
      text,
    });
    paragraphCount++;
  }

  warnings.push({ code: "docx_no_page_numbers", message: "DOCX 不含固定分页信息；块位置为文档内序号，非原文页码。" });

  const hasContent = textBlocks.length > 0 || tables.length > 0;
  return envelope({
    sourceId,
    originalHash: sha256Hex(bytes),
    byteLength: bytes.length,
    fileName,
    format: "docx",
    parser: { name: "docx", version: PARSER_VERSIONS.docx },
    options,
    status: hasContent ? "ok" : "failed",
    warnings,
    unknowns: hasContent ? unknowns : [...unknowns, { code: "no_extractable_text", message: "DOCX 无可提取正文，不作为成功。" }],
    textBlocks,
    tables,
  });
}