// S10 R09：可写课题导入公开材料并完成 P8 五步（逐步骤如实标注通道）。
// ① 优先经 UI 导入文献（开卷区表单自动化可能受折叠影响，失败则回落 API 并在结果里标明）；
// ②–⑤ 经确定性 API（本构建表格/测量/采纳/对话无 UI 入口或表单复杂）；最后刷新 UI 核对各页可见。
// 模型：本脚本不触发模型调用（全部确定性接口）；真实模型待授权。
// 用法：BASE=http://127.0.0.1:5582 NODE=http://127.0.0.1:5286 PKG=test-packages/darwin-seed-saltwater OUT=<evidence>
import { createRequire } from "module";
const require = createRequire((process.env.PW_MODULES || "C:/Users/PC/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules") + "/");
const { chromium } = require("playwright");
import fs from "node:fs";

const BASE = process.env.BASE || "http://127.0.0.1:5582";
const NODE = process.env.NODE || "http://127.0.0.1:5286";
const PKG = process.env.PKG || "test-packages/darwin-seed-saltwater";
const OUT = process.env.OUT || ".";
const R = { steps: {} };
fs.mkdirSync(`${OUT}/raw`, { recursive: true });
fs.mkdirSync(`${OUT}/screens`, { recursive: true });
const api = async (p, body) => { const r = await fetch(NODE + p, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, json: j, text: t }; };
const CSV = fs.readFileSync(`${PKG}/data/darwin-flotation.csv`, "utf8");
const QUOTE = "as all of these sank in a few days, they could not be floated across wide spaces of the sea";

const mk = await api("/api/topics", { name: "S10-R09 可写验收课题", researchQuestion: "导入公开材料并完成 P8 五步" });
const T2 = mk.json?.topicId;
const subq = await api(`/api/topics/${T2}/subquestions`, { question: "干燥后漂浮时长如何？", kind: "declared" });
const SUBQ = subq.json?.subquestionId;
R.topic = { topicId: T2, subquestionId: SUBQ };

const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--use-angle=d3d11"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const unroll = async () => { await page.waitForTimeout(3200); const ov = await page.evaluate(() => document.getElementById("overlay")?.className || ""); if (ov.includes("awaiting")) { await page.mouse.click(720, 450); await page.waitForTimeout(2000); } };
const nav = async (k) => { await page.keyboard.press("Escape"); await page.waitForTimeout(120); try { await page.click(`.navitem[data-nav="${k}"]`, { timeout: 6000 }); } catch { try { await page.click(".navtoggle, #nav-toggle, #nd-open", { timeout: 1500 }); await page.waitForTimeout(300); } catch {} await page.click(`.nd-item[data-nav="${k}"]`, { timeout: 4000 }); } await page.waitForTimeout(800); };

await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 30000 }); await unroll();
if (await page.$("#topic-select")) await page.selectOption("#topic-select", T2).catch(() => {});
await page.waitForTimeout(800);

// ① 文献导入
try {
  await nav("papers");
  // 先尝试 UI（用 evaluate 直接赋值+点击，绕过折叠/可见性）
  await page.evaluate(() => {
    const set = (id, v) => { const el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); } };
    set("pp-title", "On the Origin of Species（1859）· 第十一章（R09 导入）");
    set("pp-authors", "Charles Darwin"); set("pp-year", "1859"); set("pp-source", "Wikisource 影印（页 371–373）"); set("pp-license", "Public Domain");
    const btn = document.getElementById("pp-create"); if (btn) btn.click();
  }).catch(() => {});
  await page.waitForTimeout(1800);
  let st = await api("/api/state");
  let paper = st.json.papers.find((p) => (p.topicIds || []).includes(T2));
  let uiOk = !!paper;
  if (uiOk) {
    await page.evaluate((quote) => {
      const t = document.getElementById("att-text"); if (t) { t.value = `达尔文《物种起源》1859 · 第十一章（R09 导入）。摘录：${quote}。`; t.dispatchEvent(new Event("input", { bubbles: true })); }
      const v = document.getElementById("att-version"); if (v) { v.value = "v1"; }
      const b = document.getElementById("att-add"); if (b) b.click();
    }, QUOTE).catch(() => {});
    await page.waitForTimeout(1800);
    st = await api("/api/state");
    paper = st.json.papers.find((p) => (p.topicIds || []).includes(T2));
  }
  let atts = paper ? st.json.attachments.filter((a) => a.paperId === paper.id) : [];
  let channel = "UI";
  if (!paper || !atts.length) {
    // 回落 API
    channel = paper ? "UI 建条目 + API 加附件" : "API（UI 开卷表单自动化未成功）";
    if (!paper) { const p = await api("/api/papers", { title: "On the Origin of Species（1859）· 第十一章（R09 导入）", authors: ["Charles Darwin"], year: "1859", source: "Wikisource 影印（页 371–373）", license: "Public Domain", topicIds: [T2] }); paper = { id: p.json.paperId }; }
    if (!atts.length) { const a = await api(`/api/papers/${paper.id}/attachments`, { name: "origin-1859-p371-373.md", text: `达尔文《物种起源》1859 · 第十一章（R09 导入）。摘录：${QUOTE}。`, role: "fulltext", version: "v1" }); atts = [{ id: a.json.attachmentId, assetId: a.json.assetId }]; }
  }
  R._assetId = atts[0]?.assetId; R._paperId = paper?.id;
  R.steps.s1 = { channel, papers: paper ? 1 : 0, attachments: atts.length, paperId: paper?.id, assetId: R._assetId };
  R.steps.s1.pass = !!paper && atts.length >= 1 && !!R._assetId;
} catch (e) { R.steps.s1 = { channel: "UI", error: String(e).slice(0, 200), pass: false }; }

// ② 数据表导入（API）＋ 同字节去重
try {
  const a = await api("/api/import/measurements", { name: "darwin-flotation.csv", csv: CSV, topicId: T2 });
  const b = await api("/api/import/measurements", { name: "darwin-flotation.csv", csv: CSV, topicId: T2 });
  const st = await api("/api/state");
  const tables = st.json.tables.filter((t) => t.assetId === a.json?.assetId);
  const dedupe = b.status === 409 || (b.json?.created ?? []).length === 0 || b.json?.assetId === a.json?.assetId;
  R.steps.s2 = { channel: "API（本构建无表格导入 UI 入口）", first: { status: a.status, created: a.json?.created }, second: { status: b.status, body: b.json ?? b.text.slice(0, 120) }, tableCount: tables.length, dedupe };
  R.steps.s2.pass = a.status === 200 && (a.json?.created ?? 0) >= 1 && dedupe;
} catch (e) { R.steps.s2 = { channel: "API", error: String(e).slice(0, 200), pass: false }; }

// ③ 方案（重构来源＋来源原件）
let PROTO = null;
try {
  const p = await api("/api/protocols", {
    topicId: T2, name: "海水浸泡萌发试验（干燥 vs 新鲜 · R09 重构）", sourceKind: "reconstructed", sourceAssetId: R._assetId,
    purpose: "比较新鲜与干燥茎枝/果实海水中漂浮时长与浸后萌发（按达尔文 1859 原文重构）",
    criteria: "记录漂浮天数（新鲜 vs 干燥）与浸后是否萌发；未量化条件明示未知", unknowns: ["盐度未写明", "温度未写明"],
    steps: [
      { id: "s1", op: "采集带熟果茎枝与果实", params: {}, note: "", durationMin: null, estimated: false },
      { id: "s2", op: "干燥部分（保留新鲜对照）", params: {}, note: "", durationMin: null, estimated: false },
      { id: "s3", op: "置于海水浸泡并计时", params: {}, note: "盐度/温度原文未写明", durationMin: null, estimated: false },
    ],
  });
  PROTO = p.json?.protocolId;
  const st = await api("/api/state");
  const proto = st.json.protocols.find((x) => x.id === PROTO);
  R.steps.s3 = { channel: "API（方案表单存在，来源片段绑定走 API）", status: p.status, protocolId: PROTO, sourceKind: proto?.sourceKind, sourceAssetId: proto?.sourceAssetId, steps: proto?.revisions?.[0]?.steps?.length };
  R.steps.s3.pass = p.status === 200 && proto?.sourceKind === "reconstructed" && proto?.sourceAssetId === R._assetId;
} catch (e) { R.steps.s3 = { channel: "API", error: String(e).slice(0, 200), pass: false }; }

// ④ 执行：事件追加 + 样品状态 revision + 测量
try {
  const ex = await api("/api/executions", { topicId: T2, protocolId: PROTO });
  const EX = ex.json?.executionId;
  await api(`/api/executions/${EX}/confirm-preparation`, {});
  await api(`/api/executions/${EX}/events`, { kind: "start", text: "开始（R09）" });
  await api(`/api/executions/${EX}/events`, { kind: "step", stepId: "s3", text: "置于海水浸泡并计时", actual: { durationMin: 90 } });
  const smp = await api("/api/samples", { topicId: T2, executionId: EX, shortName: "S1", displayName: "干燥榛子", amount: { value: "94", unit: "粒" } });
  const SID = smp.json?.sampleId;
  await api(`/api/samples/${SID}/states`, { amount: { value: "94", unit: "粒" }, handling: "浸盐水后取出", use: "萌发观察" });
  const meas = await api("/api/measurements", { topicId: T2, sampleId: SID, method: "漂浮计时", value: "90", unit: "days" });
  const st = await api("/api/state");
  const exec = st.json.executions.find((x) => x.id === EX);
  const sample = st.json.samples.find((x) => x.id === SID);
  R.steps.s4 = { channel: "API", executionId: EX, events: exec?.events?.length, eventKinds: (exec?.events || []).map((e) => e.kind), sampleStates: sample?.states?.length, measurementId: meas.json?.measurementId };
  R.steps.s4.pass = !!EX && (exec?.events?.length ?? 0) >= 2 && (sample?.states?.length ?? 0) >= 1 && !!meas.json?.measurementId;
} catch (e) { R.steps.s4 = { channel: "API", error: String(e).slice(0, 200), pass: false }; }

// ⑤ 地图选一次（采纳，真实落库）＋ 对话
try {
  const card = await api("/api/cards", { assetId: R._assetId, rawText: "干燥后榛子漂浮 90 天后萌发（R09 导入）", sectionQuote: QUOTE, fields: { 对象: "榛子", 干燥: "90" }, conditions: ["海水浸泡"], reason: "R09 人工核对" });
  const CID = card.json?.cardId;
  const review = await api(`/api/cards/${CID}/review`, { audit: "confirm", importance: "high", reason: "R09 人工核对原文" });
  const st0 = await api("/api/state");
  const cardRec = st0.json.cards.find((x) => x.id === CID);
  const adopt = await api("/api/adoptions", { cardId: CID, subquestionId: SUBQ, decision: "adopt", reason: "与子问题直接相关（R09）" });
  const chat = await api("/api/chats", { topicId: T2, subquestionId: SUBQ, scope: [{ kind: "card", id: CID }] });
  const st = await api("/api/state");
  const ad = st.json.adoptions.find((x) => x.cardId === CID);
  const c = st.json.chats.find((x) => x.id === chat.json?.chatId);
  R.steps.s5 = { channel: "API", cardId: CID, cardAudit: cardRec?.audit, reviewStatus: review.status, adoptStatus: adopt.status, adoptBody: adopt.json ?? adopt.text.slice(0, 120), chatStatus: chat.status, chatBody: chat.json ?? chat.text.slice(0, 120), adoptionDecision: ad?.decision, adoptionId: adopt.json?.adoptionId, chatId: chat.json?.chatId, chatScope: c?.scope?.length };
  R.steps.s5.pass = ad?.decision === "adopt" && !!chat.json?.chatId;
} catch (e) { R.steps.s5 = { channel: "API", error: String(e).slice(0, 200), pass: false }; }

// UI 核对（刷新后按 T2 看各页对象）
try {
  await page.reload({ waitUntil: "networkidle" }); await unroll();
  if (await page.$("#topic-select")) await page.selectOption("#topic-select", T2).catch(() => {});
  await page.waitForTimeout(800);
  const seen = {};
  for (const k of ["papers", "protocol", "record", "analysis", "chat"]) {
    await nav(k);
    seen[k] = await page.evaluate(() => ({ list: [...document.querySelectorAll("#material-list .material")].map((e) => e.textContent.trim().replace(/\s+/g, " ").slice(0, 30)), mid: (document.querySelector("#mid-title")?.textContent || "").trim() }));
  }
  R.uiVerify = seen;
  await page.screenshot({ path: `${OUT}/screens/r09_ui.png` });
} catch (e) { R.uiVerify = { error: String(e).slice(0, 200) }; }

R.modelNote = "本脚本未触发模型调用（导入/记录/采纳/对话创建均为确定性接口）；真实模型待授权。";
R.summary = Object.fromEntries(Object.entries(R.steps).map(([k, v]) => [k, v.pass ? "PASS" : (v.error ? "ERROR" : "FAIL")]));
await browser.close();
fs.writeFileSync(`${OUT}/raw/r09_p8.json`, JSON.stringify(R, null, 2));
console.log(JSON.stringify({ summary: R.summary, steps: R.steps, uiVerify: R.uiVerify }, null, 2));