// LOCUS 三栏工作台前端（本地开发版）。
// 左：课题/子问题/材料与导入；中：原始材料（可高亮定位）；右：结构化结果与核对。
// 防护：所有写操作禁用按钮 + 处理中提示 + 内联错误 + 可重试；离开前脏检查。
import { api } from "./lib/api.js";

let state = { topics: [], subquestions: [], assets: [], cards: [], tables: [] };
const ui = { nav: "literature", topicId: "", assetId: null, highlight: null, cell: null, dirty: false, busy: false };
let lastAction = null; // { label, run }

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const topicName = (id) => state.topics.find((t) => t.id === id)?.name;

async function refresh() {
  state = await api.getState();
  if (ui.assetId && !state.assets.some((a) => a.id === ui.assetId)) ui.assetId = null;
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
  renderTopics(); renderSubq(); renderImportBox(); renderMaterials(); renderMiddle(); renderRight();
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
          if (job.status === "done") { ui.assetId = job.result.assetId; await refresh(); setStatus(`AI 导入成功：${job.result.created} 张证据卡`); return; }
          if (job.status === "error") throw new Error(job.error || "AI 抽取失败");
          await new Promise((res) => setTimeout(res, 700));
        }
        throw new Error("AI 抽取等待超时（请查看服务日志）");
      }
      await refresh(); ui.assetId = r.assetId; renderAll();
      setStatus(`导入成功：${r.created} 张证据卡（draft）`);
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
          <button class="primary" id="meas-import">导入</button></div>
      </details>`;
    $("#meas-import").addEventListener("click", (ev) => runBusy(ev.target, "导入数据", async () => {
      const file = $("#meas-file").files?.[0];
      let csv = $("#meas-text").value, name = $("#meas-name").value;
      if (file) { csv = await readTextFile(file); if (!name) name = file.name; }
      const r = await api.importMeasurements(name, csv, ui.topicId || undefined, $("#meas-hdr")?.value ?? "auto");
      $("#meas-text").value = ""; if ($("#meas-file")) $("#meas-file").value = "";
      await refresh(); ui.assetId = r.assetId; renderAll();
      setStatus(`导入成功：表格 ${r.created} 行`);
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
function cardsHtml(assetId) {
  const cards = state.cards.filter((c) => c.assetId === assetId);
  if (!cards.length) return `<p class="hint">暂无证据卡。</p>`;
  return cards.map((c) => `
    <div class="item" data-id="${c.id}">
      <div class="meta">抽取 <span class="badge ${c.extraction === "ai" ? "ai" : ""}">${c.extraction}</span> · 核对 <span class="badge ${c.audit}">${c.audit}</span> · rev ${c.revision}</div>
      <div class="raw linkable" title="点击在原文件中定位">${esc(c.rawText)}</div>
      <div class="row"><label>核对</label>
        <select data-field="audit">${["unreviewed", "confirm", "need_info", "exclude", "skip"].map((v) => `<option ${v === c.audit ? "selected" : ""}>${v}</option>`).join("")}</select>
        <label>重要</label>
        <select data-field="importance">${["", "high", "medium", "low"].map((v) => `<option value="${v}" ${(c.importance ?? "") === v ? "selected" : ""}>${v || "—"}</option>`).join("")}</select>
      </div>
      <div class="row"><label>备注</label><input data-field="note" value="${esc(c.note)}" /></div>
      <div class="row"><label>原因</label><input data-field="reason" value="${esc(c.reason)}" placeholder="排除/改关键文本时必填" />
        <button class="save">保存</button><button class="history-btn">历史(${c.history.length})</button></div>
    </div>`).join("");
}
function tableHtml(assetId) {
  const t = state.tables.find((x) => x.assetId === assetId);
  if (!t) return `<p class="hint">暂无表格。</p>`;
  const head = t.columns.map((name, i) => `<th><div>${esc(name)}</div>
    <input data-col="${i}" data-k="unit" value="${esc(t.columnMeta[i].unit)}" placeholder="单位" />
    <select data-col="${i}" data-k="decision">${["unreviewed", "confirm", "need_info"].map((v) => `<option ${v === t.columnMeta[i].decision ? "selected" : ""}>${v}</option>`).join("")}</select></th>`).join("");
  const body = t.rows.map((r, ri) => `<tr>${t.columns.map((_, ci) => `<td class="cell" data-row="${ri}" data-col="${ci}">${esc(r[ci] ?? "")}</td>`).join("")}</tr>`).join("");
  const cell = ui.cell && ui.cell.tableId === t.id ? ui.cell : null;
  return `
    <div class="item" data-id="${t.id}">
      <div class="meta">${t.rows.length} 行 × ${t.columns.length} 列 · rev ${t.revision}</div>
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
  ui.nav = b.dataset.nav; ui.highlight = null; ui.cell = null;
  $$(".navitem").forEach((x) => x.classList.toggle("active", x === b));
  renderAll();
});
$("#topic-select").addEventListener("change", (e) => { if (!guardLeave()) { renderTopics(); return; } ui.topicId = e.target.value; ui.assetId = null; ui.highlight = null; renderAll(); });
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
  ui.assetId = el.dataset.id; ui.highlight = null; ui.cell = null; renderAll();
});
$("#right-content").addEventListener("input", (ev) => { if (ev.target.closest(".item")) ui.dirty = true; });
$("#right-content").addEventListener("click", async (ev) => {
  const item = ev.target.closest(".item"); if (!item) return;
  const val = (f) => item.querySelector(`[data-field="${f}"]`)?.value ?? "";
  try {
    if (ev.target.classList.contains("history-btn")) {
      const isCard = item.querySelector("select[data-field=audit]");
      openHistory(isCard ? state.cards.find((c) => c.id === item.dataset.id) : state.tables.find((t) => t.id === item.dataset.id)); return;
    }
    if (ev.target.classList.contains("raw") && ev.target.classList.contains("linkable")) {
      const c = state.cards.find((x) => x.id === item.dataset.id); ui.highlight = c?.locator.sectionQuote || c?.rawText || null; renderMiddle(); return;
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
