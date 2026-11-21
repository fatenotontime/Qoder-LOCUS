/**
 * E5 知识包导出（合同 §7.4）：由**同一个快照**统一产出 JSON / CSV / wiki / ZIP。
 *
 * - 一切事实、单位、性质、unknowns、引用 token 都取自快照内容（不重新读当前库）。
 * - CSV：一行一条明确观察；item 与 dataset 单元格二选一，另一组位置字段留空（不伪造 ID）；
 *   机器版保真（缺失值留空，绝不写 0），sheet-safe 版对公式样式做安全转义并在 manifest 标注。
 * - 包内链接为相对路径、文件名用 ID；默认不带附件；manifest 记录每文件 sha256/schema/许可/排除原因。
 * - 用户内容视为不可信文本：只输出受限 Markdown，禁 raw HTML 与 javascript: 协议。
 */
import { createHash } from "node:crypto";
import type { KnowledgeItem, KnowledgeSnapshot, SnapshotDatasetRows, ItemPayload, ComparisonPayload } from "../domain/knowledge.ts";
import { refKey } from "../domain/knowledge.ts";
import { zip, type ZipEntry } from "./export.ts";
import { AppError } from "./app.ts";
import { describeValue, describeReview, describeNature, describeContentType, describeUnknownReason } from "./knowledge-base.ts";

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const now = () => new Date().toISOString();

/** 文件名只允许 ID 字符（拒绝路径穿越与非法字符）。 */
export function safeFileName(name: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new AppError(422, `文件名含非法字符（只允许字母数字与 ._-）：${name.slice(0, 40)}`, { code: "unsafe_filename" });
  return name;
}

/** 包内相对路径：每段都必须是安全名，且不含 . / ..（拒绝路径穿越）。 */
export function safeRelPath(name: string): string {
  const parts = String(name).split("/");
  if (parts.length === 0) throw new AppError(422, "空路径。", { code: "unsafe_filename" });
  for (const seg of parts) {
    if (seg === "." || seg === ".." || seg === "") throw new AppError(422, `路径含穿越段或空段：${name.slice(0, 40)}`, { code: "unsafe_filename" });
    safeFileName(seg);
  }
  return name;
}

/** 不可信文本 → 受限 Markdown 片段：转义尖括号与反引号外露，阻断 raw HTML 与脚本协议。 */
export function safeText(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/javascript:/gi, "javascript：").replace(/data:text\/html/gi, "data:text／html");
}

const CSV_HEADER = ["operand_type", "item_id", "dataset_id", "revision", "row_index", "column_index", "context_id", "metric", "raw_value", "value_kind", "normalized_value", "unit", "source_token"] as const;
type CsvRow = string[];

function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 公式样式前缀（= + - @ 与制表/回车）在 sheet-safe 版前置单引号；纯数字不转义。 */
function sheetSafeCell(v: string): string {
  if (v === "") return v;
  const risky = /^[=+@]/.test(v) || /^[\t\r]/.test(v) || (/^-/.test(v) && !/^-?\d+(\.\d+)?$/.test(v));
  return risky ? `'${v}` : v;
}

function tokenOfRef(snapshot: KnowledgeSnapshot, key: string): string {
  for (const [token, entry] of Object.entries(snapshot.content.referenceMap)) {
    if (refKey(entry.ref as never) === key) return token;
  }
  return "";
}

function contextIdOfItem(snapshot: KnowledgeSnapshot, item: KnowledgeItem): string {
  const first = (item.payload as ItemPayload).contextRefs[0];
  return first ? first.id : "";
}

export interface CsvExport { readonly filename: string; readonly content: string; readonly rows: number; readonly sheetSafe: boolean }

/** 由快照生成比较 CSV（comparisonId）或数据集 CSV（datasetId）；缺失值留空，不写 0。 */
export function snapshotCsv(snapshot: KnowledgeSnapshot, opts: { datasetId?: string; comparisonId?: string; variant?: "machine" | "sheet-safe" }): CsvExport {
  const sheetSafe = opts.variant === "sheet-safe";
  if (!!opts.datasetId === !!opts.comparisonId) throw new AppError(422, "CSV 导出须在 datasetId 与 comparisonId 中二选一。", { code: "csv_target_required" });
  const rowsOut: CsvRow[] = [];
  let base = "observation";

  if (opts.comparisonId) {
    const cmp = snapshot.content.comparisons.find((c) => c.id === opts.comparisonId);
    if (!cmp) throw new AppError(404, `该快照内没有比较：${opts.comparisonId}`, { code: "comparison_not_in_snapshot" });
    const cp = cmp.payload as ComparisonPayload;
    base = `comparison_${safeFileName(opts.comparisonId)}`;
    cp.normalizedInputs.forEach((n) => {
      const op = n.operand;
      const raw = n.rawValue;
      const norm = n.normalizedValue;
      if (op.type === "item") {
        const item = snapshot.content.items.find((i) => i.id === op.ref.id);
        rowsOut.push(["item", op.ref.id, "", String(op.ref.revision), "", "", item ? contextIdOfItem(snapshot, item) : "", cp.metricId ?? "", raw ? raw.raw : "", raw ? raw.kind : "", norm && norm.kind === "scalar" ? norm.value ?? "" : "", raw && "unit" in raw ? (raw.unit ?? "") : "", tokenOfRef(snapshot, refKey(op.ref))]);
      } else {
        const rows = (snapshot.content.datasetRows ?? []).find((r) => r.datasetRef.id === op.datasetRef.id);
        const binding = rows?.rows.find((r) => r.rowIndex === op.rowIndex)?.binding ?? null;
        rowsOut.push(["cell", "", op.datasetRef.id, String(op.datasetRef.revision), String(op.rowIndex), String(op.columnIndex), binding?.contextRef?.id ?? "", cp.metricId ?? "", raw ? raw.raw : "", raw ? raw.kind : "", norm && norm.kind === "scalar" ? norm.value ?? "" : "", raw && "unit" in raw ? (raw.unit ?? "") : "", tokenOfRef(snapshot, refKey(op.datasetRef))]);
      }
    });
    const cv = cp.computedValue;
    if (cv) rowsOut.push(["result", "", "", "", "", "", "", cp.metricId ?? "", cv.raw, cv.kind, cv.kind === "scalar" ? cv.value ?? "" : "", "unit" in cv ? (cv.unit ?? "") : "", ""]);
  } else {
    const rows = (snapshot.content.datasetRows ?? []).find((r) => r.datasetRef.id === opts.datasetId);
    if (!rows) throw new AppError(404, `该快照内没有数据集：${opts.datasetId}`, { code: "dataset_not_in_snapshot" });
    base = `dataset_${safeFileName(opts.datasetId)}`;
    for (const r of rows.rows) {
      for (const cell of r.cells) {
        const col = rows.columns.find((c) => c.index === cell.columnIndex);
        rowsOut.push(["cell", "", opts.datasetId, String(rows.datasetRef.revision), String(r.rowIndex), String(cell.columnIndex), r.binding?.contextRef?.id ?? "", col ? (col.standardId ?? col.originalName) : "", cell.raw ?? "", col ? col.type : "", "", col ? (col.unit ?? "") : "", tokenOfRef(snapshot, refKey(rows.datasetRef))]);
      }
    }
  }
  const lines = [CSV_HEADER.join(",")];
  for (const r of rowsOut) lines.push(r.map((c) => csvCell(sheetSafe ? sheetSafeCell(c) : c)).join(","));
  return { filename: `${base}${sheetSafe ? ".sheet-safe" : ""}.csv`, content: lines.join("\n") + "\n", rows: rowsOut.length, sheetSafe };
}

/** 快照 → wiki 页面（固定页型；空态不编造；相对链接用 ID）。 */
export function snapshotWiki(snapshot: KnowledgeSnapshot): { pages: { file: string; title: string; markdown: string }[]; index: string } {
  const items = snapshot.content.items;
  const themes = snapshot.content.themes;
  const comparisons = snapshot.content.comparisons;
  const sc = snapshot.scope;
  const unconfirmedOrSum = items.filter((i) => (i.payload as ItemPayload).review.status !== "confirmed").length;

  const header = (title: string) => `# ${title}\n\n> 快照 \`${snapshot.snapshotId}\` · 内容 hash \`${snapshot.contentHash.slice(0, 16)}…\` · 模式 ${snapshot.mode === "formal" ? "正式" : "探索（含待审内容，不得当正式结论）"} · 课题 \`${safeText(sc.topicId)}\`${sc.subquestionId ? ` / 子问题 \`${safeText(sc.subquestionId)}\`` : ""}\n\n`;

  const itemLine = (i: KnowledgeItem) => {
    const p = i.payload as ItemPayload;
    const unknowns = p.unknowns.map((u) => `${safeText(u.fieldPath)}(${describeUnknownReason(u.reasonCode)})`).join("、") || "无";
    return `- **${safeText(p.text)}** — 性质 ${describeNature(p.nature)}（${describeContentType(p.contentType)}）· 审核 ${describeReview(p.review.status)} · 值 ${safeText(describeValue(p.value))} · 未知：${unknowns} · 版本 第 ${i.revision} 版`;
  };

  const index = header("知识包 · 首页") + [
    `- 知识项：${items.length}（其中未确认 ${unconfirmedOrSum} 条）`,
    `- 主题：${themes.length}`,
    `- 比较：${comparisons.length}`,
    `- 数据集：${(snapshot.content.datasets ?? []).length}`,
    `- 来源版本：${snapshot.sourceVersionRefs.length}（详见 ./04-sources.md）`,
    "",
    "## 页目录",
    "- [子问题](./01-subquestions.md)",
    "- [主题与当前认识](./02-themes.md)",
    "- [比较](./03-comparisons.md)",
    "- [来源与引用 token](./04-sources.md)",
    "- [缺口与未决](./05-gaps.md)",
    "",
  ].join("\n");

  const subquestions = header("子问题") + (sc.subquestionId
    ? items.filter((i) => (i.payload as ItemPayload).subquestionIds.includes(sc.subquestionId!)).map(itemLine).join("\n")
    : (items.length ? `（本快照未指定子问题：按课题范围列出知识项）\n\n${items.map(itemLine).join("\n")}` : "（本快照未指定子问题，且课题范围内没有知识项）")) + "\n";

  const themeBody = themes.length
    ? themes.map((t) => {
      const tp = t.payload as { name: string; definition: string; members: { id: string; revision: number }[]; currentJudgmentRefs: { id: string; revision: number }[] };
      const eff = tp.currentJudgmentRefs.filter((r) => {
        const env = items.find((i) => i.id === r.id && i.revision === r.revision);
        return !!env && (env.payload as ItemPayload).review.status === "confirmed";
      });
      const judgment = eff.length
        ? eff.map((r) => { const env = items.find((i) => i.id === r.id && i.revision === r.revision)!; return `  - ${safeText((env.payload as ItemPayload).text)}（第 ${r.revision} 版）`; }).join("\n")
        : "  （尚未形成综合判断）";
      return `## 主题：${safeText(tp.name)}\n\n${safeText(tp.definition)}\n\n**当前认识**：\n${judgment}\n\n**成员（${tp.members.length}）**：\n${tp.members.map((r) => `- ${r.id} 第 ${r.revision} 版`).join("\n") || "（无）"}`;
    }).join("\n\n")
    : "（本快照无主题：尚未建立主题）";

  const comparisonBody = comparisons.length
    ? comparisons.map((c) => {
      const cp = c.payload as ComparisonPayload;
      const decision = cp.decision === "computable" ? "可计算" : cp.decision === "display_only" ? "仅并列展示" : "已阻断";
      const result = cp.computedValue ? safeText(describeValue(cp.computedValue)) : "（无计算结果）";
      return `## 比较：${safeText(cp.question)}\n\n- 操作 ${cp.operation === "difference" ? "差值" : cp.operation === "ratio" ? "比值" : "并列"} · 决策 ${decision} · ${safeText(cp.formatting)}\n- 结果：${result}\n- 理由码：${cp.reasonCodes.map(safeText).join("、") || "（无）"}`;
    }).join("\n\n")
    : "（本快照无比较）";

  const sourceBody = header("来源与引用 token") + Object.entries(snapshot.content.referenceMap)
    .map(([token, e]) => `- \`${token}\` ${e.kind === "knowledge" ? "知识" : "来源"}：${safeText(e.label)} → \`${safeText(refKey(e.ref as never))}\``).join("\n") + "\n";

  const gaps = header("缺口与未决") + [
    `### 未知项`,
    ...items.flatMap((i) => (i.payload as ItemPayload).unknowns.map((u) => `- ${safeText((i.payload as ItemPayload).text.slice(0, 30))}：${safeText(u.fieldPath)} — ${safeText(u.detail)}（${describeUnknownReason(u.reasonCode)}）`)),
    ...(items.every((i) => (i.payload as ItemPayload).unknowns.length === 0) ? ["（无记录在案的未知项）"] : []),
    "",
    "### 未纳入本次快照（前 20 条）",
    ...snapshot.excluded.slice(0, 20).map((x) => `- ${safeText(refKey(x.ref as never))}：${safeText(x.reason)}`),
    ...(snapshot.excluded.length === 0 ? ["（无排除项）"] : []),
    "",
    `### 覆盖：选中 ${snapshot.coverage.selected} / 可用 ${snapshot.coverage.totalAvailable}（processed ${snapshot.coverage.processed}）`,
    ...snapshot.coverage.omittedReasons.map((r) => `- 省略原因：${safeText(r)}`),
    "",
  ].join("\n");

  const pages = [
    { file: "00-index.md", title: "首页", markdown: index },
    { file: "01-subquestions.md", title: "子问题", markdown: subquestions },
    { file: "02-themes.md", title: "主题", markdown: header("主题与当前认识") + themeBody + "\n" },
    { file: "03-comparisons.md", title: "比较", markdown: header("比较") + comparisonBody + "\n" },
    { file: "04-sources.md", title: "来源", markdown: sourceBody },
    { file: "05-gaps.md", title: "缺口", markdown: gaps },
  ].map((p) => ({ ...p, file: safeFileName(p.file) }));
  return { pages, index };
}

/** 机器 schema ＋ 数据字典（随包提供；不是通用对象平台）。 */
export function snapshotSchemaFiles(): { schema: string; dictionary: string } {
  const schema = JSON.stringify({
    schemaVersion: 1, projectionVersion: 1,
    snapshot: { snapshotId: "string", createdAt: "ISO", mode: "formal|explore", scope: { topicId: "string", subquestionId: "string?", source: "current" }, contentHash: "sha256", content: "SnapshotContent", coverage: "SnapshotCoverage", excluded: "[{ref,reason}]" },
    content: { items: "[KnowledgeItem]", contexts: "[KnowledgeContext]", evidence: "[KnowledgeEvidence]", relations: "[KnowledgeRelation]", datasets: "[KnowledgeDataset]", datasetRows: "[SnapshotDatasetRows?]", themes: "[KnowledgeTheme]", mappings: "[KnowledgeMapping]", comparisons: "[KnowledgeComparison]", referenceMap: "{token:{kind,ref,label}}" },
    knowledgeEnvelope: { id: "string", revision: "int", createdAt: "ISO", updatedAt: "ISO", payload: "object", history: "[{revision,at,reason,payload}]" },
    csvColumns: CSV_HEADER,
    csvRules: ["一行一条明确观察", "item 与 cell 二选一，另一组位置字段留空", "缺失值留空，不写 0", "sheet-safe 变体对 = + - @ 与制表/回车开头的值前置单引号"],
  }, null, 2);
  const dictionary = JSON.stringify({
    valueKinds: ["scalar", "bound", "range", "category", "summary", "missing"],
    valueKindNotes: { scalar: "无量纲单位规范为 1；未知单位 null 并附 unknown", bound: "不自动变等号", range: "不取中点", category: "定性与未解析数值（unparsed_numeric）", summary: "含 statistic 与可选 SD/SE/CI", missing: "明确缺失，reasonCode 必填" },
    reviewStatuses: ["pending", "confirmed", "needs_info", "excluded", "withdrawn"],
    natures: ["observation", "hypothesis", "interpretation", "to_verify", "human_judgment"],
    contentTypes: ["observation", "method", "definition", "claim", "limitation", "question"],
    relationTypes: ["belongs_to", "derived_from", "supports", "contradicts", "limits", "uses_method", "precondition_of", "supersedes"],
    decisionKinds: ["computable", "display_only", "blocked"],
    note: "本字典描述快照内对象取值，不构成全领域词表。",
  }, null, 2);
  return { schema, dictionary };
}

export interface KnowledgePackage { readonly entries: ZipEntry[]; readonly manifest: Record<string, unknown>; readonly notice: string }

/** 组装知识包（默认不带附件；manifest 记录每文件 sha256/schema/许可/排除原因）。 */
export function buildKnowledgePackage(snapshot: KnowledgeSnapshot, opts: { sheetSafeCsv?: { datasetId?: string; comparisonId?: string } } = {}): KnowledgePackage {
  const { schema, dictionary } = snapshotSchemaFiles();
  const wiki = snapshotWiki(snapshot);
  const entries: ZipEntry[] = [];
  const filesMeta: { file: string; sha256: string; bytes: number; schema: string }[] = [];
  const add = (name: string, data: string, schemaName: string) => {
    entries.push({ name: safeRelPath(name), data });
    filesMeta.push({ file: name, sha256: sha(schemaName === "binary" ? Buffer.from(data, "utf8") : data), bytes: Buffer.byteLength(data, "utf8"), schema: schemaName });
  };

  const snapshotJson = JSON.stringify({
    snapshotId: snapshot.snapshotId, createdAt: snapshot.createdAt, schemaVersion: snapshot.schemaVersion,
    projectionVersion: snapshot.projectionVersion, mode: snapshot.mode, scope: snapshot.scope,
    contentHash: snapshot.contentHash, coverage: snapshot.coverage, excluded: snapshot.excluded,
    sourceVersionRefs: snapshot.sourceVersionRefs, mappingRefs: snapshot.mappingRefs, content: snapshot.content,
  }, null, 2);
  add("snapshot.json", snapshotJson, "snapshot/v1");
  add("schema.json", schema, "schema/v1");
  add("data-dictionary.json", dictionary, "dictionary/v1");
  add("references.json", JSON.stringify(snapshot.content.referenceMap, null, 2), "references/v1");

  const csvTargets: { datasetId?: string; comparisonId?: string }[] = [];
  for (const cmp of snapshot.content.comparisons) csvTargets.push({ comparisonId: cmp.id });
  if (opts.sheetSafeCsv) csvTargets.push(opts.sheetSafeCsv);
  let csvCount = 0;
  for (const t of csvTargets) {
    const machine = snapshotCsv(snapshot, t);
    add(machine.filename, machine.content, "csv/machine");
    csvCount++;
    const safe = snapshotCsv(snapshot, { ...t, variant: "sheet-safe" });
    add(safe.filename, safe.content, "csv/sheet-safe");
  }
  for (const p of wiki.pages) add(`wiki/${p.file}`, p.markdown, "wiki/markdown");

  const excludedAttachments = [
    ...snapshot.sourceVersionRefs.filter((r) => r.kind === "attachment" || r.kind === "asset").map((r) => ({ ref: r, reason: "默认不带附件原件；如需带走请在许可允许后单独导出" })),
    ...snapshot.excluded.filter((x) => "kind" in x.ref && (x.ref.kind === "attachment" || x.ref.kind === "asset")).map((x) => ({ ref: x.ref, reason: x.reason })),
  ];
  const sourcePermissions = snapshot.sourceVersionRefs.map((r) => ({ token: tokenOfRef(snapshot, refKey(r)), sourceKind: r.kind, sourceId: r.id, version: r.version }));
  const notice = [
    "LOCUS 知识包 NOTICE",
    `快照：${snapshot.snapshotId}（内容 hash ${snapshot.contentHash}）`,
    `生成：${now()}`,
    `模式：${snapshot.mode === "formal" ? "正式" : "探索（含待审内容）"}`,
    "",
    "包含：snapshot.json（机器 JSON）、schema.json、data-dictionary.json、references.json、wiki/（模板页）、comparisons/dataset CSV（机器版＋sheet-safe 版）。",
    `CSV 文件数：${csvCount * 2}（机器／sheet-safe 成对）。sheet-safe 对公式样式与制表/回车开头的值前置单引号。`,
    "",
    "默认不含附件原件。以下来源未随包（含原因）：",
    ...(excludedAttachments.length ? excludedAttachments.map((x) => `- ${refKey(x.ref as never)}：${x.reason}`) : ["- （无）"]),
    "",
    "本包内 token 是快照内 opaque ID，不是访问凭据；包内链接为相对路径。",
  ].join("\n");
  add("NOTICE.txt", notice, "text/plain");

  const manifest = {
    snapshotId: snapshot.snapshotId, contentHash: snapshot.contentHash, mode: snapshot.mode,
    generatedAt: now(), files: filesMeta, sourcePermissions, excludedAttachments,
    sheetSafe: true, note: "manifest 为包内清单；不随内容 hash 变化而改写已冻结快照。",
  };
  add("manifest.json", JSON.stringify(manifest, null, 2), "manifest/v1");
  return { entries, manifest, notice };
}

export interface KnowledgeExportResult { readonly filename: string; readonly data: Buffer | string; readonly contentType: string; readonly manifest?: Record<string, unknown> }

/** 统一导出入口（§8.1 export 路由）：format=zip|json|wiki|csv。 */
export function exportKnowledge(snapshot: KnowledgeSnapshot, opts: { format: "zip" | "json" | "wiki" | "csv"; datasetId?: string; comparisonId?: string; variant?: "machine" | "sheet-safe" }): KnowledgeExportResult {
  if (opts.format === "json") {
    const { schema, dictionary } = snapshotSchemaFiles();
    return { filename: safeFileName(`snapshot_${snapshot.snapshotId}.json`), data: JSON.stringify({ schemaVersion: 1, snapshotId: snapshot.snapshotId, contentHash: snapshot.contentHash, content: snapshot.content, schema: JSON.parse(schema), dataDictionary: JSON.parse(dictionary) }, null, 2), contentType: "application/json; charset=utf-8" };
  }
  if (opts.format === "wiki") {
    const wiki = snapshotWiki(snapshot);
    const body = wiki.pages.map((p) => `<!-- ${p.file} -->\n${p.markdown}`).join("\n\n---\n\n");
    return { filename: safeFileName(`wiki_${snapshot.snapshotId}.md`), data: body, contentType: "text/markdown; charset=utf-8" };
  }
  if (opts.format === "csv") {
    const csv = snapshotCsv(snapshot, { datasetId: opts.datasetId, comparisonId: opts.comparisonId, variant: opts.variant ?? "machine" });
    return { filename: safeFileName(csv.filename), data: csv.content, contentType: "text/csv; charset=utf-8" };
  }
  const pkg = buildKnowledgePackage(snapshot, { sheetSafeCsv: opts.datasetId || opts.comparisonId ? { datasetId: opts.datasetId, comparisonId: opts.comparisonId } : undefined });
  return { filename: safeFileName(`knowledge_${snapshot.snapshotId}.zip`), data: zip(pkg.entries), contentType: "application/zip", manifest: pkg.manifest };
}

export type { SnapshotDatasetRows };
