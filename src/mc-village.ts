import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { WorldAdapter as Bot } from './world-adapter'

/**
 * mc-village —— 穿越者侧村庄感知（2026-08-20 重构：零服务器数据）。
 *
 * 设计原则（客户端 = 单纯的机器人，2026-08-20 用户定调）：
 * 客户端不读任何服务器运行状态/台账文件——服务器的运行状态、历史背景
 * 信息在客户端【没有】。世界的一切信息（村庄、居民、委托、历史、规则）
 * 都只能在玩游戏的过程中，通过与游戏内的互动与对话获得：NPC 的台词、
 * 女神的私聊解释。这条「费劲」的求知路是设计本身，不是缺陷。
 *
 * 本插件只保留两条纯游戏内渠道：
 * 1.【听见】mc_npc.py 的台词走 tellraw（system chat），mineflayer 只在
 *   'message' 事件里给，而 mc-loop 只听 'chat' —— 本插件监听 'message'，
 *   解析「<铁匠·岳山> 」「[女神] 」前缀，缓存成 NPC/神谕话语，由 mc-loop
 *   每步 drain 进观察。
 * 2.【看见】扫 bot.entities 里的村民实体（与真人玩家客户端所见等价的
 *   原版感知）：只报数量与最近距离。想知道村民是谁、有什么委托——
 *   靠近打招呼，或向 NPC / 女神提问（游戏内聊天渠道）。
 *
 * （2026-08-18 旧版曾直读共享卷 /app/data/village/ 的 villagers.json /
 * quests-*.json——该通道已按上述原则移除。）
 *
 * 交互零新工具（全走公屏/私聊，真人与 AI 平权）：
 *   聊天：公屏喊 NPC 的称呼（如「岳山 你好」）→ NPC 回应
 *   提问：耳语问女神（mc_pray 中像提问的内容走女神快速答疑通道）
 *   交付：耳语「mc_deliver 岳山 给20铁锭」→ NPC 引擎 inbox → 绿宝石/情报
 *   追问：「有什么任务/委托」→ NPC 报今日委托详情
 */
export const name = 'mc-village'

export const inject = ['mcbot', 'timer']

export interface Config {
  nearbyRadius: number
  maxMsgBuffer: number
}

export const Config: Schema<Config> = Schema.object({
  nearbyRadius: Schema.number().default(28).description('村民实体视为「附近」的距离（格）'),
  maxMsgBuffer: Schema.number().default(24).description('NPC 话语缓冲上限'),
})

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

  // ---------- 附近村民（原版实体感知，零服务器数据）----------
  function nearbyLines(pos: { x: number; y: number; z: number }): string {
    const bot = getBot()
    const entities = (bot as unknown as { entities?: Record<number, unknown> } | null)?.entities
    if (!entities) return ''
    let n = 0
    let nearest = Number.POSITIVE_INFINITY
    for (const e of Object.values(entities)) {
      const ent = e as { name?: string; displayName?: string; position?: { x: number; y: number; z: number } }
      const isVillager = ent.name === 'villager' || (ent.displayName ?? '').toLowerCase().includes('villager')
      if (!isVillager || !ent.position) continue
      const dx = pos.x - ent.position.x
      const dy = pos.y - ent.position.y
      const dz = pos.z - ent.position.z
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (dist > config.nearbyRadius) continue
      n++
      if (dist < nearest) nearest = dist
    }
    if (!n) return ''
    return `附近有村民 ×${n}，最近 @${Math.round(nearest)}m——他们是谁、有什么委托，凑近打招呼或问女神便知`
  }

  /** 面板/调试用：附近感知 + 近期听到的 NPC 话语（不再有服务器台账快照） */
  function snapshot() {
    const bot = getBot()
    const p = bot?.entity?.position
    return {
      nearby: p ? nearbyLines(p) : '',
      recentWords: npcMsgs.slice(-8).map((m) => `[${m.who}] ${m.text}`),
      note: '客户端零服务器数据：村庄/委托/历史信息一律经游戏内聊天渠道获得',
    }
  }

  ctx.provide('mcVillage', { nearbyLines, drainMessages, snapshot })

  ctx.setInterval(() => {
    const bot = getBot()
    if (bot) ensureMessageListener(bot)
  }, 2000)
  log('up: entity perception + tellraw perception armed (zero server-side data)')
}
