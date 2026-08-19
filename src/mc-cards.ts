// mc-cards.ts — 渐进式披露卡片系统（progressive disclosure prompt cards）
//
// 背景：system prompt 里的大块说明文字（魔法/集市/书信/睡觉…共约 1600 token）每步
// 都注入，但多数时刻与当前处境无关，既稀释注意力又浪费前缀缓存。此模块把这些
// 大块拆成「卡」：常驻部分只剩一行索引（在 mc-loop.ts 的静态区），完整说明只在
// 触发条件命中（或命中后 N 步内）时注入 system 尾部（动态区，不打碎稳定前缀）。
//
// 触发信号全部来自 perceive() 生成的 status 面板 + loop 的失败计数，零额外感知成本。
// 披露状态是进程内存态（每容器一个 bot，无需持久化；重启后自然重新评估）。

export interface CardCtx {
  /** perceive() 生成的完整状态面板文本（触发器用正则解析它） */
  status: string
  health: number // 0-20
  food: number // 0-20
  isNight: boolean
  stuck: boolean // 连续失败 >= 3（与 mc-loop 的 stuckHint 同阈值）
}

export interface PromptCard {
  id: string
  /** 触发条件命中（或 sticky 步内）时注入的完整说明 */
  body: string
  trigger: (c: CardCtx) => boolean
  /** 命中后即使条件消失也再保持的步数；0 = 纯状态驱动，条件消失立即撤下 */
  sticky?: number
}

// ---- status 面板解析助手 ----
const hasNpcNearby = (s: string) => !s.includes('village NPCs nearby: (none)')
const freshPlayerChat = (s: string) => !s.includes('new chat from players: (none)')
const innateMissing = (s: string) => s.includes('未选定')
/** 女神/信使的施法反馈会出现在 NPC/goddess words 里 */
const magicFeedback = (s: string) => /魔力不足|施法失败|女神拒绝|施法成功|燃血|炼食/.test(s)
const hasWritingKit = (s: string) => /paper|writable_book|book |mail|信纸/.test(s)

export const CARDS: PromptCard[] = [
  {
    id: 'magic',
    sticky: 4,
    trigger: (c) => c.health <= 8 || c.food <= 6 || c.stuck || magicFeedback(c.status),
    body:
      '【咏唱魔法细则】用 mc_chant 咏唱施法：中二、虔诚地喊出咒语，咒语里必须带法术关键词（如「撕裂虚空，传送十格」「破晓吧，驱散黑夜」）。法术清单与等级门槛见 mc_chant 工具说明；出生天赋无视等级门槛。魔力随时间自动恢复（约每秒 2%），不足时施法失败，等一会儿再试；「大地塑形」额外耗饱食度，残血别用「陨石」。魔力见底又必须立刻施法的保命奇招：咏唱「燃血」（燃 6 点生命换 15 魔力，Lv.5 解锁）或「炼食」（耗 8 点饱食度换 6 魔力，Lv.2 解锁）——汇率必亏，只作保命用，不作日常补魔。想了解自己的能力值与已解锁秘法，咏唱「鉴定」。咏唱要克制：只在真正需要时施法（迷路归乡、重伤圣愈、饿极饱食、怕黑破晓、被围杀传送），能双手解决的绝不劳烦女神。',
  },
  {
    id: 'market',
    sticky: 6,
    trigger: (c) => hasNpcNearby(c.status) || /绿宝石|集市|委托/.test(c.status),
    body:
      '【集市与村民】状态面板 village NPCs nearby 列出的（如铁匠·岳山、书商·墨白、货郎·福伯）是集市村民 NPC，头顶挂着今日委托——不是怪物，绝不攻击。跟他们说话：公屏喊称呼+内容（如「岳山，你好」「墨白 有什么任务」），他们听得懂中文，回应出现在 NPC/goddess words。接委托：问「有什么任务/委托」，他告诉你想收什么货、给多少绿宝石；攒齐货走到他身边 5 格内用 mc_deliver 耳语交付（公屏喊交付他只会请你凑近低语）。绿宝石是硬通货，有的村民还会泄露法术咒语情报作额外酬谢。给真人玩家/穿越者递物：两人走到 5 格内，mc_deliver 说「通宝 @对方名字 给2煤」——广场掌柜·通宝（总柜台）公证交割，当面两清，对价自己谈。交付前先清点背包，数量不够会被退回；委托每天刷新，先到先得。通宝的柜台挂着全村当日委托；不熟悉行话的真人可右键他走原版柜台，你是穿越者，走耳语更体面。',
  },
  {
    id: 'letters',
    sticky: 4,
    trigger: (c) => freshPlayerChat(c.status) || hasWritingKit(c.status),
    body:
      '【说话与书信】日常交流用 mc_voice，说话有距离感：正常说约 48 格内听见，喊（shout）约 96 格但每次费 1 点饱食度，悄悄话（whisper）只传身边约 6 格；隔得远听不见，回执会告诉你谁听见了。mc_chat 是全服大喇叭（重大宣告才用）；填 to 参数则变成不限距离的私语直达。书信：mc_mail 寄信（好友之间、离线可达——对方下次上线收到提醒），适合给不在身边的同伴留言、捎话、正式致谢。好友是写信前置：mc_friend add 结交 → 对方 mc_friend accept 答应 → 互寄书信。把一起冒险过的同伴加为好友吧。',
  },
  {
    id: 'sleep',
    sticky: 10,
    trigger: (c) => c.isNight,
    body:
      '【夜晚策略】天黑后（time: NIGHT）危险，尽快回基地找床睡觉（mc_sleep 工具），一觉睡到天亮，安全又省事。附近没床（bed within 48m: no）且背包里有床，可先用 mc_place 放一张；实在找不到床：躲进基地别乱跑，或 mc_chant 咏唱「破晓」把黑夜变白天。',
  },
  {
    id: 'innate',
    sticky: 0,
    trigger: (c) => innateMissing(c.status),
    body:
      '【降临仪式】你刚穿越降临此界，要做的第一件事：状态面板 innate skill 显示「未选定」时，立刻用 mc_choose_innate 工具从候选法术里选一项作为出生天赋（求生者选归乡/圣愈/饱食，好战者选传送/陨石等，选最契合人设与处境的），选定之后才开始求生、采集、探索。选定后降临即告完成，不必反复选择。',
  },
  {
    id: 'eyes',
    sticky: 3,
    trigger: (c) => c.stuck,
    body:
      '【用眼睛】mc_look：文字雷达，一瞬扫清四周——头顶有没有出口、眼前是什么方块、哪里有水/岩浆、附近有什么实体。mc_see：睁开眼看到真实的第一人称画面（多张=原地环视全景）。进陌生地形、迷路、怀疑卡住、文字信息不够时先用眼睛；两者都不耗任何资源。看不见就等于瞎走。看清之后若确认被困（坑底/被围/寻路反复失败）：用 mc_tunnel 朝开阔方向挖平直逃生通道——不依赖跳跃、确定有进展。',
  },
]

// ---- 披露状态机 ----
const disclosed = new Map<string, number>()
let lastKey: string | null = null

/**
 * 每步调用：评估所有卡的触发条件，维护 sticky 计数，返回应注入 system 尾部的
 * 卡片文本（无卡命中时返回 ''）。披露集合变化时通过 log 记一行，便于观察。
 */
export function buildCardsBlock(ctx: CardCtx, log?: (s: string) => void): string {
  const on: PromptCard[] = []
  for (const card of CARDS) {
    const hit = card.trigger(ctx)
    const remain = hit ? (card.sticky ?? 3) : Math.max(0, (disclosed.get(card.id) ?? 0) - 1)
    if (hit || remain > 0) {
      disclosed.set(card.id, remain)
      on.push(card)
    } else if (disclosed.has(card.id)) {
      disclosed.delete(card.id)
    }
  }
  const key = on.map((c) => c.id).join(',')
  if (key !== lastKey) {
    lastKey = key
    log?.(`[mc-cards] disclosed: ${key || '(none)'}`)
  }
  return on.length ? ['', '—— 以下提示只在此刻适用 ——', ...on.map((c) => c.body)].join('\n') : ''
}

/**
 * 当前正注入 system 尾部的卡片 id 快照（含 sticky 余量中的卡）。
 * mc-loop 写 status 快照时带上，供观察面板展示"此刻上下文里有哪些提示"。
 */
export function disclosedNow(): Array<{ id: string; remain: number }> {
  return [...disclosed.entries()].map(([id, remain]) => ({ id, remain }))
}
