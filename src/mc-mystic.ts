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
 *   - mc_chant        私语念咒语（/msg 女神）→ 等信使私聊回执（快路径，程序化施法；
 *                     2026-08-18 方案A：咒语走私语，旁人只见异象听不见咒文）
 *   - mc_pray         /msg 私聊祈愿（带「祈愿：」前缀）→ 等神谕私聊回复（慢路径，LLM 裁决）
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
      '施法消耗魔力，魔力随时间自动恢复；魔力不足会施法失败。咒语以私语直达天神——只有你和女神听见，旁人只见施法异象（粒子/音效/大字）；施法结果由信使私聊告知你（成败只有你知道，留意私语）。',
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
      // 咒语以私语直达天神（2026-08-18 方案A：公屏不再施法——旁人见异象而听不见咒文）；
      // bot.whisper 走 /msg，女神侧 whisper 监听分流 → 快路径施法。
      try {
        bot.whisper(config.godName, chant)
      } catch {
        return '你的声音没能传出（连接异常）。'
      }
      // 回执由信使私聊送达（成败只有你知道；公屏点名路径已随公屏施法一并移除）。
      const reply = await waitForReply(
        bot,
        (from, msg, via) => via === 'whisper' && msg.startsWith('[信使]') && msg.includes(me),
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
      // 「祈愿：」前缀 = 显式祈愿标记（2026-08-18 方案A）：女神侧私语分流据此
      // 把祈愿和咏唱区分开——带前缀绝不按咒语结算，自然语言祈愿碰巧含法术
      // 关键词也不会被误当成咏唱。
      try {
        bot.whisper(config.godName, offer ? `祈愿：${wish}｜供奉：${offer.cn}x${offer.count}` : `祈愿：${wish}`)
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

    // ── mc_deliver：与村民耳语交割（WHISPER-TRADE 2026-08-18 刷屏治理）────
    // 交付类高频指令不占公屏：bot.whisper(Goddess, '交易：<称呼> 给<N><物品>') →
    // 世界侧 mc-god「交易：」分流 → NPC 引擎耳语收件箱 → 距离门/结算照旧 →
    // 村民 tellraw 点对点回执（本工具经 message 事件接收）。
    ctx.tools.register(defineTool({
      name: 'mc_deliver',
      description:
        '与村民当面交割委托货物——耳语交割，不扰公屏（在公屏喊交付，村民只会请你凑到耳边来）。' +
        '必须先走到该村民身边（约5格内，隔着半个广场喊只是空响）。' +
        '回执由村民点对点耳语送达（收货付酬/退单缘由），稍候勿重复交割。',
      parameters: {
        deal: {
          type: 'string',
          required: true,
          description: '交割指令「<称呼> 给<N><物品>」，如「岳山 给16煤」「石磊 给8铁锭」。称呼用村民名号（岳山/铁匠、石磊、墨白、福伯、风临、烛九、静水…）',
        },
      },
      output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
      timeoutMs: 15_000,
      execute: async (args: Record<string, unknown>) => {
        const deal = String(args.deal ?? '').trim()
        if (!deal) return '没有交割内容'
        const bot = getBot()
        if (!bot.entity) return '你尚未在此界立足，无法交割。'
        try {
          bot.whisper(config.godName, `交易：${deal}`)
        } catch {
          return '你的低语没能送达（连接异常）。'
        }
        // 等村民点对点回执：tellraw 直发本人（message 事件），文本含村民名号前缀
        const token = deal.includes(' ') ? deal.split(/\s+/)[0]! : (deal.split('给')[0] || deal)
        const ack = await waitForReply(
          bot,
          (_from, msg, via) => via === 'message' && msg.includes(token),
          8_000,
        )
        if (ack) return ack
        return '已凑到村民耳边低语交割（回执尚未传来——若还隔着远，走近些再试；勿重复交割，先清点背包余量）。'
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

  // ── 信使回执收集：mail read 会连发多行 [信使]，收齐到「已读」总结行 ──
  function collectCourierReplies(bot: Bot, timeoutMs: number): Promise<string[]> {
    return new Promise((resolve) => {
      const lines: string[] = []
      let done = false
      const onWhisper = (username: string, message: string) => {
        if (done || username !== config.godName) return
        if (!message.startsWith('[信使]')) return
        lines.push(message)
        if (message.includes('已读')) finish()
      }
      const timer = setTimeout(() => finish(), timeoutMs)
      function finish() {
        if (done) return
        done = true
        clearTimeout(timer)
        bot.removeListener('whisper', onWhisper)
        resolve(lines)
      }
      bot.on('whisper', onWhisper)
    })
  }

  // ── mc_voice：说话三档（说/喊/悄悄，经女神转达，有距离感）──────────
  ctx.tools.register(defineTool({
    name: 'mc_voice',
    description:
      '说话（日常交流首选，有距离感）。三档音量 style：say=正常说（约48格内听见，默认）；' +
      'shout=喊（约96格，隔着战场也能听见，但费嗓子——每喊一次消耗1点饱食度）；' +
      'whisper=悄悄话（只传给身边约6格的人，说秘密用）。' +
      '话由女神转达给范围内的同伴，离得远就听不见——隔着一座山说话没人理很正常。' +
      '回执会告诉你几位同伴听见了。想找不在附近或离线的人：写信（mc_mail）。' +
      '想全世界广播（重大宣告才用）：mc_chat。',
    parameters: {
      text: { type: 'string', required: true, description: '要说的话，如「这里的石头不错，我挖点带回去」' },
      style: { type: 'string', description: '音量档位：say（默认，正常说话）/ shout（喊话，96格+费饱食）/ whisper（悄悄话，6格）' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    timeoutMs: 30_000,
    execute: async (args: Record<string, unknown>) => {
      const body = String(args.text ?? '').trim()
      if (!body) return '你没有说话'
      const bot = getBot()
      if (!bot.entity) return '你尚未在此界立足，说不出话。'
      const style = String(args.style ?? 'say').toLowerCase()
      const mode = style === 'shout' ? '喊' : style === 'whisper' ? '悄悄' : '说'
      try {
        bot.whisper(config.godName, `${mode}：${body}`)
      } catch {
        return '你的声音没能传出（连接异常）。'
      }
      const reply = await waitForReply(
        bot,
        (from, msg, via) => via === 'whisper' && from === config.godName
          && (msg.startsWith('[传声]') || msg.includes('看不见你的身影')),
        config.prayTimeoutMs,
      )
      if (reply) return reply
      return `话已${mode === '喊' ? '喊出' : mode === '悄悄' ? '悄悄说出' : '说出'}（女神没有回音，附近有没有人听见无从知晓）。`
    },
  }))

  // ── mc_mail：女神信使（好友制书信，离线可达）────────────────────────
  ctx.tools.register(defineTool({
    name: 'mc_mail',
    description:
      '书信（经女神信使投递，好友之间互寄，离线也能收到——他下次上线会被提醒）。' +
      '写信前须先成为好友（mc_friend add + 对方答应）。' +
      'action：send=寄信（需 to 游戏ID + body 正文，200字内）；' +
      'read=拆读未读信件；list=看最近10封清单；clear=清空信箱。' +
      '适合：跨距离留言、给不在线的同伴捎话、正式的感谢与邀约。',
    parameters: {
      action: { type: 'string', required: true, description: 'send / read / list / clear' },
      to: { type: 'string', description: 'send 时必填：收信人游戏ID（如 Kirito / Naruto / MengMeng）' },
      body: { type: 'string', description: 'send 时必填：信的正文，200字内' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    timeoutMs: 30_000,
    execute: async (args: Record<string, unknown>) => {
      const action = String(args.action ?? '').trim().toLowerCase()
      const bot = getBot()
      if (!bot.entity) return '你尚未在此界立足。'
      let command = ''
      if (action === 'send') {
        const to = String(args.to ?? '').trim()
        const body = String(args.body ?? '').trim()
        if (!to || !body) return '寄信要写清 to（游戏ID）和 body（正文）。'
        command = `/mail send ${to} ${body}`
      } else if (action === 'read' || action === 'list' || action === 'clear') {
        command = `/mail ${action}`
      } else {
        return 'action 只支持 send / read / list / clear。'
      }
      try {
        bot.whisper(config.godName, command)
      } catch {
        return '信没能送到女神手里（连接异常）。'
      }
      if (action === 'read') {
        const lines = await collectCourierReplies(bot, config.prayTimeoutMs)
        if (lines.length === 0) return '（信使没有回应——稍后再试 /mail read。）'
        return lines.join('\n')
      }
      const reply = await waitForReply(
        bot,
        (from, msg, via) => via === 'whisper' && from === config.godName && msg.startsWith('[信使]'),
        config.prayTimeoutMs,
      )
      return reply || '（信使没有回应——稍后再试。）'
    },
  }))

  // ── mc_friend：结交好友（好友制社交，写信的前置）────────────────────
  ctx.tools.register(defineTool({
    name: 'mc_friend',
    description:
      '好友（社交的第一步，写信 mc_mail 的前置）。action：' +
      'add=请求结交（对方会收到提示，用 friend accept 答应）；' +
      'accept=答应别人的好友请求（填对方游戏ID）；' +
      'remove=解除好友；list=看好友与待答复的请求。' +
      '结为好友后即可互相写信。把一起冒险过的同伴加为好友吧。',
    parameters: {
      action: { type: 'string', required: true, description: 'add / accept / remove / list' },
      to: { type: 'string', description: 'add/accept/remove 时填对方游戏ID；list 不用' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    timeoutMs: 30_000,
    execute: async (args: Record<string, unknown>) => {
      const action = String(args.action ?? '').trim().toLowerCase()
      const bot = getBot()
      if (!bot.entity) return '你尚未在此界立足。'
      let command = ''
      if (action === 'list') {
        command = '/friend list'
      } else if (action === 'add' || action === 'accept' || action === 'remove') {
        const to = String(args.to ?? '').trim()
        if (!to) return `action=${action} 要填 to（对方游戏ID）。`
        command = `/friend ${action} ${to}`
      } else {
        return 'action 只支持 add / accept / remove / list。'
      }
      try {
        bot.whisper(config.godName, command)
      } catch {
        return '请求没能送到女神手里（连接异常）。'
      }
      const reply = await waitForReply(
        bot,
        (from, msg, via) => via === 'whisper' && from === config.godName && msg.startsWith('[信使]'),
        config.prayTimeoutMs,
      )
      return reply || '（信使没有回应——稍后再试。）'
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
