// LOCUS 三栏工作台前端（本地开发版）。
// 左：课题/子问题/材料与导入；中：原始材料（可高亮定位）；右：结构化结果与核对。
// 防护：所有写操作禁用按钮 + 处理中提示 + 内联错误 + 可重试；离开前脏检查。
import { api } from "./lib/api.js";

let state = { topics: [], subquestions: [], assets: [], cards: [], tables: [], adoptions: [], mappings: [], comparisons: [] };
const ui = { nav: "literature", topicId: "", assetId: null, tableId: null, highlight: null, cell: null, dirty: false, busy: false, cardFilter: "all", groupSel: new Set(), batch: null, ack: false };
let lastAction = null; // { label, run }

// 选择态持久（仅非敏感 UI 选择：页签/课题/材料/表块），刷新后归属正确。
const UI_KEY = "locus.ui.v1";
let uiRestored = false;
function saveUi() {
  try { localStorage.setItem(UI_KEY, JSON.stringify({ nav: ui.nav, topicId: ui.topicId, assetId: ui.assetId, tableId: ui.tableId, cardFilter: ui.cardFilter })); } catch {}
}
function restoreUi() {
  if (uiRestored) return;
  uiRestored = true;
  try {
    const s = JSON.parse(localStorage.getItem(UI_KEY) ?? "null");
    if (!s) return;
    if (s.nav === "literature" || s.nav === "measurement") ui.nav = s.nav;
    if (s.cardFilter === "all" || s.cardFilter === "pending" || s.cardFilter === "reviewed") ui.cardFilter = s.cardFilter;
    if (state.topics.some((t) => t.id === s.topicId)) ui.topicId = s.topicId;
    if (state.assets.some((a) => a.id === s.assetId)) ui.assetId = s.assetId;
    if (state.tables.some((t) => t.id === s.tableId)) ui.tableId = s.tableId;
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

function materials() {
  return state.assets.filter((a) => a.kind === ui.nav && (!ui.topicId || a.topicId === ui.topicId || !a.topicId));
}
function currentAsset() { return state.assets.find((a) => a.id === ui.assetId) ?? null; }

/** 切换前脏检查；返回 true 表示可离开。 */
function guardLeave() {
  if (!ui.dirty) return true;
  if (confirm("当前有未保存的编辑，确定离开？未保存内容会丢失。")) { ui.dirty = false; return true; }
  return false;
}

function renderAll() {
  setStatus(`课题 ${state.topics.length} · 子问题 ${state.subquestions.length} · 材料 ${state.assets.length} · 证据卡 ${state.cards.length} · 表格 ${state.tables.length}`);
  $$(".navitem").forEach((x) => x.classList.toggle("active", x.dataset.nav === ui.nav));
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
  $("#nav-hint").textContent = ui.nav === "literature"
    ? "文献：上传 Markdown/纯文本，或粘贴文本（其他格式解析器未配置）"
    : "实验数据：上传/粘贴 CSV（保留表格结构）";
  const box = $("#import-box");
  if (ui.nav === "literature") {
    box.innerHTML = `
      <details class="mini" ${state.assets.length ? "" : "open"}>
        <summary>导入文献</summary>
        <input id="lit-name" placeholder="来源名称（如 SLAC methods-source.md）" />
        <input id="lit-file" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" />
        <textarea id="lit-text" rows="3" placeholder="或粘贴 Markdown/文本…"></textarea>
        <div class="row"><select id="lit-mode"><option value="draft">draft 草稿</option><option value="ai">AI 抽取</option></select>
        <button class="primary" id="lit-import">导入</button></div>
      </details>`;
    $("#lit-import").addEventListener("click", (ev) => runBusy(ev.target, "导入文献", async () => {
      const file = $("#lit-file").files?.[0];
      let text = $("#lit-text").value, name = $("#lit-name").value;
      if (file) { text = await readTextFile(file); if (!name) name = file.name; }
      const mode = $("#lit-mode").value;
      const r = await api.importLiterature(name, text, mode, ui.topicId || undefined);
      $("#lit-text").value = ""; if ($("#lit-file")) $("#lit-file").value = "";
      if (r.jobId) {
        for (let i = 0; i < 1200; i++) {
          const job = await api.getJob(r.jobId);
          setStatus(`AI 抽取：${job.message}`);
          if (job.status === "done") { ui.assetId = job.result.assetId; await refresh(); setStatus(`AI 导入成功：${job.result.created} 张证据卡`); if (job.result.reminder) showReminder(); return; }
          if (job.status === "error") throw new Error(job.error || "AI 抽取失败");
          await new Promise((res) => setTimeout(res, 700));
        }
        throw new Error("AI 抽取等待超时（请查看服务日志）");
      }
      await refresh(); ui.assetId = r.assetId; renderAll();
      setStatus(`导入成功：${r.created} 张证据卡（draft）`);
      if (r.reminder) showReminder();
    }));
  } else {
    box.innerHTML = `
      <details class="mini" ${state.assets.length ? "" : "open"}>
        <summary>导入实验数据（CSV）</summary>
        <input id="meas-name" placeholder="文件名（如 EnzymeML_SLAC_pH3__Data.csv）" />
        <input id="meas-file" type="file" accept=".csv,.tsv,text/csv,text/plain" />
        <textarea id="meas-text" rows="2" placeholder="或粘贴 CSV…"></textarea>
        <div class="row"><label>表头行</label>
          <select id="meas-hdr"><option value="auto">自动</option><option value="1">1 行</option><option value="2">2 行（两级）</option></select>
          <label>格式</label>
          <select id="meas-profile"><option value="auto">自动</option><option value="plain-table">单表</option><option value="enzymeML-blocks">分块</option></select>
          <button class="primary" id="meas-import">导入</button></div>
      </details>`;
    $("#meas-import").addEventListener("click", (ev) => runBusy(ev.target, "导入数据", async () => {
      const file = $("#meas-file").files?.[0];
      let csv = $("#meas-text").value, name = $("#meas-name").value;
      if (file) { csv = await readTextFile(file); if (!name) name = file.name; }
      const r = await api.importMeasurements(name, csv, ui.topicId || undefined, $("#meas-hdr")?.value ?? "auto", $("#meas-profile")?.value ?? "auto");
      $("#meas-text").value = ""; if ($("#meas-file")) $("#meas-file").value = "";
      await refresh(); ui.assetId = r.assetId; renderAll();
      setStatus(`导入成功：${r.tableCount ?? 1} 张表 · ${r.created} 行`);
    }));
  }
}
function renderMaterials() {
  const list = materials();
  $("#material-list").innerHTML = list.length
    ? list.map((a) => `<div class="material ${a.id === ui.assetId ? "active" : ""}" data-id="${a.id}">
        <div class="m-title">${esc(a.name)}</div>
        <div class="m-meta">${a.kind === "literature" ? "文献" : "数据"} · ${a.bytes}B ${a.topicId ? "· " + esc(topicName(a.topicId) ?? "") : "· 未归类"}</div>
      </div>`).join("")
    : `<p class="hint">当前${ui.nav === "literature" ? "文献" : "数据"}（${ui.topicId ? "本课题" : "全部"}）暂无材料。</p>`;
}
function renderMiddle() {
  const a = currentAsset();
  $("#mid-title").textContent = a ? `原始材料 · ${a.name}` : "原始材料";
  const note = $("#mid-note"), content = $("#mid-content");
  if (!a) { note.hidden = true; content.textContent = "在左栏选择或导入材料。"; return; }
  if (!ui.highlight) { note.hidden = true; content.innerHTML = esc(a.text); return; }
  if (a.text.includes(ui.highlight)) { note.hidden = true; content.innerHTML = esc(a.text).replace(esc(ui.highlight), `<mark>${esc(ui.highlight)}</mark>`); }
  else { note.hidden = false; note.textContent = "定位不足：未能在原件中精确匹配该条目，已展示完整原件。"; content.innerHTML = esc(a.text); }
}
function renderRight() {
  const a = currentAsset();
  if (!a) { $("#right-title").textContent = "结构化结果"; $("#right-content").innerHTML = `<p class="hint">选中材料后，这里显示结构化草稿与核对操作。</p>`; return; }
  if (a.kind === "literature") { $("#right-title").textContent = "证据卡"; $("#right-content").innerHTML = cardsHtml(a.id); }
  else { $("#right-title").textContent = "数据表格"; $("#right-content").innerHTML = tableHtml(a.id); }
}
/** 候选库状态（与后端 candidateStateOf 同口径）：跳过保未复核；采用独立于核对。 */
function candState(c) {
  if (state.adoptions.some((a) => a.cardId === c.id && a.decision === "adopt")) return "adopted";
  if (c.audit === "need_info") return "pending";
  if (c.audit === "confirm" || c.audit === "exclude") return "reviewed";
  return "unreviewed";
}
const CAND_LABEL = { unreviewed: "未复核", pending: "待补信息", reviewed: "已审候选", adopted: "已采用" };

function cardsHtml(assetId) {
  const all = state.cards.filter((c) => c.assetId === assetId);
  const inFilter = (c) => ui.cardFilter === "all" ? true
    : ui.cardFilter === "pending" ? ["unreviewed", "pending"].includes(candState(c))
    : ["reviewed", "adopted"].includes(candState(c));
  const cards = all.filter(inFilter);
  const nPend = all.filter((c) => ["unreviewed", "pending"].includes(candState(c))).length;
  const nRev = all.length - nPend;
  const asset = state.assets.find((a) => a.id === assetId);
  const subqs = state.subquestions.filter((q) => !asset?.topicId || q.topicId === asset.topicId);
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

  const manualForm = `<details class="mini">
    <summary>手动补卡（人工观察/摘录，标注 manual）</summary>
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
        抽取 <span class="badge ${c.extraction === "ai" ? "ai" : ""}">${c.extraction}</span> · 核对 <span class="badge ${c.audit}">${c.audit}</span> · 候选 <span class="badge cand-${cs}">${CAND_LABEL[cs]}</span>${c.secondaryCitation ? ` · <span class="badge secondary">转引(二手)</span>` : ""} · rev ${c.revision}</div>
      <div class="raw linkable" title="点击在原文件中定位">${esc(c.rawText)}</div>
      ${!c.locator.sectionQuote ? `<div class="hint warn">定位不足：无原文定位，不得用于正式采用。</div>` : ""}
      <details class="mini ex"><summary>字段/条件/缺项${c.unknowns.length ? `（缺项 ${c.unknowns.length}）` : ""}</summary>
        ${fields.map(([k, v]) => `<div class="row"><label>${esc(k)}</label><input data-fkey="${esc(k)}" value="${esc(v)}" /></div>`).join("") || `<p class="hint">暂无抽取字段。</p>`}
        <div class="row"><input data-field="newkey" placeholder="新字段名" /><input data-field="newval" placeholder="值" /></div>
        <div class="row"><label>单位</label><input data-field="units" value="${esc((c.extracted?.units ?? []).join(","))}" /></div>
        <div class="row"><label>条件</label><input data-field="conditions" value="${esc((c.extracted?.conditions ?? []).join(","))}" /></div>
        ${c.unknowns.length ? `<div class="hint warn">缺项：${c.unknowns.map(esc).join("、")}</div>` : ""}
        <div class="row"><button class="save-fields">保存字段/单位/条件</button></div>
      </details>
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
    </div>`;
  }).join("") : `<p class="hint">${all.length ? "当前筛选下无证据卡。" : "暂无证据卡。"}</p>`;

  return tabs + batchBar + batchPanel + manualForm + body;
}

/** 左栏文献工具：命名映射 + 条件比较（仅文献导航显示）。 */
function renderLitTools() {
  const box = $("#lit-tools");
  if (ui.nav !== "literature") { box.innerHTML = ""; return; }
  const maps = state.mappings.filter((m) => !ui.topicId || !m.topicId || m.topicId === ui.topicId);
  const cmps = state.comparisons.filter((c) => !ui.topicId || c.topicId === ui.topicId);
  const confirmed = state.cards.filter((c) => c.audit === "confirm" && (!ui.topicId || state.assets.find((a) => a.id === c.assetId)?.topicId === ui.topicId));
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

function showReminder() {
  const b = $("#banner"); b.hidden = false; b.className = "banner info";
  b.innerHTML = `<span>新文献已入库：既有比较快照保持不变。是否按新版本重新比较？</span>`;
  const btn = document.createElement("button"); btn.textContent = "打开比较"; btn.className = "primary";
  btn.addEventListener("click", () => { hideBanner(); const d = $("#cmp-box"); if (d) d.open = true; });
  b.appendChild(btn);
}
function tableHtml(assetId) {
  const ts = state.tables.filter((x) => x.assetId === assetId);
  if (!ts.length) return `<p class="hint">暂无表格。</p>`;
  const t = ts.find((x) => x.id === ui.tableId) ?? ts[0];
  const markers = new Set(t.markerRows ?? []);
  const head = t.columns.map((name, i) => `<th><div>${esc(name)}</div>
    <input data-col="${i}" data-k="unit" value="${esc(t.columnMeta[i].unit)}" placeholder="单位" />
    <select data-col="${i}" data-k="decision">${["unreviewed", "confirm", "need_info"].map((v) => `<option ${v === t.columnMeta[i].decision ? "selected" : ""}>${v}</option>`).join("")}</select></th>`).join("");
  const body = t.rows.map((r, ri) => `<tr${markers.has(ri) ? ` class="marker" title="块标记行：原件中的分块标题（非测量行），保留原样"` : ""}>${t.columns.map((_, ci) => `<td class="cell" data-row="${ri}" data-col="${ci}">${esc(r[ci] ?? "")}</td>`).join("")}</tr>`).join("");
  const cell = ui.cell && ui.cell.tableId === t.id ? ui.cell : null;
  const pick = ts.length > 1 ? `<div class="row"><label>表块</label><select id="table-pick">${ts.map((x) => `<option value="${x.id}" ${x.id === t.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>` : "";
  return `
    <div class="item" data-id="${t.id}">
      ${pick}
      <div class="meta">${t.rows.length} 行（${t.rows.length - markers.size} 数据 · ${markers.size} 标记）× ${t.columns.length} 列 · rev ${t.revision}</div>
      <div class="tablewrap"><table class="grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
      <div class="row"><label>备注</label><input data-field="note" value="${esc(t.note)}" />
        <label>原因</label><input data-field="reason" placeholder="改单元格数值时必填" />
        <button class="save-cols">保存列设置</button><button class="history-btn">历史(${t.history.length})</button></div>
      ${cell ? `<div class="row celledit"><label>单元格 r${cell.row}·c${cell.col}</label>
        <input data-field="cellValue" value="${esc(t.rows[cell.row]?.[cell.col] ?? "")}" />
        <input data-field="cellReason" placeholder="更正原因（必填）" />
        <button class="save-cell">保存单元格</button><button class="cancel-cell">取消</button></div>` : `<p class="hint">点击中间原件中的行可定位；点击单元格后再改数值（需原因）。</p>`}
    </div>`;
}

// ── 事件 ────────────────────────────────────────────────────
$("#nav").addEventListener("click", (ev) => {
  const b = ev.target.closest(".navitem"); if (!b || b.disabled) return;
  if (!guardLeave()) return;
  ui.nav = b.dataset.nav; ui.highlight = null; ui.cell = null; ui.tableId = null; ui.groupSel.clear(); ui.batch = null; ui.ack = false;
  $$(".navitem").forEach((x) => x.classList.toggle("active", x === b));
  renderAll();
});
$("#topic-select").addEventListener("change", (e) => { if (!guardLeave()) { renderTopics(); return; } ui.topicId = e.target.value; ui.assetId = null; ui.highlight = null; ui.groupSel.clear(); ui.batch = null; renderAll(); });
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
  if (el.dataset.id === ui.assetId) return;
  if (!guardLeave()) return;
  ui.assetId = el.dataset.id; ui.highlight = null; ui.cell = null; ui.tableId = null; ui.groupSel.clear(); ui.batch = null; ui.ack = false; renderAll();
});
$("#right-content").addEventListener("change", (ev) => {
  if (ev.target.id === "table-pick") { ui.tableId = ev.target.value; ui.cell = null; renderRight(); }
  if (ev.target.classList.contains("grp")) {
    const id = ev.target.dataset.id;
    if (ev.target.checked) ui.groupSel.add(id); else ui.groupSel.delete(id);
    renderRight();
  }
  if (ev.target.id === "batch-ack") { ui.ack = ev.target.checked; renderRight(); }
});
$("#right-content").addEventListener("input", (ev) => { if (ev.target.closest(".item")) ui.dirty = true; });
$("#right-content").addEventListener("click", async (ev) => {
  const item = ev.target.closest(".item");
  const val = (f) => item?.querySelector(`[data-field="${f}"]`)?.value ?? "";
  const splitList = (s) => String(s ?? "").split(/[,，]/).map((x) => x.trim()).filter(Boolean);
  try {
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
          assetId: ui.assetId, rawText: $("#mc-raw").value, sectionQuote: $("#mc-quote").value,
          fields, units: splitList($("#mc-units").value), conditions: splitList($("#mc-conditions").value),
          unknowns: splitList($("#mc-unknowns").value), secondaryCitation: $("#mc-secondary").checked, reason: $("#mc-reason").value,
        });
        ui.dirty = false; await refresh(); setStatus("补卡成功（manual，待核对）");
      }); return;
    }
    if (!item) return;
    if (ev.target.classList.contains("history-btn")) {
      const isCard = item.querySelector("select[data-field=audit]");
      openHistory(isCard ? state.cards.find((c) => c.id === item.dataset.id) : state.tables.find((t) => t.id === item.dataset.id)); return;
    }
    if (ev.target.classList.contains("raw") && ev.target.classList.contains("linkable")) {
      const c = state.cards.find((x) => x.id === item.dataset.id); ui.highlight = c?.locator.sectionQuote || c?.rawText || null; renderMiddle(); return;
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
      ui.highlight = lineOf(t, ui.cell.row); renderMiddle(); renderRight(); return;
    }
    if (ev.target.classList.contains("cancel-cell")) { ui.cell = null; renderRight(); return; }
    if (ev.target.classList.contains("save-cell") && ui.cell) {
      await runBusy(ev.target, "保存单元格", async () => {
        await api.reviewTable(ui.cell.tableId, { cellUpdates: [{ row: ui.cell.row, col: ui.cell.col, value: val("cellValue") }], reason: val("cellReason") });
        ui.cell = null; ui.dirty = false; await refresh(); setStatus("单元格已保存（含修订历史）");
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
        ui.dirty = false; await refresh(); setStatus("列设置已保存");
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
