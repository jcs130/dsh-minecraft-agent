// 综合验证：Tester 喊话 + 监控 Edward 的 episodic 决策（区分 chatBuffer 没收 vs LLM 没回应）
const mineflayer = require('mineflayer')
const { DatabaseSync } = require('node:sqlite')

const DB = 'C:/Users/lzl19/.copaw/workspaces/default/data/client.db'
let lastEpisodicId = 0

function snapshotEpisodic() {
  try {
    const db = new DatabaseSync(DB, { readOnly: true })
    const rows = db.prepare('SELECT id, ts, text FROM episodic WHERE username=? ORDER BY id DESC LIMIT 6').all('Edward')
    db.close()
    if (rows.length === 0) return
    const newest = rows[0].id
    if (newest > lastEpisodicId) {
      lastEpisodicId = newest
      console.log('--- Edward 最新决策 ---')
      for (const r of rows.slice().reverse()) {
        const txt = r.text.slice(0, 200)
        console.log(`  [${r.ts.slice(11, 19)}] ${txt}`)
      }
      // 检查是否看到 Tester 或回应聊天
      const all = rows.map(r => r.text).join(' ')
      if (all.includes('Tester')) console.log('  >>> Edward 的决策里出现了 "Tester"！')
    }
  } catch (e) { console.log('  (episodic 查询失败:', e.message, ')') }
}

const bot = mineflayer.createBot({
  host: '192.168.3.225', port: 25565, username: 'Tester2',
  auth: 'offline', version: '1.21.1', viewDistance: 'tiny',
})

bot.on('spawn', () => {
  console.log('[Tester2] spawned at', JSON.stringify(bot.entity.position))
  console.log('[Tester2] 附近玩家:', Object.keys(bot.players).join(', ') || '(none)')
  // 记录 Edward 当前坐标
  const ed = bot.players['Edward']
  if (ed && ed.entity) console.log('[Tester2] Edward 位置:', JSON.stringify(ed.entity.position))
  setTimeout(() => { console.log('\n[TEST] 公屏喊话 1...'); bot.chat('Edward 你好！我是来测试的玩家，请你用 mc_voice 或 mc_chat 回复我一句话') }, 2000)
  setTimeout(() => { console.log('[TEST] 私聊...'); bot.whisper('Edward', '私聊测试：收到请私聊回复我') }, 6000)
  setTimeout(() => { console.log('\n[TEST] 公屏喊话 2（强调）...'); bot.chat('Edward！回答我：你现在看到几个玩家？') }, 12000)
})

bot.on('chat', (u, m) => console.log(`[公屏] <${u}> ${m}`))
bot.on('whisper', (u, m) => console.log(`[私聊] ${u} -> ${m}`))
bot.on('error', (e) => console.log('[err]', e.message))
bot.on('kicked', (r) => { console.log('[kicked]', r); process.exit(2) })
bot.on('end', (r) => { console.log('[end]', r); process.exit(0) })

// 每 6 秒监控 Edward 的 episodic
const mon = setInterval(snapshotEpisodic, 6000)
setTimeout(() => { clearInterval(mon); snapshotEpisodic(); console.log('[done] 结束'); process.exit(0) }, 50000)
