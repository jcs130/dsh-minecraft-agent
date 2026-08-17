import mineflayer from 'mineflayer'
import pf from 'mineflayer-pathfinder'

const host = process.env.MC_HOST ?? 'localhost'
const bot = mineflayer.createBot({ host, port: Number(process.env.MC_PORT ?? 25565), username: 'PathfinderTest' })
bot.loadPlugin(pf.pathfinder)

const TARGET = { x: -35, y: 66, z: 72 }

bot.once('spawn', () => {
  console.log('spawned at', JSON.stringify(bot.entity.position))
  const movements = new pf.Movements(bot)
  bot.pathfinder.setMovements(movements)
  bot.pathfinder.setGoal(new pf.goals.GoalNear(TARGET.x, TARGET.y, TARGET.z, 2))

  const start = Date.now()
  const timer = setInterval(() => {
    const p = bot.entity.position
    const dist = p.distanceTo(TARGET)
    console.log(`t=${((Date.now() - start) / 1000).toFixed(1)}s pos=(${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)}) dist=${dist.toFixed(1)}`)
    if (dist <= 3 || Date.now() - start > 30_000) {
      clearInterval(timer)
      console.log(`DONE dist=${dist.toFixed(1)}`)
      bot.end('test done')
      process.exit(0)
    }
  }, 2000)
})

bot.on('error', (e) => console.error('BOT_ERROR', e.message))
bot.on('goal_reached', () => console.log('EVENT goal_reached'))

setTimeout(() => {
  console.error('TIMEOUT 45s')
  process.exit(1)
}, 45_000)
