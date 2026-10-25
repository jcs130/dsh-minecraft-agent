# Registry 分发记录

## rc.20：目标恢复、新会话、生存资料与可视化（GitHub 已公开，npm 待发布）

[rc.20 Release](https://github.com/jcs130/dsh-minecraft-agent/releases/tag/v0.3.0-rc.20) 与[核心 rc.87 Release](https://github.com/jcs130/minecraft-ai-friend/releases/tag/agent-mc-world-v0.5.7-rc.87) 已公开，匿名下载归档与已验收字节完全一致。插件 SHA256 为 `12410168f9d37057e4bd64475f756c3cf525f2d11323147e877f837309500481`，核心为 `8b5da0a1c0ab27758521da4676accdce7a2d29ff7add8ba4085898b0df33a286`。目标／会话修复合并提交 `b9af814cc637bde33291244dd1e4bc7d73278ee0`；可视化部分此前已合并。见[公开分发证据](github-publish-rc20.json)。

配置目标只在连接／重载时检查：没有目标，或 complete／blocked／paused 的旧目标文案不同，才用官方目标服务建立新目标；paused／blocked 先 clear 并持久化。active 目标不被替换，相同文案的终止目标不自动重建，同一会话的 `sessionKey` 不变。另提供独立的新会话与重置入口，保留账号、人设、皮肤、凭据、笔记及旧历史。Agent 可按需使用已有知识、步骤脚本和历史经验，未打包完整 MineDojo Wiki。详见[修复说明](goal-session-reset.md)、[资料入口](survival-decision.md)及[网页资源与聊天](viewer-resources-chat.md)。

官方 DSH rc.2／rc.3 各 148 项通过、1 项既有外置 Harness2 可选跳过。隔离归档正常 npm 解析、15 个插件运行文件与源码一致，两个官方主进程／Worker、37 个 MCP 工具、离线引擎 IPC、记忆和打包后的原生目标日志通过；可选千灯纪包共用一份核心。核心沿用本轮 2068 项通过、1 项既有跳过及构建／声明／浏览器检查。本次无模型调用、真实游戏连接或现役重载，不声称已经测出长期自主收益。

**npm rc.20 与核心 rc.87 仍为 404，公开 registry 的默认 DSH 安装未验证；npm latest 和市场仍为已公开 rc.19。**GitHub 发布不等于 npm 发布或市场同步。发行归档保持原字节；本次只更新主干分发记录，不重新打包同一版本。包内 `publication` 保留为构建时快照。

## rc.19：角色配置、服务器笔记与原版 1.21.11 画面（npm / GitHub 已公开）

[rc.19 Release](https://github.com/jcs130/dsh-minecraft-agent/releases/tag/v0.3.0-rc.19) 和 npm 均可匿名下载，latest 指向 rc.19。主干功能合并 6e283ee2b5abf0974196094e2e1c71f05b738ce2；归档 SHA256 为 4929569a578b78a3e4a797a99ff7ddb28381010c1945098336c831a710f5cc1e，与候选完全一致。核心 rc.86 的归档 SHA256 为 350684246704cac0eed997bd1f801b924bb18fb462e51f52eaf0926cef3fa9f0，next 指向该版。公开分发与默认安装证据见 [npm-publish-rc19.json](npm-publish-rc19.json)，包内候选状态保留为构建时快照，不重新打包或覆盖同一版本。

新界面支持预设/自定义人格、本地 PNG 皮肤、默认关闭的矿物查询、版本化服务器笔记、离线 CPU 词元向量与关键词检索及自有 embeddings；通过官方能力预设接入其他 DSH 插件。默认只开放游戏工具，选定预设后沿用其工具策略。记录明确区分主人报告、历史和现场事实。皮肤只影响本人网页画面，不修改服务器身份；CPU 词元向量不是神经语义模型。包含未独立发行的 rc.18 网页画面、1.21.11 自动版本和公屏默认修复。

核心 2065 项通过、1 项既有跳过，构建/类型/公开声明通过；官方 DSH 两版各 133 项通过、1 项外置 Harness² 可选跳过。此前的隔离 1.21.11 原版服已验证皮肤、笔记增改/检索/重启恢复及插件工具互通。本次两版均用默认 pnpm 从公开 registry 安装，保留安全保护，无 override、手动软链接或宿主修补；真实主进程/Worker、SDK/MCP、编译引擎 IPC、游戏记忆通过，千灯纪包 rc.22 共用同一物理核心。无外部模型调用或现役重载；原生 Desktop 窗口、真实模型长期游戏表现和自动学习收益未由本次分发检查证明。


## rc.19 首次 GitHub 分发阶段（历史记录）

以下保留首次 GitHub 分发时的状态，当时 npm 尚待认证；后续 npm 发布结果见本页上方的新记录。

[rc.19 Release](https://github.com/jcs130/dsh-minecraft-agent/releases/tag/v0.3.0-rc.19) 已公开，匿名归档 SHA256 为 `4929569a578b78a3e4a797a99ff7ddb28381010c1945098336c831a710f5cc1e`，与验收候选字节一致。精确核心 rc.86 已在 npm 与 GitHub 公开，next 指向 rc.86；可选服务器包保持 rc.22。功能合并提交为 `6e283ee2b5abf0974196094e2e1c71f05b738ce2`。公开验收见 [github-publish-rc19.json](github-publish-rc19.json)。

官方 DSH 0.2.1-rc.2 / rc.3 均通过默认 pnpm 从公开 GitHub 地址安装，保留保护，无 override、手工软链接或宿主修补。真实主进程/Worker、37 个 MCP 工具、独立引擎 IPC、游戏记忆与物理初始化通过，共用一份核心；本次分发检查的外部模型调用和游戏连接均为零。前期核心 2065 项通过、1 项既有跳过，DSH 两版各 133 项通过、1 项外置 Harness² 可选跳过；隔离 1.21.11 原版服另已验证皮肤、笔记和插件互通。原生 Desktop 窗口、自动学习收益和长期自主游戏未由分发检查证明。

新增可编辑人设、本地预览皮肤、默认关闭的矿物查询、版本化服务器笔记、离线 CPU 词元向量/关键词和自有 embeddings 配置，通过官方预设接入其他 DSH 插件。包含 rc.18 的 1.21.11 画面、auto 协议与公屏默认修复。CPU 词元向量不是神经语义模型；皮肤不修改服务器身份。

npm 插件的独立网页认证等待返回 E404，未成功提交 rc.19，npm latest 与市场继续保持 rc.17。当前可用固定 GitHub 归档安装；完成新的 npm 认证和匿名安装核验后再更新 npm 与市场。旧失败证据保留，现役服务不因发布重载。发布归档不重打包，包内候选状态是构建时快照。

## rc.17：AuthMe 请求、成功回执与超时诊断（npm / GitHub 已公开）

PR #7 已合入 main，合并提交 `ac6456460ad641a802674a3123a6d99e6f6af3ea`。插件 `0.3.0-rc.17` 精确依赖已公开的共享核心 `0.5.7-rc.84` 与可选千灯纪包 `0.5.0-rc.22`。核心登录修复提交 `f8c09b2436f9a2ef04da3924ad5fccd715553475` 保留在主干。

[rc.17 Release](https://github.com/jcs130/dsh-minecraft-agent/releases/tag/v0.3.0-rc.17) 与 npm 均可匿名下载，归档 SHA256 为 `768dfd8fbd096667285803a63c5bd6ef7431c8a9e51d831a79606f28e70113cb`，与经过测试的候选字节完全一致，npm latest 指向 rc.17。[最终 registry 验收](https://github.com/jcs130/dsh-minecraft-agent/releases/download/v0.3.0-rc.17/npm-registry-verification.json)和[公开 GitHub 下载验收](https://github.com/jcs130/dsh-minecraft-agent/releases/download/v0.3.0-rc.17/github-release-verification.json)分别留存。归档内的候选文档为构建时快照，不覆盖或重新打包同一版本。

rc.16 因默认安装产生两份核心而未发布。rc.17 消费服务器包 rc.22 的 peer 核心契约，默认安装共用宿主核心。旧候选和失败证据保留。

已有密码配置可续用，修复可信系统提示中的 /login 请求、标准成功和会话续用回执；不自动注册。超时文本区分未识别请求、凭据读取中和已提交等待确认。详见[AuthMe 登录说明](authme-login.md)。首次配置、游戏画面、原生推理与工具会话和实验页均保留；前端运行文件与 rc.15 完全相同。

登录修复在核心 rc.83 的 2035 项回归通过、1 项可选跳过；当前消费 rc.84，服务器端 276 项与类型检查通过。官方 DSH 0.2.1-rc.2 / rc.3 各 125 项通过。两版均从匿名 npm 公开版本完成默认 pnpm 安装与真实主进程/Worker 验证，加载 37 个 MCP 工具，独立引擎 IPC、游戏记忆和物理试验初始化通过，共用同一物理核心。未覆盖宿主、手工软链接或关闭包管理器保护。Java 1.21.1 协议测试使用真实私有配置走 SDK/MCP，模拟 AuthMe 首次登录和会话续用；未启动实际 AuthMe/Paper 插件，未验证实服游玩或 Desktop 原生像素，没有外部模型调用和现役重载。

## rc.15：首次配置与原生决策会话（npm / GitHub 已公开）

PR #6 已合入 main，合并提交 `2d5d9087f5ba02f259c8eec38ce4ee784289941a`。[rc.15 Release](https://github.com/jcs130/dsh-minecraft-agent/releases/tag/v0.3.0-rc.15) 已公开，主归档 SHA256 为 `aad91e1c34f3f67f782200e6f1a63c10355a26860a62636558389714be8b18b0`，与先前 candidate06 验证包字节一致。匿名 HTTPS 下载、官方 DSH 0.2.1-rc.2 / rc.3 默认 pnpm 11.28.5 从公开 URL 安装均通过，运行文件哈希一致。最终验收见 [github-release-verification.json](https://github.com/jcs130/dsh-minecraft-agent/releases/download/v0.3.0-rc.15/github-release-verification.json)。

安装后从侧栏 Minecraft 填服务器地址、角色名和认证方式，复用 DSH 默认模型与思考等级。通用离线服务器不需要密码；仅明确要求 `/login` 的已有账号配置可选密码。初始任务可以留空，只连接身体。端口自动分配，账号数据、原会话和停止意图保存在当前 profile；高级 configFile 路径继续独立工作。

侧栏游戏旁使用官方 DSH 的原生会话、推理和工具组件，保留当前身体的已有 session，不切换其他会话、不创建另一个 Agent。模型未返回推理时不补写。侧栏新增游戏 + 决策、只看游戏和只看决策布局；原会话标签保留游戏与宿主输入框，使用原生“对话”标签查看决策，避免递归嵌入。通用游戏页面与渲染继续由独立核心和 mc-visual-console 提供。

候选通过原始官方 DSH 0.2.1-rc.2 和 0.2.1-rc.3 的默认 pnpm 归档安装，回归包括原生 SlotCore、真实主进程/Worker、SDK/MCP、独立 Harness² 物理试验、所有者认证、停止持久化、账号隔离、损坏配置拒绝恢复和原会话的嵌入边界。UI 验收还发现并修复了重复槽位声明、原会话递归渲染与宿主启用后身体仍继承停用默认值的问题；旧失败证据保留。最终计数见候选验证记录。

官方 DSH Web 与独立的本机 Java 1.21.1 协议测试世界完成无密码首次接入、只读工具调用、同账号重连与原会话保留。确定性的本机测试 provider 验证流式推理、工具回执和布局切换；这些文字与合成用量仅用于界面验收，不能用来证明真实模型游戏能力、缓存收益或线上反应速度。未调用外部模型，未变更现役 Agent。Desktop 原生窗口、微软首次授权交互和真实服务器游玩仍单独验收。

两版 DSH 各 123 项全量回归通过，零失败、零跳过。2026-10-24 01:08（Asia/Shanghai）完成 npm 登录与本次发布认证，CLI 返回 0；版本曾短暂处于 Validating，匿名接口返回 404。01:12 的复查已得到 200，`latest` 指向 rc.15，归档 SHA256 与 GitHub 完全一致。随后官方 DSH 0.2.1-rc.2 / rc.3 均通过默认 pnpm registry 安装、真实主进程/Worker、36 个 MCP 工具、离线编译引擎 IPC、游戏记忆与物理试验初始化；依赖共享同一个核心。没有放宽包管理器保护、覆盖宿主文件或调用外部模型。[npm 最终分发验收](https://github.com/jcs130/dsh-minecraft-agent/releases/download/v0.3.0-rc.15/npm-registry-verification.json)与[提交阶段历史](npm-publish-rc15.json)分别保留。自有市场索引已更新为 rc.15，社区 PR18 单独待审核。归档不覆盖、不重打包；包内 README 和状态文件为构建时快照，当前公开状态以本记录及 Release 附件为准。用法见[快速接入](quick-start.md)。

## rc.14：常驻 UI 入口（未发布）

核对匿名 npm rc.12 归档后确认，浏览器入口和面板后端均有分发，并未删除 UI。原入口只注册在 conversation.view，空白会话不渲染这个区域。rc.14 保留该标签，并通过官方 main/sidebar.panellist 槽位增加常驻 Minecraft 入口；未绑定时显示说明，可显式重新检查。只读面板发现沿用 DSH Connection 的所有者认证，返回已绑定会话与本机面板地址，不返回凭据或触发游戏、模型与远程网站查询。

本轮只验证独立候选，不覆盖先前 rc.13 归档，也不改写现役 profile 或启动已停用的鸣人。npm、市场和实际部署状态须分别记录。

隔离的归档消费端通过 107 项回归，1 项需要外置 Harness² 环境的可选实测跳过。包含真实官方 DSH 主进程/Worker、SDK/MCP、离线引擎 IPC、面板发现的所有者认证、其他会话拒绝和卸载后路由释放。官方 DSH 0.2.1-rc.2 的实际 Chromium 页面已见侧栏入口，并切换同一内嵌核心的游戏空态、连接与账号、系统一/系统二和实验室；无身体配置的另一 profile 也显示配置说明与可用的重新检查按钮。1280×720 外层没有横向溢出。所有画面均为明确标注的离线夹具，未调用外部模型、连接游戏或验证 Desktop 原生窗口。

随后按新用户流程补验：官方 DSH 0.2.1-rc.2 与 0.2.1-rc.3 分别从空白 Web profile 使用 `dsh plugin add <候选归档> --registry=https://registry.npmjs.org` 安装，默认 pnpm 11.28.5 保护保留，无手工软链接、依赖 override 或宿主修补。DSH 自身生成两个精确的新包年龄排除项，没有人工关闭检查。两种实际安装均已在 Chromium 中见到常驻 Minecraft 入口，rc.3 还核验内嵌核心及实验室。补齐独立的 Harness² worker 后，两版各 108 项全量回归通过，零失败、零跳过；外部模型调用、真实游戏连接和线上技能采用均为零。

默认本机镜像安装曾因 npmmirror 尚缺核心 rc.69 失败，保留失败证据，安装指引改为显式官方 registry。候选内没有本机部署路径、凭据形状或私有运行日志。此次是归档安装及公开依赖下载验证，适配器 rc.14 自身的匿名 npm 安装仍需正式发布后另验，市场保持公开 rc.12；Desktop 原生窗口仍未验收。

## rc.13：邀请接入

本轮将 PR #4 的邀请接入发布为 rc.13，锁定核心 rc.69 和中立千灯纪包 rc.13。复用官方身份模块，新增本机 `dsh-minecraft-join` 命令、原身份查询、严格建号与角色绑定、新绑定的首次连接确认，以及分别展示 API/游戏就绪的 DSH 原生前端。模型、人格、会话和记忆配置继续由宿主保留。

发行准备已核验源代码提交与不可变归档；核心 1884 项测试通过（1 项可选跳过），服务器 271 项通过，DSH 候选 107 项无跳过通过。实际 npm 发布、无 override 的默认 pnpm 安装、PR 合并及市场同步的最终状态将记录在独立发布校验文件中。旧版记录继续保留；本轮不重启现役 Agent 或创建真实游戏账号。

## rc.12：直接兼容官方 DSH

本仓库的官方 format-1 发现索引已恢复为固定 npm rc.12；社区市场 [PR18](https://github.com/ydhrdh/dsh-marketplace/pull/18) 已更新为该版本并转为待审核。本地 registry 校验和 Web 构建通过，`verified` 保持 false，由社区维护者审核；提交不代表已收录。

npm rc.12 已公开，`latest` 指向该版；匿名下载与 GitHub 的归档字节、SHA256、SHA512 完全一致。默认 pnpm 11.28.5 从 registry 安装后，原始官方 DSH 主进程/Worker、36 个 MCP 工具、离线引擎 IPC、游戏记忆和面板会话权限验证均通过。[最终 registry 校验记录](https://github.com/jcs130/dsh-minecraft-agent/releases/download/v0.3.0-rc.12/npm-registry-verification.json)。发行归档保持原字节，不重新打包同一版本。此前认证失败、GitHub 先行发布和包内发布标志保留为带时间的历史快照。

适配器 `0.3.0-rc.12` 保持核心 `0.5.7-rc.64`、可选千灯纪包 `0.5.0-rc.10`，新增精确的 `readable-stream@4.8.0` 宿主依赖。在异步导入 SDK 前同步选择依赖支持的 Node 原生流，并恢复原环境；无需用户修改 DSH 主程序或 Worker，不动 Cortico、通用 Minecraft 能力或现役进程。

全新 registry npm 消费端：97 项全量回归通过，包含外置 Harness² 集成和市场解析。新增真实未修补 DSH 回归先复现旧错误，再验证两个独立入口、SDK/MCP、离线引擎 IPC、游戏记忆、千灯纪包、物理练习及启用了官方解析器的 Worker。前后宿主文件 SHA256、解析器引用和环境一致。后续默认 pnpm、公开分发、面板与实验验收见 `candidate-sources.json`，发布制品与源码状态分别记录。候选尚未公开时不将版本号或上传成功当成匿名可下载证明。

维护者可用 `node scripts/verify-installed-core.mjs "<实际 profile 绝对路径>" --require-server-pack` 检查依赖。真实 stock fixture 支持 `MC_DSH_PROFILE=<隔离 profile>`；不使用修补过的宿主当作直接兼容证据。Desktop 原生像素和实服效果未由离线测试认证，当前任务不加载现役服务。

## rc.11 历史记录

下面保留先前分发、失败、修复与等待记录。其手工 doctor 要求不再适用于 rc.12。

当前制品：适配器 rc.11，精确依赖已公开的核心 rc.64、可选千灯纪包 rc.10。核心已通过 npm 与 GitHub 匿名下载，字节和完整性相同。无 override 的默认 pnpm 安装、新的 registry 消费端 92 项回归、实际 profile/客户端/RPC 验收通过；生产依赖只有一份核心，没有 tsx/esbuild。DSH 0.2.1-rc.2 必须先进行文档中的显式解析修复，安装不自动修改宿主。适配器已在 npm 的 next 标签和 GitHub 公开；两处匿名归档 SHA256 均为 `6b915d84fb5a83b59f10333798560a6a0c6326b51983c805656e30bc75fcf55d`。公开 npm 的完整安装、同一物理核心和实际面板/RPC 均通过，见[发布校验记录](https://github.com/jcs130/dsh-minecraft-agent/releases/download/v0.3.0-rc.11/release-verification.json)。发行归档保持原字节；本次只更新源码中的发布状态与证据，不重新打包同一版本。

pnpm 对刚发布依赖自动添加了两个精确 minimumReleaseAgeExclude 条目，这是官方默认行为；没有手动关闭新包年龄检查、构建脚本保护或 exotic 子依赖保护。维护者可在源码中执行 `node scripts/verify-installed-core.mjs "<实际 DSH profile 绝对路径>" --require-server-pack` 检查两个包使用同一物理核心。

下面保留阶段记录，包括已失败的旧包组合、临时 override 验证和认证等待，不能将它们误作最终分发状态。

2026-10-21 当前候选为 `0.3.0-rc.11`，精确锁定核心 `0.5.7-rc.64`。已修复生产依赖带入 tsx 构建脚本的问题，并提供覆盖 DSH 0.2.1-rc.2 主入口/Worker 的显式解析修复及回滚。核心源码已合入；完整核心和宿主回归、无 tsx 的真实引擎 IPC、Python 模拟器及 Harness² 离线链路通过。见 [本轮记录](core-update-20261021.md)。

默认 pnpm 11.28.5 的真实插件安装及修复后的实际 profile/面板验收通过。第一次使用未公开核心归档的临时 YAML override，未绕过构建脚本或 exotic 子依赖保护，不能当作公开 registry 下载证明。发布按以下顺序单独留证：核心相同字节上传、匿名读取元数据并下载比对、无 override 的全新消费安装、插件打包与公开、再从公开源实际安装。

包内本页与 `candidate-sources.json` 是打包时快照；实时公开状态以 [rc.11 Release](https://github.com/jcs130/dsh-minecraft-agent/releases/tag/v0.3.0-rc.11) 的制品校验记录为准。npm 上传返回成功不等于匿名用户已能下载，处理中不提前发布依赖它的插件。官方旧 DSH 仍需[显式兼容步骤](DSH-COMPAT.md)；市场索引、官方修复发行、Desktop 原生画面和线上效果继续分别记录，不冒称默认 GUI 已验收。

2026-10-21 20:42（Asia/Shanghai）：核心 rc.64 已在 [GitHub Release](https://github.com/jcs130/minecraft-ai-friend/releases/tag/agent-mc-world-v0.5.7-rc.64) 公开，匿名下载与已核验归档的字节、SHA256、SHA512 完全一致。npm 的账号登录有效，但该包发布要求独立网页认证，进程正在等待操作员完成；匿名 registry 查询仍为 404。插件尚未在 npm/GitHub 发布，默认无 override 的 registry 安装尚未验收，主分支和市场保持原状态。

随后该次 npm 网页认证等待返回 404，未完成发布；旧认证页面不能复用。后续发布必须重新取得官方认证页，并在匿名 registry 校验通过后继续依赖发布。

## rc.10 历史记录

此前 `0.3.0-rc.10` 按当时指令只同步源码和验证，核心 rc.61 未公开，官方 DSH 解析问题仍可复现；该阶段没有发布、市场更新或现役加载。新一轮修复与发布授权不改写以下历史证据。

## rc.9 历史验收与发布阻塞

本页记录 rc.9 的分发修复与验收顺序，包内文档是打包时快照；实际公开发布状态以 [GitHub Release](https://github.com/jcs130/dsh-minecraft-agent/releases/tag/v0.3.0-rc.9) 的验证记录为准。源码提交、npm/GitHub 发布、默认 DSH 安装、Desktop 画面及现役加载分别记录。不要在聊天、仓库或 profile 中保存 npm token。

2026-10-21 发布进度：核心 agent-mc-world@0.5.7-rc.57 已公开发布到 npm，匿名下载与 GitHub 归档的字节、SHA256 和 dist.integrity 一致。适配器 rc.9 的全新依赖安装、83 项常规宿主测试及单独的真实 Harness² 物理/本地协议测试已通过；实际安装/加载验收发现新的框架兼容阻塞，rc.9 尚未在 GitHub 或 npm 发布，市场 PR18 和发现入口继续暂缓。

实际阻塞：[DSH 子路径解析记录](upstream/dsh-profile-resolver.md)。不加参数的 Git 与归档安装均报告 ERR_PNPM_IGNORED_BUILDS（esbuild@0.28.2）；加 --ignore-scripts 的 Git 安装与 TypeScript 子进程烟测通过，没有执行安装脚本。官方 DSH 在加载 readable-stream 的 process/ npm 依赖时仍抛出 TypeError。隔离修补 app-boot 后，所有者 200、其他会话拒绝、delegate 403、卸载 404 均通过；该副本不等于官方 DSH 已兼容。没有自动应用补丁，也没有修改现役框架。

rc.8 的 npm 干净安装能够通过，但真实 `dsh plugin add` 在默认 pnpm11 下报告 ERR_PNPM_EXOTIC_SUBDEP，原因是核心的 GitHub URL 子依赖。官方 Desktop 0.2.1-rc.2 源码锁定 pnpm11.28.5。本次修复把核心依赖改成 registry SemVer 0.5.7-rc.57，并检查完整锁文件均来自 registry.npmjs.org；不关闭 blockExoticSubdeps，不加宽泛 allowBuilds，不降级包管理器。

核心的已验证 tgz 保持不变：SHA256 317ff114bf73dc2570009ff1e6cacf4127bd9020b430d413ae27bbfa306b59a1，来源提交 e4f18f6ecd4e28a6d3ad7b2657514b8aec959a3a。npm 与 GitHub 必须使用相同字节，不能用重新打包的制品覆盖原版本。

发布与安装的验收顺序：

1. `npm whoami --registry=https://registry.npmjs.org` 确认当前账号；读取现有维护者权限，沿用已验证的核心 tgz 发布到 next 标签，不重新生成不同的核心字节。
2. 从 npm 读取 agent-mc-world@0.5.7-rc.57 的 dist.integrity，核对为 sha512-hdsCyamWN6+ZW1IpKCrGQLzBsMsqVaNlR3Fr7hM3w6T744ZcpfOQL8ki//5D4rMyvgGV15Geg1Zldky0N4ka6A==。
3. 在全新目录进行 registry-only npm ci、完整宿主测试、安装包检查与一次可选 Harness2 本地协议/物理验证。准备阶段复用旧安装目录的离线测试不能当成这一步的通过证据。
4. 更新 candidate-sources 中的实际 registry 验证状态，再打包并发布 @jcs130/dsh-minecraft-agent@0.3.0-rc.9 至 next 标签；发布与 tag/源码、哈希分别记录。
5. 使用隔离 DSH_HOME、Node24 和官方匹配的 pnpm11.28.5，在默认保护下实际执行 dsh plugin add，确认 bundle patch、客户端入口与会话绑定；保持安装不启动模型或身体。
6. 默认安装验收完成后，再移除 rc.8 安装阻塞提醒、恢复市场索引为 rc.9，更新社区 PR18 的条目/生成索引并转为待审核。原生 Desktop 窗口像素验收仍需可用的桌面浏览器通道，不能由协议测试代替。

市场 PR：https://github.com/ydhrdh/dsh-marketplace/pull/18，由维护者审核；提交或转为待审核都不等于已上架社区主索引。rc.8 Release 保留原失败与阻塞说明，新的预览版完成安装验收后再更新当前发现入口。现役 Agent、模型、World 和客户端不因发布重载。
