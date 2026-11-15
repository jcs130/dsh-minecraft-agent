# 游戏失败与宿主工具边界

MCP 请求正常返回仍可能包含 `isError: true` 或 `structuredContent.failed: true`，表示游戏动作失败。模型应在原始回执前明确看到失败提示；未知结果需查询原请求，未学会的技能应查询当前技能并改用可用动作，不能把传输完成当作动作成功。

DSH rc.4 的 Native failure 分支不能携带 `concludesTurn`。若 MCP 回执同时请求 `control.endTurnRequested`，桥接层仍调用原 `exec.concludeTurn()`，post-execute 保留 Native success 外壳和原始失败 value，只增强模型可见反馈。直接强转 Native error 会丢失结束本轮的标记，可能让后续决策在错误边界继续运行。

不结束本轮的已确认游戏失败进入 Native error 分支。缺失、false、unknown 不推断为失败；失败本身也不证明没有副作用。原始值、请求身份、归档引用和实际游戏事实保持，不能因反馈提示自动重放请求、接管目标或额外调用模型。

验证：`node --test test/native-mcp-outcome.test.mjs test/harness-bridge.test.mjs`。现场另用实际 DSH rc.4 Tools 服务和合成工具验收：结案失败仍有 `concludesTurn: true`，非结案失败为 Native error，取消监听后恢复原行为；未调用游戏或模型。
