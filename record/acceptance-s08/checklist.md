# S08 公开展示版 · 独立验收清单（E）

> 对应施工手册「E. 独立验收和返修」表 E1–E7。本清单为**可执行**版本：每一项给出点击动作、通过标准、取证手段与证据命名。
> 状态：准备就绪，等待 D 候选。候选到手前不测业务页面。

---

## 0. 被测对象与冻结输入（待 D 提供后填写，填完即冻结）

| 字段 | 值 | 来源 |
| --- | --- | --- |
| 候选版本号 | ____ | D |
| 集成 commit（D 集成分支 HEAD） | ____ | D |
| 生成物目录（绝对路径） | ____ | D |
| 构建命令（可复跑） | ____ | D |
| 预览链接（平台／受控入口） | ____ | D |
| 本地静态服务地址 | ____ | E 自起 |
| 评委 ZIP 路径 | ____ | A/D |
| 评委 ZIP SHA-256 | ____ | A（E 下载后复核） |
| 回退版本 | ____ | D |

**冻结规则**：验收期间不重建生成物、不改候选文件；若必须重测，重取 hash 并记入 `verify.md`。断引用复测只在**临时静态副本**里改，正式候选保持只读（见 §5）。

---

## 1. 验收环境

- 浏览器：**Edge**（`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`；不使用 Chrome）。
- 视口：`1440×900`、`1280×720`、`1024×768`、`390×800`（E6 折扇/抽屉按四档）。
- **离线口径**：只起本机静态服务（仅 `localhost`），**不启动任何 Node 后端**；用 `--host-resolver-rules` 阻断外部解析，保留 `127.0.0.1`。这样「展示主线无需 Node」与「不访问外部模型」是在**同一环境**下被证明的。
- 本机已知约束（沿用既有经验）：
  - 系统代理异常 → 本机测试一律 `NO_PROXY=localhost,127.0.0.1`，不显式走代理。
  - 无头 Edge 的 `--dump-dom` 返回空 → 证据用**离屏截图 + NetLog**，不用 dump-dom。
  - 截图**离屏**执行，不弹可见窗口打断用户；需要用户亲自看的窗口另列「未由 E 截图」。

---

## 2. 取证手段（三种互补，均已在本机空白页冒烟验证）

### 2.1 静态服务访问日志 —— 判「是否触达 Node」

原理：演示主线若发起任何 `/api/*` 或 `/functions/*` 请求，本机静态服务会记录该请求（并返回 404）。**只要出现一条，即视为触达后端逻辑 → E7 失败**；演示主线应为零此类请求。

```bash
# 起服务（仅本机）；日志重定向为证据
NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 \
  python -m http.server 8799 --directory "<生成物目录>" \
  > evidence/<轮次>_server.log 2>&1 &
# 访问后判读
grep -nE "GET|POST" evidence/<轮次>_server.log
grep -nE "/api/|/functions/" evidence/<轮次>_server.log   # 期望：无输出
```

### 2.2 无头 Edge NetLog —— 判「外部主机与全量 URL」

原理：NetLog 记录所有网络事件的 URL（含外部域名）。用于核对：除 `127.0.0.1` 外是否访问了模型/后端/第三方。

```bash
"<Edge>/msedge.exe" --headless=new --disable-gpu --no-first-run --no-default-browser-check \
  --disable-background-networking --disable-component-update --disable-sync \
  --disable-domain-reliability --disable-client-side-phishing-detection \
  --disable-features=Translate,OptimizationHints,MediaRouter,InterestFeedContentSuggestions \
  --user-data-dir="<临时profile>" \
  --host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE 127.0.0.1" \
  --log-net-log="evidence/<轮次>_netlog.json" \
  --net-log-capture-mode=Default \
  --virtual-time-budget=8000 \
  --screenshot="evidence/<轮次>_E1_home.png" --window-size=1440,900 \
  "<本地静态服务地址>/"
# 判读：raw 全量主机（排除本机）→ hosts-all.txt；再去掉浏览器/本机噪声 → hosts.txt
grep -oE 'https?://[A-Za-z0-9._-]+(:[0-9]+)?' "<netlog>" | sort -u \
  | grep -vE '://(127\.0\.0\.1|localhost)' > hosts-all.txt
# hosts.txt 期望为空；命中即须逐条说明是否本页发起
```

> **实测噪声（本机 2026-11-24 冒烟确认）**：即使加了减噪开关，NetLog 仍会带上 Edge 遥测（`edge.microsoft.com`、`bing.com`/`cn.bing.com`、`microsoft.com`）与卡巴斯基 HTTPS 拦截主机（`me.kis.v2.scr.kaspersky-labs.com`）。这些**与本页无关**，脚本已将其归入 `hosts-all.txt` 并另存 `hosts.txt`（过滤后）。
> **判读准则**：`hosts.txt` 为空即通过；非空项须能溯源（是浏览器自身还是页面发起）。真机候选若出现 A/D 提供的**后端域名或模型域名**，直接判 E7 失败——因此在候选到手前先向 D 取回「后端/模型域名清单」用于定向 grep，避免噪声掩盖真命中。

> 证据卫生：真机候选采集**用 `Default` 模式**（不抓请求头/凭据），避免把 Cookie 等写入证据文件。`IncludeSensitive` 仅用于排查，不产出为交付证据。

### 2.3 离屏截图 —— 判「行为与视觉」

每个 E 项的页面状态各留一张 PNG（命名含编号），配合 §2.1／§2.2 的日志构成「行为 + 网络」双证据。

### 2.4 DevTools HAR（人工旁证，可选）

E1／E7 另由人工在 Edge 网络面板复跑一次，导出 HAR 作为交叉旁证（HAR 会含请求头，导出前确认无私密数据；如含凭据则只在结论中引用、不归档原文）。

### 2.5 脚本骨架

`scripts/smoke-capture.sh` 已备：接受 `SITE_DIR`、`OUT_DIR`、`URL` 三个变量，起静态服务并跑一轮无头截图 + NetLog，产出日志与 URL 清单。候选到手后 `bash scripts/smoke-capture.sh <生成物目录> evidence <本地地址>`。

---

## 3. E1–E7 逐项判定表（动作 / 通过标准 / 证据）

| 项 | 实际点击与检查 | 通过标准 | 取证 | 证据文件名 |
| --- | --- | --- | --- | --- |
| E1 | 无痕窗口开首页；另开窗口预存冷色再刷新 | 直接进主课题、全站暖色、无需等后端；控制台无初始化错误 | §2.1 零 `/api`；§2.2 无外部主机；截图 ×2；控制台日志 | `E1_home.png`、`E1_tech_refresh.png`、`E1_console.txt` |
| E2 | 进文献库；开待审卡与已审卡；回查原文；开一组比较 | 状态区分清楚；两边来源与可比条件可核实；回查准确 | 截图；卡片→原文跳转的 URL/请求；比对数据与 A 契约 | `E2_cards.png`、`E2_compare.png`、`E2_backtrace.png` |
| E3 | 从报告结果点到分析／记录或表／原件 | 每跳可点；源对象与版本吻合；定位精度与已知数据一致 | 截图×N；每跳的定位值与被引用对象对照 | `E3_report.png`、`E3_chain_*.png` |
| E4 | 看真实生成的上下文图、预生成方案／对话、下一步指导 | 产物标识清晰；依据可回查；无虚拟进度或现场模型调用 | 截图；§2.2 证明无模型域名请求；标识文案 | `E4_map.png`、`E4_nextstep.png` |
| E5 | 从页面下载 ZIP，解包核对内容，再核对哈希 | 压缩包可开；内容与站点引用对应；许可与指引齐全 | 解包目录树；`sha256sum` 与 A 记录对照 | `E5_zip_tree.txt`、`E5_sha256.txt` |
| E6 | 桌面开合折扇；窄屏开抽屉；键盘走一遍；改设置并刷新 | 无错位、焦点正常、偏好保留、减少动效生效、无冷色入口 | 四档截图；§2.1/§2.2 无冷色资源请求 | `E6_*.png`、`E6_console.txt` |
| E7 | 查请求记录并检查发布文件 | 展示主线未访问 Node 或外部模型；无凭据/私有文件/写入请求 | §2.1 零 `/api`·`/functions`；§2.2 无外部主机；§4 静态扫描 | `E7_server.log`、`E7_netlog.json`、`E7_scan.txt` |

> 「通过」必须同时满足：行为正确 **且** 网络无违规 **且** 证据文件存在。任一缺失即记「未测」或「失败」。

---

## 4. 发布文件静态扫描（E7 配套）

对**生成物目录**做只读扫描，逐项记入 `E7_scan.txt`：

- 凭据/配置：`ai-config.json`、`*key*`、`*.env`、`token`、`secret`（文件名与内容双查）。
- 私有材料：内部测试包 `test-packages/`、私人原件、非公开路径、作者个人信息。
- 冷色资源与入口：冷色主题 CSS/JS、切换按钮 DOM、快捷键绑定、首屏脚本引用（公开版应无）。
- 结构完整性：「AI 配置」入口已收、shim 存在与否（公开版是否仍依赖 shim）、资源引用可解析（无 404 断链）。

```bash
grep -rniE "ai-config|api[_-]?key|secret|token|test-packages" "<生成物目录>" > evidence/<轮次>_E7_scan.txt
# 冷色关键词以 C 的「剔除清单」为准（候选到手后由 C 提供精确清单）
```

---

## 5. 断引用复测方案（验证页面会指出缺口）

目标：证明「引用断开时页面给出明确提示」，且**不改动正式候选**。

1. `cp -r <生成物目录> <临时副本目录>`（副本置于 `F:/temp/`，验收后删除）。
2. 在副本内**断开一条引用**，二选一（取一项即可，记明改了哪条）：
   - 删/改 `demo-data`（A 契约的发布产物）中某张卡片引用的一个资产文件，或
   - 改快照中一条 `originalUrl`／对象 ID 指向不存在的目标。
3. 起静态服务指向副本，按 E2/E3 的路径点开该引用。
4. **预期**：页面指出具体缺口（具体原因文案或错误态），控制台可能出现受控的加载失败提示；**不得整站白屏或静默补造数据**。
5. 记录：截图 + 控制台 + 改动点（`git diff` 风格的 `diff` 输出）。
6. **回到未改动的正式候选复验**：同路径恢复正常，确认缺口提示只由断引用触发。

证据：`E8_break_<改动点>.png`、`E8_break_diff.txt`、`E8_recover.png`。

---

## 6. 需要 D（及 A/C）提供的输入

- D：候选版本号、集成 commit、**生成物目录绝对路径**、**构建命令**、**预览链接**、回退版本。
- D：公开构建的模式开关（如何以静态方式避免 `site-shim.js` 打到 `/functions/*`）。
- D：**后端域名与模型域名清单**（用于 NetLog 定向 grep，见 §2.2）。
- A：快照版本、数据契约样本、ZIP 路径与 SHA-256、引用索引。
- C：冷色剔除清单（精确关键词/路径），供 §4 扫描用。
- B：E2/E3/E4 各一条**具体点击路径**（手册 B→E 交付）。

---

## 7. 禁止与边界

- 不验收自己写的代码；本目录内容不算业务交付。
- 业务代码只读；只写本目录（含 `evidence/`）。
- 不 push、不动 `main`、不写其他 `.worktrees/*`。
- 未执行的动作不得写成「通过」；无证据的结论记「未测」。
