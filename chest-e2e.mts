// chest-e2e.mts - chest deposit/withdraw end-to-end verification (2026-08-17)
// Verifies transferWithChest after the stale-inventory fix: the count must
// SETTLE after close() because the server re-sends the main inventory
// (window 0) asynchronously on window close.
// Cases:
//   [1] deposit 4 cobblestone   -> "deposited 4", inventory 10 -> 6
//   [2] withdraw 2              -> "withdrew 2",  inventory 6 -> 8
//   [3] deposit all (no count)  -> "deposited 8", inventory -> 0
//   [4] deposit with 0 held     -> "no cobblestone in inventory to deposit"
//   [5] furnace-coords hint     -> points at mc_smelt (never opens a chest)
//   [6] enchanting-table hint   -> points at mc_enchant (new hint)
import { readFileSync } from 'node:fs'
import { exit } from 'node:process'
import mineflayer from 'mineflayer'
import pf from 'mineflayer-pathfinder'
import { transferWithChest } from './src/mc-tools.ts'
import { Rcon } from './src/rcon.ts'

const results: Array<{ name: string; pass: boolean; detail: string }> = []
function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} [${name}] ${detail}`)
}

const rcon = new Rcon('127.0.0.1', 25575, readFileSync('./data/rcon-secret.txt', 'utf-8').trim())
await rcon.connect()

// Platform y=100 (stand on 101): (-112..-108, 145..149); furnace (-111,101,145);
// chest (-108,101,145); enchanting table (-109,101,145)
console.log('setup:', await rcon.send('fill -112 100 145 -108 100 149 minecraft:smooth_stone replace minecraft:air'))
console.log('setup:', await rcon.send('setblock -111 101 145 minecraft:furnace replace'))
console.log('setup:', await rcon.send('setblock -108 101 145 minecraft:chest replace'))
console.log('setup:', await rcon.send('setblock -109 101 145 minecraft:enchanting_table replace'))

const bot = mineflayer.createBot({ host: 'localhost', port: 25565, username: 'ProbeBot3' })
bot.loadPlugin(pf.pathfinder)
process.on('unhandledRejection', (e) => { console.error('unhandledRejection:', e) })
await new Promise<void>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('spawn timeout')), 30_000)
  bot.once('spawn', () => { clearTimeout(t); resolve() })
  bot.once('kicked', (r) => reject(new Error('kicked: ' + r)))
  bot.once('error', (e) => reject(e))
})
bot.pathfinder.setMovements(new pf.Movements(bot))
console.log('ProbeBot3 spawned')
await rcon.send('tp ProbeBot3 -110 101.0 147')
await new Promise((r) => setTimeout(r, 1500))
await rcon.send('clear ProbeBot3')
await new Promise((r) => setTimeout(r, 500))
await rcon.send('give ProbeBot3 minecraft:cobblestone 10')
await new Promise((r) => setTimeout(r, 800))

function invCount(name: string): number {
  return bot.inventory.items().reduce((s, i) => (i.name === name ? s + i.count : s), 0)
}

const CHEST = { x: -108, y: 101, z: 145 }
try {
  const t0 = Date.now()
  const r1 = await transferWithChest(bot, { itemType: 'cobblestone', count: 4, ...CHEST }, 'deposit')
  record('deposit-4', /^deposited 4 cobblestone/.test(r1) && invCount('cobblestone') === 6,
    `${r1} | inv=${invCount('cobblestone')} | ${((Date.now() - t0) / 1000).toFixed(1)}s`)

  const r2 = await transferWithChest(bot, { itemType: 'cobblestone', count: 2, ...CHEST }, 'withdraw')
  record('withdraw-2', /^withdrew 2 cobblestone/.test(r2) && invCount('cobblestone') === 8,
    `${r2} | inv=${invCount('cobblestone')}`)

  const r3 = await transferWithChest(bot, { itemType: 'cobblestone', ...CHEST }, 'deposit')
  record('deposit-all', /^deposited 8 cobblestone/.test(r3) && invCount('cobblestone') === 0,
    `${r3} | inv=${invCount('cobblestone')}`)

  const r4 = await transferWithChest(bot, { itemType: 'cobblestone', ...CHEST }, 'deposit')
  record('deposit-zero', /^no cobblestone in inventory to deposit/.test(r4), r4)

  const r5 = await transferWithChest(bot, { itemType: 'cobblestone', x: -111, y: 101, z: 145 }, 'deposit')
  record('furnace-hint', /is a furnace/.test(r5) && /mc_smelt/.test(r5), r5)

  const r6 = await transferWithChest(bot, { itemType: 'cobblestone', x: -109, y: 101, z: 145 }, 'deposit')
  record('enchant-hint', /enchanting table/.test(r6) && /mc_enchant/.test(r6), r6)

  // Partial moves: ask for more than exists -> report "N of M", not a failure.
  await rcon.send('give ProbeBot3 minecraft:cobblestone 10')
  await new Promise((r) => setTimeout(r, 800))
  const r7 = await transferWithChest(bot, { itemType: 'cobblestone', count: 99, ...CHEST }, 'deposit')
  record('deposit-partial', /^deposited 10 of 99 cobblestone/.test(r7) && invCount('cobblestone') === 0,
    `${r7} | inv=${invCount('cobblestone')}`)

  const r8 = await transferWithChest(bot, { itemType: 'cobblestone', count: 99, ...CHEST }, 'withdraw')
  record('withdraw-partial', /^withdrew 20 of 99 cobblestone/.test(r8) && invCount('cobblestone') === 20,
    `${r8} | inv=${invCount('cobblestone')}`)
} catch (err) {
  record('unexpected-throw', false, err instanceof Error ? err.message : String(err))
}

bot.quit('e2e done')
await new Promise((r) => setTimeout(r, 1000))
console.log('cleanup:', await rcon.send('fill -112 100 145 -108 102 149 minecraft:air'))
rcon.close()

const failed = results.filter((r) => !r.pass)
console.log(`\n==== chest-e2e: ${results.length - failed.length}/${results.length} passed ====`)
exit(failed.length ? 1 : 0)
