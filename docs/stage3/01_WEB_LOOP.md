# 阶段3 · 最小 Web 闭环（v2）

> 目标（用户）：导入 / 人工核对 / 保存 / 刷新恢复 / 原件回查；**SLAC 实验数据**与**文献证据**两条流程**分开**；存储可替换；前端协作接口先行。
> 本轮修正（用户 review）：① **保留表格结构**（按表/列核对，不再逐格变成表单）② **更正留历史**（前后值+原因+修订号）③ **原件超限明确拒绝**（不静默截断）④ 接入**真实 AI 解析**。
> 口径：本地开发版最小闭环，非 Qoder Sites 部署（Pro 实测按 ADR-0004 在阶段6后）。

## 1. 运行

```bash
cd sciworkbench
node server.ts            # 或 npm run dev  → http://127.0.0.1:5173
```

### AI 配置（可选；仅进程内存，重启失效）

启动**前**在环境变量里提供（缺任一项即视为未配置）：

```bash
LOCUS_AI_BASE_URL="https://<openai-compatible>/v1" \
LOCUS_AI_MODEL="<模型名>" \
LOCUS_AI_KEY="<你的Key>" \
node server.ts
```

- **不写文件、不写浏览器持久存储、不进日志、不进 Git**；仅存活于当前服务进程内存，重启即失效。
- 启动日志与 `/api/ai/status` 只报告 `baseUrl/model/是否配置`，**绝不回显 Key**。
- 未配置时：文献导入可用 `draft` 模式（按行草稿）；请求 `ai` 模式会返回 **400**（不冒充 AI）。

## 2. 两条流程分开验证

**A. 文献证据流程**：粘贴文本 → 选择抽取方式（`draft` / `AI`）→ 生成证据卡 → 逐卡设 核对/重要程度/备注/原因 → 保存（写历史）→ 原件回查高亮片段。卡片带 `extraction` 徽标（draft/ai）与 `rev`。

**B. 实验数据流程（SLAC）**：从 `01_SLAC/evaluator-safe-input.zip` 解出 CSV → 导入 → 生成**一张表格**（保留行列）→ 在表头按**列**设单位/结论 → 点单元格可更正（**必须填原因**）→ 保存 → 原件回查看完整原件文本。

**刷新恢复**：保存后刷新浏览器或重启服务，记录（含修订历史）仍在。
**超限**：> 2 MiB 的原件导入返回 **413 拒绝**（不截断、不产素材）。
**历史**：每项「历史(N)」按钮查看 前值→后值 + 原因 + 修订号。

## 3. 前端协作接口（REST，`server.ts`）

| 方法 | 路径 | 请求 | 返回 |
| --- | --- | --- | --- |
| GET | `/api/state` | — | `{version,assets,cards,tables}` |
| GET | `/api/ai/status` | — | `{configured,baseUrl,model}`（无 Key） |
| POST | `/api/import/literature` | `{name,text,mode:"draft"\|"ai"}` | `{ok,created,assetId,mode}` / 400 / 502 |
| POST | `/api/import/measurements` | `{name,csv}` | `{ok,created,assetId}`（created=表行数） / 413 / 422 |
| POST | `/api/cards/:id/review` | `{audit,importance,note,reason,rawText}` | `{ok}` / 422 |
| POST | `/api/tables/:id/review` | `{columnUpdates[],cellUpdates[],note,reason}` | `{ok}` / 422 |
| GET | `/api/source/:assetId` | — | `{asset,points[]}`（原件回查） |

错误 `{error}`：`400` 参数/AI 未配置 · `413` 超限 · `422` 需原因/结构不符 · `502` 模型失败 · `404` 对象不存在。
前端调用集中在 `public/lib/api.js`；数据 DTO 见 `store.ts`。

## 4. 存储可替换

`store.ts` 的 `Store` 接口（`load`/`save`）：`JsonFileStore`（默认，原子写）/ `MemoryStore`（测试）。接 Sites DB 只需新增一个实现并改 `server.ts` 一行。状态带 `version=2`，旧结构不自动迁移（返回空）。

## 5. AI：三个独立任务（不混用）

`services/ai.ts` 定义三个任务，**各自 system 提示词与输出结构**：

| 任务 | 用途 | 输出结构 |
| --- | --- | --- |
| `literature_extract` | 文献文本 → 证据卡 | `{cards:[{rawText,locator,extracted,unknowns}]}` |
| `protocol_parse` | 方法/方案文本 → 结构化方案 | `{protocol:{purpose,inputs,operations,conditions,criteria,unknowns}}` |
| `handwriting_ocr` | 手写记录图 → 转录记录 | `{records:[{rawText,fields,unknowns}]}` |

本轮**已接入** `literature_extract` 到导入流程；`protocol_parse` 与 `handwriting_ocr` 已按独立任务定义，**尚未接入界面**（下一步，不混用提示词）。
校验：结构不符直接报错（502），不静默补造、不降级冒充。

## 6. 已验证 / 未验证

**已实测（本机 `127.0.0.1:5199`，2026-11-16）**
- 导入 CSV → **1 张表**（columns/rows 保留），created=表行数 ✔
- 改单元格无原因 → **422**；带原因 → 200，历史记 `cell[1][1] "0.348"→"0.401"` ✔
- 列单位/结论 → 历史 `col[0].unit` / `col[0].decision` ✔
- 超限导入 → **413** 且不产素材 ✔
- `ai` 模式未配置 → **400** ✔
- 原件回查返回素材完整原文 + 定位点 ✔
- 刷新恢复：重启后 表格 rev 3 / 历史 3 条 / 更正单元格 / 列单位 均保留 ✔
- 单测：`node --test "tests/*.test.ts"` → **53 项通过 / 0 失败**（含 AI stub、任务分离、状态不泄露 Key、超限拒绝、历史）

**未做（明确声明）**
- `protocol_parse` / `handwriting_ocr` 未接入界面（各有独立任务定义）。
- 无真实模型跑通凭据验证（本地未配置 Key；AI 路径仅经 stub 单测）。
- 其余五步（上下文地图/分析/报告/导出等）未做；无云部署、无多用户/权限。

## 7. 队友接手点

| 改什么 | 只动 |
| --- | --- |
| 界面/交互/样式 | `public/index.html`、`public/app.js`、`public/styles.css`（`:root` 设计变量） |
| 调接口/换后端 | `public/lib/api.js` |
| 换存储 | `store.ts` + `server.ts` 一行 |
| 用例/护栏 | `services/app.ts` |
| AI 任务/提示词/结构 | `services/ai.ts` |
| 领域语义 | `domain/*.ts` |
