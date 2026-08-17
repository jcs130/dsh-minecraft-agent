/**
 * mc-identity —— 穿越者的身份之锚与前世记忆种子。
 *
 * 解决的问题（2026-08-17 用户需求）：穿越者档案里的 backstory（前世故事）
 * 此前只躺在 registry 里，没有任何消费者——bot 跑久了，决策上下文与记忆
 * 全是挖矿砍树的今生经历，「我是谁」被逐渐稀释，忘了自己的来历。
 *
 * 双层防线（身份不能只靠检索——检索词不命中身份就断片）：
 *
 *  1. 身份锚常驻：anchor(username) 把 persona + backstory 拼成身份材料，
 *     mc-loop 每一步都注入 system prompt 首段——无论经历多少岁月，
 *     「我是谁」永远在场。档案短（数百字）全文常驻无压力，不蒸馏。
 *
 *  2. 前世记忆种子：启动时把 backstory 切片写入 MemOS 个人记忆池
 *     （user_id=mc-<username>，与今生经历同池）——mc_recall 检索
 *     「我的前世/我为什么来到这个世界」可召回细节；decide() 每步的
 *     语义检索也可能自然召回相关前世片段（如执念、故人）参与决策。
 *
 * 幂等：seed 状态按 backstory 内容 hash 记录（data/identity-seed.json），
 * 档案未变不重灌；档案修改后重启自动重灌新版（旧片留在池中不影响，
 * 语义检索会把新片排前；memoryIds 已留存备将来清理）。
 *
 * 铁律：MemOS 不可用不炸 bot——seed 失败仅记日志，身份锚照常工作
 * （锚不依赖 MemOS）；下次进程重启自动重试。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export const name = 'mc-identity'
export const inject = ['mcTransmigrators', 'mcMemos']

export interface Config {
  /** seed 状态文件（幂等标记：hash 命中则跳过）。 */
  seedStatePath: string
  /** 单片前世记忆最大字符数，超长段落再按句切分。 */
  maxChunkChars: number
  /** 切片间写入间隔（ms），温柔对待 MemOS。 */
  seedIntervalMs: number
}

export const Config: Schema<Config> = Schema.object({
  seedStatePath: Schema.string().default('./data/identity-seed.json'),
  maxChunkChars: Schema.number().default(400),
  seedIntervalMs: Schema.number().default(300),
})

export interface IdentityService {
  /** 身份锚：persona + 前世故事全文（注入 system prompt 首段）。无档案返回 ''。 */
  anchor(username: string): string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcIdentity: IdentityService
  }
}

/** 纯函数：把故事文本切成记忆片段。先按空行分段，超长段再按句号二分。 */
export function chunkStory(text: string, maxChars: number): string[] {
  const chunks: string[] = []
  const paras = text.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
  for (const para of paras) {
    if (para.length <= maxChars) {
      chunks.push(para)
      continue
    }
    // 超长段按句号切，尽量贴近 maxChars 而不撕碎句子。
    let buf = ''
    for (const part of para.split(/(?<=[。！？!?…])/)) {
      if (buf && buf.length + part.length > maxChars) {
        chunks.push(buf)
        buf = part
      } else {
        buf += part
      }
    }
    if (buf) chunks.push(buf)
  }
  return chunks
}

interface SeedState {
  [transmigratorId: string]: {
    hash: string
    count: number
    at: string
    memoryIds?: string[]
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex')
}

export function apply(ctx: Context, config: Config) {
  const log = (msg: string) => console.log(`[mc-identity] ${msg}`)
  const statePath = resolve(config.seedStatePath)

  const service: IdentityService = {
    anchor(username: string): string {
      const t = ctx.mcTransmigrators.getByUsername(username)
      if (!t) return ''
      const parts: string[] = []
      if (t.persona.trim()) parts.push(t.persona.trim())
      if (t.backstory.trim()) {
        parts.push(
          [
            `你的前世（身份之锚——无论在这个世界经历多少岁月，这都是你之所以是你的凭据，永不忘却）：`,
            t.backstory.trim(),
          ].join('\n'),
        )
      }
      return parts.join('\n\n')
    },
  }
  ctx.provide('mcIdentity', service)

  // ── 前世记忆种子（fire-and-forget，不阻塞启动，失败留待下次重启重试）──
  async function seedAll(): Promise<void> {
    let state: SeedState = {}
    try {
      if (existsSync(statePath)) state = JSON.parse(readFileSync(statePath, 'utf-8')) as SeedState
    } catch {
      state = {}
    }
    for (const t of ctx.mcTransmigrators.list()) {
      try {
        if (!t.backstory.trim()) continue
        const hash = sha256(t.backstory)
        const prev = state[t.id]
        if (prev && prev.hash === hash && prev.count > 0) continue // 已灌且未变
        const chunks = chunkStory(t.backstory, config.maxChunkChars)
        const memoryIds: string[] = []
        let failed = 0
        for (let i = 0; i < chunks.length; i++) {
          const id = await ctx.mcMemos.remember(
            t.username,
            `前世记忆·${i + 1}/${chunks.length}：${chunks[i]}`,
          )
          if (id === null) failed++
          else if (id !== 'ok') memoryIds.push(id)
          if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, config.seedIntervalMs))
        }
        if (failed > 0) {
          // 半灌状态：不写成功标记，下次重启整体重试（个别片可能重复入库，
          // 语义检索容忍冗余；正确性优先于绝对不重复）。
          log(`seed partially failed for "${t.name}" (${failed}/${chunks.length} chunks lost) — will retry on next boot`)
          continue
        }
        state[t.id] = { hash, count: chunks.length, at: new Date().toISOString(), memoryIds }
        saveState(state)
        log(`seeded ${chunks.length} past-life memory chunk(s) for "${t.name}"(${t.username}) into MemOS`)
      } catch (err) {
        // MemOS 挂了：身份锚不受影响，下次重启重试。
        log(`seed failed for "${t.name}" (${err instanceof Error ? err.message : String(err)}) — will retry on next boot`)
      }
    }
  }

  function saveState(state: SeedState): void {
    try {
      mkdirSync(dirname(statePath), { recursive: true })
      const tmp = statePath + '.tmp'
      writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8')
      renameSync(tmp, statePath)
    } catch (err) {
      log(`seed state write failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // anchor 服务立即可用（纯内存拼接）；MemOS 种子异步补上。
  log(`identity service ready (anchor=persona+backstory; seeding past-life memories to MemOS in background)`)
  void seedAll()
}
