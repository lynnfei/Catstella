# 更新记录

> 浏览器伴侣扩展独立更新记录（`1.x.y`）。桌面端（`0.x.y`）更新记录见主仓 `CHANGELOG.md`。

## 1.5.2 · Firefox 内容脚本联动修复 + 零等待互动音效 + 默认称呼统一 / 2026-11-26

- **Firefox 内容脚本联动修复**：content/shim.js 改按实际选定的 rowser 命名空间选择 Promise 契约（不再依赖内容脚本中缺失的 untime.getBrowserInfo）；pet-behavior.js 与 mbient.js 在浏览器环境下统一挂到 window（兼容 Gecko 内容脚本 globalThis !== window），并补齐跨浏览器桥接全链路回归。
- **零等待互动音效**：短音效抽离至 content/interaction-audio.js，启用时预解码两份 WAV 并在输入事件内直接创建轻量音源、不等待 esume() 完成回调，消除首次单击与闲置后单击丢声；页面隐藏或切出时自动停止并暂停音频上下文。
- **称呼统一与测试**：统一默认互动称呼为“人类”（保留旧配置向后兼容），29 项扩展单测全部通过。

## 1.4.4-ext · 壁纸过渡、画廊预览与任务栏互斥 / 2026-11-05

- 壁纸预解码后使用与桌面一致的 1.3s 淡入，固定渐隐副本共享动画进度；快速切换保留最新目标，解码失败保留旧图，尊重桌面无过渡和系统减少动态设置。
- 桌面壁纸缩略图改由后台读取/缩小并返回 data URL，避免页面图片直连本机地址；缓存带文件修订号，限制两路并发与缓存数量。设置页异步渲染加入版本守卫，修复重复卡片。
- 图片同步独立于焦点同步，避免取图期间吞掉新的焦点状态；网页心跳分离 active/visible。
- 桌面侧区分实际前台与宿主可用状态，在已知任务栏/系统壳层短暂接管时保持网页显示归属；补充独立策略与原生元数据测试。原生辅助程序已按源码哈希编译，桌面重启后生效。

## 1.4.3-ext · 固定渐隐与规则/冗余清理 / 2026-11-05

- 固定渐隐改为独立壁纸合成层：滚动不逐卡量位置、不写卡片/滚动容器遮罩；跟随窗口、侧栏、输入框与提示条几何变化更新，支持输入区平移/缩放。
- 合并气泡、回复卡、Composer、思考胶囊和用量卡的原生/标记规则，避免标注后换形换色；引用和代码块仅保留外层玻璃，关闭控件不再重设尺寸。
- 修复放进 `:is()` 的无效伪元素选择器，清除无消费者的标记、旧玻璃带、未加载的 widget.css，以及重复的几何/滚动/字符观察路径。
- 删除失效的聊天列表 RPC 捕获、缓存、广播、解析和重放，删除重复刷新定时器；保留 SSR 官方账本、DOM 和隐藏用量页兜底。拦截器只广播流式状态及数值，桥接先 ping，tracker 防重复初始化。
- 修复回调/Promise 存储路径的重复调用与提前返回；隐藏用量页支持两种 API，并仅响应自身完成通知关闭页面。
- 移除桌面工作区旧内嵌扩展；安装器与角色同步统一活动源码选择，旧双副本工具改为只读布局门禁。
- 增加存储、SSR、流式生命周期、隐藏页、样式前后同值、固定渐隐像素/输入层级、滚动零样式写入及路径回归检查。真实 Firefox/Edge 实装由用户后续验收。

## 1.4.2-ext · 展开按钮原生几何与主题色 / 2026-11-05

- 按 Edge 实装反馈取消展开/收起按钮重设计：保留宿主原生尺寸、圆角、间距、字体、焦点和交互，只应用主题色；删除相互竞争的圆钮/药丸规则。
- 复制/编辑样式不再通过通用 icon-button 类误命中未标注的展开按钮，避免标注前后切换形状。
- 清除展开控件子树内的左右渐变黑影和伪元素光晕，保持消息正文的渐变及代码装饰。
- 浏览器回归增加原生几何逐帧比较、左右渐变黑影、文本展开按钮几何及焦点描边检查。底部渐隐与目录清理保持为咨询方案，未改动和删除。

## 1.4.1-ext · 展开/收起性能与皮肤连续性 / 2026-11-05

- 移除动画期间整份皮肤样式表禁用/恢复和临时无模糊样式，展开前后保持同一份毛玻璃；仅延后几何测量。
- 皮肤 CSS 的 class 子串匹配改为明确类名，保留元素名及 `data-kg` 语义表面；取消对所有消息子元素伪元素的清洗，保护代码等内容装饰。
- 消息标注按新增节点所在表面合并执行，取消整页计算样式扫描和所有消息 div/span 的背景探测；布局写入去重，滚动监听只注册一次。
- 关闭皮肤清除自有宽度与渐隐，编辑框不再作为底部 Composer 的兜底锚；修复后台切换可能悬挂渐隐调度的问题。
- 回合完成检测使用 `textContent`，消除每 600ms 读取 `innerText` 引起的强制布局。
- 增加独立浏览器性能/回归测试和回合检测单测；扩展包、清单与 UserCSS 版本统一为 1.4.1。
- 本机隔离长会话测试通过；真实登录会话及 Firefox/Zen 发布前验收范围见 `docs/WEB_REVIEW_2026-11-05.md`。

## 1.3.10-ext · 额度恢复补强：重试 / 重置即刷 / 提示条时间纠偏（feat/browser-extension） / 2026-11-03

- **瞬时失败重试**：`refreshUsageLedger` 增加 3 次退避重试（0.8s/2s）——VPN 抖动等 `Failed to fetch` 不再让进度条停在旧值；成功才计入节流，全败后 30s 允许再试。
- **重置时刻立即刷新**：倒计时归零时强制拉账本（30s 防抖），5h 额度窗一恢复进度条当场回落，无需等 5 分钟轮询；`rateLimited` 由账本百分比重新判定。
- **回合后刷新不丢弃**：after-turn 刷新节流降至 20s；被节流时安排「延后补刷」（取最近可执行时刻，不丢请求）——实机观测确认每轮对话结束后账本会在 ≤20s 内刷新。
- **提示条时间不得覆盖账本**：实测 Google 输入框提示条的重置时间与账本/用量页存在 1 小时级错位（21:37 vs 22:37）。规则：账本数据新鲜（<10 分钟）时提示条只提供限流状态信号，绝不改写重置时间与 epoch；账本过期时提示条才作为兜底时间源。
- **实机验证（IAB，真实扩展全套）**：21:37 窗口重置后账本返回 5h 0% @ 02:37、周 82% @ 11月3日23:37，倒计时解除；随后发消息，额度真实 0% → 2%（账本 fetchedAt 随回合推进），实时监控链路成立。
- dist 重建，版本 1.3.10。

## 1.3.9-ext · 额度实时监控根治：SSR 账本抓取（feat/browser-extension） / 2026-11-03

- **实机破案（IAB 全链路取证）**：官方额度数据**不在任何运行期 RPC**（MaZiqc 实为会话列表 RPC；9 个启动 RPC、WIZ_global_data、localStorage/IndexedDB/CacheStorage 全部排除）。真相：`/usage` 页面的额度是**服务端渲染的流式 JSON 块**——HTML 中 `<script type="application/json">` 里 `id="usage:0"` 的 `chunk` 字符串拼接后为 `getUsageInfo.pools`（`GXU_FIVE_HOURLY` / `GXU_WEEKLY` 的 `percentageUsed` + `windowRefreshesAt` UTC ISO）。
- **新主链路 `refreshUsageLedger()`**：内容脚本 `fetch('/usage', {credentials:'include', cache:'no-store'})` → 正则提取 JSON 脚本块 → 拼接 usage:0 chunk → 深搜 `getUsageInfo` → 真实百分比 + UTC 重置时刻。零 UI、零导航、无跨域/iframe 限制（iframe 探针因同源嵌入被拦，已移除）。
- **触发点**：启动后 2.5s、每轮对话 STREAM_COMPLETE 后、每 5 分钟、挂件 🔄 同步按钮（force）。
- **时区根治**：重置时刻来自 ISO UTC，直接转本地显示，倒计时锚定真实 epoch，不再有 IP 属地时区误差。
- **实机验证**：账本返回 5h 100% @ 21:37、周 82% @ 11月3日23:37、TIER1，与 /usage 页面完全一致；挂件渲染红色 100% 条 + 哭泣帧 + 倒计时。
- dist 重建（含 Stylus UserCSS），版本 1.3.9。

## 1.3.8-ext · 对齐铁律 + 防跳滚 + rAF 冻结修复（feat/browser-extension） / 2026-11-03

- **双曲线错位根除**：玻璃带与卡片渐隐此前各算各的几何（带=Composer 基、卡=切线基），两条过渡曲线错位。现 `applyFades` 统一写入带几何 `[fadeStartY, cutY]`（与卡片渐隐完全同区间），带 mask 改纯线性渐变——模糊曲线与底色渐隐曲线**完全重合**；`updateGlassBand` 独立函数废除。
- **对话滚动容器定位铁律**：`infinite-scroller.chat-history`（7984px、不在侧栏内）才是**对话**滚动容器；`infinite-scroller.lr26-theme`（572 底边）是**侧栏**滚动区——此前一直锚错（渐隐带错位的真正根因）。现从 `model-response`/`user-query` 向上 `closest('infinite-scroller')` 定位（A/B 免疫），虚拟化+置底 sh≈ch 时依然稳定。
- **防跳滚**：Google 给滚动容器禁用了浏览器滚动锚定——任何布局写入都造成滚动跳动。恢复 `overflow-anchor: auto`（infinite-scroller 全体）+ 卡片 max-width 写入加 `__kgLastMaxW` 去重跳写。
- **rAF 冻结修复**：失焦/后台窗口的 requestAnimationFrame 被浏览器暂停（实测 IAB 面板 rAF 永不触发→渐隐引擎整体冻结）。调度器改 `setTimeout 32ms`（前台平滑、后台降频兜底）。
- 实机核对：band=composer=card 列几何严格一致（x430/w708）、fades 计数运转、渐隐贴合切线；dist 重建，版本 1.3.8；测试 39/40（唯一失败仍为该副本桌面端 native heartbeat 旧案）。

## 1.3.7-ext · 渐隐自然化 + 额度实时语义（feat/browser-extension） / 2026-11-03

- **渐隐自然化**：v1.3.6 的底色渐隐留下"雾感"——卡片 `backdrop-filter blur(18)` 在透明底上依旧把壁纸糊成雾，交界突兀。区内现同步内联渐隐 blur/阴影/描边（切线处玻璃带接管模糊），形成"实体卡 → 溶解 → 轻模糊"三段自然过渡；实发一轮对话截图验收通过。
- **额度实时语义**：官方 MaZiqc 权威但 5h 窗口初期恒为 0%（四舍五入滞后），0% 权威值盖住会话估算导致"跑了一轮对话条纹丝不动"。tracker 折算改为 `max(官方, 会话估算)`（turns>0 时），新增 `realQuota.displaySource`；挂件来源角标随动（官方限额/会话估算），官方重置时间照常显示。实发一轮对话验证：条 0%→92% 实时跳动（会话估算语义），每周 66% 官方数据并存。
- dist 重建，版本 1.3.7；Catstella-web 测试 39/40（唯一失败项仍为该副本桌面端 native heartbeat 旧案，与扩展无关）。

## 1.3.6-ext · 原生观感回调 + 画廊设置面板 + 防闪屏（feat/browser-extension） / 2026-11-03

- **宽度回调**：v1.3.4 的"拉宽 Composer/回复"方向被否决——Composer 恢复 Google 原生宽度（清除全部内联残留），回复卡收窄到"原生对话列"宽度（实测 user-query 容器，回退 720px），居中；观感 = 换了风格的原生 Gemini。
- **画廊设置面板（agy 移植）**：设置面板新增 壁纸画廊（内置 + 自定义上传，缩略图网格、active 高亮、自定义可删）与 形象画廊（按形象包预览选择 + 自定义单图上传/还原）；构建期扫描 assets 生成 `assets/manifest.json` 画廊清单（build.js `generateGalleryManifest`，双 dist 注入 + Firefox WAR 放行）。
- **面板自动收起**：document 捕获段点击 + composedPath 判定（Shadow DOM 兼容），点击桌宠外自动收起，Esc 亦可。
- **滚动防闪屏**：底色渐隐的渐变停靠点按 12px 量化、量化后与上次相同则跳过写入——滚动期间绝大多数帧零样式重算，闪屏消除。
- 壁纸解析链升级：`wallpaperId`（内置 id / custom:<ts>）→ `customWallpapers[]` → 旧版单图 `customWallpaper` 兜底 → 默认；skin.js 经画廊清单解析内置 id。dist 重建，版本 1.3.6；Catstella-web 测试 39/40（唯一失败项为该副本桌面端 native heartbeat 旧案，与扩展无关）。

## 1.3.5-ext · 对齐终修 + 壁纸复活 + 自定义形象/壁纸（feat/browser-extension） / 2026-11-03

- **渐变对齐终修（垂直）**：内容的真实切线是**滚动容器底边**而非 Composer 顶边（相差 ~30px）——v1.3.4 的渐隐与玻璃带锚错位置导致"渐变没对齐"。`getCutLineY()` 统一锚定滚动容器底边，渐隐带（110px）与玻璃带（含 Composer 间隙）全部随动。
- **Composer 无限拉长根因**：宽度曾取 `input-container` 容器宽（整个底栏），在部分会话中远超内容列。改为**精确对齐回复卡视口矩形**——宽度=卡宽，水平偏移=卡左缘-药丸原始左缘（relative 偏移不影响布局流，`__kgOffsetX` 防漂移累积）；实机核对 band/composer/card 三者 x≈301 w=967 严格一致。
- **壁纸复活**：挖空区方案的 body 不透明基底色把负 z-index 的壁纸层整个盖住（z 序：body 背景 > 负 z 定位层）。基底色改画独立 `#kimino-base-layer`（z -100000，垫底），body 恢复透明，壁纸层（z -99999，圆角 22 内容列）叠其上——挖空观感不变，壁纸回归。
- **自定义形象 + 自定义壁纸迁移**：设置面板新增两组文件选择——壁纸（≤1920×1080 JPEG 压暗底）与形象（≤640×640 PNG 保透明，覆盖所有表情帧）；canvas 压缩后存 storage dataURL，skin.js/widget.js 经 onChanged 链路即时切换，"默认"按钮一键还原。
- 实机核对：壁纸层可见（z -99999/圆角/IMG）、band=composer=card (x≈301, w=967)、渐隐带贴合切线；dist 重建，版本 1.3.5，测试 48/48 全绿。

## 1.3.4-ext · 全面板毛玻璃 + 挖空圆角区 + 桌宠设置面板（feat/browser-extension） / 2026-11-03

- **全面板毛玻璃统一**：阅读面/用户气泡 `rgba(33,30,45,.74)+blur18`、侧栏 `.68+blur20`、思维链与 usage 卡 `.66+blur16`、菜单/弹窗/代码块 `.90+blur10`（保护区保持高对比）——不透明界面全部转为磨砂质感，壁纸色彩统一从面板透出。
- **Liquid Glass 重构**：废弃 `input-container::before` 方案（位置/层序不可控），改为 skin.js **fixed 覆盖层**（`#kimino-glass-band`，跟随 Composer 实测坐标，mask 渐变 blur11 + 轻暗化，高 100px）；annotate/resize 持续跟随。
- **滚动联动底色渐隐**：卡片/气泡进入 Composer 上方 110px 渐变区时，自身底色沿滚动方向线性渐隐（内联渐变 background-image，文字保持清晰，blur 由 CSS 继续承担）——对话滚入底下时"先溶解、再轻模糊"，不再雾罩生硬切。
- **挖空圆角内容区**：壁纸层几何由 skin.js 实测侧栏右缘后写入（`border-radius 22px` + 内侧描边），body 基底色 `#211e2d` —— 主要操作区呈现为基底上挖出的圆角矩形区域（桌面端 pane 同款）；侧栏毛玻璃坐在基底上。
- **宽度语义修正**：v1.3.3 的"拉宽回复对齐气泡"方向废弃——回复卡恢复 Google 原生统一列宽，**Composer 药丸拉宽至与回复等宽**（实测回复卡宽度与内容列容器取小，内联 width+居中）。
- **桌宠设置面板（web 功能迁移）**：气泡 header 新增 ⚙️ 入口，Shadow DOM 毛玻璃面板含 桌宠/皮肤/台词气泡/音效 四开关、桌宠大小与壁纸浓度滑条、星语喵/林猫形象切换、位置复位——全部走 storage 即时生效（onChanged 链路已有）；enabled 开关修复为 important 内联 `display:contents/none`（contents 宿主下原 block 赋值无效的隐患）。
- 实机验收（IAB）：玻璃带渐隐、毛玻璃可读性、挖空区几何、设置面板渲染与线路全通过；dist 重建，版本 1.3.4。

## 1.3.3-ext · 卡片同列对齐 + 侧栏渐变根因 + Liquid Glass 过渡带（feat/browser-extension） / 2026-11-03

- **卡片同列对齐**：model-response 卡与 user-query 气泡列同宽同圆角——skin.js 实测当前会话 user-query 容器宽度（回退 720px，clamp 480~960），以内联 `max-width !important` 写入每张卡（绕开 var() 与类名漂移），CSS 统一 `border-radius 22px` + `margin auto` + `box-sizing`；实机核对 20 张卡全部 708px@x430 与气泡列严格对齐。
- **侧栏渐变阴影根因**：Angular Material 的 `mat-nav-list` 宿主自带 `role="navigation"`，被侧栏选择器 `:is(..., [role="navigation"])` 命中导致微网格装饰在每组列表上重复绘制（"奇怪的渐变阴影"元凶）。侧栏规则收窄为仅 `bard-sidenav`，hover/selected 规则同步去裸 `aside`（防误伤 Notifications 通知气泡）。
- **Liquid Glass 过渡带**：内容滚入 Composer 底下的生硬切断（滚动容器底边 572 vs Composer 顶 594）改为渐进高斯模糊——`input-container::before`（高 120px、`backdrop-filter blur(16px)` + `mask-image` 线性渐变 + 底部暗化），`position:relative` 仅加于该容器。
- 实机核对：navList 渐变 CLEAN、glass band（120px/blur16/mask）就位、卡片同列；44/44 测试全绿，扩展版本 1.3.3。

## 1.3.2-ext · 表面标注引擎 + 幽灵色块真身落网（feat/browser-extension） / 2026-11-03

- **表面标注引擎（架构终局）**：A/B 分流导致 Google 类名随会话漂移，任何类名选择器都可能在部分用户会话失手。skin.js 升级为**结构标注引擎**——按产品级语义锚点（`user-query`/`model-response`/`rich-textarea`/`bard-sidenav`，比类名稳定一个数量级）定位表面，向上爬到真正绘制背景的视觉容器（`climbToPainted`，A/B 变体免疫核心）后打 `data-kg` 标记；skin.css 新增 3.5 节按标记渲染，与类名规则（字面量相同）双保险并存。标注失败 → 原生暗色兜底，永远可读。
- **幽灵色块真身落网**：ghost 侦探在实机抓到"头像旁黑框"元凶——`<aside aria-label="Notifications" aria-live="polite">`，Google 的**通知 live-region 气泡**（32×32，钉在左下角 0,688），通知出现时以深色小盒示人。skin.js 自动透明化（`data-kg="ghost"`）并把 DOM 链路输出到控制台；widget.js 的角落异物诊断继续保留作报告通道。
- 实机核对：bubble×20 / card×20 / composer×1 全部标注并正确渲染（bubble `rgb(33,30,45)`、composer 玻璃梯度叠加 rgba(33,30,45,.72)）；扩展版本 1.3.2。

## 1.3.1-ext · 去 var 化 + 角落异物自诊断（feat/browser-extension） / 2026-11-03

- **var() 全灭**：用户实报"磨砂玻璃处全变透明"——透明化规则不含 var 照常生效、玻璃面规则全部依赖 `var(--kg-*)`，指向用户浏览器中 CSS 自定义属性解析失败（IAB Chromium 无法复现）。skin.css v2.1 将全部 token 内联为字面量，surface/reading 提升至纯不透明 `#211e2d`（blur 仅作质感增强），var 失败面从此不存在。
- **Composer 针对性重绘**：药丸玻璃浓度加强（rgba(75,62,84,.55)→rgba(23,18,31,.72) 叠加 rgba(33,30,45,.72) 底），明亮壁纸区域依然清晰。
- **角落异物自诊断**：widget.js 初始化 3 秒后探测左下角多点，发现非桌宠实底元素即向控制台输出 `[星语喵伴] 角落异物诊断(...)` 与完整 DOM 链路——头像旁黑框的元凶靠它揪出。
- IAB 计算样式核对：bubble/sidebar `rgb(33,30,45)`、composer 玻璃梯度、宿主 `display:contents` 全部生效；44/44 测试全绿，扩展版本 1.3.1。

## 1.3.0-ext · 扩展主题架构重写："Gemini 本体换肤"（feat/browser-extension） / 2026-11-03

- **架构反转**：放弃 1.2.x 的"全透明穿透"打法（选择器失手即生肉壁纸怼脸、永远在追 Google 新容器打地鼠），改为忠实复刻桌面端 Antigravity 主题 token 的**换肤架构**——面板以不透明深紫 `#211e2d` 为主（桌面 `--agy-ui-reading: #211e2df5`/`--agy-ui-surface` 逐字复刻），壁纸只从内容区缝隙与 Composer 玻璃（`--agy-ui-glass` 渐变）后透出。
- **稳健性关键**：任何选择器失手时 Google 原生暗色面板原样保留（优雅降级、永远可读）；skin.css 删除全部"子孙元素大清洗"与全局通配规则；`#kimino-dream-wallpaper` 升级为页面基底（`background-color: #211e2d` + 暗部渐变 + 星空图三层合一）。
- **黑框最终解**：`:host` 优先级低于页面 `#id` 规则——widget 宿主现在同时带内联 `display:contents !important` 等八项保险 + skin.css `#kimino-companion-root` 双保险，任何页面 CSS 都无法把它渲染成可见盒子。
- **实机验收（IAB 全量部署）**：文本对话阅读面、用户气泡右对齐、Composer 玻璃药丸透壁纸、不透明侧栏微网格、桌宠渲染全部通过。
- 扩展版本线升至 1.3.0；dist 重建完成。

## 1.2.3 · 扩展实机部署二次会诊（feat/browser-extension） / 2026-11-03

- **Trusted Types 加固**：gemini.google.com 开启 `require-trusted-types-for`，桌宠 `wrapper.innerHTML` 裸赋值会抛 `TrustedHTML`（MAIN world 必炸）；新增 `ttPolicy`/`setHTML` 安全壳（策略创建 → DOMParser 兜底双保险）。
- **头像旁黑框根治**：`#kimino-companion-root` 宿主原为全视口 fixed 覆盖层，易被 Google 页面级 CSS 命中渲染成色块；改为 `:host { all:initial; display:contents }` —— 宿主不再生成任何盒子（实机验证 0x0），桌宠完全由内部 fixed wrapper 承载，字体与 user-select 一并迁至 wrapper。
- **Composer 药丸增强**：浓度 0.44→0.62、blur 28px、描边 0.38，实测在明亮花哨壁纸区域依然呈现清晰水晶悬浮感。
- **图片查看器毛玻璃化**：原生 `.image-expansion-dialog-backdrop` 为 0.9 纯黑且按钮深灰（遮罩与返回键"不可见"元凶）；改为 rgba(10,7,20,0.55)+blur(18px) 毛玻璃遮罩，返回/工具条/色板按钮统一玻璃芯片+高亮图标，面板本体豁免保护区深底。
- **/usage 断层修复**：usage 路由用 Meta 原子类（x9f619 系列）——内容区 section rgb(15,15,15) 实底转透明、配额卡 rgb(23,23,23) 转 0.42 玻璃卡、升级横幅玻璃化、巨型装饰 `.gradient-strip` 隐藏；上黑下透断层根除（实机截图验收）。
- **额度映射重写（锚点式）**：文档顺序扁平映射会被噪声整数污染（实测 0%/66% 被解析成 2%/1%）；重写为"同一对象内 时间串+百分比 成组，纯时钟→当前周期、含月日→每周限额"的锚点式最小分组解析，附噪声数字混入单测；官方重置时间现可换算本地 epoch 驱动倒计时。

## 1.2.2 · 浏览器扩展实机勘察二次攻坚（feat/browser-extension） / 2026-11-03

- **皮肤选择器全面实机化**：在登录态真实 DOM 上逐层勘察后重写 `skin.css`——用户气泡玻璃只打真身 `span.user-query-bubble-with-background`（外层链路全透明），大紫板根除；Composer 水晶药丸正中 `<input-area-v2>`，并穿透 `<input-container>`(rgb(15,15,15)) 及其 `::before` 渐变迷雾与 `.autosuggest-scrim`；侧边栏结构层（含 sidenav-mavatar-footer 档案区）全裸化，左下角黑块根除。候选与最终版均在实机截图验收通过。
- **额度实时刷新管线（MaZiqc RPC）**：实测确认官方双周期额度由 batchexecute RPC `MaZiqc` 承载且每次应用启动自动发出；Angular 引导期捕获原始 fetch 引用导致运行期补丁失效，故将 `interceptor.js` 注册为 MV3 `world:"MAIN"` + `document_start` 独立 content script 先于框架完成补丁；`tracker.js` 以自适应解析器（不绑定字段名）提取双周期数据，并按"每5分钟 + 每轮对话结束 + 挂件手动同步"节流静默重放，全程零 UI；提示条/弹窗嗅探降级为兜底层。同源 iframe 幽灵加载方案实测被跨源隔离挡死，已弃用。
- 桌面端 41 项单元测试全部通过；.xpi/.zip 规范 zip（正斜杠条目）重新打包。

## 1.2.1 · 浏览器扩展四大缺陷攻坚（feat/browser-extension） / 2026-11-03

- **Gecko 修复**：根 manifest 不再混写 `service_worker`+`scripts`（Chromium 根模板与 Firefox 构建版各自合规）；新增 `content/shim.js` 跨浏览器垫片（browser.*/chrome.* 双命名空间 + 永不 reject 的 storage 封装），popup/background 同步加固；`inject-bridge.js` 带 CSP 握手检测，嗅探器被拦截时安全降级为 DOM 嗅探，桌宠与皮肤主流程零依赖它。
- **.xpi 修复**：弃用 PowerShell Compress-Archive（其条目名使用反斜杠违反 ZIP 规范，Firefox libjar 无法解析导致 content script 静默加载失败），改写为 Node 内置 zlib 规范 zip 写入器（正斜杠 + UTF-8 标志 + CRC32）。
- **皮肤重构**：用户提问外层容器全透明并右对齐，毛玻璃只作用于内层文字小气泡（0.42 微紫细描边），抹杀撑满整行的大紫色实体色块；卡片不透明度全线降至 0.35~0.45；穿透 `rich-textarea`/`input-area-container`/`bottom-container` 死黑底色，还原 `.surface-composer` 式水晶药丸（`:where()` 压低裸化规则优先级 + 三重回落防套娃）；侧边栏左下角档案区小黑块斩草除根。
- **额度嗅探**：tracker 新增输入框上方常驻提示条解析器（“用量限额将在 6:37 下午 重置” 中英文 + 相对/绝对时间 + 限流状态），无需手动打开用量弹窗即可动态更新重置倒计时；MutationObserver 回调全面节流，消除高频 innerText 布局抖动。
