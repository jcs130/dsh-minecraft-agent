import mineflayer from 'mineflayer'

const host = process.env.MC_HOST ?? 'localhost'
const port = Number(process.env.MC_PORT ?? 25565)
const username = process.env.MC_USERNAME ?? 'HarnessBotTest'

console.log(`[test] connecting to ${host}:${port} as "${username}"`)

const bot = mineflayer.createBot({ host, port, username })

bot.once('spawn', () => {
  const p = bot.entity?.position
  console.log('SPAWN_OK', JSON.stringify(p))
  setTimeout(() => {
    console.log('TEST_DONE')
    bot.end('test done')
    process.exit(0)
  }, 1500)
})

bot.on('error', (err) => console.error('BOT_ERROR', err.message))

setTimeout(() => {
  console.error('TIMEOUT: no spawn within 30s')
  process.exit(1)
}, 30_000)
