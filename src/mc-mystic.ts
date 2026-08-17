import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Bot } from 'mineflayer'
import { resolveOfferingText, sumItemCount } from './mc-offering.ts'

/**
 * mc-mystic —— 穿越者侧的神秘接口（薄层，零权限）。
 *
 * 咏唱 / 祈愿 / 降临选择，全部通过 MC 聊天文字与世界进程（天神）通信：
 *   - mc_chant        公屏喊咒语        → 等女神点名回复（快路径，程序化施法）
 *   - mc_pray         /msg 私聊祈愿     → 等神谕私聊回复（慢路径，LLM 裁决）
 *   - mc_choose_innate 公屏喊「我选 X」 → 等女神确认（降临仪式）
 *
 * 本插件不 import rcon.ts、不读魔法原子表、不执行任何服务器命令——
 * 穿越者与真人玩家走完全相同的通道（机制平权）。
 * 它同时维护穿越者对自身「出生天赋」的记忆（听见女神确认后落本地小状态文件；
 * 重启后若失忆，会自动私聊天神问回来）。
 */
export const name = 'mc-mystic'
export const inject = ['tools', 'mcbot', 'timer']

export interface Config {
  enabled: boolean
  /** 女神化身的游戏名（世界进程 mc-bot 的 username）。 */
  godName: string
  chantTimeoutMs: number
  prayTimeoutMs: number
  statePath: string
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  godName: Schema.string().default('Goddess'),
  chantTimeoutMs: Schema.number().default(10_000),
  prayTimeoutMs: Schema.number().default(8_000),
  statePath: Schema.string().default('./data/mystic-state.json'),
})

function text(value: unknown) {
  return [{ type: 'text' as const, text: String(value) }]
}

// ── 本地记忆：穿越者对自己出生天赋/等级的认知（不是世界的真相之源）──
interface MysticStateFile {
  version: 1
  players: Record<string, { innateSkill: string | null; level?: number }>
}

export interface MysticService {
  /** 穿越者记得自己的出生天赋名（本地记忆；null = 尚未知晓/失忆）。 */
  getInnate(username: string): string | null
  /** 穿越者记得自己的魔法等级（本地记忆；0 = 尚未知晓，按 1 级对待）。 */
  getLevel(username: string): number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcMystic: MysticService
  }
}

class MysticStore {
  private state: MysticStateFile = { version: 1, players: {} }
  private readonly path: string

  constructor(path: string) {
    this.path = resolve(path)
    try {
      if (existsSync(this.path)) {
        const raw = JSON.parse(readFileSync(this.path, 'utf-8'))
        if (raw && typeof raw === 'object' && raw.version === 1) this.state = raw as MysticStateFile
      }
    } catch {
      /* corrupt file — start fresh */
    }
  }

  get(username: string): string | null {
    return this.state.players[username]?.innateSkill ?? null
  }

  set(username: string, skill: string | null): void {
    this.state.players[username] = { ...this.state.players[username], innateSkill: skill }
    this.persist()
  }

  getLevel(username: string): number {
    return this.state.players[username]?.level ?? 0
  }

  setLevel(username: string, level: number): void {
    this.state.players[username] = { ...this.state.players[username], level }
    this.persist()
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const tmp = this.path + '.tmp'
      writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf-8')
      renameSync(tmp, this.path)
    } catch {
      /* best-effort persistence */
    }
  }
}

// ── 等待女神回复：临时挂 chat/whisper 监听，命中谓词即返回 ─────────────
type ReplyVia = 'chat' | 'whisper'
function waitForReply(
  bot: Bot,
  pred: (from: string, msg: string, via: ReplyVia) => boolean,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve) => {
    let done = false
    const onChat = (username: string, message: string) => {
      if (!done && pred(username, message, 'chat')) {
        done = true
        cleanup()
        resolve(message)
      }
    }
    const onWhisper = (username: string, message: string) => {
      if (!done && pred(username, message, 'whisper')) {
        done = true
        cleanup()
        resolve(message)
      }
    }
    const timer = setTimeout(() => {
      if (!done) {
        done = true
        cleanup()
        resolve('')
      }
    }, timeoutMs)
    function cleanup() {
      clearTimeout(timer)
      bot.removeListener('chat', onChat)
      bot.removeListener('whisper', onWhisper)
    }
    bot.on('chat', onChat)
    bot.on('whisper', onWhisper)
  })
}

export function apply(ctx: Context, config: Config) {
  const log = (msg: string) => console.log(`[mc-mystic] ${msg}`)
  const getBot = (): Bot => ctx.mcbot
  const store = new MysticStore(config.statePath)

  ctx.provide('mcMystic', {
    getInnate: (u) => store.get(u),
    getLevel: (u) => {
      // 路线 A（2026-08-17）：魔力层级 = MC 原生经验条等级，mineflayer 实时直读，零 RCON。
      // 在线时以 bot.experience.level 为真源；离线/未上线 fallback 本地缓存。
      const bot = getBot()
      if (bot?.entity && bot.username === u && typeof bot.experience?.level === 'number') {
        const lv = bot.experience.level
        if (store.getLevel(u) !== lv) store.setLevel(u, lv)
        return lv
      }
      return store.getLevel(u)
    },
  } satisfies MysticService)

  /** 从女神台词里解析「出生天赋「X」」模式。 */
  function parseInnate(message: string): string | null {
    const m = message.match(/出生天赋[是为]?\s*「(.+?)」/)
    return m ? m[1] : null
  }

  /** 从女神台词里解析升级宣读（兼容旧「层级提升至 N 级」与新「魔力层级 M → N」）。 */
  function parseLevelUp(message: string): number | null {
    const arrow = message.match(/魔力层级\s*\d+\s*→\s*(\d+)/)
    if (arrow) return parseInt(arrow[1], 10)
    const m = message.match(/层级提升至\s*(\d+)\s*级/)
    return m ? parseInt(m[1], 10) : null
  }

  // ── 被动记忆：听见女神点名确认天赋 / 宣读层级 → 落本地记忆 ─────────
  let watchedBot: Bot | null = null
  function ensurePassive(bot: Bot) {
    if (watchedBot === bot) return
    watchedBot = bot
    const capture = (message: string): void => {
      const innate = parseInnate(message)
      if (innate && store.get(bot.username) !== innate) {
        store.set(bot.username, innate)
        log(`innate memory captured from public chat: ${bot.username} -> ${innate}`)
      }
      const lv = parseLevelUp(message)
      if (lv && store.getLevel(bot.username) !== lv) {
        store.setLevel(bot.username, lv)
        log(`level memory captured: ${bot.username} -> Lv.${lv}`)
      }
    }
    bot.on('chat', (username: string, message: string) => {
      if (username !== config.godName) return
      if (!message.includes(bot.username)) return
      capture(message)
    })
    bot.on('whisper', (username: string, message: string) => {
      if (username !== config.godName) return
      capture(message)
    })
  }

  // ── 失忆找回：本地无天赋记忆时，定期私聊天神询问 ─────────────────────
  let disposed = false
  let stopEnsure: (() => void) | null = null
  let lastQuery = 0
  function scheduleEnsure() {
    if (disposed) return
    stopEnsure = ctx.setTimeout(() => {
      const bot = getBot()
      if (bot) {
        ensurePassive(bot)
        const me = bot.username
        if (bot.entity && me && !store.get(me) && Date.now() - lastQuery > 60_000) {
          lastQuery = Date.now()
          try {
            bot.whisper(config.godName, '女神，我的出生天赋是什么？')
            log(`asked the goddess for innate memory (${me})`)
          } catch {
            /* bot not ready */
          }
        }
      }
      scheduleEnsure()
    }, 10_000)
  }
  scheduleEnsure()

  // ── mc_chant：公屏咏唱（快路径）──────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'mc_chant',
    description:
      '咏唱魔法咒语来施法。用中二的口吻喊出咒语，必须包含法术关键词。每个法术有等级门槛（标注在括号内，如"2级"）——等级不足会被女神拒绝（你的出生天赋除外，它无视等级）。施法成功可获得经验，攒够自动提升魔力层级、解锁更高级法术。当前已知的法术清单：\n' +
      '【1级】照明(火把)、跃升(大跳)、风爆(气浪，把自己炸上天)、羽落(缓降)、夜视(猫眼)、化水(清泉)\n' +
      '【2级】归乡(回家，需先睡床设重生点)、传送(可带距离方向，如"传送十格东")、造物(变出物资，如"造物赐我熔炉/木头/铁镐")、饱食(充饥)、迅捷(加速)、水息(鱼鳃/水下呼吸)、覆土(填壑，脚下垫土)\n' +
      '【3级】圣愈(治愈/回血)、再生(愈合)、急迫(巧手/挖快)、避火(火抗)、唤雨(降雨)、大地塑形(挖地)\n' +
      '【4级】铁肤(护体)、神力(力量)、驱云(放晴)\n' +
      '【5级】隐身(无形)、雷暴(风暴)、唤马(战马，耗饱食度)\n' +
      '【6级】退魔(驱邪，清剿周围邪祟，耗生命)、铁卫(守护者，耗生命)\n' +
      '【7级】破晓(天亮)、陨石(天雷，耗生命)。\n' +
      '施法消耗魔力，魔力随时间自动恢复；魔力不足会施法失败。咒语会被全世界听见。',
    parameters: {
      chant: {
        type: 'string',
        required: true,
        description: '你的咏唱咒语，必须包含法术关键词，如「撕裂虚空，传送十格」或「破晓吧，驱散黑夜」。带方向时一次只说一个方向（如"传送五格南"），不要组合两个方向',
      },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    timeoutMs: 60_000,
    execute: async (args: Record<string, unknown>) => {
      const chant = String(args.chant ?? '').trim()
      if (!chant) return '你没有咏唱任何咒语'
      const bot = getBot()
      if (!bot.entity) return '你尚未在此界立足，无法咏唱。'
      const me = bot.username
      // 喊出来（bot.chat 不触发自身 chat 事件）；女神听见后会点名回复。
      try {
        bot.chat(chant)
      } catch {
        return '你的声音没能传出（连接异常）。'
      }
      const reply = await waitForReply(
        bot,
        (from, msg, via) => via === 'chat' && from === config.godName && msg.includes(me),
        config.chantTimeoutMs,
      )
      if (!reply) return '（世界静默——天神似乎没有听见你的咒语，或咒语里没有她们认识的法术关键词。）'
      return reply
    },
  }))

  // ── mc_pray：私聊祈愿（慢路径，入女神收件箱异步处理，可能被拒绝）──
  ctx.tools.register(defineTool({
    name: 'mc_pray',
    description:
      '向天神（女神）默默祈愿。两层用法：' +
      '①【已学会的技能】不要祈愿——自己用 mc_chant 咏唱瞬发即可，女神只会计较你的魔力够不够；' +
      '②【还没学会的技能/法则之外的恩典】才值得祈愿：如「请施展神力送我回家」「我快饿死了，求赐食物」「求女神破晓驱散黑夜」。' +
      '女神握有全部技艺，会视情形裁量：可能代施、可能拒绝、可能提条件。' +
      '神恩不轻授：祈愿时宜献上供奉（见 offering 参数）——供品从你的行囊消失、归入神库，女神按供品贵贱与你的供奉历史掂量虔诚度，再决定帮不帮、帮多少。' +
      '祈愿会进入女神的收件箱按序处理——本工具立即返回「已上达天听」，神谕稍后以女神私聊送达（留心之后的私语，勿重复祈愿、勿枯等）。' +
      '只在真正需要时才祈愿，不要滥用。',
    parameters: {
      wish: { type: 'string', required: true, description: '你向天神祈愿的内容，用自然语言，如「伟大的女神，我尚未学会传送之术，请施展神力送我向东十格」或「我受了重伤，请治愈我」' },
      offering: {
        type: 'string',
        // dsh schema：可选参数省略 required（出现则必须为 true）
        description: '供奉物品与数量，写法如「面包x3」「金锭x2」「钻石x1」。供什么由你决定：小小心愿带口粮即可，大恩典宜献贵重之物（钻石/绿宝石/金锭/附魔书/末影珍珠等）——她会记得你每一次的诚意。可识别：面包/熟牛肉/烤猪排/烤鸡/金胡萝卜/金苹果/蛋糕/南瓜派/苹果/甜浆果/煤/木炭/铁锭/铜锭/金锭/圆石/木头/纸/书/钻石/绿宝石/红石/青金石/石英/萤石粉/紫水晶/末影珍珠/烈焰棒/恶魂之泪/附魔书。省略则空手祈愿（女神可能不理）',
      },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    timeoutMs: 30_000,
    execute: async (args: Record<string, unknown>) => {
      const wish = String(args.wish ?? '').trim()
      if (!wish) return '没有祈愿内容'
      const bot = getBot()
      if (!bot.entity) return '你尚未在此界立足，无法祈愿。'
      // 供奉自检：名目可辨 + 行囊里有货（世界侧还会权威复核再收执）。
      const offeringText = String(args.offering ?? '').trim()
      let offer = null as ReturnType<typeof resolveOfferingText>
      if (offeringText) {
        offer = resolveOfferingText(offeringText)
        if (!offer) {
          return `你想供奉「${offeringText}」，但这名目太模糊。用「物品x数量」的写法（如「面包x3」「金锭x2」），且须是女神识得的东西（面包/熟牛肉/煤/铁锭/金锭/钻石/绿宝石/附魔书…）。`
        }
        const have = sumItemCount(bot.inventory.items(), offer.id)
        if (have < offer.count) {
          return `你想供奉 ${offer.cn}×${offer.count}，但行囊里只有 ${have} 个——先去收集，或换一种供品，或空手祈愿。`
        }
      }
      try {
        bot.whisper(config.godName, offer ? `${wish}｜供奉：${offer.cn}x${offer.count}` : wish)
      } catch {
        return '你的祈愿没能送达（连接异常）。'
      }
      // 只等「已上达天听」的入场回执（程序秒回）；神谕本身异步送达，
      // 会在之后的私语里出现——决策循环的聊天上下文能听见。
      const ack = await waitForReply(
        bot,
        (from, msg, via) => via === 'whisper' && from === config.godName && msg.includes('上达天听'),
        config.prayTimeoutMs,
      )
      if (ack) return ack
      return '祈愿已低声诵出（女神的回执尚未传来——也许神力繁忙，稍后留意私语）。'
    },
  }))

  // ── mc_choose_innate：降临仪式选天赋（公屏宣布）─────────────────────
  ctx.tools.register(defineTool({
    name: 'mc_choose_innate',
    description:
      '降临仪式：你刚穿越至此界，女神赐你自选一项「出生天赋」（初始技能）。' +
      '女神会在公屏宣读候选法术清单（格式如「1. 归乡 —— 回家」），' +
      '调用本工具公屏宣布你的选择。参数 skill 填要选的法术名或编号（如「归乡」或「选1」），' +
      '选一个最契合你人设/处境的（求生者选归乡/圣愈/饱食，好战者选传送/陨石等）。',
    parameters: {
      skill: {
        type: 'string',
        required: true,
        description: '要选的法术名或编号，如「归乡」「圣愈」「选1」',
      },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    timeoutMs: 60_000,
    execute: async (args: Record<string, unknown>) => {
      const bot = getBot()
      if (!bot.entity) return '你尚未在此界立足。'
      const me = bot.username
      if (store.get(me)) return '你早已选定出生天赋，无需再次降临。'
      const skill = String(args.skill ?? '').trim()
      if (!skill) return '你没有说出要选什么。'
      // 公屏宣布（与真人玩家喊「我选X」完全同通道，女神侧同一解析器）。
      try {
        bot.chat(`我选 ${skill}`)
      } catch {
        return '你的声音没能传出（连接异常）。'
      }
      const reply = await waitForReply(
        bot,
        (from, msg, via) => via === 'chat' && from === config.godName && msg.includes(me) && !!parseInnate(msg),
        config.chantTimeoutMs,
      )
      if (!reply) {
        return '女神没有回应你的选择——也许降临仪式尚未开始（等女神宣读候选清单），或你的说法她没听懂（用法术名如「归乡」或编号如「选1」）。'
      }
      return reply
    },
  }))

  ctx.effect(() => () => {
    disposed = true
    if (stopEnsure) stopEnsure()
    log('mystic disposed')
  })

  if (config.enabled) {
    log(`mystic interface armed (goddess="${config.godName}", chat-only, zero privileges)`)
  }
}
