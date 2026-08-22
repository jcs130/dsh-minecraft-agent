// 测试客户端：连 225，与 Edward 互动，验证 说话/私聊/聊天接收
const mineflayer = require('mineflayer')

const HOST = '192.168.3.225'
const PORT = 25565
const MYNAME = 'Tester'

const bot = mineflayer.createBot({
  host: HOST,
  port: PORT,
  username: MYNAME,
  auth: 'offline',
  version: '1.21.1',
  viewDistance: 'tiny',
})

bot.on('login', () => console.log('[login] ok, entity id', bot.entity && bot.entity.id))
bot.on('spawn', () => {
  console.log('[spawn] at', JSON.stringify(bot.entity.position))
  console.log('[spawn] nearby players:', Object.keys(bot.players).join(', ') || '(none)')
  setTimeout(() => { console.log('[TEST] 公屏喊话...'); bot.chat('Edward 你好，我是测试玩家，能听到我说话吗？') }, 2500)
  setTimeout(() => { console.log('[TEST] 私聊 Edward...'); bot.whisper('Edward', '这是一条私聊测试，收到请回话') }, 5000)
  setTimeout(() => { console.log('[TEST] 再次公屏...'); bot.chat('Edward，请你公屏回复我一句话，或者私聊回复') }, 8000)
})

bot.on('chat', (username, message) => {
  console.log(`[公屏收到] <${username}> ${message}`)
})
bot.on('whisper', (username, message) => {
  console.log(`[私聊收到] ${username} -> ${message}`)
})
bot.on('playerJoined', (player) => console.log('[join]', player.username))
bot.on('playerLeft', (player) => console.log('[left]', player.username))
bot.on('kicked', (reason) => { console.log('[kicked]', reason); process.exit(2) })
bot.on('error', (err) => console.log('[error]', err.message))
bot.on('end', (reason) => { console.log('[end]', reason); process.exit(0) })

// 55 秒后自动退出（给 Edward 足够的响应时间）
setTimeout(() => { console.log('[timeout] 55s 到，结束'); process.exit(0) }, 55000)
