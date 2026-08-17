// chest-count-probe.mts — 验证容器窗口打开期间 bot.inventory 是否过期（2026-08-17）
// 动机：doSmelt e2e 发现开窗期间 heldCount 数出旧值。若 chest deposit 同样
// 受影响，transferWithChest 的 moved 计算会误报（moved=0 → "no X to deposit"）。
import { readFileSync } from 'node:fs'
import { exit } from 'node:process'
import mineflayer from 'mineflayer'
import { Vec3 } from 'vec3'

const rconMod = await import('./src/rcon.ts')
const Rcon = rconMod.Rcon
const rcon = new Rcon('127.0.0.1', 25575, readFileSync('./data/rcon-secret.txt', 'utf-8').trim())
await rcon.connect()
await rcon.send('setblock -109 100 148 minecraft:smooth_stone replace')
await rcon.send('setblock -109 101 147 minecraft:chest replace')

const bot = mineflayer.createBot({ host: 'localhost', port: 25565, username: 'ProbeBot2' })
await new Promise<void>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('spawn timeout')), 30_000)
  bot.once('spawn', () => { clearTimeout(t); resolve() })
  bot.once('kicked', (r) => reject(new Error('kicked: ' + r)))
})
await rcon.send('tp ProbeBot2 -109 101.0 148')
await new Promise((r) => setTimeout(r, 1500))
console.log('server-side pos:', await rcon.send('data get entity ProbeBot2 Pos'))
await bot.waitForChunksToLoad()
const dbgBlock = bot.blockAt(new Vec3(-109, 101, 147))
console.log('client-side blockAt(-109,101,147):', dbgBlock?.name, '| bot pos:', bot.entity?.position.toString())
await rcon.send('give ProbeBot2 minecraft:cobblestone 10')
await new Promise((r) => setTimeout(r, 800))

const count = (n: string) => bot.inventory.items().reduce((s, i) => (i.name === n ? s + i.count : s), 0)
console.log('before open: cobblestone =', count('cobblestone'))

const chest = await bot.openContainer(bot.blockAt(new Vec3(-109, 101, 147))!)
const before = count('cobblestone')
await chest.deposit(bot.registry.itemsByName.cobblestone.id, null, 4)
const afterOpen = count('cobblestone')
chest.close()
await new Promise((r) => setTimeout(r, 600))
const afterClose = count('cobblestone')
console.log(`before=${before}  afterWhileOpen=${afterOpen}  afterClose=${afterClose}`)
console.log(afterOpen === before && afterClose === before - 4
  ? 'CONFIRMED: bot.inventory stale while window open, refreshed on close (transferWithChest has the same bug)'
  : afterOpen === before - 4
    ? 'REFUTED: inventory updates live while window open'
    : 'INCONCLUSIVE pattern')

bot.quit('probe done')
await new Promise((r) => setTimeout(r, 800))
await rcon.send('setblock -109 101 147 minecraft:air replace')
await rcon.send('setblock -109 100 148 minecraft:air replace')
rcon.close()
exit(0)
