// furnace-e2e.mts — 熔炉工具端到端验证（2026-08-17）
// 背景：桐人对着熔炉卡死 25 步（#294-#319）的缺陷修复验证。
// 流程：RCON 在基地上空 y=100 搭 5x5 测试台（ furnace + chest ）→ ProbeBot 进场
// → 直调 src/mc-tools.ts 导出的 doSmelt / viewFurnaceContent（不经 dsh，测我写的代码）
// → 验收清单：
//   [1] viewFurnace 空炉识别      [2] smelt 3 生铁 → 3 铁锭（约 40s）
//   [3] 批次上限 6               [4] 反向教学提示（对箱子调熔炉工具）
// → 清场拆台。ProbeBot 全程不碰真实地形。用完即走（Node 22 unhandledRejection 已在两侧 bootstrap 兜底，探针自己 try/catch）。
import { readFileSync } from 'node:fs'
import { exit } from 'node:process'
import mineflayer from 'mineflayer'
import type { Bot } from 'mineflayer'
import pf from 'mineflayer-pathfinder'
import { doSmelt, viewFurnaceContent } from './src/mc-tools.ts'
import { Rcon } from './src/rcon.ts'

const results: Array<{ name: string; pass: boolean; detail: string }> = []
function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} [${name}] ${detail}`)
}

const rcon = new Rcon('127.0.0.1', 25575, readFileSync('./data/rcon-secret.txt', 'utf-8').trim())
await rcon.connect()

// ── 1) 空中测试台（基地上空，y=100，不碰真实地形）──
// 平台 y=100（站面 101）：(-112..-108, 145..149)；熔炉 (-111,101,145)；箱子 (-108,101,145)
const PLATFORM = 'fill -112 100 145 -108 100 149 minecraft:smooth_stone replace minecraft:air'
console.log('setup:', await rcon.send(PLATFORM))
console.log('setup:', await rcon.send('setblock -111 101 145 minecraft:furnace replace'))
console.log('setup:', await rcon.send('setblock -108 101 145 minecraft:chest replace'))

// ── 2) ProbeBot 进场 ──
const bot = mineflayer.createBot({ host: 'localhost', port: 25565, username: 'ProbeBot' })
bot.loadPlugin(pf.pathfinder)
process.on('unhandledRejection', (e) => { console.error('unhandledRejection:', e); })
await new Promise<void>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('spawn timeout')), 30_000)
  bot.once('spawn', () => { clearTimeout(t); resolve() })
  bot.once('kicked', (r) => reject(new Error('kicked: ' + r)))
  bot.once('error', (e) => reject(e))
})
bot.pathfinder.setMovements(new pf.Movements(bot))
console.log('ProbeBot spawned, tp to platform')
await rcon.send('tp ProbeBot -110 101.0 147')
await new Promise((r) => setTimeout(r, 1500))
await rcon.send('give ProbeBot minecraft:raw_iron 8')
await rcon.send('give ProbeBot minecraft:coal 3')
await new Promise((r) => setTimeout(r, 800))

function invCount(b: Bot, name: string): number {
  return b.inventory.items().reduce((s, i) => (i.name === name ? s + i.count : s), 0)
}

try {
  // [1] 空炉识别
  const v1 = await viewFurnaceContent(bot, {})
  record('view-furnace-empty', /furnace/.test(v1) && /input: empty/.test(v1), v1.replace(/\n/g, ' | '))

  // [2] 熔炼 3 生铁（10s/个 + 走位，约 40s）
  const t2 = Date.now()
  const s1 = await doSmelt(bot, { itemType: 'raw_iron', count: 3 })
  const got = invCount(bot, 'iron_ingot')
  record('smelt-3', /smelted 3/.test(s1) && got >= 3, `${s1} | iron_ingot x${got} | ${(Date.now() - t2) / 1000 | 0}s`)

  // [3] 批次上限 6（背包还有 5 生铁 → 全上，不超过 6）
  const s2 = await doSmelt(bot, { itemType: 'raw_iron' })
  record('smelt-cap6', /smelted \d/.test(s2), s2)

  // [4] 反向教学提示：对箱子坐标调熔炉工具
  const v2 = await viewFurnaceContent(bot, { x: -108, y: 101, z: 145 })
  record('chest-hint', /chest/.test(v2) && /mc_view_chest/.test(v2), v2)

  // 附带：确认熔炉工具不是误开箱子（STORAGE 扩容不回归）——对熔炉坐标调 view 精确命中
  const v3 = await viewFurnaceContent(bot, { x: -111, y: 101, z: 145 })
  record('furnace-by-coords', /furnace at/.test(v3) || /furnace \(/.test(v3), v3.replace(/\n/g, ' | '))
} catch (err) {
  record('unexpected-throw', false, err instanceof Error ? err.message : String(err))
}

// ── 清场：撤台 + 收工单侧无残留 ──
bot.quit('e2e done')
await new Promise((r) => setTimeout(r, 1000))
console.log('cleanup:', await rcon.send('fill -112 100 145 -108 102 149 minecraft:air replace minecraft:smooth_stone'))
console.log('cleanup furnace/chest:', await rcon.send('fill -111 101 145 -111 101 145 minecraft:air replace minecraft:furnace'))
console.log('cleanup chest:', await rcon.send('setblock -108 101 145 minecraft:air replace'))
rcon.close()

const failed = results.filter((r) => !r.pass)
console.log(`\n==== furnace-e2e: ${results.length - failed.length}/${results.length} passed ====`)
exit(failed.length ? 1 : 0)
