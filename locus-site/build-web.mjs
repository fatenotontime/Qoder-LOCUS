// 由 LOCUS 前端 public/ 生成 Site 的 web/ 静态目录，并注入 /api/* → Site 函数的 shim。
// 用法：node build-web.mjs <publicDir> [outDir] [--mode=trial|public]
//   <publicDir> 例：F:/Qoder dev competition/sciworkbench/public
//   [outDir]   默认本目录下的 web/
//   --mode=trial   线上试玩/既有发布：注入 shim（默认，行为不变）
//   --mode=public  公开展示：打包 demo-data，注入展示配置（app.js 展示模式接线），把设置折扇作为新增入口挂到既有首页（不改首页结构与既有入口）；
//                  旧 /demo/demo.html 改为跳转兼容页（进入原工作台展示模式，不再渲染独立 demo-app.js）
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

// ── 1c) 设置折扇：接到普通静态源——trial 与 public 两种模式都发布并注入（新增入口，不改既有界面）。
//      仅当存在 window.__LOCUS_DISPLAY__ 时固定暖色；trial/常规态沿用各自已保存主题（见 settings-fan.js）。
{
  const setSrc = join(HERE, "web-overlay", "settings");
  const setOut = join(out, "settings");
  mkdirSync(setOut, { recursive: true });
  copyFileSync(join(setSrc, "settings-fan.js"), join(setOut, "settings-fan.js"));
  copyFileSync(join(setSrc, "settings-fan.css"), join(setOut, "settings-fan.css"));

  if (!html.includes("locus-build-version")) {
    const buildMeta =
      `  <meta name="locus-build-version" content="${BUILD_VERSION}" />\n` +
      `  <script>window.__LOCUS_BUILD__=${JSON.stringify({ version: BUILD_VERSION, commit: BUILD_COMMIT })};</script>\n`;
    html = html.replace(/<\/head>/i, `${buildMeta}</head>`);
  }
  if (!html.includes("settings-fan.css")) {
    html = html.replace(/<\/head>/i, `  <link rel="stylesheet" href="/settings/settings-fan.css" />\n</head>`);
  }
  if (!html.includes("settings-fan.js")) {
    html = html.replace(/<\/body>/i, `\n  <script type="module" src="/settings/settings-fan.js"></script>\n</body>`);
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

  // 2b) 旧展示链接兼容页（/demo/demo.html）：只做跳转，进入原工作台的展示模式。
  //     不再复制 demo-app.js / demo.css，也不再渲染独立 demo 页面；
  //     但保留数据层模块 a-snapshot.js / snapshot-adapter.js（供 /display/display-api.js import）。
  const demoOut = join(out, "demo");
  mkdirSync(demoOut, { recursive: true });
  for (const f of ["a-snapshot.js", "snapshot-adapter.js"]) {
    const from = join(HERE, "web-overlay", "demo", f);
    if (existsSync(from)) copyFileSync(from, join(demoOut, f));
    else console.warn(`  [warn] public 模式缺 web-overlay/demo/${f}（展示适配器依赖）`);
  }
  const compatHtml = `<!doctype html>
<html lang="zh-CN" data-theme="paper">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="0; url=/" />
  <link rel="canonical" href="/" />
  <meta name="locus-build-version" content="${BUILD_VERSION}" />
  <title>LOCUS · 展示模式</title>
</head>
<body>
  <p>正在进入 LOCUS 工作台展示模式…如未自动跳转，请<a href="/">点此进入</a>。</p>
  <script>location.replace("/");</script>
</body>
</html>
`;
  writeFileSync(join(demoOut, "demo.html"), compatHtml);

  // 2c) settings 折扇：已在 1c 统一发布并注入（trial 与 public 共用）。

  // 2d) 展示适配器（B 交付）：复制 /display 运行必需文件，供 app.js 动态 import。
  const dispSrc = join(HERE, "web-overlay", "display");
  const dispOut = join(out, "display");
  if (existsSync(join(dispSrc, "display-api.js"))) {
    cpSync(dispSrc, dispOut, { recursive: true });
    for (const rel of ["README.md", "READ_PATHS.md", "dev-serve.mjs", "dev-server.mjs"]) rmSync(join(dispOut, rel), { force: true });
    rmSync(join(dispOut, "tests"), { recursive: true, force: true });
    rmSync(join(dispOut, "fixture"), { recursive: true, force: true });
  } else {
    console.warn("  [warn] public 模式缺 web-overlay/display/display-api.js：展示适配器未打包（B 交付后重跑构建）");
  }

  // 2e) 设置折扇的注入已在 1c 完成（build 版本 meta、CSS link、module 脚本）。
  // 2e-2) 展示增量叠加层（S10-C）：CSS link + module 脚本，自举，不改首页结构。仅公开展示构建注入。
  if (!html.includes("display-extras.css")) {
    html = html.replace(/<\/head>/i, `  <link rel="stylesheet" href="/display/display-extras.css" />\n</head>`);
  }
  if (!html.includes("display-extras.js")) {
    html = html.replace(/<\/body>/i, `\n  <script type="module" src="/display/display-extras.js"></script>\n</body>`);
  }
  // 2f) 注入展示配置：app.js 在首次 getState 前读取；topicId 取快照 projectId，避免写死。
  //     仅在存在 __LOCUS_DISPLAY__ 时 app.js 才进入展示模式；trial 不注入，行为不变。
  if (!html.includes("__LOCUS_DISPLAY__")) {
    const displayCfg = {
      baseUrl: "/demo-data",
      zipUrl: ZIP_URL,
      topicId: manifest.projectId,
      label: "展示课题 · 只读",
    };
    html = html.replace(/<\/head>/i, `  <script>window.__LOCUS_DISPLAY__=${JSON.stringify(displayCfg)};</script>\n</head>`);
  }

  demoSummary = `demo-data 已打包：manifest.sourceCommit=${manifest.sourceCommit} · projectId=${manifest.projectId} · fixture=${manifest.fixtureVersion} · ZIP sha256=${zipHash.slice(0, 16)}…；展示配置已注入首页（app.js 展示模式）；settings/ 已作为新增入口挂到既有首页；/demo/demo.html 已改为跳转兼容页`;

  // 2g) 展示增量（S10-C）：校验图形/贯通链/导出文件存在且类型正确；挂接展示增强叠加层。
  {
    const errs = [];
    const needJson = (rel, check) => {
      const p = join(dst, rel);
      if (!existsSync(p)) { errs.push(`缺 demo-data/${rel}`); return null; }
      try { const j = JSON.parse(readFileSync(p, "utf8")); const m = check?.(j); if (m) errs.push(`demo-data/${rel} ${m}`); return j; }
      catch (e) { errs.push(`demo-data/${rel} 解析失败：${e.message}`); return null; }
    };
    needJson("snapshot/figures.json", (j) => (j.protocolFigures && Object.keys(j.protocolFigures).length ? "" : "缺 protocolFigures"));
    needJson("snapshot/chain-90d.json", (j) => (Array.isArray(j.hops) && j.hops.length ? "" : "缺 hops"));
    const pk = (rel, wantName) => {
      const p = join(dst, rel);
      if (!existsSync(p)) { errs.push(`缺 demo-data/${rel}`); return; }
      const b = readFileSync(p);
      if (b.length < 4 || b.readUInt32LE(0) !== 0x04034b50) errs.push(`demo-data/${rel} 非 ZIP/OOXML（PK 头缺失）`);
      if (wantName) {
        let eocd = -1; for (let i = b.length - 22; i >= 0; i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
        if (eocd < 0) { errs.push(`demo-data/${rel} 无 EOCD`); return; }
        const total = b.readUInt16LE(eocd + 10); let off = b.readUInt32LE(eocd + 16); const names = [];
        for (let i = 0; i < total; i++) { if (b.readUInt32LE(off) !== 0x02014b50) break; const n = b.readUInt16LE(off + 28); names.push(b.slice(off + 46, off + 46 + n).toString("utf8")); off += 46 + n + b.readUInt16LE(off + 30) + b.readUInt16LE(off + 32); }
        if (!names.includes(wantName)) errs.push(`demo-data/${rel} 缺条目 ${wantName}`);
      }
    };
    pk("snapshot/exports/report.docx");
    pk("snapshot/exports/traceability.zip", "report.docx");
    if (errs.length) { console.error("展示增量校验失败：\n  " + errs.join("\n  ")); process.exit(1); }
  }
}

writeFileSync(join(out, "index.html"), html);
console.log(`web/ 已生成：${out}（mode=${MODE}；注入 site-shim.js）`);
if (demoSummary) console.log(`  ${demoSummary}`);
