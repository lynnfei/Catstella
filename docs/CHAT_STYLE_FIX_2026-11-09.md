# 对话气泡作用域纠正与底部渐变回退

用户实测纠正：颜色和不透明度需求针对用户与 Gemini 的对话消息背景，不是桌宠/用量浮窗。此前 `QA_2026-11-09.md` 中关于桌宠气泡外观的验收不能视为该用户需求已满足，本记录取代该部分结论。

## 本轮修复

- Web 设置改为“对话气泡颜色”“对话气泡不透明度”，对用户消息阅读面和 Gemini 回答容器同时生效。只改变背景 alpha，不降低文字、按钮及其子元素的整体透明度，支持 0–100%。Gemini 原生样式仍不覆盖主题背景。
- 使用独立的 `chatTint/chatOpacity` 存储，旧 `bubbleTint/bubbleOpacity` 不迁移到对话偏好，也不再控制桌宠/用量浮窗；旧键和旧本地主题数据仍保留兼容。
- 桌面设置主题工坊中的相应控件改为反重力对话阅读面参数，随本地主题保存和应用，通过独立皮肤设置、payload 和宿主样式传递；旧主题没有对话参数时不覆盖已有对话偏好。预览区改为用户消息和模型回答示例。
- 对照 Web `62edbcb`，仅恢复静态渐变层及镜像壁纸的实底合成 CSS，撤回 `ad33cc2` 在该区域的透明底和 fixed background-attachment 改动。保留无对话首页不建渐变层的 guard，未恢复用量限额页已移除的遮罩。

## 验证

- `node tools/verify-conversation-style.cjs`：从真实 Web 设置控件改变颜色/透明度；检查用户与模型背景均改变、文字 opacity 保持 1、用量浮窗底色不变、0% 背景、存储失败回退、重新加载后恢复、发送按钮点击与输入编辑、脚注可见。另验证真实 AGY 主题函数的用户/模型消息容器及卸载清理。全部使用隔离页面，不登录账号。
- `node Gemini-Web-Companion/test/fade-browser.cjs`：旧版像素基准通过，渐变底部覆盖消息并匹配壁纸，上方内容不受影响，输入框在渐变之上且可点击，缩放/平移及销毁恢复正常。补齐已有 fixture 的真实消息锚点，避免被首页 guard 跳过。
- 桌面 `node --run test` 81 项通过；设置渲染夹具与真实隔离 Electron 窗口回归通过，包括新对话参数保存/重启、旧主题不覆盖、桌宠不受该控件影响。
- Web 交互回归及 runtime/turn-watcher 23 项通过。未据此声称真实 Gemini 账号所有布局或其他平台都已验收。

截图与结果：`evidence/chat-style-2026-11-09/web-conversation-footer.png`、`result.json`。

## 实际热更新结果

- 已运行 `node tools/sync-local-runtime.cjs --desktop --web`，备份在 `dist/local-runtime-backup-qtF7SJ`。没有正式封包或上传。
- 正式安装版桌宠平滑重启为 PID `56104`，版本仍为 `0.6.1`。用户设置、浏览器与 AGY 工作窗口保留。
- Edge Beta 的现有扩展加载目录 `D:/Catstella-web/Gemini-Web-Companion/dist/chromium` 已更新，版本仍为 `1.5.1`。本次 11 项关键载荷文件与源码/去 BYOK 后的 staging 文件逐项 SHA-256 一致，见 `deployed-files.json`。
- 通过现有本地 AGY 皮肤接口只读检查：已应用皮肤的 CSS 包含新 `--agy-chat-rgb`，无需另行销毁/重建皮肤；见 `live-agy-style.json`。没有读取会话正文。
- 用户需在 `edge://extensions/` 对 Catstella 点“重新加载”，再刷新 Gemini 页面。没有在真实账号上代替用户测试输入或发送消息。

全部修改仍在工作区，原有 production QA 改动和 Tauri 研究成果未回退。
