# 插件市场与桌面安装

核对日期：**2026-10-26（UTC+8）**。当前 npm 版本是 `@jcs130/dsh-minecraft-agent@0.3.0-rc.24`，精确依赖核心 `agent-mc-world@0.5.7-rc.99`。市场收录、审核、索引刷新和 npm 发布分别记录。

本次仅更新 npm、GitHub 和自有索引。社区 PR 审核及缓存为上次观察，尚未据本次发布重新核实；不能把其旧版信息当作 rc.24 已收录。

## 当前入口

| 入口 | 当前状态 | Desktop 使用方式 |
| --- | --- | --- |
| [npm](https://www.npmjs.com/package/@jcs130/dsh-minecraft-agent) / [GitHub Release](https://github.com/jcs130/dsh-minecraft-agent/releases/tag/v0.3.0-rc.24) | rc.24 已公开并通过默认 registry 安装验证。 | 应用内「插件 → 添加插件」，输入精确 npm 包名。 |
| [自有 format-1 索引](https://raw.githubusercontent.com/jcs130/dsh-minecraft-agent/main/market/index.json) | 当前提供 rc.24，使用官方 DSH 校验器验证过索引和安装目标。 | 在「插件 → 发现 → 管理索引源」添加此 URL；未启用 Discover 的版本先启用 Custom plugin markets。 |
| [awesome-dsh-plugin / dsh-market](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/9451) | **新投稿 #9451，待维护者审核**。提交前检查通过。 | 多个桌面发行版使用此目录，dsh-market 明确支持官方 Desktop；合并并同步前不能称为已上架。 |
| [DSH Marketplace](https://dshmarketplace.dev/zh/submit) | **已通过网页提交，页面确认进入人工审核队列**；本轮公开 API 尚未返回本插件。 | 该站提供 DSH format-1 索引，记录被收录后再由市场同步。 |
| [bradeGithub / DSH-Plugins-Marketplace](https://github.com/bradeGithub/DSH-Plugins-Marketplace) | **已在实际 registry.json 查到**本仓库及正确 scoped npm 包名；缓存版本仍为 rc.21，等待其定时扫描。 | 市场支持 Desktop，并通过宿主插件管理器安装 bundle；无需再提重复收录 PR。 |
| [YELEBAI / dsh-plugin-marketplace](https://github.com/YELEBAI/dsh-plugin-marketplace/pull/34) | 已被自动发现；当前索引只有 Web。**新 PR #34** 补充 Desktop 范围和经过验证的 npm 来源，待审核。 | 合并及下一轮扫描后才会进入 Desktop 筛选。 |
| [ydhrdh / dsh-marketplace](https://github.com/ydhrdh/dsh-marketplace/pull/18) | 之前的 **PR #18 仍开放**，内容已更新到 rc.22；未重复投稿。 | 审核合并后可从该社区市场检索。 |

不同市场可能消费同一个目录，不能把一个目录的多个镜像算成多次独立审核。以上均为各自维护的社区入口，不代表 DeepSeek 官方背书。

## 安装

在 **Desktop 应用内**的插件管理中安装：

```text
@jcs130/dsh-minecraft-agent@0.3.0-rc.24
```

registry：`https://registry.npmjs.org`。不必等待社区审核，也无需同时安装多个市场。不要用普通 CLI 向 Desktop 专用 profile 强行安装；[完整桌面说明](desktop.md)。

Web / CLI 用户：

```sh
dsh plugin --profile web add @jcs130/dsh-minecraft-agent@0.3.0-rc.24 --registry=https://registry.npmjs.org
```

安装完成后配置 DSH 模型，在 Minecraft 侧栏填写服务器和角色再连接。安装本身不会启动游戏或推理。协议通常使用 auto；普通离线服无需密码，正版授权及服务器特定账号激活按相应流程完成。

## 展示资料与验证

仓库具有 `dsh-plugin`、`deepseek-harness` 等主题、公开 MIT 协议和非空简介。根目录 `screenshots.json` 列出六张截图，真实线上 3D 观战排在前两张；后续是明确标注来源的 DSH 集成测试及配置截图。详见[截图来源](screenshots/README.md)。

官方 DSH 0.2.1-rc.2 / rc.3 的默认 pnpm 安装、主进程／Worker、38 个 MCP 工具及本地知识库查询通过，见 [rc.24 npm 验证](npm-publish-rc24.json)。本轮还用 YELEBAI 市场本身的校验器重新验证公开 npm 归档的完整性、bundle patch 与 host/client 入口。添加 Desktop 发现范围不会关闭安装审批；无法验证的 npm 版本仍走引导安装。原生 Desktop 窗口画面尚未实测。

参考各市场的公开机制：[dsh-market Desktop 与收录说明](https://github.com/dsh-market/dsh-market#readme)、[awesome 投稿要求](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)、[DSH Marketplace 投稿](https://dshmarketplace.dev/zh/submit)、[bradeGithub 自动索引](https://github.com/bradeGithub/DSH-Plugins-Marketplace#插件作者如何被收录)、[YELEBAI 安装策略](https://github.com/YELEBAI/dsh-plugin-marketplace#readme)。
