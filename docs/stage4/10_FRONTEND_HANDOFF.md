# 阶段4 · 4A 前端协作交接

> 目的：让前端队友**只 clone 就能启动并参与实现**，不必等所有界面完成。当前为**本地开发版**（Pro/Sites 在阶段6后）。

## 1. 启动

```bash
cd sciworkbench
node server.ts        # → http://127.0.0.1:5173
node --test "tests/*.test.ts"   # 59 项契约测试
```
零依赖（Node 内置模块 + 原生 TS 剥离）。数据落 `sciworkbench/data/state.json`（gitignored）。

## 2. 页面布局（三栏，用户确认的原 Locus 思路）

```
┌────────────── 顶栏 LOCUS / 状态 ──────────────┐
│ [AI 配置]（可折叠，不在主材料区长期占位）      │
├───────────┬──────────────────┬───────────────┤
│ 左栏      │ 中栏             │ 右栏          │
│ 导航      │ 原始材料         │ 结构化结果    │
│ 课题切换  │ （文献文本/CSV） │ （证据卡/表格）│
│ 子问题    │ 可高亮定位       │ 核对/编辑/历史│
│ 材料列表+导入                │               │
└───────────┴──────────────────┴───────────────┘
- 左：课题/子问题切换、工作区导航（文献证据/实验数据；**方案/分析/产出标"未实现"且禁用**）、材料入口与导入。
- 中：当前材料**原始内容**；选右栏条目 → 高亮对应原文；**匹配不到就明示"定位不足"**，不假装精确。
- 右：该材料的结构化草稿与核对（文献=证据卡；数据=表格），带修订历史。
左右数据指向**同一材料同一版本**（同一 `assetId`）。
```

## 3. 文件与组件边界（可修改路径）

| 文件 | 职责 | 谁改 |
| --- | --- | --- |
| `public/index.html` | 三栏骨架 + 顶栏 + AI 配置 | 前端 |
| `public/app.js` | 视图状态与渲染（`renderNav/Topics/Subq/ImportBox/Materials/Middle/Right`） | 前端 |
| `public/styles.css` | **设计变量在 `:root`**（appearance/radius/spacing/typography）；三栏 `.app` 栅格 | 前端 |
| `public/lib/api.js` | 所有后端调用集中此处（**共享契约**） | 前端 |
| `server.ts` | 路由（只加不改语义） | 双方约定 |
| `services/*.ts` `store.ts` | 用例层/存储（前端不经手） | 后端 |
| `domain/*.ts` | 领域规则 | 后端 |

## 4. 共享契约（API 请求/响应示例）

| 方法 | 路径 | 请求 | 成功 | 错误 |
| --- | --- | --- | --- | --- |
| GET | `/api/state` | — | `{version,topics,subquestions,assets,cards,tables}` | — |
| GET | `/api/ai/status` | — | `{configured,baseUrl,model}` | — |
| POST | `/api/ai/config` | `{baseUrl,model,key}` | `{configured,baseUrl,model}` | 400 |
| DELETE | `/api/ai/config` | — | `{configured:false}` | — |
| POST | `/api/topics` | `{name,researchQuestion}` | `{ok,topicId}` | 422 |
| POST | `/api/topics/:id/subquestions` | `{question,kind}` | `{ok,subquestionId}` | 404/422 |
| POST | `/api/import/literature` | `{name,text,mode:"draft"\|"ai",topicId?}` | `{ok,created,assetId,mode}` | **400**(AI未配置) **413**(超限) **502**(模型失败) |
| POST | `/api/import/measurements` | `{name,csv,topicId?}` | `{ok,created,assetId}`（created=表行数） | 413/422 |
| POST | `/api/cards/:id/review` | `{audit,importance,note,reason,rawText?}` | `{ok}` | 422 |
| POST | `/api/tables/:id/review` | `{columnUpdates[],cellUpdates[],note,reason}` | `{ok}` | 422 |
| GET | `/api/source/:assetId` | — | `{asset,points[]}` | 404 |

错误统一 `{error}`。字段含义见 `store.ts` 的 `AssetRecord`/`LitCardRecord`/`MeasurementTableRecord`/`TopicRecord`/`SubquestionRecord`。

## 5. 需覆盖的状态

| 状态 | 现状 |
| --- | --- |
| 加载中 | 顶栏"连接中…" |
| 空白 | 材料/卡片为空有提示 |
| 待审 | 卡片 `audit=unreviewed`、表格列 `decision=unreviewed` 有徽标 |
| 失败 | 导入/保存错误以 `alert` 显示 `{error}`（**待做**：内联错误态与重试按钮） |
| 过期 | 影响分析 `stale`（阶段4C 接入）——**当前无** |
| 定位不足 | 中栏明示（已实现） |

## 6. 可用公开数据

- 文献：`prompt/…/` 方法节选；实验数据：`reference reseach data/LOCUS_测试样本验收包_v1/01_SLAC/…`（approved，限声明用途，署名 DaRUS）。
- 三者同源 CC BY 4.0；不得用私人 SRTP 材料。

## 7. 未实现（明确标注，不做假按钮）

方案 / 图 / 记录（4C）、分析任务与外部结果（阶段5）、初稿与导出（阶段6）、Pro 建站（阶段6后/阶段7）。导航中已置灰并标注"未实现"。

## 8. 已知待办（移交前须知）

- 单元格更正当前用浏览器 `prompt()` 取原因 —— 待换成内联编辑（前端可直接做）。
- 错误态内联化 + 重试；加载骨架。
- 4B 将补：候选库/后台队列/补卡/组审预览/查重接入/命名映射/比较快照，并修 P1–P6 反例。
