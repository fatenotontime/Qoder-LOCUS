/**
 * LOCUS 公开展示版 · 独立只读入口（B 交付）。
 *
 * 用法：
 *   import { initDemo } from "./demo-app.js";
 *   initDemo({ root: document.querySelector("#locus-demo-root"), dataUrl: "/demo-data/snapshot.json" });
 * 或在 demo.html 中直接加载模块（#locus-demo-root 带 data-demo-auto）。
 *
 * 约束：无后端、无登录、无模型网关；所有写入/上传/实时对话均为收起态并解释一次。
 */
import { createDemoData, loadDemoSnapshot, DemoMissingError } from "./snapshot-adapter.js";
import { computeLanes, timeLabel, durationSourceOf } from "../lib/lanes.js";
import { aiSproutHtml } from "../lib/pages/knowledge-stage.js";
import { fmtTime, fmtVersion, fmtEnum, fmtReview, fmtKind, fmtValue } from "../lib/format.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const NAV = [
  ["topic", "课", "课题"],
  ["papers", "文", "文献"],
  ["knowledge", "知", "知识"],
  ["protocol", "案", "方案"],
  ["record", "行", "记录"],
  ["analysis", "析", "分析"],
  ["chat", "谈", "对话"],
];

const TABS = { deviation: "偏差", sample: "样品", table: "数据表" };

const state = {
  data: null,
  options: {},
  vi: {
    nav: "topic", paperId: null, attId: null, card: null, hl: null, compare: false,
    protoStep: null, execTab: "deviation", taskId: null, reportId: null, chatId: null,
    kzi: null, kzRev: null, openBasis: null, assetView: null,
  },
  error: null,
};

function $(sel, node = document) { return node.querySelector(sel); }
function $$(sel, node = document) { return [...node.querySelectorAll(sel)]; }

function flash(msg) {
  const root = state.options.root;
  if (!root) return;
  let el = $("#demo-toast", root);
  if (!el) { el = document.createElement("div"); el.id = "demo-toast"; el.className = "demo-toast"; el.setAttribute("role", "status"); root.append(el); }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(flash._t);
  flash._t = setTimeout(() => el.classList.remove("show"), 2600);
}

function reasonOf(e) {
  if (e instanceof DemoMissingError) return { path: e.path, reason: e.reason };
  return { path: "", reason: String(e?.message ?? e) };
}

// ── 初始化 ─────────────────────────────────────────────────
export async function initDemo(options = {}) {
  const root = options.root ?? document.querySelector("#locus-demo-root");
  if (!root) throw new Error("initDemo 需要 root 元素（#locus-demo-root）");
  state.options = { ...options, root };
  root.classList.add("demo-root");
  root.setAttribute("aria-busy", "true");
  root.innerHTML = `<div class="demo-loading">读取预置课题…</div>`;
  try {
    const snapshot = await loadDemoSnapshot(options.dataUrl ?? "/demo-data/snapshot.json", options.fetch);
    state.data = createDemoData(snapshot, { topicId: options.topicId });
    state.error = null;
    initViewState();
    readHash();
    root.removeAttribute("aria-busy");
    bind(root);
    render();
    const d = state.data;
    if (!options.silent) flash(d.isFixture() ? "已载入接线夹具（待 A 正式快照替换）" : "已载入预置展示课题");
    return { navigate, render, data: state.data };
  } catch (e) {
    state.error = e;
    root.removeAttribute("aria-busy");
    renderFatal(root, e);
    return { navigate: () => {}, render: () => {}, data: null };
  }
}

function initViewState() {
  const d = state.data, vi = state.vi;
  const papers = d.listPapers(d.meta().mainTopicId);
  vi.paperId = papers[0]?.id ?? null;
  const atts = vi.paperId ? d.listAttachments(vi.paperId) : [];
  vi.attId = atts[0]?.id ?? null;
  try { vi.taskId = d.getAnalysisTask().id; } catch { vi.taskId = null; }
  try { vi.chatId = d.getChat().id; } catch { vi.chatId = null; }
  try { vi.kzi = d.listKnowledgeItems()[0]?.id ?? null; } catch { vi.kzi = null; }
}

// ── 路由（hash 可深链，便于 E 给点击路径）──────────────────
function readHash() {
  const raw = (location.hash || "").replace(/^#\/?/, "");
  if (!raw) return;
  const [nav, qs] = raw.split("?");
  if (NAV.some(([k]) => k === nav)) state.vi.nav = nav;
  const p = new URLSearchParams(qs ?? "");
  const vi = state.vi;
  if (p.get("paper")) vi.paperId = p.get("paper");
  if (p.get("att")) vi.attId = p.get("att");
  if (p.get("card")) vi.card = p.get("card");
  if (p.get("hl")) vi.hl = p.get("hl");
  if (p.get("step")) vi.protoStep = p.get("step");
  if (p.get("tab")) vi.execTab = p.get("tab");
  if (p.get("task")) vi.taskId = p.get("task");
  if (p.get("report")) vi.reportId = p.get("report");
  if (p.get("chat")) vi.chatId = p.get("chat");
  if (p.get("item")) vi.kzi = p.get("item");
  if (p.get("rev")) vi.kzRev = Number(p.get("rev")) || null;
  if (p.get("cmp") === "1") vi.compare = true;
  if (p.get("basis")) vi.openBasis = p.get("basis");
}
function syncHash() {
  const vi = state.vi;
  const p = new URLSearchParams();
  if (vi.nav === "papers") {
    if (vi.paperId) p.set("paper", vi.paperId);
    if (vi.attId) p.set("att", vi.attId);
    if (vi.card) p.set("card", vi.card);
    if (vi.hl) p.set("hl", vi.hl);
    if (vi.compare) p.set("cmp", "1");
  } else if (vi.nav === "protocol" && vi.protoStep) p.set("step", vi.protoStep);
  else if (vi.nav === "record") p.set("tab", vi.execTab);
  else if (vi.nav === "analysis") { if (vi.taskId) p.set("task", vi.taskId); if (vi.reportId) p.set("report", vi.reportId); }
  else if (vi.nav === "chat" && vi.chatId) p.set("chat", vi.chatId);
  else if (vi.nav === "knowledge") { if (vi.kzi) p.set("item", vi.kzi); if (vi.kzRev) p.set("rev", vi.kzRev); }
  else if (vi.nav === "topic" && vi.openBasis) p.set("basis", vi.openBasis);
  const qs = p.toString();
  const next = `#/${vi.nav}${qs ? `?${qs}` : ""}`;
  if (location.hash !== next) history.replaceState(null, "", next);
}

export function navigate(view, patch = {}) {
  Object.assign(state.vi, { nav: view }, patch);
  if (view === "papers" && patch.attId) state.vi.hl = patch.hl ?? null;
  render();
}

// ── 事件委托 ───────────────────────────────────────────────
function bind(root) {
  root.addEventListener("click", (ev) => {
    const el = ev.target.closest("[data-action]");
    if (!el) return;
    const a = el.dataset.action;
    try {
      if (a === "nav") { state.vi.nav = el.dataset.nav; state.vi.compare = false; state.vi.assetView = null; render(); }
      else if (a === "paper") { selectPaper(el.dataset.paper); }
      else if (a === "att") { state.vi.attId = el.dataset.att; state.vi.hl = null; state.vi.assetView = null; render(); }
      else if (a === "assetback") { state.vi.assetView = null; render(); }
      else if (a === "card") { state.vi.card = state.vi.card === el.dataset.card ? null : el.dataset.card; render(); }
      else if (a === "locate") { locate(el.dataset.asset, el.dataset.quote); }
      else if (a === "compare") { state.vi.compare = !state.vi.compare; render(); }
      else if (a === "cmp-entry") { openCard(el.dataset.card); }
      else if (a === "step") { state.vi.protoStep = el.dataset.step; render(); }
      else if (a === "exectab") { state.vi.execTab = el.dataset.tab; render(); }
      else if (a === "task") { state.vi.taskId = el.dataset.task; state.vi.reportId = null; render(); }
      else if (a === "backref") { jumpToRef(el.dataset.kind, el.dataset.id); }
      else if (a === "item") { state.vi.kzi = el.dataset.item; state.vi.kzRev = null; render(); }
      else if (a === "kzrev") { state.vi.kzRev = Number(el.dataset.rev); render(); }
      else if (a === "basis") { state.vi.openBasis = state.vi.openBasis === el.dataset.basis ? null : el.dataset.basis; render(); }
      else if (a === "chatref") { jumpToRef(el.dataset.kind, el.dataset.id); }
      else if (a === "zip") { downloadZip(); }
      else if (a === "boundary") { toggleBoundary(el); }
      else if (a === "retry") { initDemo(state.options); }
      else if (a === "report") { state.vi.reportId = el.dataset.report; state.vi.nav = "analysis"; render(); }
    } catch (e) {
      const r = reasonOf(e);
      flash(`缺项：${r.path || "未知"} — ${r.reason}`);
      console.warn(e);
    }
  });
  window.addEventListener("hashchange", () => { readHash(); render(); });
}

function selectPaper(id) {
  state.vi.paperId = id; state.vi.card = null; state.vi.hl = null; state.vi.compare = false; state.vi.assetView = null;
  const att = state.data.listAttachments(id)[0];
  state.vi.attId = att?.id ?? null;
  render();
}
function openCard(cardId) {
  const d = state.data;
  const c = d.getCard(cardId);
  state.vi.nav = "papers"; state.vi.compare = false; state.vi.card = cardId; state.vi.hl = null;
  if (c.paperId) {
    state.vi.paperId = c.paperId;
    const a = d.listAttachments(c.paperId).find((x) => x.assetId === c.assetId);
    state.vi.attId = a?.id ?? d.listAttachments(c.paperId)[0]?.id ?? null;
  } else {
    for (const p of d.listPapers()) {
      const a = d.listAttachments(p.id).find((x) => x.assetId === c.assetId);
      if (a) { state.vi.paperId = p.id; state.vi.attId = a.id; break; }
    }
  }
  render();
}
function locate(assetId, quote) {
  const d = state.data;
  let paperId = null, attId = null;
  for (const p of d.listPapers()) {
    const a = d.listAttachments(p.id).find((x) => x.assetId === assetId);
    if (a) { paperId = p.id; attId = a.id; break; }
  }
  state.vi.nav = "papers"; state.vi.compare = false; state.vi.card = null;
  if (paperId) { state.vi.paperId = paperId; state.vi.attId = attId; state.vi.assetView = null; }
  else { state.vi.assetView = { assetId, quote: quote || null }; }
  state.vi.hl = quote || null;
  render();
}

function jumpToRef(kind, id) {
  const vi = state.vi;
  if (kind === "card") return openCard(id);
  if (kind === "asset") return locate(id, null);
  if (kind === "paper") { selectPaper(id); return; }
  if (kind === "execution" || kind === "sample" || kind === "measurement") { vi.nav = "record"; vi.execTab = kind === "measurement" ? "table" : kind === "sample" ? "sample" : "deviation"; return render(); }
  if (kind === "table") { vi.nav = "record"; vi.execTab = "table"; return render(); }
  if (kind === "protocol") { vi.nav = "protocol"; return render(); }
  if (kind === "result" || kind === "task" || kind === "report" || kind === "block") { vi.nav = "analysis"; if (kind === "task") vi.taskId = id; if (kind === "report") vi.reportId = id; return render(); }
  if (kind === "item" || kind === "context" || kind === "evidence") {
    const item = kind === "item" ? id : findItemOfKnowledge(kind, id);
    vi.nav = "knowledge"; if (item) vi.kzi = item; return render();
  }
  if (kind === "chat") { vi.nav = "chat"; vi.chatId = id; return render(); }
  state.data.backtrace(kind, id); // 触发缺项（未知 kind）
  render();
}
function findItemOfKnowledge(kind, id) {
  for (const it of state.data.listKnowledgeItems()) {
    const p = it.payload ?? {};
    if (kind === "context" && (p.contextRefs ?? []).some((r) => r.id === id)) return it.id;
    if (kind === "evidence" && (p.evidenceRefs ?? []).some((r) => r.ref?.id === id)) return it.id;
  }
  return null;
}

function downloadZip() {
  try {
    const z = state.data.zipInfo();
    if (!z.url) { flash("样本 ZIP 尚未随快照提供（缺项：demo.zip.url）"); return; }
    const a = document.createElement("a");
    a.href = z.url; a.download = z.fileName; document.body.append(a); a.click(); a.remove();
  } catch (e) { const r = reasonOf(e); flash(`缺项：${r.path} — ${r.reason}`); }
}

function toggleBoundary(el) {
  const box = el.closest(".demo-boundary");
  box?.classList.toggle("open");
}

// ── 渲染主壳 ───────────────────────────────────────────────
function render() {
  const root = state.options.root;
  if (!root || !state.data) return;
  try { renderShell(root); syncHash(); }
  catch (e) { renderFatal(root, e); }
}

function renderShell(root) {
  const d = state.data, vi = state.vi;
  const topic = d.getMainTopic();
  const meta = d.meta();
  const fixture = d.isFixture();
  const zip = safe(() => d.zipInfo(), null);
  root.innerHTML = `
    <div class="demo-app">
      <header class="demo-top">
        <div class="demo-brand"><span class="demo-seal" aria-hidden="true">卷</span>
          <div><b>LOCUS</b><span class="demo-sub">公开展示 · 只读</span></div>
        </div>
        <div class="demo-topic"><span class="demo-badge">展示课题 · 只读</span><b>${esc(topic.name)}</b></div>
        <div class="demo-topact">
          <button class="demo-zip" type="button" data-action="zip" ${zip && zip.url ? "" : `disabled title="样本 ZIP 未随快照提供（缺项：demo.zip.url）"`}>下载样本 ZIP${zip ? ` · ${esc(zip.fileName)}` : ""}</button>
        </div>
      </header>
      ${fixture ? `<div class="demo-fixture" role="note">接线夹具 · 待 A 正式快照替换（内容与结论为占位，非正式证据）。快照 ${esc(meta.fixtureVersion)} · 源 ${esc(meta.sourceCommit)}</div>` : ""}
      <div class="demo-body">
        <nav class="demo-rail" aria-label="七卷导航">
          ${NAV.map(([k, sig, label]) => `<button class="demo-navbtn${vi.nav === k ? " active" : ""}" type="button" data-action="nav" data-nav="${k}" ${vi.nav === k ? 'aria-current="page"' : ""}><span class="demo-sig" aria-hidden="true">${sig}</span><span class="demo-navlabel">${label}</span></button>`).join("")}
        </nav>
        <section class="demo-pane demo-left" aria-label="列表"><div class="demo-pane-inner">${pane(state, "left")}</div>
          ${boundaryNote()}
        </section>
        <main class="demo-pane demo-mid" aria-label="主体"><div class="demo-pane-inner">${pane(state, "mid")}</div></main>
        <aside class="demo-pane demo-right" aria-label="结果"><div class="demo-pane-inner">${pane(state, "right")}</div></aside>
      </div>
      <footer class="demo-foot">
        <span>预生成：${esc(d.presetInfo().model)} · ${esc(fmtTime(d.presetInfo().generatedAt))} · 人工核对后公开展示</span>
        <span class="demo-footnote">本页不触发后端：上传、写入、即时解析、实时对话均收起。</span>
      </footer>
    </div>`;
}

function pane(st, side) {
  const vi = st.vi;
  try {
    if (vi.nav === "topic") return side === "left" ? leftTopic() : side === "mid" ? midTopic() : rightTopic();
    if (vi.nav === "papers") return side === "left" ? leftPapers() : side === "mid" ? midPapers() : rightPapers();
    if (vi.nav === "knowledge") return side === "left" ? leftKnowledge() : side === "mid" ? midKnowledge() : rightKnowledge();
    if (vi.nav === "protocol") return side === "left" ? leftProtocol() : side === "mid" ? midProtocol() : rightProtocol();
    if (vi.nav === "record") return side === "left" ? leftRecord() : side === "mid" ? midRecord() : rightRecord();
    if (vi.nav === "analysis") return side === "left" ? leftAnalysis() : side === "mid" ? midAnalysis() : rightAnalysis();
    if (vi.nav === "chat") return side === "left" ? leftChat() : side === "mid" ? midChat() : rightChat();
    return "";
  } catch (e) {
    const r = reasonOf(e);
    return `<div class="demo-miss" role="alert">
      <div class="demo-miss-t">本栏读取缺项</div>
      <p>路径：<code>${esc(r.path || "未知")}</code></p>
      <p>原因：${esc(r.reason)}</p>
      <div class="demo-miss-act"><button type="button" data-action="retry">重新载入</button><button type="button" data-action="zip">下载样本 ZIP</button></div>
    </div>`;
  }
}

function safe(fn, fallback) { try { return fn(); } catch { return fallback; } }

function boundaryNote() {
  return `<details class="demo-boundary">
    <summary data-action="boundary">在线试玩待开放</summary>
    <p>公开展示模式只读：上传、写入、即时解析与实时对话不触发后端，均由预生成产物替代。</p>
    <p class="demo-hint">服务器恢复后仍保持只读；可写试玩将来从独立入口开启。</p>
  </details>`;
}

// ── 课题 ───────────────────────────────────────────────────
function topicCounts() {
  const d = state.data;
  const tid = d.meta().mainTopicId;
  return {
    papers: d.listPapers(tid).length,
    cards: d.listCards({ topicId: tid }).length,
    confirmed: d.listCards({ topicId: tid }).filter((c) => c.audit === "confirm").length,
    items: d.listKnowledgeItems(tid).length,
    protocols: d.listProtocols(tid).length,
    execs: d.listExecutions(tid).length,
    tasks: d.listAnalysisTasks(tid).length,
    chats: d.listChats(tid).length,
  };
}

function leftTopic() {
  const d = state.data, c = topicCounts();
  const subs = d.listSubquestions();
  return `<div class="demo-pane-head">课题目录</div>
    <button class="demo-topicbtn active" type="button" data-action="nav" data-nav="topic">${esc(d.getMainTopic().name)}</button>
    <div class="demo-pane-head">研究流程</div>
    <ol class="demo-flow">
      <li><button type="button" data-action="nav" data-nav="papers">文献 <b>${c.papers}</b></button></li>
      <li><button type="button" data-action="nav" data-nav="knowledge">知识 <b>${c.items}</b><span class="demo-hint">${c.confirmed}/${c.cards} 已确认</span></button></li>
      <li><button type="button" data-action="nav" data-nav="protocol">方案 <b>${c.protocols}</b></button></li>
      <li><button type="button" data-action="nav" data-nav="record">执行 <b>${c.execs}</b></button></li>
      <li><button type="button" data-action="nav" data-nav="analysis">分析 <b>${c.tasks}</b></button></li>
      <li><button type="button" data-action="nav" data-nav="chat">对话 <b>${c.chats}</b></button></li>
    </ol>
    <div class="demo-pane-head">子问题（${subs.length}）</div>
    <ul class="demo-subq">${subs.map((s) => `<li>${esc(s.question)} <span class="demo-hint">${esc(fmtEnum(s.kind))}</span></li>`).join("") || `<li class="demo-hint">暂无</li>`}</ul>`;
}

function midTopic() {
  const d = state.data, t = d.getMainTopic(), c = topicCounts();
  const p = safe(() => d.getProtocol(), null);
  const e = safe(() => d.getExecution(), null);
  return `<div class="demo-pane-head">课题</div>
    <div class="demo-card-block">
      <h2>${esc(t.name)}</h2>
      <p class="demo-rq">研究问题：${esc(t.researchQuestion)}</p>
      <p class="demo-hint">文献 ${c.papers} · 卡 ${c.cards}（已确认 ${c.confirmed}）· 知识项 ${c.items} · 方案 ${c.protocols} · 执行 ${c.execs} · 分析 ${c.tasks}</p>
    </div>
    <div class="demo-card-block">
      <h3>研究内核（实跑产物）</h3>
      <ul class="demo-kernel">
        <li>方案：${p ? esc(p.name) + ` · ${esc(fmtEnum(p.sourceKind))}` : "缺项"}</li>
        <li>执行：${e ? `${esc(e.id)} · ${esc(fmtEnum(e.status))}${e.origin === "reconstructed" ? " · 文献重构" : ""}` : "缺项"}</li>
        <li>分析：${state.vi.taskId ? esc(d.getAnalysisTask(state.vi.taskId).title) : "缺项"}</li>
      </ul>
      <p class="demo-hint">下面按「文献库 → 科研内核 → 下一步指导」顺序展开；点右上「下载样本 ZIP」取离线材料。</p>
    </div>`;
}

function rightTopic() {
  const d = state.data;
  const sugs = d.listSuggestions();
  const zip = safe(() => d.zipInfo(), null);
  return `<div class="demo-pane-head">下一步指导 · 预生成</div>
    ${sugs.length ? sugs.map((s, i) => suggestionHtml(s, i)).join("") : `<div class="demo-miss"><p>快照未提供下一步指导（缺项：demo.suggestions）。</p></div>`}
    <div class="demo-card-block">
      <h3>样本 ZIP</h3>
      ${zip ? `<p>${esc(zip.fileName)}${zip.sizeBytes ? ` · ${fmtBytes(zip.sizeBytes)}` : ""}</p>
        <p class="demo-hint">SHA-256：${zip.sha256 ? `<code>${esc(zip.sha256)}</code>` : "未提供（缺项）"}</p>
        <button type="button" class="demo-primary" data-action="zip" ${zip.url ? "" : "disabled title=\"缺项：demo.zip.url\""}>下载样本 ZIP</button>
        ${zip.url ? "" : `<p class="demo-hint">正式快照将提供下载地址与校验值。</p>`}` : `<div class="demo-miss"><p>缺项：demo.zip</p></div>`}
    </div>`;
}

function suggestionHtml(s, i) {
  const open = state.vi.openBasis === s.id;
  const b = s.basis ?? {};
  const list = (label, arr) => (arr ?? []).length ? `<div class="demo-basisrow"><b>${label}</b><ul>${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : "";
  return `<div class="demo-suggestion">
    <div class="demo-sug-head"><span class="demo-badge">建议 ${i + 1}</span>${s.aiPreset ? `<span class="demo-badge preset">预生成</span>` : ""}</div>
    <h3>${esc(s.title)}</h3>
    <p>${esc(s.text)}</p>
    <button type="button" class="demo-link" data-action="basis" data-basis="${esc(s.id)}" aria-expanded="${open}">${open ? "收起依据" : "查看依据"}</button>
    ${open ? `<div class="demo-basis">
      ${list("证据分歧", b.divergence)}${list("待补数据", b.dataGaps)}${list("可区分解释", b.distinguishing)}${list("不确定性", b.uncertainty)}
      <p class="demo-hint">依据来自复核后的预生成记录；不触发现场模型调用。</p></div>` : ""}
  </div>`;
}

function fmtBytes(n) { return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n > 1024 ? `${(n / 1024).toFixed(0)} KB` : `${n} B`; }

// ── 文献 ───────────────────────────────────────────────────
function leftPapers() {
  const d = state.data, vi = state.vi;
  const papers = d.listPapers(d.meta().mainTopicId);
  return `<div class="demo-pane-head">论文条目（${papers.length}）</div>
    ${papers.map((p) => {
      const cards = d.listCards({ paperId: p.id });
      const pending = cards.filter((c) => c.audit !== "confirm").length;
      return `<button class="demo-listrow${vi.paperId === p.id ? " active" : ""}" type="button" data-action="paper" data-paper="${esc(p.id)}">
        <span class="demo-rowtitle">${esc(p.title)}</span>
        <span class="demo-rowmeta">${esc(p.year)} · ${esc(p.license || "许可未提供")} · 卡 ${cards.length}${pending ? ` · ${pending} 待审` : ""}</span>
      </button>`;
    }).join("")}
    ${papers.length ? "" : `<p class="demo-hint">快照无文献条目。</p>`}`;
}

function midPapers() {
  const d = state.data, vi = state.vi;
  if (vi.assetView) return midAsset();
  if (vi.compare) return midCompare();
  const p = vi.paperId ? d.getPaper(vi.paperId) : null;
  if (!p) return `<div class="demo-miss"><p>快照无文献条目（缺项：papers）。</p></div>`;
  const atts = d.listAttachments(p.id);
  const att = atts.find((a) => a.id === vi.attId) ?? atts[0];
  const head = `<div class="demo-pane-head">原始材料${atts.length > 1 ? ` · ${atts.map((a) => `<button class="demo-chip${a.id === att?.id ? " on" : ""}" type="button" data-action="att" data-att="${esc(a.id)}">${esc(fmtEnum(a.role))}</button>`).join("")}` : ""}
      <button class="demo-toggle${vi.compare ? " on" : ""}" type="button" data-action="compare">对比视图</button></div>`;
  if (!att) return `${head}<div class="demo-miss"><p>该条目没有附件（缺项）。</p></div>`;
  const asset = d.getAsset(att.assetId);
  const src = d.getOriginalUrl(att.assetId);
  const body = src.kind === "inline"
    ? `<article class="demo-src" data-asset="${esc(asset.id)}">${renderSource(src.text, vi.hl)}</article>
       <p class="demo-hint">许可：${esc(src.license)} · ${esc(src.provenance)}${src.href ? ` · <a href="${esc(src.href)}" target="_blank" rel="noreferrer noopener">原始来源</a>` : ""}</p>`
    : `<div class="demo-card-block"><p>原件外链：<a href="${esc(src.href)}" target="_blank" rel="noreferrer noopener">${esc(src.href)}</a></p><p class="demo-hint">许可：${esc(src.license)} · ${esc(src.provenance)}</p></div>`;
  return `${head}
    <div class="demo-dochead">
      <h3>${esc(p.title)}</h3>
      <p class="demo-hint">${esc(p.authors.join("、"))} · ${esc(p.year)} · DOI ${esc(p.doi)} · 许可 ${esc(p.license || "未提供")}</p>
      <p class="demo-hint">原件：${esc(asset.name)} · ${esc(asset.kind)}${vi.hl ? ` · 已高亮「${esc(vi.hl)}」` : ""}</p>
    </div>
    ${body}`;
}

function midAsset() {
  const d = state.data, vi = state.vi;
  const av = vi.assetView;
  const asset = d.getAsset(av.assetId);
  const src = d.getOriginalUrl(av.assetId);
  return `<div class="demo-pane-head">原件 · ${esc(asset.name)}
      <button class="demo-toggle" type="button" data-action="assetback">返回文献</button></div>
    <div class="demo-dochead">
      <h3>${esc(asset.name)}</h3>
      <p class="demo-hint">类型 ${esc(asset.kind)}${av.quote ? ` · 已高亮「${esc(av.quote)}」` : ""}${src.license ? ` · 许可 ${esc(src.license)}` : ""}</p>
    </div>
    ${src.kind === "inline"
      ? `<article class="demo-src">${renderSource(src.text, av.quote)}</article>`
      : `<div class="demo-card-block"><p>原件外链：<a href="${esc(src.href)}" target="_blank" rel="noreferrer noopener">${esc(src.href)}</a></p></div>`}`;
}

function renderSource(text, hl) {  const escd = esc(text);
  if (!hl) return escd;
  const h = esc(hl);
  return escd.includes(h) ? escd.split(h).join(`<mark>${h}</mark>`) : `${escd}<p class="demo-miss-inline">证据引文未在原件中逐字命中（可能为节选）：${esc(hl)}</p>`;
}

function midCompare() {
  const d = state.data;
  const cmps = d.listComparisons(d.meta().mainTopicId);
  return `<div class="demo-pane-head">对比视图
      <button class="demo-toggle on" type="button" data-action="compare">返回原文</button></div>
    ${cmps.length ? cmps.map((c) => `
      <div class="demo-card-block">
        <h3>比较：${esc(c.groups.map((g) => g.name).join("；"))}</h3>
        <p class="demo-hint">快照固定于 ${esc(fmtTime(c.snapshot.pinnedAt))} · ${esc(c.note)}</p>
        ${c.groups.map((g) => `<div class="demo-cmpgroup">
          <div class="demo-cmphead"><b>${esc(g.name)}</b><span class="demo-badge">${cmpLabel(g.divergence)}</span></div>
          <table class="demo-table"><thead><tr><th>来源</th><th>原名称</th><th>映射</th><th>值</th><th>条件</th><th></th></tr></thead><tbody>
            ${g.entries.map((en) => {
              const card = safe(() => d.getCard(en.cardId), null);
              const detail = card ? safe(() => d.getCardDetail(card.id), null) : null;
              const src = detail?.paper?.title ?? detail?.source?.name ?? en.cardId;
              return `<tr><td>${esc(src)}</td><td>${esc(en.originalName)}</td><td>${esc(en.mappedName)}</td><td>${esc(en.value)} ${esc(en.unit === "—" ? "" : en.unit)}</td><td>${esc(en.conditions.join("；"))}</td>
                <td><button class="demo-link" type="button" data-action="cmp-entry" data-card="${esc(en.cardId)}">看这张卡</button></td></tr>`;
            }).join("")}
          </tbody></table>
          ${g.unresolved.length ? `<p class="demo-hint">未解决：${g.unresolved.map(esc).join("；")}</p>` : ""}
        </div>`).join("")}
      </div>`).join("") : `<div class="demo-miss"><p>快照未提供比较（缺项：comparisons）。</p></div>`}`;
}
function cmpLabel(d) { return ({ single: "单一来源", consistent: "一致", value_diff: "数值分歧", conditions_diff: "条件差异" }[d] ?? d); }

function rightPapers() {
  const d = state.data, vi = state.vi;
  const cards = vi.paperId ? d.listCards({ paperId: vi.paperId }) : d.listCards({ topicId: d.meta().mainTopicId });
  const head = `<div class="demo-pane-head">证据卡（${cards.length}）</div>
    <p class="demo-hint">默认折叠，只显示标题、出处与审阅状态；点开看条件、数据/论据、出处定位与知识条目关系。</p>`;
  const list = cards.map((c) => {
    const open = vi.card === c.id;
    const paper = safe(() => d.getCardDetail(c.id).paper, null);
    const asset = safe(() => d.getAsset(c.assetId), null);
    const title = c.scope || c.rawText.slice(0, 40);
    return `<div class="demo-carditem${open ? " open" : ""}">
      <button class="demo-cardbtn${open ? " active" : ""}" type="button" data-action="card" data-card="${esc(c.id)}" aria-expanded="${open}">
        <span class="demo-cardtitle">${esc(title)}</span>
        <span class="demo-cardmeta">出处：${esc(paper?.title ?? asset?.name ?? c.assetId)} · ${esc(c.locator?.sectionQuote ?? "未标注小节")}</span>
        <span class="demo-cardstate"><span class="demo-badge ${c.audit === "confirm" ? "ok" : "warn"}">${esc(fmtEnum(c.audit))}</span></span>
      </button>
      ${open ? cardDetailHtml(c) : ""}
    </div>`;
  }).join("");
  return head + (list || `<p class="demo-hint">本条目暂无卡。</p>`);
}

function cardDetailHtml(c) {
  const d = state.data;
  const det = d.getCardDetail(c.id);
  const f = c.extracted?.fields ?? {};
  const fieldRows = Object.entries(f).map(([k, v]) => `<tr><th>${esc(fieldLabels(k))}</th><td>${esc(v)}</td></tr>`).join("");
  return `<div class="demo-carddetail">
    <div class="demo-cdrow"><b>出处定位</b>
      <button class="demo-link" type="button" data-action="locate" data-asset="${esc(c.assetId)}" data-quote="${esc(c.rawText)}">在原文中定位</button>
      <span class="demo-hint">${esc(c.locator?.sectionQuote ?? "")}</span></div>
    <blockquote class="demo-quote">${esc(c.rawText)}</blockquote>
    <table class="demo-table kv"><tbody>
      ${fieldRows || `<tr><th>提取字段</th><td class="demo-hint">未提供</td></tr>`}
      <tr><th>单位</th><td>${esc((c.extracted?.units ?? []).join("、") || "未提供")}</td></tr>
      <tr><th>条件</th><td>${esc((c.extracted?.conditions ?? []).join("；") || "未提供")}</td></tr>
      <tr><th>性质</th><td>${esc(fmtEnum(c.kind ?? "—"))}${c.secondaryCitation ? " · 综述转引（不计独立证据）" : ""}</td></tr>
      <tr><th>抽取</th><td>${esc(fmtEnum(c.extraction))} · ${esc(fmtVersion(c.revision))}</td></tr>
      ${c.scope ? `<tr><th>适用范围</th><td>${esc(c.scope)}</td></tr>` : ""}
      ${c.interpretation ? `<tr><th>作者解释</th><td>${esc(c.interpretation)}</td></tr>` : ""}
      ${(c.unknowns ?? []).length ? `<tr><th>未知项</th><td>${esc(c.unknowns.join("；"))}</td></tr>` : ""}
    </tbody></table>
    <div class="demo-cdrow"><b>知识条目关系</b></div>
    ${det.items.length ? det.items.map((it) => `<div class="demo-kzrel">
      <button class="demo-link" type="button" data-action="backref" data-kind="item" data-id="${esc(it.id)}">${esc(it.text.slice(0, 36))}…</button>
      <span class="demo-badge ${it.status === "confirmed" ? "ok" : "warn"}">${esc(fmtEnum(it.status))}</span>
      <span class="demo-hint">${esc(fmtVersion(it.revision))} · 条件 ${it.contexts.length} · 引文 ${it.evidence.length}</span></div>`).join("") : `<p class="demo-hint">尚无结构化知识条目。</p>`}
  </div>`;
}
function fieldLabels(k) {
  return ({ optimal_pH: "最适 pH", optimal_temp: "最适温度", pH_range: "pH 考察范围", temp_range: "温度考察范围" }[k] ?? k);
}

// ── 知识 ───────────────────────────────────────────────────
function leftKnowledge() {
  const d = state.data, vi = state.vi;
  const items = d.listKnowledgeItems(d.meta().mainTopicId);
  return `<div class="demo-pane-head">知识项（${items.length}）</div>
    ${items.map((it) => `<button class="demo-listrow${vi.kzi === it.id ? " active" : ""}" type="button" data-action="item" data-item="${esc(it.id)}">
      <span class="demo-rowtitle">${esc(it.payload?.text?.slice(0, 34) ?? it.id)}…</span>
      <span class="demo-rowmeta">${esc(fmtEnum(it.payload?.review?.status ?? "pending"))} · ${esc(fmtVersion(it.revision))} · ${esc(fmtEnum(it.payload?.nature ?? ""))}</span>
    </button>`).join("") || `<p class="demo-hint">暂无知识项。</p>`}`;
}

function midKnowledge() {
  const d = state.data, vi = state.vi;
  const items = d.listKnowledgeItems(d.meta().mainTopicId);
  const it = items.find((x) => x.id === vi.kzi) ?? items[0];
  if (!it) return `<div class="demo-miss"><p>快照无知识项（缺项：knowledge.items）。</p></div>`;
  const env = d.getKnowledgeItemEnvelope(it.id);
  const rev = vi.kzRev ?? env.revision;
  const read = d.knowledgeItem(it.id, rev); // 严格按版本；缺版报缺项
  const p = read.payload ?? {};
  const contexts = collectConditions(p);
  const evidences = (p.evidenceRefs ?? []).map((er) => ({ ref: er.ref, evidence: safe(() => d.getEvidence(er.ref?.id), null) }));
  return `<div class="demo-pane-head">知识项 · ${esc(it.id)}
      <span class="demo-revbar">版本：${read.availableRevisions.map((rv) => `<button class="demo-chip${rv === rev ? " on" : ""}" type="button" data-action="kzrev" data-rev="${rv}">${esc(fmtVersion(rv))}</button>`).join("")}</span></div>
    <div class="demo-card-block">
      <h3>${esc(p.text)}</h3>
      <table class="demo-table kv"><tbody>
        <tr><th>性质</th><td>${esc(fmtEnum(p.nature))} · ${esc(fmtEnum(p.contentType))}</td></tr>
        <tr><th>值</th><td>${esc(fmtValue(p.value))}</td></tr>
        <tr><th>主语 / 谓词</th><td>${esc(p.subject?.raw ?? "—")} / ${esc(p.predicate?.raw ?? "—")}</td></tr>
        <tr><th>适用范围</th><td>${esc(p.scopeText || "未标注")}</td></tr>
        <tr><th>审阅</th><td><span class="demo-badge ${p.review?.status === "confirmed" ? "ok" : "warn"}">${esc(fmtReview(p.review?.status))}</span> ${esc(p.review?.basis ?? "")}</td></tr>
        <tr><th>来源类别</th><td>${esc(fmtEnum(p.origin?.sourceClass))} · ${p.origin?.secondaryCitation ? "综述转引" : "一次来源"}</td></tr>
      </tbody></table>
    </div>
    <div class="demo-card-block">
      <h3>条件</h3>
      ${contexts.length ? `<table class="demo-table"><thead><tr><th>字段</th><th>值</th><th>施加对象</th><th>来源</th><th>审阅</th></tr></thead><tbody>
        ${contexts.map((c) => `<tr><td>${esc(c.field)}</td><td>${esc(fmtValue(c.value))}</td><td>${esc(c.subject ?? "")} / ${esc(c.stage ?? "")}</td><td>${esc(fmtEnum(c.obtainedBy))}</td><td><span class="demo-badge ${c.status === "confirmed" ? "ok" : "warn"}">${esc(fmtReview(c.status))}</span></td></tr>`).join("")}
      </tbody></table>` : `<p class="demo-hint">该版本未挂条件。</p>`}
    </div>
    <div class="demo-card-block">
      <h3>引文（逐字可回查）</h3>
      ${evidences.length ? evidences.map((ev) => `<div class="demo-ev">
        <blockquote class="demo-quote">${esc(ev.evidence?.payload?.quote ?? "（引文对象缺失）")}</blockquote>
        <div class="demo-cdrow"><span class="demo-badge">${esc(fmtEnum(ev.evidence?.payload?.locationStatus ?? "unmatched"))}</span>
          ${ev.evidence?.payload?.sourceRef?.id ? `<button class="demo-link" type="button" data-action="locate" data-asset="${esc(ev.evidence.payload.sourceRef.id)}" data-quote="${esc(ev.evidence.payload.quote ?? "")}">回查原文</button>` : `<span class="demo-hint">来源缺失</span>`}
          <span class="demo-hint">${esc(fmtVersion(ev.ref?.revision ?? 1))}</span></div>
      </div>`).join("") : `<p class="demo-hint">该版本无引文。</p>`}
    </div>`;
}

function collectConditions(p) {
  const out = [];
  for (const r of p.contextRefs ?? []) {
    const cx = safe(() => state.data.getContext(r.id), null);
    for (const c of cx?.payload?.conditions ?? []) {
      out.push({ field: c.field?.raw ?? "", value: c.value, subject: c.appliesTo?.subject, stage: c.appliesTo?.stage, obtainedBy: c.obtainedBy, status: c.review?.status });
    }
  }
  return out;
}

function rightKnowledge() {
  const d = state.data;
  const runs = d.extractionRuns();
  const items = d.listKnowledgeItems(d.meta().mainTopicId);
  const pending = items.filter((x) => x.payload?.review?.status === "pending").length;
  const confirmed = items.filter((x) => x.payload?.review?.status === "confirmed").length;
  const hasRun = runs.length > 0;
  return `<div class="demo-pane-head">积累流水线 · 只读</div>
    ${hasRun ? `<div class="demo-stage">
      <div class="demo-stage-top">${aiSproutHtml("idle", "demo-sprout")}
        <div><b>迹芽</b><span class="demo-hint">${esc(fmtEnum(runs[runs.length - 1].status ?? "idle"))} · 已出 ${runs.reduce((n, r) => n + (r.created ?? 0), 0)} 张</span></div>
      </div>
      <ol class="demo-stage-rail">
        <li><span>原文献</span><b>${items.length} 项</b></li>
        <li><span>AI 加工</span><b>${runs.length} 次回执</b></li>
        <li><span>待人审</span><b>${pending} 项</b></li>
        <li><span>已归入</span><b>${confirmed} 项</b></li>
      </ol>
      <p class="demo-hint">进度只来自已落库回执，不预设、不虚拟。</p>
    </div>` : `<div class="demo-card-block"><p class="demo-hint">没有真实任务回执：迹芽保持待机，不画进度。</p></div>`}
    <div class="demo-card-block">
      <h3>审阅概览</h3>
      <p>已确认 ${confirmed} · 待审 ${pending} · 共 ${items.length}</p>
      <table class="demo-table"><thead><tr><th>条目</th><th>状态</th></tr></thead><tbody>
        ${items.map((it) => `<tr><td>${esc(it.payload?.text?.slice(0, 26) ?? it.id)}…</td><td><span class="demo-badge ${it.payload?.review?.status === "confirmed" ? "ok" : "warn"}">${esc(fmtReview(it.payload?.review?.status))}</span></td></tr>`).join("")}
      </tbody></table>
    </div>`;
}

// ── 方案 ───────────────────────────────────────────────────
function leftProtocol() {
  const d = state.data, vi = state.vi;
  const protos = d.listProtocols(d.meta().mainTopicId);
  return `<div class="demo-pane-head">方案（${protos.length}）</div>
    ${protos.map((p) => `<button class="demo-listrow${vi.nav === "protocol" && d.getProtocol().id === p.id ? " active" : ""}" type="button" data-action="nav" data-nav="protocol">
      <span class="demo-rowtitle">${esc(p.name)}</span>
      <span class="demo-rowmeta">${esc(fmtEnum(p.sourceKind))} · ${esc(fmtVersion(p.revision))} · ${p.revisions[p.revisions.length - 1]?.steps?.length ?? 0} 步</span>
    </button>`).join("") || `<p class="demo-hint">暂无方案。</p>`}`;
}

function midProtocol() {
  const d = state.data, vi = state.vi;
  const p = d.getProtocol();
  const snap = d.getProtocolRevision(p, p.revision);
  const L = computeLanes(snap.steps);
  return `<div class="demo-pane-head">实验图（先图后步骤）</div>
    <div class="demo-card-block">
      <h3>${esc(p.name)}</h3>
      <p class="demo-hint">${esc(fmtEnum(p.sourceKind))} · ${esc(fmtVersion(snap.revision))} · 目的：${esc(snap.purpose)}</p>
      ${figureHtml(L, vi.protoStep)}
      <p class="demo-hint">横轴为相对时间；点图中关键步骤查看条件与来源。</p>
    </div>
    <div class="demo-card-block">
      <h3>关键步骤</h3>
      <ol class="demo-steps">
        ${snap.steps.map((s) => `<li><button class="demo-stepbtn${vi.protoStep === s.id ? " active" : ""}" type="button" data-action="step" data-step="${esc(s.id)}">
          <b>${esc(s.op)}</b><span class="demo-hint">${durationLabel(s)}${s.observeEnd ? ` · 终点：${esc(s.observeEnd)}` : ""}</span></button></li>`).join("")}
      </ol>
    </div>`;
}

function figureHtml(L, sel) {
  return `<div class="demo-figure" role="img" aria-label="方案实验图">
    <div class="demo-lane">
      ${L.main.map((m, i) => `<div class="demo-fnode${sel === m.step.id ? " sel" : ""}" data-action="step" data-step="${esc(m.step.id)}" role="button" tabindex="0">
        <span class="demo-fop">${esc(m.step.op)}</span>
        <span class="demo-fmeta">${esc(timeLabel(m.offset, m.approx))} · ${esc(durationLabel(m.step))}</span>
      </div>${i < L.main.length - 1 ? `<span class="demo-farrow" aria-hidden="true">→</span>` : ""}`).join("")}
    </div>
    ${L.lanes.map((lane) => `<div class="demo-lane branch"><span class="demo-lanetitle">支路 · ${esc(lane.name)}${lane.anchored ? "" : "（锚点未指定）"}</span>
      ${lane.steps.map((s) => `<div class="demo-fnode${sel === s.id ? " sel" : ""}" data-action="step" data-step="${esc(s.id)}" role="button" tabindex="0"><span class="demo-fop">${esc(s.op)}</span></div>`).join(`<span class="demo-farrow" aria-hidden="true">→</span>`)}
    </div>`).join("")}
  </div>`;
}
function durationLabel(s) {
  const src = durationSourceOf(s);
  if (src === "unknown") return "时长未知";
  return `${s.durationMin}min${src === "estimated" ? "·估" : src === "computed" ? "·算" : ""}`;
}

function rightProtocol() {
  const d = state.data, vi = state.vi;
  const p = d.getProtocol();
  const snap = d.getProtocolRevision(p, p.revision);
  const step = vi.protoStep ? snap.steps.find((s) => s.id === vi.protoStep) : null;
  const src = p.sourceAssetId ? safe(() => d.getAsset(p.sourceAssetId), null) : null;
  return `<div class="demo-pane-head">方案信息</div>
    ${step ? `<div class="demo-card-block">
      <h3>步骤：${esc(step.op)}</h3>
      <table class="demo-table kv"><tbody>
        ${Object.entries(step.params ?? {}).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}
        <tr><th>时长</th><td>${esc(durationLabel(step))}</td></tr>
        <tr><th>终点</th><td>${esc(step.observeEnd || "未提供")}</td></tr>
        <tr><th>备注</th><td>${esc(step.note || "—")}</td></tr>
      </tbody></table>
      <p class="demo-hint">条件：${esc(snap.conditions.join("；") || "未提供")}</p>
      <p class="demo-hint">判据：${esc(snap.criteria || "未提供")}</p>
      <p class="demo-hint">来源片段：${esc(snap.sourceFragments.join("；") || "未提供")}</p>
      ${src ? `<button class="demo-link" type="button" data-action="locate" data-asset="${esc(src.id)}" data-quote="${esc((snap.sourceFragments[0] ?? "").split("·").pop()?.trim() ?? "")}">查看来源原件</button>` : ""}
    </div>` : `<div class="demo-card-block"><p class="demo-hint">点中间图或步骤列表中的关键步骤，查看条件与来源。</p></div>`}
    <div class="demo-card-block">
      <h3>未知项</h3>
      <p>${esc(snap.unknowns.join("；") || "无")}</p>
      <h3>来源</h3>
      <p>${src ? esc(src.name) : "未提供"}</p>
    </div>`;
}

// ── 记录 ───────────────────────────────────────────────────
function leftRecord() {
  const d = state.data, vi = state.vi;
  const execs = d.listExecutions(d.meta().mainTopicId);
  return `<div class="demo-pane-head">执行（${execs.length}）</div>
    ${execs.map((e) => `<button class="demo-listrow${vi.nav === "record" ? " active" : ""}" type="button" data-action="nav" data-nav="record">
      <span class="demo-rowtitle">${esc(e.id)} · ${esc(fmtEnum(e.status))}</span>
      <span class="demo-rowmeta">${e.origin === "reconstructed" ? "文献重构" : "自建"} · ${esc(fmtTime(e.updatedAt))}</span>
    </button>`).join("") || `<p class="demo-hint">暂无执行。</p>`}`;
}

function midRecord() {
  const d = state.data, vi = state.vi;
  const e = d.getExecution();
  const steps = d.executionSteps(e);
  const meas = d.listMeasurements(e.id);
  const devs = d.executionDeviations(e);
  return `<div class="demo-pane-head">执行与测量（先看执行）</div>
    <div class="demo-card-block">
      <h3>${esc(e.id)} · ${esc(fmtEnum(e.status))}${e.origin === "reconstructed" ? " · 文献重构" : ""}</h3>
      <p class="demo-hint">方案 ${esc(e.protocolId)} · ${esc(fmtVersion(e.protocolRevision))} · 更新 ${esc(fmtTime(e.updatedAt))}</p>
      ${e.preparation?.notes ? `<p>${esc(e.preparation.notes)}</p>` : ""}
      <div class="demo-tabrow">
        ${Object.entries(TABS).map(([k, label]) => `<button class="demo-tab${vi.execTab === k ? " on" : ""}" type="button" data-action="exectab" data-tab="${k}">${label}${k === "deviation" && devs.length ? `（${devs.length}）` : k === "sample" ? `（${d.listSamples(e.id).length}）` : k === "table" ? `（${d.listTables(d.meta().mainTopicId).length}）` : ""}</button>`).join("")}
      </div>
      <p class="demo-hint">右侧显示所选分项的明细；每一步可回查方案快照。</p>
    </div>
    <div class="demo-card-block">
      <h3>步骤记录表</h3>
      <table class="demo-table"><thead><tr><th>步骤</th><th>计划时长</th><th>实际</th><th>意外</th></tr></thead><tbody>
        ${steps.map((s) => {
          const evs = (e.events ?? []).filter((ev) => ev.stepId === s.id && ev.kind === "step");
          const last = evs[evs.length - 1];
          const dev = (e.events ?? []).some((ev) => ev.kind === "deviation" && ev.stepId === s.id);
          return `<tr><td>${esc(s.op)}</td><td>${esc(durationLabel(s))}</td><td>${last?.actual?.durationMin != null ? `${last.actual.durationMin}min` : "未记录"}${last?.actual?.amount ? ` · ${esc(last.actual.amount)}` : ""}</td><td>${dev ? `<span class="demo-badge warn">有</span>` : "—"}</td></tr>`;
        }).join("")}
      </tbody></table>
    </div>
    <div class="demo-card-block">
      <h3>测量（${meas.length}）</h3>
      ${meas.length ? `<table class="demo-table"><thead><tr><th>时间</th><th>方法</th><th>值</th><th>样品</th></tr></thead><tbody>
        ${meas.map((m) => `<tr><td>${esc(fmtTime(m.time))}</td><td>${esc(m.method)}</td><td>${esc(m.value)} ${esc(m.unit)}</td><td>${esc(safe(() => d.listSamples(e.id).find((s) => s.id === m.sampleId)?.displayName, m.sampleId) ?? m.sampleId)}</td></tr>`).join("")}
      </tbody></table>` : `<p class="demo-hint">无测量。</p>`}
    </div>`;
}

function rightRecord() {
  const d = state.data, vi = state.vi;
  const e = d.getExecution();
  if (vi.execTab === "deviation") {
    const devs = d.executionDeviations(e);
    return `<div class="demo-pane-head">偏差</div>
      ${devs.length ? devs.map((ev) => `<div class="demo-card-block"><h3>${esc(ev.text)}</h3><p class="demo-hint">步骤 ${esc(ev.stepId ?? "—")} · ${esc(fmtTime(ev.at))}</p></div>`).join("") : `<div class="demo-card-block"><p class="demo-hint">本次执行未记录偏差。</p></div>`}
      <div class="demo-card-block"><button class="demo-link" type="button" data-action="backref" data-kind="execution" data-id="${esc(e.id)}">回查执行网络</button></div>`;
  }
  if (vi.execTab === "sample") {
    const samples = d.listSamples(e.id);
    return `<div class="demo-pane-head">样品</div>
      ${samples.length ? samples.map((s) => `<div class="demo-card-block"><h3>${esc(s.displayName)}</h3>
        <p class="demo-hint">编号 ${esc(s.shortName)} · ${esc(fmtEnum(s.origin))}</p>
        <table class="demo-table"><thead><tr><th>版本</th><th>用量</th><th>处理</th></tr></thead><tbody>
          ${(s.states ?? []).map((st) => `<tr><td>${esc(fmtVersion(st.revision))}</td><td>${esc(st.amount.value)} ${esc(st.amount.unit)}${st.amount.estimated ? "（估）" : ""}</td><td>${esc(st.handling)}</td></tr>`).join("")}
        </tbody></table></div>`).join("") : `<div class="demo-card-block"><p class="demo-hint">无样品。</p></div>`}`;
  }
  const tables = d.listTables(d.meta().mainTopicId);
  return `<div class="demo-pane-head">数据表</div>
    ${tables.length ? tables.map((t) => `<div class="demo-card-block"><h3>${esc(t.name)}</h3>
      <p class="demo-hint">${esc(fmtEnum(t.origin ?? "user"))} · ${esc(fmtVersion(t.revision))} · ${t.rows.length} 行 × ${t.columns.length} 列</p>
      <div class="demo-tablewrap"><table class="demo-table"><thead><tr>${t.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>
        ${t.rows.map((r) => `<tr>${r.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("")}
      </tbody></table></div>
      <button class="demo-link" type="button" data-action="locate" data-asset="${esc(t.assetId)}" data-quote="">查看原件</button></div>`).join("") : `<div class="demo-card-block"><p class="demo-hint">无数据表。</p></div>`}`;
}

// ── 分析 / 报告 ────────────────────────────────────────────
function leftAnalysis() {
  const d = state.data, vi = state.vi;
  const tasks = d.listAnalysisTasks(d.meta().mainTopicId);
  return `<div class="demo-pane-head">分析任务（${tasks.length}）</div>
    ${tasks.map((t) => `<button class="demo-listrow${vi.taskId === t.id ? " active" : ""}" type="button" data-action="task" data-task="${esc(t.id)}">
      <span class="demo-rowtitle">${esc(t.title)}</span>
      <span class="demo-rowmeta">结果 ${t.resultIds?.length ?? 0} · ${esc(fmtTime(t.updatedAt))}</span>
    </button>`).join("") || `<p class="demo-hint">暂无任务。</p>`}`;
}

function midAnalysis() {
  const d = state.data, vi = state.vi;
  const t = vi.taskId ? d.getAnalysisTask(vi.taskId) : d.getAnalysisTask();
  const results = d.listResults(t);
  const map = safe(() => d.getContextMap(t.id), null);
  const reports = d.listReports(t.id);
  return `<div class="demo-pane-head">分析结果（先结果）</div>
    ${results.map((r) => `<div class="demo-card-block">
      <h3>${esc(r.method)} ${r.reproducible ? `<span class="demo-badge ok">可复现</span>` : `<span class="demo-badge warn">不可复现</span>`} <span class="demo-hint">${esc(fmtVersion(r.revision))}</span></h3>
      <table class="demo-table kv"><tbody>
        <tr><th>参数</th><td>${esc(r.params || "未填")}</td></tr>
        ${r.note ? `<tr><th>备注</th><td>${esc(r.note)}</td></tr>` : ""}
        ${(r.missing ?? []).length ? `<tr><th>缺项</th><td>${esc(r.missing.join("；"))}</td></tr>` : ""}
        <tr><th>附件</th><td>${(r.assetIds ?? []).map((id) => `<button class="demo-link" type="button" data-action="backref" data-kind="asset" data-id="${esc(id)}">${esc(safe(() => d.getAsset(id).name, id))}</button>`).join("、") || "无"}</td></tr>
      </tbody></table>
    </div>`).join("")}
    <div class="demo-card-block">
      <h3>上下文地图 · 实跑生成</h3>
      ${map ? contextMapHtml(map) : `<div class="demo-miss"><p>脚本未提供该任务的实跑上下文地图（缺项：demo.contextMaps[${esc(t.id)}]）。</p><p class="demo-hint">不现场合成图；正式快照将包含 /api/analysis/tasks/:id/map 的结果。</p></div>`}
    </div>
    <div class="demo-card-block">
      <h3>方法与版本</h3>
      <p class="demo-hint">快照 ${esc(t.snapshot?.hash?.slice(0, 12) ?? "未冻结")}… · 模型 ${esc(t.snapshot?.model ?? "未标注")} · 提示词 ${esc(t.snapshot?.promptVersion ?? "—")}</p>
      <p class="demo-hint">目的：${esc(t.snapshot?.purpose ?? "未填")}</p>
      ${(t.snapshot?.fragments ?? []).map((f) => `<p class="demo-hint">碎片 · ${esc(f.label)} · ${esc(f.version)} · ${esc(fmtKind(f.ref.kind))}</p>`).join("")}
    </div>
    <div class="demo-card-block">
      <h3>原始表与原件</h3>
      <p>${(t.core ?? []).map((r) => `<button class="demo-chip" type="button" data-action="backref" data-kind="${esc(r.kind)}" data-id="${esc(r.id)}">${esc(fmtKind(r.kind))} ${esc(r.id)}</button>`).join(" ") || "无"}</p>
    </div>
    ${reports.length ? `<p class="demo-hint">分析初稿 ${reports.length} 份见右栏。</p>` : ""}`;
}

function contextMapHtml(map) {
  const nodes = map.nodes ?? [], edges = map.edges ?? [];
  const cols = [];
  const depth = new Map(nodes.map((n) => [n.key, 0]));
  for (let i = 0; i < nodes.length; i++) {
    for (const e of edges) if (depth.has(e.from) && depth.has(e.to)) depth.set(e.to, Math.max(depth.get(e.to), (depth.get(e.from) ?? 0) + 1));
  }
  for (const n of nodes) {
    const dpt = depth.get(n.key) ?? 0;
    (cols[dpt] ??= []).push(n);
  }
  const W = 220, H = 74, GAPX = 90, GAPY = 22, PAD = 16;
  const ncol = cols.length || 1;
  const maxRows = Math.max(1, ...cols.map((c) => c.length));
  const width = PAD * 2 + ncol * W + (ncol - 1) * GAPX;
  const height = PAD * 2 + maxRows * H + (maxRows - 1) * GAPY;
  const pos = new Map();
  cols.forEach((col, ci) => col.forEach((n, ri) => pos.set(n.key, { x: PAD + ci * (W + GAPX), y: PAD + ri * (H + GAPY) })));
  const roleColor = { core: "#a63f2e", selected: "#3f7d5a", optional: "#8c7a63", context: "#796a58" };
  return `<div class="demo-mapwrap"><svg class="demo-map" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="上下文地图">
    ${edges.map((e) => {
      const a = pos.get(e.from), b = pos.get(e.to);
      if (!a || !b) return "";
      const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2;
      return `<path d="M${x1},${y1} C${x1 + 40},${y1} ${x2 - 40},${y2} ${x2},${y2}" fill="none" stroke="#c9b79b" stroke-width="1.4" marker-end="url(#demo-arrow)"/>`;
    }).join("")}
    <defs><marker id="demo-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#c9b79b"/></marker></defs>
    ${nodes.map((n) => {
      const p = pos.get(n.key); if (!p) return "";
      const c = roleColor[n.role] ?? "#796a58";
      return `<g class="demo-mapnode" data-action="backref" data-kind="${esc(n.kind)}" data-id="${esc(n.id)}" role="button" tabindex="0">
        <rect x="${p.x}" y="${p.y}" width="${W}" height="${H}" rx="8" fill="#fbf6ec" stroke="${c}" stroke-width="1.4"/>
        <rect x="${p.x}" y="${p.y}" width="4" height="${H}" rx="2" fill="${c}"/>
        <text x="${p.x + 12}" y="${p.y + 22}" font-size="12" fill="#2b2520">${esc(clip(n.label, 22))}</text>
        <text x="${p.x + 12}" y="${p.y + 42}" font-size="10.5" fill="#796a58">${esc(fmtKind(n.kind))} · ${esc(roleLabel(n.role))}</text>
        ${(n.gaps ?? []).length ? `<text x="${p.x + 12}" y="${p.y + 60}" font-size="10" fill="#96651d">缺：${esc(n.gaps.map((g) => g.label).join("、"))}</text>` : ""}
      </g>`;
    }).join("")}
  </svg></div>
  ${(map.gaps ?? []).length ? `<p class="demo-hint">缺口：${map.gaps.map((g) => esc(g.label)).join("；")}</p>` : ""}
  <p class="demo-hint">节点 ${nodes.length} · 边 ${edges.length}${map.truncated ? " · 已截断" : ""}；点节点回查对应对象。</p>`;
}
function roleLabel(r) { return ({ core: "必选", selected: "已选", optional: "可选", context: "上下文" }[r] ?? r); }
function clip(s, n) { return String(s ?? "").length > n ? `${String(s).slice(0, n)}…` : String(s ?? ""); }

function rightAnalysis() {
  const d = state.data, vi = state.vi;
  const t = vi.taskId ? d.getAnalysisTask(vi.taskId) : d.getAnalysisTask();
  const reports = d.listReports(t.id);
  if (!reports.length) return `<div class="demo-pane-head">分析初稿</div><div class="demo-card-block"><p class="demo-hint">该任务暂无报告。</p></div>`;
  return `<div class="demo-pane-head">分析初稿 · 报告回查</div>
    ${reports.map((rep) => `<div class="demo-card-block">
      <h3>初稿 ${esc(fmtVersion(rep.revision))} <span class="demo-hint">钉住结果 ${rep.pinned?.resultIds?.length ?? 0}</span></h3>
      ${(rep.blocks ?? []).map((b) => `<div class="demo-block">
        <div class="demo-blockhead"><span class="demo-badge">${esc(fmtEnum(b.nature))}</span>
          <span class="demo-badge ${b.draft ? "warn" : "ok"}">${b.draft ? "待确认" : "已确认"}</span></div>
        <p>${esc(b.text)}</p>
        <div class="demo-refchips">${(b.refs ?? []).map((r) => r.kind === "note"
          ? `<span class="demo-refchip">${esc(r.label)}</span>`
          : `<span class="demo-refchip">${esc(r.label)} · ${esc(r.version ?? "")} <button class="demo-link" type="button" data-action="backref" data-kind="${esc(r.kind)}" data-id="${esc(r.id)}">回查</button></span>`).join("")}
        </div></div>`).join("")}
    </div>`).join("")}`;
}

// ── 对话 ───────────────────────────────────────────────────
function leftChat() {
  const d = state.data, vi = state.vi;
  const chats = d.listChats(d.meta().mainTopicId);
  return `<div class="demo-pane-head">预生成对话（${chats.length}）</div>
    ${chats.map((c) => `<button class="demo-listrow${vi.chatId === c.id ? " active" : ""}" type="button" data-action="nav" data-nav="chat">
      <span class="demo-rowtitle">${esc(c.messages?.[0]?.content?.slice(0, 24) ?? "对话")}…</span>
      <span class="demo-rowmeta">${c.messages?.length ?? 0} 条 · ${esc(fmtTime(c.createdAt))}</span>
    </button>`).join("") || `<p class="demo-hint">暂无预生成对话。</p>`}`;
}

function midChat() {
  const d = state.data, vi = state.vi;
  const c = vi.chatId ? d.getChat(vi.chatId) : d.getChat();
  return `<div class="demo-pane-head">上下文对话 <span class="demo-badge preset">预生成</span></div>
    <div class="demo-chat">
      ${(c.messages ?? []).map((m) => `<div class="demo-msg ${m.role}">
        <div class="demo-msgrole">${m.role === "user" ? "提问" : "预生成回答"}</div>
        <p>${esc(m.content)}</p>
        ${(m.sources ?? []).length ? `<div class="demo-refchips">${m.sources.map((s) => {
          const [kind, id] = String(s).split(":");
          return `<button class="demo-chip" type="button" data-action="chatref" data-kind="${esc(kind)}" data-id="${esc(id)}">${esc(fmtKind(kind))} ${esc(id)}</button>`;
        }).join("")}</div>` : ""}
        <div class="demo-hint">${esc(fmtTime(m.at))} · ${esc(fmtEnum(m.status))}</div>
      </div>`).join("")}
    </div>
    <details class="demo-boundary inline">
      <summary data-action="boundary">实时对话：在线试玩待开放</summary>
      <p>公开站只展示预生成记录；发送、重试、采纳需联网，本站不触发后端。</p>
    </details>`;
}

function rightChat() {
  const d = state.data, vi = state.vi;
  const c = vi.chatId ? d.getChat(vi.chatId) : d.getChat();
  return `<div class="demo-pane-head">范围 · 来源</div>
    <div class="demo-card-block">
      <h3><span class="demo-badge preset">预生成</span> ${esc(fmtEnum(c.messages?.[0]?.status ?? "done"))}</h3>
      <p class="demo-hint">${esc(fmtTime(c.createdAt))} · 范围 ${c.scope?.length ?? 0} 个对象</p>
      <div class="demo-refchips">${(c.scope ?? []).map((r) => `<button class="demo-chip" type="button" data-action="chatref" data-kind="${esc(r.kind)}" data-id="${esc(r.id)}">${esc(fmtKind(r.kind))} ${esc(r.id)}</button>`).join("") || `<span class="demo-hint">无范围</span>`}</div>
      <p class="demo-hint">对话不修改对象；采纳需确认，公开展示为只读。</p>
    </div>
    <div class="demo-card-block"><h3>与下一步的关系</h3><p class="demo-hint">对话与下一步指导都来自同一批复核后的预生成记录。点引用可回到对应对象。</p></div>`;
}

// ── 致命错误 ───────────────────────────────────────────────
function renderFatal(root, e) {
  const r = reasonOf(e);
  const zipUrl = state.options.zipUrl ?? "";
  root.innerHTML = `<div class="demo-app demo-fatal">
    <div class="demo-fatal-box" role="alert">
      <h2>展示加载失败</h2>
      <p>快照未能载入，公开展示主线暂停。</p>
      <p class="demo-hint">路径：<code>${esc(r.path || state.options.dataUrl || "snapshot")}</code></p>
      <p class="demo-hint">原因：${esc(r.reason)}</p>
      <div class="demo-fatal-act">
        <button type="button" class="demo-primary" data-action="retry">重试</button>
        ${zipUrl ? `<a class="demo-zip" href="${esc(zipUrl)}" download>下载样本 ZIP</a>` : `<button type="button" class="demo-zip" data-action="zip">下载样本 ZIP</button>`}
      </div>
    </div>
  </div>`;
}

export { state as demoState };
