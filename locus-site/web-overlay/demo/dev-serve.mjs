// 本地静态自测服务（仅开发用，不进发布包）。
// 组成虚拟站点：/demo/* ← 本目录；/demo-data/* ← ./fixture；其余 ← sciworkbench/public（styles.css、lib/*）。
// 用法：node locus-site/web-overlay/demo/dev-serve.mjs [port]
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const PUBLIC = resolve(HERE, "../../../sciworkbench/public");
const DEMO_DATA = resolve(HERE, "../../demo-data");
const PORT = Number(process.argv[2] ?? 8787);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};

function pick(pathname) {
  if (pathname === "/" ) return join(HERE, "demo.html");
  if (pathname === "/demo" || pathname === "/demo/") return join(HERE, "demo.html");
  if (pathname.startsWith("/demo/")) return safeJoin(HERE, pathname.slice("/demo/".length));
  if (pathname.startsWith("/demo-data/")) return safeJoin(DEMO_DATA, pathname.slice("/demo-data/".length));
  if (pathname.startsWith("/demo-fixture/")) return safeJoin(join(HERE, "fixture"), pathname.slice("/demo-fixture/".length));
  return safeJoin(PUBLIC, pathname.replace(/^\/+/, ""));
}
function safeJoin(base, rel) {
  const p = resolve(base, normalize(rel));
  if (p !== base && !p.startsWith(base + sep)) return null;
  return p;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    const file = pick(decodeURIComponent(url.pathname));
    if (!file) { res.writeHead(403).end("Forbidden"); return; }
    const s = await stat(file).catch(() => null);
    if (!s || !s.isFile()) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not Found"); return; }
    const buf = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(buf);
  } catch (e) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" }).end(String(e));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`demo 自测站点：http://127.0.0.1:${PORT}/demo/demo.html`);
  console.log(`正式数据：http://127.0.0.1:${PORT}/demo-data/snapshot/state.json（A 正式包）`);
});
