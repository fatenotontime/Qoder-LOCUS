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
