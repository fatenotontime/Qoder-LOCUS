/**
 * 6A-4 导出：零依赖 ZIP（deflate）＋最小 DOCX（Word 可打开）＋追溯包。
 *
 * - Word 导出：块顺序＋性质＋固定引用清单，一次成稿；**外部 Word 编辑不回流为审计**（纯快照）。
 * - 追溯包：报告 DOCX ＋ 版本索引（每条引用的固定版本）＋ 逐附件**许可过滤**（仅可再分发者入包）＋
 *   hash manifest（每文件 sha256）＋ NOTICE（列出被排除的附件及原因）。
 */
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import type { LocusState, PreliminaryReportRecord, ReportBlock } from "../store.ts";
import { AppError } from "./app.ts";
import { buildNetwork, type NetNode } from "./references.ts";

const now = () => new Date().toISOString();

// ── 最小 ZIP（deflate）──────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry { name: string; data: Buffer | string }

/** 写出 ZIP（本地文件头＋数据＋中央目录＋EOCD）。deflate 压缩。 */
export function zip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, "utf8");
    const crc = crc32(data);
    const comp = deflateRawSync(data);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);      // version needed
    local.writeUInt16LE(0x0800, 6);  // UTF-8 name flag
    local.writeUInt16LE(8, 8);       // deflate
    local.writeUInt16LE(0, 10);      // time
    local.writeUInt16LE(0, 12);      // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    locals.push(local, comp);
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centrals.push(central);
    offset += local.length + comp.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const centralOffset = offset;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

// ── 最小 DOCX ───────────────────────────────────────────────

const xmlEsc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

const NATURE_CN: Record<string, string> = { observation: "观察", hypothesis: "假设", interpretation: "解释", to_verify: "待验证", human_judgment: "人工判断" };

function para(text: string, opts: { bold?: boolean; size?: number } = {}): string {
  const rpr = opts.bold ? `<w:rPr><w:b/><w:sz w:val="${(opts.size ?? 22) * 2}"/></w:rPr>` : `<w:rPr><w:sz w:val="${(opts.size ?? 22) * 2}"/></w:rPr>`;
  return `<w:p><w:pPr>${opts.bold ? "<w:spacing w:before=\"120\"/>" : ""}</w:pPr><w:r>${rpr}<w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r></w:p>`;
}

/** 由分析初稿块生成最小 DOCX（Word/Pages/WPS 可打开）。 */
export function buildReportDocx(state: LocusState, rep: PreliminaryReportRecord): Buffer {
  const topic = state.topics.find((t) => t.id === rep.topicId);
  const body: string[] = [];
  body.push(para(topic?.name ?? "课题", { bold: true, size: 30 }));
  body.push(para(`分析初稿 · 修订 r${rep.revision} · 导出 ${now()}`, { size: 18 }));
  body.push(para("（本文件为导出快照：在 Word 等外部编辑器中修改不会回流为本站审计记录。）", { size: 18 }));
  const blocks = [...rep.blocks].sort((a, b) => a.order - b.order);
  if (!blocks.length) body.push(para("（尚无块）"));
  blocks.forEach((b: ReportBlock, i) => {
    body.push(para(`${i + 1}. [${NATURE_CN[b.nature] ?? b.nature}]${b.draft ? "（AI 草稿·待确认）" : ""}`, { bold: true }));
    body.push(para(b.text));
    const refs = b.refs.filter((r) => r.kind !== "note");
    if (refs.length) body.push(para(`引用：${refs.map((r) => `${r.label}（${r.kind} ${r.version || "未标版本"}）`).join("；")}`, { size: 18 }));
    const notes = b.refs.filter((r) => r.kind === "note");
    if (notes.length) body.push(para(`来源：${notes.map((n) => n.label).join("；")}`, { size: 18 }));
  });
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}<w:sectPr/></w:body></w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  return zip([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rels },
    { name: "word/document.xml", data: doc },
  ]);
}

// ── 追溯包：版本索引 + 许可过滤 + hash manifest ─────────────

/** 许可是否可再分发入包（逐附件）。CC BY / CC0 / 公有领域 / 明确开放许可才可。 */
export function licenseRedistributable(license: string): boolean {
  const l = (license || "").toLowerCase();
  if (!l) return false;
  if (/cc0|public domain|公有领域|pd-|pd$/.test(l)) return true;
  if (/cc[\s-]*by/.test(l) && !/nc|nd/.test(l)) return true;      // CC BY（排除 NC/ND）
  if (/creative commons attribution/.test(l)) return true;
  return false;
}

export interface TraceabilityResult {
  readonly buffer: Buffer;
  readonly manifest: { file: string; sha256: string; bytes: number }[];
  readonly versionIndex: Record<string, unknown>;
  readonly excludedAttachments: { name: string; license: string; reason: string }[];
}

/** 组装某报告的追溯包（含被排除附件清单，不静默丢弃）。 */
export function buildTraceabilityPackage(state: LocusState, reportId: string): TraceabilityResult {
  const rep = state.reports.find((r) => r.id === reportId);
  if (!rep) throw new AppError(404, `报告不存在：${reportId}`);
  const topic = state.topics.find((t) => t.id === rep.topicId);
  const docx = buildReportDocx(state, rep);

  // 版本索引：报告块引用的固定版本（不指向 latest）
  const refs: { blockOrder: number; nature: string; kind: string; id: string; version: string; label: string }[] = [];
  for (const b of [...rep.blocks].sort((x, y) => x.order - y.order)) {
    for (const r of b.refs) if (r.kind !== "note") refs.push({ blockOrder: b.order, nature: b.nature, kind: r.kind, id: r.id, version: r.version, label: r.label });
  }
  const versionIndex: Record<string, unknown> = {
    report: { id: rep.id, revision: rep.revision, topic: topic?.name ?? rep.topicId, generatedAt: now() },
    pinned: rep.pinned,
    blocks: rep.blocks.map((b) => ({ order: b.order, nature: b.nature, draft: b.draft, refs: b.refs })),
    fixedRefs: refs,
    note: "引用固定版本，不指向 latest；外部 Word 编辑不回流入库。",
  };

  const files: ZipEntry[] = [
    { name: "report.docx", data: docx },
    { name: "versions.json", data: JSON.stringify(versionIndex, null, 2) },
  ];

  // 逐附件许可过滤：可再分发者入包（原件字节），否则登记排除
  const excludedAttachments: TraceabilityResult["excludedAttachments"] = [];
  const paperIds = new Set<string>();
  const assetIds = new Set<string>();
  for (const r of refs) {
    if (r.kind === "asset") assetIds.add(r.id);
    if (r.kind === "card") { const c = state.cards.find((x) => x.id === r.id); if (c) { assetIds.add(c.assetId); if (c.paperId) paperIds.add(c.paperId); } }
    if (r.kind === "result") { const res = state.analysisResults.find((x) => x.id === r.id); if (res) res.assetIds.forEach((a) => assetIds.add(a)); }
  }
  // 附件级许可：优先论文条目 license，其次原件本身无许可字段 → 视为未标（排除）
  for (const att of state.attachments) {
    if (!assetIds.has(att.assetId) && !paperIds.has(att.paperId)) continue;
    const paper = state.papers.find((p) => p.id === att.paperId);
    const asset = state.assets.find((a) => a.id === att.assetId);
    const license = paper?.license ?? "";
    if (licenseRedistributable(license)) {
      if (asset && !asset.text.startsWith("data:")) files.push({ name: `attachments/${att.id}_${asset.name}`, data: asset.text });
    } else {
      excludedAttachments.push({ name: asset?.name ?? att.id, license: license || "（未标许可）", reason: "许可不明或不允许再分发 → 未入包" });
    }
  }

  const manifest = files.map((f) => {
    const buf = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, "utf8");
    return { file: f.name, sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.length };
  });
  files.push({ name: "manifest.json", data: JSON.stringify({ generatedAt: now(), files: manifest }, null, 2) });
  const notice = [
    "追溯包说明",
    `报告 ${rep.id} · 修订 r${rep.revision}`,
    `生成 ${now()}`,
    "",
    "包含：report.docx（块顺序/性质/固定引用）、versions.json（版本索引）、manifest.json（sha256 清单）。",
    excludedAttachments.length ? `被排除的附件（许可不明或不允许再分发）：${excludedAttachments.map((e) => `${e.name}[${e.license}]`).join("；")}` : "附件：无排除。",
    "",
    "边界：本包是导出快照；在外部 Word 中编辑不会成为本站审计记录。",
  ].join("\n");
  files.push({ name: "NOTICE.txt", data: notice });
  return { buffer: zip(files), manifest, versionIndex, excludedAttachments };
}

/** 追溯包的网络快照（节点/边摘要），供界面或导出附注。 */
export function networkSummary(state: LocusState, reportId: string): { nodes: NetNode[]; edgeCount: number } {
  const net = buildNetwork(state);
  const blockIds = new Set(state.reports.find((r) => r.id === reportId)?.blocks.map((b) => `block:${b.id}`) ?? []);
  const reachable = new Set<string>(blockIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of net.edges) {
      if (reachable.has(e.to) && !reachable.has(e.from)) { reachable.add(e.from); changed = true; }
      if (reachable.has(e.from) && !reachable.has(e.to)) { reachable.add(e.to); changed = true; }
    }
  }
  const nodes = [...reachable].map((k) => net.nodes.get(k)).filter((n): n is NetNode => !!n);
  return { nodes, edgeCount: net.edges.filter((e) => reachable.has(e.from) && reachable.has(e.to)).length };
}

// ── 6A-5 整体导出与隔离恢复 ─────────────────────────────────

export const sha256 = (s: string | Buffer): string => createHash("sha256").update(s).digest("hex");

export function countsOf(state: LocusState): Record<string, number> {
  return {
    topics: state.topics.length, subquestions: state.subquestions.length, assets: state.assets.length,
    papers: state.papers.length, cards: state.cards.length, tables: state.tables.length,
    protocols: state.protocols.length, executions: state.executions.length, samples: state.samples.length,
    measurements: state.measurements.length, analysisTasks: state.analysisTasks.length,
    analysisResults: state.analysisResults.length, reports: state.reports.length, chats: state.chats.length,
  };
}

/** 整体导出：state.json ＋ manifest（sha256/版本/计数）＋ NOTICE。 */
export function buildWholeLibraryPackage(state: LocusState): Buffer {
  const stateJson = JSON.stringify(state, null, 2);
  const manifest = { generatedAt: now(), version: state.version, sha256: sha256(stateJson), bytes: Buffer.byteLength(stateJson), counts: countsOf(state) };
  const notice = [
    "LOCUS 整体导出",
    `生成 ${manifest.generatedAt} · 数据版本 v${state.version}`,
    "",
    "包含 state.json（全部实体，原件字节内嵌）、manifest.json（sha256 与计数）、NOTICE.txt。",
    "恢复：用 isolate-restore 载入 state.json；不得覆盖主实例数据文件。",
  ].join("\n");
  return zip([
    { name: "state.json", data: stateJson },
    { name: "manifest.json", data: JSON.stringify(manifest, null, 2) },
    { name: "NOTICE.txt", data: notice },
  ]);
}

export interface RestoreCheck {
  readonly ok: boolean;
  readonly error?: string;
  readonly version?: number;
  readonly counts?: Record<string, number>;
  readonly hashOk?: boolean;
}

/** 校验导入包（不落主数据）：损坏/版本未知/hash 不符 → 明确报错，不静默成空。 */
export function inspectLibraryJson(json: string, expectedSha256?: string): RestoreCheck {
  let parsed: LocusState;
  try {
    parsed = JSON.parse(json) as LocusState;
  } catch {
    return { ok: false, error: "损坏：JSON 解析失败（不静默清空，请核对文件）。" };
  }
  if (typeof parsed !== "object" || parsed === null || typeof (parsed as { version?: unknown }).version !== "number") {
    return { ok: false, error: "损坏：缺少数据版本字段（不静默清空）。" };
  }
  const hashOk = expectedSha256 ? sha256(json) === expectedSha256 : undefined;
  if (expectedSha256 && !hashOk) return { ok: false, error: "损坏：sha256 与 manifest 不符（文件可能被改动）。", hashOk };
  return { ok: true, version: parsed.version, counts: countsOf(parsed), hashOk };
}

