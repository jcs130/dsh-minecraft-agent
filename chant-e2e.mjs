// mc_chant 快路径端到端联调（一次性）：测试 bot 念咒 → 女神施法 → RCON 验证位移
// 用法：node chant-e2e.mjs   （在 scratch-plugin 目录下跑，复用其 node_modules）
import net from 'node:net'
import mf from 'mineflayer'

// ── 迷你 RCON 客户端（纯 ASCII 命令）──────────────────────────────
function rconCommand(host, port, password, cmd, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port })
    let buf = Buffer.alloc(0)
    let reqId = Math.floor(Math.random() * 10000) + 1
    const fail = (e) => { try { sock.destroy() } catch {} ; reject(e) }
    const timer = setTimeout(() => fail(new Error('rcon timeout')), timeoutMs)
    const send = (type, payload) => {
      const p = Buffer.from(payload, 'utf8')
      const len = 4 + 4 + p.length + 2
      const out = Buffer.alloc(4 + len)
      out.writeInt32LE(len, 0); out.writeInt32LE(reqId, 4); out.writeInt32LE(type, 8)
      p.copy(out, 12); out.writeInt8(0, 12 + p.length); out.writeInt8(0, 13 + p.length)
      sock.write(out)
    }
    sock.on('connect', () => send(3, password))
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d])
      while (buf.length >= 14) {
        const len = buf.readInt32LE(0)
        if (buf.length < 4 + len) break
        const rid = buf.readInt32LE(4)
        const type = buf.readInt32LE(8)
        const payload = buf.slice(12, 2 + len).toString('utf8')
        buf = buf.slice(4 + len)
        if (type === 2 && rid === -1) { clearTimeout(timer); fail(new Error('rcon auth failed')); return }
        if (rid === reqId) {
          if (type === 2) { // auth ok
            reqId += 1
            send(2, cmd)
          } else { // command response
            clearTimeout(timer); sock.destroy(); resolve(payload)
          }
        }
      }
    })
    sock.on('error', (e) => { clearTimeout(timer); fail(e) })
  })
}

const RCON = { host: 'localhost', port: 25575 }
const secret = (await import('node:fs')).readFileSync('./data/rcon-secret.txt', 'utf8').trim()

const rc = (cmd) => rconCommand(RCON.host, RCON.port, secret, cmd)
// 注意：1.21.11 的 `data get entity X Pos` 返回裸数组（无 "Pos:" 标签）：
// "TestChant has the following entity data: [-115.5d, 76.0d, 141.5d]"
const getPos = async (name) => {
  const out = await rc(`data get entity ${name} Pos`)
  const m = out && out.match(/\[([-\d.]+)d,\s*([-\d.]+)d,\s*([-\d.]+)d\]/)
  return m ? { x: +m[1], y: +m[2], z: +m[3] } : (console.log('[e2e] RAW rcon:', JSON.stringify(out)), null)
}

const replies = []
const bot = mf.createBot({ host: 'localhost', port: 25565, username: 'TestChant', version: false })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

bot.on('chat', (username, message) => {
  if (username !== 'TestChant') replies.push(`${username}: ${message}`)
})
bot.on('kicked', (r) => { console.error('KICKED:', String(r)); process.exit(2) })
bot.on('error', (e) => { console.error('BOT ERROR:', e.message); process.exit(2) })

await new Promise((r) => bot.once('spawn', r))
console.log('[e2e] TestChant spawned (round 2: innate=tp granted, expecting gate exemption), waiting 6s...')
await sleep(6000)

const before = await getPos('TestChant')
console.log('[e2e] pos before:', JSON.stringify(before))

console.log('[e2e] chanting: 撕裂虚空，向东传送十格')
bot.chat('撕裂虚空，向东传送十格')

await sleep(9000)
const after = await getPos('TestChant')
console.log('[e2e] pos after :', JSON.stringify(after))

console.log('[e2e] chat log during test:')
for (const r of replies) console.log('   |', r)

let ok = false
if (before && after) {
  const dx = after.x - before.x
  console.log(`[e2e] delta x = ${dx.toFixed(1)} (expect ~+10, east)`)
  ok = dx >= 8.5 && dx <= 11.5
}
console.log(ok ? '[e2e] RESULT: PASS ✅' : '[e2e] RESULT: FAIL ❌')
try { bot.quit() } catch {}
await sleep(500)
process.exit(ok ? 0 : 1)
