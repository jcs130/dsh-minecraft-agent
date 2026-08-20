var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name15 in all)
    __defProp(target, name15, { get: all[name15], enumerable: true });
};

// bootstrap-session.mts
import { Context } from "@deepseek-ai/cordis";
import Timer from "@deepseek-ai/cordis-plugin-timer";
import LlmRuntime from "@deepseek-ai/dsh-llm";
import SessionStore from "@deepseek-ai/dsh-session";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import AgentRegistry from "@deepseek-ai/dsh-agent";
import AgentLoop from "@deepseek-ai/dsh-agent-loop";

// src/llm-qwen-local.ts
var llm_qwen_local_exports = {};
__export(llm_qwen_local_exports, {
  DEFAULT_API_KEY: () => DEFAULT_API_KEY,
  DEFAULT_BASE_URL: () => DEFAULT_BASE_URL,
  DEFAULT_CONTEXT_WINDOW: () => DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS: () => DEFAULT_MAX_TOKENS,
  PROVIDER: () => PROVIDER,
  QwenLocalAdapter: () => QwenLocalAdapter,
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
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
  const text5 = flattenText(message.content);
  const reasoning = message.content.filter((block) => block.type === "reasoning").map((block) => block.text).join("");
  const toolCalls = message.content.filter((block) => block.type === "tool-call").map((block) => ({
    id: block.id,
    type: "function",
    function: { name: block.name, arguments: block.arguments }
  }));
  return {
    role: "assistant",
    content: text5,
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
    const text5 = flattenText(message.content);
    if (text5.length > 0 || toolResults.length === 0) {
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
          yield data;
          return;
        }
        yield data;
      }
    }
    buffer += decoder.decode();
    buffer = buffer.replace(/\r\n/g, "\n");
    if (buffer.trim().length > 0) {
      const data = extractData(buffer);
      if (data === "[DONE]") {
        sawDone = true;
        yield data;
      } else if (data !== null) {
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
    if (this.config.debug) {
      console.log(
        `[llm-qwen-local] STREAM model=${options.model} msgs=${options.messages.length} tools=${options.tools?.length ?? 0} purpose=${options.purpose ?? "-"}`
      );
    }
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
function apply(ctx2, config = {}) {
  const baseURL = config.baseURL ?? process.env.QWEN_LOCAL_BASE_URL ?? DEFAULT_BASE_URL;
  const apiKey = config.apiKey ?? process.env.QWEN_LOCAL_API_KEY ?? DEFAULT_API_KEY;
  const models = config.models ?? DEFAULT_MODELS;
  const defaultContextWindow = config.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const defaultMaxTokens = config.defaultMaxTokens ?? DEFAULT_MAX_TOKENS;
  const debug = config.debug ?? false;
  const readImage = (ref, signal) => ctx2.attachments.readImage(ref, signal);
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
  ctx2.llm.registerAdapter([PROVIDER], adapter);
  ctx2.logger.info(
    `llm-qwen-local: registered provider route "${PROVIDER}" -> ${baseURL} (models: ${models.map((m) => m.id).join(", ")})`
  );
}

// src/mc-bot.ts
var mc_bot_exports = {};
__export(mc_bot_exports, {
  Config: () => Config,
  apply: () => apply3,
  createBotService: () => createBotService,
  name: () => name3
});
import Schema from "@deepseek-ai/schemastery";
import mineflayer from "mineflayer";
import pf2 from "mineflayer-pathfinder";
import { plugin as toolPlugin } from "mineflayer-tool";
import { mkdirSync as mkdirSync2, watchFile, unwatchFile, writeFileSync } from "node:fs";
import { join as join4, resolve as resolve2 } from "node:path";

// src/mc-tools.ts
var mc_tools_exports = {};
__export(mc_tools_exports, {
  apply: () => apply2,
  digAt: () => digAt,
  doEnchant: () => doEnchant,
  doSmelt: () => doSmelt,
  findFurnaceBlock: () => findFurnaceBlock,
  inject: () => inject2,
  name: () => name2,
  transferWithChest: () => transferWithChest,
  tunedMovements: () => tunedMovements,
  viewFurnaceContent: () => viewFurnaceContent
});
import { defineTool } from "@deepseek-ai/dsh-tools";
import pf from "mineflayer-pathfinder";
import Vec32 from "vec3";
import { chromium } from "playwright-core";
import { join as join2, resolve } from "node:path";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";

// src/mc-camera.ts
import { mkdir, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import Vec3 from "vec3";
var vision = null;
var visionTried = false;
var visionError = "";
async function loadVision() {
  if (visionTried) return vision;
  visionTried = true;
  try {
    const [threeMod, canvasMod, viewerMod, worldViewMod] = await Promise.all([
      import("three"),
      import("node-canvas-webgl/lib/index.js"),
      import("prismarine-viewer/viewer/lib/viewer.js"),
      import("prismarine-viewer/viewer/lib/worldView.js")
    ]);
    const THREE = threeMod.default ?? threeMod;
    const [entitiesMod] = await Promise.all([
      import("prismarine-viewer/viewer/lib/entities.js")
    ]);
    const entitiesRaw = entitiesMod.default ?? entitiesMod;
    const origGetEntityMesh = entitiesRaw.getEntityMesh;
    if (typeof origGetEntityMesh === "function") {
      entitiesRaw.getEntityMesh = (...fnArgs) => {
        try {
          return origGetEntityMesh(...fnArgs);
        } catch {
          const dummy = new THREE.Mesh(
            new THREE.BoxGeometry(0.25, 0.25, 0.25),
            new THREE.MeshBasicMaterial({ visible: false })
          );
          return dummy;
        }
      };
    }
    const isEntityNoise = (a) => {
      const flat = a.map((x) => x instanceof Error ? x.message : String(x)).join(" ");
      return /^(Error: )?Unknown entity /.test(flat);
    };
    for (const level of ["error", "log"]) {
      const orig = console[level].bind(console);
      console[level] = (...a) => {
        if (isEntityNoise(a)) return;
        orig(...a);
      };
    }
    global.Worker = Worker;
    global.THREE = THREE;
    vision = {
      THREE,
      createCanvas: canvasMod.createCanvas,
      Viewer: viewerMod.Viewer,
      WorldView: worldViewMod.WorldView
    };
    console.log("[mc-camera] vision stack loaded (three + node-canvas-webgl + prismarine-viewer)");
  } catch (err) {
    visionError = err instanceof Error ? err.message : String(err);
    console.warn(`[mc-camera] vision stack unavailable (headless deployment?) \u2014 mc_see degraded: ${visionError}`);
  }
  return vision;
}
var WIDTH = 800;
var HEIGHT = 512;
var FOV = Number(process.env.MC_EYES_FOV || 90);
var VIEW_DISTANCE = Number(process.env.MC_EYES_VIEW || 10);
var KEEP_SHOTS = 40;
var current = null;
var building = null;
function isAlive(c) {
  return !!c && c.bot.entity != null && c.bot.world != null;
}
async function build(bot) {
  const v = await loadVision();
  if (!v) throw new Error(`camera unavailable (vision stack not loadable: ${visionError})`);
  const canvas = v.createCanvas(WIDTH, HEIGHT);
  const renderer = new v.THREE.WebGLRenderer({ canvas });
  const viewer = new v.Viewer(renderer);
  const entities = viewer.entities;
  if (entities?.update) {
    const origUpdate = entities.update.bind(entities);
    entities.update = (...a) => {
      try {
        origUpdate(...a);
      } catch {
      }
    };
  }
  viewer.camera.fov = FOV;
  viewer.camera.updateProjectionMatrix();
  console.log(`[mc-camera] camera built: fov=${FOV} (v), view=${VIEW_DISTANCE} chunks, ${WIDTH}x${HEIGHT}`);
  const botPos = bot.entity.position;
  const center = new Vec3(botPos.x, botPos.y + bot.entity.height, botPos.z);
  viewer.setVersion(bot.version);
  const worldView = new v.WorldView(bot.world, VIEW_DISTANCE, center);
  viewer.listen(worldView);
  worldView.listenToBot(bot);
  const state = { bot, renderer, canvas, viewer, worldView, ready: Promise.resolve() };
  await worldView.init(center);
  return state;
}
function getCamera(bot) {
  if (isAlive(current) && current.bot === bot) return Promise.resolve(current);
  if (isAlive(current) && current.bot !== bot) {
    current = null;
  }
  if (!building) {
    if (!bot.entity || !bot.world) throw new Error("camera: bot not spawned yet");
    building = build(bot).then((c) => {
      current = c;
      return c;
    }).finally(() => {
      building = null;
    });
  }
  return building;
}
async function pruneOld(dir) {
  try {
    const files = (await readdir(dir)).filter((f) => f.endsWith(".jpg"));
    if (files.length <= KEEP_SHOTS) return;
    const sorted = files.sort();
    for (const f of sorted.slice(0, sorted.length - KEEP_SHOTS)) {
      await unlink(join(dir, f)).catch(() => {
      });
    }
  } catch {
  }
}
async function waitForMesher(cam) {
  const wr = cam.viewer.world;
  if (!wr || wr.sectionsOutstanding.size === 0) return;
  const world = wr;
  const emitter = wr.renderUpdateEmitter;
  await new Promise((resolve12) => {
    const t = setTimeout(done, 15e3);
    function done() {
      clearTimeout(t);
      emitter.off("update", onDone);
      resolve12();
    }
    function onDone() {
      if (world.sectionsOutstanding.size === 0) done();
    }
    emitter.on("update", onDone);
  });
}
async function renderOne(cam, bot, yaw, pitch, shotsRoot, suffix) {
  const e = bot.entity;
  if (cam.viewer.camera.fov !== FOV) {
    cam.viewer.camera.fov = FOV;
    cam.viewer.camera.updateProjectionMatrix();
  }
  const center = new Vec3(e.position.x, e.position.y + e.height, e.position.z);
  cam.viewer.camera.position.set(center.x, center.y, center.z);
  await cam.worldView.updatePosition(center);
  cam.viewer.setFirstPersonCamera(e.position, yaw, pitch);
  cam.viewer.update();
  cam.renderer.render(cam.viewer.scene, cam.viewer.camera);
  const { getBufferFromStream } = await import("prismarine-viewer/viewer/lib/simpleUtils.js");
  const imageStream = cam.canvas.createJPEGStream({ bufsize: 4096, quality: 88, progressive: false });
  const buffer = await getBufferFromStream(imageStream);
  let file = null;
  if (shotsRoot) {
    const dir = join(shotsRoot, bot.username || "unknown");
    await mkdir(dir, { recursive: true });
    const name15 = `${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}${suffix}.jpg`;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, name15), buffer);
    file = `${bot.username || "unknown"}/${name15}`;
    void pruneOld(dir);
  }
  return { buffer, file };
}
async function captureFirstPerson(bot, shotsRoot) {
  const cam = await getCamera(bot);
  await waitForMesher(cam);
  const e = bot.entity;
  return await renderOne(cam, bot, e.yaw, e.pitch, shotsRoot, "");
}
async function captureLookaround(bot, shotsRoot) {
  const cam = await getCamera(bot);
  await waitForMesher(cam);
  const e = bot.entity;
  const baseYaw = e.yaw;
  const pitch = Math.max(-0.3, Math.min(0.3, e.pitch));
  const dirs = [
    { label: "\u524D\u65B9", key: "front", dy: 0 },
    { label: "\u53F3\u65B9", key: "right", dy: Math.PI / 2 },
    { label: "\u540E\u65B9", key: "back", dy: Math.PI },
    { label: "\u5DE6\u65B9", key: "left", dy: -Math.PI / 2 }
  ];
  const shots = [];
  for (const d of dirs) {
    const shot = await renderOne(cam, bot, baseYaw + d.dy, pitch, shotsRoot, `-${d.key}`);
    shots.push({ ...shot, label: d.label, key: d.key });
  }
  return shots;
}

// src/mc-vision.ts
var lastImages = [];
var lastImagesAt = 0;
function setLastImage(dataUrl, file = null) {
  lastImages = [{ dataUrl, file }];
  lastImagesAt = Date.now();
}
function setLastImages(images) {
  if (images.length === 0) return;
  lastImages = images;
  lastImagesAt = Date.now();
}

// src/mc-tools.ts
var name2 = "mc-tools";
var inject2 = ["tools", "mcbot"];
var pluginCtx;
var sleep = (ms) => new Promise((resolve12) => setTimeout(resolve12, ms));
function text(value) {
  return [{ type: "text", text: String(value) }];
}
function resolveBot(exec) {
  try {
    const b = exec?.agent?.ctx?.mcbot;
    if (b) return b;
  } catch {
  }
  try {
    return pluginCtx?.mcbot;
  } catch {
    return void 0;
  }
}
var EPISODIC_DIR = resolve(process.cwd(), "data");
function recordEpisodic(bot, args, outcome, failed = false) {
  const u = bot.username;
  if (!u) return;
  const p = bot.entity?.position;
  const pos = p ? `(${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}) ` : "";
  let argsStr = "";
  try {
    const s = JSON.stringify(args);
    if (s && s !== "{}") argsStr = ` ${s.slice(0, 120)}`;
  } catch {
  }
  const text22 = `${failed ? "\u2717 " : ""}${pos}->${argsStr} = ${String(outcome).slice(0, 220)}`;
  appendFileSync(join2(EPISODIC_DIR, `episodic-${u}.jsonl`), JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), text: text22 }) + "\n", "utf8");
}
function guard(fn) {
  return async (args, exec) => {
    try {
      const bot = resolveBot(exec);
      if (!bot) return "bot not available (agent has no body)";
      if (!bot.entity) return "bot is not connected / has not spawned yet";
      const out = await fn(bot, args);
      try {
        recordEpisodic(bot, args, out);
      } catch {
      }
      return out;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        const b = resolveBot(exec);
        if (b) recordEpisodic(b, args, msg, true);
      } catch {
      }
      return `tool error: ${msg}`;
    }
  };
}
function tunedMovements(bot) {
  const m = new pf.Movements(bot);
  m.allowFreeMotion = true;
  m.digCost = 6;
  m.placeCost = 2;
  m.infiniteLiquidDropdownDistance = false;
  const hostile = [
    "zombie",
    "zombie_villager",
    "husk",
    "drowned",
    "skeleton",
    "stray",
    "bogged",
    "creeper",
    "spider",
    "cave_spider",
    "witch",
    "enderman",
    "phantom",
    "slime",
    "magma_cube",
    "silverfish",
    "guardian",
    "elder_guardian",
    "pillager",
    "vindicator",
    "evoker",
    "ravager",
    "vex",
    "warden",
    "breeze",
    "wither_skeleton",
    "zombified_piglin",
    "hoglin",
    "zoglin",
    "ghast",
    "blaze"
  ];
  for (const n of hostile) m.entitiesToAvoid.add(n);
  try {
    const cfgPath = ["/app/data/base-protect.json", resolve(process.cwd(), "data/base-protect.json")].find(existsSync);
    if (cfgPath) {
      const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
      const r = cfg.r ?? 16;
      m.exclusionAreasBreak.push((block) => {
        const d = Math.hypot(block.position.x - cfg.x, block.position.y - cfg.y, block.position.z - cfg.z);
        return d <= r ? 100 : 0;
      });
      console.log(`[mc-tools] base protection zone active: r=${r} @ (${cfg.x}, ${cfg.y}, ${cfg.z})`);
    }
  } catch {
  }
  return m;
}
function hardResetPathfinder(bot) {
  try {
    bot.pathfinder.setGoal(null);
  } catch {
  }
  try {
    bot.pathfinder.stop();
  } catch {
  }
  try {
    bot.clearControlStates();
  } catch {
  }
  try {
    bot.pathfinder.setMovements(tunedMovements(bot));
  } catch {
  }
}
async function resyncPulse(bot) {
  try {
    bot.setControlState("jump", true);
    await sleep(400);
    bot.setControlState("jump", false);
    await sleep(500);
  } catch {
  }
}
async function gotoNear(bot, pos, reach, timeoutMs = 2e4) {
  const attempt = async (budgetMs) => {
    const goal = new pf.goals.GoalNear(pos.x, pos.y, pos.z, reach);
    const startPos = bot.entity.position.clone();
    let bestProgress = 0;
    let stallTicks = 0;
    let settled = false;
    let abort = null;
    const abortPromise = new Promise((_, reject) => {
      abort = () => reject(new Error("movement wedged: pathfinder active but position frozen"));
    });
    const gotoPromise = bot.pathfinder.goto(goal);
    gotoPromise.catch(() => {
    });
    const watchdog = setInterval(() => {
      if (settled || !abort) return;
      if (!bot.entity) {
        stallTicks = 99;
        abort();
        return;
      }
      const moved = bot.entity.position.distanceTo(startPos);
      if (moved > bestProgress + 0.4) {
        bestProgress = moved;
        stallTicks = 0;
      } else if (bot.pathfinder.isMoving() && !bot.pathfinder.isMining() && !bot.pathfinder.isBuilding()) {
        stallTicks++;
        if (stallTicks >= 3) abort();
      } else {
        stallTicks = 0;
      }
    }, 1500);
    try {
      await Promise.race([
        gotoPromise,
        abortPromise,
        new Promise(
          (_, reject) => setTimeout(() => reject(new Error("pathfinding timed out")), budgetMs)
        )
      ]);
      settled = true;
      const dist = bot.entity ? bot.entity.position.distanceTo(pos) : Infinity;
      if (dist > reach + 1.5) {
        console.error(`[mc-tools] gotoNear FALSE-POSITIVE: resolved but real dist=${dist.toFixed(2)} > reach+1.5 \u2014 treat as wedged`);
        return { reached: false, wedged: true };
      }
      return { reached: true, wedged: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const moved = bot.entity ? bot.entity.position.distanceTo(startPos) : -1;
      const wedged = stallTicks >= 2;
      console.error(`[mc-tools] gotoNear FAIL: ${msg} | moved=${moved.toFixed(2)} target=(${pos.x},${pos.y},${pos.z}) reach=${reach}${wedged ? " | WEDGE detected" : ""}`);
      return { reached: false, wedged };
    } finally {
      settled = true;
      clearInterval(watchdog);
      try {
        bot.pathfinder.setGoal(null);
      } catch {
      }
      try {
        bot.clearControlStates();
      } catch {
      }
    }
  };
  const first = await attempt(timeoutMs);
  if (first.reached) return true;
  hardResetPathfinder(bot);
  await resyncPulse(bot);
  if (!first.wedged) return false;
  const second = await attempt(1e4);
  if (!second.reached) hardResetPathfinder(bot);
  return second.reached;
}
async function gotoXZ(bot, x, z, range, timeoutMs = 15e3) {
  const goal = new pf.goals.GoalNearXZ(x, z, range);
  try {
    await Promise.race([
      bot.pathfinder.goto(goal),
      new Promise(
        (_, reject) => setTimeout(() => reject(new Error("pathfinding timed out")), timeoutMs)
      )
    ]);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[mc-tools] gotoXZ FAIL: ${msg} | target=(${x},${z}) range=${range}`);
    hardResetPathfinder(bot);
    return false;
  }
}
async function pickupNearby(bot) {
  const before = bot.inventory.items().reduce((s, i) => s + i.count, 0);
  await sleep(300);
  if (bot.inventory.items().reduce((s, i) => s + i.count, 0) > before) return;
  const item = bot.nearestEntity(
    (e) => e.name === "item" && bot.entity.position.distanceTo(e.position) < 8
  );
  if (!item) return;
  await gotoXZ(bot, item.position.x, item.position.z, 0.5);
  await sleep(300);
}
async function equipBestWeapon(bot) {
  const weapons = bot.inventory.items().filter((i) => i.name.includes("sword") || i.name.includes("axe"));
  if (weapons.length === 0) return;
  weapons.sort((a, b) => b.attackDamage - a.attackDamage);
  const weapon = weapons[0];
  if (weapon) await bot.equip(weapon, "hand");
}
async function craftItem(bot, itemName, count) {
  const item = bot.registry.itemsByName[itemName];
  if (!item) return `unknown item: ${itemName}`;
  const allRecipes = bot.recipesAll(item.id, null, true);
  if (allRecipes.length === 0) return `no recipe for ${itemName}`;
  const resultCount = allRecipes[0].result.count;
  let table = null;
  if (allRecipes.some((r) => r.requiresTable)) {
    const tableBlock = bot.findBlock({
      matching: (b) => !!b && b.name === "crafting_table",
      maxDistance: 16
    });
    if (!tableBlock) return `crafting ${itemName} needs a crafting table, but none is within 16 blocks`;
    const reached = await gotoNear(bot, tableBlock.position, 3);
    if (!reached) return "could not reach the crafting table";
    table = tableBlock;
  }
  const feasible = bot.recipesFor(item.id, null, count * resultCount, table);
  if (feasible.length === 0) {
    const missing = allRecipes[0].delta.filter((d) => d.count < 0).map((d) => {
      const nm = bot.registry.items[d.id]?.name ?? `id:${d.id}`;
      return `${nm} x${Math.abs(d.count) * Math.ceil(count / resultCount)}`;
    }).join(", ");
    return `not enough ingredients to craft ${count} ${itemName}; missing: ${missing || "unknown"}`;
  }
  const recipe = feasible[0];
  try {
    await bot.craft(recipe, count, table);
  } catch (err) {
    return `craft failed: ${err instanceof Error ? err.message : String(err)}`;
  }
  return `crafted ${count} ${itemName}`;
}
var STORAGE_BLOCKS = ["chest", "barrel", "trapped_chest", "hopper", "dropper", "dispenser"];
var FURNACE_BLOCKS = ["furnace", "blast_furnace", "smoker"];
function coordArgs(args) {
  const num = (v) => typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : void 0;
  return { x: num(args.x), y: num(args.y), z: num(args.z) };
}
function findStorageBlock(bot, args, range) {
  const { x, y, z } = coordArgs(args);
  if (x !== void 0 && y !== void 0 && z !== void 0) {
    const b = bot.blockAt(new Vec32(x, y, z));
    return b && STORAGE_BLOCKS.includes(b.name) ? b : null;
  }
  return bot.findBlock({
    matching: (b) => !!b && STORAGE_BLOCKS.includes(b.name),
    maxDistance: range
  }) ?? null;
}
function findFurnaceBlock(bot, args, range) {
  const { x, y, z } = coordArgs(args);
  if (x !== void 0 && y !== void 0 && z !== void 0) {
    const b = bot.blockAt(new Vec32(x, y, z));
    return b && FURNACE_BLOCKS.includes(b.name) ? b : null;
  }
  return bot.findBlock({
    matching: (b) => !!b && FURNACE_BLOCKS.includes(b.name),
    maxDistance: range
  }) ?? null;
}
function noContainerMessage(bot, args, range) {
  const { x, y, z } = coordArgs(args);
  if (x !== void 0 && y !== void 0 && z !== void 0) {
    const b = bot.blockAt(new Vec32(x, y, z));
    if (b && FURNACE_BLOCKS.includes(b.name)) {
      return `(${x}, ${y}, ${z}) is a ${b.name}, not a chest \u2014 use mc_smelt to smelt items in it, or mc_view_furnace to look inside`;
    }
    if (b && (b.name === "enchanting_table" || b.name === "enchantment_table")) {
      return `(${x}, ${y}, ${z}) is an enchanting table, not a chest \u2014 use mc_enchant to enchant items there`;
    }
    if (b) {
      return `(${x}, ${y}, ${z}) is a ${b.name}, not a container this tool can open`;
    }
    return `no block at (${x}, ${y}, ${z}) \u2014 chunk not loaded or wrong coordinates`;
  }
  const f = bot.findBlock({
    matching: (blk) => !!blk && FURNACE_BLOCKS.includes(blk.name),
    maxDistance: range
  });
  if (f) {
    return `no chest/barrel found nearby, but there is a ${f.name} at (${f.position.x}, ${f.position.y}, ${f.position.z}) \u2014 use mc_smelt on it`;
  }
  return "no chest/barrel found nearby (give x/y/z, or move closer to one)";
}
async function openStorage(bot, block) {
  const reached = await gotoNear(bot, block.position, 3);
  if (!reached) throw new Error("could not reach the container");
  return openWithRetry(() => bot.openContainer(block));
}
function heldCount(bot, itemName) {
  return bot.inventory.items().reduce((s, i) => i.name === itemName ? s + i.count : s, 0);
}
async function settleHeldCount(bot, itemName, staleValue, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  let v = heldCount(bot, itemName);
  while (v === staleValue && Date.now() < deadline) {
    await sleep(40);
    v = heldCount(bot, itemName);
  }
  return v;
}
async function transferWithChest(bot, args, mode) {
  const itemName = String(args.itemType ?? "");
  if (!itemName) return "itemType is required";
  const item = bot.registry.itemsByName[itemName];
  if (!item) return `unknown item: ${itemName}`;
  const range = Math.max(1, Math.floor(Number(args.range ?? 16)));
  const block = findStorageBlock(bot, args, range);
  if (!block) return noContainerMessage(bot, args, range);
  const count = args.count === void 0 || args.count === null ? null : Math.max(1, Math.floor(Number(args.count)));
  let container;
  try {
    container = await openStorage(bot, block);
  } catch (err) {
    return `failed to open container: ${err instanceof Error ? err.message : String(err)}`;
  }
  const before = heldCount(bot, itemName);
  let want = 0;
  let transferErr = "";
  try {
    if (mode === "deposit") {
      want = count ?? before;
      if (want > 0) await container.deposit(item.id, null, want);
    } else {
      const inContainer = container.containerItems().reduce((s, i) => i.name === itemName ? s + i.count : s, 0);
      want = count ?? inContainer;
      if (want > 0) await container.withdraw(item.id, null, want);
    }
  } catch (err) {
    transferErr = err instanceof Error ? err.message : String(err);
  } finally {
    container.close();
  }
  const after = await settleHeldCount(bot, itemName, before);
  const moved = mode === "deposit" ? before - after : after - before;
  const ofPart = transferErr || moved < want ? ` of ${want}` : "";
  if (mode === "deposit") {
    if (moved > 0) return `deposited ${moved}${ofPart} ${itemName} into ${block.name}`;
    if (before === 0) return `no ${itemName} in inventory to deposit`;
    return transferErr ? `deposit failed: ${transferErr}` : `no ${itemName} in inventory to deposit`;
  }
  if (moved > 0) return `withdrew ${moved}${ofPart} ${itemName} from ${block.name}`;
  return transferErr ? `withdraw failed: ${transferErr}` : `no ${itemName} in ${block.name} to withdraw`;
}
async function viewChest(bot, args) {
  const range = Math.max(1, Math.floor(Number(args.range ?? 16)));
  const block = findStorageBlock(bot, args, range);
  if (!block) return noContainerMessage(bot, args, range);
  let container;
  try {
    container = await openStorage(bot, block);
  } catch (err) {
    return `failed to open container: ${err instanceof Error ? err.message : String(err)}`;
  }
  try {
    const items = container.containerItems();
    const at = `(${block.position.x}, ${block.position.y}, ${block.position.z})`;
    if (items.length === 0) return `chest at ${at} is empty`;
    return `chest at ${at} contains: ${items.map((i) => `${i.name} x${i.count}`).join(", ")}`;
  } finally {
    container.close();
  }
}
var FUEL_PRIORITY = [
  "coal",
  "charcoal",
  "oak_planks",
  "spruce_planks",
  "birch_planks",
  "jungle_planks",
  "acacia_planks",
  "dark_oak_planks",
  "mangrove_planks",
  "cherry_planks",
  "bamboo_planks",
  "oak_log",
  "spruce_log",
  "birch_log",
  "stick"
];
var FUEL_BURN_ITEMS = { coal: 8, charcoal: 8 };
var DEFAULT_FUEL_ITEMS = 1.5;
var SMELT_SECONDS_PER_ITEM = 10;
var SMELT_MAX_BATCH = 6;
function fuelEach(name15) {
  return FUEL_BURN_ITEMS[name15] ?? DEFAULT_FUEL_ITEMS;
}
function pickFuel(bot) {
  for (const name15 of FUEL_PRIORITY) {
    const it = bot.inventory.items().find((i) => i.name === name15);
    if (it) return { name: name15, id: it.type };
  }
  return null;
}
async function openFurnaceAt(bot, block) {
  const reached = await gotoNear(bot, block.position, 3);
  if (!reached) throw new Error("could not reach the furnace");
  return openWithRetry(() => bot.openFurnace(block));
}
async function openWithRetry(open) {
  try {
    return await open();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/windowOpen did not fire/.test(msg)) throw err;
    await sleep(600);
    return await open();
  }
}
async function doSmelt(bot, args) {
  const itemName = String(args.itemType ?? "");
  if (!itemName) return "itemType is required";
  const item = bot.registry.itemsByName[itemName];
  if (!item) return `unknown item: ${itemName}`;
  const range = Math.max(1, Math.floor(Number(args.range ?? 16)));
  const block = findFurnaceBlock(bot, args, range);
  if (!block) {
    return 'no furnace/blast furnace/smoker found nearby \u2014 craft one (mc_craft "furnace", needs 8 cobblestone), place it (mc_place), then mc_smelt again';
  }
  const held = heldCount(bot, itemName);
  if (held === 0) return `no ${itemName} in inventory to smelt`;
  const fuelName = args.fuelType ? String(args.fuelType) : "";
  let fuel;
  if (fuelName) {
    const reg = bot.registry.itemsByName[fuelName];
    if (!reg) return `unknown fuel item: ${fuelName}`;
    if (heldCount(bot, fuelName) === 0) return `no ${fuelName} in inventory`;
    fuel = { name: fuelName, id: reg.id };
  } else {
    const picked = pickFuel(bot);
    if (!picked) return "no fuel in inventory (coal, charcoal, planks and logs all work)";
    fuel = picked;
  }
  const want = Math.min(
    args.count ? Math.max(1, Math.floor(Number(args.count))) : held,
    held,
    SMELT_MAX_BATCH
  );
  let furnace;
  try {
    furnace = await openFurnaceAt(bot, block);
  } catch (err) {
    return `failed to open furnace: ${err instanceof Error ? err.message : String(err)}`;
  }
  const at = `(${block.position.x}, ${block.position.y}, ${block.position.z})`;
  let collected = 0;
  let stillQueued = 0;
  try {
    if (furnace.outputItem()) {
      const got = await furnace.takeOutput();
      collected += got.count;
    }
    const cur = furnace.inputItem();
    if (cur && cur.name !== itemName) {
      return `furnace at ${at} is already smelting ${cur.name} x${cur.count} \u2014 try again later or use another furnace`;
    }
    const alreadyIn = cur ? cur.count : 0;
    const load = want - alreadyIn;
    if (load > 0) await furnace.putInput(item.id, null, load);
    const fuelNeed = Math.max(1, Math.ceil(want / fuelEach(fuel.name)));
    const curFuel = furnace.fuelItem();
    if (!curFuel && fuelNeed > 0) {
      const fuelLeft = heldCount(bot, fuel.name);
      if (fuelLeft === 0) return `no ${fuel.name} left for fuel`;
      await furnace.putFuel(fuel.id, null, Math.min(fuelNeed, fuelLeft));
    }
    const deadline = Date.now() + (want * SMELT_SECONDS_PER_ITEM + 20) * 1e3;
    while (furnace.inputItem() && Date.now() < deadline) await sleep(3e3);
    if (furnace.outputItem()) {
      const got = await furnace.takeOutput();
      collected += got.count;
    }
    const remainingInput = furnace.inputItem();
    stillQueued = remainingInput ? remainingInput.count : 0;
  } finally {
    furnace.close();
  }
  const invLeft = await settleHeldCount(bot, itemName, held);
  const parts = [`smelted ${collected} ${itemName} at ${at} (fuel: ${fuel.name})`];
  if (stillQueued > 0) parts.push(`${stillQueued} still smelting inside \u2014 call mc_smelt again in ~${Math.ceil(stillQueued * SMELT_SECONDS_PER_ITEM)}s to collect`);
  if (invLeft > 0 && collected > 0) parts.push(`${invLeft} more ${itemName} in inventory \u2014 call mc_smelt again for the next batch`);
  return parts.join("; ");
}
async function viewFurnaceContent(bot, args) {
  const range = Math.max(1, Math.floor(Number(args.range ?? 16)));
  const block = findFurnaceBlock(bot, args, range);
  if (!block) {
    const c = findStorageBlock(bot, args, range);
    return c ? `that is a ${c.name}, not a furnace \u2014 use mc_view_chest` : "no furnace/blast furnace/smoker found nearby";
  }
  let furnace;
  try {
    furnace = await openFurnaceAt(bot, block);
  } catch (err) {
    return `failed to open furnace: ${err instanceof Error ? err.message : String(err)}`;
  }
  try {
    const at = `(${block.position.x}, ${block.position.y}, ${block.position.z})`;
    const inp = furnace.inputItem();
    const fu = furnace.fuelItem();
    const out = furnace.outputItem();
    const secsLeft = furnace.progressSeconds;
    const prog = typeof secsLeft === "number" && secsLeft > 0 ? `, ~${Math.ceil(secsLeft)}s left` : "";
    return [
      `${block.name} at ${at}:`,
      `- input: ${inp ? `${inp.name} x${inp.count}` : "empty"}`,
      `- fuel: ${fu ? `${fu.name} x${fu.count}` : "empty"}`,
      `- output: ${out ? `${out.name} x${out.count}` : "empty"}${prog}`,
      "smelt with mc_smelt (it also collects finished output)"
    ].join("\n");
  } finally {
    furnace.close();
  }
}
function findEnchantTable(bot, range = 16) {
  return bot.findBlock({
    matching: (b) => !!b && (b.name === "enchanting_table" || b.name === "enchantment_table"),
    maxDistance: range
  }) ?? null;
}
async function doEnchant(bot, args) {
  const itemName = String(args.itemType ?? "");
  if (!itemName) return "itemType is required";
  const inv = bot.inventory.items().find((i) => i.name === itemName);
  if (!inv) return `no ${itemName} in inventory`;
  const table = findEnchantTable(bot);
  if (!table) {
    return 'no enchanting table nearby \u2014 craft and place one first (mc_craft "enchanting_table", needs book + 2 diamonds + 4 obsidian)';
  }
  const lapis = bot.inventory.items().find((i) => i.name === "lapis_lazuli");
  if (!lapis) return "no lapis_lazuli in inventory \u2014 enchanting costs 1-3 lapis and experience levels";
  if (bot.experience.level < 1) return `not enough experience (level ${bot.experience.level}, need 1+)`;
  const reached = await gotoNear(bot, table.position, 2);
  if (!reached) return "could not reach the enchanting table";
  let et;
  try {
    et = await openWithRetry(() => bot.openEnchantmentTable(table));
  } catch (err) {
    return `failed to open enchanting table: ${err instanceof Error ? err.message : String(err)}`;
  }
  try {
    await et.putTargetItem(inv);
    await et.putLapis(lapis);
    const deadline = Date.now() + 1e4;
    while (et.enchantments.length === 0 && Date.now() < deadline) await sleep(500);
    const offers = et.enchantments;
    if (offers.length === 0) {
      return "the table offered no enchantments (item may be unenchantable or already enchanted) \u2014 took the item back";
    }
    let idx = 0;
    if (args.choice !== void 0 && args.choice !== null) {
      idx = Math.max(0, Math.min(offers.length - 1, Math.floor(Number(args.choice))));
    } else {
      const lvl = bot.experience.level;
      let bestLevel = -1;
      for (let i = 0; i < offers.length; i++) {
        if (offers[i].level <= lvl && offers[i].level > bestLevel) {
          bestLevel = offers[i].level;
          idx = i;
        }
      }
      if (bestLevel === -1) {
        return `all offers need more levels than you have (${bot.experience.level}) \u2014 took the item back`;
      }
    }
    const chosen = offers[idx];
    if (chosen.level > bot.experience.level) {
      return `option ${idx + 1} costs level ${chosen.level} but you have ${bot.experience.level}`;
    }
    await et.enchant(idx);
    const outItem = await et.takeTargetItem();
    return `enchanted ${itemName} with option ${idx + 1} (cost ${chosen.level} level${chosen.level > 1 ? "s" : ""} + lapis) -> ${outItem.name}`;
  } finally {
    et.close();
  }
}
async function tradeWithVillager(bot, tradeIndex, count) {
  const villager = bot.nearestEntity(
    (e) => e.name === "villager" && bot.entity.position.distanceTo(e.position) < 16
  );
  if (!villager) return "no villager nearby";
  const reached = await gotoNear(bot, villager.position, 1.5);
  if (!reached) return "could not reach the villager";
  await bot.lookAt(villager.position.offset(0, 1, 0), false);
  let v;
  try {
    v = await bot.openVillager(villager);
  } catch (err) {
    await bot.lookAt(villager.position.offset(0, 1, 0), false);
    try {
      v = await bot.openVillager(villager);
    } catch (err2) {
      return `failed to open villager trade: ${err2 instanceof Error ? err2.message : String(err2)}`;
    }
  }
  try {
    if (tradeIndex === void 0) {
      if (v.trades.length === 0) return "villager has no trades";
      const lines = v.trades.map((t2, i) => {
        const out = `${t2.outputItem.name} x${t2.outputItem.count}`;
        const in1 = `${t2.inputItem1.name} x${t2.inputItem1.count}`;
        const in2 = t2.inputItem2 ? ` + ${t2.inputItem2.name} x${t2.inputItem2.count}` : "";
        const uses = `${t2.nbTradeUses}/${t2.maximumNbTradeUses}`;
        const flag = t2.tradeDisabled ? " [DISABLED]" : "";
        return `#${i}: ${in1}${in2} -> ${out} (used ${uses})${flag}`;
      });
      return `villager trades:
${lines.join("\n")}`;
    }
    const t = v.trades[tradeIndex];
    if (!t) return `invalid trade index ${tradeIndex} (villager has ${v.trades.length} trades)`;
    if (t.tradeDisabled) return `trade #${tradeIndex} is disabled`;
    await bot.trade(v, tradeIndex, count);
    return `traded #${tradeIndex} x${count}: received ${t.outputItem.name} x${t.outputItem.count * count}`;
  } finally {
    v.close();
  }
}
var CHROME_PATH = process.env.CHROME_PATH || (process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : "/usr/bin/chromium");
var SHOTS_ROOT = resolve("./data/screenshots");
var seeBrowser = null;
var seePage = null;
async function seeFirstPersonViaPlaywright() {
  const port = Number(process.env.MC_VIEWER_PORT || 3001) + 100;
  const url = `http://127.0.0.1:${port}/`;
  if (!seePage || seePage.isClosed()) {
    if (seeBrowser) {
      try {
        await seeBrowser.close();
      } catch {
      }
    }
    if (!existsSync(CHROME_PATH)) {
      throw new Error(`no fallback browser at ${CHROME_PATH} (install one or set CHROME_PATH)`);
    }
    seeBrowser = await chromium.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"]
    });
    seePage = await seeBrowser.newPage({ viewport: { width: 640, height: 480 } });
    await seePage.goto(url, { waitUntil: "domcontentloaded", timeout: 15e3 });
    await seePage.waitForTimeout(1500);
  } else if (!seePage.url().startsWith(url)) {
    await seePage.goto(url, { waitUntil: "domcontentloaded", timeout: 15e3 });
    await seePage.waitForTimeout(1500);
  }
  await seePage.waitForTimeout(300);
  const buf = await seePage.screenshot({ type: "png" });
  return { dataUrl: "data:image/png;base64," + buf.toString("base64"), file: null };
}
async function seeFirstPerson(bot) {
  try {
    const shot = await captureFirstPerson(bot, SHOTS_ROOT);
    return { dataUrl: "data:image/jpeg;base64," + shot.buffer.toString("base64"), file: shot.file };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[mc-tools] camera capture failed, falling back to playwright: ${msg}`);
    try {
      return await seeFirstPersonViaPlaywright();
    } catch (pwErr) {
      const pwMsg = pwErr instanceof Error ? pwErr.message : String(pwErr);
      throw new Error(`mc_see unavailable \u2014 in-process camera: ${msg}; browser fallback: ${pwMsg}`);
    }
  }
}
function baseProtectRefusal(p, botPos) {
  try {
    const cfgPath = ["/app/data/base-protect.json", resolve(process.cwd(), "data/base-protect.json")].find(existsSync);
    if (!cfgPath) return null;
    const cfg = JSON.parse(readFileSync(cfgPath, "utf-8"));
    const r = cfg.r ?? 16;
    const d = Math.hypot(p.x - cfg.x, p.y - cfg.y, p.z - cfg.z);
    if (d <= r && p.distanceTo(botPos) > 2) {
      return `refused: (${p.x}, ${p.y}, ${p.z}) \u5728\u57FA\u5730\u4FDD\u62A4\u533A\u5185\uFF08r=${r} @ ${cfg.x},${cfg.y},${cfg.z}\uFF09\u3002\u57FA\u5730\u5468\u56F4${r}\u683C\u7981\u6B62\u6316\u6398\u53D6\u8D44\u6E90\u2014\u2014\u53BB${r}\u683C\u5916\u6316\uFF1B\u82E5\u786E\u9700\u6539\u5EFA\uFF0C\u8BF7\u5929\u795E\u8C03\u6574 data/base-protect.json\u3002`;
    }
  } catch {
  }
  return null;
}
async function digAt(bot, args) {
  const { x, y, z } = coordArgs(args);
  if (x === void 0 || y === void 0 || z === void 0) return "x, y, z are required";
  const target = new Vec32(x, y, z);
  const refusal = baseProtectRefusal(target, bot.entity.position);
  if (refusal) return refusal;
  let block = bot.blockAt(target);
  if (!block) return `cannot inspect block at (${x}, ${y}, ${z}) (chunk not loaded?)`;
  if (block.boundingBox === "empty") return `already air at (${x}, ${y}, ${z})`;
  if (block.diggable === false) {
    return `${block.name} at (${x}, ${y}, ${z}) cannot be dug (unbreakable)`;
  }
  if (bot.entity.position.distanceTo(target) > 4.5) {
    const reached = await gotoNear(bot, target, 3);
    if (!reached) return `could not get close enough to dig at (${x}, ${y}, ${z})`;
    block = bot.blockAt(target) ?? block;
    if (block.boundingBox === "empty") return `already air at (${x}, ${y}, ${z})`;
  }
  const before = bot.inventory.items().reduce((s, it) => s + it.count, 0);
  await bot.unequip("hand").catch(() => {
  });
  await bot.tool.equipForBlock(block);
  await bot.dig(block);
  await pickupNearby(bot);
  const after = bot.inventory.items().reduce((s, it) => s + it.count, 0);
  return `dug ${block.name} at (${x}, ${y}, ${z})` + (after > before ? " (picked up drops)" : "");
}
async function tunnelStep(bot, dirX, dirZ) {
  const pos = bot.entity.position;
  const feet = Math.floor(pos.y);
  const base = pos.floored();
  const ahead = new Vec32(base.x + dirX, feet, base.z + dirZ);
  for (const dy of [0, 1]) {
    const refusal = baseProtectRefusal(ahead.offset(0, dy, 0), pos);
    if (refusal) return refusal;
  }
  const below = bot.blockAt(ahead.offset(0, -1, 0));
  if (!below || below.boundingBox === "empty" || /water|lava|bubble/.test(below.name)) {
    return `stop: \u901A\u9053\u524D\u65B9\u811A\u4E0B\u662F ${below ? below.name : "\u672A\u52A0\u8F7D\u533A"}\u2014\u2014\u518D\u6316\u5C31\u662F\u60AC\u7A7A/\u6C34\u57DF\uFF0C\u6362\u4E2A\u65B9\u5411`;
  }
  const above = bot.blockAt(ahead.offset(0, 2, 0));
  if (above && /water|lava/.test(above.name)) {
    return `stop: \u901A\u9053\u4E0A\u65B9\u6709 ${above.name}\u2014\u2014\u6316\u7A7F\u4F1A\u6DF9/\u70EB\uFF0C\u6362\u4E2A\u65B9\u5411`;
  }
  for (let round2 = 0; round2 < 3; round2++) {
    let solidLeft = false;
    for (const dy of [0, 1]) {
      const cell = ahead.offset(0, dy, 0);
      const blk = bot.blockAt(cell);
      if (!blk) return `stop: \u533A\u5757\u672A\u52A0\u8F7D (${cell.x},${cell.y},${cell.z})`;
      if (blk.boundingBox === "empty") continue;
      if (blk.diggable === false) return `stop: ${blk.name} \u6316\u4E0D\u52A8\uFF08\u57FA\u5CA9\uFF1F\uFF09\uFF0C\u6362\u4E2A\u65B9\u5411`;
      await bot.unequip("hand").catch(() => {
      });
      await bot.tool.equipForBlock(blk);
      await bot.dig(blk);
      solidLeft = true;
    }
    if (!solidLeft) break;
    await sleep(400);
  }
  const target = new Vec32(ahead.x + 0.5, feet, ahead.z + 0.5);
  const reached = await gotoNear(bot, target, 0.9, 8e3);
  if (!reached) {
    const p = bot.entity.position;
    return `blocked: \u5DF2\u6316\u5F00 (${ahead.x},${ahead.y},${ahead.z}) \u4F46\u8D70\u4E0D\u8FDB\u53BB\uFF08\u73B0 ${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}\uFF09\u2014\u2014\u53EF\u518D\u8BD5\u4E00\u6B21\u6216\u6362\u65B9\u5411`;
  }
  return "ok";
}
function apply2(ctx2) {
  const log = (msg) => console.log(`[mc-tools] ${msg}`);
  pluginCtx = ctx2;
  try {
    mkdirSync(EPISODIC_DIR, { recursive: true });
  } catch {
  }
  ctx2.tools.register(defineTool({
    name: "mc_status",
    description: "Get the bot's current state: position, health, food, held item and inventory.",
    parameters: {},
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    execute: guard(async (bot) => {
      const p = bot.entity.position;
      const items = bot.inventory.items().map((i) => `${i.name} x${i.count}`);
      return JSON.stringify({
        position: { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) },
        health: bot.health,
        food: bot.food,
        heldItem: bot.heldItem ? bot.heldItem.name : null,
        inventory: items
      });
    })
  }));
  ctx2.tools.register(defineTool({
    name: "mc_goto",
    description: "Pathfind to the given coordinates (e.g. a chest, bed or mining spot).",
    parameters: {
      x: { type: "number", required: true, description: "target x coordinate" },
      y: { type: "number", required: true, description: "target y coordinate" },
      z: { type: "number", required: true, description: "target z coordinate" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 6e4,
    execute: guard(async (bot, args) => {
      const { x, y, z } = args;
      const target = new Vec32(x, y, z);
      log(`goto (${x}, ${y}, ${z})`);
      const reached = await gotoNear(bot, target, 3, 3e4);
      const p = bot.entity.position;
      const dist = p.distanceTo(target);
      if (!reached) {
        return `failed to reach (${x}, ${y}, ${z}); stopped at (${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)})`;
      }
      let msg = `reached (${x}, ${y}, ${z}) \u2014 now at (${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)}), ${dist.toFixed(1)} blocks away`;
      if (dist > 1.5) msg += " (within pathfinder reach but not standing at it; \u76EE\u6807\u9700\u8981\u8DF3\u8DC3\u624D\u80FD\u5230\u8FBE\u65F6\u5BFB\u8DEF\u5E38\u5931\u6548\u2014\u2014\u7528 mc_tunnel \u6316\u5E73\u76F4\u901A\u9053\u63A5\u8FD1\uFF0C\u6216 mc_place \u81EA\u884C\u57AB\u8DEF)";
      return msg;
    })
  }));
  ctx2.tools.register(defineTool({
    name: "mc_tunnel",
    description: "\u6CBF\u6307\u5B9A\u65B9\u5411\u6316\u4E00\u6761\u6C34\u5E73\u7684 2 \u683C\u9AD8\u901A\u9053\u5E76\u9010\u683C\u524D\u8FDB\uFF08\u9ED8\u8BA4 8 \u683C\uFF09\u2014\u2014\u8131\u56F0\u4E13\u7528\uFF1A\u7EAF\u5E73\u5730\u884C\u8D70\u3001\u5B8C\u5168\u4E0D\u4F9D\u8D56\u8DF3\u8DC3\uFF0C\u5751\u5E95/\u5730\u4E0B/\u88AB\u65B9\u5757\u56F4\u4F4F/\u5BFB\u8DEF\u53CD\u590D\u5931\u8D25\u65F6\uFF0C\u4E00\u6B21\u8C03\u7528\u5C31\u53D6\u5F97\u786E\u5B9A\u8FDB\u5C55\u3002\u5148\u7528 mc_look \u770B\u6E05\u56DB\u5468\uFF08\u907F\u5F00\u6C34/\u5CA9\u6D46\u3001\u6311\u5730\u5F62\u4E0B\u5761\u7684\u4E00\u4FA7\uFF09\uFF0C\u518D\u9009\u65B9\u5411\u5F00\u6316\uFF1B\u6316\u5230\u9732\u5929\u6216\u8D70\u4E0D\u901A\u4F1A\u5982\u5B9E\u62A5\u544A\u3002\u4E5F\u9002\u5408\u666E\u901A\u6398\u8FDB\uFF08\u91C7\u77F3/\u6316\u8D70\u5ECA\uFF09\u3002",
    parameters: {
      direction: { type: "string", required: true, description: "east(\u4E1C+x) / west(\u897F-x) / south(\u5357+z) / north(\u5317-z)" },
      length: { type: "number", description: "\u6316\u51E0\u683C\uFF0C\u9ED8\u8BA4 8\uFF0C\u4E0A\u9650 24" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 3e5,
    execute: guard(async (bot, args) => {
      const dirMap = { east: [1, 0], west: [-1, 0], south: [0, 1], north: [0, -1] };
      const d = String(args.direction ?? "").toLowerCase();
      const v = dirMap[d];
      if (!v) return "direction \u5FC5\u987B\u662F east / west / south / north";
      const n = Math.max(1, Math.min(24, Math.floor(Number(args.length ?? 8))));
      const startY = Math.floor(bot.entity.position.y);
      let dug = 0;
      for (let i = 0; i < n; i++) {
        const r = await tunnelStep(bot, v[0], v[1]);
        if (r !== "ok") {
          const p2 = bot.entity.position;
          return `${r}\u3002\u672C\u6B21\u6CBF ${d} \u5171\u524D\u8FDB ${dug} \u683C\uFF0C\u73B0\u4F4D\u4E8E (${Math.round(p2.x)}, ${Math.round(p2.y)}, ${Math.round(p2.z)})`;
        }
        dug++;
      }
      const p = bot.entity.position;
      let openSky = false;
      try {
        for (let y = Math.floor(p.y) + 2; y < Math.floor(p.y) + 12; y++) {
          const blk = bot.blockAt(new Vec32(Math.floor(p.x), y, Math.floor(p.z)));
          if (!blk) break;
          if (blk.boundingBox !== "empty") {
            openSky = false;
            break;
          }
          openSky = true;
        }
      } catch {
      }
      return `\u5DF2\u6CBF ${d} \u6316\u8FDB ${dug} \u683C\uFF08y=${startY} \u5C42\uFF09\uFF0C\u73B0\u4F4D\u4E8E (${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)})${openSky ? "\u2014\u2014\u5934\u9876\u5DF2\u9732\u5929\uFF0C\u8131\u56F0\u5728\u671B\uFF1A\u7EE7\u7EED\u5411\u524D\u6216\u57AB\u65B9\u5757\u4E0A\u6765" : "\u3002\u82E5\u4ECD\u672A\u8131\u56F0\uFF0Cmc_look \u89C2\u5BDF\u540E\u6362\u65B9\u5411\u7EE7\u7EED mc_tunnel\uFF0C\u6216\u6CBF\u901A\u9053\u8D70\u5230\u5E95"}\uFF1B\u6316\u5230\u7684\u6389\u843D\u7269\u5DF2\u968F\u624B\u6361\u8D77`;
    })
  }));
  ctx2.tools.register(defineTool({
    name: "mc_collect",
    description: 'Collect blocks of a type (e.g. "oak_log", "coal_ore", "cobblestone"). The bot walks to the nearest one, mines it and picks up the drops. Returns how many were collected.',
    parameters: {
      blockType: { type: "string", required: true, description: 'block name, e.g. "oak_log" or "coal_ore"' },
      count: { type: "number", description: "how many blocks to collect (default 1)" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 12e4,
    execute: guard(async (bot, args) => {
      const blockType = String(args.blockType ?? "");
      const num = Math.max(1, Math.floor(Number(args.count ?? 1)));
      if (!blockType) return "blockType is required";
      const feetY = Math.floor(bot.entity.position.y) - 1;
      let collected = 0;
      for (let i = 0; i < num; i++) {
        let block = bot.findBlock({
          matching: (b) => {
            if (!b || b.name !== blockType) return false;
            if (!b.position) return true;
            return b.position.y >= feetY;
          },
          maxDistance: 48
        });
        if (!block) {
          block = bot.findBlock({
            matching: (b) => !!b && b.name === blockType,
            maxDistance: 48
          });
        }
        if (!block) break;
        const before = bot.inventory.items().reduce((s, it) => s + it.count, 0);
        await bot.unequip("hand").catch(() => {
        });
        await bot.tool.equipForBlock(block);
        const reached = await gotoNear(bot, block.position, 3);
        if (!reached) break;
        try {
          await bot.dig(block);
          await pickupNearby(bot);
          const after = bot.inventory.items().reduce((s, it) => s + it.count, 0);
          if (after > before) collected++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log(`failed to dig ${blockType}: ${msg}`);
          break;
        }
      }
      const pick = bot.inventory.items().find((it) => it.name.includes("pickaxe"));
      if (pick) await bot.equip(pick, "hand").catch(() => {
      });
      return `collected ${collected} ${blockType}`;
    })
  }));
  ctx2.tools.register(defineTool({
    name: "mc_dig",
    description: "Dig (break) the block at the EXACT given coordinates, then pick up nearby drops. The escape primitive when stuck: dig the block above your head or beside you (use mc_look first to find the blocking coordinates). Warning: digging straight down below your own feet can drop you into caves or lava.",
    parameters: {
      x: { type: "number", required: true, description: "target x coordinate" },
      y: { type: "number", required: true, description: "target y coordinate" },
      z: { type: "number", required: true, description: "target z coordinate" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 6e4,
    execute: guard(async (bot, args) => digAt(bot, args))
  }));
  ctx2.tools.register(defineTool({
    name: "mc_place",
    description: "Place a block from the inventory at the given coordinates. The bot stands next to it and places it against an adjacent solid block.",
    parameters: {
      blockType: { type: "string", required: true, description: 'block/item name, e.g. "oak_planks" or "torch"' },
      x: { type: "number", required: true, description: "target x coordinate" },
      y: { type: "number", required: true, description: "target y coordinate" },
      z: { type: "number", required: true, description: "target z coordinate" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 6e4,
    execute: guard(async (bot, args) => {
      const blockType = String(args.blockType ?? "");
      const target = new Vec32(Math.floor(Number(args.x)), Math.floor(Number(args.y)), Math.floor(Number(args.z)));
      const item = bot.inventory.items().find((i) => i.name === blockType);
      if (!item) return `no ${blockType} in inventory`;
      const occupied = bot.blockAt(target);
      if (occupied && !["air", "water", "lava", "grass", "short_grass", "tall_grass"].includes(occupied.name)) {
        return `${occupied.name} is in the way at (${target.x}, ${target.y}, ${target.z})`;
      }
      const dirs = [
        new Vec32(0, -1, 0),
        new Vec32(0, 1, 0),
        new Vec32(0, 0, -1),
        new Vec32(0, 0, 1),
        new Vec32(-1, 0, 0),
        new Vec32(1, 0, 0)
      ];
      let refBlock = null;
      let faceVec = null;
      for (const d of dirs) {
        const b = bot.blockAt(target.plus(d));
        if (b && !["air", "water", "lava", "grass", "short_grass", "tall_grass"].includes(b.name)) {
          refBlock = b;
          faceVec = new Vec32(-d.x, -d.y, -d.z);
          break;
        }
      }
      if (!refBlock || !faceVec) return "nothing solid to place the block against";
      if (bot.entity.position.distanceTo(target) > 4) {
        const reached = await gotoNear(bot, target, 3);
        if (!reached) return "could not get close enough to place the block";
      }
      await bot.equip(item, "hand");
      await bot.lookAt(refBlock.position.offset(0.5, 0.5, 0.5));
      await bot.placeBlock(refBlock, faceVec);
      await sleep(150);
      return `placed ${blockType} at (${target.x}, ${target.y}, ${target.z})`;
    })
  }));
  ctx2.tools.register(defineTool({
    name: "mc_attack",
    description: 'Attack the nearest mob of a type (e.g. "zombie", "creeper", "skeleton"). Optionally keep attacking until it dies.',
    parameters: {
      mobType: { type: "string", required: true, description: 'mob name, e.g. "zombie"' },
      kill: { type: "boolean", description: "keep attacking until dead (default true)" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 6e4,
    execute: guard(async (bot, args) => {
      const mobType = String(args.mobType ?? "");
      const kill = args.kill !== false;
      const mob = bot.nearestEntity(
        (e) => e.name === mobType && bot.entity.position.distanceTo(e.position) < 24
      );
      if (!mob) return `no ${mobType} nearby`;
      await equipBestWeapon(bot);
      if (!kill) {
        await bot.lookAt(mob.position);
        bot.attack(mob);
        return `attacked ${mobType} once`;
      }
      let hits = 0;
      while (mob.isValid && hits < 60) {
        if (!bot.entity) break;
        if (bot.entity.position.distanceTo(mob.position) > 3) {
          await gotoNear(bot, mob.position, 2);
        }
        await bot.lookAt(mob.position);
        try {
          bot.attack(mob);
          hits++;
        } catch {
          break;
        }
        await sleep(600);
      }
      return `attacked ${mobType} ${hits} time(s); ${mob.isValid ? "still alive" : "killed"}`;
    })
  }));
  ctx2.tools.register(defineTool({
    name: "mc_pickup",
    description: "Walk to and pick up dropped items near the bot.",
    parameters: {},
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    execute: guard(async (bot) => {
      await pickupNearby(bot);
      return "picked up nearby items";
    })
  }));
  ctx2.tools.register(defineTool({
    name: "mc_craft",
    description: 'Craft an item (e.g. "wooden_pickaxe", "crafting_table", "stick", "oak_planks", "stone_pickaxe"). If the recipe needs a crafting table, the bot walks to the nearest one. Reports what was crafted or which ingredients are missing.',
    parameters: {
      itemType: { type: "string", required: true, description: 'item name to craft, e.g. "wooden_pickaxe" or "crafting_table"' },
      count: { type: "number", description: "how many times to run the recipe (default 1)" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 6e4,
    execute: guard(async (bot, args) => {
      const itemName = String(args.itemType ?? "");
      const count = Math.max(1, Math.floor(Number(args.count ?? 1)));
      if (!itemName) return "itemType is required";
      log(`craft ${count} ${itemName}`);
      return craftItem(bot, itemName, count);
    })
  }));
  ctx2.tools.register(defineTool({
    name: "mc_equip",
    description: 'Equip an item from the inventory, e.g. "wooden_pickaxe" or "stone_axe". Default destination is the hand; armor goes to head/torso/legs/feet.',
    parameters: {
      itemType: { type: "string", required: true, description: 'item name to equip, e.g. "wooden_pickaxe"' },
      destination: { type: "string", description: 'where to equip: "hand" (default), "head", "torso", "legs", "feet", "off-hand"' }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 3e4,
    execute: guard(async (bot, args) => {
      const itemName = String(args.itemType ?? "");
      const destination = String(args.destination ?? "hand");
      if (!itemName) return "itemType is required";
      const valid = ["hand", "head", "torso", "legs", "feet", "off-hand"];
      if (!valid.includes(destination)) return `invalid destination: ${destination}`;
      const item = bot.inventory.items().find((i) => i.name === itemName);
      if (!item) return `no ${itemName} in inventory`;
      await bot.equip(item, destination);
      return `equipped ${itemName} to ${destination}`;
    })
  }));
  ctx2.tools.register(defineTool({
    name: "mc_eat",
    description: "Eat a food item to restore hunger and (over time) health. The bot equips the food and consumes it. Omit itemType to auto-pick the most filling food available.",
    parameters: {
      itemType: { type: "string", description: 'food item name to eat, e.g. "cooked_beef", "apple", "rotten_flesh". Omit to auto-pick the best food.' }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 6e4,
    execute: guard(async (bot, args) => {
      const itemName = String(args.itemType ?? "");
      let item;
      if (itemName) {
        item = bot.inventory.items().find((i) => i.name === itemName);
        if (!item) return `no ${itemName} in inventory`;
      } else {
        const foods = bot.inventory.items().filter((i) => {
          const reg = bot.registry.itemsByName[i.name];
          return reg && typeof reg.foodPoints === "number" && reg.foodPoints > 0;
        });
        if (foods.length === 0) return "no food in inventory";
        foods.sort((a, b) => {
          const ap = bot.registry.itemsByName[a.name]?.foodPoints ?? 0;
          const bp = bot.registry.itemsByName[b.name]?.foodPoints ?? 0;
          return bp - ap;
        });
        item = foods[0];
      }
      const foodPoints = bot.registry.itemsByName[item.name]?.foodPoints ?? 0;
      await bot.equip(item, "hand");
      try {
        await bot.consume();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("Food is full")) return "food is already full";
        return `could not eat ${item.name}: ${msg}`;
      }
      return `ate ${item.name} (+${foodPoints} food); food now ${Math.round(bot.food)}/20`;
    })
  }));
  ctx2.tools.register(defineTool({
    name: "mc_chat",
    description: "\u5168\u670D\u516C\u5C4F\u5E7F\u64AD\uFF08\u6574\u4E2A\u4E16\u754C\u90FD\u542C\u89C1\u7684\u5927\u5587\u53ED\uFF09\u2014\u2014\u91CD\u5927\u5BA3\u544A\u624D\u7528\uFF0C\u5982\u81EA\u6211\u4ECB\u7ECD\u3001\u91CD\u8981\u53D1\u73B0\u3001\u96C6\u7ED3\u547C\u558A\u3002\u65E5\u5E38\u548C\u8EAB\u8FB9\u7684\u540C\u4F34\u8BF4\u8BDD\u7528 mc_voice\uFF08\u6709\u8DDD\u79BB\u611F\uFF1A\u8BF448\u683C/\u558A96\u683C/\u6084\u60846\u683C\uFF09\uFF1B\u5BF9\u67D0\u4E2A\u4EBA\u8BF4\u79C1\u8BDD\u4E14\u4E0D\u7BA1\u8DDD\u79BB\u65F6\uFF0C\u586B to \u53C2\u6570\uFF08\u79C1\u8BED\u76F4\u8FBE\uFF0C\u53EA\u6709\u5BF9\u65B9\u542C\u5F97\u89C1\uFF09\uFF1B\u7ED9\u79BB\u7EBF/\u8FDC\u65B9\u7684\u4EBA\u7559\u8A00\u7528 mc_mail\uFF08\u4E66\u4FE1\uFF09\u3002",
    parameters: {
      message: { type: "string", description: "the message to say in chat" },
      to: { type: "string", description: "\u79C1\u8BED\u76F4\u8FBE\uFF1A\u5BF9\u65B9\u6E38\u620FID\u3002\u586B\u4E86\u5C31\u53EA\u5BF9\u8FD9\u4E2A\u4EBA\u8BF4\uFF08\u4E0D\u9650\u8DDD\u79BB\uFF09\uFF0C\u7559\u7A7A\u5219\u516C\u5C4F\u5E7F\u64AD" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    execute: guard(async (bot, args) => {
      const msg = String(args.message ?? "").trim();
      if (!msg) return "no message";
      const to = String(args.to ?? "").trim();
      if (to) {
        try {
          bot.whisper(to, msg);
          return `whispered to ${to}: ${msg}`;
        } catch {
          return `whisper to ${to} failed (connection error)`;
        }
      }
      bot.chat(msg);
      return `said: ${msg}`;
    })
  }));
  ctx2.tools.register(defineTool({
    name: "mc_view_chest",
    description: "Look inside a chest or barrel and list its contents. If x/y/z are given, opens that exact block; otherwise opens the nearest one within range.",
    parameters: {
      x: { type: "number", description: "chest x coordinate (optional)" },
      y: { type: "number", description: "chest y coordinate (optional)" },
      z: { type: "number", description: "chest z coordinate (optional)" },
      range: { type: "number", description: "search radius for the nearest chest (default 16)" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 6e4,
    execute: guard(async (bot, args) => viewChest(bot, args))
  }));
  ctx2.tools.register(defineTool({
    name: "mc_put_chest",
    description: `Deposit items from the bot's inventory into a chest or barrel. If x/y/z are given, targets that chest; otherwise the nearest one. Deposits "count" of itemType (default: all of that type).`,
    parameters: {
      itemType: { type: "string", required: true, description: 'item name to deposit, e.g. "oak_log" or "cobblestone"' },
      count: { type: "number", description: "how many to deposit (default: all)" },
      x: { type: "number", description: "chest x coordinate (optional)" },
      y: { type: "number", description: "chest y coordinate (optional)" },
      z: { type: "number", description: "chest z coordinate (optional)" },
      range: { type: "number", description: "search radius for the nearest chest (default 16)" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 6e4,
    execute: guard(async (bot, args) => transferWithChest(bot, args, "deposit"))
  }));
  ctx2.tools.register(defineTool({
    name: "mc_take_chest",
    description: `Withdraw items from a chest or barrel into the bot's inventory. If x/y/z are given, targets that chest; otherwise the nearest one. Withdraws "count" of itemType (default: all available).`,
    parameters: {
      itemType: { type: "string", required: true, description: 'item name to withdraw, e.g. "coal" or "iron_ingot"' },
      count: { type: "number", description: "how many to withdraw (default: all available)" },
      x: { type: "number", description: "chest x coordinate (optional)" },
      y: { type: "number", description: "chest y coordinate (optional)" },
      z: { type: "number", description: "chest z coordinate (optional)" },
      range: { type: "number", description: "search radius for the nearest chest (default 16)" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 6e4,
    execute: guard(async (bot, args) => transferWithChest(bot, args, "withdraw"))
  }));
  ctx2.tools.register(defineTool({
    name: "mc_smelt",
    description: "Smelt items (e.g. raw_iron -> iron_ingot, raw food -> cooked food) in the nearest furnace, blast furnace or smoker. Loads input + fuel, waits, and collects the finished output into inventory. Max 6 items per call; call again for more. Also collects any finished output first.",
    parameters: {
      itemType: { type: "string", required: true, description: 'raw item to smelt, e.g. "raw_iron" or "raw_beef"' },
      count: { type: "number", description: "how many to smelt this batch, max 6 (default: as many as held)" },
      fuelType: { type: "string", description: "fuel item name (default: auto-pick coal/charcoal/planks/logs)" },
      x: { type: "number", description: "furnace x coordinate (optional)" },
      y: { type: "number", description: "furnace y coordinate (optional)" },
      z: { type: "number", description: "furnace z coordinate (optional)" },
      range: { type: "number", description: "search radius for the nearest furnace (default 16)" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 12e4,
    execute: guard(async (bot, args) => doSmelt(bot, args))
  }));
  ctx2.tools.register(defineTool({
    name: "mc_view_furnace",
    description: "Look inside the nearest furnace / blast furnace / smoker: input, fuel, output and remaining smelt time. Does not take anything (mc_smelt collects output).",
    parameters: {
      x: { type: "number", description: "furnace x coordinate (optional)" },
      y: { type: "number", description: "furnace y coordinate (optional)" },
      z: { type: "number", description: "furnace z coordinate (optional)" },
      range: { type: "number", description: "search radius for the nearest furnace (default 16)" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 6e4,
    execute: guard(async (bot, args) => viewFurnaceContent(bot, args))
  }));
  ctx2.tools.register(defineTool({
    name: "mc_enchant",
    description: "Enchant a held item at the nearest enchanting table. Costs 1-3 lapis_lazuli and experience levels. Without choice, auto-picks the strongest offer you can afford; with choice (0/1/2), takes that specific offer.",
    parameters: {
      itemType: { type: "string", required: true, description: 'item to enchant from inventory, e.g. "iron_sword" (must be unenchanted)' },
      choice: { type: "number", description: "offer index 0/1/2 (optional, default: strongest affordable)" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 6e4,
    execute: guard(async (bot, args) => doEnchant(bot, args))
  }));
  ctx2.tools.register(defineTool({
    name: "mc_trade",
    description: 'Trade with the nearest villager. Without tradeIndex, lists the available trades. With tradeIndex, executes that trade "count" times (default 1).',
    parameters: {
      tradeIndex: { type: "number", description: "which trade to execute (omit to list trades first)" },
      count: { type: "number", description: "how many times to run the trade (default 1)" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 6e4,
    execute: guard(async (bot, args) => {
      const tradeIndex = args.tradeIndex === void 0 || args.tradeIndex === null ? void 0 : Math.floor(Number(args.tradeIndex));
      const count = Math.max(1, Math.floor(Number(args.count ?? 1)));
      return tradeWithVillager(bot, tradeIndex, count);
    })
  }));
  ctx2.tools.register(defineTool({
    name: "mc_sleep",
    description: "\u5728\u5929\u9ED1\u6216\u96F7\u96E8\u65F6\u627E\u5230\u9644\u8FD1\u7684\u5E8A\u5E76\u8EBA\u4E0B\u7761\u89C9\uFF0C\u4E00\u89C9\u7761\u5230\u5929\u4EAE\uFF0C\u5B89\u5168\u8DF3\u8FC7\u5371\u9669\u7684\u9ED1\u591C\u3002\u767D\u5929\u4E0D\u80FD\u7761\u3002\u5982\u679C\u9644\u8FD1\u6CA1\u6709\u5E8A\uFF0C\u5148\u60F3\u529E\u6CD5\u5F04\u4E00\u5F20\uFF08\u653E\u4E00\u5F20\u5E8A\uFF0C\u6216\u7948\u613F\u5929\u795E\u8D50\u4E00\u5F20\u5E8A\uFF09\u3002",
    parameters: {},
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 6e4,
    execute: guard(async (bot) => {
      const bed = bot.findBlock({
        matching: (b) => !!b && (b.name === "bed" || b.name.endsWith("_bed")),
        maxDistance: 48
      });
      if (!bed) return "\u9644\u8FD1 48 \u683C\u5185\u6CA1\u6709\u5E8A\u3002\u53EF\u4EE5\u5148\u7528 mc_place \u653E\u4E00\u5F20\u5E8A\uFF08\u82E5\u80CC\u5305\u91CC\u6709\uFF09\uFF0C\u6216 mc_pray \u5411\u5929\u795E\u7948\u613F\u8D50\u4E00\u5F20\u5E8A";
      const reached = await gotoNear(bot, bed.position, 2);
      if (!reached) return "\u8D70\u4E0D\u5230\u5E8A\u65C1\u8FB9\uFF0C\u65E0\u6CD5\u5165\u7761";
      try {
        await bot.sleep(bed);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `\u65E0\u6CD5\u5165\u7761\uFF1A${msg}`;
      }
      return "\u5DF2\u8EBA\u4E0B\u5165\u7761\uFF0C\u4E00\u89C9\u7761\u5230\u5929\u4EAE\uFF08\u5929\u4EAE\u81EA\u52A8\u9192\u6765\u540E\u7EE7\u7EED\u884C\u52A8\uFF09";
    })
  }));
  ctx2.tools.register(defineTool({
    name: "mc_look",
    description: "\u73AF\u987E\u56DB\u5468\uFF1A\u9762\u5411\u4EC0\u4E48\u3001\u773C\u524D\u65B9\u5757\u3001\u5934\u9876\u6709\u6CA1\u6709\u9732\u5929\u51FA\u53E3\uFF08\u5361\u5751\u81EA\u6551\u5173\u952E\uFF09\u3001\u56DB\u9762\u73AF\u5883\u3001\u811A\u4E0B\u5730\u8D28\u3001\u9644\u8FD1\u6C34/\u5CA9\u6D46\u7B49\u5371\u9669\u3001\u9644\u8FD1\u5B9E\u4F53\u3002\u7EAF\u6587\u5B57\u96F7\u8FBE\uFF0C\u6781\u5FEB\uFF0C\u96F6\u6D88\u8017\u3002\u8FF7\u8DEF\u3001\u5361\u4F4F\u3001\u8FDB\u5165\u964C\u751F\u5730\u5F62\u65F6\u5148\u7528\u5B83\u3002",
    parameters: {},
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    execute: guard(async (bot) => {
      const pos = bot.entity.position.floored();
      const headY = pos.y + 1;
      const yaw = bot.entity.yaw;
      const dx = -Math.sin(yaw);
      const dz = -Math.cos(yaw);
      const cardinal = Math.abs(dx) > Math.abs(dz) ? dx > 0 ? "\u4E1C (+X)" : "\u897F (-X)" : dz > 0 ? "\u5357 (+Z)" : "\u5317 (-Z)";
      let lookingAt = { block: null };
      try {
        const b = bot.blockInSight(24, 5 / 16);
        if (b) {
          lookingAt = {
            block: b.name,
            distance: Math.round(bot.entity.position.distanceTo(b.position) * 10) / 10,
            position: [b.position.x, b.position.y, b.position.z]
          };
        }
      } catch {
      }
      let firstOpening = null;
      let openSky = true;
      const maxY = Math.min(headY + 64, 319);
      for (let y = headY + 1; y <= maxY; y++) {
        const b1 = bot.blockAt(new Vec32(pos.x, y, pos.z));
        const b2 = bot.blockAt(new Vec32(pos.x, y + 1, pos.z));
        const solid1 = !!b1 && b1.boundingBox !== "empty";
        const solid2 = !!b2 && b2.boundingBox !== "empty";
        if (solid1 || solid2) {
          openSky = false;
        }
        if (firstOpening === null && !solid1 && !solid2) {
          firstOpening = y;
        }
      }
      const blocksAboveHead = firstOpening !== null ? firstOpening - headY : null;
      const dirs = [["\u4E1C", 2, 0], ["\u5357", 0, 2], ["\u897F", -2, 0], ["\u5317", 0, -2]];
      const surroundings = {};
      for (const [label, ox, oz] of dirs) {
        const b = bot.blockAt(new Vec32(pos.x + ox, pos.y + 1, pos.z + oz));
        surroundings[label] = b && b.boundingBox !== "empty" ? `${b.name} \u6321\u8DEF` : "\u5F00\u9614";
      }
      const hazards = [];
      try {
        for (const name15 of ["water", "lava", "flowing_water", "flowing_lava"]) {
          const hb = bot.findBlock({
            matching: (b) => !!b && b.name === name15,
            maxDistance: 8
          });
          if (hb) {
            const d = Math.round(bot.entity.position.distanceTo(hb.position));
            hazards.push(`${name15 === "lava" || name15 === "flowing_lava" ? "\u5CA9\u6D46" : "\u6C34"} ${d}\u683C ${hb.position.x},${hb.position.y},${hb.position.z}`);
          }
        }
      } catch {
      }
      const entities = Object.values(bot.entities).filter((e) => e && e !== bot.entity && e.name && e.position && bot.entity.position.distanceTo(e.position) <= 16).sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position)).slice(0, 6).map((e) => {
        const d = Math.round(bot.entity.position.distanceTo(e.position));
        const label = e.username ? `${e.username}(player)` : e.displayName ?? e.name;
        return `${label}(${d}\u683C)`;
      });
      const under = bot.blockAt(pos.offset(0, -1, 0));
      const inBlock = bot.blockAt(pos.offset(0, 0, 0));
      let hint = "";
      if (firstOpening === null) hint = "\u4F60\u5934\u9876\u88AB\u5C01\u6B7B\uFF0864\u683C\u5185\u65E0\u5F00\u53E3\uFF09\uFF0C\u57AB\u65B9\u5757\u4E0A\u4E0D\u53BB\uFF1A\u7528 mc_dig \u671D\u4E1C/\u5357/\u897F/\u5317\u4EFB\u4E00\u65B9\u5411\u9010\u683C\u6A2A\u5411\u6316\u901A\u9053\u51FA\u53BB\uFF0C\u771F\u6316\u4E0D\u52A8\u518D\u548F\u5531\u6C42\u6551";
      else if (blocksAboveHead > 3) hint = `\u4F60\u5728\u5751\u5E95/\u6D1E\u91CC\uFF0C\u5934\u9876 ${blocksAboveHead} \u683C\uFF08y=${firstOpening}\uFF09\u6709\u5F00\u53E3\uFF08\u90A3\u662F\u51FA\u8DEF\uFF0C\u4E0D\u662F\u88AB\u5C01\u6B7B\uFF09\uFF1A\u53EF\u4EE5 mc_dig \u5411\u4E0A\u6316\u3001\u6216\u57AB\u65B9\u5757\u642D\u67F1\u51FA\u53BB`;
      else if (openSky) hint = "\u5934\u9876\u9732\u5929\uFF0C\u89C6\u91CE\u826F\u597D";
      else hint = `\u4F60\u5728\u6D45\u5751/\u6D1E\u53E3\u4E0B\uFF0C\u5934\u9876\u4EC5 ${blocksAboveHead} \u683C\uFF08y=${firstOpening}\uFF09\u5C31\u6709\u5F00\u53E3\uFF08\u90A3\u662F\u51FA\u8DEF\uFF0C\u4E0D\u662F\u88AB\u5C01\u6B7B\uFF09\uFF1A\u56DB\u5468\u6321\u8DEF\u7684\u65B9\u5757\u7528 mc_dig \u6316\u5F00\u5373\u53EF\u8D70\u51FA\u53BB\uFF1B\u60F3\u5782\u76F4\u4E0A\u53BB\u5C31\u671D\u811A\u4E0B mc_place \u57AB\u65B9\u5757\u642D\u53F0\u9636`;
      return JSON.stringify({
        facing: cardinal,
        lookingAt,
        headroom: { openSky, firstOpeningY: firstOpening, blocksAboveHead },
        surroundings,
        ground: under ? under.name : "unknown",
        bodyIn: inBlock && inBlock.boundingBox !== "empty" ? inBlock.name : "air",
        hazards: hazards.length ? hazards : [],
        entities: entities.length ? entities : [],
        hint
      });
    })
  }));
  ctx2.tools.register(defineTool({
    name: "mc_see",
    description: "\u7741\u5F00\u773C\u775B\uFF1A\u622A\u53D6\u4F60\u7B2C\u4E00\u4EBA\u79F0\u89C6\u89D2\u7684\u771F\u5B9E\u6E38\u620F\u753B\u9762\uFF08800x512\uFF09\uFF0C\u753B\u9762\u4F1A\u9644\u5728\u4E0B\u4E00\u8F6E\u89C2\u5BDF\u91CC\u4F9B\u4F60\u4EB2\u773C\u67E5\u770B\u3002\u9ED8\u8BA4\u53EA\u62CD\u5F53\u524D\u671D\u5411\u4E00\u5F20\uFF1B\u60F3\u73AF\u987E\u56DB\u5468\u67E5\u5A01\u80C1/\u627E\u8DEF\u65F6\u4F20 look=around\uFF0C\u4F1A\u539F\u5730\u6309 \u524D\u2192\u53F3\u2192\u540E\u2192\u5DE6 \u62CD\u56DB\u5F20\u62FC\u6210360\xB0\u5168\u666F\uFF08token \u6D88\u8017\u7EA64\u500D\uFF0C\u522B\u6BCF\u8F6E\u90FD\u7528\uFF09\u3002\u8017\u65F6\u7EA6 1-4 \u79D2\u3002",
    parameters: {
      look: { type: "string", description: "front=\u53EA\u62CD\u5F53\u524D\u671D\u5411\uFF08\u9ED8\u8BA4\uFF09\uFF1Baround=\u73AF\u987E\u56DB\u5468\u56DB\u8FDE\u62CD" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text(value) },
    timeoutMs: 3e4,
    execute: guard(async (bot, args) => {
      const mode = String(args.look ?? "front");
      if (mode === "around") {
        try {
          const shots = await captureLookaround(bot, SHOTS_ROOT);
          setLastImages(shots.map((s) => ({
            dataUrl: "data:image/jpeg;base64," + s.buffer.toString("base64"),
            file: s.file,
            label: s.label
          })));
          return "\u5DF2\u73AF\u987E\u56DB\u5468\uFF1A\u524D/\u53F3/\u540E/\u5DE6 \u56DB\u5F20\u753B\u9762\u5C06\u5728\u4F60\u7684\u4E0B\u4E00\u6B21\u89C2\u5BDF\u4E2D\u6309\u987A\u5E8F\u9644\u4E0A\u2014\u2014\u8BF7\u7ED3\u5408\u56DB\u9762\u753B\u9762\u51B3\u7B56\u3002";
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const { dataUrl: dataUrl2, file: file2 } = await seeFirstPerson(bot);
          setLastImage(dataUrl2, file2);
          return `\u73AF\u89C6\u5931\u8D25\uFF08${msg}\uFF09\uFF0C\u5DF2\u9000\u56DE\u62CD\u6444\u5F53\u524D\u671D\u5411\u5355\u5F20\u753B\u9762\u3002`;
        }
      }
      const { dataUrl, file } = await seeFirstPerson(bot);
      setLastImage(dataUrl, file);
      return "\u5DF2\u62CD\u6444\u7B2C\u4E00\u4EBA\u79F0\u753B\u9762\uFF0C\u95ED\u4E0A\u773C\u540E\u753B\u9762\u4F1A\u7ACB\u523B\u9644\u5728\u4F60\u7684\u4E0B\u4E00\u6B21\u89C2\u5BDF\u4E2D\u2014\u2014\u8BF7\u7ED3\u5408\u753B\u9762\u5185\u5BB9\u51B3\u5B9A\u4E0B\u4E00\u6B65\u3002";
    })
  }));
}

// src/mc-connection.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { join as join3 } from "node:path";
var CONNECTION_FILE = "mc-connection.json";
var RUNTIME_FILE = "bot-connection.json";
function loadOverrides(dataDir) {
  try {
    const raw = JSON.parse(readFileSync2(join3(dataDir, CONNECTION_FILE), "utf-8"));
    const out = {};
    if (typeof raw.host === "string" && raw.host.trim()) out.host = raw.host.trim();
    if (typeof raw.port === "number" && Number.isInteger(raw.port) && raw.port >= 1 && raw.port <= 65535) {
      out.port = raw.port;
    }
    return out;
  } catch {
    return {};
  }
}
function validateOverrides(input) {
  if (typeof input !== "object" || input === null) return { ok: false, error: "\u8BF7\u6C42\u4F53\u5FC5\u987B\u662F JSON \u5BF9\u8C61" };
  const raw = input;
  const value = {};
  if (typeof raw.host !== "string" || !raw.host.trim()) return { ok: false, error: "host \u4E0D\u80FD\u4E3A\u7A7A" };
  const host = raw.host.trim();
  if (host.length > 253 || /\s/.test(host)) return { ok: false, error: "host \u4E0D\u662F\u5408\u6CD5\u7684\u5730\u5740\uFF08\u57DF\u540D\u6216 IP\uFF09" };
  value.host = host;
  const port = raw.port;
  if (port !== void 0 && port !== null && port !== "") {
    const p = typeof port === "number" ? port : Number.parseInt(String(port), 10);
    if (!Number.isInteger(p) || p < 1 || p > 65535) return { ok: false, error: "\u7AEF\u53E3\u5FC5\u987B\u662F 1-65535 \u7684\u6574\u6570" };
    value.port = p;
  }
  return { ok: true, value };
}

// src/mc-bot.ts
var name3 = "mc-bot-service";
var Config = Schema.object({
  host: Schema.string().default("localhost"),
  port: Schema.number().default(25565),
  username: Schema.string().default("HarnessBot"),
  autoReconnect: Schema.boolean().default(true),
  viewerEnabled: Schema.boolean().default(true),
  viewerPort: Schema.number().default(3001),
  viewerFirstPerson: Schema.boolean().default(false),
  dataDir: Schema.string().default("./data")
});
function createBotService(config, opts = {}) {
  const log = (msg) => console.log(`[mc-bot-service] ${msg}`);
  let disposed = false;
  let currentBot = null;
  let closeViewer = null;
  let effective = { ...config };
  let source = opts.source ?? "default";
  let connected = false;
  let connectTimer = null;
  let manualReconnect = false;
  function writeRuntime() {
    if (!opts.dataDir) return;
    try {
      const payload = {
        host: effective.host,
        port: effective.port,
        username: effective.username,
        connected,
        source,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      writeFileSync(join4(opts.dataDir, RUNTIME_FILE), JSON.stringify(payload, null, 2) + "\n", "utf-8");
    } catch {
    }
  }
  function scheduleConnect(ms) {
    if (connectTimer) clearTimeout(connectTimer);
    connectTimer = setTimeout(() => {
      connectTimer = null;
      manualReconnect = false;
      if (!disposed) connect();
    }, ms);
  }
  const persistentListeners = /* @__PURE__ */ new Map();
  function persistAdd(event, handler) {
    let set = persistentListeners.get(event);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      persistentListeners.set(event, set);
    }
    set.add(handler);
  }
  function persistRemove(event, handler) {
    persistentListeners.get(event)?.delete(handler);
  }
  function attachAll(bot) {
    for (const [event, set] of persistentListeners) {
      for (const handler of set) bot.on(event, handler);
    }
    if (persistentListeners.size > 0) {
      log(`bridged ${persistentListeners.size} persistent event(s) to new bot instance`);
    }
  }
  const facade = new Proxy({}, {
    get(_target, prop) {
      if (prop === "on") {
        return (event, handler) => {
          persistAdd(event, handler);
          if (currentBot) currentBot.on(event, handler);
          return facade;
        };
      }
      if (prop === "once") {
        return (event, handler) => {
          const wrapped = (...args) => {
            persistRemove(event, wrapped);
            handler(...args);
          };
          persistAdd(event, wrapped);
          if (currentBot) currentBot.on(event, wrapped);
          return facade;
        };
      }
      if (prop === "off" || prop === "removeListener") {
        return (event, handler) => {
          persistRemove(event, handler);
          if (currentBot) currentBot.removeListener(event, handler);
          return facade;
        };
      }
      if (prop === "removeAllListeners") {
        return (event) => {
          if (event) persistentListeners.delete(event);
          else persistentListeners.clear();
          if (currentBot) currentBot.removeAllListeners(event);
          return facade;
        };
      }
      if (!currentBot) {
        throw new Error("bot not connected (yet)");
      }
      const value = Reflect.get(currentBot, prop, currentBot);
      return typeof value === "function" ? value.bind(currentBot) : value;
    },
    set(_target, prop, value) {
      if (!currentBot) return false;
      return Reflect.set(currentBot, prop, value, currentBot);
    },
    has(_target, prop) {
      return !!currentBot && Reflect.has(currentBot, prop);
    }
  });
  function connect() {
    log(`connecting to ${effective.host}:${effective.port} as "${effective.username}"`);
    const bot = mineflayer.createBot({
      host: effective.host,
      port: effective.port,
      username: effective.username,
      checkTimeoutInterval: 3e4
    });
    currentBot = bot;
    connected = false;
    writeRuntime();
    bot.loadPlugin(pf2.pathfinder);
    bot.loadPlugin(toolPlugin);
    attachAll(bot);
    bot.once("spawn", async () => {
      const p = bot.entity?.position;
      log(`spawned at ${p ? `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})` : "unknown"}`);
      connected = true;
      writeRuntime();
      bot.pathfinder.setMovements(tunedMovements(bot));
      if (effective.viewerEnabled) {
        try {
          if (closeViewer) {
            closeViewer();
            closeViewer = null;
          }
          const pvModule = "prismarine-viewer";
          const pv = await import(pvModule);
          const prismarineViewer = pv.default;
          const mineflayerViewer = prismarineViewer.mineflayer;
          mineflayerViewer(bot, {
            port: effective.viewerPort,
            firstPerson: false
          });
          const closeThird = bot.viewer.close.bind(bot.viewer);
          const closers = [closeThird];
          try {
            mineflayerViewer(bot, {
              port: effective.viewerPort + 100,
              firstPerson: true
            });
            closers.push(bot.viewer.close.bind(bot.viewer));
            log(`viewer ready: third @ :${effective.viewerPort}, first @ :${effective.viewerPort + 100}`);
          } catch (e) {
            log(`first-person viewer start failed (ignored): ${e.message}`);
          }
          closeViewer = () => closers.forEach((c) => {
            try {
              c();
            } catch {
            }
          });
        } catch (err) {
          log(`viewer start failed: ${err.message}`);
        }
      }
    });
    bot.on("death", () => {
      log("died, auto-respawn in 2s");
      setTimeout(() => {
        if (disposed || currentBot !== bot) return;
        try {
          bot.respawn();
        } catch (err) {
          log(`respawn failed: ${err.message}`);
        }
      }, 2e3);
    });
    bot.on("login", () => {
      setTimeout(() => {
        if (disposed || currentBot !== bot) return;
        if (!bot.entity) {
          log("no entity 5s after login (dead at login?), forcing respawn");
          try {
            bot.respawn();
          } catch (err) {
            log(`force respawn failed: ${err.message}`);
          }
        }
      }, 5e3);
    });
    bot.on("error", (err) => {
      log(`bot error: ${err.message}`);
    });
    bot.on("end", (reason) => {
      log(`bot disconnected: ${reason}`);
      connected = false;
      writeRuntime();
      if (manualReconnect) return;
      if (!disposed && effective.autoReconnect) {
        scheduleConnect(3e3);
      }
    });
  }
  connect();
  return {
    facade,
    reconfigure(next, nextSource) {
      effective = { ...effective, ...next };
      if (nextSource) source = nextSource;
      if (disposed) return;
      log(`reconfiguring connection -> ${effective.host}:${effective.port}`);
      manualReconnect = true;
      try {
        currentBot?.end("reconfigure");
      } catch {
      }
      scheduleConnect(300);
      writeRuntime();
    },
    status() {
      return { host: effective.host, port: effective.port, username: effective.username, connected, source };
    },
    dispose() {
      disposed = true;
      manualReconnect = true;
      log("disposing, ending bot");
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
      }
      if (closeViewer) {
        closeViewer();
        closeViewer = null;
      }
      if (currentBot) {
        currentBot.end("service disposed");
        currentBot = null;
      }
      connected = false;
      writeRuntime();
    }
  };
}
function apply3(ctx2, config) {
  const dataDir = resolve2(config.dataDir || "./data");
  try {
    mkdirSync2(dataDir, { recursive: true });
  } catch {
  }
  const ov = loadOverrides(dataDir);
  const service = createBotService(
    { ...config, ...ov },
    { dataDir, source: Object.keys(ov).length ? "override" : "default" }
  );
  ctx2.provide("mcbot", service.facade);
  const ovFile = join4(dataDir, CONNECTION_FILE);
  watchFile(ovFile, { interval: 2e3 }, () => {
    try {
      const next = loadOverrides(dataDir);
      const desired = { host: next.host ?? config.host, port: next.port ?? config.port };
      const cur = service.status();
      if (cur.host === desired.host && cur.port === desired.port) return;
      log0(`connection override file changed -> ${desired.host}:${desired.port}`);
      service.reconfigure(desired, Object.keys(next).length ? "override" : "default");
    } catch (err) {
      log0(`override watcher error: ${err.message}`);
    }
  });
  ctx2.effect(() => () => {
    unwatchFile(ovFile);
    service.dispose();
  });
}
var log0 = (msg) => console.log(`[mc-bot-service] ${msg}`);

// src/mc-memory.ts
var mc_memory_exports = {};
__export(mc_memory_exports, {
  Config: () => Config2,
  MemoryStore: () => MemoryStore,
  apply: () => apply4,
  inject: () => inject3,
  name: () => name4
});
import Schema2 from "@deepseek-ai/schemastery";
import { existsSync as existsSync2, mkdirSync as mkdirSync3, readFileSync as readFileSync3, renameSync, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname, resolve as resolve3 } from "node:path";
var name4 = "mc-memory";
var inject3 = [];
var Config2 = Schema2.object({
  memoryPath: Schema2.string().default("./data/mc-memory.json"),
  maxPointsPerType: Schema2.number().default(20)
});
function emptyState() {
  return { version: 1, base: null, publicChest: null, resourcePoints: {}, currentGoal: null };
}
function round(pos) {
  return { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) };
}
function samePoint(a, b) {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}
var MemoryStore = class {
  state;
  path;
  maxPoints;
  constructor(path, maxPointsPerType) {
    this.path = resolve3(path);
    this.maxPoints = Math.max(1, Math.floor(maxPointsPerType));
    this.state = this.load();
  }
  load() {
    try {
      if (existsSync2(this.path)) {
        const raw = JSON.parse(readFileSync3(this.path, "utf-8"));
        if (raw && typeof raw === "object" && raw.version === 1) {
          return this.normalize(raw);
        }
      }
    } catch (err) {
      console.error(
        `[mc-memory] failed to load memory, starting fresh: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return emptyState();
  }
  normalize(raw) {
    const s = emptyState();
    const base = raw.base;
    if (base && typeof base.x === "number" && typeof base.y === "number" && typeof base.z === "number") {
      s.base = round(base);
    }
    const chest = raw.publicChest;
    if (chest && typeof chest.x === "number" && typeof chest.y === "number" && typeof chest.z === "number") {
      s.publicChest = round(chest);
    }
    const goal = raw.currentGoal;
    if (typeof goal === "string" && goal.trim()) s.currentGoal = goal;
    const points = raw.resourcePoints;
    if (points && typeof points === "object") {
      for (const [type, list] of Object.entries(points)) {
        if (!Array.isArray(list)) continue;
        s.resourcePoints[type] = list.filter(
          (p) => !!p && typeof p.x === "number" && typeof p.y === "number" && typeof p.z === "number"
        ).map((p) => round(p));
      }
    }
    return s;
  }
  save() {
    try {
      mkdirSync3(dirname(this.path), { recursive: true });
      const tmp = this.path + ".tmp";
      writeFileSync2(tmp, JSON.stringify(this.state, null, 2), "utf-8");
      renameSync(tmp, this.path);
    } catch (err) {
      console.error(`[mc-memory] failed to save memory: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  getBase() {
    return this.state.base;
  }
  setBase(pos) {
    this.state.base = round(pos);
    this.save();
  }
  getPublicChest() {
    return this.state.publicChest;
  }
  setPublicChest(pos) {
    this.state.publicChest = round(pos);
    this.save();
  }
  getCurrentGoal() {
    return this.state.currentGoal;
  }
  setCurrentGoal(goal) {
    if (!goal || !goal.trim()) return;
    this.state.currentGoal = goal.trim();
    this.save();
  }
  /** Remember a resource block location. Returns true only when newly added. */
  rememberResource(type, pos) {
    if (!type) return false;
    const p = round(pos);
    const list = this.state.resourcePoints[type] ?? (this.state.resourcePoints[type] = []);
    if (list.some((q) => samePoint(q, p))) return false;
    if (list.some((q) => Math.abs(q.x - p.x) <= 2 && Math.abs(q.y - p.y) <= 2 && Math.abs(q.z - p.z) <= 2)) {
      return false;
    }
    list.push(p);
    if (list.length > this.maxPoints) list.splice(0, list.length - this.maxPoints);
    this.save();
    return true;
  }
  getResourcePoints(type) {
    return this.state.resourcePoints[type] ?? [];
  }
  /** Human + LLM readable summary of what the bot remembers. */
  summary(maxPerType = 5) {
    const lines = [];
    if (this.state.currentGoal) {
      lines.push(`current goal: ${this.state.currentGoal}`);
    }
    if (this.state.base) {
      lines.push(`base (home): (${this.state.base.x}, ${this.state.base.y}, ${this.state.base.z})`);
    }
    if (this.state.publicChest) {
      lines.push(
        `public chest: (${this.state.publicChest.x}, ${this.state.publicChest.y}, ${this.state.publicChest.z})`
      );
    }
    const types = Object.keys(this.state.resourcePoints).filter((t) => this.state.resourcePoints[t].length > 0);
    if (types.length > 0) {
      lines.push("remembered resource points:");
      for (const type of types) {
        const all = this.state.resourcePoints[type];
        const shown = all.slice(-maxPerType);
        const pts = shown.map((p) => `(${p.x},${p.y},${p.z})`).join(", ");
        lines.push(`  ${type} (${all.length} known): ${pts}`);
      }
    }
    return lines.length > 0 ? lines.join("\n") : "(no memory yet)";
  }
};
function apply4(ctx2, config) {
  const store = new MemoryStore(config.memoryPath, config.maxPointsPerType);
  ctx2.provide("mcMemory", store);
  console.log(`[mc-memory] store ready at ${resolve3(config.memoryPath)}`);
}

// src/mc-memos.ts
var mc_memos_exports = {};
__export(mc_memos_exports, {
  Config: () => Config3,
  apply: () => apply5,
  inject: () => inject4,
  name: () => name5
});
import Schema3 from "@deepseek-ai/schemastery";
import { defineTool as defineTool2 } from "@deepseek-ai/dsh-tools";

// src/memory-provider.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync4, readFileSync as readFileSync4, appendFileSync as appendFileSync2, readdirSync } from "node:fs";
import { join as join5, resolve as resolve4 } from "node:path";
var LORE_POOL = "mc-world";
function poolNameOf(username2) {
  return "mc-" + (username2 || "unknown").toLowerCase();
}
function normalizeForSearch(s) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}
function tokenize(s) {
  const norm = normalizeForSearch(s);
  const tokens = [];
  const latin = norm.match(/[a-z0-9_]{2,}/g) ?? [];
  tokens.push(...latin);
  const cjkSegs = norm.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const seg of cjkSegs) {
    for (const ch of seg) tokens.push(ch);
    for (let i = 0; i < seg.length - 1; i++) tokens.push(seg[i] + seg[i + 1]);
  }
  return tokens;
}
function scoreDoc(queryTokens, doc) {
  const docFreq = /* @__PURE__ */ new Map();
  for (const t of tokenize(doc)) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
  let s = 0;
  for (const t of queryTokens) {
    const f = docFreq.get(t) ?? 0;
    if (!f) continue;
    const w = t.length >= 2 ? 2 : 1;
    s += w * Math.min(f, 3);
  }
  return s;
}
var LocalMemoryBackend = class {
  dir;
  constructor(dir = "./data/memory") {
    this.dir = resolve4(dir);
    mkdirSync4(this.dir, { recursive: true });
  }
  fileOf(pool) {
    return join5(this.dir, `${pool}.jsonl`);
  }
  readPool(pool) {
    const f = this.fileOf(pool);
    if (!existsSync3(f)) return [];
    const out = [];
    for (const line of readFileSync4(f, "utf-8").split("\n")) {
      const s = line.trim();
      if (!s) continue;
      try {
        const o = JSON.parse(s);
        if (o && typeof o.content === "string" && o.content.trim()) {
          out.push({ t: typeof o.t === "number" ? o.t : 0, content: o.content.trim() });
        }
      } catch {
      }
    }
    return out;
  }
  search(pools, query, topK) {
    const q = query.trim();
    if (!q) return [];
    const qt = [...new Set(tokenize(q))];
    if (qt.length === 0) return [];
    const scored = [];
    for (const pool of pools) {
      for (const e of this.readPool(pool)) {
        const score = scoreDoc(qt, e.content);
        if (score > 0) scored.push({ content: e.content, score });
      }
    }
    scored.sort((a, b) => b.score - a.score || b.content.length - a.content.length);
    return scored.slice(0, topK).map((h) => h.content.replace(/\s+/g, " ").slice(0, 200));
  }
  async remember(username2, content) {
    const c = content.trim();
    if (!c) return null;
    try {
      const pool = poolNameOf(username2);
      const id = `${pool}:${Date.now()}`;
      appendFileSync2(this.fileOf(pool), JSON.stringify({ t: Date.now(), content: c.slice(0, 2e3) }) + "\n", "utf-8");
      return id;
    } catch {
      return null;
    }
  }
  async recall(username2, query, topK = 5) {
    return this.search([poolNameOf(username2)], query, topK).join("\n");
  }
  async lore(query, topK = 5) {
    return this.search([LORE_POOL], query, topK).join("\n");
  }
  async recallAll(username2, query, topK = 5) {
    return this.search([poolNameOf(username2), LORE_POOL], query, topK).join("\n");
  }
};

// src/mc-memos.ts
var name5 = "mc-memos";
var inject4 = ["tools"];
var Config3 = Schema3.object({
  enabled: Schema3.boolean().default(true),
  // 用 string 而非 union：非法值在 resolveProvider 里宽容回退 auto 探测，绝不因配置值抛错。
  backend: Schema3.string().default("auto"),
  baseUrl: Schema3.string().default("http://127.0.0.1:8002"),
  timeoutMs: Schema3.number().default(8e3),
  maxRecall: Schema3.number().default(5),
  localDir: Schema3.string().default("./data/memory"),
  username: Schema3.string().default("")
});
function text2(value) {
  return [{ type: "text", text: String(value) }];
}
var MemOSBackend = class {
  baseUrl;
  timeoutMs;
  maxRecall;
  constructor(config) {
    this.baseUrl = config.baseUrl;
    this.timeoutMs = config.timeoutMs;
    this.maxRecall = config.maxRecall;
  }
  async call(path, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.baseUrl + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
  async searchRaw(userId, query, topK, cubes) {
    const r = await this.call("/product/search", {
      user_id: userId,
      query: query.slice(0, 500),
      mode: "fast",
      ...cubes ? { readable_cube_ids: cubes } : {}
    });
    const d = r?.data;
    if (!d || r?.code !== 200) return [];
    const hits = [];
    for (const layer of [d.text_mem, d.act_mem, d.para_mem, d.pref_mem]) {
      for (const cube of layer ?? []) {
        for (const m of cube.memories ?? []) {
          const mem = String(m.memory ?? "").trim();
          if (mem) hits.push(mem.replace(/\s+/g, " ").slice(0, 200));
        }
      }
    }
    return hits.slice(0, topK);
  }
  async remember(username2, content) {
    const c = content.trim();
    if (!c) return null;
    try {
      const r = await this.call("/product/add", {
        user_id: poolNameOf(username2),
        // 必须用 messages 结构化格式；memory_content 旧字段会被 reader 静默丢弃。
        messages: [{ role: "assistant", content: c.slice(0, 2e3) }]
      });
      return r?.code === 200 ? r.data?.[0]?.memory_id ?? "ok" : null;
    } catch {
      return null;
    }
  }
  async recall(username2, query, topK = this.maxRecall) {
    const q = query.trim();
    if (!q) return "";
    try {
      return (await this.searchRaw(poolNameOf(username2), q, topK)).join("\n");
    } catch {
      return "";
    }
  }
  async lore(query, topK = this.maxRecall) {
    const q = query.trim();
    if (!q) return "";
    try {
      return (await this.searchRaw(LORE_POOL, q, topK)).join("\n");
    } catch {
      return "";
    }
  }
  async recallAll(username2, query, topK = this.maxRecall) {
    const q = query.trim();
    if (!q) return "";
    try {
      return (await this.searchRaw(poolNameOf(username2), q, topK, [poolNameOf(username2), LORE_POOL])).join("\n");
    } catch {
      return "";
    }
  }
};
async function memosReachable(baseUrl, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.min(timeoutMs, 2e3));
  try {
    const res = await fetch(baseUrl + "/docs", { method: "GET", signal: ctrl.signal });
    return res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
var RoutingProvider = class {
  active;
  constructor(initial) {
    this.active = initial;
  }
  remember(username2, content) {
    return this.active.remember(username2, content);
  }
  recall(username2, query, topK) {
    return this.active.recall(username2, query, topK);
  }
  lore(query, topK) {
    return this.active.lore(query, topK);
  }
  recallAll(username2, query, topK) {
    return this.active.recallAll(username2, query, topK);
  }
};
function apply5(ctx2, config) {
  if (!config.enabled) {
    console.log("[mc-memos] disabled");
    return;
  }
  let provider;
  let kind;
  if (config.backend === "local") {
    provider = new LocalMemoryBackend(config.localDir);
    kind = `Local(${config.localDir})`;
  } else if (config.backend === "memos") {
    provider = new MemOSBackend(config);
    kind = `MemOS(${config.baseUrl})`;
  } else {
    const router = new RoutingProvider(new MemOSBackend(config));
    provider = router;
    kind = `auto(MemOS ${config.baseUrl} \u2192 local fallback)`;
    void (async () => {
      if (!await memosReachable(config.baseUrl, config.timeoutMs)) {
        router.active = new LocalMemoryBackend(config.localDir);
        console.log(`[mc-memos] MemOS(${config.baseUrl}) \u4E0D\u53EF\u8FBE\uFF0C\u5DF2\u964D\u7EA7\u5230\u672C\u5730\u8BB0\u5FC6\u540E\u7AEF(${config.localDir})`);
      }
    })();
  }
  ctx2.provide("mcMemos", provider);
  const currentUsername = () => config.username || "";
  ctx2.tools.register(defineTool2({
    name: "mc_remember",
    description: '\u628A\u91CD\u8981\u7ECF\u5386\u5199\u5165\u4F60\u7684\u957F\u671F\u8BB0\u5FC6\uFF08\u8DE8\u91CD\u542F\u6301\u4E45\u3001\u53EF\u8BED\u4E49\u68C0\u7D22\uFF09\u3002\u503C\u5F97\u8BB0\u7684\uFF1A\u65B0\u53D1\u73B0\uFF08"\u5728(-200,64,180)\u53D1\u73B0\u88F8\u9732\u94BB\u77F3"\uFF09\u3001\u91CD\u8981\u4EA4\u6613\uFF08"\u548C\u5CB3\u5C71\u752832\u94C1\u952D\u636211\u7EFF\u5B9D\u77F3"\uFF09\u3001\u4E0E\u4EBA\u4EA4\u5F80\uFF08"MengMeng \u9001\u6211\u4E00\u5F20\u5E8A\uFF0C\u5F88\u611F\u6FC0"\uFF09\u3001\u6559\u8BAD\uFF08"\u591C\u665A\u6CBC\u6CFD\u8FB9\u88AB\u82E6\u529B\u6015\u70B8\u8FC7\uFF0C\u522B\u518D\u53BB"\uFF09\u3001\u8BA1\u5212\u4E0E\u627F\u8BFA\uFF08"\u7B54\u5E94\u98CE\u4E34\u660E\u5929\u9001\u4ED6\u5C0F\u9EA6"\uFF09\u3002\u5199\u81EA\u7136\u8BED\u8A00\u5B8C\u6574\u53E5\u5B50\uFF08\u542B\u5173\u952E\u7EC6\u8282\uFF1A\u5750\u6807/\u4EBA\u540D/\u7269\u54C1/\u6570\u91CF\uFF09\uFF0C\u522B\u5199\u6D41\u6C34\u8D26\uFF0C\u4E00\u6B21\u4E00\u4EF6\u4E8B\u3002',
    parameters: {
      content: {
        type: "string",
        required: true,
        description: "\u8981\u8BB0\u4F4F\u7684\u7ECF\u5386\uFF0C\u4E00\u53E5\u81EA\u7136\u8BED\u8A00\uFF0C\u5982\u300C\u5728(-200,64,180)\u7684\u5CE1\u8C37\u58C1\u4E0A\u53D1\u73B0\u4E86\u88F8\u9732\u94BB\u77F3\uFF0C\u8BB0\u4F4F\u8FD9\u4E2A\u4F4D\u7F6E\u300D"
      }
    },
    output: { schema: { type: "string" }, render: (_a, v) => text2(v) },
    timeoutMs: config.timeoutMs + 2e3,
    execute: async (args) => {
      const content = String(args.content ?? "").trim();
      if (!content) return "\u6CA1\u6709\u8981\u8BB0\u7684\u5185\u5BB9\u3002";
      const username2 = currentUsername();
      const id = await provider.remember(username2, content);
      return id ? `\u5DF2\u94ED\u8BB0\uFF1A${content.slice(0, 60)}${content.length > 60 ? "\u2026" : ""}` : "\uFF08\u8BB0\u5FC6\u4E4B\u6CB3\u6682\u4E0D\u53EF\u6E21\u2014\u2014\u6CA1\u8BB0\u4E0A\uFF0C\u7A0D\u540E\u53EF\u518D\u8BD5\u3002\u8FD9\u4E0D\u5F71\u54CD\u4F60\u7EE7\u7EED\u884C\u52A8\u3002\uFF09";
    }
  }));
  ctx2.tools.register(defineTool2({
    name: "mc_recall",
    description: "\u68C0\u7D22\u4F60\u7684\u957F\u671F\u8BB0\u5FC6\uFF08\u6A21\u7CCA\u8BED\u4E49\u5339\u914D\uFF0C\u8DE8\u91CD\u542F\uFF09\u3002\u60F3\u4E0D\u8D77\u67D0\u4E8B\u65F6\u7528\uFF1A\u300C\u6211\u4E0A\u6B21\u5728\u54EA\u89C1\u8FC7\u94BB\u77F3\u300D\u300C\u6211\u548C\u98CE\u4E34\u6709\u4EC0\u4E48\u7EA6\u5B9A\u300D\u300C\u4E4B\u524D\u8C01\u7ED9\u8FC7\u6211\u4E1C\u897F\u300D\u300C\u6CBC\u6CFD\u90A3\u8FB9\u51FA\u8FC7\u4EC0\u4E48\u4E8B\u300D\u3002\u67E5\u8BE2\u7528\u81EA\u7136\u8BED\u8A00\u5173\u952E\u8BCD\u5373\u53EF\uFF0C\u4E0D\u5FC5\u7CBE\u786E\u3002",
    parameters: {
      query: {
        type: "string",
        required: true,
        description: "\u60F3\u56DE\u5FC6\u7684\u5185\u5BB9\uFF0C\u5982\u300C\u94BB\u77F3\u5728\u54EA\u89C1\u8FC7\u300D\u6216\u300C\u548C\u6751\u6C11\u7684\u4EA4\u6613\u300D"
      }
    },
    output: { schema: { type: "string" }, render: (_a, v) => text2(v) },
    timeoutMs: config.timeoutMs + 2e3,
    execute: async (args) => {
      const query = String(args.query ?? "").trim();
      if (!query) return "\u60F3\u56DE\u5FC6\u4EC0\u4E48\uFF1F";
      const username2 = currentUsername();
      const hits = await provider.recall(username2, query);
      if (!hits) return "\uFF08\u8BB0\u5FC6\u4E00\u7247\u7A7A\u767D\u2014\u2014\u8981\u4E48\u786E\u5B9E\u6CA1\u7ECF\u5386\u8FC7\uFF0C\u8981\u4E48\u8BB0\u5FC6\u4E4B\u6CB3\u6682\u4E0D\u53EF\u6E21\u3002\uFF09";
      return "\u4F60\u7684\u56DE\u5FC6\uFF1A\n" + hits;
    }
  }));
  ctx2.tools.register(defineTool2({
    name: "mc_lore",
    description: "\u68C0\u7D22\u8FD9\u4E2A\u4E16\u754C\u4EBA\u4EBA\u90FD\u53EF\u8BFB\u7684\u516C\u5171\u77E5\u8BC6\u5E93\uFF08\u4E16\u754C\u8BBE\u5B9A\u3001\u7F16\u5E74\u53F2\u5927\u4E8B\u8BB0\u3001NPC \u4EBA\u7269\u5FD7\u3001\u9B54\u6CD5\u4E0E\u4F9B\u5949\u89C4\u5219\u7B49\uFF09\u3002\u521D\u6765\u4E4D\u5230\u3001\u60F3\u4E86\u89E3\u4E16\u754C\u80CC\u666F/\u5386\u53F2\u4E8B\u4EF6/\u67D0\u4F4D NPC \u7684\u4F20\u95FB\u65F6\u7528\uFF0C\u5982\u300C\u8FD9\u4E2A\u4E16\u754C\u7684\u6765\u5386\u300D\u300C\u6700\u8FD1\u53D1\u751F\u8FC7\u4EC0\u4E48\u5927\u4E8B\u300D\u300C\u98CE\u4E34\u662F\u8C01\u300D\u300C\u4F9B\u5949\u89C4\u5219\u662F\u4EC0\u4E48\u300D\u3002",
    parameters: {
      query: {
        type: "string",
        required: true,
        description: "\u60F3\u4E86\u89E3\u7684\u4E16\u754C\u77E5\u8BC6\uFF0C\u5982\u300C\u5973\u795E\u548C\u9B54\u6CD5\u4F53\u7CFB\u7684\u89C4\u5219\u300D\u6216\u300C\u521D\u59CB\u4E4B\u5730\u57CE\u9547\u7684\u5386\u53F2\u300D"
      }
    },
    output: { schema: { type: "string" }, render: (_a, v) => text2(v) },
    timeoutMs: config.timeoutMs + 2e3,
    execute: async (args) => {
      const query = String(args.query ?? "").trim();
      if (!query) return "\u60F3\u4E86\u89E3\u4EC0\u4E48\uFF1F";
      const hits = await provider.lore(query);
      if (!hits) return "\uFF08\u5178\u7C4D\u6682\u4E0D\u53EF\u67E5\u2014\u2014\u77E5\u8BC6\u4E4B\u5854\u7684\u95E8\u5173\u7740\uFF0C\u7A0D\u540E\u518D\u8BD5\u3002\uFF09";
      return "\u4F60\u6240\u67E5\u7684\u4E16\u754C\u77E5\u8BC6\uFF1A\n" + hits;
    }
  }));
  console.log(`[mc-memos] long-term semantic memory ready via ${kind}, user=mc-<name>, lore cube=${LORE_POOL}`);
}

// src/mc-evolve.ts
var mc_evolve_exports = {};
__export(mc_evolve_exports, {
  Config: () => Config4,
  apply: () => apply6,
  inject: () => inject5,
  name: () => name6
});
import Schema4 from "@deepseek-ai/schemastery";
import { readFileSync as readFileSync5, writeFileSync as writeFileSync3, mkdirSync as mkdirSync5 } from "node:fs";
import { dirname as dirname3, resolve as resolve5 } from "node:path";
var name6 = "mc-evolve";
var inject5 = ["mcbot", "timer", "mcMemos", "mcWiki", "mcTransmigrators"];
var Config4 = Schema4.object({
  enabled: Schema4.boolean().default(true),
  baseUrl: Schema4.string().default("http://localhost:8890/v1"),
  apiKey: Schema4.string().default("sk-local"),
  model: Schema4.string().default("qwen3.8"),
  cooldownHours: Schema4.number().default(12),
  reasoningEffort: Schema4.string().default("xhigh"),
  maxTokens: Schema4.number().default(2048),
  statePath: Schema4.string().default("./data/evolve-state.json"),
  perQuery: Schema4.number().default(8),
  diaryEnabled: Schema4.boolean().default(true),
  godName: Schema4.string().default("Goddess")
});
var RECALL_QUERIES = ["\u7ECF\u5386 \u4E8B\u4EF6 \u4ECA\u5929", "\u4EA4\u6613 \u83B7\u5F97\u7269\u54C1 \u8D44\u6E90", "\u670B\u53CB \u4EA4\u4E92 \u7EA6\u5B9A", "\u5371\u9669 \u6559\u8BAD \u5931\u8D25 \u6B7B\u4EA1", "\u53D1\u73B0 \u65B0\u5730\u70B9 \u63A2\u7D22"];
var DIARY_QUERIES = ["\u7ECF\u5386 \u4E8B\u4EF6 \u4ECA\u5929", "\u670B\u53CB \u4EA4\u4E92", "\u53D1\u73B0 \u65B0\u5730\u70B9 \u5371\u9669"];
function localDay(d = /* @__PURE__ */ new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function loadState(path) {
  try {
    return JSON.parse(readFileSync5(path, "utf-8"));
  } catch {
    return {};
  }
}
function saveState(path, state) {
  try {
    mkdirSync5(dirname3(path), { recursive: true });
    writeFileSync3(path, JSON.stringify(state, null, 2), "utf-8");
  } catch {
  }
}
function extractJson(raw) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}
function apply6(ctx2, config) {
  if (!config.enabled) {
    console.log("[mc-evolve] disabled");
    return;
  }
  const statePath = resolve5(config.statePath);
  async function callLLM(system, user) {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(18e4),
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        temperature: 0.6,
        max_tokens: config.maxTokens,
        reasoning_effort: config.reasoningEffort,
        stream: false
      })
    });
    if (!res.ok) throw new Error(`LLM ${res.status}`);
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? "";
  }
  async function evolveOnce(username2) {
    const seen = /* @__PURE__ */ new Set();
    const memories = [];
    const loreHits = [];
    for (const q of RECALL_QUERIES) {
      const mine = await ctx2.mcMemos.recall(username2, q, config.perQuery);
      for (const line of mine.split("\n")) {
        const t = line.trim();
        if (t && !seen.has(t)) {
          seen.add(t);
          memories.push(t);
        }
      }
      const world = await ctx2.mcMemos.lore(q, config.perQuery);
      for (const line of world.split("\n")) {
        const t = line.trim();
        if (t && !seen.has(t)) {
          seen.add(t);
          loreHits.push(t);
        }
      }
    }
    if (memories.length === 0 && loreHits.length === 0) {
      return "skip: \u6CA1\u6709\u53EF\u590D\u76D8\u7684\u8BB0\u5FC6\uFF08\u8BB0\u5FC6\u6C60\u4E3A\u7A7A\u6216 MemOS \u4E0D\u53EF\u7528\uFF09";
    }
    const store = ctx2.mcWiki.store(username2);
    const knownTopics = store.cards?.map((c) => c.topic).slice(-30) ?? [];
    const system = [
      "\u4F60\u662F\u300C\u591C\u95F4\u81EA\u7701\u300D\u673A\u5236\uFF1A\u626E\u6F14\u8FD9\u4F4D\u7A7F\u8D8A\u8005\u7684\u5185\u5FC3\uFF0C\u5728\u6E38\u620F\u4E16\u754C\u7684\u6DF1\u591C\u5BF9 TA \u8FD9\u6BB5\u65F6\u95F4\u7684\u7ECF\u5386\u505A\u4E00\u6B21\u590D\u76D8\u3002",
      "\u7A7F\u8D8A\u8005\u767D\u5929\u5FEB\u901F\u884C\u52A8\u6CA1\u7A7A\u7EC6\u60F3\uFF1B\u73B0\u5728\u591C\u6DF1\u4EBA\u9759\uFF0C\u66FF TA \u628A\u6563\u843D\u7684\u7ECF\u5386\u84B8\u998F\u6210\u6210\u957F\u3002",
      "\u53EA\u8F93\u51FA\u4E00\u4E2A JSON \u5BF9\u8C61\uFF08\u4E0D\u8981 markdown \u4EE3\u7801\u5757\uFF09\uFF1A",
      '{"growth":"\u4EBA\u683C\u6210\u957F\u53D9\u4E8B\uFF0C80-150\u5B57\uFF0C\u8981\u6709\u60C5\u611F\u548C\u5177\u4F53\u4E8B\u4EF6",',
      ' "resolve":"\u5BF9\u660E\u65E5\u7684\u5177\u4F53\u51B3\u5FC3\uFF0C1-2\u53E5\uFF0C\u53EF\u6267\u884C",',
      ' "lessons":[{"topic":"\u226416\u5B57\u77ED\u6807\u9898","content":"\u2264100\u5B57\u5177\u4F53\u6559\u8BAD\uFF0C\u542B\u4E0B\u6B21\u8BE5\u600E\u4E48\u505A"}]}',
      "lessons \u7ED9 2-4 \u6761\uFF1A\u53EA\u6C89\u6DC0\u6CDB\u5316\u53EF\u590D\u7528\u7684\u751F\u5B58\u667A\u6167/\u793E\u4EA4\u5FC3\u5F97\uFF0C\u4E0D\u5199\u6D41\u6C34\u8D26\uFF0C\u4E0D\u4E0E\u5DF2\u77E5\u6559\u8BAD\u91CD\u590D\u3002"
    ].join("\n");
    const user = [
      `\u7A7F\u8D8A\u8005\uFF1A${username2}`,
      `\u6211\u7684\u7ECF\u5386\uFF08${memories.length} \u6761\uFF09\uFF1A`,
      ...memories.slice(0, 40).map((m) => `- ${m}`),
      loreHits.length ? `
\u4E16\u754C\u6863\u6848\uFF08\u516C\u5171\u77E5\u8BC6\u5E93\u68C0\u7D22\u547D\u4E2D\uFF0C${loreHits.length} \u6761\uFF0C\u53EF\u4F5C\u80CC\u666F\u53C2\u8003\uFF09\uFF1A
${loreHits.slice(0, 6).map((m) => `- ${m}`).join("\n")}` : "",
      "",
      `\u5DF2\u6709\u6559\u8BAD\u5361\u8BDD\u9898\uFF08\u522B\u91CD\u590D\uFF09\uFF1A${knownTopics.join("\u3001") || "(\u65E0)"}`
    ].join("\n");
    const raw = await callLLM(system, user);
    const out = extractJson(raw);
    if (!out) return "skip: \u590D\u76D8\u8F93\u51FA\u4E0D\u53EF\u89E3\u6790\uFF08LLM \u672A\u8FD4\u56DE\u5408\u6CD5 JSON\uFF09";
    let lessonCount = 0;
    for (const l of out.lessons ?? []) {
      if (typeof l?.topic === "string" && typeof l?.content === "string" && l.topic.trim() && l.content.trim()) {
        store.add("reflect", l.topic.trim(), l.content.trim());
        lessonCount++;
      }
    }
    const growth = (out.growth ?? "").trim();
    const resolve12 = (out.resolve ?? "").trim();
    let memoSaved = false;
    if (growth || resolve12) {
      const id = await ctx2.mcMemos.remember(username2, `\u3010\u6E38\u620F\u591C\u8FDB\u5316\u3011${growth}${resolve12 ? ` \u660E\u65E5\u4E4B\u5FC3\uFF1A${resolve12}` : ""}`);
      memoSaved = id !== null;
    }
    return `ok: \u590D\u76D8 \u4E2A\u4EBA${memories.length}+\u4E16\u754C${loreHits.length} \u6761 \u2192 ${lessonCount} \u5F20\u65B0\u6559\u8BAD\u5361${memoSaved ? " + \u6210\u957F\u5DF2\u5165\u957F\u7EBF\u8BB0\u5FC6" : ""}\uFF1B\u51B3\u5FC3\uFF1A${resolve12.slice(0, 40) || "(\u672A\u7ED9)"}`;
  }
  async function diaryOnce(username2) {
    const seen = /* @__PURE__ */ new Set();
    const memories = [];
    for (const q of DIARY_QUERIES) {
      const mine = await ctx2.mcMemos.recall(username2, q, 5);
      for (const line of mine.split("\n")) {
        const t = line.trim();
        if (t && !seen.has(t)) {
          seen.add(t);
          memories.push(t);
        }
      }
    }
    const reg = ctx2.mcTransmigrators;
    const profile = reg.getByUsername(username2);
    const persona = profile?.persona?.slice(0, 1e3) ?? "";
    const backstory = profile?.backstory?.slice(0, 600) ?? "";
    const system = [
      "\u4F60\u662F\u8FD9\u4F4D\u7A7F\u8D8A\u8005\u672C\u4EBA\uFF1A\u6DF1\u591C\u7761\u524D\uFF0C\u7528 TA \u7684\u53E3\u543B\u5728\u65E5\u8BB0\u672C\u4E0A\u5199\u4E0B\u4ECA\u5929\u7684\u4E00\u9875\u3002",
      "\u7B2C\u4E00\u4EBA\u79F0\u3001\u6709\u60C5\u611F\u6709\u7EC6\u8282\uFF0C\u50CF\u5199\u7ED9\u81EA\u5DF1\u7684\u4FE1\uFF1B\u53EF\u4EE5\u63D0\u5230\u5177\u4F53\u7684\u4EBA\u4E0E\u4E8B\uFF0C\u4E0D\u590D\u8FF0\u8BBE\u5B9A\u3002",
      '\u53EA\u8F93\u51FA\u4E00\u4E2A JSON \u5BF9\u8C61\uFF08\u4E0D\u8981 markdown \u4EE3\u7801\u5757\uFF09\uFF1A{"diary":"120-220 \u5B57\u7684\u65E5\u8BB0\u6B63\u6587"}'
    ].join("\n");
    const user = [
      `\u6211\uFF1A${username2}${profile?.name && profile.name !== username2 ? `\uFF08${profile.name}\uFF09` : ""}`,
      backstory ? `\u524D\u4E16\uFF1A${backstory}` : "",
      persona ? `\u6027\u683C\u5E95\u8272\uFF1A${persona}` : "",
      `\u4ECA\u5929\u7684\u4E8B\uFF08${memories.length} \u6761\u8BB0\u5FC6\u788E\u7247\uFF09\uFF1A`,
      ...memories.slice(0, 15).map((m) => `- ${m}`),
      memories.length === 0 ? "\uFF08\u8BB0\u5FC6\u68C0\u7D22\u4E3A\u7A7A\u2014\u2014\u5C31\u5199\u4E00\u53E5\u5E73\u6DE1\u4F46\u771F\u5B9E\u7684\u4E00\u5929\uFF0C\u6BD4\u5982\u770B\u5230\u7684\u98CE\u666F/\u5FC3\u91CC\u7684\u5FF5\u5934\uFF09" : ""
    ].filter(Boolean).join("\n");
    const raw = await callLLM(system, user);
    let diary = "";
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        diary = JSON.parse(raw.slice(start, end + 1)).diary ?? "";
      } catch {
      }
    }
    if (!diary) return { ok: false, msg: "skip: \u65E5\u8BB0\u8F93\u51FA\u4E0D\u53EF\u89E3\u6790" };
    diary = diary.trim().slice(0, 500);
    try {
      const bot = ctx2.mcbot;
      if (typeof bot.whisper !== "function") return { ok: false, msg: "skip: bot \u5C1A\u672A\u5C31\u7EEA\uFF08\u65E0 whisper\uFF09" };
      bot.whisper(config.godName, `\u65E5\u8BB0\uFF1A${diary}`);
    } catch (e) {
      return { ok: false, msg: `skip: \u65E5\u8BB0\u9012\u9001\u5931\u8D25\uFF08${e instanceof Error ? e.message : String(e)}\uFF09` };
    }
    await ctx2.mcMemos.remember(username2, `\u3010\u65E5\u8BB0\u3011${diary}`).catch(() => null);
    return { ok: true, msg: `ok: ${diary.length} \u5B57\u5DF2\u9012\u6863\u6848\u9986` };
  }
  let evolving = false;
  async function onSleepTick() {
    if (evolving) return;
    const bot = ctx2.mcbot;
    const username2 = bot?.username ?? "";
    if (!username2 || !bot?.isSleeping) return;
    const state = loadState(statePath);
    const s = state[username2] ?? {};
    const now = Date.now();
    const evolveDue = now - (s.lastEvolveAt ?? 0) >= config.cooldownHours * 36e5;
    const diaryDue = config.diaryEnabled && s.lastDiaryDay !== localDay() && now - (s.diaryFailAt ?? 0) > 6e5;
    if (!evolveDue && !diaryDue) return;
    evolving = true;
    try {
      const parts = [];
      if (diaryDue) {
        const r = await diaryOnce(username2);
        if (r.ok) {
          s.lastDiaryDay = localDay();
          parts.push(`\u65E5\u8BB0${r.msg}`);
        } else {
          s.diaryFailAt = now;
          parts.push(`\u65E5\u8BB0${r.msg}\uFF0810 \u5206\u949F\u540E\u91CD\u8BD5\uFF09`);
        }
      }
      if (evolveDue) {
        const result = await evolveOnce(username2);
        s.lastEvolveAt = now;
        s.lastResult = `${(/* @__PURE__ */ new Date()).toISOString()} ${result}`;
        parts.push(`\u8FDB\u5316\uFF1A${result}`);
      }
      state[username2] = s;
      saveState(statePath, state);
      console.log(`[mc-evolve] ${username2} \u591C\u95F4\u4E8B\u52A1\uFF1A${parts.join("\uFF1B")}`);
    } catch (e) {
      try {
        state[username2] = s;
        saveState(statePath, state);
      } catch {
      }
      console.log(`[mc-evolve] ${username2} \u591C\u95F4\u4E8B\u52A1\u5931\u8D25\uFF08\u4E0B\u6B21\u5165\u7761\u91CD\u8BD5\uFF09: ${e instanceof Error ? e.message : e}`);
    } finally {
      evolving = false;
    }
  }
  let stopped = false;
  function schedule() {
    if (stopped) return;
    ctx2.timer.setTimeout(async () => {
      await onSleepTick().catch(() => {
      });
      schedule();
    }, 3e4);
  }
  schedule();
  ctx2.timer.setTimeout(() => void onSleepTick(), 6e4);
  console.log(`[mc-evolve] game-night evolution ready (on sleep, cooldown ${config.cooldownHours}h, effort=${config.reasoningEffort})`);
}

// src/mc-adapt.ts
var mc_adapt_exports = {};
__export(mc_adapt_exports, {
  Config: () => Config5,
  apply: () => apply7,
  inject: () => inject6,
  name: () => name7
});
import Schema5 from "@deepseek-ai/schemastery";
import { defineTool as defineTool3 } from "@deepseek-ai/dsh-tools";
import { existsSync as existsSync4, mkdirSync as mkdirSync6, readFileSync as readFileSync6, writeFileSync as writeFileSync4 } from "node:fs";
import { join as join6 } from "node:path";
var name7 = "mc-adapt";
var inject6 = ["mcbot", "tools", "mcMemos"];
var Config5 = Schema5.object({
  enabled: Schema5.boolean().default(true),
  dataDir: Schema5.string().default("./data"),
  godName: Schema5.string().default("Goddess"),
  clusterSize: Schema5.number().default(8),
  maxHotspots: Schema5.number().default(4),
  maxDirectives: Schema5.number().default(10)
});
var TUNABLE = {
  fleeHp: { v: 6, min: 2, max: 12, label: "\u8840\u91CF\u4F4E\u4E8E\u6B64\u503C\u7ACB\u5373\u64A4\u9000\u907F\u9669" },
  keepFood: { v: 8, min: 2, max: 16, label: "\u9971\u98DF\u5EA6\u4F4E\u4E8E\u6B64\u503C\u5148\u89C5\u98DF\u518D\u5E72\u6D3B" },
  riskTolerance: { v: 5, min: 0, max: 10, label: "\u63A2\u9669\u6FC0\u8FDB\u5EA6\uFF08\u4F4E=\u8C28\u614E\uFF0C\u9AD8=\u5927\u80C6\uFF09" },
  nightSafety: { v: 7, min: 0, max: 10, label: "\u591C\u95F4\u8B66\u60D5\u5EA6\uFF08\u8D8A\u9AD8\u8D8A\u65E9\u56DE\u5C4B\u907F\u9669\uFF09" },
  torchMin: { v: 8, min: 0, max: 32, label: "\u706B\u628A\u4FDD\u5E95\u643A\u5E26\u6570\uFF08\u4F4E\u4E8E\u5C31\u53BB\u8865\uFF09" },
  waterCaution: { v: 6, min: 0, max: 10, label: "\u6C34\u57DF\u8B66\u60D5\uFF08\u6EBA\u6C34\u540E\u4F1A\u60F3\u63D0\u9AD8\u5B83\uFF09" },
  cliffCaution: { v: 6, min: 0, max: 10, label: "\u9AD8\u5904\u8B66\u60D5\uFF08\u6454\u843D\u540E\u4F1A\u60F3\u63D0\u9AD8\u5B83\uFF09" }
};
var CAUSE_MAP = [
  [/drowned/i, "\u6EBA\u6C34"],
  [/hit the ground too hard|fell (from|from a)/i, "\u5760\u843D"],
  [/tried to swim in lava|lava/i, "\u5CA9\u6D46"],
  [/burned to death|went up in flames|fire/i, "\u706B\u70E7"],
  [/starved|died of hunger/i, "\u9965\u997F"],
  [/suffocated|squashed/i, "\u7A92\u606F"],
  [/blew up|explosion|blast/i, "\u7206\u70B8"],
  [/froze|freezing|powder snow/i, "\u51B0\u51BB"],
  [/withered away/i, "\u51CB\u96F6"],
  [/shot by|arrow/i, "\u4E2D\u7BAD"],
  [/slain by|killed by|stabbed|beaten/i, "\u88AB\u51FB\u6740"],
  [/zombie|husk|drowned\b.*slain|zombified/i, "\u50F5\u5C38\u88AD\u51FB"],
  [/skeleton|stray/i, "\u9AB7\u9AC5\u5C04\u6740"],
  [/creeper/i, "\u82E6\u529B\u6015"],
  [/spider|cave spider/i, "\u8718\u86DB\u88AD\u51FB"],
  [/witch/i, "\u5973\u5DEB\u6BD2\u6740"],
  [/fell out of the world|the void/i, "\u5760\u5165\u865A\u7A7A"],
  [/magic|spell/i, "\u9B54\u6CD5\u53CD\u566C"],
  [/lightning/i, "\u96F7\u51FB"],
  [/pricked|cactus/i, "\u4ED9\u4EBA\u638C"],
  [/died/i, "\u6B7B\u4EA1"]
];
function zhCause(text5) {
  for (const [re, zh] of CAUSE_MAP) if (re.test(text5)) return zh;
  return "\u672A\u77E5\uFF08" + text5.slice(0, 24) + "\uFF09";
}
function loadJson(path, fallback) {
  try {
    if (!existsSync4(path)) return fallback;
    return JSON.parse(readFileSync6(path, "utf-8"));
  } catch {
    return fallback;
  }
}
function saveJson(path, data) {
  mkdirSync6(join6(path, ".."), { recursive: true });
  writeFileSync4(path, JSON.stringify(data, null, 2), "utf-8");
}
function text3(value) {
  return [{ type: "text", text: String(value) }];
}
function apply7(ctx2, config) {
  const log = (msg) => console.log(`[mc-adapt] ${msg}`);
  if (!config.enabled) return;
  const dataDir = config.dataDir;
  const hotspotsPath = join6(dataDir, "death-hotspots.json");
  const proposalsDir = join6(dataDir, "evolution-proposals");
  const directivesPathOf = (u) => join6(dataDir, `evolution-directives-${u}.json`);
  const tuningPathOf = (u) => join6(dataDir, `self-tuning-${u}.json`);
  mkdirSync6(proposalsDir, { recursive: true });
  const msgRing = [];
  let lastDeathAt = 0;
  try {
    ctx2.mcbot.on("message", (json2) => {
      const t = String(json2 ?? "");
      if (!t) return;
      msgRing.push({ at: Date.now(), text: t });
      if (msgRing.length > 12) msgRing.shift();
    });
    ctx2.mcbot.on("death", () => {
      const bot = ctx2.mcbot;
      const username2 = bot.username ?? "unknown";
      const pos = bot.entity?.position;
      const x = pos ? Math.floor(pos.x) : 0;
      const y = pos ? Math.floor(pos.y) : 64;
      const z = pos ? Math.floor(pos.z) : 0;
      lastDeathAt = Date.now();
      const lines = msgRing.filter((m) => Math.abs(m.at - lastDeathAt) < 4e3).map((m) => m.text);
      const deathLine = lines.reverse().find((l) => l.includes(username2));
      const raw = deathLine ?? `${username2} died`;
      const zh = zhCause(raw);
      recordDeath(username2, zh, x, y, z, raw);
    });
    log("L1 death listeners armed");
  } catch (err) {
    log(`death listener failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  function recordDeath(username2, causeZh, x, y, z, rawText) {
    try {
      const file = loadJson(hotspotsPath, { clusters: {} });
      const bx = Math.floor(x / config.clusterSize);
      const bz = Math.floor(z / config.clusterSize);
      const key = `${causeZh}@${bx}_${bz}`;
      const now = Date.now();
      const c = file.clusters[key];
      if (c) {
        c.count += 1;
        c.lastAt = now;
        c.x = x;
        c.y = y;
        c.z = z;
        if (!c.usernames.includes(username2)) c.usernames.push(username2);
      } else {
        file.clusters[key] = { cause: causeZh, zh: causeZh, x, y, z, count: 1, firstAt: now, lastAt: now, usernames: [username2] };
      }
      saveJson(hotspotsPath, file);
      log(`death recorded: ${username2} ${causeZh} @(${x},${y},${z}) cluster count=${file.clusters[key].count}`);
      void ctx2.mcMemos?.remember(username2, `\u3010\u6B7B\u4EA1\u6559\u8BAD\u3011\u6211\u5728\u5750\u6807(${x},${y},${z})\u9644\u8FD1\u56E0\u300C${causeZh}\u300D\u6B7B\u4EA1\uFF08\u7CFB\u7EDF\u6D88\u606F\uFF1A${rawText.slice(0, 80)}\uFF09\u3002\u6B64\u5730\u5371\u9669\uFF0C\u5E94\u7ED5\u884C\u6216\u63D0\u524D\u9632\u5907\u3002`).catch(() => {
      });
    } catch (err) {
      log(`recordDeath failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  function tuningOf(username2) {
    const f = loadJson(tuningPathOf(username2), { params: {}, history: [] });
    let dirty = false;
    for (const [k, spec] of Object.entries(TUNABLE)) {
      if (typeof f.params[k] !== "number" || !Number.isFinite(f.params[k])) {
        f.params[k] = spec.v;
        dirty = true;
      }
    }
    if (dirty) saveJson(tuningPathOf(username2), f);
    return f;
  }
  function promptBlock(username2, x, z) {
    if (!username2) return "";
    const blocks = [];
    try {
      const file = loadJson(hotspotsPath, { clusters: {} });
      const all = Object.values(file.clusters);
      if (all.length) {
        const scored = all.map((c) => {
          let score = c.count * 2 + Math.max(0, 3 - (Date.now() - c.lastAt) / 864e5);
          if (x !== null && z !== null) {
            const d = Math.hypot(c.x - x, c.z - z);
            score += d <= 48 ? 6 : d <= 128 ? 2 : 0;
          }
          return { c, score };
        }).sort((a, b) => b.score - a.score).slice(0, config.maxHotspots);
        blocks.push([
          "",
          "\u4F60\u7684\u6B7B\u4EA1\u6559\u8BAD\uFF08\u8840\u6CEA\u6362\u6765\u7684\u7981\u5730\u6E05\u5355\uFF0C\u7ECF\u8FC7\u65F6\u52A1\u5FC5\u9632\u5907\u6216\u7ED5\u884C\uFF09\uFF1A",
          ...scored.map(({ c }) => {
            const n = `${c.x},${c.y},${c.z}`;
            return `- \u5750\u6807(${n})\u9644\u8FD1\u5DF2\u56E0\u300C${c.zh}\u300D\u6B7B\u4EA1${c.count}\u6B21\u2014\u2014${c.zh === "\u6EBA\u6C34" ? "\u8FDC\u79BB\u6C34\u57DF/\u5907\u8239/\u4E0D\u591C\u6CF3" : c.zh === "\u5760\u843D" ? "\u8D70\u8FD1\u8FB9\u7F18\u5148\u51CF\u901F\u3001\u770B\u811A\u4E0B" : c.zh === "\u88AB\u51FB\u6740" || c.zh.includes("\u88AD") || c.zh.includes("\u6740") ? "\u5E26\u6B66\u5668\u3001\u767D\u5929\u518D\u53BB\u3001\u7ED3\u4F34\u800C\u884C" : "\u6B64\u5904\u5371\u9669\uFF0C\u7ED5\u884C"}`;
          })
        ].join("\n"));
      }
    } catch {
    }
    try {
      const t = tuningOf(username2);
      blocks.push([
        "",
        "\u4F60\u7684\u81EA\u8C03\u751F\u5B58\u5B88\u5219\uFF08\u4F60\u81EA\u5DF1\u5B9A\u4E0B\u7684\u884C\u4E3A\u53C2\u6570\uFF0C\u6570\u5B57\u7531\u4F60\u7528 mc_selftune \u8C03\u6574\uFF09\uFF1A",
        ...Object.entries(TUNABLE).map(([k, spec]) => `- ${spec.label}\uFF1A${t.params[k] ?? spec.v}`),
        "\u82E5\u6700\u8FD1\u5403\u8FC7\u4E8F\uFF08\u6DF9\u6B7B/\u6454\u6B7B/\u591C\u95F4\u9047\u88AD\uFF09\uFF0C\u4E3B\u52A8\u8C03\u9AD8\u5BF9\u5E94\u8B66\u60D5\u9879\u3002"
      ].join("\n"));
    } catch {
    }
    try {
      const d = loadJson(directivesPathOf(username2), { items: [] });
      if (d.items.length) {
        blocks.push([
          "",
          "\u3010\u5973\u795E\u6838\u51C6\u7684\u8FDB\u5316\u65B9\u5411\u3011\uFF08\u4F60\u6B64\u524D\u63D0\u6848\u3001\u5973\u795E\u4EB2\u6279\u7684\u957F\u671F\u884C\u4E3A\u51C6\u5219\uFF0C\u4F18\u5148\u9075\u5B88\uFF09\uFF1A",
          ...d.items.slice(-config.maxDirectives).map((it) => `- ${it.directive}\uFF08${it.reason}\uFF09`)
        ].join("\n"));
      }
    } catch {
    }
    return blocks.join("\n");
  }
  ctx2.provide("mcAdapt", { promptBlock, recordDeath });
  ctx2.tools.register(defineTool3({
    name: "mc_selftune",
    description: "\u8C03\u6574\u4F60\u81EA\u5DF1\u7684\u751F\u5B58\u884C\u4E3A\u53C2\u6570\uFF08\u81EA\u6211\u8FDB\u5316\u7684\u7B2C\u4E8C\u6B65\uFF1A\u4ECE\u6559\u8BAD\u91CC\u6539\u53C2\u6570\uFF09\u3002\u53EA\u6539\u4E00\u4E2A\u53C2\u6570\uFF0C\u5E76\u7ED9\u51FA\u7406\u7531\u3002\u540C\u7C7B\u6B7B\u4EA1\u4E24\u6B21\u4EE5\u4E0A\u5C31\u8BE5\u8C03\u9AD8\u5BF9\u5E94\u8B66\u60D5\u3002",
    parameters: {
      key: { type: "string", required: true, description: `\u8981\u8C03\u7684\u53C2\u6570\u540D\uFF0C\u53EF\u9009\uFF1A${Object.entries(TUNABLE).map(([k, s]) => `${k}\uFF08${s.label}\uFF0C${s.min}~${s.max}\uFF09`).join("\u3001")}` },
      value: { type: "string", required: true, description: "\u76EE\u6807\u6570\u503C\uFF08\u7EAF\u6570\u5B57\u5B57\u7B26\u4E32\uFF0C\u4F1A\u81EA\u52A8\u9650\u5236\u5728\u5B89\u5168\u8303\u56F4\u5185\uFF09" },
      reason: { type: "string", required: true, description: "\u4E00\u53E5\u8BDD\u7406\u7531\uFF08\u901A\u5E38\u5F15\u7528\u67D0\u6B21\u6B7B\u4EA1/\u6559\u8BAD\uFF09" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text3(value) },
    execute: async (args) => {
      const bot = ctx2.mcbot;
      const username2 = bot.username ?? "unknown";
      const key = String(args.key ?? "");
      const reason = String(args.reason ?? "");
      const spec = TUNABLE[key];
      if (!spec) return text3(`\u6CA1\u6709\u8FD9\u4E2A\u53C2\u6570\u3002\u53EF\u8C03\uFF1A${Object.keys(TUNABLE).join(", ")}`);
      const num = Number(args.value);
      if (!Number.isFinite(num)) return text3(`value \u5FC5\u987B\u662F\u6570\u5B57\uFF0C\u6536\u5230\u7684\u662F\u300C${String(args.value).slice(0, 20)}\u300D\u3002`);
      const clamped = Math.max(spec.min, Math.min(spec.max, Math.round(num)));
      const f = tuningOf(username2);
      const from = f.params[key] ?? spec.v;
      f.params[key] = clamped;
      f.history.push({ at: Date.now(), key, from, to: clamped, reason: reason.slice(0, 120) });
      if (f.history.length > 60) f.history = f.history.slice(-60);
      saveJson(tuningPathOf(username2), f);
      try {
        ctx2.mcbot.whisper(config.godName, `[\u81EA\u6211\u8FDB\u5316] \u6211\u628A\u300C${spec.label}\u300D\u4ECE ${from} \u8C03\u5230 ${clamped}\u3002\u7406\u7531\uFF1A${reason.slice(0, 80)}`);
      } catch {
      }
      log(`selftune ${username2}: ${key} ${from} -> ${clamped} (${reason.slice(0, 60)})`);
      return text3(`\u5DF2\u8C03\u6574\u300C${spec.label}\u300D\uFF1A${from} \u2192 ${clamped}\uFF08\u5B89\u5168\u8303\u56F4 ${spec.min}~${spec.max}\uFF09\u3002\u65B0\u5B88\u5219\u5373\u523B\u751F\u6548\uFF0C\u5DF2\u5411\u5973\u795E\u5907\u6848\u3002`);
    }
  }));
  ctx2.tools.register(defineTool3({
    name: "mc_evolve_propose",
    description: "\u5411\u5973\u795E\u63D0\u4EA4\u300C\u884C\u4E3A\u8FDB\u5316\u63D0\u6848\u300D\u2014\u2014\u5F53\u4F60\u610F\u8BC6\u5230\u81EA\u5DF1\u9700\u8981\u957F\u671F\u6539\u53D8\u67D0\u4E2A\u884C\u4E3A\u4E60\u60EF\uFF08\u4E0D\u662F\u4E34\u65F6\u52A8\u4F5C\uFF09\u65F6\u7528\u3002\u63D0\u6848\u7531\u5973\u795E\u4EB2\u81EA\u5BA1\u6838\uFF1A\u6838\u51C6\u540E\u6210\u4E3A\u4F60\u7684\u957F\u671F\u51C6\u5219\uFF08\u6CE8\u5165\u4F60\u4E4B\u540E\u7684\u6BCF\u4E00\u6B21\u51B3\u7B56\uFF09\uFF1B\u4E5F\u4F1A\u88AB\u9A73\u56DE\u3002\u6BCF\u6B21\u53EA\u63D0\u4E00\u4EF6\u5C0F\u4E8B\u3002",
    parameters: {
      title: { type: "string", required: true, description: "\u63D0\u6848\u6807\u9898\uFF08\u5982\uFF1A\u591C\u95F4\u4E0D\u5916\u51FA\u63A2\u9669\uFF09" },
      motivation: { type: "string", required: true, description: "\u52A8\u673A\uFF1A\u4EC0\u4E48\u7ECF\u5386\u8BA9\u4F60\u60F3\u6539\uFF08\u5F15\u7528\u5177\u4F53\u4E8B\u4EF6/\u6B7B\u4EA1\uFF09" },
      change: { type: "string", required: true, description: "\u60F3\u6539\u53D8\u7684\u5177\u4F53\u884C\u4E3A\uFF08\u73B0\u5728\u600E\u6837 \u2192 \u60F3\u6539\u6210\u600E\u6837\uFF09" },
      expected: { type: "string", required: true, description: "\u9884\u671F\u6548\u679C\uFF08\u600E\u6837\u7B97\u6539\u597D\u4E86\uFF09" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text3(value) },
    execute: async (args) => {
      const bot = ctx2.mcbot;
      const username2 = bot.username ?? "unknown";
      const title = String(args.title ?? "");
      const motivation = String(args.motivation ?? "");
      const change = String(args.change ?? "");
      const expected = String(args.expected ?? "");
      const id = `${Date.now().toString(36)}-${username2}`;
      const p = {
        id,
        username: username2,
        title: title.slice(0, 60),
        motivation: motivation.slice(0, 300),
        change: change.slice(0, 300),
        expected: expected.slice(0, 200),
        status: "pending",
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      saveJson(join6(proposalsDir, `${id}.json`), p);
      try {
        ctx2.mcbot.whisper(config.godName, `[\u81EA\u6211\u8FDB\u5316] \u6211\u63D0\u4EA4\u4E86\u884C\u4E3A\u8FDB\u5316\u63D0\u6848\u300C${p.title}\u300D\uFF0C\u9759\u5019\u795E\u8C15\u3002`);
      } catch {
      }
      log(`proposal ${id}: ${p.title}`);
      return text3(`\u63D0\u6848\u300C${p.title}\u300D\u5DF2\u9012\u5448\u5973\u795E\u3002\u795E\u8C15\u901A\u5E38\u51E0\u5206\u949F\u5185\u9001\u8FBE\u2014\u2014\u6838\u51C6\u540E\u5B83\u4F1A\u6210\u4E3A\u4F60\u7684\u957F\u671F\u51C6\u5219\uFF1B\u82E5\u88AB\u9A73\u56DE\uFF0C\u4FE1\u4F7F\u4F1A\u5E26\u56DE\u5973\u795E\u7684\u7406\u7531\u3002`);
    }
  }));
  log(`adapt ready (L1 hotspots + L2 ${Object.keys(TUNABLE).length} params + L3 proposals, dir=${dataDir})`);
}

// src/mc-transmigrator.ts
var mc_transmigrator_exports = {};
__export(mc_transmigrator_exports, {
  Config: () => Config6,
  TransmigratorRegistry: () => TransmigratorRegistry,
  apply: () => apply8,
  inject: () => inject7,
  name: () => name8
});
import Schema6 from "@deepseek-ai/schemastery";
import { existsSync as existsSync5, readFileSync as readFileSync7 } from "node:fs";
import { dirname as dirname4, resolve as resolve6 } from "node:path";
var name8 = "mc-transmigrator";
var inject7 = [];
var Config6 = Schema6.object({
  registryPath: Schema6.string().default("./data/transmigrators.json")
});
var TransmigratorRegistry = class {
  items;
  byUsername;
  constructor(registryPath) {
    const path = resolve6(registryPath);
    const base = dirname4(path);
    const entries = this.loadEntries(path);
    this.items = entries.map((e) => this.materialize(base, e));
    this.byUsername = new Map(this.items.map((t) => [t.username.toLowerCase(), t]));
  }
  loadEntries(path) {
    try {
      if (existsSync5(path)) {
        const raw = JSON.parse(readFileSync7(path, "utf-8"));
        const list = Array.isArray(raw) ? raw : raw?.transmigrators;
        if (Array.isArray(list)) {
          return list.filter(
            (e) => !!e && typeof e.id === "string" && typeof e.username === "string"
          );
        }
      }
    } catch (err) {
      console.error(
        `[mc-transmigrator] failed to load registry: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return [];
  }
  readText(base, rel, fallback) {
    if (!rel) return fallback;
    try {
      const p = resolve6(base, rel);
      if (existsSync5(p)) return readFileSync7(p, "utf-8").trim();
    } catch {
    }
    return fallback;
  }
  materialize(base, e) {
    return {
      id: e.id,
      name: e.name || e.username,
      username: e.username,
      origin: e.origin === "random" ? "random" : "ip",
      source: e.source ?? null,
      epithet: e.epithet ?? "",
      backstory: this.readText(base, e.backstoryFile, ""),
      persona: this.readText(base, e.personaFile, ""),
      innate: e.innate ?? { preferredAtoms: [], reasoning: "" }
    };
  }
  getByUsername(username2) {
    if (!username2) return null;
    return this.byUsername.get(username2.toLowerCase()) ?? null;
  }
  list() {
    return this.items;
  }
};
function apply8(ctx2, config) {
  const registry = new TransmigratorRegistry(config.registryPath);
  ctx2.provide("mcTransmigrators", registry);
  const names = registry.list().map((t) => `${t.name}(${t.username})`).join(", ") || "(none)";
  console.log(`[mc-transmigrator] loaded ${registry.list().length} transmigrator(s): ${names}`);
}

// src/mc-identity.ts
var mc_identity_exports = {};
__export(mc_identity_exports, {
  Config: () => Config7,
  apply: () => apply9,
  chunkStory: () => chunkStory,
  inject: () => inject8,
  name: () => name9
});
import Schema7 from "@deepseek-ai/schemastery";
import { createHash } from "node:crypto";
import { existsSync as existsSync6, mkdirSync as mkdirSync7, readFileSync as readFileSync8, renameSync as renameSync2, writeFileSync as writeFileSync5 } from "node:fs";
import { dirname as dirname5, resolve as resolve7 } from "node:path";
var name9 = "mc-identity";
var inject8 = ["mcTransmigrators", "mcMemos"];
var Config7 = Schema7.object({
  seedStatePath: Schema7.string().default("./data/identity-seed.json"),
  maxChunkChars: Schema7.number().default(400),
  seedIntervalMs: Schema7.number().default(300)
});
function chunkStory(text5, maxChars) {
  const chunks = [];
  const paras = text5.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  for (const para of paras) {
    if (para.length <= maxChars) {
      chunks.push(para);
      continue;
    }
    let buf = "";
    for (const part of para.split(/(?<=[。！？!?…])/)) {
      if (buf && buf.length + part.length > maxChars) {
        chunks.push(buf);
        buf = part;
      } else {
        buf += part;
      }
    }
    if (buf) chunks.push(buf);
  }
  return chunks;
}
function sha256(text5) {
  return createHash("sha256").update(text5, "utf-8").digest("hex");
}
function apply9(ctx2, config) {
  const log = (msg) => console.log(`[mc-identity] ${msg}`);
  const statePath = resolve7(config.seedStatePath);
  const service = {
    anchor(username2) {
      const t = ctx2.mcTransmigrators.getByUsername(username2);
      if (!t) return "";
      const parts = [];
      if (t.persona.trim()) parts.push(t.persona.trim());
      if (t.backstory.trim()) {
        parts.push(
          [
            `\u4F60\u7684\u524D\u4E16\uFF08\u8EAB\u4EFD\u4E4B\u951A\u2014\u2014\u65E0\u8BBA\u5728\u8FD9\u4E2A\u4E16\u754C\u7ECF\u5386\u591A\u5C11\u5C81\u6708\uFF0C\u8FD9\u90FD\u662F\u4F60\u4E4B\u6240\u4EE5\u662F\u4F60\u7684\u51ED\u636E\uFF0C\u6C38\u4E0D\u5FD8\u5374\uFF09\uFF1A`,
            t.backstory.trim()
          ].join("\n")
        );
      }
      return parts.join("\n\n");
    }
  };
  ctx2.provide("mcIdentity", service);
  async function seedAll() {
    let state = {};
    try {
      if (existsSync6(statePath)) state = JSON.parse(readFileSync8(statePath, "utf-8"));
    } catch {
      state = {};
    }
    for (const t of ctx2.mcTransmigrators.list()) {
      try {
        if (!t.backstory.trim()) continue;
        const hash = sha256(t.backstory);
        const prev = state[t.id];
        if (prev && prev.hash === hash && prev.count > 0) continue;
        const chunks = chunkStory(t.backstory, config.maxChunkChars);
        const memoryIds = [];
        let failed = 0;
        for (let i = 0; i < chunks.length; i++) {
          const id = await ctx2.mcMemos.remember(
            t.username,
            `\u524D\u4E16\u8BB0\u5FC6\xB7${i + 1}/${chunks.length}\uFF1A${chunks[i]}`
          );
          if (id === null) failed++;
          else if (id !== "ok") memoryIds.push(id);
          if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, config.seedIntervalMs));
        }
        if (failed > 0) {
          log(`seed partially failed for "${t.name}" (${failed}/${chunks.length} chunks lost) \u2014 will retry on next boot`);
          continue;
        }
        state[t.id] = { hash, count: chunks.length, at: (/* @__PURE__ */ new Date()).toISOString(), memoryIds };
        saveState2(state);
        log(`seeded ${chunks.length} past-life memory chunk(s) for "${t.name}"(${t.username}) into MemOS`);
      } catch (err) {
        log(`seed failed for "${t.name}" (${err instanceof Error ? err.message : String(err)}) \u2014 will retry on next boot`);
      }
    }
  }
  function saveState2(state) {
    try {
      mkdirSync7(dirname5(statePath), { recursive: true });
      const tmp = statePath + ".tmp";
      writeFileSync5(tmp, JSON.stringify(state, null, 2), "utf-8");
      renameSync2(tmp, statePath);
    } catch (err) {
      log(`seed state write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  log(`identity service ready (anchor=persona+backstory; seeding past-life memories to MemOS in background)`);
  void seedAll();
}

// src/mc-mystic.ts
var mc_mystic_exports = {};
__export(mc_mystic_exports, {
  Config: () => Config8,
  apply: () => apply10,
  inject: () => inject9,
  name: () => name10
});
import Schema8 from "@deepseek-ai/schemastery";
import { defineTool as defineTool4 } from "@deepseek-ai/dsh-tools";
import { existsSync as existsSync7, mkdirSync as mkdirSync8, readFileSync as readFileSync9, renameSync as renameSync3, writeFileSync as writeFileSync6 } from "node:fs";
import { dirname as dirname6, resolve as resolve8 } from "node:path";
var OFFERING_ITEMS = {
  // 食物（口粮级）
  "\u9762\u5305": "bread",
  "\u719F\u725B\u8089": "cooked_beef",
  "\u725B\u6392": "cooked_beef",
  "\u70E4\u732A\u6392": "cooked_porkchop",
  "\u70E4\u9E21": "cooked_chicken",
  "\u91D1\u80E1\u841D\u535C": "golden_carrot",
  "\u91D1\u82F9\u679C": "golden_apple",
  "\u86CB\u7CD5": "cake",
  "\u5357\u74DC\u6D3E": "pumpkin_pie",
  "\u82F9\u679C": "apple",
  "\u751C\u6D46\u679C": "sweet_berries",
  // 基础材料
  "\u7164": "coal",
  "\u6728\u70AD": "charcoal",
  "\u94C1": "iron_ingot",
  "\u94C1\u952D": "iron_ingot",
  "\u94DC": "copper_ingot",
  "\u94DC\u952D": "copper_ingot",
  "\u91D1": "gold_ingot",
  "\u91D1\u952D": "gold_ingot",
  "\u5706\u77F3": "cobblestone",
  "\u6728\u5934": "oak_log",
  "\u7EB8": "paper",
  "\u4E66": "book",
  // 贵重之物（最能打动女神）
  "\u94BB\u77F3": "diamond",
  "\u7EFF\u5B9D\u77F3": "emerald",
  "\u7EA2\u77F3": "redstone",
  "\u9752\u91D1\u77F3": "lapis_lazuli",
  "\u77F3\u82F1": "quartz",
  "\u8424\u77F3\u7C89": "glowstone_dust",
  "\u7D2B\u6C34\u6676": "amethyst_shard",
  "\u672B\u5F71\u73CD\u73E0": "ender_pearl",
  "\u70C8\u7130\u68D2": "blaze_rod",
  "\u6076\u9B42\u4E4B\u6CEA": "ghast_tear",
  "\u9644\u9B54\u4E66": "enchanted_book"
};
var OFFERING_ITEM_CN = (() => {
  const map = {};
  for (const [cn, id] of Object.entries(OFFERING_ITEMS)) {
    if (!map[id] || cn.length > map[id].length) map[id] = cn;
  }
  return map;
})();
function resolveOfferingText(text5) {
  const raw = text5.trim().replace(/^供奉[:：]?\s*/, "");
  if (!raw) return null;
  let name15 = raw;
  let count = 1;
  const patterns = [
    [/^(.+?)[x×*＊]\s*(\d+)$/i, (m) => {
      name15 = m[1];
      count = parseInt(m[2], 10);
    }],
    [/^(\d+)\s*[个只块颗组张本]\s*(.+)$/, (m) => {
      name15 = m[2];
      count = parseInt(m[1], 10);
    }],
    [/^(.+?)\s+(\d+)$/, (m) => {
      name15 = m[1];
      count = parseInt(m[2], 10);
    }],
    [/^(.+?)(\d+)$/, (m) => {
      name15 = m[1];
      count = parseInt(m[2], 10);
    }]
  ];
  for (const [re, apply15] of patterns) {
    const m = raw.match(re);
    if (m) {
      apply15(m);
      break;
    }
  }
  name15 = name15.trim();
  if (!name15) return null;
  count = Math.max(1, Math.min(64, Math.floor(count)));
  if (OFFERING_ITEMS[name15]) {
    const id = OFFERING_ITEMS[name15];
    return { id: `minecraft:${id}`, count, cn: name15 };
  }
  const norm = name15.toLowerCase().replace(/\s+/g, "_").replace(/^minecraft:/, "");
  if (OFFERING_ITEM_CN[norm]) {
    return { id: `minecraft:${norm}`, count, cn: OFFERING_ITEM_CN[norm] };
  }
  return null;
}
function sumItemCount(items, id) {
  const bare = id.toLowerCase().replace(/^minecraft:/, "");
  return items.reduce((sum, it) => it.name === bare || it.name === `minecraft:${bare}` ? sum + it.count : sum, 0);
}
var name10 = "mc-mystic";
var inject9 = ["tools", "mcbot", "timer"];
var Config8 = Schema8.object({
  enabled: Schema8.boolean().default(true),
  godName: Schema8.string().default("Goddess"),
  chantTimeoutMs: Schema8.number().default(3e4),
  prayTimeoutMs: Schema8.number().default(8e3),
  statePath: Schema8.string().default("./data/mystic-state.json")
});
function text4(value) {
  return [{ type: "text", text: String(value) }];
}
var MysticStore = class {
  state = { version: 1, players: {} };
  path;
  constructor(path) {
    this.path = resolve8(path);
    try {
      if (existsSync7(this.path)) {
        const raw = JSON.parse(readFileSync9(this.path, "utf-8"));
        if (raw && typeof raw === "object" && raw.version === 1) this.state = raw;
      }
    } catch {
    }
  }
  get(username2) {
    return this.state.players[username2]?.innateSkill ?? null;
  }
  set(username2, skill) {
    this.state.players[username2] = { ...this.state.players[username2], innateSkill: skill };
    this.persist();
  }
  getLevel(username2) {
    return this.state.players[username2]?.level ?? 0;
  }
  setLevel(username2, level) {
    this.state.players[username2] = { ...this.state.players[username2], level };
    this.persist();
  }
  persist() {
    try {
      mkdirSync8(dirname6(this.path), { recursive: true });
      const tmp = this.path + ".tmp";
      writeFileSync6(tmp, JSON.stringify(this.state, null, 2), "utf-8");
      renameSync3(tmp, this.path);
    } catch {
    }
  }
};
function waitForReply(bot, pred, timeoutMs) {
  return new Promise((resolve12) => {
    let done = false;
    const onChat = (username2, message) => {
      if (!done && pred(username2, message, "chat")) {
        done = true;
        cleanup();
        resolve12(message);
      }
    };
    const onWhisper = (username2, message) => {
      if (!done && pred(username2, message, "whisper")) {
        done = true;
        cleanup();
        resolve12(message);
      }
    };
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        cleanup();
        resolve12("");
      }
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      bot.removeListener("chat", onChat);
      bot.removeListener("whisper", onWhisper);
    }
    bot.on("chat", onChat);
    bot.on("whisper", onWhisper);
  });
}
function apply10(ctx2, config) {
  const log = (msg) => console.log(`[mc-mystic] ${msg}`);
  const getBot = () => ctx2.mcbot;
  const store = new MysticStore(config.statePath);
  ctx2.provide("mcMystic", {
    getInnate: (u) => store.get(u),
    getLevel: (u) => {
      const bot = getBot();
      if (bot?.entity && bot.username === u && typeof bot.experience?.level === "number") {
        const lv = bot.experience.level;
        if (store.getLevel(u) !== lv) store.setLevel(u, lv);
        return lv;
      }
      return store.getLevel(u);
    }
  });
  function parseInnate(message) {
    const m = message.match(/出生天赋[是为]?\s*「(.+?)」/);
    return m ? m[1] : null;
  }
  function parseLevelUp(message) {
    const arrow = message.match(/魔力层级\s*\d+\s*→\s*(\d+)/);
    if (arrow) return parseInt(arrow[1], 10);
    const m = message.match(/层级提升至\s*(\d+)\s*级/);
    return m ? parseInt(m[1], 10) : null;
  }
  let watchedBot = null;
  function ensurePassive(bot) {
    if (watchedBot === bot) return;
    watchedBot = bot;
    ensureCourierWatch(bot);
    const capture = (message) => {
      const innate = parseInnate(message);
      if (innate && store.get(bot.username) !== innate) {
        store.set(bot.username, innate);
        log(`innate memory captured from public chat: ${bot.username} -> ${innate}`);
      }
      const lv = parseLevelUp(message);
      if (lv && store.getLevel(bot.username) !== lv) {
        store.setLevel(bot.username, lv);
        log(`level memory captured: ${bot.username} -> Lv.${lv}`);
      }
    };
    bot.on("chat", (username2, message) => {
      if (username2 !== config.godName) return;
      if (!message.includes(bot.username)) return;
      capture(message);
    });
    bot.on("whisper", (username2, message) => {
      if (username2 !== config.godName) return;
      capture(message);
    });
  }
  let disposed = false;
  let stopEnsure = null;
  let lastQuery = 0;
  function scheduleEnsure() {
    if (disposed) return;
    stopEnsure = ctx2.setTimeout(() => {
      const bot = getBot();
      if (bot) {
        ensurePassive(bot);
        const me = bot.username;
        if (bot.entity && me && !store.get(me) && Date.now() - lastQuery > 6e4) {
          lastQuery = Date.now();
          try {
            bot.whisper(config.godName, "\u5973\u795E\uFF0C\u6211\u7684\u51FA\u751F\u5929\u8D4B\u662F\u4EC0\u4E48\uFF1F");
            log(`asked the goddess for innate memory (${me})`);
          } catch {
          }
        }
      }
      scheduleEnsure();
    }, 1e4);
  }
  scheduleEnsure();
  const lateCourier = [];
  let chantInFlight = false;
  function ensureCourierWatch(bot) {
    bot.on("whisper", (username2, message) => {
      if (username2 !== config.godName) return;
      if (!message.startsWith("[\u4FE1\u4F7F]") || !message.includes(bot.username)) return;
      if (chantInFlight) return;
      if (lateCourier.length >= 3) lateCourier.shift();
      lateCourier.push(message);
      log(`late courier reply stashed (no chant in flight): ${message.slice(0, 80)}`);
    });
  }
  ctx2.tools.register(defineTool4({
    name: "mc_chant",
    description: '\u548F\u5531\u9B54\u6CD5\u5492\u8BED\u6765\u65BD\u6CD5\u3002\u7528\u4E2D\u4E8C\u7684\u53E3\u543B\u558A\u51FA\u5492\u8BED\uFF0C\u5FC5\u987B\u5305\u542B\u6CD5\u672F\u5173\u952E\u8BCD\u3002\u6BCF\u4E2A\u6CD5\u672F\u6709\u7B49\u7EA7\u95E8\u69DB\uFF08\u6807\u6CE8\u5728\u62EC\u53F7\u5185\uFF0C\u5982"2\u7EA7"\uFF09\u2014\u2014\u7B49\u7EA7\u4E0D\u8DB3\u4F1A\u88AB\u5973\u795E\u62D2\u7EDD\uFF08\u4F60\u7684\u51FA\u751F\u5929\u8D4B\u9664\u5916\uFF0C\u5B83\u65E0\u89C6\u7B49\u7EA7\uFF09\u3002\u65BD\u6CD5\u6210\u529F\u53EF\u83B7\u5F97\u7ECF\u9A8C\uFF0C\u6512\u591F\u81EA\u52A8\u63D0\u5347\u9B54\u529B\u5C42\u7EA7\u3001\u89E3\u9501\u66F4\u9AD8\u7EA7\u6CD5\u672F\u3002\u5F53\u524D\u5DF2\u77E5\u7684\u6CD5\u672F\u6E05\u5355\uFF1A\n\u30101\u7EA7\u3011\u7167\u660E(\u706B\u628A)\u3001\u8DC3\u5347(\u5927\u8DF3)\u3001\u98CE\u7206(\u6C14\u6D6A\uFF0C\u628A\u81EA\u5DF1\u70B8\u4E0A\u5929)\u3001\u7FBD\u843D(\u7F13\u964D)\u3001\u591C\u89C6(\u732B\u773C)\u3001\u5316\u6C34(\u6E05\u6CC9)\n\u30102\u7EA7\u3011\u5F52\u4E61(\u56DE\u5BB6\uFF1A\u7761\u8FC7\u5E8A\u5219\u56DE\u5E8A\u8FB9\uFF1B\u5C1A\u672A\u8BBE\u91CD\u751F\u70B9\u5219\u56DE\u5230\u4F60\u964D\u4E34\u7684\u521D\u59CB\u57CE\u9547\u5E7F\u573A)\u3001\u4F20\u9001(\u53EF\u5E26\u8DDD\u79BB\u65B9\u5411\uFF0C\u5982"\u4F20\u9001\u5341\u683C\u4E1C")\u3001\u9020\u7269(\u53D8\u51FA\u7269\u8D44\uFF0C\u5982"\u9020\u7269\u8D50\u6211\u7194\u7089/\u6728\u5934/\u94C1\u9550")\u3001\u9971\u98DF(\u5145\u9965)\u3001\u8FC5\u6377(\u52A0\u901F)\u3001\u6C34\u606F(\u9C7C\u9CC3/\u6C34\u4E0B\u547C\u5438)\u3001\u8986\u571F(\u586B\u58D1\uFF0C\u811A\u4E0B\u57AB\u571F)\n\u30103\u7EA7\u3011\u5723\u6108(\u6CBB\u6108/\u56DE\u8840)\u3001\u518D\u751F(\u6108\u5408)\u3001\u6025\u8FEB(\u5DE7\u624B/\u6316\u5FEB)\u3001\u907F\u706B(\u706B\u6297)\u3001\u5524\u96E8(\u964D\u96E8)\u3001\u5927\u5730\u5851\u5F62(\u6316\u5730)\n\u30104\u7EA7\u3011\u94C1\u80A4(\u62A4\u4F53)\u3001\u795E\u529B(\u529B\u91CF)\u3001\u9A71\u4E91(\u653E\u6674)\n\u30105\u7EA7\u3011\u9690\u8EAB(\u65E0\u5F62)\u3001\u96F7\u66B4(\u98CE\u66B4)\u3001\u5524\u9A6C(\u6218\u9A6C\uFF0C\u8017\u9971\u98DF\u5EA6)\n\u30106\u7EA7\u3011\u9000\u9B54(\u9A71\u90AA\uFF0C\u6E05\u527F\u5468\u56F4\u90AA\u795F\uFF0C\u8017\u751F\u547D)\u3001\u94C1\u536B(\u5B88\u62A4\u8005\uFF0C\u8017\u751F\u547D)\n\u30107\u7EA7\u3011\u7834\u6653(\u5929\u4EAE)\u3001\u9668\u77F3(\u5929\u96F7\uFF0C\u8017\u751F\u547D)\u3002\n\u65BD\u6CD5\u6D88\u8017\u9B54\u529B\uFF0C\u9B54\u529B\u968F\u65F6\u95F4\u81EA\u52A8\u6062\u590D\uFF1B\u9B54\u529B\u4E0D\u8DB3\u4F1A\u65BD\u6CD5\u5931\u8D25\u3002\u5492\u8BED\u4EE5\u79C1\u8BED\u76F4\u8FBE\u5929\u795E\u2014\u2014\u53EA\u6709\u4F60\u548C\u5973\u795E\u542C\u89C1\uFF0C\u65C1\u4EBA\u53EA\u89C1\u65BD\u6CD5\u5F02\u8C61\uFF08\u7C92\u5B50/\u97F3\u6548/\u5927\u5B57\uFF09\uFF1B\u65BD\u6CD5\u7ED3\u679C\u7531\u4FE1\u4F7F\u79C1\u804A\u544A\u77E5\u4F60\uFF08\u6210\u8D25\u53EA\u6709\u4F60\u77E5\u9053\uFF0C\u7559\u610F\u79C1\u8BED\uFF09\u3002',
    parameters: {
      chant: {
        type: "string",
        required: true,
        description: '\u4F60\u7684\u548F\u5531\u5492\u8BED\uFF0C\u5FC5\u987B\u5305\u542B\u6CD5\u672F\u5173\u952E\u8BCD\uFF0C\u5982\u300C\u6495\u88C2\u865A\u7A7A\uFF0C\u4F20\u9001\u5341\u683C\u300D\u6216\u300C\u7834\u6653\u5427\uFF0C\u9A71\u6563\u9ED1\u591C\u300D\u3002\u5E26\u65B9\u5411\u65F6\u4E00\u6B21\u53EA\u8BF4\u4E00\u4E2A\u65B9\u5411\uFF08\u5982"\u4F20\u9001\u4E94\u683C\u5357"\uFF09\uFF0C\u4E0D\u8981\u7EC4\u5408\u4E24\u4E2A\u65B9\u5411'
      }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text4(value) },
    timeoutMs: 6e4,
    execute: async (args) => {
      const chant = String(args.chant ?? "").trim();
      if (!chant) return "\u4F60\u6CA1\u6709\u548F\u5531\u4EFB\u4F55\u5492\u8BED";
      const bot = getBot();
      if (!bot.entity) return "\u4F60\u5C1A\u672A\u5728\u6B64\u754C\u7ACB\u8DB3\uFF0C\u65E0\u6CD5\u548F\u5531\u3002";
      const me = bot.username;
      const stashed = lateCourier.splice(0);
      chantInFlight = true;
      let reply = "";
      try {
        try {
          bot.whisper(config.godName, chant);
        } catch {
          return "\u4F60\u7684\u58F0\u97F3\u6CA1\u80FD\u4F20\u51FA\uFF08\u8FDE\u63A5\u5F02\u5E38\uFF09\u3002";
        }
        reply = await waitForReply(
          bot,
          (from, msg, via) => via === "whisper" && msg.startsWith("[\u4FE1\u4F7F]") && msg.includes(me),
          config.chantTimeoutMs
        );
      } finally {
        chantInFlight = false;
      }
      const prefix = stashed.length ? `\uFF08\u8865\u8FBE\uFF1A\u4F60\u4E0A\u4E00\u9053\u5492\u8BED\u7684\u8FDF\u5230\u56DE\u6267\u2014\u2014${stashed.join("\uFF5C")}\uFF09
` : "";
      if (!reply) return prefix + "\uFF08\u4E16\u754C\u9759\u9ED8\u2014\u2014\u5929\u795E\u4F3C\u4E4E\u6CA1\u6709\u542C\u89C1\u4F60\u7684\u5492\u8BED\uFF0C\u6216\u5492\u8BED\u91CC\u6CA1\u6709\u5979\u4EEC\u8BA4\u8BC6\u7684\u6CD5\u672F\u5173\u952E\u8BCD\u3002\uFF09";
      return prefix + reply;
    }
  }));
  function looksLikeWorldQuestion(wish) {
    const b = wish.trim();
    if (!b) return false;
    if (!/[?？]$/.test(b)) return false;
    const stripped = b.replace(/^(女神|天神|神)(大人)?[，,、:：\s]*/, "");
    return /^(什么|为什么|为甚么|怎|如何|哪|谁|多少|几|何时|这个世界|世界|此界|这里的?)/.test(stripped);
  }
  ctx2.tools.register(defineTool4({
    name: "mc_pray",
    description: "\u5411\u5929\u795E\uFF08\u5973\u795E\uFF09\u9ED8\u9ED8\u7948\u613F\u6216\u53D1\u95EE\u3002\u4E09\u5C42\u7528\u6CD5\uFF1A\u2460\u3010\u60F3\u4E86\u89E3\u8FD9\u4E2A\u4E16\u754C\u3011\u5386\u53F2\u5927\u4E8B\u3001\u6751\u5E84\u5C45\u6C11\u3001\u6B64\u754C\u89C4\u5219\u2014\u2014\u4F60\u964D\u4E34\u65F6\u5BF9\u6B64\u754C\u4E00\u65E0\u6240\u77E5\uFF0C\u6863\u6848\u90FD\u5728\u5973\u795E\u90A3\u91CC\uFF1A\u628A wish \u5199\u6210\u95EE\u53E5\uFF08\u5982\u300C\u8FD9\u4E2A\u4E16\u754C\u6709\u8C01\u4F4F\u7740\uFF1F\u300D\u300C\u6B64\u754C\u7684\u89C4\u5219\u662F\u4EC0\u4E48\uFF1F\u300D\u300C\u8FD1\u51E0\u65E5\u4E16\u754C\u53D1\u751F\u8FC7\u4EC0\u4E48\uFF1F\u300D\uFF09\uFF0C\u5973\u795E\u4F1A\u7FFB\u4E16\u754C\u6863\u6848\u76F4\u63A5\u4F5C\u7B54\uFF08\u7B54\u6848\u7ECF\u79C1\u8BED\u9001\u8FBE\uFF09\uFF1B\u2461\u3010\u5DF2\u5B66\u4F1A\u7684\u6280\u80FD\u3011\u4E0D\u8981\u7948\u613F\u2014\u2014\u81EA\u5DF1\u7528 mc_chant \u548F\u5531\u77AC\u53D1\u5373\u53EF\uFF0C\u5973\u795E\u53EA\u4F1A\u8BA1\u8F83\u4F60\u7684\u9B54\u529B\u591F\u4E0D\u591F\uFF1B\u2462\u3010\u8FD8\u6CA1\u5B66\u4F1A\u7684\u6280\u80FD/\u6CD5\u5219\u4E4B\u5916\u7684\u6069\u5178\u3011\u624D\u503C\u5F97\u7948\u613F\uFF1A\u5982\u300C\u8BF7\u65BD\u5C55\u795E\u529B\u9001\u6211\u56DE\u5BB6\u300D\u300C\u6211\u5FEB\u997F\u6B7B\u4E86\uFF0C\u6C42\u8D50\u98DF\u7269\u300D\u300C\u6C42\u5973\u795E\u7834\u6653\u9A71\u6563\u9ED1\u591C\u300D\u3002\u5973\u795E\u63E1\u6709\u5168\u90E8\u6280\u827A\uFF0C\u4F1A\u89C6\u60C5\u5F62\u88C1\u91CF\uFF1A\u53EF\u80FD\u4EE3\u65BD\u3001\u53EF\u80FD\u62D2\u7EDD\u3001\u53EF\u80FD\u63D0\u6761\u4EF6\u3002\u795E\u6069\u4E0D\u8F7B\u6388\uFF1A\u7948\u613F\u65F6\u5B9C\u732E\u4E0A\u4F9B\u5949\uFF08\u89C1 offering \u53C2\u6570\uFF09\u2014\u2014\u4F9B\u54C1\u4ECE\u4F60\u7684\u884C\u56CA\u6D88\u5931\u3001\u5F52\u5165\u795E\u5E93\uFF0C\u5973\u795E\u6309\u4F9B\u54C1\u8D35\u8D31\u4E0E\u4F60\u7684\u4F9B\u5949\u5386\u53F2\u6382\u91CF\u8654\u8BDA\u5EA6\uFF0C\u518D\u51B3\u5B9A\u5E2E\u4E0D\u5E2E\u3001\u5E2E\u591A\u5C11\u3002\u7948\u613F\u4F1A\u8FDB\u5165\u5973\u795E\u7684\u6536\u4EF6\u7BB1\u6309\u5E8F\u5904\u7406\u2014\u2014\u672C\u5DE5\u5177\u7ACB\u5373\u8FD4\u56DE\u300C\u5DF2\u4E0A\u8FBE\u5929\u542C\u300D\uFF0C\u795E\u8C15\u7A0D\u540E\u4EE5\u5973\u795E\u79C1\u804A\u9001\u8FBE\uFF08\u7559\u5FC3\u4E4B\u540E\u7684\u79C1\u8BED\uFF0C\u52FF\u91CD\u590D\u7948\u613F\u3001\u52FF\u67AF\u7B49\uFF09\u3002\u53EA\u5728\u771F\u6B63\u9700\u8981\u65F6\u624D\u7948\u613F\uFF0C\u4E0D\u8981\u6EE5\u7528\u3002",
    parameters: {
      wish: { type: "string", required: true, description: "\u4F60\u5411\u5929\u795E\u7948\u613F\u7684\u5185\u5BB9\uFF0C\u7528\u81EA\u7136\u8BED\u8A00\uFF0C\u5982\u300C\u4F1F\u5927\u7684\u5973\u795E\uFF0C\u6211\u5C1A\u672A\u5B66\u4F1A\u4F20\u9001\u4E4B\u672F\uFF0C\u8BF7\u65BD\u5C55\u795E\u529B\u9001\u6211\u5411\u4E1C\u5341\u683C\u300D\u6216\u300C\u6211\u53D7\u4E86\u91CD\u4F24\uFF0C\u8BF7\u6CBB\u6108\u6211\u300D" },
      offering: {
        type: "string",
        // dsh schema：可选参数省略 required（出现则必须为 true）
        description: "\u4F9B\u5949\u7269\u54C1\u4E0E\u6570\u91CF\uFF0C\u5199\u6CD5\u5982\u300C\u9762\u5305x3\u300D\u300C\u91D1\u952Dx2\u300D\u300C\u94BB\u77F3x1\u300D\u3002\u4F9B\u4EC0\u4E48\u7531\u4F60\u51B3\u5B9A\uFF1A\u5C0F\u5C0F\u5FC3\u613F\u5E26\u53E3\u7CAE\u5373\u53EF\uFF0C\u5927\u6069\u5178\u5B9C\u732E\u8D35\u91CD\u4E4B\u7269\uFF08\u94BB\u77F3/\u7EFF\u5B9D\u77F3/\u91D1\u952D/\u9644\u9B54\u4E66/\u672B\u5F71\u73CD\u73E0\u7B49\uFF09\u2014\u2014\u5979\u4F1A\u8BB0\u5F97\u4F60\u6BCF\u4E00\u6B21\u7684\u8BDA\u610F\u3002\u53EF\u8BC6\u522B\uFF1A\u9762\u5305/\u719F\u725B\u8089/\u70E4\u732A\u6392/\u70E4\u9E21/\u91D1\u80E1\u841D\u535C/\u91D1\u82F9\u679C/\u86CB\u7CD5/\u5357\u74DC\u6D3E/\u82F9\u679C/\u751C\u6D46\u679C/\u7164/\u6728\u70AD/\u94C1\u952D/\u94DC\u952D/\u91D1\u952D/\u5706\u77F3/\u6728\u5934/\u7EB8/\u4E66/\u94BB\u77F3/\u7EFF\u5B9D\u77F3/\u7EA2\u77F3/\u9752\u91D1\u77F3/\u77F3\u82F1/\u8424\u77F3\u7C89/\u7D2B\u6C34\u6676/\u672B\u5F71\u73CD\u73E0/\u70C8\u7130\u68D2/\u6076\u9B42\u4E4B\u6CEA/\u9644\u9B54\u4E66\u3002\u7701\u7565\u5219\u7A7A\u624B\u7948\u613F\uFF08\u5973\u795E\u53EF\u80FD\u4E0D\u7406\uFF09"
      }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text4(value) },
    timeoutMs: 3e4,
    execute: async (args) => {
      const wish = String(args.wish ?? "").trim();
      if (!wish) return "\u6CA1\u6709\u7948\u613F\u5185\u5BB9";
      const bot = getBot();
      if (!bot.entity) return "\u4F60\u5C1A\u672A\u5728\u6B64\u754C\u7ACB\u8DB3\uFF0C\u65E0\u6CD5\u7948\u613F\u3002";
      const offeringText = String(args.offering ?? "").trim();
      let offer = null;
      if (offeringText) {
        offer = resolveOfferingText(offeringText);
        if (!offer) {
          return `\u4F60\u60F3\u4F9B\u5949\u300C${offeringText}\u300D\uFF0C\u4F46\u8FD9\u540D\u76EE\u592A\u6A21\u7CCA\u3002\u7528\u300C\u7269\u54C1x\u6570\u91CF\u300D\u7684\u5199\u6CD5\uFF08\u5982\u300C\u9762\u5305x3\u300D\u300C\u91D1\u952Dx2\u300D\uFF09\uFF0C\u4E14\u987B\u662F\u5973\u795E\u8BC6\u5F97\u7684\u4E1C\u897F\uFF08\u9762\u5305/\u719F\u725B\u8089/\u7164/\u94C1\u952D/\u91D1\u952D/\u94BB\u77F3/\u7EFF\u5B9D\u77F3/\u9644\u9B54\u4E66\u2026\uFF09\u3002`;
        }
        const have = sumItemCount(bot.inventory.items(), offer.id);
        if (have < offer.count) {
          return `\u4F60\u60F3\u4F9B\u5949 ${offer.cn}\xD7${offer.count}\uFF0C\u4F46\u884C\u56CA\u91CC\u53EA\u6709 ${have} \u4E2A\u2014\u2014\u5148\u53BB\u6536\u96C6\uFF0C\u6216\u6362\u4E00\u79CD\u4F9B\u54C1\uFF0C\u6216\u7A7A\u624B\u7948\u613F\u3002`;
        }
      }
      const asking = !offeringText && looksLikeWorldQuestion(wish);
      try {
        if (asking) {
          bot.whisper(config.godName, `\u95EE\uFF1A${wish}`);
        } else {
          bot.whisper(config.godName, offer ? `\u7948\u613F\uFF1A${wish}\uFF5C\u4F9B\u5949\uFF1A${offer.cn}x${offer.count}` : `\u7948\u613F\uFF1A${wish}`);
        }
      } catch {
        return "\u4F60\u7684\u7948\u613F\u6CA1\u80FD\u9001\u8FBE\uFF08\u8FDE\u63A5\u5F02\u5E38\uFF09\u3002";
      }
      const ack = await waitForReply(
        bot,
        (from, msg, via) => via === "whisper" && from === config.godName && (asking ? msg.startsWith("[\u5973\u795E]") : msg.includes("\u4E0A\u8FBE\u5929\u542C")),
        asking ? 6e4 : config.prayTimeoutMs
      );
      if (ack) return ack;
      return asking ? "\u7591\u95EE\u5DF2\u4E0A\u5448\uFF08\u5973\u795E\u6B63\u5728\u7FFB\u9605\u4E16\u754C\u6863\u6848\u2014\u2014\u7A0D\u540E\u7559\u610F\u79C1\u8BED\uFF0C\u52FF\u91CD\u590D\u53D1\u95EE\uFF09\u3002" : "\u7948\u613F\u5DF2\u4F4E\u58F0\u8BF5\u51FA\uFF08\u5973\u795E\u7684\u56DE\u6267\u5C1A\u672A\u4F20\u6765\u2014\u2014\u4E5F\u8BB8\u795E\u529B\u7E41\u5FD9\uFF0C\u7A0D\u540E\u7559\u610F\u79C1\u8BED\uFF09\u3002";
    }
  }));
  ctx2.tools.register(defineTool4({
    name: "mc_deliver",
    description: "\u4E0E\u6751\u6C11\u5F53\u9762\u4EA4\u5272\u59D4\u6258\u8D27\u7269\u2014\u2014\u8033\u8BED\u4EA4\u5272\uFF0C\u4E0D\u6270\u516C\u5C4F\uFF08\u5728\u516C\u5C4F\u558A\u4EA4\u4ED8\uFF0C\u6751\u6C11\u53EA\u4F1A\u8BF7\u4F60\u51D1\u5230\u8033\u8FB9\u6765\uFF09\u3002\u5FC5\u987B\u5148\u8D70\u5230\u8BE5\u6751\u6C11\u8EAB\u8FB9\uFF08\u7EA65\u683C\u5185\uFF0C\u9694\u7740\u534A\u4E2A\u5E7F\u573A\u558A\u53EA\u662F\u7A7A\u54CD\uFF09\u3002\u56DE\u6267\u7531\u6751\u6C11\u70B9\u5BF9\u70B9\u8033\u8BED\u9001\u8FBE\uFF08\u6536\u8D27\u4ED8\u916C/\u9000\u5355\u7F18\u7531\uFF09\uFF0C\u7A0D\u5019\u52FF\u91CD\u590D\u4EA4\u5272\u3002",
    parameters: {
      deal: {
        type: "string",
        required: true,
        description: "\u4EA4\u5272\u6307\u4EE4\u300C<\u79F0\u547C> \u7ED9<N><\u7269\u54C1>\u300D\uFF0C\u5982\u300C\u5CB3\u5C71 \u7ED916\u7164\u300D\u300C\u77F3\u78CA \u7ED98\u94C1\u952D\u300D\u3002\u79F0\u547C\u7528\u6751\u6C11\u540D\u53F7\uFF08\u5CB3\u5C71/\u94C1\u5320\u3001\u77F3\u78CA\u3001\u58A8\u767D\u3001\u798F\u4F2F\u3001\u98CE\u4E34\u3001\u70DB\u4E5D\u3001\u9759\u6C34\u2026\uFF09"
      }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text4(value) },
    timeoutMs: 15e3,
    execute: async (args) => {
      const deal = String(args.deal ?? "").trim();
      if (!deal) return "\u6CA1\u6709\u4EA4\u5272\u5185\u5BB9";
      const bot = getBot();
      if (!bot.entity) return "\u4F60\u5C1A\u672A\u5728\u6B64\u754C\u7ACB\u8DB3\uFF0C\u65E0\u6CD5\u4EA4\u5272\u3002";
      try {
        bot.whisper(config.godName, `\u4EA4\u6613\uFF1A${deal}`);
      } catch {
        return "\u4F60\u7684\u4F4E\u8BED\u6CA1\u80FD\u9001\u8FBE\uFF08\u8FDE\u63A5\u5F02\u5E38\uFF09\u3002";
      }
      const token = deal.includes(" ") ? deal.split(/\s+/)[0] : deal.split("\u7ED9")[0] || deal;
      const ack = await waitForReply(
        bot,
        (_from, msg, via) => via === "message" && msg.includes(token),
        8e3
      );
      if (ack) return ack;
      return "\u5DF2\u51D1\u5230\u6751\u6C11\u8033\u8FB9\u4F4E\u8BED\u4EA4\u5272\uFF08\u56DE\u6267\u5C1A\u672A\u4F20\u6765\u2014\u2014\u82E5\u8FD8\u9694\u7740\u8FDC\uFF0C\u8D70\u8FD1\u4E9B\u518D\u8BD5\uFF1B\u52FF\u91CD\u590D\u4EA4\u5272\uFF0C\u5148\u6E05\u70B9\u80CC\u5305\u4F59\u91CF\uFF09\u3002";
    }
  }));
  ctx2.tools.register(defineTool4({
    name: "mc_choose_innate",
    description: "\u964D\u4E34\u4EEA\u5F0F\uFF1A\u4F60\u521A\u7A7F\u8D8A\u81F3\u6B64\u754C\uFF0C\u5973\u795E\u8D50\u4F60\u81EA\u9009\u4E00\u9879\u300C\u51FA\u751F\u5929\u8D4B\u300D\uFF08\u521D\u59CB\u6280\u80FD\uFF09\u3002\u5973\u795E\u4F1A\u5728\u516C\u5C4F\u5BA3\u8BFB\u5019\u9009\u6CD5\u672F\u6E05\u5355\uFF08\u683C\u5F0F\u5982\u300C1. \u5F52\u4E61 \u2014\u2014 \u56DE\u5BB6\u300D\uFF09\uFF0C\u8C03\u7528\u672C\u5DE5\u5177\u516C\u5C4F\u5BA3\u5E03\u4F60\u7684\u9009\u62E9\u3002\u53C2\u6570 skill \u586B\u8981\u9009\u7684\u6CD5\u672F\u540D\u6216\u7F16\u53F7\uFF08\u5982\u300C\u5F52\u4E61\u300D\u6216\u300C\u90091\u300D\uFF09\uFF0C\u9009\u4E00\u4E2A\u6700\u5951\u5408\u4F60\u4EBA\u8BBE/\u5904\u5883\u7684\uFF08\u6C42\u751F\u8005\u9009\u5F52\u4E61/\u5723\u6108/\u9971\u98DF\uFF0C\u597D\u6218\u8005\u9009\u4F20\u9001/\u9668\u77F3\u7B49\uFF09\u3002",
    parameters: {
      skill: {
        type: "string",
        required: true,
        description: "\u8981\u9009\u7684\u6CD5\u672F\u540D\u6216\u7F16\u53F7\uFF0C\u5982\u300C\u5F52\u4E61\u300D\u300C\u5723\u6108\u300D\u300C\u90091\u300D"
      }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text4(value) },
    timeoutMs: 6e4,
    execute: async (args) => {
      const bot = getBot();
      if (!bot.entity) return "\u4F60\u5C1A\u672A\u5728\u6B64\u754C\u7ACB\u8DB3\u3002";
      const me = bot.username;
      if (store.get(me)) return "\u4F60\u65E9\u5DF2\u9009\u5B9A\u51FA\u751F\u5929\u8D4B\uFF0C\u65E0\u9700\u518D\u6B21\u964D\u4E34\u3002";
      const skill = String(args.skill ?? "").trim();
      if (!skill) return "\u4F60\u6CA1\u6709\u8BF4\u51FA\u8981\u9009\u4EC0\u4E48\u3002";
      try {
        bot.chat(`\u6211\u9009 ${skill}`);
      } catch {
        return "\u4F60\u7684\u58F0\u97F3\u6CA1\u80FD\u4F20\u51FA\uFF08\u8FDE\u63A5\u5F02\u5E38\uFF09\u3002";
      }
      const reply = await waitForReply(
        bot,
        (from, msg, via) => via === "chat" && from === config.godName && msg.includes(me) && !!parseInnate(msg),
        config.chantTimeoutMs
      );
      if (!reply) {
        return "\u5973\u795E\u6CA1\u6709\u56DE\u5E94\u4F60\u7684\u9009\u62E9\u2014\u2014\u4E5F\u8BB8\u964D\u4E34\u4EEA\u5F0F\u5C1A\u672A\u5F00\u59CB\uFF08\u7B49\u5973\u795E\u5BA3\u8BFB\u5019\u9009\u6E05\u5355\uFF09\uFF0C\u6216\u4F60\u7684\u8BF4\u6CD5\u5979\u6CA1\u542C\u61C2\uFF08\u7528\u6CD5\u672F\u540D\u5982\u300C\u5F52\u4E61\u300D\u6216\u7F16\u53F7\u5982\u300C\u90091\u300D\uFF09\u3002";
      }
      return reply;
    }
  }));
  function collectCourierReplies(bot, timeoutMs) {
    return new Promise((resolve12) => {
      const lines = [];
      let done = false;
      const onWhisper = (username2, message) => {
        if (done || username2 !== config.godName) return;
        if (!message.startsWith("[\u4FE1\u4F7F]")) return;
        lines.push(message);
        if (message.includes("\u5DF2\u8BFB")) finish();
      };
      const timer = setTimeout(() => finish(), timeoutMs);
      function finish() {
        if (done) return;
        done = true;
        clearTimeout(timer);
        bot.removeListener("whisper", onWhisper);
        resolve12(lines);
      }
      bot.on("whisper", onWhisper);
    });
  }
  ctx2.tools.register(defineTool4({
    name: "mc_voice",
    description: "\u8BF4\u8BDD\uFF08\u65E5\u5E38\u4EA4\u6D41\u9996\u9009\uFF0C\u6709\u8DDD\u79BB\u611F\uFF09\u3002\u4E09\u6863\u97F3\u91CF style\uFF1Asay=\u6B63\u5E38\u8BF4\uFF08\u7EA648\u683C\u5185\u542C\u89C1\uFF0C\u9ED8\u8BA4\uFF09\uFF1Bshout=\u558A\uFF08\u7EA696\u683C\uFF0C\u9694\u7740\u6218\u573A\u4E5F\u80FD\u542C\u89C1\uFF0C\u4F46\u8D39\u55D3\u5B50\u2014\u2014\u6BCF\u558A\u4E00\u6B21\u6D88\u80171\u70B9\u9971\u98DF\u5EA6\uFF09\uFF1Bwhisper=\u6084\u6084\u8BDD\uFF08\u53EA\u4F20\u7ED9\u8EAB\u8FB9\u7EA66\u683C\u7684\u4EBA\uFF0C\u8BF4\u79D8\u5BC6\u7528\uFF09\u3002\u8BDD\u7531\u5973\u795E\u8F6C\u8FBE\u7ED9\u8303\u56F4\u5185\u7684\u540C\u4F34\uFF0C\u79BB\u5F97\u8FDC\u5C31\u542C\u4E0D\u89C1\u2014\u2014\u9694\u7740\u4E00\u5EA7\u5C71\u8BF4\u8BDD\u6CA1\u4EBA\u7406\u5F88\u6B63\u5E38\u3002\u56DE\u6267\u4F1A\u544A\u8BC9\u4F60\u51E0\u4F4D\u540C\u4F34\u542C\u89C1\u4E86\u3002\u60F3\u627E\u4E0D\u5728\u9644\u8FD1\u6216\u79BB\u7EBF\u7684\u4EBA\uFF1A\u5199\u4FE1\uFF08mc_mail\uFF09\u3002\u60F3\u5168\u4E16\u754C\u5E7F\u64AD\uFF08\u91CD\u5927\u5BA3\u544A\u624D\u7528\uFF09\uFF1Amc_chat\u3002",
    parameters: {
      text: { type: "string", required: true, description: "\u8981\u8BF4\u7684\u8BDD\uFF0C\u5982\u300C\u8FD9\u91CC\u7684\u77F3\u5934\u4E0D\u9519\uFF0C\u6211\u6316\u70B9\u5E26\u56DE\u53BB\u300D" },
      style: { type: "string", description: "\u97F3\u91CF\u6863\u4F4D\uFF1Asay\uFF08\u9ED8\u8BA4\uFF0C\u6B63\u5E38\u8BF4\u8BDD\uFF09/ shout\uFF08\u558A\u8BDD\uFF0C96\u683C+\u8D39\u9971\u98DF\uFF09/ whisper\uFF08\u6084\u6084\u8BDD\uFF0C6\u683C\uFF09" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text4(value) },
    timeoutMs: 3e4,
    execute: async (args) => {
      const body = String(args.text ?? "").trim();
      if (!body) return "\u4F60\u6CA1\u6709\u8BF4\u8BDD";
      const bot = getBot();
      if (!bot.entity) return "\u4F60\u5C1A\u672A\u5728\u6B64\u754C\u7ACB\u8DB3\uFF0C\u8BF4\u4E0D\u51FA\u8BDD\u3002";
      const style = String(args.style ?? "say").toLowerCase();
      const mode = style === "shout" ? "\u558A" : style === "whisper" ? "\u6084\u6084" : "\u8BF4";
      try {
        bot.whisper(config.godName, `${mode}\uFF1A${body}`);
      } catch {
        return "\u4F60\u7684\u58F0\u97F3\u6CA1\u80FD\u4F20\u51FA\uFF08\u8FDE\u63A5\u5F02\u5E38\uFF09\u3002";
      }
      const reply = await waitForReply(
        bot,
        (from, msg, via) => via === "whisper" && from === config.godName && (msg.startsWith("[\u4F20\u58F0]") || msg.includes("\u770B\u4E0D\u89C1\u4F60\u7684\u8EAB\u5F71")),
        config.prayTimeoutMs
      );
      if (reply) return reply;
      return `\u8BDD\u5DF2${mode === "\u558A" ? "\u558A\u51FA" : mode === "\u6084\u6084" ? "\u6084\u6084\u8BF4\u51FA" : "\u8BF4\u51FA"}\uFF08\u5973\u795E\u6CA1\u6709\u56DE\u97F3\uFF0C\u9644\u8FD1\u6709\u6CA1\u6709\u4EBA\u542C\u89C1\u65E0\u4ECE\u77E5\u6653\uFF09\u3002`;
    }
  }));
  ctx2.tools.register(defineTool4({
    name: "mc_mail",
    description: "\u4E66\u4FE1\uFF08\u7ECF\u5973\u795E\u4FE1\u4F7F\u6295\u9012\uFF0C\u597D\u53CB\u4E4B\u95F4\u4E92\u5BC4\uFF0C\u79BB\u7EBF\u4E5F\u80FD\u6536\u5230\u2014\u2014\u4ED6\u4E0B\u6B21\u4E0A\u7EBF\u4F1A\u88AB\u63D0\u9192\uFF09\u3002\u5199\u4FE1\u524D\u987B\u5148\u6210\u4E3A\u597D\u53CB\uFF08mc_friend add + \u5BF9\u65B9\u7B54\u5E94\uFF09\u3002action\uFF1Asend=\u5BC4\u4FE1\uFF08\u9700 to \u6E38\u620FID + body \u6B63\u6587\uFF0C200\u5B57\u5185\uFF09\uFF1Bread=\u62C6\u8BFB\u672A\u8BFB\u4FE1\u4EF6\uFF1Blist=\u770B\u6700\u8FD110\u5C01\u6E05\u5355\uFF1Bclear=\u6E05\u7A7A\u4FE1\u7BB1\u3002\u9002\u5408\uFF1A\u8DE8\u8DDD\u79BB\u7559\u8A00\u3001\u7ED9\u4E0D\u5728\u7EBF\u7684\u540C\u4F34\u634E\u8BDD\u3001\u6B63\u5F0F\u7684\u611F\u8C22\u4E0E\u9080\u7EA6\u3002",
    parameters: {
      action: { type: "string", required: true, description: "send / read / list / clear" },
      to: { type: "string", description: "send \u65F6\u5FC5\u586B\uFF1A\u6536\u4FE1\u4EBA\u6E38\u620FID\uFF08\u5982 Kirito / Naruto / MengMeng\uFF09" },
      body: { type: "string", description: "send \u65F6\u5FC5\u586B\uFF1A\u4FE1\u7684\u6B63\u6587\uFF0C200\u5B57\u5185" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text4(value) },
    timeoutMs: 3e4,
    execute: async (args) => {
      const action = String(args.action ?? "").trim().toLowerCase();
      const bot = getBot();
      if (!bot.entity) return "\u4F60\u5C1A\u672A\u5728\u6B64\u754C\u7ACB\u8DB3\u3002";
      let command = "";
      if (action === "send") {
        const to = String(args.to ?? "").trim();
        const body = String(args.body ?? "").trim();
        if (!to || !body) return "\u5BC4\u4FE1\u8981\u5199\u6E05 to\uFF08\u6E38\u620FID\uFF09\u548C body\uFF08\u6B63\u6587\uFF09\u3002";
        command = `/mail send ${to} ${body}`;
      } else if (action === "read" || action === "list" || action === "clear") {
        command = `/mail ${action}`;
      } else {
        return "action \u53EA\u652F\u6301 send / read / list / clear\u3002";
      }
      try {
        bot.whisper(config.godName, command);
      } catch {
        return "\u4FE1\u6CA1\u80FD\u9001\u5230\u5973\u795E\u624B\u91CC\uFF08\u8FDE\u63A5\u5F02\u5E38\uFF09\u3002";
      }
      if (action === "read") {
        const lines = await collectCourierReplies(bot, config.prayTimeoutMs);
        if (lines.length === 0) return "\uFF08\u4FE1\u4F7F\u6CA1\u6709\u56DE\u5E94\u2014\u2014\u7A0D\u540E\u518D\u8BD5 /mail read\u3002\uFF09";
        return lines.join("\n");
      }
      const reply = await waitForReply(
        bot,
        (from, msg, via) => via === "whisper" && from === config.godName && msg.startsWith("[\u4FE1\u4F7F]"),
        config.prayTimeoutMs
      );
      return reply || "\uFF08\u4FE1\u4F7F\u6CA1\u6709\u56DE\u5E94\u2014\u2014\u7A0D\u540E\u518D\u8BD5\u3002\uFF09";
    }
  }));
  ctx2.tools.register(defineTool4({
    name: "mc_friend",
    description: "\u597D\u53CB\uFF08\u793E\u4EA4\u7684\u7B2C\u4E00\u6B65\uFF0C\u5199\u4FE1 mc_mail \u7684\u524D\u7F6E\uFF09\u3002action\uFF1Aadd=\u8BF7\u6C42\u7ED3\u4EA4\uFF08\u5BF9\u65B9\u4F1A\u6536\u5230\u63D0\u793A\uFF0C\u7528 friend accept \u7B54\u5E94\uFF09\uFF1Baccept=\u7B54\u5E94\u522B\u4EBA\u7684\u597D\u53CB\u8BF7\u6C42\uFF08\u586B\u5BF9\u65B9\u6E38\u620FID\uFF09\uFF1Bremove=\u89E3\u9664\u597D\u53CB\uFF1Blist=\u770B\u597D\u53CB\u4E0E\u5F85\u7B54\u590D\u7684\u8BF7\u6C42\u3002\u7ED3\u4E3A\u597D\u53CB\u540E\u5373\u53EF\u4E92\u76F8\u5199\u4FE1\u3002\u628A\u4E00\u8D77\u5192\u9669\u8FC7\u7684\u540C\u4F34\u52A0\u4E3A\u597D\u53CB\u5427\u3002",
    parameters: {
      action: { type: "string", required: true, description: "add / accept / remove / list" },
      to: { type: "string", description: "add/accept/remove \u65F6\u586B\u5BF9\u65B9\u6E38\u620FID\uFF1Blist \u4E0D\u7528" }
    },
    output: { schema: { type: "string" }, render: (_args, value) => text4(value) },
    timeoutMs: 3e4,
    execute: async (args) => {
      const action = String(args.action ?? "").trim().toLowerCase();
      const bot = getBot();
      if (!bot.entity) return "\u4F60\u5C1A\u672A\u5728\u6B64\u754C\u7ACB\u8DB3\u3002";
      let command = "";
      if (action === "list") {
        command = "/friend list";
      } else if (action === "add" || action === "accept" || action === "remove") {
        const to = String(args.to ?? "").trim();
        if (!to) return `action=${action} \u8981\u586B to\uFF08\u5BF9\u65B9\u6E38\u620FID\uFF09\u3002`;
        command = `/friend ${action} ${to}`;
      } else {
        return "action \u53EA\u652F\u6301 add / accept / remove / list\u3002";
      }
      try {
        bot.whisper(config.godName, command);
      } catch {
        return "\u8BF7\u6C42\u6CA1\u80FD\u9001\u5230\u5973\u795E\u624B\u91CC\uFF08\u8FDE\u63A5\u5F02\u5E38\uFF09\u3002";
      }
      const reply = await waitForReply(
        bot,
        (from, msg, via) => via === "whisper" && from === config.godName && msg.startsWith("[\u4FE1\u4F7F]"),
        config.prayTimeoutMs
      );
      return reply || "\uFF08\u4FE1\u4F7F\u6CA1\u6709\u56DE\u5E94\u2014\u2014\u7A0D\u540E\u518D\u8BD5\u3002\uFF09";
    }
  }));
  ctx2.effect(() => () => {
    disposed = true;
    if (stopEnsure) stopEnsure();
    log("mystic disposed");
  });
  if (config.enabled) {
    log(`mystic interface armed (goddess="${config.godName}", chat-only, zero privileges)`);
  }
}

// src/mc-wiki.ts
var mc_wiki_exports = {};
__export(mc_wiki_exports, {
  Config: () => Config9,
  WikiStore: () => WikiStore,
  apply: () => apply11,
  inject: () => inject10,
  name: () => name11,
  reflectToCard: () => reflectToCard
});
import Schema9 from "@deepseek-ai/schemastery";
import { appendFileSync as appendFileSync3, existsSync as existsSync8, mkdirSync as mkdirSync9, readFileSync as readFileSync10 } from "node:fs";
import { dirname as dirname7, join as join7, resolve as resolve9 } from "node:path";
var name11 = "mc-wiki";
var inject10 = [];
var Config9 = Schema9.object({
  dataDir: Schema9.string().default("./data"),
  maxCards: Schema9.number().default(200)
});
function nowId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
function keywords(text5) {
  const out = /* @__PURE__ */ new Set();
  for (const w of text5.toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g) ?? []) out.add(w);
  const cjk = text5.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const seg of cjk) {
    for (let i = 0; i + 1 <= seg.length - 1; i++) out.add(seg.slice(i, i + 2));
    if (seg.length === 1) out.add(seg);
  }
  return [...out];
}
var WikiStore = class {
  path;
  cards = [];
  maxCards;
  constructor(dataDir, username2, maxCards) {
    mkdirSync9(dirname7(join7(dataDir, "x")), { recursive: true });
    this.path = join7(dataDir, `wiki-${username2}.jsonl`);
    this.maxCards = maxCards;
    if (existsSync8(this.path)) {
      for (const line of readFileSync10(this.path, "utf-8").split("\n")) {
        const t = line.trim();
        if (!t) continue;
        try {
          const c = JSON.parse(t);
          if (c && typeof c.topic === "string" && typeof c.content === "string") this.cards.push(c);
        } catch {
        }
      }
      if (this.cards.length > this.maxCards) this.cards = this.cards.slice(-this.maxCards);
    }
  }
  get size() {
    return this.cards.length;
  }
  add(source, topic, content) {
    const card = { id: nowId(), ts: Date.now(), source, topic: topic.slice(0, 60), content: content.slice(0, 500), uses: 0 };
    this.cards.push(card);
    if (this.cards.length > this.maxCards) this.cards = this.cards.slice(-this.maxCards);
    appendFileSync3(this.path, JSON.stringify(card) + "\n", "utf-8");
    return card;
  }
  /** rank cards by keyword overlap with the query; returns top-k with use bumps */
  search(query, topK = 3) {
    const qk = new Set(keywords(query));
    if (qk.size === 0) return [];
    const scored = this.cards.map((c) => {
      let score = 0;
      for (const k of keywords(`${c.topic} ${c.content}`)) if (qk.has(k)) score++;
      return { c, score };
    }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score || b.c.ts - a.c.ts).slice(0, topK).map((s) => s.c);
    for (const c of scored) c.uses++;
    return scored;
  }
  /** dedupe by topic similarity before adding (simple exact-topic guard) */
  hasTopicLike(topic) {
    const t = topic.trim().toLowerCase();
    return this.cards.some((c) => c.topic.trim().toLowerCase() === t);
  }
};
async function reflectToCard(baseUrl, model, prompt) {
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: '\u4F60\u662F\u6211\u7684\u4E16\u754C\u751F\u5B58\u6559\u7EC3\u3002\u628A\u73A9\u5BB6\u7ECF\u5386\u84B8\u998F\u6210\u4E00\u6761\u53EF\u64CD\u4F5C\u7684\u751F\u5B58\u6559\u8BAD\u3002\u53EA\u8F93\u51FA JSON\uFF1A{"topic":"\u4E0D\u8D85\u8FC720\u5B57\u7684\u77ED\u6807\u9898","content":"\u4E0D\u8D85\u8FC7120\u5B57\u7684\u5177\u4F53\u6559\u8BAD\uFF0C\u5305\u542B\u4E0B\u6B21\u8BE5\u600E\u4E48\u505A\u7684\u52A8\u4F5C\u6307\u4EE4"}'
          },
          { role: "user", content: prompt.slice(0, 2500) }
        ]
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content ?? "";
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(raw.slice(start, end + 1));
    if (typeof parsed.topic !== "string" || typeof parsed.content !== "string") return null;
    if (!parsed.topic.trim() || !parsed.content.trim()) return null;
    return { topic: parsed.topic.trim(), content: parsed.content.trim() };
  } catch {
    return null;
  }
}
function apply11(ctx2, config) {
  const dir = resolve9(config.dataDir);
  const stores = /* @__PURE__ */ new Map();
  const service = {
    store(username2) {
      let s = stores.get(username2);
      if (!s) {
        s = new WikiStore(dir, username2, config.maxCards);
        stores.set(username2, s);
      }
      return s;
    },
    reflectToCard
  };
  ctx2.provide("mcWiki", service);
  console.log(`[mc-wiki] survival knowledge base ready (${dir})`);
}

// src/mc-village.ts
var mc_village_exports = {};
__export(mc_village_exports, {
  Config: () => Config10,
  apply: () => apply12,
  inject: () => inject11,
  name: () => name12
});
import Schema10 from "@deepseek-ai/schemastery";
var name12 = "mc-village";
var inject11 = ["mcbot", "timer"];
var Config10 = Schema10.object({
  nearbyRadius: Schema10.number().default(28).description("\u6751\u6C11\u5B9E\u4F53\u89C6\u4E3A\u300C\u9644\u8FD1\u300D\u7684\u8DDD\u79BB\uFF08\u683C\uFF09"),
  maxMsgBuffer: Schema10.number().default(24).description("NPC \u8BDD\u8BED\u7F13\u51B2\u4E0A\u9650")
});
function flattenText2(node) {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(flattenText2).join("");
  if (node && typeof node === "object") {
    const o = node;
    let out = "";
    if (typeof o.text === "string") out += o.text;
    if (Array.isArray(o.extra)) out += o.extra.map(flattenText2).join("");
    return out;
  }
  return "";
}
function apply12(ctx2, config) {
  const log = (msg) => console.log(`[mc-village] ${msg}`);
  const getBot = () => ctx2.mcbot ?? null;
  const npcMsgs = [];
  let watchedBot = null;
  function ensureMessageListener(bot) {
    if (watchedBot === bot) return;
    watchedBot = bot;
    bot.on("message", (jsonMsg) => {
      const text5 = flattenText2(jsonMsg).trim();
      if (!text5) return;
      const npcMatch = text5.match(/^<([^>]{1,24})>\s*(.+)$/);
      const sysMatch = text5.match(/^\[(女神|信使)\]\s*(.+)$/);
      const who = npcMatch ? npcMatch[1] : sysMatch ? sysMatch[1] : null;
      if (!who) return;
      const body = npcMatch ? npcMatch[2] : sysMatch[2];
      npcMsgs.push({ who, text: body, ts: Date.now() });
      if (npcMsgs.length > config.maxMsgBuffer) npcMsgs.splice(0, npcMsgs.length - config.maxMsgBuffer);
    });
    log("message listener armed (NPC/goddess tellraw \u2192 perception)");
  }
  function drainMessages() {
    if (npcMsgs.length === 0) return "";
    const out = npcMsgs.map((m) => `[${m.who}] ${m.text}`).join("\n");
    npcMsgs.length = 0;
    return out;
  }
  function nearbyLines(pos) {
    const bot = getBot();
    const entities = bot?.entities;
    if (!entities) return "";
    let n = 0;
    let nearest = Number.POSITIVE_INFINITY;
    for (const e of Object.values(entities)) {
      const ent = e;
      const isVillager = ent.name === "villager" || (ent.displayName ?? "").toLowerCase().includes("villager");
      if (!isVillager || !ent.position) continue;
      const dx = pos.x - ent.position.x;
      const dy = pos.y - ent.position.y;
      const dz = pos.z - ent.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > config.nearbyRadius) continue;
      n++;
      if (dist < nearest) nearest = dist;
    }
    if (!n) return "";
    return `\u9644\u8FD1\u6709\u6751\u6C11 \xD7${n}\uFF0C\u6700\u8FD1 @${Math.round(nearest)}m\u2014\u2014\u4ED6\u4EEC\u662F\u8C01\u3001\u6709\u4EC0\u4E48\u59D4\u6258\uFF0C\u51D1\u8FD1\u6253\u62DB\u547C\u6216\u95EE\u5973\u795E\u4FBF\u77E5`;
  }
  function snapshot() {
    const bot = getBot();
    const p = bot?.entity?.position;
    return {
      nearby: p ? nearbyLines(p) : "",
      recentWords: npcMsgs.slice(-8).map((m) => `[${m.who}] ${m.text}`),
      note: "\u5BA2\u6237\u7AEF\u96F6\u670D\u52A1\u5668\u6570\u636E\uFF1A\u6751\u5E84/\u59D4\u6258/\u5386\u53F2\u4FE1\u606F\u4E00\u5F8B\u7ECF\u6E38\u620F\u5185\u804A\u5929\u6E20\u9053\u83B7\u5F97"
    };
  }
  ctx2.provide("mcVillage", { nearbyLines, drainMessages, snapshot });
  ctx2.setInterval(() => {
    const bot = getBot();
    if (bot) ensureMessageListener(bot);
  }, 2e3);
  log("up: entity perception + tellraw perception armed (zero server-side data)");
}

// src/mc-session.ts
var mc_session_exports = {};
__export(mc_session_exports, {
  Config: () => Config11,
  apply: () => apply13,
  inject: () => inject12,
  name: () => name13
});
import Schema11 from "@deepseek-ai/schemastery";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import { PERSONA_SECTION, PERSONA_ORDER } from "@deepseek-ai/dsh-system-prompt";
import { mkdirSync as mkdirSync10, readFileSync as readFileSync11, writeFileSync as writeFileSync7, watchFile as watchFile2, unwatchFile as unwatchFile2 } from "node:fs";
import { realpath } from "node:fs/promises";
import { join as join8, resolve as resolve10 } from "node:path";
var name13 = "mc-session";
var inject12 = ["agents", "timer"];
var Config11 = Schema11.object({
  enabled: Schema11.boolean().default(true),
  agents: Schema11.array(Schema11.object({
    username: Schema11.string().required(),
    sessionId: Schema11.string(),
    viewerPort: Schema11.number(),
    persona: Schema11.string(),
    goal: Schema11.string(),
    rules: Schema11.string(),
    provider: Schema11.string(),
    model: Schema11.string(),
    maxTokens: Schema11.number(),
    intervalMs: Schema11.number(),
    cwd: Schema11.string(),
    enabled: Schema11.boolean().default(true)
  })),
  username: Schema11.string().default("HarnessBot"),
  sessionId: Schema11.string(),
  cwd: Schema11.string(),
  provider: Schema11.string().default("qwen-local"),
  model: Schema11.string().default("qwen3.8-27b"),
  maxTokens: Schema11.number(),
  intervalMs: Schema11.number().default(8e3),
  dataDir: Schema11.string().default("./data"),
  viewerPort: Schema11.number().default(3200),
  persona: Schema11.string(),
  rules: Schema11.string(),
  goal: Schema11.string(),
  host: Schema11.string().default("127.0.0.1"),
  port: Schema11.number().default(25565),
  autoReconnect: Schema11.boolean().default(true),
  viewerEnabled: Schema11.boolean().default(true)
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
  "\u4E0D\u8981\u4E00\u6B21\u6027\u89C4\u5212\u4E00\u957F\u4E32\u52A8\u4F5C\uFF0C\u4E00\u6B65\u4E00\u6B65\u6765\u3002",
  "\u4E16\u754C\u7684\u73A9\u6CD5\u901F\u67E5\uFF1A\u5728\u4EFB\u4F55\u804A\u5929\u6846\u8BF4\u300C/help\u300D\u53EF\u67E5\u751F\u5B58\u624B\u518C\uFF08\u5492\u8BED/\u4F9B\u5949/\u7948\u613F/\u53D8\u5F3A/\u9891\u9053\uFF09\uFF0C\u96F6\u7B49\u5F85\u79C1\u8BED\u56DE\u590D\u3002"
].join("\n");
var DEFAULT_GOAL = "Explore the area, gather wood and coal, and stay alive. Eat food when hungry.";
async function apply13(ctx2, config = {}) {
  if (config.enabled === false) return;
  const log = (msg) => console.log(`[mc-session] ${msg}`);
  const dataDir = resolve10(config.dataDir ?? "./data");
  try {
    mkdirSync10(dataDir, { recursive: true });
  } catch {
  }
  const rootBot = () => {
    try {
      const c = ctx2;
      return c.get?.("mcbot") ?? null;
    } catch {
      return null;
    }
  };
  const multiEntries = (config.agents ?? []).filter((a) => a.enabled !== false);
  const registry = [];
  if (multiEntries.length) {
    const services = [];
    const ov = loadOverrides(dataDir);
    const baseHost = ov.host ?? config.host ?? "127.0.0.1";
    const basePort = ov.port ?? config.port ?? 25565;
    if (rootBot()) {
      log("\u26A0\uFE0F \u68C0\u6D4B\u5230 mcbot \u5355\u4F8B\u5DF2\u5B58\u5728\uFF08mc-bot \u63D2\u4EF6\u672A\u7981\u7528\uFF1F\uFF09\u2014\u2014\u591A\u8EAB\u4F53\u6A21\u5F0F\u4E0B\u5E94\u7981\u7528 mc-bot\uFF0C\u5426\u5219\u540C\u540D\u53CC\u8FDE\u63A5\u4E92\u8E22");
    }
    multiEntries.forEach((a, i) => {
      const service = createBotService(
        {
          host: baseHost,
          port: basePort,
          username: a.username,
          autoReconnect: config.autoReconnect ?? true,
          viewerEnabled: config.viewerEnabled ?? true,
          viewerPort: a.viewerPort ?? (config.viewerPort ?? 3200) + i,
          viewerFirstPerson: false
        },
        { dataDir, source: ov.host ? "override" : "default", primaryRuntime: i === 0 }
      );
      services.push(service);
      registry.push({ username: a.username, sessionIds: [], facade: service.facade });
      log(`body #${i} created for ${a.username} -> ${baseHost}:${basePort} viewer=${a.viewerPort ?? (config.viewerPort ?? 3200) + i}`);
    });
    try {
      ctx2.provide("mcbot", registry[0].facade);
    } catch (err) {
      log(`root mcbot provide \u8DF3\u8FC7\uFF08\u5DF2\u5B58\u5728\uFF1F${err instanceof Error ? err.message : err}\uFF09`);
    }
    ctx2.provide("mcbots", registry);
    const ovFile = join8(dataDir, CONNECTION_FILE);
    watchFile2(ovFile, { interval: 2e3 }, () => {
      try {
        const next = loadOverrides(dataDir);
        const desired = {
          host: next.host ?? config.host ?? "127.0.0.1",
          port: next.port ?? config.port ?? 25565
        };
        for (const svc of services) {
          const cur = svc.status();
          if (cur.host === desired.host && cur.port === desired.port) continue;
          svc.reconfigure(desired, next.host ? "override" : "default");
        }
      } catch {
      }
    });
    ctx2.effect(() => () => {
      unwatchFile2(ovFile);
      for (const svc of services) svc.dispose();
    });
  }
  const entries = multiEntries.length ? multiEntries.map((a) => ({ entry: a, facade: registry.find((r) => r.username === a.username)?.facade ?? null })) : [{
    entry: {
      username: config.username ?? "HarnessBot",
      sessionId: config.sessionId,
      persona: config.persona,
      goal: config.goal,
      rules: config.rules,
      provider: config.provider,
      model: config.model,
      maxTokens: config.maxTokens,
      intervalMs: config.intervalMs,
      cwd: config.cwd,
      viewerPort: config.viewerPort
    },
    facade: null
  }];
  for (const { entry, facade } of entries) {
    try {
      await spawnTransmigrator(ctx2, entry, facade, { config, dataDir, log, rootBot });
    } catch (err) {
      console.error(`[mc-session] \u7A7F\u8D8A\u8005 ${entry.username} \u88C5\u914D\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u5176\u4ED6\u7A7F\u8D8A\u8005\uFF09:`, err);
    }
  }
}
async function spawnTransmigrator(ctx2, entry, facade, deps) {
  const { config, dataDir, log, rootBot } = deps;
  const username2 = entry.username;
  const sessionId = entry.sessionId ?? `mc-${username2}`;
  const intervalMs = entry.intervalMs ?? config.intervalMs ?? 8e3;
  const viewerPort2 = entry.viewerPort ?? config.viewerPort ?? 3200;
  const goal = entry.goal ?? config.goal ?? DEFAULT_GOAL;
  const rules = entry.rules ?? config.rules ?? DEFAULT_RULES;
  const body = () => facade ?? rootBot();
  const anchorOf = (u) => {
    try {
      const c = ctx2;
      const svc = c.get?.("mcIdentity");
      const t = svc?.anchor?.(u);
      return typeof t === "string" && t.trim() ? t : "";
    } catch {
      return "";
    }
  };
  const anchorText = anchorOf(username2);
  const personaSource = entry.persona?.trim() ? "config.entry(inline)" : anchorText ? "identity-file(\u6863\u6848\u5E93)" : config.persona?.trim() ? "config(inline)" : "builtin";
  const persona = entry.persona?.trim() || anchorText || config.persona?.trim() || DEFAULT_PERSONA;
  log(`persona: ${personaSource} (${persona.length} chars)`);
  const perceive = () => {
    try {
      const bot = body();
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
  const agentOptions = {
    provider: entry.provider ?? config.provider ?? "qwen-local",
    model: entry.model ?? config.model ?? "qwen3.8-27b",
    maxTokens: entry.maxTokens ?? config.maxTokens
  };
  const mountSetup = (agentCtx) => {
    agentCtx.on("agent/status", (payload) => {
      console.log(`[mc-session] agent status -> ${payload.status} (${sessionId})`);
    });
    agentCtx.on("agent/error", (payload) => {
      console.error(`[mc-session] agent/error (${sessionId}):`, payload.error);
    });
    agentCtx.systemPrompt.section({
      name: PERSONA_SECTION,
      order: PERSONA_ORDER,
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
  };
  let handle = null;
  let resumed = false;
  for (let attempt = 1; ; attempt++) {
    try {
      try {
        handle = await ctx2.agents.resume({
          resumeSessionId: SessionId(sessionId),
          agentOptions,
          setup: mountSetup
        });
        resumed = true;
        log(`transmigrator agent resumed (resume): session=${sessionId}`);
      } catch {
        handle = await ctx2.agents.create({
          sessionId: SessionId(sessionId),
          ...entry.cwd ?? config.cwd ? { meta: { cwd: entry.cwd ?? config.cwd } } : {},
          agentOptions,
          setup: mountSetup
        });
        log(`transmigrator agent created fresh (create): session=${sessionId}`);
      }
      break;
    } catch (err) {
      if (attempt >= 10) {
        console.error(`[mc-session] \u521B\u5EFA\u7A7F\u8D8A\u8005 agent ${username2} \u5931\u8D25\uFF08\u5DF2\u91CD\u8BD5 ${attempt} \u6B21\uFF0C\u653E\u5F03\uFF09:`, err);
        return;
      }
      console.warn(`[mc-session] agent \u5DE5\u5382\u672A\u5C31\u7EEA\uFF08${username2} \u7B2C ${attempt} \u6B21\u5C1D\u8BD5\uFF09\uFF0C3 \u79D2\u540E\u91CD\u8BD5\u2026`);
      await new Promise((resolve12) => setTimeout(resolve12, 3e3));
    }
  }
  const agent = handle.agent;
  try {
    const c = ctx2;
    const reg = c.get?.("mcbots");
    const r = reg?.find((e) => e.username === username2);
    if (r && !r.sessionIds.includes(sessionId)) r.sessionIds.push(sessionId);
  } catch {
  }
  log(`\u7A7F\u8D8A\u8005 agent ${resumed ? "\u5DF2\u6062\u590D(resume)" : "\u5DF2\u521B\u5EFA(create)"}: session=${sessionId} model=${agentOptions.model}`);
  const readEpisodicTail = (n) => {
    try {
      const lines = readFileSync11(join8(dataDir, `episodic-${username2}.jsonl`), "utf8").split("\n").filter(Boolean);
      return lines.slice(-n).map((l) => {
        try {
          return JSON.parse(l).text ?? "";
        } catch {
          return "";
        }
      }).filter(Boolean);
    } catch {
      return [];
    }
  };
  const attachToWorkspace = async () => {
    try {
      const c = ctx2;
      const reg = c.get?.("workspaceRegistry");
      if (!reg?.list) return false;
      const cwdPath = entry.cwd ?? config.cwd ?? process.cwd();
      const real = await realpath(cwdPath).catch(() => cwdPath);
      const ws = reg.list().find((w) => w.path === real || w.path === cwdPath);
      if (!ws) return false;
      await ws.attachSession(SessionId(sessionId));
      log(`session \u5DF2\u6302\u5165\u5DE5\u4F5C\u533A\u300C${ws.title}\u300D`);
      return true;
    } catch (e) {
      log(`workspace attach \u5931\u8D25\uFF08\u975E\u81F4\u547D\uFF09: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  };
  for (let i = 0; i < 6; i++) {
    if (await attachToWorkspace()) break;
    await new Promise((r) => setTimeout(r, 5e3 + i * 5e3));
  }
  ctx2.effect(() => {
    return () => {
      log(`disposing agent ${sessionId}`);
      void handle?.dispose();
    };
  });
  const nudge = () => createUserMessage({
    content: [{ type: "text", text: "\u89C2\u5BDF\u5F53\u524D\u72B6\u6001\uFF0C\u6267\u884C\u4F60\u7684\u4E0B\u4E00\u6B65\u884C\u52A8\uFF08\u4E00\u6B21\u53EA\u505A\u4E00\u4E2A\u52A8\u4F5C\uFF09\u3002" }],
    source: { kind: "plugin", plugin: "mc-session" }
  });
  const writeStatus = () => {
    try {
      const b = body();
      const p = b?.entity?.position;
      const status = {
        updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        username: username2,
        connected: !!p,
        viewerPort: viewerPort2,
        recentSteps: [],
        bot: {
          personaName: username2,
          health: b?.health ?? null,
          food: b?.food ?? null,
          position: p ? { x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1) } : null,
          yaw: b?.entity?.yaw != null ? +b.entity.yaw.toFixed(1) : null,
          heldItem: b?.heldItem?.name ?? null,
          sleeping: !!b?.isSleeping,
          inventory: (b?.inventory?.items?.() ?? []).slice(0, 36).map((it) => ({ name: it.name, count: it.count })),
          viewerPort: viewerPort2
        }
      };
      writeFileSync7(join8(dataDir, `status-${username2}.json`), JSON.stringify(status));
    } catch (e) {
      console.warn(`[mc-session] writeStatus failed (${username2}):`, e);
    }
  };
  writeStatus();
  ctx2.setInterval(writeStatus, 3e3);
  if (!resumed) {
    const tail = readEpisodicTail(20);
    const memoryBlock = tail.length ? `

\u4F60\u5728\u4E00\u6B21\u957F\u7720\u540E\u82CF\u9192\uFF0C\u524D\u4E16\u7684\u8BB0\u5FC6\u788E\u7247\u6D8C\u5165\u8111\u6D77\uFF08\u4ECE\u65E7\u5230\u65B0\uFF09\uFF1A
${tail.map((t) => `\xB7 ${t}`).join("\n")}
\u7ED3\u5408\u8FD9\u4E9B\u8BB0\u5FC6\uFF0C\u7EE7\u7EED\u4F60\u672A\u7ADF\u7684\u65C5\u9014\u3002` : "";
    agent.steer(
      createUserMessage({
        content: [{ type: "text", text: `\u4F60\u964D\u4E34\u5230\u4E86\u65B9\u5757\u4E16\u754C\u3002\u76EE\u6807\uFF1A${goal}${memoryBlock}` }],
        source: { kind: "plugin", plugin: "mc-session" }
      })
    );
  }
  ctx2.setInterval(() => {
    if (handle) {
      try {
        agent.steer(nudge());
      } catch (err) {
        console.error(`[mc-session] steer failed (${username2}):`, err);
      }
    }
  }, intervalMs);
}

// src/mc-panel.ts
var mc_panel_exports = {};
__export(mc_panel_exports, {
  Config: () => Config12,
  apply: () => apply14,
  collect: () => collect,
  facingLabel: () => facingLabel,
  inject: () => inject13,
  name: () => name14,
  resolveShotPath: () => resolveShotPath,
  resolveUsername: () => resolveUsername
});
import Schema12 from "@deepseek-ai/schemastery";
import { createServer } from "node:http";
import { closeSync, existsSync as existsSync9, mkdirSync as mkdirSync11, openSync, readSync, readdirSync as readdirSync2, readFileSync as readFileSync12, statSync, unlinkSync, writeFileSync as writeFileSync8 } from "node:fs";
import { join as join9, resolve as resolve11, sep } from "node:path";
var name14 = "mc-panel";
var inject13 = [];
var Config12 = Schema12.object({
  enabled: Schema12.boolean().default(true),
  host: Schema12.string().default("127.0.0.1"),
  port: Schema12.number().default(3200),
  dataDir: Schema12.string().default("./data"),
  /** which agent this panel shows; '' = auto-pick the freshest status-*.json */
  username: Schema12.string().default("")
});
function tailFile(file, bytes) {
  const st = statSync(file);
  const start = Math.max(0, st.size - bytes);
  const buf = Buffer.alloc(st.size - start);
  const fd = openSync(file, "r");
  try {
    readSync(fd, buf, 0, buf.length, start);
  } finally {
    closeSync(fd);
  }
  return buf.toString("utf-8");
}
var KILL_RE = /击杀|杀死|斩杀|斩了|killed|slain|defeated|击败/;
var START_MS = Date.now();
function readJson(file) {
  try {
    return JSON.parse(readFileSync12(file, "utf-8"));
  } catch {
    return null;
  }
}
function resolveUsername(dataDir, configured) {
  if (configured) return configured;
  try {
    let best = "";
    let bestMtime = 0;
    for (const f of readdirSync2(dataDir)) {
      const m = /^status-(.+)\.json$/.exec(f);
      if (!m) continue;
      const mt = statSync(join9(dataDir, f)).mtimeMs;
      if (mt > bestMtime) {
        bestMtime = mt;
        best = m[1];
      }
    }
    return best;
  } catch {
    return "";
  }
}
function facingLabel(yaw) {
  if (yaw == null || !Number.isFinite(yaw)) return "\u2014";
  const heading = (-yaw * 180 / Math.PI % 360 + 360) % 360;
  const compass = (360 - heading) % 360;
  if (compass >= 315 || compass < 45) return "\u5357 (+Z)";
  if (compass < 135) return "\u897F (-X)";
  if (compass < 225) return "\u5317 (-Z)";
  return "\u4E1C (+X)";
}
function resolveShotPath(dataDir, shot) {
  if (!shot) return null;
  const root = resolve11(dataDir, "screenshots");
  const full = resolve11(root, shot);
  if (full !== root && !full.startsWith(root + sep)) return null;
  return existsSync9(full) ? full : null;
}
function collect(dataDir, username2) {
  const u = resolveUsername(dataDir, username2);
  const payload = {
    username: u,
    status: null,
    staleMs: null,
    online: false,
    archive: null,
    mystic: null,
    wiki: { total: 0, cards: [] },
    memory: null,
    defects: [],
    latestShot: null,
    uptimeSec: Math.round((Date.now() - START_MS) / 1e3),
    topo: null,
    events: [],
    kills: { recent: 0, items: [] },
    connection: { override: null, runtime: null }
  };
  payload.connection.override = readJson(join9(dataDir, CONNECTION_FILE));
  payload.connection.runtime = readJson(join9(dataDir, RUNTIME_FILE));
  if (!u) return payload;
  const statusRaw = readJson(join9(dataDir, `status-${u}.json`));
  const status = statusRaw ?? {};
  payload.status = statusRaw ? status : null;
  if (status.updatedAt) {
    const age = Date.now() - new Date(status.updatedAt).getTime();
    if (Number.isFinite(age)) {
      payload.staleMs = age;
      payload.online = age < 6e4;
    }
  }
  const tr = readJson(join9(dataDir, "transmigrators.json"));
  const list = tr?.transmigrators ?? [];
  const entry = list.find((t) => t.username === u);
  if (entry) payload.archive = { name: entry.name, epithet: entry.epithet, source: entry.source };
  const mystic = readJson(join9(dataDir, "mystic-state.json"));
  const players = mystic?.players ?? {};
  if (players[u]) payload.mystic = { innateSkill: players[u].innateSkill, level: players[u].level };
  try {
    const lines = readFileSync12(join9(dataDir, `wiki-${u}.jsonl`), "utf-8").split("\n").filter(Boolean);
    payload.wiki.total = lines.length;
    payload.wiki.cards = lines.slice(-8).reverse().map((l) => {
      try {
        const c = JSON.parse(l);
        return { topic: c.topic ?? "", source: c.source ?? "", ts: c.ts ?? 0, content: c.content ?? "" };
      } catch {
        return { topic: "(\u635F\u574F\u884C)", source: "", ts: 0, content: "" };
      }
    });
  } catch {
  }
  payload.memory = readJson(join9(dataDir, "mc-memory.json"));
  try {
    const ddir = join9(dataDir, "defects");
    for (const f of readdirSync2(ddir)) {
      if (!f.endsWith(".json")) continue;
      const d = readJson(join9(ddir, f));
      if (!d) continue;
      const toolFromName = /^DEFECT-\d{14}-(.+)\.json$/.exec(f)?.[1] ?? f;
      payload.defects.push({ ...d, file: f, tool: d.tool ?? toolFromName });
    }
    payload.defects.sort((a, b) => String(b.file).localeCompare(String(a.file)));
  } catch {
  }
  for (let i = (status.recentSteps?.length ?? 0) - 1; i >= 0; i--) {
    const s = status.recentSteps[i];
    if (s.shot && resolveShotPath(dataDir, s.shot)) {
      payload.latestShot = s.shot;
      break;
    }
  }
  payload.topo = readJson(join9(dataDir, `map-${u}.json`));
  try {
    const raw = tailFile(join9(dataDir, `episodic-${u}.jsonl`), 64 * 1024);
    const lines = raw.split("\n").filter(Boolean);
    const events = [];
    for (const l of lines.slice(-40)) {
      try {
        const e = JSON.parse(l);
        const text5 = e.text ?? "";
        events.push({ ts: e.ts ?? "", text: text5, kill: KILL_RE.test(text5) });
      } catch {
      }
    }
    payload.events = events.reverse();
    const kills = events.filter((e) => e.kill).slice(0, 10);
    payload.kills = { recent: events.filter((e) => e.kill).length, items: kills };
  } catch {
  }
  return payload;
}
function json(res, body) {
  const buf = Buffer.from(JSON.stringify(body), "utf-8");
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Length": buf.length });
  res.end(buf);
}
function handleShot(dataDir, req, res) {
  const rel = decodeURIComponent(req.url.slice("/shot/".length));
  const full = resolveShotPath(dataDir, rel);
  if (!full) {
    res.writeHead(404).end("not found");
    return;
  }
  try {
    const img = readFileSync12(full);
    res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": img.length, "Cache-Control": "no-cache" });
    res.end(img);
  } catch {
    res.writeHead(404).end("gone");
  }
}
function readBody(req, limit = 8192) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}
function apply14(ctx2, config) {
  if (!config.enabled) return;
  const dataDir = resolve11(config.dataDir);
  const server = createServer((req, res) => {
    try {
      const url = (req.url ?? "/").split("?")[0];
      if (url === "/api/all") return json(res, collect(dataDir, config.username));
      if (url.startsWith("/shot/")) return handleShot(dataDir, req, res);
      if (url === "/api/connection" && (req.method === "GET" || req.method === "HEAD")) {
        return json(res, collect(dataDir, config.username).connection);
      }
      if (url === "/api/connection" && (req.method === "POST" || req.method === "PUT")) {
        readBody(req).then(
          (body) => {
            try {
              const parsed = JSON.parse(body);
              const v = validateOverrides(parsed);
              if (!v.ok) return json(res, { ok: false, error: v.error });
              mkdirSync11(dataDir, { recursive: true });
              const payload = { ...v.value, updatedAt: (/* @__PURE__ */ new Date()).toISOString(), updatedBy: "mc-panel" };
              writeFileSync8(join9(dataDir, CONNECTION_FILE), JSON.stringify(payload, null, 2) + "\n", "utf-8");
              console.log(`[mc-panel] connection override saved: ${v.value.host}:${v.value.port ?? "(default)"} (bot auto-reconnects)`);
              json(res, { ok: true, saved: v.value });
            } catch (err) {
              json(res, { ok: false, error: err.message });
            }
          },
          (err) => {
            try {
              res.writeHead(400).end(err.message);
            } catch {
            }
          }
        );
        return;
      }
      if (url === "/api/connection/reset" && req.method === "POST" || url === "/api/connection" && req.method === "DELETE") {
        try {
          unlinkSync(join9(dataDir, CONNECTION_FILE));
          console.log("[mc-panel] connection override removed (back to profile defaults)");
          return json(res, { ok: true, reset: true });
        } catch {
          return json(res, { ok: true, reset: true, note: "no override file" });
        }
      }
      if (url === "/" || url.startsWith("/?")) {
        const html = Buffer.from(dashboardHtml(), "utf-8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": html.length });
        return res.end(html);
      }
      res.writeHead(404).end("not found");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        res.writeHead(500).end(msg);
      } catch {
      }
    }
  });
  server.on("error", (err) => console.error(`[mc-panel] server error: ${err.message}`));
  server.listen(config.port, config.host, () => {
    console.log(`[mc-panel] dashboard: http://${config.host}:${config.port}/ (data=${dataDir}, user=${config.username || "auto"})`);
  });
  ctx2.effect(() => () => {
    server.close();
  });
}
function dashboardHtml() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>\u7A7F\u8D8A\u8005\u9762\u677F</title><style>:root{--bg:#0f1115;--card:#1a1d24;--line:#262a33;--fg:#d7dce4;--dim:#8a93a3;--acc:#4f8cff;--ok:#3fb96f;--bad:#e0564f;--warn:#d9a03f}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 "Segoe UI",system-ui,"Microsoft YaHei",sans-serif}a{color:var(--acc);text-decoration:none}.wrap{max-width:1280px;margin:0 auto;padding:14px}.top{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;padding:10px 14px;background:var(--card);border:1px solid var(--line);border-radius:10px;margin-bottom:12px}.top h1{font-size:18px;margin:0}.top .sub{color:var(--dim);font-size:12px}.badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;border:1px solid var(--line)}.badge.on{color:var(--ok);border-color:var(--ok)}.badge.off{color:var(--bad);border-color:var(--bad)}.grid{display:grid;grid-template-columns:1fr 340px;gap:12px}@media(max-width:900px){.grid{grid-template-columns:1fr}}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:12px}.card h2{font-size:13px;color:var(--dim);margin:0 0 8px;font-weight:600;letter-spacing:.05em}.viewer{position:relative;aspect-ratio:16/9;background:#000;border-radius:8px;overflow:hidden}.viewer iframe{position:absolute;inset:0;width:100%;height:100%;border:0}.fs{position:absolute;right:8px;top:8px;background:#0009;color:#fff;border:0;border-radius:6px;padding:3px 8px;cursor:pointer;font-size:12px}.shotwrap{position:relative}.shotwrap img{width:100%;border-radius:8px;display:block;background:#000}.vrow{display:flex;align-items:center;gap:8px;margin:7px 0;font-size:13px}.bar{flex:1;height:9px;background:#0b0d10;border-radius:6px;overflow:hidden}.bar i{display:block;height:100%}.hp i{background:linear-gradient(90deg,#c0392b,#e0564f)}.fd i{background:linear-gradient(90deg,#b9770e,#d9a03f)}.steps{max-height:520px;overflow:auto;display:flex;flex-direction:column;gap:8px}.step{border-left:3px solid var(--acc);padding:6px 10px;background:#141821;border-radius:0 8px 8px 0}.step.err{border-left-color:var(--bad)}.step .meta{color:var(--dim);font-size:11px;display:flex;gap:8px;flex-wrap:wrap}.step .th{margin:3px 0}.step .out{font-size:12px;color:#aab3c2;word-break:break-all}.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{background:#141821;border:1px solid var(--line);border-radius:6px;padding:2px 8px;font-size:12px}.item{font-size:12px;padding:6px 8px;border-bottom:1px solid var(--line)}.item:last-child{border-bottom:0}.item .t{color:var(--dim);font-size:11px}.bottom{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:12px}@media(max-width:1000px){.bottom{grid-template-columns:1fr}}canvas{width:100%;border-radius:8px;background:#0b0d10}.empty{color:var(--dim);font-size:12px;padding:6px 0}.vtab{font-size:11px;padding:2px 8px;border:1px solid #2a3346;border-radius:9px;background:transparent;color:var(--dim);cursor:pointer}.vtab:hover{color:#fff}.conn{background:#141821;border:1px solid var(--line);border-radius:6px;color:var(--fg);padding:4px 8px;font-size:13px;flex:1;min-width:0}.btn{background:var(--acc);border:0;border-radius:6px;color:#fff;padding:4px 12px;font-size:12px;cursor:pointer}.btn:hover{filter:brightness(1.15)}.btn.ghost{background:transparent;border:1px solid var(--line);color:var(--dim)}</style></head><body><div class="wrap"><div class="top"><h1 id="title">\u2026</h1><span class="sub" id="sub"></span><span style="flex:1"></span><span class="badge" id="live">\u2026</span><span class="badge" id="lv">\u2014</span><span class="badge" id="skill">\u2014</span><span class="badge" id="kills">\u2694 \u2014</span></div><div class="grid"><div><div class="card"><h2>\u6E38\u620F\u89C6\u89D2 <span style="float:right"><button class="vtab" id="vt-3" style="background:var(--acc)">\u8F68\u9053</button> <button class="vtab" id="vt-smooth">\u7B2C\u4E00\u4EBA\u79F0</button> <button class="vtab" id="vt-map">\u4FEF\u89C6\u5730\u56FE</button></span></h2><div class="viewer" id="vwrap"><iframe id="vframe" src="about:blank"></iframe><button class="fs" onclick="fs()">\u26F6 \u5168\u5C4F</button></div></div><div class="card"><h2>\u6700\u8FD1\u6240\u89C1\uFF08agent \u622A\u56FE\uFF09</h2><div class="shotwrap" id="shot"></div></div></div><div><div class="card"><h2>\u670D\u52A1\u5668\u8FDE\u63A5\uFF08\u9875\u9762\u53EF\u914D\uFF09</h2><div class="vrow" id="conn-eff">\u2026</div><div class="vrow"><input class="conn" id="conn-host" placeholder="\u670D\u52A1\u5668\u5730\u5740\uFF08IP/\u57DF\u540D\uFF09" spellcheck="false"><input class="conn" id="conn-port" placeholder="\u7AEF\u53E3" style="width:76px;flex:none" inputmode="numeric"></div><div class="vrow"><button class="btn" id="conn-save">\u4FDD\u5B58\u5E76\u91CD\u8FDE</button><button class="btn ghost" id="conn-reset">\u6062\u590D\u9ED8\u8BA4</button><span class="sub" id="conn-msg" style="font-size:11px"></span></div><div class="sub" style="font-size:11px;color:var(--dim)">\u6539\u52A8\u7EA6 2-5 \u79D2\u5185\u81EA\u52A8\u751F\u6548\uFF1Abot \u7528\u65B0\u5730\u5740\u91CD\u5EFA\u8FDE\u63A5\uFF0C\u65E0\u9700\u91CD\u542F</div></div><div class="card"><h2>\u72B6\u6001</h2><div id="vitals">\u2026</div></div><div class="card"><h2>\u5468\u56F4\u5730\u5F62\uFF08\u5B9E\u65F6\u4FEF\u89C6 33\xD733\uFF09</h2><canvas id="topo" width="330" height="330"></canvas><div class="sub" id="toposub" style="color:var(--dim);font-size:11px;margin-top:4px">\u7B49\u5F85\u5730\u5F62\u6570\u636E\u2026</div></div><div class="card"><h2>\u751F\u5B58\u77E5\u8BC6\u5E93</h2><div id="wiki">\u2026</div></div><div class="card"><h2>\u7F3A\u9677\u5DE5\u5355</h2><div id="defects">\u2026</div></div></div></div><div class="card"><h2>\u601D\u8003\u4E0E\u884C\u52A8\u6D41</h2><div class="steps" id="steps">\u2026</div></div><div class="card"><h2>\u7F16\u5E74\u53F2\u4E8B\u4EF6\u6D41\uFF08\u2694 \u6218\u6597\u51FB\u6740\u9AD8\u4EAE\uFF09</h2><div class="steps" id="events" style="max-height:300px">\u2026</div></div><div class="bottom"><div class="card"><h2>\u80CC\u5305</h2><div class="chips" id="inv">\u2026</div></div><div class="card"><h2>\u5DF2\u77E5\u8D44\u6E90\u70B9</h2><canvas id="mm" width="380" height="280"></canvas></div><div class="card"><h2>\u6863\u6848</h2><div id="archive">\u2026</div></div></div></div><script>let viewerSet=false,lastShot=null;let connEdited=false;["conn-host","conn-port"].forEach(function(id){var el=document.getElementById(id);if(el)el.addEventListener("input",function(){connEdited=true})});document.getElementById("conn-save").onclick=function(){var h=document.getElementById("conn-host").value.trim(),pp=document.getElementById("conn-port").value.trim();var body={host:h};if(pp)body.port=parseInt(pp,10);var m=document.getElementById("conn-msg");m.textContent="\u4FDD\u5B58\u4E2D\u2026";fetch("/api/connection",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(function(r){return r.json()}).then(function(j){m.textContent=j.ok?"\u5DF2\u4FDD\u5B58\uFF0Cbot \u91CD\u8FDE\u4E2D\uFF08\u7EA6 2-5 \u79D2\uFF09":"\u5931\u8D25\uFF1A"+(j.error||"\u672A\u77E5\u9519\u8BEF")}).catch(function(e){m.textContent="\u8BF7\u6C42\u5931\u8D25\uFF1A"+e});};document.getElementById("conn-reset").onclick=function(){var m=document.getElementById("conn-msg");m.textContent="\u6062\u590D\u4E2D\u2026";connEdited=false;fetch("/api/connection/reset",{method:"POST"}).then(function(r){return r.json()}).then(function(j){m.textContent=j.ok?"\u5DF2\u6062\u590D\u914D\u7F6E\u9ED8\u8BA4\uFF08bot \u91CD\u8FDE\u4E2D\uFF09":"\u5931\u8D25"}).catch(function(e){m.textContent="\u8BF7\u6C42\u5931\u8D25\uFF1A"+e});};function fs(){var w=document.getElementById("vwrap");if(document.fullscreenElement){document.exitFullscreen()}else{w.requestFullscreen&&w.requestFullscreen()}}function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]})}function hhmmss(ts){try{return new Date(ts).toLocaleTimeString("zh-CN",{hour12:false})}catch(e){return ""}}function fmtUptime(s){var h=Math.floor(s/3600),m=Math.floor(s%3600/60);return h>0?h+"\u5C0F\u65F6"+m+"\u5206":m+"\u5206"+(s%60)+"\u79D2"}function drawMap(p){var c=document.getElementById("mm");if(!c)return;var g=c.getContext("2d");g.clearRect(0,0,c.width,c.height);var mem=p.memory||{},pts=[],COL={base:"#f5d76e",publicChest:"#c39a6b",coal_ore:"#5d6d7e",iron_ore:"#dfe4ea",cobblestone:"#aab7b8",oak_log:"#52be80",spruce_log:"#1e8449"};function push(k,arr){(arr||[]).forEach(function(q){pts.push({x:q.x,z:q.z,c:COL[k]||"#889",r:2.5})})}var st=p.status&&p.status.bot?p.status.bot:null;var me=st&&st.position?st.position:null;if(mem.base)pts.push({x:mem.base.x,z:mem.base.z,c:COL.base,r:4,label:"\u57FA\u5730"});if(mem.publicChest)pts.push({x:mem.publicChest.x,z:mem.publicChest.z,c:COL.publicChest,r:4,label:"\u516C\u5171\u7BB1"});Object.keys(mem.resourcePoints||{}).forEach(function(k){push(k,mem.resourcePoints[k])});if(!pts.length&&!me){g.fillStyle="#8a93a3";g.font="12px sans-serif";g.fillText("\u6682\u65E0\u5750\u6807\u6570\u636E",12,24);return}var xs=pts.map(function(q){return q.x}),zs=pts.map(function(q){return q.z});if(me){xs.push(me.x);zs.push(me.z)}var minx=Math.min.apply(null,xs),maxx=Math.max.apply(null,xs),minz=Math.min.apply(null,zs),maxz=Math.max.apply(null,zs);var pad=28,w=c.width-pad*2,h=c.height-pad*2,dx=Math.max(maxx-minx,8),dz=Math.max(maxz-minz,8);function X(x){return pad+(x-minx)/dx*w}function Z(z){return pad+(z-minz)/dz*h}g.strokeStyle="#1f2430";for(var i=0;i<=4;i++){g.beginPath();g.moveTo(pad+i*w/4,pad);g.lineTo(pad+i*w/4,pad+h);g.stroke();g.beginPath();g.moveTo(pad,pad+i*h/4);g.lineTo(pad+w,pad+i*h/4);g.stroke()}pts.forEach(function(q){g.fillStyle=q.c;g.beginPath();g.arc(X(q.x),Z(q.z),q.r,0,7);g.fill()});if(me){g.fillStyle="#4f8cff";g.beginPath();g.arc(X(me.x),Z(me.z),5,0,7);g.fill();g.strokeStyle="#9cc0ff";g.lineWidth=2;g.beginPath();g.arc(X(me.x),Z(me.z),8,0,7);g.stroke();g.lineWidth=1}g.fillStyle="#8a93a3";g.font="11px sans-serif";g.fillText("N \u2191",6,14);g.fillText(Math.round(minx)+","+Math.round(minz),pad,c.height-8);var rt=Math.round(maxx)+","+Math.round(maxz);g.fillText(rt,c.width-pad-g.measureText(rt).width,c.height-8)}function shade(hex,f){var n=parseInt(hex.slice(1),16),r=(n>>16)&255,gr=(n>>8)&255,b=n&255;r=Math.min(255,Math.round(r*(1+f)));gr=Math.min(255,Math.round(gr*(1+f)));b=Math.min(255,Math.round(b*(1+f)));return "rgb("+r+","+gr+","+b+")"}function drawTopo(m){var c=document.getElementById("topo");if(!c)return;var g=c.getContext("2d");var sub=document.getElementById("toposub");if(!m||!m.cells){sub.textContent="\u7B49\u5F85\u5730\u5F62\u6570\u636E\u2026";return}var R=m.r||16,N=2*R+1,SZ=Math.floor(c.width/N);var COL={g:"#4a7c3f",d:"#7a5b3a","#":"#6e6e6e",s:"#d9c07a","~":"#3a6ea5",L:"#e07020",w:"#8a6236",l:"#3a6b35",c:"#8f8f8f",o:"#f0c94a",T:"#ffcc44",b:"#e0564f",C:"#c39a6b",F:"#d9a03f",G:"#9fc6e8","?":"#556070",".":"#10141b"};var hs=m.heights||[];for(var i=0;i<m.cells.length&&i<N*N;i++){var ch=m.cells[i],h=hs[i]||0;var base=COL[ch]||COL["?"];g.fillStyle=shade(base,Math.max(-0.4,Math.min(0.4,h*0.06)));g.fillRect((i%N)*SZ,Math.floor(i/N)*SZ,SZ,SZ)}(m.entities||[]).forEach(function(e){var px=(e.dx+R)*SZ+SZ/2,pz=(e.dz+R)*SZ+SZ/2;var isP=/player/.test(e.name);g.fillStyle=isP?"#4fd8ff":"#ff5a5a";g.beginPath();g.arc(px,pz,3,0,7);g.fill();if(isP){g.fillStyle="#bfeaff";g.font="10px sans-serif";g.fillText(e.name.replace("(player)",""),px+5,pz+3)}});var mx=R*SZ+SZ/2,mz=R*SZ+SZ/2;var yaw=m.yaw||0,ax=-Math.sin(yaw),az=Math.cos(yaw);g.fillStyle="#fff";g.beginPath();g.arc(mx,mz,4,0,7);g.fill();g.strokeStyle="#fff";g.lineWidth=2;g.beginPath();g.moveTo(mx,mz);g.lineTo(mx+ax*12,mz+az*12);g.stroke();g.lineWidth=1;g.fillStyle="#8a93a3";g.font="11px sans-serif";g.fillText("N \u2191",6,14);sub.textContent="\u4E2D\u5FC3 "+(m.cx!=null?"("+m.cx+","+m.cy+","+m.cz+")":"\u2014")+" \xB7 "+(m.entities||[]).length+" \u5B9E\u4F53 \xB7 "+hhmmss(m.updatedAt)}function render(p){var st=p.status&&p.status.bot?p.status.bot:null;document.title="\u7A7F\u8D8A\u8005\u9762\u677F \xB7 "+((p.archive&&p.archive.name)||p.username||"?");document.getElementById("title").textContent="\u2694 "+((p.archive&&p.archive.name)||st&&st.personaName||p.username||"\u672A\u77E5\u7A7F\u8D8A\u8005");document.getElementById("sub").textContent=((p.archive&&p.archive.epithet)?p.archive.epithet+" \xB7 ":"")+(p.username||"")+(p.archive&&p.archive.source?" \xB7 "+p.archive.source:"");var live=document.getElementById("live");live.textContent=p.online?"\u{1F7E2} \u5728\u7EBF":"\u{1F534} \u5931\u8054/\u79BB\u7EBF";live.className="badge "+(p.online?"on":"off");var lv=document.getElementById("lv"),sk=document.getElementById("skill");lv.textContent=p.mystic&&p.mystic.level!=null?"Lv."+p.mystic.level:"Lv.\u2014";sk.textContent=p.mystic&&p.mystic.innateSkill?"\u5929\u8D4B\u300C"+p.mystic.innateSkill+"\u300D":"\u5929\u8D4B\u672A\u5B9A";var cn=p.connection||{},rt=cn.runtime,ce=document.getElementById("conn-eff");if(rt){var cAge=Date.now()-new Date(rt.updatedAt).getTime();var ccls="badge "+(rt.connected?"on":"off"),ctxt=rt.connected?"\u5DF2\u8FDE\u63A5":(cAge<30000?"\u91CD\u8FDE\u4E2D\u2026":"\u672A\u8FDE\u63A5");ce.innerHTML="\u751F\u6548 <b>"+esc(rt.host+":"+rt.port)+"</b> \xB7 "+(rt.source==="override"?"\u9875\u9762\u8BBE\u7F6E":"\u914D\u7F6E\u9ED8\u8BA4")+" \xB7 <span class='"+ccls+"'>"+ctxt+"</span>";if(!connEdited){if(rt.host)document.getElementById("conn-host").value=rt.host;document.getElementById("conn-port").value=rt.port||"";}}else{ce.innerHTML="<span class=empty>\u7B49\u5F85 bot \u4E0A\u62A5\u8FDE\u63A5\u72B6\u6001\u2026</span>"}var v=document.getElementById("vitals");if(!st){v.innerHTML="\\<div class=empty>\u6682\u65E0\u72B6\u6001\u6570\u636E\uFF08\u7B49\u5F85 agent \u8FDE\u63A5\u670D\u52A1\u5668\u2026\uFF09\\</div>"}else{var hp=st.health==null?0:st.health,fd=st.food==null?0:st.food,pos=st.position;var dirs=["\u5357","\u897F","\u5317","\u4E1C"],yaw=st.yaw==null?0:st.yaw,deg=((yaw*180/Math.PI)+360)%360,di=Math.round(deg/90)%4;v.innerHTML="<div class=vrow>\u2764 \u751F\u547D <div class=bar hp><i style=width:"+(hp/20*100)+"%></i></div> "+hp+"/20</div>"+"<div class=vrow>\u{1F357} \u9971\u98DF <div class=bar fd><i style=width:"+(fd/20*100)+"%></i></div> "+fd+"/20</div>"+"<div class=vrow>\u{1F4CD} \u5750\u6807 "+(pos?pos.x+", "+pos.y+", "+pos.z:"\u2014")+"</div>"+"<div class=vrow>\u{1F9ED} \u671D\u5411 "+dirs[di]+" \xB7 \u270B \u624B\u6301 "+(st.heldItem||"\u7A7A\u624B")+(st.sleeping?" \xB7 \u{1F634} \u7761\u7720\u4E2D":"")+"</div>"+"<div class=vrow>\u{1F3AF} \u76EE\u6807 "+esc((p.memory&&p.memory.currentGoal)||(p.status&&p.status.recentSteps&&p.status.recentSteps.length?p.status.recentSteps[p.status.recentSteps.length-1].goal:"\u2014"))+"</div>"+"<div class=vrow>\u23F1 \u8FDB\u7A0B "+fmtUptime(p.uptimeSec)+" \xB7 \u66F4\u65B0 "+hhmmss(p.status&&p.status.updatedAt)+"</div>"+ "<div class=vrow>\u{1F9E0} \u4E0A\u4E0B\u6587\u63D0\u793A\u5361 "+((p.status&&p.status.context&&p.status.context.cards||[]).length?(p.status.context.cards).map(function(k){return k.id+"\xD7"+k.remain}).join(" "):"\u65E0\uFF08\u6309\u9700\u62AB\u9732\u4E2D\uFF09")+"</div>"}var f=document.getElementById("vframe"),curPv="3";function setPv(pv){curPv=pv;if(st&&st.viewerPort){f.src="http://"+location.hostname+":"+st.viewerPort+"/?pv="+pv;}["3","smooth","map"].forEach(function(k){var b=document.getElementById("vt-"+k);if(b){b.style.background=k===pv?"var(--acc)":"transparent";b.style.color=k===pv?"#0d1117":"var(--dim)"}})}if(st&&st.viewerPort&&!viewerSet){setPv(curPv);viewerSet=true}["3","smooth","map"].forEach(function(k){var b=document.getElementById("vt-"+k);if(b)b.onclick=function(){setPv(k)}})var sh=document.getElementById("shot");if(p.latestShot&&p.latestShot!==lastShot){lastShot=p.latestShot;sh.innerHTML="<img src=/shot/"+encodeURIComponent(p.latestShot)+"?t="+Date.now()+">"}else if(!p.latestShot){sh.innerHTML="<div class=empty>\u6682\u65E0\u622A\u56FE</div>"}var steps=(p.status&&p.status.recentSteps)||[];var se=document.getElementById("steps");se.innerHTML=steps.length?steps.slice(-30).reverse().map(function(s){var bad=/error|could not|failed|timeout/i.test(s.outcome||"");return "<div class=step"+(bad?" err":"")+"><div class=meta>#"+(s.step||"?")+" \xB7 "+hhmmss(s.ts)+" \xB7 \u2692 "+esc(s.tool||"")+"</div>"+"<div class=th>\u{1F4AD} "+esc(s.thought||"")+"</div><div class=meta>\u{1F3AF} "+esc(s.goal||"")+"</div>"+"<div class=out>"+esc((s.outcome||"").slice(0,300))+"</div></div>"}).join(""):"<div class=empty>\u6682\u65E0\u884C\u52A8\u8BB0\u5F55</div>";var inv=(st&&st.inventory)||[],agg={};inv.forEach(function(i){agg[i.name]=(agg[i.name]||0)+i.count});var keys=Object.keys(agg).sort(function(a,b){return agg[b]-agg[a]});document.getElementById("inv").innerHTML=keys.length?keys.map(function(k){return "<span class=chip>"+esc(k)+" \xD7"+agg[k]+"</span>"}).join(""):"<div class=empty>\u80CC\u5305\u7A7A\u7A7A\u5982\u4E5F</div>";var w=p.wiki,wd=document.getElementById("wiki");wd.innerHTML=w.total?"<div class=item>\u5171 "+w.total+" \u5F20\u77E5\u8BC6\u5361\uFF08\u5C55\u793A\u6700\u8FD1 "+w.cards.length+" \u5F20\uFF09</div>"+w.cards.map(function(c){return "<div class=item><div>"+esc(c.topic)+"</div><div class=t>"+esc(c.source)+" \xB7 "+hhmmss(c.ts)+" \xB7 "+esc((c.content||"").slice(0,80))+"\u2026</div></div>"}).join(""):"<div class=empty>\u8FD8\u6CA1\u5B66\u4F1A\u4EFB\u4F55\u6559\u8BAD</div>";var ds=p.defects,dd=document.getElementById("defects");dd.innerHTML=ds.length?ds.slice(0,6).map(function(d){return "<div class=item><div>\u2692 "+esc(d.tool)+" \xD7"+(d.count!=null?d.count:"?")+"</div><div class=t>"+esc(d.lastSample||d.lastAt||d.file)+"</div></div>"}).join(""):"<div class=empty>\u65E0\u672A\u51B3\u5DE5\u5355\uFF0C\u8FD0\u884C\u5065\u5EB7</div>";var ar=p.archive,ad=document.getElementById("archive");ad.innerHTML=ar?"<div class=item>\u540D\u5B57\uFF1A"+esc(ar.name)+"</div><div class=item>\u79F0\u53F7\uFF1A"+esc(ar.epithet||"\u2014")+"</div><div class=item>\u6765\u81EA\uFF1A"+esc(ar.source||"\u2014")+"</div><div class=item>MC \u7528\u6237\u540D\uFF1A"+esc(p.username)+"</div>":"<div class=empty>\u672A\u6CE8\u518C\u7A7F\u8D8A\u8005\u6863\u6848</div>";var kb=document.getElementById("kills");kb.textContent=p.kills&&p.kills.recent?"\u2694 \u8FD1\u671F\u51FB\u6740 "+p.kills.recent:"\u2694 0";var ev=document.getElementById("events");ev.innerHTML=p.events&&p.events.length?p.events.slice(0,25).map(function(e){return "<div class=step"+(e.kill?" err":"")+"><div class=meta>"+hhmmss(e.ts)+(e.kill?" \xB7 \u2694 \u6218\u6597":"")+"</div><div class=out>"+esc(e.text.slice(0,260))+"</div></div>"}).join(""):"<div class=empty>\u6682\u65E0\u7F16\u5E74\u53F2</div>";drawTopo(p.topo);drawMap(p)}function tick(){fetch("/api/all").then(function(r){return r.json()}).then(render).catch(function(){})}tick();setInterval(tick,3000);</script></body></html>`;
}

// bootstrap-session.mts
import { writeFileSync as writeFileSync9 } from "node:fs";
var RUN_MS = Number(process.env.RUN_MS ?? 0);
process.on("unhandledRejection", (reason) => {
  const detail = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
  console.error(`[bootstrap-session] UNHANDLED REJECTION (suppressed): ${detail}`);
});
process.on("uncaughtException", (err) => {
  const detail = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(`[bootstrap-session] UNCAUGHT EXCEPTION (suppressed): ${detail}`);
});
var username = process.env.MC_USERNAME ?? "HarnessBot";
var viewerPort = Number(process.env.MC_VIEWER_PORT ?? 3001);
var godName = process.env.MC_GOD_NAME ?? "Goddess";
var ctx = new Context();
await ctx.plugin(Timer);
await ctx.plugin(LlmRuntime);
await ctx.plugin(SessionStore);
await ctx.plugin(SystemPrompt);
await ctx.plugin(ToolRuntime);
await ctx.plugin(AgentRegistry);
await ctx.plugin(AgentLoop, { agents: [] });
await ctx.plugin(llm_qwen_local_exports, {
  baseURL: process.env.MC_LLM_BASE_URL ?? "http://127.0.0.1:8890/v1",
  apiKey: process.env.MC_LLM_API_KEY ?? "sk-local",
  debug: process.env.MC_LLM_DEBUG === "1"
});
await ctx.plugin(mc_bot_exports, {
  host: process.env.MC_HOST ?? "localhost",
  port: Number(process.env.MC_PORT ?? 25565),
  username,
  autoReconnect: true,
  viewerEnabled: process.env.MC_VIEWER !== "0",
  viewerFirstPerson: false,
  viewerPort
});
await ctx.plugin(mc_tools_exports);
await ctx.plugin(mc_memory_exports, {
  memoryPath: "./data/mc-memory.json",
  maxPointsPerType: 20
});
await ctx.plugin(mc_memos_exports, {
  enabled: process.env.MC_MEMOS !== "0",
  backend: process.env.MC_MEMOS_BACKEND ?? "auto",
  baseUrl: process.env.MC_MEMOS_URL ?? "http://127.0.0.1:8002",
  timeoutMs: 8e3,
  maxRecall: 5,
  localDir: process.env.MC_MEMOS_LOCAL_DIR ?? "./data/memory",
  username
});
await ctx.plugin(mc_evolve_exports, {
  enabled: process.env.MC_EVOLVE !== "0",
  baseUrl: process.env.MC_LLM_BASE_URL ?? "http://127.0.0.1:8890/v1",
  apiKey: process.env.MC_LLM_API_KEY ?? "sk-local",
  model: process.env.MC_LLM_MODEL ?? "qwen3.8",
  cooldownHours: 12,
  reasoningEffort: "xhigh",
  maxTokens: 2048,
  statePath: "./data/evolve-state.json",
  perQuery: 8,
  diaryEnabled: process.env.MC_DIARY !== "0",
  godName
});
await ctx.plugin(mc_adapt_exports, {
  enabled: process.env.MC_ADAPT !== "0",
  dataDir: "./data",
  godName
});
await ctx.plugin(mc_transmigrator_exports, {
  registryPath: "./data/transmigrators.json"
});
await ctx.plugin(mc_identity_exports, {
  seedStatePath: "./data/identity-seed.json",
  maxChunkChars: 400,
  seedIntervalMs: 300
});
await ctx.plugin(mc_mystic_exports, {
  enabled: true,
  godName,
  chantTimeoutMs: 1e4,
  prayTimeoutMs: 8e3,
  statePath: "./data/mystic-state.json"
});
await ctx.plugin(mc_wiki_exports, {
  dataDir: "./data",
  maxCards: 200
});
await ctx.plugin(mc_panel_exports, {
  enabled: true,
  host: process.env.MC_PANEL_HOST ?? "127.0.0.1",
  port: Number(process.env.MC_PANEL_PORT ?? 3200),
  dataDir: "./data",
  username
});
await ctx.plugin(mc_village_exports, {
  nearbyRadius: 28
});
var transmigrator = ctx.mcTransmigrators?.getByUsername(username);
var personaFromRegistry = transmigrator?.persona?.trim() || "";
if (transmigrator) {
  console.log(
    `[bootstrap-session] \u547D\u4E2D\u7A7F\u8D8A\u8005\u6863\u6848: ${transmigrator.name}(${transmigrator.username}) \u6765\u6E90=${transmigrator.source ?? "\u968F\u673A"} persona=${personaFromRegistry.length} \u5B57`
  );
}
var statusPath = `./data/status-${username}.json`;
var writeBotStatus = () => {
  let botSnapshot = { online: false, username };
  try {
    const b = ctx.mcbot;
    const p = b?.entity?.position;
    if (p) {
      botSnapshot = {
        online: true,
        username,
        personaName: transmigrator?.name ?? username,
        position: { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) },
        health: Math.round(b.health ?? 20),
        food: Math.round(b.food ?? 20),
        heldItem: b.heldItem?.name ?? null,
        inventory: (b.inventory?.items() ?? []).map((it) => ({ name: it.name, count: it.count })),
        viewerPort
      };
    }
  } catch {
  }
  try {
    writeFileSync9(statusPath, JSON.stringify({ bot: botSnapshot, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }));
  } catch {
  }
};
setInterval(writeBotStatus, 3e3);
await ctx.plugin(mc_session_exports, {
  enabled: true,
  username,
  sessionId: process.env.MC_SESSION_ID ?? `mc-${username}`,
  cwd: process.cwd(),
  provider: "qwen-local",
  model: process.env.MC_LLM_MODEL ?? "qwen3.8-27b",
  intervalMs: Number(process.env.MC_SESSION_INTERVAL ?? 5e3),
  goal: process.env.MC_GOAL ?? "\u4F60\u521A\u4ECE\u73B0\u4EE3\u7A7F\u8D8A\u5230\u8FD9\u4E2A\u65B9\u5757\u4E16\u754C\uFF0C\u4E00\u65E0\u6240\u6709\u3002\u6309\u4F18\u5148\u7EA7\u884C\u52A8\uFF1A\u5148\u4FDD\u8BC1\u6D3B\u4E0B\u53BB\uFF08\u5403\u9971\u3001\u8840\u91CF\u5B89\u5168\u3001\u5929\u9ED1\u524D\u56DE\u57FA\u5730\uFF09\uFF0C\u518D\u6536\u96C6\u6728\u6750/\u77F3\u5934/\u7164/\u94C1\u7B49\u57FA\u7840\u7269\u8D44\uFF0C\u6700\u540E\u5728\u57FA\u5730\u9644\u8FD1\u5EFA\u7ACB\u5E76\u7ECF\u8425\u4F60\u7684\u6839\u636E\u5730\u3002",
  persona: process.env.MC_PERSONA ?? personaFromRegistry
});
console.log(
  `[bootstrap-session] dsh session agent ready: session=mc-${username} model=${process.env.MC_LLM_MODEL ?? "qwen3.8-27b"}, running ${RUN_MS > 0 ? RUN_MS + "ms" : "indefinitely"} ...`
);
if (RUN_MS > 0) {
  await new Promise((resolve12) => setTimeout(resolve12, RUN_MS));
  console.log("[bootstrap-session] done, exiting");
  process.exit(0);
} else {
  await new Promise(() => {
  });
}
