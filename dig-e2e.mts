// dig-e2e.mts - mc_dig/digAt end-to-end verification (2026-08-17)
// DEFECT-20260817-080630-mc_place: the loop prompt taught "嵌方块就 mc_dig
// 挖开头顶/身旁" but no mc_dig tool existed — Kirito retried mc_place against
// the blocking stone 5x (later literally got `unknown tool "mc_dig"`).
// This e2e proves the new digAt primitive against the live server:
//   [1] defect-replay  : stone beside head-level (the (-98,41,148) case)
//   [2] above-head     : stone directly over the head in own column
//   [3] already-air    : friendly no-op message
//   [4] bedrock        : friendly unbreakable message (no throw)
//   [5] drop-pickup    : digging dirt picks the drop up
//   [6] far-walk       : target >4.5 blocks away -> walks, then digs
import { readFileSync } from 'node:fs'
import { exit } from 'node:process'
import mineflayer from 'mineflayer'
import pf from 'mineflayer-pathfinder'
import { plugin as toolPlugin } from 'mineflayer-tool'
import { Vec3 } from 'vec3'
import { digAt } from './src/mc-tools.ts'
import { Rcon } from './src/rcon.ts'

const results: Array<{ name: string; pass: boolean; detail: string }> = []
function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} [${name}] ${detail}`)
}

const rcon = new Rcon('127.0.0.1', 25575, readFileSync('./data/rcon-secret.txt', 'utf-8').trim())
await rcon.connect()

// Platform y=100 over (-118..-110, 145..149); probe stands at (-115, 101, 147).
console.log('setup:', await rcon.send('fill -118 100 145 -110 100 149 minecraft:smooth_stone replace minecraft:air'))
console.log('setup:', await rcon.send('setblock -114 102 147 minecraft:stone replace'))   // [1] beside, head level
console.log('setup:', await rcon.send('setblock -115 103 147 minecraft:stone replace'))   // [2] above head (own column)
console.log('setup:', await rcon.send('setblock -113 102 147 minecraft:bedrock replace')) // [4] unbreakable
console.log('setup:', await rcon.send('setblock -116 102 147 minecraft:dirt replace'))    // [5] guaranteed drop
console.log('setup:', await rcon.send('setblock -110 101 149 minecraft:stone replace'))   // [6] ~5.4 blocks away

const bot = mineflayer.createBot({ host: 'localhost', port: 25565, username: 'ProbeDig' })
bot.loadPlugin(pf.pathfinder)
bot.loadPlugin(toolPlugin)
process.on('unhandledRejection', (e) => { console.error('unhandledRejection:', e) })
await new Promise<void>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('spawn timeout')), 30_000)
  bot.once('spawn', () => { clearTimeout(t); resolve() })
  bot.once('kicked', (r) => reject(new Error('kicked: ' + r)))
  bot.once('error', (e) => reject(e))
})
bot.pathfinder.setMovements(new pf.Movements(bot))
console.log('ProbeDig spawned')
await rcon.send('tp ProbeDig -115 101.0 147')
await new Promise((r) => setTimeout(r, 1500))
await rcon.send('clear ProbeDig')
await new Promise((r) => setTimeout(r, 500))
await rcon.send('give ProbeDig minecraft:iron_pickaxe 1')
await new Promise((r) => setTimeout(r, 800))

function blockAt(x: number, y: number, z: number) {
  return bot.blockAt(new Vec3(x, y, z))
}

try {
  // [1] defect replay: the literal stone-beside case like (-98,41,148)
  const r1 = await digAt(bot, { x: -114, y: 102, z: 147 })
  const gone1 = blockAt(-114, 102, 147)
  record('defect-replay-stone-beside', /^dug stone at \(-114, 102, 147\)/.test(r1) && gone1?.name === 'air',
    `${r1} | blockNow=${gone1?.name}`)

  // [2] above head (own column): 2 above feet
  const r2 = await digAt(bot, { x: -115, y: 103, z: 147 })
  const gone2 = blockAt(-115, 103, 147)
  record('stone-above-head', /^dug stone at \(-115, 103, 147\)/.test(r2) && gone2?.name === 'air',
    `${r2} | blockNow=${gone2?.name}`)

  // [3] digging air is a friendly no-op, not an error
  const r3 = await digAt(bot, { x: -115, y: 103, z: 147 })
  record('already-air', /^already air at/.test(r3), r3)

  // [4] bedrock refuses politely (no throw, no dig)
  const r4 = await digAt(bot, { x: -113, y: 102, z: 147 })
  const bed = blockAt(-113, 102, 147)
  record('bedrock-unbreakable', /cannot be dug/.test(r4) && bed?.name === 'bedrock',
    `${r4} | blockNow=${bed?.name}`)

  // [5] dirt drops and gets picked up
  const before = bot.inventory.items().reduce((s, i) => s + i.count, 0)
  const r5 = await digAt(bot, { x: -116, y: 102, z: 147 })
  await new Promise((r) => setTimeout(r, 1500))
  const dirtNow = bot.inventory.items().filter((i) => i.name === 'dirt').reduce((s, i) => s + i.count, 0)
  record('dirt-drop-picked-up', /^dug dirt at/.test(r5) && dirtNow >= 1,
    `${r5} | dirtInInv=${dirtNow} (before total=${before})`)

  // [6] far target: walks into range first, then digs
  const r6 = await digAt(bot, { x: -110, y: 101, z: 149 })
  const gone6 = blockAt(-110, 101, 149)
  record('far-walk-then-dig', /^dug stone at \(-110, 101, 149\)/.test(r6) && gone6?.name === 'air',
    `${r6} | blockNow=${gone6?.name}`)
} catch (err) {
  record('unexpected-throw', false, err instanceof Error ? err.message : String(err))
}

bot.quit('e2e done')
await new Promise((r) => setTimeout(r, 1000))
console.log('cleanup:', await rcon.send('fill -118 100 145 -110 104 149 minecraft:air'))
rcon.close()

const failed = results.filter((r) => !r.pass)
console.log(`\n==== dig-e2e: ${results.length - failed.length}/${results.length} passed ====`)
exit(failed.length ? 1 : 0)
