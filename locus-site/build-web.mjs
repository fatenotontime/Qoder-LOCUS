// 由 LOCUS 前端 public/ 生成 Site 的 web/ 静态目录，并注入 /api/* → Site 函数的 shim。
// 用法：node build-web.mjs <publicDir> [outDir] [--mode=trial|public]
//   <publicDir> 例：F:/Qoder dev competition/sciworkbench/public
//   [outDir]   默认本目录下的 web/
//   --mode=trial   线上试玩/既有发布：注入 shim（默认，行为不变）
//   --mode=public  静态公开展示：落地页=演示页，打包 demo-data/demo/settings，剥离冷色素材与自测件
import { cpSync, existsSync, readFileSync, writeFileSync, copyFileSync, rmSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));

// ── 参数与构建模式 ──────────────────────────────────────────
const argv = process.argv.slice(2);
const modeArg = argv.find((a) => a.startsWith("--mode="));
const MODE = (modeArg ? modeArg.split("=")[1] : (argv.includes("--public") ? "public" : "trial"));
if (MODE !== "trial" && MODE !== "public") {
  console.error(`未知构建模式：${MODE}（仅支持 trial | public）`);
  process.exit(1);
}
const positional = argv.filter((a) => !a.startsWith("--"));
const pub = resolve(positional[0] ?? "");
const out = resolve(positional[1] ?? join(HERE, "web"));

if (!existsSync(join(pub, "index.html"))) {
  console.error("用法: node build-web.mjs <publicDir> [outDir] [--mode=trial|public]（publicDir 需含 index.html）");
  process.exit(1);
}

// ── 1) 生成 web/ 基础（前端整份拷贝 + shim） ────────────────
rmSync(out, { recursive: true, force: true });
cpSync(pub, out, { recursive: true });
copyFileSync(join(HERE, "web-overlay", "site-shim.js"), join(out, "site-shim.js"));

let html = readFileSync(join(out, "index.html"), "utf8");
if (!html.includes("site-shim.js")) {
  const injected = html.replace(/<\/head>/i, `  <script src="/site-shim.js"></script>\n</head>`);
  if (!injected.includes("site-shim.js")) { console.error("未能注入 shim：index.html 缺 </head>"); process.exit(1); }
  html = injected;
}

// ── 2) 公开展示模式 ─────────────────────────────────────────
const ZIP_URL = "/demo-data/locus-demo-public.zip";
let demoSummary = "";
if (MODE === "public") {
  // 2a) demo-data：只发布展示必需文件；tools/ 与私有生成输入一律不进入公开包。
  const src = join(HERE, "demo-data");
  const dst = join(out, "demo-data");
  if (!existsSync(join(src, "snapshot", "manifest.json"))) {
    console.error("public 模式需要 locus-site/demo-data（缺 snapshot/manifest.json）");
    process.exit(1);
  }
  cpSync(join(src, "snapshot"), join(dst, "snapshot"), { recursive: true });
  cpSync(join(src, "originals"), join(dst, "originals"), { recursive: true });
  for (const f of ["fixture.json", "SHA256SUMS.txt", "locus-demo-public.zip"]) {
    const from = join(src, f);
    if (!existsSync(from)) { console.error(`public 模式缺文件：demo-data/${f}`); process.exit(1); }
    copyFileSync(from, join(dst, f));
  }
  // 校验：ZIP 字节 SHA-256 与 A 的 SHA256SUMS.txt 一致（生成物不变）。
  const sums = readFileSync(join(src, "SHA256SUMS.txt"), "utf8").split("\n");
  const line = sums.find((l) => l.trim().endsWith("locus-demo-public.zip"));
  const expected = line ? line.trim().split(/\s+/)[0] : "";
  const zipHash = createHash("sha256").update(readFileSync(join(dst, "locus-demo-public.zip"))).digest("hex");
  if (!expected || zipHash !== expected) {
    console.error(`ZIP SHA-256 不一致：生成物 ${zipHash} ≠ 清单 ${expected || "(缺失)"}`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(join(dst, "snapshot", "manifest.json"), "utf8"));

  // 2b) demo 展示模块：只发布运行必需文件，剔除 README/READ_PATHS/dev-serve/tests/fixture。
  const demoOut = join(out, "demo");
  cpSync(join(HERE, "web-overlay", "demo"), demoOut, { recursive: true });
  for (const rel of ["README.md", "READ_PATHS.md", "dev-serve.mjs"]) rmSync(join(demoOut, rel), { force: true });
  rmSync(join(demoOut, "tests"), { recursive: true, force: true });
  rmSync(join(demoOut, "fixture"), { recursive: true, force: true });

  // 2c) settings 折扇：只发布 settings-fan.js / settings-fan.css。
  const setOut = join(out, "settings");
  mkdirSync(setOut, { recursive: true });
  copyFileSync(join(HERE, "web-overlay", "settings", "settings-fan.js"), join(setOut, "settings-fan.js"));
  copyFileSync(join(HERE, "web-overlay", "settings", "settings-fan.css"), join(setOut, "settings-fan.css"));

  // 2d) 把设置折扇挂到演示页：head 加 CSS link，body 末加静态入口 + module 脚本。
  const demoHtmlPath = join(demoOut, "demo.html");
  let demoHtml = readFileSync(demoHtmlPath, "utf8");
  if (!demoHtml.includes("settings-fan.css")) {
    demoHtml = demoHtml.replace(/<\/head>/i, `  <link rel="stylesheet" href="/settings/settings-fan.css" />\n</head>`);
  }
  const entry =
    `\n  <button id="settings-open" class="modelbtn" type="button" style="position:fixed;left:16px;bottom:16px;z-index:60" aria-haspopup="dialog" aria-controls="settings-fan" aria-expanded="false">设置 <span class="hint" id="ai-state">预生成</span></button>\n` +
    `  <script type="module" src="/settings/settings-fan.js"></script>\n`;
  if (!demoHtml.includes("settings-fan.js")) {
    demoHtml = demoHtml.replace(/<\/body>/i, `${entry}</body>`);
  }
  writeFileSync(demoHtmlPath, demoHtml);

  // 2e) 落地页 = 演示页（评委匿名打开 Site 直达暖色预置课题，无需后端）。
  html = `<!doctype html>
<html lang="zh-CN" data-theme="paper">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="0; url=/demo/demo.html" />
  <title>LOCUS · 公开展示</title>
  <script>location.replace("/demo/demo.html");</script>
</head>
<body>
  <noscript>请打开 <a href="/demo/demo.html">LOCUS 公开展示</a>。</noscript>
</body>
</html>
`;

  demoSummary = `demo-data 已打包：manifest.sourceCommit=${manifest.sourceCommit} · projectId=${manifest.projectId} · fixture=${manifest.fixtureVersion} · ZIP sha256=${zipHash.slice(0, 16)}…；demo/ + settings/ 已接入，落地页→/demo/demo.html`;
}

writeFileSync(join(out, "index.html"), html);
console.log(`web/ 已生成：${out}（mode=${MODE}；注入 site-shim.js）`);
if (demoSummary) console.log(`  ${demoSummary}`);
