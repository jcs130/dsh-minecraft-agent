// src/llm-qwen-local.ts
import {
  CallId,
  EMPTY_RESPONSE_CODE,
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
  attributionHeaders,
  contentHasImage,
  isContextWindowExceededError,
  isQuotaExceededError
} from "@deepseek-ai/dsh-llm";
var name = "llm-qwen-local";
var inject = ["llm"];
var PROVIDER = "qwen-local";
var DEFAULT_BASE_URL = "http://127.0.0.1:8890/v1";
var DEFAULT_API_KEY = "sk-local";
var DEFAULT_CONTEXT_WINDOW = 262144;
var DEFAULT_MAX_TOKENS = 8192;
var NONE_REASONING_EFFORT = ReasoningEffortId("none");
var LOW_REASONING_EFFORT = ReasoningEffortId("low");
var MEDIUM_REASONING_EFFORT = ReasoningEffortId("medium");
var HIGH_REASONING_EFFORT = ReasoningEffortId("high");
var XHIGH_REASONING_EFFORT = ReasoningEffortId("xhigh");
var REASONING_EFFORTS = [
  { id: NONE_REASONING_EFFORT, name: "None" },
  { id: LOW_REASONING_EFFORT, name: "Low" },
  { id: MEDIUM_REASONING_EFFORT, name: "Medium" },
  { id: HIGH_REASONING_EFFORT, name: "High" },
  { id: XHIGH_REASONING_EFFORT, name: "XHigh" }
];
var DEFAULT_MODELS = [
  {
    id: "qwen3.8-27b",
    name: "Qwen3.8-27B",
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS
  }
];
function modelInfo(provider, model) {
  return {
    provider,
    id: model.id,
    name: model.name ?? model.id,
    ...model.description === void 0 ? {} : { description: model.description },
    inputModalities: ["text", "image"]
  };
}
function wireEffort(effort) {
  const value = effort === void 0 ? "none" : String(effort);
  if (value === "none" || value === "low" || value === "medium" || value === "high" || value === "xhigh") {
    return value;
  }
  throw new LlmError(
    `Qwen3.8 does not support reasoning effort "${value}"`,
    "UNSUPPORTED_REASONING_EFFORT"
  );
}
function flattenText(blocks) {
  return blocks.filter((block) => block.type === "text").map((block) => block.text).join("");
}
function serializeAssistant(message) {
  const text = flattenText(message.content);
  const reasoning = message.content.filter((block) => block.type === "reasoning").map((block) => block.text).join("");
  const toolCalls = message.content.filter((block) => block.type === "tool-call").map((block) => ({
    id: block.id,
    type: "function",
    function: { name: block.name, arguments: block.arguments }
  }));
  return {
    role: "assistant",
    content: text,
    ...toolCalls.length > 0 && reasoning.length > 0 ? { reasoning_content: reasoning } : {},
    ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {}
  };
}
async function imageDataUrl(block, readImage, signal) {
  const stored = await readImage(block.attachment, signal);
  const base64 = Buffer.from(stored.data).toString("base64");
  return `data:${stored.ref.mediaType};base64,${base64}`;
}
async function serializeContent(blocks, readImage, signal) {
  if (!contentHasImage(blocks)) return flattenText(blocks);
  const parts = [];
  for (const block of blocks) {
    if (block.type === "image") {
      parts.push({
        type: "image_url",
        image_url: { url: await imageDataUrl(block, readImage, signal) }
      });
    } else if (block.type === "text" && block.text.length > 0) {
      parts.push({ type: "text", text: block.text });
    }
  }
  return parts;
}
async function serializeToolContent(blocks, readImage, signal) {
  const content = await serializeContent(blocks, readImage, signal);
  if (typeof content === "string" && content.length === 0) return "(no output)";
  return content;
}
async function serializeMessages(messages, readImage, signal) {
  const wire = [];
  for (const message of messages) {
    if (message.role === "system") {
      wire.push({ role: "system", content: flattenText(message.content) });
      continue;
    }
    if (message.role === "assistant") {
      wire.push(serializeAssistant(message));
      continue;
    }
    const toolResults = message.content.filter((block) => block.type === "tool-result");
    const text = flattenText(message.content);
    if (text.length > 0 || toolResults.length === 0) {
      wire.push({
        role: "user",
        content: await serializeContent(message.content, readImage, signal)
      });
    }
    for (const result of toolResults) {
      wire.push({
        role: "tool",
        tool_call_id: result.toolCallId,
        content: await serializeToolContent(result.content, readImage, signal)
      });
    }
  }
  return wire;
}
async function serializeRequest(options, adapter, signal) {
  const messages = [];
  if (options.system !== void 0) {
    messages.push({ role: "system", content: options.system });
  }
  messages.push(...await serializeMessages(options.messages, adapter.readImage, signal));
  const tools = options.tools?.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));
  const reasoningEffort = options.purpose === "session-title" ? "none" : wireEffort(options.reasoningEffort ?? adapter.defaultReasoningEffort);
  return {
    model: options.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    reasoning_effort: reasoningEffort,
    ...tools !== void 0 && tools.length > 0 ? { tools } : {},
    ...options.temperature !== void 0 ? { temperature: options.temperature } : {},
    ...options.maxTokens === void 0 ? {} : { max_tokens: options.maxTokens },
    ...options.stop !== void 0 ? { stop: options.stop } : {}
  };
}
function extractData(rawEvent) {
  const dataLines = [];
  for (const line of rawEvent.split("\n")) {
    if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ ?/, ""));
  }
  if (dataLines.length === 0) return null;
  return dataLines.join("\n");
}
async function* parseSse(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawDone = false;
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      let separator;
      while ((separator = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const data = extractData(raw);
        if (data === null) continue;
        if (data === "[DONE]") {
          sawDone = true;
          return;
        }
        yield data;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
    }
  }
  if (!sawDone) throw new LlmError("SSE stream ended without [DONE]", "STREAM_CLOSED");
}
function mapFinishReason(reason) {
  switch (reason) {
    case "stop":
      return { kind: "stop" };
    case "tool_calls":
      return { kind: "tool-calls" };
    case "length":
      return { kind: "max-tokens" };
    default:
      return {
        kind: "error",
        failure: {
          message: `model stopped: ${reason}`,
          code: reason.toUpperCase()
        }
      };
  }
}
function mapUsage(usage) {
  const promptTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const completionTokens = typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0;
  const details = usage.prompt_tokens_details;
  const cacheRead = typeof details?.cached_tokens === "number" ? details.cached_tokens : void 0;
  const completionDetails = usage.completion_tokens_details;
  const reasoning = typeof completionDetails?.reasoning_tokens === "number" ? completionDetails.reasoning_tokens : void 0;
  return {
    inputTokens: promptTokens - (cacheRead ?? 0),
    outputTokens: completionTokens,
    ...cacheRead !== void 0 ? { cacheReadTokens: cacheRead } : {},
    ...reasoning !== void 0 ? { reasoningTokens: reasoning } : {}
  };
}
function closeBlock(block) {
  switch (block.kind) {
    case "text":
      return { type: "text", text: block.text };
    case "reasoning":
      return { type: "reasoning", text: block.text };
    case "tool-call":
      return {
        type: "tool-call",
        id: CallId(block.callId ?? ""),
        name: block.name ?? "",
        arguments: block.text
      };
  }
}
async function* translate(payloads) {
  let nextIndex = 0;
  let textBlock;
  let reasoningBlock;
  const toolBlocks = /* @__PURE__ */ new Map();
  const order = [];
  let pendingFinish;
  let pendingUsage;
  const open = (kind) => {
    const block = { index: nextIndex++, kind, text: "" };
    order.push(block);
    return block;
  };
  for await (const payload of payloads) {
    if (payload === "[DONE]") {
      for (const block of order) {
        yield { type: "block-end", index: block.index, block: closeBlock(block) };
      }
      if (pendingUsage) yield { type: "usage", usage: pendingUsage };
      const reason = pendingFinish ?? { kind: "stop" };
      yield {
        type: "finish",
        reason: reason.kind === "stop" && order.length === 0 ? {
          kind: "error",
          failure: {
            message: "model returned a completed response with no content",
            code: EMPTY_RESPONSE_CODE
          }
        } : reason
      };
      return;
    }
    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      throw new LlmError(
        `malformed SSE payload: ${payload.slice(0, 120)}`,
        "MALFORMED_RESPONSE"
      );
    }
    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta;
      const reasoning = delta?.reasoning_content;
      if (typeof reasoning === "string" && reasoning.length > 0) {
        if (!reasoningBlock) {
          reasoningBlock = open("reasoning");
          yield {
            type: "block-start",
            index: reasoningBlock.index,
            blockType: "reasoning"
          };
        }
        reasoningBlock.text += reasoning;
        yield {
          type: "reasoning-delta",
          index: reasoningBlock.index,
          text: reasoning
        };
      }
      const content = delta?.content;
      if (typeof content === "string" && content.length > 0) {
        if (!textBlock) {
          textBlock = open("text");
          yield { type: "block-start", index: textBlock.index, blockType: "text" };
        }
        textBlock.text += content;
        yield { type: "text-delta", index: textBlock.index, text: content };
      }
      for (const call of delta?.tool_calls ?? []) {
        const callIndex = typeof call.index === "number" ? call.index : 0;
        let block = toolBlocks.get(callIndex);
        if (!block) {
          block = open("tool-call");
          toolBlocks.set(callIndex, block);
          yield { type: "block-start", index: block.index, blockType: "tool-call" };
        }
        if (typeof call.id === "string") block.callId = call.id;
        const fn = call.function;
        if (typeof fn?.name === "string") block.name = fn.name;
        const fragment = typeof fn?.arguments === "string" ? fn.arguments : "";
        block.text += fragment;
        yield {
          type: "tool-call-delta",
          index: block.index,
          id: CallId(block.callId ?? ""),
          ...block.name !== void 0 ? { name: block.name } : {},
          argumentsDelta: fragment
        };
      }
      if (typeof choice.finish_reason === "string") {
        pendingFinish = mapFinishReason(choice.finish_reason);
      }
    }
    if (chunk.usage) pendingUsage = mapUsage(chunk.usage);
  }
  throw new LlmError("SSE payload stream ended without [DONE]", "STREAM_CLOSED");
}
function httpErrorCode(status, error) {
  if (status === 401 || status === 403) return "AUTH";
  const detail = [error?.code, error?.type, error?.message].filter(Boolean).join(" ");
  if (isQuotaExceededError(detail)) return "QUOTA";
  if (status === 429) return "RATE_LIMIT";
  if (status === 400) {
    if (isContextWindowExceededError(detail)) return "CONTEXT_WINDOW_EXCEEDED";
    return "INVALID_REQUEST";
  }
  if (status >= 500) return "SERVER";
  return `HTTP_${status}`;
}
var QwenLocalAdapter = class extends LlmAdapter {
  config;
  constructor(config) {
    super();
    this.config = config;
  }
  providerInfo(provider) {
    return { id: provider, name: "Qwen Local" };
  }
  listModels(provider) {
    return Promise.resolve(this.config.models.map((model) => modelInfo(provider, model)));
  }
  resolveModel(provider, model, _signal) {
    const configured = this.config.models.find((entry) => entry.id === model);
    const contextWindow = configured?.contextWindow ?? this.config.defaultContextWindow;
    return Promise.resolve({
      ...configured === void 0 ? {
        provider,
        id: model,
        name: model,
        inputModalities: ["text", "image"]
      } : modelInfo(provider, configured),
      context: { contextWindow },
      defaultMaxTokens: configured?.maxTokens ?? this.config.defaultMaxTokens,
      reasoning: {
        efforts: REASONING_EFFORTS,
        defaultEffort: this.config.defaultReasoningEffort
      }
    });
  }
  async *stream(options) {
    const body = await serializeRequest(options, this.config, options.signal);
    const payload = JSON.stringify(body);
    const headers = {
      authorization: `Bearer ${this.config.apiKey}`,
      "content-type": "application/json",
      accept: "text/event-stream",
      ...attributionHeaders()
    };
    let response;
    try {
      response = await fetch(`${this.config.baseURL}/chat/completions`, {
        method: "POST",
        headers,
        body: payload,
        signal: options.signal
      });
    } catch (error) {
      if (options.signal?.aborted) {
        throw new LlmError("request aborted by caller", "ABORTED", { cause: error });
      }
      throw new LlmError(
        `Qwen local API request to ${this.config.baseURL} failed`,
        "TRANSPORT",
        { cause: error }
      );
    }
    if (!response.ok) {
      let message = `Qwen local API error (HTTP ${response.status})`;
      let providerError;
      try {
        const parsed = await response.json();
        providerError = parsed.error;
        if (typeof providerError?.message === "string") message = providerError.message;
      } catch {
      }
      throw new LlmError(message, httpErrorCode(response.status, providerError), {
        status: response.status
      });
    }
    if (!response.body) {
      throw new LlmError("Qwen local API returned no response body", "EMPTY_RESPONSE");
    }
    yield* translate(parseSse(response.body));
  }
};
function apply(ctx, config = {}) {
  const baseURL = config.baseURL ?? process.env.QWEN_LOCAL_BASE_URL ?? DEFAULT_BASE_URL;
  const apiKey = config.apiKey ?? process.env.QWEN_LOCAL_API_KEY ?? DEFAULT_API_KEY;
  const models = config.models ?? DEFAULT_MODELS;
  const defaultContextWindow = config.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const defaultMaxTokens = config.defaultMaxTokens ?? DEFAULT_MAX_TOKENS;
  const debug = config.debug ?? false;
  const readImage = (ref, signal) => ctx.attachments.readImage(ref, signal);
  const adapter = new QwenLocalAdapter({
    baseURL,
    apiKey,
    models,
    defaultContextWindow,
    defaultMaxTokens,
    defaultReasoningEffort: NONE_REASONING_EFFORT,
    readImage,
    debug
  });
  ctx.llm.registerAdapter([PROVIDER], adapter);
  ctx.logger.info(
    `llm-qwen-local: registered provider route "${PROVIDER}" -> ${baseURL} (models: ${models.map((m) => m.id).join(", ")})`
  );
}
export {
  DEFAULT_API_KEY,
  DEFAULT_BASE_URL,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  PROVIDER,
  QwenLocalAdapter,
  apply,
  inject,
  name
};
