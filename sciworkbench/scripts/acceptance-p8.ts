// P8 五步走真实案例验收驱动（达尔文海水漂流）。
// 真实模型未授权：③⑤ 走本地模拟桩（scripts/_acceptance-p8-mock-ai.ts），显式标注「真实模型待授权」。
// 用法：先起服务与模拟桩，再运行本脚本：
//   PORT=5185 LOCUS_DATA=data/acceptance-p8.json \
//   LOCUS_AI_BASE_URL=http://127.0.0.1:5186/v1 LOCUS_AI_MODEL=mock-stub LOCUS_AI_KEY=stub \
//   node server.ts
//   P8_MOCK_PORT=5186 node scripts/_acceptance-p8-mock-ai.ts
//   node scripts/acceptance-p8.ts             # 默认 http://127.0.0.1:5185
//
// 本脚本经 HTTP 接口驱动（与前端 app.js 调用的同一组端点），逐步打印「操作 → 观察 → 证据」。
// 本脚本随仓库分发，但依赖私有测试包 test-packages/darwin-seed-saltwater；他人 clone 后需自备该包
// 方可运行（缺包时脚本 exit(1) 提示）。该包不入仓库（.gitignore 覆盖 test-packages/）。
//
// 判定：五步均带可失败断言（见下方 expect / stepVerdict）；任一步不达预期即打印失败步与原因，
// 最终以非零退出码结束（exit 1）。「退出码 0」= 五步全部达预期。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import ExcelJS from "exceljs";

const BASE = process.env.P8_BASE ?? "http://127.0.0.1:5185";
const PKG = "../test-packages/darwin-seed-saltwater";
const OUTDIR = "data/acceptance-p8";
const evidence: Record<string, unknown> = {};

if (!existsSync(`${PKG}/data/darwin-flotation.csv`)) {
  console.error(`缺少内部测试包：${PKG}。请先准备达尔文种子包再运行。`);
  process.exit(1);
}
mkdirSync(OUTDIR, { recursive: true });

// ── 工具 ──────────────────────────────────────────────────
const short = (v: unknown, n = 240) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s && s.length > n ? s.slice(0, n) + `…(+${s.length - n})` : s;
};
const banner = (t: string) => console.log(`\n===== ${t} =====`);
const rec = (...a: unknown[]) => console.log(...a);

// ── 断言与判定（任一步不达 → 非零退出）────────────────────
type Failure = { step: string; check: string; detail: string };
const failures: Failure[] = [];
const ok2xx = (s: number) => s >= 200 && s < 300;
function expect(step: string, check: string, ok: boolean, detail: unknown = ""): void {
  if (ok) return;
  const d = short(detail, 300);
  failures.push({ step, check, detail: d });
  console.error(`  [FAIL] ${step} · ${check}${d ? `：${d}` : ""}`);
}
function stepVerdict(step: string, label: string): void {
  const n = failures.filter((f) => f.step === step).length;
  if (n === 0) console.log(`  ✔ ${step} ${label}：达预期`);
  else console.error(`  ✘ ${step} ${label}：失败 ${n} 项`);
}

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(BASE + path, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { json = { _raw: text }; }
  return { status: res.status, json };
}
async function getState(): Promise<Record<string, unknown>> {
  return (await call("GET", "/api/state")).json;
}
async function pollJob(jobId: string, tries = 50): Promise<Record<string, unknown>> {
  if (!jobId || jobId === "undefined" || jobId === "null") return { status: "missing-job-id" };
  for (let i = 0; i < tries; i++) {
    const j = (await call("GET", `/api/jobs/${encodeURIComponent(jobId)}`)).json;
    const status = j.status as string;
    if (status === "done" || status === "error") return j;
    await new Promise((r) => setTimeout(r, 200));
  }
  return { status: "timeout" };
}

// ── 素材准备：真实多页 PDF + 真实 XLSX（由达尔文原文/数据生成）──────
const clean = (w: string) => {
  let t = w.replace(/<noinclude>[\s\S]*?<\/noinclude>/g, "").replace(/<[^>]+>/g, "");
  let prev;
  do { prev = t; t = t.replace(/\{\{[^{}]*\}\}/g, ""); } while (t !== prev);
  return t.replace(/\s+/g, " ").trim();
};
const pageText = (n: number) => clean(readFileSync(`${PKG}/sources/page-${n}.wiki`, "utf8"));

async function buildPdf(pages: { label: string; text: string }[], out: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = 10.5;
  const lineH = 15;
  const marginX = 54;
  for (const { label, text } of pages) {
    const page = doc.addPage([595, 842]);
    let y = 800;
    page.drawText(label, { x: marginX, y, size: size + 1, font, color: rgb(0.2, 0.2, 0.5) });
    y -= lineH * 1.5;
    const words = text.split(" ");
    let line = "";
    const flush = () => { if (line) { page.drawText(line, { x: marginX, y, size, font, color: rgb(0, 0, 0) }); y -= lineH; line = ""; } };
    for (const w of words) {
      const cand = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(cand, size) > 595 - marginX * 2) { flush(); if (y < 48) break; }
      line = line ? `${line} ${w}` : w;
    }
    flush();
  }
  const bytes = await doc.save();
  writeFileSync(out, bytes);
  return bytes;
}

function parseCsvRows(text: string): string[][] {
  return text.trim().split(/\r?\n/).map((line) => {
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  });
}
async function buildXlsx(csvPath: string, sheet: string, out: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  const coerce = (v: string): string | number => (/^[-+]?\d+(\.\d+)?$/.test(v) ? Number(v) : v);
  for (const row of parseCsvRows(readFileSync(csvPath, "utf8"))) ws.addRow(row.map((c) => coerce(c)));
  await wb.xlsx.writeFile(out);
}

const pdfBytes = await buildPdf(
  [371, 372, 373].map((n) => ({ label: `(facs. p.${n})`, text: pageText(n) })),
  `${OUTDIR}/darwin-1859-p371-373.pdf`,
);
await buildXlsx(`${PKG}/data/darwin-flotation.csv`, "flotation", `${OUTDIR}/darwin-flotation.xlsx`);
const floatCsv = readFileSync(`${PKG}/data/darwin-flotation.csv`, "utf8");
const dispCsv = readFileSync(`${PKG}/data/darwin-dispersal-estimates.csv`, "utf8");
const b64 = (b: Uint8Array | Buffer) => Buffer.from(b).toString("base64");

banner("素材准备");
rec(`PDF（多页文本）：${OUTDIR}/darwin-1859-p371-373.pdf  ${pdfBytes.length} 字节，3 页`);
rec(`XLSX：${OUTDIR}/darwin-flotation.xlsx（由 darwin-flotation.csv 生成）`);
rec(`CSV：darwin-flotation.csv（${floatCsv.length}B）、darwin-dispersal-estimates.csv（${dispCsv.length}B）`);

// 页码/文本块可回查的直接证据：解析器对真实 PDF 的页级切分。
const { parseBytes } = await import("../services/import-formats/index.ts");
const directParse = await parseBytes(pdfBytes, "darwin-1859-p371-373.pdf");
banner("证据·页码/文本块（parseBytes 直接解析真实 PDF）");
rec(`format=${directParse.format} status=${directParse.status} textBlocks=${directParse.textBlocks.length}`);
for (const b of directParse.textBlocks) rec(`  block#${b.orderIndex} origin=${JSON.stringify(b.origin)} chars=${b.text.length} lines=${b.lines.length} head="${short(b.lines[0] ?? "", 70)}"`);
evidence.pageBlocks = directParse.textBlocks.map((b) => ({ order: b.orderIndex, origin: b.origin, chars: b.text.length }));
expect("步骤①", "parseBytes 直接解析 PDF：status=ok 且 textBlocks>0", directParse.status === "ok" && directParse.format === "pdf" && directParse.textBlocks.length > 0, `status=${directParse.status} format=${directParse.format} blocks=${directParse.textBlocks.length}`);

// ── ⑤ 步 0：建课题与子问题（最小创建）────────────────────────
banner("步骤0 · 课题与子问题（最小创建）");
const topic = await call("POST", "/api/topics", { name: "种子经海水漂流后的萌发（达尔文 1859）", researchQuestion: "种子能否经海水漂流后仍萌发，从而跨海传播？" });
rec(`POST /api/topics → ${topic.status} ${short(topic.json)}`);
const topicId = String(topic.json.topicId);
const sq1 = await call("POST", `/api/topics/${topicId}/subquestions`, { question: "干燥与新鲜的漂浮时长差异如何？", kind: "declared" });
const sq2 = await call("POST", `/api/topics/${topicId}/subquestions`, { question: "海浪条件下传播估计是否需下修？", kind: "exploratory" });
rec(`子问题1 → ${sq1.status} ${short(sq1.json)}；子问题2 → ${sq2.status} ${short(sq2.json)}`);
const subqId = String(sq1.json.subquestionId);
evidence.topicId = topicId;
expect("步骤0", "POST /api/topics 2xx 且返回 topicId", ok2xx(topic.status) && Boolean(topic.json.topicId), topic.json);
expect("步骤0", "子问题创建 2xx 且返回 subquestionId", ok2xx(sq1.status) && ok2xx(sq2.status) && Boolean(sq1.json.subquestionId), `${sq1.status}/${sq2.status}`);
stepVerdict("步骤0", "课题与子问题");

// ── 步 ①：文献导入（真实 PDF）────────────────────────────────
banner("步骤① · 文献导入（真实多页 PDF）");
const paper = await call("POST", "/api/papers", { title: "On the Origin of Species（1859）· 第十一章 地理分布", authors: ["Charles Darwin"], year: "1859", source: "Wikisource 影印（页 371–373）", license: "Public Domain", topicIds: [topicId], note: "原文叙述，非实验记录本；条件多未量化。" });
rec(`POST /api/papers → ${paper.status} ${short(paper.json)}`);
expect("步骤①", "POST /api/papers 2xx 且返回 paperId", ok2xx(paper.status) && Boolean(paper.json.paperId), paper.json);
const paperId = String(paper.json.paperId);
const imp1 = await call("POST", "/api/import/file", { name: "darwin-1859-p371-373.pdf", dataBase64: b64(pdfBytes), kind: "literature", topicId, paperId });
rec(`POST /api/import/file(PDF) → ${imp1.status} ${short(imp1.json, 300)}`);
const litAssetId = String(imp1.json.assetId);
const srcView = await call("GET", `/api/source/${litAssetId}`);
rec(`GET /api/source/<asset> → ${srcView.status} asset=${short((srcView.json.asset as Record<string, unknown>)?.name)} points=${(srcView.json.points as unknown[])?.length}`);
rec(`  定位样例：${short(((srcView.json.points as { locate: string }[]) ?? []).slice(0, 3).map((p) => p.locate))}`);
type CardRow = { id: string; assetId: string; locator: { sectionQuote: string }; rawText: string; audit: string };
const allCards = (((await getState()).cards ?? []) as CardRow[]).filter((c) => c.assetId === litAssetId);
// 选内容有实质的卡（漂浮/萌发/海水）作为证据，避免只挑到页码标签行。
const litCards = allCards.filter((c) => /float|germinat|sea-water|immersion/i.test(c.rawText)).slice(0, 3);
const confirmedCards: string[] = [];
for (const c of litCards) {
  const rv = await call("POST", `/api/cards/${c.id}/review`, { audit: "confirm", importance: "medium", reason: "人工核对原文（验收）" });
  if (rv.status === 200) confirmedCards.push(c.id);
}
rec(`文献卡：合计 ${allCards.length}（均由 PDF 文本行派生）；选取实质卡 ${litCards.length} 张并确认 → ${short(litCards.map((c) => c.rawText), 160)}`);
const dup1 = await call("POST", "/api/import/file", { name: "darwin-1859-p371-373.pdf", dataBase64: b64(pdfBytes), kind: "literature", topicId, paperId });
rec(`再导同字节 PDF → ${dup1.status}（期望 409 不重复入库）${short(dup1.json)}`);
evidence.step1 = { assetId: litAssetId, cards: litCards.length, confirmed: confirmedCards, dupStatus: dup1.status };
expect("步骤①", "PDF 导入 2xx 且返回 assetId", ok2xx(imp1.status) && Boolean(imp1.json.assetId), imp1.json);
expect("步骤①", "文献卡 cards>0（PDF 文本行派生）", allCards.length > 0, `cards=${allCards.length}`);
expect("步骤①", "选取到实质卡（float/germinat/sea-water）>0", litCards.length > 0, `litCards=${litCards.length}`);
expect("步骤①", "实质卡全部确认成功", confirmedCards.length === litCards.length, `confirmed=${confirmedCards.length}/${litCards.length}`);
expect("步骤①", "GET /api/source 2xx 且 points>0", ok2xx(srcView.status) && ((srcView.json.points as unknown[])?.length ?? 0) > 0, `${srcView.status} points=${(srcView.json.points as unknown[])?.length}`);
expect("步骤①", "再导同字节 PDF → 409 不重复入库", dup1.status === 409, `status=${dup1.status} ${short(dup1.json)}`);
stepVerdict("步骤①", "文献导入（真实多页 PDF）");

// ── 步 ②：数据库可视化与积累（真实 XLSX/CSV）───────────────────
banner("步骤② · 数据表导入与画像（真实 XLSX/CSV）");
const xlsxBytes = readFileSync(`${OUTDIR}/darwin-flotation.xlsx`);
const impX = await call("POST", "/api/import/file", { name: "darwin-flotation.xlsx", dataBase64: b64(xlsxBytes), kind: "measurement", topicId });
rec(`POST /api/import/file(XLSX) → ${impX.status} ${short(impX.json, 300)}`);
const impF = await call("POST", "/api/import/file", { name: "darwin-flotation.csv", dataBase64: b64(floatCsv), kind: "measurement", topicId });
rec(`POST /api/import/file(CSV·flotation) → ${impF.status} ${short(impF.json, 200)}`);
const impD = await call("POST", "/api/import/file", { name: "darwin-dispersal-estimates.csv", dataBase64: b64(dispCsv), kind: "measurement", topicId });
rec(`POST /api/import/file(CSV·dispersal) → ${impD.status} ${short(impD.json, 200)}`);
const st2 = await getState();
const tables = (st2.tables ?? []) as { id: string; name: string; columns: string[]; rows: string[][]; profile: { columns: { label: string; nonEmpty: number; empty: number; observedTypes: Record<string, number> }[]; questions: unknown[]; totalRows: number } }[];
rec(`记录页可见表：${tables.length} 张（累计）`);
for (const t of tables) {
  const p = t.profile;
  rec(`  《${t.name}》 ${t.rows.length}行×${t.columns.length}列 | 列画像：${p?.columns?.map((c) => `${c.label}[非空${c.nonEmpty}/空${c.empty};类型${Object.entries(c.observedTypes).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v}`).join(",")}]`).join(" ")}`);
  rec(`     待答问题 ${p?.questions?.length ?? 0} 项（单位/分组/独立性/缺失值…）`);
}
const dupX = await call("POST", "/api/import/file", { name: "darwin-flotation.xlsx", dataBase64: b64(xlsxBytes), kind: "measurement", topicId });
rec(`再导同字节 XLSX → ${dupX.status}（期望 409 不重复入库）${short(dupX.json)}`);
const tableId = String(tables[0]?.id ?? "");
evidence.step2 = { tables: tables.length, tableId, dupStatus: dupX.status };
expect("步骤②", "XLSX/CSV 三文件导入均 2xx", ok2xx(impX.status) && ok2xx(impF.status) && ok2xx(impD.status), `${impX.status}/${impF.status}/${impD.status}`);
expect("步骤②", "记录页可见表 tables≥1", tables.length >= 1, `tables=${tables.length}`);
expect("步骤②", "每张表均有列画像（columns>0 且 totalRows>0）", tables.every((t) => (t.profile?.columns?.length ?? 0) > 0 && (t.profile?.totalRows ?? 0) > 0), tables.map((t) => `${t.name}:cols=${t.profile?.columns?.length ?? 0},rows=${t.profile?.totalRows ?? 0}`).join(" | "));
expect("步骤②", "取得 tableId", Boolean(tableId), `tableId=${tableId}`);
expect("步骤②", "再导同字节 XLSX → 409 不重复入库", dupX.status === 409, `status=${dupX.status} ${short(dupX.json)}`);
stepVerdict("步骤②", "数据表导入与画像（真实 XLSX/CSV）");

// ── 步 ③：方案从历史文献总结（模拟桩，真实模型待授权）───────────
banner("步骤③ · 由已有文献生成/修订方案【模拟桩·真实模型待授权】");
const parse = await call("POST", "/api/protocols/parse", { assetId: litAssetId, sourceKind: "reconstructed", topicId, name: "海水浸泡萌发试验（干燥 vs 新鲜）" });
rec(`POST /api/protocols/parse → ${parse.status} ${short(parse.json)}`);
expect("步骤③", "POST /api/protocols/parse 2xx 且返回 jobId", ok2xx(parse.status) && Boolean(parse.json.jobId), parse.json);
const pjob = await pollJob(String(parse.json.jobId));
rec(`GET /api/jobs/<id> → status=${pjob.status} ${short(pjob.result)}`);
expect("步骤③", "方案解析 job status=done", pjob.status === "done", `status=${pjob.status} ${short(pjob.result)}`);
type ProtoRow = { id: string; revision: number; sourceKind: string; sourceAssetId?: string; revisions: { revision: number; steps: { id: string; op: string }[]; unknowns: string[] }[] };
const protocols = ((await getState()).protocols ?? []) as ProtoRow[];
const curRev = protocols[0]?.revisions.at(-1);
rec(`方案：sourceKind=${protocols[0]?.sourceKind} sourceAssetId=${short(protocols[0]?.sourceAssetId, 20)}（回链到文献原件→其卡）`);
rec(`  r${curRev?.revision} 步骤 ${curRev?.steps?.length} 步：${short(curRev?.steps?.map((s) => s.op))}`);
rec(`  缺项 unknowns=${short(curRev?.unknowns)}`);
rec(`  回链核验：GET /api/source/<sourceAssetId> points=${((await call("GET", `/api/source/${litAssetId}`)).json.points as unknown[])?.length} 张文献卡`);
const protoId = String(protocols[0]?.id ?? "");
const edit = await call("POST", `/api/protocols/${protoId}/edit`, { unknowns: [...(curRev?.unknowns ?? []), "对照组样品数未写明"], reason: "修订：据证据补充缺项（人工）" });
const protoAfter = ((await getState()).protocols ?? []) as ProtoRow[];
rec(`POST /api/protocols/<id>/edit（修订）→ ${edit.status} ${short(edit.json)}；方案 revision=${protoAfter[0]?.revision}`);
evidence.step3 = { protocolId: protoId, sourceKind: protocols[0]?.sourceKind, revision: protoAfter[0]?.revision, steps: curRev?.steps?.length, unknowns: curRev?.unknowns };
expect("步骤③", "方案已落库且 sourceKind=reconstructed", protocols[0]?.sourceKind === "reconstructed", `sourceKind=${protocols[0]?.sourceKind}`);
expect("步骤③", "sourceAssetId 非空（回链文献原件）", Boolean(protocols[0]?.sourceAssetId), `sourceAssetId=${protocols[0]?.sourceAssetId}`);
expect("步骤③", "方案含可执行步骤（steps>0）", (curRev?.steps?.length ?? 0) > 0, `steps=${curRev?.steps?.length}`);
expect("步骤③", "编辑 2xx 且 revision 递增", ok2xx(edit.status) && (protoAfter[0]?.revision ?? 0) > (protocols[0]?.revision ?? 0), `${edit.status} r${protocols[0]?.revision}→r${protoAfter[0]?.revision}`);
stepVerdict("步骤③", "方案从历史文献总结（模拟桩）");

// ── 步 ④：执行记录（事件追加、样品状态 revision、测量固定版本）─────
banner("步骤④ · 执行记录（追加式）");
const exec = await call("POST", "/api/executions", { topicId, protocolId: protoId });
rec(`POST /api/executions → ${exec.status} ${short(exec.json)}`);
const execId = String(exec.json.executionId);
const soakStepId = String(protoAfter[0]?.revisions.at(-1)?.steps?.[2]?.id ?? "");
const prep = await call("POST", `/api/executions/${execId}/preparation`, { adjustments: [{ stepId: soakStepId, field: "note", after: "海水（盐度/温度未写明）", reason: "原文未量化，明示缺项，不补造" }], notes: "浸泡条件缺量化；计时口径：新鲜 vs 干燥对照。" });
const conf = await call("POST", `/api/executions/${execId}/confirm-preparation`, {});
rec(`准备稿（调整步骤 ${soakStepId}）→ ${prep.status} ${short(prep.json)}；确认快照 → ${conf.status} ${short(conf.json)}`);
const ev1 = await call("POST", `/api/executions/${execId}/events`, { kind: "note", text: "历史文献重构（达尔文 1859 第十一章）：非本地实验，数值为原文陈述补记。", backfilled: true });
const ev2 = await call("POST", `/api/executions/${execId}/events`, { kind: "start", text: "干燥茎枝与对照置于海水（原文叙述）。", backfilled: true });
rec(`追加事件 → ${ev1.status} + ${ev2.status}（追加不覆盖）`);
const sample = await call("POST", "/api/samples", { topicId, executionId: execId, shortName: "SEA-94", amount: { value: "94", unit: "plants" }, note: "原文所述 94 种植物的文献重构样品，非本地样品" });
rec(`POST /api/samples → ${sample.status} ${short(sample.json)}`);
const sampleId = String(sample.json.sampleId);
const srev = await call("POST", `/api/samples/${sampleId}/states`, { amount: { value: "94", unit: "plants" }, note: "追加状态：准备稿确认后登记（revision 2）" });
rec(`POST /api/samples/<id>/states（追加修订）→ ${srev.status} ${short(srev.json)}`);
const m1 = await call("POST", "/api/measurements", { topicId, sampleId, sampleStateRevision: 1, value: "90", unit: "days", method: "干燥后浸泡-种植（原文陈述）", note: "榛子（干燥）漂浮天数：原文陈述，非本地测量" });
const m2 = await call("POST", "/api/measurements", { topicId, sampleId, sampleStateRevision: 1, value: "85", unit: "days", method: "干燥后浸泡-种植（原文陈述）", note: "芦笋（干燥）漂浮天数：原文陈述，非本地测量" });
rec(`POST /api/measurements ×2 → ${m1.status}/${m2.status} ${short(m1.json)} ${short(m2.json)}`);
const st4 = await getState();
const ex = ((st4.executions ?? []) as { id: string; events: unknown[] }[]).find((e) => e.id === execId);
const smp = ((st4.samples ?? []) as { id: string; states: unknown[] }[]).find((s) => s.id === sampleId);
const meas = ((st4.measurements ?? []) as { id: string; sampleStateRevision: number; value: string; unit: string }[]).filter((m) => (m as unknown as { sampleId: string }).sampleId === sampleId);
rec(`核对：执行事件 ${ex?.events.length} 条（追加）；样品状态 revision=${smp?.states.length}（追加式）；测量 ${meas.length} 条，均固定 sampleStateRevision=${meas[0]?.sampleStateRevision}`);
const measId = String(m1.json.measurementId);
evidence.step4 = { executionId: execId, sampleId, events: ex?.events.length, sampleRevisions: smp?.states.length, measurements: meas.length };
expect("步骤④", "建执行 2xx 且返回 executionId", ok2xx(exec.status) && Boolean(exec.json.executionId), exec.json);
expect("步骤④", "准备稿/确认快照 2xx", ok2xx(prep.status) && ok2xx(conf.status), `${prep.status}/${conf.status}`);
expect("步骤④", "事件追加 2 条且均 2xx", ok2xx(ev1.status) && ok2xx(ev2.status) && (ex?.events.length ?? 0) >= 2, `status=${ev1.status}/${ev2.status} events=${ex?.events.length}`);
expect("步骤④", "建样品 2xx 且返回 sampleId", ok2xx(sample.status) && Boolean(sample.json.sampleId), sample.json);
expect("步骤④", "追加样品状态 2xx 且 revision 递增到 2", ok2xx(srev.status) && (smp?.states.length ?? 0) >= 2 && Number(srev.json.revision) >= 2, `${srev.status} states=${smp?.states.length} revision=${srev.json.revision}`);
expect("步骤④", "测量 2 条均 2xx", ok2xx(m1.status) && ok2xx(m2.status) && meas.length === 2, `${m1.status}/${m2.status} meas=${meas.length}`);
expect("步骤④", "测量 sampleStateRevision 固定为 1（不随样品新 revision 漂移）", meas.length === 2 && meas.every((m) => m.sampleStateRevision === 1), meas.map((m) => `r${m.sampleStateRevision}`).join(","));
stepVerdict("步骤④", "执行记录（追加式）");

// ── 步 ⑤：上下文地图选一次 + 对话（真地图，真实落库）─────────────
banner("步骤⑤ · 上下文地图选一次 + 对话【模拟桩·真实模型待授权】");
const task = await call("POST", "/api/analysis/tasks", { topicId, subquestionId: subqId, title: "传播量级与漂浮时长（干燥 vs 新鲜）", core: [{ kind: "table", id: tableId }, { kind: "measurement", id: measId }], optional: confirmedCards.slice(0, 2).map((id) => ({ ref: { kind: "card", id }, included: true })) });
rec(`POST /api/analysis/tasks → ${task.status} ${short(task.json)}`);
const taskId = String(task.json.taskId);
expect("步骤⑤", "POST /api/analysis/tasks 2xx 且返回 taskId", ok2xx(task.status) && Boolean(task.json.taskId), task.json);
const map = await call("GET", `/api/analysis/tasks/${taskId}/map`);
const mapNodes = (map.json.nodes ?? []) as { key: string; kind: string; label: string; adoptable?: boolean; role: string }[];
const mapEdges = (map.json.edges ?? []) as unknown[];
rec(`GET /api/analysis/tasks/<id>/map → ${map.status} nodes=${mapNodes.length} edges=${mapEdges.length} truncated=${map.json.truncated}`);
rec(`  节点样例：${short(mapNodes.slice(0, 6).map((n) => `${n.role}:${n.kind}=${n.label}`))}`);
expect("步骤⑤", "地图 2xx 且 nodes>0 且 edges>0", ok2xx(map.status) && mapNodes.length > 0 && mapEdges.length > 0, `${map.status} nodes=${mapNodes.length} edges=${mapEdges.length}`);
const adoptable = mapNodes.filter((n) => n.kind === "card" && n.adoptable);
rec(`  可「采用」的文献卡节点：${adoptable.length}（后端口径：audit=confirm 且有原文定位）`);
const adopt = await call("POST", "/api/adoptions", { cardId: confirmedCards[0], subquestionId: subqId, decision: "adopt", reason: "已核对原文，纳入证据" });
const exclude = confirmedCards[1] ? await call("POST", "/api/adoptions", { cardId: confirmedCards[1], subquestionId: subqId, decision: "exclude", reason: "与本研究子问题不直接相关" }) : { status: 0, json: {} };
rec(`选一次（采用）→ ${adopt.status} ${short(adopt.json)}；选一次（排除）→ ${exclude.status} ${short(exclude.json)}`);
const st5 = await getState();
const adoptions = (st5.adoptions ?? []) as { decision: string }[];
rec(`落库核对：GET /api/state adoptions=${adoptions.length}（decision=${adoptions.map((a) => a.decision).join(",")}）`);
expect("步骤⑤", "选一次（采用/排除）均 2xx", ok2xx(adopt.status) && ok2xx(exclude.status), `${adopt.status}/${exclude.status}`);
expect("步骤⑤", "adoptions 落库 2 条（adopt+exclude）", adoptions.length === 2, `adoptions=${adoptions.length}`);
const chat = await call("POST", "/api/chats", { topicId, subquestionId: subqId, scope: [{ kind: "table", id: tableId }, { kind: "measurement", id: measId }, { kind: "execution", id: execId }, { kind: "card", id: confirmedCards[0] }] });
rec(`POST /api/chats（范围接该任务：表+测量+执行+卡）→ ${chat.status} ${short(chat.json)}`);
const chatId = String(chat.json.chatId);
const send = await call("POST", `/api/chats/${chatId}/send`, { text: "海浪条件下传播估计是否需要下修？依据上下文证据说明。" });
rec(`POST /api/chats/<id>/send → ${send.status} ${short(send.json)}`);
expect("步骤⑤", "POST /api/chats 2xx 且返回 chatId", ok2xx(chat.status) && Boolean(chat.json.chatId), chat.json);
expect("步骤⑤", "POST /api/chats/<id>/send 2xx", ok2xx(send.status), send.json);
const cjob = await pollJob(String(send.json.jobId));
rec(`GET /api/jobs/<id> → status=${cjob.status} ${short(cjob.result)}`);
const chatRec = ((await getState()).chats ?? []) as { id: string; messages: { role: string; status: string; content: string; sources?: string[]; proposals?: { targetKind: string; targetId: string }[] }[] }[];
const last = chatRec.find((c) => c.id === chatId)?.messages.filter((m) => m.role === "assistant").at(-1);
rec(`对话回复：status=${last?.status} sources=${short(last?.sources)} proposals=${short(last?.proposals)}`);
rec(`  回答：${short(last?.content, 200)}`);
evidence.step5 = { taskId, nodes: mapNodes.length, edges: mapEdges.length, adoptable: adoptable.length, adoptions: adoptions.length, chatId, chatStatus: last?.status };
expect("步骤⑤", "对话 job status=done", cjob.status === "done", `status=${cjob.status} ${short(cjob.result)}`);
expect("步骤⑤", "末条助手回复 status=done", last?.status === "done", `status=${last?.status}`);
stepVerdict("步骤⑤", "上下文地图选一次＋对话（模拟桩）");

banner("判定");
evidence.failures = failures;
writeFileSync(`${OUTDIR}/evidence.json`, JSON.stringify(evidence, null, 2), "utf8");
rec(`证据摘要已写入 ${OUTDIR}/evidence.json`);
if (failures.length > 0) {
  const steps = [...new Set(failures.map((f) => f.step))];
  console.error(`\n验收未通过：${failures.length} 项失败，涉及 ${steps.join("、")}`);
  process.exitCode = 1;
} else {
  rec("验收通过：五步均达预期（③⑤ 为模拟桩，真实模型待授权）");
}
