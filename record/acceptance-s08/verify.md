# S08 公开展示版 · 验收判定表（E）

> 执行者：executor-e｜轮次：S08-T7｜执行日期：2026-11-24｜**本地验收完成**
> 判定口径：逐项「通过／失败／未测」，只在有本轮工具输出支撑时判通过。

## 结论速览

| 项 | 判定 | 说明 |
| --- | --- | --- |
| E1 首页主课题·暖色·无后端 | **通过** | 7/7 子项 |
| E2 文献库·待审/已审·回查·比较 | **通过** | 8/8 子项 |
| E3 报告→分析/记录/表→原件 | **通过** | 4/4 子项 |
| E4 上下文图/预生成/下一步 | **部分** | 5/5 子项通过；但本轮无真实模型生成（A 未授权），页面如实标注「未调用（未授权）」，见 §E4 披露 |
| E5 ZIP 下载·解包·哈希 | **通过** | 5/5 子项，哈希与 A 记录一致 |
| E6 折扇/抽屉·键盘·偏好·减少动效 | **通过** | 12/12 子项，四档视口 |
| E7 请求记录·发布文件 | **通过（本地）／发布环境未测** | 零 `/api`、零 `/functions`、零外部业务主机、零写入；Qoder 发布环境未验 |
| E8 断引用复测 | **通过** | 临时副本缺资产 → 明确「本栏读取缺项」，非白屏、无补造 |

**阻断缺陷：0。** 详见 §缺陷与误报。

## 冻结输入（实测核对）

| 字段 | 值 |
| --- | --- |
| 集成分支 / HEAD | `feat/s08-d-integration` / `3103888`（父：`28e1705`、`2c4fd87`、`89e89f1`） |
| 生成物目录 | `F:/Qoder dev competition/.worktrees/d/locus-site/web` |
| 版本号（meta / window） | `s08-public-3103888`（两项一致） |
| ZIP | `demo-data/locus-demo-public.zip`，SHA-256 `785b468908b0f024…f4312b`，与 `SHA256SUMS.txt` 及页面显示一致；SHA256SUMS 19 项全部 `OK` |
| 本地入口 | `http://127.0.0.1:8785/` → 302/刷新到 `/demo/demo.html#/topic` |
| 采集环境 | Edge `157.0.4341.60`（系统 Edge，非 Chrome）；Playwright 1.63.0；无头离屏；视口 1440×900/1280×720/1024×768/390×800 |
| 离线口径 | 仅本机静态服务（Python http.server），**未启动任何 Node 后端**；外部解析用 `MAP * ~NOTFOUND, EXCLUDE 127.0.0.1` 阻断 |
| 证据目录 | `record/acceptance-s08/evidence/s08-t7/` |

## E1 首页（无痕上下文）

| 判定项 | 结果 | 关键证据 |
| --- | --- | --- |
| E1.1 直接进入主课题 | 通过 | url=`…/demo/demo.html#/topic`，课题「种子经海水漂流后的萌发（达尔文 1859）」 |
| E1.2 全站暖色 | 通过 | `html[data-theme]=paper` |
| E1.3 非夹具占位 | 通过 | 无 `.demo-fixture` 提示条 |
| E1.4 构建版本 | 通过 | `s08-public-3103888` |
| E1.5 无未捕获异常 | 通过 | pageerror 空；console 无 error |
| E1.6 预存 `locus.theme.v1=tech` 后刷新仍暖色 | 通过 | `paper` |
| E1.7 无冷色切换入口 | 通过 | `#theme-seal`/`#replay-theme`/主题按钮 计数 0 |

证据：`E1_home.png`、`E1_tech_refresh.png`、`console.json`、`-result.json`。

## E2 文献库

| 判定项 | 结果 | 关键证据 |
| --- | --- | --- |
| E2.1 待审/已审可区分 | 通过 | 10 卡：8「已确认」+ 2「待审」 |
| E2.2 存在待审卡 | 通过 | 同上 |
| E2.3 卡片详情含条件/单位/出处定位 | 通过 | `E2_card_pending.png` |
| E2.4 原文定位逐字命中 | 通过 | `<mark>` 命中 1 处 |
| E2.5 定位到同一引文 | 通过 | mark 文本与卡片「原文」blockquote 一致（Martens 实验段） |
| E2.6 比较视图两边来源 | 通过 | 2 行来源；「静水实验 vs 真实海水（干湿交替）」 |
| E2.7 共同指标/条件差异 | 通过 | 页面含「共同指标」「条件差异」，并标「独立性：未具备（同页转引）」 |
| E2.8 比较可回查原文 | 通过 | 行内「回查原文」跳回 `article.demo-src` |

证据：`E2_card_pending.png`、`E2_backtrace.png`、`E2_compare.png`。

## E3 报告回查链

| 判定项 | 结果 | 关键证据 |
| --- | --- | --- |
| E3.1 报告块有可回查引用 | 通过 | 5 个回查按钮 |
| E3.2 引用覆盖多类对象 | 通过 | `card`、`result` 等 |
| E3.3 每跳可点且无缺项 | 通过 | 4 跳均无 `.demo-miss`；hash 指向对应对象 |
| E3.4 结果附件到原件 | 通过 | `原件 · flotation-summary.csv` |

证据：`E3_report.png`、`E3_after_ref.png`。

## E4 上下文图 / 预生成 / 下一步（部分）

| 判定项 | 结果 | 关键证据 |
| --- | --- | --- |
| E4.1 下一步 1–2 条 | 通过 | 2 条 |
| E4.2 依据四要素 | 通过 | 证据分歧／要补什么数据／可区分解释／仍不确定 全部展开 |
| E4.3 实跑上下文图节点 | 通过 | 13 节点、19 边（实跑 `context-map.json`） |
| E4.4 图节点可回查 | 通过 | 点节点跳到对应卡片/原文 |
| E4.5 预生成/只读标识 | 通过 | 页脚「预生成：未调用（未授权）· 11-24 18:26 · 人工核对后公开展示」「本页不触发后端」 |

**§E4 披露（为何记「部分」）**：`snapshot/ai-products.json` 记本轮**未调用模型**（未授权），故「预生成方案/对话」不是真实模型产物，页面以「未调用（未授权）」如实标注、未伪装为模型生成。上下文图与引用网络为真实实跑数据，且可回查；但按手册「若某项只能用已有结果，验收记作部分」，E4 不记完全通过。**这不是页面缺陷，是 A 侧素材限制**，需 A 补真实模型产物后复验。

证据：`E4_nextstep.png`、`E4_map.png`。

## E5 评委 ZIP

| 判定项 | 结果 | 关键证据 |
| --- | --- | --- |
| E5.1 ZIP 可下载并打开 | 通过 | 13 个条目 |
| E5.2 ZIP 哈希一致 | 通过 | `785b4689…f4312b`（下载件 = 站点件） |
| E5.3 页面显示哈希一致 | 通过 | 页面 SHA-256 = 实测 |
| E5.4 许可与指引齐全 | 通过 | `README.md`、`docs/五步走查.md`、`docs/来源与许可.md`、`docs/站内映射.md` |
| E5.5 原件齐备 | 通过 | 9 个 `originals/*` 与站点引用对应 |

证据：`downloaded.zip`、`run.log`。

## E6 折扇与设置

| 判定项 | 结果 | 关键证据 |
| --- | --- | --- |
| E6.1 打开且焦点进入 | 通过 | `aria-expanded=true`，焦点在扇内 |
| E6.2 Tab 焦点限制 | 通过 | 14×Tab + Shift+Tab 不逃逸 |
| E6.3 Esc 关闭并归还焦点 | 通过 | 焦点回到 `#settings-open` |
| E6.4 偏好刷新保留 | 通过 | compact/lg/reduced 刷新后保持 |
| E6.10 页签鼠标可点击 | 通过 | 鼠标切到「模型」成功（见 §误报） |
| E6.5 模型页只读无密钥控件 | 通过 | 无 key/保存/测试 |
| E6.11 键盘可切页签 | 通过 | Enter 切「模型」 |
| E6.6 关于显示构建版本 | 通过 | active=about，含 `s08-public-3103888` |
| E6.12 窄屏抽屉页签可点击 | 通过 | 390×800 切「模型」成功 |
| E6.7 四档内容面板无错位 | 通过 | 四档 `.fan-content` 均在视口内 |
| E6.8 系统减少动效生效 | 通过 | `data-motion=reduced`，即时开合 |
| E6.9 存 tech 仍暖色且无冷色控件 | 通过 | `paper`，控件 0 |

证据：`E6_desktop_open.png`、`E6_prefs.png`、`E6_1440x900.png`、`E6_1280x720.png`、`E6_1024x768.png`、`E6_390x800.png`、`E6_reduced.png`。

## E7 请求审计与发布文件

- 页面级请求（Playwright，权威）：332 条；本机同源 231 条（仅静态资源与快照 JSON），外部仅本机卡巴斯基 HTTPS 注入 101 条（环境噪声，非页面发起）。
- **`/api/` 与 `/functions/` 命中：0**；**外部业务主机（后端/模型/第三方）：0**；**写入方法（除 AV 注入）：0**。
- 静态服务日志：132 行，全部本机同源 200/404（404 仅 `favicon.ico`），`/api`·`/functions` 0 条。
- NetLog 旁证（独立进程）：`hosts.txt` 过滤后为空；raw 仅 Edge/Office/Bing 遥测与卡巴斯基注入。
- 发布文件扫描：无 `ai-config.json`/`api key`/`secret`/`test-packages`；`styles.css` 仅保留注释提及 tech，无 `[data-theme=tech]` 规则；`assets/` 仅 `fonts`、`paper`。
- **Qoder 发布环境：未测**（本轮仅本地静态验收）。

证据：`requests.json`、`server.log`、`netlog/`（netlog.json、hosts.txt、hosts-all.txt、api-hits.txt、shot.png）。

## E8 断引用复测

- 方法：复制生成物到 `F:/temp/e-break`，从 `snapshot/state.json` 删除被卡片引用的资产 `ast_907d8227-…`，其余不变；静态服务打开 `#/papers`。
- 结果：右栏显示「本栏读取缺项 / 路径：asset:ast_907d… / 原因：原条原件不存在」，并提供「重新载入」「下载样本 ZIP」；**无白屏、无静默补造**。
- 回到正式候选复验：同路径正常（见 E2）。
- 证据：`E8_break.png`、`E8_break.json`、`E8_break_diff.txt`。

## 缺陷与误报

- **阻断/一般缺陷：0。**
- 误报记录（避免误传）：首轮自动化在「设置页签鼠标点击」上报 `Locator.click` 超时。人工复查为**自动化时序问题**（折扇开合过渡未 settle 即点击）；修正为等待 `#settings-fan.is-open` + 指针预热后，连续多次复跑均通过（E6.10、E6.12），且 CDP 真实指针/键盘均生效。**非产品缺陷，不退回。**
- 环境噪声说明：本机卡巴斯基 HTTPS 注入（`me.kis.v2.scr.kaspersky-labs.com`）会出现在页面请求表中；NetLog 另含 Edge/Office/Bing 遥测。均与页面无关，已在判定中排除并保留 raw 证据。

## 未测项

1. **Qoder 发布环境**：仅本地静态候选通过；平台预览/线上入口未验。
2. **真实模型产物**：A 本轮未授权模型调用，E4 记「部分」。
3. **真实评委浏览器组合/网络环境**：仅 Edge 157 无头离屏。

## 复跑方式

```bash
# 1) 起本地静态服务（不启动 Node 后端）
NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 \
  python -m http.server 8785 --directory "F:/Qoder dev competition/.worktrees/d/locus-site/web"
# 2) 运行 45 项判定（Edge 无头、离线解析）
PYTHONIOENCODING=utf-8 python record/acceptance-s08/scripts/run_acceptance.py \
  --base http://127.0.0.1:8785 --out record/acceptance-s08/evidence/s08-t7 \
  --zip "F:/Qoder dev competition/.worktrees/d/locus-site/web/demo-data/locus-demo-public.zip"
# 3) 独立 NetLog 旁证
bash record/acceptance-s08/scripts/smoke-capture.sh "<生成物目录>" "<输出目录>" "http://127.0.0.1:8792" 1440x900 /
```
