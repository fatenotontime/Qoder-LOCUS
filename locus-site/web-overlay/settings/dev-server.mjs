// 开发自测用双根静态服务（非发布物）：
//   /settings/*  → 本目录（设置组件与预览页）
//   其余         → sciworkbench/public（真实样式与素材）
// 用法：node dev-server.mjs <publicDir> [port]
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const PUBLIC = resolve(process.argv[2] ?? join(HERE, "../../../sciworkbench/public"));
const PORT = Number(process.argv[3] ?? 8781);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function safeJoin(root, rel) {
  const full = resolve(root, "." + rel);
  return full === root || full.startsWith(root + sep) ? full : null;
}

const server = http.createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (path === "/") path = "/settings/preview.html";
    const isSettings = path.startsWith("/settings/");
    const root = isSettings ? HERE : PUBLIC;
    const rel = isSettings ? path.slice("/settings".length) : path;
    const file = safeJoin(root, rel);
    if (!file || !(await stat(file)).isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("404");
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(await readFile(file));
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("500 " + e.message);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`settings preview: http://127.0.0.1:${PORT}/settings/preview.html`);
  console.log(`public root: ${PUBLIC}`);
});
