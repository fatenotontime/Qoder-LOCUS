/**
 * 文献整理（5A/5C）：论文条目 ≠ 上传文件。
 * 条目管理题录身份（题名/作者/年份/DOI/来源/许可）；附件指向原件，角色/版本明确。
 * 收藏不触发强制 AI 解析；多课题可引用同一来源。
 * Zotero 三模式如实区分：题录导入（BibTeX/CSL-JSON，本模块实现）、附件导入（文件上传）、
 * 实时连接（Zotero 桌面本地 API，未验证、未实现，不做假入口）。
 */
import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import type { LocusState, PaperAttachment, PaperEntry, RevisionEntry } from "../store.ts";
import { AppError, assertUniqueHash, makeAsset } from "./app.ts";

const now = () => new Date().toISOString();
const str = (v: unknown) => String(v ?? "").trim();

const ATT_EXT = new Set([".md", ".markdown", ".txt", ".text", ""]);

export interface PaperInput {
  title: string;
  authors?: string[] | string;
  year?: string;
  doi?: string;
  source?: string;
  license?: string;
  topicIds?: string[];
  note?: string;
}

function normAuthors(a: PaperInput["authors"]): string[] {
  if (Array.isArray(a)) return a.map(str).filter(Boolean);
  return str(a).split(/\s+and\s+|;|；/).map((s) => s.trim()).filter(Boolean);
}

/** 同 DOI 视为同一论文身份：不重复建条目，返回已有条目供定位（不死路）。 */
function assertDoiUnique(state: LocusState, doi: string, exceptId?: string): void {
  if (!doi) return;
  const existing = state.papers.find((p) => p.doi && p.doi.toLowerCase() === doi.toLowerCase() && p.id !== exceptId);
  if (existing) throw new AppError(409, `相同 DOI 的论文条目已存在：${existing.title}`, { existingPaperId: existing.id, existingTitle: existing.title });
}

export function createPaper(state: LocusState, input: PaperInput): { state: LocusState; paper: PaperEntry } {
  const title = str(input.title);
  if (!title) throw new AppError(422, "论文题名不能为空。");
  const doi = str(input.doi);
  assertDoiUnique(state, doi);
  const topicIds = (input.topicIds ?? []).filter((id) => state.topics.some((t) => t.id === id));
  const paper: PaperEntry = {
    id: `paper_${randomUUID()}`, title, authors: normAuthors(input.authors), year: str(input.year), doi,
    source: str(input.source), license: str(input.license), topicIds, note: str(input.note),
    revision: 1, history: [], createdAt: now(), updatedAt: now(),
  };
  return { state: { ...state, papers: [...state.papers, paper] }, paper };
}

export interface PaperPatch {
  title?: string; authors?: string[] | string; year?: string; doi?: string;
  source?: string; license?: string; note?: string; reason?: string;
}

/** 题录修订：留历史；DOI 改为已有条目同样 409 定位。 */
export function updatePaper(state: LocusState, id: string, patch: PaperPatch): { state: LocusState; paper: PaperEntry } {
  const idx = state.papers.findIndex((p) => p.id === id);
  if (idx < 0) throw new AppError(404, `论文条目不存在：${id}`);
  const cur = state.papers[idx];
  const next = {
    title: patch.title !== undefined ? str(patch.title) : cur.title,
    authors: patch.authors !== undefined ? normAuthors(patch.authors) : cur.authors,
    year: patch.year !== undefined ? str(patch.year) : cur.year,
    doi: patch.doi !== undefined ? str(patch.doi) : cur.doi,
    source: patch.source !== undefined ? str(patch.source) : cur.source,
    license: patch.license !== undefined ? str(patch.license) : cur.license,
    note: patch.note !== undefined ? str(patch.note) : cur.note,
  };
  if (!next.title) throw new AppError(422, "论文题名不能为空。");
  assertDoiUnique(state, next.doi, id);
  const reason = str(patch.reason);
  const diffs: [string, string, string][] = [];
  for (const k of ["title", "year", "doi", "source", "license", "note"] as const) {
    if (next[k] !== cur[k]) diffs.push([k, cur[k], next[k]]);
  }
  if (next.authors.join("|") !== cur.authors.join("|")) diffs.push(["authors", cur.authors.join(" and "), next.authors.join(" and ")]);
  const revision = cur.revision + (diffs.length ? 1 : 0);
  const history: RevisionEntry[] = [...cur.history];
  for (const [field, before, after] of diffs) history.push({ revision, at: now(), field, before, after, reason });
  const paper: PaperEntry = { ...cur, ...next, revision, history, updatedAt: now() };
  const papers = state.papers.slice(); papers[idx] = paper;
  return { state: { ...state, papers }, paper };
}

/** 课题关联：多课题可引用同一来源；关联是组织归属，不是依赖或科学可比。 */
export function linkPaperTopic(state: LocusState, paperId: string, topicId: string, link: boolean): { state: LocusState; paper: PaperEntry } {
  const idx = state.papers.findIndex((p) => p.id === paperId);
  if (idx < 0) throw new AppError(404, `论文条目不存在：${paperId}`);
  if (!state.topics.some((t) => t.id === topicId)) throw new AppError(404, `课题不存在：${topicId}`);
  const cur = state.papers[idx];
  const has = cur.topicIds.includes(topicId);
  if (link === has) return { state, paper: cur };
  const topicIds = link ? [...cur.topicIds, topicId] : cur.topicIds.filter((t) => t !== topicId);
  const paper: PaperEntry = { ...cur, topicIds, updatedAt: now() };
  const papers = state.papers.slice(); papers[idx] = paper;
  return { state: { ...state, papers }, paper };
}

/**
 * 附件导入：只归档建关系，**不触发任何解析**。
 * 真重复（同内容指纹）拒收并给出已有原件/条目定位；同 DOI 不同附件/版本不互拒。
 */
export function addPaperAttachment(
  state: LocusState,
  input: { paperId: string; name: string; text: string; role?: PaperAttachment["role"]; version?: string },
): { state: LocusState; attachment: PaperAttachment; assetId: string } {
  const paper = state.papers.find((p) => p.id === input.paperId);
  if (!paper) throw new AppError(404, `论文条目不存在：${input.paperId}`);
  const ext = extname(input.name ?? "").toLowerCase();
  if (!ATT_EXT.has(ext)) throw new AppError(422, `附件暂只支持 Markdown/纯文本（.md/.txt）；${ext} 解析器未配置（PDF 等后续按实际能力接入）。`);
  const role = input.role === "supplement" || input.role === "other" ? input.role : "fulltext";
  const asset = makeAsset("literature", input.name ?? "", String(input.text ?? "").replace(/^\uFEFF/, ""), paper.topicIds[0]);
  try {
    assertUniqueHash(state, asset.fingerprint!);
  } catch (e) {
    if (e instanceof AppError && e.status === 409) {
      const att = state.attachments.find((a) => a.assetId === e.details?.existingAssetId);
      throw new AppError(409, e.message, { ...e.details, existingPaperId: att?.paperId, existingAttachmentId: att?.id });
    }
    throw e;
  }
  const attachment: PaperAttachment = { id: `att_${randomUUID()}`, paperId: paper.id, assetId: asset.id, role, version: str(input.version), createdAt: now() };
  return { state: { ...state, assets: [...state.assets, asset], attachments: [...state.attachments, attachment] }, attachment, assetId: asset.id };
}

// ── 题录导入：BibTeX / CSL-JSON（Zotero 导出即用；不连接私人库）──

interface BibEntry { type: string; key: string; fields: Record<string, string> }

/** 括号感知的 BibTeX 扫描：支持嵌套花括号字段值。 */
export function parseBibtex(text: string): BibEntry[] {
  const entries: BibEntry[] = [];
  let i = 0;
  while (i < text.length) {
    const at = text.indexOf("@", i);
    if (at < 0) break;
    const brace = text.indexOf("{", at);
    if (brace < 0) break;
    const type = text.slice(at + 1, brace).trim().toLowerCase();
    let depth = 1; let j = brace + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
      j++;
    }
    const body = text.slice(brace + 1, j - 1);
    i = j;
    if (type === "comment" || type === "preamble" || type === "string") continue;
    const comma = body.indexOf(",");
    const key = (comma >= 0 ? body.slice(0, comma) : body).trim();
    const fields: Record<string, string> = {};
    let k = comma + 1;
    while (k < body.length) {
      const eq = body.indexOf("=", k);
      if (eq < 0) break;
      const name = body.slice(k, eq).trim().toLowerCase();
      let p = eq + 1;
      while (p < body.length && /\s/.test(body[p])) p++;
      let value = "";
      if (body[p] === "{") {
        let d = 1; const s = p + 1; p++;
        while (p < body.length && d > 0) { if (body[p] === "{") d++; else if (body[p] === "}") d--; p++; }
        value = body.slice(s, p - 1);
      } else if (body[p] === '"') {
        const s = p + 1; p++;
        while (p < body.length && body[p] !== '"') p++;
        value = body.slice(s, p); p++;
      } else {
        const s = p;
        while (p < body.length && body[p] !== ",") p++;
        value = body.slice(s, p).trim();
      }
      if (name) fields[name] = value.replace(/\s+/g, " ").trim();
      const nextComma = body.indexOf(",", p);
      if (nextComma < 0) break;
      k = nextComma + 1;
    }
    entries.push({ type, key, fields });
  }
  return entries;
}

export interface BibliographyResult {
  state: LocusState;
  created: PaperEntry[];
  skipped: { title: string; doi: string; existingPaperId: string }[];
}

/** 题录批量导入：同 DOI 已有条目跳过并给定位；不导入附件、不触发解析。 */
export function importBibliography(state: LocusState, input: { format: "bibtex" | "csl-json"; text: string }): BibliographyResult {
  let items: PaperInput[];
  if (input.format === "bibtex") {
    items = parseBibtex(input.text).map((e) => ({
      title: e.fields.title ?? "", authors: e.fields.author ?? "", year: e.fields.year ?? "",
      doi: e.fields.doi ?? "", source: e.fields.journal ?? e.fields.booktitle ?? e.fields.url ?? "", license: "",
    }));
  } else {
    let arr: unknown;
    try { arr = JSON.parse(input.text); } catch { throw new AppError(422, "CSL-JSON 解析失败：请提供 Zotero 导出的 CSL JSON 数组。"); }
    if (!Array.isArray(arr)) throw new AppError(422, "CSL-JSON 须为条目数组。");
    items = arr.map((x) => {
      const o = x as { title?: string; author?: { family?: string; given?: string }[]; issued?: { "date-parts"?: (string | number)[][] }; DOI?: string; "container-title"?: string; URL?: string };
      const year = o.issued?.["date-parts"]?.[0]?.[0];
      return {
        title: String(o.title ?? ""),
        authors: (o.author ?? []).map((a) => [a.family, a.given].filter(Boolean).join(", ")),
        year: year !== undefined ? String(year) : "", doi: String(o.DOI ?? ""),
        source: String(o["container-title"] ?? o.URL ?? ""), license: "",
      };
    });
  }
  let s = state;
  const created: PaperEntry[] = [];
  const skipped: BibliographyResult["skipped"] = [];
  for (const item of items) {
    if (!item.title.trim()) continue;
    try {
      const r = createPaper(s, item);
      s = r.state; created.push(r.paper);
    } catch (e) {
      if (e instanceof AppError && e.status === 409) {
        skipped.push({ title: item.title, doi: item.doi ?? "", existingPaperId: String(e.details?.existingPaperId ?? "") });
      } else throw e;
    }
  }
  if (created.length === 0 && skipped.length === 0) throw new AppError(422, "未识别到任何题录条目（BibTeX 需 @type{key, …}；CSL-JSON 需条目数组）。");
  return { state: s, created, skipped };
}