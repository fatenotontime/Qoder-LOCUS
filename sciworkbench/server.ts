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
  addManualCard,
  batchConfirm,
  batchPreview,
  createComparison,
  createMapping,
  createSubquestion,
  createTopic,
  importLiterature,
  importMeasurements,
  reviewCard,
  reviewTable,
  sourceView,
  upsertAdoption,
} from "./services/app.ts";
import {
  addManualOcr,
  addMeasurement,
  addSampleState,
  appendEvent,
  completeExecution,
  confirmOcr,
  confirmTemplate,
  createProtocol,
  createSample,
  createTemplate,
  editEvent,
  editMeasurement,
  editProtocol,
  importImage,
  pauseAssist,
  pauseExecution,
  protocolDraftFromAi,
  registerImpact,
  renameSample,
  resumeExecution,
  runImpactAssessment,
  runOcr,
  startExecution,
  templateProtocolCheck,
} from "./services/experiment.ts";
import { runTask } from "./services/ai.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(HERE, "public");
const DATA_PATH = process.env.LOCUS_DATA ?? join(HERE, "data", "state.json");
const AUDIT_DIR = join(dirname(DATA_PATH), "audit");
const PORT = Number(process.env.PORT ?? process.argv[2] ?? 5173);
const MAX_BODY = 8 * 1024 * 1024;

/** 审计：留存模型原始响应（不含认证头）；写入数据区，不入 Git。失败不阻断主流程。 */
function writeAudit(assetId: string, audit: { raws: { index: number; content: string }[]; model: string }, task = "literature_extract"): void {
  try {
    mkdirSync(AUDIT_DIR, { recursive: true });
    writeFileSync(join(AUDIT_DIR, `${assetId}.json`), JSON.stringify({ assetId, at: new Date().toISOString(), task, model: audit.model, raws: audit.raws }, null, 2), "utf8");
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
  result?: { assetId?: string; created?: number; reminder?: boolean; protocolId?: string; impactId?: string; ocrIds?: string[]; discarded?: boolean };
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
      const tmplCheck = path.match(/^\/api\/templates\/([^/]+)\/check$/);
      if (method === "GET" && tmplCheck) {
        send(res, 200, templateProtocolCheck(state, decodeURIComponent(tmplCheck[1])));
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
                job.status = "done"; job.result = { assetId: r.asset.id, created: r.created, reminder: r.reminder }; job.message = "完成";
              } catch (e) { job.status = "error"; job.error = (e as Error).message ?? "失败"; }
            })();
            send(res, 202, { ok: true, jobId: id });
            return;
          }
          const r = await importLiterature(state, input, getAiConfig());
          state = r.state; await store.save(state);
          send(res, 200, { ok: true, created: r.created, assetId: r.asset.id, mode: "draft", reminder: r.reminder });
          return;
        }
        if (path === "/api/import/measurements") {
          const hr = body.headerRows;
          const pf = body.profile;
          const r = importMeasurements(state, { name: String(body.name ?? ""), csv: String(body.csv ?? ""), topicId: body.topicId as string | undefined, headerRows: hr === 1 || hr === 2 ? hr : "auto", profile: pf === "plain-table" || pf === "enzymeML-blocks" ? pf : "auto" });
          state = r.state; await store.save(state);
          send(res, 200, { ok: true, created: r.created, tableCount: state.tables.filter((t) => t.assetId === r.asset.id).length, assetId: r.asset.id });
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
            secondaryCitation: body.secondaryCitation as boolean | undefined,
            extracted: body.extracted as never,
          });
          await store.save(state); send(res, 200, { ok: true }); return;
        }
        if (path === "/api/cards") {
          const r = addManualCard(state, {
            assetId: String(body.assetId ?? ""),
            rawText: String(body.rawText ?? ""),
            sectionQuote: body.sectionQuote as string | undefined,
            fields: body.fields as Record<string, string> | undefined,
            units: body.units as string[] | undefined,
            conditions: body.conditions as string[] | undefined,
            unknowns: body.unknowns as string[] | undefined,
            secondaryCitation: body.secondaryCitation === true,
            reason: body.reason as string | undefined,
          });
          state = r.state; await store.save(state);
          send(res, 200, { ok: true, cardId: r.card.id }); return;
        }
        if (path === "/api/cards/batch-preview") {
          send(res, 200, batchPreview(state, (body.ids as string[]) ?? [])); return;
        }
        if (path === "/api/cards/batch-confirm") {
          state = batchConfirm(state, (body.ids as string[]) ?? [], body.ack === true);
          await store.save(state); send(res, 200, { ok: true }); return;
        }
        if (path === "/api/adoptions") {
          const r = upsertAdoption(state, {
            cardId: String(body.cardId ?? ""),
            subquestionId: String(body.subquestionId ?? ""),
            decision: body.decision as "adopt" | "exclude",
            reason: body.reason as string | undefined,
          });
          state = r.state; await store.save(state);
          send(res, 200, { ok: true, adoptionId: r.adoption.id }); return;
        }
        if (path === "/api/mappings") {
          const r = createMapping(state, {
            original: String(body.original ?? ""),
            mapped: String(body.mapped ?? ""),
            basis: String(body.basis ?? ""),
            topicId: body.topicId as string | undefined,
          });
          state = r.state; await store.save(state);
          send(res, 200, { ok: true, mappingId: r.mapping.id }); return;
        }
        if (path === "/api/comparisons") {
          const r = createComparison(state, {
            topicId: String(body.topicId ?? ""),
            subquestionId: body.subquestionId as string | undefined,
            cardIds: (body.cardIds as string[]) ?? [],
            filters: body.filters as string[] | undefined,
            conversions: body.conversions as string[] | undefined,
            exclusions: body.exclusions as string[] | undefined,
            note: body.note as string | undefined,
          });
          state = r.state; await store.save(state);
          send(res, 200, { ok: true, comparisonId: r.comparison.id }); return;
        }
        const tblMatch = path.match(/^\/api\/tables\/([^/]+)\/review$/);
        if (tblMatch) {
          const tableId = decodeURIComponent(tblMatch[1]);
          const before = state.tables.find((t) => t.id === tableId);
          state = reviewTable(state, tableId, {
            columnUpdates: body.columnUpdates as never,
            cellUpdates: body.cellUpdates as never,
            note: body.note as string | undefined,
            reason: body.reason as string | undefined,
          });
          const after = state.tables.find((t) => t.id === tableId);
          // 表格数值修订 → 登记影响分析（确定性部分无；AI 语义评估待跑）。课题经原件取。
          const tableTopic = after ? state.assets.find((a) => a.id === after.assetId)?.topicId : undefined;
          if (before && after && after.revision > before.revision && tableTopic) {
            state = registerImpact(state, {
              topicId: tableTopic,
              change: { entityKind: "table", entityId: tableId, revision: after.revision, summary: `表格修订 r${after.revision}` },
              aiConfigured: getAiConfig() !== null,
            }).state;
          }
          await store.save(state); send(res, 200, { ok: true }); return;
        }

        // ── 4C：方案 / 模板 / 执行 / 样品 / 测量 / 影响 / OCR ──
        if (path === "/api/protocols") {
          const r = createProtocol(state, {
            topicId: String(body.topicId ?? ""),
            name: String(body.name ?? ""),
            sourceKind: body.sourceKind as "user" | "reconstructed" | "ai-draft" | undefined,
            sourceAssetId: body.sourceAssetId as string | undefined,
            purpose: body.purpose as string | undefined,
            inputs: body.inputs as string[] | undefined,
            steps: (body.steps as never[]) ?? [],
            conditions: body.conditions as string[] | undefined,
            criteria: body.criteria as string | undefined,
            unknowns: body.unknowns as string[] | undefined,
            sourceFragments: body.sourceFragments as string[] | undefined,
          });
          state = r.state; await store.save(state);
          send(res, 200, { ok: true, protocolId: r.protocol.id }); return;
        }
        if (path === "/api/protocols/parse") {
          const cfg = getAiConfig();
          if (!cfg) { send(res, 422, { error: "AI 未配置：无法解析方案。可先手工创建方案。" }); return; }
          const assetId = String(body.assetId ?? "");
          const asset = state.assets.find((a) => a.id === assetId);
          if (!asset) { send(res, 404, { error: `原件不存在：${assetId}` }); return; }
          const topicId = String(body.topicId ?? asset.topicId ?? "");
          const name = String(body.name ?? `${asset.name} · 方案草稿`);
          const id = `job_${randomUUID()}`;
          const job: Job = { id, status: "running", done: 0, total: 1, message: "方案解析中…" };
          jobs.set(id, job); trimJobs();
          void (async () => {
            try {
              const { value, raw } = await runTask(cfg, "protocol_parse", asset.text.slice(0, 12000));
              const draft = protocolDraftFromAi(value, assetId);
              const r = createProtocol(state, { topicId, name, sourceKind: "ai-draft", sourceAssetId: assetId, ...draft });
              state = r.state; await store.save(state);
              writeAudit(assetId, { raws: [{ index: 0, content: raw }], model: cfg.model }, "protocol_parse");
              job.status = "done"; job.result = { protocolId: r.protocol.id, assetId }; job.message = "完成";
            } catch (e) { job.status = "error"; job.error = (e as Error).message ?? "失败"; }
          })();
          send(res, 202, { ok: true, jobId: id }); return;
        }
        const protoEdit = path.match(/^\/api\/protocols\/([^/]+)\/edit$/);
        if (protoEdit) {
          const r = editProtocol(state, decodeURIComponent(protoEdit[1]), {
            name: body.name as string | undefined,
            purpose: body.purpose as string | undefined,
            inputs: body.inputs as string[] | undefined,
            steps: body.steps as never,
            conditions: body.conditions as string[] | undefined,
            criteria: body.criteria as string | undefined,
            unknowns: body.unknowns as string[] | undefined,
            sourceFragments: body.sourceFragments as string[] | undefined,
            reason: String(body.reason ?? ""),
          });
          state = r.state; await store.save(state);
          send(res, 200, { ok: true, revision: r.protocol.revision }); return;
        }
        if (path === "/api/templates") {
          const r = createTemplate(state, {
            protocolId: String(body.protocolId ?? ""),
            protocolRevision: typeof body.protocolRevision === "number" ? body.protocolRevision : undefined,
            fields: body.fields as string[] | undefined,
            aiDraft: body.aiDraft === true,
          });
          state = r.state; await store.save(state);
          send(res, 200, { ok: true, templateId: r.template.id }); return;
        }
        const tmplConfirm = path.match(/^\/api\/templates\/([^/]+)\/confirm$/);
        if (tmplConfirm) {
          const r = confirmTemplate(state, decodeURIComponent(tmplConfirm[1]), body.fields as string[] | undefined);
          state = r.state; await store.save(state);
          send(res, 200, { ok: true }); return;
        }
        if (path === "/api/executions") {
          const r = startExecution(state, {
            topicId: String(body.topicId ?? ""),
            protocolId: String(body.protocolId ?? ""),
            protocolRevision: typeof body.protocolRevision === "number" ? body.protocolRevision : undefined,
            templateId: body.templateId as string | undefined,
          });
          state = r.state; await store.save(state);
          send(res, 200, { ok: true, executionId: r.execution.id }); return;
        }
        const execEvents = path.match(/^\/api\/executions\/([^/]+)\/events$/);
        if (execEvents) {
          const r = appendEvent(state, decodeURIComponent(execEvents[1]), {
            kind: body.kind as never,
            stepId: body.stepId as string | undefined,
            text: body.text as string | undefined,
            actual: body.actual as never,
            at: body.at as string | undefined,
            backfilled: body.backfilled === true,
          });
          state = r.state; await store.save(state);
          send(res, 200, { ok: true, eventId: r.execution.events[r.execution.events.length - 1].id }); return;
        }
        const evEdit = path.match(/^\/api\/executions\/([^/]+)\/events\/([^/]+)\/edit$/);
        if (evEdit) {
          const r = editEvent(state, decodeURIComponent(evEdit[1]), decodeURIComponent(evEdit[2]), {
            text: body.text as string | undefined,
            actual: body.actual as never,
            reason: body.reason as string | undefined,
          });
          state = r.state; await store.save(state);
          send(res, 200, { ok: true }); return;
        }
        const execPauseAssist = path.match(/^\/api\/executions\/([^/]+)\/pause-assist$/);
        if (execPauseAssist) {
          const cfg = getAiConfig();
          if (!cfg) { send(res, 422, { error: "AI 未配置：无法给出暂停建议。可直接人工暂停。" }); return; }
          const r = await pauseAssist(cfg, state, decodeURIComponent(execPauseAssist[1]));
          send(res, 200, r); return;
        }
        const execPause = path.match(/^\/api\/executions\/([^/]+)\/pause$/);
        if (execPause) {
          const r = pauseExecution(state, decodeURIComponent(execPause[1]), {
            reason: String(body.reason ?? ""),
            risks: body.risks as string[] | undefined,
            resumeChecks: body.resumeChecks as string[] | undefined,
            aiSuggested: body.aiSuggested === true,
          });
          state = r.state; await store.save(state);
          send(res, 200, { ok: true }); return;
        }
        const execResume = path.match(/^\/api\/executions\/([^/]+)\/resume$/);
        if (execResume) {
          const r = resumeExecution(state, decodeURIComponent(execResume[1]), String(body.humanDecision ?? ""));
          state = r.state; await store.save(state);
          send(res, 200, { ok: true }); return;
        }
        const execDone = path.match(/^\/api\/executions\/([^/]+)\/done$/);
        if (execDone) {
          const r = completeExecution(state, decodeURIComponent(execDone[1]));
          state = r.state; await store.save(state);
          send(res, 200, { ok: true }); return;
        }
        if (path === "/api/samples") {
          const r = createSample(state, {
            topicId: String(body.topicId ?? ""),
            executionId: body.executionId as string | undefined,
            shortName: String(body.shortName ?? ""),
            displayName: body.displayName as string | undefined,
            origin: body.origin as "user" | "public" | undefined,
            amount: (body.amount as never) ?? { value: "", unit: "" },
            handling: body.handling as string | undefined,
            use: body.use as string | undefined,
            note: body.note as string | undefined,
          });
          state = r.state; await store.save(state);
          send(res, 200, { ok: true, sampleId: r.sample.id }); return;
        }
        const smpStates = path.match(/^\/api\/samples\/([^/]+)\/states$/);
        if (smpStates) {
          const r = addSampleState(state, decodeURIComponent(smpStates[1]), {
            amount: (body.amount as never) ?? { value: "", unit: "" },
            handling: body.handling as string | undefined,
            use: body.use as string | undefined,
            note: body.note as string | undefined,
          });
          state = r.state; await store.save(state);
          send(res, 200, { ok: true, revision: r.sample.states.length }); return;
        }
        const smpRename = path.match(/^\/api\/samples\/([^/]+)\/rename$/);
        if (smpRename) {
          const r = renameSample(state, decodeURIComponent(smpRename[1]), String(body.displayName ?? ""));
          state = r.state; await store.save(state);
          send(res, 200, { ok: true }); return;
        }
        if (path === "/api/measurements") {
          const r = addMeasurement(state, {
            topicId: String(body.topicId ?? ""),
            sampleId: String(body.sampleId ?? ""),
            sampleStateRevision: typeof body.sampleStateRevision === "number" ? body.sampleStateRevision : undefined,
            time: body.time as string | undefined,
            method: body.method as string | undefined,
            instrument: body.instrument as string | undefined,
            value: String(body.value ?? ""),
            unit: body.unit as string | undefined,
            cellRef: body.cellRef as never,
            note: body.note as string | undefined,
          });
          state = r.state; await store.save(state);
          send(res, 200, { ok: true, measurementId: r.measurement.id }); return;
        }
        const measEdit = path.match(/^\/api\/measurements\/([^/]+)\/edit$/);
        if (measEdit) {
          const r = editMeasurement(state, decodeURIComponent(measEdit[1]), {
            value: body.value as string | undefined,
            unit: body.unit as string | undefined,
            method: body.method as string | undefined,
            instrument: body.instrument as string | undefined,
            note: body.note as string | undefined,
            reason: body.reason as string | undefined,
          });
          state = r.state; await store.save(state);
          send(res, 200, { ok: true }); return;
        }
        const impRun = path.match(/^\/api\/impacts\/([^/]+)\/run$/);
        if (impRun) {
          const cfg = getAiConfig();
          if (!cfg) { send(res, 422, { error: "AI 未配置：语义影响无法评估（这不等于“无影响”）。" }); return; }
          const impactId = decodeURIComponent(impRun[1]);
          if (!state.impacts.some((i) => i.id === impactId)) { send(res, 404, { error: `影响分析不存在：${impactId}` }); return; }
          const id = `job_${randomUUID()}`;
          const job: Job = { id, status: "running", done: 0, total: 1, message: "影响评估中…" };
          jobs.set(id, job); trimJobs();
          void (async () => {
            try {
              const r = await runImpactAssessment(async () => state, async (s) => { state = s; await store.save(s); }, impactId, cfg);
              job.status = "done";
              job.result = { impactId, discarded: r.discarded };
              job.message = r.ok ? "完成" : r.discarded ? "已有更新改动，旧评估结果已丢弃（stale 守卫）" : `失败：${r.error}`;
              if (!r.ok && !r.discarded) { job.status = "error"; job.error = r.error; }
            } catch (e) { job.status = "error"; job.error = (e as Error).message ?? "失败"; }
          })();
          send(res, 202, { ok: true, jobId: id }); return;
        }
        if (path === "/api/import/image") {
          const r = importImage(state, { name: String(body.name ?? ""), dataUrl: String(body.dataUrl ?? ""), topicId: body.topicId as string | undefined });
          state = r.state; await store.save(state);
          send(res, 200, { ok: true, assetId: r.asset.id }); return;
        }
        if (path === "/api/ocr") {
          const cfg = getAiConfig();
          if (!cfg) { send(res, 422, { error: "AI 未配置：无法识别。可用人工转录兜底（标 manual）。" }); return; }
          const assetId = String(body.assetId ?? "");
          const asset = state.assets.find((a) => a.id === assetId);
          if (!asset) { send(res, 404, { error: `原件不存在：${assetId}` }); return; }
          const id = `job_${randomUUID()}`;
          const job: Job = { id, status: "running", done: 0, total: 1, message: "识别中…" };
          jobs.set(id, job); trimJobs();
          void (async () => {
            try {
              const r = await runOcr(cfg, asset);
              state = { ...state, ocrs: [...state.ocrs, ...r.ocrs] };
              await store.save(state);
              writeAudit(assetId, { raws: [{ index: 0, content: r.raw }], model: r.model }, "handwriting_ocr");
              job.status = "done"; job.result = { assetId, created: r.ocrs.length, ocrIds: r.ocrs.map((o) => o.id) }; job.message = "完成";
            } catch (e) { job.status = "error"; job.error = (e as Error).message ?? "失败"; }
          })();
          send(res, 202, { ok: true, jobId: id }); return;
        }
        if (path === "/api/ocr/manual") {
          const r = addManualOcr(state, String(body.assetId ?? ""), {
            rawText: String(body.rawText ?? ""),
            fields: body.fields as Record<string, string> | undefined,
            unknowns: body.unknowns as string[] | undefined,
          });
          state = r.state; await store.save(state);
          send(res, 200, { ok: true, ocrId: r.ocr.id }); return;
        }
        const ocrConfirm = path.match(/^\/api\/ocr\/([^/]+)\/confirm$/);
        if (ocrConfirm) {
          const r = confirmOcr(state, decodeURIComponent(ocrConfirm[1]), {
            rawText: body.rawText as string | undefined,
            fields: body.fields as Record<string, string> | undefined,
            unknowns: body.unknowns as string[] | undefined,
            reason: body.reason as string | undefined,
          });
          state = r.state; await store.save(state);
          send(res, 200, { ok: true }); return;
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
