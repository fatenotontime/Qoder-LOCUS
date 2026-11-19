/**
 * 逐页渲染文本检查（验收用）：对七个入口真实渲染后扫描可见文本，
 * 断言不含 ISO 时间 / 英文枚举 / 裸版本 / 原始报错 / 文档路径 / （全部课题）。
 * 用法：node scripts/frontend-text-check.ts [BASE]   （默认 http://127.0.0.1:5187）
 * 依赖：本机 Edge（headless）。仅用于本地/CI 核对，不改产品。
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync, readFileSync } from "node:fs";
import { existsSync } from "node:fs";

const BASE = process.argv[2] ?? "http://127.0.0.1:5187";
const EDGE = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"].find(existsSync);
if (!EDGE) { console.error("未找到 Edge。"); process.exit(2); }

const FORBIDDEN: [RegExp, string][] = [
  [/\d{4}-\d{2}-\d{2}T/, "ISO 时间"],
  [/unreviewed|declared|exploratory|ai-draft|reconstructed|rev \d|fetch failed|docs\/stage/, "英文枚举/裸版本/原始报错/文档路径"],
  [/（全部课题）/, "旧「全部课题」下拉"],
];
const strip = (h: string) => h
  .replace(/<script[\s\S]*?<\/script>/g, " ")
  .replace(/<pre class="perr-detail-body"[\s\S]*?<\/pre>/g, " ")
  .replace(/<[^>]*>/g, " ")
  .replace(/&[a-z]+;/g, " ")
  .replace(/\s+/g, " ");

const runEdge = (url: string, profile: string) => spawnSync(EDGE, ["--headless=new", "--disable-gpu", "--no-sandbox", `--user-data-dir=${profile}`, "--virtual-time-budget=6000", "--dump-dom", url], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout ?? "";

(async () => {
  const state = await (await fetch(`${BASE}/api/state`)).json() as any;
  const ids: Record<string, string> = {
    topicId: state.topics[0]?.id ?? "", paperId: state.papers[0]?.id ?? "",
    protocolId: state.protocols[0]?.id ?? "", executionId: state.executions[0]?.id ?? "",
    taskId: state.analysisTasks[0]?.id ?? "", chatId: state.chats[0]?.id ?? "",
  };
  const navs = ["topic", "papers", "knowledge", "protocol", "record", "analysis", "chat"];
  let failed = 0;
  for (const nav of navs) {
    const profile = `${process.env.TEMP ?? "/tmp"}/locustext-${nav}-${Date.now()}`;
    const harness = `public/_check-${nav}.html`;
    writeFileSync(harness, `<!doctype html><meta charset="utf-8"><title>set</title><script>try{localStorage.setItem('locus.ui.v2', JSON.stringify({nav:"${nav}",topicId:"${ids.topicId}",paperId:"${ids.paperId}",protocolId:"${ids.protocolId}",executionId:"${ids.executionId}",taskId:"${ids.taskId}",chatId:"${ids.chatId}"}));}catch(e){}</script>`);
    try {
      runEdge(`${BASE}/_check-${nav}.html`, profile);
      const dom = runEdge(`${BASE}/`, profile);
      const text = strip(dom);
      const hits: string[] = [];
      for (const [re, label] of FORBIDDEN) { const m = text.match(re); if (m) hits.push(`${label} → 「${m[0]}」`); }
      // 确认真渲染（避免 app.js 报错时静默误判为通过）
      if (dom.length < 500 || !dom.includes("navitem") || /id="status">连接中/.test(dom)) hits.push("页面疑似未渲染（应用未启动/JS 报错）");
      if (hits.length) { failed++; console.log(`✗ ${nav}: ${hits.join("；")}`); } else { console.log(`✓ ${nav}`); }
    } finally {
      rmSync(harness, { force: true });
      rmSync(profile, { recursive: true, force: true });
    }
  }
  console.log(failed ? `\n${failed} 个入口存在禁用文本。` : "\n全部入口通过。");
  process.exit(failed ? 1 : 0);
})();
