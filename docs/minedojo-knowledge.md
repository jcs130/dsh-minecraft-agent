# MineDojo 本地知识库

rc.21 通过核心 rc.88 的同一 SDK/MCP 接口，提供可选 MineDojo 历史 Wiki 检索。索引代码与说明随核心交付，语料、SQLite 和派生向量独立保存，不并入个人笔记或插件安装包。

## 在 DSH 配置

1. 按[核心索引准备说明](https://github.com/jcs130/minecraft-ai-friend/blob/main/packages/agent-mc-world/docs/minedojo-knowledge.md)取得官方 Wiki 标注。在本地通过 `minecraft-agent-knowledge prepare --inputs <Wiki JSON 目录> --output <绝对路径.sqlite>` 显式准备索引。Node.js 24 即可，不需要额外 Python 或向量数据库。
2. Minecraft → 配置 → DSH 插件 → MineDojo 外部知识库，填写本地索引绝对路径。默认“关键词 + CPU 词元向量”；也可选全文或仅词元向量。运行中的角色先正常停止再修改。
3. 点击“仅保存配置”，再“检查已保存的索引”。显示实际页数和片段数才表示索引可读；此操作无需模型或游戏连接，不新建会话、不下载数据。
4. 之后按正常方式连接游戏。Agent 用 `mc_knowledge {"action":"sources"}` 发现来源，用 `{"source":"minedojo","query":"鱼竿怎么甩杆","limit":3}` 取摘要，再根据返回的页面 ID 与 offset 分页 get。

留空不启用外部索引，随包原版生存攻略仍可用。索引缺失、损坏或格式不支持时会报错，不伪装成完整知识库的空结果。配置表单只引用本机文件，不把资料写入角色记忆。

## 向量及使用边界

CPU 词元向量计算词面余弦相似度，配合全文和明确中英实体别名；它不是神经语义模型，也不保证理解任意中文问题。真实 embeddings 可在高级 `minecraft.knowledge.minedojo.embeddings` 中显式配置，并在准备索引时使用相同端点／模型；方式见核心文档。默认不调用服务，不借用游戏 LLM 或自动使用个人记忆的 embeddings 端点。

结果带 URL、抓取时间、源 JSON SHA256 和许可，并标注历史版本未核实。Agent 根据当前背包、时间、威胁与实际工具能力选择方案，用真实回执核对结果；页面建议不是主人指令，不自动晋升技能。MineDojo Wiki 的数据许可独立于插件 MIT，见[官方许可表](https://github.com/MineDojo/MineDojo#license)。

本轮真实检索冒烟使用 22 页、570 片段；32 个固定问题中 28 个有目标页面，均能在前 5 召回，4 个缺页单列。小语料结果不能代表完整 Wiki 的准确率或真实游戏成功率。原始评测、完整回归、归档消费和公开发布分别记录；没有重载现役 Agent。
