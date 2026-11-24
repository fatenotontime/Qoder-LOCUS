# 设置折扇 · 公开版交接组件（C 交付）

> 需求：施工手册 **C.1–C.4**。几何与交互以《设置页折扇_原型.html》v2 为准；内容差异（无卷面切换、模型只读、关于走构建注入）以手册为准。
> 发布物只有两个文件：`settings-fan.js`、`settings-fan.css`。其余为本目录开发自测件，**不进发布包**。

## 1. 文件角色

| 文件 | 用途 | 发布 |
| --- | --- | --- |
| `settings-fan.js` | ES 模块：自建 `<aside id="settings-fan">`、扇骨/绢面/题签、开合、焦点、三签内容、外观偏好 | 是 |
| `settings-fan.css` | 折扇样式＋外观偏好令牌（字号/疏密/减少动效）＋入口小扇图标 | 是 |
| `preview.html` | 开发预览与页内自测（读取真实 `styles.css`） | 否 |
| `dev-server.mjs` | 双根静态服务（`/settings/*` → 本目录，其余 → `sciworkbench/public`） | 否 |
| `cdp-run.mjs` | 无头 Edge + CDP：精确视口截图、`__fanSelfTest()`、偏好持久化与减动效断言 | 否 |
| `_evidence/` | 自测截图与 `report.json`（本机路径，`.gitignore` 忽略） | 否 |

## 2. D 的接入步骤（最小）

1. 构建时把 `web-overlay/settings/settings-fan.js`、`settings-fan.css` 复制到 `web/settings/`（其余文件不要复制）。
2. `index.html` 的 `<head>` 末尾（`styles.css` 之后）加：
   ```html
   <link rel="stylesheet" href="/settings/settings-fan.css" />
   ```
   在 `</body>` 前、`app.js` 之后加：
   ```html
   <script type="module" src="/settings/settings-fan.js"></script>
   ```
   模块会自建扇体并自动初始化；也可 `import { initSettingsFan } from "/settings/settings-fan.js"` 后显式调用（幂等）。
3. **左栏入口**：把 `index.html` 的
   `<button id="ai-open" class="modelbtn" type="button">模型设置 <span class="hint" id="ai-state">读取中…</span></button>`
   换成（保留 `.modelbtn` 与 `#ai-state`）：
   ```html
   <button id="settings-open" class="modelbtn" type="button" aria-haspopup="dialog" aria-controls="settings-fan" aria-expanded="false">
     设置 <span class="hint" id="ai-state">预生成</span>
   </button>
   ```
   小扇图标 `.settings-glyph` 由模块在初始化时补进按钮（也可自行放入同样结构）。
4. **窄屏卷目入口**：`#navdrawer` 底部 `data-open-ai` 按钮改为 `data-open-settings`，文案「设置」。模块监听该属性并打开「模型」签；模块会先派发可取消事件 `locus-settings:will-open`，D 应在此事件里关闭卷目抽屉（或实现 `beforeOpen`，见 §3）。
5. **旧 AI 面板**：按 §7 整块删除 `#ai-drawer` 与相关 JS 监听。公开版模型签**不迁入**任何输入/按钮 id（只读）。
6. 顶部 `#ai-chip` 保留为**只读状态显示**（shim 已拦截点击），不要绑定打开设置。
7. 选定一个入口元素后可通过 `window.LocusSettings.mountEntry(el)` 重新挂载（入口被重建时用）。

## 3. 初始化参数（可选）

`window.__LOCUS_SETTINGS__`（在模块加载前赋值）或 `initSettingsFan(opts)`：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `entrySelector` | `"#settings-open"` | 左栏入口；用于扇钉对准与焦点归还 |
| `adoptLegacyEntry` | `false` | 过渡期允许识别尚未改名的 `#ai-open`（须同时移除旧监听，否则双开） |
| `forcePaper` | `true` | 加载即把 `data-theme` 置回 `paper`、移除 `body.theme-tech`；**不写存储**。开发分支可设 `false` |
| `defaultTab` | `"appearance"` | 初次打开的签 |
| `version` | `null` | 字符串或函数；留空依次读 `window.__LOCUS_BUILD__`（`{version, commit}`）、`<meta name="locus-build-version">`、`<html data-build-version>`，都没有显示「—」 |
| `beforeOpen` | `null` | 打开前回调（关卷目抽屉等） |

运行时 API：`window.LocusSettings.open(tab)/close()/toggle()/setTab()/isOpen()/refresh()/applyPreferences()/mountEntry(el)/config(next)`。

| 行为 | 约定 |
| --- | --- |
| 点击 `#settings-open` | 打开「外观」；已打开则合拢 |
| 点击 `[data-open-settings]` | 打开「模型」 |
| Esc / 点遮罩 / 点「合拢」 | 关闭，焦点还给入口 |
| 打开时派发 | `locus-settings:will-open`（可取消，`detail.tab`）→ `locus-settings:open` |
| 关闭完成时派发 | `locus-settings:close` |
| 快速开合 | 关窗计时器在重开时清除；`data-closing` 同步 |

## 4. 偏好存储键（复用 v2）

| 键 | 值 | 生效方式 |
| --- | --- | --- |
| `locus.motion.v1` | `system`（缺省）\| `full` \| `reduced` | `<html data-motion="full|reduced">`；扇子按两套选择器（`prefers-reduced-motion` ＋ `[data-motion]`）关动效 |
| `locus.density.v1` | `loose`（缺省）\| `compact` | `<html data-density>`；`compact` 仅收紧 `--space-1..6` |
| `locus.fontsize.v1` | `sm` \| `md`（缺省）\| `lg` | `<html data-fontsize>`；仅缩放 `--text-sm / --text / --text-lg`（.92 / 1 / 1.12） |

均 `try/catch` 读写；刷新后由模块启动时读回。**函数级限制**：字号/疏密只影响使用令牌的区域（与 v2 §6.1 一致，不改硬编码 px）。

## 5. 减少动效联动

- 扇子自身：CSS 同时写 `@media (prefers-reduced-motion: reduce)` 与 `html[data-motion="reduced"]`，不做旋转/蒙版/位移，只 120ms 淡入。
- **全站动效**（换卷外的遮罩、骨架等）由 `app.js:prefersReducedMotion()` 决定；建议 D 改成先读 `locus.motion.v1`：
  ```js
  function prefersReducedMotion() {
    try { const v = localStorage.getItem("locus.motion.v1");
      if (v === "reduced") return true; if (v === "full") return false; } catch {}
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }
  ```
  不改也能用，只是站内开关只作用于扇子与 CSS 动效。
- 首屏防闪：若在 `<head>` 引入，模块在解析后立即 `applyPreferences()`；如仍有闪烁，D 可在 head 内联同款三行读键逻辑。

## 6. 内容与文案

- 外观：动画效果（开关，默认「跟随系统」）、疏密（宽松/紧凑）、字号（小/中/大）。
- 模型：`模型 · <状态>`（镜像 `#ai-chip-text` / `#ai-state` 文本，或 `window.__LOCUS_MODEL_STATUS__`）、「结果为预生成」、「公开版不连模型」。**无输入框、无保存/测试/列模型、无地址与密钥。**
- 关于：名称 `LOCUS · 科研上下文工作台`、构建注入版本、`数据：预生成 · 只读`。不请求后端。

## 7. 冷色剔除清单（交 D 执行；行号基于基线 `8120986`）

> 原则：先核对 JS 引用再删 DOM，避免 `null.addEventListener` 中断整站。改完执行 §7.H 的 grep 必须零结果。

**A. `sciworkbench/public/index.html`**

| 位置 | 处置 |
| --- | --- |
| L56–~92 `#theme-seal`（顶栏印章，title「换卷（切换主题）」） | 删除按钮整体（含 `.seal-scroll` SVG）；删后必须同时删 `app.js` 的事件绑定（B.2） |
| L104 `#replay-splash`「启卷」 | **保留**（暖色开卷，独立于换卷） |
| L105–108 `#replay-theme`「重播换卷」 | 删除 |
| L100–103 `#ai-chip` | 保留为只读状态；`aria-label`/`aria-controls` 去掉 `ai-drawer`（可改 `settings-fan`） |
| L140–142 `.leftfoot > #ai-open` | 替换为 `#settings-open`（见 §2.3） |
| L702 `#navdrawer` 内 `data-open-ai`「AI 配置」 | 改 `data-open-settings`，文案「设置」 |
| L707–729 `#ai-drawer` 整块 | 删除（含 `#aiconfig/#ai-base/#ai-model/#ai-key/#ai-timeout/#ai-save/#ai-test/#ai-models/#ai-clear/#ai-msg/#ai-models-list/#ai-state-2/#ai-close`）。公开版不迁入任何控件 |
| L10–15 `<head>` 首屏脚本（读 `locus.theme.v1` 写 `data-theme`） | 删除（`<html data-theme="paper">` 已是暖色默认，防止旧 tech 闪一帧） |

**B. `sciworkbench/public/app.js`**

| 位置 | 处置 |
| --- | --- |
| L76 `THEME_KEY`、L80–85 `currentTheme/applyTheme`、L94–116 `switchingTheme/sealAnchor/quickSwitchTheme`、L117+ `replaying` 与 `runSwarmRebuild/runInkBloom/replayAndRecast` 及换卷图层函数 | 删除换卷专用逻辑；`applyTheme` 若保留须去掉 `#theme-seal` 标题/按钮状态与 `theme-color` 的 tech 分支（`if (seal)` 已判空，不会崩） |
| L1957 `DIALOG_SELECTORS` 的 `"#ai-drawer"` | 删除该项 |
| L2028 遮罩点击 `closeAiDrawer` 分支 | 删除 |
| L2035 Tab 陷阱选择器 `#ai-drawer:not(...)` | 删除该段 |
| L2058 卷目抽屉 `[data-open-ai]` | 改 `[data-open-settings]`（关闭卷目后交本组件打开；或监听 `locus-settings:will-open`） |
| L2536 Esc 的 `#ai-drawer` 分支 | 删除 |
| L2544–2559 `openAiDrawer/closeAiDrawer` 与 `#ai-chip/#ai-close/[data-open-ai]` 监听 | 删除 |
| L2561–2577 `refreshAiState()` 内 `#ai-state-2/#ai-base/#ai-model/#ai-timeout` 写入与 `$("#ai-open")` 监听 | 删除与旧面板相关的部分；`refreshAiState()` 本身会请求 `/api/ai/config`，公开版**不要调用**，`#ai-chip-text` 改为静态「AI · 预生成」 |
| L2578–2622 `#ai-save/#ai-clear/#ai-test/#ai-models/#ai-models-list` 监听 | 随控件删除 |
| L2634–2635 `#theme-seal/#replay-theme` 监听 | 删除 |
| L2636 `#replay-splash` 监听 | 保留 |
| L2643 `applyTheme(currentTheme(), {persist:false})` | 删除或改为只把 `meta[name=theme-color]` 固定为 `#f2ede2` |
| L2644–2647 `refreshAiState().catch(...)` | 删除；改为静态状态文本 |

**C. `sciworkbench/public/styles.css`**

- 删除所有 `[data-theme="tech"]` 规则：L461–490、505–512、537、565–572、586、619、628、654–658、690–697、714、724、779、834、836、1079–1094、1494–1887（含 `--pane-icon`、`scene-*`、`holo-*`、`swarm-build`、`btn-busy-tech`）。
- 删除 `#ai-drawer .drawer-meta`（L838）与 `.ai-panel*`（L839–846 一带）；`#aipanel`（L116）随面板删除。
- `.modelbtn:hover`（L143）`#eef3ef` → `var(--hover)`。
- 保留 `[data-theme="paper"]` 基础块（L432–460）与宣纸皮肤（L1164 起）。

**D. `sciworkbench/public/knowledge-stage.css`**

- 删除 L199–217 的 `[data-theme="tech"] .kzstage*` 规则。其余保留。

**E. 素材（`sciworkbench/public/assets/`）**

- 冷色专用、可删：`assets/tech/` 全部 —— `tech-bg.webp`、`tech-texture.png`、`tech-topbar.png`、`tech-corner-{tl,tr,bl,br}.svg`、`tech-slashes.svg`、`scene-{hangar,station,arm,dna}.webp`、`icon-{topic,papers,knowledge,protocol,record,analysis,chat}.svg`、`holo-*.{webp,png}`。
- 保留：`assets/paper/*`、`assets/fonts/*`（暖色通用）。

**F. 快捷键**

- 全站无换卷快捷键；仅 Esc（关抽屉/扇子，保留）、Tab（焦点循环，保留）、开卷动画 Enter/Space（保留）。

**G. Site shim（`locus-site/web-overlay/site-shim.js`）**

- L7–12 的 `[data-open-ai]{display:none!important}` / `#ai-drawer{display:none!important}` 兜底样式在旧节点删除后可留可删；L50–64 的 `#ai-chip,[data-open-ai]` 只读提示需去掉 `[data-open-ai]`（该属性已改名），保留 `#ai-chip`。

**H. 删除后核对（必须零结果）**

```bash
grep -rn "theme-seal\|replay-theme\|quickSwitchTheme\|replayAndRecast\|data-open-ai\|ai-drawer\|openAiDrawer\|closeAiDrawer\|ai-base\|ai-key\|ai-save\|ai-test\|ai-models\|ai-clear\|ai-state-2\|aiconfig" sciworkbench/public
grep -rn "data-theme=\"tech\"\|theme-tech\|swarm-build\|assets/tech/" sciworkbench/public --include=*.css --include=*.js --include=*.html
```

## 8. 自测方法与已测结果（本机）

```bash
node dev-server.mjs "F:/Qoder dev competition/.worktrees/c/sciworkbench/public" 8781   # 终端 1
node cdp-run.mjs                                                                       # 终端 2（无头 Edge + CDP）
```

- 截图：`_evidence/fan-1440x900.png`、`fan-1280x720.png`、`fan-1024x768-models.png`、`fan-390x800-sheet.png`（底部抽屉）、`fan-reduced-1024x768.png`、`fan-seedtech-1024x768.png`；原始读数在 `_evidence/report.json`。
- 页内 `__fanSelfTest()` 23 项全过：开合、分区切换、快速重开不误关、Tab 正反向循环、遮罩/Esc 关闭与焦点归还、偏好即时生效与存储、强制 paper、动效状态同步。
- 减少动效（`locus.motion.v1=reduced`）：`data-motion=reduced`、开关 `aria-checked=false`、骨 `transform: matrix(1,0,0,1,0,0)`、`transition-duration: 0s`、蒙版 `88deg`。
- 偏好刷新保留：刷新后 `density=compact / fontsize=lg / motion=reduced`，按钮态与存储一致。
- 预存 `locus.theme.v1=tech` 后加载：`data-theme=paper`，存储值保持 `tech` 未被覆写，页面无 `[data-theme="tech"]` 节点、无冷色入口。

## 9. 已知限制

- 视口 1024×768 / 1280×720 时扇箱按公式允许左/下缘越出屏幕数像素（v2 §2.2 的预期行为）。
- 字号/疏密只作用于令牌使用者；未改硬编码 px（v2 §6.1 的如实限定）。
- 站内「动画效果」要控制全站动效需 D 按 §5 改动 `app.js:prefersReducedMotion()`；本组件自身已完全受控。
- 模型状态来自页面既有文本/注入值，不请求后端；若 D 不提供状态，显示「状态未提供」。
