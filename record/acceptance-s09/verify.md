# LOCUS S09「展示模式」独立验收报告（executor-e2）

- 轮次：`Turn: S09-T22` ／ 验收者：`executor-e2`（独立会话，业务代码只读）
- 验收对象：候选 = 集成分支 `feat/s08-public-demo`（首轮 `a1f07ef`；**复验候选 `83e6996`**，修复 `d9b9072`）
- 结论速览：**E1/E2/E3/E4/E5/E6/E7 通过；E8 未测。**
- 发布判定：**E4 已修复复验通过**；可提交用户确认发布（E8 待有上传环境补测）。

---

## 0. 冻结信息（本地验收，非发布环境）

| 项 | 值 |
| --- | --- |
| 候选 commit | 首轮 `a1f07ef382e277f4cb1006c70279065d84cbdfb8`；**复验候选：`feat/s08-public-demo`=`83e6996`（修复 `d9b9072`），并入 e2 后 HEAD `470f127`** |
| 验收分支 | `feat/s09-acceptance`（worktree `.worktrees/e2`；复验用 `git merge` 并入集成分支） |
| 构建版本注入 | 首轮 `s08-public-a1f07ef`；**复验 `s08-public-470f127`**（`<meta name=locus-build-version>`，设置「关于」同值） |
| 快照 manifest | schemaVersion=1 · fixtureVersion=`s08-a-fixture-1` · sourceCommit=`8120986` · projectId=`topic_f6bff443-3f74-4677-810d-0c15c7d06bf0` · verificationStatus=`verified-local` |
| 公开构建命令 | `node locus-site/build-web.mjs sciworkbench/public <tmp>/web-public --mode=public`（产物置于仓库外 tmp，避免污染分支） |
| trial 构建命令 | `node locus-site/build-web.mjs sciworkbench/public <tmp>/web-trial --mode=trial` |
| 展示适配器单测 | `node --test locus-site/web-overlay/display/tests/display-api.test.mjs` → **14/14 通过** |
| 仓库回归 | `npm --prefix sciworkbench test` → **353/353 通过**（从主工作区补入 gitignore 的 `test-packages/`） |
| ZIP 哈希 | `locus-demo-public.zip` sha256 = `785b468908b0f0246b4e0cafb407a8f4e66d2fbb4db31ed6599fba9f68f4312b`（与 `demo-data/SHA256SUMS.txt` 一致） |
| 发布副本哈希 | `sha256sum -c SHA256SUMS.txt`（对 `<tmp>/web-public/demo-data`）→ **19/19 OK** |
| 运行环境 | Node 硬断：无任何 Node 业务后端，仅 `python serve.py`（本地静态托管，逐请求写日志）；无头 **Edge**（Playwright `channel:msedge`）离屏 |

---

## 1. 逐项判定表

| 项 | 判定 | 实测要点（证据见 §4） |
| --- | --- | --- |
| **E1** | ✅ 通过 | 断 Node 无痕开 `/`：停在 `/`（无重定向），进入**原工作台**（title「研迹 LOCUS·科研上下文工作台」、8 项原导航含末端「文献库」、三栏俱在）；默认选中预存课题（达尔文 1859）并挂「展示课题 · 只读」标识；`data-theme=paper`（暖色）；冷色切换 `#theme-seal`/`#replay-theme` 被遮罩覆盖不可见（点击后主题仍为 paper）。刷新后同上；旧链 `/demo/demo.html` 落到同一工作台（`location.replace('/')`）。**业务 API 请求 = 0**（`/api/`、`/functions/` 命中 0/323）。 |
| **E2** | ✅ 通过 | 文献库：10 张证据卡，**8 已确认(ok)/2 未审(warn) 状态区分清楚**；卡片展开显示条件/字段/单位/未知项表；「在原文中定位」跳原文并逐字高亮（命中 `ripe hazel-nuts sank immediately, but when dried, they float`）；「两端对照」表 2 行、含来源/指标/值/条件/二手与条件差异、可点回卡片；「引用回查」4 组/32 节点/64 边。 |
| **E3** | ✅ 通过 | 分析页含报告（1）、结果回查按钮 5 个、查看表格 1 个、实跑上下文图；点「回查」就地展开 `refnet-body`（含知识卡等下游节点，无缺项）；点「查看表格」进入表格视图（`#table-max` 出现，body[data-nav]=analysis）。 |
| **E4** | ✅ 通过（复验） | **首轮失败**：下一步指导四字段全「（未提）」。**复验候选 `83e6996`（修复 `d9b9072`，消费端对齐适配器输出形状）**：2 条建议标题正常（「在真实海浪/干湿交替条件下复测…」/「补齐原文条件与样本清单…」均带「待验证」标），展开后**四要素全部为真实内容**（证据分歧/缺口、要补什么数据、能区分哪个解释、仍有什么不确定，无「（未提）」）；每条含 4 个「可回查」引用，点击就地调 `backtrace` 展开 `.refnet-body`（含知识卡等下游节点）；全程零 `/api`。实跑上下文图（13 节点）与预生成对话仍正常。证据：`evidence/raw/e4_retest.json`、`evidence/screens/e4_retest_topic.png`。 |
| **E5** | ✅ 通过 | 页面链接下载 ZIP：`href=/demo-data/locus-demo-public.zip`；取回 26204 字节，sha256 与 `SHA256SUMS.txt` 一致；解包 13 项，含 `README.md`、`docs/五步走查.md`、`docs/来源与许可.md`、`docs/站内映射.md`、`originals/**`（许可与指引齐全）。 |
| **E6** | ✅ 通过 | 展示构建：左栏底部 `#settings-open` 开折扇（题签 外观/模型/关于）；四视口降级正确——1440×900、1280×720、1024×768 `data-fan-sheet=false`（折扇），**390×800 `data-fan-sheet=true`（底部抽屉，圆角顶、贴底，height=min(86dvh,680)）**；改疏密/字号后 `locus.density.v1`/`locus.fontsize.v1` 持久、刷新保留；`Esc` 关闭且焦点归还 `#settings-open`；`prefers-reduced-motion:reduce` 生效；「模型」签**无密钥/地址/保存/测试控件**（password=0），显示「结果为预生成 · 公开版不连模型」；「关于」用构建注入版本。**trial 构建**：`__LOCUS_DISPLAY__` 不存在、默认纸色，`#theme-seal`/`#replay-theme`/`#ai-open` 均在，点 `#theme-seal` → `data-theme=tech`、`body.theme-tech`（冷色可用）。 |
| **E7** | ✅ 通过 | 公开主线请求记录（323 条）**零 `/api/`、零 `/functions/`**；无外部模型/业务接口调用；发布目录扫描**无** `*key*/*secret*/.env*/ai-config*/*.pem/*token*`，无 `test-packages`/私有目录，正文无 `SITE_SERVER_TOKEN/BACKEND_BASE_URL/LOCUS_AI_KEY/PRIVATE KEY`；应用自身无写方法请求（唯一的 POST 来自卡巴斯基 AV 注入脚本，见 §4 说明）。 |
| **E8** | ⚠️ 未测 | 本轮**未启动**任何本地/已授权私网后端，无「上传并入库的个人课题」环境，故不测、不凭静态截图宣称两源一致。 |

**回归抽检（复验候选 `83e6996`）**：E1 —— `data-theme=paper`、无重定向、默认选中预存课题、挂只读标识、8 导航俱全、**业务 API 请求 0**；E5 —— 页面 ZIP 链接 26204 字节、sha256 `785b4689…` 与清单一致；E6-trial —— `__LOCUS_DISPLAY__` 不存在、点 `#theme-seal` → `data-theme=tech`。均未回归。✅

**断引用复测**：复制公开生成物 → 改断一张卡的原件引用（`card_8a4e4db2…` 的 `assetId` 改为不存在）→ 文献库显示「本栏读取缺项 · 路径：asset:ast_DOES_NOT_EXIST · 原因：原件不存在」（不补造）；对**未改动候选**复验：10 张卡、可正常展开详情。✅

---

## 2. 缺陷（1 项，已修复并复验关闭）

**D1 · E4 下一步指导字段全部丢失（依据不可回查）—— 已修复（`d9b9072`）并复验通过**
- 现象（首轮）：断 Node 打开 `/` →「课题」页右栏「下一步指导 · 预生成」显示 `1. 依据：（未提） 要补数据：（未提） 能区分：（未提） 仍不确定：（未提）`。
- 根因（口径不一致）：数据源 `next-steps.json` 字段为 `direction/basis.text/needData/distinguishes/stillUncertain`；适配器输出为 `{ title, text, basis:{divergence,dataGaps,distinguishing,uncertainty} }`（`locus-site/web-overlay/demo/a-snapshot.js:141-150`）；消费端却按原字段名读取（原 `sciworkbench/public/app.js:700-706`）。两边不匹配 → 全部回落「（未提）」。
- 修复：D 在消费端对齐适配器输出形状（`d9b9072`，改 39 行），四要素改按 `basis.*` 渲染、缺要素显式「缺项」不编造，并把 `refs` 渲染为「可回查」按钮（点击调适配器 `backtrace` 就地展开，仍零 `/api`）。
- 复验：`83e6996` 上四要素全部真实、回查可用（见 §1 E4 行）。**D1 关闭。**
- 附带（非阻断，未修）：`#theme-seal`/`#replay-theme` 在展示态仍带 `hidden` 但被 CSS 覆盖为可渲染、靠 desk-overlay 完全遮挡才不可见（像素采样：按钮区域纯色 0 方差）；功能上冷色未泄露，属潜在脆弱点，建议后续改用显式 `display:none`。

---

## 3. 未测项

- **E8（同一套样本：Site 预存课题 vs 上传个人课题 走同一渲染组件）**：未测。原因：本轮按要求「硬断 Node」做展示验收，未另起本地/私网后端接管上传分支；无可用上传环境，按手册 §E8 标「未测」，不以静态截图代替。

---

## 4. 证据位置（均在 `record/acceptance-s09/`）

- 结构化结果：`evidence/raw/accept.json`（首轮 E1–E7）、`evidence/raw/e1.json`、`evidence/raw/e6_probe.json`（四视口+三签）、**`evidence/raw/e4_retest.json`（E4 复验 + E1/E5/E6-trial 回归抽检）**。
- 请求记录：`evidence/requests/public-static.log`（323 条，`/api/`+`/functions/` = 0）、`trial-static.log`、`broken-static.log`。
- 下载物：`evidence/raw/downloaded.zip`（sha256 `785b4689…`，13 项）。
- 截图：`evidence/screens/e1_root.png`、`e1_legacy.png`、`e2_cards.png`、`e2_locate.png`、`e2_compare.png`、`e2_backtrace.png`、`e3_analysis.png`、`e3_table.png`、`e4_contextmap.png`、`e4_topic_right.png`、`e4_chat.png`、**`e4_retest_topic.png`**、`e6_fan_open.png`、`e6_narrow_drawer.png`、`e6_trial_theme.png`、`e6_after_reload.png` 等。
- 脚本：`scripts/serve.py`（静态托管+请求日志）、`scripts/e1.mjs`、`scripts/accept.mjs`（首轮 E1–E7）、**`scripts/e4_retest.mjs`（E4 复验）**。
- 启动方式：见 `scripts/README.md`。

> 说明：E7「外部/写请求」里出现的 `me.kis.v2.scr.kaspersky-labs.com` 为该机器上卡巴斯基安全软件的浏览器注入脚本，与本应用无关；剔除该域名后应用自身无任何外部或写请求。

---

## 5. 给协调者的结论

1. 原工作台「双数据源」展示接线在断 Node 下成立：`/` 不重定向、暖色只读、零业务 API；**经修复后 E1–E7 全部通过**，trial 冷色与个人模式入口未被破坏。
2. **E4 阻断缺陷 D1 已修复（`d9b9072`）并在候选 `83e6996` 复验通过**；复验同时抽检 E1（暖色/无重定向/零 `/api`）、E5（ZIP sha256 一致）、E6-trial（点 `#theme-seal`→冷色）**均未回归**。
3. **可提交用户确认发布**；发布替换仍由用户确认。
4. E8 因无上传环境未测，需在具备本地/私网后端时补做；不以静态截图代替。
5. 本地验收结论与 Qoder 发布环境分开记。
