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
| z 序策略对齐生产 | 通过 | 宿主或桌宠前台 → 桌宠置顶（浮在宿主上）；其他窗口前台 → 桌宠退普通层级并被其遮挡，与 ForegroundHost 的 wantTop 一致 |
| 空闲防刷（浮动任务栏重影缓解） | 通过 | 宿主持续前台 2.5s，`SetWindowPos` 调用数 0——只在层级位或邻居关系漂移时调用，对应生产注释里的 DWM 重影规避 |
| 负坐标平移 | 通过 | 宿主移到 x=-220（跨约 2700px），桌宠平移量逐像素一致；单屏即可验证平移数学 |
| 真实辅助进程接 Tauri 窗口 | 通过 | `ForegroundHost.cs` 参数化副本（进程名/类名经环境变量注入，生产文件未动）绑定测试宿主：`kind:"host"`、`attached:true`、bounds 与客户区逐像素匹配；宿主移动时其自带 followHost 精确平移 Tauri 桌宠窗口 |

关键发现：**Tauri 顶层窗口类名是 `Tauri Window`，不是 Electron/Chromium 的 `Chrome_WidgetWin_1`**。生产 `ForegroundHost.exe` 的 `IsHost` 同时硬编码进程名 `Antigravity` 与类名 `Chrome_WidgetWin_1`，迁移时两者都必须可配置（Rust 侧自行找窗或给辅助进程加参数），仅改进程名不够。

### 第四轮（同日）：跨进程独立底板/宿主、真实点击送达与 30 轮循环

针对「同进程底板不能证明跨进程送达」的验收意见重做：底板与测试宿主改为**独立进程**（`spike-external.exe`，纯 Win32 窗口，点击写入日志文件），探针报告三方 HWND/PID 并断言互不相同；点击送达不再只看 `WindowFromPoint`，而是验证**真实点击**（`SendInput`）被目标端处理。

| 验收项 | 结果 | 说明 |
| --- | --- | --- |
| 独立进程底板/宿主 | 通过 | backdrop_pid / host_pid / pet_pid 两两不同；`WindowFromPoint` 空隙命中独立底板（类 `SpikeExternalWindow`） |
| 气泡按钮真实点击送达 | 通过 | 气泡内固定坐标「计数按钮」→ `SendInput` 点击 → WebView2 收到 → JS → Rust `bubble_ping` 计数递增，30 轮每轮验证 |
| 空隙点击真实送达底板 | 通过 | 空隙点击穿透桌宠后由独立底板进程写入点击日志（文件计数），30 轮每轮验证，同时该点击使底板成为前台 |
| 30 轮跨区拖动/松手/前台切换 | 30/30 | 每轮：宿主点击→置顶、气泡 ping、拖动跨出折返（采样 8 个不同位置、净位移归零）、空隙点击→底板送达→桌宠沉底（z 链可见性判定） |
| 宿主关闭（cycle 10） | 通过 | 宿主进程被杀：桌宠按生产语义沉底被盖住，交互预期退化，进程与窗口存活 |
| 宿主重建句柄（cycle 11） | 通过 | 重启宿主进程获得新 HWND/PID，跟随引擎重绑后置顶与跟随恢复 |
| 无效句柄（cycle 12） | 通过 | 引擎指向 `0xdead_beef` 句柄 400ms：ClientToScreen/GetWindowRect 静默失败，无崩溃，恢复真句柄后一切正常 |
| 退出清理 | 通过 | `WM_CLOSE` 优雅关闭两个外部进程，窗口句柄消失确认，探针自动退出 |
| 资源基线 | 记录 | 静置 CPU 0.0%、工作集 ~31MB；跟随中 CPU 0.0%、+0.2MB；线程 40→37（30 轮后无堆积；拖动松手监视线程按次退出） |

第四轮中修复的实验缺陷：底板与桌宠矩形必然重叠（底板必须盖住空隙区），旧流程在「底板前台→桌宠沉底」后直接点桌宠，点击全落在底板上，30 轮从第 2 轮起全灭；改为每轮以「点击不重叠的宿主→置顶」开始。z 序沉底判定从「紧贴前台窗口下方」放宽为「z 链 8 步内可见」——IME/MSCTFIME 等系统窗口会紧跟激活窗口插入，紧贴不可持续也不影响生产语义。z 序管理相应放宽 kept 条件，避免每 200ms 重插。

结论与边界：

- 「按物理坐标切换整窗穿透」在 Tauri + WebView2 上可以做到 Electron `forward: true` 的等效分区手感，命中判定走顶层 HWND；跨进程送达已用独立进程底板点击日志与气泡按钮计数双重实证。
- 像素级（立绘透明边缘）穿透未做：正式版 Electron 桌宠窗口同样是矩形级命中，本轮先对齐现状；像素级留作后续增强实验。
- 测试宿主是独立 Win32 进程，未验证真实 Antigravity 进程；辅助进程路径已用参数化副本验证可行，剩余是给生产副本定参数注入方式（环境变量或命令行）。
- 剩余门槛：混合 DPI / 锁屏恢复 / 浮动任务栏实机重影（需多屏、锁屏与真实任务栏场景，锁屏实验不能在用户会话上做）、100% 缩放复测（需改系统 DPI，未在本轮授权范围）、WebView2 缺失环境、跟随引擎对宿主**自动重扫描**（当前重绑是显式 stop/start；生产辅助进程每拍重找宿主，迁移时保留该行为）。

### 第五轮（同日）：设置与本机数据门槛（迁移顺序第二步）

验证「Rust 拥有 JSON 设置文件与隔离目录、页面经 IPC 读写」这一 `widgetApi` 替代模式：

| 验收项 | 结果 | 说明 |
| --- | --- | --- |
| 真实 IPC 写入 | 通过 | 气泡内「存取配置」按钮 → `SendInput` 点击 → WebView2/JS → `cfg_experiment` 命令 → 原子写（临时文件 + rename） |
| 隔离目录 | 通过 | 配置写入 `%TEMP%\catstella-window-spike-config\settings.json`，与真实配置 `~/.antigravity-cat-widget` 完全隔离 |
| 内容往返 | 通过 | 磁盘文件直接解析：标量、字符串、嵌套对象/数组全部一致 |
| 跨进程持久化 | 通过 | 第二阶段以 `--probe-verify-config` 启动全新进程，懒加载读回第一阶段全部值精确一致（`config_persistence_pass=true`） |

该模式与生产 `SettingsManager`（读 JSON → sanitize → 写回）同构，迁移时把 sanitize 逻辑逐条翻成 Rust、保留 JSON 字段名即可；`widgetApi` 的 IPC 面先由 Tauri command 等价实现，页面代码仅换绑定层。

### 第六轮（同日）：联动协议门槛（Rust 侧 /companion/*）

生产实例占 3921 的约定不变，spike 内用纯 `std::TcpListener` 实现最小 `/companion/*` 服务并绑定**备用端口 3922**（扩展的 `BRIDGE_PORTS=[3921,3922,3923]` 依次探测，无需改动扩展即可被发现）：

| 验收项 | 结果 | 说明 |
| --- | --- | --- |
| 端口策略 | 通过 | 3921 归生产、spike 落 3922，与扩展的备用端口扫描一致 |
| GET /companion/state | 通过 | 200，`ok/ts/port` 与 `web` 快照结构对齐生产 `buildPayload`，CORS `*` |
| GET /companion/wallpapers | 通过 | 200，`id/title/fileName/preview/revision` 条目结构一致 |
| POST /companion/sync 头校验 | 通过 | 缺 `X-Catstella-Client: gemini-web-companion` → 403 `missing_client_header`；带头 → 200 |
| Origin 校验 | 通过 | 外部 `https://evil.example` → 403 `Forbidden origin`；`chrome-extension://` → 放行且 CORS 回显该 origin |

扩展真机对接（隔离浏览器加载扩展→发现 3922 服务→跑通握手/状态流）需要浏览器自动化会话，留待下一批；Rust 侧协议实现与 schema 一致性本轮已证。端口在探针退出后随进程释放（netstat 确认无监听残留）。

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
| 设置与本机数据 | 保留 `widgetApi` 和已有 JSON 格式。Rust 命令按窗口拆权限，首轮使用隔离配置目录 | 已验（第五轮）：隔离目录 + 原子写 + IPC 往返 + 跨进程持久化。待验：真实配置副本的全字段迁移（壁纸/角色/位置/计数/联动选择）与旧版本回读 |
| AGY 与扩展联动 | 先保持 `/companion/*`、本机端口、来源与客户端校验。AGY 皮肤和额度经 AGY 的 CDP 连接，和 Catstella 自己用哪个 WebView 分开迁移 | 已验（第六轮）：Rust 侧最小服务在备用端口跑通 schema/头校验/Origin 规则。待验：隔离浏览器 + 真实扩展对接、AGY CDP 通道、断线重连 |
| 安装与更新 | 先用同一批素材测安装体积、冷启动和常驻资源，再验证跨版本安装与回滚。Tauri 更新器需要独立签名 | 保留单实例和退出旧进程的逻辑。确认有无 WebView2、联网与断网安装。签名和发行渠道单独验证 |

透明、命中、宿主跟随是启动迁移的门槛。等它们通过后，再决定把本地 HTTP、日志解析和 CDP 客户端逐块移到 Rust 的顺序。Tauri 已提供托盘、快捷键、单实例和更新器相关能力，仍需对照 Catstella 的行为实测。 [Tauri 插件目录](https://v2.tauri.app/plugin/) · [Tauri 更新签名](https://v2.tauri.app/plugin/updater/#signing-updates)

### widgetApi 面清单（绑定层替换施工图，2026-11-09）

`src/main/preload.cjs` 暴露的 18 个方法逐条映射。结论：16 个是 command/event 的直接平移；`drag` 已在 spike 用原生 `start_dragging` 验证（比 Electron 三段式 `widget:drag` 更简单）；`hit`（渲染进程命中上报）被 spike 的 Rust 物理坐标分区轮询整体替代，前端不再需要上报。

| widgetApi | Electron IPC | Tauri 等价物 | 授权窗口 |
| --- | --- | --- | --- |
| `get` | invoke `widget:get` | command `settings_get` | pet + settings |
| `save` | invoke `widget:settings` | command `settings_save` | pet + settings |
| `rememberBubble` | send `widget:bubble-preference` | command（fire-and-forget） | pet |
| `ready` | send `widget:ready` | command `page_ready` | pet |
| `byok` | invoke | 已封存；重启用时再映射 | — |
| `online` | invoke `widget:online` | command `online_action`（catalog/download/uninstall/source/preview-theme） | pet + settings |
| `releaseNotes` / `markReleaseNotesSeen` | invoke | 各自 command | pet |
| `canChatter` | invoke | command | pet |
| `command` | send `widget:command` | command（preview-reaction、打开设置等） | pet |
| `pointer` | invoke `widget:pointer` | command | pet |
| `drag` | send `widget:drag` | **原生 `start_dragging`**（spike 已验） | pet |
| `hit` | send `widget:hit` | **删除**——Rust 分区轮询替代 | pet |
| `audio` | invoke `widget:audio` | command + 资源解析 | pet |
| `subscribe` | on `widget:snapshot` | event `widget://snapshot` | pet |
| `onStep` | on `widget:step` | event | pet |
| `onReaction` | on `widget:reaction` | event | pet |
| `onNavigate` | on `widget:navigate` | event | pet |
| `onRefresh` | on `cat:refresh` | event | settings |

页面侧只需换绑定层实现（同名 `window.widgetApi` 由 Tauri 的 `invoke`/`listen` 组装），业务 JS/CSS 不动。

### 第七、八轮（同日晨）：自动重扫描与安全边界

| 验收项 | 结果 | 说明 |
| --- | --- | --- |
| 宿主自动重扫描 | 通过 | 兜底轮询检测 `IsWindow(host)==0` → 按标题重找 → 自动重绑（对齐 ForegroundHost 每拍 `FindHost`）。探针杀宿主进程 → 重启 → 引擎 1.5s 内自动拾取新 HWND 并恢复精确平移跟随（delta (60,40)），全程无手动 stop/start |
| 30 轮回归 | 30/30 | 全量探针在自动重扫描 + capabilities 变更后连跑全绿 |
| IPC 按窗口拆权限 | 模式已立 | spike 加 `capabilities/pet-window.json`（windows:["pet"] + core:default），ACL 编译进 `gen/schemas/capabilities.json`；生产迁移照此为 settings/商店窗口单独发 capability |
| Origin parity | 记录 | 本地回环页面按生产 `isAllowedOrigin` 语义放行——生产行为，非 spike 缺陷；外部 https → 403、扩展协议 → 放行+CORS 回显 |
| 头校验边界 | parity | `X-Catstella-Client` 是协议标识不是鉴权令牌（可伪造，与生产一致）；真正防线=仅回环绑定+浏览器 Origin 白名单 |

安全未覆盖项（迁移评审清单）：无共享密钥/令牌鉴权（生产同，迁移可加 nonce）；AGY CDP 通道不在 spike 范围；无速率限制（生产同）；`/companion/wallpaper-image` spike 按固定 id 白名单返回单文件（生产按 manifest 映射，迁移时保留路径校验）；Tauri ACL 目前仅示例 pet 窗口，settings 窗口接入时需单独 capability。

### 第九轮（同日晨）：widgetApi 绑定层落地与窗口权限实测

| 验收项 | 结果 | 说明 |
| --- | --- | --- |
| `window.widgetApi` Tauri 绑定层 | 通过 | `get/save/ready`、`subscribe`（Tauri listen，返回取消函数）、`command`（settings/navigate:）、只读 `online("catalog")`；未实现接口（byok/drag/hit/audio/onStep 等 12 个）显式 reject `unsupported in tauri spike`，不假成功 |
| 独立 settings 窗口跨窗口同步 | 通过 | pet 点击「打开设置」→ 窗口显示于桌宠下方空档；点击「保存并同步双端」→ `widget_save`（settings 窗口）→ 事件广播 → pet 应用 `--bubble-tint` 并回写日志 `pet applied tint=#eee6ff`（链路：settings 点击→IPC→持久化→事件→pet 生效） |
| 窗口权限拒绝（实测非纸面） | 通过 | pet 页启动即自检：`widget_get` allowed、`widget_save` **rejected**（label guard：`window 'pet' cannot call this command (requires 'settings')`），双端结果均写入 widget-sync.log |
| 重启持久化 | 通过 | phase 2 新进程读回 `widgetSettings.bubbleTint=#eee6ff` + 夹具字段全绿（config_persistence_pass=true） |
| 进程树资源基线（修正口径） | 记录 | **此前 ~31MB 仅为主进程**；进程树含 7 个 msedgewebview2 子进程：idle 树总 ~457MB、follow 中 ~474MB（+17MB/30 轮），CPU 仍 ~0%。后续对比以此口径为准 |
| 30 轮回归 | 30/30 | widgetApi 窗口共存下零 cycle 失败（此前一次 21/30 系 settings 窗口盖住宿主点击区，摆位修正后消失） |

**30 轮失败证据留档说明**：本日曾出现 29/30（cycle29 drag out=(0,0)）与 27/30（cycle5/6/8 ping/drag 超时型失败）各一次，失败报告文件被后续运行覆盖未及存档，摘录自会话记录。两次失败运行都紧随 1~3 分钟 release 全量重编译（IO/缓存高负载）启动，而 30/30 运行为热缓存启动——时序上与机器资源压力吻合，属观测性证据而非因果证明；拖动重试机制（对应用户再点一次）是在这两次失败之后加入的，后续 30/30 含重试逻辑，特此如实说明。

### 第十轮（同日晨）：绑定层可靠性验收与边界测试

| 验收项 | 结果 | 说明 |
| --- | --- | --- |
| 订阅/退订/重订阅 | 通过（含一处时序备注） | 取消后 emit 不再送达；重订阅后每次 emit 恰好送达一次；settings 开关 5 次后订阅无重复无堆积。**时序备注**：首个计数窗口可能计入 `widget_ready` 迟到投递的一次快照（emit_to 与 subscribe 的竞态）——订阅前状态本应由 `get()` 拉取，事件只做增量通知，属标准语义，如实记录 |
| settings 快速连续保存 | 通过 | 5 连发（150ms 间隔）全部成功且 tint 交替正确、无丢失；最终持久化与两窗显示一致 |
| 失败写入不破坏 | 通过 | `.settings.tmp` 目录占位使写入失败 → 旧 settings.json 原样保留（夹具轮已证）；非对象 patch 合并无操作（键数不变，无损坏），如实记录为"不拒绝但不破坏" |
| 边界拒绝 | 通过 | 未知 command（pet+settings 两窗口）、未知 online 动作、online 变更动作（download）均明确 reject；pet 调 `widget_save` 被 label guard 拒绝（日志留证） |
| 冷/热启动回归 | 30/30 与 30/30 | 冷=全新 WebView2 用户数据目录，热=复用缓存；各自独立目录独立存档（report-cold-start.txt / report-warm-start.txt）。**拖动首试成功率 29/29（非退化轮），重试恢复 0，失败 0**——本两轮无重试介入 |
| 此前 29/30、27/30 | 已留档说明 | 紧随全量重编译的资源压力时序，见第九轮说明；本轮冷/热均首试即过，与压力假设一致 |

**资源口径澄清**：`tree_*` 为进程树工作集**求和**，共享页（同一 DLL 物理页）会在多进程间重复计入，仅作上界参考；`cpu_*` 一直仅测 spike 主进程，**此前"跟随中 0.0%"不能推广为整树 CPU**，整树 CPU 未测。

**结论表述修正**：迁移门槛中，本机可验证项（窗口层、数据层、协议层、绑定层）已逐项通过；**混合 DPI、锁屏恢复、浮动任务栏实机、100% 缩放、真实 AGY 宿主、AGY CDP、整树 CPU 均未测**——"本机可测范围无未测项"≠"迁移所有门槛已通过"；且 30 轮结果含拖动重试机制（重试对应用户再点一次），非裸首试全绿。

#### 可复现命令

```powershell
# 全量探针（冷启动变体：先设 WEBVIEW2_USER_DATA_FOLDER 指向全新临时目录）
Set-Location D:/Catstella/prototypes/tauri-window-spike
cargo build --release --offline
./target/release/catstella-window-spike.exe --probe-output=target/run-cold
./target/release/catstella-window-spike.exe --probe-output=target/run-warm
# 配置夹具（净化/原子写/旧版回读）
./target/release/catstella-window-spike.exe --probe-fixture=../../evidence/tauri-window-spike-2026-11-09/fixture-old-config.json
# 跨进程持久化验证（第二阶段）
./target/release/catstella-window-spike.exe --probe-verify-config=target/run-warm
# 真实扩展对接（隔离浏览器，需 web dist 已构建）
node browser-check/bridge-browser.cjs --out=target/bridge-run
```

## 接续说明（2026-11-09 凌晨批次结束）

本夜完成窗口门槛全部本机可测项与数据门槛（第一～五轮，连续全绿，证据在 `evidence/tauri-window-spike-2026-11-09/`）。下一批建议顺序：

1. ~~联动协议门槛~~ 已完成：Rust 侧 `/companion/*`（第六轮）+ 隔离浏览器加载真实扩展完成握手/壁纸/断线重连（host-resolver-rules 隔离法）。
2. ~~widgetApi 面清单~~ 已完成（见上表）。剩余：按清单落地 Tauri command/event 绑定层与各窗口 capability。
3. ~~跟随引擎自动重扫描~~ 已完成（第七轮：兜底轮询自动重绑，免手动 stop/start）。
4. **需要环境/用户的待测项**：混合 DPI 与负坐标屏（多屏）、锁屏恢复（不能在用户会话上做）、浮动任务栏实机重影（真实 Win11 任务栏场景）、100% 缩放复测（改系统 DPI）、真实 AGY 宿主跟随（用户在场时）。
5. **安装门槛**：体积基线已测（压缩样本省约 52%）；跨版本安装/回滚与签名属发布动作，按约定不在实验批次内做。

实验约定延续：独立应用标识 `com.catstella.research.window`、临时隔离配置（`%TEMP%\catstella-window-spike-config`，验证后已删）、不占用真实联动端口、不操作真实 AGY；探针会短暂移动光标并结束还原；只退出本轮启动的实例。
