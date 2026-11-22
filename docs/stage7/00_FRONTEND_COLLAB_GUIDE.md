# LOCUS 前端协作者必读

> 写给接手前端设计的协作者。先读完本文再动手。
> 本文只做三件事：划出你**可以自由发挥**的范围，说明**每页的主次功能与代码位置**，列出**不能破坏的严密性**与**两项已定的定制设计**。
> 页面路径以「拆分提示词」（`01_SPLIT_PROMPT.md`）完成后为准；与代码不符时以代码为准并改本文。

## 一、你可以自由决定

版式与栅格、配色、字体、间距、图标、插画、空状态与加载态、各页内部排布、交互细节、动效风格。
现有前端是毛坯，**不是设计稿**：不要照着它的排布改，也不要因为它没有某个视觉就认为后端没有对应能力。
下文第二、三、四节才是约束；没写到的，你说了算。

## 二、页面地图

七个入口，顺序固定。每页先看「主功能」，它是这一页存在的理由；「次功能」可以重排、折叠，但不能丢。
前端文件里，渲染函数是纯函数，事件在同文件的绑定函数或 `app.js` 中。

| 页面 | 主功能 | 次功能 | 前端 | 后端 |
|---|---|---|---|---|
| 课题展示 | 研究问题、下一步建议 | 子问题、待办 | `lib/views.js`：`topicOverviewHtml`、`subqBlockHtml`、`nextStepHtml`、`topicTodosHtml` | `domain/topic.ts`、`services/app.ts`；`/api/topics/:id/subquestions` |
| 文献整理 | 条目与附件 | 题录导入、表格查看与更正 | `app.js`：`paperHtml`、`renderPaperForm`、`renderLitTools`、`openTableMax` | `services/papers.ts`、`domain/literature.ts`；`/api/papers/:id/{update,attachments,topics}` |
| 领域知识积累 | 卡片审阅：待审 → 已入候选 / 已跳过 / 已排除 | AI 队列、原文定位、重要程度与备注 | `lib/pages/knowledge.js` | `services/knowledge.ts`、`services/ai.ts`、`services/app.ts`；`/api/knowledge/jobs/:id/{cancel,pause,resume,retry-chunk}`、`/api/cards/:id/review` |
| 实验方案管理 | 实验图 | 步骤编辑、影响分析、模板、导出 | `app.js`：`diagramHtml`、`stepEditorHtml`、`impactHtml`、`protocolMainHtml`、`protocolSideHtml`；`lib/lanes.js` | `services/experiment.ts`、`domain/impact.ts`；`/api/protocols/:id/edit`、`/api/templates/:id/{confirm,check}`、`/api/impacts/:id/run` |
| 实验执行与记录 | 步骤记录表（左计划 / 右实际） | 准备稿、事件时间线、样品、测量、OCR | `app.js`：`stepsTableHtml`、`preparationHtml`、`recordHtml`、`ocrHtml`、`renderRecordTools` | `services/experiment.ts`；`/api/executions/:id/*`、`/api/samples/:id/*`、`/api/measurements/:id/edit`、`/api/ocr/:id/confirm` |
| 数据处理与分析 | 上下文地图 | 方法推荐、结果提交、分析初稿（报告块）、导出 | `lib/pages/analysis.js` | `services/analysis.ts`、`services/references.ts`、`services/export.ts`；`/api/analysis/*`（含地图接口）、`/api/reports/:id/*`、`/api/backtrace` |
| 上下文 AI 对话 | 范围限定的对话 | 冻结快照、建议采纳 | `app.js`：`chatHtml`、`chatRightHtml`、`renderChatForm` | `services/analysis.ts`；`/api/chats/:id/*` |

共用：`lib/format.js`（时间、枚举、版本格式化）、`lib/api.js`（接口封装）、`lib/lanes.js`（实验图布局）、`lib/refs.js`（对象引用读取：`topicObjects`/`refLabel`/`humanVer`，分析页与对话页共用）、`lib/views.js` 里的外壳与导航。知识页与分析页的渲染＋事件已在 `lib/pages/knowledge.js`、`lib/pages/analysis.js`（各自导出渲染纯函数与 `bindKnowledge`/`bindAnalysis`）。
改渲染先改纯函数并补 `tests/frontend-render.test.ts`；`app.js` 保持纯 JS，混入 TS 语法会让整页挂掉。

## 三、不能破坏的严密性

这些是产品的语义，与外观无关。你可以换样式，不能换含义。

1. **引用网络，不是链。** 回查按归属 / 溯源 / 数据链 / 科学依据四类边建立；缺一段就显示缺口，不画完整箭头伪装。
2. **原件不覆盖。** 更正保留旧值与原因，版本固定；正文不显示版本号，只在历史里露出，写作「第N版」。
3. **没有的就是没有。** 未配置、失败、过期都不等于「无影响」；未实现的功能不设假入口，禁用占位不发请求、不模拟成功。
4. **不预填。** 排除原因可空，暂停原因无预填，开始时间系统不代填。前端不得传默认值冒充用户输入。
5. **AI 产物须人确认。** AI 卡片先进待审，人确认才入候选；AI 草稿块标记保留；后台任务完成不得替换人正在审的卡。
6. **十个硬标记的语义保留**（样式随意）：定位不足、时长未知、未确认、不可复现、未配置、非作者原始、记录不改快照、源方案不影响本次、未实现、未验证。
7. **可见文本不出现**：ISO 时间、英文枚举（unreviewed / declared / exploratory / ai-draft）、裸 `rev N`、`fetch failed` 之类原始报错、docs 路径。时间一律 `11-18 12:35`。`scripts/frontend-text-check.ts` 会检查。
8. **计划与实际分开。** 记录页改的是实际层，不回写源方案；没做的步骤不从计划里消失。

## 四、两项已定的定制设计

### A. 知识页：吉祥物流水线

**意图**：右栏有一个吉祥物在加工，像一条流水线。卡片是一个个对象：AI 加工出厂 → 进入人的工作区 → 人点开完成审计项 → 放进不同容器。

- 对象与路径：卡片有稳定 ID（`data-cid`）。路径为 加工中 → 待审 → {已入候选 | 已跳过 | 已排除}，撤回是反向路径。
- **每条转移要有独立动效**：出厂、进入工作区、落入候选、落入跳过、落入排除、撤回。从 AI 转到人手里的那一步必须「有感」。
- 动效由**真实状态变化**触发。后端逐块落库一张，才出厂一张；不得用定时器伪造进度。
- 不打断人正在编辑的卡；不自动展开新卡；一次最多展开一张。
- 队列要表达：抽取中 d/t、已出 N、暂停 / 继续 / 取消、排队中（并发上限 1）、失败块与「重试」。
- 技术前提：现在中栏靠整块 `innerHTML` 重建，卡片 DOM 每次都被销毁，做不出「同一张卡移动」。需要带 key 的 DOM 复用或 FLIP 动画层，做在 `lib/pages/knowledge.js` 内。
- **吉祥物页本身先搁置**。当前只预留它的状态：待机、加工中、暂停、失败。形象与文案待定，勿自行定稿。

### B. 分析页：上下文地图要真是地图

**意图**：选上下文不是勾选清单，而是在一张图上看清「这次分析用到了什么、从哪来」。

- 节点：课题 → 子问题 → 方案 / 执行 / 样品 / 记录 / 数据。
- 边：只画由真实引用字段建立的关系，分四类显示；**不因为同课题就连线**。关联不等于依赖。
- 选择语义不变：**必选**（直接引用的数据及其来源方案 / 记录，锁定、不可取消）、**默认已选**（可取消）、**其他可选**（折叠）。
- 缺来源的数据显示缺口，可说明，不伪造、不阻塞。
- 选择结果仍写入同一份候选数据；快照冻结逻辑与「查看表格」入口保持。不逐项显示推荐理由。
- **数据来自后端只读接口**（已交付，ADR-0027；以代码为准）：
  - `GET /api/analysis/map?topicId=&subquestionId=&pick=table:ID,measurement:ID`：建任务前，按所选数据推导。
  - `GET /api/analysis/tasks/:id/map`：任务已建，按当前选择。
  - 返回 `{ ok, scope:{ topicId, subquestionId?, taskId?, frozen? }, nodes, edges, gaps, truncated }`。
  - 节点：`{ key, kind, id, label, version?, external?, role, selectable, adoptable, adoptBlockedReason?, gaps:[{code,label}] }`；`role` 取 `core`（必选，锁定）/ `selected`（已选）/ `optional`（可选未选）/ `context`（仅供看清来源，不可选）；`selectable = role∈{selected,optional}`。`adoptable` 与后端「采用」前置同口径（非新壳 + 已确认 + 有原文定位），**仅对 `adoptable` 的卡给「采用」按钮**；否则按 `adoptBlockedReason` 如实标注不可用，不给假入口。
  - 边：`{ from, to, edgeKind, establishedBy, note? }`，只来自 `buildNetwork`，**不要在前端自行连线或补边**。
  - `gaps` 汇总为 `[{ key, code, label }]`（label 为中文短词，如「来源缺失」）；`truncated` 为真表示节点被截断（上限 300），界面须提示。
  - 错误：`topicId` 缺失/不存在、任务不存在 → **404**；`pick` 项不存在/不属本课题/类型不支持 → **422**。
- **必选推导已收进后端**（测量 → 样品 → 执行 → 方案，纯函数 `deriveCore`）。新界面不要再各自实现一份，直接用接口返回的 `core`；选择变更仍走现有 `POST /api/analysis/tasks/:id/candidates`，建任务仍走现有创建接口。
- 接口只读，不会写数据、不触发 AI。

## 五、动效通则

- 动效只表达真实状态，不能伪造「已完成」，也不能代替状态文字。
- 必须尊重 `prefers-reduced-motion`：关闭位移动效，只保留状态变化。
- 动效不得阻塞操作；任何动画中用户都能点击、编辑、切页。

## 六、工程与验收

- `cd sciworkbench && npm test` 全过；`node scripts/frontend-text-check.ts` 7/7（它会拦「缺导航项」与「一直连接中」）。
- 验证只用 Edge、离屏；截图由用户截，不虚构截图。
- AI 配置落盘到本机数据目录 `ai-config.json`（不入库；环境变量优先，ADR-0024），Key 默认不读不打印；左下角「模型设置」可测试连接、列可用模型。达尔文 / 密立根测试包是私人材料，不进 `public/samples/`、不入公开仓库。
- 无构建步骤，`node server.ts` 直接跑；不引入框架与依赖。
- 动之前先问用户的遗留项：「意外影响环节」单选还是多选；详情里的完整原始响应；实验图导出的剩余缺口。

## 七、建议（非硬性）

文案尽量短：按钮 ≤6 字，导航用短词，已定义的术语不加长句解释，不写补白句。这是用户 11-17 的口径，作为建议，新设计可与之商量。界面统一用「分析初稿」。

## 八、已知过期的文档

`docs/stage6/04_FRONTEND_REVIEW.md` 中「实验图列宽等分」「并发排队未做」「暂停 / 续跑未做」已被 S02-T42 与 ADR-0023 覆盖。冲突时以代码、`record/HANDOFF.md` 与 `docs/architecture/04_ADR.md` 为准。
