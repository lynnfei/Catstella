# Web 图片预览修复 · 2026-11-10

用户反馈点击对话中发送的图片后只显示文件名，媒体内容不可见。

## 原因与修改

Web 皮肤的通用 `[role="dialog"]` 毛玻璃规则会覆盖媒体弹窗。`backdrop-filter` 改变固定定位后代的定位参照，隔离页面中原本高 604px 的媒体区域折叠为 0，只剩文件名栏。

`Gemini-Web-Companion/content/skin.css` 将包含图片、画布或视频的弹窗排除出通用内容层毛玻璃规则，同时明确取消 `.image-expansion-dialog` 内容层的模糊。独立遮罩继续保留模糊效果，媒体尺寸和布局由原生页面决定。

## 验证与部署

- 新增 `test/image-viewer-browser.cjs`：修改前复现媒体区域高度为 0；修改后图片、画布、无特定类名的媒体弹窗、延迟插入图片及返回按钮通过；普通文字弹窗仍保留毛玻璃。
- 已接入扩展及 Web 工作树根目录的浏览器测试入口。
- `skin-browser.cjs`、`fade-browser.cjs` 和 23 项 Web 单测通过。
- `sync-local-runtime.cjs --web` 仅更新 `content/skin.css`，备份为 `dist/local-runtime-backup-L0NOoM`。源文件与 `dist/chromium/content/skin.css` SHA-256 一致：`4CF069151221286DB3353A80C7987B45DD09D3FCEEE15136177AE64FDA6A7777`。

真实浏览器检查因无法可靠识别当前 URL 而被安全校验中止，未绕过检查，也未声称真实账号已验收。用户需在扩展页重新加载 Catstella，并刷新 Gemini 页面复测。未封包、未推送、未更改桌面或 AGY 运行进程。
