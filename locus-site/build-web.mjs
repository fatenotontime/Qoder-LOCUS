// 由 LOCUS 前端 public/ 生成 Site 的 web/ 静态目录，并注入 /api/* → Site 函数的 shim。
// 用法：node build-web.mjs <publicDir> [outDir]
//   <publicDir> 例：F:/Qoder dev competition/sciworkbench/public
//   [outDir]   默认本目录下的 web/
import { cpSync, existsSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const pub = resolve(process.argv[2] ?? "");
const out = resolve(process.argv[3] ?? join(HERE, "web"));

if (!existsSync(join(pub, "index.html"))) {
  console.error("用法: node build-web.mjs <publicDir> [outDir]（publicDir 需含 index.html）");
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
cpSync(pub, out, { recursive: true });
copyFileSync(join(HERE, "web-overlay", "site-shim.js"), join(out, "site-shim.js"));

let html = readFileSync(join(out, "index.html"), "utf8");
if (!html.includes("site-shim.js")) {
  const injected = html.replace(/<\/head>/i, `  <script src="/site-shim.js"></script>\n</head>`);
  if (!injected.includes("site-shim.js")) { console.error("未能注入 shim：index.html 缺 </head>"); process.exit(1); }
  html = injected;
}
// 竞赛页面：静态收掉「AI 配置」入口（模型固定，避免评委打开必然失败的表单）。
const before = html;
html = html.replace(/<button[^>]*\bdata-open-ai\b[^>]*>[\s\S]*?<\/button>\s*/i, "");
if (html === before) console.warn("提示：未找到 data-open-ai 入口（可能已改动）；依赖 shim 的 CSS 兜底。");
writeFileSync(join(out, "index.html"), html);
console.log(`web/ 已生成：${out}（注入 site-shim.js；已收掉 AI 配置入口）`);