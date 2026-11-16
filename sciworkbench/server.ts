/**
 * LOCUS 最小 Web 闭环 — 零依赖本地服务（v2）。
 * 运行：node server.ts   （默认 http://127.0.0.1:5173）
 * AI 配置：启动时从环境变量读取，仅进程内存（见 services/ai.ts）。绝不写入文件/日志/Git。
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JsonFileStore, type LocusState, type Store } from "./store.ts";
import { aiConfigFromEnv, AiError, describeConfig } from "./services/ai.ts";
import {
  AppError,
  importLiterature,
  importMeasurements,
  reviewCard,
  reviewTable,
  sourceView,
} from "./services/app.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(HERE, "public");
const DATA_PATH = process.env.LOCUS_DATA ?? join(HERE, "data", "state.json");
const PORT = Number(process.env.PORT ?? process.argv[2] ?? 5173);
const MAX_BODY = 8 * 1024 * 1024;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export async function createApp(store: Store, ai = aiConfigFromEnv()) {
  let state: LocusState = await store.load();

  const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((res, rej) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) { rej(new AppError(413, "请求体过大。")); req.destroy(); return; }
        chunks.push(c);
      });
      req.on("end", () => res(Buffer.concat(chunks).toString("utf8")));
      req.on("error", rej);
    });

  const send = (res: ServerResponse, status: number, body: unknown, type = "application/json; charset=utf-8") => {
    const payload = type.startsWith("application/json") ? JSON.stringify(body) : (body as string);
    res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
    res.end(payload);
  };

  const serveStatic = (res: ServerResponse, urlPath: string) => {
    const rel = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath.replace(/^\/+/, ""));
    const target = resolve(PUBLIC_DIR, normalize(rel));
    if (!target.startsWith(PUBLIC_DIR) || !existsSync(target) || !statSync(target).isFile()) {
      send(res, 404, "Not Found", "text/plain; charset=utf-8");
      return;
    }
    send(res, 200, readFileSync(target), MIME[extname(target)] ?? "application/octet-stream");
  };

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      const path = url.pathname;
      const method = req.method ?? "GET";

      if (!path.startsWith("/api/")) { serveStatic(res, path); return; }

      if (method === "GET" && path === "/api/state") { send(res, 200, state); return; }
      if (method === "GET" && path === "/api/ai/status") { send(res, 200, describeConfig(ai)); return; }
      if (method === "GET" && path.startsWith("/api/source/")) {
        send(res, 200, sourceView(state, decodeURIComponent(path.slice("/api/source/".length))));
        return;
      }

      if (method === "POST") {
        const raw = await readBody(req);
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};

        if (path === "/api/import/literature") {
          const r = await importLiterature(state, { name: String(body.name ?? ""), text: String(body.text ?? ""), mode: (body.mode as "draft" | "ai") ?? "draft" }, ai);
          state = r.state; await store.save(state);
          send(res, 200, { ok: true, created: r.created, assetId: r.asset.id, mode: body.mode ?? "draft" });
          return;
        }
        if (path === "/api/import/measurements") {
          const r = importMeasurements(state, { name: String(body.name ?? ""), csv: String(body.csv ?? "") });
          state = r.state; await store.save(state);
          send(res, 200, { ok: true, created: r.created, assetId: r.asset.id });
          return;
        }
        const cardMatch = path.match(/^\/api\/cards\/([^/]+)\/review$/);
        if (cardMatch) {
          state = reviewCard(state, decodeURIComponent(cardMatch[1]), {
            audit: body.audit as never,
            importance: (body.importance ?? undefined) as never,
            note: body.note as string | undefined,
            reason: body.reason as string | undefined,
            rawText: body.rawText as string | undefined,
          });
          await store.save(state); send(res, 200, { ok: true }); return;
        }
        const tblMatch = path.match(/^\/api\/tables\/([^/]+)\/review$/);
        if (tblMatch) {
          state = reviewTable(state, decodeURIComponent(tblMatch[1]), {
            columnUpdates: body.columnUpdates as never,
            cellUpdates: body.cellUpdates as never,
            note: body.note as string | undefined,
            reason: body.reason as string | undefined,
          });
          await store.save(state); send(res, 200, { ok: true }); return;
        }
      }

      send(res, 404, { error: "未知接口" });
    } catch (err) {
      if (err instanceof AiError) send(res, 502, { error: err.message });
      else if (err instanceof AppError) send(res, err.status, { error: err.message });
      else if (err instanceof SyntaxError) send(res, 400, { error: "JSON 解析失败" });
      else send(res, 500, { error: (err as Error).message ?? "内部错误" });
    }
  });
}

const store = new JsonFileStore(DATA_PATH);
const app = await createApp(store);
app.listen(PORT, "127.0.0.1", () => {
  const d = describeConfig(aiConfigFromEnv());
  console.log(`LOCUS dev server: http://127.0.0.1:${PORT}  (data: ${DATA_PATH})`);
  console.log(`AI: ${d.configured ? `已配置 model=${d.model} @ ${d.baseUrl}` : "未配置（导入将用 draft 模式）"}`);
});
