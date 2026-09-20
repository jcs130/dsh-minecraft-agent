// 感知层「注入预算」实测：把 status() 在各场景下的真实输出打出来，数行数/字数。
// 用途：验证 8/24 那次"砍全量注入"的成果没被我这几轮加回去（用户当时的原话是砍，不是加）。
// 跑法见文件末尾注释。
import { createPerception } from '../src/mc-perception.ts'

function makeBot(over = {}) {
  const handlers = {}
  const bot = {
    on: (ev, cb) => { (handlers[ev] ||= []).push(cb) },
    emit: (ev, ...a) => { for (const cb of handlers[ev] || []) cb(...a) },
    username: 'Edward',
    entity: {
      name: 'player',
      position: { x: 128.4, y: 64, z: -301.2 },
      yaw: 0, pitch: 0, onGround: true, velocity: { x: 0, y: 0, z: 0 },
      effects: {}, equipment: [null, { name: 'iron_helmet' }],
    },
    health: 20, food: 20, foodSaturation: 5, oxygenLevel: 20, isSleeping: false,
    experience: { level: 12, points: 3, progress: 0.4 },
    game: { dimension: 'overworld', difficulty: 'normal', gameMode: 'survival', minY: -64, height: 384 },
    isRaining: false, rainState: 0, thunderState: 0,
    time: { day: 12, timeOfDay: 4000 },
    world: { columns: { 'a': {}, 'b': {} } },
    inventory: {
      slots: [
        { name: 'stone_pickaxe', count: 1 }, null, { name: 'oak_log', count: 7 }, null, null,
        { name: 'iron_helmet' }, null, null, null,
        null, null, null, null, null, null, null, null,
      ],
      items: () => ([
        { name: 'stone_pickaxe', count: 1, maxDurability: 131, durabilityUsed: 40 },
        { name: 'oak_log', count: 7 },
      ]),
    },
    heldItem: { name: 'stone_pickaxe', count: 1, maxDurability: 131, durabilityUsed: 40 },
    registry: { items: { 15: { name: 'iron_ore' } }, sounds: { 183: { name: 'entity.zombie.ambient' } }, effects: {} },
    blockAt: () => ({ name: 'grass_block', boundingBox: 'block', light: 12, skyLight: 15, biome: { name: 'plains' } }),
    entities: {}, players: { Edward: { username: 'Edward' } },
    ...over,
  }
  return bot
}

function show(label, text) {
  const lines = text.split('\n')
  const chars = text.length
  console.log(`\n===== ${label} =====`)
  console.log(`行数 ${lines.length} ｜ 字符 ${chars} ｜ 估算 token ≈ ${Math.round(chars / 1.6)}`)
  for (const l of lines) console.log('  | ' + l)
}

const noLos = () => true

// ① 首次接入（所有门控都会触发一次）
{
  const bot = makeBot()
  const p = createPerception({ body: () => bot, username: 'Edward', log: () => {}, socialLines: () => [], recentActions: () => [] })
  show('① 首次接入', p.status())
}

// ② 稳定常态：连走 5 步什么都不变（这是最该省 token 的场景）
{
  const bot = makeBot()
  const p = createPerception({ body: () => bot, username: 'Edward', log: () => {}, socialLines: () => [], recentActions: () => [] })
  p.status()
  let last = ''
  for (let i = 0; i < 5; i++) last = p.status()
  show('② 稳定常态（第 6 步，什么都没变）', last)
}

// ③ 战斗中：怪靠近 + 挨打 + 掉血
{
  const bot = makeBot()
  const p = createPerception({ body: () => bot, username: 'Edward', log: () => {}, socialLines: () => [], recentActions: () => [] })
  p.status()
  bot.entities = { 1: { name: 'zombie', position: { x: 131, y: 64, z: -301 } }, 2: { name: 'creeper', position: { x: 130, y: 64, z: -300 } } }
  bot.health = 12
  bot.emit('health')
  bot.emit('entityHurt', bot.entity, { name: 'zombie' })
  show('③ 战斗中（挨了一击 + 两只怪）', p.status())
}

// ④ 危险常态：血量持续低（看会不会每步刷同一行）
{
  const bot = makeBot()
  const p = createPerception({ body: () => bot, username: 'Edward', log: () => {}, socialLines: () => [], recentActions: () => [] })
  bot.health = 7
  p.status()
  const a = p.status()
  const b = p.status()
  show('④ 危险常态（血 7，第 2/3 步）', a + '\n--- 下一步 ---\n' + b)
}

// ⑤ 溺水：氧气持续低
{
  const bot = makeBot()
  const p = createPerception({ body: () => bot, username: 'Edward', log: () => {}, socialLines: () => [], recentActions: () => [] })
  bot.oxygenLevel = 6
  p.status()
  const a = p.status()
  const b = p.status()
  show('⑤ 溺水（氧气 6，连续两步）', a + '\n--- 下一步 ---\n' + b)
}

// ⑥ 长时间不挪窝（检验"停滞"判定是否被区域粒度误导）
{
  const bot = makeBot()
  const p = createPerception({ body: () => bot, username: 'Edward', log: () => {}, socialLines: () => [], recentActions: () => [] })
  p.status()
  for (let i = 0; i < 4; i++) p.status()
  show('⑥ 同点位连走 5 步', p.status())
}
