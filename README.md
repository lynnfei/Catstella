# Catstella

[English](README_EN.md) | [简体中文](README.md)

Catstella 是面向 Google Antigravity 和 Gemini 网页版的开源桌面增强与双端伴侣。套件包含驻留桌面的猫娘挂件（Cat Widget）、宿主毛玻璃皮肤与壁纸引擎（Dream Skin），以及专门适配 Google Gemini 官方网页端（gemini.google.com）的浏览器伴侣扩展（Gemini Web Companion）。

> **免责声明与安全声明**  
> 本项目为开源爱好者出于个人兴趣与学习交流自发维护的非商业衍生工具，**非 Google 官方产品**，亦未获得 Google 或任何相关实体的官方背书或授权。  
> 项目通过宿主的本地调试接口和浏览器扩展读取额度、应用样式。Catstella 不改写宿主安装文件或 `app.asar`。本地账本和双端同步只保留数值与状态，不保存或传输聊天正文。

---

## 🎨 视觉与立绘展示 (Gallery & Artworks)

<p align="center">
  <img src="art_assets/stella/idle.png" alt="Stella Idle" width="280" />
</p>

> [!TIP]
> 包含两种 Gemini 拟人形象变体的高清单帧表情（得意、委屈、害羞、打瞌睡等），以及 4 套预装星空全景壁纸。详见[美术资产说明](ASSETS.md)和[在线图库目录](online-assets/README.md)。

---

## 🌟 核心特性 (Key Features)

### 🐱 桌面猫娘挂件与 HUD 设置中心 (Cat Widget · Tauri 2)
- **原生轻量架构**：自 `0.7.0` 起桌面端全面迁移至 **Tauri 2 (Rust + WebView2)** 原生架构，旧 Electron 外壳已封存至 `archive/legacy-electron/`；集成 16ms 鼠标穿透路由、Windows 宿主联动守护与系统托盘左键双击打开设置中心。
- **5 频道 Bento HUD 与平面耐力计**：提供「桌宠 / 外观 / 用量 / 连接 / 商店」五频道设置中心、左侧居中实时预览舱与 `side-quota.js` 平面四芒星 / 紫红沙漏耐力条。
- **多模型额度与配额监控**：
  - 通过宿主后台接口只读提取 **Gemini (5h / 1w)** 与 **Claude / GPT (5h / 1w)** 配额与刷新倒计时；低额度会触发提醒和表情变化。
  - 提供互动称呼设置（默认“人类”，支持自定义文本）。
- **交互与状态反馈**：
  - 50+ 句精校中文台词、自然呼吸动效与星轨边缘光晕；
  - 点击桌宠头部触发表情，可通过菜单停靠到屏幕左下角或右下角；
  - 支持表情预览、空闲打盹和点击唤醒；提供四套音效方案（默认静音）。
- **桌面穿透与防抖优化**：
  - 支持前台窗口识别和显示优先级。Windows 浮动任务栏下的双端重影仍可复现，已列入[长期规划](docs/ROADMAP.md)；
  - **独立桌面常驻模式（Standalone）**：脱离 Antigravity 宿主运行时亦可退守桌面常驻，宿主启动后自动恢复吸附。

桌面设置「桌宠」和「壁纸」各有在线图库。检测到本地缺少的素材时会提示，安装后可在本地图库选择。连接 GitHub 失败时会提示检查网络或代理，已安装的素材仍可使用。设置「关于」提供更新检测和在线配色。「显示气泡」旁可以开启自动碎碎念。在线图库依赖发布到 GitHub `main` 分支的[素材目录](online-assets/README.md)。实验性 BYOK 不随 Windows 安装包发行，见[路线图](docs/ROADMAP.md)。

### 🔮 毛玻璃皮肤与壁纸引擎 (Dream Skin)
- **透光界面架构**：
  - 输入框重构为高斯模糊悬浮胶囊，消除外层容器深色底块，背景壁纸自然透光；
  - 保持代码编辑器（Monaco）与终端（xterm）的完全不透明防护，兼顾视觉体验与工作可读性；
  - 对话流向上滚动时平滑渐隐过渡，避免生硬边界。
- **四色主题配色方案**：
  - 原生 CSS 变量动态注入，支持切换：**星空紫 (Violet)**、**幻梦粉 (Pink)**、**深海蓝 (Ocean)** 与 **极夜黑 (Onyx)**；
  - 深度适配右上角 Overview 概览浮窗与弹出菜单。
- **壁纸自动轮播系统**：
  - 平滑交叉淡入淡出动画；
  - **1m ~ 60m 真实比例刻度滑块**，靠近常用时间档位提供磁吸阻尼辅助；自动读取用户壁纸目录。

### 🌐 Catstella · Gemini 网页伴侣
套件不仅服务于 Antigravity 本地 IDE，还深度适配了 **Google Gemini 官方网页版 (`gemini.google.com`)**，实现跨终端的无缝伴侣体验：
- **官方网页主题与桌宠注入**：
  - 原生运行于 Edge、Chrome 与 Firefox 浏览器；
  - 将与桌面端同脉相承的高清全景星空毛玻璃透明皮肤注入 Gemini 官方聊天界面；
  - 在网页右下角常驻互动猫娘桌宠，具备多套表情反应与点击互动；
- **Web 端专属实时用量监控**：
  - 读取 Gemini 网页提供的 5 小时和每周用量、重置时间，并显示数据来源。
  - 统计当前会话轮次，估算当前上下文的 Token 规模。估算值用于提示会话负载。
- **桌面与网页联动 (Companion Bridge)**：
  - 桌面端与 Web 扩展通过本机环回端口 `127.0.0.1:3921–3923` 自动双向握手；
  - **双端用量互显互通**：桌面端桌宠气泡滑动至第 2 页即可直接查阅 Web 网页端用量指标，Web 扩展弹窗中亦可同步读取 Antigravity 宿主额度；
  - **样式与偏好同步**：支持桌宠形象与壁纸图库在双端之间“一键实时同步”或“各自保持独立”；
  - **灵活的同屏显示策略**：可在设置中自由切换“双端同显（各自独立驻留）”、“桌面优先”或“焦点互斥（浏览网页端时桌面猫猫自动隐藏）”。

### 🌐 界面多语言本地化 (Localization Layer)
- 基于本地 CDP 增量注入，不修改任何宿主内部 asar，支持随时一键卸载并完全还原；
- 覆盖 830+ 处界面文本、输入框 placeholder、按钮 title 与无障碍属性；
- 开箱默认保持原版英文界面，可在设置中心随时切换为简体中文。

---

## 🛠️ 安装与运行 (Installation & Usage)

### 方案 A：Windows 安装包（推荐）
Windows x64 发行版使用一个安装包，内含桌面套件及可选的 Web 扩展组件：
1. 前往 [Releases 发布页](https://github.com/lynnfei/Catstella/releases) 下载最新的 `Catstella-Setup-*-x64.exe`；
2. 运行安装程序。需要双端联动时选择「完整安装」，可按需开启开机自启或宿主联动。默认安装到当前用户目录，通常无需管理员权限；
3. 在安装目录下打开 `web-extension/web-plugin-guide.html`，按指引加载扩展。Edge / Chrome 先解压 ZIP，再在扩展管理页开启开发人员模式，选择包含 `manifest.json` 的目录。Firefox 随包附带的是未签名 XPI，可通过 `about:debugging` 临时加载，重启浏览器后需重新加载。

### 方案 B：macOS / Linux 实验构建

[Releases 发布页](https://github.com/lynnfei/Catstella/releases) 提供 macOS（Apple Silicon / Intel，`.dmg` / `.zip`）和 Linux x64（`.AppImage` / `.tar.gz`）实验构建。这些构建尚未完成实机回归，也不包含 Web 扩展。各平台的下载文件都可用同页的 `SHA256SUMS.txt` 校验。

### 方案 C：源码运行与开发
环境要求：Windows 10/11 x64、Rust 工具链（`cargo`）、Node.js 22.12 或更新版本（以及 Inno Setup 7+ 如需打包安装器）。

```powershell
# 1. 克隆代码仓库
git clone https://github.com/lynnfei/Catstella.git
cd Catstella

# 2. 安装前端打包依赖并同步 Tauri 前端资源
npm ci
npm run prepare:frontend

# 3. 执行 Rust 与 Node 自动化测试
npm run test:rust
npm test

# 4. 构建桌面端 Release 二进制与 Windows 安装包
npm run build:tauri
npm run build:installers
```

快捷键：`Ctrl+Alt+G` 唤回挂件；`Ctrl+Alt+Shift+G` 关闭鼠标穿透。左键双击或右键托盘图标可打开设置中心。旧版 Electron 主外壳、C# 启动守护与旧安装脚本位于 `archive/legacy-electron/`（仅供历史参考）。

### ⚠️ Antigravity v2.33+ 兼容提示
Antigravity v2.33.0 起默认不再在启动时开启本地 CDP 调试端口（`DevToolsActivePort`），直接启动会导致主题注入、汉化与客户端额度读取处于等待连接状态。
- **一键适配（Windows）**：打开 Catstella 设置中心「反重力」页点击「配置快捷方式（开启调试通道）」，或运行 `node tools/enable-agy-cdp.cjs --apply`；配置后完全退出并重开 Antigravity 即可恢复（不修改宿主安装包，可随时还原）。
- **命令行 / macOS / Linux 启动**：为 Antigravity 传入 `--remote-debugging-port=0 --remote-debugging-address=127.0.0.1`。

---

## 🔒 隐私与本地数据边界 (Privacy & Security)

| 数据类型 | 本地存储路径 | 用途说明 |
| :--- | :--- | :--- |
| 挂件与皮肤配置 | `%USERPROFILE%/.antigravity-cat-widget/`<br>`%USERPROFILE%/.antigravity-dream-skin/` | 存储壁纸偏好、滑块阻尼、缩放比例与本地配额数值账本。 |
| 本地日志数据 | `%USERPROFILE%/.gemini/antigravity/brain/` | 读取本地日志并提取步骤与 Token 数值，账本只保存统计数据。 |
| 本地通信端口 | `127.0.0.1:3921–3923`（环回地址） | 仅监听本机，并对浏览器请求的来源做检查。 |

- 设置、用量账本和桌面/Web 同步均保存在本机。更新检测和在线图库会向项目的 GitHub 地址请求发行信息或素材。
- 在设置中心关闭皮肤可撤回对当前宿主界面的样式注入。

---

## 📜 许可声明与资产边界 (License & Assets)

1. **软件源代码许可**：本项目包含的原创源代码采用 [MIT License](LICENSE) 开源发布。
2. **美术与非代码资产限制**：
   - **MIT 许可证不适用于本项目包含的所有角色立绘、原画设定、壁纸图片、衍生美术以及非开源音效**；
   - 角色原设概念设计者按提供者记录署名 [ZipZipPipe (B站空间)](https://space.bilibili.com/4168597)；角色与设定集图片由 AI 辅助生成，保留生成提示词，不宣称 Google 官方授权或原设的再许可权。公开版未包含原作者参考图、私人截图或未确认再分发许可的 DSH 鸭叫音频；
   - **粉毛 Gemini 形象所有权归本仓库管理者所有，使用及二创须遵循 CC BY-NC-SA 4.0 协议**；
   - 仓库内音频资源均已注明许可来源（Kenney CC0 / 上游 MIT 合成音频），未包含未经明确授权的第三方商业音频；
   - 详情请查阅 [ASSETS.md](ASSETS.md) 与 [NOTICE.md](NOTICE.md)。
3. **免责条款**：
   - 本套件依赖宿主本地 CDP 调试接口与界面结构，宿主未来版本更新可能带来布局变化或接口调整；
   - 开发者不对因使用本非官方衍生工具可能导致的显示异常、缓存冲突等情况承担保证或连带责任。

---

## 💐 鸣谢与致敬 (Acknowledgements)

本项目在开发过程中参考并衍生自以下开源项目与原创设计：

- **[Monokumakuki / Antigravity-Star-Suite](https://github.com/Monokumakuki/Antigravity-Star-Suite)**：上游项目，提供了初期架构、CDP 探针和双端联动雏形；
- **[ZipZipPipe (B站空间)](https://space.bilibili.com/4168597)**：Gemini 星语猫娘原设概念设计者；
- **[Feeesack / codex-maid-widget](https://github.com/Feeesack/codex-maid-widget)** 与 **[MeteorNOX / DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)**：感谢两大家居式桌宠项目在交互反馈、气泡状态机及额度观察逻辑上的开源启发。
