/**
 * Thin OpenAI-compatible LLM adapter for a locally hosted Qwen3.8 vLLM server.
 *
 * The harness ships no OpenAI adapter, so this clones the transport-only shape
 * of `dsh-llm-deepseek`'s `DeepSeekAdapter` and swaps two facts:
 *
 *  1. Reasoning-effort vocabulary — Qwen3.8 accepts `none`/`low`/`medium`/
 *     `high`/`xhigh` (NOT DeepSeek's `off`/`low`/`high`/`max`), carried on the
 *     wire as a top-level `reasoning_effort` field. There is no separate
 *     `thinking` field on this route.
 *  2. Image support — Qwen3.8 is a VL model. DeepSeek's route is text-only and
 *     rejects image blocks; this adapter resolves `ImageBlock` attachments
 *     through the attachment service (injected at registration) and serializes
 *     them as OpenAI `image_url` parts with a base64 data URL.
 *
 * Everything else (SSE translation, finish-reason mapping, token accounting,
 * error classification) is provider-neutral and mirrors DeepSeek's reference
 * implementation.
 *
 * @module llm-qwen-local
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  ImageAttachmentRef,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import {
  CallId,
  EMPTY_RESPONSE_CODE,
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
  attributionHeaders,
  contentHasImage,
  isContextWindowExceededError,
  isQuotaExceededError,
} from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock,
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  Message,
  ReasoningEffortId as ReasoningEffortIdType,
  StreamChunk,
  TokenUsage,
} from '@deepseek-ai/dsh-llm'

export const name = 'llm-qwen-local'
export const inject = ['llm']

/** The single provider route this plugin owns. */
export const PROVIDER = 'qwen-local'

export const DEFAULT_BASE_URL = 'http://127.0.0.1:8890/v1'
export const DEFAULT_API_KEY = 'sk-local'
export const DEFAULT_CONTEXT_WINDOW = 262144
export const DEFAULT_MAX_TOKENS = 8192

const NONE_REASONING_EFFORT = ReasoningEffortId('none')
const LOW_REASONING_EFFORT = ReasoningEffortId('low')
const MEDIUM_REASONING_EFFORT = ReasoningEffortId('medium')
const HIGH_REASONING_EFFORT = ReasoningEffortId('high')
const XHIGH_REASONING_EFFORT = ReasoningEffortId('xhigh')

const REASONING_EFFORTS = [
  { id: NONE_REASONING_EFFORT, name: 'None' },
  { id: LOW_REASONING_EFFORT, name: 'Low' },
  { id: MEDIUM_REASONING_EFFORT, name: 'Medium' },
  { id: HIGH_REASONING_EFFORT, name: 'High' },
  { id: XHIGH_REASONING_EFFORT, name: 'XHigh' },
]

/** Adapter-level catalog entry (provider-agnostic; `provider` is stamped later). */
export interface QwenLocalModel {
  id: string
  name?: string
  description?: string
  contextWindow?: number
  maxTokens?: number
}

export interface QwenLocalAdapterOptions {
  baseURL: string
  apiKey: string
  models: QwenLocalModel[]
  defaultContextWindow: number
  defaultMaxTokens: number
  defaultReasoningEffort: ReasoningEffortIdType
  readImage: (
    ref: ImageAttachmentRef,
    signal?: AbortSignal,
  ) => Promise<StoredImageAttachment>
  debug?: boolean
}

export interface QwenLocalPluginConfig {
  baseURL?: string
  apiKey?: string
  models?: QwenLocalModel[]
  defaultContextWindow?: number
  defaultMaxTokens?: number
  debug?: boolean
}

const DEFAULT_MODELS: QwenLocalModel[] = [
  {
    id: 'qwen3.8-27b',
    name: 'Qwen3.8-27B',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
  },
]

function modelInfo(provider: string, model: QwenLocalModel): LlmModelInfo {
  return {
    provider,
    id: model.id,
    name: model.name ?? model.id,
    ...(model.description === undefined ? {} : { description: model.description }),
    inputModalities: ['text', 'image'],
  }
}

/** Validate and materialize the adapter-owned reasoning-effort wire value. */
function wireEffort(effort: ReasoningEffortIdType | undefined): string {
  const value = effort === undefined ? 'none' : String(effort)
  if (
    value === 'none' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh'
  ) {
    return value
  }
  throw new LlmError(
    `Qwen3.8 does not support reasoning effort "${value}"`,
    'UNSUPPORTED_REASONING_EFFORT',
  )
}

/** Join the text blocks of a message (used for text-only paths). */
function flattenText(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
}

/** Serialize one assistant message (text + reasoning + tool calls). */
function serializeAssistant(message: Message): Record<string, unknown> {
  const text = flattenText(message.content)
  const reasoning = message.content
    .filter((block) => block.type === 'reasoning')
    .map((block) => block.text)
    .join('')
  const toolCalls = message.content
    .filter((block) => block.type === 'tool-call')
    .map((block) => ({
      id: block.id,
      type: 'function',
      function: { name: block.name, arguments: block.arguments },
    }))
  return {
    role: 'assistant',
    content: text,
    ...(toolCalls.length > 0 && reasoning.length > 0
      ? { reasoning_content: reasoning }
      : {}),
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  }
}

/** Resolve an image block to a base64 data URL. */
async function imageDataUrl(
  block: { attachment: ImageAttachmentRef },
  readImage: QwenLocalAdapterOptions['readImage'],
  signal?: AbortSignal,
): Promise<string> {
  const stored = await readImage(block.attachment, signal)
  const base64 = Buffer.from(stored.data).toString('base64')
  return `data:${stored.ref.mediaType};base64,${base64}`
}

/**
 * Serialize a content-block list into wire content: a plain string when
 * text-only, or a multimodal part array when images are present. The harness
 * guarantees images carry text alongside them in practice, so image-only
 * content is still handled defensively (a lone `image_url` part is legal).
 */
async function serializeContent(
  blocks: readonly ContentBlock[],
  readImage: QwenLocalAdapterOptions['readImage'],
  signal?: AbortSignal,
): Promise<string | Array<Record<string, unknown>>> {
  if (!contentHasImage(blocks)) return flattenText(blocks)
  const parts: Array<Record<string, unknown>> = []
  for (const block of blocks) {
    if (block.type === 'image') {
      parts.push({
        type: 'image_url',
        image_url: { url: await imageDataUrl(block, readImage, signal) },
      })
    } else if (block.type === 'text' && block.text.length > 0) {
      parts.push({ type: 'text', text: block.text })
    }
  }
  return parts
}

async function serializeToolContent(
  blocks: readonly ContentBlock[],
  readImage: QwenLocalAdapterOptions['readImage'],
  signal?: AbortSignal,
): Promise<string | Array<Record<string, unknown>>> {
  const content = await serializeContent(blocks, readImage, signal)
  if (typeof content === 'string' && content.length === 0) return '(no output)'
  return content
}

/**
 * Serialize the conversation. `tool-result` blocks become standalone
 * `{role:'tool'}` messages; a mixed user message contributes its text/images
 * first and its tool results as separate wire messages after.
 */
async function serializeMessages(
  messages: readonly Message[],
  readImage: QwenLocalAdapterOptions['readImage'],
  signal?: AbortSignal,
): Promise<Array<Record<string, unknown>>> {
  const wire: Array<Record<string, unknown>> = []
  for (const message of messages) {
    if (message.role === 'system') {
      wire.push({ role: 'system', content: flattenText(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      wire.push(serializeAssistant(message))
      continue
    }
    const toolResults = message.content.filter((block) => block.type === 'tool-result')
    const text = flattenText(message.content)
    if (text.length > 0 || toolResults.length === 0) {
      wire.push({
        role: 'user',
        content: await serializeContent(message.content, readImage, signal),
      })
    }
    for (const result of toolResults) {
      wire.push({
        role: 'tool',
        tool_call_id: result.toolCallId,
        content: await serializeToolContent(result.content, readImage, signal),
      })
    }
  }
  return wire
}

/** Build the full wire request (async: image resolution may be I/O). */
async function serializeRequest(
  options: GenerateOptions,
  adapter: QwenLocalAdapterOptions,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = []
  if (options.system !== undefined) {
    messages.push({ role: 'system', content: options.system })
  }
  messages.push(...(await serializeMessages(options.messages, adapter.readImage, signal)))

  const tools = options.tools?.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))

  const reasoningEffort =
    options.purpose === 'session-title'
      ? 'none'
      : wireEffort(options.reasoningEffort ?? adapter.defaultReasoningEffort)

  return {
    model: options.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    reasoning_effort: reasoningEffort,
    ...(tools !== undefined && tools.length > 0 ? { tools } : {}),
    ...(options.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
    ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
    ...(options.stop !== undefined ? { stop: options.stop } : {}),
  }
}

/** Extract the `data:` payload lines of one SSE event (joined with `\n`). */
function extractData(rawEvent: string): string | null {
  const dataLines: string[] = []
  for (const line of rawEvent.split('\n')) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ ?/, ''))
  }
  if (dataLines.length === 0) return null
  return dataLines.join('\n')
}

/**
 * Parse a vLLM SSE byte stream into `data` payloads. Yields `[DONE]` as the
 * final value and returns; throws `LlmError('STREAM_CLOSED')` when the stream
 * ends without it. Hand-rolled to avoid an `eventsource-parser` dependency.
 */
async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let sawDone = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n')
      let separator: number
      while ((separator = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, separator)
        buffer = buffer.slice(separator + 2)
        const data = extractData(raw)
        if (data === null) continue
        if (data === '[DONE]') {
          sawDone = true
          // 必须 yield 出去：`translate` 靠收到 `[DONE]` 来做收尾
          //（block-end / usage / finish），直接 return 会让它误判为
          // 流中断并抛 STREAM_CLOSED。
          yield data
          return
        }
        yield data
      }
    }
    // 流已结束：flush decoder 并处理 buffer 残留。健壮兜底——
    // 某些上游在 `[DONE]` 后可能不补 `\n\n`，此时它仍留在 buffer 里。
    buffer += decoder.decode()
    buffer = buffer.replace(/\r\n/g, '\n')
    if (buffer.trim().length > 0) {
      const data = extractData(buffer)
      if (data === '[DONE]') {
        sawDone = true
        yield data
      } else if (data !== null) {
        yield data
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* already released */
    }
  }
  if (!sawDone) throw new LlmError('SSE stream ended without [DONE]', 'STREAM_CLOSED')
}

/** Map the wire `finish_reason` vocabulary to the harness `FinishReason`. */
function mapFinishReason(
  reason: string,
): Extract<StreamChunk, { type: 'finish' }>['reason'] {
  switch (reason) {
    case 'stop':
      return { kind: 'stop' }
    case 'tool_calls':
      return { kind: 'tool-calls' }
    case 'length':
      return { kind: 'max-tokens' }
    default:
      return {
        kind: 'error',
        failure: {
          message: `model stopped: ${reason}`,
          code: reason.toUpperCase(),
        },
      }
  }
}

/** Map wire usage fields to disjoint harness counts. */
function mapUsage(usage: Record<string, unknown>): TokenUsage {
  const promptTokens = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0
  const completionTokens =
    typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0
  const details = usage.prompt_tokens_details as Record<string, unknown> | undefined
  const cacheRead = typeof details?.cached_tokens === 'number' ? details.cached_tokens : undefined
  const completionDetails = usage.completion_tokens_details as
    | Record<string, unknown>
    | undefined
  const reasoning =
    typeof completionDetails?.reasoning_tokens === 'number'
      ? completionDetails.reasoning_tokens
      : undefined
  return {
    inputTokens: promptTokens - (cacheRead ?? 0),
    outputTokens: completionTokens,
    ...(cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {}),
    ...(reasoning !== undefined ? { reasoningTokens: reasoning } : {}),
  }
}

interface OpenBlock {
  index: number
  kind: 'text' | 'reasoning' | 'tool-call'
  text: string
  callId?: string
  name?: string
}

function closeBlock(block: OpenBlock): ContentBlock {
  switch (block.kind) {
    case 'text':
      return { type: 'text', text: block.text }
    case 'reasoning':
      return { type: 'reasoning', text: block.text }
    case 'tool-call':
      return {
        type: 'tool-call',
        id: CallId(block.callId ?? ''),
        name: block.name ?? '',
        arguments: block.text,
      }
  }
}

/** Consume SSE data payloads and yield StreamChunks (mirrors DeepSeek). */
async function* translate(payloads: AsyncIterable<string>): AsyncGenerator<StreamChunk> {
  let nextIndex = 0
  let textBlock: OpenBlock | undefined
  let reasoningBlock: OpenBlock | undefined
  const toolBlocks = new Map<number, OpenBlock>()
  const order: OpenBlock[] = []
  let pendingFinish: Extract<StreamChunk, { type: 'finish' }>['reason'] | undefined
  let pendingUsage: TokenUsage | undefined

  const open = (kind: OpenBlock['kind']): OpenBlock => {
    const block: OpenBlock = { index: nextIndex++, kind, text: '' }
    order.push(block)
    return block
  }

  for await (const payload of payloads) {
    if (payload === '[DONE]') {
      for (const block of order) {
        yield { type: 'block-end', index: block.index, block: closeBlock(block) }
      }
      if (pendingUsage) yield { type: 'usage', usage: pendingUsage }
      const reason = pendingFinish ?? { kind: 'stop' }
      yield {
        type: 'finish',
        reason:
          reason.kind === 'stop' && order.length === 0
            ? {
                kind: 'error',
                failure: {
                  message: 'model returned a completed response with no content',
                  code: EMPTY_RESPONSE_CODE,
                },
              }
            : reason,
      }
      return
    }

    let chunk: Record<string, unknown>
    try {
      chunk = JSON.parse(payload)
    } catch {
      throw new LlmError(
        `malformed SSE payload: ${payload.slice(0, 120)}`,
        'MALFORMED_RESPONSE',
      )
    }

    for (const choice of (chunk.choices ?? []) as Array<Record<string, unknown>>) {
      const delta = choice.delta as Record<string, unknown> | undefined
      const reasoning = delta?.reasoning_content
      if (typeof reasoning === 'string' && reasoning.length > 0) {
        if (!reasoningBlock) {
          reasoningBlock = open('reasoning')
          yield {
            type: 'block-start',
            index: reasoningBlock.index,
            blockType: 'reasoning',
          }
        }
        reasoningBlock.text += reasoning
        yield {
          type: 'reasoning-delta',
          index: reasoningBlock.index,
          text: reasoning,
        }
      }

      const content = delta?.content
      if (typeof content === 'string' && content.length > 0) {
        if (!textBlock) {
          textBlock = open('text')
          yield { type: 'block-start', index: textBlock.index, blockType: 'text' }
        }
        textBlock.text += content
        yield { type: 'text-delta', index: textBlock.index, text: content }
      }

      for (const call of (delta?.tool_calls ?? []) as Array<Record<string, unknown>>) {
        const callIndex = typeof call.index === 'number' ? call.index : 0
        let block = toolBlocks.get(callIndex)
        if (!block) {
          block = open('tool-call')
          toolBlocks.set(callIndex, block)
          yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
        }
        if (typeof call.id === 'string') block.callId = call.id
        const fn = call.function as Record<string, unknown> | undefined
        if (typeof fn?.name === 'string') block.name = fn.name
        const fragment = typeof fn?.arguments === 'string' ? fn.arguments : ''
        block.text += fragment
        yield {
          type: 'tool-call-delta',
          index: block.index,
          id: CallId(block.callId ?? ''),
          ...(block.name !== undefined ? { name: block.name } : {}),
          argumentsDelta: fragment,
        }
      }

      if (typeof choice.finish_reason === 'string') {
        pendingFinish = mapFinishReason(choice.finish_reason)
      }
    }

    if (chunk.usage) pendingUsage = mapUsage(chunk.usage as Record<string, unknown>)
  }
  throw new LlmError('SSE payload stream ended without [DONE]', 'STREAM_CLOSED')
}

/** Map an HTTP status + provider error body to a stable LlmError code. */
function httpErrorCode(status: number, error: Record<string, unknown> | undefined): string {
  if (status === 401 || status === 403) return 'AUTH'
  const detail = [error?.code, error?.type, error?.message].filter(Boolean).join(' ')
  if (isQuotaExceededError(detail)) return 'QUOTA'
  if (status === 429) return 'RATE_LIMIT'
  if (status === 400) {
    if (isContextWindowExceededError(detail)) return 'CONTEXT_WINDOW_EXCEEDED'
    return 'INVALID_REQUEST'
  }
  if (status >= 500) return 'SERVER'
  return `HTTP_${status}`
}

/** The thin transport adapter: fetch + SSE against a local vLLM endpoint. */
export class QwenLocalAdapter extends LlmAdapter {
  private readonly config: QwenLocalAdapterOptions

  constructor(config: QwenLocalAdapterOptions) {
    super()
    this.config = config
  }

  providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Qwen Local' }
  }

  listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.config.models.map((model) => modelInfo(provider, model)))
  }

  resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    const configured = this.config.models.find((entry) => entry.id === model)
    const contextWindow = configured?.contextWindow ?? this.config.defaultContextWindow
    return Promise.resolve({
      ...(configured === undefined
        ? {
            provider,
            id: model,
            name: model,
            inputModalities: ['text', 'image'] as const,
          }
        : modelInfo(provider, configured)),
      context: { contextWindow },
      defaultMaxTokens: configured?.maxTokens ?? this.config.defaultMaxTokens,
      reasoning: {
        efforts: REASONING_EFFORTS,
        defaultEffort: this.config.defaultReasoningEffort,
      },
    })
  }

  async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    if (this.config.debug) {
      console.log(
        `[llm-qwen-local] STREAM model=${options.model} msgs=${options.messages.length} ` +
          `tools=${options.tools?.length ?? 0} purpose=${options.purpose ?? '-'}`,
      )
    }
    const body = await serializeRequest(options, this.config, options.signal)
    const payload = JSON.stringify(body)
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.config.apiKey}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...attributionHeaders(),
    }

    let response: Response
    try {
      response = await fetch(`${this.config.baseURL}/chat/completions`, {
        method: 'POST',
        headers,
        body: payload,
        signal: options.signal,
      })
    } catch (error) {
      if (options.signal?.aborted) {
        throw new LlmError('request aborted by caller', 'ABORTED', { cause: error })
      }
      throw new LlmError(
        `Qwen local API request to ${this.config.baseURL} failed`,
        'TRANSPORT',
        { cause: error },
      )
    }

    if (!response.ok) {
      let message = `Qwen local API error (HTTP ${response.status})`
      let providerError: Record<string, unknown> | undefined
      try {
        const parsed = (await response.json()) as { error?: Record<string, unknown> }
        providerError = parsed.error
        if (typeof providerError?.message === 'string') message = providerError.message
      } catch {
        /* non-JSON error body */
      }
      throw new LlmError(message, httpErrorCode(response.status, providerError), {
        status: response.status,
      })
    }

    if (!response.body) {
      throw new LlmError('Qwen local API returned no response body', 'EMPTY_RESPONSE')
    }
    yield* translate(parseSse(response.body))
  }
}

/** Register the adapter for the `qwen-local` provider route on `ctx.llm`. */
export function apply(ctx: Context, config: QwenLocalPluginConfig = {}): void {
  const baseURL = config.baseURL ?? process.env.QWEN_LOCAL_BASE_URL ?? DEFAULT_BASE_URL
  const apiKey = config.apiKey ?? process.env.QWEN_LOCAL_API_KEY ?? DEFAULT_API_KEY
  const models = config.models ?? DEFAULT_MODELS
  const defaultContextWindow = config.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW
  const defaultMaxTokens = config.defaultMaxTokens ?? DEFAULT_MAX_TOKENS
  const debug = config.debug ?? false

  // Bind lazily via ctx.get(): the `ctx.attachments` property accessor requires
  // 'attachments' in the inject array (cordis throws "cannot get property ...
  // without inject" even for lazy access). dsh-llm-deepseek resolves it through
  // the explicit-lookup seam `ctx.get("attachments")` instead — mirror that.
  const readImage = (ref: ImageAttachmentRef, signal?: AbortSignal) => {
    const attachments = ctx.get('attachments') as
      | { readImage: (r: ImageAttachmentRef, s?: AbortSignal) => Promise<StoredImageAttachment> }
      | undefined
    if (!attachments) {
      throw new LlmError(
        'Qwen local image conversion requires the durable attachment service.',
        'UNSUPPORTED_CONTENT',
      )
    }
    return attachments.readImage(ref, signal)
  }

  const adapter = new QwenLocalAdapter({
    baseURL,
    apiKey,
    models,
    defaultContextWindow,
    defaultMaxTokens,
    defaultReasoningEffort: NONE_REASONING_EFFORT,
    readImage,
    debug,
  })

  ctx.llm.registerAdapter([PROVIDER], adapter)
  ctx.logger.info(
    `llm-qwen-local: registered provider route "${PROVIDER}" -> ${baseURL} (models: ${models.map((m) => m.id).join(', ')})`,
  )
}
