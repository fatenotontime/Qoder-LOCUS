// LOCUS 三栏工作台前端（本地开发版）。
// 左：课题/子问题/材料与导入；中：原始材料（可高亮定位）；右：结构化结果与核对。
// 防护：所有写操作禁用按钮 + 处理中提示 + 内联错误 + 可重试；离开前脏检查。
import { api } from "./lib/api.js";
import { computeLanes, timeLabel } from "./lib/lanes.js";

let state = { topics: [], subquestions: [], assets: [], papers: [], attachments: [], cards: [], tables: [], adoptions: [], mappings: [], comparisons: [], protocols: [], templates: [], executions: [], samples: [], measurements: [], impacts: [], ocrs: [], analysisTasks: [], analysisResults: [], reports: [], chats: [] };
const ui = { nav: "topic", topicId: "", assetId: null, paperId: null, attId: null, tableId: null, highlight: null, cell: null, dirty: false, busy: false, cardFilter: "all", groupSel: new Set(), batch: null, ack: false, protocolId: null, executionId: null, stepSel: null, viewRev: null, editEventId: null, pauseSuggest: null, prepExtra: 0, taskId: null, chatId: null, reportId: null };
let lastAction = null; // { label, run }

// 选择态持久（仅非敏感 UI 选择：页签/课题/材料/表块），刷新后归属正确。
const UI_KEY = "locus.ui.v2"; // 阶段5 重构：七入口导航，旧选择态作废，默认落课题首页
let uiRestored = false;
function saveUi() {
  try { localStorage.setItem(UI_KEY, JSON.stringify({ nav: ui.nav, topicId: ui.topicId, assetId: ui.assetId, paperId: ui.paperId, tableId: ui.tableId, cardFilter: ui.cardFilter, protocolId: ui.protocolId, executionId: ui.executionId, taskId: ui.taskId, chatId: ui.chatId, reportId: ui.reportId })); } catch {}
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
  } catch {}
}

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const topicName = (id) => state.topics.find((t) => t.id === id)?.name;

async function refresh() {
  state = await api.getState();
  restoreUi();
  if (ui.assetId && !state.assets.some((a) => a.id === ui.assetId)) ui.assetId = null;
  if (ui.tableId && !state.tables.some((t) => t.id === ui.tableId)) ui.tableId = null;
  if (ui.topicId && !state.topics.some((t) => t.id === ui.topicId)) ui.topicId = "";
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
function showBanner(msg, retry) {
  const b = $("#banner"); b.hidden = false; b.className = "banner error";
  b.innerHTML = `<span>${esc(msg)}</span>`;
  if (retry) {
    const btn = document.createElement("button"); btn.textContent = "重试"; btn.className = "primary";
    btn.addEventListener("click", async () => { hideBanner(); if (ui.busy) return; try { await retry(); } catch (e) { showBanner(String(e.message ?? e), retry); } });
    b.appendChild(btn);
  }
}
function hideBanner() { $("#banner").hidden = true; }

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
  const b = $("#banner"); b.hidden = false; b.className = "banner info";
  const parts = [];
  if (blocks.length) parts.push(`报告块 ${blocks.length}`);
  if (tasks.length) parts.push(`分析任务 ${tasks.length}`);
  if (results.length) parts.push(`结果 ${results.length}`);
  b.innerHTML = `<span>改数值命中：${parts.join("、")}（需复核，不自动改）</span>`;
  const rep = blocks.length ? state.reports.find((rp) => rp.blocks.some((bl) => bl.id === blocks[0].id)) : null;
  if (rep) {
    const btn = document.createElement("button"); btn.textContent = "去复核"; btn.className = "primary";
    btn.addEventListener("click", () => { hideBanner(); ui.nav = "analysis"; ui.reportId = rep.id; if (rep.taskId) ui.taskId = rep.taskId; renderAll(); });
    b.appendChild(btn);
  }
}

/** 所有写操作：禁用按钮 + 处理中 + 错误内联 + 可重试。 */
async function runBusy(btn, label, fn) {
  if (ui.busy) return;
  ui.busy = true; hideBanner();
  const old = btn?.textContent; if (btn) { btn.disabled = true; btn.textContent = "处理中…"; }
  lastAction = { label, run: () => runBusy(btn, label, fn) };
  setStatus(`${label}…`);
  try { await fn(); }
  catch (e) { showBanner(`${label}失败：${e.message ?? e}`, lastAction.run); }
  finally { ui.busy = false; if (btn) { btn.disabled = false; btn.textContent = old; } }
}

/** 后台 job 专用：只禁用发起按钮，不锁全局——等待期可继续编辑（后端合并写回保证不覆盖）。 */
async function runJob(btn, label, fn) {
  hideBanner();
  const old = btn?.textContent; if (btn) { btn.disabled = true; btn.textContent = "后台运行中…"; }
  setStatus(`${label}…`);
  try { await fn(); }
  catch (e) { showBanner(`${label}失败：${e.message ?? e}`, () => runJob(btn, label, fn)); }
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
  $$(".navitem").forEach((x) => x.classList.toggle("active", x.dataset.nav === ui.nav));
  $("#sec-subq").hidden = ui.nav !== "topic";
  $("#topic-create-box").hidden = ui.nav !== "topic";
  $("#sec-materials").hidden = ui.nav === "topic";
  $("#materials-title").textContent = { papers: "论文条目", knowledge: "选择文献", protocol: "方案", record: "执行", analysis: "分析任务", chat: "对话会话" }[ui.nav] ?? "材料";
  renderTopics(); renderSubq(); renderImportBox(); renderMaterials(); renderLitTools(); renderMiddle(); renderRight();
  saveUi();
}

function renderTopics() {
  $("#topic-select").innerHTML = [`<option value="">（全部课题）</option>`]
    .concat(state.topics.map((t) => `<option value="${t.id}" ${t.id === ui.topicId ? "selected" : ""}>${esc(t.name)}</option>`)).join("");
}
function renderSubq() {
  const list = state.subquestions.filter((s) => !ui.topicId || s.topicId === ui.topicId);
  $("#subq-list").innerHTML = list.length
    ? list.map((s) => `<li class="${s.kind}">${esc(s.question)} <span class="hint">(${s.kind})</span></li>`).join("")
    : `<li class="hint">暂无子问题${ui.topicId ? "" : "（先选课题）"}</li>`;
}
function renderImportBox() {
  const hints = {
    topic: "研究问题与待办",
    papers: "条目与附件；不强制解析",
    knowledge: "选文献＋写目的，才提取",
    protocol: "上传原件直接解析；版本固定",
    record: "先准备稿，确认快照后再记录",
    analysis: "选上下文，推荐与验收项",
    chat: "带上下文讨论；采纳需确认",
  };
  $("#nav-hint").textContent = hints[ui.nav] ?? "";
  const box = $("#import-box");
  if (ui.nav === "topic") { box.innerHTML = ""; return; }
  if (ui.nav === "papers") { renderPaperForm(box); return; }
  if (ui.nav === "knowledge") { renderKnowledgeForm(box); return; }
  if (ui.nav === "protocol") { renderProtocolImport(box); return; }
  if (ui.nav === "record") { renderRecordImport(box); return; }
  if (ui.nav === "analysis") { renderAnalysisForm(box); return; }
  if (ui.nav === "chat") { renderChatForm(box); return; }
  box.innerHTML = "";
}
function renderMaterials() {
  const box = $("#material-list");
  if (ui.nav === "topic") { box.innerHTML = ""; return; }
  if (ui.nav === "papers" || ui.nav === "knowledge") {
    const ps = state.papers.filter((p) => !ui.topicId || p.topicIds.includes(ui.topicId) || !p.topicIds.length);
    box.innerHTML = ps.length
      ? ps.map((p) => {
          const nAtt = state.attachments.filter((a) => a.paperId === p.id).length;
          const nCard = state.cards.filter((c) => c.paperId === p.id).length;
          const sel = ui.nav === "papers" ? p.id === ui.paperId : p.id === ui.paperId;
          return `<div class="material ${sel ? "active" : ""}" data-paperid="${p.id}">
            <div class="m-title">${esc(p.title)}</div>
            <div class="m-meta">${p.year ? esc(p.year) + " · " : ""}${nAtt} 附件 · ${nCard} 卡${p.doi ? " · DOI " + esc(p.doi) : ""}</div>
          </div>`;
        }).join("")
      : `<p class="hint">暂无论文条目。${ui.nav === "papers" ? "在上方新建或导入题录。" : "先在「文献整理」建立条目并导入附件。"}</p>`;
    return;
  }
  if (ui.nav === "protocol") {
    const ps = state.protocols.filter((p) => !ui.topicId || p.topicId === ui.topicId);
    box.innerHTML = ps.length
      ? ps.map((p) => `<div class="material ${p.id === ui.protocolId ? "active" : ""}" data-pid="${p.id}">
          <div class="m-title">${esc(p.name)}</div>
          <div class="m-meta">r${p.revision} · ${p.sourceKind === "user" ? "用户编写" : p.sourceKind === "reconstructed" ? "重构（已标来源）" : "AI 草稿"} · ${p.revisions[p.revisions.length - 1].steps.length} 步</div>
        </div>`).join("")
      : `<p class="hint">本课题暂无方案。先创建或从文献解析。</p>`;
    return;
  }
  if (ui.nav === "record") {
    const es = state.executions.filter((e) => !ui.topicId || e.topicId === ui.topicId);
    const STATUS = { active: "进行中", paused: "已暂停", done: "已结束" };
    box.innerHTML = es.length
      ? es.map((e) => {
          const p = state.protocols.find((x) => x.id === e.protocolId);
          const prep = (e.phase ?? "recording") === "preparing";
          return `<div class="material ${e.id === ui.executionId ? "active" : ""}" data-eid="${e.id}">
            <div class="m-title">${esc(p?.name ?? e.protocolId)} <span class="badge ${prep ? "cand-pending" : e.status === "paused" ? "warn" : e.status === "active" ? "confirm" : ""}">${prep ? "准备稿" : STATUS[e.status]}</span></div>
            <div class="m-meta">固定 r${e.protocolRevision}${prep ? ` · ${e.preparation?.adjustments.length ?? 0} 条差异待确认` : ` · ${e.events.length} 事件`}${e.templateId ? " · 用模板" : ""}</div>
          </div>`;
        }).join("")
      : `<p class="hint">暂无执行。选择方案（及已确认模板）后创建，进入准备稿。</p>`;
    return;
  }
  if (ui.nav === "analysis") {
    const ts = state.analysisTasks.filter((t) => !ui.topicId || t.topicId === ui.topicId);
    box.innerHTML = ts.length
      ? ts.map((t) => {
          const inc = t.optional.filter((o) => o.included).length;
          return `<div class="material ${t.id === ui.taskId ? "active" : ""}" data-atid="${t.id}">
            <div class="m-title">${esc(t.title)} ${t.recommendation ? `<span class="badge confirm">已推荐</span>` : `<span class="badge cand-pending">待推荐</span>`}</div>
            <div class="m-meta">核心 ${t.core.length} · 候选 ${inc}/${t.optional.length} · 结果 ${t.resultIds.length}${t.snapshot ? " · 快照已冻结" : ""}</div>
          </div>`;
        }).join("")
      : `<p class="hint">暂无分析任务。先选课题，再从执行/测量/数据表建任务。</p>`;
    return;
  }
  if (ui.nav === "chat") {
    const cs = state.chats.filter((c) => !ui.topicId || c.topicId === ui.topicId);
    box.innerHTML = cs.length
      ? cs.map((c) => {
          const q = state.subquestions.find((x) => x.id === c.subquestionId);
          const running = c.messages.some((m) => m.status === "running");
          return `<div class="material ${c.id === ui.chatId ? "active" : ""}" data-cid="${c.id}">
            <div class="m-title">${esc(q ? q.question : topicName(c.topicId) ?? "课题对话")} ${running ? `<span class="badge warn">运行中</span>` : ""}</div>
            <div class="m-meta">范围 ${c.scope.length} 对象${c.subquestionId ? " ＋ 子问题" : ""} · ${c.messages.length} 条消息</div>
          </div>`;
        }).join("")
      : `<p class="hint">暂无对话。选课题后可加子问题与显式对象范围，再创建会话。</p>`;
    return;
  }
  box.innerHTML = "";
}
function renderMiddle() {
  const note = $("#mid-note"), content = $("#mid-content");
  if (ui.nav === "topic") {
    $("#mid-title").textContent = "课题总览";
    note.hidden = true;
    content.innerHTML = topicOverviewHtml();
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
    const p = currentPaper();
    const atts = p ? state.attachments.filter((a) => a.paperId === p.id) : [];
    const asset = (ui.assetId && state.assets.find((a) => a.id === ui.assetId)) || state.assets.find((a) => a.id === atts[0]?.assetId);
    $("#mid-title").textContent = asset ? `原件 · ${asset.name}` : "原件";
    if (!p) { note.hidden = true; content.textContent = "在左栏选择文献条目。"; return; }
    if (!asset) { note.hidden = false; note.textContent = "无附件；先去「文献整理」导入。"; content.textContent = ""; return; }
    if (ui.highlight && asset.text.includes(ui.highlight)) { note.hidden = true; content.innerHTML = esc(asset.text).replace(esc(ui.highlight), `<mark>${esc(ui.highlight)}</mark>`); }
    else if (ui.highlight) { note.hidden = false; note.textContent = "定位不足：显示完整原件。"; content.innerHTML = esc(asset.text); }
    else { note.hidden = true; content.innerHTML = esc(asset.text); }
    return;
  }
  if (ui.nav === "protocol") {
    const p = currentProtocol();
    $("#mid-title").textContent = p ? `原始材料 · ${p.name}` : "原始材料";
    if (!p) { note.hidden = true; content.textContent = "在左栏选择或创建方案。"; return; }
    const src = p.sourceAssetId ? state.assets.find((a) => a.id === p.sourceAssetId) : null;
    if (src) {
      note.hidden = false; note.textContent = `方法来源原件：${src.name}（${p.sourceKind}）`;
      content.innerHTML = ui.highlight && src.text.includes(ui.highlight)
        ? esc(src.text).replace(esc(ui.highlight), `<mark>${esc(ui.highlight)}</mark>`)
        : esc(src.text);
    } else {
      note.hidden = false; note.textContent = p.sourceKind === "user" ? "无外部原件；下为版本快照。" : "来源见快照 sourceFragments。";
      content.textContent = fmtSnapshot(viewSnapshot(p));
    }
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
    const prep = e && (e.phase ?? "recording") === "preparing";
    $("#mid-title").textContent = e ? (prep ? `准备稿 · 基础 r${e.preparation?.baseRevision ?? e.protocolRevision}` : `本次执行快照 · 基础 r${e.protocolRevision}`) : "原始材料";
    if (!e) { note.hidden = true; content.textContent = "在左栏选择执行，或选择手写图片。"; return; }
    const p = state.protocols.find((x) => x.id === e.protocolId);
    const snap = e.preparation?.snapshot ?? p?.revisions.find((r) => r.revision === (e.preparation?.baseRevision ?? e.protocolRevision));
    note.hidden = false;
    note.textContent = prep
      ? `准备稿（未确认）：基础 r${e.preparation?.baseRevision ?? e.protocolRevision}，当前方案 r${p?.revision ?? "?"}；差异在右栏，确认后冻结。`
      : e.preparation?.snapshot
        ? `本次快照：基础 r${e.protocolRevision} ＋ ${e.preparation.adjustments.length} 条差异；源方案 r${p?.revision ?? "?"} 不影响本次。`
        : `固定引用 r${e.protocolRevision}（当前方案 r${p?.revision ?? "?"}）；记录不改此快照。`;
    content.textContent = snap ? fmtSnapshot(snap) : "（方案快照缺失）";
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
  if (ui.nav === "topic") { $("#right-title").textContent = "待办与入口"; $("#right-content").innerHTML = topicTodosHtml(); return; }
  if (ui.nav === "papers") { $("#right-title").textContent = "条目与附件"; $("#right-content").innerHTML = paperHtml(); return; }
  if (ui.nav === "knowledge") {
    $("#right-title").textContent = "知识卡（独立人工审阅）";
    const p = currentPaper();
    $("#right-content").innerHTML = p ? cardsHtml(null, p.id) : `<p class="hint">在左栏选择文献条目后，这里显示其知识卡与核对操作。</p>`;
    return;
  }
  if (ui.nav === "protocol") { $("#right-title").textContent = "方案与实验图"; $("#right-content").innerHTML = protocolHtml(); return; }
  if (ui.nav === "record") { $("#right-title").textContent = "实验记录"; $("#right-content").innerHTML = recordHtml(); return; }
  if (ui.nav === "analysis") { $("#right-title").textContent = "推荐 · 结果 · 分析初稿"; $("#right-content").innerHTML = analysisRightHtml(); return; }
  if (ui.nav === "chat") { $("#right-title").textContent = "范围 · 来源 · 采纳"; $("#right-content").innerHTML = chatRightHtml(); return; }
  $("#right-title").textContent = "结构化结果";
  $("#right-content").innerHTML = `<p class="hint">在左栏选择工作对象。</p>`;
}
/** 候选库状态（与后端 candidateStateOf 同口径）：跳过保未复核；采用独立于核对。 */
function candState(c) {
  if (state.adoptions.some((a) => a.cardId === c.id && a.decision === "adopt")) return "adopted";
  if (c.audit === "need_info") return "pending";
  if (c.audit === "confirm" || c.audit === "exclude") return "reviewed";
  return "unreviewed";
}
const CAND_LABEL = { unreviewed: "未复核", pending: "待补信息", reviewed: "已审候选", adopted: "已采用" };
const KIND_LABEL = { data: "数据", argument: "论证", method: "方法", idea: "思路" };
const ROLE_LABEL = { fulltext: "正文", supplement: "补充材料", other: "其他" };

function cardsHtml(assetId, paperId) {
  const all = state.cards.filter((c) => paperId ? c.paperId === paperId : c.assetId === assetId);
  const inFilter = (c) => ui.cardFilter === "all" ? true
    : ui.cardFilter === "pending" ? ["unreviewed", "pending"].includes(candState(c))
    : ["reviewed", "adopted"].includes(candState(c));
  const cards = all.filter(inFilter);
  const nPend = all.filter((c) => ["unreviewed", "pending"].includes(candState(c))).length;
  const nRev = all.length - nPend;
  const paper = paperId ? state.papers.find((p) => p.id === paperId) : null;
  const asset = paper
    ? state.assets.find((a) => a.id === state.attachments.find((x) => x.paperId === paper.id)?.assetId)
    : state.assets.find((a) => a.id === assetId);
  const topicIds = paper ? paper.topicIds : (asset?.topicId ? [asset.topicId] : []);
  const subqs = state.subquestions.filter((q) => !topicIds.length || topicIds.includes(q.topicId));
  const independent = all.filter((c) => c.audit === "confirm" && !c.secondaryCitation).length;

  const tabs = `<div class="tabs">
    ${[["all", `全部 ${all.length}`], ["pending", `待审 ${nPend}`], ["reviewed", `已审候选 ${nRev}`]].map(([k, label]) => `<button class="tab ${ui.cardFilter === k ? "active" : ""}" data-filter="${k}">${label}</button>`).join("")}
    <span class="hint">独立证据 ${independent}（不含转引/未确认）</span>
  </div>`;

  const batchBar = `<div class="row batchbar">
    <button class="batch-preview" ${ui.groupSel.size ? "" : "disabled"}>组审预览（已选 ${ui.groupSel.size}）</button>
    <button class="batch-clear" ${ui.groupSel.size ? "" : "disabled"}>清空选择</button>
  </div>`;
  const batchPanel = ui.batch ? `<div class="item batchpanel">
    <div class="meta">组审预览 · ${ui.batch.count} 张（先呈现共享条件，确认后才整组通过）</div>
    <div>共享条件：${ui.batch.sharedConditions.length ? ui.batch.sharedConditions.map(esc).join("、") : "（无）"}</div>
    <div>缺定位：${ui.batch.missing.length ? ui.batch.missing.map((id) => esc(id)).join("、") : "（无）"}</div>
    <div>缺项/异常：${ui.batch.anomalies.length ? ui.batch.anomalies.map((id) => esc(id)).join("、") : "（无）"}</div>
    <div class="row"><label><input type="checkbox" id="batch-ack" ${ui.ack ? "checked" : ""}/> 我已查看上述共享条件/缺项/异常</label>
      <button class="primary batch-confirm" ${ui.ack ? "" : "disabled"}>整组确认</button>
      <button class="batch-cancel">取消</button></div>
  </div>` : "";

  const manualForm = !asset ? (paper ? `<p class="hint">该条目暂无附件：手动补卡需要可定位的原件，请先导入附件。</p>` : "") : `<details class="mini">
    <summary>手动补卡</summary>
    <textarea id="mc-raw" rows="2" placeholder="证据内容（必填）"></textarea>
    <input id="mc-quote" placeholder="定位引文：粘贴原件中的连续片段（可留空＝定位不足，不得正式采用）" />
    <textarea id="mc-fields" rows="2" placeholder="字段，每行 键=值（如 Km=0.5）"></textarea>
    <div class="row"><input id="mc-units" placeholder="单位（逗号分隔）" /><input id="mc-conditions" placeholder="条件（逗号分隔）" /></div>
    <div class="row"><input id="mc-unknowns" placeholder="缺项（逗号分隔）" /><input id="mc-reason" placeholder="原因（标转引时必填）" /></div>
    <div class="row"><label><input type="checkbox" id="mc-secondary" /> 综述转引（二手）</label><button class="primary" id="mc-add">补卡</button></div>
  </details>`;

  const body = cards.length ? cards.map((c) => {
    const cs = candState(c);
    const adps = state.adoptions.filter((a) => a.cardId === c.id);
    const fields = Object.entries(c.extracted?.fields ?? {});
    return `
    <div class="item" data-id="${c.id}">
      <div class="meta"><label class="grpwrap"><input type="checkbox" class="grp" data-id="${c.id}" ${ui.groupSel.has(c.id) ? "checked" : ""}/></label>
        ${c.kind ? `<span class="badge kind-${c.kind}">${KIND_LABEL[c.kind] ?? c.kind}</span> · ` : ""}抽取 <span class="badge ${c.extraction === "ai" ? "ai" : ""}">${c.extraction}</span> · 核对 <span class="badge ${c.audit}">${c.audit}</span> · 候选 <span class="badge cand-${cs}">${CAND_LABEL[cs]}</span>${c.mechanical ? ` · <span class="badge warn">机械草稿（逐段拆分，非语义提取）</span>` : ""}${c.secondaryCitation ? ` · <span class="badge secondary">转引(二手)</span>` : ""} · rev ${c.revision}</div>
      <div class="raw linkable" title="点击在原文件中定位">${esc(c.rawText)}</div>
      ${c.scope ? `<div class="hint">适用范围：${esc(c.scope)}</div>` : ""}
      ${c.interpretation ? `<div class="hint">作者解释（与数据/事实分开）：${esc(c.interpretation)}</div>` : ""}
      ${c.spans?.length ? `<div class="spans">${c.spans.map((s) => `<div class="hint ${s.matched ? "" : "warn"}"><button class="span-link" data-asset="${s.assetId}" data-quote="${esc(s.quote)}">${s.matched ? "定位" : "定位不足"}</button> 「${esc(s.quote.slice(0, 80))}${s.quote.length > 80 ? "…" : ""}」</div>`).join("")}</div>` : ""}
      ${!c.locator.sectionQuote ? `<div class="hint warn">定位不足：无原文定位，不得用于正式采用。</div>` : ""}
      <details class="mini ex"><summary>字段/条件/缺项${c.unknowns.length ? `（缺项 ${c.unknowns.length}）` : ""}</summary>
        ${fields.map(([k, v]) => `<div class="row"><label>${esc(k)}</label><input data-fkey="${esc(k)}" value="${esc(v)}" /></div>`).join("") || `<p class="hint">暂无抽取字段。</p>`}
        <div class="row"><input data-field="newkey" placeholder="新字段名" /><input data-field="newval" placeholder="值" /></div>
        <div class="row"><label>单位</label><input data-field="units" value="${esc((c.extracted?.units ?? []).join(","))}" /></div>
        <div class="row"><label>条件</label><input data-field="conditions" value="${esc((c.extracted?.conditions ?? []).join(","))}" /></div>
        ${c.unknowns.length ? `<div class="hint warn">缺项：${c.unknowns.map(esc).join("、")}</div>` : ""}
        <div class="row"><button class="save-fields">保存字段/单位/条件</button></div>
      </details>
      <details class="mini rev"><summary>核对与采用 · 核对 ${c.audit} · 候选 ${CAND_LABEL[cs]}${adps.length ? ` · 已记录 ${adps.length} 条任务采用` : ""}</summary>
      <div class="row"><label>核对</label>
        <select data-field="audit">${["unreviewed", "confirm", "need_info", "exclude", "skip"].map((v) => `<option ${v === c.audit ? "selected" : ""}>${v}</option>`).join("")}</select>
        <label>重要</label>
        <select data-field="importance">${["", "high", "medium", "low"].map((v) => `<option value="${v}" ${(c.importance ?? "") === v ? "selected" : ""}>${v || "—"}</option>`).join("")}</select>
        <button class="sec-toggle">${c.secondaryCitation ? "取消转引标记" : "标记转引(二手)"}</button>
      </div>
      <div class="row"><label>备注</label><input data-field="note" value="${esc(c.note)}" /></div>
      <div class="row"><label>原因</label><input data-field="reason" value="${esc(c.reason)}" placeholder="排除/改关键文本/标转引时必填" />
        <button class="save">保存</button><button class="history-btn">历史(${c.history.length})</button></div>
      <div class="row adopt">
        <label>任务</label>
        ${subqs.length ? `<select data-field="adoptSubq">${subqs.map((q) => `<option value="${q.id}">${esc(q.question)}</option>`).join("")}</select>
        <select data-field="adoptDecision"><option value="adopt">采用</option><option value="exclude">排除</option></select>
        <input data-field="adoptReason" placeholder="原因（排除必填）" />
        <button class="adopt-btn">记录</button>` : `<span class="hint">先在左栏创建子问题，才能按任务采用。</span>`}
      </div>
      ${adps.length ? `<div class="adoptlist">${adps.map((a) => `<span class="badge ${a.decision === "adopt" ? "adopted" : "exclude"}" title="${esc(a.reason)}">${a.decision === "adopt" ? "采用" : "排除"} · ${esc(state.subquestions.find((q) => q.id === a.subquestionId)?.question ?? a.subquestionId)}（卡 rev ${a.cardRevision}）</span>`).join("")}</div>` : ""}
      </details>
    </div>`;
  }).join("") : `<p class="hint">${all.length ? "当前筛选下无证据卡。" : "暂无证据卡。"}</p>`;

  return tabs + batchBar + batchPanel + manualForm + body;
}

// ── 阶段5 第一段：课题首页 / 文献整理 / 领域知识积累 ─────────────

function currentPaper() { return state.papers.find((p) => p.id === ui.paperId) ?? null; }
function currentAttachment() {
  const p = currentPaper(); if (!p) return null;
  const atts = state.attachments.filter((a) => a.paperId === p.id);
  return atts.find((a) => a.id === ui.attId) ?? atts[0] ?? null;
}

/** 课题首页总览：研究问题＋各对象进度；不堆审计字段。 */
function topicOverviewHtml() {
  const ts = ui.topicId ? state.topics.filter((t) => t.id === ui.topicId) : state.topics;
  if (!ts.length) return `<div class="item"><p class="hint">还没有课题。在左栏「新建课题」填写名称与研究问题即可开始——不需要先准备任何材料。</p></div>`;
  return ts.map((t) => {
    const papers = state.papers.filter((p) => p.topicIds.includes(t.id));
    const paperIds = new Set(papers.map((p) => p.id));
    const cards = state.cards.filter((c) => paperIds.has(c.paperId) || state.assets.find((a) => a.id === c.assetId)?.topicId === t.id);
    const confirmed = cards.filter((c) => c.audit === "confirm").length;
    const adopted = state.adoptions.filter((a) => a.decision === "adopt" && state.subquestions.find((q) => q.id === a.subquestionId)?.topicId === t.id).length;
    const protos = state.protocols.filter((p) => p.topicId === t.id);
    const execs = state.executions.filter((e) => e.topicId === t.id);
    const tables = state.tables.filter((x) => state.assets.find((a) => a.id === x.assetId)?.topicId === t.id);
    const subqs = state.subquestions.filter((q) => q.topicId === t.id);
    return `<div class="item topiccard" data-id="${t.id}">
      <div class="meta"><strong>${esc(t.name)}</strong></div>
      <div>研究问题：${esc(t.researchQuestion)}</div>
      <div class="hint">子问题 ${subqs.length} · 论文 ${papers.length} · 知识卡 ${cards.length}（已确认 ${confirmed} · 按任务采用 ${adopted}）</div>
      <div class="hint">方案 ${protos.length} · 执行 ${execs.length}（进行中 ${execs.filter((e) => e.status === "active").length} · 暂停 ${execs.filter((e) => e.status === "paused").length} · 结束 ${execs.filter((e) => e.status === "done").length}）· 数据表 ${tables.length}</div>
      <div class="row">
        <button class="goto" data-goto="papers" data-topic="${t.id}">文献整理</button>
        <button class="goto" data-goto="knowledge" data-topic="${t.id}">领域知识</button>
        <button class="goto" data-goto="protocol" data-topic="${t.id}">实验方案</button>
        <button class="goto" data-goto="record" data-topic="${t.id}">执行与记录</button>
        <button class="goto" data-goto="analysis" data-topic="${t.id}">分析与数据</button>
      </div>
    </div>`;
  }).join("");
}

/** 待办：只列需要人动作的事；入口直达对应工作区。 */
function topicTodosHtml() {
  const inTopic = (topicId) => !ui.topicId || topicId === ui.topicId;
  const pendingCards = state.cards.filter((c) => ["unreviewed", "need_info"].includes(c.audit) && !c.mechanical && inTopic(state.papers.find((p) => p.id === c.paperId)?.topicIds[0] ?? state.assets.find((a) => a.id === c.assetId)?.topicId));
  const mechCount = state.cards.filter((c) => c.mechanical).length;
  const draftProtos = state.protocols.filter((p) => p.sourceKind === "ai-draft" && inTopic(p.topicId));
  const unconfTmpls = state.templates.filter((t) => !t.humanConfirmed && inTopic(state.protocols.find((p) => p.id === t.protocolId)?.topicId));
  const liveExecs = state.executions.filter((e) => e.status !== "done" && (e.phase ?? "recording") !== "preparing" && inTopic(e.topicId));
  const prepExecs = state.executions.filter((e) => (e.phase ?? "recording") === "preparing" && inTopic(e.topicId));
  const rows = [];
  if (pendingCards.length) rows.push(`<div class="item"><div class="meta">待审知识卡 ${pendingCards.length} 张</div><p class="hint">须人工核对。</p><button class="goto" data-goto="knowledge">去审阅</button></div>`);
  if (draftProtos.length) rows.push(`<div class="item"><div class="meta">AI 方案草稿 ${draftProtos.length} 份待确认</div><button class="goto" data-goto="protocol">去确认</button></div>`);
  if (unconfTmpls.length) rows.push(`<div class="item"><div class="meta">记录模板 ${unconfTmpls.length} 份待人工确认</div><button class="goto" data-goto="protocol">去确认</button></div>`);
  if (prepExecs.length) rows.push(`<div class="item"><div class="meta">执行准备稿 ${prepExecs.length} 份待确认快照</div><p class="hint">确认快照后再记录。</p><button class="goto" data-goto="record">去确认</button></div>`);
  if (liveExecs.length) rows.push(`<div class="item"><div class="meta">进行中/暂停的执行 ${liveExecs.length} 个</div><button class="goto" data-goto="record">去记录</button></div>`);
  if (!rows.length) rows.push(`<div class="item"><p class="hint">当前没有待办。</p></div>`);
  if (mechCount) rows.push(`<div class="item"><div class="meta">机械草稿 ${mechCount} 张</div><p class="hint">旧逐段拆分，开发调试用，不计入语义知识。</p></div>`);
  rows.push(acceptancePanelHtml());
  rows.push(`<div class="item"><div class="meta">暂藏 / 未实现</div><p class="hint">未实现：Zotero 实时连接、实验图 AI 重排；手写 OCR 未验证。见 docs/stage5/02_HIDDEN_FEATURES.md。</p></div>`);
  rows.push(`<div class="item"><div class="meta">导出与恢复</div><p class="hint">导出含 manifest；恢复不覆盖主数据。</p><button id="lib-export">整体导出</button><input type="file" id="lib-restore-file" accept=".json"/><button id="lib-restore">隔离恢复校验</button><div class="refnet-body" id="lib-restore-out"></div></div>`);
  return rows.join("");
}

/** 验收材料（常驻，未处理）：样本已在库，点按钮走真实路由；解析/提取由用户自行发起。 */
const ACC_MATERIALS = [
  { key: "paper", label: "导入文献", file: "samples/paper-laccase-btb-2026.md", src: "PMC13566542 · CC BY 4.0",
    paper: { title: "Individual and Cooperative Photochemical–Enzymatic Processes for the Degradation of the Dye Bromothymol Blue: Kinetic and Eco-Toxicity Analysis", authors: "Urquiza AS, Reynoso A, Biasutti MA, Montejano HA, Reynoso E", year: "2026", doi: "10.3390/ijms27177767", source: "Europe PMC PMC13566542 · Int. J. Mol. Sci.", license: "CC BY 4.0" }, name: "paper-laccase-btb-2026.md" },
  { key: "csv", label: "导入数据", file: "samples/slac-ph3-data.csv", src: "DaRUS 3337 · CC BY 4.0", name: "EnzymeML_SLAC_pH3__Data.csv" },
  { key: "proto", label: "导入方案", file: "samples/protocol-source.md", src: "DaRUS 3337 · CC BY 4.0", name: "protocol-source.md" },
];
function acceptancePanelHtml() {
  const dis = ui.topicId ? "" : `disabled title="先选课题"`;
  return `<details class="mini"><summary>验收材料（未处理）</summary>
    ${ACC_MATERIALS.map((m) => `<div class="row"><button class="acc-import" data-key="${m.key}" ${dis}>${m.label}</button><span class="hint">${esc(m.src)}</span></div>`).join("")}
    <p class="hint">导入后自行发起解析／提取。</p>
  </details>`;
}

/** 409 不死路：给出已有条目定位按钮。 */
function showLocate(msg, paperId) {
  const b = $("#banner"); b.hidden = false; b.className = "banner info";
  b.innerHTML = `<span>${esc(msg)}</span>`;
  if (paperId) {
    const btn = document.createElement("button"); btn.textContent = "定位已有条目"; btn.className = "primary";
    btn.addEventListener("click", () => { hideBanner(); ui.paperId = paperId; ui.attId = null; renderAll(); });
    b.appendChild(btn);
  }
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
      <div class="meta">题录 · rev ${p.revision} · ${nCard} 张知识卡</div>
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
    const res = await pollJob(r.jobId, "知识提取");
    await refreshAfterJob();
    setStatus(`知识提取完成：新增 ${res.created} 张待审卡${res.skipped ? `，跳过重复 ${res.skipped}` : ""}（输入快照已固定）`);
  }));
  $("#dbg-import").addEventListener("click", (ev) => runBusy(ev.target, "导入机械草稿", async () => {
    const r = await api.importLiterature($("#dbg-name").value || "debug.md", $("#dbg-text").value, "draft", ui.topicId || undefined);
    await refresh(); setStatus(`机械草稿已导入：${r.created} 张（全部标记 mechanical，仅供调试）`);
  }));
}

/** 左栏文献工具：命名映射 + 条件比较（仅文献导航显示）。 */
function renderLitTools() {
  const box = $("#lit-tools");
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
        ${confirmed.length ? confirmed.map((c) => `<label class="cmppick"><input type="checkbox" class="cmp-card" value="${c.id}" /> ${esc(c.rawText.slice(0, 40))}（rev ${c.revision}）</label>`).join("") : `<p class="hint">本课题暂无已确认证据卡。</p>`}
        <div class="row"><input id="cmp-filters" placeholder="筛选（逗号分隔）" /><input id="cmp-conversions" placeholder="换算（逗号分隔）" /></div>
        <div class="row"><input id="cmp-exclusions" placeholder="排除（逗号分隔）" /><button class="primary" id="cmp-create">固定快照比较</button></div>
      ` : `<p class="hint">先选课题。</p>`}
      ${cmps.map((cmp) => `
        <div class="item cmp" data-id="${cmp.id}">
          <div class="meta">快照 ${esc(cmp.snapshot.dataRevision.slice(0, 10))} · ${esc(cmp.snapshot.pinnedAt)}${cmp.reviewFlags.length ? ` · <span class="badge warn">需复核（${cmp.reviewFlags.length} 张卡已修改）</span>` : ""}</div>
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
    <div class="tblmax-head"><strong>${esc(t.name)}</strong> <span class="hint">${t.rows.length} 行（${t.rows.length - markers.size} 数据 · ${markers.size} 标记）× ${t.columns.length} 列 · 原件 ${asset?.bytes ?? 0}B · rev ${t.revision}</span>
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
          <select data-col="${i}" data-k="decision">${["unreviewed", "confirm", "need_info"].map((v) => `<option ${v === t.columnMeta[i].decision ? "selected" : ""}>${v}</option>`).join("")}</select></th>`).join("")}</tr></thead></table></div>
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
  lines.push(`（r${s.revision} · ${s.at} · 原因：${s.reason}）`);
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
    showBanner("后台任务已完成，但当前有未保存编辑（未刷新，以免丢弃）。保存或放弃后再刷新查看结果。");
    return;
  }
  await refresh();
}

function renderProtocolImport(box) {
  const protos = state.assets.filter((a) => a.kind === "protocol" && (!ui.topicId || a.topicId === ui.topicId || !a.topicId));
  const paperAtts = state.assets.filter((a) => a.kind === "literature" && state.attachments.some((x) => x.assetId === a.id));
  box.innerHTML = `
    <details class="mini" open>
      <summary>上传方案原件（直接解析）</summary>
      <input id="proto-up-name" placeholder="文件名（如 protocol.md）" />
      <input id="proto-up-file" type="file" accept=".md,.markdown,.txt,.text,text/markdown,text/plain" />
      <textarea id="proto-up-text" rows="3" placeholder="或粘贴方案文本（Markdown/纯文本）…"></textarea>
      <button class="primary" id="proto-upload">上传并解析为方案草稿</button>
      <p class="hint">原件按方案类归档；草稿标 ai-draft，须人工编辑确认。AI 未配置时只归档，可稍后解析。</p>
    </details>
    ${protos.length ? `<details class="mini"><summary>已归档方案原件（${protos.length}）</summary>
      ${protos.map((a) => `<div class="row protoasset" data-aid="${a.id}"><span class="hint">${esc(a.name)} · ${a.bytes}B</span><button class="protoasset-parse">解析为草稿</button></div>`).join("")}
    </details>` : ""}
    <details class="mini">
      <summary>从论文重构（非作者原始）</summary>
      ${paperAtts.length ? `<select id="parse-asset">${paperAtts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select>
      <button id="proto-parse">重构为方案草稿</button>
      <p class="hint">重构来源仅限论文附件；草稿标 reconstructed 并固定来源原件，不是作者原始方案。</p>` : `<p class="hint">先在「文献整理」为论文条目导入正文/方法附件。</p>`}
    </details>
    <details class="mini" ${state.protocols.length ? "" : "open"}>
      <summary>新建方案（手工）</summary>
      <input id="proto-name" placeholder="方案名称" />
      <select id="proto-src"><option value="user">用户编写</option><option value="reconstructed">公开材料重构（须标来源）</option></select>
      <input id="proto-purpose" placeholder="目的" />
      <textarea id="proto-steps" rows="4" placeholder="每行一步：操作 | 时长分钟 | 支路名 | est&#10;例：配缓冲液 | 10 | |&#10;孵育 | 30 | | est&#10;对照 | 60 | 对照支路 |"></textarea>
      <input id="proto-criteria" placeholder="完成判据" />
      <input id="proto-frag" placeholder="来源片段（重构时必填，逗号分隔）" />
      <button class="primary" id="proto-create">创建方案</button>
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
    setStatus("方案草稿已生成（ai-draft，须人工确认）");
  }));
  $$(".protoasset-parse").forEach((b) => b.addEventListener("click", (ev) => runJob(ev.target, "AI 解析方案", async () => {
    const aid = b.closest(".protoasset").dataset.aid;
    const r = await api.parseProtocol(aid, ui.topicId);
    const res = await pollJob(r.jobId, "方案解析");
    ui.protocolId = res.protocolId; ui.viewRev = null; await refreshAfterJob();
    setStatus("方案草稿已生成（ai-draft，须人工确认）");
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
    setStatus("重构草稿已生成（reconstructed：非作者原始方案，须人工确认）");
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
    const dur = s.durationMin === null ? `<span class="badge warn">时长未知</span>` : `<span class="badge ${s.estimated ? "warn" : "confirm"}">${s.durationMin}min${s.estimated ? "·估计" : ""}</span>`;
    return `<div class="dnode ${ui.stepSel === s.id ? "sel" : ""}" data-step="${s.id}">
      <div class="dop">${esc(s.op)}</div>
      <div class="dmeta">${offset !== null ? `<span class="dtime">${timeLabel(offset, approx)}</span>` : ""}${dur}${s.observeEnd ? `<span class="hint">终点:${esc(s.observeEnd)}</span>` : ""}</div>
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
  html += `</div><p class="hint">列宽等分（非时间比例）；t≈ 规定 / t≥ 下界。${L.unknownCount ? `主线 ${L.unknownCount} 步时长未知，其后为下界。` : ""}${estCount ? `估计 ${estCount} 步：取值＝所填数字。` : ""}已知主线 ${L.totalKnown}min。</p>`;
  return html;
}

function stepEditorHtml(p, snap) {
  const s = ui.stepSel === "new" ? { id: "", op: "", params: {}, note: "", durationMin: null, estimated: false, branch: null, observeEnd: "" } : snap.steps.find((x) => x.id === ui.stepSel);
  if (!s) return `<div class="stepeditor"><p class="hint">点击图中节点编辑步骤；保存将追加方案新快照（旧版本不动）。</p>
    <div class="row"><input id="newstep-op" placeholder="新步骤操作名" /><button id="step-add">添加步骤</button></div></div>`;
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
    <div class="row"><input id="se-reason" placeholder="修改原因（必填）" /><button class="primary" id="step-save">保存步骤</button><button id="step-cancel">取消</button></div>
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
          ${esc(i.change.summary)} <span class="hint">${esc(i.createdAt)}</span></summary>
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

function protocolHtml() {
  const p = currentProtocol();
  if (!p) return `<p class="hint">在左栏选择方案。图中节点可点击编辑；保存追加新快照，旧版本与已固定的执行/模板不受影响。</p>`;
  const snap = viewSnapshot(p);
  const viewingOld = snap.revision !== p.revision;
  const tmpls = state.templates.filter((t) => t.protocolId === p.id);
  return `
    <div class="item" data-id="${p.id}">
      <div class="meta">${esc(p.name)} · 当前 r${p.revision} · 来源 ${p.sourceKind}${p.sourceAssetId ? `（${esc(state.assets.find((a) => a.id === p.sourceAssetId)?.name ?? p.sourceAssetId)}）` : ""}</div>
      <div class="row"><label>查看版本</label>
        <select id="proto-rev">${p.revisions.map((r) => `<option value="${r.revision}" ${r.revision === snap.revision ? "selected" : ""}>r${r.revision} · ${esc(r.reason)}</option>`).join("")}</select>
        <button id="proto-export">导出 JSON</button>
        <button disabled title="占位：AI 重排未实现（仅确定性布局）">AI 重排（未实现）</button>
        <button class="history-btn">快照历史(${p.revisions.length})</button></div>
      ${viewingOld ? `<p class="hint warn">正在查看旧快照 r${snap.revision}（只读）；编辑将基于最新 r${p.revision} 追加。</p>` : ""}
      ${diagramHtml(p, snap)}
      ${!viewingOld ? stepEditorHtml(p, snap) : ""}
      ${!viewingOld ? `<details class="mini"><summary>方案元信息编辑</summary>
        <div class="row"><label>目的</label><input data-field="purpose" value="${esc(snap.purpose)}" /></div>
        <div class="row"><label>判据</label><input data-field="criteria" value="${esc(snap.criteria)}" /></div>
        <div class="row"><label>条件</label><input data-field="conditions" value="${esc(snap.conditions.join(","))}" /></div>
        <div class="row"><label>未知项</label><input data-field="unknowns" value="${esc(snap.unknowns.join(","))}" /></div>
        <div class="row"><input data-field="reason" placeholder="修改原因（必填）" /><button class="primary" id="proto-save">保存元信息</button></div>
      </details>` : ""}
    </div>
    ${impactHtml([p.id])}
    <div class="item"><div class="meta">记录模板（${tmpls.length}）</div>
      ${tmpls.map((t) => `<div class="row tmpl" data-id="${t.id}">
        <span class="badge ${t.humanConfirmed ? "confirm" : "cand-pending"}">${t.humanConfirmed ? "已确认" : "待确认"}</span>
        ${t.aiDraft ? `<span class="badge ai">AI 草稿</span>` : ""}
        <span class="hint">固定 r${t.protocolRevision}${t.protocolRevision !== p.revision ? `（方案已变 → 当前 r${p.revision}，复用前须比较）` : ""} · ${t.fields.length} 字段</span>
        ${!t.humanConfirmed ? `<button class="tmpl-confirm">人工确认</button>` : `<button class="tmpl-use">用于执行</button>`}
      </div>`).join("") || `<p class="hint">暂无模板。</p>`}
      <div class="row"><label><input type="checkbox" id="tmpl-ai" /> AI 草稿</label><button id="tmpl-create">生成模板（固定 r${p.revision}）</button></div>
    </div>`;
}

/** 5D 准备稿：基础快照图＋本次差异编辑（固定底部编辑区）；确认前可反复改，确认后冻结。 */
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
      ${e.preparation?.confirmedAt ? `<div class="hint">本次快照确认于 ${esc(e.preparation.confirmedAt)}（基础 r${e.preparation.baseRevision}${nAdj ? ` ＋ ${nAdj} 条差异` : "，无差异"}）；源方案后续不影响本次。</div>` : ""}
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
      <div class="pane-title">事件时间线（${e.events.length}）</div>
      ${e.events.map((ev) => ui.editEventId === ev.id ? `<div class="celledit" data-evid="${ev.id}">
          <div class="row"><label>内容</label><input data-field="evText" value="${esc(ev.text)}" /></div>
          <div class="row"><label>实际用量</label><input data-field="evAmount" value="${esc(ev.actual.amount ?? "")}" />
            <label>实际时长</label><input data-field="evDur" type="number" min="0" value="${ev.actual.durationMin ?? ""}" /></div>
          <div class="row"><input data-field="evReason" placeholder="修改原因（必填）" /><button class="primary ev-save">保存</button><button class="ev-cancel">取消</button></div>
        </div>` : `<div class="evrow" data-evid="${ev.id}">
          <span class="badge ${ev.kind === "deviation" ? "exclude" : ev.kind === "pause" ? "warn" : ""}">${KIND[ev.kind]}</span>
          <span class="hint">${esc(ev.at)}${ev.backfilled ? " · 后补" : ""}</span>
          <span>${esc(ev.text)}</span>
          ${ev.actual.amount ? `<span class="hint">用量 ${esc(ev.actual.amount)}</span>` : ""}
          ${ev.actual.durationMin !== undefined ? `<span class="hint">实际 ${ev.actual.durationMin}min</span>` : ""}
          ${ev.kind === "step" || ev.kind === "note" || ev.kind === "deviation" ? `<button class="ev-edit">编辑(${ev.history.length})</button>` : ""}
        </div>`).join("")}
      <details class="mini"><summary>追加事件</summary>
        <div class="row"><select id="ev-kind"><option value="step">步骤</option><option value="note">备注</option><option value="deviation">偏差</option></select>
          <select id="ev-step">${(snap?.steps ?? []).map((s) => `<option value="${s.id}">${esc(s.op)}</option>`).join("")}</select></div>
        <div class="row"><input id="ev-text" placeholder="内容（备注/偏差必填）" /></div>
        <div class="row"><input id="ev-amount" placeholder="实际用量" /><input id="ev-dur" type="number" min="0" placeholder="实际时长(分)" />
          <label><input type="checkbox" id="ev-backfill" /> 后补</label><button class="primary" id="ev-add">追加</button></div>
      </details>
    </div>
    <div class="item"><div class="meta">样品与测量（本课题）</div>
      ${samples.map((s) => `<div class="smprow" data-id="${s.id}">
        <strong>${esc(s.shortName)}</strong> ${esc(s.displayName)} <span class="hint">${s.origin === "public" ? "公开导入" : "用户"} · ${s.states.length} 状态</span>
        <div class="hint">最新：${esc(s.states[s.states.length - 1].amount.value)} ${esc(s.states[s.states.length - 1].amount.unit)}${s.states[s.states.length - 1].amount.estimated ? "（估计）" : ""} · ${esc(s.states[s.states.length - 1].handling || "—")}</div>
      </div>`).join("") || `<p class="hint">暂无样品（左栏新建）。</p>`}
      <details class="mini"><summary>新增测量（固定样品状态版本）</summary>
        ${samples.length ? `<div class="row"><select id="meas-sample">${samples.map((s) => `<option value="${s.id}">${esc(s.shortName)} ${esc(s.displayName)}</option>`).join("")}</select>
          <select id="meas-srev">${samples[0].states.map((st) => `<option value="${st.revision}">状态 r${st.revision}</option>`).join("")}</select></div>
        <div class="row"><input id="meas-value" placeholder="测量值（必填）" /><input id="meas-unit" placeholder="单位" /></div>
        <div class="row"><input id="meas-method" placeholder="方法" /><input id="meas-instr" placeholder="仪器" /></div>
        <div class="row"><input id="meas-note" placeholder="备注" /><button class="primary" id="meas-add">记录测量</button></div>` : `<p class="hint">先建样品。</p>`}
      </details>
      ${meas.map((m) => `<div class="item meas" data-id="${m.id}">
        <div class="meta">${esc(state.samples.find((s) => s.id === m.sampleId)?.shortName ?? m.sampleId)} · 状态 r${m.sampleStateRevision} · rev ${m.revision}${m.cellRef ? ` · 回链表 ${esc(m.cellRef.tableId.slice(4, 12))} r${m.cellRef.row}c${m.cellRef.col}` : ""}</div>
        <div class="row"><input data-field="mValue" value="${esc(m.value)}" /><input data-field="mUnit" value="${esc(m.unit)}" />
          <input data-field="mMethod" value="${esc(m.method)}" /><input data-field="mInstr" value="${esc(m.instrument)}" /></div>
        <div class="row"><input data-field="mNote" value="${esc(m.note)}" /><input data-field="mReason" placeholder="修改原因（必填）" />
          <button class="meas-save">保存</button><button class="history-btn">历史(${m.history.length})</button></div>
      </div>`).join("")}
    </div>
    ${impactHtml([e.id, ...samples.map((s) => s.id), ...meas.map((m) => m.id)])}`;
}

// ── 5E：数据处理与分析 / 上下文AI对话 ──────────────────────
function currentTask() { return state.analysisTasks.find((t) => t.id === ui.taskId) ?? null; }
function currentChat() { return state.chats.find((c) => c.id === ui.chatId) ?? null; }
function refLabel(ref) {
  switch (ref.kind) {
    case "execution": { const e = state.executions.find((x) => x.id === ref.id); const p = e && state.protocols.find((x) => x.id === e.protocolId); return `执行 · ${p?.name ?? ref.id}`; }
    case "protocol": return `方案 · ${state.protocols.find((x) => x.id === ref.id)?.name ?? ref.id}`;
    case "measurement": return `测量原件 · ${state.assets.find((x) => x.id === ref.id)?.name ?? ref.id}`;
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
  const meas = state.assets.filter((a) => a.kind === "measurement" && (!tid || !a.topicId || a.topicId === tid));
  const protos = state.protocols.filter((p) => !tid || p.topicId === tid);
  const cards = state.cards.filter((c) => { const p = state.papers.find((x) => x.id === c.paperId); return !tid || !p || !p.topicIds.length || p.topicIds.includes(tid); });
  return { execs, tables, meas, protos, cards };
}
const pickRow = (cls, kind, id, label) => `<label class="ctxpick"><input type="checkbox" class="${cls}" data-kind="${kind}" data-id="${id}"/> ${esc(label)}</label>`;
const collectPicks = (cls) => [...$$(`.${cls}:checked`)].map((cb) => ({ kind: cb.dataset.kind, id: cb.dataset.id }));

function renderAnalysisForm(box) {
  if (!ui.topicId) { box.innerHTML = `<p class="hint">先在上方选择课题，再创建分析任务。</p>`; return; }
  const { execs, tables, meas, protos, cards } = topicObjects();
  const subqs = state.subquestions.filter((s) => s.topicId === ui.topicId);
  const coreList = [
    ...execs.map((e) => pickRow("an-core", "execution", e.id, `执行 · ${state.protocols.find((p) => p.id === e.protocolId)?.name ?? e.id}${(e.phase ?? "recording") === "preparing" ? "（准备稿）" : ""}`)),
    ...meas.map((a) => pickRow("an-core", "measurement", a.id, `测量原件 · ${a.name}`)),
    ...tables.map((t) => pickRow("an-core", "table", t.id, `数据表 · ${t.name}`)),
  ].join("");
  const optList = [
    ...protos.map((p) => pickRow("an-opt", "protocol", p.id, `方案 · ${p.name} r${p.revision}`)),
    ...cards.map((c) => pickRow("an-opt", "card", c.id, `知识卡 · ${c.scope || Object.values(c.extracted?.fields ?? {})[0] || c.id}`)),
  ].join("");
  box.innerHTML = `
    <details class="mini" open>
      <summary>新建分析任务</summary>
      <input id="an-title" placeholder="任务标题（如 pH3 酶活衰减拟合）"/>
      <select id="an-subq"><option value="">（不挂子问题）</option>${subqs.map((s) => `<option value="${s.id}">${esc(s.question)}</option>`).join("")}</select>
      <p class="hint">核心对象（至少一项执行/测量/数据表，不可取消）：</p>
      ${coreList || `<p class="hint">本课题暂无执行/测量/数据表。先到「实验执行与记录」或数据导入建立。</p>`}
      <details class="mini"><summary>可选候选（方案/知识卡，默认纳入、可取消）</summary>${optList || `<p class="hint">暂无方案/知识卡。</p>`}</details>
      <button class="primary" id="an-create">创建任务</button>
    </details>`;
  $("#an-create").addEventListener("click", (ev) => runBusy(ev.target, "创建分析任务", async () => {
    const r = await api.createAnalysisTask({ topicId: ui.topicId, subquestionId: $("#an-subq").value || undefined, title: $("#an-title").value, core: collectPicks("an-core"), optional: collectPicks("an-opt") });
    ui.taskId = r.taskId; await refresh(); setStatus("分析任务已创建：上下文地图在中栏");
  }));
}

function renderChatForm(box) {
  if (!ui.topicId) { box.innerHTML = `<p class="hint">先在上方选择课题，再创建对话。</p>`; return; }
  const { execs, tables, meas, protos, cards } = topicObjects();
  const subqs = state.subquestions.filter((s) => s.topicId === ui.topicId);
  const scopeList = [
    ...execs.map((e) => pickRow("ch-scope", "execution", e.id, `执行 · ${state.protocols.find((p) => p.id === e.protocolId)?.name ?? e.id}`)),
    ...meas.map((a) => pickRow("ch-scope", "measurement", a.id, `测量原件 · ${a.name}`)),
    ...tables.map((t) => pickRow("ch-scope", "table", t.id, `数据表 · ${t.name}`)),
    ...protos.map((p) => pickRow("ch-scope", "protocol", p.id, `方案 · ${p.name}`)),
    ...cards.map((c) => pickRow("ch-scope", "card", c.id, `知识卡 · ${c.scope || Object.values(c.extracted?.fields ?? {})[0] || c.id}`)),
  ].join("");
  box.innerHTML = `
    <details class="mini" open>
      <summary>新建对话会话</summary>
      <select id="ch-subq"><option value="">（课题层，不挂子问题）</option>${subqs.map((s) => `<option value="${s.id}">${esc(s.question)}</option>`).join("")}</select>
      <p class="hint">显式选取讨论对象（不选则只有课题/子问题层）：</p>
      ${scopeList || `<p class="hint">本课题暂无可选对象。</p>`}
      <button class="primary" id="ch-create">创建会话</button>
    </details>`;
  $("#ch-create").addEventListener("click", (ev) => runBusy(ev.target, "创建会话", async () => {
    const r = await api.createChat({ topicId: ui.topicId, subquestionId: $("#ch-subq").value || undefined, scope: collectPicks("ch-scope") });
    ui.chatId = r.chatId; await refresh(); setStatus("会话已创建：在中栏开始讨论");
  }));
}

function snapshotHtml(snap) {
  return `<details class="mini" open><summary>冻结上下文快照 · ${esc(snap.summary)}</summary>
    <p class="hint">目的：${esc(snap.purpose)}<br/>模型：${esc(snap.model)} · 提示词 ${esc(snap.promptVersion)} · ${esc(snap.at)}<br/>hash：${esc(snap.hash)}</p>
    ${snap.fragments.map((f, i) => `<details class="mini"><summary>碎片 ${i + 1} · ${esc(f.label)} · ${esc(f.version)} · ${f.ref.kind}:${f.ref.id}</summary><pre>${esc(f.excerpt)}</pre></details>`).join("")}
  </details>`;
}

function contextMapHtml(t) {
  const q = t.subquestionId ? state.subquestions.find((x) => x.id === t.subquestionId) : null;
  const refOpen = (r) => {
    if (r.kind === "table") return ` <button class="tbl-open" data-tid="${r.id}">查看表格</button>`;
    if (r.kind === "measurement") {
      const tb = state.tables.find((x) => x.assetId === r.id);
      return tb ? ` <button class="tbl-open" data-tid="${tb.id}">查看表格</button>` : ` <span class="hint">（该原件尚未构建数据表）</span>`;
    }
    return "";
  };
  return `
    <p><b>课题「${esc(topicName(t.topicId) ?? t.topicId)}」${q ? ` → 子问题「${esc(q.question)}」` : ""} → 核心数据/记录</b></p>
    <p class="hint">核心（不可取消）：</p>
    <ul>${t.core.map((r) => `<li>${esc(refLabel(r))} <span class="hint">${r.kind}:${r.id}</span>${refOpen(r)}</li>`).join("")}</ul>
    <p class="hint">可选候选（勾选＝纳入上下文；保存后对下次推荐生效）：</p>
    ${t.optional.length
      ? `<ul>${t.optional.map((o, i) => `<li><label><input type="checkbox" class="cand-toggle" data-idx="${i}" ${o.included ? "checked" : ""}/> ${esc(refLabel(o.ref))}</label> <span class="hint">${o.ref.kind}:${o.ref.id}</span>${refOpen(o.ref)}</li>`).join("")}</ul><button id="cand-save">保存候选选择</button>`
      : `<p class="hint">无候选。创建任务时可勾选方案/知识卡作为补充。</p>`}
    ${t.snapshot ? snapshotHtml(t.snapshot) : ""}`;
}

const REPORT_NATURES = [["observation", "观察"], ["hypothesis", "假设"], ["interpretation", "解释"], ["to_verify", "待验证"], ["human_judgment", "人工判断"]];
const natureLabel = (n) => (REPORT_NATURES.find(([k]) => k === n)?.[1] ?? n);
const refDisplay = (r) => r.version ? `${r.label}（${r.kind} ${r.version}）` : r.label;

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
    ${r.history.length ? `<details class="mini"><summary>历史（${r.history.length}）</summary>${r.history.map((h) => `<p class="hint">r${h.revision} · ${esc(h.at)} · ${esc(h.reason)}</p>`).join("")}</details>` : ""}
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
    ${r.history.length ? `<details class="mini"><summary>历史（${r.history.length}）</summary>${r.history.map((h) => `<p class="hint">r${h.revision} · ${esc(h.at)} · ${esc(h.reason)} · 方法 ${esc(h.method)}</p>`).join("")}</details>` : ""}
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
  h += `<details class="mini" open><summary>分析初稿（有序块 · 性质 · 固定引用）</summary>
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
        <span class="badge ${o.status === "confirmed" ? "confirm" : "cand-pending"}">${o.status === "confirmed" ? "已确认" : "草稿"}</span> · rev ${o.revision}</div>
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
  const b = ev.target.closest(".navitem"); if (!b || b.disabled) return;
  if (!guardLeave()) return;
  ui.nav = b.dataset.nav; ui.highlight = null; ui.cell = null; ui.tableId = null; ui.groupSel.clear(); ui.batch = null; ui.ack = false;
  ui.stepSel = null; ui.viewRev = null; ui.editEventId = null; ui.pauseSuggest = null; ui.prepExtra = 0;
  $$(".navitem").forEach((x) => x.classList.toggle("active", x === b));
  renderAll();
});
$("#topic-select").addEventListener("change", (e) => { if (!guardLeave()) { renderTopics(); return; } ui.topicId = e.target.value; ui.assetId = null; ui.highlight = null; ui.groupSel.clear(); ui.batch = null; ui.protocolId = null; ui.executionId = null; ui.stepSel = null; ui.viewRev = null; ui.taskId = null; ui.chatId = null; ui.reportId = null; renderAll(); });
$("#topic-create").addEventListener("click", (ev) => runBusy(ev.target, "创建课题", async () => {
  const r = await api.createTopic($("#topic-name").value, $("#topic-q").value);
  ui.topicId = r.topicId; await refresh(); setStatus("课题已创建");
}));
$("#subq-create").addEventListener("click", (ev) => runBusy(ev.target, "创建子问题", async () => {
  if (!ui.topicId) throw new Error("请先选择/创建一个课题");
  await api.createSubquestion(ui.topicId, $("#subq-q").value, $("#subq-kind").value); $("#subq-q").value = ""; await refresh(); setStatus("子问题已创建");
}));
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
    $("#meas-srev").innerHTML = (s?.states ?? []).map((st) => `<option value="${st.revision}">状态 r${st.revision}</option>`).join("");
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
      if (!purpose) { showBanner("推荐须写明研究目的。"); return; }
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
    if (ev.target.id === "lib-export") { download("/api/export/all.zip"); setStatus("整体导出已下载"); return; }
    if (ev.target.id === "lib-restore") {
      const f = document.querySelector("#lib-restore-file")?.files?.[0];
      const out = $("#lib-restore-out");
      if (!f) { showBanner("先选择导出的 state.json。"); return; }
      await runBusy(ev.target, "隔离恢复校验", async () => {
        const json = await readTextFile(f);
        const r = await api.restore(json);
        out.innerHTML = `<div class="diffbox"><p class="hint">版本 v${r.version} · 隔离文件 ${esc(r.isolatedPath)}</p><p class="hint">${Object.entries(r.counts).map(([k, v]) => `${esc(k)} ${v}`).join(" · ")}</p></div>`;
        setStatus("恢复校验通过（未覆盖主数据）");
      }); return;
    }
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
      try { blocks = collectReportBlocks(box); } catch (e) { showBanner(String(e.message ?? e)); return; }
      if (!blocks.length) { showBanner("至少需要一个块。"); return; }
      await runBusy(ev.target, "预览改动", async () => {
        const r = await api.previewReport(repId, blocks);
        renderBlockDiff(box.querySelector(".rep-diff"), r.diff, repId);
        setStatus(r.diff.same ? "未检测到改动。" : "已生成块级 diff，确认后接受为新版本。");
      }); return;
    }
    if (ev.target.classList.contains("rep-accept")) {
      const box = ev.target.closest(".rep"); const repId = ev.target.dataset.repid; const baseRevision = Number(ev.target.dataset.rev);
      const reason = box.querySelector(".rep-reason").value.trim();
      if (!reason) { showBanner("报告修订必须填写原因（留历史）。"); return; }
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
    if (ev.target.classList.contains("acc-import")) {
      const m = ACC_MATERIALS.find((x) => x.key === ev.target.dataset.key);
      await runBusy(ev.target, m.label, async () => {
        const r = await fetch(m.file);
        if (!r.ok) throw new Error(`样本缺失：${m.file}`);
        const text = await r.text();
        if (m.key === "paper") {
          const p = await api.createPaper({ ...m.paper, topicIds: [ui.topicId] });
          await api.addPaperAttachment(p.paperId, { name: m.name, text, role: "fulltext", version: "v1" });
          ui.paperId = p.paperId;
        } else if (m.key === "csv") {
          await api.importMeasurements(m.name, text, ui.topicId, "auto", "auto");
        } else {
          const up = await api.uploadProtocolSource(m.name, text, ui.topicId);
          ui.assetId = up.assetId;
        }
        await refresh(); setStatus(`${m.label}完成`);
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
    if (ev.target.classList.contains("dnode")) { ui.stepSel = ev.target.closest(".dnode").dataset.step; renderRight(); return; }
    if (!item) return;
    if (ev.target.classList.contains("history-btn")) {
      const id = item.dataset.id;
      const obj = state.cards.find((c) => c.id === id) ?? state.tables.find((t) => t.id === id)
        ?? state.ocrs.find((o) => o.id === id) ?? state.measurements.find((m) => m.id === id)
        ?? state.papers.find((p) => p.id === id);
      if (obj) { openHistory(obj); return; }
      const p = state.protocols.find((x) => x.id === id);
      if (p) {
        openHistory({ revision: p.revision, history: p.revisions.map((r) => ({ revision: r.revision, field: "整版快照", before: r.revision > 1 ? `r${r.revision - 1}` : "—", after: `${r.steps.length} 步`, reason: r.reason, at: r.at })) });
        return;
      }
      return;
    }
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
    if (ev.target.id === "step-cancel") { ui.stepSel = null; renderRight(); return; }
    if (ev.target.id === "step-add") {
      const op = $("#newstep-op").value.trim();
      if (!op) throw new Error("新步骤操作名不能为空");
      const p = currentProtocol();
      const latest = p.revisions[p.revisions.length - 1];
      await runBusy(ev.target, "添加步骤", async () => {
        await api.editProtocol(p.id, { steps: [...latest.steps, { op, durationMin: null, branch: null, estimated: false }], reason: `添加步骤：${op}` });
        ui.dirty = false; await refresh(); setStatus(`已添加步骤（方案 r${p.revision + 1}）`);
      }); return;
    }
    if (ev.target.id === "step-save") {
      const p = currentProtocol();
      const latest = p.revisions[p.revisions.length - 1];
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
      await runBusy(ev.target, "保存步骤", async () => {
        await api.editProtocol(p.id, { steps, reason: $("#se-reason").value });
        ui.stepSel = null; ui.dirty = false; await refresh(); setStatus("步骤已保存（追加新快照，旧版本不动）");
      }); return;
    }
    if (ev.target.id === "proto-export") {
      const p = currentProtocol();
      const blob = new Blob([JSON.stringify(viewSnapshot(p), null, 2)], { type: "application/json" });
      const aEl = document.createElement("a");
      aEl.href = URL.createObjectURL(blob); aEl.download = `${p.name}_r${viewSnapshot(p).revision}.json`;
      aEl.click(); URL.revokeObjectURL(aEl.href); setStatus("已导出当前快照 JSON"); return;
    }
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
    if (ev.target.classList.contains("imp-run")) {
      const iid = ev.target.dataset.id;
      await runJob(ev.target, "AI 影响评估", async () => {
        const r = await api.runImpact(iid);
        const res = await pollJob(r.jobId, "影响评估");
        await refreshAfterJob();
        setStatus(res.discarded ? "已有更新改动：旧评估被丢弃（stale 守卫）" : "影响评估完成");
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
  } catch (e) { showBanner(String(e.message ?? e)); }
});
function lineOf(t, ri) {
  const lines = currentAsset().text.split(/\r?\n/).filter((l) => l.trim() !== "");
  return (lines[ri + 1] ?? "").trim() || null;
}
const splitList = (s) => String(s ?? "").split(/[,，]/).map((x) => x.trim()).filter(Boolean);
$("#lit-tools").addEventListener("click", (ev) => {
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
  $("#drawer-meta").textContent = `当前 rev ${obj.revision} · 共 ${obj.history.length} 条`;
  $("#drawer-body").innerHTML = obj.history.length === 0 ? `<p class="hint">暂无修订记录。</p>`
    : `<table class="grid"><thead><tr><th>rev</th><th>字段</th><th>前</th><th>后</th><th>原因</th><th>时间</th></tr></thead><tbody>${
        obj.history.slice().reverse().map((h) => `<tr><td>${h.revision}</td><td>${esc(h.field)}</td><td class="raw">${esc(h.before)}</td><td class="raw">${esc(h.after)}</td><td>${esc(h.reason)}</td><td>${esc(h.at)}</td></tr>`).join("")
      }</tbody></table>`;
  $("#drawer").hidden = false;
}
$("#drawer-close").addEventListener("click", () => { $("#drawer").hidden = true; });
window.addEventListener("beforeunload", (e) => { if (ui.dirty) { e.preventDefault(); e.returnValue = ""; } });

async function refreshAiState() {
  const s = await api.aiStatus();
  $("#ai-state").textContent = s.configured
    ? `已配置 · ${s.model} @ ${s.baseUrl} · 超时 ${Math.round((s.timeoutMs ?? 120000) / 1000)}s（仅进程内存）`
    : "未配置：填写三项并保存后，文献导入可选 AI 抽取";
}
$("#ai-save").addEventListener("click", (ev) => runBusy(ev.target, "保存 AI 配置", async () => {
  const secs = Number($("#ai-timeout").value);
  const timeoutMs = Number.isFinite(secs) && secs > 0 ? secs * 1000 : undefined;
  const s = await api.setAiConfig($("#ai-base").value, $("#ai-model").value, $("#ai-key").value, timeoutMs); $("#ai-key").value = ""; await refreshAiState();
  setStatus(s.configured ? `AI 已配置 · ${s.model}` : "AI 配置未生效");
}));
$("#ai-clear").addEventListener("click", (ev) => runBusy(ev.target, "清除 AI 配置", async () => { await api.clearAiConfig(); await refreshAiState(); setStatus("AI 配置已清除"); }));

refreshAiState().catch(() => {});
refresh().catch((e) => showBanner(`加载失败：${e.message}`));
