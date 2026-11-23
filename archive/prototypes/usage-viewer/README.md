# 已归档：用量查看器探索 Demo

2026-11-10 按用户决定归档。正式用量查看器／浮窗已经实装，本文仅保留早期布局探索和示例数据，不再作为未来功能待办。本目录不进入发行载荷；活动组件仍在 `Gemini-Web-Companion/content/usage-viewer.js`，用户设置与素材不变。

# Web 用量查看器原型

直接用浏览器打开 `demo.html`。同一组件分别展示独立浮窗和 296 px 桌宠气泡里的紧凑版。底部「同步反重力用量」关闭后只显示 Web 用量；打开时，Argon 的独立周额度是 AGY Gemini 分组的第三行。选「倒计时归零」后等 5 秒，额度行会变成「等待更新」；点右上角刷新可模拟收到新的用量。

`usage-viewer.js` 注册独立的 `<catstella-usage-viewer>`，样式封装在组件内，`compact` 属性开启紧凑布局。组件继承 Web 主题的 `--kg-palette-base`、`--kg-palette-accent` 和 `--kg-palette-accent-rgb`，也允许宿主用 `--usage-surface`、`--usage-accent`、`--usage-border` 等覆盖。正常、低额度、严重不足的圆环颜色保留其状态含义。

调用方设置 `viewer.data = { groups, status, refreshing }`；每组为 `{ name, rows }`，每行接受 `{ label, remaining, resetAt, state }`，其中 `remaining` 是剩余百分比，`resetAt` 是 Unix 毫秒时间戳，`state: 'pending'` 表示等待确认。刷新按钮只派发 `usage-refresh` 事件，由调用方提供新数据。

演示使用样例数据、工作区现有壁纸和主题配色，可离线打开。同步开关只筛选样例数据；接入时应作为独立的 Web 用量同步偏好，关闭后不拉取或展示 AGY 用量，不影响角色、壁纸等其它联动。目录位于扩展源码和打包输入之外。
