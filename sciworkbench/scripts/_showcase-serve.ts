import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const PORT = Number(process.argv[2] ?? 5190);
const FRAG = process.argv[3] ?? "C:/Users/PC/.qoder/app/chat-session-visualizations/78293572-535c-41d2-b712-648c689a94b1/visualizations/locus-frontend-showcase.html";

if (!existsSync(FRAG)) {
  const r = spawnSync(process.execPath, ["scripts/_build-showcase.ts"], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

createServer((req, res) => {
  if (!existsSync(FRAG)) { res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }); res.end("fragment missing"); return; }
  const frag = readFileSync(FRAG, "utf8");
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>研迹 LOCUS · 前端改版展示（本地验收）</title><style>html,body{margin:0;padding:0}</style></head><body>${frag}</body></html>`;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(html);
}).listen(PORT, "127.0.0.1", () => console.log(`showcase at http://127.0.0.1:${PORT}/`));