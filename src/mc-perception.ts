/**
 * mc-perception —— 穿越者的感知层（具身智能分类，2026-09-20）。
 *
 * 分类学（按具身智能/机器人的感知划分，不是按数据源划分）：
 *   ① 本体感受 proprioception —— 我在哪、朝哪、怎么动、被外力推动、骑乘/睡眠
 *   ② 内感受   interoception —— 血/饱食/饱和/氧气/药水效果/经验；痛觉（受伤）
 *   ③ 外感受   exteroception —— 视（方块/光照/天气/维度/地形）、听（声音/箱子/活塞/挖掘）、
 *                                触（被击中、被推动、脚下接触）
 *   ④ 时间感知 chronoception —— 游戏时刻/昼夜/月相、感知新鲜度（每条带 ts）
 *   ⑤ 空间感知 localization —— 坐标、16 格区段、8 方位、**认知边界**（加载范围=能感知的范围）
 *   ⑥ 社会感知 social        —— 聊天/私语/NPC 台词、玩家进出、在线旅人（**不具名**）
 *   ⑦ 动作反馈 efference     —— 我这一动的结果（挖掘中断、拾取、击杀、升级）
 *   ⑧ 元认知   metacognition —— 脉搏（最近动作/连续同类型）、停滞、威胁态势、锚点、进展量化
 *
 * 三档（token 预算决定，见 docs/DESIGN-perception-layer.md）：
 *   ① 底线注入 status()  —— 每步进 system prompt，全部**门控**（变了才说、危险才说）
 *   ② 事件增量 queue     —— mineflayer 事件入队，随下一次 status() 吐出（合并去重、限流）
 *   ③ 按需 sensesSnapshot() —— 工具（mc_status/mc_scan/mc_map/mc_see）主动拉的全量快照
 *
 * 真实性铁律（不可协商）：
 *   - 视线外不报实体（LOS 剔除）；玩家**去名化**（名字只能经实际社交获得）
 *   - 未加载区块 = 不可知（`blockAt` 返回 null ≠ 空气；不许把未知说成已知）
 *   - **不碰 RCON、不读服务端内部数据**（世界侧归天神）；剧情事实只经文字通道
 *
 * 工程约束：本模块被 esbuild 内联进 mc-session 的 bundle（不是独立插件行），
 * 因此**不持有跨插件共享状态**；`sensesSnapshot` 是纯函数，可安全被 mc-tools 复用。
 */
import type { Bot } from 'mineflayer'
import Vec3 from 'vec3'
import { appendFileSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// ─────────────────────────────────────────────────────────────────────────────
// 常量与纯工具
// ─────────────────────────────────────────────────────────────────────────────

/** 敌对生物名单（用于威胁态势计数与刷怪预警）。中立生物不在此列。 */
export const HOSTILE_TYPES: ReadonlySet<string> = new Set([
  'zombie', 'husk', 'drowned', 'zombie_villager', 'zombified_piglin',
  'skeleton', 'stray', 'bogged', 'wither_skeleton',
  'creeper', 'spider', 'cave_spider', 'silverfish', 'endermite',
  'slime', 'magma_cube', 'phantom', 'witch',
  'pillager', 'vindicator', 'evoker', 'illusioner', 'ravager', 'vex',
  'blaze', 'ghast', 'guardian', 'elder_guardian', 'shulker', 'enderman',
  'piglin', 'piglin_brute', 'hoglin', 'zoglin', 'wither', 'ender_dragon',
  'warden', 'breeze', 'creaking', 'giant',
])

/** 会自主移动、值得预警的飞行/远程敌对（出现在头顶时更危险）。 */
const RANGED_HOSTILES: ReadonlySet<string> = new Set(['skeleton', 'stray', 'bogged', 'pillager', 'blaze', 'ghast', 'witch', 'drowned'])

/** 8 方位中文（相对朝向：+X=东，+Z=南，与 MC 坐标系一致）。 */
export function relDir8(dx: number, dz: number): string {
  const ax = Math.abs(dx)
  const az = Math.abs(dz)
  if (ax < 0.5 && az < 0.5) return '脚下'
  const ew = dx >= 0 ? '东' : '西'
  const ns = dz >= 0 ? '南' : '北'
  if (ax >= az * 2) return ew
  if (az >= ax * 2) return ns
  return ew + ns
}

/** 把 yaw 转成 8 方位朝向（mineflayer: forward = (-sin yaw, -cos yaw)）。 */
export function facingOf(yaw: number): string {
  const dx = -Math.sin(yaw)
  const dz = -Math.cos(yaw)
  return relDir8(dx * 2, dz * 2)
}

export interface GameClock { day: number; hh: string; mm: string; tod: number; isNight: boolean; stamp: string }

/** 游戏内时刻与昼夜（timeOfDay 0=清晨 6:00 起点，与部署版公式一致）。 */
export function gameClock(bot: unknown): GameClock {
  const b = bot as { time?: { day?: number; timeOfDay?: number } } | null
  const day = b?.time?.day ?? 0
  const tod = b?.time?.timeOfDay ?? 0
  const isNight = tod > 13_000 && tod < 23_000
  const hh = String(Math.floor(((tod / 1000) + 6) % 24)).padStart(2, '0')
  const mm = String(Math.floor(((tod % 1000) / 1000) * 60)).padStart(2, '0')
  return { day, hh, mm, tod, isNight, stamp: `[Day ${day} ${hh}:${mm} ${isNight ? '夜' : '昼'}]` }
}

/** 天气一行（含雷暴与雨强度）。 */
export function weatherOf(bot: unknown): { text: string; raining: boolean; thunder: boolean } {
  const b = bot as { isRaining?: boolean; rainState?: number; thunderState?: number } | null
  const raining = !!b?.isRaining
  const thunder = typeof b?.thunderState === 'number' && b.thunderState > 0
  const rain = typeof b?.rainState === 'number' ? b.rainState : raining ? 1 : 0
  if (thunder) return { text: '⛈ 雷暴（雷击危险、视野差）', raining: true, thunder: true }
  if (raining) return { text: `🌧 下雨（强度 ${rain}/2）`, raining: true, thunder: false }
  return { text: '', raining: false, thunder: false }
}

/** 脚下方块的光照（夜里判断刷怪风险；未加载返回 null）。 */
export function lightAt(bot: unknown): { block: number; sky: number } | null {
  const b = bot as { entity?: { position?: { x: number; y: number; z: number } }; blockAt?: (v: unknown) => unknown } | null
  const p = b?.entity?.position
  if (!p || !b?.blockAt) return null
  try {
    const blk = b.blockAt(new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))) as { light?: number; skyLight?: number } | null
    if (!blk) return null
    return { block: blk.light ?? 0, sky: blk.skyLight ?? 0 }
  } catch { return null }
}

/** 物品耐久（无耐久的物品返回 null）。 */
export function durabilityOf(item: unknown): { max: number; used: number; left: number; ratio: number } | null {
  const it = item as { maxDurability?: number; durabilityUsed?: number } | null
  const max = it?.maxDurability ?? 0
  if (!max) return null
  const used = it?.durabilityUsed ?? 0
  const left = Math.max(0, max - used)
  return { max, used, left, ratio: left / max }
}

/** 药水效果的可读名（拿不到注册表就退回 id，绝不编名字）。 */
export function effectLabel(bot: unknown, effect: unknown): string {
  const e = effect as { id?: number; amplifier?: number; duration?: number } | null
  if (!e) return ''
  const reg = (bot as { registry?: { effects?: Record<number, { name?: string; displayName?: string }> } } | null)?.registry
  const meta = e.id != null ? reg?.effects?.[e.id] : undefined
  const name = meta?.displayName ?? meta?.name ?? (e.id != null ? `效果#${e.id}` : '效果')
  const lv = typeof e.amplifier === 'number' && e.amplifier > 0 ? ` ${e.amplifier + 1} 级` : ''
  const dur = typeof e.duration === 'number' ? ` 剩 ${Math.max(0, Math.round(e.duration / 20))}s` : ''
  return `${name}${lv}${dur}`
}

/** 在线旅人（**不具名**）：身边 ≤16 格 / 远处在线 / 方位未明。 */
export function travellers(bot: unknown): { total: number; nearby: Array<{ dir: string; d: number }>; faraway: number; unknown: number } {
  const b = bot as {
    username?: string
    entity?: { position?: { x: number; y: number; z: number; distanceTo: (v: unknown) => number } }
    players?: Record<string, { username?: string; entity?: unknown }>
  } | null
  const p = b?.entity?.position
  const out = { total: 0, nearby: [] as Array<{ dir: string; d: number }>, faraway: 0, unknown: 0 }
  if (!p) return out
  for (const [uname, player] of Object.entries(b?.players ?? {})) {
    if (!player) continue
    // 排除自己：用户名匹配，或该 player 条目就挂在自身实体上（重连后仍稳）
    const entRef = (player as { entity?: unknown }).entity
    if (uname === b?.username || (entRef && entRef === (b?.entity as unknown))) continue
    out.total++
    const ent = player.entity as { position?: { x: number; y: number; z: number } } | null | undefined
    if (!ent?.position) { out.unknown++; continue }
    const d = Math.round(Math.hypot(ent.position.x - p.x, ent.position.z - p.z))
    if (d <= 16) out.nearby.push({ dir: relDir8(ent.position.x - p.x, ent.position.z - p.z), d })
    else out.faraway++
  }
  out.nearby.sort((a, b2) => a.d - b2.d)
  return out
}

/** 近处实体（LOS 剔除 + 玩家去名化），按距离排序。传入 los 判定时只保留真看得见的。 */
export function visibleEntities(
  bot: unknown,
  maxDistance = 16,
  limit = 8,
  los?: (bot: unknown, eye: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }) => boolean,
): Array<{ label: string; dir: string; d: number; hostile: boolean }> {
  const b = bot as {
    entity?: { position?: { x: number; y: number; z: number } }
    entities?: Record<string | number, unknown>
  } | null
  const p = b?.entity?.position
  if (!p || !b?.entities) return []
  const out: Array<{ label: string; dir: string; d: number; hostile: boolean }> = []
  const eye = { x: p.x, y: p.y + 1.62, z: p.z }
  for (const raw of Object.values(b.entities)) {
    const e = raw as { name?: string; username?: string; displayName?: string; position?: { x: number; y: number; z: number } } | null
    if (!e || !e.name || !e.position) continue
    if (e === (b.entity as unknown)) continue
    const d = Math.hypot(e.position.x - p.x, e.position.y - p.y, e.position.z - p.z)
    if (d > maxDistance) continue
    // 真实性铁律：视线外不算「看见」（没有 los 判定时退化为不过滤，由调用方声明）
    if (los && !los(bot, eye, { x: e.position.x, y: e.position.y + 0.9, z: e.position.z })) continue
    out.push({
      // 去名化铁律：玩家只标「玩家」；NPC/生物保留类型名
      label: e.username ? '玩家' : (flattenChat(e.displayName) || e.name),
      dir: relDir8(e.position.x - p.x, e.position.z - p.z),
      d: Math.round(d),
      hostile: HOSTILE_TYPES.has(e.name),
    })
  }
  out.sort((a, b2) => a.d - b2.d)
  return out.slice(0, limit)
}

/** 威胁态势：近处敌对怪数量 + 最近一只的方位/距离 + 是否含远程（**不做 LOS 剔除**——威胁是防身用的）。 */
export function threatState(bot: unknown, radius = 24): { count: number; nearest: string; ranged: boolean; rangedAny: boolean } {
  const b = bot as { entity?: { position?: { x: number; y: number; z: number } }; entities?: Record<string | number, unknown> } | null
  const p = b?.entity?.position
  if (!p || !b?.entities) return { count: 0, nearest: '', ranged: false, rangedAny: false }
  let count = 0
  let best: { d: number; dir: string; name: string } | null = null
  let rangedAny = false
  for (const raw of Object.values(b.entities)) {
    const e = raw as { name?: string; position?: { x: number; y: number; z: number } } | null
    if (!e || !e.name || !e.position || !HOSTILE_TYPES.has(e.name)) continue
    const d = Math.hypot(e.position.x - p.x, e.position.z - p.z)
    if (d > radius) continue
    count++
    if (RANGED_HOSTILES.has(e.name)) rangedAny = true
    if (!best || d < best.d) best = { d, dir: relDir8(e.position.x - p.x, e.position.z - p.z), name: e.name }
  }
  return { count, nearest: best ? `${best.name} ${best.dir}${Math.round(best.d)}格` : '', ranged: best ? RANGED_HOSTILES.has(best.name) : false, rangedAny }
}

/** 未加载区块判定：`blockAt` 返回 null = 该区块不在感知范围内（≠ 空气）。 */
export function isUnloadedBlock(block: unknown): boolean {
  return block === null || block === undefined
}

// ── 预处理：mineflayer 的真实载荷形状（见本文件补丁说明，均按源码实证）─────────

/**
 * 扁平化聊天/标题载荷。
 * mineflayer 的 title/actionBar 可能给 ChatMessage 对象、`{text, extra}`、数组或字符串
 * （title.js 用 parseTitle，chat.js 给 msg，entities.js 的 displayName 是 ChatMessage）。
 * 不处理就会插进模板串变成 [object Object]。
 */
export function flattenChat(value: unknown, depth = 0): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (depth > 6) return ''
  if (Array.isArray(value)) return value.map((v) => flattenChat(v, depth + 1)).join('')
  const o = value as { text?: unknown; extra?: unknown; translate?: unknown; with?: unknown; toString?: () => string }
  if (typeof o.text === 'string' || typeof o.text === 'number') {
    return String(o.text) + flattenChat(o.extra, depth + 1)
  }
  if (o.extra != null) return flattenChat(o.extra, depth + 1)
  if (o.translate != null) return flattenChat(o.with, depth + 1) || String(o.translate)
  // 兜底：ChatMessage 的 toString() 就是它的纯文本
  if (typeof o.toString === 'function') {
    const t = o.toString()
    if (t && t !== '[object Object]') return t
  }
  return ''
}

/**
 * 解析掉落物实体到底掉的是什么物品。
 * `itemDrop`/`playerCollect` 给的是**实体**，其 name 是实体类型（'item'），
 * 真正的物品在实体元数据的物品槽里（不同版本位置不同）。
 * 逐层兜底；全都拿不到就明说「未知」，绝不把 'item' 当物品名报出去。
 */
export function itemEntityLabel(bot: unknown, entity: unknown): string {
  const e = entity as {
    name?: string
    displayName?: unknown
    itemType?: { name?: string; count?: number }
    heldItem?: { name?: string; count?: number }
    metadata?: Array<{ key?: number; value?: unknown }> | Record<string, unknown>
  } | null
  if (!e) return '未知物品'
  const fromItem = (it: unknown): string | null => {
    const i = it as { name?: string; count?: number; itemCount?: number; itemId?: number } | null
    if (!i) return null
    if (typeof i.name === 'string' && i.name && i.name !== 'item') {
      const c = i.count ?? i.itemCount
      return c ? `${i.name}×${c}` : i.name
    }
    // 只有数字 id 时，用注册表换名字；换不到就如实报 id
    if (typeof i.itemId === 'number') {
      const reg = (bot as { registry?: { items?: Record<number, { name?: string }> } } | null)?.registry
      const nm = reg?.items?.[i.itemId]?.name
      const c = i.itemCount ?? i.count
      return nm ? (c ? `${nm}×${c}` : nm) : `物品#${i.itemId}`
    }
    return null
  }
  for (const cand of [e.itemType, e.heldItem]) {
    const got = fromItem(cand)
    if (got) return got
  }
  // 实体元数据里的物品槽（key 8 是多数版本的位置）
  try {
    const meta = e.metadata
    if (Array.isArray(meta)) {
      for (const entry of meta) {
        if (!entry || entry.key !== 8) continue
        const got = fromItem(entry.value)
        if (got) return got
      }
    } else if (meta && typeof meta === 'object') {
      const got = fromItem((meta as Record<string, unknown>)['8'])
      if (got) return got
    }
  } catch { /* 元数据形状不认识：继续兜底 */ }
  // 某些版本/自定义服务端会把物品名直接挂在实体上
  if (typeof e.name === 'string' && e.name && !/^item$/i.test(e.name)) return e.name
  const dn = flattenChat(e.displayName)
  if (dn && !/^item$/i.test(dn)) return dn
  return '未知物品（该版本未暴露掉落物内容）'
}

/** 音效名解析：`hardcodedSoundEffectHeard` 给的是数字 id（名字只在 soundEffectHeard 里）。 */
export function soundLabel(bot: unknown, id: unknown, category?: unknown): string {
  if (typeof id === 'string' && id && !/^\d+$/.test(id)) return id
  const reg = (bot as { registry?: { sounds?: Record<number, { name?: string }> } } | null)?.registry
  const nm = typeof id === 'number' ? reg?.sounds?.[id]?.name : undefined
  const cat = typeof category === 'string' && category && category !== 'master' ? `·${category}` : ''
  return nm ? `${nm}${cat}` : `音效#${String(id)}${cat}`
}

// ─────────────────────────────────────────────────────────────────────────────
// ③ 按需档：全量快照（纯函数，供 mc_status 等工具调用）
// ─────────────────────────────────────────────────────────────────────────────

/** 具身八类全量快照（按需拉，不进每步注入）。未加载/未知一律显式标注，不猜。 */
export function sensesSnapshot(
  bot: Bot,
  los?: (bot: unknown, eye: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }) => boolean,
): Record<string, unknown> {
  const b = bot as unknown as {
    entity?: { position?: { x: number; y: number; z: number }; yaw?: number; pitch?: number; velocity?: { x: number; y: number; z: number }; onGround?: boolean; effects?: Record<string, unknown>; equipment?: unknown[] }
    health?: number; food?: number; foodSaturation?: number; oxygenLevel?: number; isSleeping?: boolean
    experience?: { level?: number; points?: number; progress?: number }
    game?: { dimension?: string; difficulty?: string; gameMode?: string; serverBrand?: string; minY?: number; height?: number }
    inventory?: { items: () => Array<{ name: string; count: number; maxDurability?: number; durabilityUsed?: number; slot?: number }>; slots?: unknown[] }
    heldItem?: unknown
    world?: { columns?: Record<string, unknown> }
    blockAt?: (v: unknown) => unknown
  }
  const p = b.entity?.position
  if (!p) return { 状态: '尚未出生 —— 身体还没接入方块世界' }
  const clock = gameClock(bot)
  const weather = weatherOf(bot)
  const light = lightAt(bot)
  const fl = (v: number): number => Math.round(v)

  // 背包 + 手持 + 装备耐久（镐子快坏是真实且高频的翻车点）
  let inventory: Array<{ name: string; count: number }> = []
  let held: { name: string; count: number } | null = null
  let durability: Array<{ name: string; left: number; max: number }> = []
  try {
    const items = b.inventory?.items?.() ?? []
    inventory = items.map((i) => ({ name: i.name, count: i.count }))
    for (const i of items) {
      const d = durabilityOf(i)
      if (d && d.ratio <= 0.25) durability.push({ name: i.name, left: d.left, max: d.max })
    }
    const h = b.heldItem as { name?: string; count?: number } | null
    if (h?.name) held = { name: h.name, count: h.count ?? 1 }
  } catch { /* 背包读取失败不阻塞 */ }
  // 装备：优先用背包窗口的护甲槽（mindcraft 做法，5=头盔 6=胸甲 7=护腿 8=靴子），
  // 拿不到再退回实体的 equipment 数组。具名比原始数组可判断得多（"没穿护甲"是生存信号）。
  let equipment: string[] = []
  let armor: Record<string, string> = {}
  try {
    const slots = (b.inventory as { slots?: Array<{ name?: string } | null> } | undefined)?.slots ?? []
    const at = (i: number): string => slots[i]?.name ?? '无'
    if (slots.length >= 9) armor = { 头盔: at(5), 胸甲: at(6), 护腿: at(7), 靴子: at(8) }
    equipment = (b.entity?.equipment ?? [])
      .filter(Boolean)
      .map((i) => (i as { name?: string }).name ?? '?')
    if (!Object.keys(armor).length && equipment.length) armor = { 装备数组: equipment.join('/') }
  } catch { /* 装备读取失败不阻塞 */ }

  // 背包容量占用（格数/总格数）：快满时捡不到东西，是真压力信号
  let slotsUsed = -1
  let slotsTotal = -1
  try {
    const inv = b.inventory as { slots?: unknown[] } | undefined
    slotsTotal = Array.isArray(inv?.slots) ? inv.slots.length : -1
    slotsUsed = Array.isArray(inv?.slots) ? inv.slots.filter((x) => x != null).length : -1
  } catch { /* 容量读取失败不阻塞 */ }

  // 视（视线方块 + 头顶开口 + 四向 + 脚下 + 光照/群系）
  let sight: Record<string, unknown> = {}
  try {
    const botAny = bot as unknown as { blockInSight?: (n: number, e: number) => { name: string; position: { x: number; y: number; z: number } } | null }
    const look = botAny.blockInSight?.(24, 5 / 16)
    const feet = b.blockAt?.(new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))) as { name?: string; light?: number; skyLight?: number; biome?: { name?: string } } | null
    const under = b.blockAt?.(new Vec3(Math.floor(p.x), Math.floor(p.y) - 1, Math.floor(p.z))) as { name?: string } | null
    const dirs: Array<[string, number, number]> = [['东', 2, 0], ['南', 0, 2], ['西', -2, 0], ['北', 0, -2]]
    const around: Record<string, string> = {}
    for (const [label, ox, oz] of dirs) {
      const blk = b.blockAt?.(new Vec3(Math.floor(p.x) + ox, Math.floor(p.y) + 1, Math.floor(p.z) + oz)) as { name?: string; boundingBox?: string } | null
      around[label] = isUnloadedBlock(blk) ? '未加载（不可知）' : blk && blk.boundingBox !== 'empty' ? `${blk.name} 挡路` : '开阔'
    }
    sight = {
      视线内: look ? `${look.name} ${fl(Math.hypot(look.position.x - p.x, look.position.y + 1.62 - (p.y + 1.62), look.position.z - p.z))}格` : '24 格内无遮挡物',
      四向: around,
      脚下: isUnloadedBlock(under) ? '未加载（不可知）' : under?.name ?? '空气',
      所在方块: isUnloadedBlock(feet) ? '未加载（不可知）' : feet?.name ?? '空气',
      光照: feet ? { 方块光: feet.light ?? 0, 天光: feet.skyLight ?? 0 } : null,
      群系: feet?.biome?.name ?? '未知',
    }
  } catch { sight = { 说明: '视觉扫描失败' } }

  const effects = Object.values(b.entity?.effects ?? {}).map((e) => effectLabel(bot, e)).filter(Boolean)
  const trav = travellers(bot)
  const threat = threatState(bot)
  const loaded = b.world?.columns ? Object.keys(b.world.columns).length : null

  return {
    时间: { 刻度: clock.stamp, 天气: weather.text || '晴', 维度: b.game?.dimension ?? '未知', 难度: b.game?.difficulty ?? '未知', 模式: b.game?.gameMode ?? '未知' },
    本体: {
      坐标: { x: fl(p.x), y: fl(p.y), z: fl(p.z) },
      面朝: facingOf(b.entity?.yaw ?? 0),
      俯仰: Math.round(((b.entity?.pitch ?? 0) * 180) / Math.PI),
      站立: b.entity?.onGround ? '站在地面' : '腾空/坠落中',
      速度: b.entity?.velocity ? Math.round(Math.hypot(b.entity.velocity.x, b.entity.velocity.z) * 100) / 100 : null,
      睡眠: b.isSleeping ? '正在睡觉' : '清醒',
    },
    内感: {
      生命: b.health ?? null,
      饱食: b.food ?? null,
      饱和: b.foodSaturation ?? null,
      氧气: b.oxygenLevel ?? null,
      经验: { 等级: b.experience?.level ?? null, 点数: b.experience?.points ?? null, 进度: b.experience?.progress ?? null },
      药水效果: effects.length ? effects : '无',
    },
    视: sight,
    威胁: { 近处敌对怪: threat.count, 最近: threat.nearest || '无', 远程: threat.rangedAny ? '有（注意弹道）' : '否', 可见实体: visibleEntities(bot, 16, 8, los) },
    库存: {
      物品种类: inventory.length,
      物品: inventory,
      手持: held ?? '空手',
      装备: armor,
      装备原始数组: equipment.length ? equipment : '无',
      背包占用: slotsTotal > 0 ? { 已用格: slotsUsed, 总格: slotsTotal, 比例: Math.round((slotsUsed / slotsTotal) * 100) / 100 } : '未知',
      低耐久警告: durability.length ? durability : '无',
    },
    社会: { 在线旅人: trav.total, 身边16格内: trav.nearby.length ? trav.nearby : '无', 远处: trav.faraway, 方位未明: trav.unknown },
    元认知: { 感知范围_已加载区块: loaded ?? '未知', 说明: '未加载区块内的一切都不可知（不许猜）', 世界上下限: b.game?.minY != null && b.game?.height != null ? `${b.game.minY}~${b.game.minY + b.game.height}` : '未知' },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ①②④ 有状态部分：每步底线注入 + 事件增量 + 元认知
// ─────────────────────────────────────────────────────────────────────────────

export interface PerceptionSignals {
  hp: number
  food: number
  oxygen: number
  isNight: boolean
  stuck: boolean
  samePosCount: number
  hostileNear: number
  freshChat: boolean
  hasWritingKit: boolean
  position: { x: number; y: number; z: number } | null
}

export interface PerceptionDeps {
  /** 取当前身体（多穿越者形态下是 per-agent 门面）。 */
  body: () => unknown
  /** 穿越者用户名（用于捡拾/死亡归属判断）。 */
  username: string
  log: (msg: string) => void
  /** 本轮新到的社会性文字（聊天/NPC 台词，已由上层按铁律加工：上位者标注、去名化）。 */
  socialLines: () => string[]
  /** 最近的动作流水（episodic 尾部文本，用于脉博）。 */
  recentActions: () => string[]
  /** 每步注入里最多吐几条事件（默认 8）。 */
  maxEventLines?: number
  /** 锚点间隔（步），默认 25；每 N 步补一行全量锚点，防上下文压缩后漂移。 */
  anchorEverySteps?: number
  /** 数据目录：落 decision_trace.jsonl（每步快照，供慢循环离线重放）。不传则不落盘。 */
  dataDir?: string
  /** 死亡热点簇（世界模型用来判「我是否正站在死亡区里」）。 */
  deathZones?: () => Array<{ x: number; z: number; r?: number; count?: number }>
  /** 连接代次：换身体/重连后观测账本自动作废（Cortico 同款作用域）。 */
  connectionGeneration?: number
}

/** 收集敌对实体（世界模型输入）。威胁判定**不做 LOS 过滤**——威胁是防身用的，宁可多报。 */
export function collectHostiles(bot: unknown): Array<{ name: string; x: number; y: number; z: number }> {
  const b = bot as { entities?: Record<string | number, unknown> } | null
  const out: Array<{ name: string; x: number; y: number; z: number }> = []
  for (const raw of Object.values(b?.entities ?? {})) {
    const e = raw as { name?: string; position?: { x: number; y: number; z: number } } | null
    if (!e?.name || !e.position || !HOSTILE_TYPES.has(e.name)) continue
    out.push({ name: e.name, x: e.position.x, y: e.position.y, z: e.position.z })
  }
  return out
}

/** 追加一行 JSONL（自愈：目录不存在就建；超过 8MB 截断重开，防无限增长）。 */
export function appendJsonl(dir: string, file: string, obj: unknown): void {
  try {
    mkdirSync(dir, { recursive: true })
    const p = join(dir, file)
    try { if (statSync(p).size > 8 * 1024 * 1024) appendFileSync(p, '') } catch { /* 首次写 */ }
    appendFileSync(p, JSON.stringify(obj) + '\n')
  } catch { /* 落盘失败绝不影响感知 */ }
}

export interface Perception {
  /** ①底线 + ②事件 + ④元认知 → 每步注入文本。 */
  status: () => string
  /** 给上层（指导块）用的信号。 */
  signals: () => PerceptionSignals
  /** 只为可观测性：事件队列长度。 */
  pending: () => number
  /** 各通道新鲜度（neko fresh_status 式：陈旧必须标注）。 */
  freshness: () => FreshnessReport
  /** 最近一次构建的世界模型（决策就绪快照）。 */
  lastWorldModel: () => WorldModel | null
}

interface QueuedPercept { cat: string; text: string; at: number; key?: string; count: number }

/** 动作流水的极简解析（与 episodic 文本格式 `(x,y,z) -> {args} = result` 对齐）。 */
function parseAction(line: string): { type: string; detail: string; result: string } | null {
  if (!line) return null
  const arrow = line.indexOf('->')
  const eq = line.indexOf(' = ', arrow > -1 ? arrow + 2 : 0)
  if (arrow < 0 || eq < 0) return null
  const argsRaw = line.slice(arrow + 2, eq).trim()
  const result = line.slice(eq + 3).trim().slice(0, 48)
  let obj: Record<string, unknown> = {}
  try { obj = JSON.parse(argsRaw) as Record<string, unknown> } catch { /* 非 JSON 参数：走文本兜底 */ }
  const num = (v: unknown): boolean => typeof v === 'number'
  const str = (v: unknown): boolean => typeof v === 'string'
  if (obj.kill === true) return { type: '战斗', detail: str(obj.mobType) ? `打怪(${String(obj.mobType)})` : '攻击', result }
  if (num(obj.x) && num(obj.z)) return { type: '移动', detail: `去(${String(obj.x)},${String(obj.y)},${String(obj.z)})`, result }
  if (str(obj.item)) return { type: '合成/使用', detail: String(obj.item), result }
  if (str(obj.block) || num(obj.y)) return { type: '挖建', detail: argsRaw.slice(0, 28), result }
  if (str(obj.message)) return { type: '交流', detail: String(obj.message).slice(0, 20), result }
  return { type: '操作', detail: argsRaw.slice(0, 28), result }
}

export function createPerception(deps: PerceptionDeps): Perception {
  const maxEventLines = deps.maxEventLines ?? 8
  const anchorEverySteps = deps.anchorEverySteps ?? 25

  // ── 事件队列（②档）：合并去重 + 限长 + 限流 ───────────────────────────
  const queue: QueuedPercept[] = []
  const MAX_QUEUE = 60
  const COALESCE_MS = 6000
  const push = (cat: string, text: string, key?: string): void => {
    const now = Date.now()
    if (key) {
      const hit = queue.find((q) => q.key === key && now - q.at < COALESCE_MS)
      if (hit) { hit.count++; hit.at = now; hit.text = text; return }
    }
    // 同类事件过密时合并计数，避免刷屏
    const sameCat = queue.filter((q) => q.cat === cat)
    if (sameCat.length >= 12) { sameCat[0].count++; sameCat[0].text = text; return }
    queue.push({ cat, text, at: now, key, count: 1 })
    if (queue.length > MAX_QUEUE) {
      const dropped = queue.length - MAX_QUEUE
      queue.splice(0, dropped)
      queue.unshift({ cat: '元认知', text: `（${dropped} 条较早的感知因积压被丢弃）`, at: now, count: 1 })
    }
  }

  // ── 门控状态（只在变化时注入）────────────────────────────────────────
  let watched: unknown = null
  let lastHp = -1
  let lastFood = -1
  let lastOxygen = -1
  let lastRegion = ''
  let lastWeather = ''
  let lastDim = ''
  let lastLevel = -1
  let lastEffects = ''
  let lastPackFull = ''
  let lastDayPhase = ''
  let lastLoaded = -1
  let lastPosKey = ''
  let samePosCount = 0
  let stepCount = 0
  let sig: PerceptionSignals = {
    hp: 20, food: 20, oxygen: 20, isNight: false, stuck: false, samePosCount: 0,
    hostileNear: 0, freshChat: false, hasWritingKit: false, position: null,
  }
  let anchorInv = { kinds: -1, total: -1 }
  let pendingProgress = ''
  // 停滞判定：以"有进展"为基准（逐格位置 / 背包构成 / 区段 任一变化都算进展），
  // 而不是"区段没变"——后者会把"在同一个区块里挖矿/盖房 8 分钟"误判成卡死。
  let lastProgressAt = 0
  let lastPosBlock = ''
  let lastInvKinds = -1
  let lastInvTotal = -1
  // 最近一次真实攻击者（由 entityHurt 的真值填，供血量行合并陈述；不靠"最近威胁"猜）
  let lastAttacker = ''
  let lastAttackerAt = 0
  /** 资产/风险串的指纹（不含时钟）：不变就不重复追加。 */
  let assetStamp = ''
  let lastWorld: WorldModel | null = null
  const marks: Record<string, number | null> = { vitals: null, threat: null, social: null, world: null, inventory: null }
  let lastTraceAt = 0

  const n = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

  // ── 事件武装（幂等；身体重连换实例会自动重新挂）──────────────────────
  const arm = (botRaw: unknown): void => {
    const bot = botRaw as (Bot & { on: (ev: string, cb: (...a: unknown[]) => void) => void; entity?: { position?: { x: number; y: number; z: number }; yaw?: number; pitch?: number }; username?: string; entities?: Record<string | number, unknown> }) | null
    if (!bot || watched === bot) return
    watched = bot
    const me = (): unknown => bot.entity
    const p = (): { x: number; y: number; z: number } | undefined => bot.entity?.position
    /** 近处方位描述（超距返回 null → 事件直接丢掉，不给全知感）。 */
    const near = (pos: { x: number; y: number; z: number } | undefined, maxD: number): string | null => {
      const self = p()
      if (!self || !pos) return null
      const d = Math.hypot(pos.x - self.x, pos.y - self.y, pos.z - self.z)
      if (d > maxD) return null
      return `${relDir8(pos.x - self.x, pos.z - self.z)}${Math.round(d)}格`
    }
    const guard = (fn: () => void): void => { try { fn() } catch { /* 感知事件永不影响主循环 */ } }

    // ① 本体感受
    guard.bind(null)
    bot.on('spawn', () => push('本体', '你已接入世界（身体就位）'))
    bot.on('respawn', () => push('本体', '你在重生点重新醒来'))
    bot.on('spawnReset', () => push('本体', '你的重生点已改变'))
    bot.on('sleep', () => push('本体', '你躺下睡着了'))
    bot.on('wake', () => push('本体', '你醒来了'))
    bot.on('forcedMove', () => push('本体', '你被外力推动了（水流/活塞/别人）', 'forced'))
    bot.on('mount', () => push('本体', '你骑上了载具'))
    bot.on('dismount', () => push('本体', '你离开了载具'))
    bot.on('kicked', (...a: unknown[]) => push('本体', `⚠ 你被服务器踢出：${String(a[0] ?? '').slice(0, 80)}`))

    // ② 内感受（痛觉/呼吸/效果/经验）
    // 血量变化的**陈述权归每步注入**（它同时知道上一次的值与真实攻击者）。
    // 原先这里也 push 一条"你被击中"，结果是同一击报两遍、而且来源是猜的
    // （实测抓出：真凶 zombie 被猜成 creeper）。事件层不再重复报告。
    bot.on('health', () => guard(() => { /* 血量由 status() 的边沿触发统一陈述 */ }))
    // ⚠️ 这个处理器**不许再写 lastOxygen**：变化检测的所有权归每步注入
    //（原先它把 lastOxygen 改成事件后的值 → 注入层看到"没变" → 溺水/恢复都将不报，
    //  实测抓出：氧气从 20 掉到 6 时注入层一声不响）。与 health 同一个坑，一并堵死。
    bot.on('breath', () => guard(() => { /* 氧气由 status() 的边沿触发统一陈述 */ }))
    bot.on('entityEffect', (...a: unknown[]) => guard(() => {
      if (a[0] !== me()) return
      push('内感', `获得药水效果：${effectLabel(bot, a[1])}`)
    }))
    bot.on('entityEffectEnd', (...a: unknown[]) => guard(() => {
      if (a[0] !== me()) return
      push('内感', `药水效果结束：${effectLabel(bot, a[1])}`)
    }))
    bot.on('experience', () => guard(() => {
      const lv = n((bot as unknown as { experience?: { level?: number } }).experience?.level, 0)
      if (lastLevel >= 0 && lv > lastLevel) push('内感', `🌟你升级了：现在 ${lv} 级`)
      lastLevel = lv
    }))

    // ③ 外感受·视（世界在变）
    bot.on('itemDrop', (...a: unknown[]) => guard(() => {
      const e = a[0] as { position?: { x: number; y: number; z: number } } | null
      const where = near(e?.position, 20)
      if (!where) return
      // 掉落物实体本身不是物品（name='item'）：走预处理解析真实物品名
      const item = itemEntityLabel(bot, e)
      push('外感·视', `地上出现了可捡的 ${item}（${where}）`, `drop:${item}`)
    }))
    bot.on('playerCollect', (...a: unknown[]) => guard(() => {
      const collector = a[0] as unknown
      const collected = a[1]
      if (!collected) return
      const item = itemEntityLabel(bot, collected)
      if (collector === me()) push('动作', `你捡起了 ${item}`)
      else push('外感·视', `有人捡走了 ${item}`, 'collect')
    }))
    bot.on('blockUpdate', (...a: unknown[]) => guard(() => {
      const nb = a[1] as { name?: string; position?: { x: number; y: number; z: number } } | null
      if (!nb?.position) return
      const where = near(nb.position, 8)
      if (!where) return
      push('外感·视', `近处方块变化：变成 ${nb.name}（${where}）`, 'blockchange')
    }))
    const blockPlaced = (...a: unknown[]): void => guard(() => {
      const nb = a[1] as { name?: string; position?: { x: number; y: number; z: number } } | null
      if (!nb?.position) return
      const where = near(nb.position, 8)
      if (!where) return
      push('外感·视', `有人在你旁边放了 ${nb.name}（${where}）`, 'blockplace')
    })
    bot.on('blockPlaced', blockPlaced)
    bot.on('rain', () => push('外感·视', '天气变了（开始/停止下雨）', 'weather'))
    bot.on('weatherUpdate', () => push('外感·视', '天气变了（开始/停止下雨）', 'weather'))
    bot.on('entitySpawn', (...a: unknown[]) => guard(() => {
      const e = a[0] as { name?: string; position?: { x: number; y: number; z: number } } | null
      if (!e?.name || !HOSTILE_TYPES.has(e.name)) return
      const where = near(e.position, 16)
      if (!where) return
      push('外感·视', `⚠ ${e.name} 出现了（${where}）`, `spawn:${e.name}`)
    }))
    bot.on('entityEquip', (...a: unknown[]) => guard(() => {
      const e = a[0] as { name?: string; position?: { x: number; y: number; z: number } } | null
      if (!e?.name || e === me()) return
      const where = near(e.position, 16)
      if (!where) return
      push('外感·视', `${e.name} 换了装备（${where}）`, 'equip')
    }))

    // ③ 外感受·听（最近距离衰减 + 过滤脚步/环境音）
    const hear = (name: string, pos: { x: number; y: number; z: number } | undefined, maxD = 16): void => {
      // 只滤脚步/涉水/闲置这类高频无信息噪声；**保留 .ambient**
      //（怪物环境音 = 还没看见就先听到，是最有价值的一类听觉信号）
      if (!name || /\.(step|walk|swim|idle)$/.test(name)) return
      const where = near(pos, maxD)
      if (!where) return
      push('外感·听', `【${where}】${name.replace(/^block\.|^entity\.|^item\./, '')}`, `sound:${name}`)
    }
    bot.on('soundEffectHeard', (...a: unknown[]) => guard(() => hear(String(a[0] ?? ''), a[1] as { x: number; y: number; z: number } | undefined)))
    // 载荷是 (soundId, soundCategory, position, volume, pitch)：第一参是数字 id，必须解析
    bot.on('hardcodedSoundEffectHeard', (...a: unknown[]) => guard(() => {
      hear(soundLabel(bot, a[0], a[1]), a[2] as { x: number; y: number; z: number } | undefined)
    }))
    bot.on('noteHeard', (...a: unknown[]) => guard(() => {
      const block = a[0] as { position?: { x: number; y: number; z: number } } | null
      const where = near(block?.position, 24)
      push('外感·听', `有人弹响了音符盒（${where ?? '远处'}）`, 'note')
    }))
    bot.on('chestLidMove', (...a: unknown[]) => guard(() => {
      const block = a[0] as { position?: { x: number; y: number; z: number } } | null
      const isOpen = a[1] === true
      const where = near(block?.position, 12)
      push('外感·听', `${isOpen ? '有人打开了箱子' : '有人合上了箱子'}（${where ?? '远处'}）`, `chest:${isOpen}`)
    }))
    bot.on('pistonMove', (...a: unknown[]) => guard(() => {
      const block = a[0] as { position?: { x: number; y: number; z: number } } | null
      const where = near(block?.position, 12)
      push('外感·听', `活塞动了（${where ?? '远处'}）`, 'piston')
    }))
    bot.on('blockBreakProgressObserved', (...a: unknown[]) => guard(() => {
      const block = a[0] as { name?: string; position?: { x: number; y: number; z: number } } | null
      const who = a[2] as unknown
      if (who === me()) return
      const where = near(block?.position, 8)
      if (!where) return
      push('外感·听', `有人在挖 ${block?.name ?? '方块'}（${where}）`, 'breaking')
    }))

    // ⑦ 动作反馈（我这一动的结果）
    bot.on('diggingAborted', (...a: unknown[]) => guard(() => {
      const block = a[0] as { name?: string } | null
      push('动作', `⚠ 挖掘 ${block?.name ?? '方块'} 被中断（没挖完）`)
    }))
    bot.on('entityHurt', (...a: unknown[]) => guard(() => {
      const e = a[0] as { name?: string; position?: { x: number; y: number; z: number } } | null
      const source = a[1] as { name?: string; username?: string } | null | undefined
      if (!e) return
      const where = near(e.position, 16)
      // 我自己被打：带上真实伤害源（mineflayer 第二参），比按最近怪猜方位准。
      // 先判身份再判 name —— 自身实体未必带 name 字段。
      if (e === me()) {
        // 只记真值：谁打的（玩家去名化）。陈述交给每步注入的血量行，避免同一击说两遍。
        lastAttacker = source?.name ? (source.username ? '某个玩家' : source.name) : ''
        lastAttackerAt = Date.now()
        return
      }
      if (!e.name) return
      if (!where) return
      push('动作', `${e.name} 被击伤${source?.name ? `（${source.username ? '玩家' : source.name} 出手）` : ''}（${where}）`, 'hurt')
    }))
    bot.on('entityDead', (...a: unknown[]) => guard(() => {
      const e = a[0] as { name?: string; position?: { x: number; y: number; z: number } } | null
      if (!e?.name || e === me()) return
      const where = near(e.position, 16)
      push('动作', `${e.name} 死了（${where ?? '附近'}）`, 'dead')
    }))

    // ⑤ 空间感知：认知边界（加载范围变化 = 感知范围变化）
    bot.on('chunkColumnLoad', () => guard(() => {
      const cols = (bot as unknown as { world?: { columns?: Record<string, unknown> } }).world?.columns
      const loaded = cols ? Object.keys(cols).length : -1
      if (lastLoaded >= 0 && loaded >= 0 && Math.abs(loaded - lastLoaded) > 40) push('空间', `感知范围变化：已加载 ${loaded} 区块`)
      lastLoaded = loaded
    }))

    // ⑥ 社会感知（玩家进出；**不具名**）
    const joinLeave = (verb: string) => (...a: unknown[]) => guard(() => {
      const player = a[0] as { username?: string } | null
      const trav = travellers(bot)
      push('社会', `有人${verb}了世界（现在在线 ${trav.total} 位旅人）`, `joinleave:${verb}:${player?.username ?? '?'}`)
    })
    bot.on('playerJoined', joinLeave('来'))
    bot.on('playerLeft', joinLeave('离开'))

    // 服务器文字通道（剧情事实，不是物理事实）
    bot.on('title', (...a: unknown[]) => guard(() => {
      const text = flattenChat(a[0]).trim()
      const kind = a[1] === 'subtitle' ? '副字幕' : '字幕'
      if (text) push('社会', `【${kind}】${text.slice(0, 80)}`, `title:${text.slice(0, 24)}`)
    }))
    bot.on('actionBar', (...a: unknown[]) => guard(() => {
      const text = flattenChat(a[0]).trim()
      if (text) push('社会', `【提示】${text.slice(0, 60)}`, `bar:${text.slice(0, 24)}`)
    }))
    deps.log('感知层已武装：本体/内感/外感(视听触)/社会/动作/认知边界 事件就绪')
  }

  // ── 每步注入 ─────────────────────────────────────────────────────────
  const status = (): string => {
    const botRaw = deps.body()
    const bot = botRaw as unknown as {
      entity?: { position?: { x: number; y: number; z: number }; yaw?: number; onGround?: boolean }
      health?: number; food?: number; oxygenLevel?: number; foodSaturation?: number
      inventory?: { items: () => Array<{ name: string; maxDurability?: number; durabilityUsed?: number }> }
      heldItem?: unknown
      game?: { dimension?: string }
      experience?: { level?: number }
      entity2?: unknown
    } | null
    const pos = bot?.entity?.position
    if (!bot || !pos) return '(尚未出生 — 等待身体接入方块世界)'
    arm(bot)
    stepCount++

    const clock = gameClock(bot)
    const lines: string[] = []

    // ⑥ 社会感知（亲耳听到的：聊天/私语/NPC 台词；上层已按铁律加工过标签）
    const social = deps.socialLines().filter(Boolean)
    for (const line of social) lines.push(line)

    // ② 事件增量（时效性次之）
    const events = queue.splice(0, maxEventLines)
    for (const e of events) lines.push(e.count > 1 ? `${e.text}（×${e.count}）` : e.text)
    if (queue.length > maxEventLines) lines.push(`（另有 ${queue.length} 条感知排队，下次继续）`)

    // ① 本体感受（位置：跨 16 格区段才报 —— 防止每步刷坐标）
    const region = `${Math.floor(pos.x / 16)},${Math.floor(pos.z / 16)}`
    const regionChanged = region !== lastRegion
    lastRegion = region
    // 位置不再单独占一行（下面的态势行本来就带坐标）——省一行、去一处重复。
    // 但"是否跨区段"仍是进展信号之一。
    let invKinds = -1
    let invTotal = -1
    try {
      const its = bot.inventory?.items?.() ?? []
      invKinds = its.length
      invTotal = its.reduce((sum, i) => sum + (typeof i === 'object' && i && 'count' in i ? Number((i as { count?: number }).count ?? 0) : 0), 0)
    } catch { /* 背包读取失败：进展判定退化为位置 */ }
    const posBlock = `${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)}`
    const progressed = regionChanged || posBlock !== lastPosBlock || invKinds !== lastInvKinds || invTotal !== lastInvTotal
    if (progressed) {
      lastProgressAt = Date.now()
      lastPosBlock = posBlock
      lastInvKinds = invKinds
      lastInvTotal = invTotal
    }
    const stalledMs = lastProgressAt ? Date.now() - lastProgressAt : 0
    /** 最告急的那件工具（并入处境行资产位；不再单独占行） */
    let lowDurDetail = ''

    // ② 内感受（门控：变了才报，危险必报）
    const hp = Math.round(n(bot.health, 20))
    const food = Math.round(n(bot.food, 20))
    const oxygen = Math.round(n(bot.oxygenLevel, 20))
    // 边沿触发 + 每 20 步补底：变化时报；仍处于危险态时定期重述，但绝不每步刷同一行。
    const refresh = stepCount % 20 === 0
    if (hp !== lastHp || (hp <= 8 && refresh)) {
      const d = lastHp >= 0 && hp < lastHp ? `（-${lastHp - hp}` : ''
      const who = Date.now() - lastAttackerAt < 15_000 && lastAttacker ? ` 被 ${lastAttacker}` : ''
      lines.push(`${clock.stamp} ♥生命 ${hp}/20${hp <= 8 ? ' ⚠重伤' : ''}${d ? d + (who ? `，${who.trim()}` : '') + '）' : who ? `（${who.trim()}）` : ''}`)
      lastHp = hp
    }
    if (food !== lastFood || (food <= 8 && refresh)) {
      lines.push(`${clock.stamp} 🍗饱食 ${food}/20${food <= 8 ? ' ⚠饥饿' : ''}`)
      lastFood = food
    }
    // oxygenLevel = air_supply/15 → 0..20（满 20）。≤10 提醒，≤5 才是真危险。
    if (oxygen <= 10 && (oxygen !== lastOxygen || refresh)) {
      lines.push(`${clock.stamp} 🫧氧气 ${oxygen}/20${oxygen <= 5 ? ' ⚠快要溺水，立刻上浮换气' : '（空气过半，留意上浮）'}`)
    }
    lastOxygen = oxygen

    // ③ 外感受·视：天气/维度/光照（变化时或危险时）
    const weather = weatherOf(bot)
    const wkey = weather.text || '晴'
    if (wkey !== lastWeather) { if (weather.text) lines.push(`${clock.stamp} ${weather.text}`); lastWeather = wkey }
    const dim = bot.game?.dimension ?? ''
    if (dim && dim !== lastDim) { if (lastDim) lines.push(`${clock.stamp} 维度变了：${lastDim} → ${dim}`); lastDim = dim }

    // ④ 时间感知：昼夜切换（精确边界）
    const phase = clock.isNight ? '夜' : '昼'
    if (lastDayPhase && phase !== lastDayPhase) lines.push(`${clock.stamp} ${clock.isNight ? '天黑了（怪物出没，注意回屋）' : '天亮了'}`)
    lastDayPhase = phase

    // ⑦ 背包容量（≥90% 才报一次，且只在跨越阈值时；捡不到东西是真压力）
    try {
      const slots = (bot.inventory as { slots?: unknown[] } | undefined)?.slots
      if (Array.isArray(slots) && slots.length) {
        const used = slots.filter((x) => x != null).length
        const ratio = used / slots.length
        if (ratio >= 0.9 && lastPackFull !== `${used}/${slots.length}`) {
          lines.push(`${clock.stamp} 🎒背包将满（${used}/${slots.length} 格）——再捡就装不下了，找箱子卸货或合成合并同类`)
          lastPackFull = `${used}/${slots.length}`
        } else if (ratio < 0.8) {
          lastPackFull = ''
        }
      }
    } catch { /* 容量读取失败不阻塞 */ }

    // ⑦ 装备耐久：不再单独占一行——并入处境行的资产位（同一事实只说一遍，实测查出过重复）

    // ⑤ 空间感知 · 认知边界（夜里 + 光暗 = 刷怪风险）
    try {
      if (clock.isNight) {
        const light = lightAt(bot)
        if (light && light.block <= 7 && light.sky <= 7) lines.push(`${clock.stamp} 🌑 这里光暗（方块光 ${light.block}）——夜里暗处会刷怪`)
      }
    } catch { /* 光照读取失败不阻塞 */ }

    // ⑦ 动作反馈：脉搏（最近动作 + 连续同类型）
    let repeatN = 0
    try {
      const acts = deps.recentActions().map(parseAction).filter((a): a is { type: string; detail: string; result: string } => !!a)
      if (acts.length) {
        const last = acts[acts.length - 1]
        for (let i = acts.length - 1; i >= 0; i--) {
          if (acts[i].type !== last.type) break
          repeatN++
        }
        lines.push(`${clock.stamp} 【最近动作】${last.type} ${last.detail} => ${last.result}${repeatN >= 2 ? ` —— 已连续 ${repeatN} 轮同类型` : ''}`)
      }
    } catch { /* 脉搏失败不阻塞 */ }

    // ⑧ 元认知：停滞 / 威胁态势 / 认知边界
    const posKey = `${Math.round(pos.x)},${Math.round(pos.z)}`
    samePosCount = posKey === lastPosKey ? samePosCount + 1 : 0
    lastPosKey = posKey
    const threat = threatState(bot, 24)
    const trav = travellers(bot)
    const loadedCols = (bot as unknown as { world?: { columns?: Record<string, unknown> } }).world?.columns
    const loaded = loadedCols ? Object.keys(loadedCols).length : -1
    // ⑧ 元认知：这一行**每步都有**，游戏时刻固定挂在这里（时间感知不随门控消失）。
    // 位置/威胁/旅人/感知范围合成一行；资产与风险（护甲/工具/包/饥荒/困死区）只在
    // 变化或危险时追加——实测出的 6 处重复就是这么消掉的。

    // ⑧ 派生感知 · 决策就绪的世界模型（判断下沉：零 token 的确定性判断，可单测可重放）
    try {
      const items = bot.inventory?.items?.() ?? []
      const slots = (bot.inventory as { slots?: unknown[] } | undefined)?.slots
      const slotsTotal = Array.isArray(slots) ? slots.length : -1
      const slotsUsed = Array.isArray(slots) ? slots.filter((x) => x != null).length : -1
      const held = (bot as unknown as { heldItem?: { name?: string } | null }).heldItem ?? null
      const equipment = (bot as unknown as { entity?: { equipment?: Array<{ name?: string } | null | undefined> } }).entity?.equipment ?? []
      let lowDur = 0
      try {
        for (const it of items) {
          const d = durabilityOf(it)
          if (d && d.ratio <= 0.25) {
            lowDur++
            const nm = (it as { name?: string }).name ?? '工具'
            if (!lowDurDetail || d.ratio < 0.15) lowDurDetail = `${nm} 耐久 ${d.left}/${d.max}`
          }
        }
      } catch { /* 耐久扫描失败不阻塞 */ }
      const wm = deriveWorldModel({
        now: Date.now(),
        hp, food,
        foodSaturation: (bot as unknown as { foodSaturation?: number }).foodSaturation,
        oxygen,
        pos: { x: pos.x, y: pos.y, z: pos.z },
        dim: (bot as unknown as { game?: { dimension?: string } }).game?.dimension,
        tod: clock.tod,
        isNight: clock.isNight,
        items,
        slotsTotal,
        slotsUsed,
        equipment,
        held,
        hostiles: collectHostiles(bot),
        threatFresh: true,
        deathZones: deps.deathZones?.() ?? [],
        stalledMs,
        lowDurabilityCount: lowDur,
      })
      lastWorld = wm
      // 通道新鲜度
      const t = Date.now()
      marks.vitals = t
      marks.threat = t
      marks.world = t
      marks.inventory = t
      if (social.length) marks.social = t
      // decision_trace：每步一份纯函数快照（慢循环可离线重放当时看到的世界）
      if (deps.dataDir && t - lastTraceAt >= 1000) {
        lastTraceAt = t
        appendJsonl(deps.dataDir, 'decision_trace.jsonl', {
          ts: new Date(t).toISOString(), stamp: clock.stamp, world: wm,
          freshness: freshnessReport(marks, t),
          recent: deps.recentActions().slice(-3),
        })
      }
    } catch { /* 世界模型失败不阻塞感知 */ }

    // ⑧ 元认知 · 锚点与进展量化（每 N 步一行，防上下文压缩后漂移）
    let hasWritingKit = false
    try {
      const items = bot.inventory?.items?.() ?? []
      // 写信工具（纸/书）——指导块用它判断「能不能给女神写信」
      hasWritingKit = items.some((i) => /paper|writable_book|book/.test((i as { name?: string }).name ?? ''))
      const kinds = items.length
      const total = items.reduce((s, i) => s + (typeof i === 'object' && i && 'count' in i ? Number((i as { count?: number }).count ?? 0) : 0), 0)
      if (anchorInv.kinds >= 0 && (kinds !== anchorInv.kinds || total !== anchorInv.total)) {
        const dk = kinds - anchorInv.kinds
        const dt = total - anchorInv.total
        pendingProgress = `【进展】背包 ${kinds} 类/${total} 件（较上次锚点 ${dk >= 0 ? '+' : ''}${dk} 类、${dt >= 0 ? '+' : ''}${dt} 件）`
      }
      if (stepCount % anchorEverySteps === 0) {
        if (pendingProgress) lines.push(pendingProgress)
        const top = items.slice(0, 6).map((i) => `${(i as { name?: string }).name}×${(i as { count?: number }).count ?? 1}`).join('，')
        lines.push(`【锚点】背包 ${kinds} 类/${total} 件${top ? `（${top}${items.length > 6 ? '…' : ''}）` : ''}`)
        anchorInv = { kinds, total }
        pendingProgress = ''
      }
    } catch { /* 锚点失败不阻塞 */ }

    sig = {
      hp, food, oxygen, isNight: clock.isNight, stuck: samePosCount >= 4, samePosCount,
      hostileNear: threat.count, freshChat: social.length > 0,
      hasWritingKit, position: { x: pos.x, y: pos.y, z: pos.z },
    }

    // ── 合成"态势行"：位置/威胁/旅人/感知范围（每步）＋ 资产与风险（变化或危险才追加）──
    {
      const bits: string[] = [`你在 (${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)})`]
      if (threat.count > 0) {
        bits.push(`威胁 ${threat.count} 个${threat.nearest ? `(最近 ${threat.nearest}${threat.ranged ? '·远程' : ''})` : ''}${threat.rangedAny && !threat.ranged ? '·另有远程' : ''}`)
      } else bits.push('无威胁')
      bits.push(`旅人 ${trav.total}${trav.nearby.length ? `(身边 ${trav.nearby.map((v) => `${v.dir}${v.d}格`).join('、')})` : ''}${trav.faraway ? `｜远处 ${trav.faraway}` : ''}${trav.unknown ? `｜方位未明 ${trav.unknown}` : ''}`)
      if (loaded >= 0) bits.push(`感知 ${loaded} 区块`)
      if (stalledMs >= 4 * 60_000) bits.push(`⚠${Math.round(stalledMs / 60_000)}min 无进展`)
      // 资产/风险：只在"变化 or 危险"时追加（避免每步重复同一串静态事实）
      const wm = lastWorld
      if (wm) {
        const asset: string[] = []
        if (wm.defense.weakDefense) asset.push('⚠无甲无盾')
        else if (wm.defense.armorPieces < 4) asset.push(`护甲 ${wm.defense.armorPieces}/4`)
        if (wm.stock.picks === 0) asset.push('⚠无镐')
        else if (wm.stock.picks < 3) asset.push(`⚠镐仅剩 ${wm.stock.picks}`)
        if (lowDurDetail) asset.push(`⚠${lowDurDetail}${wm.durability.lowCount > 1 ? `（另有 ${wm.durability.lowCount - 1} 件）` : ''}`)
        if (wm.stock.tier !== 'none') asset.push(`镐阶 ${wm.stock.tier}`)
        if (wm.stock.slotsTotal > 0) {
          const ratio = wm.stock.slotsUsed / wm.stock.slotsTotal
          if (ratio >= PACK_FULL_TRIGGER) asset.push(`⚠包将满(${wm.stock.emptySlots} 空)`)
        }
        if (wm.paralysis.starving) asset.push('⚠饥饿且无粮')
        if (wm.zone.insideDeathZone) asset.push(`⚠身处死亡区(中心距 ${wm.zone.zoneDistance}格)`)
        const stamp = asset.join('|')
        // 变化时报（边沿）；仍是危险态则每 20 步补一次 —— 静态事实绝不每步重复
        if (stamp !== assetStamp || (stepCount % 20 === 0 && asset.some((a) => a.startsWith('⚠')))) {
          bits.push(...asset)
          assetStamp = stamp
        }
      }
      lines.push(`${clock.stamp} 【处境】${bits.join('｜')}`)
    }

    return lines.join('\n')
  }

  return {
    status,
    signals: () => sig,
    pending: () => queue.length,
    freshness: () => freshnessReport(marks, Date.now()),
    lastWorldModel: () => lastWorld,
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// 派生感知 / 世界模型（decision-ready 单一快照）
// 借鉴 neko `core/worldModel.mjs`：把"判断"从模型中挪到确定性代码里（零 token、可单测、可重放）。
// 本函数是**纯函数**：不读 bot、不读文件、不看时钟（now 由调用方注入）⇒ 当时的快照可离线重放。
// ─────────────────────────────────────────────────────────────────────────────

/** 低于此饱食度且没有可吃的东西 = 饥饿压力（neko worldModel LOW_FOOD=6）。 */
export const LOW_FOOD = 6
/** 包将满迟滞：≥95% 触发、<80% 释放（neko 用 trigger/release 成对，避免阈值抖动）。 */
export const PACK_FULL_TRIGGER = 0.95
export const PACK_FULL_RELEASE = 0.8
/** 可动威胁口径（neko modes.js：d<12 且 |dy|<=4；墙外/够不到的怪不算 LETHAL）。 */
export const THREAT_ACTIONABLE_D = 12
export const THREAT_ACTIONABLE_DY = 4
/** 贴脸苦力怕距离（neko：creeperD < 4.5 时连"安全待命"都不算）。 */
export const CREEPER_PANIC_D = 4.5
/** 射手纵向阈值（neko：ranged && dy < 8 视为可动威胁——箭能打上来）。 */
export const RANGED_DY = 8
/** 卡死判据（neko paralysis）：8 分钟无进展 / 4 分钟困在死亡区。 */
export const STALL_LONG_MS = 8 * 60_000
export const STALL_DEATHZONE_MS = 4 * 60_000
/** 饱食度"备足"线（neko FOOD_STOCK=16：不只是活着，是"有余量"）。 */
export const FOOD_STOCK = 16

/** 可食用**白名单**（保守；宁缺毋滥——把不能吃的当能吃的会喂出伤害）。 */
const RATION_RE = /^(cooked_\w+|bread|apple|baked_potato|carrot|golden_apple|golden_carrot|beef|porkchop|mutton|chicken|rabbit|cod|salmon|tropical_fish|melon_slice|cookie|pumpkin_pie|sweet_berries|glow_berries|dried_kelp|mushroom_stew|rabbit_stew|beetroot_soup|beetroot|potato|honey_bottle|steak)$/
/** 明确**不可食用/有害**黑名单（neko 同款；即使名字看着像食物也排除）。 */
const NOT_FOOD_RE = /^(spider_eye|poisonous_potato|pufferfish|rotten_flesh|raw_copper|raw_iron|raw_gold|bone|string|gunpowder|fermented_spider_eye|suspicious_stew)$/

export function isEdibleName(name: string): boolean {
  if (!name) return false
  const n = name.replace(/^minecraft:/, '')
  if (NOT_FOOD_RE.test(n)) return false
  return RATION_RE.test(n)
}

export interface StockSummary {
  /** 背包已用格 / 总格 / 空余格（neko 用 emptySlotCount()<=4 判"包将满"）。 */
  slotsUsed: number
  slotsTotal: number
  emptySlots: number
  /** 木材等价单位（1 log = 4 planks，neko woodUnits 口径）。 */
  woodUnits: number
  /** 可食用份数 + 是否还有吃的。 */
  rations: number
  hasEdible: boolean
  /** 铁料（原铁 + 铁锭，neko ironForArmor 口径）。 */
  ironForArmor: number
  /** 镐子总数（neko 备镐不变量 REPLENISH_PICKS_MIN=3）。 */
  picks: number
  /** 工具层级（技术进度的一等派生量）。 */
  tier: 'none' | 'wood' | 'stone' | 'iron' | 'diamond' | 'netherite'
}

const TIER_RANK: Record<string, number> = { none: 0, wood: 1, wooden: 1, golden: 1, stone: 2, iron: 3, diamond: 4, netherite: 5 }

/** 从背包清单派生物资概览（纯函数）。 */
export function stockFrom(items: Array<{ name?: string; count?: number }>, slotsTotal = -1, slotsUsed = -1): StockSummary {
  let wood = 0, rations = 0, iron = 0, picks = 0
  let tier: StockSummary['tier'] = 'none'
  for (const it of items) {
    const name = (it?.name ?? '').replace(/^minecraft:/, '')
    const c = Number(it?.count ?? 0)
    if (!name || !c) continue
    if (/_log$/.test(name)) wood += c * 4
    else if (/_planks$/.test(name)) wood += c
    if (isEdibleName(name)) rations += c
    if (name === 'raw_iron' || name === 'iron_ingot') iron += c
    if (/_pickaxe$/.test(name)) {
      picks += c
      const mat = name.replace(/_pickaxe$/, '')
      if ((TIER_RANK[mat] ?? 0) > (TIER_RANK[tier] ?? 0)) tier = mat as StockSummary['tier']
    }
  }
  const empty = slotsTotal > 0 && slotsUsed >= 0 ? Math.max(0, slotsTotal - slotsUsed) : -1
  return { slotsUsed, slotsTotal, emptySlots: empty, woodUnits: wood, rations, hasEdible: rations > 0, ironForArmor: iron, picks, tier }
}

/** 防御姿态（neko：头号死因是没穿甲跟僵尸打）。纯函数。 */
export function defenseFrom(equipment: Array<{ name?: string } | null | undefined>, held: { name?: string } | null): {
  armorPieces: number; hasShield: boolean; hasWeapon: boolean; weakDefense: boolean
} {
  const armorRe = /(helmet|chestplate|leggings|boots)$/
  const armorPieces = equipment.filter((e) => !!e && armorRe.test((e.name ?? '').replace(/^minecraft:/, ''))).length
  const hasShield = equipment.some((e) => (e?.name ?? '').replace(/^minecraft:/, '') === 'shield')
  const heldName = (held?.name ?? '').replace(/^minecraft:/, '')
  const hasWeapon = /(_sword|_axe|trident|bow|crossbow)$/.test(heldName) || equipment.some((e) => /(_sword|trident)$/.test((e?.name ?? '').replace(/^minecraft:/, '')))
  return { armorPieces, hasShield, hasWeapon, weakDefense: armorPieces === 0 && !hasShield }
}

export interface ThreatBreakdown {
  /** 24 格内敌对总数（neko 用 24：超过怪的 16 格仇恨半径 ⇒ 先手知情）。 */
  raw: number
  /** 可动威胁（d<12 且 |dy|<=4）——墙外/够不到的怪不算。 */
  actionable: number
  /** 其外层威胁（看得到但够不到/在高处）。 */
  layered: number
  nearest: number
  nearestLabel: string
  /** 最近的苦力怕距离（neko：贴脸苦力怕改变一切）。 */
  creeperDist: number
  /** 是否含射手（纵向 8 格内也算够得着）。 */
  rangedThreat: boolean
  /** 数据是否新鲜；不新鲜时**明确标注**而不是静默使用。 */
  fresh: boolean
}

/**
 * 威胁分级（纯函数）。
 * fail-safe 纪律（neko）：拿不准就当"够得着"，绝不因为不确定而降低警惕。
 */
export function threatBreakdown(input: {
  pos: { x: number; y: number; z: number }
  hostiles: Array<{ name?: string; x: number; y: number; z: number }>
  fresh?: boolean
}): ThreatBreakdown {
  const p = input.pos
  let raw = 0, actionable = 0, layered = 0, nearest = Number.POSITIVE_INFINITY, creeper = Number.POSITIVE_INFINITY
  let nearestLabel = '', rangedThreat = false
  for (const h of input.hostiles) {
    const name = (h?.name ?? '')
    const d = Math.hypot(h.x - p.x, h.z - p.z)
    const dy = Math.abs(h.y - p.y)
    raw++
    if (d < nearest) { nearest = d; nearestLabel = `${name} ${relDir8(h.x - p.x, h.z - p.z)}${Math.round(d)}格` }
    if (/creeper/.test(name) && d < creeper) creeper = d
    const ranged = /skeleton|stray|pillager|witch|blaze|ghast|bogged/.test(name)
    if (ranged && dy < RANGED_DY) rangedThreat = true
    // 可动口径（neko）：**水平距离是硬门**（d<12），纵向对近战放宽到 4、对射手放宽到 8。
    // 反例（本规则修掉的真 bug）：30 格外的骷髅曾被算成"可动"——只因它纵向对得上。
    const isActionable = d < THREAT_ACTIONABLE_D && (dy <= THREAT_ACTIONABLE_DY || (ranged && dy < RANGED_DY))
    if (isActionable) actionable++
    else layered++
  }
  return {
    raw, actionable, layered,
    nearest: Number.isFinite(nearest) ? Math.round(nearest) : -1,
    nearestLabel: nearestLabel || '无',
    creeperDist: Number.isFinite(creeper) ? Math.round(creeper * 10) / 10 : -1,
    rangedThreat,
    fresh: input.fresh !== false,
  }
}

export interface WorldModelInput {
  now: number
  hp: number
  food: number
  foodSaturation?: number
  oxygen?: number
  pos: { x: number; y: number; z: number }
  dim?: string
  tod?: number
  isNight: boolean
  items: Array<{ name?: string; count?: number }>
  slotsTotal?: number
  slotsUsed?: number
  equipment: Array<{ name?: string } | null | undefined>
  held: { name?: string } | null
  hostiles: Array<{ name?: string; x: number; y: number; z: number }>
  threatFresh?: boolean
  /** 死亡热点簇（neko dzone：圆心 + 半径；用它判"我是否正站在死亡区里"）。 */
  deathZones?: Array<{ x: number; z: number; r?: number; count?: number }>
  /** 身体多久没有实质进展（ms）。 */
  stalledMs?: number
  /** 耐久告急的工具数。 */
  lowDurabilityCount?: number
}

export interface WorldModel {
  ts: number
  self: { hp: number; food: number; pos: { x: number; y: number; z: number }; dim: string; isNight: boolean; tod: number | null }
  stock: StockSummary
  defense: { armorPieces: number; hasShield: boolean; hasWeapon: boolean; weakDefense: boolean }
  threat: ThreatBreakdown
  zone: { insideDeathZone: boolean; zoneCount: number; zoneDistance: number | null }
  /** 派生瘫痪信号：低食无粮 / 长时间无进展 / 困死区——都不是"安全待命"。 */
  paralysis: { starving: boolean; longStall: boolean; trappedInDeathZone: boolean; stalledMs: number }
  durability: { lowCount: number }
  /** 阈值随快照一起带出，便于测试与复盘（neko 的 constants 做法）。 */
  constants: Record<string, number | string>
}

/** 构建决策就绪的单一快照。**纯函数**：同样的输入永远得到同样的输出，可离线重放。 */
export function deriveWorldModel(t: WorldModelInput): WorldModel {
  const stock = stockFrom(t.items ?? [], t.slotsTotal ?? -1, t.slotsUsed ?? -1)
  const defense = defenseFrom(t.equipment ?? [], t.held ?? null)
  const threat = threatBreakdown({ pos: t.pos, hostiles: t.hostiles ?? [], fresh: t.threatFresh })
  let inside = false

  let zoneCount = 0
  let zoneDistance: number | null = null
  for (const z of t.deathZones ?? []) {
    if (!z) continue
    const d = Math.hypot(t.pos.x - z.x, t.pos.z - z.z)
    if (zoneDistance === null || d < zoneDistance) zoneDistance = Math.round(d)
    if (d <= (z.r ?? 24)) { inside = true; zoneCount++ }
  }
  const stalledMs = t.stalledMs ?? 0
  const paralysis = {
    starving: t.food <= LOW_FOOD && !stock.hasEdible,
    longStall: stalledMs >= STALL_LONG_MS,
    trappedInDeathZone: inside && stalledMs >= STALL_DEATHZONE_MS,
    stalledMs,
  }
  return {
    ts: t.now,
    self: { hp: t.hp, food: t.food, pos: t.pos, dim: t.dim ?? '未知', isNight: t.isNight, tod: t.tod ?? null },
    stock, defense, threat,
    zone: { insideDeathZone: inside, zoneCount, zoneDistance },
    paralysis,
    durability: { lowCount: t.lowDurabilityCount ?? 0 },
    constants: {
      LOW_FOOD, PACK_FULL_TRIGGER, PACK_FULL_RELEASE, THREAT_ACTIONABLE_D, THREAT_ACTIONABLE_DY,
      CREEPER_PANIC_D, RANGED_DY, STALL_LONG_MS, STALL_DEATHZONE_MS, FOOD_STOCK,
    },
  }
}

/** 把世界模型渲染成一行决策就绪文本（判断下沉，但要让模型一眼看见）。 */
export function renderWorldModel(wm: WorldModel): string {
  const bits: string[] = []
  const stock = wm.stock
  if (stock.slotsTotal > 0 && stock.emptySlots >= 0) {
    const ratio = stock.slotsUsed / stock.slotsTotal
    if (ratio >= PACK_FULL_TRIGGER) bits.push(`包将满(${stock.emptySlots} 空)`)
    else if (ratio >= PACK_FULL_RELEASE) bits.push(`包偏满(${stock.emptySlots} 空)`)
  }
  if (wm.stock.hasEdible) bits.push(`粮食 ${wm.stock.rations}`)
  else if (wm.self.food <= FOOD_STOCK) bits.push(`⚠无粮(饱食${wm.self.food})`)
  if (wm.defense.weakDefense) bits.push('⚠无甲无盾')
  else if (wm.defense.armorPieces < 4) bits.push(`护甲 ${wm.defense.armorPieces}/4`)
  if (wm.stock.picks >= 3) bits.push(`备镐 ${wm.stock.picks}`)
  else if (wm.stock.picks > 0) bits.push(`⚠镐仅剩 ${wm.stock.picks}`)
  bits.push(`镐阶 ${wm.stock.tier}`)
  if (wm.durability.lowCount > 0) bits.push(`⚠${wm.durability.lowCount} 件工具耐久告急`)
  if (!wm.threat.fresh) bits.push('⚠威胁数据过期(按未知处理)')
  if (wm.threat.raw > 0) {
    bits.push(`威胁 可动${wm.threat.actionable}/层外${wm.threat.layered}(最近 ${wm.threat.nearestLabel})`)
  }
  if (wm.threat.creeperDist >= 0 && wm.threat.creeperDist <= CREEPER_PANIC_D * 2) bits.push(`⚠苦力怕 ${wm.threat.creeperDist}格`)
  if (wm.zone.insideDeathZone) bits.push(`⚠身处死亡区(第${wm.zone.zoneCount}处，中心距 ${wm.zone.zoneDistance}格)`)
  const p = wm.paralysis
  if (p.starving) bits.push('⚠饥饿且无粮')
  if (p.trappedInDeathZone) bits.push('⚠困死区>4min')
  else if (p.longStall) bits.push('⚠>8min 无进展')
  return `【世界模型】${bits.join('｜')}`
}

// ─────────────────────────────────────────────────────────────────────────────
// 感知新鲜度契约（neko fresh_status.mjs：每路声明 TTL + live/stale 标注 + 总体分类）
// 纪律：陈旧数据**永远标注**，绝不静默使用；不确定按最保守方向处理。
// ─────────────────────────────────────────────────────────────────────────────

export const CHANNEL_TTL_MS: Record<string, number> = {
  vitals: 45_000,     // 自身体征（neko vitals 45s）
  threat: 45_000,     // 威胁雷达（neko radar 45s）
  social: 120_000,    // 聊天/NPC（neko events 120s）
  world: 120_000,     // 世界状态（neko progress 120s）
  inventory: 60_000,  // 背包
}

export interface FreshnessReport {
  live: Record<string, boolean>
  ages: Record<string, number | null>
  classification: 'live' | 'partial' | 'stale' | 'offline'
  staleChannels: string[]
}

/** 汇总各感知通道的新鲜度（纯函数，便于单测）。 */
export function freshnessReport(marks: Record<string, number | null>, now: number): FreshnessReport {
  const live: Record<string, boolean> = {}
  const ages: Record<string, number | null> = {}
  const stale: string[] = []
  for (const [k, ttl] of Object.entries(CHANNEL_TTL_MS)) {
    const at = marks[k]
    const age = typeof at === 'number' ? Math.max(0, now - at) : null
    ages[k] = age
    const ok = age !== null && age <= ttl
    live[k] = ok
    if (!ok) stale.push(k)
  }
  const freshCount = Object.values(live).filter(Boolean).length
  const classification: FreshnessReport['classification'] =
    freshCount === 0 ? 'offline' : stale.length === 0 ? 'live' : freshCount >= 2 ? 'partial' : 'stale'
  return { live, ages, classification, staleChannels: stale }
}

// ─────────────────────────────────────────────────────────────────────────────
// 观测账本（Cortico FindObservationCache + neko 资源节点账本）
// 作用域 = 连接代次 + 维度：跨界一律作废（重连/换维度后"我记得那儿有铁"不再成立）。
// 每次召回**必带 ageMs** ⇒ 调用方永远知道这条记忆多旧。
// ─────────────────────────────────────────────────────────────────────────────

export interface ObservationScope { connectionGeneration: number; dimension: string }

interface ObservedFinding {
  kind: 'block' | 'entity'
  target: string
  at: [number, number, number]
  observedAt: number
  depleted?: boolean
}

export class ObservationLedger {
  private entries = new Map<string, ObservedFinding>()
  private activeScope = ''
  constructor(
    private readonly ttlMs = 15 * 60_000,   // Cortico：HISTORY_TTL_MS = 15min
    private readonly limit = 128,           // Cortico：HISTORY_LIMIT = 128
  ) {}

  sync(scope: ObservationScope): void {
    const next = `${scope.connectionGeneration}|${scope.dimension}`
    if (this.activeScope && this.activeScope !== next) this.entries.clear()  // 跨界即清空
    this.activeScope = next
  }

  remember(scope: ObservationScope, kind: 'block' | 'entity', target: string, at: [number, number, number], now = Date.now()): void {
    this.sync(scope)
    this.purge(now)
    const key = `${kind}|${target.replace(/^minecraft:/, '').toLowerCase()}`
    this.entries.delete(key)
    this.entries.set(key, { kind, target, at, observedAt: now })
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value as string)
  }

  markDepleted(scope: ObservationScope, target: string, now = Date.now()): void {
    this.sync(scope)
    const key = `block|${target.replace(/^minecraft:/, '').toLowerCase()}`
    const hit = this.entries.get(key)
    if (hit) { hit.depleted = true; hit.observedAt = now }
  }

  recall(scope: ObservationScope, target: string, kind: 'block' | 'entity' = 'block', now = Date.now()): { at: [number, number, number]; ageMs: number; depleted: boolean } | null {
    this.sync(scope)
    this.purge(now)
    const hit = this.entries.get(`${kind}|${target.replace(/^minecraft:/, '').toLowerCase()}`)
    if (!hit) return null
    return { at: hit.at, ageMs: Math.max(0, now - hit.observedAt), depleted: !!hit.depleted }
  }

  nearest(scope: ObservationScope, from: { x: number; z: number }, kind: 'block' | 'entity' = 'block', now = Date.now()): { target: string; at: [number, number, number]; ageMs: number; distance: number } | null {
    this.sync(scope)
    this.purge(now)
    let best: { target: string; at: [number, number, number]; ageMs: number; distance: number } | null = null
    for (const e of this.entries.values()) {
      if (e.kind !== kind || e.depleted) continue
      const d = Math.hypot(e.at[0] - from.x, e.at[2] - from.z)
      if (!best || d < best.distance) best = { target: e.target, at: e.at, ageMs: Math.max(0, now - e.observedAt), distance: Math.round(d) }
    }
    return best
  }

  size(): number { return this.entries.size }

  private purge(now: number): void {
    for (const [k, v] of this.entries) if (now - v.observedAt > this.ttlMs) this.entries.delete(k)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 读数指纹 + 一轮一答闸（Cortico readouts.ts）
// 指纹**不含时钟**：会随时间变的字段进指纹 = 这道闸等于不存在。
// ─────────────────────────────────────────────────────────────────────────────

/** 背包指纹（槽位占用 + 物品清单 + 手持 + 装备，全部排序后拼）。 */
export function bagStamp(s: { items: Array<{ name?: string; count?: number }>; slotsUsed: number; slotsTotal: number; held?: string | null; equipment?: Array<{ name?: string } | null | undefined> }): string {
  return [
    `${s.slotsUsed}/${s.slotsTotal}`,
    s.items.map((i) => `${i.name}×${i.count}`).sort().join(','),
    s.held ?? 'bare',
    (s.equipment ?? []).map((e) => e?.name ?? '-').sort().join(','),
  ].join('|')
}

/** 世界模型指纹（**不含 ts**）。 */
export function worldStamp(wm: WorldModel): string {
  return [
    wm.self.hp, wm.self.food, wm.self.pos.x, wm.self.pos.y, wm.self.pos.z, wm.self.isNight ? 'N' : 'D',
    wm.stock.slotsUsed, wm.stock.tier, wm.defense.armorPieces,
    wm.threat.raw, wm.threat.actionable, wm.threat.nearest,
    wm.zone.insideDeathZone ? 'Z' : '-', wm.paralysis.starving ? 'S' : '-',
  ].join('|')
}

/** 一轮一答闸：同一份读数在窗口内重复问 → 返回 true（调用方回一句「已答过」）。 */
export function createReadoutGate(windowMs = 120_000) {
  const seen = new Map<string, { stamp: string; at: number }>()
  return {
    /** @returns true = 这份读数刚才答过且没变，可以只回一句「上面已经答过了」。 */
    duplicate(kind: string, stamp: string, now = Date.now()): boolean {
      const prev = seen.get(kind)
      if (prev && prev.stamp === stamp && now - prev.at <= windowMs) return true
      seen.set(kind, { stamp, at: now })
      return false
    },
    reset(kind?: string): void { if (kind) seen.delete(kind); else seen.clear() },
  }
}
