/**
 * 把 A（executor-a）在 locus-site/demo-data/ 的正式包装载成 B 适配器消费的快照。
 *
 * A 的产物不是单一 JSON，而是：
 *   snapshot/state.json        LocusState（前端消费格式）
 *   snapshot/knowledge.json    知识条目（由 state.cards 派生，扁平结构）+ 跨来源比较
 *   snapshot/context-map.json  真实生成的上下文图（mapTask / mapPre）
 *   snapshot/references.json   真实引用网络（nodes / edges）
 *   snapshot/ai-products.json  AI 产物登记（本轮未调用模型）
 *   snapshot/next-steps.json   下一步方向
 *   snapshot/manifest.json     版本、原件清单与 SHA-256
 *   SHA256SUMS.txt             ZIP 校验值
 *
 * 本模块只做**结构搬运**：不新增事实、不改数值、不补来源；缺文件直接报错。
 */
import { DemoMissingError } from "./snapshot-adapter.js";

const ZIP_FILE = "locus-demo-public.zip";

export async function loadASnapshot({ baseUrl = "../demo-data", fetch: fetchImpl = fetch, zipUrl } = {}) {
  const getJson = async (rel) => {
    const url = `${baseUrl}/${rel}`;
    const res = await fetchImpl(url, { headers: { accept: "application/json" }, cache: "no-store" });
    if (!res.ok) throw new DemoMissingError(url, `A 数据文件加载失败（HTTP ${res.status}）`);
    return res.json();
  };
  const getText = async (rel) => {
    const url = `${baseUrl}/${rel}`;
    const res = await fetchImpl(url, { cache: "no-store" });
    return res.ok ? res.text() : "";
  };
  const getJsonOpt = async (rel) => { try { return await getJson(rel); } catch { return null; } };
  const [state, knowledge, contextMap, references, aiProducts, nextSteps, manifest, sums, figures, chain90] = await Promise.all([
    getJson("snapshot/state.json"),
    getJson("snapshot/knowledge.json"),
    getJson("snapshot/context-map.json"),
    getJson("snapshot/references.json"),
    getJson("snapshot/ai-products.json"),
    getJson("snapshot/next-steps.json"),
    getJson("snapshot/manifest.json"),
    getText("SHA256SUMS.txt"),
    // 图形与贯通链为可选展示增量：缺文件不阻断工作台启动（对应区域显示加载失败与重试）。
    getJsonOpt("snapshot/figures.json"),
    getJsonOpt("snapshot/chain-90d.json"),
  ]);
  const zipSha = (sums.split(/\r?\n/).find((l) => l.trim().endsWith(ZIP_FILE)) ?? "").trim().split(/\s+/)[0] ?? "";
  // 导出文件（Word/追溯包）哈希取自 manifest.files；URL 指向站内静态导出目录。
  const fh = manifest?.files ?? {};
  const exportFile = (rel, fileName) => ({
    fileName,
    sha256: (fh[`snapshot/${rel}`] ?? "").slice(0, 64),
    url: `${baseUrl}/snapshot/${rel}`,
  });
  return composeASnapshot({
    state, knowledge, contextMap, references, aiProducts, nextSteps, manifest, figures, chain90,
    zip: { fileName: ZIP_FILE, sha256: zipSha, url: zipUrl ?? `${baseUrl}/${ZIP_FILE}`, sizeBytes: 0 },
    exports: {
      docx: exportFile("exports/report.docx", "report.docx"),
      trace: exportFile("exports/traceability.zip", "traceability.zip"),
    },
    baseUrl,
  });
}

function reviewOf(audit) {
  if (audit === "confirm") return { status: "confirmed" };
  if (audit === "need_info") return { status: "needs_info" };
  if (audit === "exclude") return { status: "excluded" };
  if (audit === "skip") return { status: "withdrawn" };
  return { status: "pending" };
}

function fieldsText(fields) {
  return Object.entries(fields ?? {}).map(([k, v]) => `${k}：${v}`).join("；");
}

export function composeASnapshot({ state, knowledge, contextMap, references, aiProducts, nextSteps, manifest, figures, chain90, exports, zip, baseUrl = "" }) {
  const topicId = manifest?.projectId ?? state.topics?.[0]?.id;
  if (!topicId || !state.topics?.some((t) => t.id === topicId)) throw new DemoMissingError("manifest.projectId", "A 数据的主课题与 state.topics 不一致");

  const know = { schemaVersion: 9, items: [], contexts: [], evidence: [], relations: [], themes: [], mappings: [], datasets: [], sourcePolicies: [], snapshots: [], sourceVersions: [], extractionRuns: [] };
  for (const it of knowledge.items ?? []) {
    const audit = it.audit ?? "unreviewed";
    const rev = it.version ?? 1;
    const quote = it.locator?.quote ?? "";
    const assetId = (it.sourceRefs ?? []).find((r) => r.kind === "asset")?.id ?? null;
    const conds = it.conditions ?? [];
    const text = quote || fieldsText(it.fields);
    know.items.push({
      id: it.id, revision: rev, createdAt: manifest?.generatedAt, updatedAt: manifest?.generatedAt,
      payload: {
        topicIds: [topicId], subquestionIds: [],
        contentType: "observation", nature: "observation",
        text,
        subject: { raw: it.fields?.["对象"] ?? "" },
        predicate: { raw: "原文陈述" },
        value: { kind: "category", raw: fieldsText(it.fields), label: fieldsText(it.fields) },
        contextRefs: conds.length ? [{ kind: "context", id: `${it.id}_ctx`, revision: 1 }] : [],
        evidenceRefs: quote ? [{ ref: { kind: "evidence", id: `${it.id}_evd`, revision: 1 }, fieldPaths: ["text"] }] : [],
        sourceRefs: it.sourceRefs ?? [],
        origin: { sourceClass: "literature_report", createdBy: it.extraction === "manual" ? "human" : "model", secondaryCitation: false },
        scopeText: conds.join("；"),
        unknowns: [],
        review: { ...reviewOf(audit), basis: it.locator?.reason ?? "" },
        cardId: it.cardId,
        // 展示辅助：A 的字段/单位/未知项原样保留
        demoFields: it.fields ?? {}, demoUnits: it.units ?? [], demoConditions: conds, demoUnknowns: it.unknowns ?? [],
      },
      history: [],
    });
    if (conds.length) {
      know.contexts.push({
        id: `${it.id}_ctx`, revision: 1, createdAt: manifest?.generatedAt, updatedAt: manifest?.generatedAt,
        payload: {
          topicIds: [topicId], subquestionIds: [], researchUnitId: it.id, subject: it.fields?.["对象"] ?? "", groupLabel: "", stage: "",
          methodRefs: [],
          conditions: conds.map((c, i) => ({
            id: `${it.id}_c${i + 1}`, field: { raw: String(c) }, value: { kind: "category", raw: String(c), label: String(c) },
            appliesTo: { subject: it.fields?.["对象"] ?? "", stage: "" }, evidenceRefs: [], obtainedBy: "human_record", review: reviewOf(audit),
          })),
          unknowns: [], review: reviewOf(audit),
        },
        history: [],
      });
    }
    if (quote) {
      know.evidence.push({
        id: `${it.id}_evd`, revision: 1, createdAt: manifest?.generatedAt, updatedAt: manifest?.generatedAt,
        payload: {
          topicIds: [topicId], subquestionIds: [], sourceRef: assetId ? { kind: "asset", id: assetId } : null,
          quote, locator: { type: "text", start: it.locator?.start ?? null }, candidates: [],
          locationStatus: it.locator?.status === "confirmed" ? "located" : (it.locator?.status ?? "unmatched"),
          review: reviewOf(audit),
        },
        history: [],
      });
    }
  }

  // 原件：manifest.originals 给出 assetId → 可再分发文件、许可
  const sources = {};
  for (const o of manifest?.originals ?? []) {
    if (!o.assetId) continue;
    sources[o.assetId] = {
      originalUrl: baseUrl ? `${baseUrl}/${o.path}` : null,
      license: o.license ?? "未提供",
      provenance: `${o.license ?? ""} · ${o.path}`.trim(),
      access: o.redistributable ? "public" : "external",
    };
  }

  const mainTask = state.analysisTasks?.[0];
  const contextMaps = {};
  if (contextMap?.mapTask?.scope?.taskId) contextMaps[contextMap.mapTask.scope.taskId] = contextMap.mapTask;

  const suggestions = (nextSteps?.items ?? []).slice(0, 2).map((n) => ({
    id: n.id,
    title: n.direction,
    text: n.basis?.text ?? "",
    basis: {
      divergence: n.basis?.text ? [n.basis.text] : [],
      dataGaps: n.needData ? [n.needData] : [],
      distinguishing: n.distinguishes ? [n.distinguishes] : [],
      uncertainty: n.stillUncertain ? [n.stillUncertain] : [],
    },
    refs: n.basis?.refs ?? [],
    aiPreset: false,
    status: n.status,
  }));

  const snapshot = {
    schemaVersion: manifest?.schemaVersion ?? 1,
    fixtureVersion: manifest?.fixtureVersion ?? "未标注",
    sourceCommit: manifest?.sourceCommit ?? "未标注",
    projectId: manifest?.projectId ?? "",
    generatedAt: manifest?.generatedAt ?? "",
    fixture: false,
    mainTopicId: topicId,
    version: state.version,
    topics: state.topics, subquestions: state.subquestions, assets: state.assets, papers: state.papers,
    attachments: state.attachments, cards: state.cards, tables: state.tables, comparisons: state.comparisons ?? [],
    protocols: state.protocols, templates: state.templates ?? [], executions: state.executions, samples: state.samples,
    measurements: state.measurements, analysisTasks: state.analysisTasks, analysisResults: state.analysisResults,
    reports: state.reports, chats: state.chats,
    knowledge: know,
    demo: {
      fixture: false,
      mainTopicId: topicId,
      mainProtocolId: state.protocols?.[0]?.id,
      mainExecutionId: state.executions?.[0]?.id,
      mainTaskId: mainTask?.id,
      mainChatId: state.chats?.[0]?.id,
      zip,
      sources,
      contextMaps,
      mapPre: contextMap?.mapPre ?? null,
      references: references?.nodes?.length ? { nodes: references.nodes, edges: references.edges } : null,
      comparison: knowledge.comparisons?.[0] ?? null,
      suggestions,
      figures: figures ?? null,
      chain90: chain90 ?? null,
      exports: exports ?? null,
      preset: {
        ai: !!aiProducts?.modelRunThisSession,
        model: aiProducts?.modelRunThisSession ? "见 ai-products.json" : "未调用（未授权）",
        generatedAt: manifest?.generatedAt ?? "",
        reviewedBy: "人工核对后公开展示",
        note: aiProducts?.modelRunReason ?? "",
      },
      manifest: { verificationStatus: manifest?.verificationStatus ?? "", counts: manifest?.counts ?? {} },
    },
  };
  return snapshot;
}
