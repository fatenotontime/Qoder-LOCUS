// 前端协作接口：所有后端调用集中此处，队友只需替换实现即可换存储/换部署。
export const api = {
  async getState() { return json("/api/state"); },
  async aiStatus() { return json("/api/ai/status"); },
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
  async parseProtocol(assetId, topicId, name) { return json("/api/protocols/parse", { assetId, topicId, name }); },
  async editProtocol(id, patch) { return json(`/api/protocols/${encodeURIComponent(id)}/edit`, patch); },
  async createTemplate(input) { return json("/api/templates", input); },
  async confirmTemplate(id, fields) { return json(`/api/templates/${encodeURIComponent(id)}/confirm`, { fields }); },
  async templateCheck(id) { return json(`/api/templates/${encodeURIComponent(id)}/check`); },
  async startExecution(input) { return json("/api/executions", input); },
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
};

async function json(url, body) {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
