/**
 * LOCUS 最小 Web 闭环 — 零依赖本地服务。
 * 运行：node server.ts   （默认 http://127.0.0.1:5173）
 * 存储：JsonFileStore（data/state.json），可替换（见 store.ts）。
 * 本文件即“前端协作接口”的落地：REST + 静态托管。
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JsonFileStore, type LocusState, type Store } from "./store.ts";
import {
  AppError,
  importLiterature,
  importMeasurements,
  reviewCard,
  reviewMeasurement,
  sourceView,
} from "./services/app.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(HERE, "public");
const DATA_PATH = process.env.LOCUS_DATA ?? join(HERE, "data", "state.json");
const PORT = Number(process.env.PORT ?? process.argv[2] ?? 5173);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const MAX_BODY = 2 * 1024 * 1024;

export async function createApp(store: Store) {
  let state: LocusState = await store.load();

  async function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolveBody, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new AppError(413, "请求体过大。"));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }

  function send(res: ServerResponse, status: number, body: unknown, type = "application/json; charset=utf-8") {
    const payload = type.startsWith("application/json") ? JSON.stringify(body) : (body as string);
    res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
    res.end(payload);
  }

  function serveStatic(res: ServerResponse, urlPath: string) {
    const rel = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath.replace(/^\/+/, ""));
    const target = resolve(PUBLIC_DIR, normalize(rel));
    if (!target.startsWith(PUBLIC_DIR) || !existsSync(target) || !statSync(target).isFile()) {
      send(res, 404, "Not Found", "text/plain; charset=utf-8");
      return;
    }
    send(res, 200, readFileSync(target), MIME[extname(target)] ?? "application/octet-stream");
  }

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      const path = url.pathname;
      const method = req.method ?? "GET";

      if (!path.startsWith("/api/")) {
        serveStatic(res, path);
        return;
      }

      if (method === "GET" && path === "/api/state") {
        send(res, 200, state);
        return;
      }

      if (method === "GET" && path.startsWith("/api/source/")) {
        const assetId = decodeURIComponent(path.slice("/api/source/".length));
        send(res, 200, sourceView(state, assetId));
        return;
      }

      if (method === "POST") {
        const raw = await readBody(req);
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};

        if (path === "/api/import/literature") {
          const r = importLiterature(state, { name: String(body.name ?? ""), text: String(body.text ?? "") });
          state = r.state;
          await store.save(state);
          send(res, 200, { ok: true, created: r.created, assetId: r.asset.id, count: r.created });
          return;
        }
        if (path === "/api/import/measurements") {
          const r = importMeasurements(state, { name: String(body.name ?? ""), csv: String(body.csv ?? "") });
          state = r.state;
          await store.save(state);
          send(res, 200, { ok: true, created: r.created, assetId: r.asset.id, count: r.created });
          return;
        }
        const cardMatch = path.match(/^\/api\/cards\/([^/]+)\/review$/);
        if (cardMatch) {
          state = reviewCard(state, decodeURIComponent(cardMatch[1]), {
            audit: body.audit as never,
            importance: (body.importance ?? undefined) as never,
            note: body.note as string | undefined,
            reason: body.reason as string | undefined,
            keyValueChanged: body.keyValueChanged as boolean | undefined,
          });
          await store.save(state);
          send(res, 200, { ok: true });
          return;
        }
        const measMatch = path.match(/^\/api\/measurements\/([^/]+)\/review$/);
        if (measMatch) {
          state = reviewMeasurement(state, decodeURIComponent(measMatch[1]), {
            value: body.value as string | undefined,
            unit: body.unit as string | undefined,
            decision: body.decision as never,
            note: body.note as string | undefined,
            reason: body.reason as string | undefined,
          });
          await store.save(state);
          send(res, 200, { ok: true });
          return;
        }
      }

      send(res, 404, { error: "未知接口" });
    } catch (err) {
      if (err instanceof AppError) send(res, err.status, { error: err.message });
      else if (err instanceof SyntaxError) send(res, 400, { error: "JSON 解析失败" });
      else send(res, 500, { error: (err as Error).message ?? "内部错误" });
    }
  });
}

const store = new JsonFileStore(DATA_PATH);
const app = await createApp(store);
app.listen(PORT, "127.0.0.1", () => {
  console.log(`LOCUS dev server: http://127.0.0.1:${PORT}  (data: ${DATA_PATH})`);
});
