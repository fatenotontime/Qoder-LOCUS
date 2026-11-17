const $ = (s) => document.querySelector(s);
const api = async (path, body) => {
  const r = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const MATS = [
  {
    key: "csv", name: "EnzymeML_SLAC_pH3__Data.csv", file: "samples/slac-ph3-data.csv", kind: "text",
    title: "实验数据库（条件记录 CSV）", path: "路径② 实验数据",
    src: "DaRUS DOI 10.18419/DARUS-3337 · CC BY 4.0 · 30 组动力学测定之 pH3 条件块",
    act: "上传并构建数据表", route: "/api/import/measurements",
    body: (text, topicId) => ({ name: "EnzymeML_SLAC_pH3__Data.csv", csv: text, topicId, headerRows: "auto", profile: "auto" }),
    stage: "核验未开始",
    summary: (st, a) => {
      const ts = st.tables.filter((t) => t.assetId === a.id);
      const rows = ts.reduce((n, t) => n + t.rows.length, 0);
      return `${ts.length} 张表 · ${rows} 行（含标记行）· 单元格核验未开始`;
    },
    advanced: (st, a) => st.tables.some((t) => t.assetId === a.id && t.revision > 1),
  },
  {
    key: "paper", name: "paper-laccase-btb-2026.md", file: "samples/paper-laccase-btb-2026.md", kind: "text",
    title: "真实公开论文（CC BY 全文，含署名与许可）", path: "路径① 文献整理 → 领域知识",
    src: "Europe PMC PMC13566542 · DOI 10.3390/ijms27177767 · Int. J. Mol. Sci. 2026 · CC BY 4.0（作者署名见文件头；经 scripts/fetch-paper.ts 自公开 JATS 全文转换）",
    act: "创建条目＋导入附件", route: "/api/papers",
    stage: "已导入 · 语义提取未开始",
    run: async (text, topicId) => {
      const p = await api("/api/papers", { title: "Individual and Cooperative Photochemical–Enzymatic Processes for the Degradation of the Dye Bromothymol Blue: Kinetic and Eco-Toxicity Analysis", authors: "Urquiza AS, Reynoso A, Biasutti MA, Montejano HA, Reynoso E", year: 2026, doi: "10.3390/ijms27177767", source: "Europe PMC PMC13566542 · Int. J. Mol. Sci.", license: "CC BY 4.0", note: "验收用真实公开论文（逐附件署名/许可清楚）" });
      if (p.status >= 400) return p;
      const a = await api(`/api/papers/${encodeURIComponent(p.j.paperId)}/attachments`, { name: "paper-laccase-btb-2026.md", text, role: "fulltext", version: "v1" });
      if (a.status >= 400) return a;
      if (topicId) await api(`/api/papers/${encodeURIComponent(p.j.paperId)}/topics`, { topicId, link: true });
      return { status: 201, j: { paperId: p.j.paperId, attachmentId: a.j.attachmentId } };
    },
    summary: (st) => {
      const p = st.papers.find((x) => x.doi === "10.3390/ijms27177767");
      if (!p) return "条目未找到";
      const atts = st.attachments.filter((x) => x.paperId === p.id).length;
      const cs = st.cards.filter((c) => c.paperId === p.id).length;
      return `条目 1 · 附件 ${atts}（全文）· 知识卡 ${cs}（在「领域知识积累」发起语义提取）`;
    },
    advanced: (st) => st.cards.some((c) => c.paperId && st.papers.find((p) => p.id === c.paperId)?.doi === "10.3390/ijms27177767"),
  },
  {
    key: "proto", name: "protocol-source.md", file: "samples/protocol-source.md", kind: "text",
    title: "实验方案（原作者 notebook 节选）", path: "路径② 方案直解",
    src: "DaRUS DOI 10.18419/DARUS-3337 · CC BY 4.0 · 译述节选",
    act: "上传方案原件（归档，解析在主界面）", route: "/api/protocols/upload",
    body: (text, topicId) => ({ name: MATS.find((m) => m.key === "proto").name, text, topicId }),
    stage: "已归档 · 方案解析未开始",
    summary: (st, a) => `方案原件已归档（不进文献候选库）· 结构化解析在「实验方案管理」发起`,
    advanced: (st, a) => st.protocols.some((p) => p.sourceAssetId === a.id),
  },
  {
    key: "meth", name: "methods-source.md", file: "samples/methods-source.md", kind: "text",
    title: "方法学文献（处理路径依据）", path: "路径① 文献证据",
    src: "DaRUS DOI 10.18419/DARUS-3337 · CC BY 4.0",
    act: "上传并构建草稿卡", route: "/api/import/literature",
    body: (text, topicId) => ({ name: "methods-source.md", text, topicId, mode: "draft" }),
    stage: "核验未开始",
    summary: (st, a) => {
      const cs = st.cards.filter((c) => c.assetId === a.id);
      return `${cs.length} 张草稿卡 · ${cs.filter((c) => c.audit === "unreviewed").length} 张待核验`;
    },
    advanced: (st, a) => st.cards.some((c) => c.assetId === a.id && c.audit !== "unreviewed"),
  },
];

let state = null;
let topicId = null;
const out = (key, html) => { $(`#out-${key}`).innerHTML = html; };

function statusOf(m) {
  const a = state.assets.find((x) => x.name === m.name);
  if (!a) return { a: null, badge: '<span class="badge wait">待上传</span>' };
  if (m.advanced(state, a)) return { a, badge: `<span class="badge done">已上传 · 已推进（${m.stage.replace("未开始", "已开始")}）</span>` };
  return { a, badge: `<span class="badge uploaded">已上传 · ${m.stage}</span>` };
}

function render() {
  const t = state.topics[0];
  topicId = t?.id ?? null;
  $("#envnote").innerHTML = `验收环境：独立数据文件（启动时由 <code>LOCUS_DATA</code> 指定，与主实例隔离）· 课题 ${state.topics.length} · 子问题 ${state.subquestions.length} · 原件 ${state.assets.length} · 表 ${state.tables.length} · 卡 ${state.cards.length} · 方案 ${state.protocols.length} · OCR ${state.ocrs.length}。<strong>不含你主实例的历史记录。</strong>`;
  $("#topic-body").innerHTML = t
    ? `<p><strong>${esc(t.name)}</strong></p><p class="hint">${esc(t.researchQuestion)}</p>
       <ul class="subq">${state.subquestions.filter((s) => s.topicId === t.id).map((s) => `<li class="${s.kind}">${esc(s.question)} <span class="badge ${s.kind === "exploratory" ? "warn" : "confirm"}">${s.kind === "exploratory" ? "探索性" : "已声明"}</span></li>`).join("")}</ul>`
    : '<p class="hint warn">尚无课题：先运行 node scripts/acceptance-seed.ts &lt;数据文件&gt;</p>';
  $("#mat-grid").innerHTML = MATS.map((m) => {
    const { a, badge } = statusOf(m);
    return `<div class="card matcard" id="mat-${m.key}">
      <h2 style="font-size:var(--text)">${esc(m.title)} ${badge}</h2>
      <div class="src">${esc(m.path)} · ${esc(m.src)}</div>
      <div class="acts">
        <button class="primary" id="up-${m.key}" ${a ? "disabled" : ""}>${m.act}</button>
        <button id="dup-${m.key}" ${a ? "" : "disabled"}>再传一次（验 409 拒重）</button>
        <button id="prev-${m.key}">预览原件</button>
        ${a ? '<a href="/" style="font-size:var(--text-sm)">主界面继续 →</a>' : ""}
      </div>
      <div id="prevbox-${m.key}"></div>
      <div class="out" id="out-${m.key}">${a ? `<span class="ok">${esc(m.summary(state, a))}</span>` : ""}</div>
    </div>`;
  }).join("");
  for (const m of MATS) {
    $(`#up-${m.key}`).onclick = () => upload(m, false);
    $(`#dup-${m.key}`).onclick = () => upload(m, true);
    $(`#prev-${m.key}`).onclick = () => preview(m);
  }
}

async function contentOf(m) {
  const r = await fetch(m.file);
  if (!r.ok) throw new Error(`样本文件缺失：${m.file}`);
  if (m.kind === "image") {
    const blob = await r.blob();
    return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
  }
  return await r.text();
}

async function upload(m, isDup) {
  const btn = $(`#up-${m.key}`); const dbtn = $(`#dup-${m.key}`);
  btn.disabled = dbtn.disabled = true;
  out(m.key, "上传中…（调用真实导入函数）");
  try {
    const content = await contentOf(m);
    const { status, j } = m.run ? await m.run(content, topicId) : await api(m.route, m.body(content, topicId));
    if (status === 409) {
      out(m.key, `<span class="${isDup ? "ok" : "err"}">409 拒重：${esc(j.error)}${j.existingAssetId ? ` <code>${esc(j.existingAssetId)}</code>` : ""}${isDup ? "（预期行为：指向已有原件，不产生重复）" : ""}</span>`);
    } else if (status >= 400) {
      out(m.key, `<span class="err">${status}：${esc(j.error)}</span>`);
    } else {
      await load();
      const a = state.assets.find((x) => x.name === m.name);
      out(m.key, `<span class="ok">构建完成：${esc(m.summary(state, a))}</span>`);
      return;
    }
  } catch (e) {
    out(m.key, `<span class="err">${esc(e.message)}</span>`);
  }
  btn.disabled = !!statusOf(m).a; dbtn.disabled = !statusOf(m).a;
}

async function preview(m) {
  const box = $(`#prevbox-${m.key}`);
  if (box.innerHTML) { box.innerHTML = ""; return; }
  if (m.kind === "image") { box.innerHTML = `<img class="prev" src="${m.file}" alt="手写实验记录（网络来源）">`; return; }
  const text = await contentOf(m).catch((e) => { box.innerHTML = `<span class="err" style="color:var(--danger)">${esc(e.message)}</span>`; return null; });
  if (text === null) return;
  const lines = text.split("\n");
  box.innerHTML = `<pre class="prev">${esc(lines.slice(0, 30).join("\n"))}${lines.length > 30 ? `\n…（共 ${lines.length} 行，预览前 30 行）` : ""}</pre>`;
}

async function load() {
  state = await (await fetch("/api/state")).json();
  if (!Array.isArray(state.topics)) throw new Error(`/api/state 返回异常：${JSON.stringify(state).slice(0, 120)}`);
  render();
}

function fatal(msg) {
  $("#envnote").innerHTML = `<span style="color:var(--danger)"><strong>无法加载验收环境：</strong>${esc(msg)}</span><br>请通过服务打开 <code>http://127.0.0.1:5180/acceptance.html</code>（直接双击 HTML 文件走 file://，调不到后端 TS 函数）。服务未启动时：<code>cd sciworkbench && PORT=5180 LOCUS_DATA=data/acceptance.json node server.ts</code>`;
  $("#topic-body").innerHTML = '<span class="hint warn">环境未连接，见上方提示。</span>';
}

if (location.protocol === "file:") {
  fatal("当前以 file:// 直开 HTML 文件，浏览器无法请求后端接口。");
} else {
  try {
    await load();
    const ai = await (await fetch("/api/ai/status")).json();
    $("#envnote").innerHTML += ai.configured
      ? ` AI 已配置（${esc(ai.model)}）：上传构建不依赖 AI；解析/识别可在主界面发起。`
      : " AI 未配置：上传构建走草稿/原图归档路径，不冒充 AI；如需 AI 解析/识别请在主界面配置。";
  } catch (e) {
    fatal(e.message ?? String(e));
  }
}