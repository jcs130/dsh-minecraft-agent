import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Bot } from 'mineflayer'

/**
 * mc-village —— 穿越者侧村庄感知（2026-08-18，零 RCON）。
 *
 * 「作为玩家的 Agent 也应该看得到这些信息并且交互」——本插件补齐两个缺口：
 *
 * 1.【听见 NPC】mc_npc.py 的台词走 tellraw（system chat），mineflayer 只在
 *   'message' 事件里给，而 mc-loop 只听 'chat' —— NPC 说话 bot 原本根本
 *   收不到。本插件监听 'message'，解析「<铁匠·岳山> 」「[女神] 」前缀，
 *   缓存成 NPC/神谕话语，由 mc-loop 每步 drain 进观察。
 * 2.【看见村庄】读共享卷 /app/data/village/（villagers.json + quests-<day>.json，
 *   与世界进程同源），把「附近 NPC + 头顶委托状态 + 怎么交互」注入观察，
 *   bot 就能主动找 NPC 聊天、接委托、攒货交付。
 *
 * 交互零新工具（全走公屏，真人与 AI 平权）：
 *   聊天：公屏喊 NPC 的称呼（如「岳山 你好」）→ NPC 回应
 *   交付：公屏「岳山 给20铁锭」→ /clear 收货 → 绿宝石/祝福/咒语情报
 *   追问：「有什么任务/委托」→ NPC 报今日委托详情
 */
export const name = 'mc-village'

export const inject = ['mcbot', 'timer']

export interface Config {
  dataDir: string
  nearbyRadius: number
  cacheTtlMs: number
  maxMsgBuffer: number
}

export const Config: Schema<Config> = Schema.object({
  dataDir: Schema.string().default('./data').description('共享世界数据卷（与世界进程同源）'),
  nearbyRadius: Schema.number().default(28).description('NPC 视为「附近」的距离（格）'),
  cacheTtlMs: Schema.number().default(30000).description('村庄文件缓存 TTL'),
  maxMsgBuffer: Schema.number().default(24).description('NPC 话语缓冲上限'),
})

interface Villager {
  key: string
  tag: string
  display: string
  calls?: string[]
  spawn?: [number, number, number]
  persona?: string
  topics?: Array<{ kw: string[] }>
}

interface Quest {
  villager: string
  zh?: string
  count?: number
  emerald?: number
  done?: boolean
  done_by?: string
}

/** 从 mineflayer message 组件（对象/数组/字符串）递归提取纯文本 */
function flattenText(node: unknown): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(flattenText).join('')
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>
    let out = ''
    if (typeof o.text === 'string') out += o.text
    if (Array.isArray(o.extra)) out += o.extra.map(flattenText).join('')
    return out
  }
  return ''
}

export function apply(ctx: Context, config: Config) {
  const log = (msg: string) => console.log(`[mc-village] ${msg}`)
  const getBot = (): Bot | null => (ctx.mcbot as Bot | undefined) ?? null

  const villageDir = resolve(config.dataDir, 'village')

  let villagers: Villager[] = []
  let quests: Quest[] = []
  let cacheAt = 0

  function refresh() {
    if (Date.now() - cacheAt < config.cacheTtlMs) return
    cacheAt = Date.now()
    try {
      const raw = JSON.parse(readFileSync(resolve(villageDir, 'villagers.json'), 'utf-8'))
      const list = Array.isArray(raw) ? raw : raw?.villagers
      villagers = Array.isArray(list) ? list : []
    } catch {
      villagers = []
    }
    try {
      const d = new Date()
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const p = resolve(villageDir, `quests-${day}.json`)
      if (existsSync(p)) {
        const raw = JSON.parse(readFileSync(p, 'utf-8'))
        quests = Array.isArray(raw?.quests) ? raw.quests : []
      } else {
        quests = []
      }
    } catch {
      quests = []
    }
  }

  // ---------- NPC / 女神 tellraw → 话语缓冲 ----------
  const npcMsgs: Array<{ who: string; text: string; ts: number }> = []
  let watchedBot: Bot | null = null
  function ensureMessageListener(bot: Bot) {
    if (watchedBot === bot) return
    watchedBot = bot
    bot.on('message', (jsonMsg: unknown) => {
      const text = flattenText(jsonMsg).trim()
      if (!text) return
      // NPC 台词形如「<铁匠·岳山> 台词」，神谕形如「[女神] …」，信使「[信使] …」
      const npcMatch = text.match(/^<([^>]{1,24})>\s*(.+)$/)
      const sysMatch = text.match(/^\[(女神|信使)\]\s*(.+)$/)
      const who = npcMatch ? npcMatch[1] : sysMatch ? sysMatch[1] : null
      if (!who) return
      const body = npcMatch ? npcMatch[2] : sysMatch![2]
      npcMsgs.push({ who, text: body, ts: Date.now() })
      if (npcMsgs.length > config.maxMsgBuffer) npcMsgs.splice(0, npcMsgs.length - config.maxMsgBuffer)
    })
    log('message listener armed (NPC/goddess tellraw → perception)')
  }

  /** mc-loop 每步调用：取走还没进过观察的 NPC/神谕话语 */
  function drainMessages(): string {
    if (npcMsgs.length === 0) return ''
    const out = npcMsgs.map((m) => `[${m.who}] ${m.text}`).join('\n')
    npcMsgs.length = 0
    return out
  }

  // ---------- 附近 NPC + 委托状态 → 感知行 ----------
  function nearbyLines(pos: { x: number; y: number; z: number }): string {
    refresh()
    const out: string[] = []
    for (const v of villagers) {
      if (!v.spawn) continue
      const dx = pos.x - v.spawn[0]
      const dy = pos.y - v.spawn[1]
      const dz = pos.z - v.spawn[2]
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (dist > config.nearbyRadius) continue
      const q = quests.find((x) => x.villager === v.key)
      const qs = !q
        ? '今日无委托'
        : q.done
          ? `委托已完成`
          : `委托：${q.zh ?? ''}×${q.count ?? '?'} → ${q.emerald ?? 0}绿宝石`
      out.push(`${v.display} @${Math.round(dist)}m（${qs}）`)
    }
    return out.join('; ')
  }

  /** 面板/调试用：全部村庄状态快照 */
  function snapshot() {
    refresh()
    return {
      npcs: villagers.map((v) => {
        const q = quests.find((x) => x.villager === v.key)
        return {
          key: v.key,
          display: v.display,
          spawn: v.spawn,
          quest: q ? { zh: q.zh, count: q.count, emerald: q.emerald, done: q.done, doneBy: q.done_by } : null,
        }
      }),
    }
  }

  ctx.provide('mcVillage', { nearbyLines, drainMessages, snapshot })

  ctx.setInterval(() => {
    const bot = getBot()
    if (bot) ensureMessageListener(bot)
  }, 2000)
  log('up: villagers+quests polled from shared volume, tellraw → perception armed')
}
