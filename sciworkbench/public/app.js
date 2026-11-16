// LOCUS 最小闭环前端（本地开发版，v2）。
// 结构：state ← api.getState()（刷新恢复）；render* 纯渲染；事件 → api → 重新拉取。
// 队友接手点：换 UI 只动 render*；换存储/部署只动 lib/api.js。
import { api } from "./lib/api.js";

let state = { assets: [], cards: [], tables: [] };
let selectedCell = null; // {tableId,row,col}

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const assetName = (id) => state.assets.find((a) => a.id === id)?.name ?? id;

async function refresh() {
  state = await api.getState();
  render();
}
function setStatus(m) { $("#status").textContent = m; }

async function renderAiBar() {
  try {
    const s = await api.aiStatus();
    $("#aibar").innerHTML = s.configured
      ? `AI：已配置 · <strong>${esc(s.model)}</strong> @ ${esc(s.baseUrl)} ·（仅进程内存；重启失效）`
      : `AI：<strong>未配置</strong> · 启动时设置 <code>LOCUS_AI_BASE_URL / LOCUS_AI_MODEL / LOCUS_AI_KEY</code> 后可用 AI 抽取`;
  } catch { $("#aibar").textContent = ""; }
}

function render() {
  setStatus(`素材 ${state.assets.length} · 证据卡 ${state.cards.length} · 表格 ${state.tables.length}`);
  renderCards();
  renderTables();
}

function renderCards() {
  const box = $("#lit-list");
  if (state.cards.length === 0) { box.innerHTML = `<p class="hint">尚无证据卡。先在上方导入一段文献摘录。</p>`; return; }
  box.innerHTML = state.cards.map((c) => `
    <div class="item" data-id="${c.id}">
      <div class="meta">来源：${esc(assetName(c.assetId))} · 抽取 <span class="badge ${c.extraction === "ai" ? "ai" : ""}">${c.extraction}</span> · 核对 <span class="badge ${c.audit}">${c.audit}</span> · rev ${c.revision}</div>
      <div class="raw">${esc(c.rawText)}</div>
      <div class="row">
        <label>核对</label>
        <select data-field="audit">${["unreviewed", "confirm", "need_info", "exclude", "skip"].map((v) => `<option ${v === c.audit ? "selected" : ""}>${v}</option>`).join("")}</select>
        <label>重要程度</label>
        <select data-field="importance">${["", "high", "medium", "low"].map((v) => `<option value="${v}" ${(c.importance ?? "") === v ? "selected" : ""}>${v || "—"}</option>`).join("")}</select>
      </div>
      <div class="row"><label>备注</label><input data-field="note" value="${esc(c.note)}" /></div>
      <div class="row">
        <label>原因</label><input data-field="reason" value="${esc(c.reason)}" placeholder="排除/改关键文本时必填" />
        <button class="save">保存</button>
        <button class="source-btn">原件回查</button>
        <button class="history-btn">历史(${c.history.length})</button>
      </div>
    </div>`).join("");
}

function renderTables() {
  const box = $("#meas-list");
  if (state.tables.length === 0) { box.innerHTML = `<p class="hint">尚无表格。先在上方导入 CSV。</p>`; return; }
  box.innerHTML = state.tables.map((t) => {
    const head = t.columns.map((name, i) => `
      <th>
        <div>${esc(name)}</div>
        <input data-col="${i}" data-k="unit" value="${esc(t.columnMeta[i].unit)}" placeholder="单位" />
        <select data-col="${i}" data-k="decision">${["unreviewed", "confirm", "need_info"].map((v) => `<option ${v === t.columnMeta[i].decision ? "selected" : ""}>${v}</option>`).join("")}</select>
      </th>`).join("");
    const body = t.rows.map((r, ri) => `<tr>${t.columns.map((_, ci) => `<td class="cell" data-row="${ri}" data-col="${ci}" title="点击选择该单元格">${esc(r[ci] ?? "")}</td>`).join("")}</tr>`).join("");
    const sel = selectedCell && selectedCell.tableId === t.id ? selectedCell : null;
    return `
    <div class="item" data-id="${t.id}">
      <div class="meta">来源：${esc(t.name)} · ${t.rows.length} 行 × ${t.columns.length} 列 · rev ${t.revision}</div>
      <div class="tablewrap"><table class="grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
      <div class="row"><label>备注</label><input data-field="note" value="${esc(t.note)}" />
        <label>原因</label><input data-field="reason" placeholder="改单元格数值时必填" />
        <button class="save-cols">保存列设置</button>
        <button class="source-btn">原件回查</button>
        <button class="history-btn">历史(${t.history.length})</button>
      </div>
      ${sel ? `
      <div class="row celledit">
        <label>单元格 r${sel.row}·c${sel.col}</label>
        <span class="raw">${esc(t.rows[sel.row]?.[sel.col] ?? "")}</span> →
        <input data-field="cellValue" value="${esc(t.rows[sel.row]?.[sel.col] ?? "")}" />
        <button class="save-cell">保存单元格</button>
        <button class="cancel-cell">取消</button>
      </div>` : ""}
    </div>`;
  }).join("");
}

// ── 事件 ────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${t.dataset.tab}`));
}));

$("#lit-import").addEventListener("click", async () => {
  try {
    const mode = $("#lit-mode").value;
    const r = await api.importLiterature($("#lit-name").value, $("#lit-text").value, mode);
    $("#lit-text").value = "";
    await refresh();
    setStatus(`导入成功（${mode}）：生成 ${r.created} 张证据卡`);
  } catch (e) { alert(`导入失败：${e.message}`); }
});

$("#meas-import").addEventListener("click", async () => {
  try {
    const file = $("#meas-file").files?.[0];
    let csv = $("#meas-text").value;
    let name = $("#meas-name").value;
    if (file) { csv = await file.text(); if (!name) name = file.name; }
    const r = await api.importMeasurements(name, csv);
    $("#meas-text").value = "";
    await refresh();
    setStatus(`导入成功：表格 ${r.created} 行`);
  } catch (e) { alert(`导入失败：${e.message}`); }
});

$("#lit-list").addEventListener("click", (ev) => onListClick(ev, "card"));
$("#meas-list").addEventListener("click", (ev) => onListClick(ev, "table"));

async function onListClick(ev, kind) {
  const item = ev.target.closest(".item");
  if (!item) return;
  const id = item.dataset.id;
  const val = (f) => item.querySelector(`[data-field="${f}"]`)?.value ?? "";
  const obj = kind === "card" ? state.cards.find((c) => c.id === id) : state.tables.find((t) => t.id === id);
  try {
    if (ev.target.classList.contains("history-btn")) { openHistory(kind, obj); return; }
    if (ev.target.classList.contains("source-btn")) { await openSource(kind, obj); return; }
    if (ev.target.classList.contains("cancel-cell")) { selectedCell = null; render(); return; }
    if (ev.target.classList.contains("save-cell") && selectedCell) {
      await api.reviewTable(selectedCell.tableId, { cellUpdates: [{ row: selectedCell.row, col: selectedCell.col, value: val("cellValue") }], reason: val("reason") });
      selectedCell = null; await refresh(); setStatus("单元格已保存（含修订历史）"); return;
    }
    if (ev.target.classList.contains("cell")) {
      selectedCell = { tableId: id, row: Number(ev.target.dataset.row), col: Number(ev.target.dataset.col) };
      render(); return;
    }
    if (ev.target.classList.contains("save")) {
      await api.reviewCard(id, { audit: val("audit"), importance: val("importance") || null, note: val("note"), reason: val("reason") });
      await refresh(); setStatus("已保存（含修订历史）"); return;
    }
    if (ev.target.classList.contains("save-cols")) {
      const columnUpdates = state.tables.find((t) => t.id === id).columns.map((_, i) => ({
        index: i,
        unit: item.querySelector(`[data-col="${i}"][data-k="unit"]`).value,
        decision: item.querySelector(`[data-col="${i}"][data-k="decision"]`).value,
      }));
      await api.reviewTable(id, { columnUpdates, note: val("note"), reason: val("reason") });
      await refresh(); setStatus("列设置已保存"); return;
    }
  } catch (e) { alert(`操作失败：${e.message}`); }
}

async function openSource(kind, obj) {
  const sv = await api.getSource(obj.assetId);
  $("#drawer-title").textContent = `原件回查 · ${sv.asset.name}`;
  $("#drawer-meta").textContent = `类型：${sv.asset.kind} · bytes ${sv.asset.bytes}（完整保存，未截断） · hash ${sv.asset.hash.slice(0, 12)}…`;
  if (kind === "card") {
    const q = obj.locator.sectionQuote;
    $("#drawer-source").innerHTML = esc(sv.asset.text).replace(esc(q), `<mark>${esc(q)}</mark>`);
  } else {
    $("#drawer-source").textContent = sv.asset.text; // 表格：显示完整原件文本
  }
  $("#drawer-history").innerHTML = "";
  $("#drawer").hidden = false;
}

function openHistory(kind, obj) {
  $("#drawer-title").textContent = `修订历史 · ${kind === "card" ? "证据卡" : obj.name}`;
  $("#drawer-meta").textContent = `当前 rev ${obj.revision} · 共 ${obj.history.length} 条修订`;
  $("#drawer-source").textContent = "";
  $("#drawer-history").innerHTML = obj.history.length === 0
    ? `<p class="hint">暂无修订记录（保存过更正后会出现）。</p>`
    : `<table class="grid"><thead><tr><th>rev</th><th>字段</th><th>前</th><th>后</th><th>原因</th><th>时间</th></tr></thead><tbody>${
        obj.history.slice().reverse().map((h) => `<tr><td>${h.revision}</td><td>${esc(h.field)}</td><td class="raw">${esc(h.before)}</td><td class="raw">${esc(h.after)}</td><td>${esc(h.reason)}</td><td>${esc(h.at)}</td></tr>`).join("")
      }</tbody></table>`;
  $("#drawer").hidden = false;
}

$("#drawer-close").addEventListener("click", () => { $("#drawer").hidden = true; });

renderAiBar();
refresh().catch((e) => setStatus(`加载失败：${e.message}`));
