# Catstella 的 Tauri 迁移调研

先验证 Windows 桌宠窗口，再决定是否替换 Electron。设置、商店、桌宠动作和台词的 HTML／CSS／JavaScript 已经通过 `window.widgetApi` 与桌面主进程隔开。可以保留这个接口和页面，逐步更换主进程的实现。浏览器扩展仍走现在的本机联动协议。

## 体积基线

数据来自本地 Windows x64 测试包 `0.6.1-beta.2` 和它的打包暂存目录。暂存目录一栏是原始文件体积，不能直接从成品安装包相减。

| 项目 | 体积 | 测量口径 |
| --- | ---: | --- |
| Windows x64 安装器 | 191.8 MiB | Inno Setup 成品 |
| Electron 与安装辅助文件 | 308.4 MiB | 暂存目录中 `resources/app` 之外的内容，未压缩 |
| 桌面应用代码与素材 | 37.2 MiB | 暂存目录中的 `resources/app`，未压缩 |
| Edge／Chrome 扩展 | 35.7 MiB | ZIP 成品 |
| Firefox 扩展 | 35.7 MiB | XPI 成品 |
| 九张追加壁纸 | 9.0 MiB | 桌面侧离线安装来源，两个扩展各有一份 |
| Tauri 等载荷压缩样本 | 92.2 MiB | 保留 37.2 MiB 的桌面载荷和两个扩展，以 8.62 MiB 的原型 EXE 替换 Electron 运行时 |

压缩样本用 Inno Setup 的 `lzma2/max` 和固实压缩，和现有安装器压缩设置一致。它用于测量载荷，未包含完整的 Tauri 桌面功能、正式安装逻辑或离线 WebView2。相比现有安装器，样本少了约 99.6 MiB，约 52%。这项测量支持继续验证迁移收益，实际发布体积还要计入移植后的主进程、安装器和运行时策略。

Tauri 在 Windows 上使用系统 WebView2。系统已有运行时的机器可以直接复用。缺少运行时的机器需要通过联网引导程序安装，或由安装包携带离线运行时。官方估算离线安装程序增加约 127 MB，固定运行时增加约 180 MB。比较时分别测「复用系统 WebView2」和「缺少运行时也可离线安装」两种方案，保持应用素材及两个扩展一致。 [Tauri Windows 安装文档](https://v2.tauri.app/distribute/windows-installer/#webview2-installation-options)

两个浏览器包合计 71.4 MiB，内置运行时换掉后仍要一起交付。对比解包文件后，65 个同名文件逐字节相同，占 Chromium 解包大小的 99.99%，其中壁纸离线来源单独压缩约 8.9 MiB。可以独立验证安装器是否能存一份公共扩展文件，再生成两个浏览器各自的包，以保留同一个安装器和离线交付能力。35.7 MiB 是公共文件在现有 ZIP 中的大致体积，成品能省多少仍需打包对比。森山白月的壁纸仅为本次测试包额外提供离线安装来源。后续新增素材按在线清单交付，届时再用相同素材重测两个桌面框架。

## Windows 原型

`prototypes/tauri-window-spike` 是独立实验。使用专用应用标识（`com.catstella.research.window`），窗口只有本地页面。命中测试创建自己的底板，不连真实 AGY，不占用现有联动端口。

首轮用 Tauri 2.12.5 在 Windows x64、150% 缩放下运行。原型 Release EXE 为 8.62 MiB。普通模式下，透明区和控件区都命中桌宠窗口。打开整窗穿透后，两处都命中底板。关闭穿透后，控件重新命中桌宠。这个试验只读取 Win32 的坐标命中结果。

```powershell
Set-Location D:\Catstella\prototypes\tauri-window-spike
cargo build --release --locked --offline
.\target\release\catstella-window-spike.exe
```

上面使用本机已缓存的依赖。首次构建时去掉 `--offline` 以获取锁定依赖。

## 第二轮：分区命中、拖动捕获与独立宿主跟随（2026-11-09）

第二轮在原型内复用真实立绘（`gemini-star-v1` idle 帧，1254×1254 RGBA）与星晶气泡样式，窗口 340×420 逻辑 px 划成三个分区：气泡区 0–150 可交互、空隙 150–230 动态穿透、立绘区 230–420 可交互。自动探针 `--probe-output=<目录>` 一次性产出 `report.txt` 与 `pet-region.bmp`，可重复执行；第三轮补充 z 序防刷、负坐标与辅助进程绑定后连续三次全绿，证据存于 `evidence/tauri-window-spike-2026-11-09/`。

结果（Windows x64、150%、单屏、scale=1.5）：

| 门槛 | 结果 | 说明 |
| --- | --- | --- |
| 分区动态穿透 | 通过 | 16ms 轮询线程读 `GetCursorPos` + `GetWindowRect`，按物理坐标折算分区，仅在状态变化时调用 `set_ignore_cursor_events`。`WindowFromPoint` 实测：气泡→桌宠、空隙→底板、立绘→桌宠 |
| 跨进程命中判定 | 通过 | 命中窗口是 WebView2 子 HWND（类名 `Chrome_RenderWidgetHostHWND`），必须经 `GetAncestor(GA_ROOT)` 折算到顶层窗口再比较；直接比较子 HWND 会误判 |
| 拖动保持捕获 | 通过 | 立绘 `pointerdown` → `start_dragging` 原生模态循环，`SendInput` 连续位移使窗口跨出自身矩形，采样 9 个不同位置无丢失；相对位移受系统指针速度倍率影响（本次 3.22x，方向比例一致） |
| 松手恢复穿透 | 通过 | 模态循环吞掉 `pointerup`，用 `GetAsyncKeyState(VK_LBUTTON)` 异步检测松手并恢复分区轮询 |
| 独立测试宿主跟随 | 通过 | WinEvent 钩子（`EVENT_OBJECT_LOCATIONCHANGE`/`EVENT_SYSTEM_FOREGROUND`）+ 200ms 兜底轮询；宿主移动 (120,80) 桌宠同步 (120,80)；前台是宿主时桌宠不置顶且紧贴宿主上方，前台切走恢复置顶——与 ForegroundHost 的 wantTop 策略一致 |
| DPI | 部分覆盖 | 150%（scale=1.5）下分区折算、命中、拖动、跟随全部正确；物理 510×630 = 逻辑 340×420。混合 DPI 单屏无法测，留待多屏环境 |
| 渲染截图 | 通过 | GDI `BitBlt` 抓屏，气泡与立绘渲染正常，透明区可见背后底板 |

过程中修复的真实失败：拖动松手监视线程最初未把 `dragging` 标志清回，分区轮询被永久暂停，松手后穿透不恢复；测试宿主窗口过早显示，拖动后空白分区恰好落在它身上，把恢复判定误报为 `other`；z 序首版语义与生产相反（生产是宿主前台→桌宠置顶）；探针用 `SetForegroundWindow` 切前台被系统前台锁间歇拒绝，改为 `SendInput` 真实点击目标窗口后连续三跑全绿。

### 第三轮补充（同日）：z 序防刷、负坐标与真实辅助进程

| 门槛 | 结果 | 说明 |
| --- | --- | --- |
| z 序策略对齐生产 | 通过 | 宿主或桌宠前台 → 桌宠置顶（浮在宿主上）；其他窗口前台 → 桌宠退普通层级并紧贴该窗口下方，与 ForegroundHost 的 wantTop 一致 |
| 空闲防刷（浮动任务栏重影缓解） | 通过 | 宿主持续前台 2.5s，`SetWindowPos` 调用数 0——只在层级位或邻居关系漂移时调用，对应生产注释里的 DWM 重影规避 |
| 负坐标平移 | 通过 | 宿主移到 x=-220（跨约 2700px），桌宠平移量逐像素一致；单屏即可验证平移数学 |
| 真实辅助进程接 Tauri 窗口 | 通过 | `ForegroundHost.cs` 参数化副本（进程名/类名经环境变量注入，生产文件未动）绑定测试宿主：`kind:"host"`、`attached:true`、bounds 与客户区逐像素匹配；宿主移动时其自带 followHost 精确平移 Tauri 桌宠窗口 |

关键发现：**Tauri 顶层窗口类名是 `Tauri Window`，不是 Electron/Chromium 的 `Chrome_WidgetWin_1`**。生产 `ForegroundHost.exe` 的 `IsHost` 同时硬编码进程名 `Antigravity` 与类名 `Chrome_WidgetWin_1`，迁移时两者都必须可配置（Rust 侧自行找窗或给辅助进程加参数），仅改进程名不够。

结论与边界：

- 「按物理坐标切换整窗穿透」在 Tauri + WebView2 上可以做到 Electron `forward: true` 的等效分区手感，且命中判定必须走顶层 HWND；整窗穿透的成功不等于分区命中成功，本轮已用三分区 + 跨进程底板区分验证。
- 像素级（立绘透明边缘）穿透未做：正式版 Electron 桌宠窗口同样是矩形级命中，本轮先对齐现状；像素级留作后续增强实验。
- 测试宿主是独立窗口，未验证真实 Antigravity 进程；辅助进程路径已用参数化副本验证可行，剩余是给生产副本定参数注入方式（环境变量或命令行）。
- 剩余门槛：混合 DPI / 锁屏恢复 / 浮动任务栏实机重影（需多屏、锁屏与真实任务栏场景，锁屏实验不能在用户会话上做）、100% 缩放复测（需改系统 DPI，未在本轮授权范围）、WebView2 缺失环境。

自动实验会短暂移动真实光标（分区命中与拖动需要），结束后恢复原位；手动模式不移动鼠标。

```powershell
$dir = Join-Path (Get-Location) 'target\spike-run'
Start-Process -FilePath '.\target\release\catstella-window-spike.exe' -ArgumentList "--probe-output=$dir" -Wait
Get-Content -LiteralPath (Join-Path $dir 'report.txt')
```

## 建议迁移顺序

| 环节 | 首轮做法 | 验收 |
| --- | --- | --- |
| 桌宠窗口 | 先替换窗口层。保留前端和宿主跟随辅助进程并把进程名/类名参数化（Tauri 顶层类名是 `Tauri Window`），通过 HWND 接到原型；分区穿透按第二轮的物理坐标轮询方案移植 | 已验：150% 下分区命中、拖动捕获、独立宿主跟随、z 序对齐与空闲防刷、负坐标平移、参数化辅助进程绑定。待验：100% 复测、混合 DPI、锁屏恢复、浮动任务栏实机 |
| 设置与本机数据 | 保留 `widgetApi` 和已有 JSON 格式。Rust 命令按窗口拆权限，首轮使用隔离配置目录 | 用真实配置的副本检查壁纸、角色、位置、计数和联动选择。回到旧版本时原配置可用 |
| AGY 与扩展联动 | 先保持 `/companion/*`、本机端口、来源与客户端校验。AGY 皮肤和额度经 AGY 的 CDP 连接，和 Catstella 自己用哪个 WebView 分开迁移 | 现有扩展无需更新就能联动。覆盖 AGY 重启、壁纸切换、额度更新和断线重连 |
| 安装与更新 | 先用同一批素材测安装体积、冷启动和常驻资源，再验证跨版本安装与回滚。Tauri 更新器需要独立签名 | 保留单实例和退出旧进程的逻辑。确认有无 WebView2、联网与断网安装。签名和发行渠道单独验证 |

透明、命中、宿主跟随是启动迁移的门槛。等它们通过后，再决定把本地 HTTP、日志解析和 CDP 客户端逐块移到 Rust 的顺序。Tauri 已提供托盘、快捷键、单实例和更新器相关能力，仍需对照 Catstella 的行为实测。 [Tauri 插件目录](https://v2.tauri.app/plugin/) · [Tauri 更新签名](https://v2.tauri.app/plugin/updater/#signing-updates)
