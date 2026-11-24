// 本地静态预览服务：直接托管 build-web.mjs 生成的发布目录，用于在发布到 Qoder Site 之前
// 用「与线上同一份生成物」做本地验收。纯静态，不接 Node 业务后端；/api/* 未命中即 404，
// 公开展示模式下应由 B 的读路径适配兜住，联调阶段会表现为页面「读取失败」兜底。
// 用法：node locus-site/dev/preview-server.mjs [dir] [port]
//   [dir]  默认 <locus-site>/web（build-web.mjs 默认产物）
//   [port] 默认 5191，绑定 127.0.0.1
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.argv[2] ?? join(HERE, "..", "web"));
const PORT = Number(process.argv[3] ?? 5191);

if (!existsSync(join(ROOT, "index.html"))) {
  console.error(`预览目录缺少 index.html：${ROOT}\n先运行：node locus-site/build-web.mjs sciworkbench/public`);
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".zip": "application/zip",
};

function safeJoin(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split("?")[0].split("#")[0]));
  const rel = clean.replace(/^(\.\.[/\\])+/, "");
  return join(ROOT, rel);
}

async function respond(req, res) {
  let p = safeJoin(req.url === "/" ? "/index.html" : req.url);
  if (!p.startsWith(ROOT)) { res.writeHead(403); res.end("forbidden"); return; }
  try {
    let s = await stat(p);
    if (s.isDirectory()) { p = join(p, "index.html"); s = await stat(p); }
    const body = await readFile(p);
    res.writeHead(200, {
      "Content-Type": MIME[extname(p).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end(`404 ${req.url}`);
  }
}

const server = createServer((req, res) => { respond(req, res).catch(() => { res.writeHead(500); res.end("error"); }); });
server.listen(PORT, "127.0.0.1", () => {
  console.log(`静态预览：http://127.0.0.1:${PORT}/  →  ${ROOT}`);
});
