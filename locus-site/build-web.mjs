// 由 LOCUS 前端 public/ 生成 Site 的 web/ 静态目录，并注入 /api/* → Site 函数的 shim。
// 用法：node build-web.mjs <publicDir> [outDir] [--mode=trial|public]
//   <publicDir> 例：F:/Qoder dev competition/sciworkbench/public
//   [outDir]   默认本目录下的 web/
//   --mode=trial   线上试玩/既有发布：注入 shim、收掉 AI 配置入口（默认，行为不变）
//   --mode=public  静态公开展示：额外打包 demo-data/、失败页改为可离线下载样本 ZIP
import { cpSync, existsSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
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
// 竞赛页面：静态收掉「AI 配置」入口（模型固定，避免评委打开必然失败的表单）。
const before = html;
html = html.replace(/<button[^>]*\bdata-open-ai\b[^>]*>[\s\S]*?<\/button>\s*/i, "");
if (html === before) console.warn("提示：未找到 data-open-ai 入口（可能已改动）；依赖 shim 的 CSS 兜底。");

// ── 2) 公开展示模式：打包 demo-data、失败页改可下载 ZIP ─────
const ZIP_URL = "/demo-data/locus-demo-public.zip";
let demoSummary = "";
if (MODE === "public") {
  const src = join(HERE, "demo-data");
  const dst = join(out, "demo-data");
  if (!existsSync(join(src, "snapshot", "manifest.json"))) {
    console.error("public 模式需要 locus-site/demo-data（缺 snapshot/manifest.json）");
    process.exit(1);
  }
  // 只发布展示必需文件；tools/ 与私有生成输入一律不进入公开包。
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
  // 记录 manifest 一致性（sourceCommit / projectId / fixtureVersion）。
  const manifest = JSON.parse(readFileSync(join(dst, "snapshot", "manifest.json"), "utf8"));
  demoSummary = `demo-data 已打包：manifest.sourceCommit=${manifest.sourceCommit} · projectId=${manifest.projectId} · fixture=${manifest.fixtureVersion} · ZIP sha256=${zipHash.slice(0, 16)}…`;

  // 失败页（静态资源未加载兜底）：公开展示版不提示“跑服务端”，改为可离线下载样本 ZIP。
  const warnOld = /<p>这个页面必须由[\s\S]*?<\/p>\s*<p>不要直接双击[\s\S]*?<\/p>/;
  if (warnOld.test(html)) {
    html = html.replace(
      warnOld,
      `<p>这是 LOCUS 公开展示版，演示主线无需联网或服务端即可完成。</p>
      <p>若界面未能加载，可直接下载样本包离线查看：<a href="${ZIP_URL}" download>下载样本 ZIP</a>。</p>`
    );
  } else {
    console.warn("提示：未匹配到 #boot-warn 开发提示文案，失败页下载入口未改写（页面数据层失败入口由 app.js bootFailure 兜底）。");
  }
  // 标记公开展示模式，供前端失败页读取 ZIP 入口。
  html = html.replace(/<html\b([^>]*)>/i, (m, attrs) => `<html${attrs} data-locus-mode="public" data-demo-zip="${ZIP_URL}">`);
}

writeFileSync(join(out, "index.html"), html);
console.log(`web/ 已生成：${out}（mode=${MODE}；注入 site-shim.js；已收掉 AI 配置入口）`);
if (demoSummary) console.log(`  ${demoSummary}`);
