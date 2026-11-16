// 前端协作接口：所有后端调用集中此处，队友只需替换实现即可换存储/换部署。
export const api = {
  async getState() {
    return json("/api/state");
  },
  async importLiterature(name, text) {
    return json("/api/import/literature", { name, text });
  },
  async importMeasurements(name, csv) {
    return json("/api/import/measurements", { name, csv });
  },
  async reviewCard(id, patch) {
    return json(`/api/cards/${encodeURIComponent(id)}/review`, patch);
  },
  async reviewMeasurement(id, patch) {
    return json(`/api/measurements/${encodeURIComponent(id)}/review`, patch);
  },
  async getSource(assetId) {
    return json(`/api/source/${encodeURIComponent(assetId)}`);
  },
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
