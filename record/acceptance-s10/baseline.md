# S10 本地展示整改 · 开工基线 R01–R04（executor-e3）

- 轮次：`Turn: S10-T4` ／ 验收者：`executor-e3`（业务代码只读）
- 候选：`feat/s08-public-demo` HEAD `b7086c4`（构建版本 `public-b7086c4`）
- 结论：**R01–R04 基线全部暴露缺陷**（详见各节）。这是开工基线，供各角色定位；并非对整改后的判定。

## 0. 冻结信息与启动

| 项 | 值 |
| --- | --- |
| 候选分支 / HEAD | `feat/s08-public-demo` · `b7086c4` |
| 公开静态 | `http://127.0.0.1:5380/`（`--mode=public`，**无 Node**） |
| trial（→ 原生 Node） | `http://127.0.0.1:5281/`（反代 `/functions/v1/app/api/*`→5284） |
| 原生 Node | `http://127.0.0.1:5284/`（`sciworkbench/server.ts`） |
| 模型替身 | `http://127.0.0.1:5490/v1`（`stub-model.mjs`，knowledge_struct 延迟 8s） |
| 临时目录 | `F:/qoder-dev-tmp/s10-e3-b7086c4`（`web-public`、`web-trial`、`node-data`、`logs`） |
| 验收数据副本 | `node-data/state.json` = 公开快照 `locus-site/demo-data/snapshot/state.json` 的拷贝 |

端口偏离说明：本机 `5280`（b3 公开静态）与 `5290`（b3 模型替身）已被并行角色占用，`5283` 被 QQ 占用；本轮改用 `5380 / 5281 / 5284 / 5490`，并在开工前探测空闲。启动命令见 `scripts/README.md`。

## 1. R01 上下文选择与推荐 —— 失败

模式·版本：可写态（trial 5281 → Node 5284）· `b7086c4`

- 点击或输入：分析页选中既有任务（3 张候选卡均勾选）→ 取消「知识卡 · 作者修正意见」→ 填研究目的 → 点「发起方法推荐」。
- 实际状态／文件：
  - 界面：取消后 UI 勾选 = **2**。
  - 冻结快照：替身收到的模型输入上下文摘要仍为「核心 2 ＋ **候选 3**」（`evidence/raw/baseline_r01_r04.json` `r01.stubRequest.userHead`）→ **界面 2 ≠ 快照 3**。
  - 空子问题：经 API `POST /api/analysis/tasks` 不传 `subquestionId` → **200 成功创建** `atask_9de25570…`（`r01.emptySubqCreate`），**未就地拦住**。
- 判定：**不通过**。取消的候选仍进入冻结快照；空子问题未被拦。

## 2. R02 课题切换与迟到响应 —— 失败

模式·版本：可写态 · `b7086c4`

- 点击或输入：以 A（达尔文课题，有文献与 10 卡）经 API 发起语义提取（run `kr_e777ac8a…`，2 块）→ 进知识页 → 顶栏 `#topic-select` 切到 B（`topic_1dbb263a…`）→ 等 9.5s 回执到达 → 回 A。
- 实际状态／文件：
  - 切到 B 后 `#topic-select` 值确为 B，但知识页左栏文献 `#kz-paper` 仍为 A 的 `paper_a4936b8e…`，正文/主题仍显示 A 的 10 卡与队列（`r02.onB_initial`）。根因迹象：切课题时未重置 `ui.paperId`，知识视图按 `paperId` 作用域而非 `topicId`（`lib/pages/knowledge-stage.js` `scopedCards`）。
  - 回执到达后：仍在 B 页面显示 A 的内容（`leaksA=true`，`r02.onB_afterReceipt`）。
  - 回 A：队列仍在，`stage=idle`；`finalRun.status=completed`。
- 判定：**不通过**。切到空课题 B 后，正文/队列/提示仍属于 A。

## 3. R03 执行记录草稿与失败反馈 —— 失败

模式·版本：可写态 · `b7086c4`

- 点击或输入：记录页加载执行（4 步）→ 第 1、2 行分别填入 `R03-ROW1`、`R03-ROW2` → 只点第 1 行「记录」；随后 `page.route` 把 `POST /api/executions/:id/events` 改成 503，再次点第 1 行保存。
- 实际状态／文件：
  - 保存第 1 行后：`row1="R03-ROW1"`、`row2=""`（第 2 行草稿被刷新丢弃）；执行事件 4→5（只追加 1 条）。`r03.afterSaveRow1`。
  - 失败注入后：行输入回退为已存值 `R03-ROW1`（本次 `R03-FAIL` 丢失）；`inlineErrorNearRow=false`、错误节点数 0；`#status` 仍显示上次成功文案「步骤已记录…」。`r03.afterFail`。
- 判定：**不通过**。另一行草稿未保留；失败无就地可见错误、状态文案过期。

## 4. R04 提取中填备注与切页/刷新 —— 失败

模式·版本：可写态 · `b7086c4`

- 点击或输入：知识页经 UI 点「发起语义提取」（`#k-start`）→ 提取中打开一张替身卡、在备注框输入 `R04-未保存备注`（仅 `input`，未失焦/未保存）→ 切到分析页再返回 → 刷新页面。
- 实际状态／文件：
  - 提取中舞台 `stage=working`（0/2 块，暂停/取消可见）——经 UI 发起时舞台能进入加工中。
  - 切页返回后：备注框 `value=""`（**未保存备注静默丢失**），舞台仍 `working`，卡仍展开（`r04.afterReturn`）。
  - 刷新后：舞台 `stage=idle`／「待机」（与仍在进行的任务不符），队列仍在（`r04.afterReload`）。
- 判定：**不通过**。未保存备注无保护规则；刷新后舞台状态与实际任务不一致。

## 5. R05 公开静态（顺带实测，属 R05 部分）

- 无 Node 打开 `5380/`：`data-theme=paper`、`data-display-mode=on`、badge「展示课题 · 只读」、8 个导航项；遍历 library/protocol/record/analysis/chat 全程 **`/api` 命中 0**、`/demo-data` 命中 17、外链 0（`evidence/raw/r05_r10_skeleton.json` `r05.req`）。
- 对象级点击断言（文献卡/方案/记录/方法/初稿/对话）**尚未实现**，留作新候选全量。

## 6. 脚本与证据位置

- 脚本：`scripts/stub-model.mjs`、`scripts/baseline_r01_r04.mjs`、`scripts/r05_r10_skeleton.mjs`、`scripts/README.md`。
- 证据：`evidence/raw/baseline_r01_r04.json`、`evidence/raw/r05_r10_skeleton.json`、`evidence/screens/r01_recommend.png`、`r02_onB.png`、`r02_backA.png`、`r03_fail.png`、`r04_reload.png`、`r05_public.png`、`r08_narrow.png`。
- 台账与空模板：`record/acceptance-s10/verify.md`。

## 7. 未测 / 下一依赖

- R04 用替身造卡（`knowledge_struct` 返回 1 张验收标卡），非真实模型；真实模型质量不在本轮范围。
- R06–R10 在 `scripts/r05_r10_skeleton.mjs` 中仅为骨架（`status=TODO/PARTIAL`），待集成负责人交付新入口后按选择器补全。
- 设置折扇：脚本点击 `#settings-open` 后未检出 `#settings-fan-title`（`r08.settingsOpen=false`），选择器/入口需按新候选核对后再判定。
- 下一依赖：等集成负责人通知新候选后，用同一 `scripts/` 在**同一候选**上全量复跑 R01–R10 并填 `verify.md`。
