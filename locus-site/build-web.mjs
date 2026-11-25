// 由 LOCUS 前端 public/ 生成 Site 的 web/ 静态目录，并注入 /api/* → Site 函数的 shim。
// 用法：node build-web.mjs <publicDir> [outDir] [--mode=trial|public]
//   <publicDir> 例：F:/Qoder dev competition/sciworkbench/public
//   [outDir]   默认本目录下的 web/
//   --mode=trial   线上试玩/既有发布：注入 shim（默认，行为不变）
//   --mode=public  公开展示：打包 demo-data，并把设置折扇作为新增入口挂到既有首页（不改首页结构与既有入口）
import { cpSync, existsSync, readFileSync, writeFileSync, copyFileSync, rmSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));

// 构建版本：显式 --version= 优先，否则取 git 短提交；供设置「关于」显示。
let BUILD_COMMIT = "";
try { BUILD_COMMIT = execSync("git rev-parse --short HEAD", { cwd: HERE, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { /* 非 git 环境忽略 */ }
const verArg = process.argv.find((a) => a.startsWith("--version="));
const BUILD_VERSION = verArg ? verArg.split("=")[1] : (BUILD_COMMIT ? `s08-public-${BUILD_COMMIT}` : "s08-public");

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

// ── 1b) 文献库嵌入视图：trial 与 public 两种模式都发布运行必需文件到 web/library/
//      只复制运行必需文件；tests/ 与夹具不进入产物。
{
  const libSrc = join(HERE, "web-overlay", "library");
  const libOut = join(out, "library");
  mkdirSync(libOut, { recursive: true });
  for (const f of ["library-view.js", "library-view.css", "a-snapshot.js", "snapshot-adapter.js"]) {
    copyFileSync(join(libSrc, f), join(libOut, f));
  }
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

  // 2b) settings 折扇：只发布 settings-fan.js / settings-fan.css（新增入口，不改既有界面）。
  const setOut = join(out, "settings");
  mkdirSync(setOut, { recursive: true });
  copyFileSync(join(HERE, "web-overlay", "settings", "settings-fan.js"), join(setOut, "settings-fan.js"));
  copyFileSync(join(HERE, "web-overlay", "settings", "settings-fan.css"), join(setOut, "settings-fan.css"));

  // 2c) 把设置折扇挂到既有首页：head 加 CSS link + 构建版本注入，body 末加静态入口 + module 脚本。
  //     不改首页结构、不删既有入口；模型状态读取既有 #ai-state。
  if (!html.includes("locus-build-version")) {
    const buildMeta =
      `  <meta name="locus-build-version" content="${BUILD_VERSION}" />\n` +
      `  <script>window.__LOCUS_BUILD__=${JSON.stringify({ version: BUILD_VERSION, commit: BUILD_COMMIT })};</script>\n`;
    html = html.replace(/<\/head>/i, `${buildMeta}</head>`);
  }
  if (!html.includes("settings-fan.css")) {
    html = html.replace(/<\/head>/i, `  <link rel="stylesheet" href="/settings/settings-fan.css" />\n</head>`);
  }
  const entry =
    `\n  <button id="settings-open" class="modelbtn" type="button" style="position:fixed;left:16px;bottom:16px;z-index:60" aria-haspopup="dialog" aria-controls="settings-fan" aria-expanded="false">设置</button>\n` +
    `  <script type="module" src="/settings/settings-fan.js"></script>\n`;
  if (!html.includes("settings-fan.js")) {
    html = html.replace(/<\/body>/i, `${entry}</body>`);
  }

  demoSummary = `demo-data 已打包：manifest.sourceCommit=${manifest.sourceCommit} · projectId=${manifest.projectId} · fixture=${manifest.fixtureVersion} · ZIP sha256=${zipHash.slice(0, 16)}…；settings/ 已作为新增入口挂到既有首页`;
}

writeFileSync(join(out, "index.html"), html);
console.log(`web/ 已生成：${out}（mode=${MODE}；注入 site-shim.js）`);
if (demoSummary) console.log(`  ${demoSummary}`);
