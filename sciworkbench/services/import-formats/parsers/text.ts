/**
 * M 导入路 · 正文文本解析（MD / TXT）。
 * 完整读取文本（不截断），按**物理行号**切稳定块（1 基，空行作块分隔）。
 * 这不是 CSV；不做行列拆分。
 */
import type { ParseResult, ParseOptions, TextBlock, Diagnostic } from "../contracts.ts";
import { PARSER_VERSIONS } from "../contracts.ts";
import { DEFAULT_OUTPUT_MAX_CHARS } from "../limits.ts";
import { decodeText, sha256Hex, ImportError } from "../util.ts";
import { envelope } from "../envelope.ts";

export function parseText(
  bytes: Uint8Array,
  fileName: string,
  format: "markdown" | "text",
  options: ParseOptions = {},
  sourceId: string | null = null,
): ParseResult {
  const { text, encoding, warning } = decodeText(bytes);
  const warnings: Diagnostic[] = [];
  if (warning) warnings.push({ code: "encoding_unconfirmed", message: warning });
  warnings.push({ code: "encoding_used", message: `读取编码：${encoding}。` });

  const chars = text.length;
  const maxChars = options.outputMaxChars ?? DEFAULT_OUTPUT_MAX_CHARS;
  if (chars > maxChars) {
    throw new ImportError("output_too_large", `文本 ${chars} 字符超过上限 ${maxChars}，已拒绝（不截断）。`);
  }

  const lines = text.split(/\r?\n/);
  const textBlocks: TextBlock[] = [];
  let order = 0;
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === "") {
      i++;
      continue;
    }
    const start = i;
    while (i < lines.length && lines[i].trim() !== "") i++;
    const group = lines.slice(start, i);
    textBlocks.push({
      id: `tb${order}`,
      orderIndex: order++,
      origin: { kind: "text-lines", lineStart: start + 1, lineEnd: i },
      text: group.join("\n"),
      lines: group,
    });
  }

  const hasContent = textBlocks.length > 0;
  const parser = format === "markdown" ? { name: "markdown", version: PARSER_VERSIONS.markdown } : { name: "text", version: PARSER_VERSIONS.text };

  return envelope({
    sourceId,
    originalHash: sha256Hex(bytes),
    byteLength: bytes.length,
    fileName,
    format,
    parser,
    options,
    status: hasContent ? "ok" : "failed",
    warnings,
    unknowns: hasContent ? [] : [{ code: "no_extractable_text", message: "文件无可提取文本（空文件或全为空白），不作为成功。" }],
    textBlocks,
  });
}
