import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync, existsSync } from "node:fs";

const BASE = "http://127.0.0.1:5173";
const OUT = "C:/Users/PC/AppData/Local/Temp/locus-showcase";
const EDGE = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"].find(existsSync);
if (!EDGE) { console.error("no edge"); process.exit(2); }

const state = await (await fetch(`${BASE}/api/state`)).json();
const ids = {
  topicId: state.topics[0].id, paperId: state.papers[0].id,
  protocolId: state.protocols[0].id,
  executionId: state.executions.find(e => e.origin === "reconstructed").id,
  taskId: state.analysisTasks[0].id, reportId: state.reports[0].id,
  chatId: state.chats[0]?.id ?? "",
};
const dayKey = (() => { const d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); })();

const shots = [
  { name: "01-splash", splash: true, budget: 6000 },
  { name: "02-topic-paper", seed: { nav: "topic" }, theme: "paper" },
  { name: "03-topic-tech", seed: { nav: "topic" }, theme: "tech" },
  { name: "04-record-paper", seed: { nav: "record" }, theme: "paper" },
  { name: "05-analysis-paper", seed: { nav: "analysis" }, theme: "paper" },
  { name: "06-knowledge-paper", seed: { nav: "knowledge" }, theme: "paper" },
  { name: "07-protocol-tech", seed: { nav: "protocol" }, theme: "tech" },
];

const waitFile = (p, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (existsSync(p)) return true; spawnSync("sleep", ["0.3"]); } return existsSync(p); };

for (const s of shots) {
  const profile = `${OUT}/pf-${s.name}-${Date.now()}`;
  rmSync(`${OUT}/${s.name}.png`, { force: true });
  const harness = `public/_shot-${s.name}.html`;
  let seed = "";
  if (!s.splash) {
    const ui = { ...ids, ...(s.seed ?? {}) };
    seed = `localStorage.setItem('locus.ui.v2', JSON.stringify(${JSON.stringify(ui)}));localStorage.setItem('locus.splash.v1', '${dayKey}');localStorage.setItem('locus.theme.v1', '${s.theme}');`;
  }
  const after = s.splash ? `document.getElementById('f').addEventListener('load',()=>{setTimeout(()=>{try{document.getElementById('f').contentWindow.__locusSplash.seek(4600);}catch(e){document.title='ERR'+e.message;}},900);});` : "";
  writeFileSync(harness, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%}</style><script>try{${seed}}catch(e){}</script><iframe id="f" src="/"></iframe><script>${after}</script>`);
  spawnSync(EDGE, ["--headless=new", "--disable-gpu", "--no-sandbox", `--user-data-dir=${profile}`, "--hide-scrollbars", "--window-size=1440,900", `--virtual-time-budget=${s.budget ?? 9000}`, `--screenshot=${OUT}/${s.name}.png`, `${BASE}/_shot-${s.name}.html`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const ok = waitFile(`${OUT}/${s.name}.png`);
  spawnSync("sleep", ["1.5"]);
  rmSync(harness, { force: true });
  console.log(s.name, ok ? "OK" : "FAIL");
}