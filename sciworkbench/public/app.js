// LOCUS 三栏工作台前端（本地开发版）。
// 左：课题/子问题/材料与导入；中：原始材料（可高亮定位）；右：结构化结果与核对。
// 防护：所有写操作禁用按钮 + 处理中提示 + 内联错误 + 可重试；离开前脏检查。
import { api } from "./lib/api.js";
import { computeLanes, timeLabel } from "./lib/lanes.js";
import { fmtTime, fmtEnum, fmtVersion, fmtNameOnce } from "./lib/format.js";
import {
  topbarTopicHtml, emptyTopicGuideHtml, navHtml, panelErrorHtml, sidebarListHtml,
  topicOverviewHtml, topicTodosHtml, subqBlockHtml, nextStepHtml,
  knowledgeLeftHtml, knowledgeWorkspaceHtml, knowledgeQueueHtml, NAV_ITEMS,
} from "./lib/views.js";

let state = { topics: [], subquestions: [], assets: [], papers: [], attachments: [], cards: [], tables: [], adoptions: [], mappings: [], comparisons: [], protocols: [], templates: [], executions: [], samples: [], measurements: [], impacts: [], ocrs: [], analysisTasks: [], analysisResults: [], reports: [], chats: [] };
const ui = { nav: "topic", topicId: "", assetId: null, paperId: null, attId: null, tableId: null, highlight: null, cell: null, dirty: false, busy: false, cardFilter: "all", groupSel: new Set(), batch: null, ack: false, protocolId: null, executionId: null, stepSel: null, viewRev: null, editEventId: null, pauseSuggest: null, prepExtra: 0, taskId: null, chatId: null, reportId: null, navCollapsed: false, kzTab: "todo", cardOpen: null, kzJob: null };
let lastAction = null; // { label, run }

// A2 分区报错：只在触发它的面板内显示（left/mid/right），可关闭、带重试。
const errors = { left: null, mid: null, right: null };
const PANEL_OF = (el) => { const p = el?.closest?.(".pane"); return p ? (p.classList.contains("left") ? "left" : p.classList.contains("right") ? "right" : "mid") : "mid"; };

// 选择态持久（仅非敏感 UI 选择：页签/课题/材料/表块），刷新后归属正确。
const UI_KEY = "locus.ui.v2"; // 阶段5 重构：七入口导航，旧选择态作废，默认落课题首页
let uiRestored = false;
function saveUi() {
  try { localStorage.setItem(UI_KEY, JSON.stringify({ nav: ui.nav, topicId: ui.topicId, assetId: ui.assetId, paperId: ui.paperId, tableId: ui.tableId, cardFilter: ui.cardFilter, protocolId: ui.protocolId, executionId: ui.executionId, taskId: ui.taskId, chatId: ui.chatId, reportId: ui.reportId, navCollapsed: ui.navCollapsed })); } catch {}
}
function restoreUi() {
  if (uiRestored) return;
  uiRestored = true;
  try {
    const s = JSON.parse(localStorage.getItem(UI_KEY) ?? "null");
    if (!s) return;
    if (["topic", "papers", "knowledge", "protocol", "record", "analysis", "chat"].includes(s.nav)) ui.nav = s.nav;
    if (s.cardFilter === "all" || s.cardFilter === "pending" || s.cardFilter === "reviewed") ui.cardFilter = s.cardFilter;
    if (state.topics.some((t) => t.id === s.topicId)) ui.topicId = s.topicId;
    if (state.assets.some((a) => a.id === s.assetId)) ui.assetId = s.assetId;
    if (state.papers.some((p) => p.id === s.paperId)) ui.paperId = s.paperId;
    if (state.tables.some((t) => t.id === s.tableId)) ui.tableId = s.tableId;
    if (state.protocols.some((p) => p.id === s.protocolId)) ui.protocolId = s.protocolId;
    if (state.executions.some((e) => e.id === s.executionId)) ui.executionId = s.executionId;
    if (state.analysisTasks.some((t) => t.id === s.taskId)) ui.taskId = s.taskId;
    if (state.chats.some((c) => c.id === s.chatId)) ui.chatId = s.chatId;
    if (state.reports.some((r) => r.id === s.reportId)) ui.reportId = s.reportId;
    if (typeof s.navCollapsed === "boolean") ui.navCollapsed = s.navCollapsed;
  } catch {}
}

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
/** 把任意字符串里的 ISO 时间替换成本地短格式（用于服务端生成的摘要文本）。 */
const deIso = (s) => String(s ?? "").replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, (m) => fmtTime(m));
/** 服务端摘要文本里可能夹带的英文枚举/裸版本 → 中文（仅用于展示）。 */
const humanVer = (s) => String(s ?? "")
  .replace(/rev (\d+)/g, "第$1版")
  .replace(/ai-draft/g, "模型草稿").replace(/reconstructed/g, "重构")
  .replace(/unreviewed/g, "待审").replace(/need_info/g, "待补")
  .replace(/exploratory/g, "探索中").replace(/declared/g, "已定")
  .replace(/confirm/g, "已确认").replace(/exclude/g, "已排除").replace(/\bskip\b/g, "已跳过");
const topicName = (id) => state.topics.find((t) => t.id === id)?.name;

async function refresh() {
  state = await api.getState();
  restoreUi();
  if (ui.assetId && !state.assets.some((a) => a.id === ui.assetId)) ui.assetId = null;
  if (ui.tableId && !state.tables.some((t) => t.id === ui.tableId)) ui.tableId = null;
  if (ui.topicId && !state.topics.some((t) => t.id === ui.topicId)) ui.topicId = "";
  // A1：有课题即自动落到第一个（单课题自动选中；多课题默认首项，可页头切换）；无课题由中间区引导创建。
  if (!ui.topicId && state.topics.length >= 1) ui.topicId = state.topics[0].id;
  if (ui.protocolId && !state.protocols.some((p) => p.id === ui.protocolId)) ui.protocolId = null;
  if (ui.executionId && !state.executions.some((e) => e.id === ui.executionId)) ui.executionId = null;
  if (ui.paperId && !state.papers.some((p) => p.id === ui.paperId)) { ui.paperId = null; ui.attId = null; }
  if (ui.attId && !state.attachments.some((a) => a.id === ui.attId)) ui.attId = null;
  if (ui.taskId && !state.analysisTasks.some((t) => t.id === ui.taskId)) ui.taskId = null;
  if (ui.chatId && !state.chats.some((c) => c.id === ui.chatId)) ui.chatId = null;
  if (ui.reportId && !state.reports.some((r) => r.id === ui.reportId)) ui.reportId = null;
  renderAll();
}

function setStatus(m) { $("#status").textContent = m; }

/** 按 BOM 解码文本文件（UTF-8 / UTF-16LE / UTF-16BE），避免 UTF-16 仪器导出被误判。 */
async function readTextFile(file) {
  const buf = await file.arrayBuffer();
  const u8 = new Uint8Array(buf);
  let enc = "utf-8";
  if (u8[0] === 0xff && u8[1] === 0xfe) enc = "utf-16le";
  else if (u8[0] === 0xfe && u8[1] === 0xff) enc = "utf-16be";
  return new TextDecoder(enc).decode(buf).replace(/^\uFEFF/, "");
}
/** 人话错误：把原始报错翻译成可读文案，原始信息进「详情」。 */
function humanError(e) {
  const raw = String(e?.message ?? e ?? "");
  if (/fetch failed|Failed to fetch|NetworkError|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(raw)) return { message: "连不上服务或模型，请检查网络与地址。", detail: raw };
  if (/401|403|unauthor|key/i.test(raw)) return { message: "认证失败：请检查 Key。", detail: raw };
  if (/429/.test(raw)) return { message: "请求过多（限流），请稍后重试。", detail: raw };
  if (/timeout|超时/i.test(raw)) return { message: "请求超时，请重试或调大超时。", detail: raw };
  return { message: raw || "操作失败。", detail: raw };
}
function setError(panel, err) { errors[panel] = err; renderErrors(); }
const notify = (panel, message, detail) => setError(panel, { panel, message, detail: detail ?? "", retry: null });
function clearError(panel) { errors[panel] = null; renderErrors(); }
function clearAllErrors() { errors.left = errors.mid = errors.right = null; renderErrors(); }
function renderErrors() {
  for (const p of ["left", "mid", "right"]) { const el = $("#err-" + p); if (el) el.innerHTML = panelErrorHtml(errors[p]); }
}

/** 证据可达：科学改动后，就地提示命中的报告块/分析（需复核，不自动改）。失败不阻断保存。 */
async function noteChangeHits(kind, id, fields) {
  if (!fields || !fields.length) return;
  let r;
  try { r = await api.changeHits(kind, id, { fields }); } catch { return; }
  if (r.category !== "needs_review") { setStatus("改动已保存（标题/备注：无需重算）"); return; }
  const blocks = r.byKind?.block ?? [];
  const tasks = r.byKind?.task ?? [];
  const results = r.byKind?.result ?? [];
  if (!blocks.length && !tasks.length && !results.length) { setStatus("改动已保存（暂无引用它的分析/报告块）"); return; }
  const parts = [];
  if (blocks.length) parts.push(`报告块 ${blocks.length}`);
  if (tasks.length) parts.push(`分析任务 ${tasks.length}`);
  if (results.length) parts.push(`结果 ${results.length}`);
  const rep = blocks.length ? state.reports.find((rp) => rp.blocks.some((bl) => bl.id === blocks[0].id)) : null;
  setError("right", { panel: "right", message: `改数值命中：${parts.join("、")}（需复核，不自动改）`, detail: (r.hits ?? []).map((h) => h.reason).join("\n"), retry: rep ? () => { clearAllErrors(); ui.nav = "analysis"; ui.reportId = rep.id; if (rep.taskId) ui.taskId = rep.taskId; renderAll(); } : null });
}

/** 所有写操作：禁用按钮 + 处理中 + 错误内联 + 可重试。 */
async function runBusy(btn, label, fn) {
  if (ui.busy) return;
  ui.busy = true;
  const panel = PANEL_OF(btn); clearError(panel);
  const old = btn?.textContent; if (btn) { btn.disabled = true; btn.textContent = "处理中…"; }
  lastAction = { label, run: () => runBusy(btn, label, fn) };
  setStatus(`${label}…`);
  try { await fn(); }
  catch (e) { const h = humanError(e); setError(panel, { panel, message: `${label}失败：${h.message}`, detail: h.detail, retry: lastAction.run }); }
  finally { ui.busy = false; if (btn) { btn.disabled = false; btn.textContent = old; } }
}

/** 后台 job 专用：只禁用发起按钮，不锁全局——等待期可继续编辑（后端合并写回保证不覆盖）。 */
async function runJob(btn, label, fn) {
  const panel = PANEL_OF(btn); clearError(panel);
  const old = btn?.textContent; if (btn) { btn.disabled = true; btn.textContent = "后台运行中…"; }
  setStatus(`${label}…`);
  try { await fn(); }
  catch (e) { const h = humanError(e); setError(panel, { panel, message: `${label}失败：${h.message}`, detail: h.detail, retry: () => runJob(btn, label, fn) }); }
  finally { if (btn) { btn.disabled = false; btn.textContent = old; } }
}

function currentAsset() { return state.assets.find((a) => a.id === ui.assetId) ?? null; }

/** 切换前脏检查；返回 true 表示可离开。 */
function guardLeave() {
  if (!ui.dirty) return true;
  if (confirm("当前有未保存的编辑，确定离开？未保存内容会丢失。")) { ui.dirty = false; return true; }
  return false;
}

function renderAll() {
  if ($("#status").textContent === "连接中…") setStatus("就绪");
  renderShell();
  renderMiddle(); renderRight();
  saveUi();
}

/** 外壳：页头当前课题、侧栏（导航＋本页列表）、中间「＋新建」区、分区报错。 */
function renderShell() {
  $("#curtopic").innerHTML = topbarTopicHtml(state, ui);
  const kz = ui.nav === "knowledge";
  if (!kz) ui.kzJob = null;
  if (kz && !ui.paperId && state.papers.length) ui.paperId = state.papers[0].id;
  // B5：进入分析页自动打开最近的分析任务
  if (ui.nav === "analysis" && !ui.taskId) {
    const ts = state.analysisTasks.filter((t) => !ui.topicId || t.topicId === ui.topicId).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (ts.length) ui.taskId = ts[0].id;
  }
  document.querySelector(".app").classList.toggle("mode-knowledge", kz);
  $("#navrail").hidden = !kz;
  $("#nav").hidden = kz;
  if (kz) $("#navrail").innerHTML = navHtml(ui, false); else $("#nav").innerHTML = navHtml(ui, ui.navCollapsed);
  $("#nav").classList.toggle("collapsed", !!ui.navCollapsed);
  $("#kz-left").hidden = !kz;
  if (kz) $("#kz-left").innerHTML = knowledgeLeftHtml(state, ui);
  $("#sec-materials").hidden = kz || ui.nav === "topic";
  $("#materials-title").textContent = { papers: "论文条目", protocol: "方案", record: "执行", analysis: "分析任务", chat: "对话会话" }[ui.nav] ?? "材料";
  $("#material-list").innerHTML = kz ? "" : sidebarListHtml(state, ui);
  renderCreateArea();
  renderErrors();
}

/** 中间「＋新建」区：本页的新建/上传表单与工具（不再放侧栏）。 */
function renderCreateArea() {
  const box = $("#create-area"), tools = $("#tools-area");
  if (ui.nav === "topic") { box.innerHTML = ""; tools.innerHTML = ""; return; }
  box.innerHTML = ""; tools.innerHTML = "";
  renderImportBox(box);
  renderLitTools(tools);
}

function renderImportBox(box) {
  if (ui.nav === "papers") { renderPaperForm(box); return; }
  if (ui.nav === "knowledge") { renderKnowledgeForm(box); return; }
  if (ui.nav === "protocol") { renderProtocolImport(box); return; }
  if (ui.nav === "record") { renderRecordImport(box); return; }
  if (ui.nav === "analysis") { renderAnalysisForm(box); return; }
  if (ui.nav === "chat") { renderChatForm(box); return; }
  box.innerHTML = "";
}
function renderMiddle() {
  const note = $("#mid-note"), content = $("#mid-content");
  content.classList.toggle("kzw", ui.nav === "knowledge");
  if (ui.nav === "topic") {
    $("#mid-title").textContent = "课题";
    note.hidden = true;
    content.innerHTML = state.topics.length
      ? topicOverviewHtml(state, ui) + subqBlockHtml(state, ui)
      : emptyTopicGuideHtml();
    return;
  }
  if (ui.nav === "papers") {
    const p = currentPaper();
    const att = currentAttachment();
    $("#mid-title").textContent = att ? `附件原文 · ${state.assets.find((a) => a.id === att.assetId)?.name ?? ""}` : "附件原文";
    if (!p) { note.hidden = true; content.textContent = "在左栏选择或新建论文条目。"; return; }
    if (!att) { note.hidden = false; note.textContent = "无附件；右栏导入（只归档）。"; content.textContent = ""; return; }
    const asset = state.assets.find((a) => a.id === att.assetId);
    note.hidden = false; note.textContent = `角色：${ROLE_LABEL[att.role]}${att.version ? " · 版本 " + att.version : ""} · 原件 ${asset?.bytes ?? 0}B`;
    content.innerHTML = esc(asset?.text ?? "");
    return;
  }
  if (ui.nav === "knowledge") {
    $("#mid-title").textContent = "卡片审阅";
    note.hidden = true;
    content.innerHTML = knowledgeWorkspaceHtml(state, ui);
    return;
  }
  if (ui.nav === "protocol") {
    $("#mid-title").textContent = "实验图";
    note.hidden = true;
    content.innerHTML = protocolMainHtml();
    return;
  }
  if (ui.nav === "record") {
    const a = currentAsset();
    if (a && a.kind === "image") {
      $("#mid-title").textContent = `原始图片 · ${a.name}`;
      note.hidden = false; note.textContent = "原图归档；识别在右栏，须确认。";
      content.innerHTML = `<img class="ocrimg" src="${a.text}" alt="${esc(a.name)}" />`;
      return;
    }
    const e = currentExecution();
    if (!e) { note.hidden = true; $("#mid-title").textContent = "执行记录"; content.textContent = "在左栏选择执行，或选择手写图片。"; return; }
    const p = state.protocols.find((x) => x.id === e.protocolId);
    const snap = e.preparation?.snapshot ?? p?.revisions.find((r) => r.revision === (e.preparation?.baseRevision ?? e.protocolRevision));
    if ((e.phase ?? "recording") === "preparing") {
      $("#mid-title").textContent = "准备稿";
      note.hidden = false;
      note.textContent = `准备稿（未确认）：差异与确认在右栏；确认后进入步骤记录。`;
      content.textContent = snap ? fmtSnapshot(snap) : "（方案快照缺失）";
      return;
    }
    $("#mid-title").textContent = "步骤记录表";
    note.hidden = true;
    content.innerHTML = `<div class="item">${stepsTableHtml(e, snap)}</div>` + impactHtml([e.id]);
    return;
  }
  if (ui.nav === "analysis") {
    const t = currentTask();
    $("#mid-title").textContent = t ? `上下文地图 · ${t.title}` : "上下文地图";
    if (!t) { note.hidden = true; content.textContent = "在左栏选择或创建分析任务。"; return; }
    note.hidden = false;
    note.textContent = t.snapshot
      ? `快照已冻结（hash ${t.snapshot.hash.slice(0, 12)}…）；改候选不回改旧快照。`
      : "未冻结：推荐时按核心＋候选＋目的冻结发送内容。";
    content.innerHTML = contextMapHtml(t);
    return;
  }
  if (ui.nav === "chat") {
    const c = currentChat();
    $("#mid-title").textContent = c ? "上下文对话" : "上下文对话";
    if (!c) { note.hidden = true; content.textContent = "在左栏选择或创建对话会话。"; return; }
    note.hidden = false;
    note.textContent = `范围：${c.subquestionId ? "子问题 ＋ " : ""}${c.scope.length} 对象；发送即冻结快照。讨论不改对象；采纳需确认。`;
    content.innerHTML = chatHtml(c);
    return;
  }
  note.hidden = true;
  $("#mid-title").textContent = "原始材料";
  content.textContent = "在左栏选择工作对象。";
}
function renderRight() {
  if (ui.nav === "topic") { $("#right-title").textContent = "下一步与待办"; $("#right-content").innerHTML = nextStepHtml(state, ui) + topicTodosHtml(state, ui); return; }
  if (ui.nav === "papers") { $("#right-title").textContent = "条目与附件"; $("#right-content").innerHTML = paperHtml(); return; }
  if (ui.nav === "knowledge") {
    $("#right-title").textContent = "AI 待审队列";
    $("#right-content").innerHTML = knowledgeQueueHtml(state, ui);
    return;
  }
  if (ui.nav === "protocol") { $("#right-title").textContent = "方案信息"; $("#right-content").innerHTML = protocolSideHtml(); return; }
  if (ui.nav === "record") { $("#right-title").textContent = "实验记录"; $("#right-content").innerHTML = recordHtml(); return; }
  if (ui.nav === "analysis") { $("#right-title").textContent = "推荐 · 结果 · 分析初稿"; $("#right-content").innerHTML = analysisRightHtml(); return; }
  if (ui.nav === "chat") { $("#right-title").textContent = "范围 · 来源 · 采纳"; $("#right-content").innerHTML = chatRightHtml(); return; }
  $("#right-title").textContent = "结构化结果";
  $("#right-content").innerHTML = `<p class="hint">在左栏选择工作对象。</p>`;
}
/** 候选库状态（与后端 candidateStateOf 同口径）：跳过保未复核；采用独立于核对。 */
const ROLE_LABEL = { fulltext: "正文", supplement: "补充材料", other: "其他" };


// ── 阶段5 第一段：课题首页 / 文献整理 / 领域知识积累 ─────────────

function currentPaper() { return state.papers.find((p) => p.id === ui.paperId) ?? null; }
function currentAttachment() {
  const p = currentPaper(); if (!p) return null;
  const atts = state.attachments.filter((a) => a.paperId === p.id);
  return atts.find((a) => a.id === ui.attId) ?? atts[0] ?? null;
}


/** 409 不死路：给出已有条目定位按钮（用分区报错承载）。 */
function showLocate(msg, paperId) {
  setError("right", { panel: "right", message: msg, detail: "", retry: paperId ? () => { clearAllErrors(); ui.paperId = paperId; ui.attId = null; renderAll(); } : null });
}

function renderPaperForm(box) {
  box.innerHTML = `
    <details class="mini" ${state.papers.length ? "" : "open"}>
      <summary>新建论文条目（题名必填）</summary>
      <input id="pp-title" placeholder="题名（必填）" />
      <input id="pp-authors" placeholder="作者（and 或分号分隔）" />
      <div class="row"><input id="pp-year" placeholder="年份" /><input id="pp-doi" placeholder="DOI（可空）" /></div>
      <input id="pp-source" placeholder="来源（期刊/预印本/网址）" />
      <input id="pp-license" placeholder="许可（如 CC BY 4.0；未提供留空，不补造）" />
      <button class="primary" id="pp-create">创建条目</button>
      <p class="hint">条目是题录身份，不是文件；附件在右栏导入，收藏不触发 AI 解析。</p>
    </details>`;
  $("#pp-create").addEventListener("click", (ev) => runBusy(ev.target, "创建论文条目", async () => {
    try {
      const r = await api.createPaper({
        title: $("#pp-title").value, authors: $("#pp-authors").value, year: $("#pp-year").value,
        doi: $("#pp-doi").value, source: $("#pp-source").value, license: $("#pp-license").value,
        topicIds: ui.topicId ? [ui.topicId] : [],
      });
      ui.paperId = r.paperId; ui.attId = null; await refresh(); setStatus("论文条目已创建（未解析）");
    } catch (e) {
      if (e.status === 409 && e.details?.existingPaperId) { showLocate(e.message, e.details.existingPaperId); return; }
      throw e;
    }
  }));
}

/** 右栏：条目元信息（修订留历史）＋附件管理＋课题关联＋去知识提取。 */
function paperHtml() {
  const p = currentPaper();
  if (!p) return `<p class="hint">在左栏选择论文条目；或新建条目/导入题录。</p>`;
  const atts = state.attachments.filter((a) => a.paperId === p.id);
  const nCard = state.cards.filter((c) => c.paperId === p.id).length;
  return `
    <div class="item" data-id="${p.id}">
      <div class="meta">题录 · ${nCard} 张知识卡</div>
      <div class="row"><label>题名</label><input data-field="pTitle" value="${esc(p.title)}" /></div>
      <div class="row"><label>作者</label><input data-field="pAuthors" value="${esc(p.authors.join(" and "))}" /></div>
      <div class="row"><label>年份</label><input data-field="pYear" value="${esc(p.year)}" /><label>DOI</label><input data-field="pDoi" value="${esc(p.doi)}" /></div>
      <div class="row"><label>来源</label><input data-field="pSource" value="${esc(p.source)}" /></div>
      <div class="row"><label>许可</label><input data-field="pLicense" value="${esc(p.license)}" placeholder="未提供留空" /></div>
      <div class="row"><label>备注</label><input data-field="pNote" value="${esc(p.note)}" /></div>
      <div class="row"><input data-field="pReason" placeholder="修改原因（修订留历史）" />
        <button class="primary" id="paper-save">保存题录</button><button class="history-btn">历史(${p.history.length})</button></div>
      <div class="pane-title">课题关联（可多课题引用）</div>
      ${state.topics.length ? state.topics.map((t) => `<label class="cmppick"><input type="checkbox" class="paper-topic" value="${t.id}" ${p.topicIds.includes(t.id) ? "checked" : ""}/> ${esc(t.name)}</label>`).join("") : `<p class="hint">暂无课题；先在「课题展示」创建。</p>`}
      <div class="row"><button class="primary goto" data-goto="knowledge" data-paper="${p.id}">去知识提取（选目的后发起）</button></div>
    </div>
    <div class="item">
      <div class="meta">附件（${atts.length}）· 导入只归档，不触发解析</div>
      ${atts.map((a) => {
        const asset = state.assets.find((x) => x.id === a.assetId);
        return `<div class="material ${a.id === (currentAttachment()?.id ?? "") ? "active" : ""}" data-attid="${a.id}">
          <div class="m-title">${esc(asset?.name ?? a.assetId)}</div>
          <div class="m-meta">${ROLE_LABEL[a.role]}${a.version ? " · " + esc(a.version) : ""} · ${asset?.bytes ?? 0}B</div>
        </div>`;
      }).join("") || `<p class="hint">暂无附件。</p>`}
      <details class="mini">
        <summary>导入附件（Markdown/纯文本）</summary>
        <input id="att-file" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" />
        <textarea id="att-text" rows="3" placeholder="或粘贴文本…"></textarea>
        <div class="row"><select id="att-role"><option value="fulltext">正文</option><option value="supplement">补充材料</option><option value="other">其他</option></select>
          <input id="att-version" placeholder="版本（可空，如 v2）" /></div>
        <button class="primary" id="att-add">导入附件</button>
        <p class="hint">同 DOI 的不同附件/版本不互拒；真重复（同内容）会给出已有原件定位。PDF 等格式解析器未配置。</p>
      </details>
    </div>`;
}

/** 左栏：知识提取发起（目的必填）＋机械草稿调试入口（明确标记）。 */
function renderKnowledgeForm(box) {
  const p = currentPaper();
  const atts = p ? state.attachments.filter((a) => a.paperId === p.id) : [];
  const subqs = state.subquestions.filter((q) => !ui.topicId || q.topicId === ui.topicId);
  box.innerHTML = `
    <details class="mini" open>
      <summary>语义提取（选文献＋目的）</summary>
      ${p ? `<div class="hint">当前文献：${esc(p.title)}</div>
        ${atts.length ? atts.map((a) => `<label class="cmppick"><input type="checkbox" class="k-att" value="${a.id}" checked/> ${esc(state.assets.find((x) => x.id === a.assetId)?.name ?? a.assetId)}（${ROLE_LABEL[a.role]}）</label>`).join("") : `<p class="hint warn">该条目无附件；先到「文献整理」导入。</p>`}
        <textarea id="k-purpose" rows="2" placeholder="研究目的（必填）：围绕哪个研究问题提取？如：比较 pH 对 Km 的影响"></textarea>
        ${subqs.length ? `<select id="k-subq"><option value="">（不挂子问题）</option>${subqs.map((q) => `<option value="${q.id}">${esc(q.question)}</option>`).join("")}</select>` : ""}
        <button class="primary" id="k-start" ${atts.length ? "" : "disabled"}>发起语义提取（独立 AI 任务）</button>
        <p class="hint">抽取单位是研究意义（数据＋条件/方法、结论＋依据、思路），不是逐行拆文本；结果进右栏待审区，须人工核对。等待期间可继续编辑，不会被覆盖。</p>`
      : `<p class="hint">先在下方选择文献条目（或到「文献整理」新建）。</p>`}
    </details>
    <details class="mini">
      <summary>机械草稿（开发调试）</summary>
      <input id="dbg-name" placeholder="文件名" />
      <textarea id="dbg-text" rows="2" placeholder="粘贴文本：逐段拆分为草稿卡，全部标记 mechanical"></textarea>
      <button id="dbg-import">导入机械草稿</button>
    </details>`;
  const start = $("#k-start");
  if (start) start.addEventListener("click", (ev) => runJob(ev.target, "语义知识提取", async () => {
    const attachmentIds = [...$$(".k-att")].filter((x) => x.checked).map((x) => x.value);
    const r = await api.knowledgeJob({ paperId: p.id, attachmentIds, purpose: $("#k-purpose").value, topicId: ui.topicId || undefined, subquestionId: $("#k-subq")?.value || undefined });
    ui.kzJob = { id: r.jobId, status: "running", done: 0, total: r.total ?? 0, created: 0, chunkErrors: [], message: "语义提取中…" };
    renderRight();
    const job = await pollKnowledgeJob(r.jobId);
    await refreshAfterJob();
    setStatus(job.status === "done" ? job.message : `知识提取失败：${job.error ?? ""}`);
  }));
  $("#dbg-import").addEventListener("click", (ev) => runBusy(ev.target, "导入机械草稿", async () => {
    const r = await api.importLiterature($("#dbg-name").value || "debug.md", $("#dbg-text").value, "draft", ui.topicId || undefined);
    await refresh(); setStatus(`机械草稿已导入：${r.created} 张（全部标记 mechanical，仅供调试）`);
  }));
}

/** 左栏文献工具：命名映射 + 条件比较（仅文献导航显示）。 */
function renderLitTools(box) {
  if (ui.nav === "record") { renderRecordTools(box); return; }
  if (ui.nav === "papers") {
    box.innerHTML = `
      <details class="mini">
        <summary>题录导入（Zotero 导出）</summary>
        <select id="bib-format"><option value="bibtex">BibTeX（.bib）</option><option value="csl-json">CSL-JSON（Zotero 导出）</option></select>
        <textarea id="bib-text" rows="4" placeholder="粘贴题录内容；同 DOI 已有条目会跳过并给定位"></textarea>
        <button class="primary" id="bib-import">导入题录</button>
        <p class="hint">Zotero 三模式如实区分：题录导入（本功能）/ 附件导入（右栏上传）/ 实时连接（未验证、未实现，不做假入口）。</p>
      </details>`;
    $("#bib-import").addEventListener("click", (ev) => runBusy(ev.target, "导入题录", async () => {
      const r = await api.importBibliography($("#bib-format").value, $("#bib-text").value);
      $("#bib-text").value = "";
      if (r.created?.length) ui.paperId = r.created[0];
      await refresh();
      setStatus(`题录导入：新建 ${r.created?.length ?? 0} 条${r.skipped?.length ? `，跳过同 DOI ${r.skipped.length} 条（已有条目可定位）` : ""}`);
    }));
    return;
  }
  if (ui.nav !== "knowledge") { box.innerHTML = ""; return; }
  const maps = state.mappings.filter((m) => !ui.topicId || !m.topicId || m.topicId === ui.topicId);
  const cmps = state.comparisons.filter((c) => !ui.topicId || c.topicId === ui.topicId);
  const confirmed = state.cards.filter((c) => c.audit === "confirm" && (!ui.topicId || state.assets.find((a) => a.id === c.assetId)?.topicId === ui.topicId || state.papers.find((p) => p.id === c.paperId)?.topicIds.includes(ui.topicId)));
  const DIV = { single: "单源", consistent: "一致", value_diff: "值分歧", conditions_diff: "条件差异" };
  box.innerHTML = `
    <details class="mini" id="map-box">
      <summary>命名映射（${maps.length}）</summary>
      ${maps.map((m) => `<div class="hint">${esc(m.original)} → ${esc(m.mapped)}（依据：${esc(m.basis)}）</div>`).join("") || `<p class="hint">暂无映射。原名保留，映射须有依据。</p>`}
      <div class="row"><input id="map-original" placeholder="原名" /><input id="map-mapped" placeholder="映射名" /></div>
      <div class="row"><input id="map-basis" placeholder="来源依据（必填）" /><button id="map-create">添加映射</button></div>
    </details>
    <details class="mini" id="cmp-box">
      <summary>条件比较（${cmps.length}）</summary>
      ${ui.topicId ? `
        <div class="hint">仅已确认证据卡可入比较；快照固定卡版本，不自动合并/平均。</div>
        ${confirmed.length ? confirmed.map((c) => `<label class="cmppick"><input type="checkbox" class="cmp-card" value="${c.id}" /> ${esc(c.rawText.slice(0, 40))}（第${c.revision}版）</label>`).join("") : `<p class="hint">本课题暂无已确认证据卡。</p>`}
        <div class="row"><input id="cmp-filters" placeholder="筛选（逗号分隔）" /><input id="cmp-conversions" placeholder="换算（逗号分隔）" /></div>
        <div class="row"><input id="cmp-exclusions" placeholder="排除（逗号分隔）" /><button class="primary" id="cmp-create">固定快照比较</button></div>
      ` : `<p class="hint">先选课题。</p>`}
      ${cmps.map((cmp) => `
        <div class="item cmp" data-id="${cmp.id}">
          <div class="meta">快照 ${esc(fmtTime(cmp.snapshot.pinnedAt))}${cmp.reviewFlags.length ? ` · <span class="badge warn">需复核（${cmp.reviewFlags.length} 张卡已修改）</span>` : ""}</div>
          <div class="hint">口径：筛选[${cmp.snapshot.filters.map(esc).join("、") || "—"}] 换算[${cmp.snapshot.conversions.map(esc).join("、") || "—"}] 排除[${cmp.snapshot.exclusions.map(esc).join("、") || "—"}]</div>
          ${cmp.groups.map((g) => `<div class="cmpgroup">
            <strong>${esc(g.name)}</strong> <span class="badge div-${g.divergence}">${DIV[g.divergence]}</span>
            ${g.entries.map((e) => `<div class="hint">${esc(e.value)}${e.unit ? " " + esc(e.unit) : ""} · 条件[${e.conditions.map(esc).join("、") || "—"}] · 卡${esc(e.cardId.slice(5, 13))} rev${e.cardRevision}${e.originalName !== e.mappedName ? `（原名 ${esc(e.originalName)}）` : ""}</div>`).join("")}
            ${g.unresolved.map((u) => `<div class="hint warn">${esc(u)}</div>`).join("")}
          </div>`).join("")}
          <div class="row"><button class="cmp-again" data-id="${cmp.id}">按当前版本重新比较（新快照）</button></div>
        </div>`).join("")}
    </details>`;
}

let foldEmpty = true;
/** 表格渲染（中间/最大化共用）：全空行只在展示层折叠，零值与标记行不折叠，原件字节不改。 */
function tableGridHtml(t, big) {
  const markers = new Set(t.markerRows ?? []);
  const isEmptyRow = (r) => (r ?? []).every((c) => String(c ?? "").trim() === "");
  const folded = [];
  const rows = t.rows.map((r, ri) => {
    const isMarker = markers.has(ri);
    if (!isMarker && isEmptyRow(r) && foldEmpty) { folded.push(ri + 1); return ""; }
    return `<tr${isMarker ? ` class="marker" title="块标记行：原件中的分块标题（非测量行），保留原样"` : ""}>${t.columns.map((_, ci) => `<td class="cell" data-row="${ri}" data-col="${ci}">${esc(r[ci] ?? "")}</td>`).join("")}</tr>`;
  }).join("");
  const note = folded.length
    ? `<p class="hint">已折叠 ${folded.length} 个全空行（仅展示层；原件字节未改，零值与标记行不折叠）：第 ${folded.slice(0, 12).join("、")}${folded.length > 12 ? "…" : ""} 行</p>`
    : "";
  return { html: `<div class="tablewrap${big ? " big" : ""}"><table class="grid"><thead><tr>${t.columns.map((n) => `<th>${esc(n)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>${note}`, folded: folded.length };
}
function openTableMax(tid) {
  const t = state.tables.find((x) => x.id === tid); if (!t) return;
  document.querySelector("#table-max")?.remove();
  const asset = state.assets.find((a) => a.id === t.assetId);
  const markers = new Set(t.markerRows ?? []);
  const cell = ui.cell && ui.cell.tableId === t.id ? ui.cell : null;
  const wrap = document.createElement("div");
  wrap.id = "table-max"; wrap.className = "item"; wrap.dataset.id = t.id;
  wrap.innerHTML = `
    <div class="tblmax-head"><strong>${esc(t.name)}</strong> <span class="hint">${t.rows.length} 行（${t.rows.length - markers.size} 数据 · ${markers.size} 标记）× ${t.columns.length} 列 · 原件 ${asset?.bytes ?? 0}B</span>
      <button id="tblmax-fold">${foldEmpty ? "展开全空行" : "折叠全空行"}</button>
      <button id="tblmax-csv">查看原始 CSV</button>
      <button id="tblmax-close">关闭</button></div>
    <div class="tblmax-body">
      ${tableGridHtml(t, true).html}
      <div id="tblmax-raw" hidden><pre>${esc(asset?.text ?? "")}</pre></div>
      ${cell ? `<div class="row celledit"><label>单元格 r${cell.row}·c${cell.col}</label>
        <input data-field="cellValue" value="${esc(t.rows[cell.row]?.[cell.col] ?? "")}" />
        <input data-field="cellReason" placeholder="更正原因（必填）" />
        <button class="save-cell">保存单元格</button><button class="cancel-cell">取消</button></div>` : `<p class="hint">点单元格可更正；改值需原因。</p>`}
      <details class="mini"><summary>列设置（单位 / 核对）</summary>
        <div class="tablewrap"><table class="grid"><thead><tr>${t.columns.map((name, i) => `<th><div>${esc(name)}</div>
          <input data-col="${i}" data-k="unit" value="${esc(t.columnMeta[i].unit)}" placeholder="单位" />
          <select data-col="${i}" data-k="decision">${[["unreviewed", "待审"], ["confirm", "已确认"], ["need_info", "待补"]].map(([v, l]) => `<option value="${v}" ${v === t.columnMeta[i].decision ? "selected" : ""}>${l}</option>`).join("")}</select></th>`).join("")}</tr></thead></table></div>
      </details>
      <div class="row"><label>备注</label><input data-field="note" value="${esc(t.note)}" />
        <label>原因</label><input data-field="reason" placeholder="改单元格数值时必填" />
        <button class="save-cols">保存列设置</button><button class="history-btn">历史(${t.history.length})</button></div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.querySelector("#tblmax-close").onclick = () => { ui.cell = null; wrap.remove(); };
  wrap.querySelector("#tblmax-fold").onclick = () => { foldEmpty = !foldEmpty; saveUi(); openTableMax(tid); };
  wrap.querySelector("#tblmax-csv").onclick = () => { const r = wrap.querySelector("#tblmax-raw"); r.hidden = !r.hidden; };
  wrap.querySelector(".tblmax-body").addEventListener("click", (ev) => {
    const td = ev.target.closest("td.cell"); if (!td) return;
    ev.stopPropagation();
    ui.cell = { tableId: tid, row: Number(td.dataset.row), col: Number(td.dataset.col) };
    openTableMax(tid);
  });
}

// ── 4C：方案 / 实验图 / 模板 / 执行 / 样品 / 测量 / 影响 / OCR ──

function currentProtocol() { return state.protocols.find((p) => p.id === ui.protocolId) ?? null; }
function currentExecution() { return state.executions.find((e) => e.id === ui.executionId) ?? null; }
function viewSnapshot(p) { return p.revisions.find((r) => r.revision === (ui.viewRev ?? p.revision)) ?? p.revisions[p.revisions.length - 1]; }

function fmtSnapshot(s) {
  const lines = [`目的：${s.purpose || "（未写）"}`, `输入：${s.inputs.join("、") || "（未写）"}`, "步骤："];
  const L = computeLanes(s.steps);
  const mainById = new Map(L.main.map((m) => [m.step.id, m]));
  for (const st of s.steps) {
    const dur = st.durationMin === null ? "时长未知" : `${st.durationMin}min${st.estimated ? "（估计）" : ""}`;
    const branch = st.branch ? `［支路:${st.branch}］` : "";
    if (!st.branch) {
      const m = mainById.get(st.id);
      lines.push(`  ${timeLabel(m.offset, m.approx)}  ${st.op}  ${dur}${st.observeEnd ? `  终点:${st.observeEnd}` : ""}`);
    } else {
      const anchors = st.branchFrom || st.mergeInto ? `［分叉自:${st.branchFrom ?? "未指定"} / 汇合入:${st.mergeInto ?? "未指定"}］` : "";
      lines.push(`  ${st.op}  ${dur}${branch}${anchors}${st.observeEnd ? `  终点:${st.observeEnd}` : ""}`);
    }
    for (const [k, v] of Object.entries(st.params)) lines.push(`      ${k}=${v}`);
    if (st.note) lines.push(`      注：${st.note}`);
  }
  if (L.unknownCount) lines.push(`（主线有 ${L.unknownCount} 步时长未知：其后偏移为下界 t≥，未按零累计；已知总时长 ${L.totalKnown}min）`);
  lines.push(`条件：${s.conditions.join("、") || "（未写）"}`, `判据：${s.criteria || "（未写）"}`);
  if (s.unknowns.length) lines.push(`未知项：${s.unknowns.join("、")}`);
  if (s.sourceFragments.length) lines.push("方法来源片段：", ...s.sourceFragments.map((f) => `  「${f}」`));
  lines.push(`（${fmtVersion(s.revision)} · ${fmtTime(s.at)} · 原因：${s.reason}）`);
  return lines.join("\n");
}

/** 步骤行格式：操作 | 时长分钟(可空) | 支路名(可空) | est(可空) */
function parseStepsText(text) {
  return String(text ?? "").split(/\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [op, dur, branch, est] = l.split("|").map((x) => (x ?? "").trim());
    return { op, durationMin: dur === "" ? null : Number(dur), branch: branch || null, estimated: est === "est" || est === "估计" };
  });
}

async function pollJob(jobId, label) {
  for (let i = 0; i < 1200; i++) {
    const job = await api.getJob(jobId);
    setStatus(`${label}：${job.message}`);
    if (job.status === "done") return job.result ?? {};
    if (job.status === "error") throw new Error(job.error || `${label}失败`);
    await new Promise((res) => setTimeout(res, 700));
  }
  throw new Error(`${label}等待超时`);
}

/** 后台任务完成后的刷新：若有未保存编辑，不静默丢弃，改为提示后再由用户决定。 */
async function refreshAfterJob() {
  if (ui.dirty) {
    notify("mid", "后台任务已完成，但当前有未保存编辑（未刷新，以免丢弃）。保存或放弃后再刷新查看结果。");
    return;
  }
  await refresh();
}

/** 知识抽取流式轮询：只更新右栏队列（不动中栏编辑），把进度/失败块反映到 ui.kzJob。 */
async function pollKnowledgeJob(jobId) {
  for (let i = 0; i < 2400; i++) {
    const job = await api.getJob(jobId);
    ui.kzJob = { id: jobId, status: job.status, done: job.done ?? 0, total: job.total ?? 0, created: job.result?.created ?? 0, chunkErrors: job.result?.chunkErrors ?? [], cancelled: job.result?.cancelled, message: job.message };
    renderRight();
    if (job.status === "done" || job.status === "error") return job;
    await new Promise((r) => setTimeout(r, 700));
  }
  return { status: "error", error: "等待超时" };
}

function renderProtocolImport(box) {
  const protos = state.assets.filter((a) => a.kind === "protocol" && (!ui.topicId || a.topicId === ui.topicId || !a.topicId));
  const paperAtts = state.assets.filter((a) => a.kind === "literature" && state.attachments.some((x) => x.assetId === a.id));
  box.innerHTML = `
    <details class="mini" ${state.protocols.length ? "" : "open"}>
      <summary>＋新建方案</summary>
      <details class="mini" open><summary>① 上传原件并解析</summary>
        <input id="proto-up-name" placeholder="文件名（如 protocol.md）" />
        <input id="proto-up-file" type="file" accept=".md,.markdown,.txt,.text,text/markdown,text/plain" />
        <textarea id="proto-up-text" rows="3" placeholder="或粘贴方案文本（Markdown/纯文本）…"></textarea>
        <button class="primary" id="proto-upload">上传并解析为方案草稿</button>
        <p class="hint">原件按方案类归档；草稿标「模型草稿」，须人工编辑确认。AI 未配置时只归档，可稍后解析。</p>
        ${protos.length ? `<div class="hint">已归档方案原件（${protos.length}）：</div>${protos.map((a) => `<div class="row protoasset" data-aid="${a.id}"><span class="hint">${esc(a.name)} · ${a.bytes}B</span><button class="protoasset-parse">解析为草稿</button></div>`).join("")}` : ""}
      </details>
      <details class="mini"><summary>② 从论文重构（非作者原始）</summary>
        ${paperAtts.length ? `<select id="parse-asset">${paperAtts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select>
        <button id="proto-parse">重构为方案草稿</button>
        <p class="hint">重构来源仅限论文附件；草稿标「重构」并固定来源原件，不是作者原始方案。</p>` : `<p class="hint">先在「文献整理」为论文条目导入正文/方法附件。</p>`}
      </details>
      <details class="mini"><summary>③ 手动新建</summary>
        <input id="proto-name" placeholder="方案名称" />
        <select id="proto-src"><option value="user">用户编写</option><option value="reconstructed">公开材料重构（须标来源）</option></select>
        <input id="proto-purpose" placeholder="目的" />
        <textarea id="proto-steps" rows="4" placeholder="每行一步：操作 | 时长分钟 | 支路名 | est&#10;例：配缓冲液 | 10 | |&#10;孵育 | 30 | | est&#10;对照 | 60 | 对照支路 |"></textarea>
        <input id="proto-criteria" placeholder="完成判据" />
        <input id="proto-frag" placeholder="来源片段（重构时必填，逗号分隔）" />
        <button class="primary" id="proto-create">创建方案</button>
      </details>
    </details>`;
  $("#proto-upload").addEventListener("click", (ev) => runJob(ev.target, "上传并解析方案", async () => {
    if (!ui.topicId) throw new Error("请先选择/创建课题");
    const file = $("#proto-up-file").files?.[0];
    let text = $("#proto-up-text").value, name = $("#proto-up-name").value;
    if (file) { text = await readTextFile(file); if (!name) name = file.name; }
    let assetId;
    try {
      const up = await api.uploadProtocolSource(name, text, ui.topicId);
      assetId = up.assetId;
    } catch (e) {
      if (e.status === 409 && e.details?.existingAssetId) { assetId = e.details.existingAssetId; setStatus("原件已归档：定位已有原件，继续解析"); }
      else throw e;
    }
    $("#proto-up-text").value = ""; if ($("#proto-up-file")) $("#proto-up-file").value = "";
    let r;
    try { r = await api.parseProtocol(assetId, ui.topicId); }
    catch (e) {
      if (e.status === 422) { await refresh(); setStatus(`原件已归档。${e.message}`); return; }
      throw e;
    }
    const res = await pollJob(r.jobId, "方案解析");
    ui.protocolId = res.protocolId; ui.viewRev = null; await refreshAfterJob();
    setStatus("方案草稿已生成（模型草稿，须人工确认）");
  }));
  $$(".protoasset-parse").forEach((b) => b.addEventListener("click", (ev) => runJob(ev.target, "AI 解析方案", async () => {
    const aid = b.closest(".protoasset").dataset.aid;
    const r = await api.parseProtocol(aid, ui.topicId);
    const res = await pollJob(r.jobId, "方案解析");
    ui.protocolId = res.protocolId; ui.viewRev = null; await refreshAfterJob();
    setStatus("方案草稿已生成（模型草稿，须人工确认）");
  })));
  $("#proto-create").addEventListener("click", (ev) => runBusy(ev.target, "创建方案", async () => {
    if (!ui.topicId) throw new Error("请先选择/创建课题");
    const sourceKind = $("#proto-src").value;
    await api.createProtocol({
      topicId: ui.topicId, name: $("#proto-name").value, sourceKind,
      purpose: $("#proto-purpose").value, criteria: $("#proto-criteria").value,
      steps: parseStepsText($("#proto-steps").value),
      sourceFragments: splitList($("#proto-frag").value),
    });
    await refresh(); setStatus("方案已创建（r1）");
  }));
  const parseBtn = $("#proto-parse");
  if (parseBtn) parseBtn.addEventListener("click", (ev) => runJob(ev.target, "AI 重构方案", async () => {
    if (!ui.topicId) throw new Error("请先选择/创建课题");
    const r = await api.parseProtocol($("#parse-asset").value, ui.topicId, undefined, "reconstructed");
    const res = await pollJob(r.jobId, "方案重构");
    ui.protocolId = res.protocolId; ui.viewRev = null; await refreshAfterJob();
    setStatus("重构草稿已生成（重构：非作者原始方案，须人工确认）");
  }));
}

function renderRecordImport(box) {
  const ps = state.protocols.filter((p) => !ui.topicId || p.topicId === ui.topicId);
  const tmpls = state.templates.filter((t) => t.humanConfirmed);
  box.innerHTML = `
    <details class="mini" ${state.executions.length ? "" : "open"}>
      <summary>创建执行（进准备稿）</summary>
      ${ps.length ? `<select id="exec-proto">${ps.map((p) => `<option value="${p.id}">${esc(p.name)}（r${p.revision}）</option>`).join("")}</select>
      <select id="exec-tmpl"><option value="">不用模板</option>${tmpls.map((t) => `<option value="${t.id}">模板 r${t.protocolRevision} · ${t.fields.length} 字段</option>`).join("")}</select>
      <button class="primary" id="exec-start">创建执行</button>
      <p class="hint">创建后进入准备稿：可登记本次差异，确认快照后才开始补记录；实际开始另行记录。之后方案修订不影响本执行。</p>` : `<p class="hint">先在「方案与图」创建方案。</p>`}
    </details>`;
  const btn = $("#exec-start");
  if (btn) btn.addEventListener("click", (ev) => runBusy(ev.target, "创建执行", async () => {
    if (!ui.topicId) throw new Error("请先选择/创建课题");
    const r = await api.startExecution({ topicId: ui.topicId, protocolId: $("#exec-proto").value, templateId: $("#exec-tmpl").value || undefined });
    ui.executionId = r.executionId; ui.assetId = null; ui.prepExtra = 0; await refresh(); setStatus("执行已创建：进入准备稿（尚未开始实验）");
  }));
}

/** 实验图：横向时间泳道——主线一条泳道，支路在分叉/汇合锚点间平行展开；
 * 未知时长不按零累计（其后 t≥ 下界）；无锚点明示不猜；点击节点 → 下方固定编辑器。 */
function diagramHtml(p, snap) {
  const L = computeLanes(snap.steps);
  const node = (s, offset, approx) => {
    const unknown = s.durationMin === null;
    const bar = unknown
      ? `<span class="dbar unknown" title="时长未知（不按 0）">时长未知</span>`
      : `<span class="dbar ${s.estimated ? "est" : "fixed"}">${s.durationMin}min${s.estimated ? "·估" : ""}</span>`;
    const op = s.op.length > 16 ? `${s.op.slice(0, 16)}…` : s.op;
    return `<div class="dnode ${ui.stepSel === s.id ? "sel" : ""}" data-step="${s.id}" title="${esc(s.op)}">
      <div class="dop">${esc(op)}</div>
      <div class="dmeta">${offset !== null ? `<span class="dtime">${timeLabel(offset, approx)}</span>` : ""}${bar}${s.observeEnd ? `<span class="hint">终点:${esc(s.observeEnd)}</span>` : ""}</div>
    </div>`;
  };
  let html = `<div class="diagram" style="grid-template-columns:repeat(${L.cols},minmax(110px,1fr))">`;
  L.main.forEach((m, i) => {
    html += `<div class="dcell" style="grid-column:${i + 1};grid-row:1">${node(m.step, m.offset, m.approx)}${i < L.main.length - 1 ? `<span class="darrow-h">→</span>` : ""}</div>`;
  });
  L.lanes.forEach((lane, li) => {
    const forkOp = lane.forkIdx !== null ? L.main[lane.forkIdx].step.op : null;
    const mergeOp = lane.mergeIdx !== null ? L.main[lane.mergeIdx].step.op : null;
    const anchorText = lane.anchored
      ? `分叉自「${esc(forkOp)}」之后 · 汇合入「${esc(mergeOp)}」之前`
      : `<span class="badge warn">锚点未指定（横跨全程，不猜）</span>`;
    html += `<div class="dlane ${lane.anchored ? "" : "unanchored"}" style="grid-column:${lane.start + 1}/${lane.end + 2};grid-row:${li + 2}">
      <div class="dlane-title">支路 · ${esc(lane.name)} · ${anchorText}</div>
      <div class="dlane-nodes">${lane.steps.map((s) => node(s, null, false)).join(`<span class="darrow-h">→</span>`)}</div>
    </div>`;
  });
  const estCount = snap.steps.filter((s) => s.estimated).length;
  const unkCount = snap.steps.filter((s) => s.durationMin === null).length;
  html += `</div><p class="hint">横轴：时间（步序，列宽等分）；纵轴：线程／泳道。虚线＝估计或时长未知${unkCount ? `（未知 ${unkCount} 步不按 0，其后为下界）` : ""}${estCount ? `（估计 ${estCount} 步）` : ""}；已知主线 ${L.totalKnown}min。</p>`;
  return html;
}

function stepEditorHtml(p, snap) {
  const s = ui.stepSel === "new" ? { id: "", op: "", params: {}, note: "", durationMin: null, estimated: false, branch: null, observeEnd: "" } : snap.steps.find((x) => x.id === ui.stepSel);
  if (!s) return `<div class="stepeditor"><p class="hint">点击图中节点编辑步骤；保存将追加方案新快照（旧版本不动）。</p>
    <div class="row"><input id="newstep-op" placeholder="新步骤操作名" /><button id="step-add">添加步骤</button><button disabled title="占位：AI 重排未接入">AI 重排（未实现）</button></div></div>`;
  const paramsText = Object.entries(s.params).map(([k, v]) => `${k}=${v}`).join("\n");
  const mainOpts = (cur) => snap.steps.filter((x) => !x.branch).map((x) => `<option value="${x.id}" ${x.id === cur ? "selected" : ""}>${esc(x.op)}</option>`).join("");
  return `<div class="stepeditor">
    <div class="meta">${ui.stepSel === "new" ? "新步骤" : `编辑步骤 · ${esc(s.op)}`}（保存 → 方案 r${p.revision + 1}）</div>
    <div class="row"><label>操作</label><input id="se-op" value="${esc(s.op)}" /></div>
    <div class="row"><label>时长(分)</label><input id="se-dur" type="number" min="0" value="${s.durationMin ?? ""}" placeholder="空=未知" />
      <label><input id="se-est" type="checkbox" ${s.estimated ? "checked" : ""}/> 估计</label>
      <label>支路</label><input id="se-branch" value="${esc(s.branch ?? "")}" placeholder="空=主线" /></div>
    <div class="row"><label>分叉自</label><select id="se-fork"><option value="">（未指定）</option>${mainOpts(s.branchFrom)}</select>
      <label>汇合入</label><select id="se-merge"><option value="">（未指定）</option>${mainOpts(s.mergeInto)}</select>
      <span class="hint">支路锚点：仅支路步骤生效；未指定则图中明示不猜</span></div>
    <div class="row"><label>观察终点</label><input id="se-end" value="${esc(s.observeEnd)}" /></div>
    <textarea id="se-params" rows="2" placeholder="参数，每行 键=值">${esc(paramsText)}</textarea>
    <div class="row"><label>备注</label><input id="se-note" value="${esc(s.note)}" /></div>
    <div class="row"><input id="se-reason" placeholder="修改原因（必填）" /><button class="primary" id="step-save">保存步骤</button><button id="step-cancel">取消</button><button disabled title="占位：AI 重排未接入">AI 重排（未实现）</button></div>
  </div>`;
}

/** 影响分析面板：确定性传播与 AI 语义评估分栏；失败/未配置/stale 明示，不暗示无影响。 */
function impactHtml(entityIds) {
  const imps = state.impacts
    .filter((i) => entityIds.includes(i.change.entityId) && (!ui.topicId || i.topicId === ui.topicId))
    .slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!imps.length) return `<div class="item impactpanel"><div class="meta">AI 影响分析</div><p class="hint">保存方案/记录/样品/测量修改后，这里自动登记影响分析。</p></div>`;
  const STATUS = { pending: "待评估", running: "评估中", completed: "已完成", failed: "评估失败", stale: "已过时" };
  const ASSESS = { impact: "有影响", no_supported_impact_found: "未发现支持的影响", needs_review: "需人工复核" };
  return `<div class="item impactpanel"><div class="meta">AI 影响分析（${imps.length}）<span class="hint">确定性时间传播独立计算；AI 只做语义评估</span></div>
    ${imps.map((i) => {
      const disp = i.status === "failed" ? "failed" : i.status === "stale" ? (i.assessment === "no_supported_impact_found" ? "needs_review" : i.assessment ?? "not_analyzed") : i.status === "completed" ? i.assessment : "not_analyzed";
      const dispLabel = disp === "failed" ? "评估失败（≠无影响）" : disp === "not_analyzed" ? "未分析/进行中" : disp === "needs_review" ? "需人工复核" : ASSESS[disp];
      return `<details class="mini imp" ${i === imps[0] ? "open" : ""}>
        <summary><span class="badge ${i.status === "failed" ? "exclude" : i.status === "stale" ? "warn" : i.status === "completed" ? "confirm" : "cand-pending"}">${STATUS[i.status]}</span>
          ${esc(i.change.summary)} <span class="hint">${esc(fmtTime(i.createdAt))}</span></summary>
        <div class="hint">结论口径：<strong>${esc(dispLabel)}</strong>${i.status === "stale" ? "（旧结论仅供历史查看，已有更新改动）" : ""}${i.error ? ` · 错误：${esc(i.error)}` : ""}</div>
        ${i.deterministic.timeShifts.length ? `<div class="hint">确定性时间传播：${esc(i.deterministic.note)}</div>
          <table class="grid"><thead><tr><th>步骤</th><th>平移(min)</th><th>主线总时长(min)</th></tr></thead><tbody>
          ${i.deterministic.timeShifts.map((s) => `<tr><td>${esc(s.op)}</td><td>${s.deltaMin > 0 ? "+" : ""}${s.deltaMin}</td><td>${s.newTotalMin}</td></tr>`).join("")}</tbody></table>`
          : `<div class="hint">${esc(i.deterministic.note)}</div>`}
        ${i.summary ? `<div>${esc(i.summary)}</div>` : ""}
        ${i.items.length ? `<div class="hint">逐条（${i.items.length}）：</div>${i.items.map((it) => `<div class="impitem">
          <span class="badge secondary">${esc(it.category)}</span> <strong>${esc(it.finding)}</strong>
          <div class="hint">对象：${esc(it.targetKind)} ${esc(it.targetId)}${it.targetRevision ? ` r${it.targetRevision}` : ""} · 理由：${esc(it.reason)}</div>
          ${it.evidenceRefs.length ? `<div class="hint">证据：${it.evidenceRefs.map(esc).join("、")}</div>` : ""}
          ${it.unknowns.length ? `<div class="hint warn">未知：${it.unknowns.map(esc).join("、")}</div>` : ""}
          ${it.suggestedAction ? `<div class="hint">建议：${esc(it.suggestedAction)}</div>` : ""}
        </div>`).join("")}` : ""}
        ${(i.status === "pending" || i.status === "failed") ? `<div class="row"><button class="imp-run" data-id="${i.id}">运行 AI 语义评估</button></div>` : ""}
      </details>`;
    }).join("")}
  </div>`;
}

function protocolMainHtml() {
  const p = currentProtocol();
  if (!p) return `<p class="hint">在左栏选择方案，或用中间「＋新建方案」创建。图中节点可点击编辑；保存追加新快照，旧版本与已固定的执行/模板不受影响。</p>`;
  const snap = viewSnapshot(p);
  const viewingOld = snap.revision !== p.revision;
  return `
    <div class="item" data-id="${p.id}">
      <div class="meta">${esc(p.name)} · 来源 ${fmtEnum(p.sourceKind)}</div>
      <div class="row"><label>查看版本</label>
        <select id="proto-rev">${p.revisions.map((r) => `<option value="${r.revision}" ${r.revision === snap.revision ? "selected" : ""}>${fmtVersion(r.revision)} · ${esc(r.reason)}</option>`).join("")}</select>
        <button id="proto-export">导出 JSON</button>
        <button class="history-btn">快照历史(${p.revisions.length})</button></div>
      ${viewingOld ? `<p class="hint warn">正在查看旧快照 ${fmtVersion(snap.revision)}（只读）；编辑将基于最新 ${fmtVersion(p.revision)} 追加。</p>` : ""}
      ${diagramHtml(p, snap)}
      ${!viewingOld ? stepEditorHtml(p, snap) : ""}
    </div>
    ${impactHtml([p.id])}`;
}

function protocolSideHtml() {
  const p = currentProtocol();
  if (!p) return `<p class="hint">选择方案后显示元信息、来源原件与记录模板。</p>`;
  const snap = viewSnapshot(p);
  const viewingOld = snap.revision !== p.revision;
  const tmpls = state.templates.filter((t) => t.protocolId === p.id);
  const src = p.sourceAssetId ? state.assets.find((a) => a.id === p.sourceAssetId) : null;
  return `
    <div class="item">${!viewingOld ? `<details class="mini" open><summary>方案元信息</summary>
      <div class="row"><label>目的</label><input data-field="purpose" value="${esc(snap.purpose)}" /></div>
      <div class="row"><label>判据</label><input data-field="criteria" value="${esc(snap.criteria)}" /></div>
      <div class="row"><label>条件</label><input data-field="conditions" value="${esc(snap.conditions.join(","))}" /></div>
      <div class="row"><label>未知项</label><input data-field="unknowns" value="${esc(snap.unknowns.join(","))}" /></div>
      <div class="row"><input data-field="reason" placeholder="修改原因（必填）" /><button class="primary" id="proto-save">保存元信息</button></div></details>`
      : `<p class="hint">正在查看旧快照（只读）。</p>`}</div>
    ${src ? `<details class="mini"><summary>来源原件 · ${esc(src.name)}</summary><pre class="srcpre">${esc(src.text)}</pre></details>` : ""}
    <div class="item"><div class="meta">记录模板（${tmpls.length}）</div>
      ${tmpls.map((t) => `<div class="row tmpl" data-id="${t.id}">
        <span class="badge ${t.humanConfirmed ? "confirm" : "cand-pending"}">${t.humanConfirmed ? "已确认" : "待确认"}</span>
        ${t.aiDraft ? `<span class="badge ai">AI 草稿</span>` : ""}
        <span class="hint">固定 ${fmtVersion(t.protocolRevision)}${t.protocolRevision !== p.revision ? `（方案已变 → 当前 ${fmtVersion(p.revision)}，复用前须比较）` : ""} · ${t.fields.length} 字段</span>
        ${!t.humanConfirmed ? `<button class="tmpl-confirm">人工确认</button>` : `<button class="tmpl-use">用于执行</button>`}
      </div>`).join("") || `<p class="hint">暂无模板。</p>`}
      <div class="row"><label><input type="checkbox" id="tmpl-ai" /> AI 草稿</label><button id="tmpl-create">生成模板（固定 ${fmtVersion(p.revision)}）</button></div>
    </div>`;
}

/** 5D 准备稿：基础快照图＋本次差异编辑（固定底部编辑区）；确认前可反复改，确认后冻结。 */
/** 步骤记录表（B4）：左＝计划（来自本次快照，不改源方案）；右＝实际（用量/时长/意外影响到哪一环节）。 */
function stepsTableHtml(e, snap) {
  const steps = snap?.steps ?? [];
  if (!steps.length) return `<p class="hint">本次快照无步骤（方案可能缺失）。</p>`;
  const lastStepEv = (sid) => { const evs = e.events.filter((ev) => ev.kind === "step" && ev.stepId === sid); return evs[evs.length - 1]; };
  const hasDev = (sid) => e.events.some((ev) => ev.kind === "deviation" && ev.stepId === sid);
  const rows = steps.map((s) => {
    const last = lastStepEv(s.id);
    const plan = s.durationMin === null ? `<span class="dbar unknown">时长未知</span>` : `<span class="dbar ${s.estimated ? "est" : "fixed"}">${s.durationMin}min${s.estimated ? "·估" : ""}</span>`;
    const others = steps.filter((x) => x.id !== s.id);
    const dev = hasDev(s.id);
    return `<tr data-step="${s.id}" data-op="${esc(s.op)}">
      <td>${esc(s.op)}${s.branch ? ` <span class="hint">支路:${esc(s.branch)}</span>` : ""}</td>
      <td>${plan}</td>
      <td><input data-f="amount" value="${esc(last?.actual.amount ?? "")}" placeholder="用量" /></td>
      <td><input data-f="dur" type="number" min="0" value="${last?.actual.durationMin ?? ""}" placeholder="分" /></td>
      <td><label class="hint"><input type="checkbox" data-f="incident" ${dev ? "checked" : ""}/> 意外</label>
        <select data-f="target">${others.map((x) => `<option value="${x.id}">影响:${esc(x.op)}</option>`).join("") || `<option value="">（无其它步骤）</option>`}</select></td>
      <td><button class="steptbl-save">${last ? "更新" : "记录"}</button>${dev ? ` <span class="hint warn">已标意外</span>` : ""}</td>
    </tr>`;
  }).join("");
  return `<div class="tablewrap"><table class="grid steptbl"><thead><tr><th>步骤（计划）</th><th>计划时长</th><th>实际用量</th><th>实际时长</th><th>意外/影响</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="hint">左＝计划（本次快照，不改源方案）；右＝实际，逐行记录。实际开始/暂停/备注见下方「事件时间线」。</p>`;
}

function preparationHtml(e, p, baseSnap) {
  const adj = e.preparation?.adjustments ?? [];
  const FIELDS = [["op", "操作"], ["durationMin", "时长(分)"], ["estimated", "估计(true/false)"], ["params", "参数(JSON)"], ["note", "备注"], ["observeEnd", "观察终点"], ["branch", "支路"]];
  const stepOpts = (cur) => (baseSnap?.steps ?? []).map((s) => `<option value="${s.id}" ${s.id === cur ? "selected" : ""}>${esc(s.op)}</option>`).join("");
  const fieldOpts = (cur) => FIELDS.map(([v, l]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${l}</option>`).join("");
  const rowHtml = (a) => `<div class="preprow celledit">
    <div class="row"><select data-pf="stepId">${stepOpts(a?.stepId)}</select><select data-pf="field">${fieldOpts(a?.field ?? "durationMin")}</select>
      <input data-pf="after" placeholder="调整后值（时长可填 null=未知）" value="${esc(a?.after ?? "")}" />
      <button class="prep-del">删除</button></div>
    <div class="hint">调整前：${a ? esc(a.before) : "（保存时自动取基础快照值）"}</div>
    <div class="row"><input data-pf="reason" placeholder="本次差异原因（必填）" value="${esc(a?.reason ?? "")}" /></div>
  </div>`;
  return `
    <div class="item" data-id="${e.id}">
      <div class="meta">${esc(p?.name ?? e.protocolId)} · 准备稿 · 基础 r${e.preparation?.baseRevision ?? e.protocolRevision} · <span class="badge cand-pending">未确认</span></div>
      <p class="hint">准备≠已做实验：这里登记本次差异；确认快照后进入记录状态，实际开始另行记录。源方案不被改动。</p>
      ${baseSnap ? diagramHtml(p, baseSnap) : `<p class="hint warn">基础方案快照缺失。</p>`}
      <div class="pane-title">本次差异（${adj.length}）</div>
      ${adj.map((a) => rowHtml(a)).join("")}
      ${Array.from({ length: ui.prepExtra }, () => rowHtml(null)).join("")}
      <textarea id="prep-notes" rows="2" placeholder="准备备注（如室温/试剂批次）">${esc(e.preparation?.notes ?? "")}</textarea>
      <div class="row"><button id="prep-add">＋添加差异</button><button id="prep-save">保存准备稿</button><button class="primary" id="prep-confirm">确认本次执行快照</button></div>
      <p class="hint">确认＝把「基础快照＋差异」冻结为本次执行的独立快照；有时长差异时自动登记确定性时间传播。确认前草稿不算数。</p>
    </div>`;
}

function recordHtml() {
  const a = currentAsset();
  if (a && a.kind === "image") return ocrHtml(a);
  const e = currentExecution();
  if (!e) return `<p class="hint">在左栏选择执行；或选择手写图片进行 OCR。</p>`;
  const p = state.protocols.find((x) => x.id === e.protocolId);
  const baseSnap = p?.revisions.find((r) => r.revision === (e.preparation?.baseRevision ?? e.protocolRevision));
  if ((e.phase ?? "recording") === "preparing") return preparationHtml(e, p, baseSnap) + impactHtml([e.id]);
  const snap = e.preparation?.snapshot ?? baseSnap;
  const samples = state.samples.filter((s) => s.topicId === e.topicId);
  const meas = state.measurements.filter((m) => m.topicId === e.topicId);
  const KIND = { start: "开始", step: "步骤", pause: "暂停", resume: "恢复", note: "备注", deviation: "偏差" };
  const suggest = ui.pauseSuggest;
  const nAdj = e.preparation?.adjustments.length ?? 0;
  const coveredIds = new Set(e.events.filter((ev) => ev.kind === "step").map((ev) => ev.stepId));
  const missing = (snap?.steps ?? []).filter((s) => !coveredIds.has(s.id));
  const unknownDur = (snap?.steps ?? []).filter((s) => s.durationMin === null).length;
  const hasStart = e.events.some((ev) => ev.kind === "start");
  return `
    <div class="item" data-id="${e.id}">
      <div class="meta">${esc(p?.name ?? e.protocolId)} · 固定 r${e.protocolRevision}${nAdj ? ` ＋ 本次差异 ${nAdj} 条` : ""} · <span class="badge ${e.status === "paused" ? "warn" : e.status === "active" ? "confirm" : ""}">${e.status}</span>${e.templateId ? " · 模板" : ""}</div>
      ${e.preparation?.confirmedAt ? `<div class="hint">本次快照确认于 ${esc(fmtTime(e.preparation.confirmedAt))}（基础 ${fmtVersion(e.preparation.baseRevision)}${nAdj ? ` ＋ ${nAdj} 条差异` : "，无差异"}）；源方案后续不影响本次。</div>` : ""}
      <div class="hint">数据完整度：步骤记录 ${(snap?.steps.length ?? 0) - missing.length}/${snap?.steps.length ?? 0}${missing.length ? ` · 未记录：${missing.map((s) => esc(s.op)).join("、")}` : ""}${unknownDur ? ` · ${unknownDur} 步时长未知（不按 0 计）` : ""}</div>
      ${e.status === "active" && !hasStart ? `<div class="row"><button class="primary" id="exec-begin">记录实际开始</button><span class="hint">由人记录，系统不代填。</span></div>` : ""}
      ${e.preparation?.snapshot ? `<details class="mini"><summary>另存新方案（不改源）</summary>
        <div class="row"><input id="saveas-name" placeholder="新方案名称" /><button id="exec-saveas">另存为新方案 r1</button></div>
        <p class="hint">把本次确认快照存为新方案；不默认改动全局源方案。</p></details>` : ""}
      ${e.status === "active" ? `<div class="row"><input id="pause-reason" placeholder="暂停原因（必填）" />
        <button id="exec-assist">AI 暂停建议</button><button class="primary" id="exec-pause">暂停</button><button id="exec-done">结束执行</button></div>
        ${suggest ? `<div class="hint">AI 建议（仅建议，采纳由人决定）：风险[${suggest.risks.map(esc).join("、") || "—"}] 恢复检查[${suggest.resumeChecks.map(esc).join("、") || "—"}]${suggest.unknowns.length ? ` 未知[${suggest.unknowns.map(esc).join("、")}]` : ""}</div>` : ""}` : ""}
      ${e.status === "paused" && e.pausedState ? `<div class="celledit">
        <div class="hint">暂停于 ${esc(e.pausedState.at)} · 原因：${esc(e.pausedState.reason)}${e.pausedState.aiSuggested ? "（含 AI 建议）" : ""}</div>
        <div class="hint">风险：${e.pausedState.risks.map(esc).join("、") || "—"} · 恢复检查：${e.pausedState.resumeChecks.map(esc).join("、") || "—"}</div>
        <div class="row"><input id="resume-decision" placeholder="人的恢复决定（必填）" /><button class="primary" id="exec-resume">恢复执行</button></div>
      </div>` : ""}
    </div>
    <div class="item">
      <details class="mini"><summary>事件时间线（${e.events.length}，默认折叠）</summary>
      ${e.events.map((ev) => ui.editEventId === ev.id ? `<div class="celledit" data-evid="${ev.id}">
          <div class="row"><label>内容</label><input data-field="evText" value="${esc(ev.text)}" /></div>
          <div class="row"><label>实际用量</label><input data-field="evAmount" value="${esc(ev.actual.amount ?? "")}" />
            <label>实际时长</label><input data-field="evDur" type="number" min="0" value="${ev.actual.durationMin ?? ""}" /></div>
          <div class="row"><input data-field="evReason" placeholder="修改原因（必填）" /><button class="primary ev-save">保存</button><button class="ev-cancel">取消</button></div>
        </div>` : `<div class="evrow" data-evid="${ev.id}">
          <span class="badge ${ev.kind === "deviation" ? "exclude" : ev.kind === "pause" ? "warn" : ""}">${KIND[ev.kind]}</span>
          <span class="hint">${esc(fmtTime(ev.at))}${ev.backfilled ? " · 后补" : ""}</span>
          <span>${esc(ev.text)}</span>
          ${ev.actual.amount ? `<span class="hint">用量 ${esc(ev.actual.amount)}</span>` : ""}
          ${ev.actual.durationMin !== undefined ? `<span class="hint">实际 ${ev.actual.durationMin}min</span>` : ""}
          ${ev.kind === "step" || ev.kind === "note" || ev.kind === "deviation" ? `<button class="ev-edit">编辑(${ev.history.length})</button>` : ""}
        </div>`).join("") || `<p class="hint">暂无事件。</p>`}
      <details class="mini"><summary>追加事件</summary>
        <div class="row"><select id="ev-kind"><option value="step">步骤</option><option value="note">备注</option><option value="deviation">偏差</option></select>
          <select id="ev-step">${(snap?.steps ?? []).map((s) => `<option value="${s.id}">${esc(s.op)}</option>`).join("")}</select></div>
        <div class="row"><input id="ev-text" placeholder="内容（备注/偏差必填）" /></div>
        <div class="row"><input id="ev-amount" placeholder="实际用量" /><input id="ev-dur" type="number" min="0" placeholder="实际时长(分)" />
          <label><input type="checkbox" id="ev-backfill" /> 后补</label><button class="primary" id="ev-add">追加</button></div>
      </details>
      </details>
    </div>
    <div class="item"><div class="meta">样品与测量（本课题）</div>
      ${samples.map((s) => {
        const last = s.states[s.states.length - 1];
        const mOfS = meas.filter((m) => m.sampleId === s.id);
        return `<div class="smprow" data-id="${s.id}">
          <div class="row"><input class="smp-name" value="${esc(s.displayName)}" placeholder="名称" />
            ${s.shortName !== s.displayName ? `<span class="hint">编号 ${esc(s.shortName)}</span>` : ""}
            <button class="smp-rename">改名</button></div>
          <div class="hint">总量：${esc(last?.amount.value ?? "—")} ${esc(last?.amount.unit ?? "")}${last?.amount.estimated ? "（估计）" : ""} · 拆分：${s.states.length} 个状态${last?.handling ? ` · 处理：${esc(last.handling)}` : ""}${last?.use ? ` · 用途：${esc(last.use)}` : ""}</div>
          <div class="hint">测量结果：${mOfS.length ? mOfS.map((m) => `${esc(m.value)}${esc(m.unit)}`).join("、") : "（无）"}</div>
        </div>`;
      }).join("") || `<p class="hint">暂无样品（左栏新建）。</p>`}
      <details class="mini"><summary>新增测量（固定样品状态版本）</summary>
        ${samples.length ? `<div class="row"><select id="meas-sample">${samples.map((s) => `<option value="${s.id}">${esc(s.shortName)} ${esc(s.displayName)}</option>`).join("")}</select>
          <select id="meas-srev">${samples[0].states.map((st) => `<option value="${st.revision}">状态 ${st.revision}</option>`).join("")}</select></div>
        <div class="row"><input id="meas-value" placeholder="测量值（必填）" /><input id="meas-unit" placeholder="单位" /></div>
        <div class="row"><input id="meas-method" placeholder="方法" /><input id="meas-instr" placeholder="仪器" /></div>
        <div class="row"><input id="meas-note" placeholder="备注" /><button class="primary" id="meas-add">记录测量</button></div>` : `<p class="hint">先建样品。</p>`}
      </details>
      ${meas.map((m) => `<div class="item meas" data-id="${m.id}">
        <div class="meta">${esc(state.samples.find((s) => s.id === m.sampleId)?.shortName ?? m.sampleId)} · 样品状态 ${m.sampleStateRevision}${m.cellRef ? ` · 回链表 r${m.cellRef.row}c${m.cellRef.col}` : ""}</div>
        <div class="row"><input data-field="mValue" value="${esc(m.value)}" /><input data-field="mUnit" value="${esc(m.unit)}" />
          <input data-field="mMethod" value="${esc(m.method)}" /><input data-field="mInstr" value="${esc(m.instrument)}" /></div>
        <div class="row"><input data-field="mNote" value="${esc(m.note)}" /><input data-field="mReason" placeholder="修改原因（必填）" />
          <button class="meas-save">保存</button><button class="history-btn">历史(${m.history.length})</button></div>
      </div>`).join("")}
    </div>`;
}

// ── 5E：数据处理与分析 / 上下文AI对话 ──────────────────────
function currentTask() { return state.analysisTasks.find((t) => t.id === ui.taskId) ?? null; }
function currentChat() { return state.chats.find((c) => c.id === ui.chatId) ?? null; }
function refLabel(ref) {
  switch (ref.kind) {
    case "execution": { const e = state.executions.find((x) => x.id === ref.id); const p = e && state.protocols.find((x) => x.id === e.protocolId); return `执行 · ${p?.name ?? ref.id}`; }
    case "protocol": return `方案 · ${state.protocols.find((x) => x.id === ref.id)?.name ?? ref.id}`;
    case "measurement": {
      const mr = state.measurements.find((x) => x.id === ref.id);
      if (mr) { const s = state.samples.find((x) => x.id === mr.sampleId); return `测量 · ${s?.shortName ?? ""} ${mr.value}${mr.unit}`; }
      return `测量原件 · ${state.assets.find((x) => x.id === ref.id)?.name ?? ref.id}`;
    }
    case "table": return `数据表 · ${state.tables.find((x) => x.id === ref.id)?.name ?? ref.id}`;
    case "card": { const c = state.cards.find((x) => x.id === ref.id); return `知识卡 · ${c?.scope || Object.values(c?.extracted?.fields ?? {})[0] || ref.id}`; }
    case "asset": return `原件 · ${state.assets.find((x) => x.id === ref.id)?.name ?? ref.id}`;
    case "subquestion": return `子问题 · ${state.subquestions.find((x) => x.id === ref.id)?.question ?? ref.id}`;
    default: return `${ref.kind}:${ref.id}`;
  }
}
function topicObjects() {
  const tid = ui.topicId;
  const execs = state.executions.filter((e) => !tid || e.topicId === tid);
  const tables = state.tables.filter((t) => { const a = state.assets.find((x) => x.id === t.assetId); return !tid || !a?.topicId || a.topicId === tid; });
  const meas = state.measurements.filter((m) => !tid || m.topicId === tid);
  const protos = state.protocols.filter((p) => !tid || p.topicId === tid);
  const cards = state.cards.filter((c) => { const p = state.papers.find((x) => x.id === c.paperId); return c.audit === "confirm" && (!tid || !p || !p.topicIds.length || p.topicIds.includes(tid)); });
  return { execs, tables, meas, protos, cards };
}
const collectPicks = (cls) => [...$$(`.${cls}:checked`)].map((cb) => ({ kind: cb.dataset.kind, id: cb.dataset.id }));

function renderAnalysisForm(box) {
  if (!ui.topicId) { box.innerHTML = `<p class="hint">先在上方选择课题，再建分析任务。</p>`; return; }
  const { execs, tables, meas, protos, cards } = topicObjects();
  const subqs = state.subquestions.filter((s) => s.topicId === ui.topicId);
  const conf = cards.filter((c) => c.audit === "confirm");
  const dataSources = [
    ...tables.map((t) => ({ kind: "table", id: t.id, label: `数据表 · ${t.name}` })),
    ...meas.map((m) => ({ kind: "measurement", id: m.id, label: `测量 · ${state.samples.find((s) => s.id === m.sampleId)?.shortName ?? ""} ${m.value}${m.unit}` })),
  ];
  box.innerHTML = `
    <details class="mini" open>
      <summary>＋新建分析任务</summary>
      <input id="an-title" placeholder="任务标题（如 传播量级汇总）"/>
      <select id="an-subq"><option value="">（子问题）</option>${subqs.map((s) => `<option value="${s.id}">${esc(s.question)}</option>`).join("")}</select>
      <p class="hint">选择数据（必选，锁定且不可取消）：</p>
      ${dataSources.length ? dataSources.map((d) => `<label class="ctxpick"><input type="checkbox" class="an-data" data-kind="${d.kind}" data-id="${d.id}"/> ${esc(d.label)}</label>`).join("") : `<p class="hint">本课题暂无可分析数据（先导入数据表或记录测量）。</p>`}
      <p class="hint">默认已选（关联度高的已入候选知识卡，可取消）：</p>
      ${conf.length ? conf.map((c) => `<label class="ctxpick"><input type="checkbox" class="an-def" data-id="${c.id}" checked/> ${esc(c.scope || c.rawText.slice(0, 24))}</label>`).join("") : `<p class="hint">暂无已入候选卡。</p>`}
      <details class="mini"><summary>其他可选（折叠：方案/执行）</summary>
        ${protos.map((p) => `<label class="ctxpick"><input type="checkbox" class="an-opt2" data-kind="protocol" data-id="${p.id}"/> 方案 · ${esc(p.name)}</label>`).join("")}
        ${execs.map((e) => `<label class="ctxpick"><input type="checkbox" class="an-opt2" data-kind="execution" data-id="${e.id}"/> 执行 · ${esc(state.protocols.find((p) => p.id === e.protocolId)?.name ?? e.id)}</label>`).join("")}
      </details>
      <button class="primary" id="an-create">创建任务（必选项自动锁定）</button>
    </details>`;
  $("#an-create").addEventListener("click", (ev) => runBusy(ev.target, "创建分析任务", async () => {
    const core = [...$$(".an-data:checked")].map((x) => ({ kind: x.dataset.kind, id: x.dataset.id }));
    if (!core.length) { notify("mid", "请至少选择一个数据表/测量作为必选数据。"); return; }
    const optional = [
      ...[...$$(".an-def:checked")].map((x) => ({ ref: { kind: "card", id: x.dataset.id }, included: true })),
      ...[...$$(".an-opt2:checked")].map((x) => ({ ref: { kind: x.dataset.kind, id: x.dataset.id }, included: true })),
      ...[...$$(".an-def:not(:checked)")].map((x) => ({ ref: { kind: "card", id: x.dataset.id }, included: false })),
    ];
    const r = await api.createAnalysisTask({ topicId: ui.topicId, subquestionId: $("#an-subq").value || undefined, title: $("#an-title").value, core, optional });
    ui.taskId = r.taskId; await refresh(); setStatus("分析任务已创建：必选数据已锁定");
  }));
}

function renderChatForm(box) {
  if (!ui.topicId) { box.innerHTML = `<p class="hint">先在上方选择课题，再创建对话。</p>`; return; }
  const { execs, tables, meas, protos, cards } = topicObjects();
  const subqs = state.subquestions.filter((s) => s.topicId === ui.topicId);
  const conf = cards.filter((c) => c.audit === "confirm");
  const row = (kind, id, label) => `<label class="ctxpick"><input type="checkbox" class="ch-scope" data-kind="${kind}" data-id="${id}"/> ${esc(label)}</label>`;
  box.innerHTML = `
    <details class="mini" open>
      <summary>＋新建对话</summary>
      <select id="ch-subq"><option value="">（课题层，不挂子问题）</option>${subqs.map((s) => `<option value="${s.id}">${esc(s.question)}</option>`).join("")}</select>
      <p class="hint">默认已选（已入候选知识卡，可取消）：</p>
      ${conf.length ? conf.map((c) => `<label class="ctxpick"><input type="checkbox" class="ch-scope" data-kind="card" data-id="${c.id}" checked/> ${esc(c.scope || c.rawText.slice(0, 24))}</label>`).join("") : `<p class="hint">暂无。</p>`}
      <details class="mini"><summary>其他可选（折叠：执行/测量/表/方案/其余卡）</summary>
        ${execs.map((e) => row("execution", e.id, `执行 · ${state.protocols.find((p) => p.id === e.protocolId)?.name ?? e.id}`)).join("")}
        ${meas.map((m) => row("measurement", m.id, `测量 · ${state.samples.find((s) => s.id === m.sampleId)?.shortName ?? ""} ${m.value}${m.unit}`)).join("")}
        ${tables.map((t) => row("table", t.id, `数据表 · ${t.name}`)).join("")}
        ${protos.map((p) => row("protocol", p.id, `方案 · ${p.name}`)).join("")}
        ${cards.filter((c) => c.audit !== "confirm").map((c) => row("card", c.id, `知识卡 · ${c.scope || c.rawText.slice(0, 20)}`)).join("")}
      </details>
      <button class="primary" id="ch-create">创建会话</button>
    </details>`;
  $("#ch-create").addEventListener("click", (ev) => runBusy(ev.target, "创建会话", async () => {
    const r = await api.createChat({ topicId: ui.topicId, subquestionId: $("#ch-subq").value || undefined, scope: collectPicks("ch-scope") });
    ui.chatId = r.chatId; await refresh(); setStatus("会话已创建：在中栏开始讨论");
  }));
}

function snapshotHtml(snap) {
  return `<details class="mini" open><summary>冻结上下文快照 · ${esc(snap.summary)}</summary>
    <p class="hint">目的：${esc(snap.purpose)}<br/>模型：${esc(snap.model)} · ${esc(fmtTime(snap.at))}<br/>hash：${esc(snap.hash)}</p>
    ${snap.fragments.map((f, i) => `<details class="mini"><summary>碎片 ${i + 1} · ${esc(f.label)} · ${esc(humanVer(f.version))} · ${f.ref.kind}:${f.ref.id}</summary><pre>${esc(deIso(humanVer(f.excerpt)))}</pre></details>`).join("")}
  </details>`;
}

function contextMapHtml(t) {
  const q = t.subquestionId ? state.subquestions.find((x) => x.id === t.subquestionId) : null;
  const refOpen = (r) => {
    if (r.kind === "table") return ` <button class="tbl-open" data-tid="${r.id}">查看表格</button>`;
    if (r.kind === "measurement") {
      const mr = state.measurements.find((x) => x.id === r.id);
      const tb = state.tables.find((x) => x.assetId === r.id) || (mr?.cellRef ? state.tables.find((t) => t.id === mr.cellRef.tableId) : null);
      return tb ? ` <button class="tbl-open" data-tid="${tb.id}">查看表格</button>` : ` <span class="hint">（无关联数据表）</span>`;
    }
    return "";
  };
  const inc = t.optional.map((o, i) => ({ o, i })).filter(({ o }) => o.included);
  const others = t.optional.map((o, i) => ({ o, i })).filter(({ o }) => !o.included);
  const cand = ({ o, i }) => `<li><label><input type="checkbox" class="cand-toggle" data-idx="${i}" ${o.included ? "checked" : ""}/> ${esc(refLabel(o.ref))}</label>${refOpen(o.ref)}</li>`;
  return `
    <p><b>课题「${esc(topicName(t.topicId) ?? t.topicId)}」${q ? ` → 子问题「${esc(q.question)}」` : ""}</b></p>
    <p class="hint">必选（锁定，不可取消）：</p>
    <ul>${t.core.map((r) => `<li>🔒 ${esc(refLabel(r))}${refOpen(r)}</li>`).join("") || `<li class="hint">无</li>`}</ul>
    <p class="hint">默认已选（可取消）：</p>
    ${inc.length ? `<ul>${inc.map(cand).join("")}</ul>` : `<p class="hint">无。</p>`}
    ${others.length ? `<details class="mini"><summary>其他可选（${others.length}，折叠）</summary><ul>${others.map(cand).join("")}</ul></details>` : ""}
    ${t.optional.length ? `<button id="cand-save">保存候选选择</button>` : `<p class="hint">无候选。</p>`}
    ${t.snapshot ? snapshotHtml(t.snapshot) : ""}`;
}

const REPORT_NATURES = [["observation", "观察"], ["hypothesis", "假设"], ["interpretation", "解释"], ["to_verify", "待验证"], ["human_judgment", "人工判断"]];
const natureLabel = (n) => (REPORT_NATURES.find(([k]) => k === n)?.[1] ?? n);
const refDisplay = (r) => r.version ? `${r.label}（${humanVer(r.version)}）` : r.label;

/** 触发浏览器下载（本地服务带 content-disposition）。 */
function download(path) {
  const a = document.createElement("a");
  a.href = path; a.download = ""; document.body.append(a); a.click(); a.remove();
}

function blockRowHtml(b, i) {
  return `<div class="reprow" data-bid="${esc(b.id)}" data-refs="${esc(JSON.stringify(b.refs ?? []))}">
    <div class="repmove"><button class="rep-up" title="上移">↑</button><button class="rep-down" title="下移">↓</button><span class="hint">#${i + 1}</span></div>
    <select class="rep-nature">${REPORT_NATURES.map(([k, l]) => `<option value="${k}" ${k === b.nature ? "selected" : ""}>${l}</option>`).join("")}</select>
    <textarea class="rep-text" rows="2">${esc(b.text)}</textarea>
    <input class="rep-refs" value="${esc((b.refs ?? []).map((r) => r.label).join("；"))}" placeholder="引用（分号分隔）"/>
    <div class="reprowactions">
      <span class="badge ${b.draft ? "warn" : "confirm"}">${b.draft ? "AI 草稿待确认" : "已确认"}</span>
      ${b.draft ? `<button class="rep-confirm">确认</button>` : ""}
      <button class="rep-del">删除</button>
    </div>
    ${(b.refs ?? []).filter((r) => r.kind !== "note").length ? `<div class="refchips">${b.refs.filter((r) => r.kind !== "note").map((r) => `<span class="refchip">${esc(refDisplay(r))} <button class="ref-back" data-kind="${esc(r.kind)}" data-id="${esc(r.id)}">回查</button></span>`).join("")}</div>` : ""}
    <div class="refnet-body"></div></div>`;
}

function reportHtml(r) {
  return `<details class="mini rep" data-repid="${r.id}" ${r.id === ui.reportId ? "open" : ""}><summary>分析初稿 r${r.revision} · 钉住 ${r.pinned.resultIds.length} 结果${r.pinned.snapshotHash ? ` · 快照 ${r.pinned.snapshotHash.slice(0, 8)}…` : ""}</summary>
    <p class="hint">块＝性质＋固定引用；改动→预览→新版本。</p>
    <div class="repblocks">${r.blocks.map(blockRowHtml).join("") || `<p class="hint">尚无块。</p>`}</div>
    <div class="repaddrow">
      <select class="rep-newnature">${REPORT_NATURES.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
      <button class="rep-add">＋ 添加块</button>
      <button class="rep-draft">由任务生成草稿</button>
    </div>
    <input class="rep-reason" placeholder="修订原因（必填，留历史）"/>
    <div class="repaddrow">
      <button class="primary rep-preview">预览改动</button>
      <button class="rep-docx" data-repid="${r.id}">Word 导出</button>
      <button class="rep-trace" data-repid="${r.id}">追溯包</button>
    </div>
    <div class="rep-diff"></div>
    ${r.history.length ? `<details class="mini"><summary>历史（${r.history.length}）</summary>${r.history.map((h) => `<p class="hint">${fmtVersion(h.revision)} · ${esc(fmtTime(h.at))} · ${esc(h.reason)}</p>`).join("")}</details>` : ""}
  </details>`;
}

function collectReportBlocks(repEl) {
  return [...repEl.querySelectorAll(".repblocks .reprow")].map((row) => {
    let refs = [];
    try { refs = JSON.parse(row.dataset.refs || "[]"); } catch {}
    const labels = row.querySelector(".rep-refs").value.split(/[;；]/).map((s) => s.trim()).filter(Boolean);
    const outRefs = labels.map((lab, j) => refs[j] ? { ...refs[j], label: lab } : { kind: "note", id: "", version: "", label: lab });
    return { id: row.dataset.bid || undefined, nature: row.querySelector(".rep-nature").value, text: row.querySelector(".rep-text").value.trim(), refs: outRefs };
  });
}

function renderBlockDiff(el, diff, reportId) {
  if (diff.same) { el.innerHTML = `<p class="hint">未检测到块改动。</p>`; return; }
  const part = (label, arr, fmt) => arr.length ? `<p class="hint"><b>${label}</b> ${arr.map(fmt).join("；")}</p>` : "";
  el.innerHTML = `<div class="diffbox">
    ${part("新增", diff.added, (a) => `[${natureLabel(a.nature)}] ${esc(a.text)}`)}
    ${part("删除", diff.removed, (a) => `[${natureLabel(a.nature)}] ${esc(a.text)}`)}
    ${part("修改", diff.changed, (c) => `[${natureLabel(c.after.nature)}] ${esc(c.text)}（${c.fields.join("/")}）`)}
    ${part("顺序", diff.reordered, (o) => `#${o.from + 1}→#${o.to + 1}`)}
    <button class="primary rep-accept" data-repid="${reportId}" data-rev="${diff.baseRevision}">接受并保存为新版本</button></div>`;
}

function resultHtml(r) {
  const atts = r.assetIds.map((id) => state.assets.find((a) => a.id === id)).filter(Boolean);
  return `<details class="mini"><summary>结果 · ${esc(r.method)} ${r.reproducible ? `<span class="badge confirm">可复现</span>` : `<span class="badge warn">不可复现</span>`} · r${r.revision}</summary>
    <p>参数：${esc(r.params) || "（未填）"}</p>
    ${r.adoptedRecommendation ? `<p class="hint">采纳推荐：${esc(r.adoptedRecommendation)}</p>` : r.reason ? `<p class="hint">不采纳理由：${esc(r.reason)}</p>` : ""}
    ${r.note ? `<p class="hint">备注：${esc(r.note)}</p>` : ""}
    ${r.missing.length ? `<p class="hint">缺项：${r.missing.map(esc).join("；")}</p>` : ""}
    <p class="hint">附件：${atts.map((a) => esc(a.name)).join("、") || "无"}</p>
    <details class="mini"><summary>修订结果（留历史）</summary>
      <div class="resedit" data-rid="${r.id}">
        <input data-field="method" value="${esc(r.method)}"/>
        <textarea data-field="params" rows="2">${esc(r.params)}</textarea>
        <input data-field="note" value="${esc(r.note)}" placeholder="备注"/>
        <input data-field="reason" placeholder="修订原因（必填）"/>
        <button class="res-edit-save">保存修订</button>
      </div></details>
    ${r.history.length ? `<details class="mini"><summary>历史（${r.history.length}）</summary>${r.history.map((h) => `<p class="hint">${fmtVersion(h.revision)} · ${esc(fmtTime(h.at))} · ${esc(h.reason)} · 方法 ${esc(h.method)}</p>`).join("")}</details>` : ""}
  </details>`;
}

function analysisRightHtml() {
  const t = currentTask();
  if (!t) return `<p class="hint">选择分析任务后：这里做推荐、提交结果、写分析初稿。</p>`;
  const rec = t.recommendation;
  const results = t.resultIds.map((id) => state.analysisResults.find((r) => r.id === id)).filter(Boolean);
  const reps = state.reports.filter((r) => r.taskId === t.id);
  let h = `<details class="mini" open><summary>方法推荐（含验收项；预期产物≠预设结论）</summary>
    <textarea id="an-purpose" rows="2" placeholder="研究目的（必填，如：估计 pH3 下酶活半衰期并比较 pH5）"></textarea>
    <button class="primary" id="an-recommend">${rec ? "重新推荐（生成新快照）" : "发起方法推荐"}</button>`;
  if (rec) {
    h += rec.methods.map((m) => `<div class="item"><b>${esc(m.name)}</b> · 软件：${esc(m.software)}<p>${esc(m.rationale)}</p>
      <p class="hint">预期产物：${m.expectedArtifacts.map(esc).join("；") || "（未列）"}</p>
      <p class="hint">验收项：${m.acceptanceItems.map(esc).join("；") || "（未列）"}</p></div>`).join("");
    if (rec.unknowns.length) h += `<p class="hint">未知/待补：${rec.unknowns.map(esc).join("；")}</p>`;
    h += `<details class="mini"><summary>AI 原始返回</summary><pre>${esc(rec.raw)}</pre></details>`;
  }
  h += `</details>`;
  h += `<details class="mini" ${results.length ? "" : "open"}><summary>提交处理结果（Origin/MATLAB 等外部工具允许）</summary>
    <input id="res-method" placeholder="实际使用的方法（如 Origin 双指数衰减拟合）"/>
    <textarea id="res-params" rows="2" placeholder="关键参数（拟合区间/初值/软件版本等；缺参数不标可复现）"></textarea>
    <select id="res-adopt"><option value="">未采纳推荐（须填理由）</option>${(rec?.methods ?? []).map((m) => `<option value="${esc(m.name)}">采纳：${esc(m.name)}</option>`).join("")}</select>
    <input id="res-reason" placeholder="不采纳理由（简短）"/>
    <input id="res-note" placeholder="备注（可选）"/>
    <input id="res-files" type="file" multiple accept=".csv,.tsv,.json,.txt,.md,.png,.jpg,.jpeg,.webp"/>
    <p class="hint">只有图/脚本也可提交，但不标「可复现」；附数据文件（csv/tsv/json/txt/md）＋关键参数才可复现。</p>
    <button class="primary" id="res-submit">提交结果</button></details>`;
  h += results.map(resultHtml).join("");
  h += `<details class="mini" open><summary>分析初稿（有序块 · 性质 · 固定引用 · 仅供参考，非最终结论）</summary>
    <button id="rep-create">新建初稿（钉住结果）</button>
    ${reps.map(reportHtml).join("") || `<p class="hint">暂无报告。</p>`}</details>`;
  return h;
}

function chatHtml(c) {
  const msgs = c.messages.map((m) => {
    if (m.role === "user") return `<div class="chatmsg user"><p>${esc(m.content)}</p></div>`;
    const badge = { running: `<span class="badge warn">运行中</span>`, done: "", failed: `<span class="badge cand-pending">失败</span>`, cancelled: `<span class="badge">已取消</span>` }[m.status];
    let body;
    if (m.status === "running") body = `<p class="hint">等待 AI 返回… <button class="chat-cancel" data-mid="${m.id}">取消</button></p>`;
    else if (m.status === "failed") body = `<p class="hint">失败：${esc(m.error ?? "")} <button class="chat-retry" data-mid="${m.id}">重试</button></p>`;
    else if (m.status === "cancelled") body = `<p class="hint">已取消：返回内容被丢弃，不写入。 <button class="chat-retry" data-mid="${m.id}">重试</button></p>`;
    else body = `<p>${esc(m.content)}</p>
      ${m.sources.length ? `<details class="mini"><summary>来源（${m.sources.length}）</summary><ul>${m.sources.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></details>` : ""}
      ${m.snapshot ? `<details class="mini"><summary>本次冻结快照 · hash ${m.snapshot.hash.slice(0, 12)}…</summary>${snapshotHtml(m.snapshot)}</details>` : ""}`;
    return `<div class="chatmsg assistant">${badge}${body}</div>`;
  }).join("");
  const running = c.messages.some((m) => m.status === "running");
  return `<div class="chatlog">${msgs || `<p class="hint">还没有消息。输入问题开始讨论（范围与采纳见右栏）。</p>`}</div>
    <div class="row"><textarea id="chat-text" rows="2" placeholder="围绕本课题/子问题与已选对象提问…"></textarea>
    <button class="primary" id="chat-send" ${running ? "disabled" : ""}>${running ? "回答运行中…" : "发送"}</button></div>`;
}

function chatRightHtml() {
  const c = currentChat();
  if (!c) return `<p class="hint">选择会话后：这里显示范围、建议采纳与最近一次冻结快照。</p>`;
  const q = c.subquestionId ? state.subquestions.find((x) => x.id === c.subquestionId) : null;
  let h = `<p><b>范围</b>：课题「${esc(topicName(c.topicId) ?? c.topicId)}」${q ? ` → 子问题「${esc(q.question)}」` : ""}</p>
    <ul>${c.scope.map((r) => `<li>${esc(refLabel(r))} <span class="hint">${r.kind}:${r.id}</span></li>`).join("") || `<li class="hint">未选对象（仅课题层）。</li>`}</ul>
    <p class="hint"><b>建议采纳</b>：讨论不修改对象；逐条预览＋人工确认后才写入目标。</p>`;
  const proposals = c.messages.flatMap((m) => m.proposals.map((p, i) => ({ m, p, i })));
  h += proposals.length
    ? proposals.map(({ m, p, i }) => `<div class="item"><p>${esc(p.preview)}</p>
        <p class="hint">目标：${p.targetKind === "execution-note" ? "执行备注" : "报告待验证"} · ${esc(p.targetId)}</p>
        ${p.confirmed ? `<span class="badge confirm">已采纳 ${esc(p.adoptedAt ?? "")}</span>` : `<button class="chat-adopt" data-mid="${m.id}" data-idx="${i}">确认采纳</button>`}</div>`).join("")
    : `<p class="hint">暂无建议。</p>`;
  const last = [...c.messages].reverse().find((m) => m.role === "assistant" && m.status === "done" && m.snapshot);
  if (last) h += snapshotHtml(last.snapshot);
  return h;
}

function ocrHtml(asset) {
  const ocrs = state.ocrs.filter((o) => o.assetId === asset.id);
  return `
    <div class="item" data-id="${asset.id}">
      <div class="meta">手写记录 · ${esc(asset.name)} · 原图已归档</div>
      <div class="row"><button class="primary" id="ocr-ai">AI 识别（视觉独立任务）</button><span class="hint">失败不降级为假 AI；可人工转录兜底（标 manual）。</span></div>
      <details class="mini"><summary>人工转录（兜底）</summary>
        <textarea id="ocr-raw" rows="3" placeholder="逐字转录，不清处用 ? 占位"></textarea>
        <textarea id="ocr-fields" rows="2" placeholder="字段，每行 键=值"></textarea>
        <div class="row"><input id="ocr-unknowns" placeholder="未知项（逗号分隔）" /><button id="ocr-manual-add">保存转录草稿</button></div>
      </details>
    </div>
    ${ocrs.map((o) => `<div class="item ocr" data-id="${o.id}">
      <div class="meta"><span class="badge ${o.extraction === "ai" ? "ai" : ""}">${o.extraction}</span>
        <span class="badge ${o.status === "confirmed" ? "confirm" : "cand-pending"}">${o.status === "confirmed" ? "已确认" : "草稿"}</span> · 第${o.revision}版</div>
      <div class="row"><label>转录</label><input data-field="oRaw" value="${esc(o.rawText)}" /></div>
      ${Object.entries(o.fields).map(([k, v]) => `<div class="row"><label>${esc(k)}</label><input data-ofkey="${esc(k)}" value="${esc(v)}" /></div>`).join("")}
      <div class="row"><input data-field="oNewKey" placeholder="新字段名" /><input data-field="oNewVal" placeholder="值" /></div>
      ${o.unknowns.length ? `<div class="hint warn">未知：${o.unknowns.map(esc).join("、")}</div>` : ""}
      <div class="row"><input data-field="oReason" placeholder="修改原因（改转录/数值必填）" />
        <button class="primary ocr-confirm">${o.status === "confirmed" ? "再次确认" : "人工确认"}</button><button class="history-btn">历史(${o.history.length})</button></div>
    </div>`).join("")}`;
}

/** 左栏工具：方案导航=模板；记录导航=样品/图片；文献导航=映射/比较。 */
function renderRecordTools(box) {
  const samples = state.samples.filter((s) => !ui.topicId || s.topicId === ui.topicId);
  const imgs = state.assets.filter((a) => a.kind === "image" && (!ui.topicId || a.topicId === ui.topicId || !a.topicId));
  box.innerHTML = `
    <div class="pane-title">样品（短号稳定，改名不破引用）</div>
    ${samples.map((s) => `<div class="item smp" data-id="${s.id}">
      <div class="meta"><strong>${esc(s.shortName)}</strong> · ${s.states.length} 状态</div>
      <div class="row"><input data-field="smpName" value="${esc(s.displayName)}" /><button class="smp-rename">改名</button></div>
      <details class="mini"><summary>追加状态（分样/处理/用途）</summary>
        <div class="row"><input data-field="stValue" placeholder="用量（必填）" /><input data-field="stUnit" placeholder="单位" />
          <label><input type="checkbox" data-field="stEst" /> 估计</label></div>
        <div class="row"><input data-field="stHandling" placeholder="处理" /><input data-field="stUse" placeholder="用途" /></div>
        <div class="row"><input data-field="stNote" placeholder="备注" /><button class="smp-state">追加状态</button></div>
      </details>
      <div class="hint">历史：${s.states.map((st) => `r${st.revision} ${esc(st.amount.value)}${esc(st.amount.unit)}${st.amount.estimated ? "(估)" : ""}`).join(" → ")}</div>
    </div>`).join("") || `<p class="hint">暂无样品。</p>`}
    <details class="mini"><summary>新建样品</summary>
      <div class="row"><input id="smp-short" placeholder="短号（唯一，如 S1）" /><input id="smp-display" placeholder="显示名（可后改）" /></div>
      <div class="row"><input id="smp-value" placeholder="用量（必填）" /><input id="smp-unit" placeholder="单位" />
        <label><input type="checkbox" id="smp-est" /> 估计</label></div>
      <div class="row"><input id="smp-handling" placeholder="处理" /><input id="smp-use" placeholder="用途" /></div>
      <button class="primary" id="smp-create">创建样品</button>
    </details>
    <div class="pane-title">手写图片（OCR）</div>
    <details class="mini"><summary>上传原图（PNG/JPEG/WebP）</summary>
      <input id="img-file" type="file" accept="image/png,image/jpeg,image/webp" />
      <button id="img-import">归档原图</button>
    </details>
    ${imgs.map((a) => `<div class="material ${a.id === ui.assetId ? "active" : ""}" data-aid="${a.id}">
      <div class="m-title">${esc(a.name)}</div><div class="m-meta">图片 · ${a.bytes}B · OCR ${state.ocrs.filter((o) => o.assetId === a.id).length}</div>
    </div>`).join("") || `<p class="hint">暂无图片。真实手写公开材料缺位时可用人工转录兜底。</p>`}`;
}

// ── 事件 ────────────────────────────────────────────────────
/** 工作区跳转（课题首页/待办/条目页的入口按钮）。 */
document.addEventListener("click", (ev) => {
  const b = ev.target.closest(".goto"); if (!b) return;
  if (!guardLeave()) return;
  if (b.dataset.topic) ui.topicId = b.dataset.topic;
  if (b.dataset.paper) ui.paperId = b.dataset.paper;
  ui.nav = b.dataset.goto; ui.highlight = null; ui.cell = null; ui.groupSel.clear(); ui.batch = null; ui.ack = false;
  renderAll();
});
$("#nav").addEventListener("click", (ev) => {
  if (ev.target.closest("#nav-toggle")) { ui.navCollapsed = !ui.navCollapsed; saveUi(); renderShell(); return; }
  const b = ev.target.closest(".navitem"); if (!b || b.disabled) return;
  if (!guardLeave()) return;
  clearAllErrors();
  ui.nav = b.dataset.nav; ui.highlight = null; ui.cell = null; ui.tableId = null; ui.groupSel.clear(); ui.batch = null; ui.ack = false;
  ui.stepSel = null; ui.viewRev = null; ui.editEventId = null; ui.pauseSuggest = null; ui.prepExtra = 0;
  renderAll();
});
// 页头「当前课题」（容器 #curtopic 常驻，用委托）
$("#curtopic").addEventListener("change", (e) => {
  if (e.target.id !== "topic-select") return;
  if (!guardLeave()) { renderShell(); return; }
  clearAllErrors();
  ui.topicId = e.target.value; ui.assetId = null; ui.highlight = null; ui.groupSel.clear(); ui.batch = null; ui.protocolId = null; ui.executionId = null; ui.stepSel = null; ui.viewRev = null; ui.taskId = null; ui.chatId = null; ui.reportId = null; renderAll();
});
// 创建课题 / 子问题（中间区随渲染重建，用委托）
document.addEventListener("click", (ev) => {
  if (ev.target.id === "topic-create") { runBusy(ev.target, "创建课题", async () => {
    const r = await api.createTopic($("#topic-name").value, $("#topic-q").value);
    ui.topicId = r.topicId; await refresh(); setStatus("课题已创建");
  }); return; }
  if (ev.target.id === "subq-create") { runBusy(ev.target, "创建子问题", async () => {
    if (!ui.topicId) { setError("mid", { panel: "mid", message: "请先创建或选择课题。", detail: "", retry: null }); return; }
    await api.createSubquestion(ui.topicId, $("#subq-q").value, $("#subq-kind").value); $("#subq-q").value = ""; await refresh(); setStatus("子问题已添加");
  }); return; }
});
// 分区报错条：关闭 / 详情 / 重试
document.addEventListener("click", (ev) => {
  const bar = ev.target.closest(".panelerr"); if (!bar) return;
  const panel = bar.dataset.panel || "mid";
  if (ev.target.classList.contains("perr-close")) { clearError(panel); return; }
  if (ev.target.classList.contains("perr-detail")) { const d = bar.querySelector(".perr-detail-body"); if (d) d.hidden = !d.hidden; return; }
  if (ev.target.classList.contains("perr-retry")) { const r = errors[panel]?.retry; clearError(panel); if (r) r(); return; }
});
// 领域知识页（B2）：卡片审阅动作
async function kzAct(fn, msg) {
  try { await fn(); ui.dirty = false; await refresh(); setStatus(msg); }
  catch (e) { const h = humanError(e); setError("mid", { panel: "mid", message: h.message, detail: h.detail, retry: null }); }
}
document.addEventListener("click", (ev) => {
  const t = ev.target;
  if (t.classList.contains("kztab")) { ui.kzTab = t.dataset.kztab; ui.cardOpen = null; renderMiddle(); return; }
  if (t.classList.contains("kz-open")) { ui.cardOpen = ui.cardOpen === t.dataset.cid ? null : t.dataset.cid; renderMiddle(); return; }
  if (t.classList.contains("kzq-item")) { ui.kzTab = "todo"; ui.cardOpen = t.dataset.cid; renderMiddle(); return; }
  if (t.classList.contains("kz-locate")) { ui.highlight = t.dataset.quote || null; renderShell(); const m = document.querySelector("#kz-text mark"); if (m) m.scrollIntoView({ block: "center" }); return; }
  if (t.classList.contains("kzq-cancel")) { if (ui.kzJob?.id) api.cancelKnowledgeJob(ui.kzJob.id).then(() => setStatus("已请求取消：保留已出内容")).catch(() => {}); return; }
  if (t.classList.contains("kzq-retry")) {
    const idx = Number(t.dataset.index);
    if (ui.kzJob?.id) { t.disabled = true; api.retryKnowledgeChunk(ui.kzJob.id, idx)
      .then(async (r) => { await refreshAfterJob(); ui.kzJob = { ...ui.kzJob, chunkErrors: (ui.kzJob.chunkErrors ?? []).filter((e) => e.index !== idx), created: ui.kzJob.created + (r.created ?? 0) }; renderRight(); setStatus(`第 ${idx + 1} 段已重试（新增 ${r.created} 张）`); })
      .catch((e) => { const h = humanError(e); setError("mid", { panel: "mid", message: h.message, detail: h.detail, retry: null }); t.disabled = false; }); }
    return;
  }
  const cid = t.dataset.cid;
  if (!cid) return;
  if (t.classList.contains("kz-cand")) { kzAct(() => api.reviewCard(cid, { audit: "confirm" }), "已入候选"); return; }
  if (t.classList.contains("kz-skip")) { kzAct(() => api.reviewCard(cid, { audit: "skip" }), "已跳过（可回来）"); return; }
  if (t.classList.contains("kz-excl")) { const inp = t.closest(".kzcard")?.querySelector(".kz-exclr"); const reason = (inp?.value ?? "").trim(); kzAct(() => api.reviewCard(cid, reason ? { audit: "exclude", reason } : { audit: "exclude" }), "已排除"); return; }
  if (t.classList.contains("kz-undo")) { kzAct(() => api.reviewCard(cid, { audit: "unreviewed" }), "已撤回（回到待审）"); return; }
  if (t.classList.contains("kz-skipall")) {
    if (!confirm("一键全部跳过：为时间紧准备，不推荐。确定跳过本页所有待审卡？")) return;
    const ids = state.cards.filter((c) => (ui.paperId ? c.paperId === ui.paperId : true) && ["unreviewed", "need_info"].includes(c.audit)).map((c) => c.id);
    kzAct(async () => { for (const id of ids) await api.reviewCard(id, { audit: "skip" }); }, `已跳过 ${ids.length} 张`);
    return;
  }
});
document.addEventListener("change", (ev) => {
  if (ev.target.id === "kz-paper") { ui.paperId = ev.target.value; ui.assetId = null; ui.cardOpen = null; ui.highlight = null; ui.kzJob = null; clearAllErrors(); renderAll(); return; }
  if (ev.target.classList.contains("kz-imp")) { const cid = ev.target.dataset.cid; kzAct(() => api.reviewCard(cid, { importance: ev.target.value || null }), "重要程度已记"); }
});
document.addEventListener("focusout", (ev) => {
  if (ev.target.classList.contains("kz-note")) { const cid = ev.target.dataset.cid; kzAct(() => api.reviewCard(cid, { note: ev.target.value }), "备注已记"); }
});
// 实验图（中栏）：点节点选择步骤 + 图下固定区编辑（保存追加新快照）
document.addEventListener("click", (ev) => {
  const t = ev.target;
  const node = t.closest(".dnode");
  if (node) { if (ui.nav === "protocol") { ui.stepSel = node.dataset.step; renderMiddle(); } return; }
  if (t.id === "step-cancel") { ui.stepSel = null; renderMiddle(); return; }
  if (t.id === "step-add") {
    const op = ($("#newstep-op")?.value ?? "").trim();
    if (!op) { notify("mid", "新步骤操作名不能为空"); return; }
    const p = currentProtocol(); const latest = p.revisions[p.revisions.length - 1];
    runBusy(t, "添加步骤", async () => { await api.editProtocol(p.id, { steps: [...latest.steps, { op, durationMin: null, branch: null, estimated: false }], reason: `添加步骤：${op}` }); ui.dirty = false; await refresh(); setStatus(`已添加步骤（${fmtVersion(p.revision + 1)}）`); }); return;
  }
  if (t.id === "step-save") {
    const p = currentProtocol(); const latest = p.revisions[p.revisions.length - 1];
    const params = {};
    for (const line of $("#se-params").value.split(/\n/)) { const i = line.indexOf("="); if (i > 0) params[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
    const durRaw = $("#se-dur").value;
    const edited = {
      id: ui.stepSel === "new" ? undefined : ui.stepSel,
      op: $("#se-op").value, params, note: $("#se-note").value,
      durationMin: durRaw === "" ? null : Number(durRaw),
      estimated: $("#se-est").checked, branch: $("#se-branch").value.trim() || null, observeEnd: $("#se-end").value,
      branchFrom: $("#se-fork")?.value || null, mergeInto: $("#se-merge")?.value || null,
    };
    const steps = ui.stepSel === "new" ? [...latest.steps, edited] : latest.steps.map((s) => (s.id === ui.stepSel ? { ...s, ...edited, id: s.id } : s));
    runBusy(t, "保存步骤", async () => { await api.editProtocol(p.id, { steps, reason: $("#se-reason").value }); ui.stepSel = null; ui.dirty = false; await refresh(); setStatus("步骤已保存（追加新快照，旧版本不动）"); }); return;
  }
});
// 通用（中栏或右栏皆可）：修订/快照历史、方案导出 JSON、影响分析运行
document.addEventListener("click", (ev) => {
  const t = ev.target;
  if (t.classList.contains("history-btn")) {
    const item = t.closest(".item"); const id = item?.dataset.id; if (!id) return;
    const obj = state.cards.find((c) => c.id === id) ?? state.tables.find((x) => x.id === id) ?? state.ocrs.find((o) => o.id === id) ?? state.measurements.find((m) => m.id === id) ?? state.papers.find((p) => p.id === id);
    if (obj) { openHistory(obj); return; }
    const p = state.protocols.find((x) => x.id === id);
    if (p) { openHistory({ revision: p.revision, history: p.revisions.map((r) => ({ revision: r.revision, field: "整版快照", before: r.revision > 1 ? fmtVersion(r.revision - 1) : "—", after: `${r.steps.length} 步`, reason: r.reason, at: r.at })) }); return; }
    return;
  }
  if (t.id === "proto-export") {
    const p = currentProtocol(); if (!p) return;
    const snap = viewSnapshot(p);
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: "application/json" });
    const aEl = document.createElement("a"); aEl.href = URL.createObjectURL(blob); aEl.download = `${p.name}_${fmtVersion(snap.revision)}.json`;
    aEl.click(); URL.revokeObjectURL(aEl.href); setStatus("已导出当前快照 JSON"); return;
  }
  if (t.classList.contains("imp-run")) {
    const iid = t.dataset.id;
    runJob(t, "AI 影响评估", async () => { const r = await api.runImpact(iid); const res = await pollJob(r.jobId, "影响评估"); await refreshAfterJob(); setStatus(res.discarded ? "已有更新改动：旧评估被丢弃（stale 守卫）" : "影响评估完成"); }); return;
  }
  // B4 步骤记录表 + 样品改名（记录页）
  const stepBtn = t.closest(".steptbl-save");
  if (stepBtn) {
    const row = stepBtn.closest("tr"); const sid = row.dataset.step; const opText = row.dataset.op || "步骤";
    const amount = row.querySelector('[data-f="amount"]').value.trim();
    const durRaw = row.querySelector('[data-f="dur"]').value.trim();
    const incident = row.querySelector('[data-f="incident"]').checked;
    const targetSel = row.querySelector('[data-f="target"]');
    const targetOp = (targetSel?.selectedOptions?.[0]?.textContent ?? "").replace(/^影响:/, "");
    runBusy(stepBtn, "记录步骤", async () => {
      await api.appendEvent(ui.executionId, { kind: "step", stepId: sid, text: opText, actual: { ...(amount ? { amount } : {}), ...(durRaw !== "" ? { durationMin: Number(durRaw) } : {}) } });
      if (incident && targetSel?.value) await api.appendEvent(ui.executionId, { kind: "deviation", stepId: sid, text: `意外：影响到「${targetOp}」` });
      ui.dirty = false; await refresh(); setStatus("步骤已记录（实际值入本次执行，不改源方案）");
    }); return;
  }
  const smpRename = t.closest(".smp-rename");
  if (smpRename) {
    const row = smpRename.closest(".smprow"); const id = row.dataset.id; const name = row.querySelector(".smp-name").value.trim();
    runBusy(smpRename, "改样品名", async () => { await api.renameSample(id, name); ui.dirty = false; await refresh(); setStatus("样品名已改（稳定编号不变）"); }); return;
  }
});
// 窄导航条：悬停显文字（title）；点击图标弹出完整导航抽屉
function openNavDrawer() {
  $("#nd-list").innerHTML = NAV_ITEMS.map(([k, l]) => `<button class="nd-item ${k === ui.nav ? "active" : ""}" data-nav="${k}">${esc(l)}</button>`).join("");
  $("#navdrawer").hidden = false;
}
$("#navrail").addEventListener("click", (ev) => { if (ev.target.closest(".navitem")) openNavDrawer(); });
$("#navdrawer").addEventListener("click", (ev) => {
  if (ev.target.id === "nd-close") { $("#navdrawer").hidden = true; return; }
  const b = ev.target.closest(".nd-item"); if (!b) return;
  $("#navdrawer").hidden = true;
  if (!guardLeave()) return;
  clearAllErrors();
  ui.nav = b.dataset.nav; ui.highlight = null; ui.cell = null; ui.tableId = null; ui.groupSel.clear(); ui.batch = null; ui.ack = false;
  ui.stepSel = null; ui.viewRev = null; ui.editEventId = null; ui.pauseSuggest = null; ui.prepExtra = 0;
  renderAll();
});

$("#material-list").addEventListener("click", (ev) => {
  const el = ev.target.closest(".material"); if (!el) return;
  if (el.dataset.paperid) {
    if (el.dataset.paperid === ui.paperId) return;
    if (!guardLeave()) return;
    ui.paperId = el.dataset.paperid; ui.attId = null; ui.assetId = null; ui.highlight = null; ui.groupSel.clear(); ui.batch = null; ui.ack = false; renderAll(); return;
  }
  if (el.dataset.pid) {
    if (el.dataset.pid === ui.protocolId) return;
    if (!guardLeave()) return;
    ui.protocolId = el.dataset.pid; ui.stepSel = null; ui.viewRev = null; ui.highlight = null; renderAll(); return;
  }
  if (el.dataset.eid) {
    if (el.dataset.eid === ui.executionId) return;
    if (!guardLeave()) return;
    ui.executionId = el.dataset.eid; ui.editEventId = null; ui.pauseSuggest = null; ui.prepExtra = 0; ui.assetId = null; renderAll(); return;
  }
  if (el.dataset.atid) {
    if (el.dataset.atid === ui.taskId) return;
    if (!guardLeave()) return;
    ui.taskId = el.dataset.atid; ui.reportId = null; renderAll(); return;
  }
  if (el.dataset.cid) {
    if (el.dataset.cid === ui.chatId) return;
    if (!guardLeave()) return;
    ui.chatId = el.dataset.cid; renderAll(); return;
  }
  if (el.dataset.id === ui.assetId) return;
  if (!guardLeave()) return;
  ui.assetId = el.dataset.id; ui.highlight = null; ui.cell = null; ui.tableId = null; ui.groupSel.clear(); ui.batch = null; ui.ack = false; renderAll();
});
$("#mid-content").addEventListener("click", async (ev) => {
  if (ev.target.classList.contains("tbl-open")) { openTableMax(ev.target.dataset.tid); return; }
  if (ev.target.id === "cand-save") {
    const t = currentTask(); if (!t) return;
    await runBusy(ev.target, "保存候选", async () => {
      const optional = [...$$("#mid-content .cand-toggle")].map((cb) => ({ ref: t.optional[Number(cb.dataset.idx)].ref, included: cb.checked }));
      await api.setTaskCandidates(t.id, optional);
      await refresh(); setStatus("候选选择已保存（旧快照不受影响）");
    }); return;
  }
  if (ev.target.id === "chat-send") {
    const c = currentChat(); if (!c) return;
    const text = $("#chat-text").value.trim();
    if (!text) { setStatus("请输入讨论内容"); return; }
    await runJob(ev.target, "上下文讨论", async () => {
      const r = await api.sendChat(c.id, text);
      $("#chat-text").value = "";
      await refresh();
      await pollJob(r.jobId, "上下文讨论");
      await refreshAfterJob(); setStatus("讨论完成（建议采纳见右栏）");
    }); return;
  }
  if (ev.target.classList.contains("chat-cancel")) {
    const c = currentChat(); if (!c) return;
    await runBusy(ev.target, "取消回答", async () => {
      await api.cancelChatMessage(c.id, ev.target.dataset.mid);
      await refresh(); setStatus("已取消：若 AI 稍后返回，内容将被丢弃不写入");
    }); return;
  }
  if (ev.target.classList.contains("chat-retry")) {
    const c = currentChat(); if (!c) return;
    await runJob(ev.target, "重试回答", async () => {
      const r = await api.retryChatMessage(c.id, ev.target.dataset.mid);
      await refresh();
      await pollJob(r.jobId, "上下文讨论");
      await refreshAfterJob(); setStatus("重试完成");
    }); return;
  }
});
$("#right-content").addEventListener("change", (ev) => {
  if (ev.target.classList.contains("paper-topic")) {
    const p = currentPaper();
    runBusy(null, "课题关联", async () => {
      await api.linkPaperTopic(p.id, ev.target.value, ev.target.checked);
      await refresh(); setStatus(ev.target.checked ? "已关联课题（多课题可引用同一来源）" : "已解除课题关联");
    }); return;
  }
  if (ev.target.id === "proto-rev") { ui.viewRev = Number(ev.target.value); ui.stepSel = null; renderMiddle(); renderRight(); }
  if (ev.target.id === "meas-sample") {
    const s = state.samples.find((x) => x.id === ev.target.value);
    $("#meas-srev").innerHTML = (s?.states ?? []).map((st) => `<option value="${st.revision}">状态 ${st.revision}</option>`).join("");
  }
  if (ev.target.classList.contains("grp")) {
    const id = ev.target.dataset.id;
    if (ev.target.checked) ui.groupSel.add(id); else ui.groupSel.delete(id);
    renderRight();
  }
  if (ev.target.id === "batch-ack") { ui.ack = ev.target.checked; renderRight(); }
});
$("#right-content").addEventListener("input", (ev) => { if (ev.target.closest(".item") || ev.target.closest(".resedit") || ev.target.closest(".reprow")) ui.dirty = true; });
$("#right-content").addEventListener("click", async (ev) => {
  const item = ev.target.closest(".item");
  const val = (f) => item?.querySelector(`[data-field="${f}"]`)?.value ?? "";
  const splitList = (s) => String(s ?? "").split(/[,，]/).map((x) => x.trim()).filter(Boolean);
  try {
    // ── 5E：推荐 / 结果 / 报告 / 采纳 ──
    if (ev.target.id === "an-recommend") {
      const t = currentTask(); if (!t) return;
      const purpose = $("#an-purpose").value.trim();
      if (!purpose) { notify("right", "推荐须写明研究目的。"); return; }
      await runJob(ev.target, "方法推荐", async () => {
        const r = await api.recommendMethods(t.id, purpose);
        setStatus(`快照已冻结 ${r.snapshotHash.slice(0, 12)}…`);
        await pollJob(r.jobId, "方法推荐");
        await refreshAfterJob(); setStatus("方法推荐完成（含验收项）");
      }); return;
    }
    if (ev.target.id === "res-submit") {
      const t = currentTask(); if (!t) return;
      await runBusy(ev.target, "提交结果", async () => {
        const attachments = [];
        for (const f of [...($("#res-files").files ?? [])]) {
          const content = /^image\/(png|jpeg|webp)$/.test(f.type)
            ? await new Promise((res, rej) => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.onerror = rej; rd.readAsDataURL(f); })
            : await readTextFile(f);
          attachments.push({ name: f.name, content });
        }
        const r = await api.submitResult(t.id, { method: $("#res-method").value, params: $("#res-params").value, reason: $("#res-reason").value, note: $("#res-note").value, adoptedRecommendation: $("#res-adopt").value || undefined, attachments });
        await refresh(); setStatus(r.reproducible ? "结果已提交：可复现" : `结果已提交（不可复现：${r.missing.join("；")}）`);
      }); return;
    }
    if (ev.target.classList.contains("res-edit-save")) {
      const box = ev.target.closest(".resedit"); const rid = box.dataset.rid;
      const before = state.analysisResults.find((r) => r.id === rid);
      const v = (f) => box.querySelector(`[data-field="${f}"]`).value;
      await runBusy(ev.target, "修订结果", async () => {
        await api.editResult(rid, { method: v("method"), params: v("params"), note: v("note"), reason: v("reason") });
        const fields = [];
        if (before) { if (v("params") !== before.params) fields.push("params"); if (v("method") !== before.method) fields.push("method"); }
        ui.dirty = false; await refresh(); setStatus("结果已修订（留历史，可复现性重算）");
        await noteChangeHits("result", rid, fields);
      }); return;
    }
    if (ev.target.id === "rep-create") {
      const t = currentTask();
      await runBusy(ev.target, "新建报告", async () => {
        const r = await api.createReport(ui.topicId || t?.topicId, t?.id);
        ui.reportId = r.reportId; await refresh(); setStatus("初稿已建（钉住结果与快照）");
      }); return;
    }
    if (ev.target.classList.contains("rep-add")) {
      const box = ev.target.closest(".rep");
      const nature = box.querySelector(".rep-newnature").value;
      const row = document.createElement("div");
      row.className = "reprow"; row.dataset.bid = ""; row.dataset.refs = "[]";
      row.innerHTML = blockRowHtml({ id: "", nature, text: "", refs: [], draft: false }, box.querySelectorAll(".repblocks .reprow").length);
      box.querySelector(".repblocks").append(row);
      ui.dirty = true; return;
    }
    if (ev.target.classList.contains("rep-del")) { ev.target.closest(".reprow").remove(); ui.dirty = true; return; }
    if (ev.target.classList.contains("rep-up") || ev.target.classList.contains("rep-down")) {
      const row = ev.target.closest(".reprow"); const parent = row.parentElement;
      const sib = ev.target.classList.contains("rep-up") ? row.previousElementSibling : row.nextElementSibling;
      if (sib) { ev.target.classList.contains("rep-up") ? parent.insertBefore(row, sib) : parent.insertBefore(sib, row); ui.dirty = true; }
      return;
    }
    if (ev.target.classList.contains("ref-back")) {
      const body = ev.target.closest(".reprow").querySelector(".refnet-body");
      const kind = ev.target.dataset.kind, id = ev.target.dataset.id;
      await runJob(ev.target, "来源回查", async () => {
        const r = await api.backtrace(kind, id, "both");
        const byKind = {};
        for (const n of r.nodes) (byKind[n.kind] ??= []).push(n.label);
        body.innerHTML = `<div class="diffbox">${Object.entries(byKind).map(([k, arr]) => `<p class="hint"><b>${esc(k)}</b> ${arr.map(esc).join("、")}</p>`).join("")}${r.pending.length ? `<p class="hint">缺项：${r.pending.map(esc).join("；")}</p>` : ""}</div>`;
        setStatus(`回查 ${r.nodes.length} 个节点`);
      }); return;
    }
    if (ev.target.classList.contains("rep-docx")) { download(`/api/reports/${encodeURIComponent(ev.target.dataset.repid)}/export.docx`); setStatus("Word 已导出（快照，外部编辑不回流）"); return; }
    if (ev.target.classList.contains("rep-trace")) { download(`/api/reports/${encodeURIComponent(ev.target.dataset.repid)}/traceability.zip`); setStatus("追溯包已导出（含版本索引/许可过滤/manifest）"); return; }
    if (ev.target.classList.contains("rep-confirm")) {
      const box = ev.target.closest(".rep"); const repId = box.dataset.repid;
      const bid = ev.target.closest(".reprow").dataset.bid;
      await runBusy(ev.target, "确认草稿块", async () => {
        await api.confirmReportBlock(repId, bid, "已人工核对");
        await refresh(); setStatus("AI 草稿块已人工确认");
      }); return;
    }
    if (ev.target.classList.contains("rep-draft")) {
      const box = ev.target.closest(".rep"); const repId = box.dataset.repid;
      await runBusy(ev.target, "生成草稿", async () => {
        const r = await api.draftReport(repId);
        const holder = box.querySelector(".repblocks");
        const base = holder.querySelectorAll(".reprow").length;
        (r.blocks ?? []).forEach((b, i) => { const row = document.createElement("div"); row.className = "reprow"; row.dataset.bid = ""; row.dataset.refs = esc(JSON.stringify(b.refs ?? [])); row.innerHTML = blockRowHtml({ ...b, id: "" }, base + i); holder.append(row); });
        ui.dirty = true; setStatus(`草稿块 ${r.blocks.length} 个已入编辑器（未保存，须预览→接受）`);
      }); return;
    }
    if (ev.target.classList.contains("rep-preview")) {
      const box = ev.target.closest(".rep"); const repId = box.dataset.repid;
      let blocks;
      try { blocks = collectReportBlocks(box); } catch (e) { notify("right", String(e.message ?? e)); return; }
      if (!blocks.length) { notify("right", "至少需要一个块。"); return; }
      await runBusy(ev.target, "预览改动", async () => {
        const r = await api.previewReport(repId, blocks);
        renderBlockDiff(box.querySelector(".rep-diff"), r.diff, repId);
        setStatus(r.diff.same ? "未检测到改动。" : "已生成块级 diff，确认后接受为新版本。");
      }); return;
    }
    if (ev.target.classList.contains("rep-accept")) {
      const box = ev.target.closest(".rep"); const repId = ev.target.dataset.repid; const baseRevision = Number(ev.target.dataset.rev);
      const reason = box.querySelector(".rep-reason").value.trim();
      if (!reason) { notify("right", "报告修订必须填写原因（留历史）。"); return; }
      const blocks = collectReportBlocks(box);
      await runBusy(ev.target, "接受改动", async () => {
        const r = await api.applyReport(repId, baseRevision, blocks, reason);
        ui.reportId = repId; ui.dirty = false; await refresh(); setStatus(`改动已接受：新版本 r${r.revision}（留历史）`);
      }); return;
    }
    if (ev.target.classList.contains("chat-adopt")) {
      const c = currentChat(); if (!c) return;
      await runBusy(ev.target, "采纳建议", async () => {
        await api.adoptChatProposal(c.id, ev.target.dataset.mid, Number(ev.target.dataset.idx));
        await refresh(); setStatus("已采纳：写入目标对象（执行备注/报告待验证），来源可溯");
      }); return;
    }
    if (ev.target.classList.contains("span-link")) { ui.assetId = ev.target.dataset.asset; ui.highlight = ev.target.dataset.quote; renderMiddle(); return; }
    const attEl = ev.target.closest(".material[data-attid]");
    if (attEl) { ui.attId = attEl.dataset.attid; ui.highlight = null; renderMiddle(); renderRight(); return; }
    if (ev.target.id === "paper-save") {
      const p = currentPaper();
      await runBusy(ev.target, "保存题录", async () => {
        try {
          await api.updatePaper(p.id, { title: val("pTitle"), authors: val("pAuthors"), year: val("pYear"), doi: val("pDoi"), source: val("pSource"), license: val("pLicense"), note: val("pNote"), reason: val("pReason") });
          ui.dirty = false; await refresh(); setStatus("题录已保存（修订留历史）");
        } catch (e) {
          if (e.status === 409 && e.details?.existingPaperId) { showLocate(e.message, e.details.existingPaperId); return; }
          throw e;
        }
      }); return;
    }
    if (ev.target.id === "att-add") {
      const p = currentPaper();
      await runBusy(ev.target, "导入附件", async () => {
        const file = $("#att-file").files?.[0];
        let text = $("#att-text").value, name = file?.name ?? "";
        if (file) text = await readTextFile(file);
        if (!name) name = "attachment.md";
        try {
          const r = await api.addPaperAttachment(p.id, { name, text, role: $("#att-role").value, version: $("#att-version").value });
          ui.attId = r.attachmentId; $("#att-text").value = ""; if ($("#att-file")) $("#att-file").value = "";
          await refresh(); setStatus("附件已归档（未触发解析）");
        } catch (e) {
          if (e.status === 409) { showLocate(e.message, e.details?.existingPaperId ?? p.id); return; }
          throw e;
        }
      }); return;
    }
    if (ev.target.classList.contains("tab")) { ui.cardFilter = ev.target.dataset.filter; renderRight(); saveUi(); return; }
    if (ev.target.classList.contains("batch-preview")) {
      ui.batch = await api.batchPreview([...ui.groupSel]); ui.ack = false; renderRight(); return;
    }
    if (ev.target.classList.contains("batch-clear")) { ui.groupSel.clear(); ui.batch = null; ui.ack = false; renderRight(); return; }
    if (ev.target.classList.contains("batch-cancel")) { ui.batch = null; ui.ack = false; renderRight(); return; }
    if (ev.target.classList.contains("batch-confirm")) {
      await runBusy(ev.target, "整组确认", async () => {
        await api.batchConfirm([...ui.groupSel], ui.ack);
        ui.groupSel.clear(); ui.batch = null; ui.ack = false; ui.dirty = false;
        await refresh(); setStatus("整组已确认（含修订历史）");
      }); return;
    }
    if (ev.target.id === "mc-add") {
      await runBusy(ev.target, "手动补卡", async () => {
        const fields = {};
        for (const line of $("#mc-fields").value.split(/\n/)) {
          const i = line.indexOf("=");
          if (i > 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
        }
        await api.addCard({
          assetId: ui.assetId ?? state.attachments.find((a) => a.paperId === ui.paperId)?.assetId, rawText: $("#mc-raw").value, sectionQuote: $("#mc-quote").value,
          fields, units: splitList($("#mc-units").value), conditions: splitList($("#mc-conditions").value),
          unknowns: splitList($("#mc-unknowns").value), secondaryCitation: $("#mc-secondary").checked, reason: $("#mc-reason").value,
        });
        ui.dirty = false; await refresh(); setStatus("补卡成功（manual，待核对）");
      }); return;
    }
    if (!item) return;
    if (ev.target.classList.contains("raw") && ev.target.classList.contains("linkable")) {
      const c = state.cards.find((x) => x.id === item.dataset.id); ui.highlight = c?.locator.sectionQuote || c?.rawText || null;
      if (ui.nav === "knowledge" && c) ui.assetId = c.assetId;
      renderMiddle(); return;
    }
    if (ev.target.classList.contains("save-fields")) {
      const fields = {};
      item.querySelectorAll("[data-fkey]").forEach((inp) => { fields[inp.dataset.fkey] = inp.value; });
      const nk = val("newkey").trim();
      if (nk) fields[nk] = val("newval");
      await runBusy(ev.target, "保存字段", async () => {
        await api.reviewCard(item.dataset.id, { extracted: { fields, units: splitList(val("units")), conditions: splitList(val("conditions")) }, reason: val("reason") });
        ui.dirty = false; await refresh(); setStatus("字段/单位/条件已保存（含修订历史）");
      }); return;
    }
    if (ev.target.classList.contains("sec-toggle")) {
      const c = state.cards.find((x) => x.id === item.dataset.id);
      await runBusy(ev.target, "转引标记", async () => {
        await api.reviewCard(item.dataset.id, { secondaryCitation: !c.secondaryCitation, reason: val("reason") });
        ui.dirty = false; await refresh(); setStatus(c.secondaryCitation ? "已取消转引标记" : "已标记转引（二手，不计独立证据）");
      }); return;
    }
    if (ev.target.classList.contains("adopt-btn")) {
      await runBusy(ev.target, "记录采用", async () => {
        await api.adopt(item.dataset.id, val("adoptSubq"), val("adoptDecision"), val("adoptReason"));
        ui.dirty = false; await refresh(); setStatus("任务采用/排除已记录（独立于核对）");
      }); return;
    }
    if (ev.target.classList.contains("cell")) {
      const t = state.tables.find((x) => x.id === item.dataset.id);
      ui.cell = { tableId: t.id, row: Number(ev.target.dataset.row), col: Number(ev.target.dataset.col) };
      ui.highlight = lineOf(t, ui.cell.row); openTableMax(t.id); return;
    }
    if (ev.target.classList.contains("cancel-cell")) { const tid = ui.cell?.tableId; ui.cell = null; if (tid) openTableMax(tid); return; }
    if (ev.target.classList.contains("save-cell") && ui.cell) {
      const tid = ui.cell.tableId;
      await runBusy(ev.target, "保存单元格", async () => {
        await api.reviewTable(tid, { cellUpdates: [{ row: ui.cell.row, col: ui.cell.col, value: val("cellValue") }], reason: val("cellReason") });
        ui.cell = null; ui.dirty = false; await refresh(); setStatus("单元格已保存（含修订历史）"); openTableMax(tid);
      }); return;
    }
    if (ev.target.classList.contains("save")) {
      await runBusy(ev.target, "保存核对", async () => {
        await api.reviewCard(item.dataset.id, { audit: val("audit"), importance: val("importance") || null, note: val("note"), reason: val("reason") });
        ui.dirty = false; await refresh(); setStatus("已保存（含修订历史）");
      }); return;
    }
    if (ev.target.classList.contains("save-cols")) {
      const t = state.tables.find((x) => x.id === item.dataset.id);
      await runBusy(ev.target, "保存列设置", async () => {
        const columnUpdates = t.columns.map((_, i) => ({ index: i, unit: item.querySelector(`[data-col="${i}"][data-k="unit"]`).value, decision: item.querySelector(`[data-col="${i}"][data-k="decision"]`).value }));
        await api.reviewTable(t.id, { columnUpdates, note: val("note"), reason: val("reason") });
        ui.dirty = false; await refresh(); setStatus("列设置已保存"); openTableMax(t.id);
      }); return;
    }
    // ── 4C 操作 ──
    if (ev.target.id === "proto-save") {
      const p = currentProtocol();
      await runBusy(ev.target, "保存方案元信息", async () => {
        await api.editProtocol(p.id, { purpose: val("purpose"), criteria: val("criteria"), conditions: splitList(val("conditions")), unknowns: splitList(val("unknowns")), reason: val("reason") });
        ui.dirty = false; await refresh(); setStatus("方案元信息已保存（新快照）");
      }); return;
    }
    if (ev.target.classList.contains("tmpl-confirm")) {
      const tid = ev.target.closest(".tmpl").dataset.id;
      await runBusy(ev.target, "确认模板", async () => { await api.confirmTemplate(tid); ui.dirty = false; await refresh(); setStatus("模板已人工确认，可复用"); }); return;
    }
    if (ev.target.classList.contains("tmpl-use")) {
      const tid = ev.target.closest(".tmpl").dataset.id;
      const t = state.templates.find((x) => x.id === tid);
      await runBusy(ev.target, "按模板开始执行", async () => {
        const r = await api.startExecution({ topicId: ui.topicId || currentProtocol().topicId, protocolId: t.protocolId, protocolRevision: t.protocolRevision, templateId: tid });
        ui.executionId = r.executionId; ui.nav = "record"; ui.prepExtra = 0; ui.dirty = false; await refresh(); setStatus("执行已创建：进入准备稿（固定模板所指方案版本）");
      }); return;
    }
    if (ev.target.id === "tmpl-create") {
      await runBusy(ev.target, "生成模板", async () => {
        await api.createTemplate({ protocolId: ui.protocolId, aiDraft: $("#tmpl-ai").checked });
        ui.dirty = false; await refresh(); setStatus("模板已生成（固定当前方案版本；AI 草稿须人工确认）");
      }); return;
    }
    if (ev.target.id === "prep-add") { ui.prepExtra += 1; renderRight(); return; }
    if (ev.target.classList.contains("prep-del")) { ev.target.closest(".preprow").remove(); return; }
    if (ev.target.id === "prep-save" || ev.target.id === "prep-confirm") {
      const confirm = ev.target.id === "prep-confirm";
      const rows = [];
      $$("#right-content .preprow").forEach((r) => {
        const after = r.querySelector('[data-pf="after"]').value.trim();
        if (!after) return;
        rows.push({ stepId: r.querySelector('[data-pf="stepId"]').value, field: r.querySelector('[data-pf="field"]').value, after, reason: r.querySelector('[data-pf="reason"]').value.trim() });
      });
      await runBusy(ev.target, confirm ? "确认快照" : "保存准备稿", async () => {
        await api.updatePreparation(ui.executionId, { adjustments: rows, notes: $("#prep-notes").value });
        if (!confirm) { ui.prepExtra = 0; ui.dirty = false; await refresh(); setStatus("准备稿已保存（未确认，不算数）"); return; }
        const r = await api.confirmPreparation(ui.executionId);
        ui.prepExtra = 0; ui.dirty = false; await refresh();
        setStatus(r.impactId ? "快照已确认：进入记录状态；已登记影响分析（含确定性时间传播）" : "快照已确认（无差异）：进入记录状态；实际开始请另行记录");
      }); return;
    }
    if (ev.target.id === "exec-begin") {
      await runBusy(ev.target, "记录实际开始", async () => {
        await api.appendEvent(ui.executionId, { kind: "start" });
        ui.dirty = false; await refresh(); setStatus("实际开始已记录（由人记录，非系统虚构）");
      }); return;
    }
    if (ev.target.id === "exec-saveas") {
      await runBusy(ev.target, "另存新方案", async () => {
        const r = await api.saveExecutionAsProtocol(ui.executionId, $("#saveas-name").value);
        ui.protocolId = r.protocolId; ui.nav = "protocol"; ui.viewRev = null; ui.dirty = false; await refresh();
        setStatus("已另存为新方案 r1（源方案未改动）");
      }); return;
    }
    if (ev.target.id === "exec-assist") {
      await runBusy(ev.target, "AI 暂停建议", async () => {
        ui.pauseSuggest = await api.pauseAssist(ui.executionId);
        renderRight(); setStatus("AI 建议已给出（仅建议，是否采纳由人决定）");
      }); return;
    }
    if (ev.target.id === "exec-pause") {
      await runBusy(ev.target, "暂停执行", async () => {
        await api.pauseExecution(ui.executionId, {
          reason: $("#pause-reason").value,
          risks: ui.pauseSuggest?.risks ?? [], resumeChecks: ui.pauseSuggest?.resumeChecks ?? [],
          aiSuggested: !!ui.pauseSuggest,
        });
        ui.pauseSuggest = null; ui.dirty = false; await refresh(); setStatus("已暂停（状态与风险已记录）");
      }); return;
    }
    if (ev.target.id === "exec-resume") {
      await runBusy(ev.target, "恢复执行", async () => {
        await api.resumeExecution(ui.executionId, $("#resume-decision").value);
        ui.dirty = false; await refresh(); setStatus("已恢复（人的决定已记录）");
      }); return;
    }
    if (ev.target.id === "exec-done") {
      await runBusy(ev.target, "结束执行", async () => { await api.completeExecution(ui.executionId); await refresh(); setStatus("执行已结束"); }); return;
    }
    if (ev.target.classList.contains("ev-edit")) { ui.editEventId = ev.target.closest(".evrow").dataset.evid; renderRight(); return; }
    if (ev.target.classList.contains("ev-cancel")) { ui.editEventId = null; renderRight(); return; }
    if (ev.target.classList.contains("ev-save")) {
      const evid = ev.target.closest(".celledit").dataset.evid;
      const durRaw = val("evDur");
      await runBusy(ev.target, "保存记录修订", async () => {
        await api.editEvent(ui.executionId, evid, {
          text: val("evText"),
          actual: { amount: val("evAmount"), ...(durRaw !== "" ? { durationMin: Number(durRaw) } : {}) },
          reason: val("evReason"),
        });
        ui.editEventId = null; ui.dirty = false; await refresh(); setStatus("记录已原位修订（留历史，不改源方案）");
      }); return;
    }
    if (ev.target.id === "ev-add") {
      const durRaw = $("#ev-dur").value;
      await runBusy(ev.target, "追加事件", async () => {
        await api.appendEvent(ui.executionId, {
          kind: $("#ev-kind").value, stepId: $("#ev-step").value || undefined, text: $("#ev-text").value,
          actual: { amount: $("#ev-amount").value, ...(durRaw !== "" ? { durationMin: Number(durRaw) } : {}) },
          backfilled: $("#ev-backfill").checked,
        });
        ui.dirty = false; await refresh(); setStatus("事件已追加");
      }); return;
    }
    if (ev.target.id === "meas-add") {
      await runBusy(ev.target, "记录测量", async () => {
        await api.addMeasurement({
          topicId: ui.topicId || currentExecution().topicId, sampleId: $("#meas-sample").value,
          sampleStateRevision: Number($("#meas-srev").value), value: $("#meas-value").value, unit: $("#meas-unit").value,
          method: $("#meas-method").value, instrument: $("#meas-instr").value, note: $("#meas-note").value,
        });
        ui.dirty = false; await refresh(); setStatus("测量已记录（固定样品状态版本）");
      }); return;
    }
    if (ev.target.classList.contains("meas-save")) {
      const before = state.measurements.find((m) => m.id === item.dataset.id);
      await runBusy(ev.target, "保存测量修订", async () => {
        await api.editMeasurement(item.dataset.id, { value: val("mValue"), unit: val("mUnit"), method: val("mMethod"), instrument: val("mInstr"), note: val("mNote"), reason: val("mReason") });
        const fields = [];
        if (before) { if (val("mValue") !== before.value) fields.push("value"); if (val("mUnit") !== before.unit) fields.push("unit"); if (val("mMethod") !== before.method) fields.push("method"); }
        ui.dirty = false; await refresh(); setStatus("测量已修订（留历史）");
        await noteChangeHits("measurement", item.dataset.id, fields);
      }); return;
    }
    if (ev.target.id === "ocr-ai") {
      await runJob(ev.target, "AI 识别", async () => {
        const r = await api.runOcr(ui.assetId);
        const res = await pollJob(r.jobId, "手写识别");
        await refreshAfterJob(); setStatus(`识别完成：${res.created} 条草稿（须人工确认）`);
      }); return;
    }
    if (ev.target.id === "ocr-manual-add") {
      const fields = {};
      for (const line of $("#ocr-fields").value.split(/\n/)) { const i = line.indexOf("="); if (i > 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
      await runBusy(ev.target, "保存转录", async () => {
        await api.manualOcr(ui.assetId, { rawText: $("#ocr-raw").value, fields, unknowns: splitList($("#ocr-unknowns").value) });
        ui.dirty = false; await refresh(); setStatus("人工转录草稿已保存（manual）");
      }); return;
    }
    if (ev.target.classList.contains("ocr-confirm")) {
      const fields = {};
      item.querySelectorAll("[data-ofkey]").forEach((inp) => { fields[inp.dataset.ofkey] = inp.value; });
      const nk = val("oNewKey").trim(); if (nk) fields[nk] = val("oNewVal");
      await runBusy(ev.target, "确认 OCR", async () => {
        await api.confirmOcr(item.dataset.id, { rawText: val("oRaw"), fields, reason: val("oReason") });
        ui.dirty = false; await refresh(); setStatus("OCR 记录已人工确认（修订留历史）");
      }); return;
    }
  } catch (e) { const h = humanError(e); setError("mid", { panel: "mid", message: h.message, detail: h.detail, retry: null }); }
});
function lineOf(t, ri) {
  const lines = currentAsset().text.split(/\r?\n/).filter((l) => l.trim() !== "");
  return (lines[ri + 1] ?? "").trim() || null;
}
const splitList = (s) => String(s ?? "").split(/[,，]/).map((x) => x.trim()).filter(Boolean);
$("#tools-area").addEventListener("click", (ev) => {
  const t = ev.target;
  const imgEl = t.closest?.(".material[data-aid]");
  if (imgEl) {
    if (!guardLeave()) return;
    ui.assetId = imgEl.dataset.aid; ui.executionId = null; ui.highlight = null; renderAll(); return;
  }
  if (t.id === "smp-create") {
    runBusy(t, "创建样品", async () => {
      if (!ui.topicId) throw new Error("请先选择/创建课题");
      await api.createSample({
        topicId: ui.topicId, executionId: ui.executionId || undefined,
        shortName: $("#smp-short").value, displayName: $("#smp-display").value,
        amount: { value: $("#smp-value").value, unit: $("#smp-unit").value, estimated: $("#smp-est").checked },
        handling: $("#smp-handling").value, use: $("#smp-use").value,
      });
      await refresh(); setStatus("样品已创建（短号唯一，状态追加式）");
    }); return;
  }
  if (t.classList.contains("smp-rename")) {
    const item = t.closest(".smp");
    runBusy(t, "样品改名", async () => {
      await api.renameSample(item.dataset.id, item.querySelector('[data-field="smpName"]').value);
      await refresh(); setStatus("显示名已改（短号与引用不变）");
    }); return;
  }
  if (t.classList.contains("smp-state")) {
    const item = t.closest(".smp");
    const v = (f) => item.querySelector(`[data-field="${f}"]`)?.value ?? "";
    runBusy(t, "追加样品状态", async () => {
      await api.addSampleState(item.dataset.id, {
        amount: { value: v("stValue"), unit: v("stUnit"), estimated: item.querySelector('[data-field="stEst"]').checked },
        handling: v("stHandling"), use: v("stUse"), note: v("stNote"),
      });
      await refresh(); setStatus("样品状态已追加（历史不改写）");
    }); return;
  }
  if (t.id === "img-import") {
    runBusy(t, "归档原图", async () => {
      const file = $("#img-file").files?.[0];
      if (!file) throw new Error("请先选择图片文件");
      const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error("读取图片失败")); fr.readAsDataURL(file); });
      const r = await api.importImage(file.name, dataUrl, ui.topicId || undefined);
      ui.assetId = r.assetId; ui.executionId = null; await refresh(); setStatus("原图已归档（可选择 AI 识别或人工转录）");
    }); return;
  }
  if (t.id === "map-create") {
    runBusy(t, "添加映射", async () => {
      await api.createMapping($("#map-original").value, $("#map-mapped").value, $("#map-basis").value, ui.topicId || undefined);
      await refresh(); setStatus("映射已添加（原名保留，依据必填）");
    }); return;
  }
  if (t.id === "cmp-create") {
    runBusy(t, "固定快照比较", async () => {
      const cardIds = [...$$(".cmp-card")].filter((x) => x.checked).map((x) => x.value);
      if (!cardIds.length) throw new Error("请先勾选已确认证据卡。");
      await api.createComparison({ topicId: ui.topicId, cardIds, filters: splitList($("#cmp-filters").value), conversions: splitList($("#cmp-conversions").value), exclusions: splitList($("#cmp-exclusions").value) });
      await refresh(); setStatus("比较快照已固定（追加式，不覆盖旧结论）");
    }); return;
  }
  if (t.classList.contains("cmp-again")) {
    runBusy(t, "重新比较", async () => {
      const cmp = state.comparisons.find((c) => c.id === t.dataset.id);
      const cardIds = [...new Set(cmp.groups.flatMap((g) => g.entries.map((e) => e.cardId)))];
      await api.createComparison({ topicId: cmp.topicId, subquestionId: cmp.subquestionId, cardIds, filters: cmp.snapshot.filters, conversions: cmp.snapshot.conversions, exclusions: cmp.snapshot.exclusions });
      await refresh(); setStatus("已按当前卡版本生成新快照（旧快照保留）");
    });
  }
});
function openHistory(obj) {
  if (!obj) return;
  $("#drawer-title").textContent = "修订历史";
  $("#drawer-meta").textContent = `当前第${obj.revision}版 · 共 ${obj.history.length} 条`;
  $("#drawer-body").innerHTML = obj.history.length === 0 ? `<p class="hint">暂无修订记录。</p>`
    : `<table class="grid"><thead><tr><th>版本</th><th>字段</th><th>前</th><th>后</th><th>原因</th><th>时间</th></tr></thead><tbody>${
        obj.history.slice().reverse().map((h) => `<tr><td>${h.revision}</td><td>${esc(h.field)}</td><td class="raw">${esc(h.before)}</td><td class="raw">${esc(h.after)}</td><td>${esc(h.reason)}</td><td>${esc(fmtTime(h.at))}</td></tr>`).join("")
      }</tbody></table>`;
  $("#drawer").hidden = false;
}
$("#drawer-close").addEventListener("click", () => { $("#drawer").hidden = true; });
window.addEventListener("beforeunload", (e) => { if (ui.dirty) { e.preventDefault(); e.returnValue = ""; } });

async function refreshAiState() {
  const s = await api.aiStatus();
  $("#ai-state").textContent = s.configured
    ? `已配置 · ${s.model}`
    : "未配置";
  // A3：未配置时自动展开，便于填写；已配置时保持折叠（由用户控制）。
  $("#aiconfig").open = !s.configured;
}
$("#ai-save").addEventListener("click", async (ev) => {
  const btn = ev.target, old = btn.textContent;
  btn.disabled = true; btn.textContent = "处理中…"; $("#ai-msg").textContent = "";
  try {
    const secs = Number($("#ai-timeout").value);
    const timeoutMs = Number.isFinite(secs) && secs > 0 ? secs * 1000 : undefined;
    const s = await api.setAiConfig($("#ai-base").value, $("#ai-model").value, $("#ai-key").value, timeoutMs);
    $("#ai-key").value = "";
    if (s.configured) { $("#ai-msg").textContent = `已保存 · ${s.model}`; setStatus(`AI 已配置 · ${s.model}`); }
    else { $("#ai-msg").textContent = "配置不完整：需要地址 / 模型 / Key 三项。"; }
    await refreshAiState();
  } catch (e) { const h = humanError(e); $("#ai-msg").textContent = `保存失败：${h.message}`; }
  finally { btn.disabled = false; btn.textContent = old; }
});
$("#ai-clear").addEventListener("click", (ev) => runBusy(ev.target, "清除 AI 配置", async () => { await api.clearAiConfig(); await refreshAiState(); setStatus("AI 配置已清除"); }));
$("#ai-test").addEventListener("click", (ev) => {
  const btn = ev.target, old = btn.textContent;
  btn.disabled = true; btn.textContent = "测试中…"; $("#ai-msg").textContent = "";
  api.aiTest()
    .then((r) => { $("#ai-msg").textContent = (r.ok ? "✓ " : "✗ ") + r.message; })
    .catch((e) => { $("#ai-msg").textContent = "测试失败：" + (e.status === 400 ? "未配置（先保存再测）" : String(e.message ?? e)); })
    .finally(() => { btn.disabled = false; btn.textContent = old; });
});

refreshAiState().catch(() => {});
refresh().catch((e) => { const h = humanError(e); notify("mid", `加载失败：${h.message}`, h.detail); });
