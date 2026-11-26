# Catstella 桌面工作区 · DeepSeek Harness 交接

2026-11-26 Tauri 接续开发已转到 `codex/tauri-fixes`，基米交接的六项问题、验证边界及热更新信息集中记录在 [Tauri 交接第 7 节](src-tauri/HANDOFF.md#7-codex-接续修复--2026-11-26)，供后续 Astra 检阅。

2026-11-24（三续）耐力条前台感知智能刷新与编排器/四芒星自适应切换：针对用户反馈的从桌面/浏览器切回 Antigravity 时耐力条图标不在默认四芒星与编排器徽章间智能切换的问题，完成端到端实时同步适配：（1）**轻量多窗口焦点模型采样**：`Antigravity-Cat-Widget/src/adapters/host-quota.cjs` 修复无模型选择器页面误匹配 `permissions-selector-trigger` 的兜底漏洞，新增 `isSameModelInfo()`、`readFocusedModelInfo()`（多窗口优先选取 `document.hasFocus()` 窗口）及不干扰 30s 额度周期调度的 `refreshModelInfo()`（仅在模型或 `orchestrator` 状态变化时 `emit('change')`），并在 `tick()` 缓存未就绪分支保留有效 `modelInfo`；（2）**主进程前台事件流与即时重绘**：`Antigravity-Cat-Widget/src/main/index.cjs` 新增 `resolveEffectiveForeground()`（跨越点击桌宠 `self` 与任务栏 `shell` 保持有效前台粘性）、`needsForegroundMonitor()`（在开启耐力条挂件时亦启用轻量前台元数据监听）、`snapshot().visibility.foregroundKind/effectiveForeground`，修复 `hostWindowOnly + nativeFollowing` 下 `syncVisibility()` 返回 `false` 吞掉前台变化 `publish()` 的问题；切回 Antigravity 或更换宿主窗口时立即触发 `triggerHostModelRefresh(true)` 与 450ms 跟进探测，并在 `effectiveForeground === 'host'` 期间维持 2s 轻量模型切换轮询（休眠/锁屏/切离即停），同步挂载在 `turnRunning` / `userInput` / `turnDone` / `resume`；（3）**挂件前台感知切换与渲染刷新**：`Antigravity-Cat-Widget/src/renderer/side-quota.js` `resolveSideQuotaMetrics()` 按 `visibility.effectiveForeground` 驱动 `sideQuotaSource === 'auto'` 在 `host`（Antigravity）与 `browser`（Gemini Web）间切换；`source === 'agy'` 时区分 `modelOrchestrator` 与 `orchestrator`（仅前台位于宿主 `host` 或未知态 `unknown` 时点亮 `.orch-body` 编排器表盘，桌面/浏览器等非宿主场景切回四芒星 `.star-body`），`renderer.cjs` 在 `visibilitychange` 恢复可见时立即 `syncSideQuota()`；`settings.html` 同步更新 `挂件数据源` 描述文案。验证：`npm.cmd test` **113/113**（`pass 113, fail 0, skipped 0`，新增多窗口焦点、`refreshModelInfo`、`permissions-selector-trigger` 隔离及前台切换单测）、`localization-browser.cjs`、`side-quota-browser.cjs`（含 `desktop` -> `browser` -> `host(Orchestrator)` -> `host(常规模型)` 真实 DOM `.orch-body`/`.star-body` 切换断言）、`settings-browser.cjs` 与 `npm.cmd run verify:appearance` 全部通过；已执行 `node tools/sync-local-runtime.cjs --desktop` 热更新 5 项运行载荷（备份 `D:\Catstella\dist\local-runtime-backup-FLu7aH`），待用户右键托盘「重启套件」生效。

2026-11-24（再续）Antigravity v2.34.0 汉化适配、Omnitrix 风格 Orchestrator 徽章与设置文案清理：针对用户反馈的 Antigravity v2.34.0 新设置项（含服务端实验文案 `Knowledge Work` / `Software Engineering`、终端沙箱提示与语音/输入设置）、编排器长名溢出（`Orchestrator Gemini 4...`）及 `类原神` 文案清理需求完成三项落地：（1）**v2.34.0 词典与动态规则**：实机只读核对 `/main.js` 新增设置项与分支回退文案后，`Antigravity-Dream-Skin/assets/localization/zh-CN.json` 新增 **172 条**译文至 **2,504 条**；`src/host/localize.cjs` 在 `resolveDynamic()` 新增终端沙箱可用性提示模板（`... needs/need the terminal sandbox, which isn't available on this host.`），同步扩充 `localization.test.cjs` 与 `localization-browser.cjs` 用例；（2）**Omnitrix 风格编排器徽章与溢出修复**：`Antigravity-Cat-Widget/src/adapters/host-quota.cjs` 的 `extractModelInfo()` 返回 `orchestrator` 标志并剥离冗余 `"Orchestrator "` 前缀（纯 `Orchestrator` 保留）；经 `src/main/index.cjs` 桥接至渲染层后，桌宠气泡 `#model-tag`（`renderer.cjs` + `widget.css`）与体力条浮窗 `#sq-tip-model`（`side-quota.js` + `side-quota.css`）前置翡翠星仪表盘内联徽章 `.orch-inline-badge` 并限制弹性省略防溢出，体力条挂件 `arc` / `ring` / `bar` 在 `data-orchestrator="true"` 时将默认四芒星徽记 `.star-body` 切换为编排器表盘徽记 `.orch-body`（`createOrchestratorDialInner`），设置页 `#dq-agy-model` 同步展示 `编排 · <模型名>`；（3）**设置文案清理**：`Antigravity-Cat-Widget/src/renderer/settings.html` 选项文案 `原神风弧形` 改为 `贴边弧形`（历史原型归档目录 `prototypes/quota-side-widget-study/` 保持不动）。验证：`npm.cmd test` **111/111**（`pass 111, fail 0, skipped 0`）、`localization-browser.cjs`、`side-quota-browser.cjs`、`settings-browser.cjs` 与 `npm.cmd run verify:appearance` 全部一次通过；已执行 `node tools/sync-local-runtime.cjs --desktop` 热更新 10 项运行载荷（备份 `D:\Catstella\dist\local-runtime-backup-5RoOjA`），待用户点击托盘「重启套件」即刻生效。

2026-11-24（续）Antigravity v2.33.0 实机复测、全量汉化完善与模型/滚动毛玻璃细节加固：用户重启 Antigravity v2.33.0 与 Catstella 后，本地 CDP（`127.0.0.1:1191`）、桥接 `GET /companion/state`、皮肤、汉化与双端额度均正常在线；对真实运行态主页面、`plugin://swarm--swarm_board` 子页面及前端静态文案只读审计后完成三项完善：（1）**全量汉化扩充与对话隔离**：`Antigravity-Dream-Skin/assets/localization/zh-CN.json` 新增 668 条精选译文至 **2,332 条**（覆盖编排器 Orchestrator、权限预设与精细化 GitHub 策略、沙箱、内置浏览器与隐私数据清理、远程控制/SSH、插件市场/MCP、自动化/钩子/终端，以及 Swarm 蜂群视图全套文案，刻意保留独立 `Orchestrator` 不译以维持模型按钮紧凑）；`src/host/localize.cjs` 新增 `[data-markdown-root]` / `[data-testid='user-message-content']` / `.agy-user-bubble` 正文文本隔离（同时保留按钮 `aria-label`/`title`/`placeholder` 翻译）并新增 47 条动态模板（多段耗时 `Worked for 1m 23s`、长格式 `5 minutes ago`、`Plan, X of Y steps done`、`+N more`、`N waiting on @coordinator` 等）；（2）**v2.33.0 思考强度解析修复**：针对实机观测到的 `Orchestrator Gemini 4 Neon Extra High` 被误拆成 `modelName: "... Extra"` 的问题，更新 `Antigravity-Cat-Widget/src/adapters/host-quota.cjs` `extractModelInfo()` 支持 `Extra High` / `Very High` / `XHigh` / `Extra` 及括号等级（如 `(XHigh)`、`(High thinking)`）且不误伤 `Orchestrator (Neon)`；（3）**滚动毛玻璃选择器加固**：`Antigravity-Dream-Skin/src/host/theme.cjs` 升级至 `2026-11-24-agy-233-v7`，显式纳入 `[data-testid="autoscroll-viewport"]` 解除 `mask-image` 遮罩，并同步增强 `tools/verify-agy-scroll-glass.cjs` 对 `container-type: size` 与纯 `autoscroll-viewport` 节点的像素回归。验证：`npm.cmd test` **110/110**、`localization-browser.cjs`、`settings-browser.cjs`、`side-quota-browser.cjs`（独立运行通过；先前与 `settings-browser.cjs` 并行时因多窗口焦点抢占偶发失焦重测即过）、`npm.cmd run verify:appearance`（初次因 1000ms 轮播窗口竞态重跑通过）全部 PASS；已执行 `node tools/sync-local-runtime.cjs --desktop` 热更新 4 项运行载荷（备份 `dist/local-runtime-backup-3UK3Np`），待用户醒后点击托盘「重启套件」即可在现存 `StarSuite.exe`（PID `16904`）加载新版词典与修复；`docs/ROADMAP.md` 第 2 项已标 `[x]`。

2026-11-24 Antigravity v2.33+ 适配、11/16–17 成果收尾与双工作树整理：经只读排查本机 Antigravity v2.33.0（`D:\Program Files\Antigravity\Antigravity.exe`）确认无 Electron Fuse 封锁，但自 v2.33.0 起默认冷启动不再传入 `--remote-debugging-port` 且启动时会清理旧 `DevToolsActivePort`，导致皮肤注入、汉化层与客户端额度读取全部失联、桌宠只能读取 Web 端同步数据。本轮已完成适配：（1）升级 `shared/host.cjs`（支持 `localhost` 匹配、`explicitPort` 兜底、多路径与注册表安装探测、无强杀运行态探测、`cdp-disabled` 状态诊断、Windows 用户级桌面/开始菜单快捷方式幂等读写 `--remote-debugging-port=0 --remote-debugging-address=127.0.0.1` 及安全启动入口 `launchHostWithDebug`）；（2）升级 `HostController`、`LocalizationController`、`HostQuotaAdapter` 区分 `cdp-disabled` 与 `host-offline`，并在 `host-quota.cjs` 增加 `Gemini` 组名兜底、思考强度（含 `Minimal`/`Max`/`Auto`）与中文标签兼容解析，同步修复 `side-quota.js` 对 `fiveHourReset` / `weeklyReset` / `argon.weeklyReset` / `modelInfo.thinking` 的读取；（3）桌面主进程、托盘菜单、气泡提示及设置中心新增连接诊断与「反重力」页一键快捷方式配置/兼容启动引导，并新增 `tools/enable-agy-cdp.cjs` CLI。同时按用户验收在 `docs/ROADMAP.md` 关闭 1、3、4、5、6、7（7 先默认通过，待同学用 MBA 实机复核）及「用量独立挂件」（已于 11/17 实装），第 2 项转为 v2.33 重启后复测，补记 11/16 汉化词典扩充与多屏窗口恢复。验证结果：`D:\Catstella` `npm test` **110/110**（含新增 `shared/host.test.cjs` 与 Windows COM `.lnk` 往返）、`settings-browser.cjs`、`side-quota-browser.cjs`、`localization-browser.cjs`、`npm run verify:appearance` 全部通过；`D:\Catstella-web` 23 项单测与 5 项浏览器回归全部通过。本机已执行 `node tools/enable-agy-cdp.cjs --apply` 为桌面和开始菜单 `Antigravity.lnk` 写入兼容参数（`shortcutsConfigured: true`），并通过 `node tools/sync-local-runtime.cjs --desktop` 校验热更新 11 项桌面载荷（备份 `dist/local-runtime-backup-jpQwyt`）；因沙盒隔离桌面无法向交互桌面的 `StarSuite.exe`（PID 46152）投递单实例 `--quit`（且严守不强杀原则），留待用户在托盘点击「重启套件」并保存退出后用快捷方式重启 Antigravity 完成实机闭环。仓库清理：删除临时 `scratch/` 并加入 `.gitignore`，保留 `prototypes/` 设计研究目录；`D:\Catstella`（`beta`）与 `D:\Catstella-web`（`feat/browser-extension`）积压及本轮改动均已按主题分批提交，未推送远端、未合并 `main`。

2026-11-12 桌宠恢复、台词与气泡跟随已热更新。按当前模型判断低额度，警告流汗限时，爱心和错误回落通过真实隔离窗口验证。故障注入验证账本写盘失败重试及无托盘时渲染崩溃恢复。历史自行退出仍缺原始证据，新增恢复日志供后续长跑排查。网页跟随默认关闭，开启后单向读取桌面，断线恢复网页独立选择。热更新备份 `dist/local-runtime-backup-tMMj2q`，正式桌宠 PID 10968 和 AGY v6 已核对，网页需重载扩展并刷新。用量独立挂件已记入路线图。[本轮验收](docs/QA_RECOVERY_CHAT_2026-11-12.md)

2026-11-11 AGY 更新兼容修复：真实 2.31.0 聊天滚动祖先新增 mask，隔断回复毛玻璃采样；CSS blur 仍存在，旧检查仅看声明无法发现。v5 引擎仅在玻璃模式解除包含 AI 回复的聊天滚动遮罩，保留 alpha／圆角及编辑器、辅助区域原生遮罩，不加滚动重绘。新增像素门禁复现修复前条纹 239／240、修复后 1／240，滚动停止／延迟 mask 写回／晚到回复均通过；86 项单测和固定门禁通过。唯一皮肤载荷已校验热更新，备份 `dist/local-runtime-backup-IcfHe7`，正式桌宠 PID 35008；真实 AGY 三次静止检查为单份 v5，mask 解除、blur28／圆角18和原 alpha 保留。AGY／浏览器未重启，用户可直接复测；未提交／封包／推送。见 [修复记录](docs/AGY_SCROLL_GLASS_2026-11-11.md)。

2026-11-10 Web 长输入覆盖地图边栏：已定位并隔离复现为整页渐隐越界，而非边栏布局移动。保留完整壁纸平面，只按聊天栏左右边界裁切渐隐；输入增高／缩放、地图可点、分栏宽度变化和关闭恢复均通过像素回归，源代码及加载产物已验。皮肤回归、23 项 Web 单测与固定外观门禁通过。仅 `content/fade.js` 已热更新并核对哈希，备份 `dist/local-runtime-backup-jA34sn`；需用户重载扩展并刷新 Gemini 后实机确认。渐隐铁律已补充辅助边栏不可被覆盖，未重启其他应用、未提交／封包／推送。见 [修复记录](docs/WEB_SIDEBAR_FADE_2026-11-10.md)。

2026-11-10 设置点击／动画第二轮性能修复：真实窗口确认逐卡实时背景模糊是软件绘制热点，采用原半透明底色与柔和渐变直接合成，保留原布局／阴影／动画。无关桌宠动作和心跳不再重绘表单。前 260ms 切页帧间隔 P95 范围约 43–81ms→21–49ms；滚动 P95 约 101ms→23ms，仍有少量慢帧。静态截图差异接近零；设置及原生功能、固定外观门禁通过。仅两项设置文件已校验热更新并平滑重启正式实例 PID 32904，备份 `dist/local-runtime-backup-ULEsIa`。未改鼠标／拖动及全局 GPU 配置，未提交／推送／封包，等用户手感复测。详见 [帧表现记录](docs/SETTINGS_FRAMES_2026-11-10.md)。

2026-11-10 拖动／设置性能热更新：已修复立绘被透明气泡预留区限制在下半屏、独立桌面左右不能贴边；保存窗口内立绘偏移，支持上方气泡避让及重启／调整大小保持位置。普通滑条 60 次输入从 60 次保存降到 1 次；素材重扫复用未变预览，真实 Electron 主线程对照约 709ms→12–25ms。86 项单测、原生拖动／托盘／无钩子鼠标路由、动作及固定外观门禁通过。7 项载荷已校验热更新，初始备份 `dist/local-runtime-backup-TxuEXZ`、最终补丁备份 `dist/local-runtime-backup-rt9EeX`，正式安装实例 PID 13768 已平滑启动；未重启 AGY／浏览器，未提交／封包／推送。用户已确认的鼠标、轮播／瞬切、气泡、额度到期及 AGY 透明度项目已在 ROADMAP 关闭；黑雾移至中长期，灰度按钮忽略，用量探索 Demo 在 Web 工作树 archive 中归档，现有功能保留。混合 DPI 多屏、低内存手感与本轮新修复仍待用户实测。详见 [本轮 QA](docs/QA_DRAG_SETTINGS_2026-11-10.md)。

2026-11-10 Web 图片查看器修复：通用弹窗毛玻璃会改变固定定位图片的参照区域，隔离复现中媒体区域高度从 604px 变成 0，只剩文件名栏。媒体弹窗不再套用内容层毛玻璃，模糊仅留在独立遮罩；图片、画布、延迟插入媒体、返回按钮与普通弹窗回归通过，皮肤及底部渐隐回归、23 项 Web 单测通过。已热更新唯一运行资源 `content/skin.css` 并核对哈希，备份 `dist/local-runtime-backup-L0NOoM`；真实页面检查因浏览器 URL 安全校验中止，用户需重新加载扩展并刷新 Gemini 后复测。新增回归已接入 Web 浏览器测试入口，未封包或推送。见 [图片预览修复记录](docs/WEB_IMAGE_PREVIEW_2026-11-10.md)。

2026-11-10 `beta` 分支开设 + Memosyne 桥接适配器实装 + 设置中心/内容商店/网页端气泡美学重塑：桌面工作区已切入 `beta` 分支，在 `shared/companion-bridge.cjs` 中通过多路径自适应加载 `D:\Projects\Memosyne\src\catstella-bridge-adapter.cjs`，直接由 Catstella 桥接端口（3921–3923）服务 `/api/memory/*` 并转发 `POST /companion/sync` 的 `completedTurn`；同时重构桌面端 `settings.css`、双端 `content-hub.css`（Luminous Astral Boutique 画廊与灯箱）及网页端 `Gemini-Web-Companion/content/widget.js` 气泡（保留 `rgba(22, 16, 38, 0.94)` 尾巴色彩契约）与 `.kg-store` 弹窗。`shared/companion-bridge.test.cjs`、`settings-browser.cjs`、`online-browser.cjs`、`bubble-tail-browser.cjs`、`verify-store-clarity.cjs` 全部通过；已通过 `node tools/sync-local-runtime.cjs --desktop --web` 热更新本机安装目录与 Web 扩展产物，备份 `dist/local-runtime-backup-h2UA5Q`。

2026-11-10 自动碎碎念字号已获用户授权并修复：临时台词显式标记为 talk，首次显示即复用普通喵言喵语字号，不继承数字提示字号；六句内置台词在正常和窄窗口均无横纵滚动溢出，动作回归与 84 项单测通过。已热更新 renderer.cjs 并平滑重启，安装文件哈希一致，备份 `dist/local-runtime-backup-a80PkV`。这条授权取代此前“字号待办暂停”的指示；未封包或推送，等用户实测。

2026-11-10 全局鼠标迟滞复查：用户确认单纯移动即严重卡顿，在 Gemini Web 中观察到。发现 Windows `forward:true` 会安装系统级鼠标钩子；相同 250ms 主线程负载对照中，事件延迟约 230ms→16ms。已改为不使用全局转发的局部光标/异步命中方案，84 项测试、实际穿透/命中/拖动捕获及动作检查通过，已热更新，备份 `dist/local-runtime-backup-Lh9ldX`。实际开启/关闭短时自然采样未重现严重卡顿，仍待用户原场景复测，不宣称所有原因已排除。见 [输入排查记录](docs/MOUSE_INPUT_2026-11-10.md)。字号待办仍暂停。

2026-11-09 系统卡顿排查：窗口跟随改为消息唤醒、宿主身份限频检查，位置监听收窄至 AGY 所在线程；主进程忽略同一子进程的重复心跳。已热更新原生程序和主进程，84 项测试及实际窗口检查通过。8 秒采样的跟随程序单核占用约 12.1%→0.8%，但尚未证明全局鼠标迟缓全部消除，待用户复测。备份 `dist/local-runtime-backup-A1Ei8y`、`dist/local-runtime-backup-8nor30`。见 [性能记录](docs/PERFORMANCE_2026-11-09.md)。字号待办仍暂停，未封包或推送。

2026-11-09 最新待办：自动碎碎念「喵言喵语」气泡字号过大，长句排版拥挤，已记入路线图。用户明确要求先不做、等通知后再施工；本轮仅更新文档，不改代码、不测试、不热更新。

2026-11-09 Windows 托盘驻留：桌宠在 Windows 上补充 toolbar 工具窗类型，配合 skipTaskbar 防止窗口状态变化后重新进入任务栏；托盘与交互保留，设置窗口正常切换。实际 Win32 标志回归和 84 项单测通过，已热更新并核对正式实例，备份 `dist/local-runtime-backup-t78XYT`。CI/发布检查已补充，未推送或封包。见 [托盘驻留记录](docs/TRAY_RESIDENCY_2026-11-09.md)。

2026-11-09 后续圆角与性能修复：已恢复 AGY 回复旧版圆角、细边框、阴影与内边距，保留现有透明度；滑块改为本地预览、松手保存，宿主使用不传壁纸/不扫整页的外观更新通路。84 项单测、固定门禁及真实隔离设置窗口通过。6 项载荷已热更新，真实 AGY v4 圆角生效，用户 AI 背景 0% 和轮播偏好未变，仍只有 1 个皮肤监听。见 [修复记录](docs/AGY_ROUNDED_PERF_2026-11-09.md)，未封包或推送，等用户手感复测。

2026-11-09 AGY 最新修复与重载：用户授权后已重载窗口。旧皮肤焦点监听从 5 个清理至 1 个，两次宿主检查保持单实例，当前 4 条 AI 回复与 4 条用户消息各自效果一致。实际观测壁纸从 07 轮换至 08，选择与展示一致。源码修复及 83 项测试/固定外观检查已通过，载荷已热更新，未封包或推送。详见 [本轮修复与约束](docs/AGY_INVARIANTS_2026-11-09.md)。此前暂停施工的指示已由额度恢复后的授权取代；更长时间的原场景复测仍待用户确认，不能用“已加载”替代完整轮播实机验收。

2026-11-09 Web 额度显示方式：设置新增“剩余额度 / 已使用额度”（`quotaDisplay=remaining|used`，默认剩余），经典进度条、圆环与 Web 内同步的 AGY 行采用同一显示口径；只换算显示，不改变账本或桌面设置。隔离 UI 切换与 23 项 Web 单测通过，已用 `--web` 热更新 3 项资源并核对哈希；备份 `dist/local-runtime-backup-JZG1pd`，证据 `evidence/web-quota-display-2026-11-09.json`。用户需重载扩展并刷新 Gemini 页面。

2026-11-09 AGY 壁纸闪屏：修复同图重复通知重启动画及失焦丢弃过渡层的闪回，隔离回归通过并已热更新正式载荷、核对真实 AGY 新逻辑。见 [壁纸修复记录](docs/AGY_WALLPAPER_FIX_2026-11-09.md)。此记录只描述当时的检查，后续用户实测仍发现轮播覆盖，最终状态以最新修复记录为准。

2026-11-09 用户实测纠正后：气泡颜色/不透明度已重新接入 Web 和 AGY 的用户/模型对话背景，底部渐变仅回退相关合成 CSS；双端已实际热更新。见 [本轮纠正与部署记录](docs/CHAT_STYLE_FIX_2026-11-09.md)，此记录取代早先将该需求验收为桌宠气泡调整的结论。

2026-11-09 源码验收：已检查 ZCode 新增的 AGY 工具/等待态、商店更新卸载、主题工坊与双端气泡外观，修复了实际入口与失败恢复问题。详见 [本轮验收记录](docs/QA_2026-11-09.md)。此处保留当时的源码验收记录，后续部署以各专项记录为准；Tauri 实验仍由另一工作线程负责。

2026-11-08 发布补充。用户已验收 RC 3，授权发布桌面 0.6.1 和 Web 1.5.1。桌面从当前测试分支推进 main，Web 使用独立源码标签 `web-source-v1.5.1` 固定。Actions 生成 Windows x64、macOS arm64/x64 和 Linux x64 安装包，并检查原生窗口拖动和离屏恢复。macOS / Linux 的宿主窗口跟随仍待实现。

本版新增设置首次打开时的更新说明，文案位于 `Antigravity-Cat-Widget/assets/release-notes.json`，须与根目录版本一致。显示成功后由主进程持久化已读版本，同版本不再自动弹出；CI 同时检查首次展示和重开不再展示。

发布结果：`v0.6.1` 和 `web-v1.5.1` 已上线，Actions `42394456903` 的 Windows、macOS arm64/x64、Linux 与发布任务全部成功。桌面 Release 含 7 份安装文件、2 份 Web 扩展及校验清单；Web Release 另外提供同一组扩展。Mac 拖动通过 CI 原生窗口检查，真实设备的宿主跟随仍待后续适配。

> 更新时间：2026-11-05  
> 状态：下文保留的是 20:41 那次构建的历史记录。发布以 GitHub Actions 的三端构建和验收结果为准。<br>
> 桌面工作区：`D:\Catstella`，分支 `main`，跟踪 `origin/main`<br>
> Web 工作区：`D:\Catstella-web`，分支 `feat/browser-extension`

2026-11-06：两个目录是同一仓库的工作树。原作 `upstream` 只用于取代码。重复的本地桌面分支已移除，未提交改动已保留；远端 `feat/desktop-suite` 等实时核验后再清理。Web 分支有独有提交，桌面发布按版本标签取 Web 源码。

## 0.6.0 发布流程

- 新安装器移除了递归删除整个 `{app}` 的规则，并替换旧测试版遗留的卸载记录。卸载只额外清理内容全部是 Chromium 缺语言包告警的 `debug.log`。CI 分别验证干净安装、覆盖旧卸载记录后卸载，并检查安装目录中的用户文件仍在。
- Windows 和 Web 构建完成时自动生成 SHA-256 校验和。Windows 验收会比对随包内置的两份 Web 压缩包。发布任务对实际上传的七份 Windows、macOS、Linux 安装文件生成 `SHA256SUMS.txt`。
- Web 源码由 `web-source-v1.5.0` 标签固定，`v0.6.0` 触发三端封包。首次 `desktop-v0.6.0` 运行因 Windows 工作流漏编原生助手和素材换行转换而未发布。所有构建和启动检查通过后才创建 Release。Mac 和 Linux 是实验构建，未做实机回归。

## 用户最新决定

1. **不做桌面/Web 分包。** Web 扩展继续随完整安装包提供，双端联动和离线安装保持一体。
2. 删除 Chromium 的全部 `locales/*.pak`。这些文件服务于 Chromium 自带界面，不是 Antigravity 主题资源。
3. 旧独立 Dream Skin 应用退役；主题引擎继续保留为统一桌面应用的内部模块。
4. 实验性 BYOK 从运行源码封存到 archive，恢复前必须重新做 Antigravity 实机验证。
5. 不要在本轮发布前全量重命名 `Antigravity-Cat-Widget` / `Antigravity-Dream-Skin`。

## 已完成

### 旧 Dream Skin 壳层退役

以下旧独立应用文件已移入 `archive/legacy-dream-skin/`：

- `Antigravity-Dream-Skin/src/main/index.cjs`
- `Antigravity-Dream-Skin/src/main/preload.cjs`
- `Antigravity-Dream-Skin/src/renderer/index.html`
- `Antigravity-Dream-Skin/src/renderer/renderer.cjs`
- `Antigravity-Dream-Skin/src/renderer/style.css`
- 旧 `package.json`、README、图标和 `启动星语皮肤.cmd`

当前 `Antigravity-Dream-Skin` 只保留统一应用实际需要的内部主题引擎：

- `src/domain/settings.cjs`
- `src/domain/theme-loader.cjs`
- `src/domain/host-controller.cjs`
- `src/domain/localization-controller.cjs`
- `src/host/theme.cjs`
- `src/host/localize.cjs`
- `assets/wallpapers/`
- `assets/localization/`

根脚本 `start:skin`、`restart:skin` 已移除。皮肤只能由统一 Catstella 进程启动。

### BYOK 封存

- `shared/gateway/` 已移至 `archive/legacy-byok/shared/gateway/`。
- Dream Skin 的 BYOK portal controller 和注入入口已移至 `archive/legacy-byok/`。
- `Antigravity-Cat-Widget/src/main/index.cjs` 现在固定使用 `devGateway=null`、`byokPortal=null`，正常运行不会加载归档模块。
- 根 `package.json` 增加了 `"byokDevelopment": false`。
- 默认测试列表移除了已经归档的 gateway 测试。
- 安装器的旧版升级清理规则继续保留，用于删除用户机器上早先安装的 BYOK 文件。

### 构建精简

- `tools/build-installers.cjs` 不再复制 Dream Skin 的旧 `src/main`、`src/renderer`、独立 `package.json` 和旧图标。
- Dream Skin 只复制 `src/domain`、`src/host`、`assets/localization`、`assets/wallpapers`。
- `ForegroundHost.cs` 不再进入发行包，运行时只保留编译后的 `ForegroundHost.exe`。
- 构建产物会删除整个 Electron `locales/` 目录。
- `tools/verify-installers.cjs` 已增加断言：
  - Dream Skin 旧 main/renderer 不得进包；
  - `locales` 目录不得存在；
  - BYOK 不得进包；
  - Web 扩展 XPI/ZIP 继续进包；
  - 构建机文件 `GeneratedVersion.cs`、`IconSwap.exe` 不得进包。
- `tools/installer/star-suite.iss` 已增加覆盖升级清理，删除旧 Dream Skin 壳层、旧图标和旧 BYOK 文件。
- `[Files]` 通配符补上 `Excludes:"StartupSettings.exe,GeneratedVersion.cs,IconSwap.exe"`，避免把构建辅助文件装进 `{app}`。
- 新增 `[UninstallDelete] Type: filesandordirs; Name: "{app}"`：Electron 在无 locales 时会在安装目录写 `debug.log`，Inno 默认只删安装清单内的文件，导致卸载后目录残留。

### 0.6.0 发布结果

**可发布产物**

- 路径：`D:\Catstella\dist\installers\Catstella-Setup-0.6.0-x64.exe`
- 大小：**172,753,159 字节（164.75 MiB）**，写入时间 2026-11-05 20:41:04
- SHA-256：`94b63ab880d62dec055c6abaf1cdc2cb6d697bd016261a88644e256ffc79e16d`
- 同目录 `.sha256` 已按“哈希 + 两个空格 + 文件名”重写（97 字节，ASCII）；`dist/installers` 只有一个 exe，无 `*-slim.exe`。
- 构建命令：`node tools/build-installers.cjs`（未使用 `--slim`，未做 Web 分包）；日志 `dist/build-20261105-2042.log`，ISCC 编译 124.281 秒。

**四道验收全部通过**

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 单元测试 | `node --test <HANDOFF 列表 10 个文件>` | 65/65，日志 `dist/unit-tests-20261105-2043.log`（最终树复跑，20:43） |
| 安装/启动/卸载 | `node tools/verify-installers.cjs` | pass，报告 `evidence/installer-report.json`（checkedAt 2026-11-05T12:41:51.378Z） |
| 冷启动回归 | `node tools/verify-cold-start.cjs` | PASS，日志 `dist/verify-cold-start-20261105-2042.log` |
| 校验和 | `Get-FileHash -Algorithm SHA256` | 见上，已写回 `.sha256` |

安装验证覆盖：中文路径目录下静默安装、`LICENSES.chromium.html` 与 `NOTICE.md`、两个项目文件齐全、表情图标与 Web 扩展组件、自启动/快捷方式判定与临时 Run 项清理、安装后 EXE 在无 Node/无源码工作区下打开统一渲染层且设置可读、`unins000.exe` 卸载只删安装目录。Web 扩展 XPI/ZIP 断言仍在脚本内并通过。

**无 locales 的实际表现（重点结论）**

Electron 45.1.0 在完全没有 `locales/` 时**仍能正常启动并创建窗口**，安装后的主界面、设置读取、截图（`evidence/installer-Suite.png`）全部正常。唯一的副作用是启动时在 exe 同目录写一个 `debug.log`，内容为：

```
[1105/203547.461:WARNING:ui\base\resource\resource_bundle.cc:528] locale_file_path.empty() for locale
```

这是 Chromium 资源包缺失时的非致命告警，不影响功能；没有恢复任何 `.pak` 文件。该 `debug.log` 曾导致卸载后 `{app}` 目录删不掉（Inno 默认只删自己装的文件），已用 `[UninstallDelete] filesandordirs` 解决，安装验证连续两次通过。

**本轮额外修掉的构建/安装缺陷**

1. `[Files]` 的 `Source:"{#StageDir}\*"` 曾把 `GeneratedVersion.cs` 与 `IconSwap.exe` 装进 `{app}`（早期安装树 `dist/安装验证-ztxKgi/Suite/GeneratedVersion.cs` 可证）；已用 `Excludes` 拦掉，并在 `verify-installers.cjs` 加断言防回归。
2. 卸载目录残留（上述 `debug.log`）已用 `[UninstallDelete]` 清空 `{app}`；卸载器仍先执行 `StarSuite.exe --quit` 并等待 12 秒让进程退出。

**未做/未声称**

- 安装包仍未做代码签名，SmartScreen 首次运行仍会提示。
- 只在本机完成验证；`evidence/installer-report.json` 的 `secondComputerVerified` 仍为 `false`。
- `dist/` 下保留了历次 `installer-stage-*` 与 `安装验证-*` 目录（含旧构建日志），未做清理；发布只需 `dist/installers/` 两个文件。
- 目录/品牌全量重命名按用户决定留到后续版本，见下节评估。

## 全量品牌重命名评估

`Antigravity-Cat-Widget` 目前仍出现在约 30 处运行、测试、构建和安装器路径中。只改显示名称风险低；目录、数据目录和安装身份一起改则属于中高风险重构。

高风险耦合点：

1. Electron 入口：
   `Antigravity-Cat-Widget/src/main/index.cjs`
2. 跨目录相对 require：
   桌宠主进程仍引用 `../../../Antigravity-Dream-Skin/...`
3. 原生辅助程序和安装器：
   `ForegroundHost.cs`、`StartupSettings.cs`、`star-suite.iss`、图标路径和更新清理路径。
4. 开发/测试工具：
   `tools/launch.cjs`、`restart.cjs`、`sync-character-frames.cjs`、`source-hashes.cjs`、安装验证。
5. 用户数据：
   `~/.antigravity-cat-widget/`
   `~/.antigravity-dream-skin/`
   直接改名会丢失设置、账号相关缓存、账本与用户壁纸。
6. 安装器身份：
   `AppId`、HKCU 注册表键、默认安装目录和更新器必须继续识别旧安装。
7. 源码指纹：
   路径变化会改变升级验证与构建输入，必须在同一提交内更新。

建议分阶段：

1. **本轮不重命名目录。**
2. 先替换用户可见的旧品牌文案，保留全部路径、AppId 和数据目录。
3. 下一版本再改为 `Catstella-Desktop` / `Catstella-HostTheme`。
4. 目录迁移时保留旧目录兼容层或做一次性自动迁移。
5. 用户数据先双读后迁移，至少保留一个版本的旧路径回退。
6. 安装器 `AppId` 永久保持稳定；注册表键如需改名，必须有迁移逻辑。
7. 所有相对 require、源码指纹、打包脚本、原生工具和 Web worktree 检测在同一提交完成，再跑双端联动与覆盖升级测试。

## 仓库边界

- 桌面源码只改 `D:\Catstella`。
- Web 源码只改 `D:\Catstella-web\Gemini-Web-Companion`。
- 桌面目录原有的 `Gemini-Web-Companion` 副本已删除，不要恢复。
- 安装器和角色帧同步通过 `tools/web-companion-path.cjs` 寻找活动 Web 工作区。
- 不要 `git reset`、`git checkout -- .` 或清理现有未提交改动；工作区包含本轮之前的大量用户改动。

## 当前重要文件

- 构建：`tools/build-installers.cjs`
- 安装脚本：`tools/installer/star-suite.iss`
- 安装验证：`tools/verify-installers.cjs`
- 冷启动验证：`tools/verify-cold-start.cjs`
- 桌面主进程：`Antigravity-Cat-Widget/src/main/index.cjs`
- 内部主题引擎：`Antigravity-Dream-Skin/src/{domain,host}/`
- 旧应用归档：`archive/legacy-dream-skin/`
- BYOK 归档：`archive/legacy-byok/`
- 路线图：`docs/ROADMAP.md`
