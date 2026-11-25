/**
 * 公开展示模式 · 数据读取适配器（B 交付，S09-T18）。
 *
 * 目标：让**原工作台**（`sciworkbench/public/app.js`）在公开展示构建里，
 * 用与在线 `lib/api.js` 相同的读接口，从 Site 托管的静态快照读数据并进入只读模式。
 *
 * 约束：
 * - 只读。不提供任何写方法；每个方法都不请求 `/api/...`。
 * - 数据来源只有一个：A 的静态快照（`locus-site/demo-data/`）。缺项抛 `DemoMissingError`，不补造。
 * - 复用 `../demo/a-snapshot.js`（多文件装载）与 `../demo/snapshot-adapter.js`（只读适配器）；
 *   不引入 `demo-app.js` 的整页外壳，只用数据层。
 *
 * 接线（D 负责）：在 `app.js` 第一次 `api.getState()` 之前，用 `createDisplayApi` 产出的只读 api
 * 替换在线 api；配置从构建注入的 `window.__LOCUS_DISPLAY__` 读（见 README「D 接线参数」）。
 */
import { loadASnapshot } from "../demo/a-snapshot.js";
import { createDemoData, DemoMissingError } from "../demo/snapshot-adapter.js";

const DEFAULT_BASE_URL = "../demo-data";

/** 读取构建注入的展示配置；无则返回 null。解析失败不抛，返回 null。 */
export function displayConfig(win = typeof window !== "undefined" ? window : undefined) {
  const raw = win?.__LOCUS_DISPLAY__;
  if (raw == null) return null;
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function deepFreeze(o) {
  if (!o || typeof o !== "object" || Object.isFrozen(o)) return o;
  Object.freeze(o);
  for (const k of Object.keys(o)) deepFreeze(o[k]);
  return o;
}

/**
 * 把适配器的 backtrace 结果补齐成 `GET /api/backtrace` 的响应形态：
 * `{ ok, start, nodes, edges, downstreamByKind, pending }`（见 server.ts:524、references.ts:336）。
 * 纯投影：downstreamByKind 按 edges 的 edgeKind 归组；pending 取自节点自带的 pending / gap。
 */
function backtraceResponse(r) {
  const byKey = new Map(r.nodes.map((n) => [n.key ?? `${n.kind}:${n.id}`, n]));
  const downstreamByKind = {};
  for (const e of r.edges) {
    const to = byKey.get(e.to);
    if (to) (downstreamByKind[e.edgeKind] ??= []).push(to);
  }
  const pending = r.nodes.flatMap((n) => [...(n.pending ?? []), ...(n.gap ? [n.gap] : [])]);
  return { ok: r.ok, start: r.start, nodes: r.nodes, edges: r.edges, downstreamByKind, pending };
}

/**
 * 构造只读 api。方法名与签名对齐 `sciworkbench/public/lib/api.js` 的读接口子集。
 *
 * @param {object} opts
 * @param {string} [opts.baseUrl] 静态快照目录（默认 "../demo-data"，由 D 改为站点路径如 "/demo-data"）
 * @param {string} [opts.topicId] 固定主课题 ID（覆盖 manifest.projectId）
 * @param {string} [opts.zipUrl] 样本 ZIP 的下载地址（覆盖快照内置 url；供 zipInfo() 使用）
 * @param {typeof fetch} [opts.fetch] 注入 fetch（单测用；默认全局 fetch）
 * @returns {Promise<Readonly<object>>}
 */
export async function createDisplayApi({ baseUrl = DEFAULT_BASE_URL, topicId, zipUrl, fetch: fetchImpl = fetch } = {}) {
  const loadJson = async (rel) => {
    const url = `${baseUrl}/${rel}`;
    const res = await fetchImpl(url, { headers: { accept: "application/json" }, cache: "no-store" });
    if (!res.ok) throw new DemoMissingError(url, `展示快照文件加载失败（HTTP ${res.status}）`);
    return res.json();
  };

  // 复用 a-snapshot：装载多文件并组合成适配器快照（含真实 knowledge / demo 派生）。
  const composed = await loadASnapshot({ baseUrl, fetch: fetchImpl });
  const data = createDemoData(composed, { topicId });

  // app.js 依赖的顶层集合里，adoptions/mappings/impacts/ocrs 不参与 composeASnapshot 的派生，
  // 但存在于 A 导出的 state.json 中（本快照为空）。以 state.json 为准补齐，缺失给空数组。
  const rawState = await loadJson("snapshot/state.json");
  const state = deepFreeze({
    ...rawState,
    knowledge: composed.knowledge,
    adoptions: rawState.adoptions ?? [],
    mappings: rawState.mappings ?? [],
    impacts: rawState.impacts ?? [],
    ocrs: rawState.ocrs ?? [],
    demo: composed.demo,
    display: {
      mode: "display",
      readOnly: true,
      mainTopicId: data.meta().mainTopicId,
      topicId: topicId ?? composed.mainTopicId,
      schemaVersion: composed.schemaVersion,
      fixtureVersion: composed.fixtureVersion,
      sourceCommit: composed.sourceCommit,
      projectId: composed.projectId,
      generatedAt: composed.generatedAt,
    },
  });

  const api = {
    // ── 必读接口（与在线 api 同名同签名）──
    async getState() { return state; },

    async getSource(assetId) { return data.getSource(assetId); },

    async backtrace(kind, id, dir = "both") { return backtraceResponse(data.backtrace(kind, id, dir)); },

    async knowledgeItem(id, revision, topicIdArg) {
      const r = data.knowledgeItem(id, revision);
      if (topicIdArg && !(r.payload?.topicIds ?? []).includes(topicIdArg)) {
        throw new DemoMissingError(`knowledgeItem:${id}@r${revision}`, `该版本不属于课题 ${topicIdArg}`);
      }
      return r;
    },

    async aiStatus() {
      // 展示态占位：不读取、不请求任何模型配置；模型产物一律为预生成/未授权。
      return { configured: false, baseUrl: "", model: "预生成", timeoutMs: 0 };
    },

    async getJob(id) {
      // 展示模式不提供后台任务，也不请求后端；返回终态错误让任何轮询立即停止，不伪造进度。
      return { id, status: "error", error: "展示模式不提供后台任务（只读）", message: "展示模式" };
    },

    // ── 展示增量（E4 上下文图/下一步、E5 样本 ZIP）──
    /** 返回该分析任务实跑生成的上下文图；未导出即缺项，不现场合成。 */
    async contextMap(taskId) { return data.getContextMap(taskId); },

    /** 样本 ZIP 元信息 {fileName, sha256, url}；下载地址优先用注入配置的 zipUrl。 */
    async zipInfo() {
      const z = data.zipInfo(); // 缺 fileName/sha256 时抛缺项
      return { fileName: z.fileName, sha256: z.sha256, url: zipUrl ?? z.url };
    },

    /** 下一步指导（最多 2 条）；快照未提供即缺项。 */
    async suggestions() {
      const list = data.listSuggestions();
      if (!list.length) throw new DemoMissingError("demo.suggestions", "快照未提供下一步指导（A 需导出 next-steps.json）");
      return list;
    },
  };

  return Object.freeze(api);
}
