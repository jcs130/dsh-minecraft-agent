import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { McStoreService } from './mc-store'

/**
 * mc-spellbook —— 穿越者侧「自主学习法术书」（客户端零权限，纯只读词表 + 反馈学习）。
 *
 * 解决的问题（2026-08-22 用户拍板"开始吧，需要有自主学习能力"）：爱德华吟吟诵法时
 * 造词（如把「圣愈」编成「回春」）→ 女神不认识 → 施法失败。根因=法术的「标准词+等级门」
 * 没有作为可靠知识常驻 prompt，模型只能靠猜。
 *
 * 本品做三件事：
 *   1. 种子词表：一次性把大典（magic-atoms.json）的 name/words/requiredLevel 抄成
 *      内置常量（无 id、无命令、无费用、无世界文件实时读取——严守客户端解耦铁律）。
 *      这就是"魔法书上写的法术"，爱德华照抄标准词即可命中女神。
 *   2. 反馈学习：咏唱成功 → seal（确认掌握）；失败 → 记录失败原因（等级不及 / 词不认识）；
 *      升层级 → 自动解锁该层法术；女神明确赐予的新法术 → 登记为 granted。
 *      ——这是"自主学习"：状态随时序进账本，不靠人喂。
 *   3. 自我修正 + 能力复盘：发唱前对关键词做防呆（把造词改写成标准词，纯造词则拦截提示）；
 *      提供 mc_reflect_skills 工具让穿越者定期"总结我掌握的能力"。
 *
 * 数据：经 mc-store 的 spellbook 表（与 mc-progress 的 progress 表隔离）持久化，
 * 键 = 穿越者（bot.username），值为 { version, level, innate, skills: { [seedId]: {...} } }。
 */

export const name = 'mc-spellbook'
export const inject: string[] = ['mcStore']

export interface Config {
  dataDir: string
  maxPromptSpells: number
}

export const Config: Schema<Config> = Schema.object({
  dataDir: Schema.string().default('./data'),
  maxPromptSpells: Schema.number().default(40),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcSpellbook: {
      /** 注入 agent 上下文的「已掌握/可咏唱法术」知识（含标准词+等级门）。 */
      knowledge(username: string, levelHint?: number): string
      /** 渐进式披露·「我有什么技能」列表（名称+等级+状态，不含咏唱词）。 */
      listSkills(username: string, cap?: number): string
      /** 渐进式披露·「选中某技能后的咏唱方法」单技能详情（含标准咏唱词）。 */
      spellDetail(username: string, query: string): string
      /** 发唱前防呆：造词→标准词改写；纯造词→block+提示。无问题返回 null。 */
      correctChant(username: string, chant: string): { chant?: string; block?: boolean; note?: string } | null
      /** 咏唱失败/成功通报（learning loop）。 */
      noteChantResult(username: string, ok: boolean, chant: string, reply: string): void
      /** 女神赐予新法术（含出生天赋确认）。 */
      grant(username: string, spellName: string): void
      /** 同步当前魔力层级（升层自动解锁）。 */
      syncLevel(username: string, level: number): void
      /** 能力复盘：生成「我掌握的能力」自省卡。 */
      reflect(username: string): string
    }
  }
}

// ── 种子词表（大典抄录：name/words/level，无 id/命令/费用）─────────────
interface SpellSeed {
  id: string
  name: string
  level: number
  words: string[]
}

const SPELLS_SEED: SpellSeed[] = [
  { id: 'appraise', name: '鉴定', level: 1, words: ['鉴定', '鉴定自身', '鉴定能力', '审视己身', 'appraise'] },
  { id: 'home', name: '归乡', level: 2, words: ['归乡', '回家', '回基地', '归途', '回巢'] },
  { id: 'tp', name: '空间传送', level: 2, words: ['传送', '瞬移', '闪现', '撕裂虚空', '空间跳跃', '跃迁'] },
  { id: 'heal', name: '圣愈术', level: 5, words: ['圣愈', '治愈', '治疗', '疗伤', '回血', '痊愈'] },
  { id: 'blood_mana', name: '燃血术', level: 5, words: ['燃血', '以血为引', '血祭', '化血为魔', '燃烧生命'] },
  { id: 'feed', name: '饱食赐福', level: 2, words: ['饱食', '充饥', '饱腹', '不饿', '充能'] },
  { id: 'food_mana', name: '炼食术', level: 2, words: ['炼食', '化食', '以食为引', '化食为魔', '炼化腹中之食'] },
  { id: 'give', name: '造物术', level: 2, words: ['造物', '赐予', '给予', '赐下', '给我', '变出'] },
  { id: 'light', name: '照明术', level: 1, words: ['照明', '点火', '火把', '光亮', '照亮', '驱暗'] },
  { id: 'time_day', name: '破晓术', level: 25, words: ['破晓', '天明', '白昼', '天亮', '日出', '驱夜'] },
  { id: 'weather_clear', name: '驱云术', level: 8, words: ['驱云', '放晴', '晴空', '雨停', '云散'] },
  { id: 'terraform', name: '大地塑形', level: 5, words: ['塑形', '裂地', '掘土', '开辟', '平整', '挖地'] },
  { id: 'rampart', name: '覆土术', level: 2, words: ['覆土', '填壑', '垒土', '筑地', '垫脚'] },
  { id: 'spring', name: '化水术', level: 1, words: ['化水', '清泉', '涌泉', '甘泉', '引水'] },
  { id: 'meteor', name: '陨石术', level: 25, words: ['陨石', '天罚', '星陨', '神雷', '天雷', '雷击'] },
  { id: 'swift', name: '迅捷术', level: 2, words: ['迅捷', '疾风', '加速'] },
  { id: 'leap', name: '跃升术', level: 1, words: ['跃升', '大跳', '高跳', '腾跃'] },
  { id: 'feather_fall', name: '羽落术', level: 1, words: ['羽落', '缓降', '轻身'] },
  { id: 'ironskin', name: '铁肤术', level: 8, words: ['铁肤', '护体', '坚韧'] },
  { id: 'regen', name: '再生术', level: 5, words: ['再生', '愈合', '新生'] },
  { id: 'strength', name: '神力术', level: 8, words: ['神力', '蛮力', '力量'] },
  { id: 'haste', name: '急迫术', level: 5, words: ['急迫', '巧手', '快手'] },
  { id: 'night_vision', name: '夜视术', level: 1, words: ['夜视', '猫眼', '夜瞳'] },
  { id: 'water_breath', name: '水息术', level: 2, words: ['水息', '鱼鳃', '水下呼吸', '深潜'] },
  { id: 'fire_res', name: '避火术', level: 5, words: ['火抗', '防火', '避火'] },
  { id: 'invisibility', name: '隐身术', level: 12, words: ['隐身', '无形', '遁形'] },
  { id: 'rain', name: '唤雨术', level: 5, words: ['唤雨', '降雨', '甘霖', '求雨'] },
  { id: 'storm', name: '雷暴术', level: 12, words: ['雷暴', '风暴', '雷云', '风雷'] },
  { id: 'steed', name: '唤马术', level: 12, words: ['唤马', '战马', '坐骑', '召唤马'] },
  { id: 'guardian', name: '铁卫术', level: 18, words: ['铁卫', '守护者', '铁傀儡', '护卫'] },
  { id: 'purge', name: '退魔术', level: 18, words: ['退魔', '净化', '驱邪', '驱魔'] },
  { id: 'windburst', name: '风爆术', level: 1, words: ['风爆', '气浪', '御风'] },
  { id: 'summon_wolf', name: '通灵契约', level: 15, words: ['通灵', '通灵之术', '契约之狼', '灵狼', '通灵狼', '召唤狼', '通灵犬'] },
  { id: 'summon_pack', name: '驮兽契约', level: 25, words: ['驮兽', '驮兽契约', '召唤驴', '驮兽之术', '灵驴'] },
  { id: 'rasengan', name: '螺旋丸', level: 8, words: ['螺旋丸', '螺旋手里剑', '查克拉旋涡', 'rasengan'] },
  { id: 'kage_bunshin', name: '影分身之术', level: 6, words: ['影分身', '多重影分身', '分身之术', 'kage bunshin'] },
  { id: 'mokuton_hut', name: '木遁·草庐', level: 1, words: ['木遁', '草庐', '起屋', '盖小屋'] },
  { id: 'mokuton_home', name: '木遁·民居', level: 2, words: ['民居', '造屋', '盖房'] },
  { id: 'mokuton_manor', name: '木遁·大宅', level: 3, words: ['大宅', '豪宅', '起大屋'] },
  { id: 'mokuton_shop', name: '木遁·商铺', level: 2, words: ['商铺', '起铺', '开店'] },
  { id: 'mokuton_library', name: '木遁·书阁', level: 3, words: ['书阁', '书馆', '书楼'] },
  { id: 'mokuton_farm', name: '木遁·农舍', level: 1, words: ['农舍', '垦田', '谷仓'] },
  { id: 'doton_tavern', name: '土遁·酒馆', level: 3, words: ['酒馆', '客栈', '酒楼'] },
  { id: 'doton_tower', name: '土遁·望楼', level: 4, words: ['望楼', '瞭望塔', '高塔'] },
  { id: 'doton_fort', name: '土遁·城寨', level: 5, words: ['城寨', '要塞', '堡垒'] },
  { id: 'doton_shrine', name: '土遁·神殿', level: 4, words: ['神殿', '祭坛', '神龛'] },
  { id: 'doton_well', name: '土遁·水井', level: 1, words: ['水井', '掘井', '凿井'] },
  { id: 'lantern_guide', name: '提灯引路', level: 1, words: ['提灯', '引路'] },
]

// 常见"造词" → 标准词（本地方言学习：把穿越者编出来的词映射回女神认识的标准词）。
// 键 = seed.id，值为穿越者可能误用的常见说法。
const PATRON_ALIASES: Record<string, string[]> = {
  heal: ['回春', '疗愈', '治好', '恢复体力', '把血填满'],
  tp: ['飞过去', '挪移', '空间挪移'],
  home: ['回城', '返程', '回出生点', '回镇子'],
  give: ['给我物资', '变出来', '给我造', '赐我'],
  feed: ['吃饱', '不饿了', '别饿'],
  light: ['点灯', '发光', '亮起来'],
  spring: ['出水', '变水', '造水'],
  swift: ['跑快点', '疾行'],
  leap: ['蹦高', '跳起来', '飞跳'],
  feather_fall: ['慢慢落', '飘落', '防摔'],
  night_vision: ['看清黑夜', '夜眼'],
  water_breath: ['在水里呼吸', '憋气'],
  regen: ['恢复', '补血', '快速回血'],
  haste: ['挖快', '加速挖'],
  terraform: ['平整地', '开垦', '整地'],
  weather_clear: ['出太阳', '雨停'],
}

// 技能状态枚举。
type SkillStatus = 'seeded' | 'mastered' | 'granted' | 'attempted' | 'locking'

interface SkillRecord {
  id: string
  name: string
  level: number
  words: string[]
  status: SkillStatus
  successes: number
  fails: number
  source: string
  lastAt: string
}

interface SpellbookState {
  version: number
  level: number
  innate: string | null
  skills: Record<string, SkillRecord>
}

function freshState(): SpellbookState {
  const skills: Record<string, SkillRecord> = {}
  for (const s of SPELLS_SEED) {
    skills[s.id] = {
      id: s.id,
      name: s.name,
      level: s.level,
      words: [...s.words],
      status: 'seeded',
      successes: 0,
      fails: 0,
      source: 'book',
      lastAt: new Date().toISOString(),
    }
  }
  return { version: 1, level: 0, innate: null, skills }
}

export function apply(ctx: Context, config: Config = {} as Config) {
  const log = (msg: string) => console.log(`[mc-spellbook] ${msg}`)
  const maxPromptSpells = config.maxPromptSpells ?? 40
  const store = (ctx as unknown as { get?: (n: string) => unknown }).get?.('mcStore') as McStoreService | undefined
  const cache = new Map<string, SpellbookState>()

  function load(username: string): SpellbookState {
    let s = cache.get(username)
    if (s) return s
    const base = freshState()
    try {
      const persisted = store?.loadSpellbook?.(username)
      if (persisted && persisted.skills) {
        const p = persisted as unknown as SpellbookState
        base.version = p.version ?? 1
        base.level = typeof p.level === 'number' ? p.level : 0
        base.innate = typeof p.innate === 'string' ? p.innate : null
        // 合并：种子词表是权威（name/level/words），持久化只覆盖学习状态（status/counts/source）。
        for (const [id, rec] of Object.entries(p.skills ?? {})) {
          const seed = SPELLS_SEED.find((x) => x.id === id)
          const existing = base.skills[id]
          if (existing) {
            existing.status = (rec as SkillRecord).status ?? existing.status
            existing.successes = (rec as SkillRecord).successes ?? 0
            existing.fails = (rec as SkillRecord).fails ?? 0
            existing.source = (rec as SkillRecord).source ?? 'book'
            existing.lastAt = (rec as SkillRecord).lastAt ?? existing.lastAt
          } else if (seed) {
            // 种子词表新增了法术，但持久化里还没有 → 按种子登记。
            base.skills[id] = { ...seed, words: [...seed.words], status: 'seeded', successes: 0, fails: 0, source: 'book', lastAt: new Date().toISOString() }
          }
        }
      }
    } catch { /* 读失败用种子 */ }
    cache.set(username, base)
    return base
  }

  function persist(username: string, s: SpellbookState): void {
    try {
      store?.saveSpellbook?.(username, s)
    } catch { /* 写失败不影响运行 */ }
    cache.set(username, s)
  }

  // 状态归一化：根据当前层级推导「可用性」。mastered/granted 恒可用；否则需 level>=技能要求。
  function effectiveStatus(s: SkillRecord, curLevel: number): 'mastered' | 'granted' | 'available' | 'locked' {
    if (s.status === 'mastered' || s.status === 'granted') return s.status
    if (curLevel >= s.level) return 'available'
    return 'locked'
  }

  function syncLevel(username: string, level: number): void {
    if (!Number.isInteger(level) || level < 0) return
    const s = load(username)
    if (s.level === level) return
    const unlocked: string[] = []
    for (const rec of Object.values(s.skills)) {
      if (level >= rec.level && rec.status === 'seeded') unlocked.push(rec.name)
    }
    s.level = level
    persist(username, s)
    if (unlocked.length) log(`${username} 升至 Lv.${level}，新解锁：${unlocked.join('、')}`)
  }

  function grant(username: string, spellName: string): void {
    const s = load(username)
    const bare = spellName.replace(/术$/, '').trim()
    // 先按名字匹配种子；匹配不到则视为女神新赐的法术，动态登记（自主学习）。
    let target = Object.values(s.skills).find((r) => r.name.replace(/术$/, '') === bare)
    if (!target) {
      const byWord = Object.values(s.skills).find((r) => r.words.some((w) => w.includes(bare) || bare.includes(w)))
      target = byWord
    }
    if (target) {
      target.status = 'granted'
      target.source = 'goddess'
      target.lastAt = new Date().toISOString()
    } else {
      const id = `granted_${Date.now()}`
      s.skills[id] = { id, name: spellName, level: s.level, words: [bare], status: 'granted', successes: 0, fails: 0, source: 'goddess', lastAt: new Date().toISOString() }
      log(`${username} 获女神新赐法术：${spellName}`)
    }
    persist(username, s)
  }

  function matchSpell(s: SpellbookState, chant: string): SkillRecord | null {
    const norm = chant.replace(/[，。、！？,．!？\s]+/g, ' ')
    for (const rec of Object.values(s.skills)) {
      if (rec.words.some((w) => norm.includes(w))) return rec
    }
    return null
  }

  // 咏唱结果回调（learning loop）：成功 → seal；失败 → 记录失败原因。
  function noteChantResult(username: string, ok: boolean, chant: string, reply: string): void {
    const s = load(username)
    const rec = matchSpell(s, chant)
    if (!rec) return
    rec.lastAt = new Date().toISOString()
    if (ok) {
      rec.successes += 1
      if (rec.status !== 'granted') rec.status = 'mastered'
      rec.source = rec.source === 'goddess' ? 'goddess' : 'practice'
      log(`${username} 咏唱「${rec.name}」成功（共${rec.successes}次）→ 已掌握`)
    } else {
      rec.fails += 1
      if (rec.status !== 'mastered' && rec.status !== 'granted') {
        const lvlGate = /等级|不足|层级|不够|未达/i.test(reply)
        rec.status = lvlGate ? 'locking' : 'attempted'
      }
      log(`${username} 咏唱「${rec.name}」失败（共${rec.fails}次）${/等级|不足/.test(reply) ? '（等级不及）' : ''}`)
    }
    persist(username, s)
  }

  // 发唱前防呆：把造词改写成标准词；纯造词则拦截。
  function correctChant(username: string, chant: string): { chant?: string; block?: boolean; note?: string } | null {
    const s = load(username)
    const norm = chant.replace(/[，。、！？,．!？\s]+/g, ' ')
    // 标准词命中 → 通过。
    if (matchSpell(s, chant)) return null
    // 造词典命中 → 改写成该法术的 canonical 词。
    for (const [id, aliases] of Object.entries(PATRON_ALIASES)) {
      for (const al of aliases) {
        if (norm.includes(al)) {
          const rec = s.skills[id]
          if (rec) {
            const canonical = rec.words[0] ?? rec.name
            if (!norm.includes(canonical)) {
              const corrected = chant.replace(new RegExp(al.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), canonical)
              return { chant: corrected, note: `（你念的「${al}」女神不认识，已改为标准法术词「${canonical}」）` }
            }
          }
        }
      }
    }
    // 完全无命中 → 拦截，提示用标准词。
    const available = availableList(s, 6)
    return {
      block: true,
      note: `你咏的法术词女神不认识，这次不消耗魔力。请照你掌握的法术清单里的标准词咏唱（如${available}…）。`,
    }
  }

  function availableList(s: SpellbookState, cap: number): string {
    const cur = s.level
    const items = Object.values(s.skills)
      .map((r) => ({ r, st: effectiveStatus(r, cur) }))
      .filter(({ st }) => st !== 'locked')
      .sort((a, b) => a.r.level - b.r.level)
      .slice(0, cap)
    return items.map(({ r, st }) => {
      const w = r.words.slice(0, 2).join(' / ')
      const mark = st === 'mastered' ? '✓' : st === 'granted' ? '✦' : ''
      return `${mark}${r.name}(${w})[Lv.${r.level}]`
    }).join('、')
  }

  // 注入 agent 上下文的「法术书」知识（渐进披露总原则：常驻只留指引+天赋，
  // 词表/清单全部交给工具按需取——不让上下文整块背着标准词）。
  function knowledge(username: string, levelHint?: number): string {
    const s = load(username)
    if (levelHint !== undefined && Number.isInteger(levelHint) && levelHint >= 0) {
      if (s.level !== levelHint) { s.level = levelHint }
    }
    const cur = s.level
    const innateS = s.innate ? `你的出生天赋是「${s.innate}」，无视等级，随时可咏唱。` : ''
    return (
      `你有一本魔法书（当前魔力层级 Lv.${cur}，层级决定你能咏唱多少法术，最低级法术每级解锁）。\n` +
      `${innateS}\n` +
      `看「你现在能用什么技能、该不该学新法术」→ 用工具 mc_skills。\n` +
      `选定一个技能后，看它的「标准咏唱词」→ 用工具 mc_spell_detail <技能名>。\n` +
      `照标准词咏唱 → 用工具 mc_chant。\n` +
      `铁律：咏唱词必须照 mc_spell_detail 查到的标准词一字不差，造词女神不认会失败；一句只施一个法术、只带一个方向。`
    )
  }

  // 渐进式披露·①「我有什么技能」列表：只报名称+等级+可用状态，不含咏唱词（词另查）。
  function listSkills(username: string, cap = maxPromptSpells): string {
    const s = load(username)
    const cur = s.level
    const rows: string[] = []
    const items = Object.values(s.skills)
    for (const r of items) {
      const st = effectiveStatus(r, cur)
      if (st === 'locked') continue
      let label: string
      if (st === 'mastered') label = '已掌握'
      else if (st === 'granted') label = '女神赐予'
      else label = '可咏唱'
      rows.push(`${r.name}｜${label}｜Lv.${r.level}`)
    }
    rows.sort((a, b) => {
      const la = /Lv\.(\d+)/.exec(a)?.[1] ?? '999'
      const lb = /Lv\.(\d+)/.exec(b)?.[1] ?? '999'
      return Number(la) - Number(lb)
    })
    const shown = rows.slice(0, cap)
    const innateS = s.innate ? `，出生天赋「${s.innate}」（无视等级）` : ''
    const lockedN = Object.values(s.skills).filter((r) => effectiveStatus(r, cur) === 'locked').length
    return (
      `你的法术书（当前 Lv.${cur}${innateS}）：\n` +
      `${shown.length ? shown.join('\n') : '（你现在还没有层级足够可咏唱的他人法术，只有出生天赋可用）'}\n` +
      `想学某个技能时，用 mc_spell_detail <技能名> 查它的标准咏唱词；层级不够的法术（${lockedN}个）后续升级解锁。`
    )
  }

  // 渐进式披露·②「选中某技能后的咏唱方法」：单技能详情（含标准咏唱词，只此一个）。
  function spellDetail(username: string, query: string): string {
    const s = load(username)
    const q = query.trim()
    if (!q) return '（未指定技能名）'
    const norm = q.replace(/术$/, '').replace(/[，。、！？,．!？\s]+/g, '')
    // 先按 完整名/去术名 匹配；再按 关键字（id/标准词）匹配。
    let target = Object.values(s.skills).find((r) => r.name === q || r.name.replace(/术$/, '') === norm)
    if (!target) target = Object.values(s.skills).find((r) => r.id.toLowerCase() === q.toLowerCase())
    if (!target) target = Object.values(s.skills).find((r) => r.words.some((w) => w === q || w.includes(q) || (q.length > 1 && q.includes(w))))
    if (!target) {
      // 最近似的名字提示。
      const near = Object.values(s.skills)
        .map((r) => ({ r, d: nameDist(r.name, q) }))
        .sort((a, b) => a.d - b.d)[0]
      const hint = near && near.d <= 2 ? `，你是不是想查「${near.r.name}」？` : ''
      return `法术书里没找到「${q}」${hint}。可用 mc_skills 看全部技能名。`
    }
    const cur = s.level
    const st = effectiveStatus(target, cur)
    const lock = st === 'locked'
    const statLine = st === 'mastered' ? `已掌握（成功${target.successes}次）`
      : st === 'granted' ? `女神赐予`
      : st === 'locking' ? `未成功（等级不及，失败${target.fails}次）`
      : st === 'attempted' ? `未成功（失败${target.fails}次）`
      : `层级已够（可咏唱）`
    const gate = lock ? `⚠️ 需 Lv.${target.level}，你当前 Lv.${cur}（未达标，升级后再试）` : `（你现在可咏唱）`
    return (
      `${target.name}（${statLine}）：\n` +
      `· 等级要求：Lv.${target.level} ${gate}\n` +
      `· 标准咏唱词：${target.words.join(' / ')}\n` +
      `· 用法：选其中一个词，照抄咏唱（造词女神不认）。仅施此一个、方向一次只说一个。`
    )
  }

  // 用于 spellDetail 的名字近似度（简单 Levenshtein，太小直接返回大值避免误报）。
  function nameDist(a: string, b: string): number {
    const s1 = a, s2 = b
    if (s1 === s2) return 0
    const m = s1.length, n = s2.length
    if (m === 0) return n
    if (n === 0) return m
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
    for (let i = 0; i <= m; i++) dp[i][0] = i
    for (let j = 0; j <= n; j++) dp[0][j] = j
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + (s1[i - 1] === s2[j - 1] ? 0 : 1),
        )
      }
    }
    return dp[m][n]
  }

  // 能力复盘：生成「我掌握的能力」自省卡（爱德华自我总结）。
  function reflect(username: string): string {
    const s = load(username)
    const cur = s.level
    const masteredL: SkillRecord[] = []
    const availableL: SkillRecord[] = []
    const lockingL: SkillRecord[] = []
    const lockedL: SkillRecord[] = []
    for (const r of Object.values(s.skills)) {
      const st = effectiveStatus(r, cur)
      if (st === 'mastered') masteredL.push(r)
      else if (st === 'granted') masteredL.push(r)
      else if (st === 'available') availableL.push(r)
      else if (r.status === 'locking' || st === 'locked') {
        if (r.status === 'locking') lockingL.push(r)
        else lockedL.push(r)
      }
    }
    masteredL.sort((a, b) => a.level - b.level)
    availableL.sort((a, b) => a.level - b.level)
    const fmt = (arr: SkillRecord[]) => arr.map((r) => `- ${r.name}（词：${r.words.slice(0, 3).join('/')}）[Lv.${r.level}]${r.status === 'granted' ? '（女神赐予）' : ''}${r.successes ? `｜成功${r.successes}次` : ''}`).join('\n') || '（暂无）'
    const still = lockingL.map((r) => r.name).join('、')
    return (
      `【我的能力复盘】当前魔力层级 Lv.${cur}${s.innate ? `，出生天赋「${s.innate}」` : ''}\n` +
      `★ 我已掌握：\n${fmt(masteredL)}\n` +
      `☆ 我可咏唱（层级已够）：\n${fmt(availableL)}\n` +
      `△ 我尝试过但还没成（多为等级不及）：\n${still || '（无）'}\n` +
      `—— 结论：想用某个法术，先确认它的层级够不够、词照上面标准词；层级不够就靠日常积累经验升级，别硬咏。`
    )
  }

  // ── 服务注册（无工具：mc_reflect_skills 由 mc-session 按 agent 注册以拿到 username）──
  ctx.provide('mcSpellbook', {
    knowledge,
    listSkills,
    spellDetail,
    correctChant,
    noteChantResult,
    grant,
    syncLevel,
    reflect,
  })
  log(`self-learning spellbook ready (${SPELLS_SEED.length} spells seeded, maxPrompt=${maxPromptSpells})`)
}
