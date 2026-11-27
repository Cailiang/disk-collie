# DiskCollie 1.0.24 — 新名称与新仓库 / New identity and repository

- 产品与安装包统一使用 DiskCollie，包名 `disk-collie`，应用标识 `com.fcl.diskcollie`，原生引擎 `disk-collie-engine`。
- 代码与后续更新迁至 [Cailiang/disk-collie](https://github.com/Cailiang/disk-collie)，旧仓库停止维护并归档，提交历史保留。
- 首次启动迁移原有供应商、加密密钥、配置、对话与清理统计，保留旧数据，已有 DiskCollie 数据不覆盖。
- 同步侧栏、启动页、托盘、AI 提示、通信接口、测试、文档及全部平台发布脚本，保留必要的旧版兼容。
- 修复 Windows 忽略目录在规范化路径前缀和大小写变化时未被跳过的问题。

English: Memento becomes DiskCollie, with package `disk-collie`, bundle ID `com.fcl.diskcollie` and sidecar `disk-collie-engine`. Source and future updates move to Cailiang/disk-collie while the old repository is archived. First launch snapshots the legacy database together with its encryption key, preserving providers, settings, conversations and cleanup totals without overwriting existing DiskCollie data. Branding, IPC, build/release scripts, documentation and automated coverage are updated together. Windows exclusions now normalize canonical namespace prefixes and casing before traversal. Historical entries below retain the original product name.

# Memento 1.0.23 — 游戏切换与窗口适配 / Game controls and window resizing

- 草地、松林、溪谷、小镇及昼夜可手动切换，也可恢复自动变化；夜晚有清晰的深色效果。
- 游戏随窗口实际宽高调整视野，缩放时暂停并保留得分与进度，按空格继续。
- 终端优化收紧上下布局，游戏独立排版，去掉中间横线，修复文字被遮挡及扫描中提前显示空结果。
- 新增场景、光照、反复缩放和终端页四种窗口布局的回归验证。

English: scene and lighting selectors now change the panorama and game palette, including a distinct night. A measured camera adapts to window size, pauses during resizing and retains the round. Terminal optimization uses a compact game panel in normal page flow, with shorter counters/results/footer and no horizontal section separators. Regression coverage checks visual changes, repeated resizing and four-viewport scanning/completion layouts.

# Memento 1.0.22 — 变化的障碍与场景 / Varied challenges and scenery

- 快跑增加十种障碍与单／双／三连组合，高飞鸟可从下方通过；飞盘与荷塘也有不同轨迹和地形组合。
- 随机池避免反复出现相同障碍，随路程解锁更多组合并逐步提速，增加骨头奖励和连击得分。
- 草地、松林、溪谷、小镇沿路切换，加入远近景滚动、日月星空与昼夜变化，配色继续跟随主题。
- 仍只需空格或点击操作，保留暂停、减少动态效果、输入隔离和扫描完成立即返回结果。

English: ten runner obstacles and single/double/triple groups, varied frisbee trajectories and pond formations replace repetitive boxes. Shuffled pools, progressive unlocks, fair landing gaps, treats and catch streaks add changing goals. Four parallax landscapes crossfade with a theme-colored day/night cycle. One-button controls and scan independence remain intact, verified with multi-seed two-minute physics runs and real-keyboard browser journeys.

# Memento 1.0.21 — 边牧扫描小游戏 / Collie scan games

- 使用选定的朝左竖耳边牧 Logo，保留坚定眼神和调皮笑意，界面与游戏角色跟随主题色。
- 扫描区加入越障快跑、接飞盘、荷塘跳跃，空格或点击／轻触即可玩，支持得分、最佳成绩和重试。
- 游戏默认等待，切页／失焦时暂停，减少动态效果时移除装饰运动；文本输入和弹窗保留正常按键操作。
- 真实扫描进度和取消按钮独立保留，扫描完成立即显示结果；移除原来的宠物故事动画。

English: the approved left-facing, upright-eared collie becomes the themeable identity and game character. Three opt-in one-button scan games replace passive stories: Hurdle run, Frisbee catch and Pond hop. Space or tap starts/jumps/resumes/retries, with local best scores, hidden-view pause and reduced decorative motion. Inputs and dialogs keep their normal keys; scan progress/cancellation and immediate completion remain independent.

# Memento 1.0.20 — 边牧侧脸 Logo / Border collie profile logo

- Logo 改为可爱的边牧侧脸线条画，以折耳尖、额头白斑、长吻和颈部毛体现边牧特征。
- 同步侧栏、清理顾问、启动页、网页图标及应用图标，颜色继续跟随主题。

English: a cute right-facing border collie profile replaces the front-facing logo. The folded ear tip, forehead blaze, long muzzle and neck ruff carry through sidebar, advisor, startup, favicon and PNG/ICNS application icons, with themed UI ink.

# Memento 1.0.19 — 线条边牧小剧场 / Line-art collie stories

- 边牧与 Logo 改为跟随软件主题色的简笔线条画，移除照片素材。
- 四段约二十秒的连续小故事包含追球、扑空、接飞盘、拔河和篮球补投；结束后接不同故事，可暂停或切换。
- 利用扫描页面的主要空白区域展示动画，首次深度／隐私扫描移除空分类和骨架列表。
- 扫描完成立即返回结果，支持减少动态效果；隐藏页面暂停动画绘制。

English: a theme-colored SVG border collie replaces the photographic mascot. Four continuous twenty-second stories automatically hand off to different games, with pause/next controls and reduced-motion support. A large scan stage replaces empty loading panels; actual scan completion and cancellation stay independent of animation time.

# Memento 1.0.18 — 边牧与清理顾问 / Collie and Cleanup advisor

- 深度清理按占用空间从大到小排列分类、项目、路径和文件；仅供查看的来源不再扫描。
- 边牧成为新的应用 Logo；扫描时可看它玩球、接飞盘、拔河和玩篮球，点击可换游戏，减少动态效果时静止。
- 菜单图标逐项重新绘制，设置页移除水平分隔线。
- AI 助手改为清理顾问，集中解答文件用途、是否适合删除和清理影响。问题可从扫描结果发起，也可直接输入；模型配置往返保留草稿，执行计划按需展示。

English: Deep cleanup orders actionable categories/items/paths/files by size and avoids unsupported inspection-only sources. A border collie icon and four photographic sprite animations replace the generic scan spinner, with game switching and reduced-motion support. Semantic navigation icons and separator-free Settings accompany a focused Cleanup advisor for file decisions, cleanup impact and priorities, with deliberate evidence collection, retained provider-setup drafts and contextual return navigation.

# Memento 1.0.17 — 隐私读取与扫描配置 / Privacy reads and scan settings

- 修复 Chrome 浏览历史、搜索、下载读取失败；兼容数据库锁定和真实关联表结构。
- 应用活动隐藏零痕迹项，支持名称／数量排序；系统活动增加网络连接历史。
- 空间分析支持目录移到废纸篓，确认展示完整内容（含隐藏项），变化或受保护内容会阻止处理。
- 设置页增加持久化扫描排除目录，可添加／移除；修改后旧扫描结果失效。
- 精简模型配置：默认自定义 OpenAI 兼容接口，填写名称、地址和密钥，获取模型列表后选择保存；官方地址固定，说明收进问号。

English: verified private SQLite snapshots handle locked Chrome reads, while WITHOUT ROWID tables no longer break history fingerprints. Actual zero-trace apps are hidden with name/count sorting; macOS network recents are previewable. Space explorer supports complete, reviewed folder Trash with change/protection checks. Persisted excluded scan folders replace the old ignore-list UI. Concise model setup explicitly fetches and selects models before saving. Privacy previews remain local; no real user records are cleaned during verification.

# Memento 1.0.16 — 深度清理与并行更新 / Deep cleanup and concurrent updates

- 更新应用时仅当前行显示更新中，其他应用可以继续更新、打开和询问 AI；同一应用的更新和卸载互斥。
- 左侧删除清理记录入口，首页累计和每日图表继续读取本地清理统计。
- 智能清理改为深度清理，分类查看系统、用户、应用、浏览器、开发工具、Xcode、项目、AI 和容器占用，展开具体路径与文件明细。
- 支持文件预览、推荐／手动选择、批量确认、正在使用提示、权限状态、扫描取消，以及清理后的剩余结果。
- 项目产物核验后移到废纸篓；缓存只清理已扫描文件，源码、密钥、账户和配置保留。模型库、容器虚拟盘和应用瘦身目前仅分析，不执行整根删除或破坏签名的修改。

English: per-application concurrent updates, isolated progress/failures and same-app update/uninstall protection; no sidebar Cleanup history; a categorized Deep cleanup workspace with real source/file previews, safe recommendations, bulk review, cancellation, live-use checks and retained results. Verified project artifacts move to Trash; captured cache files are removed selectively. Model stores, virtual disks and application trimming remain inspection-only without a safe dedicated cleaner. Package-manager locks may still limit their own installations and are reported per app.

# Memento 1.0.15 — 隐私记录与直接文件操作 / Privacy records and file actions

- 隐私清理重新设计为四类分层列表，应用 Logo、配置目录、真实记录数，点击可分页查看浏览历史、搜索词、下载记录和系统活动。
- 时间范围支持最近一小时、今天、近七天、全部；没有可靠时间的来源明确标记仅支持全部时间，权限不足可打开系统设置后重扫。
- 浏览／搜索／下载独立清理，书签、下载文件和原始文档保留；账户和敏感记录需明确选择，浏览器运行中要求退出或跳过。
- 应用编辑历史和恢复记录标为敏感项，清理前分别提示旧版本丢失及未保存草稿风险。
- macOS 补齐新版 SFL4 最近记录、Finder 与终端活动、剪贴板摘要及已适配应用活动；记录预览仅在本机，AI 只收到类型元数据。
- 空间分析选中文件图块或目录树文件后，出现带文字的打开、询问 AI、移到废纸篓按钮，核对后删除并更新剩余结果。

涉及源文件大小与实际释放空间分开：数据库删除记录不一定立即缩小，清理结果按实测记录。Safari 目前适配历史／会话／缓存；Windows 系统活动目前为 Recent 快捷方式，不宣称完整平台对齐。

English: redesigned four-category privacy workspace with local paginated record previews, actual timestamp filters, permission/range states, separate Chromium history/search/download transactions, redacted account previews and explicit sensitive selections. macOS SFL4/Finder/shell/app activity is supported with structure-preserving cleanup. Running browsers must close or be skipped; AI receives type metadata only. Space explorer tile/tree file selections expose labeled, reviewed file deletion. Source size and measured freed bytes are distinct; Safari/Windows adapter limits are explicit.

# Memento 1.0.14 — 扫描边界与操作弹窗 / Cleanup scope and operation dialogs

- 大文件、重复文件扫描提前跳过无法在此清理的系统和应用目录，包括 `/private/var`；隐藏目录选项不会绕过保护。
- 空间分析中的受保护文件可查看占用，删除操作禁用并说明原因。
- 操作结果和错误统一在居中弹窗中展示，用户关闭前不会消失，并发提示排队去重。
- 文件变化时停止删除，弹出中文说明，保留文件和页面结果，可重新扫描后重试。

English: cleanup discovery and deletion share one protection policy, pruning system/app data, credentials and Trash before traversal and hashing. Analysis keeps protected items read-only. Operation outcomes use persistent centered dialogs with queued/deduplicated messages, keyboard dismissal and focus restoration; changed-file rejection is localized and preserves results.

# Memento 1.0.13 — 文件直删与应用管理修复 / File actions and app management

- 扫描提示与当前页面对应；空间分析文件行可核对后移到废纸篓，成功后同步目录图表和其他页面。
- 首页删除最近记录列表，累计清理与每日图表统一统计成功处理的体积，不再拆分永久删除和废纸篓。
- 清理记录迁入本地 memento.sqlite，与加密 AI 供应商和自定义配置同库；自动保留旧记录。
- 应用管理采用用户／系统标签、列标题排序和真实应用包 Logo；系统应用没有卸载入口。
- 卸载不再依赖关联文件或递归体积测量；无额外数据也可卸载应用本体。

English: workspace-specific scan labels; reviewed file removal in Space explorer; unified cleanup statistics without the duplicated recent list; an embedded SQLite cleanup ledger with one-time legacy import; sortable application columns, separate User/System tabs, actual bundle logos and reliable app-only uninstall.

# Memento 1.0.12 — 紧凑首页与分层隐私 / Compact overview and layered privacy

- 首页删除标语与重复指标；健康度按分数着色，设备状态集中到一个面板，分别使用 CPU 折线、内存分段条和存储环图；更多信息展示 GPU、电源和网络。
- 大文件扫描与隐私扫描／清理可以并行；同类任务有序执行，删除操作串行协调，扫描结果会扣除期间删除的文件。
- 隐私清理分为浏览器活动、浏览器账户、应用活动、系统活动，支持应用 Logo、配置目录、记录类型和路径层级；Cookie／会话清理会说明影响，密码与书签不在清理范围。
- AI 任务入口移到顶部，结果保持未读提示；面板支持收起、点击外部和 Escape 关闭；悬停提示紧邻操作按钮。
- 空间图只显示 Top 10 和其他，其他可继续展开。每个图块保留名称与实际大小，小块设最小面积，去掉独立较小项目列表。

English: a compact score/device overview with three distinct charts and expandable hardware details; independent file/privacy work runs concurrently with removal reconciliation. Privacy now has four categories and application/profile/record/path layers with OS icons and explicit cookie/session effects. AI tasks live in the top bar, tooltips stay close, and Top 10 + Other tiles keep byte labels visible with minimum display areas.

# Memento 1.0.11 — 应用缓存与批量整理 / Cached apps and batch cleanup

- 应用清单在启动时后台读取，跨启动恢复缓存并自动维护；先显示列表，再补齐体积，未变应用复用测量结果。
- 重复文件可以跨组勾选，通过底部统一按钮一次核对、一次移到废纸篓；每组至少保留一份，全部校验通过后才开始移动。
- 大文件、缓存和隐私清理共用底部批量操作栏，支持清空选择；AI 任务入口避让批量操作按钮。
- 大文件、重复文件和空间分析默认排除隐藏目录及应用数据；手动包含时提示扫描耗时和数据风险，已有路径保护继续生效。
- 自动缓存仅用于展示，实际打开、更新或卸载前仍需当前应用登记；扫描总量只代表本次范围。

English: application inventory now warms on launch, restores a local cache, maintains installed-app changes and publishes the list before calculating sizes. One bottom action reviews selected duplicates across groups; every group keeps a verified survivor before any removal begins. File scans exclude hidden folders and application data by default, with a clear opt-in and risk explanation. Existing protected paths and confirmation remain enforced.

# Memento 1.0.10 — 后台 AI 任务与设备概览 / Background AI and device overview

- 扫描跨页面自动排队，显示等待进度，不再因已有扫描而报错；取消按页面类别隔离。
- 询问 AI 后留在原页面，右下角浮窗展示排队、分析中和完成状态，并提示未读结果；支持取消、重试、配置供应商后继续以及一键返回来源。
- 文件和进程操作增加悬停提示。进程默认用户进程、CPU 降序；CPU／内存超过 40% 橙色、超过 65% 红色。
- macOS 退出应用辅助进程时处理所属应用，并验证实际退出；应用仍运行或被重启会明确提示。
- 首页新增健康评分、CPU／内存实时小图表和存储卡片，直达对应工具；保留累计与每日整理图表，区分永久清理和废纸篓。
- 健康评分只使用可用测量，是当前负载与容量的参考，不代表硬件诊断。

English: storage jobs queue across pages; background AI tasks retain source context and resume after provider setup, with unread results, cancellation and retry. Processes default to user-only/CPU descending, highlight >40%/>65% usage and verify actual app/process exit. Overview combines an explainable score, real CPU/memory samples, storage navigation and cleanup-value charts. Unavailable readings are excluded.

# Memento 1.0.9 — 应用管理与清晰的空间导航 / Applications and clearer navigation

- “应用卸载”改为实用工具中的“应用管理”，默认隐藏系统应用。
- 应用行显示真实 Logo、版本、体积和多久未使用，支持打开、检查更新、更新与询问 AI。
- 卸载前可逐项核对应用本体、缓存、设置、支持文件和日志；目录可展开，关联数据默认不选，并标明哪些可重建、哪些可能包含个人数据。
- 问号改为透明小图标，删除首页、应用管理、进程、记录及空间分析的多余帮助。
- 大文件默认包含隐藏目录和应用数据；重复文件从 10 MiB 起扫描，可提高阈值。
- 空间分析下钻后有明确的“返回上一级”；较小项目即使无法在图内显示，也能从列表打开。

macOS 更新支持已发现的 Homebrew Cask、App Store 和 Sparkle 来源；需外部更新时会打开相应入口，不会冒充已完成安装。最近使用信息缺失时显示未知。

English: a redesigned application manager under Utilities with real icons, usage, sorting, Open/Update/AI actions and expandable uninstall details. System apps are hidden by default. Duplicate scanning starts at 10 MiB; large files include hidden/app-data locations by default. Quiet Help glyphs, explicit disk navigation and accessible smaller-item lists keep results readable.

---

# Memento 1.0.8 — 保留整理成果 / Keep your progress

- 大文件清理一部分后回到剩余结果；成功项移除，失败项保留，继续处理无需重新扫描。
- 大文件、重复文件和空间分析分别保留结果；切页和询问 AI 后返回时，筛选与勾选仍在。
- 删除选择文件夹功能，统一扫描系统磁盘，默认包含隐藏目录和应用数据。
- 新增清理动画、实际处理数量和当前路径；文件与目录各层级增加打开位置和询问 AI。
- 首页累计整理立即更新，新增近 14 天累计折线图、每日整理柱状图和每日任务数。
- 累计整理包含永久清理与移入废纸篓；废纸篓未清空前仍占磁盘，明细继续分别显示。

English: retained results and selections across pages/AI, independent full-drive scan sessions, remaining results after partial cleanup, actual cleanup progress animation and per-file AI explanations. The homepage updates immediately with organized totals, a 14-day cumulative line and daily bars; permanent cleanup and Trash remain distinct.

---

# Memento 1.0.7 — 紧凑工作区与扫描改进

- 删除大段页面说明，必要说明收进可点击问号；大文件支持类型筛选。
- 重复文件、隐私、卸载关联文件改成可展开层级；应用显示真实图标。
- 空间分析改为左目录树、右分布图，默认分析系统磁盘并包含 Users。
- 恢复进程图标、表头双向排序、用户／系统筛选与行内操作；无独立图标资源的应用使用系统图标回退。
- 修复扫描极快时重复结果被界面重置的问题；不同用途的扫描范围独立校验。
- 近期修改的文件绕过哈希缓存，避免 Windows 相同时间戳下的内容变化导致旧结果。
- 取消 200 万项上限，压缩索引；重复扫描按可见条件分阶段校验并缓存同会话结果。默认 ≥200 KB，隐藏目录和个人应用数据可勾选纳入。
- 本机默认重复扫描 12.70 秒（52 万项、816 组）；完整个人目录 213 万项／60.77 秒；系统磁盘 368 万项／99.77 秒。整盘仍较慢；无权限与跳过位置可在问号中查看。不是与 MangoDisk 的同条件基准。
- 个人文件进入系统废纸篓，删除前重校验完整内容并至少保留一份；缓存／历史永久删除仍需确认。

English: compact data workspaces, on-demand Help, file-type filters, expandable results and inline process actions. The compact native index removes the two-million-entry cutoff. Focused duplicate scans default to ≥200 KB with optional hidden/app-data coverage; full-drive scans still take substantially longer. Local measurements and scope limitations are documented in the architecture report.

---

# Memento 1.0.6 — 重新找回空间 / A lighter workspace

## 简体中文

- 全新首页与清晰导航：大文件、重复文件、空间分析、隐私、应用卸载和清理记录。
- 原生 Rust 扫描核心与共享索引，macOS 批量读取、完整内容去重和可取消的扫描进度。
- 应用关联文件逐项检查，关联数据默认不选；缓存永久清理与文件移到废纸篓使用不同确认说明。
- 保留进程管理和现有 AI 接入方式；中英文资源可扩展，支持浅色／深色主题。
- 接入 Windows／Linux 平台适配与构建。macOS x64 已本机运行验证；其他平台的运行验证仍由 CI 承担。Windows／Linux 应用卸载使用系统工具。
- 整理体积是估算；废纸篓未清空前仍占用磁盘。隐私目前覆盖支持浏览器的默认配置，清理前需要退出浏览器。

## English

- Rebuilt home, navigation, large files, verified duplicates, space map, privacy, app associations and cleanup history.
- Independent Rust scanning/index engine with macOS bulk metadata, staged full-content hashing, progress and cancellation.
- Explicit per-file app review, associated data unselected by default, distinct permanent-cache and Trash confirmation flows.
- Preserved user-configured AI and process management; extensible Chinese/English catalogs and light/dark themes.
- Windows/Linux adapters and packaging are configured. macOS x64 is runtime verified locally; other platform runtime checks remain in CI. Package removal on Windows/Linux uses the OS tools.
- Processed sizes are estimates; Trash still occupies disk space. Privacy supports listed default browser profiles and requires browsers to be closed.

---

# Memento Agent 1.0.5 - DuckDuckGo CDN 回退 / DuckDuckGo CDN Fallback

## 简体中文

- **可靠检测：** DuckDuckGo 的静态 Sparkle appcast CDN 暂时不可用时，使用官方 GitHub macOS 发布标签识别更新。
- **版本比较：** 分别读取 Sparkle 展示版本和构建号，避免同一展示版本的新构建被漏报。

## English

- **Reliable discovery:** DuckDuckGo updates are detected from official GitHub macOS release tags when its static Sparkle appcast CDN is unavailable.
- **Version comparison:** Sparkle marketing versions and build numbers are compared separately so newer builds with the same marketing version are not missed.

---

# Memento Agent 1.0.4 - DuckDuckGo 更新检测 / DuckDuckGo Update Detection

## 简体中文

- **更新检测回退：** 带有 Mac App Store 收据、同时提供 Sparkle appcast 的应用，现在会在 Apple 没有有效 macOS 更新记录时继续检查自己的更新源。
- **来源优先级：** 有效的 Homebrew 和 Mac App Store 更新仍优先；Sparkle 仅作为没有更高优先级结果时的安全回退。

## English

- **Update fallback:** Receipt-backed applications that also publish a Sparkle appcast now continue checking their own feed when Apple has no valid macOS update record.
- **Source priority:** Valid Homebrew and Mac App Store updates remain preferred; Sparkle is used as a safe fallback when no higher-priority result exists.

---

# Memento Agent 1.0.3 - 供应商密钥编辑 / Provider Key Editing

## 简体中文

- **编辑立即生效：** 在供应商页面输入新密钥后，测试连接和模型发现会使用当前输入的密钥。
- **保存后持久化：** 点击保存后，后续请求和重新打开设置都会使用新密钥；页面只显示新的末尾提示，不会回传已保存密钥的明文。
- **草稿稳定：** 测试失败或供应商列表刷新不会覆盖未保存的密钥和其它字段；留空密钥继续表示保留已保存的密钥。

## English

- **Edits take effect immediately:** Connection tests and model discovery use the key currently entered in the provider editor.
- **Persistence after Save:** Requests after saving and reopening Settings use the replacement key; the Renderer only receives its masked suffix.
- **Stable drafts:** Failed tests and provider-list refreshes no longer overwrite unsaved keys or fields; leaving the key blank still preserves the encrypted saved key.

---

# Memento Agent 1.0.2 - CC Switch 一次性导入 / One-Time CC Switch Import

## 简体中文

- **只询问一次：** 首次检测到可用 CC Switch 配置时，Memento 会询问是否导入；选择后不会重复弹出。
- **独立副本：** 导入结果保存为 Memento 自己的加密供应商配置，用户可以自由修改名称、地址、模型和密钥，不会跟随 CC Switch 变化，也不会回写 CC Switch。
- **手动复制：** 设置页可以按需再次复制 CC Switch 配置，除此之外 Memento 不会读取或同步 CC Switch。

## English

- **One-time prompt:** Memento asks once whether to import usable CC Switch providers when it first detects them.
- **Independent copies:** Imported providers are encrypted Memento configurations that can be edited freely. They do not follow or write back to CC Switch.
- **Explicit copy action:** Settings can copy CC Switch configurations again when requested; there is no background synchronization.

---

# Memento Agent 1.0.1 - App Store 更新检测 / App Store Update Detection

## 简体中文

- **App Store 更新检测：** 通过应用内的 App Store 收据和 Apple lookup 服务识别更新；没有安装 `mas` 时，钉钉等 App Store 应用也能显示准确的版本差异。
- **更新方式清晰：** 应用卡片会区分“可在 Memento 内更新”和“需打开 App Store/应用更新”，并提供对应的筛选器与操作按钮。
- **来源校验：** Homebrew Cask 结果会比较实际版本，只保留确实更高的更新。

## English

- **Mac App Store detection:** Receipt-backed applications are checked through Apple's lookup service, so App Store installs such as DingTalk still show their exact version delta without `mas`.
- **Clear update paths:** Application cards distinguish updates Memento can install from updates that need the App Store or the application's own updater, with matching filters and action labels.
- **Source validation:** Homebrew Cask results are compared with the installed version to avoid stale update reports.

---

# Memento Agent 1.0.0 - 首个稳定版本 / First Stable Release

## 简体中文

`1.0.0` 完成首个稳定版本的交互收口。

### 主要变化

- **辅助功能说明：** 网络卡片在无法自动切换活动监视器面板时，会说明权限用途、设置路径和权限边界。它只用于点击“网络”标签。
- **应用卡片空间：** 默认窗口宽度调整为 1440 像素，应用卡片中的“问 Agent”、更新和管理操作不再拥挤。
- **快捷筛选：** 从概览页点击“不常用”或“需要更新”的数字，会直接进入应用管理并选中对应筛选。
- **系统进程提示：** 进程列表中的“系统进程”标签使用红色显示。

## English

`1.0.0` closes the first stable interaction pass for Memento Agent.

### Highlights

- **Accessibility explanation:** If Memento cannot switch Activity Monitor to the Network panel automatically, it explains the permission purpose, settings path, and scope. The permission is used only to click the Network tab.
- **Application-card space:** The default window width is now 1440 pixels, giving Agent, update, and management actions room to breathe.
- **Filter shortcuts:** Clicking Unused or Updates available in Overview opens Applications with that filter selected.
- **System-process warning:** The System process label is now red in the live process list.

---

# Memento Agent 0.7.15 - 应用内更新与进程列表可读性 / In-App Updates and Process Readability

## 简体中文

`0.7.15` 让应用管理可以在 Memento 内执行更多更新，并收紧命令行启动优化列表的可操作边界。

### 主要变化

- **应用更新：** Homebrew Cask 和 Mac App Store 继续使用各自的命令行更新源；Sparkle appcast 提供下载包时，Memento 会通过 HTTPS 下载、校验 Bundle ID、签名团队和严格代码签名，再替换应用。无法安全取得安装包时仍使用应用自带更新器。
- **命令行启动：** 没有注册修复操作的“可查看配置”诊断不再出现在优化列表中。
- **进程列表：** 概览页进程名称、资源数值、筛选器和操作菜单字号调大，行高同步增加。

## English

`0.7.15` brings more application updates into Memento and keeps reference-only terminal diagnostics out of the actionable list.

### Highlights

- **Application updates:** Homebrew Cask and Mac App Store updates keep their package-manager paths. When a Sparkle appcast includes a package URL, Memento downloads it over HTTPS, verifies bundle identity, signing team, and strict code signing, then replaces the bundle. If a safe package is unavailable, the app's own updater remains available.
- **Terminal startup:** Findings without a registered fix, including reference-only configuration diagnostics, are hidden from the optimization list.
- **Process list:** Overview uses larger process names, resource values, filters, action-menu text, and row spacing.

---

# Memento Agent 0.7.14 - 应用活跃时间 / Application Activity Dates

## 简体中文

`0.7.14` 修复应用管理中大量应用显示“无使用记录”的问题。

### 主要变化

- **活跃时间：** 优先使用 Spotlight 的 `kMDItemLastUsedDate`；Spotlight 没有数据时，使用 `.app` 包目录修改时间作为 Mole 兼容的活动估算。
- **时间显示：** 应用卡片按天、周、月和年显示相对时间，例如“7 个月前”和“2 年前”。
- **数据边界：** 丢弃无效、2001 年以前和未来异常时间；兜底时间表示安装或更新活动，不宣称是精确启动记录。

## English

`0.7.14` fixes application cards that reported “No usage record” for many apps.

### Highlights

- **Activity dates:** Read Spotlight `kMDItemLastUsedDate` first, then use the `.app` bundle mtime as Mole-compatible activity estimate when Spotlight has no value.
- **Humanized ages:** Show application ages in day, week, month, and year units, such as “7 months ago” and “2 years ago”.
- **Validation:** Reject invalid, pre-2001, and future dates; bundle mtime is documented as installation/update activity evidence rather than an exact launch record.

---

# Memento Agent 0.7.13 - 应用分析进度与卡片交互 / Application Scan Progress and Card Interaction

## 简体中文

`0.7.13` 优化应用扫描反馈和应用卡片的空间使用。

### 主要变化

- **应用分析：** 概览首次扫描时在卡片内显示动画进度条，完成后显示已安装、不常用和可更新应用数量。
- **应用卡片：** 点击卡片即可打开应用；移除独立“打开”按钮，更新状态改为标题下方的紧凑徽标。
- **卡片入口：** CPU/内存卡片跳到对应降序进程列表，磁盘卡片打开磁盘分析，电池卡片打开系统设置，网络卡片打开活动监视器网络面板。
- **进程列表：** 移除“高占用进程”板块，扩展实时采样数量，支持用户/系统筛选和颜色区分。
- **应用更新：** 应用管理支持 Homebrew Cask、Mac App Store（`mas`）和 Sparkle appcast 来源，并为每个来源使用对应的更新动作。
- **首次加载：** 概览页启动应用扫描，应用分析统计、进程 Logo 和 Memento 自身图标不再依赖先打开应用管理。
- **终端诊断：** 没有自动修复的诊断也可以直接打开相关 shell 配置文件查看。

## English

`0.7.13` improves application scan feedback and application-card interaction density.

### Highlights

- **Application analysis:** Overview shows an animated in-card progress bar during the first inventory scan, then shows installed, unused, and updateable counts.
- **Application cards:** Clicking or keyboard-activating a card opens the app; the standalone Open button is removed and update status is shown as a compact badge under the title.
- **Card navigation:** CPU and Memory cards jump to descending process lists, Disk opens Disk analysis, Battery opens System Settings, and Network opens Activity Monitor's Network panel.
- **Process list:** The high-usage process block is replaced by a larger live sample with User/System filters and distinct colors.
- **Application updates:** Applications recognizes Homebrew Cask, Mac App Store (`mas`), and Sparkle appcast sources and routes each update action to its matching updater.
- **First-load inventory:** Overview starts the application scan itself, so counts, process logos, and Memento's own icon are ready without visiting Applications first.
- **Terminal diagnostics:** Findings without safe automatic edits can still open their related shell configuration file.

---

# Memento Agent 0.7.12 - 应用更新来源与概览初始化 / Application Updates and Overview Initialization

## 简体中文

`0.7.12` 扩展应用更新来源，并让概览页面首次打开就拥有完整的应用和进程图标数据。

### 主要变化

- **应用分析：** 概览显示已安装、不常用和可更新应用数量，点击进入应用管理。
- **卡片入口：** CPU/内存卡片跳到对应降序进程列表，磁盘卡片打开磁盘分析，电池卡片打开系统设置，网络卡片打开活动监视器网络面板。
- **进程列表：** 移除“高占用进程”板块，扩展实时采样数量，支持用户/系统筛选和颜色区分。
- **应用更新：** 应用管理支持 Homebrew Cask、Mac App Store（`mas`）和 Sparkle appcast 来源，并为每个来源使用对应的更新动作。
- **首次加载：** 概览页启动应用扫描，应用分析统计、进程 Logo 和 Memento 自身图标不再依赖先打开应用管理。

## English

`0.7.12` broadens application update sources and makes Overview initialize its application inventory immediately.

### Highlights

- **Application analysis:** Overview shows installed, unused, and updateable application counts and opens Applications.
- **Card navigation:** CPU and Memory cards jump to descending process lists, Disk opens Disk analysis, Battery opens System Settings, and Network opens Activity Monitor's Network panel.
- **Process list:** The high-usage process block is replaced by a larger live sample with User/System filters and distinct colors.
- **Application updates:** Applications recognizes Homebrew Cask, Mac App Store (`mas`), and Sparkle appcast sources and routes each update action to its matching updater.
- **First-load inventory:** Overview starts the application scan itself, so counts, process logos, and Memento's own icon are ready without visiting Applications first.

---

# Memento Agent 0.7.11 - 概览分析与进程筛选 / Overview Analysis and Process Filters

## 简体中文

`0.7.11` 让概览页面成为可操作的设备入口，并补齐应用更新和终端诊断操作。

### 主要变化

- **应用分析：** 概览显示已安装、不常用和可更新应用数量，点击进入应用管理。
- **卡片入口：** CPU/内存卡片跳到对应降序进程列表，磁盘卡片打开磁盘分析，电池和网络卡片打开 macOS 系统设置。
- **进程列表：** 移除“高占用进程”板块，扩展实时采样数量，支持用户/系统筛选和颜色区分。
- **应用更新：** 应用管理增加检查更新和更新按钮；Homebrew Cask 应用在检测到安全更新来源时可直接更新。
- **终端诊断：** 没有自动修复的诊断也可以直接打开相关 shell 配置文件查看。

## English

`0.7.11` turns Overview into an actionable device workspace and adds application update and terminal diagnostic actions.

### Highlights

- **Application analysis:** Overview shows installed, unused, and updateable application counts and opens Applications.
- **Card navigation:** CPU and Memory cards jump to descending process lists, Disk opens Disk analysis, and Battery/Network open macOS System Settings.
- **Process list:** The high-usage process block is replaced by a larger live sample with User/System filters and distinct colors.
- **Application updates:** Applications adds Check updates and per-app Update actions when Homebrew Cask provides a safe update source.
- **Terminal diagnostics:** Findings without safe automatic edits can still open their related shell configuration file.

---

# Memento Agent 0.7.10 - 进程图标、终端模块与清理进度 / Process Logos, Terminal Module, and Cleanup Progress

## 简体中文

`0.7.10` 让进程、命令行启动优化和清理执行结果更容易理解和处理。

### 主要变化

- **进程图标：** 首页高占用进程会匹配已安装应用 Bundle，并按需加载对应 Logo。
- **独立终端模块：** “命令行启动优化”现在和“应用管理”“磁盘分析”处于同一级导航；清理页专注于存储和后台服务。
- **清理进度动画：** 执行批量清理时逐项展示等待、处理中、完成或失败状态，持续反馈当前进度。
- **失败处理：** 失败行会显示具体错误原因，完成后可以只重试失败的操作，不需要重新勾选整批项目。

## English

`0.7.10` makes process identity, terminal startup optimization, and cleanup results easier to understand and act on.

### Highlights

- **Process logos:** Overview process rows match sampled commands to installed application bundles and load their logos on demand.
- **Standalone terminal module:** Terminal startup optimization now sits beside Applications and Disk analysis in primary navigation; Cleanup focuses on storage and background services.
- **Animated cleanup progress:** Batch cleanup shows each item moving through waiting, working, completed, or failed states while progress advances.
- **Failure handling:** Failed rows keep their concrete error messages and can be retried as a smaller batch without selecting everything again.

---

# Memento Agent 0.7.9 - 依赖安全修复 / Dependency Security Fix

## 简体中文

`0.7.9` 修复了随应用发布的 `electron-updater` 依赖链中的 `js-yaml@4.3.0` 高危公告。

### 主要变化

- **依赖安全：** 将 `electron-updater` 和 Electron Builder 使用的 `js-yaml` 4.x 间接依赖固定到 `4.3.2`，覆盖受影响的 4.3.0/4.3.1 版本。
- **发布校验：** 运行时 `npm audit --omit=dev` 已通过，发布依赖树不再报告该高危问题。

## English

`0.7.9` fixes the high-severity `js-yaml@4.3.0` advisory in the shipped `electron-updater` dependency chain.

### Highlights

- **Dependency security:** Pin the `js-yaml` 4.x transitive dependency used by `electron-updater` and Electron Builder to `4.3.2`, covering the affected 4.3.0/4.3.1 releases.
- **Release verification:** `npm audit --omit=dev` passes, and the shipped dependency tree no longer reports this high-severity issue.

---

# Memento Agent 0.7.8 - 清理菜单与选择状态 / Cleanup Navigation and Selection State

## 简体中文

`0.7.8` 修复了清理页进入 AI 后勾选状态丢失的问题，并补齐后台服务和命令行启动项的菜单入口。

### 主要变化

- **选择状态：** 从清理项目进入 AI 解释后返回，原有勾选继续保留；返回时也恢复来源类别。
- **后台服务：** 清理菜单新增后台服务分类，可以查看扫描到的服务、启动项和对应操作。
- **命令行启动项：** 清理菜单新增命令行启动项分类，可以查看 shell 启动诊断，并直接执行带备份的可撤销修复。

## English

`0.7.8` keeps Cleanup selections across isolated AI explanations and adds visible menus for background services and terminal startup findings.

### Highlights

- **Selection state:** Returning from an item explanation preserves the checked Cleanup items and restores the source category.
- **Background services:** Cleanup now has a dedicated menu for scanned services, launch agents, and their registered operations.
- **Terminal startup:** Cleanup now exposes shell startup diagnostics and directly runs reversible, backed-up configuration fixes.

---

# Memento Agent 0.7.7 - 开发者产物与应用加载 / Developer Artifacts and Application Loading

## 简体中文

`0.7.7` 补齐了开发者项目构建产物清理，并让应用管理在扫描期间明确反馈状态。

### 主要变化

- **开发者项目产物：** 在常见项目目录中识别 `node_modules`、`target`、`build`、`dist`、`.build`、`.next`、`.turbo`、覆盖率和其他可重建产物，按项目显示大小和路径。
- **安全边界：** 最近活动目录、包含嵌套 Git 仓库或部署密钥的产物不会进入默认清理；移动到废纸篓前会重新校验项目根目录、目录类型和修改时间。
- **规则外线索：** 已注册目标的弱线索现在提供明确的“移到废纸篓”确认操作，同时仍保持规则外标签和 AI 解释入口。
- **应用加载：** 首次扫描显示阶段信息与骨架动画；已有结果刷新时继续保留当前列表，并显示紧凑进度状态；失败时可直接重试。

## English

`0.7.7` adds developer project artifact cleanup and makes application inventory loading explicit.

### Highlights

- **Developer project artifacts:** Discover `node_modules`, `target`, `build`, `dist`, `.build`, `.next`, `.turbo`, coverage, and other rebuildable outputs under bounded project roots, with project and path context.
- **Safety boundaries:** Recently active directories and outputs containing nested Git repositories or deployment key material are protected from default cleanup. The main process revalidates the project root, directory type, and modification time before moving an artifact to Trash.
- **Outside-rule clues:** Weak clues with registered targets now expose an explicit confirmed Move to Trash action while retaining their outside-rule label and AI explanation entry.
- **Application loading:** The first scan shows phase text and animated skeleton cards; later refreshes keep the current list visible and add compact progress feedback. Scan failures offer a direct retry.

---

# Memento Agent 0.7.6 - 更新安装退出修复 / Update Installation Exit Fix

## 简体中文

`0.7.6` 修复更新安装时应用没有真正退出的问题。

### 主要变化

- **菜单栏驻留兼容：** 开始更新前明确标记应用正在退出，避免“关闭后驻留菜单栏”拦截 `quitAndInstall` 的窗口关闭流程。
- **失败恢复：** 如果更新器同步抛出错误，会恢复正常窗口关闭行为并显示错误状态。

## English

`0.7.6` fixes updates that remained stuck in the Installing state.

### Highlights

- **Tray compatibility:** Mark the app as quitting before `quitAndInstall` so Keep in menu bar cannot intercept the updater's shutdown.
- **Failure recovery:** Restore normal window-close behavior when the updater throws synchronously and expose the error state.

---

# Memento Agent 0.7.5 - macOS 磁盘容量一致性 / macOS Disk Capacity Alignment

## 简体中文

`0.7.5` 让概览中的磁盘可用空间尽量跟随 macOS 系统口径。

### 主要变化

- **系统容量口径：** 使用 macOS 原生宗卷容量估算，包含系统可按需释放的可清除空间。
- **显示格式：** 磁盘容量改用十进制 GB，并明确标注包含 macOS 可清除空间。
- **回归覆盖：** 增加容量解析器、文档和四视口 UI 冒烟断言。

## English

`0.7.5` brings Overview disk availability closer to the macOS system view.

### Highlights

- **System capacity:** Read macOS native volume capacity estimates, including space macOS can purge when needed.
- **Display format:** Use decimal GB for disk capacity and explain that purgeable space is included.
- **Regression coverage:** Add capacity parser, documentation, and four-viewport UI smoke coverage.

---

# Memento Agent 0.7.4 - Agent 进程操作 / Agent Process Actions

## 简体中文

`0.7.4` 补齐了从概览进程询问 AI 到结束进程的确认操作，并优化了 Top 5 饼图。

### 主要变化

- **Agent 进程操作：** 询问具体进程后，Agent 结果显示“退出进程”和“强制退出进程”两个需要确认的操作，不再把进程问题误配成应用打开或卸载。
- **主进程复核：** 进程操作使用实时 PID、所有者和命令路径重新校验，系统进程和其他用户进程不会注册为可执行操作。
- **饼图：** CPU 和内存 Top 5 饼图尺寸增大，移除图形内部的 TOP 文案。

## English

`0.7.4` completes the focused process workflow from Ask AI to confirmed termination and improves the Top 5 charts.

### Highlights

- **Agent process actions:** Asking about a specific process now renders separate confirmable Quit process and Force quit process actions instead of unrelated application Open or Uninstall actions.
- **Main-process revalidation:** Process operations recheck the live PID, owner, and command path; system and other-user processes never become executable operations.
- **Pie charts:** CPU and memory Top 5 charts are larger and no longer place a TOP label inside the graphic.

---

# Memento Agent 0.7.3 - 稳定进程交互 / Stable Process Interaction

## 简体中文

`0.7.3` 解决了实时刷新导致进程行和操作菜单移动的问题。

### 主要变化

- **稳定操作目标：** 鼠标或键盘焦点进入高占用进程列表后，暂存当前进程顺序和数据；刷新继续更新页面其他状态，但不会移动当前操作入口。离开列表后恢复实时数据。
- **回归覆盖：** 四视口 UI 冒烟测试验证操作菜单跨刷新周期保持打开。

## English

`0.7.3` fixes process rows and action menus moving while live monitoring refreshes.

### Highlights

- **Stable targets:** When the pointer or keyboard focus enters the high-usage process panel, the current process order and values are held while the rest of the Overview keeps refreshing. Live process data resumes when focus leaves the panel.
- **Regression coverage:** Four-viewport UI smoke coverage keeps an action menu open across a refresh interval.

---

# Memento Agent 0.7.2 - 进程监控 / Process Monitoring

## 简体中文

`0.7.2` 扩展了概览中的高占用进程工作流，让用户可以比较资源占用、了解进程并在安全边界内处理自己的进程。

### 主要变化

- **排序与图表：** 高占用进程支持按名称、CPU、内存排序，并新增 CPU 和内存 Top 5 饼图。
- **进程操作：** 可询问 AI、复制进程名称或 PID；非系统进程可选择退出或强制退出。主进程会在执行前重新读取 PID、所有者和命令路径，系统进程与其他用户进程保持保护。
- **回归覆盖：** demo、preload、真实 Electron 和四视口 UI 冒烟测试覆盖了新增进程界面。

## English

`0.7.2` extends Overview's high-usage process workflow so users can compare resource use, understand a process, and act on their own processes within a protected boundary.

### Highlights

- **Sorting and charts:** Sort high-usage processes by name, CPU, or memory and view CPU and memory Top 5 pie charts.
- **Process actions:** Ask AI, copy a process name or PID, and gracefully or force-quit non-system processes. The main process re-reads the PID, owner, and command path before execution; system and other-user processes remain protected.
- **Regression coverage:** Demo, preload, real Electron, and four-viewport UI smoke tests cover the new process surface.

---

# Memento Agent 0.7.1 - 确定性清理 / Deterministic Cleanup

## 简体中文

`0.7.1` 把“信任重置”落实到新的 macOS 主界面与清理闭环：规则负责发现和执行，AI 只在用户需要时解释结果。

### 主要变化

- **四个主模块：** 主导航收敛为“概览、清理、应用管理、磁盘分析”。概览显示实时硬件和进程指标，磁盘容量浏览不再混入清理规则列表。
- **规则优先：** 扫描与执行共用一个规则注册表，明确标记系统、应用、浏览器、开发工具、日志和设备分类；规则路径、最低体积、风险和是否可执行不再分散维护。
- **覆盖更完整：** 增加浏览器、Electron 应用、Python、Go、Rust、Android、Maven、Xcode、AI 客户端和系统诊断规则；完整测量合格应用缓存，并发现第三方 Sandbox 与 Group Container 中受限的缓存目录。
- **安全批量清理：** 安全项默认选择但仍需一次确认；需要确认项由用户主动选择；规则外弱线索不能执行。批量操作只移除实际成功的结果，失败项保留供检查。
- **AI 锦上添花：** AI 只作为每个清理项的解释入口，不参与规则匹配、空间统计、默认选择或执行授权。
- **执行保护：** 动态目标仅允许固定层级的缓存或临时目录，Apple 与凭据类容器受保护，目录本身及其祖先中的符号链接都会被拒绝。
- **实机结果：** 当前开发 Mac 的可信可释放空间由约 26.1 GB 提升到 44.6 GB，完整扫描仍约 9 秒。

## English

`0.7.1` carries the trust reset into the primary macOS workspace and cleanup loop: rules own discovery and execution, while AI explains findings only when requested.

### Highlights

- **Four primary modules:** Navigation is centered on Overview, Cleanup, Applications, and Disk analysis. Overview shows live hardware and process metrics, while disk-capacity browsing remains separate from cleanup rules.
- **Rules first:** Discovery and execution share one registry with explicit System, Applications, Browsers, Developer, Logs, and Devices categories. Paths, thresholds, risk, and action eligibility no longer drift between scanners and executors.
- **Broader measured coverage:** Adds browser, Electron app, Python, Go, Rust, Android, Maven, Xcode, AI-client, and system-diagnostic rules; measures every eligible application cache and bounded third-party Sandbox/Group Container cache folder.
- **Safe batch cleanup:** Safe items are preselected but still require confirmation. Review items are opt-in and weak outside-rule clues are not executable. Batch reconciliation removes only operations that actually succeed.
- **AI as enhancement:** AI remains a per-item explanation action and does not control rule matching, size estimates, default selection, or execution authorization.
- **Execution protection:** Dynamic targets are limited to exact cache or temporary-directory depths. Apple and credential identities are protected, and targets with symbolic-link ancestors are rejected.
- **Real-device result:** Trusted reclaimable coverage increased from about 26.1 GB to 44.6 GB on the development Mac while the complete scan remained around nine seconds.
