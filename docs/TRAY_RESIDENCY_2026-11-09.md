# Windows 桌宠托盘驻留

用户反馈桌宠在任务栏中出现窗口预览。旧桌宠已经设置 `skipTaskbar:true`，但实际运行的窗口没有 `WS_EX_TOOLWINDOW` 标志，仍符合普通任务栏窗口条件。

Windows 创建桌宠时额外采用 `type:"toolbar"`，在保留 `skipTaskbar` 的同时，从窗口类型上排除任务栏和 Alt-Tab 项。此选项只作用于 Windows 桌宠；设置窗口仍是正常可切换的窗口，托盘的设置、唤回和退出入口保留。未禁用窗口焦点或鼠标交互。

依据：[Electron 45.1.0 实现](https://github.com/electron/electron/blob/v45.1.0/shell/browser/native_window_views.cc#L384) 将 Windows toolbar 类型映射为 `WS_EX_TOOLWINDOW`；同文件的 `SetSkipTaskbar` 使用 Shell `DeleteTab` 请求。[微软任务栏说明](https://learn.microsoft.com/en-us/windows/win32/shell/taskbar#managing-taskbar-buttons) 说明工具窗标志用于阻止任务栏按钮。无需改动原生跟随程序或额外轮询修复窗口样式。

## 验证

- `node tools/verify-tray-window.cjs`：隔离真实 Electron 实例，直接读取 Win32 标志，验证启动、宿主跟随、退回桌面、隐藏再显示、切换置顶及打开关闭设置后，工具窗标志保持，且没有 `WS_EX_APPWINDOW`；窗口仍可聚焦。测试没有修改日常配置。
- `npm test`：84 项通过。
- Windows CI 与 Windows 发布校验已加入上述实际窗口检查，工作流修改尚未推送。

## 本地热更新

- 更新正式安装版的主进程文件，备份 `dist/local-runtime-backup-t78XYT`。桌宠平滑重启，记录 PID 28780，版本仍为 0.6.1。
- 正式实例实际窗口：桌宠 `WS_EX_TOOLWINDOW=true`、`WS_EX_APPWINDOW=false`，托盘宿主 `Electron_NotifyIconHostWindow` 存在。安装文件与测试后的发布 staging 文件 SHA-256 一致。
- 证据：`evidence/tray-window-2026-11-09.json`、`evidence/tray-window-deployed-2026-11-09.json`。未封包、未推送；AGY 和 Web 无需重载。
