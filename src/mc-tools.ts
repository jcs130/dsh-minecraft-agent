import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Bot, Chest, Dispenser, EnchantmentTable, EquipmentDestination, Furnace, Villager } from 'mineflayer'
import type { Block } from 'prismarine-block'
import pf from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'
import { chromium } from 'playwright-core'
import type { Browser, Page } from 'playwright-core'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { captureFirstPerson, captureLookaround } from './mc-camera'
import { setLastImage, setLastImages } from './mc-vision'

export const name = 'mc-tools'
export const inject = ['tools', 'mcbot']

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function text(value: unknown) {
  return [{ type: 'text' as const, text: String(value) }]
}

type Args = Record<string, unknown>
type ToolExecutor = (args: Args) => Promise<string>

/**
 * Wraps every tool body with a safety net so a single exception can never
 * hang the agent or crash the runtime: it reports the error as a string
 * instead of throwing. Also short-circuits when the bot is not alive.
 */
function guard(bot: Bot, fn: ToolExecutor): ToolExecutor {
  return async (args: Args) => {
    try {
      if (!bot.entity) return 'bot is not connected / has not spawned yet'
      return await fn(args)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return `tool error: ${msg}`
    }
  }
}

/** Hard-reset pathfinder state so a wedge can never silently survive a failed goto. */
function hardResetPathfinder(bot: Bot): void {
  try { bot.pathfinder.setGoal(null) } catch { /* no goal */ }
  try { bot.pathfinder.stop() } catch { /* not running */ }
  try { bot.clearControlStates() } catch { /* no controls */ }
  // Re-seed Movements: drops any poisoned collision index / cached planner state.
  try { bot.pathfinder.setMovements(new pf.Movements(bot)) } catch { /* plugin not ready */ }
}

/**
 * Physics round-trip: a jump pulse makes the server send back a position
 * correction, which cures the vertical desync behind the
 * DEFECT-20260818-043636 wedge (pathfinder waiting for a 1-block drop that
 * local physics never performs).
 */
async function resyncPulse(bot: Bot): Promise<void> {
  try {
    bot.setControlState('jump', true)
    await sleep(400)
    bot.setControlState('jump', false)
    await sleep(500)
  } catch { /* ignore */ }
}

/**
 * Pathfind near a position, with a timeout so it can never block forever.
 *
 * 2026-08-16 事故教训：一次静默失败吞掉了真实错误，物理/寻路状态卡死后
 * 连续 400+ 步 goto 全部失败在起点，bot 靠 tp 咒语空烧上千魔力。必须报错留痕。
 *
 * 2026-08-18 DEFECT-20260818-043636：Naruto 在 (-115,65,177) 实体 y 与真实
 * 地面脱同步（自报 65.0，真地面 64.0，实测同位置复现 bot 秒落到 64.0）。
 * pathfinder 算出的路径首节点是"落回原地"，本地物理却认为脚下有支撑 →
 * 位置永不前进 → pathfinder 内部 3.5s resetPath('stuck') 死循环重算同一条
 * 路 → goto() promise 永不产生终态事件（无 path_update 终态、无
 * goal_reached、无异常）→ 工具层盲超时 30s×5 次、moved=0.00，最终靠魔法
 * tp 烧资源逃逸；tp 走脱后 goto 立刻全部恢复正常。
 *
 * 加固：进度看门狗每 1.5s 采样——pathfinder 自称在走（isMoving）且不在
 * 挖/放方块、但实体位移无累计进展，连续 3 个采样（4.5s，高于 pathfinder
 * 自身 3.5s stuck-reset 一个周期）即判楔死并提前中止；任何失败路径统一
 * 硬复位（清 goal + 重播 Movements）+ 跳跃脉冲强制服务器回发位置校正；
 * 确认楔死时原地重试一次（fresh state，预算 10s），普通失败（无路/超时
 * 有进展）不重试不额外耗时。
 */
async function gotoNear(bot: Bot, pos: Vec3, reach: number, timeoutMs = 20_000): Promise<boolean> {
  const attempt = async (budgetMs: number): Promise<{ reached: boolean; wedged: boolean }> => {
    const goal = new pf.goals.GoalNear(pos.x, pos.y, pos.z, reach)
    const startPos = bot.entity!.position.clone()
    let bestProgress = 0
    let stallTicks = 0
    let settled = false
    let abort: (() => void) | null = null
    const abortPromise = new Promise<never>((_, reject) => {
      abort = () => reject(new Error('movement wedged: pathfinder active but position frozen'))
    })
    const gotoPromise = bot.pathfinder.goto(goal)
    gotoPromise.catch(() => { /* late rejection after settle is expected */ })
    const watchdog = setInterval(() => {
      if (settled || !abort) return
      const moved = bot.entity!.position.distanceTo(startPos)
      if (moved > bestProgress + 0.4) {
        bestProgress = moved
        stallTicks = 0
      } else if (bot.pathfinder.isMoving() && !bot.pathfinder.isMining() && !bot.pathfinder.isBuilding()) {
        stallTicks++
        if (stallTicks >= 3) abort()
      } else {
        stallTicks = 0
      }
    }, 1_500)
    try {
      await Promise.race([
        gotoPromise,
        abortPromise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('pathfinding timed out')), budgetMs),
        ),
      ])
      settled = true
      return { reached: true, wedged: false }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const moved = bot.entity!.position.distanceTo(startPos)
      const wedged = stallTicks >= 2
      console.error(`[mc-tools] gotoNear FAIL: ${msg} | moved=${moved.toFixed(2)} target=(${pos.x},${pos.y},${pos.z}) reach=${reach}${wedged ? ' | WEDGE detected' : ''}`)
      return { reached: false, wedged }
    } finally {
      settled = true
      clearInterval(watchdog)
      // 无论成败都不留僵尸状态：楔死/超时的 goal 绝不允许存活到下一次调用
      try { bot.pathfinder.setGoal(null) } catch { /* no goal */ }
      try { bot.clearControlStates() } catch { /* no controls */ }
    }
  }

  const first = await attempt(timeoutMs)
  if (first.reached) return true
  // 失败统一善后：硬复位 + 物理脉冲，保证下一次调用从干净状态开始
  hardResetPathfinder(bot)
  await resyncPulse(bot)
  // 只有确认楔死才值得原地重试：普通失败（无路/有进展的超时）重试无意义
  if (!first.wedged) return false
  const second = await attempt(10_000)
  if (!second.reached) hardResetPathfinder(bot)
  return second.reached
}

/**
 * Pathfind to a horizontal (x,z) position, ignoring y. This is the correct
 * way to reach a dropped item: items often rest inside the hole left by a
 * freshly dug block (1-2 blocks below the bot's feet), and targeting their
 * full 3D position makes the pathfinder stall at the hole's edge. Aligning
 * only x,z puts the bot directly above the item, well within the ~1.5-block
 * pickup range.
 */
async function gotoXZ(bot: Bot, x: number, z: number, range: number, timeoutMs = 15_000): Promise<boolean> {
  const goal = new pf.goals.GoalNearXZ(x, z, range)
  try {
    await Promise.race([
      bot.pathfinder.goto(goal),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('pathfinding timed out')), timeoutMs),
      ),
    ])
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[mc-tools] gotoXZ FAIL: ${msg} | target=(${x},${z}) range=${range}`)
    // 同 gotoNear：失败不留楔死状态（DEFECT-20260818-043636 家族）
    hardResetPathfinder(bot)
    return false
  }
}

/** Move close to the nearest dropped item so it gets picked up. */
async function pickupNearby(bot: Bot): Promise<void> {
  const before = bot.inventory.items().reduce((s, i) => s + i.count, 0)
  // Give an already-adjacent drop a moment to be auto-picked up first.
  await sleep(300)
  if (bot.inventory.items().reduce((s, i) => s + i.count, 0) > before) return
  const item = bot.nearestEntity(
    (e) => e.name === 'item' && bot.entity!.position.distanceTo(e.position) < 8,
  )
  if (!item) return
  // Align x,z only (not y): the item may be in a hole below the bot.
  await gotoXZ(bot, item.position.x, item.position.z, 0.5)
  await sleep(300)
}

/** Equip the best melee weapon available (sword > axe > pickaxe > shovel). */
async function equipBestWeapon(bot: Bot): Promise<void> {
  const weapons = bot.inventory
    .items()
    .filter((i) => i.name.includes('sword') || i.name.includes('axe'))
  if (weapons.length === 0) return
  weapons.sort((a, b) => (b as any).attackDamage - (a as any).attackDamage)
  const weapon = weapons[0]
  if (weapon) await bot.equip(weapon, 'hand')
}

/** Craft an item, walking to a nearby crafting table if the recipe needs one. */
async function craftItem(bot: Bot, itemName: string, count: number): Promise<string> {
  const item = bot.registry.itemsByName[itemName]
  if (!item) return `unknown item: ${itemName}`

  // craftingTable=true keeps table-requiring recipes (false/null would filter them out).
  const allRecipes = bot.recipesAll(item.id, null, true)
  if (allRecipes.length === 0) return `no recipe for ${itemName}`

  // Result count is identical across recipe variants for the same item.
  const resultCount = allRecipes[0]!.result.count

  // If any variant needs a table, walk to the nearest one first.
  let table: any = null
  if (allRecipes.some((r) => r.requiresTable)) {
    const tableBlock = bot.findBlock({
      matching: (b) => !!b && b.name === 'crafting_table',
      maxDistance: 16,
    })
    if (!tableBlock) return `crafting ${itemName} needs a crafting table, but none is within 16 blocks`
    const reached = await gotoNear(bot, tableBlock.position, 3)
    if (!reached) return 'could not reach the crafting table'
    table = tableBlock
  }

  // Pick a variant whose ingredients we actually hold (e.g. cherry vs oak planks).
  const feasible = bot.recipesFor(item.id, null, count * resultCount, table)
  if (feasible.length === 0) {
    const missing = allRecipes[0]!.delta
      .filter((d) => d.count < 0)
      .map((d) => {
        const nm = bot.registry.items[d.id]?.name ?? `id:${d.id}`
        return `${nm} x${Math.abs(d.count) * Math.ceil(count / resultCount)}`
      })
      .join(', ')
    return `not enough ingredients to craft ${count} ${itemName}; missing: ${missing || 'unknown'}`
  }
  const recipe = feasible[0]!

  try {
    await bot.craft(recipe, count, table)
  } catch (err) {
    return `craft failed: ${err instanceof Error ? err.message : String(err)}`
  }
  return `crafted ${count} ${itemName}`
}

// ── Storage (chest / barrel / trapped chest / hopper / dropper / dispenser) ──
// 2026-08-17 缺陷复盘（桐人 #294-#319 卡死 25 步）：旧列表只认 chest/barrel，
// 熔炉/高炉/烟熏炉完全不在工具认知里，bot 对着脚下熔炉反复 view/put_chest 全报
// "no chest/barrel found"，最后被迫烧魔力造物变铁锭。容器认知按 mineflayer
// openContainer 的真实能力对齐：hopper/dropper/dispenser 同样可开可存取。
const STORAGE_BLOCKS = ['chest', 'barrel', 'trapped_chest', 'hopper', 'dropper', 'dispenser']
/** 熔炉家族：mineflayer openFurnace 官方支持这三种窗口（plugins/furnace.js 实证）。 */
const FURNACE_BLOCKS = ['furnace', 'blast_furnace', 'smoker']

/** Extract optional integer coordinates from tool args (used to target a specific chest). */
function coordArgs(args: Args): { x: number | undefined; y: number | undefined; z: number | undefined } {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : undefined)
  return { x: num(args.x), y: num(args.y), z: num(args.z) }
}

/**
 * Resolve a storage block. When x/y/z are all given, that exact block is used
 * (must be a storage block); otherwise the nearest storage block within range
 * is found, so the bot can deposit/withdraw without knowing coordinates.
 */
function findStorageBlock(bot: Bot, args: Args, range: number): Block | null {
  const { x, y, z } = coordArgs(args)
  if (x !== undefined && y !== undefined && z !== undefined) {
    const b = bot.blockAt(new Vec3(x, y, z))
    return b && STORAGE_BLOCKS.includes(b.name) ? b : null
  }
  return (
    bot.findBlock({
      matching: (b) => !!b && STORAGE_BLOCKS.includes(b.name),
      maxDistance: range,
    }) ?? null
  )
}

/**
 * Resolve a furnace-family block the same way findStorageBlock resolves
 * chests: exact coords when given, otherwise the nearest one within range.
 */
export function findFurnaceBlock(bot: Bot, args: Args, range: number): Block | null {
  const { x, y, z } = coordArgs(args)
  if (x !== undefined && y !== undefined && z !== undefined) {
    const b = bot.blockAt(new Vec3(x, y, z))
    return b && FURNACE_BLOCKS.includes(b.name) ? b : null
  }
  return (
    bot.findBlock({
      matching: (b) => !!b && FURNACE_BLOCKS.includes(b.name),
      maxDistance: range,
    }) ?? null
  )
}

/**
 * Build the "no container" error message, but teach instead of just failing:
 * if the target (or the nearest interactive block) is a furnace, point the
 * bot at mc_smelt / mc_view_furnace. This hint alone would have saved the
 * 25-step furnace death-loop of 2026-08-17.
 */
function noContainerMessage(bot: Bot, args: Args, range: number): string {
  const { x, y, z } = coordArgs(args)
  if (x !== undefined && y !== undefined && z !== undefined) {
    const b = bot.blockAt(new Vec3(x, y, z))
    if (b && FURNACE_BLOCKS.includes(b.name)) {
      return `(${x}, ${y}, ${z}) is a ${b.name}, not a chest — use mc_smelt to smelt items in it, or mc_view_furnace to look inside`
    }
    if (b && (b.name === 'enchanting_table' || b.name === 'enchantment_table')) {
      return `(${x}, ${y}, ${z}) is an enchanting table, not a chest — use mc_enchant to enchant items there`
    }
    if (b) {
      return `(${x}, ${y}, ${z}) is a ${b.name}, not a container this tool can open`
    }
    return `no block at (${x}, ${y}, ${z}) — chunk not loaded or wrong coordinates`
  }
  // No coords given: scan for a furnace within the same range and hint at it.
  const f = bot.findBlock({
    matching: (blk) => !!blk && FURNACE_BLOCKS.includes(blk.name),
    maxDistance: range,
  })
  if (f) {
    return `no chest/barrel found nearby, but there is a ${f.name} at (${f.position.x}, ${f.position.y}, ${f.position.z}) — use mc_smelt on it`
  }
  return 'no chest/barrel found nearby (give x/y/z, or move closer to one)'
}

/** Walk to a storage block and open it; the caller is responsible for close(). */
async function openStorage(bot: Bot, block: Block): Promise<Chest | Dispenser> {
  const reached = await gotoNear(bot, block.position, 3)
  if (!reached) throw new Error('could not reach the container')
  return openWithRetry(() => bot.openContainer(block))
}

/** Count how many of an item the bot currently holds. */
function heldCount(bot: Bot, itemName: string): number {
  return bot.inventory.items().reduce((s, i) => (i.name === itemName ? s + i.count : s), 0)
}

/**
 * Poll bot.inventory until it settles after a container window close.
 * While a container window is open, slot updates land in that window's
 * mirror only — the main inventory (window 0) is re-sent by the server on
 * close, asynchronously. Counting immediately after close() can still read
 * the pre-transfer snapshot (e2e probe: count at +0ms after close was
 * stale, at +600ms correct). Poll until the count differs from the
 * pre-transfer `staleValue`, or give up after the timeout — the legit
 * "nothing moved" case just costs the full wait.
 */
async function settleHeldCount(bot: Bot, itemName: string, staleValue: number, timeoutMs = 1500): Promise<number> {
  const deadline = Date.now() + timeoutMs
  let v = heldCount(bot, itemName)
  while (v === staleValue && Date.now() < deadline) {
    await sleep(40)
    v = heldCount(bot, itemName)
  }
  return v
}

/** Deposit items into (or withdraw from) a chest/barrel, reporting what moved. */
export async function transferWithChest(bot: Bot, args: Args, mode: 'deposit' | 'withdraw'): Promise<string> {
  const itemName = String(args.itemType ?? '')
  if (!itemName) return 'itemType is required'
  const item = bot.registry.itemsByName[itemName]
  if (!item) return `unknown item: ${itemName}`

  const range = Math.max(1, Math.floor(Number(args.range ?? 16)))
  const block = findStorageBlock(bot, args, range)
  if (!block) return noContainerMessage(bot, args, range)

  const count =
    args.count === undefined || args.count === null
      ? null
      : Math.max(1, Math.floor(Number(args.count)))

  let container: Chest | Dispenser
  try {
    container = await openStorage(bot, block)
  } catch (err) {
    return `failed to open container: ${err instanceof Error ? err.message : String(err)}`
  }

  // ⚠️ 2026-08-17 e2e 实锤（chest-count-probe）：容器窗口打开期间 bot.inventory
  // 是过期快照（before=40, whileOpen=40, afterClose=36），deposit/withdraw 后立刻
  // 计数恒为旧值 → moved=0 → 消息误报 "no X to deposit"（物品实际转移成功了）。
  // 桐人反复"存箱失败"重试的真凶之一。修法：转移动作开窗内做，计数统统挪到
  // close() 之后（服务器关窗时重发主背包 window_items）。
  const before = heldCount(bot, itemName)
  // mineflayer's deposit/withdraw treat a null count as ONE item
  // (lib/plugins/inventory.js: `count == null ? 1 : count`), so "move all"
  // must be an explicit number, computed from what we can actually see.
  // Asking for more than exists throws "Can't find <item>" once the source
  // runs dry — catch it and report the partial move instead of failing.
  let want = 0
  let transferErr = ''
  try {
    if (mode === 'deposit') {
      want = count ?? before
      if (want > 0) await container.deposit(item.id, null, want)
    } else {
      const inContainer = container
        .containerItems()
        .reduce((s, i) => (i.name === itemName ? s + i.count : s), 0)
      want = count ?? inContainer
      if (want > 0) await container.withdraw(item.id, null, want)
    }
  } catch (err) {
    transferErr = err instanceof Error ? err.message : String(err)
  } finally {
    container.close()
  }
  const after = await settleHeldCount(bot, itemName, before)
  const moved = mode === 'deposit' ? before - after : after - before
  const ofPart = transferErr || moved < want ? ` of ${want}` : ''
  if (mode === 'deposit') {
    if (moved > 0) return `deposited ${moved}${ofPart} ${itemName} into ${block.name}`
    if (before === 0) return `no ${itemName} in inventory to deposit`
    return transferErr ? `deposit failed: ${transferErr}` : `no ${itemName} in inventory to deposit`
  }
  if (moved > 0) return `withdrew ${moved}${ofPart} ${itemName} from ${block.name}`
  return transferErr ? `withdraw failed: ${transferErr}` : `no ${itemName} in ${block.name} to withdraw`
}

/** Open a chest/barrel and list what is inside. */
async function viewChest(bot: Bot, args: Args): Promise<string> {
  const range = Math.max(1, Math.floor(Number(args.range ?? 16)))
  const block = findStorageBlock(bot, args, range)
  if (!block) return noContainerMessage(bot, args, range)

  let container: Chest | Dispenser
  try {
    container = await openStorage(bot, block)
  } catch (err) {
    return `failed to open container: ${err instanceof Error ? err.message : String(err)}`
  }

  try {
    const items = container.containerItems()
    const at = `(${block.position.x}, ${block.position.y}, ${block.position.z})`
    if (items.length === 0) return `chest at ${at} is empty`
    return `chest at ${at} contains: ${items.map((i) => `${i.name} x${i.count}`).join(', ')}`
  } finally {
    container.close()
  }
}

// ── Furnace family (furnace / blast_furnace / smoker) ──────────────────
// 2026-08-17 新增：mineflayer openFurnace 官方支持三种熔炉窗口，此前工具层
// 完全缺失，导致桐人对着熔炉卡死 25 步（见 noContainerMessage 注释）。

/** Fuels the bot may burn, best first. Coal/charcoal smelt 8 items each. */
const FUEL_PRIORITY = [
  'coal', 'charcoal',
  'oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks', 'acacia_planks',
  'dark_oak_planks', 'mangrove_planks', 'cherry_planks', 'bamboo_planks',
  'oak_log', 'spruce_log', 'birch_log', 'stick',
]
/** How many items one unit of fuel can smelt (planks/logs/sticks burn 1.5). */
const FUEL_BURN_ITEMS: Record<string, number> = { coal: 8, charcoal: 8 }
const DEFAULT_FUEL_ITEMS = 1.5
/** Vanilla furnace smelts one item every 10s (blast/smoker 5s; 10 is the safe bound). */
const SMELT_SECONDS_PER_ITEM = 10
/** Max items per mc_smelt call so the wait stays inside tool timeouts. */
const SMELT_MAX_BATCH = 6

function fuelEach(name: string): number {
  return FUEL_BURN_ITEMS[name] ?? DEFAULT_FUEL_ITEMS
}

function pickFuel(bot: Bot): { name: string; id: number } | null {
  for (const name of FUEL_PRIORITY) {
    const it = bot.inventory.items().find((i) => i.name === name)
    if (it) return { name, id: it.type }
  }
  return null
}

/** Walk to a furnace-family block and open it; the caller must close(). */
async function openFurnaceAt(bot: Bot, block: Block): Promise<Furnace> {
  const reached = await gotoNear(bot, block.position, 3)
  if (!reached) throw new Error('could not reach the furnace')
  return openWithRetry(() => bot.openFurnace(block))
}

/**
 * Open a container/furnace/enchant window with one retry. The first
 * activateBlock right after a tp or chunk load occasionally gets swallowed
 * by the server (windowOpen never fires) and mineflayer just times out
 * after 20s; a second activate a moment later works. e2e flake seen on
 * ProbeBot's first furnace open after spawn+tp (2026-08-17).
 */
async function openWithRetry<T>(open: () => Promise<T>): Promise<T> {
  try {
    return await open()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!/windowOpen did not fire/.test(msg)) throw err
    await sleep(600)
    return await open()
  }
}

/**
 * Smelt items in the nearest (or given) furnace/blast furnace/smoker:
 * loads input + fuel, waits for the batch, collects the output into the
 * inventory. Batches are capped at 6 items; call again for more.
 */
export async function doSmelt(bot: Bot, args: Args): Promise<string> {
  const itemName = String(args.itemType ?? '')
  if (!itemName) return 'itemType is required'
  const item = bot.registry.itemsByName[itemName]
  if (!item) return `unknown item: ${itemName}`
  const range = Math.max(1, Math.floor(Number(args.range ?? 16)))
  const block = findFurnaceBlock(bot, args, range)
  if (!block) {
    return 'no furnace/blast furnace/smoker found nearby — craft one (mc_craft "furnace", needs 8 cobblestone), place it (mc_place), then mc_smelt again'
  }
  const held = heldCount(bot, itemName)
  if (held === 0) return `no ${itemName} in inventory to smelt`
  // Fuel: explicit fuelType wins, else auto-pick from the priority list.
  const fuelName = args.fuelType ? String(args.fuelType) : ''
  let fuel: { name: string; id: number }
  if (fuelName) {
    const reg = bot.registry.itemsByName[fuelName]
    if (!reg) return `unknown fuel item: ${fuelName}`
    if (heldCount(bot, fuelName) === 0) return `no ${fuelName} in inventory`
    fuel = { name: fuelName, id: reg.id }
  } else {
    const picked = pickFuel(bot)
    if (!picked) return 'no fuel in inventory (coal, charcoal, planks and logs all work)'
    fuel = picked
  }

  const want = Math.min(
    args.count ? Math.max(1, Math.floor(Number(args.count))) : held,
    held,
    SMELT_MAX_BATCH,
  )

  let furnace: Furnace
  try {
    furnace = await openFurnaceAt(bot, block)
  } catch (err) {
    return `failed to open furnace: ${err instanceof Error ? err.message : String(err)}`
  }

  const at = `(${block.position.x}, ${block.position.y}, ${block.position.z})`
  let collected = 0
  let stillQueued = 0
  try {
    // Collect any finished output first (frees the slot for this batch).
    if (furnace.outputItem()) {
      const got = await furnace.takeOutput()
      collected += got.count
    }
    // Someone else's batch inside? Report, don't interrupt.
    const cur = furnace.inputItem()
    if (cur && cur.name !== itemName) {
      return `furnace at ${at} is already smelting ${cur.name} x${cur.count} — try again later or use another furnace`
    }
    const alreadyIn = cur ? cur.count : 0
    const load = want - alreadyIn
    if (load > 0) await furnace.putInput(item.id, null, load)
    // Top up fuel so burning power covers the whole batch.
    const fuelNeed = Math.max(1, Math.ceil(want / fuelEach(fuel.name)))
    const curFuel = furnace.fuelItem()
    if (!curFuel && fuelNeed > 0) {
      const fuelLeft = heldCount(bot, fuel.name)
      if (fuelLeft === 0) return `no ${fuel.name} left for fuel`
      await furnace.putFuel(fuel.id, null, Math.min(fuelNeed, fuelLeft))
    }
    // Poll until the input queue is empty (all smelted into the output slot).
    const deadline = Date.now() + (want * SMELT_SECONDS_PER_ITEM + 20) * 1000
    while (furnace.inputItem() && Date.now() < deadline) await sleep(3000)
    if (furnace.outputItem()) {
      const got = await furnace.takeOutput()
      collected += got.count
    }
    const remainingInput = furnace.inputItem()
    stillQueued = remainingInput ? remainingInput.count : 0
  } finally {
    furnace.close()
  }
  // ⚠️ 计数必须放在 close() 之后：容器窗口打开期间 bot.inventory 是过期
  // 快照（服务器把背包变更发进容器窗口，主背包 window_items 要等关窗才
  // 重发）——e2e 实测开着窗数出的是 putInput 之前的旧值。
  const invLeft = await settleHeldCount(bot, itemName, held)
  const parts = [`smelted ${collected} ${itemName} at ${at} (fuel: ${fuel.name})`]
  if (stillQueued > 0) parts.push(`${stillQueued} still smelting inside — call mc_smelt again in ~${Math.ceil(stillQueued * SMELT_SECONDS_PER_ITEM)}s to collect`)
  if (invLeft > 0 && collected > 0) parts.push(`${invLeft} more ${itemName} in inventory — call mc_smelt again for the next batch`)
  return parts.join('; ')
}

/** Open a furnace-family block and report input/fuel/output + progress. */
export async function viewFurnaceContent(bot: Bot, args: Args): Promise<string> {
  const range = Math.max(1, Math.floor(Number(args.range ?? 16)))
  const block = findFurnaceBlock(bot, args, range)
  if (!block) {
    const c = findStorageBlock(bot, args, range)
    return c
      ? `that is a ${c.name}, not a furnace — use mc_view_chest`
      : 'no furnace/blast furnace/smoker found nearby'
  }
  let furnace: Furnace
  try {
    furnace = await openFurnaceAt(bot, block)
  } catch (err) {
    return `failed to open furnace: ${err instanceof Error ? err.message : String(err)}`
  }
  try {
    const at = `(${block.position.x}, ${block.position.y}, ${block.position.z})`
    const inp = furnace.inputItem()
    const fu = furnace.fuelItem()
    const out = furnace.outputItem()
    // progressSeconds 由 mineflayer furnace 插件在运行时挂上（d.ts 未声明）。
    const secsLeft = (furnace as Furnace & { progressSeconds?: number | null }).progressSeconds
    const prog = typeof secsLeft === 'number' && secsLeft > 0 ? `, ~${Math.ceil(secsLeft)}s left` : ''
    return [
      `${block.name} at ${at}:`,
      `- input: ${inp ? `${inp.name} x${inp.count}` : 'empty'}`,
      `- fuel: ${fu ? `${fu.name} x${fu.count}` : 'empty'}`,
      `- output: ${out ? `${out.name} x${out.count}` : 'empty'}${prog}`,
      'smelt with mc_smelt (it also collects finished output)',
    ].join('\n')
  } finally {
    furnace.close()
  }
}

// ── Enchantment table ──────────────────────────────────────────────────
// 举一反三：mineflayer 自带 openEnchantmentTable（附魔台=第三类可开交互方块），
// 工具层此前同样为空。铁装铁剑做出来后，附魔是战力的下一步。

function findEnchantTable(bot: Bot, range = 16): Block | null {
  return (
    bot.findBlock({
      matching: (b) => !!b && (b.name === 'enchanting_table' || b.name === 'enchantment_table'),
      maxDistance: range,
    }) ?? null
  )
}

/** Enchant an inventory item at the nearest enchanting table. */
export async function doEnchant(bot: Bot, args: Args): Promise<string> {
  const itemName = String(args.itemType ?? '')
  if (!itemName) return 'itemType is required'
  const inv = bot.inventory.items().find((i) => i.name === itemName)
  if (!inv) return `no ${itemName} in inventory`
  const table = findEnchantTable(bot)
  if (!table) {
    return 'no enchanting table nearby — craft and place one first (mc_craft "enchanting_table", needs book + 2 diamonds + 4 obsidian)'
  }
  const lapis = bot.inventory.items().find((i) => i.name === 'lapis_lazuli')
  if (!lapis) return 'no lapis_lazuli in inventory — enchanting costs 1-3 lapis and experience levels'
  if (bot.experience.level < 1) return `not enough experience (level ${bot.experience.level}, need 1+)`

  const reached = await gotoNear(bot, table.position, 2)
  if (!reached) return 'could not reach the enchanting table'
  let et: EnchantmentTable
  try {
    et = await openWithRetry(() => bot.openEnchantmentTable(table))
  } catch (err) {
    return `failed to open enchanting table: ${err instanceof Error ? err.message : String(err)}`
  }
  try {
    await et.putTargetItem(inv)
    await et.putLapis(lapis)
    // Wait until the table reveals its three offers.
    const deadline = Date.now() + 10_000
    while (et.enchantments.length === 0 && Date.now() < deadline) await sleep(500)
    const offers = et.enchantments
    if (offers.length === 0) {
      return 'the table offered no enchantments (item may be unenchantable or already enchanted) — took the item back'
    }
    // Choose: explicit choice index (0/1/2), else auto-pick the strongest affordable.
    let idx = 0
    if (args.choice !== undefined && args.choice !== null) {
      idx = Math.max(0, Math.min(offers.length - 1, Math.floor(Number(args.choice))))
    } else {
      const lvl = bot.experience.level
      let bestLevel = -1
      for (let i = 0; i < offers.length; i++) {
        if (offers[i].level <= lvl && offers[i].level > bestLevel) {
          bestLevel = offers[i].level
          idx = i
        }
      }
      if (bestLevel === -1) {
        return `all offers need more levels than you have (${bot.experience.level}) — took the item back`
      }
    }
    const chosen = offers[idx]
    if (chosen.level > bot.experience.level) {
      return `option ${idx + 1} costs level ${chosen.level} but you have ${bot.experience.level}`
    }
    await et.enchant(idx)
    const outItem = await et.takeTargetItem()
    return `enchanted ${itemName} with option ${idx + 1} (cost ${chosen.level} level${chosen.level > 1 ? 's' : ''} + lapis) -> ${outItem.name}`
  } finally {
    et.close()
  }
}

/** Trade with the nearest villager: list trades, or execute one. */
async function tradeWithVillager(bot: Bot, tradeIndex: number | undefined, count: number): Promise<string> {
  const villager = bot.nearestEntity(
    (e) => e.name === 'villager' && bot.entity!.position.distanceTo(e.position) < 16,
  )
  if (!villager) return 'no villager nearby'
  const reached = await gotoNear(bot, villager.position, 1.5)
  if (!reached) return 'could not reach the villager'

  await bot.lookAt(villager.position.offset(0, 1, 0), false)

  let v: Villager
  try {
    v = await bot.openVillager(villager)
  } catch (err) {
    // openEntity can intermittently time out if the bot is slightly out of
    // interact range; face the villager and retry once.
    await bot.lookAt(villager.position.offset(0, 1, 0), false)
    try {
      v = await bot.openVillager(villager)
    } catch (err2) {
      return `failed to open villager trade: ${err2 instanceof Error ? err2.message : String(err2)}`
    }
  }

  try {
    if (tradeIndex === undefined) {
      if (v.trades.length === 0) return 'villager has no trades'
      const lines = v.trades.map((t, i) => {
        const out = `${t.outputItem.name} x${t.outputItem.count}`
        const in1 = `${t.inputItem1.name} x${t.inputItem1.count}`
        const in2 = t.inputItem2 ? ` + ${t.inputItem2.name} x${t.inputItem2.count}` : ''
        const uses = `${t.nbTradeUses}/${t.maximumNbTradeUses}`
        const flag = t.tradeDisabled ? ' [DISABLED]' : ''
        return `#${i}: ${in1}${in2} -> ${out} (used ${uses})${flag}`
      })
      return `villager trades:\n${lines.join('\n')}`
    }

    const t = v.trades[tradeIndex]
    if (!t) return `invalid trade index ${tradeIndex} (villager has ${v.trades.length} trades)`
    if (t.tradeDisabled) return `trade #${tradeIndex} is disabled`
    await bot.trade(v, tradeIndex, count)
    return `traded #${tradeIndex} x${count}: received ${t.outputItem.name} x${t.outputItem.count * count}`
  } finally {
    v.close()
  }
}

// ── mc_see 后端：方案 C 进程内相机（node-canvas-webgl）优先，playwright 截 viewer 兜底 ──
// 相机直出 800x512 JPEG，无浏览器开销；仅当相机不可用（如刚 spawn 未就绪）时退回无头 Chrome。
// 兜底是给宿主机部署（Windows 装 Chrome + viewer 网页在 :3101）的路径；无头容器
// 部署以相机栈为准（镜像内置 canvas/gl/Xvfb，见 Dockerfile）。
// DEFECT-20260818-063022-mc_see：容器里相机栈缺失 → 兜底又拿写死的 Windows
// chrome.exe 路径硬启 → 两头全炸还把根因（相机栈没装）掩盖成浏览器报错。
const CHROME_PATH = process.env.CHROME_PATH
  || (process.platform === 'win32'
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : '/usr/bin/chromium')
const SHOTS_ROOT = resolve('./data/screenshots')
let seeBrowser: Browser | null = null
let seePage: Page | null = null

async function seeFirstPersonViaPlaywright(): Promise<{ dataUrl: string; file: string | null }> {
  const port = Number(process.env.MC_VIEWER_PORT || 3001) + 100
  const url = `http://127.0.0.1:${port}/`
  if (!seePage || seePage.isClosed()) {
    if (seeBrowser) {
      try { await seeBrowser.close() } catch { /* already closed */ }
    }
    if (!existsSync(CHROME_PATH)) {
      throw new Error(`no fallback browser at ${CHROME_PATH} (install one or set CHROME_PATH)`)
    }
    seeBrowser = await chromium.launch({
      executablePath: CHROME_PATH,
      headless: true,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
    })
    seePage = await seeBrowser.newPage({ viewport: { width: 640, height: 480 } })
    await seePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    await seePage.waitForTimeout(1500) // 首次加载：等区块渲染出来
  } else if (!seePage.url().startsWith(url)) {
    await seePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    await seePage.waitForTimeout(1500)
  }
  await seePage.waitForTimeout(300) // 渲染当前帧
  const buf = await seePage.screenshot({ type: 'png' })
  return { dataUrl: 'data:image/png;base64,' + buf.toString('base64'), file: null }
}

async function seeFirstPerson(bot: Bot): Promise<{ dataUrl: string; file: string | null }> {
  try {
    const shot = await captureFirstPerson(bot, SHOTS_ROOT)
    return { dataUrl: 'data:image/jpeg;base64,' + shot.buffer.toString('base64'), file: shot.file }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[mc-tools] camera capture failed, falling back to playwright: ${msg}`)
    try {
      return await seeFirstPersonViaPlaywright()
    } catch (pwErr) {
      // 两级后端都挂：把相机根因与兜底失败合在一起抛出，别让浏览器报错
      // 掩盖「视觉栈未安装」这个真正的问题。
      const pwMsg = pwErr instanceof Error ? pwErr.message : String(pwErr)
      throw new Error(`mc_see unavailable — in-process camera: ${msg}; browser fallback: ${pwMsg}`)
    }
  }
}

/**
 * Dig (break) the block at exact coordinates, then pick up nearby drops —
 * the directional mining primitive.
 * DEFECT-20260817-080630: the loop prompt's 「三层自救铁律」teaches stuck bots
 * "嵌方块就 mc_dig 挖开头顶/身旁", but no such tool was ever registered.
 * Kirito fell back to mc_place against the blocking stone 5x in a row (and a
 * later probe literally got `unknown tool "mc_dig"`). mc_collect cannot express
 * "dig THE block at (-98, 41, 148)" — it targets the nearest block of a type.
 * This gives every transmigrator exactly the primitive the doctrine promises.
 */
export async function digAt(bot: Bot, args: Args): Promise<string> {
  const { x, y, z } = coordArgs(args)
  if (x === undefined || y === undefined || z === undefined) return 'x, y, z are required'
  const target = new Vec3(x, y, z)
  let block = bot.blockAt(target)
  if (!block) return `cannot inspect block at (${x}, ${y}, ${z}) (chunk not loaded?)`
  if (block.boundingBox === 'empty') return `already air at (${x}, ${y}, ${z})`
  if (block.diggable === false) {
    return `${block.name} at (${x}, ${y}, ${z}) cannot be dug (unbreakable)`
  }
  // 太远先走近；挖头顶/身旁方块时本来就贴脸，通常直接跳过。
  if (bot.entity!.position.distanceTo(target) > 4.5) {
    const reached = await gotoNear(bot, target, 3)
    if (!reached) return `could not get close enough to dig at (${x}, ${y}, ${z})`
    block = bot.blockAt(target) ?? block
    if (block.boundingBox === 'empty') return `already air at (${x}, ${y}, ${z})`
  }
  const before = bot.inventory.items().reduce((s, it) => s + it.count, 0)
  // 先空手再换最佳工具：与 mc_collect 同理，绕过 mineflayer-tool
  // 「手持工具已够好就不换」的优化，避免拿铲子挖石头。
  await bot.unequip('hand').catch(() => {})
  await bot.tool.equipForBlock(block)
  await bot.dig(block)
  await pickupNearby(bot)
  const after = bot.inventory.items().reduce((s, it) => s + it.count, 0)
  return `dug ${block.name} at (${x}, ${y}, ${z})` + (after > before ? ' (picked up drops)' : '')
}

export function apply(ctx: Context) {
  const bot: Bot = ctx.mcbot
  const log = (msg: string) => console.log(`[mc-tools] ${msg}`)

  // ── Observe: position / health / food / held item / inventory ────────
  ctx.tools.register(defineTool({
    name: 'mc_status',
    description: 'Get the bot\'s current state: position, health, food, held item and inventory.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    execute: guard(bot, async () => {
      const p = bot.entity!.position
      const items = bot.inventory.items().map((i) => `${i.name} x${i.count}`)
      return JSON.stringify({
        position: { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) },
        health: bot.health,
        food: bot.food,
        heldItem: bot.heldItem ? bot.heldItem.name : null,
        inventory: items,
      })
    }),
  }))

  // ── Move: pathfind to coordinates ─────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'mc_goto',
    description: 'Pathfind to the given coordinates (e.g. a chest, bed or mining spot).',
    parameters: {
      x: { type: 'number', required: true, description: 'target x coordinate' },
      y: { type: 'number', required: true, description: 'target y coordinate' },
      z: { type: 'number', required: true, description: 'target z coordinate' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    timeoutMs: 60_000,
    execute: guard(bot, async (args) => {
      const { x, y, z } = args as { x: number; y: number; z: number }
      const target = new Vec3(x, y, z)
      log(`goto (${x}, ${y}, ${z})`)
      const reached = await gotoNear(bot, target, 3, 30_000)
      if (!reached) {
        const p = bot.entity!.position
        return `failed to reach (${x}, ${y}, ${z}); stopped at (${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)})`
      }
      return `reached (${x}, ${y}, ${z})`
    }),
  }))

  // ── Gather: collect blocks of a given type ────────────────────────────
  ctx.tools.register(defineTool({
    name: 'mc_collect',
    description:
      'Collect blocks of a type (e.g. "oak_log", "coal_ore", "cobblestone"). The bot walks to the nearest one, mines it and picks up the drops. Returns how many were collected.',
    parameters: {
      blockType: { type: 'string', required: true, description: 'block name, e.g. "oak_log" or "coal_ore"' },
      count: { type: 'number', description: 'how many blocks to collect (default 1)' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    timeoutMs: 120_000,
    execute: guard(bot, async (args) => {
      const blockType = String(args.blockType ?? '')
      const num = Math.max(1, Math.floor(Number(args.count ?? 1)))
      if (!blockType) return 'blockType is required'
      const feetY = Math.floor(bot.entity!.position.y) - 1
      let collected = 0
      for (let i = 0; i < num; i++) {
        // Prefer a block at the bot's feet layer or above: its drop lands at
        // the bot's feet and is picked up instantly. Digging below the feet
        // makes the drop fall into the hole, out of pickup range.
        let block = bot.findBlock({
          matching: (b) => {
            if (!b || b.name !== blockType) return false
            // Palette pre-check hands us a position-less temp Block: accept by
            // name only (its .position is null and would throw).
            if (!b.position) return true
            return b.position.y >= feetY
          },
          maxDistance: 48,
        })
        if (!block) {
          block = bot.findBlock({
            matching: (b) => !!b && b.name === blockType,
            maxDistance: 48,
          })
        }
        if (!block) break
        const before = bot.inventory.items().reduce((s, it) => s + it.count, 0)
        // 先空手再换最佳工具：绕过 mineflayer-tool「手持工具已够好就不换」的
        // 优化，否则会手持石铲去挖矿石（慢且不掉落），看起来像「徒手挖」。
        await bot.unequip('hand').catch(() => {})
        await bot.tool.equipForBlock(block)
        const reached = await gotoNear(bot, block.position, 3)
        if (!reached) break
        try {
          await bot.dig(block)
          await pickupNearby(bot)
          const after = bot.inventory.items().reduce((s, it) => s + it.count, 0)
          if (after > before) collected++
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log(`failed to dig ${blockType}: ${msg}`)
          break
        }
      }
      // 挖完后把镐子留手（若有），保持「挖掘者」姿态，避免手持石铲乱走。
      const pick = bot.inventory.items().find((it) => it.name.includes('pickaxe'))
      if (pick) await bot.equip(pick, 'hand').catch(() => {})
      return `collected ${collected} ${blockType}`
    }),
  }))

  // ── Dig: break the block at exact coordinates ────────────────────────
  ctx.tools.register(defineTool({
    name: 'mc_dig',
    description:
      'Dig (break) the block at the EXACT given coordinates, then pick up nearby drops. The escape primitive when stuck: dig the block above your head or beside you (use mc_look first to find the blocking coordinates). Warning: digging straight down below your own feet can drop you into caves or lava.',
    parameters: {
      x: { type: 'number', required: true, description: 'target x coordinate' },
      y: { type: 'number', required: true, description: 'target y coordinate' },
      z: { type: 'number', required: true, description: 'target z coordinate' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    timeoutMs: 60_000,
    execute: guard(bot, async (args) => digAt(bot, args)),
  }))

  // ── Build: place a block at coordinates ───────────────────────────────
  ctx.tools.register(defineTool({
    name: 'mc_place',
    description:
      'Place a block from the inventory at the given coordinates. The bot stands next to it and places it against an adjacent solid block.',
    parameters: {
      blockType: { type: 'string', required: true, description: 'block/item name, e.g. "oak_planks" or "torch"' },
      x: { type: 'number', required: true, description: 'target x coordinate' },
      y: { type: 'number', required: true, description: 'target y coordinate' },
      z: { type: 'number', required: true, description: 'target z coordinate' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    timeoutMs: 60_000,
    execute: guard(bot, async (args) => {
      const blockType = String(args.blockType ?? '')
      const target = new Vec3(Math.floor(Number(args.x)), Math.floor(Number(args.y)), Math.floor(Number(args.z)))
      const item = bot.inventory.items().find((i) => i.name === blockType)
      if (!item) return `no ${blockType} in inventory`

      const occupied = bot.blockAt(target)
      if (occupied && !['air', 'water', 'lava', 'grass', 'short_grass', 'tall_grass'].includes(occupied.name)) {
        return `${occupied.name} is in the way at (${target.x}, ${target.y}, ${target.z})`
      }

      const dirs = [
        new Vec3(0, -1, 0), new Vec3(0, 1, 0),
        new Vec3(0, 0, -1), new Vec3(0, 0, 1),
        new Vec3(-1, 0, 0), new Vec3(1, 0, 0),
      ]
      let refBlock: Block | null = null
      let faceVec: Vec3 | null = null
      for (const d of dirs) {
        const b = bot.blockAt(target.plus(d))
        if (b && !['air', 'water', 'lava', 'grass', 'short_grass', 'tall_grass'].includes(b.name)) {
          refBlock = b
          faceVec = new Vec3(-d.x, -d.y, -d.z)
          break
        }
      }
      if (!refBlock || !faceVec) return 'nothing solid to place the block against'

      if (bot.entity!.position.distanceTo(target) > 4) {
        const reached = await gotoNear(bot, target, 3)
        if (!reached) return 'could not get close enough to place the block'
      }
      await bot.equip(item, 'hand')
      await bot.lookAt(refBlock.position.offset(0.5, 0.5, 0.5))
      await bot.placeBlock(refBlock, faceVec)
      await sleep(150)
      return `placed ${blockType} at (${target.x}, ${target.y}, ${target.z})`
    }),
  }))

  // ── Fight: attack the nearest mob of a type ───────────────────────────
  ctx.tools.register(defineTool({
    name: 'mc_attack',
    description:
      'Attack the nearest mob of a type (e.g. "zombie", "creeper", "skeleton"). Optionally keep attacking until it dies.',
    parameters: {
      mobType: { type: 'string', required: true, description: 'mob name, e.g. "zombie"' },
      kill: { type: 'boolean', description: 'keep attacking until dead (default true)' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    timeoutMs: 60_000,
    execute: guard(bot, async (args) => {
      const mobType = String(args.mobType ?? '')
      const kill = args.kill !== false
      const mob = bot.nearestEntity(
        (e) => e.name === mobType && bot.entity!.position.distanceTo(e.position) < 24,
      )
      if (!mob) return `no ${mobType} nearby`

      await equipBestWeapon(bot)

      if (!kill) {
        await bot.lookAt(mob.position)
        bot.attack(mob)
        return `attacked ${mobType} once`
      }

      let hits = 0
      while (mob.isValid && hits < 60) {
        if (!bot.entity) break
        if (bot.entity.position.distanceTo(mob.position) > 3) {
          await gotoNear(bot, mob.position, 2)
        }
        await bot.lookAt(mob.position)
        try {
          bot.attack(mob)
          hits++
        } catch {
          // mob may have died between checks
          break
        }
        await sleep(600)
      }
      return `attacked ${mobType} ${hits} time(s); ${mob.isValid ? 'still alive' : 'killed'}`
    }),
  }))

  // ── Pick up nearby dropped items ──────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'mc_pickup',
    description: 'Walk to and pick up dropped items near the bot.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    execute: guard(bot, async () => {
      await pickupNearby(bot)
      return 'picked up nearby items'
    }),
  }))

  // ── Craft: make an item, using a crafting table if needed ─────────────
  ctx.tools.register(defineTool({
    name: 'mc_craft',
    description:
      'Craft an item (e.g. "wooden_pickaxe", "crafting_table", "stick", "oak_planks", "stone_pickaxe"). If the recipe needs a crafting table, the bot walks to the nearest one. Reports what was crafted or which ingredients are missing.',
    parameters: {
      itemType: { type: 'string', required: true, description: 'item name to craft, e.g. "wooden_pickaxe" or "crafting_table"' },
      count: { type: 'number', description: 'how many times to run the recipe (default 1)' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    timeoutMs: 60_000,
    execute: guard(bot, async (args) => {
      const itemName = String(args.itemType ?? '')
      const count = Math.max(1, Math.floor(Number(args.count ?? 1)))
      if (!itemName) return 'itemType is required'
      log(`craft ${count} ${itemName}`)
      return craftItem(bot, itemName, count)
    }),
  }))

  // ── Equip: put an item into the hand or an armor slot ────────────────
  ctx.tools.register(defineTool({
    name: 'mc_equip',
    description:
      'Equip an item from the inventory, e.g. "wooden_pickaxe" or "stone_axe". Default destination is the hand; armor goes to head/torso/legs/feet.',
    parameters: {
      itemType: { type: 'string', required: true, description: 'item name to equip, e.g. "wooden_pickaxe"' },
      destination: { type: 'string', description: 'where to equip: "hand" (default), "head", "torso", "legs", "feet", "off-hand"' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    timeoutMs: 30_000,
    execute: guard(bot, async (args) => {
      const itemName = String(args.itemType ?? '')
      const destination = String(args.destination ?? 'hand')
      if (!itemName) return 'itemType is required'
      const valid: EquipmentDestination[] = ['hand', 'head', 'torso', 'legs', 'feet', 'off-hand']
      if (!valid.includes(destination as EquipmentDestination)) return `invalid destination: ${destination}`
      const item = bot.inventory.items().find((i) => i.name === itemName)
      if (!item) return `no ${itemName} in inventory`
      await bot.equip(item, destination as EquipmentDestination)
      return `equipped ${itemName} to ${destination}`
    }),
  }))

  // ── Eat: consume food to restore hunger (and usually health) ──────────
  ctx.tools.register(defineTool({
    name: 'mc_eat',
    description:
      'Eat a food item to restore hunger and (over time) health. The bot equips the food and consumes it. Omit itemType to auto-pick the most filling food available.',
    parameters: {
      itemType: { type: 'string', description: 'food item name to eat, e.g. "cooked_beef", "apple", "rotten_flesh". Omit to auto-pick the best food.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    timeoutMs: 60_000,
    execute: guard(bot, async (args) => {
      const itemName = String(args.itemType ?? '')
      let item: any
      if (itemName) {
        item = bot.inventory.items().find((i) => i.name === itemName)
        if (!item) return `no ${itemName} in inventory`
      } else {
        // Auto-pick the most filling edible food (rotten_flesh has foodPoints
        // but can poison, so it still counts — starving is worse).
        const foods = bot.inventory.items().filter((i) => {
          const reg = bot.registry.itemsByName[i.name] as { foodPoints?: number } | undefined
          return reg && typeof reg.foodPoints === 'number' && reg.foodPoints > 0
        })
        if (foods.length === 0) return 'no food in inventory'
        foods.sort((a, b) => {
          const ap = (bot.registry.itemsByName[a.name] as { foodPoints?: number } | undefined)?.foodPoints ?? 0
          const bp = (bot.registry.itemsByName[b.name] as { foodPoints?: number } | undefined)?.foodPoints ?? 0
          return bp - ap
        })
        item = foods[0]
      }
      const foodPoints = (bot.registry.itemsByName[item.name] as { foodPoints?: number } | undefined)?.foodPoints ?? 0
      await bot.equip(item, 'hand')
      try {
        await bot.consume()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('Food is full')) return 'food is already full'
        return `could not eat ${item.name}: ${msg}`
      }
      return `ate ${item.name} (+${foodPoints} food); food now ${Math.round(bot.food)}/20`
    }),
  }))

  // ── Chat: speak to the world (reply to players / narrate) ────────────
  ctx.tools.register(defineTool({
    name: 'mc_chat',
    description:
      '全服公屏广播（整个世界都听见的大喇叭）——重大宣告才用，如自我介绍、重要发现、集结呼喊。' +
      '日常和身边的同伴说话用 mc_voice（有距离感：说48格/喊96格/悄悄6格）；' +
      '对某个人说私话且不管距离时，填 to 参数（私语直达，只有对方听得见）；' +
      '给离线/远方的人留言用 mc_mail（书信）。',
    parameters: {
      message: { type: 'string', description: 'the message to say in chat' },
      to: { type: 'string', description: '私语直达：对方游戏ID。填了就只对这个人说（不限距离），留空则公屏广播' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    execute: guard(bot, async (args) => {
      const msg = String(args.message ?? '').trim()
      if (!msg) return 'no message'
      const to = String(args.to ?? '').trim()
      if (to) {
        try {
          bot.whisper(to, msg)
          return `whispered to ${to}: ${msg}`
        } catch {
          return `whisper to ${to} failed (connection error)`
        }
      }
      bot.chat(msg)
      return `said: ${msg}`
    }),
  }))

  // ── Storage: list what's inside a chest/barrel ────────────────────────
  ctx.tools.register(defineTool({
    name: 'mc_view_chest',
    description:
      'Look inside a chest or barrel and list its contents. If x/y/z are given, opens that exact block; otherwise opens the nearest one within range.',
    parameters: {
      x: { type: 'number', description: 'chest x coordinate (optional)' },
      y: { type: 'number', description: 'chest y coordinate (optional)' },
      z: { type: 'number', description: 'chest z coordinate (optional)' },
      range: { type: 'number', description: 'search radius for the nearest chest (default 16)' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    timeoutMs: 60_000,
    execute: guard(bot, async (args) => viewChest(bot, args)),
  }))

  // ── Storage: deposit items from inventory into a chest ────────────────
  ctx.tools.register(defineTool({
    name: 'mc_put_chest',
    description:
      'Deposit items from the bot\'s inventory into a chest or barrel. If x/y/z are given, targets that chest; otherwise the nearest one. Deposits "count" of itemType (default: all of that type).',
    parameters: {
      itemType: { type: 'string', required: true, description: 'item name to deposit, e.g. "oak_log" or "cobblestone"' },
      count: { type: 'number', description: 'how many to deposit (default: all)' },
      x: { type: 'number', description: 'chest x coordinate (optional)' },
      y: { type: 'number', description: 'chest y coordinate (optional)' },
      z: { type: 'number', description: 'chest z coordinate (optional)' },
      range: { type: 'number', description: 'search radius for the nearest chest (default 16)' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    timeoutMs: 60_000,
    execute: guard(bot, async (args) => transferWithChest(bot, args, 'deposit')),
  }))

  // ── Storage: withdraw items from a chest into inventory ───────────────
  ctx.tools.register(defineTool({
    name: 'mc_take_chest',
    description:
      'Withdraw items from a chest or barrel into the bot\'s inventory. If x/y/z are given, targets that chest; otherwise the nearest one. Withdraws "count" of itemType (default: all available).',
    parameters: {
      itemType: { type: 'string', required: true, description: 'item name to withdraw, e.g. "coal" or "iron_ingot"' },
      count: { type: 'number', description: 'how many to withdraw (default: all available)' },
      x: { type: 'number', description: 'chest x coordinate (optional)' },
      y: { type: 'number', description: 'chest y coordinate (optional)' },
      z: { type: 'number', description: 'chest z coordinate (optional)' },
      range: { type: 'number', description: 'search radius for the nearest chest (default 16)' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    timeoutMs: 60_000,
    execute: guard(bot, async (args) => transferWithChest(bot, args, 'withdraw')),
  }))

  // ── Furnace: smelt items in furnace / blast furnace / smoker ──────────
  ctx.tools.register(defineTool({
    name: 'mc_smelt',
    description:
      'Smelt items (e.g. raw_iron -> iron_ingot, raw food -> cooked food) in the nearest furnace, blast furnace or smoker. Loads input + fuel, waits, and collects the finished output into inventory. Max 6 items per call; call again for more. Also collects any finished output first.',
    parameters: {
      itemType: { type: 'string', required: true, description: 'raw item to smelt, e.g. "raw_iron" or "raw_beef"' },
      count: { type: 'number', description: 'how many to smelt this batch, max 6 (default: as many as held)' },
      fuelType: { type: 'string', description: 'fuel item name (default: auto-pick coal/charcoal/planks/logs)' },
      x: { type: 'number', description: 'furnace x coordinate (optional)' },
      y: { type: 'number', description: 'furnace y coordinate (optional)' },
      z: { type: 'number', description: 'furnace z coordinate (optional)' },
      range: { type: 'number', description: 'search radius for the nearest furnace (default 16)' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    timeoutMs: 120_000,
    execute: guard(bot, async (args) => doSmelt(bot, args)),
  }))

  // ── Furnace: look inside a furnace ────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'mc_view_furnace',
    description:
      'Look inside the nearest furnace / blast furnace / smoker: input, fuel, output and remaining smelt time. Does not take anything (mc_smelt collects output).',
    parameters: {
      x: { type: 'number', description: 'furnace x coordinate (optional)' },
      y: { type: 'number', description: 'furnace y coordinate (optional)' },
      z: { type: 'number', description: 'furnace z coordinate (optional)' },
      range: { type: 'number', description: 'search radius for the nearest furnace (default 16)' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    timeoutMs: 60_000,
    execute: guard(bot, async (args) => viewFurnaceContent(bot, args)),
  }))

  // ── Enchanting: enchant an item at the nearest enchanting table ───────
  ctx.tools.register(defineTool({
    name: 'mc_enchant',
    description:
      'Enchant a held item at the nearest enchanting table. Costs 1-3 lapis_lazuli and experience levels. Without choice, auto-picks the strongest offer you can afford; with choice (0/1/2), takes that specific offer.',
    parameters: {
      itemType: { type: 'string', required: true, description: 'item to enchant from inventory, e.g. "iron_sword" (must be unenchanted)' },
      choice: { type: 'number', description: 'offer index 0/1/2 (optional, default: strongest affordable)' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    timeoutMs: 60_000,
    execute: guard(bot, async (args) => doEnchant(bot, args)),
  }))

  // ── Trade: interact with the nearest villager ─────────────────────────
  ctx.tools.register(defineTool({
    name: 'mc_trade',
    description:
      'Trade with the nearest villager. Without tradeIndex, lists the available trades. With tradeIndex, executes that trade "count" times (default 1).',
    parameters: {
      tradeIndex: { type: 'number', description: 'which trade to execute (omit to list trades first)' },
      count: { type: 'number', description: 'how many times to run the trade (default 1)' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    timeoutMs: 60_000,
    execute: guard(bot, async (args) => {
      const tradeIndex = args.tradeIndex === undefined || args.tradeIndex === null
        ? undefined
        : Math.floor(Number(args.tradeIndex))
      const count = Math.max(1, Math.floor(Number(args.count ?? 1)))
      return tradeWithVillager(bot, tradeIndex, count)
    }),
  }))

  // ── Sleep: find a bed and sleep through the night ─────────────────────
  ctx.tools.register(defineTool({
    name: 'mc_sleep',
    description:
      '在天黑或雷雨时找到附近的床并躺下睡觉，一觉睡到天亮，安全跳过危险的黑夜。白天不能睡。如果附近没有床，先想办法弄一张（放一张床，或祈愿天神赐一张床）。',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    timeoutMs: 60_000,
    execute: guard(bot, async () => {
      const bed = bot.findBlock({
        matching: (b) => !!b && (b.name === 'bed' || b.name.endsWith('_bed')),
        maxDistance: 48,
      })
      if (!bed) return '附近 48 格内没有床。可以先用 mc_place 放一张床（若背包里有），或 mc_pray 向天神祈愿赐一张床'
      const reached = await gotoNear(bot, bed.position, 2)
      if (!reached) return '走不到床旁边，无法入睡'
      try {
        // bot.sleep() 在真正躺下时 resolve（≤3s），失败则抛出明确原因；
        // 躺下后由决策循环检测 isSleeping 暂停行动，直到天亮自动醒来。
        await bot.sleep(bed)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return `无法入睡：${msg}`
      }
      return '已躺下入睡，一觉睡到天亮（天亮自动醒来后继续行动）'
    }),
  }))

  // ── Look (A)：文字版环境雷达，重点暴露「头顶出口」等自救关键信息 ────
  ctx.tools.register(defineTool({
    name: 'mc_look',
    description:
      '环顾四周：面向什么、眼前方块、头顶有没有露天出口（卡坑自救关键）、四面环境、脚下地质、附近水/岩浆等危险、附近实体。纯文字雷达，极快，零消耗。迷路、卡住、进入陌生地形时先用它。',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    execute: guard(bot, async () => {
      const pos = bot.entity!.position.floored()
      const headY = pos.y + 1 // 头部所在格

      // 朝向（mineflayer yaw：forward = (-sin yaw, -cos yaw)）
      const yaw = bot.entity!.yaw
      const dx = -Math.sin(yaw)
      const dz = -Math.cos(yaw)
      const cardinal = Math.abs(dx) > Math.abs(dz)
        ? (dx > 0 ? '东 (+X)' : '西 (-X)')
        : (dz > 0 ? '南 (+Z)' : '北 (-Z)')

      // 视线内第一个实体方块
      let lookingAt: Record<string, unknown> = { block: null }
      try {
        const b = bot.blockInSight(24, 5 / 16)
        if (b) {
          lookingAt = {
            block: b.name,
            distance: Math.round(bot.entity!.position.distanceTo(b.position) * 10) / 10,
            position: [b.position.x, b.position.y, b.position.z],
          }
        }
      } catch { /* raycast miss = 眼前开阔 */ }

      // 头顶柱状扫描：找第一个「能站人的露天/开口」位置
      let firstOpening: number | null = null
      let openSky = true
      const maxY = Math.min(headY + 64, 319)
      for (let y = headY + 1; y <= maxY; y++) {
        const b1 = bot.blockAt(new Vec3(pos.x, y, pos.z))
        const b2 = bot.blockAt(new Vec3(pos.x, y + 1, pos.z))
        const solid1 = !!b1 && b1.boundingBox !== 'empty'
        const solid2 = !!b2 && b2.boundingBox !== 'empty'
        if (solid1 || solid2) { openSky = false }
        if (firstOpening === null && !solid1 && !solid2) { firstOpening = y }
      }
      const blocksAboveHead = firstOpening !== null ? firstOpening - headY : null

      // 四面 2 格处的环境
      const dirs: Array<[string, number, number]> = [['东', 2, 0], ['南', 0, 2], ['西', -2, 0], ['北', 0, -2]]
      const surroundings: Record<string, string> = {}
      for (const [label, ox, oz] of dirs) {
        const b = bot.blockAt(new Vec3(pos.x + ox, pos.y + 1, pos.z + oz))
        surroundings[label] = b && b.boundingBox !== 'empty' ? `${b.name} 挡路` : '开阔'
      }

      // 危险液体（8 格内）
      const hazards: string[] = []
      try {
        for (const name of ['water', 'lava', 'flowing_water', 'flowing_lava']) {
          const hb = bot.findBlock({
            matching: (b: any) => !!b && b.name === name,
            maxDistance: 8,
          })
          if (hb) {
            const d = Math.round(bot.entity!.position.distanceTo(hb.position))
            hazards.push(`${name === 'lava' || name === 'flowing_lava' ? '岩浆' : '水'} ${d}格 ${hb.position.x},${hb.position.y},${hb.position.z}`)
          }
        }
      } catch { /* findBlock 失败不阻塞 */ }

      // 实体雷达（16 格）
      const entities = Object.values(bot.entities)
        .filter((e: any) => e && e !== bot.entity && e.name && e.position
          && bot.entity!.position.distanceTo(e.position) <= 16)
        .sort((a: any, b: any) =>
          bot.entity!.position.distanceTo(a.position) - bot.entity!.position.distanceTo(b.position))
        .slice(0, 6)
        .map((e: any) => {
          const d = Math.round(bot.entity!.position.distanceTo(e.position))
          return `${e.displayName ?? e.name}(${d}格)`
        })

      // 脚下地质
      const under = bot.blockAt(pos.offset(0, -1, 0))
      const inBlock = bot.blockAt(pos.offset(0, 0, 0))

      // 自救提示（DEFECT-20260817-080630：浅坑分支此前为空，且穿越者把
      // firstOpeningY 误读成"被封死"——开口=出路，语义必须说破）
      let hint = ''
      if (firstOpening === null) hint = '你头顶被封死（64格内无开口），垫方块上不去：用 mc_dig 朝东/南/西/北任一方向逐格横向挖通道出去，真挖不动再咏唱求救'
      else if (blocksAboveHead! > 3) hint = `你在坑底/洞里，头顶 ${blocksAboveHead} 格（y=${firstOpening}）有开口（那是出路，不是被封死）：可以 mc_dig 向上挖、或垫方块搭柱出去`
      else if (openSky) hint = '头顶露天，视野良好'
      else hint = `你在浅坑/洞口下，头顶仅 ${blocksAboveHead} 格（y=${firstOpening}）就有开口（那是出路，不是被封死）：四周挡路的方块用 mc_dig 挖开即可走出去；想垂直上去就朝脚下 mc_place 垫方块搭台阶`

      return JSON.stringify({
        facing: cardinal,
        lookingAt,
        headroom: { openSky, firstOpeningY: firstOpening, blocksAboveHead },
        surroundings,
        ground: under ? under.name : 'unknown',
        bodyIn: inBlock && inBlock.boundingBox !== 'empty' ? inBlock.name : 'air',
        hazards: hazards.length ? hazards : [],
        entities: entities.length ? entities : [],
        hint,
      })
    }),
  }))

  // ── See (B)：真实第一人称截图 → 嵌入下一轮多模态观察 ──────────────────
  ctx.tools.register(defineTool({
    name: 'mc_see',
    description:
      '睁开眼睛：截取你第一人称视角的真实游戏画面（800x512），画面会附在下一轮观察里供你亲眼查看。默认只拍当前朝向一张；想环顾四周查威胁/找路时传 look=around，会原地按 前→右→后→左 拍四张拼成360°全景（token 消耗约4倍，别每轮都用）。耗时约 1-4 秒。',
    parameters: {
      look: { type: 'string', description: 'front=只拍当前朝向（默认）；around=环顾四周四连拍' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => text(value) },
    timeoutMs: 30_000,
    execute: guard(bot, async (args) => {
      const mode = String(args.look ?? 'front')
      if (mode === 'around') {
        try {
          const shots = await captureLookaround(bot, SHOTS_ROOT)
          setLastImages(shots.map((s) => ({
            dataUrl: 'data:image/jpeg;base64,' + s.buffer.toString('base64'),
            file: s.file,
            label: s.label,
          })))
          return '已环顾四周：前/右/后/左 四张画面将在你的下一次观察中按顺序附上——请结合四面画面决策。'
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          // 环视失败退回单张，别让 agent 白等一轮
          const { dataUrl, file } = await seeFirstPerson(bot)
          setLastImage(dataUrl, file)
          return `环视失败（${msg}），已退回拍摄当前朝向单张画面。`
        }
      }
      const { dataUrl, file } = await seeFirstPerson(bot)
      setLastImage(dataUrl, file)
      return '已拍摄第一人称画面，闭上眼后画面会立刻附在你的下一次观察中——请结合画面内容决定下一步。'
    }),
  }))
}
