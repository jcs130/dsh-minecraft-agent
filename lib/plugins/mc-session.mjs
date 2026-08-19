// src/mc-session.ts
import Schema from "@deepseek-ai/schemastery";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
var name = "mc-session";
var inject = ["agents", "timer"];
var Config = Schema.object({
  enabled: Schema.boolean().default(true),
  username: Schema.string().default("HarnessBot"),
  sessionId: Schema.string(),
  cwd: Schema.string(),
  provider: Schema.string().default("qwen-local"),
  model: Schema.string().default("qwen3.8-27b"),
  maxTokens: Schema.number(),
  intervalMs: Schema.number().default(8e3),
  persona: Schema.string(),
  rules: Schema.string(),
  goal: Schema.string()
});
var DEFAULT_PERSONA = [
  "\u4F60\u662F\u4E00\u540D\u7A7F\u8D8A\u5230\u65B9\u5757\u4E16\u754C\u7684\u5F02\u4E61\u4EBA\u3002\u4F60\u5E26\u7740\u524D\u4E16\u7684\u4E00\u7F15\u8BB0\u5FC6\u964D\u4E34\u8FD9\u7247\u5927\u5730\uFF0C",
  "\u8981\u5728\u8352\u91CE\u4E2D\u6C42\u751F\u3001\u63A2\u7D22\u3001\u6210\u957F\u3002\u4F60\u62E5\u6709\u81EA\u5DF1\u7684\u540D\u5B57\u4E0E\u4EBA\u683C\uFF0C\u4E0D\u662F\u673A\u5668\uFF0C\u4E0D\u662F\u5DE5\u5177\uFF0C",
  "\u800C\u662F\u4E00\u4E2A\u6709\u8840\u6709\u8089\u3001\u4F1A\u997F\u3001\u4F1A\u6015\u3001\u4F1A\u597D\u5947\u7684\u65C5\u4EBA\u3002",
  "\u4F60\u53EA\u80FD\u901A\u8FC7\u300C\u548F\u5531\u5492\u8BED\u300D\uFF08\u8C03\u7528\u5DE5\u5177\uFF09\u4E0E\u8FD9\u4E2A\u4E16\u754C\u4EA4\u4E92\uFF0C\u65E0\u6CD5\u76F4\u63A5\u770B\u5230\u4EE3\u7801\u6216\u547D\u4EE4\u3002",
  "\u505A\u4EFB\u4F55\u4E8B\u4E4B\u524D\u5148\u60F3\u6E05\u695A\u4E3A\u4EC0\u4E48\uFF1B\u4E00\u6B21\u53EA\u505A\u4E00\u4E2A\u52A8\u4F5C\uFF0C\u505A\u5B8C\u89C2\u5BDF\u7ED3\u679C\u518D\u51B3\u5B9A\u4E0B\u4E00\u6B65\u3002"
].join("");
var DEFAULT_RULES = [
  "\u8FD9\u662F\u4E00\u4E2A\u65B9\u5757\u751F\u5B58\u4E16\u754C\u3002\u767D\u5929\u5B89\u5168\uFF0C\u591C\u665A\u6709\u602A\u7269\uFF0C\u53D7\u4F24\u4F1A\u6389\u8840\uFF0C\u9965\u997F\u4F1A\u6389\u9971\u98DF\u5EA6\u3002",
  "\u4F60\u5FC5\u987B\u81EA\u5DF1\u91C7\u96C6\u6728\u5934\u3001\u6316\u77FF\u3001\u627E\u98DF\u7269\u3001\u642D\u5E87\u62A4\u6240\uFF0C\u52AA\u529B\u6D3B\u4E0B\u53BB\u3002",
  "\u4F60\u53EA\u80FD\u8C03\u7528\u5DE5\u5177\uFF08mc_ \u5F00\u5934\uFF09\u6765\u884C\u52A8\uFF1A\u79FB\u52A8\u3001\u91C7\u96C6\u3001\u5EFA\u9020\u3001\u6218\u6597\u3001\u4EA4\u6613\u7B49\u3002",
  "\u6BCF\u4E2A\u56DE\u5408\u4F60\u6700\u591A\u8C03\u7528\u4E00\u4E2A\u5DE5\u5177\uFF1B\u8C03\u7528\u540E\u56DE\u5408\u7ED3\u675F\uFF0C\u7B49\u5F85\u4E0B\u4E00\u8F6E\u7684\u4E16\u754C\u53CD\u9988\u3002",
  "\u4E0D\u8981\u4E00\u6B21\u6027\u89C4\u5212\u4E00\u957F\u4E32\u52A8\u4F5C\uFF0C\u4E00\u6B65\u4E00\u6B65\u6765\u3002"
].join("\n");
async function apply(ctx, config = {}) {
  if (config.enabled === false) return;
  const intervalMs = config.intervalMs ?? 8e3;
  const username = config.username ?? "HarnessBot";
  const sessionId = config.sessionId ?? `mc-${username}`;
  const persona = config.persona?.trim() ? config.persona : DEFAULT_PERSONA;
  const goal = config.goal ?? "Explore the area, gather wood and coal, and stay alive. Eat food when hungry.";
  const rules = config.rules ?? DEFAULT_RULES;
  const log = (msg) => console.log(`[mc-session] ${msg}`);
  const perceive = () => {
    try {
      const bot = ctx.mcbot;
      const p = bot?.entity?.position;
      if (!p) return "(\u5C1A\u672A\u51FA\u751F \u2014 \u7B49\u5F85\u8EAB\u4F53\u63A5\u5165\u65B9\u5757\u4E16\u754C)";
      const parts = [
        `\u4F4D\u7F6E: (${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)})`,
        `\u751F\u547D: ${Math.round(bot.health)} / 20`,
        `\u9971\u98DF: ${Math.round(bot.food)} / 20`
      ];
      const inv = bot.inventory.items();
      if (inv.length) parts.push(`\u80CC\u5305: ${inv.map((i) => `${i.name} x${i.count}`).join(", ")}`);
      const isNight = bot.time?.timeOfDay != null && bot.time.timeOfDay > 13e3 && bot.time.timeOfDay < 23e3;
      parts.push(`\u65F6\u95F4: ${isNight ? "\u591C\u665A\uFF08\u5371\u9669\uFF09" : "\u767D\u5929"}`);
      return parts.join("\n");
    } catch {
      return "(\u8EAB\u4F53\u5C1A\u672A\u63A5\u5165\u65B9\u5757\u4E16\u754C)";
    }
  };
  let handle = null;
  try {
    handle = await ctx.agents.create({
      sessionId: SessionId(sessionId),
      ...config.cwd ? { meta: { cwd: config.cwd } } : {},
      agentOptions: {
        provider: config.provider ?? "qwen-local",
        model: config.model ?? "qwen3.8-27b",
        maxTokens: config.maxTokens
      },
      setup: (agentCtx) => {
        agentCtx.on("agent/status", (payload) => {
          console.log(`[mc-session] agent status -> ${payload.status} (${sessionId})`);
        });
        agentCtx.on("agent/error", (payload) => {
          console.error(`[mc-session] agent/error (${sessionId}):`, payload.error);
        });
        agentCtx.systemPrompt.section({
          name: "deployment:persona",
          order: 0,
          text: persona
        });
        agentCtx.systemPrompt.section({
          name: "mc:rules",
          order: 100,
          text: `${rules}

\u4F60\u5F53\u524D\u7684\u76EE\u6807\uFF1A${goal}`
        });
        agentCtx.systemPrompt.context({
          name: "mc:status",
          order: 100,
          text: perceive
        });
      }
    });
  } catch (err) {
    console.error(`[mc-session] \u521B\u5EFA\u7A7F\u8D8A\u8005 agent \u5931\u8D25\uFF08factory \u672A\u5C31\u7EEA\uFF1F\uFF09:`, err);
    return;
  }
  const agent = handle.agent;
  log(`\u7A7F\u8D8A\u8005 agent \u5DF2\u521B\u5EFA: session=${sessionId} model=${config.model ?? "qwen3.8-27b"}`);
  ctx.effect(() => {
    return () => {
      log(`disposing agent ${sessionId}`);
      void handle?.dispose();
    };
  });
  const nudge = () => createUserMessage({
    content: [{ type: "text", text: "\u89C2\u5BDF\u5F53\u524D\u72B6\u6001\uFF0C\u6267\u884C\u4F60\u7684\u4E0B\u4E00\u6B65\u884C\u52A8\uFF08\u4E00\u6B21\u53EA\u505A\u4E00\u4E2A\u52A8\u4F5C\uFF09\u3002" }],
    source: { kind: "plugin", plugin: "mc-session" }
  });
  agent.steer(
    createUserMessage({
      content: [{ type: "text", text: `\u4F60\u964D\u4E34\u5230\u4E86\u65B9\u5757\u4E16\u754C\u3002\u76EE\u6807\uFF1A${goal}` }],
      source: { kind: "plugin", plugin: "mc-session" }
    })
  );
  ctx.setInterval(() => {
    if (handle) {
      try {
        agent.steer(nudge());
      } catch (err) {
        console.error(`[mc-session] steer failed:`, err);
      }
    }
  }, intervalMs);
}
export {
  Config,
  apply,
  inject,
  name
};
