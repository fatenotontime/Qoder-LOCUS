/**
 * AI 配置落盘（本机本地文件，不入库）。
 * 位置通常为 <数据目录>/ai-config.json（`sciworkbench/data/` 已被 .gitignore 覆盖）。
 * 含 Key 明文：仅本机本地工具用途；文件权限 0600；不打印、不写入日志/Git/导出。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { normalizeAiConfig, type AiConfig } from "./ai.ts";

/** 读回本地配置；缺失/损坏/不完整 → null（不抛错，不静默清空设置以外的东西）。 */
export function loadAiConfigFile(path: string): AiConfig | null {
  try {
    if (!existsSync(path)) return null;
    const p = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    return normalizeAiConfig({ baseUrl: p.baseUrl, model: p.model, key: p.key, timeoutMs: p.timeoutMs });
  } catch {
    return null;
  }
}

/** 写入本地配置（含 savedAt 便于人工辨认；原子性：直接覆盖，配置极小且非高频）。 */
export function saveAiConfigFile(path: string, cfg: AiConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  const body = { baseUrl: cfg.baseUrl, model: cfg.model, key: cfg.key, timeoutMs: cfg.timeoutMs, savedAt: new Date().toISOString() };
  writeFileSync(path, JSON.stringify(body, null, 2), { encoding: "utf8", mode: 0o600 });
}

/** 删除本地配置文件（清除配置时用）。 */
export function removeAiConfigFile(path: string): void {
  try {
    if (existsSync(path)) rmSync(path);
  } catch {
    /* 删除失败不影响内存态清除 */
  }
}
