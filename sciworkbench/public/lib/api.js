// 前端协作接口：所有后端调用集中此处，队友只需替换实现即可换存储/换部署。
export const api = {
  async getState() { return json("/api/state"); },
  async aiStatus() { return json("/api/ai/status"); },
  async setAiConfig(baseUrl, model, key) { return json("/api/ai/config", { baseUrl, model, key }); },
  async clearAiConfig() { return fetch("/api/ai/config", { method: "DELETE" }).then((r) => r.json()); },
  async createTopic(name, researchQuestion) { return json("/api/topics", { name, researchQuestion }); },
  async createSubquestion(topicId, question, kind) { return json(`/api/topics/${encodeURIComponent(topicId)}/subquestions`, { question, kind }); },
  async importLiterature(name, text, mode, topicId) { return json("/api/import/literature", { name, text, mode, topicId }); },
  async importMeasurements(name, csv, topicId) { return json("/api/import/measurements", { name, csv, topicId }); },
  async reviewCard(id, patch) { return json(`/api/cards/${encodeURIComponent(id)}/review`, patch); },
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
