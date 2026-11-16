# 阶段4 · 第二轮扫描与修复（问题 → 修复 → 验证）

> 承接 `20_EXPLORATORY.md`。用户：修复方向基本同意，但**再扫一轮同类问题后一并修复**；文献需支持**文件提交**（暂只 .md，其他解析器不配置）。
> 本轮：先扫第二轮，再**一次性修复**（含点名的 3 项 + 相邻 + 新发现）。**不改已执行阶段结论**。

## 一、第二轮扫描新增发现（同类/相邻）

| # | 问题 | 证据 |
| --- | --- | --- |
| S1 | `JsonFileStore.save` 用**固定 `.tmp` 名**：并发保存可能互相覆盖 | 源码 `store.ts` |
| S2 | 文献 AI **无分块 / 无原始响应留存 / 无重试**；大 md 直送模型易超上下文 | 源码 `ai.ts`；03 契约要求留存 |
| S3 | 无 **BOM/编码**处理；UTF-16 仪器导出被误判为二进制 | TimeCourse `.txt` 为 `FF FE`(UTF-16LE) |
| S4 | `parseCsv` **只认逗号**；TSV/仪器制表符导出误解析为单列 | TimeCourse 数据块为制表符分隔 |
| S5 | 无 **导入拒重**（LIT07 未接） | 同内容二次导入此前成功 |
| S6 | 前端无**进度/防连点/脏检查**；更正用 `prompt()` | 源码 `app.js` |
| S7 | 失败一律 `alert()` 原始串，无内联错误/重试 | 用户截图 |

## 二、本轮修复清单

| 修复 | 落点 | 对应 |
| --- | --- | --- |
| 写操作：**处理中提示 + 按钮禁用（防连点）+ 内联错误条 + 可重试** | `public/app.js` `runBusy`/`showBanner` | ③/S6/S7 |
| **离开前脏检查**（切换导航/课题/材料、关页提示） | `app.js` `guardLeave`+`beforeunload` | ③c |
| 单元格更正改**内联编辑**（值+原因），弃用 `prompt()` | `app.js` `celledit` | S6 |
| AI：**JSON 提取容错**（去围栏/去尾逗号/补未加引号键） | `ai.ts` `extractJson` | ①/S2 |
| AI：**失败一次受限重试**（“只返回严格 JSON”） | `ai.ts` `runTask` | ① |
| AI：文献**按段落分块抽取**（≤4000 字/块，≤24 块，超限明确拒绝） | `ai.ts` `chunkText`/`extractLiterature` | S2 |
| AI：**原始响应留存**（写 `data/audit/<assetId>.json`，不含认证头） | `server.ts` `writeAudit` | ①/03 契约 |
| CSV/TSV：**分隔符判定**（首行含 ,/\t）+ 按该分隔符解析 | `app.ts` `detectDelimiter`/`parseCsv` | ②/S4 |
| CSV：**表头识别**（跳过章节标记行）+ 丢弃“只有键列”的空行 | `app.ts` `analyseTable` | ② |
| **非表格/仪器格式明确拒绝**（首行无分隔符 → 422） | `app.ts` `importMeasurements` | ②/S4 |
| **BOM 剥离**（服务端）+ **按 BOM 解码**（前端 UTF-8/16LE/16BE） | `app.ts` `stripBom`；`app.js` `readTextFile` | S3 |
| **内容 hash 拒重**（两条路径，409） | `app.ts` `assertUniqueHash` | S5/LIT07 |
| **格式明确拒绝**（文献非 md/txt 422；数据非 csv/tsv 422） | `app.ts` `assertLiteratureName`/`assertCsvName` | ⑤ |
| 文献**文件提交**（`.md/.markdown/.txt` 上传，或粘贴） | `public/index.html` + `app.js` | 用户要求 |
| 存储**唯一临时名**（并发写不冲突） | `store.ts` | S1 |
| 表列下拉**最小宽度**（不再截断 `unreview…`） | `styles.css` | A3 |

## 三、验证证据（本轮实测）

- 单测：`node --test "tests/*.test.ts"` → **71 项通过 / 0 失败**（新增：`analyseTable`、真实 EnzymeML 表头、`extractJson` 容错、`chunkText`、拒重 409、扩展名 422、`.md` 导入、二进制拒绝、AI 分块失败、`detectDelimiter`、TSV、仪器格式拒绝）。
- 真实 SLAC 文件（端到端，`127.0.0.1:5199`）：
  - `EnzymeML_SLAC_pH5_5__Reactions.csv` → **HTTP 200**，列 = 真实 10 列，行 = 1（此前崩坏为 `Reactions|col2…`，21 行）。
  - 同内容再导 → **409**；`.pdf` → **422**；TimeCourse 仪器 `.txt`（UTF-16，`##BLOCKS=`）→ **422 明示“仪器导出等格式解析器未配置”**。
  - 最终 state：`assets 1 / tables 1 / 列 10 / 行 1`（页面=后端=保存 一致）。

## 四、仍未做 / 限制（如实）

- **`Data.csv` 多行（合并）表头**：EnzymeML 的 `__Data.csv` 是“章节行 + 两级表头”，当前只取到第一级，子表头会落成数据行 —— 属**格式专用解析器**，本轮不配置，后续如需要再单开。
- **仪器导出（`##BLOCKS=`/制表符块）**：**明确拒绝**而非解析（解析器未配置）。
- AI 真凭据未跑通（用户填 Key 后另测）；`protocol_parse`/`handwriting_ocr` 仍未接界面。
- 其余五步（分析/报告/导出）未做。

## 五、不改动
- 阶段0–3 历史结论不回改；本轮仅 `sciworkbench/` 与 `docs/stage4/`。
