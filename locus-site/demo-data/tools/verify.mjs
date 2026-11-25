// 复核 + 生成 SHA256SUMS.txt。
// 检查：JSON 可解析；state/fixture/knowledge/comparison 引用不悬空；
//       原件与快照文件 SHA-256 与 manifest 一致；ZIP 条目与磁盘一致、SHA-256 与校验文件一致。
// 运行：node locus-site/demo-data/tools/verify.mjs   失败退出码非 0。
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, dirname, relative, sep, posix } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..");
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
let fail = 0;
const ok = (m) => console.log("PASS  " + m);
const bad = (m) => { fail++; console.log("FAIL  " + m); };

// 1) JSON 可解析
const jsonFiles = ["fixture.json", "snapshot/state.json", "snapshot/manifest.json", "snapshot/context-map.json", "snapshot/references.json", "snapshot/knowledge.json", "snapshot/ai-products.json", "snapshot/next-steps.json", "snapshot/figures.json", "snapshot/chain-90d.json"];
const J = {};
for (const f of jsonFiles) { try { J[f] = readJson(join(OUT, f)); ok(`JSON 可解析: ${f}`); } catch (e) { bad(`JSON 无法解析: ${f} (${e.message})`); } }

const state = J["snapshot/state.json"] ?? {};
const manifest = J["snapshot/manifest.json"] ?? {};
const fixture = J["fixture.json"] ?? {};
const knowledge = J["snapshot/knowledge.json"] ?? {};

// 2) manifest 固定字段
for (const k of ["schemaVersion", "fixtureVersion", "sourceCommit", "projectId", "generatedAt", "verificationStatus"]) {
  (manifest[k] !== undefined && manifest[k] !== null && manifest[k] !== "") ? ok(`manifest.${k}=${JSON.stringify(manifest[k])}`) : bad(`manifest 缺 ${k}`);
}
if (manifest.sourceCommit === "8120986") ok("manifest.sourceCommit=8120986"); else bad(`sourceCommit=${manifest.sourceCommit}`);
if (manifest.fixtureVersion === fixture.fixtureVersion && manifest.projectId === fixture.projectId) ok("manifest 与 fixture 版本/项目一致"); else bad("manifest 与 fixture 版本/项目不一致");

// 3) state 引用不悬空
const S = (k) => new Set((state[k] ?? []).map((x) => x.id));
const has = (k, id) => S(k).has(id);
let dangling = [];
for (const c of state.cards ?? []) { if (!has("assets", c.assetId)) dangling.push(`card ${c.id}→asset ${c.assetId}`); if (c.paperId && !has("papers", c.paperId)) dangling.push(`card ${c.id}→paper`); }
for (const t of state.tables ?? []) if (!has("assets", t.assetId)) dangling.push(`table ${t.id}→asset`);
for (const a of state.attachments ?? []) { if (!has("papers", a.paperId)) dangling.push(`att ${a.id}→paper`); if (!has("assets", a.assetId)) dangling.push(`att ${a.id}→asset`); }
for (const m of state.measurements ?? []) { if (!has("samples", m.sampleId)) dangling.push(`meas ${m.id}→sample`); }
for (const s of state.samples ?? []) { if (!has("executions", s.executionId)) dangling.push(`sample ${s.id}→exec`); if (!has("topics", s.topicId)) dangling.push(`sample ${s.id}→topic`); }
for (const e of state.executions ?? []) { if (!has("protocols", e.protocolId)) dangling.push(`exec ${e.id}→protocol`); }
for (const t of state.analysisTasks ?? []) {
  for (const r of [...(t.core ?? []), ...(t.optional ?? []).map((o) => o.ref)]) {
    const coll = { table: "tables", measurement: "measurements", card: "cards", execution: "executions", protocol: "protocols" }[r.kind];
    if (!coll || !has(coll, r.id)) dangling.push(`task ${t.id}→${r.kind}:${r.id}`);
  }
  for (const rid of t.resultIds ?? []) if (!has("analysisResults", rid)) dangling.push(`task ${t.id}→result ${rid}`);
}
for (const rep of state.reports ?? []) for (const b of rep.blocks ?? []) for (const ref of b.refs ?? []) {
  const coll = { card: "cards", result: "analysisResults" }[ref.kind];
  if (!coll || !has(coll, ref.id)) dangling.push(`report ${rep.id}→${ref.kind}:${ref.id}`);
}
for (const ch of state.chats ?? []) for (const sc of ch.scope ?? []) { if (!has("cards", sc.id)) dangling.push(`chat ${ch.id}→card ${sc.id}`); }
dangling.length === 0 ? ok(`state 引用无悬空（cards ${state.cards?.length ?? 0} / tables ${state.tables?.length ?? 0} / …）`) : bad(`state 悬空引用 ${dangling.length} 处:\n  ` + dangling.join("\n  "));

// 4) fixture 引用可解析到 state
{
  const fx = [];
  const has2 = (k, id) => S(k).has(id);
  const ca = fixture.chainA_literatureToKnowledge ?? {};
  const cb = fixture.chainB_resultToOriginal ?? {};
  if (!has2("papers", ca.paper?.id)) fx.push(`fixture paper ${ca.paper?.id}`);
  if (!has2("assets", ca.original?.assetId)) fx.push(`fixture original ${ca.original?.assetId}`);
  if (!has2("attachments", ca.attachment?.id)) fx.push(`fixture attachment ${ca.attachment?.id}`);
  if (!has2("cards", ca.card?.id)) fx.push(`fixture card ${ca.card?.id}`);
  if (!has2("cards", ca.knowledgeItem?.cardId)) fx.push(`fixture kitem card ${ca.knowledgeItem?.cardId}`);
  if (!has2("analysisResults", cb.result?.id)) fx.push(`fixture result ${cb.result?.id}`);
  if (!has2("measurements", cb.processingSample?.measurementId)) fx.push(`fixture meas ${cb.processingSample?.measurementId}`);
  if (!has2("tables", cb.tableRow?.tableId)) fx.push(`fixture table ${cb.tableRow?.tableId}`);
  if (!has2("executions", cb.execution?.id)) fx.push(`fixture exec ${cb.execution?.id}`);
  if (!has2("assets", cb.original?.assetId)) fx.push(`fixture original ${cb.original?.assetId}`);
  if (!has2("topics", fixture.projectId)) fx.push(`fixture projectId ${fixture.projectId}`);
  fx.length === 0 ? ok("fixture 全部引用可解析到 snapshot state") : bad("fixture 悬空:\n  " + fx.join("\n  "));
}

// 5) knowledge / comparison 引用
{
  const kk = [];
  for (const it of knowledge.items ?? []) { if (!has("cards", it.cardId)) kk.push(`item ${it.id}→card`); for (const rf of it.sourceRefs ?? []) if (rf.kind === "asset" && !has("assets", rf.id)) kk.push(`item ${it.id}→asset ${rf.id}`); }
  for (const cmp of knowledge.comparisons ?? []) for (const side of cmp.sides ?? []) for (const rf of side.refs ?? []) if (!has("cards", rf.id)) kk.push(`cmp ${cmp.id}→card ${rf.id}`);
  kk.length === 0 ? ok(`knowledge 条目/比较引用无悬空（items ${knowledge.items?.length ?? 0}，comparisons ${knowledge.comparisons?.length ?? 0}）`) : bad("knowledge 悬空:\n  " + kk.join("\n  "));
}

// 5.5) 图形与 90 天贯通链引用可解析
{
  const figures = J["snapshot/figures.json"] ?? {};
  const chain = J["snapshot/chain-90d.json"] ?? {};
  const gg = [];
  for (const [pid, fig] of Object.entries(figures.protocolFigures ?? {})) {
    if (!has("protocols", pid)) gg.push(`figure protocolId ${pid}`);
    if (!Array.isArray(fig.nodes) || !fig.nodes.length) gg.push(`figure ${pid} 无节点`);
  }
  for (const [tid, ch] of Object.entries(figures.charts ?? {})) {
    if (!has("tables", tid)) gg.push(`chart tableId ${tid}`);
    for (const r of ch.rows ?? []) if (r.fresh === null && r.dried === null) gg.push(`chart ${tid} 行无数值`);
  }
  const collOf = { block: "reports", result: "analysisResults", measurement: "measurements", table: "tables", execution: "executions", asset: "assets" };
  for (const h of chain.hops ?? []) {
    const coll = collOf[h.kind];
    if (!coll) { gg.push(`chain 未知 kind ${h.kind}`); continue; }
    if (h.kind === "block") {
      const rep = (state.reports ?? []).find((r) => r.id === h.reportId);
      if (!rep || !(rep.blocks ?? []).some((b) => b.id === h.id)) gg.push(`chain block ${h.id} 不在报告 ${h.reportId}`);
    } else if (!has(coll, h.id)) gg.push(`chain ${h.kind}:${h.id}`);
  }
  gg.length === 0 ? ok(`图形与 90 天链引用可解析（protocolFigures ${Object.keys(figures.protocolFigures ?? {}).length}，charts ${Object.keys(figures.charts ?? {}).length}，hops ${(chain.hops ?? []).length}）`) : bad("图形/贯通链悬空:\n  " + gg.join("\n  "));
}

// 5.6) 导出文件：存在、类型正确、追溯包内引用版本与报告一致
{
  const ee = [];
  const docxPath = join(OUT, "snapshot/exports/report.docx");
  const tracePath = join(OUT, "snapshot/exports/traceability.zip");
  if (!existsSync(docxPath)) ee.push("缺 exports/report.docx");
  else {
    const b = readFileSync(docxPath);
    if (b.length < 4 || b.readUInt32LE(0) !== 0x04034b50) ee.push("report.docx 非 ZIP/OOXML（PK 头缺失）");
  }
  if (!existsSync(tracePath)) ee.push("缺 exports/traceability.zip");
  else {
    const zb = readFileSync(tracePath);
    if (zb.length < 4 || zb.readUInt32LE(0) !== 0x04034b50) ee.push("traceability.zip 非 ZIP");
    // 读中央目录名，确认含 report.docx 与 versions.json
    let names = [];
    let eocd = -1; for (let i = zb.length - 22; i >= 0; i--) if (zb.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd >= 0) {
      const total = zb.readUInt16LE(eocd + 10); let off = zb.readUInt32LE(eocd + 16);
      for (let i = 0; i < total; i++) { if (zb.readUInt32LE(off) !== 0x02014b50) break; const n = zb.readUInt16LE(off + 28); names.push(zb.slice(off + 46, off + 46 + n).toString("utf8")); off += 46 + n + zb.readUInt16LE(off + 30) + zb.readUInt16LE(off + 32); }
    }
    if (!names.includes("report.docx")) ee.push("追溯包缺 report.docx");
    if (!names.includes("versions.json")) ee.push("追溯包缺 versions.json");
  }
  ee.length === 0 ? ok("导出文件存在且类型正确（report.docx OOXML、traceability.zip 含 report.docx/versions.json）") : bad("导出文件校验失败:\n  " + ee.join("\n  "));
}

// 6) 原件 SHA-256 复算
{
  let n = 0, e = 0;
  for (const o of manifest.originals ?? []) {
    const p = join(OUT, o.path);
    if (!existsSync(p)) { bad(`原件缺失 ${o.path}`); e++; continue; }
    const buf = readFileSync(p);
    if (sha(buf) !== o.sha256) { bad(`原件 SHA-256 不符 ${o.path}`); e++; }
    else if (buf.length !== o.bytes) { bad(`原件字节数不符 ${o.path}`); e++; }
    else n++;
  }
  e === 0 ? ok(`原件 SHA-256 全部复算一致（${n} 个）`) : bad(`原件校验失败 ${e} 个`);
}

// 7) 快照文件 SHA-256 复算
{
  let e = 0, n = 0;
  for (const [rel, h] of Object.entries(manifest.files ?? {})) {
    const p = join(OUT, rel);
    if (!existsSync(p)) { bad(`快照文件缺失 ${rel}`); e++; continue; }
    sha(readFileSync(p)) === h ? n++ : (bad(`快照文件 SHA-256 不符 ${rel}`), e++);
  }
  e === 0 ? ok(`快照文件 SHA-256 复算一致（${n} 个）`) : bad(`快照文件校验失败 ${e} 个`);
}

// 8) 生成 SHA256SUMS.txt（原件 + 快照 + fixture + zip）
const sums = [];
const addSum = (rel) => { const p = join(OUT, rel); if (existsSync(p)) sums.push(`${sha(readFileSync(p))}  ${rel}`); };
const walkRel = (dir) => { for (const name of readdirSync(dir).sort()) { const p = join(dir, name); statSync(p).isDirectory() ? walkRel(p) : addSum(relative(OUT, p).split(sep).join(posix.sep)); } };
addSum("fixture.json");
walkRel(join(OUT, "originals"));
for (const f of ["state.json", "manifest.json", "context-map.json", "references.json", "knowledge.json", "ai-products.json", "next-steps.json", "report-snippet.md", "figures.json", "chain-90d.json", "exports/report.docx", "exports/traceability.zip"]) addSum(`snapshot/${f}`);
addSum("locus-demo-public.zip");
writeFileSync(join(OUT, "SHA256SUMS.txt"), sums.join("\n") + "\n", "utf8");
ok(`SHA256SUMS.txt 已生成（${sums.length} 行）`);

// 9) ZIP 校验：SHA-256 + 条目与磁盘一致（读中央目录）
{
  const zipPath = join(OUT, "locus-demo-public.zip");
  if (!existsSync(zipPath)) bad("ZIP 缺失");
  else {
    const buf = readFileSync(zipPath);
    const zipSha = sha(buf);
    const inSums = readFileSync(join(OUT, "SHA256SUMS.txt"), "utf8").split("\n").find((l) => l.endsWith("  locus-demo-public.zip"));
    (inSums && inSums.startsWith(zipSha)) ? ok(`ZIP SHA-256 与校验文件一致 ${zipSha.slice(0, 16)}…`) : bad(`ZIP SHA-256 与校验文件不一致`);
    // EOCD
    let eocd = -1; for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) bad("ZIP 无 EOCD");
    else {
      const total = buf.readUInt16LE(eocd + 10);
      let off = buf.readUInt32LE(eocd + 16);
      const names = [];
      for (let i = 0; i < total; i++) {
        if (buf.readUInt32LE(off) !== 0x02014b50) { bad("中央目录签名错误"); break; }
        const nameLen = buf.readUInt16LE(off + 28), extraLen = buf.readUInt16LE(off + 30), commentLen = buf.readUInt16LE(off + 32);
        names.push(buf.slice(off + 46, off + 46 + nameLen).toString("utf8"));
        off += 46 + nameLen + extraLen + commentLen;
      }
      const expected = new Set(["README.md"]);
      const addExpected = (dir) => { for (const name of readdirSync(dir).sort()) { const p = join(dir, name); if (statSync(p).isDirectory()) addExpected(p); else expected.add(relative(OUT, p).split(sep).join(posix.sep)); } };
      addExpected(join(OUT, "originals"));
      addExpected(join(OUT, "docs"));
      const nameSet = new Set(names);
      const missing = [...expected].filter((x) => !nameSet.has(x));
      const extra = names.filter((x) => !expected.has(x));
      (missing.length === 0 && extra.length === 0) ? ok(`ZIP 条目与磁盘一致（${names.length} 项）`) : bad(`ZIP 条目不一致 缺 ${missing.length}/多 ${extra.length}: ${missing.concat(extra).join(", ")}`);
    }
  }
}

console.log(`\n结果：${fail === 0 ? "全部通过" : fail + " 项失败"}`);
process.exit(fail === 0 ? 0 : 1);
