# Catstella Tauri 2 Port — Migration Handoff

2026-11-26 Codex 修复接续见第 7 节。第 6 节保留基米原始问题描述，实际验证边界与部署结果以第 7 节为准。

## 1. Executive Status

Steps 1–3 of the Tauri 2 port in `src-tauri/` are implemented and feature-complete against the Electron runtime, plus post-Step-3 polish requested on 2026-11-25:

- **Completed Core Architecture**:
  - **Step 1 (Pet Shell & Win32 Routing)**: Transparent `pet` WebView2 shell, lock-free drag (`drag.rs`), Win32 foreground & Antigravity host tracking (`foreground.rs`), pure-memory 16 ms `.interactive` hit-testing (`mouse_routing.rs`), WebView2 `low-mem` browser args.
  - **Step 2 (Settings, State, Ledger, Bridge, Hub)**: On-demand Settings Center window (`settings_window.rs`, async non-blocking creation per `tauri-apps/wry#583`, destroyed on close), Antigravity transcript scanner + `usage-v2.json` ledger + `ModelActivity` (`transcript.rs`), pure-Rust `/companion/*` loopback HTTP bridge + `/api/memory/*` optional `MEMOSYNE_URL` proxy (`companion_bridge.rs`), DreamSkin config & wallpaper/character pack scanner (`dream_skin.rs`, `assets.rs`), offline-seeded Content Hub & release notes (`online.rs`), Win32 global hotkeys (`hotkeys.rs`).
  - **Step 3 (Host CDP & Packaging)**: Pure-Rust loopback CDP WebSocket client, host install/shortcut diagnostics (`host_cdp.rs`), 3-worker CDP orchestrator for quota/model polling, DreamSkin overlay (`owner: "catstella-tauri-host"`), and zh-CN localization (`owner: "catstella-tauri-zh"`) (`host_orchestrator.rs`), plus standalone preview Inno Setup pipeline (`installer/catstella-tauri.iss`, `scripts/build-tauri-installer.cjs`).
  - **Latest Code Fixes (2026-11-25, pre-rebuild)**:
    - **Wallpaper Thumbnails**: Updated `tauri.conf.json` `app.security.csp` (`img-src 'self' data: http://127.0.0.1:*;`), added `tauri://` and `tauri.localhost` to `companion_bridge::is_allowed_origin`, and added `Cross-Origin-Resource-Policy: cross-origin` to `serve_image_file`. *(Requires running `cargo build --release --offline` when ready to test a new binary.)*
    - **Tray Menu**: Removed `形态：星语 (魔猫)` and `形态：霓音 (林猫)` from the tray menu; added `重启套件` directly below `统一设置中心` (`restart_suite` cleanly stops CDP orchestrators, saves `ledger`, respawns with non-oneshot CLI flags, and exits).
- **Ready Next**: Plug in the redesigned Settings Center UI, tune Settings Center open latency, run live `Catstella-web` browser extension co-testing, and execute the final Electron-to-Tauri cutover.

---

## 2. Module & File Map (`src-tauri/`)

| File | Responsibility |
| :--- | :--- |
| [src/main.rs](src/main.rs) | App entry, CLI flags, `widget_*` Tauri commands, tray menu & `restart_suite`, window placement, slideshow & transcript monitors, verification probes (`--test-settings-cycle`, `--test-cdp-cycle`). |
| [src/state.rs](src/state.rs) | `SharedApp`, `RuntimeData`, `StateMachine`, `CompanionVisibility`, `WebCompanionState`, transactional JSON saves (`atomic_write_json`), `build_snapshot()`, `/companion/state` payload builder. |
| [src/settings_window.rs](src/settings_window.rs) | Non-blocking `open_settings` (spawned thread + `SETTINGS_OPENING` guard + `settings-window.log` error logging), `close_settings`, `minimize_settings`. |
| [src/host_cdp.rs](src/host_cdp.rs) | RFC 6455 loopback CDP `TcpStream` client (`127.0.0.1`/`localhost` only), `DevToolsActivePort` / `--host-cdp-port` discovery, Win32 ToolHelp `Antigravity.exe` detection, `.lnk` shortcut inspection & configuration, safe `launch_host_with_debug`. |
| [src/host_orchestrator.rs](src/host_orchestrator.rs) | Background CDP workers for Antigravity quota + model info, DreamSkin (`installTheme` / fast `updateAppearance` / `destroy`), and zh-CN localization (`Page.addScriptToEvaluateOnNewDocument` + primary/iframe coverage / `destroy`). |
| [src/companion_bridge.rs](src/companion_bridge.rs) | Loopback HTTP/1.1 bridge on ports `3921..3923` (`/companion/state`, `/companion/wallpapers`, `/companion/wallpaper-image`, `/companion/character-frame`, `POST /companion/sync`, `/api/memory/*`). |
| [src/assets.rs](src/assets.rs) | PNG/JPEG/WebP header `probe_image`, SHA-256 dedupe, bundled + user wallpaper and character pack scanners, `select_wallpaper`, `next_wallpaper_id`. |
| [src/dream_skin.rs](src/dream_skin.rs) | `DreamSkinSettings` sanitization, `legacy_rotate_patch`, `<data-dir>/skin/settings.json` persistence with read-only home seed. |
| [src/transcript.rs](src/transcript.rs) | `TranscriptScanner` (64 newest JSONL files, incremental offset), `UsageLedger` (`usage-v2.json`, 90-day retention), `ModelActivity`. |
| [src/online.rs](src/online.rs) | Offline-seeded Content Hub (`catalog`, `preview-theme`, `download`, `install`, `uninstall`, `check`, `release`, `source`) + Win32 `ShellExecuteW` open folder/URL. |
| [src/layout.rs](src/layout.rs) | Pure DPI-aware layout geometry, drag snapping, bubble room clamping, offscreen bounds reconciliation. |
| [src/foreground.rs](src/foreground.rs) | Win32 foreground polling, Antigravity window detection, `SetWindowPos` helpers, monitor enumeration. |
| [src/drag.rs](src/drag.rs) | Lock-free window drag state & art-shift updates. |
| [src/mouse_routing.rs](src/mouse_routing.rs) | 16 ms cursor polling against `.interactive` rects pushed from WebView2. |
| [src/hotkeys.rs](src/hotkeys.rs) | Win32 `RegisterHotKey` (`Ctrl+Alt+G`, `Ctrl+Alt+Shift+G`), non-fatal on Electron collision. |
| [scripts/prepare-frontend.cjs](scripts/prepare-frontend.cjs) | Stages Electron renderer HTML/CSS/JS + assets into `src-tauri/frontend-dist/`, injects `tauri-widget-api.js`, patches CSP/drag-region/preview paths. |
| [scripts/tauri-widget-api.js](scripts/tauri-widget-api.js) | Drop-in `window.widgetApi` Tauri IPC shim + `#mascot` `.interactive` hit-rect collector + frameless `.custom-titlebar` drag handler. |
| [tauri.conf.json](tauri.conf.json) | Tauri v2 bundle config (`withGlobalTauri: true`, `frontendDist: "frontend-dist"`, HTTP CSP header). |
| [capabilities/](capabilities/) | Window-scoped permissions (`default.json` for `pet`, `settings-window.json` for `settings`). |
| [installer/catstella-tauri.iss](installer/catstella-tauri.iss) | Preview Inno Setup script (`AppId={{B7E4D1F2-9C3A-4F8B-8D6E-2A1F9C5B4E30}`, `{localappdata}\Programs\Catstella-Tauri`). |
| [scripts/build-tauri-installer.cjs](scripts/build-tauri-installer.cjs) | Stages `catstella-tauri.exe`, icons, and optional `Catstella-web` artifacts and compiles via `tools/vendor/InnoSetup/ISCC.exe`. |
| [scripts/verify-step2.cjs](scripts/verify-step2.cjs) / [verify-step3.cjs](scripts/verify-step3.cjs) | Automated Step 2 (UI click + RAM reclaim) & Step 3 (mock CDP + Inno Setup) verification runners. |

---

## 3. Verified Architectural Decisions & Baselines

1. **WebView2 `low-mem` + On-Demand Settings Window**:
   - Both `"pet"` and `"settings"` share the single `wv2_dir` (`<data-dir>/webview2`) and `--renderer-process-limit=1 --disable-gpu --js-flags=--max-old-space-size=96 ...` browser flags.
   - `"settings"` is created on demand and natively destroyed (`WindowEvent::Destroyed`) on close so WebView2 memory returns to idle levels.
   - Observed Step 2 baseline (`verify-step2.cjs`, prior to 2026-11-25 thumbnail/tray edits): Private WS `83.45 MB` idle -> `87.95 MB` settings open -> `79.09 MB` after close.
   - Observed Step 3 release footprint (prior to 2026-11-25 edits): `catstella-tauri.exe` = `23,806,464` bytes (~22.70 MiB); full Inno installer with Web extensions = `81,027,289` bytes (~77.27 MiB).
2. **Windows `WebviewWindowBuilder::build()` Deadlock Avoidance (`wry#583`)**:
   - Calling `WebviewWindowBuilder::build()` inside a sync `#[tauri::command]` (`WebMessageReceived`) or Win32 `MenuEvent` callback deadlocks Windows WebView2.
   - `settings_window::open_settings` spawns a background thread protected by `SETTINGS_OPENING`, and `widget_command` is `async fn` running on Tokio.
3. **Zero Production Electron Impact & Safe Dual-Run**:
   - Zero modifications to `Antigravity-Cat-Widget/`, `Antigravity-Dream-Skin/`, `shared/`, `package.json`, `tools/`, or `online-assets/`.
   - Distinct CDP owners (`catstella-tauri-host`, `catstella-tauri-zh`) yield cleanly when Electron's `StarSuite.exe` already owns a live Antigravity window.
   - 100% offline Cargo build using pre-cached crates in `Cargo.lock`.

---

## 4. Next Phase Integration Guide

### A. Plugging In the New Settings Center UI
1. Stage the new HTML/CSS/JS assets in [scripts/prepare-frontend.cjs](scripts/prepare-frontend.cjs) instead of (or conditionally beside) the legacy `settings.*` files.
2. Keep `<script src="tauri-widget-api.js"></script>` loaded before page scripts in the new Settings HTML so `window.widgetApi` and frameless `.custom-titlebar` / `.titlebar-drag-area` (`data-tauri-drag-region`) dragging work automatically.
3. Maintain CSP compatibility with [tauri.conf.json](tauri.conf.json) (no inline `<script>`, `img-src` uses `'self'`, `data:`, or `http://127.0.0.1:*`, `connect-src` uses `'self' ipc: http://ipc.localhost`).
4. Full `window.widgetApi` surface exposed by [scripts/tauri-widget-api.js](scripts/tauri-widget-api.js) (window-label ACL gated in Rust to `"settings"` / `"pet"`):
   - `get() -> Promise<Snapshot>` (`widget_get`)
   - `save(patch) -> Promise<Snapshot>` (`widget_save`)
   - `command(action)` (`widget_command`: `"settings-close"`, `"settings-minimize"`, `"restart"`, `"next-wallpaper"`, `"open-character-dir"`, `"open-wallpaper-dir"`, `"open-project-repo"`, `"open-upstream-repo"`, `"reset"`, `"dock-left"`, `"dock-right"`, `"refresh"`, `"quota-refresh"`, `"preview-reaction:<expr>"`, `"quit"`)
   - `online(action, value) -> Promise<Value>` (`widget_online`)
   - `host(action) -> Promise<Value>` (`widget_host`: `"diagnose"`, `"configure-shortcuts"`, `"restore-shortcuts"`, `"launch-debug"`)
   - `releaseNotes()` / `markReleaseNotesSeen(version)`
   - `audio(kind)`
   - Events: `subscribe(cb)` (`widget://snapshot`), `onNavigate(cb)` (`widget://navigate`), `onRefresh(cb)` (`widget://refresh`)

### B. Settings Center Open Latency Optimization Options
Current cold open creates a fresh transparent WebView2 window and synchronously runs asset card rendering + initial `diagnose`/`online` checks. When building the new Settings Center, consider three complementary speedups:
1. **Defer Heavy Async Calls Until After First Paint**: Load Settings shell + initial `widgetApi.get()` first; delay `widgetApi.host("diagnose")` and `widgetApi.online(...)` via `requestIdleCallback` / post-paint micro-task so Win32 PowerShell shortcut probing never blocks initial visual readiness.
2. **Downscaled Thumbnail Endpoints / Decode Hints**: Current `/companion/wallpaper-image?id=...` serves full 1–2.4 MB PNG/JPG wallpapers into gallery `<img>` cards. Adding an optional `?thumb=1` (or cached resized WebP/PNG previews in `<data-dir>/cache/thumbs/` via a lightweight endpoint) cuts WebView2 image decode CPU and peak memory dramatically when opening the Wallpaper tab. Add `decoding="async"` + `content-visibility: auto` on gallery tiles in the new UI.
3. **Evaluate Warm-Hide vs Destroy-on-Close**: Currently `WindowEvent::Destroyed` frees ~9 MB Private WS (87.95 MB -> 79.09 MB under `--renderer-process-limit=1`). Once the new Settings UI exists, measure actual open time and peak delta: if instant open (<100 ms) matters more than ~9–15 MB when Settings is closed, toggling hide-on-close + `eval` sleep cleanup is an easy one-file change in [src/settings_window.rs](src/settings_window.rs).

### C. Browser Extension (`Catstella-web`) Co-Testing Checklist
1. Build or point `Catstella-web/Gemini-Web-Companion` against `catstella-tauri.exe` (keep Electron `StarSuite.exe` stopped so `127.0.0.1:3921` is bound by Tauri rather than Electron).
2. Verify extension sync populates `webCompanion` in the pet bubble (`POST /companion/sync`), switches `characterPack` & `wallpaperId`, and respects `petDisplayMode: "prefer-web"`.
3. Verify `/companion/wallpaper-image` and `/companion/character-frame` load cleanly in the extension popup/content script (CORS + `Cross-Origin-Resource-Policy: cross-origin`).
4. If testing Memosyne integration, launch with `MEMOSYNE_URL=http://127.0.0.1:<port>` and verify `/api/memory/*` + `completedTurn` forwarding.

### D. Final Electron Replacement Cutover Checklist (When Ready)
1. **Installer Ownership**: Update [installer/catstella-tauri.iss](installer/catstella-tauri.iss) `AppId`, `DefaultDirName`, Start Menu shortcuts, and upgrade `[InstallDelete]` rules only when replacing the production Electron `StarSuite.exe` install (`tools/installer/star-suite.iss`).
2. **Single-Instance IPC & Startup Watcher**: Add single-instance enforcement (e.g., `--quit` CLI/named-pipe signal for Inno `PrepareToInstall` and `--settings` forwarding) and ensure Windows registry `Run` / `StartupSettings` autostart & hostlink parity.
3. **Default Data Migration**: Keep `%USERPROFILE%\.antigravity-cat-widget` / `%USERPROFILE%\.antigravity-dream-skin` compatibility and remove preview CLI/product strings (`Catstella Tauri Preview`).

---

## 5. Build & Verification Commands

Run all commands from `d:\Catstella` (no network required for Rust crates):

```powershell
# Re-stage frontend files into src-tauri/frontend-dist (run after changing Settings UI / renderer scripts)
node src-tauri/scripts/prepare-frontend.cjs

# Rust unit tests (offline)
cargo test --manifest-path src-tauri/Cargo.toml --offline

# Production release binary (offline -> src-tauri/target/release/catstella-tauri.exe)
cargo build --manifest-path src-tauri/Cargo.toml --release --offline

# Automated E2E verification (requires rebuilt release binary)
node src-tauri/scripts/verify-step2.cjs
node src-tauri/scripts/verify-step3.cjs

# Build standalone preview Inno Setup installer (-> dist/installers-tauri/)
node src-tauri/scripts/build-tauri-installer.cjs

# Legacy Electron test suite (must remain green)
npm.cmd test
```

---

## 6. Known Issues & Next Optimization Backlog (2026-11-26 · For Codex)

> **Current Verified Baseline (2026-11-25 night)**:
> 5-channel Bento HUD Settings (`src-tauri/settings-hud/`), live Antigravity CDP HTTP keep-alive fix (`host_cdp.rs`), host watcher & single-instance IPC (`startup.rs`), `--optimize-art` WebP preview fix (`tauri-widget-api.js`), Argon cleanup, and `Claude / GPT` pet bubble page are all implemented and verified (`cargo test` 28/28, `verify-step2` / `verify-step3` pass, `npm.cmd test` 113/113).

Please resolve the following 6 items with **minimal, surgical edits** (avoid over-engineering, duplicate helpers, or bloated abstractions — every diff will be reviewed):

1. **Fix `重启套件` Exiting Instead of Restarting (`restart_suite` vs Single-Instance Mutex Race)**
   - **Symptom**: Clicking `重启套件` (tray menu or Settings Link page) exits the app without bringing up the new instance.
   - **Root Cause**: In [src/main.rs](src/main.rs) (`restart_suite`), `Command::new(exe).args(args).spawn()` runs *before* `h.exit(0)` drops `_instance_guard` (`Local\CatstellaSingleInstanceMutex`). The spawned child calls `startup::try_acquire_single_instance()`, sees `ERROR_ALREADY_EXISTS`, and exits immediately.
   - **Fix**: Pass an internal flag (e.g., `--wait-single-instance` or retry acquiring the mutex for ~3s in `try_acquire_single_instance` when `--restart` / `--wait-single-instance` is passed, stripped in `filter_restart_args`), OR drop `_instance_guard` / release the mutex before spawning. Verify `重启套件` relaunches cleanly in single-instance mode.

2. **Fix `Catstella-web` Browser Extension ↔ Tauri Bridge Linkage (`d:\Catstella-web\Gemini-Web-Companion`)**
   - **Symptom**: Using the extension from the `Catstella-web` workspace/branch fails to sync with the Tauri backend.
   - **Investigation**:
     - Check whether the installed Firefox/Edge extension build is stale vs `d:\Catstella-web\Gemini-Web-Companion` (ensure `build-tauri-installer.cjs` / `Catstella-web/scripts/build.js` packages the latest extension and document/verify reloading it).
     - Inspect HTTP CORS / preflight (`OPTIONS`), `Origin` handling (`moz-extension://...`, or missing `Origin` in Firefox MV3 background `fetch`), and `Access-Control-Allow-Private-Network` in [src/companion_bridge.rs](src/companion_bridge.rs) against `Catstella-web/Gemini-Web-Companion/background.js` (`BRIDGE_PORTS = [3921, 3922, 3923]`, `X-Catstella-Client: gemini-web-companion`, `/companion/sync`, `/companion/state`).
     - Verify `127.0.0.1:3921` isn't occupied by leftover `StarSuite.exe`.

3. **Fix Antigravity Skin Washed-Out / White Overlay When Pet Starts Before Antigravity**
   - **Symptom**: Launching Catstella *before* Antigravity causes injected DreamSkin in Antigravity to appear washed out / white; restarting Catstella after Antigravity settles fixes it.
   - **Root Cause Lead**: In [src/host_orchestrator.rs](src/host_orchestrator.rs), `spawn_skin_worker` connects as soon as `DevToolsActivePort` appears while Antigravity's workbench DOM / dark theme CSS tokens are still hydrating, runs `installTheme`, and caches `primary_applied_skin = Some(...)` so it never re-evaluates once the workbench finishes loading.
   - **Fix**: Inspect `Antigravity-Dream-Skin/src/host/theme.cjs` readiness expectations + wait in `spawn_skin_worker` (or inside injected check) until `document.readyState === "complete"` and the workbench container/theme CSS variables are hydrated before `installTheme` (or re-verify/re-apply once after workbench settles). Keep Electron compatibility intact.

4. **Double-Click Tray Icon Should Open Settings Center**
   - **Symptom**: Double-clicking the Windows system tray icon does nothing; users must right-click → `统一设置中心`.
   - **Fix**: In [src/main.rs](src/main.rs) (`setup_tray`), attach `.on_tray_icon_event(...)` on `TrayIconBuilder` and handle `tauri::tray::TrayIconEvent::DoubleClick { button: tauri::tray::MouseButton::Left, .. }` by calling `settings_window::open_settings(tray.app_handle(), &app_clone, "")`.

5. **Fix Desktop ↔ Web Pet Mutual Exclusion (`petDisplayMode: "prefer-web"`)**
   - **Symptom**: Both desktop pet and web pet stay visible simultaneously (noticed on Firefox with `Catstella-web`).
   - **Investigation**:
     - Verify Item #2 first so `/companion/sync` actually reaches Tauri with `webActive` / `webVisible` heartbeats.
     - Check Firefox `Catstella-web` content/background visibility reporting (`webVisible` / `webActive` fields in `POST /companion/sync`) and verify [src/state.rs](src/state.rs) `CompanionVisibility::hide_desktop` + `sync_visibility` in [src/main.rs](src/main.rs) trigger `hide()` on `"pet"` when `petDisplayMode == "prefer-web"`, browser is active/visible, and `foreground != "host"`.

6. **Remove `"杂鱼君"` Honorific Option & Default to `"人类"`**
   - **Symptom**: Settings UI still offers `"杂鱼君"` (`zayu`), and HUD fallback says `"你"`.
   - **Fix**:
     - [settings-hud/settings.html](settings-hud/settings.html): Remove the `杂鱼君` (`data-val="zayu"`) pill; keep `人类` (`data-val="none"`) as default + `自定义` (`data-val="custom"`).
     - [settings-hud/settings.js](settings-hud/settings.js): Change `resolveHonorific()` fallback from `"你"` to `"人类"`.
     - [src/state.rs](src/state.rs): In `sanitize_settings`, coerce legacy `"zayu"` to `"none"` (keep `"none"` default).
     - [scripts/prepare-frontend.cjs](scripts/prepare-frontend.cjs): In `patchStagedPetScripts()`, strip `mode==="zayu"?"杂鱼君":` in staged `personality.js` so `fallback||"人类"` always resolves to `"人类"` when `mode === "none"` (verify `Antigravity-Cat-Widget/src/renderer/personality.js` / `settings-hud` consistency without breaking `npm.cmd test`).

## 7. Codex 接续修复 · 2026-11-26

当前开发分支为 `codex/tauri-fixes`，从原 `beta` 工作区建立，保留已有未提交修改。接手时整个 `src-tauri/` 尚未被 Git 跟踪。施工前 Tauri 源码快照在 `dist/tauri-fixes-before-y7CdlS/`，可用于 Astra 对比本轮增量。

### 六项处理

1. 重启先启动带 `--wait-single-instance` 的接班进程，接班方限时等待旧锁释放，等待期间不向旧进程发送召回信号。清除历史等待参数后再添加新参数，生成子进程失败时保留当前实例。补充 `--restart` 本地命令，通过命名事件复用托盘和设置页的 `restart_suite`。
2. 桥接原有的 Firefox 扩展 Origin 和无 Origin 请求均可通过，补上私有网络预检响应。实际读取的安装版 XPI、工作树 Firefox/Chromium 构建目录与后台源码 SHA-256 一致，未发现旧包。用当前扩展后台源码分别按 Chromium 回调 API、Firefox Promise API 连入隔离的真实 Rust 桥接，额度、焦点和可见心跳通过。本机 Firefox 临时扩展加载路径为 `D:/Catstella-web/Gemini-Web-Companion/dist/firefox/`。自动化工具在进一步访问 Firefox 调试控制台时因 URL 策略支持限制停止，本机现有 Gemini 标签页完整联动仍待刷新后验收。
3. Tauri 皮肤工作线程在主窗口和附加窗口中检查文档完成、工作台存在、有布局、主题变量已加载，并要求深色标记与实际原生背景一致。等待期间不缓存“已应用”，注入返回 `applied:false` 时也不缓存成功。隔离浏览器验证空壳、CSS 晚到、深色背景晚到、导航重建与正常浅色模式。
4. 托盘左键双击调用既有异步设置窗口入口，编译与设置入口回归通过，真实托盘双击仍待用户验收。
5. 可见性策略显式要求网页可见。发现并修复启动 5 秒兜底把已被 Web 策略隐藏的桌宠重新召回的问题，兜底只在 renderer 尚未 ready 时执行，且重新遵守当前显示策略。纯状态测试覆盖前台、任务栏黏性、网页隐藏和断线恢复，实际 Firefox 聚焦切换仍待用户验收。
6. HUD 只保留“人类”和“自定义”，旧 `zayu` 配置在 Tauri 内归一为 `none`，自定义空值回落到“人类”。仅修改 Tauri 暂存的 `personality.js`，原 Electron 文件通过 113 项测试。

### 验证方式与限制

- `cargo test --manifest-path src-tauri/Cargo.toml --offline`，29/29。包含真实 Windows 命名锁从旧句柄关闭到新实例取得的等待回归。
- `node src-tauri/scripts/verify-cold-skin.cjs`，通过。
- `node src-tauri/scripts/verify-web-bridge.cjs`，通过。扩展 API 在受控环境模拟，网络和 Rust 桥接真实运行，端口为临时随机端口。
- `node src-tauri/scripts/verify-step2.cjs --no-memory`，真实 Tauri 设置开关、缩略图、保存、窗口销毁与桌宠气泡通过。首次默认运行的系统进程内存采样耗时超过测试实例 20 秒寿命，故此轮明确跳过内存测量，零值不代表实际内存。
- `node src-tauri/scripts/verify-step3.cjs --no-package`，额度、主页面及 iframe 汉化、皮肤安装／轻量更新／卸载通过，安装包生成显式跳过。
- 原 Electron `npm test`，113/113。

Windows 托盘双击、真实 AGY 从关闭到冷启动、Firefox 页面刷新后的联动互斥及长跑性能均需用户实机验收。

### 本机热更新

已离线构建并替换 `%LOCALAPPDATA%/Programs/Catstella-Tauri/catstella-tauri.exe`。最初安装文件备份在 `dist/tauri-runtime-backup-ef551b55cd3f475584db86845cc28208/`，最终更新前的中间版备份在 `dist/tauri-runtime-backup-31d272055e76411b8372917aa2a413f1/`。源程序与安装程序 SHA-256 均为 `EEADB0B47EDD9EF6C2D006CA6329E6CBD02DA737F1AECAD4A32EE67E60D5C42A`。

真实单实例模式下通过 `catstella-tauri.exe --restart` 连续调用两次公共重启入口，PID `34588 → 28496 → 55860`，每次均恢复端口 3921 且等待参数保持一份。宿主启动监听恢复为 PID 42368。详见 `evidence/tauri-fixes-hotupdate-2026-11-26.json`。

当前已打开的真实 AGY 检查到 owner 为 `catstella-tauri-host`、单份皮肤样式、`applied:true`，深色表面色为 `#211e2d`。没有通过关闭并重新打开真实 AGY 来替代用户验收冷启动。

曾尝试用 WebView2 临时调试端口做重启验证，调试端口未开放，随后删除该验证夹具并改用已通过的本地公共重启入口。测试配置与正式用户配置分离，最终正式进程使用原用户设置。此轮只生成热更新可执行文件，未运行安装包构建或发布。

### Firefox 联动追加修复 · 2026-11-26

用户刷新实测后仍未联动，继续排查确认 `content/shim.js` 用 `runtime.getBrowserInfo` 识别 Gecko。这一接口在 Firefox 内容脚本中不可用，导致内容脚本错误走 Chromium 回调调用路径。严格 Promise 消息接口会把回调参数当作不合法参数，异常被兼容层转成 null，后台收不到心跳。此前后台测试提供了完整 runtime，漏掉内容脚本能力差异。

Web 工作树 `Gemini-Web-Companion/content/shim.js` 和 `background.js` 统一按实际选择的 `browser` 命名空间使用 Promise 契约。新增回归在同时存在 browser/chrome、没有 getBrowserInfo 的内容脚本环境中验证心跳，修复前失败、修复后通过。既有 storage 回归也移除该接口并严格检查 Promise 调用没有附加回调。

`verify-web-bridge.cjs` 已扩展为完整的内容脚本 shim → 后台源码 → 隔离真实 Tauri 桥接链路。24 项 Web 单测、该链路测试、真实 Chromium 隔离扩展和网页交互回归通过。Firefox 接口通过受控环境模拟，真实 Firefox 最终联动仍待用户重新加载扩展并刷新 Gemini 后验收。

另确认原热更新工具仅更新 Chromium，Firefox 目录有多项生成资源落后源码。`tools/sync-local-runtime.cjs` 新增 `--web --firefox`，使用独立备份路径同步 Firefox，保留其 background.scripts 清单格式。已热更新 Firefox 7 项资源，备份 `dist/local-runtime-backup-LVaybL`；Chromium 2 项，备份 `dist/local-runtime-backup-QNFQC1`。两目录再次 dry-run 均无差异。此次没有修改 Tauri 二进制或生成扩展归档，安装目录中旧 XPI 将在用户安排的封包阶段重新生成。

接口依据见 [Mozilla 内容脚本 WebExtension API 列表](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts#webextension_apis)。

### Firefox 原生引擎复查与音效优化 · 2026-11-26

此前模拟消息链路未覆盖 Gecko 的另一项区别：内容脚本的 `globalThis` 与 `window` 不同。真实 Firefox 161 临时配置复现 `PetBehavior is undefined`：DOM 已创建，但动作、点击和心跳的初始化被中断。`pet-behavior.js`、`ambient.js` 改为浏览器环境向 `window` 导出，无 window 的 Node 环境仍向 globalThis 导出。用户随后反馈 Web 已修复。

Web 短音效抽离为 `content/interaction-audio.js`，在启用时预解码两个 WAV，交互时直接创建轻量音源，保持一个活动音效和原有 0.45 音量。缺少 Web Audio/解码失败时保留媒体播放器兜底。没有改变桌面音效代码或 Tauri 二进制。**当前音效规则以本节末尾“单击丢声追加修复”为准，早期闲置 5 秒暂停和 150ms 丢弃方案已经撤销。**

验证：29 项 Web 单测（含 5 项音频调度/取消/闲置/降级回归）；Edge 交互及真实隔离扩展回归通过。`Gemini-Web-Companion/test/firefox-native.cjs` 以独立临时配置启动本机 Firefox 161，加载当前 `dist/firefox`，验证无初始化错误、设置真实点击、可见心跳到达隔离 HTTP 桥接、扩展 WAV 原生解码及 8 次连续点击的 16 次音源启动。设备预热后记录事件到音源调度最大 1ms、平均 0.0625ms，仅是内部调度，不能当成扬声器端到端延迟；首次系统设备唤醒不在该指标内。此原生测试的桥接响应是夹具，真实 Rust 通道仍由上一节的 `verify-web-bridge.cjs` 覆盖。

Firefox 热更新备份依次为 `dist/local-runtime-backup-yJLRbe`（模块导出）、`CRPGXN`（音效模块/清单）、`ecbRRL`（设备准备）；后两个名称同样以 `dist/local-runtime-backup-` 为前缀。Chromium 对应备份为 `dist/local-runtime-backup-JzNHgE`、`dist/local-runtime-backup-hcjB2B`。本机实际加载目录已更新，需要在现有 Firefox 重新加载临时扩展并刷新 Gemini 才能切换到新内容脚本。本轮未封包、未推送。

API 依据：[Mozilla 内容脚本环境](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts#content_script_environment)、[Web Audio 用户交互与恢复规则](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices#autoplay_policy)。

### 单击丢声追加修复 · 2026-11-26

用户反馈“连续快速点击之后才有摸头声”。真实 Firefox 161 回归不再预热：旧逻辑首次单击、6 秒闲置后单击均没有音源启动、没有 PCM 波形；连点后才会播放。原因是等待 `resume()` 的完成回调才创建音源，设备恢复超过 150ms 就丢弃点击；5 秒闲置暂停又让之后的单击反复进入此路径。上轮仅测预热后 start() 调度的证据不足，不能据此判定首次播放或实际音频已经修复。

当前规则：音源在输入事件内立即提交，再请求恢复设备，不等待 resume Promise；复用正在进行的恢复请求，最多保留一个活动音源。可见页面不再按 5 秒闲置暂停；页面隐藏、pagehide 或关闭音效立即停止音源并暂停，返回可见时提前恢复。页面 pointerdown/keydown 在用户的普通交互中静默准备音频，没有鼠标移动监听或轮询。持续被自动播放策略阻止的未渲染音源在 1 秒后丢弃，防止以后授权时补播旧点击。

原生测试增加 AnalyserNode 侧支读取非零 PCM，仅测隔离扩展的输出，不录系统声音。修复后首次单击独立产生波形（全新 Firefox 音频设备冷启动约 517ms，仍有一次系统设备启动成本，并未宣称已消除）；6 秒可见闲置后的单次点击约 11ms 检测到非零 PCM，不需要额外点击。此数值仍不是扬声器端到端延迟。另验证 8 次连点 16 个音源、仅解码两份 WAV、设置真实点击和可见心跳。29 项单测、Edge 交互和真实隔离扩展回归通过。

最终 Firefox/Chromium 加载目录已热更新，备份分别为 `dist/local-runtime-backup-waILt5`、`dist/local-runtime-backup-XUqvxW`。Firefox 需要重载扩展并刷新 Gemini，旧内容脚本及旧的 5 秒计时器不会仅因磁盘文件替换而失效。没有封包或改动 Tauri 二进制。

### 耐力条视觉统一与初审 · 2026-11-26

用户暂时接受 Web 音效结果，要求先审阅并优化耐力条。初审范围、已处理问题与留给基米的商店重建/试听遗漏记录在 `docs/CODE_REVIEW_2026-11-26.md`。未宣称全仓库审计已完成。

共享 `side-quota.js/css`：四芒星改为柔和曲线、主题色晶体切面；Omnitrix 使用同系列玻璃圆盘和细描边，保留翡翠沙漏；双环星徽使用同一星晶和主题双色轨道；竖条保留原 26×82 占位与主副双轨，增加圆角填充、边缘刻度、细分隔与克制高光。去掉星徽的循环亮度滤镜和编排器额外光晕，改轻量透明度呼吸。额度、警告、贴边位置与镜像行为继续由原组件管理。

Tauri HUD 删除独立 SVG 拼接与编排器标签解析，加载共享组件样式/脚本，预览复用真实数据来源、剩余/已用换算和未知状态。同变体更新不重建 SVG；清空容器后再次显示能自动重建。路线图新增未完成的“耐力条样式自定义”，未额外增加完整自定义设置。

验证：9 项旁侧额度/布局单测；`tools/verify-stamina-visual.cjs` 的节点稳定、已用模式、未知状态与清空恢复通过，四配色截图在 `evidence/stamina-{violet,pink,ocean,onyx}-2026-11-26.png`。`node src-tauri/scripts/verify-step2.cjs --no-memory` 真实隔离 Tauri 测试通过：设置打开/关闭、耐力条和镜像预览、主题保存、桌宠气泡、桥接状态。跳过内存采样，未作性能数字承诺。

仅离线构建本地可执行文件，没有封装安装包。前端暂存旧版备份 `dist/stamina-frontend-before-nru0pR/frontend-dist/`；安装程序旧版备份 `dist/tauri-stamina-backup-6491424f243b457dae89b72541d26385/`。已通过官方退出入口关闭主进程 `55860`，更新安装目录并启动 `43496`；新源程序与安装程序 SHA-256 为 `12FEAD2C77A648A3DA2184AFDD441BD7A0B3DC8A0824E0EE8A559A3C43146204`。本机更新详情见 `evidence/stamina-hotupdate-2026-11-26.json`。没有改用户配置、推送或发包。

### 耐力条平面样式修订 · 2026-11-26

按用户截图指向，将弧形与圆环进度端点的圆点改为略饱满、白填充紫描边的四芒星，并随真实进度更新 SVG 平移；原有零额度/未知时隐藏规则保留。中心与顶部星徽同步去掉晶体切面，改为白底紫边。Omnitrix 沙漏由水蓝/翡翠改为紫红 `#ce65b5`，去掉拟物高光。竖条去掉所有顶部图标与空白冠部，基准占位从 26×82 改为 20×96，保留双轨、未知条纹、告警和额度方向，设置预览自动复用。

9 项旁侧单测与四主题视觉回归通过；视觉检查新增端点 path/位置、紫红沙漏及竖条无顶部图标断言。用户询问无图标方案，目前仅建议普通蓝紫、编排器莓紫红，并保留橙/红告警；尚未切换成纯颜色识别，编排器仍沿用原图标/提示逻辑。

本机已更新并通过官方退出/启动入口切换主进程 `43496 → 33684`，旧程序备份在 `dist/tauri-stamina-flat-backup-d0b10eee80ca4c82b9684d080fea1434/`；源程序与安装程序 SHA-256 为 `74549ABCF228352C34B0B911F12AD2858977A074B186346DDFE74B377F62F5AC`。更新记录 `evidence/stamina-flat-hotupdate-2026-11-26.json`；未封包、未推送。

### 商店状态更新保留节点 · 2026-11-26

用户授权立即修复初审发现的商店反复重建，下午再让 Astra 验证后封包，本轮不封包。仅改 Tauri HUD 商店渲染：Banner 按精选条目内容更新，网格按可见目录字段、分类和搜索签名重建；额度/步骤快照与安装/使用状态不再更换卡片、按钮和图片节点。安装与使用标签原地更新；目录内容真实变化时保留可恢复的同卡片操作焦点和主区滚动，不自动聚焦搜索框。相同目录刷新不重建节点，既有点击处理从当前目录取条目。

`tools/verify-hud-store.cjs` 使用实际 HUD HTML/CSS/JS 与隔离 API 夹具：旧暂存构建失败（100 次额度更新导致按钮身份变化、焦点丢失），修复后源码及最终暂存构建通过。覆盖 100 次快照保留节点/焦点/滚动、安装/使用标签、相同目录刷新、目录内容变更恢复焦点、搜索与详情、应用操作仅发一次请求。使用 `--staged` 验证实际嵌入输入。未将该浏览器夹具称为真实在线安装验收。

源码与 `frontend-dist/src/renderer/settings.js` 同步；旧暂存脚本备份 `dist/tauri-store-frontend-before-LdV2IB/settings.js`。初审记录中对应条目已更新为“已修复”，其余试听与构建维护风险保留，供 Astra 继续复核。没有修改 Web 扩展、试听、用户配置或耐力条外观。

离线本地构建完成；`node src-tauri/scripts/verify-step2.cjs --no-memory` 原生隔离 Tauri 设置/保存/桌宠/桥接回归通过，未做内存采样。已备份并更新正式安装目录，官方退出/启动切换 `33684 → 1104`。旧程序在 `dist/tauri-store-backup-6ff63b3311474f07b1b996e0efa2c164/`，新程序 SHA-256 为 `FC420DB7712760C33D4B2370A236C8CFC892A2AD372F0C52E91ABB8658B3BE83`；详见 `evidence/store-hotupdate-2026-11-26.json`。未封包、未推送，等待用户下午安排 Astra 复核。

