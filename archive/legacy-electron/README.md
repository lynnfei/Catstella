# Legacy Electron Shell Archive (Retired in v0.7.0)

本目录保存自 **Catstella v0.7.0** 起正式退役封存的旧 Electron 桌面端外壳、旧版设置界面、C# 启动守护辅助与旧版 Inno 安装脚本。

自 `0.7.0` 起，桌面端由 `src-tauri/` 下的 **Tauri 2 (Rust + WebView2)** 原生实现完全接管。

以下共用资产、领域逻辑、宿主皮肤引擎与桌宠前端核心模块仍由 `src-tauri/` 与核心测试共同使用，继续保留在主目录中：
- `Antigravity-Cat-Widget/assets/`（立绘、音效、台词与更新说明）
- `Antigravity-Cat-Widget/src/renderer/{index.html,widget.css,side-quota.*,personality.js,pet-behavior.js,ambient.js,renderer.cjs}`
- `Antigravity-Cat-Widget/src/{domain,adapters,native}/` 与 `Antigravity-Cat-Widget/src/main/online.cjs`
- `Antigravity-Dream-Skin/` 与 `shared/`
- `tools/installer/web-plugin-guide.html`
