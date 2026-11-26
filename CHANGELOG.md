# 更新记录

> 桌面端独立更新记录（`0.x.y`）。浏览器伴侣扩展（`1.x.y`）更新记录见 `Catstella-web/CHANGELOG.md`。

## 0.7.0 · Tauri 2 底层架构迁移与转正 + 设置中心重构 + 跨端联动重构 / 2026-11-26

- **Tauri 2 转正与旧 Electron 外壳封存**：正式切换为基于 Rust + WebView2 的原生运行底座（`src-tauri/`），集成窗口管理、16ms 鼠标穿透命中路由、CDP 宿主编排、Windows 自启/宿主监听守护（`--watch-host`）、本地 Web 伴侣桥接及专属 Inno 安装包（`Catstella.exe` / `Catstella-Setup-0.7.0-x64.exe`，默认安装至 `%LOCALAPPDATA%\Programs\Catstella` 并自动承接旧版安装退出）；退役的 Electron 主进程、旧版设置页、C# 辅助与旧安装脚本统一归档至 `archive/legacy-electron/`。
- **设置中心重构**：设置界面重构为「桌宠 / 外观 / 用量 / 连接 / 商店」5 频道 Bento HUD，左侧实时预览舱桌宠居中；商店恢复「系列图包」轻微堆叠卡片、角标计数、多图条带浏览与整套补装能力，并接入真实 GitHub 在线目录/SHA-256 下载安装与 Release 更新检查；状态刷新原地更新节点保留滚动与焦点，支持设置页 `试听采样` 静音直听及动态文本 HTML 转义防护。
- **用量耐力条实装**：通过共享 `side-quota.js` 统一桌宠与 HUD 预览舱的平面耐力计样式，实装镜像弧线、四芒星进度端点、紫红沙漏（`#ce65b5`）编排器图标以及去除了顶部图标的竖条能量柱。
- **Antigravity 通道与皮肤冷启动修复**：修复宿主 CDP HTTP keep-alive 与切回宿主时的配额刷新延迟；清理已下线的 Argon 独立计量代码并打通 `Claude / GPT` 气泡配额页；`host_orchestrator` 在冷启动注入前校验 `readyState`、`.agy-sheet` 布局及原生背景暗度，避免先开桌宠后开宿主时皮肤泛白。
- **单实例生命周期与托盘交互**：修复 `重启套件` 与单实例互斥锁竞态导致直接退出的问题（新增 `--wait-single-instance` 等待与 `--restart` 本地 IPC，并在重启时先停止宿主编排与落盘账本再拉起子进程）；新增系统托盘左键双击直接打开设置中心。
- **Web 伴侣跨浏览器联动与称呼统一**：本地桥接补充私有网络预检响应（`Access-Control-Allow-Private-Network`）；`Catstella-web` 适配 Firefox 内容脚本 Promise 契约与 `window` 导出并实现零等待互动音效，同时修复 Tauri 启动 5 秒兜底把互斥隐藏的桌面桌宠误召回的问题；桌面端与浏览器端统一默认称呼为“人类”。
- **验证与安装包**：源码与前端暂存同步，Rust 31 项单测 + 1 项无种子直连 GitHub 商店实测（9 张图包解析、真下载 SHA-256 安装/卸载与更新检查）、Catstella Node 112 项、Catstella-web 29 项单测及 HUD 商店（含系列图包）阶段冒烟全绿。发行包 `Catstella-Setup-0.7.0-x64.exe` 82,438,784 字节（78.62 MiB，含最新 v1.5.2 双端浏览器扩展），SHA-256 `f1ca677cc36f2f39a17d5c20c99677ba93db0e8f7c648e09f584b016909ea39e`（核心可运行二进制 23,862,784 字节 / 22.76 MiB）。

## 0.6.0 · 星语/霓音新角色 + 在线图库与更新检测 + 点击语义重做 / 2026-11-05

- **新角色与素材**：默认角色换成星语（`gemini-star-v1`）和霓音（`lin-cat`），由项目提供的五张透明帧适配，沿用原角色包 ID；旧立绘仅在本机 `art_assets/archive/pre-0.6-art/` 备份，不进发行包。内置壁纸换成四张新图（星语、霓音各两张），尺寸与 SHA-256 记录在壁纸包清单。
- **点击语义重做**：`pet-behavior.js` 统一裁决——只有短按（≤700ms 且位移 ≤10px）才触发互动，长按、滑动、拖动不再弹气泡；点头部按概率触发得意，快速连点会气恼，间隔点按或点出部分台词可能害羞。空闲眨眼；气泡收起后空闲约三分钟打盹，点击唤醒。停靠改由菜单选择左下/右下，不再依赖拖拽。
- **在线图库与更新**：设置中心「桌宠」「壁纸」各带在线图库（`online-assets/catalog.json`，含 WebP 预览、大小与 SHA-256），检测到本地缺少的素材会提示安装；「关于」支持自动/手动更新检测和在线配色；新增「自动碎碎念」（空闲冒一句，无音效）。桌面与网页联动端口扩为 `127.0.0.1:3921–3923`，并新增焦点互斥（浏览网页端时桌面猫自动隐藏）。
- **发行结构与精简**：旧独立 Dream Skin 壳层退役到 `archive/legacy-dream-skin/`（只保留内部主题引擎），实验性 BYOK 封存到 `archive/legacy-byok/`（`byokDevelopment:false`，主进程固定 `devGateway=null`、`byokPortal=null`）。安装包删除全部 Chromium `locales/`，并用 Inno `Excludes` 拦掉 `GeneratedVersion.cs`、`IconSwap.exe` 等构建机文件；卸载时清空 `{app}`，避免运行时生成的 `debug.log` 残留导致目录删不掉。安装目录改为 `%LOCALAPPDATA%\Programs\Catstella\Suite`。
- **验证**：65 项单测全绿；Inno 静默安装 → 无 locales 启动 → 读取统一渲染层设置 → unins000 卸载目录消失全链通过（无 locales 时 Electron 只在 `debug.log` 写 `locale_file_path.empty()` 警告，功能正常）；冷启动隔离测试通过（保存的形象首帧生效、短按可交互、长按/滑动/拖动无效）。发行包 `Catstella-Setup-0.6.0-x64.exe` 172,753,159 字节（164.75 MiB），SHA-256 `94b63ab880d62dec055c6abaf1cdc2cb6d697bd016261a88644e256ffc79e16d`。测试 65 项全绿。版本 0.6.0。

## 0.5.0 · 界面汉化翻译层 + 立绘缓存击穿 + 帧图同步工具 / 2026-11-03

- **Antigravity 界面汉化（实验）**：宿主为自研 React IDE，"自带汉化文件"仅是 Chromium 层 .pak（只管原生菜单），改 asar 属禁区——故走 **CDP 注入翻译层**（与主题化同通道）：`localize.cjs`（serialized，自包含）字典精确匹配替换可见文本节点，MutationObserver 增量跟随；输入框/代码/终端/[contenteditable] 绝对不碰；原文记录于数组、关闭语言时完整还原；独立 `LocalizationController` 按签名增量注入/销毁。统一面板新增「Antigravity 界面语言」选择（English / 简体中文），起步字典 60+ 条（数据目录 JSON 可持续扩充）。沙箱验证：注入→翻译→保护区免疫→销毁→还原全链路。
- **立绘缓存击穿**：主进程计算 character-packs 内容指纹（size+mtime 哈希，15s 缓存）作为 `artVersion` 注入快照；渲染层全部帧图 URL 携带 `?v=<指纹>`，资产一变 Chromium 文件缓存自动失效——根治升级后"偶尔变回老版本红眼立绘"。
- **帧图同步工具**：`tools/sync-character-frames.cjs [--check]`——从 web 端（角色素材权威源）同步到桌面 character-packs，自动探测 worktree 分房后的路径（../Catstella-web 或 WEB_COMPANION_PATH）。
- **Inno 验收链加固**：web 端组件改为从 worktree 现场构建（`tools/web-companion-path.cjs` 探测，分房后不再依赖旧单仓库路径）；新解压 EXE 被杀软短暂扫描导致的自检/断言偶发失败改为轮询重试；`StartupSettings --self-test` 删除遗留的快捷方式创建测试段（Inno 已接管快捷方式，该行为也是 Defender 行为启发式的误报源）。
- 测试 48 项全绿。版本 0.5.0。

## 0.4.2 · 额度断供修复 + Inno Setup 组件化安装器 / 2026-11-03

- **额度断供根因修复**：`queryHostQuota`（CDP 服务主路径）返回值丢失 `cacheAvailable:true` 标记——适配器把所有主路径样本误判为"宿主不兼容"丢进 initializing 桶，Gemini 额度永远显示 "—"。恢复标记并在测试钉死 `out.cacheAvailable===true`（此前 mock 直接返回样本绕过了真实路径，教训：主路径输出形状要有形状断言）。
- **安装器迁移 Inno Setup 7.1.1**（`tools/ensure-inno.cjs` 一次性 vendor，`npm run setup:inno`）：`star-suite.iss` 组件化——core（桌宠+皮肤，fixed）/ webext（Web 插件包+安装指引，可选档位 1：复制 xpi/zip + 图文 HTML 指引）；任务页自启动/联动（[Code] 写入 SetFlags 语义注册表+Run 项）；安装前优雅退出旧实例并清标志放行守护；卸载前优雅退出 + 等待，卸载后清标志（个人数据保留）；简体中文官方语言包。LZMA2 压缩使安装器 175M→152M。旧 C# SetupProgram 退役（StartupSettings.exe 保留 --watch/--self-test 职责）。
- 验收链适配：Inno 静默沙箱安装（非中文目录 + 全组件断言 + webext 产物断言）→ 真实渲染层启动 → unins000 卸载收尾；playwright 沙箱孤儿进程按测试 data-dir 精准清理。测试 48 项全绿。

## 0.4.1 · 模型/思考强度识别回归 + Claude&GPT 实时额度 + 瞳色修正 + 侧栏渐变清除 / 2026-11-03

- **模型识别复活**：`extractModelInfo`（stash 移植）从宿主模型选择器 `[data-testid="model-selector-trigger"]` 只读解析当前模型名与思考强度（High/Medium/Low/None/Off/Extended），随额度查询共用同一次 evaluate（`({modelInfo:…,…await query})`），零额外请求、零 UI 干扰；气泡额度页新增模型徽标与思考强度角标。
- **Claude & GPT 通道**：`readHostQuota`/`queryHostQuota` 升级为多模型组解析——同一缓存/服务里同时抓取 Gemini Models 与 Claude/GPT 组的双周期比例与重置文案（`(?:resets?|refresh) in` 双措辞兼容，满额显示"满额"）；快照新增 `claudeGpt`/`fiveHourReset`/`weeklyReset`/`modelInfo`，切换宿主时与额度一并清空。序列化契约修复：注入宿主的函数保持完全自包含（helper 内联，勿引用模块级符号）。
- **瞳色修正**：默认 gemini-star-v1 全部帧图同步 web 端分支的修正版（idle/proud/sad 系列实测 md5 不同），`shy/angry` 两帧随之点亮（表情管线此前已就绪）。
- **主题微调**：侧栏与选中项的装饰性渐变（radial+repeating-linear）整条移除，保留底色/描边/内侧高亮；`user-query` 容器加毛玻璃卡片与投影，提升用户回复在壁纸上的可读性。
- 测试 48 项全绿（新增 Claude 通道解析、模型信息随行与陈旧保留、宿主切换清空、重置文案解析 4 项）。版本 0.4.1。

## 0.4.0 · 星语套件统一实例：stash 复活 + 单托盘 + Suite 安装包 / 2026-11-03

- **Stash 复活**：从 `stash@{1}`（基于 0.2.10 的 WIP local desktop edits，+1748 行）完整移植用户 fork 前的设置中心设计——无边框自绘标题栏（拖拽区+最小化/关闭）、桌宠形态画廊（横向/网格双视图+素材管理目录）、壁纸画廊+阻尼轮播滑块(1-60min)+磨砂玻璃开关、单击桌宠三段巡检（Gemini Models→Claude & GPT→聊天互动）、proud/crying/shy/angry 表情预览、refresh-state 缓存刷新。
- **恢复丢失素材**：`lin-cat` 第二形态六帧从 kimino 扩展目录找回并按挂件约定重建 manifest；`shy/angry` 帧对 gemini 形态仍缺失（原为未跟踪文件已散佚），管线就绪、放入帧图即生效。
- **真·单实例**：皮肤域（DreamSkinSettings/WallpaperManager/HostController）并入挂件主进程——一个 Electron、一个托盘、一份 Chromium；壁纸设置并入统一面板；轮播改为分钟级 slideshow 单一真源（autoRotate 降级为惰性扩展字段，`legacyRotatePatch` 一次性迁移）；`wallpaperFile`↔`wallpaperId` 双向同步。claudeGpt 额度通道数据层未移植（页占位显示 —，待后续对齐 host-quota）。
- **Suite 安装包**：`StarSuite-Setup-0.4.0-x64.exe`（173M）替代旧双包——双项目统一负载、开始菜单仅 启动/设置/卸载 三项（图标=默认/得意/委屈表情 ico，sharp 运行时生成）、`IconSwap.cs`（BeginUpdateResource 零依赖）替换 StarSuite.exe 的 Electron 默认图标、`--settings` 直达设置中心。verify:installers 4/4 全绿（统一渲染层实启+自检+沙箱卸载）。
- 旧 Widget/Skin 0.3.1 安装已优雅卸载（注册表/快捷方式/标记校验目录）；个人数据目录零迁移沿用。测试 44 项全绿。

## 0.3.1 · 上游新版特征兼容移植（数据目录壁纸 / slideshow / 点击语义） / 2026-11-03

- **壁纸包兼容**：`WallpaperManager` 新增用户壁纸目录扫描（`数据目录/wallpapers/`，上游 0.2.12+ 的布局）——散装图片即包（id=文件名），子目录按完整包解析；散图预览走 `file:` 绝对 URL。仓库内置包与用户包统一进出选择器与轮转。
- **字段迁移**：上游旧字段一次性迁移到本地单一真源——`wallpaperFile` 匹配到扫描包时自动写入 `wallpaperId`；`slideshow`+`slideshowIntervalMinutes` 经 `legacyRotatePatch` 映射为 `autoRotate`（≤20 分钟→15m，否则 1h）后退役，不再反复覆盖面板设置。sanitize 全程保留外来字段不丢弃。
- **挂件点击语义**：恢复上游 `clickCatAction`（字符串模式，"talk" 等真值=点击保证触发表情与台词，"off"/false 关闭）与 `clickCyclesBubblePage`（轻点循环切换气泡页：额度→今日→最新→聊天）；拖动仍算拖动，键盘空格/回车同语义；设置面板新增两个开关。
- 版本 0.3.1；测试 44 项全绿（新增用户壁纸包迁移、legacy 字段映射、点击设置归一化 3 项回归）。

## 0.3.0 · 桌面端独立化改造：多壁纸管理 + Standalone 常驻 + 安全热重启（main） / 2026-11-03

- **配置丢弃根治**：`DreamSkinSettings.sanitize()` 改为"先合并、再校验已知项、保留扩展字段"，`wallpaperId` 与动态扩展属性（如 `customWallpaperPath`）不再被重启抹杀；新增 `autoRotate` 轮转模式（off/15m/1h/boot）。
- **WallpaperManager**：`theme-loader.cjs` 重构为多壁纸包动态扫描（`assets/wallpapers/` 子目录即包，manifest 可选，放入图片自动识别）；废除单文件 SHA256 强校验与硬编码路径，仅按文件头校验 PNG/JPEG/WebP 有效性并实测尺寸，损坏包自动跳过不白屏；保留路径穿越防护。控制面板新增壁纸选择与轮换设置，托盘支持手动切换下一张。
- **Standalone 独立常驻**：挂件新增 `standaloneDesktopMode`（默认开启）。宿主窗口不可用时不再隐藏/闪退，而是优雅退守桌面（恢复独立尺寸，回到用户最后自由坐标或缺省右下角），互动全功能保持；宿主恢复后无缝回到磁吸跟随。托盘与设置面板均可控制该开关；离线时额度条沿用既有 cached/stale 缓冲语义。
- **安全平滑重启**：新增 `npm run restart:widget` / `restart:skin`（`tools/restart.cjs`）——先经单实例 IPC 发送 `--quit`，以 `tools/lock-probe.cjs` 轮询单例锁释放（退出码 0/3），再基于当前 Git 源码重新拉起；全程不 `taskkill /f`，不触碰 `%LOCALAPPDATA%` 外部安装目录，`writeJson` 原子写入不受中断威胁。
- **测试**：`npm test` 41 项全绿（原 40 项中 2 项按多壁纸架构重构断言，新增 sanitize 字段保留回归 1 项）。

## 0.2.12 · 独立安装包（测试版） / 2026-11-02

- 新增挂件和壁纸两个独立Windows x64安装EXE，内置Electron运行时，创建桌面与开始菜单入口及独立卸载项。
- 可选开机启动、宿主启动联动；首次均默认关闭，在独立启动设置里随时修改。联动不依赖宿主安装路径，不修改快捷方式。
- 新增可复现构建脚本及隔离安装/运行/卸载验证，保留运行时与素材来源说明。
- 保留0.2.11后台额度功能。安装包未签名，跨电脑和真实重新登录验收仍待反馈。

## 0.2.11 · 后台额度与启动重试（测试版） / 2026-11-02

- 启动即调用已登录宿主自身额度服务，只提取 Gemini 双周期比例；不导出凭据、不打开设置页。
- 失败后 3/6/12/24/30 秒退避重试，成功后每30秒查询，防止重复请求和停止后的迟到响应覆盖。
- 手动读取也使用后台路径，设置页新增连接/查询/兼容状态。
- 补充跨电脑安装条件与内部接口变动风险。本机验证不等同第二台设备验收。

## 0.2.10 · 窗口跟随与启动读取 / 2026-11-01

- 同步最新宿主识别、窗口恢复及层级处理；切换其他应用时取消置顶并排在前台窗口后方，宿主隐藏或最小化时隐藏挂件。
- 启动立即读取已有额度缓存，每 30 秒刷新读取；不再自动打开 Settings → Models，缺失数据仍显示未知。
- 修正健康检查定时参数，运行一小时后降低检查频率，两小时后进一步降低，避免高频捕获消耗。
- 保留已确认美术和四套公开音效，继续排除个人配置、日志及快捷方式备份。

## 0.2.9 · 首次公开源码 / 2026-10-31

- 基于本机最终确认版本导出两个独立插件，保留按压回弹、双周期额度、窗口跟随恢复与整窗玻璃皮肤。
- 同一宿主目标内保留最近额度，陈旧或错误时标记待更新；切换目标与重启不沿用账户缓存。
- 重写公开 README、隐私说明和素材许可边界，提供可复现的 npm 启动与原生辅助程序编译步骤。
- 移除私人日志、原设参考图、本机快捷方式补丁与备份、已编译程序和未明确授权的 DSH 鸭叫音频。公开版本含四套八段音效；本机工作版本未改。

此版本为源码发布，不沿用旧便携包作为本次功能验证证据。
