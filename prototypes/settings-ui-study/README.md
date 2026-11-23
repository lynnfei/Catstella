# Catstella 设置中心 UI 探索 & Web 台词气泡分流原型（交付说明）

> **边界声明**：本目录（`D:/Catstella/prototypes/settings-ui-study/`）为独立设计探索与交互验证沙盒。**未修改任何桌面端或 Chrome Web 扩展正式源码**，所有交互测试均基于 `file:///` 或本地静态页面与 [`shared/store.js`](shared/store.js) 内存态驱动。

---

## 1. 各方案入口与运行方式

无需构建步骤，直接在浏览器（Chrome / Edge / Firefox）打开 HTML，或由 Playwright 脚本一键启动回归测试：

| 入口文件 | 定位 | 模糊预算 (`backdrop-filter`) | 说明 |
| --- | --- | --- | --- |
| [`index.html`](index.html) | **设计探索总览页 (Hub)** | `0` 层 | 四个入口导航卡片、旧版卡顿根因与三方向横向对比表 |
| [`compact/index.html`](compact/index.html) | **方案一 · 清爽紧凑（主推）** | `0` 层（实测 `blurLayers: 0`） | 纯实色阶梯底板 + 左侧精简导航 + 右侧双预览舞台 |
| [`frosted/index.html`](frosted/index.html) | **方案二 · 轻毛玻璃（Astral Mist）** | 严格 `1` 层（实测 `blurLayers: 1`） | 仅粘性顶栏使用 1 层模糊，下方滚动卡片使用 `0.88` 高不透明度实感底色 |
| [`journal/index.html`](journal/index.html) | **方案三 · 偏手账（猫星手札）** | `0` 层（实测 `blurLayers: 0`） | 纸感点阵 + 笔记本分切彩签 + 和风胶带拍立得 + 盖章保存反馈 |
| [`web-chatter-demo/index.html`](web-chatter-demo/index.html) | **Web 端自动碎碎念让位分支** | `0` 层 | `speech-only` 极简台词气泡 vs `full-panel` 完整面板抢占/让位状态机 |

### 本地复测脚本

```bash
# 运行全部 5 个入口（hub + 3 套设置页 + Web 分支）并重生成 screenshots/
node prototypes/settings-ui-study/verify.mjs all

# 也可单独运行某一模块：hub | compact | frosted | journal | web
node prototypes/settings-ui-study/verify.mjs compact
```

---

## 2. 推荐方案与三方向取舍

### 主推桌面方案：**方案一 · 清爽紧凑（[`compact/index.html`](compact/index.html)）**

- **推荐理由**：
  1. **性能与流畅度最优**：`backdrop-filter` 严格为 **0 层**，在透明 Electron 窗口叠加桌面、低功耗核显笔记本或长期挂机场景下不产生多 pass 模糊合成开销；配合精细键级订阅（`subscribeKey`），滑块与表单修改仅更新目标文字与 CSS 变量，完全消除全页 `render()` 与 `innerHTML` 重建导致的滚动跳动。
  2. **信息密度与扫读效率最高**：桌面宽度 `168px` 左栏 + 中区主表单 + `298px` 右侧双舞台（桌宠实时表情 + Atelier 聊天微缩预览），高频设置项几乎一屏直达；窄窗（`<= 979px` 或模拟 `460px`）自动收敛为顶部横滑分类条并默认收起预览区（点击右上角「实时预览」展开并自动滚动聚焦）。
- **其他两套适用场景与取舍**：
  - **方案二 · 轻毛玻璃（[`frosted/index.html`](frosted/index.html)）**：把模糊层硬性封顶在顶栏（`blurLayers: 1`），兼顾飘逸通透观感；但顶部通栏与胶囊标签占用了较多纵向空间，长表单单屏可容纳设置项少于「清爽紧凑」。适合作为高分屏浮窗风格备选。
  - **方案三 · 偏手账（[`journal/index.html`](journal/index.html)）**：情感连接与 Aica 世界观辨识度最强，用纯 CSS 点阵、纸胶带、盖章反馈表达个性化（减动效开启时拍立得倾角自动摆正）；但虚线边框与装饰留白降低同屏条目密度，更适合纪念主题活动或内容商店换肤预设，不宜作为默认工程设定窗。

---

## 3. 真实测量值 vs 演示仪表值（严格区分）

为避免拿“演示 UI 里的假数据”误当成真实现网指标，本原型按以下口径严格拆分：

| 类别 | 具体项目 | 来源与性质 | 说明 |
| --- | --- | --- | --- |
| **真实浏览器测量** | 顶部 HUD「`DOM 变动: N 节点`」 | **实测（`MutationObserver`）** | [`shared/perf-meter.js`](shared/perf-meter.js) 观测 `#settings-app-root` 子树每次交互同步产生的增删改记录（排除 HUD 自身） |
| **真实浏览器测量** | 顶部 HUD「`整页重绘`」 | **实测计数规则** | 当单次交互 DOM 变动超过 85 个节点时记为 1 次重绘告警（用于捕获类似全量重建的退化） |
| **真实浏览器测量** | 顶部 HUD「`模糊层`」 | **实测（`getComputedStyle`）** | 遍历可见节点检查非 `none` 的 `backdropFilter` `blur(...)` 数量 |
| **真实浏览器测量** | 顶部 HUD「`脚本耗时`」 | **实测（`performance.now()`）** | 衡量每次用户事件处理函数（状态更新 + 局部 DOM Patch）的同步 JS 执行耗时 |
| **真实浏览器测量** | 顶部 HUD「`帧率`」 | **实测（`requestAnimationFrame`）** | 每 `>= 1000ms` 窗口统计一次实际渲染帧率 |
| **真实浏览器测量** | `scrollWidth <= clientWidth`、元素包围盒、键盘 `activeElement` | **实测（Playwright）** | [`verify.mjs`](verify.mjs) 直接在 headless Chromium (Edge) 中以 `1180x800` 与 `460x820` 视口检验 |
| **演示 / Mock 数据** | AGY `5h 96% / 1w 95%`、Web `5h 72%`、重置倒计时文案 | **本地假数据** | 定义于 [`shared/store.js`](shared/store.js) `DEFAULT_STATE` 与静默页面文案中，仅用于展示进度条及双口径（剩余/已用）联动 |
| **演示 / Mock 数据** | BYOK 列表 `延迟 380ms` / `Thinking Low` 备注 | **本地假数据** | 仅代表静态展示文案，未实际发起网络探针或 LLM 请求 |
| **演示 / Mock 数据** | `Atelier 演示预览` 气泡、摸头计数 `今日 18 / 累计 1954` | **本地内存 Mock** | 无持久化到 `~/.antigravity-cat-widget/settings.json` 或浏览器扩展存储 |
| **演示 / Mock 数据** | 顶部「`模拟保存失败`」开关 & 自动保存回执 | **沙盒状态模拟** | 模拟 Electron IPC `widget:settings` 失败时的草稿保留、错误播报、重试与放弃改动回退链路 |

> 注：初稿中 `.atelier-chrome` 角落曾写有静态文本 `0ms 重绘` / `0ms`，BYOK 卡片角标曾写有 `约 4 次 DOM 变动`；评审中发现此类纯静态文案易与上方实测 HUD 混淆，现已分别改为 `Atelier 演示预览` 与 `增量更新目标行，零整表重建`。

---

## 4. 实际交互测试结果与原型内修复记录

最新一轮全量执行 `node prototypes/settings-ui-study/verify.mjs all`（Edge headless，退出码 `0`）结果如下：

### 4.1 自动化回归与实测指标汇总

| 验证对象 | 控制台报错 / 破图 | 桌面 / 460px 溢出 | 切换分类 / 改形象 / 拖滑块 / BYOK 行更新 DOM 变动 | 最大单次变动 / 整页重绘 / 模糊层 | 关键新增校验通过项 |
| --- | --- | --- | --- | --- | --- |
| `hub` | `0` / `0` | — / `false` | — | — | 入口链接与图片全加载 |
| `compact` | `0` / `0` | `false` / `false` | `7` / `15` / `14` / `18` | `21` / **`0`** / **`0`** | 数字框清空不归零、保存失败保留草稿并可回退、`Escape` 关闭重置并还焦点、窄窗预览 `order: 0` 且展开聚焦 |
| `frosted` | `0` / `0` | `false` / `false` | `7` / `15` / `14` / `18` | `22` / **`0`** / **`1`** | 同上 |
| `journal` | `0` / `0` | `false` / `false` | `7` / `19` / `18` / `22` | `25` / **`0`** / **`0`** | 同上 |
| `web-chatter-demo` | `0` / — | — / `false` | — | — | `3.2s` 自然收起（`retractCount: 1`）、碰撞 A 抢占清除计时（`preemptCount: 1`）、碰撞 B 后台让位（`yieldCount: 1`）、键盘 `Enter` 升级后焦点落入面板、`Esc` 焦点归还唤醒按钮、`460x820` 下两种气泡均完整在画布内（`insideCard: true`） |

*单次脚本执行耗时 `lastOpMs` 在多次运行中实测约为 `0.3ms – 1.7ms`（随系统调度浮动）。*

### 4.2 本轮审计发现并在原型内直接修复的 6 个问题

1. **数字校准框清空退格时误写为 `0`**（[`shared/settings-core.js`](shared/settings-core.js)）：
   - 现象：原 `input` 监听将空字符串 `""` `Number("") === 0` 立即写回状态，用户删空重输时会闪变成 `0%`。
   - 修复：允许输入过程暂时为空（跳过空串写入），仅在输入有效有限数字时同步；`change` / `blur` 时若仍非法或为空再回填最近合法存储值（实测 `#q-manual-5h` 删空时 Store 保持 `96`，失焦归位 `"96"`）。
2. **缺少保存失败链路与回退可测性**（[`shared/store.js`](shared/store.js)、[`shared/settings-core.js`](shared/settings-core.js)）：
   - 现象：原原型假定所有 `set()` 必定成功，无法验证 Electron IPC 拒绝写入时的状态一致性和回退体验。
   - 修复：新增「模拟保存失败」开关（`[data-sim="save-failure"]`）。打开后修改配置会保留 `draft` 而不覆盖 `committed`，顶部状态栏以 `data-tone="error"` 播报原因、脏状态标牌切为 `写入失败 · 待重试 (N)`、隐藏的保存按钮变为「重试保存」，用户可取消失败模拟后点重试，或点「放弃改动」一键回退到上次成功快照。
3. **非阻塞内联重置确认框键盘退出缺失**（[`shared/settings-core.js`](shared/settings-core.js)）：
   - 修复：为 `[data-reset-confirm-box]` 增加 `Escape` 监听，按下 `Esc` 收起确认区并把焦点准确归还给触发按钮 `[data-action="reset-confirm-open"]`；切换设置分页 `switchPage()` 时自动收起未处理的确认框。
4. **窄窗预览区 `order: -1` 破坏视觉/Tab 焦点序**（[`compact/compact.css`](compact/compact.css)、[`frosted/frosted.css`](frosted/frosted.css)、[`journal/journal.css`](journal/journal.css)）：
   - 现象：在 `<= 979px` 与 `.is-narrow-preview` 中使用 `order: -1` 将 `<aside class="preview-dock">` 渲染到 `<nav>` 与 `<main>` 上方，导致视觉从上到下顺序与 DOM `Tab` 焦点流相反。
   - 修复：三套样式全部移除 `order: -1`，让展开后的预览区自然落在主设定区下方（DOM 与视觉顺序一致）；同时在用户点击顶部「实时预览」按钮展开时，平滑滚动并自动将焦点移至 `#live-preview-dock`（`tabindex="-1"`）。
5. **局部更新缺少旧值判等剪枝**：
   - 修复：在 `settings-core.js` 引入 `setText` / `setAttr` / `setClass` / `setStyleProp` 判等封装，使拖动 `petSize` 滑块触发的 DOM 变动从 ~36 节点降至 **14 节点**（仅触及输出值、按钮禁用状态、立绘 `transform`）。
6. **Web 演示分支窄窗与键盘焦点保持**（[`web-chatter-demo/chatter-demo.js`](web-chatter-demo/chatter-demo.js)、[`web-chatter-demo/chatter-demo.css`](web-chatter-demo/chatter-demo.css)）：
   - 修复：当用户对台词气泡按下 `Enter` / `Space` 升级为完整面板时，`#speech-only-bubble` 隐藏前主动将焦点移交 `#btn-close-web-panel`，杜绝焦点跌落 `<body>`；在 `<= 920px` 窄屏增大 `.gemini-chat-viewport` 底部避让内边距与 `.web-full-panel` `max-height` 防裁切；同时给截图采集中的切页过渡补足 `220ms` 等待，确保截图不再捕获到半透明淡入中帧。

---

## 5. 截图索引

所有截图均由 [`verify.mjs`](verify.mjs) 自动生成于 [`screenshots/`](screenshots/)：

### 对比总览与主推「清爽紧凑」（Desktop 1180×800 & Narrow 460×820）
- [`screenshots/study-hub-desktop.png`](screenshots/study-hub-desktop.png) — 探索总览首页（Hub）
- [`screenshots/compact-desktop-overview.png`](screenshots/compact-desktop-overview.png) — 总览与联动卡、核心开关摘要
- [`screenshots/compact-desktop-char.png`](screenshots/compact-desktop-char.png) — 形象与桌宠控制（霓音 · 害羞态预览）
- [`screenshots/compact-desktop-gallery.png`](screenshots/compact-desktop-gallery.png) — 壁纸画廊横滑视图 + `1m–1h` 磁吸轮播标尺
- [`screenshots/compact-desktop-theme.png`](screenshots/compact-desktop-theme.png) — 主题预设与背景遮罩对比度预览（深海蓝）
- [`screenshots/compact-desktop-quota.png`](screenshots/compact-desktop-quota.png) — 双源额度与手动兜底校准
- [`screenshots/compact-desktop-byok.png`](screenshots/compact-desktop-byok.png) — 本地 BYOK 网关节点增量开关页
- [`screenshots/compact-desktop-interact.png`](screenshots/compact-desktop-interact.png) — 互动称呼、摸头测试与减弱动效激活态
- [`screenshots/compact-desktop-about.png`](screenshots/compact-desktop-about.png) — 关于页与非阻塞行内重置确认框 (`role="alertdialog"`)
- [`screenshots/compact-narrow-460.png`](screenshots/compact-narrow-460.png) — 460px 窄窗响应式自适应与预览折叠展开态

### 方案二「轻毛玻璃」& 方案三「偏手账」
- [`screenshots/frosted-desktop-char.png`](screenshots/frosted-desktop-char.png) / [`screenshots/frosted-desktop-gallery.png`](screenshots/frosted-desktop-gallery.png) / [`screenshots/frosted-desktop-theme.png`](screenshots/frosted-desktop-theme.png) / [`screenshots/frosted-narrow-460.png`](screenshots/frosted-narrow-460.png)
- [`screenshots/journal-desktop-char.png`](screenshots/journal-desktop-char.png) / [`screenshots/journal-desktop-gallery.png`](screenshots/journal-desktop-gallery.png) / [`screenshots/journal-desktop-theme.png`](screenshots/journal-desktop-theme.png) / [`screenshots/journal-narrow-460.png`](screenshots/journal-narrow-460.png)

### Web 自动碎碎念与让位分支
- [`screenshots/web-chatter-speech-only.png`](screenshots/web-chatter-speech-only.png) — 桌面视口：仅展示极简台词气泡 + 自动收起进度条
- [`screenshots/web-chatter-full-panel.png`](screenshots/web-chatter-full-panel.png) — 桌面视口：用户抢占后锁定为完整伴侣面板（清除倒计时）
- [`screenshots/web-chatter-narrow-speech.png`](screenshots/web-chatter-narrow-speech.png) — 460×820 窄视口：`speech-only` 气泡边界贴合检查
- [`screenshots/web-chatter-narrow-panel.png`](screenshots/web-chatter-narrow-panel.png) — 460×820 窄视口：`full-panel` 面板无裁切边界检查

---

## 6. 从现有桌面设置页迁移清单

未来将 `compact` 方案正式迁入 `Antigravity-Cat-Widget` 时，须完整承接以下已验证的契约，不得遗漏或私自重命名正式键位：

### 6.1 必须保留的配置键（Persistence Keys）

1. **Cat Widget 域（`Antigravity-Cat-Widget/src/domain/settings.cjs`，持久化于 `~/.antigravity-cat-widget/settings.json`）**
   - 主进程 `apply(partial)`（`Antigravity-Cat-Widget/src/main/index.cjs`）白名单接收并规范化的字段：
     - **形态与窗口定位**：`characterPack`（需通过 `getCharacterPacks()` 校验）、`scale`（`ALLOWED_SCALES = [140, 180, 220, 260, 300]`）、`alwaysOnTop`、`hostWindowOnly`、`standaloneDesktopMode`、`clickThrough`
     - **气泡与音频**：`bubbleOn`、`bubblePage`（`["quota", "webQuota", "claudeGpt", "today", "latest", "talk"]`）、`bubbleTint`、`bubbleOpacity`、`turnCostOn`、`turnCostDurationMs`、`sound`、`volume`、`soundSet`（`ALLOWED_SOUND_SETS = ["original", "wood-tap", "bubble-pop", "soft-spring"]`）
     - **交互、无障碍与联动**：`reducedMotion`、`clickCatAction`、`easterEggs`、`ambientChatter`、`autoUpdateCheck`、`syncCharacter`、`syncWallpaper`、`syncInteraction`、`petDisplayMode`、`userHonorificMode`、`customHonorific`
     - **额度手动校准与自定义主题**：`manualQuota`、`manualPercent`、`manualWeeklyPercent`、`customThemes`
   - 另由主进程托管但非设置窗表单直接编辑的运行时坐标/状态键：`x`、`y`、`desktopArtShiftX`、`desktopArtShiftY`、`hostOffsetX`、`hostOffsetY`、`hostDock`、`currency`、`seenReleaseNotes`。

2. **Dream Skin 域（`Antigravity-Dream-Skin/src/domain/settings.cjs`，持久化于 `~/.antigravity-dream-skin/settings.json`）**
   - 经由 `api.save({ dreamSkin: { ... } })` 嵌套传递到主进程 `apply(partial)` 再转交 `skinSettings.update(dream)`：
     - `enabled`、`themePreset`（`THEME_PRESETS = ["violet", "pink", "ocean", "onyx"]`）、`outputMode`（`"transparent"` / `"glass"`）
     - `chatTint`、`chatOpacity`、`replyOpacity`
     - `positionX`、`positionY`、`zoom`、`fit`、`scrim`、`opacity`
     - `wallpaperId`、`wallpaperFile`、`slideshow`、`slideshowIntervalMinutes`、`uiLanguage`、`transition`
     - `protectEditor`、`protectTerminal`
   - 注：正式 `apply(partial)` 中对同时出现 `wallpaperId` 或 `wallpaperFile` 的请求会自动调用 `selectWallpaper(skinManager, ..., { fileOnly })` 对齐包 ID 并更新 `skinController` 与 `scheduleSlideshow()`，新 UI **不可跳过此嵌套 `{ dreamSkin: ... }` 结构**。

3. **BYOK 网关与在线内容能力（零侵入按需挂载）**
   - 延续现有 `mountByokIfAvailable()` 契约：仅当 `snapshot.byok?.available === true` 时显示网关设置页，所有写操作经 `window.widgetApi.byok(action, data)`（IPC `widget:byok`）调往网关管理器（已使用动作含 `updateGatewayConfig`、`revealGatewayToken`、`discoverOllama`、`scanEnvKeys`、`setActiveModel` 等）。

### 6.2 保存回执、竞态防护与失败回退机制

对照 `Antigravity-Cat-Widget/src/renderer/settings.cjs` 实装逻辑，迁移到精细订阅架构时必须保留 4 道安全阀：

| 机制 | 正式代码实现要点 | 迁移改造注意事项 |
| --- | --- | --- |
| **串行写队列 (`pending`)** | `save(partial, message)` 通过 `pending = pending.then(...)` 串行调用 `window.widgetApi.save(...)` (`widget:settings`) | 新 UI 的即时自动保存（`autoSave`）也必须走串行队列或防抖合并，避免滑块/开关乱序覆盖写入 |
| **乐观锁/在途保护 (`savingAppearance` & `dreamDrafts`)** | 对 `syncCharacter`/`syncWallpaper` 记录 `intent` 引用，滑块拖动先写 `dreamDrafts` 本地预览、`change/blur` 再提交且校验引用一致后删除草稿 | 绝不能在 `api.save` 尚未返回时用旧的 `widget:snapshot` 广播覆写当前正在拖动的滑块或开关 |
| **回执与失败播报 (`$("saved")`)** | `api.save` 成功后写回 `data` 并更新 `$("saved").textContent = message`；`catch` 分支置为 `"保存失败，请重试"` 并在 `finally` 清理在途态 | 参考本原型 `simulateSaveFailure` 验证方式：**建议正式版失败时额外保留脏标记与「重试 / 放弃本项回退」按钮**，并用 `data-tone="error"`（`#991b1b`）区分普通提示 |
| **整体回退基线 (`original` & `originalDreamSkin`)** | 打开窗口时深拷一份基线；`$("undo").onclick` 整包提交恢复 | 可保留「重置为打开本窗前状态」的整体还原入口，与本原型「单步撤销栈 + 放弃未保存草稿」互补 |

### 6.3 桌面 ↔ 宿主 ↔ Chrome Web 桥接协议（`shared/companion-bridge.cjs`）

- 监听环回端口 `DEFAULT_BRIDGE_PORTS = [3921, 3922, 3923]`（仅放行 `EXTENSION_PROTOCOLS` 与 `LOOPBACK_HOSTS` 来源）。
- 关键路由与新 UI 的衔接点：
  - `GET /companion/state`：由主进程 `companionBridge.getState()` 组装 `sync`、`desktop`（含 `characterPack`、`honorific`、`modelActivity`、`themePreset`、`chatAppearance`、`wallpaperId`、`wallpaperRev`、`agyQuota` 等）与 `web` 快照（`getWebSnapshot()`：`lastSeen < 15000ms` 视为 `online`，`webActive && < 12000ms` 视为 `active`）。
  - `POST /companion/sync`（带 `X-Catstella-Client: gemini-web-companion`）：接收 `webActive` / `webVisible` / `webQuota`（经 `sanitizeWebQuota` 清洗）及 `patch`。主进程 `onPatch` 按白名单过滤并受 `syncCharacter` / `syncWallpaper` 门控回写桌宠设置：允许 `["syncCharacter", "syncWallpaper", "syncInteraction", "petDisplayMode", "clickCatAction", "scale", "sound"]`、`characterPack`、以及 `dreamSkin` 子集 `["wallpaperId", "slideshow", "slideshowIntervalMinutes", "opacity", "scrim", "themePreset"]`。
  - **碎碎念互锁 (`widget:can-chatter`)**：桌面侧 `Antigravity-Cat-Widget/src/main/index.cjs:556` 已强制校验 `!companionBridge.getWebSnapshot().active`，即网页伴侣活跃时桌面自动碎碎念主动静默。

---

## 7. Web 台词气泡最小生产接入方案

针对 `D:/Catstella-web/Gemini-Web-Companion/content/widget.js` 与 `ambient.js`，不重写现有 DOM 结构即可按以下**最小改动方案**上线两段式表面分流与优先级仲裁：

### 7.1 现状缺口分析

当前正式版 `widget.js` 中：
1. 气泡容器 `.kimino-bubble` 同时包着 `.kimino-header`、`.kimino-dialogue`、`.kimino-dialogue-hint` 和 `.kimino-quota-panel`。
2. `chatter`（`CatstellaChatter`）的 `allowed()` 条件强依赖 `bubbleVisible === true`：即用户把主面板折叠（`bubbleVisible = false`）时，自动碎碎念完全不生效；而当 `bubbleVisible = true` 时，触发自动碎碎念会让整张带额度和按钮的完整面板常驻画面，且 `ambientTimer`（4500ms）结束时只调用 `quietAmbient()` 切回默认台词，不会自然收起气泡。

### 7.2 最小改动设计（3 步接入）

#### 第一步：在 `.kimino-bubble` 上增加独立显示态 `surfaceMode`（不污染持久化 `bubbleVisible`）

- 引入瞬态变量 `let transientAmbientActive = false;` 与统一派生函数 `getBubbleSurfaceMode()`：
  - 若 `settingsOpen` -> `'hidden'`（原规则：`settingsOpen` 开启时不显示气泡防遮挡）
  - 否则若 `bubbleVisible`（用户持久化开启了完整面板）-> `'full-panel'`
  - 否则若 `transientAmbientActive`（仅自动碎碎念临时激活）-> `'speech-only'`
  - 否则 -> `'hidden'`
- 将 `bubble.dataset.surfaceMode = mode` 写入容器；在 Shadow DOM 样式表中补充极简模式规则（零 DOM 结构搬移）：
  - `.kimino-bubble[data-surface-mode="speech-only"] .kimino-header,`
  - `.kimino-bubble[data-surface-mode="speech-only"] .kimino-dialogue-hint,`
  - `.kimino-bubble[data-surface-mode="speech-only"] .kimino-quota-panel { display: none; }`
  - 并仅在 `speech-only` 下给 `.kimino-bubble` 加上紧凑圆角尺寸与底部 3.5px 自动收起进度条（复用现有 `getComputedStyle`/CSS 变量，尊重 `prefers-reduced-motion`）。
- 改造 `updateVisibilityAndBridgeUI()`：判断条件从单纯 `bubbleVisible ? 'block' : 'none'` 改为 `const mode = getBubbleSurfaceMode(); bubble.style.display = mode === 'hidden' ? 'none' : 'block'; bubble.dataset.surfaceMode = mode;`，并随之执行 `adjustBubblePlacement()`。

#### 第二步：更新 `chatter`、`quietAmbient()` 与悬停/聚焦保活

1. 放宽 `chatter.allowed()`：
   - 不再要求 `bubbleVisible === true`，改为允许 **面板已收起 (`!bubbleVisible`)** 时在网页活跃空闲期弹出 `speech-only`；同时补充输入避让判断：当前焦点在 Gemini 输入框（可复用已有输入检测或检查 `document.activeElement` 是否为可编辑节点 / 输入区域，对应 Demo 的 `userTyping` 护栏）时返回 `false` 让位。
   - 当 `bubbleVisible === true` 或 `settingsOpen === true` 时，`allowed()` 返回 `false`：**完整面板已打开期间，自动碎碎念只低调让位（可选择跳过本轮并由 `Chatter.reset()` 等待下个周期，不覆盖用户当前阅读内容，也不挂载自动收起定时器）**。
2. `chatter.speak()` 行为：
   - 设 `transientAmbientActive = true;`（**绝不调用 `api.storageSet({ bubbleVisible: true })`**），调用 `paintDialogue(ambientLine)` 并刷新 `updateVisibilityAndBridgeUI()`。
   - 将原本固定的 `ambientTimer = setTimeout(quietAmbient, 4500)` 改用可控倒计时（悬停 `.kimino-bubble` 的 `pointerenter`/`pointerleave` 与 `focusin`/`focusout` 时暂停剩余时间，离开或失焦恢复；到时归零执行 `quietAmbient()`）。
3. `quietAmbient()` 行为：
   - 清理 `ambientTimer` 与 `ambientLine`；若 `transientAmbientActive === true`，置 `transientAmbientActive = false` 并触发 `updateVisibilityAndBridgeUI()`，气泡自然收起回 `'hidden'`；同时让 `syncPet()` 恢复挂件待机姿态。

#### 第三步：接入优先级仲裁与事件流转表

所有并发或连续事件按**固定优先级**仲裁（数字越小优先级越高，高优先级可抢占低优先级，低优先级面对高优先级主动让位或延后）：

| 优先级 | 事件 / 所有权 (`owner`) | 当前处于 `speech-only` 时怎么处理 | 当前处于 `full-panel` / `settingsOpen` 时怎么处理 | 结束后动作 |
| --- | --- | --- | --- | --- |
| **P0** | 桌面优先级隐藏 (`isHiddenByDesktopPriority()`) / 扩展关闭 (`!widgetEnabled`) / 标签页后台 (`document.hidden`) | 立即执行 `quietAmbient()` + `chatter.reset()` 退场 | 按现网规则隐藏整个挂件或让设置面板保持可关（见现有 `settingsOpen` 判断） | 等待恢复条件后重新计时 |
| **P1** | 用户手动操作：`activate(head)`、点击 `.kimino-bubble`、点击 `.btn-open-settings`、键盘 `Enter`/`Space` | **立即抢占升级**：调用 `quietAmbient()` 彻底清除倒计时与 `transientAmbientActive`；写入 `bubbleVisible = true`（或 `openSettings()`），切换为 `full-panel` 且**永不挂载自动收起定时器**；若来自键盘激活，将焦点妥善交给面板关闭钮或首控件 | 保持现网点击切换（点击挂件/关闭钮可收起 `full-panel` 或关闭设置）；绝不触发倒计时消失 | 保持直到用户手动关闭 |
| **P2** | 关键运行状态：`trackerStatus === 'thinking'`（网页正在回复 `webGenerating`）、`warning === 'exhausted'`、`syncAgyTalk()`（`agy` 任务播报）、`recordHeadPat()`（摸头 `pat`） | 保持现有规则：若 `statusSource` 需展示气泡，由 `showStatusLine()` 优先调用 `quietAmbient()` 清掉自动碎碎念，避免瞬态词覆盖正式状态；若 `bubbleVisible === false`（未手动展开），仅当 `exhausted` / 显式提醒策略需要时才唤醒，常规后台状态不强制展开完整卡片 | 保持现网行为：若处于 `settingsOpen`，文字提示让位不强关设置；若处于 `full-panel`，按现有 `statusSource` 互斥（例如 `pat` 与 `agy` 串行衔接，`DURATION` 结束后恢复 `syncAgyTalk()`） | 状态结束并恢复 `idle` 后恢复待机 |
| **P3** | 用户正在输入框键入 (`userTyping`) 或指针拖拽 (`pointer !== null`) | **立即退避**：沿用并保留 `document` 上 `pointerdown` / `keydown` 监听触发 `resetChatter()`，即用户在打字或点页面时立即 `quietAmbient()` 收起气泡并将计时重置到下一空闲轮次 | 保持打开不打断；拖拽期间仅更新坐标与气泡位置（`placeWidget` + `adjustBubblePlacement`） | 用户停止输入后重新进入静默周期 |
| **P4** | 空闲定时触发：**自动碎碎念 (`ambient`)** | 允许替换或重置本轮碎碎念文本并重新开始 3.2s–4.5s 自然收起计时 | **主动让位**：检测到 `bubbleVisible === true` 或 `settingsOpen === true` 时，`chatter.allowed()` 直接拒绝抢占，绝不改写当前面板台词，也不允许给已打开的手动面板挂上任何收起计时；待 `Chatter.reset(60_000)` 延后重检，不补弹已过期积压消息 | 倒计时结束自然回归 `idle-collapsed` |

> **关键边界保护**：当用户关闭手动展开的 `full-panel`（把 `bubbleVisible` 置回 `false`）时，之前在开启期间被让位跳过的自动碎碎念应**直接作废丢弃**（如 Demo 中 `deferredChatterWaiting = false`、`QUEUE_INFO` 日志所示），由 `chatter.reset()` 重新开始下一次长空闲等待，避免刚一手动关闭面板、下一毫秒又突兀弹出过期碎碎念。
