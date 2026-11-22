// 前端协作接口：所有后端调用集中此处，队友只需替换实现即可换存储/换部署。
export const api = {
  async getState() { return json("/api/state"); },
  async aiStatus() { return json("/api/ai/status"); },
  async aiTest() { return json("/api/ai/test", {}); },
  async listAiModels() { return json("/api/ai/models", {}); },
  async setAiConfig(baseUrl, model, key, timeoutMs) { return json("/api/ai/config", { baseUrl, model, key, timeoutMs }); },
  async clearAiConfig() { return fetch("/api/ai/config", { method: "DELETE" }).then((r) => r.json()); },
  async getJob(id) { return json(`/api/jobs/${encodeURIComponent(id)}`); },
  async createTopic(name, researchQuestion) { return json("/api/topics", { name, researchQuestion }); },
  async createSubquestion(topicId, question, kind) { return json(`/api/topics/${encodeURIComponent(topicId)}/subquestions`, { question, kind }); },
  async importLiterature(name, text, mode, topicId) { return json("/api/import/literature", { name, text, mode, topicId }); },
  async importMeasurements(name, csv, topicId, headerRows, profile) { return json("/api/import/measurements", { name, csv, topicId, headerRows, profile }); },
  async reviewCard(id, patch) { return json(`/api/cards/${encodeURIComponent(id)}/review`, patch); },
  async addCard(input) { return json("/api/cards", input); },
  async batchPreview(ids) { return json("/api/cards/batch-preview", { ids }); },
  async batchConfirm(ids, ack) { return json("/api/cards/batch-confirm", { ids, ack }); },
  async adopt(cardId, subquestionId, decision, reason) { return json("/api/adoptions", { cardId, subquestionId, decision, reason }); },
  async createMapping(original, mapped, basis, topicId) { return json("/api/mappings", { original, mapped, basis, topicId }); },
  async createComparison(input) { return json("/api/comparisons", input); },
  async reviewTable(id, patch) { return json(`/api/tables/${encodeURIComponent(id)}/review`, patch); },
  async getSource(assetId) { return json(`/api/source/${encodeURIComponent(assetId)}`); },
  // ── 4C：方案 / 模板 / 执行 / 样品 / 测量 / 影响 / OCR ──
  async createProtocol(input) { return json("/api/protocols", input); },
  async parseProtocol(assetId, topicId, name, sourceKind) { return json("/api/protocols/parse", { assetId, topicId, name, sourceKind }); },
  async uploadProtocolSource(name, text, topicId) { return json("/api/protocols/upload", { name, text, topicId }); },
  async editProtocol(id, patch) { return json(`/api/protocols/${encodeURIComponent(id)}/edit`, patch); },
  async createTemplate(input) { return json("/api/templates", input); },
  async confirmTemplate(id, fields) { return json(`/api/templates/${encodeURIComponent(id)}/confirm`, { fields }); },
  async templateCheck(id) { return json(`/api/templates/${encodeURIComponent(id)}/check`); },
  async startExecution(input) { return json("/api/executions", input); },
  async updatePreparation(execId, input) { return json(`/api/executions/${encodeURIComponent(execId)}/preparation`, input); },
  async confirmPreparation(execId) { return json(`/api/executions/${encodeURIComponent(execId)}/confirm-preparation`, {}); },
  async saveExecutionAsProtocol(execId, name) { return json(`/api/executions/${encodeURIComponent(execId)}/save-as-protocol`, { name }); },
  async appendEvent(execId, input) { return json(`/api/executions/${encodeURIComponent(execId)}/events`, input); },
  async editEvent(execId, eventId, patch) { return json(`/api/executions/${encodeURIComponent(execId)}/events/${encodeURIComponent(eventId)}/edit`, patch); },
  async pauseAssist(execId) { return json(`/api/executions/${encodeURIComponent(execId)}/pause-assist`, {}); },
  async pauseExecution(execId, input) { return json(`/api/executions/${encodeURIComponent(execId)}/pause`, input); },
  async resumeExecution(execId, humanDecision) { return json(`/api/executions/${encodeURIComponent(execId)}/resume`, { humanDecision }); },
  async completeExecution(execId) { return json(`/api/executions/${encodeURIComponent(execId)}/done`, {}); },
  async createSample(input) { return json("/api/samples", input); },
  async addSampleState(id, input) { return json(`/api/samples/${encodeURIComponent(id)}/states`, input); },
  async renameSample(id, displayName) { return json(`/api/samples/${encodeURIComponent(id)}/rename`, { displayName }); },
  async addMeasurement(input) { return json("/api/measurements", input); },
  async editMeasurement(id, patch) { return json(`/api/measurements/${encodeURIComponent(id)}/edit`, patch); },
  async runImpact(id) { return json(`/api/impacts/${encodeURIComponent(id)}/run`, {}); },
  async importImage(name, dataUrl, topicId) { return json("/api/import/image", { name, dataUrl, topicId }); },
  async runOcr(assetId) { return json("/api/ocr", { assetId }); },
  async manualOcr(assetId, input) { return json("/api/ocr/manual", { assetId, ...input }); },
  async confirmOcr(id, patch) { return json(`/api/ocr/${encodeURIComponent(id)}/confirm`, patch); },
  // ── 阶段5：论文条目/附件（文献整理）与语义知识提取 ──
  async createPaper(input) { return json("/api/papers", input); },
  async updatePaper(id, patch) { return json(`/api/papers/${encodeURIComponent(id)}/update`, patch); },
  async addPaperAttachment(id, input) { return json(`/api/papers/${encodeURIComponent(id)}/attachments`, input); },
  async linkPaperTopic(id, topicId, link) { return json(`/api/papers/${encodeURIComponent(id)}/topics`, { topicId, link }); },
  async importBibliography(format, text) { return json("/api/papers/import-bibliography", { format, text }); },
  async knowledgeJob(input) { return json("/api/knowledge/jobs", input); },
  async knowledgeRun(runId) { return json(`/api/knowledge/runs/${encodeURIComponent(runId)}`); },
  async cancelKnowledgeJob(id, runId) { return json(`/api/knowledge/jobs/${encodeURIComponent(id)}/cancel`, { runId }); },
  async pauseKnowledgeJob(id, runId) { return json(`/api/knowledge/jobs/${encodeURIComponent(id)}/pause`, { runId }); },
  async resumeKnowledgeJob(id, runId) { return json(`/api/knowledge/jobs/${encodeURIComponent(id)}/resume`, { runId }); },
  async retryKnowledgeChunk(id, index, runId) { return json(`/api/knowledge/jobs/${encodeURIComponent(id)}/retry-chunk`, { index, runId }); },
  // ── 5E：分析任务 / 方法推荐 / 结果提交 / 初步报告 / 上下文对话 ──
  async createAnalysisTask(input) { return json("/api/analysis/tasks", input); },
  async setTaskCandidates(id, optional) { return json(`/api/analysis/tasks/${encodeURIComponent(id)}/candidates`, { optional }); },
  async recommendMethods(id, purpose) { return json(`/api/analysis/tasks/${encodeURIComponent(id)}/recommend`, { purpose }); },
  async submitResult(taskId, input) { return json(`/api/analysis/tasks/${encodeURIComponent(taskId)}/result`, input); },
  async editResult(id, patch) { return json(`/api/analysis/results/${encodeURIComponent(id)}/edit`, patch); },
  async createReport(topicId, taskId) { return json("/api/reports", { topicId, taskId }); },
  async previewReport(id, blocks) { return json(`/api/reports/${encodeURIComponent(id)}/preview`, { blocks }); },
  async applyReport(id, baseRevision, blocks, reason) { return json(`/api/reports/${encodeURIComponent(id)}/apply`, { baseRevision, blocks, reason }); },
  async confirmReportBlock(id, blockId, reason) { return json(`/api/reports/${encodeURIComponent(id)}/blocks/${encodeURIComponent(blockId)}/confirm`, { reason }); },
  async draftReport(id) { return json(`/api/reports/${encodeURIComponent(id)}/draft`, {}); },
  async backtrace(kind, id, dir) { return json(`/api/backtrace?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}&dir=${dir ?? "both"}`); },
  async changeHits(kind, id, input) { return json("/api/change-hits", { kind, id, ...input }); },
  async restore(json, sha256) { return json("/api/restore", { json, sha256 }); },
  async createChat(input) { return json("/api/chats", input); },
  async sendChat(id, text) { return json(`/api/chats/${encodeURIComponent(id)}/send`, { text }); },
  async cancelChatMessage(chatId, messageId) { return json(`/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/cancel`, {}); },
  async retryChatMessage(chatId, messageId) { return json(`/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/retry`, {}); },
  async adoptChatProposal(chatId, messageId, index) { return json(`/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/adopt`, { index, confirmed: true }); },
  // ── E3：知识分项审阅（§8.1）：内容修订与审核分开；旧卡显式结构化；主题/新增认识 ──
  async knowledgeItem(id, revision, topicId) {
    const q = [`revision=${encodeURIComponent(revision)}`];
    if (topicId) q.push(`topicId=${encodeURIComponent(topicId)}`);
    return json(`/api/knowledge/items/${encodeURIComponent(id)}?${q.join("&")}`);
  },
  async updateKnowledgeItem(id, input) { return json(`/api/knowledge/items/${encodeURIComponent(id)}/update`, input); },
  async reviewKnowledgeItem(id, input) { return json(`/api/knowledge/items/${encodeURIComponent(id)}/review`, input); },
  async updateKnowledgeContext(id, input) { return json(`/api/knowledge/contexts/${encodeURIComponent(id)}/update`, input); },
  async reviewKnowledgeContext(id, input) { return json(`/api/knowledge/contexts/${encodeURIComponent(id)}/review`, input); },
  async resolveKnowledgeEvidence(id, input) { return json(`/api/knowledge/evidence/${encodeURIComponent(id)}/resolve`, input); },
  async structureCard(id, input) { return json(`/api/knowledge/cards/${encodeURIComponent(id)}/structure`, input); },
  async createTheme(input) { return json("/api/knowledge/themes", input); },
  async updateTheme(id, input) { return json(`/api/knowledge/themes/${encodeURIComponent(id)}/update`, input); },
  async createStatement(input) { return json("/api/knowledge/statements", input); },
  async knowledgeContainer(query = {}) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
    const tail = q.toString();
    return json(`/api/knowledge/container${tail ? `?${tail}` : ""}`);
  },
  // 分析页上下文地图（只读）：节点/边一律来自后端 buildNetwork，前端不补造。
  async analysisMap(query = {}) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
    const tail = q.toString();
    return json(`/api/analysis/map${tail ? `?${tail}` : ""}`);
  },
  async analysisTaskMap(taskId) { return json(`/api/analysis/tasks/${encodeURIComponent(taskId)}/map`); },
};

async function json(url, body) {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `HTTP ${res.status}`); e.status = res.status; e.details = data; throw e; }
  return data;
}
