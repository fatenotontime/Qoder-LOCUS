/**
 * 领域知识积累页：渲染（纯函数）＋事件注册（bindKnowledge）。
 * 渲染函数无 DOM；事件走文档级委托、closest() 命中。
 * 行为与拆分前一致：DOM、文案、接口、请求时序均不变。
 */
import { esc } from "../views.js";
import { fmtEnum } from "../format.js";

const ROLE_LABEL = { fulltext: "正文", supplement: "补充材料", other: "其他" };

let ctx = null;

// ── 渲染：原文区 ────────────────────────────────────────────

const KZ_PART = (c) => (c.audit === "confirm" ? "cand" : c.audit === "skip" ? "skip" : c.audit === "exclude" ? "excl" : "todo");
const KZ_STATUS = { todo: "待审", cand: "已入候选", skip: "已跳过", excl: "已排除" };
const kzCards = (state, ui) => state.cards.filter((c) => (ui.paperId ? c.paperId === ui.paperId : true));

/** 原文区（显示层排版；原件字节不改）。章节标题、影印页码、段落间距；命中高亮。 */
function fmtSource(text, hi) {
  const lines = String(text ?? "").split(/\r?\n/);
  const out = [];
  let buf = [];
  const flush = () => { if (buf.length) { out.push(`<p>${esc(buf.join(" "))}</p>`); buf = []; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (/^#{1,6}\s+/.test(line)) { flush(); out.push(`<h4>${esc(line.replace(/^#{1,6}\s+/, ""))}</h4>`); continue; }
    if (/^（影印页|^\d{1,4}\s*$/.test(line)) { flush(); out.push(`<div class="kzpage">${esc(line)}</div>`); continue; }
    buf.push(line);
  }
  flush();
  let html = out.join("");
  if (hi && html.includes(esc(hi))) html = html.split(esc(hi)).join(`<mark>${esc(hi)}</mark>`);
  return html;
}

export function knowledgeLeftHtml(state, ui) {
  const paper = state.papers.find((p) => p.id === ui.paperId);
  if (!paper) return `<p class="hint">在左侧选择文献条目。</p>`;
  const atts = state.attachments.filter((a) => a.paperId === ui.paperId);
  const asset = (ui.assetId && state.assets.find((a) => a.id === ui.assetId)) || state.assets.find((a) => a.id === atts[0]?.assetId);
  if (!asset) return `<p class="hint">该条目暂无附件。</p>`;
  return `<div class="kztextwrap"><div class="kztext-title">${esc(asset.name)}</div><div class="kztext" id="kz-text" data-asset="${esc(asset.id)}">${fmtSource(asset.text, ui.highlight)}</div></div>`;
}

function firstQuote(c) {
  return c.spans?.find((s) => s.matched)?.quote || c.locator?.sectionQuote || "";
}

export function knowledgeWorkspaceHtml(state, ui) {
  const cards = kzCards(state, ui);
  const part = { todo: [], cand: [], skip: [], excl: [] };
  for (const c of cards) part[KZ_PART(c)].push(c);
  const tab = ui.kzTab && part[ui.kzTab] ? ui.kzTab : "todo";
  const tabs = [["todo", "待审"], ["cand", "已入候选"], ["skip", "已跳过"], ["excl", "已排除"]];
  const tabHtml = tabs.map(([k, l]) => `<button class="kztab ${k === tab ? "active" : ""}" data-kztab="${k}">${l} ${part[k].length}</button>`).join("");
  const rows = part[tab].map((c) => {    const open = ui.cardOpen === c.id;
    const type = c.kind ? fmtEnum(c.kind) : (c.extraction === "ai" ? "模型摘录" : "摘录");
    const q = firstQuote(c);
    const acts = tab === "todo"
      ? `<button class="kz-cand" data-cid="${c.id}">入候选</button><button class="kz-skip" data-cid="${c.id}">跳过</button><button class="kz-excl" data-cid="${c.id}">排除</button>`
      : `<button class="kz-undo" data-cid="${c.id}">撤回</button>`;
    return `<div class="kzcard ${open ? "open" : ""}" data-cid="${c.id}">
      <div class="kzhead"><button class="kz-open" data-cid="${c.id}"><span class="kztype">${esc(type)}</span> · <span class="kzsum">${esc(c.rawText.slice(0, 40))}</span></button><span class="badge">${KZ_STATUS[KZ_PART(c)]}</span></div>
      ${open ? `<div class="kzbody">
        <div class="kv">内容：${esc(c.rawText)}</div>
        ${c.scope ? `<div class="kv">适用范围：${esc(c.scope)}</div>` : ""}
        <div class="kv">重要程度：<select class="kz-imp" data-cid="${c.id}">${["", "high", "medium", "low"].map((v) => `<option value="${v}" ${(c.importance ?? "") === v ? "selected" : ""}>${v ? fmtEnum(v) : "未定"}</option>`).join("")}</select></div>
        <div class="kv">备注：<input class="kz-note" data-cid="${c.id}" value="${esc(c.note)}" /></div>
        <div class="kv">原文位置：${q ? `<button class="kz-locate" data-cid="${c.id}" data-quote="${esc(q)}">看原文</button>` : `<span class="hint">定位不足</span>`}</div>
        ${tab === "todo" ? `<details class="kz-reason"><summary>排除原因（可选）</summary><input class="kz-exclr" data-cid="${c.id}" placeholder="可选，留空即不填" /></details>` : ""}
        <div class="kzactions">${acts}</div>
      </div>` : ""}
    </div>`;
  }).join("");
  return `<div class="kzpick">文献：<select id="kz-paper">${state.papers.length ? state.papers.map((p) => `<option value="${esc(p.id)}" ${p.id === ui.paperId ? "selected" : ""}>${esc(p.title)}</option>`).join("") : `<option>（暂无文献）</option>`}</select></div>
    <div class="kztabs">${tabHtml}</div>
    <div class="kzlist">${rows || `<p class="hint">此分区暂无卡片。</p>`}</div>
    <div class="kzfoot"><button class="kz-skipall">一键全部跳过</button><span class="hint">为时间紧准备，不推荐</span></div>`;
}

export function knowledgeQueueHtml(state, ui) {
  const queue = kzCards(state, ui).filter((c) => c.extraction === "ai" && KZ_PART(c) === "todo");
  const j = ui.kzJob;
  const task = j ? `<div class="kzq-task">
    <span class="hint">${j.status === "running" ? `抽取中 ${j.done}/${j.total} 段，已出 ${j.created} 张` : (j.status === "paused" ? `已暂停：已出 ${j.created} 张` : (j.cancelled ? `已取消，保留已出 ${j.created} 张` : esc(j.message ?? "")))}</span>
    ${j.status === "running" ? `<button class="kzq-pause">暂停</button><button class="kzq-cancel">取消</button>` : ""}
    ${j.status === "paused" ? `<button class="kzq-resume">继续</button><button class="kzq-cancel">取消</button>` : ""}
  </div>${(j.chunkErrors ?? []).map((e) => `<div class="kzq-err">第 ${e.index + 1} 段失败 · <button class="kzq-retry" data-index="${e.index}">重试</button></div>`).join("")}` : "";
  return `<div class="kzq">
    <div class="kzq-head">AI 待审队列 <span class="badge">新增 ${queue.length}</span></div>
    ${task}
    <div class="kzq-list">${queue.map((c) => `<button class="kzq-item" data-cid="${c.id}">${esc(c.kind ? fmtEnum(c.kind) : "摘录")} · ${esc(c.rawText.slice(0, 28))}</button>`).join("") || `<p class="hint">队列为空。</p>`}</div>
  </div>`;
}

// ── 中栏「＋新建」：语义提取表单（含机械草稿调试） ──────────

export function renderKnowledgeForm(box) {
  const state = ctx.getState();
  const { ui, $, $$ } = ctx;
  const p = state.papers.find((x) => x.id === ui.paperId) ?? null;
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
  if (start) start.addEventListener("click", (ev) => ctx.runJob(ev.target, "语义知识提取", async () => {
    const attachmentIds = [...$$(".k-att")].filter((x) => x.checked).map((x) => x.value);
    const r = await ctx.api.knowledgeJob({ paperId: p.id, attachmentIds, purpose: $("#k-purpose").value, topicId: ui.topicId || undefined, subquestionId: $("#k-subq")?.value || undefined });
    ui.kzJob = { id: r.jobId, status: "running", done: 0, total: r.total ?? 0, created: 0, chunkErrors: [], message: "语义提取中…" };
    ctx.renderRight();
    const job = await pollKnowledgeJob(r.jobId);
    await ctx.refreshAfterJob();
    if (job.status === "done") { ctx.setStatus(job.message); }
    else { const h = ctx.humanError(job.error ?? ""); ctx.setStatus("知识提取失败，详情见错误面板。"); ctx.setError("right", { panel: "right", message: `知识提取失败：${h.message}`, detail: h.detail, retry: null }); }
  }));
  $("#dbg-import").addEventListener("click", (ev) => ctx.runBusy(ev.target, "导入机械草稿", async () => {
    const r = await ctx.api.importLiterature($("#dbg-name").value || "debug.md", $("#dbg-text").value, "draft", ui.topicId || undefined);
    await ctx.refresh(); ctx.setStatus(`机械草稿已导入：${r.created} 张（全部标记 mechanical，仅供调试）`);
  }));
}

// ── 事件 ────────────────────────────────────────────────────

async function kzAct(fn, msg) {
  try { await fn(); ctx.ui.dirty = false; await ctx.refresh(); ctx.setStatus(msg); }
  catch (e) { const h = ctx.humanError(e); ctx.setError("mid", { panel: "mid", message: h.message, detail: h.detail, retry: null }); }
}

/** 知识抽取流式轮询：只更新右栏队列（不动中栏编辑）。 */
async function pollKnowledgeJob(jobId) {
  const { api, ui } = ctx;
  for (let i = 0; i < 2400; i++) {
    const job = await api.getJob(jobId);
    ui.kzJob = { id: jobId, status: job.status, done: job.done ?? 0, total: job.total ?? 0, created: job.result?.created ?? 0, chunkErrors: job.result?.chunkErrors ?? [], cancelled: job.result?.cancelled, message: job.message };
    ctx.renderRight();
    if (job.status === "done" || job.status === "error" || job.status === "paused") return job;
    await new Promise((r) => setTimeout(r, 700));
  }
  return { status: "error", error: "等待超时" };
}

export function bindKnowledge(c) {
  ctx = c;
  document.addEventListener("click", (ev) => {
    const t = ev.target;
    const { ui, api, renderMiddle, renderShell } = ctx;
    const tab = t.closest?.(".kztab");
    if (tab) { ui.kzTab = tab.dataset.kztab; ui.cardOpen = null; renderMiddle(); return; }
    const open = t.closest?.(".kz-open");
    if (open) { ui.cardOpen = ui.cardOpen === open.dataset.cid ? null : open.dataset.cid; renderMiddle(); return; }
    const qi = t.closest?.(".kzq-item");
    if (qi) { ui.kzTab = "todo"; ui.cardOpen = qi.dataset.cid; renderMiddle(); return; }
    const loc = t.closest?.(".kz-locate");
    if (loc) { ui.highlight = loc.dataset.quote || null; renderShell(); const m = document.querySelector("#kz-text mark"); if (m) m.scrollIntoView({ block: "center" }); return; }
    const CANCEL = t.closest?.(".kzq-cancel");
    if (CANCEL) { if (ui.kzJob?.id) api.cancelKnowledgeJob(ui.kzJob.id).then(() => ctx.setStatus("已请求取消：保留已出内容")).catch(() => {}); return; }
    const PAUSE = t.closest?.(".kzq-pause");
    if (PAUSE) { if (ui.kzJob?.id) api.pauseKnowledgeJob(ui.kzJob.id).then(() => { ui.kzJob = { ...ui.kzJob, status: "paused" }; ctx.renderRight(); ctx.setStatus("已请求暂停：保留已出内容"); }).catch(() => {}); return; }
    const RESUME = t.closest?.(".kzq-resume");
    if (RESUME) {
      if (ui.kzJob?.id) { ui.kzJob = { ...ui.kzJob, status: "running" }; ctx.renderRight();
        api.resumeKnowledgeJob(ui.kzJob.id).then(() => pollKnowledgeJob(ui.kzJob.id)).then((job) => ctx.refreshAfterJob().then(() => ctx.setStatus(job.status === "done" ? job.message : "已暂停"))).catch(() => {}); }
      return;
    }
    const RETRY = t.closest?.(".kzq-retry");
    if (RETRY) {
      const idx = Number(RETRY.dataset.index);
      if (ui.kzJob?.id) { RETRY.disabled = true; api.retryKnowledgeChunk(ui.kzJob.id, idx)
        .then(async (r) => { await ctx.refreshAfterJob(); ui.kzJob = { ...ui.kzJob, chunkErrors: (ui.kzJob.chunkErrors ?? []).filter((e) => e.index !== idx), created: ui.kzJob.created + (r.created ?? 0) }; ctx.renderRight(); ctx.setStatus(`第 ${idx + 1} 段已重试（新增 ${r.created} 张）`); })
        .catch((e) => { const h = ctx.humanError(e); ctx.setError("mid", { panel: "mid", message: h.message, detail: h.detail, retry: null }); RETRY.disabled = false; }); }
      return;
    }
    const act = t.closest?.(".kz-cand, .kz-skip, .kz-excl, .kz-undo");
    if (act) {
      const cid = act.dataset.cid;
      if (act.classList.contains("kz-cand")) { kzAct(() => api.reviewCard(cid, { audit: "confirm" }), "已入候选"); return; }
      if (act.classList.contains("kz-skip")) { kzAct(() => api.reviewCard(cid, { audit: "skip" }), "已跳过（可回来）"); return; }
      if (act.classList.contains("kz-excl")) { const inp = act.closest(".kzcard")?.querySelector(".kz-exclr"); const reason = (inp?.value ?? "").trim(); kzAct(() => api.reviewCard(cid, reason ? { audit: "exclude", reason } : { audit: "exclude" }), "已排除"); return; }
      if (act.classList.contains("kz-undo")) { kzAct(() => api.reviewCard(cid, { audit: "unreviewed" }), "已撤回（回到待审）"); return; }
    }
    const skipall = t.closest?.(".kz-skipall");
    if (skipall) {
      if (!confirm("一键全部跳过：为时间紧准备，不推荐。确定跳过本页所有待审卡？")) return;
      const ids = ctx.getState().cards.filter((c) => (ui.paperId ? c.paperId === ui.paperId : true) && ["unreviewed", "need_info"].includes(c.audit)).map((c) => c.id);
      kzAct(async () => { for (const id of ids) await api.reviewCard(id, { audit: "skip" }); }, `已跳过 ${ids.length} 张`);
      return;
    }
  });
  document.addEventListener("change", (ev) => {
    const { ui } = ctx;
    if (ev.target.id === "kz-paper") { ui.paperId = ev.target.value; ui.assetId = null; ui.cardOpen = null; ui.highlight = null; ui.kzJob = null; ctx.clearAllErrors(); ctx.renderAll(); return; }
    if (ev.target.classList.contains("kz-imp")) { const cid = ev.target.dataset.cid; kzAct(() => ctx.api.reviewCard(cid, { importance: ev.target.value || null }), "重要程度已记"); }
  });
  document.addEventListener("focusout", (ev) => {
    if (ev.target.classList.contains("kz-note")) { const cid = ev.target.dataset.cid; kzAct(() => ctx.api.reviewCard(cid, { note: ev.target.value }), "备注已记"); }
  });
}
