# LOCUS 交接文档（下一执行区初始提示词）

> 用法：将本文件全文作为新会话的初始提示词。文中引用的文档都在仓库内，**先读再动手**。
> 本文件只保留最终版；状态以 `git log` 与 `record/COMMIT_LEDGER.md` 为准，本文与其冲突时以仓库实际状态为准。

---

你是 LOCUS 项目的执行 agent。LOCUS 是 2026 Qoder 高校创造力大赛（StudyHack 赛道）参赛作品：一个面向实验科研全过程的本地工作台（课题→文献→知识→方案→执行记录→分析→报告），零依赖、单进程、数据落本地 JSON。仓库 `fatenotontime/Qoder-LOCUS`，**截止 2026-11-30 18:00**。代码主体在 `sciworkbench/`（Node 24 原生 TS 剥离，无构建步骤，`node server.ts` 直接跑）。

## 一、开工前必读（按此顺序）

1. `AGENTS.md` —— 协作与记录纪律，**每轮收尾必须执行其检查清单**（先 git log 取真实 hash，再写台账与轮次记录；提交带 `Turn:`/`Agent:` trailer）。
2. `docs/architecture/00_ARCHITECTURE.md`、`01_DOMAIN_SCHEMA.md`、`02_API_CONTRACT.md`、`03_AGENT_RUNTIME.md` —— 架构、领域模型、API 契约、AI 运行时。
3. `docs/architecture/04_ADR.md` —— 全部决策记录。重点：ADR-0018（后台任务合并写回，不换当前审阅版本）、ADR-0019（实验图 archify 合同）、ADR-0020~0023（阶段6 与前端纠偏轮决策，含排除原因可选、暂停/继续＋AI 并发排队）。
4. `docs/stage6/04_FRONTEND_REVIEW.md` —— **前端现状权威**：A 全局外壳＋B1–B7 逐页已做/未做/与需求不同，含三处明确回答（实验图轴/分组/导出占位）。注意其后的 S02-T42 又补了 B3 时间等比轴、B5 必选自动推导＋上游复核、B2 暂停/继续＋并发排队（见 `record/sessions/2026-11-17_session-02.md` 的 S02-T42 与 ADR-0023）。
5. `docs/stage6/03_ACCEPTANCE_REPORT.md` —— 阶段6（报告块化/引用网络/改动命中/导出与追溯包/整体导出恢复）验收结论。
6. `docs/stage5/05_EXPERIMENT_ARCHIFY_CONTRACT.md` —— 实验图合同（用户自有草案当规格；AI 重排**不接入**）；`docs/stage5/02_HIDDEN_FEATURES.md` —— 已实现/未实现能力清单；`docs/stage5/04_UI_TERMS.md` —— 界面用词表。
7. 需要回溯早期阶段时再查 `docs/stage0/`（知识库/功能图/保护清单）、`docs/stage3/01_WEB_LOOP.md`、`docs/stage4/`（债务/前端交接/稳定化/验收）。

## 二、硬约束（不得违反）

- **领域语义**：三条业务路径、两类事件；回查是**引用网络**（affiliation/provenance/lineage/support 四边型），不是串联链。记录四约束：保表结构、更正留历史、原件超限显式拒绝、AI 解析走独立任务。
- **前端文案**：导航/按钮短词（≤4字优先）；架构文档已定义术语不写长句解释；禁过度说明。渲染可见文本不得出现：ISO 时间（`\d{4}-\d{2}-\d{2}T`）、英文枚举（unreviewed/declared/exploratory/ai-draft）、裸版本（`rev N`，一律「第N版」且正文不显版本仅历史露出）、原始报错（fetch failed）、docs 路径、「（全部课题）」。时间格式 `11-18 12:35`。
- **`public/app.js` 是纯 JS**，严禁混入 TS 类型语法（曾致整页挂掉）；纯渲染函数在 `public/lib/views.js`、格式化在 `public/lib/format.js`，改渲染优先改这两处并补 `tests/frontend-render.test.ts` 断言。
- **控件挪栏必须挪处理器**：中栏控件用文档级 click 监听器承接；点击命中用 `closest()` 不用 `target.classList`。
- **AI 配置**：**本机落盘** `<数据目录>/ai-config.json`（含 Key 明文、不入库；启动读回，环境变量优先；ADR-0024）；界面当前模型 mimo-v2.6-flash 保持原样；Key 用本地 `.env`/`.env.ai` 由用户自填，**默认不读不打印 Key**；左下角「模型设置」可测试连接与列出可用模型。
- **私人材料**：达尔文/密立根测试包仅内部验收用，**不进 `public/samples/`、不入公开仓库**。
- **验证一律离屏**，浏览器只用 Edge（不启 Chrome）；关键节点**截图由用户截**，agent 只引用真实存在的路径（`record/screenshots/`）。
- 不改他人分支既有记录；不重写已推送历史；工作区内未跟踪的用户材料（如 `vibe_images/`、`record/screenshots/from-pictures/`、`reference reseach data/` 下用户自行解压的目录）**不删不擅自提交**。

## 三、当前状态（2026-11-19 交接时点）

- 分支 `main`，功能提交至 `2fefb58`（前端 B+C），记录至 `34ca3b1`；已推 GitHub。
- **阶段 0–6 全部完成并验收**；前端纠偏 A、B1–B7、B 功能补齐、C 轻量打磨完成。**阶段 7 未开始**，进入前听用户指令。
- 测试：`cd sciworkbench && npm test` → **193 项全过**（含 `tests/ai-config.test.ts`、`tests/archify.test.ts`）；逐页真渲染检查 `node scripts/frontend-text-check.ts` → **7/7**（该脚本含「真渲染」判定：缺 navitem 或状态仍「连接中」即失败，防 JS 报错假通过）。
- 运行实例：**5184**＝验收实例（`data/acceptance-darwin.json`）；**5187**＝达尔文演示（`data/demo-darwin.json`，已重启加载新后端；**AI 配置需用户在页面重填**）。
- 推送若经代理 7897 失败：`git -c http.proxy= -c https.proxy= push` 直连。

## 四、用户验收规程（用户说"验收"时照此执行）

1. `cd sciworkbench && node scripts/acceptance-darwin.ts` 一步生成 `data/acceptance-darwin.json`（达尔文闭环预导入；缺 test-packages 会报错）。
2. `PORT=5184 LOCUS_DATA=data/acceptance-darwin.json node server.ts`，用 Edge 打开 `http://127.0.0.1:5184`。
3. 每轮验收先重置隔离数据防 409；材料交付态＝已提交未处理；直进主页面，不用页内验收材料 panel。
4. 每轮自验收必开**简洁性专项**（跑 frontend-text-check）。

## 五、遗留与待拍板（均已如实登记，动之前先问用户）

见 `docs/stage6/04_FRONTEND_REVIEW.md`「未做」节与「六、修订（S02-T42 / S02-T44）」：
- §三.8 界面「详情」原始响应完整覆盖（目前仅 recommend 有「AI 原始返回」折叠，其余留痕于 audit；仍**未内联**）。
- 意外影响环节已**改多选**（S02-T44，ADR-0026）；一次意外可勾多个受影响步骤。
- experiment-archify 合同**剩余唯一缺口**：逐节点「原方案来源/现场补充/未决项」标记（条款8）。A/C/E（由量·速率计算／等待余量吸收延迟／导出 HTML·PNG）已于 S02-T44 补做（ADR-0025）。
- 密立根 Table XX 待用户转录；真实手写 OCR 未经真实模型验证。
- **实验图 PNG 导出未在真实浏览器点击实测**（离屏无法验证下载内容）；HTML 导出为纯字符串构造。
- 阶段 7 未开始；`docs/stage7/` 已有**用户新增的协作者指南与拆分提示词**（未跟踪，勿擅动）。

## 六、每轮收尾（AGENTS.md 摘要，全文以 AGENTS.md 为准）

git log 核对真实提交 → `record/COMMIT_LEDGER.md` 双线表＋轮次索引追加 → `record/sessions/` 叙述记录（会话号沿用 S02 或新开 S03，轮次递增）→ 提交带 `Turn: S0x-Tnn` / `Agent: <标识>` trailer → 推送。无提交的轮次显式记「本轮无提交」。