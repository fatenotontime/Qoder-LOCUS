/**
 * LOCUS 最小 Web 闭环 — 零依赖本地服务（v2）。
 * 运行：node server.ts   （默认 http://127.0.0.1:5173）
 * AI 配置：启动时从环境变量读取，仅进程内存（见 services/ai.ts）。绝不写入文件/日志/Git。
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JsonFileStore, type LocusState, type Store } from "./store.ts";
import { AiError, clearAiConfig, describeConfig, getAiConfig, setAiConfig } from "./services/ai.ts";
import {
  AppError,
  createSubquestion,
  createTopic,
  importLiterature,
  importMeasurements,
  reviewCard,
  reviewTable,
  sourceView,
} from "./services/app.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(HERE, "public");
const DATA_PATH = process.env.LOCUS_DATA ?? join(HERE, "data", "state.json");
const AUDIT_DIR = join(dirname(DATA_PATH), "audit");
const PORT = Number(process.env.PORT ?? process.argv[2] ?? 5173);
const MAX_BODY = 8 * 1024 * 1024;

/** 审计：留存模型原始响应（不含认证头）；写入数据区，不入 Git。失败不阻断主流程。 */
function writeAudit(assetId: string, audit: { raws: { index: number; content: string }[]; model: string }): void {
  try {
    mkdirSync(AUDIT_DIR, { recursive: true });
    writeFileSync(join(AUDIT_DIR, `${assetId}.json`), JSON.stringify({ assetId, at: new Date().toISOString(), task: "literature_extract", model: audit.model, raws: audit.raws }, null, 2), "utf8");
  } catch {
    /* 审计失败不影响导入结果 */
  }
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export interface Job {
  id: string;
  status: "running" | "done" | "error";
  done: number;
  total: number;
  message: string;
  result?: { assetId: string; created: number };
  error?: string;
}

export async function createApp(store: Store) {
  let state: LocusState = await store.load();
  const jobs = new Map<string, Job>();
  const trimJobs = () => { if (jobs.size > 20) { for (const k of jobs.keys()) { if (jobs.size <= 20) break; jobs.delete(k); } } };

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
      if (method === "GET" && path === "/api/ai/status") { send(res, 200, describeConfig(getAiConfig())); return; }
      if (method === "GET" && path.startsWith("/api/jobs/")) {
        const job = jobs.get(decodeURIComponent(path.slice("/api/jobs/".length)));
        if (!job) { send(res, 404, { error: "任务不存在" }); return; }
        send(res, 200, job);
        return;
      }
      if (method === "DELETE" && path === "/api/ai/config") { clearAiConfig(); send(res, 200, describeConfig(getAiConfig())); return; }
      if (method === "GET" && path.startsWith("/api/source/")) {
        send(res, 200, sourceView(state, decodeURIComponent(path.slice("/api/source/".length))));
        return;
      }

      if (method === "POST") {
        const raw = await readBody(req);
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};

        if (path === "/api/ai/config") {
          const ok = setAiConfig({ baseUrl: body.baseUrl, model: body.model, key: body.key });
          if (!ok) { send(res, 400, { error: "AI 配置不完整：需要 baseUrl / model / key（仅进程内存，不落盘）。" }); return; }
          send(res, 200, describeConfig(getAiConfig()));
          return;
        }
        if (path === "/api/topics") {
          const r = createTopic(state, { name: String(body.name ?? ""), researchQuestion: String(body.researchQuestion ?? "") });
          state = r.state; await store.save(state);
          send(res, 200, { ok: true, topicId: r.topic.id });
          return;
        }
        const subMatch = path.match(/^\/api\/topics\/([^/]+)\/subquestions$/);
        if (subMatch) {
          const r = createSubquestion(state, { topicId: decodeURIComponent(subMatch[1]), question: String(body.question ?? ""), kind: body.kind as "declared" | "exploratory" | undefined });
          state = r.state; await store.save(state);
          send(res, 200, { ok: true, subquestionId: r.subquestion.id });
          return;
        }
        if (path === "/api/import/literature") {
          const mode = (body.mode as "draft" | "ai") ?? "draft";
          const input = { name: String(body.name ?? ""), text: String(body.text ?? ""), mode, topicId: body.topicId as string | undefined };
          if (mode === "ai") {
            const id = `job_${randomUUID()}`;
            const job: Job = { id, status: "running", done: 0, total: 0, message: "处理中…" };
            jobs.set(id, job); trimJobs();
            void (async () => {
              try {
                const r = await importLiterature(state, input, getAiConfig(), (done, total) => { job.done = done; job.total = total; job.message = `第 ${done}/${total} 块`; });
                state = r.state; await store.save(state);
                if (r.audit) writeAudit(r.asset.id, r.audit);
                job.status = "done"; job.result = { assetId: r.asset.id, created: r.created }; job.message = "完成";
              } catch (e) { job.status = "error"; job.error = (e as Error).message ?? "失败"; }
            })();
            send(res, 202, { ok: true, jobId: id });
            return;
          }
          const r = await importLiterature(state, input, getAiConfig());
          state = r.state; await store.save(state);
          send(res, 200, { ok: true, created: r.created, assetId: r.asset.id, mode: "draft" });
          return;
        }
        if (path === "/api/import/measurements") {
          const hr = body.headerRows;
          const r = importMeasurements(state, { name: String(body.name ?? ""), csv: String(body.csv ?? ""), topicId: body.topicId as string | undefined, headerRows: hr === 1 || hr === 2 ? hr : "auto" });
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

// 仅在被直接运行时才监听（被 import 时不产生副作用，便于测试）。
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const store = new JsonFileStore(DATA_PATH);
  const app = await createApp(store);
  app.listen(PORT, "127.0.0.1", () => {
    const d = describeConfig(getAiConfig());
    console.log(`LOCUS dev server: http://127.0.0.1:${PORT}  (data: ${DATA_PATH})`);
    console.log(`AI: ${d.configured ? `已配置 model=${d.model} @ ${d.baseUrl}` : "未配置（在网页「AI 配置」里填写即可；仅进程内存）"}`);
  });
}
