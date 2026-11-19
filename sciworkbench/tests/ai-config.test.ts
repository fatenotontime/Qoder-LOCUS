/**
 * 模型设置：配置落盘（重启读回）、清除删文件、可用模型列表（联通性 + 模型 id）。
 * 落盘仅在本机数据目录；Key 不回显、不进状态。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { MemoryStore } from "../store.ts";
import { clearAiConfig } from "../services/ai.ts";

const listen = async (app: Server): Promise<string> => {
  await new Promise<void>((r) => app.listen(0, "127.0.0.1", () => r()));
  return `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
};

test("AI 配置落盘与重启读回；Key 不回显；清除即删文件", async () => {
  clearAiConfig();
  const dir = mkdtempSync(join(tmpdir(), "locus-aicfg-"));
  const cfgPath = join(dir, "ai-config.json");
  const { createApp } = await import("../server.ts");
  try {
    const app1 = await createApp(new MemoryStore(), { aiConfigPath: cfgPath });
    const base1 = await listen(app1);
    await fetch(`${base1}/api/ai/config`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "https://api.example.com/v1", model: "m1", key: "SECRET" }),
    });
    await new Promise<void>((r) => app1.close(() => r()));
    assert.equal(existsSync(cfgPath), true);

    clearAiConfig(); // 模拟进程重启：内存清空，仅剩文件
    const app2 = await createApp(new MemoryStore(), { aiConfigPath: cfgPath });
    const base2 = await listen(app2);
    const s = (await (await fetch(`${base2}/api/ai/status`)).json()) as { configured: boolean; model: string };
    assert.equal(s.configured, true);
    assert.equal(s.model, "m1");
    assert.equal(JSON.stringify(s).includes("SECRET"), false);

    const cleared = (await (await fetch(`${base2}/api/ai/config`, { method: "DELETE" })).json()) as { configured: boolean };
    assert.equal(cleared.configured, false);
    assert.equal(existsSync(cfgPath), false);
    await new Promise<void>((r) => app2.close(() => r()));
  } finally {
    clearAiConfig();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("可用模型：未配置 400；配置后返回模型列表与联通性", async () => {
  clearAiConfig();
  const ai = createServer((req, res) => {
    if (req.url === "/models") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "model-a" }, { id: "model-b" }] }));
      return;
    }
    res.statusCode = 404;
    res.end("nf");
  });
  await new Promise<void>((r) => ai.listen(0, "127.0.0.1", () => r()));
  const aiPort = (ai.address() as AddressInfo).port;
  const { createApp } = await import("../server.ts");
  const app = await createApp(new MemoryStore());
  const base = await listen(app);
  try {
    const r0 = await fetch(`${base}/api/ai/models`, { method: "POST" });
    assert.equal(r0.status, 400);
    await fetch(`${base}/api/ai/config`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: `http://127.0.0.1:${aiPort}`, model: "x", key: "k" }),
    });
    const body = (await (await fetch(`${base}/api/ai/models`, { method: "POST" })).json()) as { ok: boolean; models: string[] };
    assert.equal(body.ok, true);
    assert.deepEqual(body.models, ["model-a", "model-b"]);
  } finally {
    clearAiConfig();
    await new Promise<void>((r) => app.close(() => r()));
    await new Promise<void>((r) => ai.close(() => r()));
  }
});
