# 阶段3 · 最小 Web 闭环（首轮验收）

> 目标（用户 2026-11-16）：**导入 / 人工核对 / 保存 / 刷新恢复 / 原件回查**，且 **SLAC 实验数据**与**文献证据**两条流程**分开验证**；存储可替换；尽早给出前端协作接口。其余五步为后续目标，本轮不铺开。
> 口径：这是**本地开发版最小闭环**，非 Qoder Sites 部署（Pro 实测按 ADR-0004 在阶段6后）。

## 1. 运行

```bash
cd sciworkbench
node server.ts            # 或 npm run dev
# → http://127.0.0.1:5173   （改端口： PORT=5199 node server.ts）
```

- 零依赖：只用 Node 内置模块（Node ≥ 22，本机 Node 24 实测）。**无需 npm install**。
- 数据文件：`sciworkbench/data/state.json`（已 gitignore）。删掉它即清空。

## 2. 两条流程分开验证（首轮）

**A. 文献证据流程**（Tab「文献证据流程」）
1. 在「导入文献摘录」粘贴一段文本 → 「导入并生成草稿」。
2. 每段文字生成一张**待审证据卡草稿**（`unreviewed`）。
3. 逐卡设置 核对(`confirm`/`need_info`/`exclude`/`skip`)、重要程度、备注、原因 → 「保存」。
   - **排除必须填原因**，否则 422 拒绝（护栏）。
4. 点「原件回查」→ 右侧抽屉显示原始文本并**高亮该卡片段**。

**B. 实验数据流程**（Tab「实验数据流程」，用 SLAC）
1. 从 `reference reseach data/LOCUS_测试样本验收包_v1/01_SLAC/evaluator-safe-input.zip` 解出任意 CSV（如 `TimeCourseData/*.csv` 或 `ConditionRecordCSV/*__Data.csv`）。
2. 在「导入实验数据」选择该 CSV 文件（或粘贴内容）→ 「导入并生成待核对项」。
3. 每个非空单元格生成一个**待核对测量项**，带源定位（第 N 行 · 列名）。
4. 逐项改 数值/单位、设结论 → 「保存」。
5. 点「原件回查」→ 抽屉显示原始 CSV 并**高亮对应数据行**。

**刷新恢复**：核对/保存后**刷新浏览器**（或重启服务）→ 记录仍在（存储落盘）。

## 3. 前端协作接口（REST，落地于 `server.ts`）

| 方法 | 路径 | 请求 | 返回 |
| --- | --- | --- | --- |
| GET | `/api/state` | — | 全量状态 `{version,assets,cards,measurements}` |
| POST | `/api/import/literature` | `{name,text}` | `{ok,created,assetId}` |
| POST | `/api/import/measurements` | `{name,csv}` | `{ok,created,assetId}` |
| POST | `/api/cards/:id/review` | `{audit,importance,note,reason,keyValueChanged}` | `{ok}` / 422 |
| POST | `/api/measurements/:id/review` | `{value,unit,decision,note,reason}` | `{ok}` |
| GET | `/api/source/:assetId` | — | `{asset,points[]}`（原件回查） |

- 错误统一 `{error}`；`422` 表示需原因或数据不合法；`404` 对象不存在。
- 前端调用集中在 `public/lib/api.js`（**换存储/换部署只改这一处 + `store.ts`**）。
- 数据结构（DTO）见 `store.ts` 的 `AssetRecord` / `LitCardRecord` / `MeasurementRecord`。

## 4. 存储可替换

`store.ts` 定义 `Store` 接口（`load()` / `save(state)`），现提供：
- `JsonFileStore`（本地文件，原子写；当前默认）
- `MemoryStore`（测试）

后续接 Sites DB / 对象存储时，只需新增一个 `Store` 实现并在 `server.ts` 换一行，用例层与前端不动。

## 5. 已验证 / 未验证（首轮）

**已实测（本机 `http://127.0.0.1:5199`，2026-11-16）**
- 导入：文献 3 卡、CSV 4 项生成成功。
- 人工核对：卡片 `confirm`+重要程度、测量改单位，均 `{ok:true}`。
- 护栏反例：`exclude` 无原因 → **HTTP 422**；补原因 → 200。
- 原件回查：文献返回原文 + 3 定位点；数据返回原文 + 4 定位点。
- 刷新恢复：重启服务后 assets 2 / cards 3 / meas 4 保留，排除原因与单位均持久化。
- 单测：`node --test "tests/*.test.ts"` → **46 项通过 / 0 失败**。

**未做（明确声明）**
- **无 AI 解析**：抽取是"按行/按格"的**草稿生成**，非真实 OCR/文献解析；不冒充智能抽取。
- 无证据卡→比较/采用、无上下文地图、无分析/报告/导出（其余五步）。
- 无多用户/权限/隔离；无云部署；未跑 Qoder Sites。
- 未接入任何真实模型或文献 API。

## 6. 队友接手点

| 改什么 | 只动 |
| --- | --- |
| 界面/交互/样式 | `public/index.html`、`public/app.js`、`public/styles.css`（设计变量在 `:root`） |
| 调接口/换后端地址 | `public/lib/api.js` |
| 换存储 | `store.ts`（新 `Store` 实现）+ `server.ts` 一行 |
| 用例规则（导入/核对护栏） | `services/app.ts` |
| 领域语义（路径/双链/影响链/回查） | `domain/*.ts` |
