// 活体探针：用**我们自己的** classificationState 去问本地 decider（jav-craft 形状的一问四题），
// 验证 ①状态形状能被接受 ②答案能通过严格校验 ③审计落盘 ④延迟/用量。
// 需要本地 decider 在跑（默认 127.0.0.1:8000）。跑法见文件末尾。
import { deriveWorldModel, classificationState, collectHostiles } from '../src/mc-perception.ts'
import { callSystemOne, prewarm, DECIDER_THRESHOLDS } from '../src/mc-decider.ts'

const log = (...a) => console.log(...a)

// ── 假 bot（危局：HP 12、饿 6、夜、zombie 3.2 格东、creeper 5 格北、无食物）──
const bot = {
  username: 'Edward',
  entity: {
    name: 'player', position: { x: 128.4, y: 64, z: -301.2 }, yaw: 0, pitch: 0, onGround: true,
    effects: {}, equipment: [null, { name: 'iron_helmet' }, null, null, null],
  },
  health: 12, food: 6, foodSaturation: 2, oxygenLevel: 20,
  experience: { level: 9 }, game: { dimension: 'overworld' },
  time: { day: 12, timeOfDay: 15000 },
  inventory: { slots: new Array(36).fill(null), items: () => ([{ name: 'stone_sword', count: 1 }, { name: 'stone_pickaxe', count: 1 }, { name: 'oak_log', count: 7 }]) },
  heldItem: { name: 'stone_sword' },
  entities: {
    1: { name: 'zombie', position: { x: 131.6, y: 64, z: -301.2 } },
    2: { name: 'creeper', position: { x: 128.4, y: 64, z: -296.2 } },
  },
}

const hostiles = collectHostiles(bot)
const wm = deriveWorldModel({
  now: Date.now(), hp: bot.health, food: bot.food, pos: bot.entity.position, isNight: true, tod: 15000,
  items: bot.inventory.items(), slotsTotal: 36, slotsUsed: 3, equipment: bot.entity.equipment,
  held: bot.heldItem, hostiles, threatFresh: true, deathZones: [], stalledMs: 0,
})
const state = classificationState({
  wm, hostiles, items: bot.inventory.items(), hasFood: false,
  currentGoal: 'craft_tools', goalAgeMs: 42_000, failures: 2, stuckOn: ['need planks'],
  recent: ['dig oak_log ok', 'craft planks ok', 'move to (-295) ok'],
})

log('=== 我方裁剪状态（发给分类器的那部分）===')
log(JSON.stringify(state, null, 1))

// ── jev-craft 形状：一问四题（instructions 里内联当前处境，criteria 定义每个选项何时适用）──
const hostileText = state.nearby_hostiles.map((h) => `${h.name} ${h.distance}m ${h.direction}`).join(', ') || 'none'
const questions = {
  threat_level: {
    type: 'score',
    instructions: `How dangerous is the situation? Hostiles: ${hostileText}. HP ${state.player.health}/20, hunger ${state.player.food}/20. Time: ${state.time_of_day}. Creeper distance: ${state.threat.creeper_distance}.`,
    criteria: [
      'Safe — no threats, good health',
      'Caution — minor threat or night approaching',
      'Moderate danger — hostile nearby but manageable',
      'High danger — close hostile, low health, or multiple threats',
      'Critical — immediate death likely without action',
    ],
  },
  action: {
    type: 'choice',
    instructions: `What should the bot do right now? Hostiles: ${hostileText}. HP ${state.player.health}/20, hunger ${state.player.food}/20. Has food: ${state.has_food}. Goal: ${state.current_goal} (${Math.round(state.goal_age_ms / 1000)}s, ${state.failures} failures, stuck on: ${state.stuck_on.join('; ')}). Defense: armor ${state.defense.armorPieces} pieces, shield ${state.defense.hasShield}.`,
    criteria: {
      fight: 'Attack the nearest hostile — when one is nearby, health is okay, and bot is not too scared',
      flee: 'Run away — when outmatched, low health, or near a creeper',
      eat: 'Eat food — when hungry and food available',
      keep_goal: 'Keep working on current goal — when safe and there is something to do',
      look_around: 'Survey surroundings — when uncertain, stuck, or need to reorient',
    },
  },
  should_eat: {
    type: 'noul',
    instructions: `Should the bot eat now? Hunger ${state.player.food}/20. Has food: ${state.has_food}. Rations: ${state.stock.rations}. In combat: ${state.threat.nearest <= 6 ? 'yes' : 'no'}.`,
    criteria: { true: 'Should eat — hunger low and food available', false: 'No need — hunger fine, no food, or in active combat' },
  },
  flee_direction: {
    type: 'choice',
    instructions: `Which way should the bot flee? ${hostileText}. Position x:${state.player.position.x} z:${state.player.position.z}. Do not run into a hostile.`,
    criteria: {
      north: 'Run north — away from threats to the south',
      south: 'Run south — away from threats to the north',
      east: 'Run east — away from threats to the west',
      west: 'Run west — away from threats to the east',
    },
  },
}

const cfg = { baseUrl: 'http://127.0.0.1:8000', model: 'decider-dev', timeoutMs: 8000, maxAttempts: 2, dataDir: '_decider_probe_out' }

log('\n=== 预热（冷启实测约 2.5s）===')
log(`prewarm: ${await prewarm(cfg)} ms`)

log('\n=== 正式调用（一问四题，单次并行）===')
for (let i = 1; i <= 2; i++) {
  try {
    const r = await callSystemOne(state, questions, cfg)
    const a = r.answers
    log(`第 ${i} 次：${r.latencyMs} ms｜input_tokens=${r.usage?.input_tokens ?? '-'}`)
    log(`  threat_level(Score) = ${a.threat_level.score}  conf=${a.threat_level.confidence?.toFixed(3)}`)
    log(`  action(Choice)      = ${a.action.choice}  conf=${a.action.confidence?.toFixed(3)}  分布=${JSON.stringify(a.action.probabilities)}`)
    log(`  should_eat(Noul)    = ${a.should_eat.noul}`)
    log(`  flee_direction      = ${a.flee_direction.choice}  conf=${a.flee_direction.confidence?.toFixed(3)}`)
    log(`  → 按命名阈值判：逃(${DECIDER_THRESHOLDS.fleeConfidence})→${a.flee_direction.choice}｜打(${DECIDER_THRESHOLDS.fightConfidence})→${a.action.choice === 'fight' ? '是' : '否'}`)
  } catch (e) {
    log(`第 ${i} 次失败：${e.message}`)
  }
}

log('\n=== 审计落盘（F 项验证）===')
try {
  const { readFileSync, readdirSync } = await import('node:fs')
  const dir = '_decider_probe_out'
  log('目录内容：' + JSON.stringify(readdirSync(dir)))
  const lines = readFileSync(`${dir}/decider.jsonl`, 'utf-8').trim().split('\n')
  const last = JSON.parse(lines[lines.length - 1])
  log(`共 ${lines.length} 行；最后一行 keys=${Object.keys(last).join(',')}｜latencyMs=${last.latencyMs}`)
} catch (e) {
  log('审计文件读取失败：' + e.message)
}
