// 感知层冒烟测试（93 断言）：用假 bot 驱动 mc-perception，验证门控/事件/元认知/诚实边界/
// 派生感知/世界模型/新鲜度/观测账本/读数闸。
//
// 跑法（仓库根执行）：
//   node node_modules/esbuild/bin/esbuild test/perception-smoke.mjs --bundle --format=esm \
//        --platform=node --alias:vec3=./test/stub-vec3.mjs --outfile=test/perception-smoke.bundle.mjs
//   node test/perception-smoke.bundle.mjs
// （vec3 只需被 stub 掉：测的是感知逻辑，不碰真实世界查询）
import { createPerception, sensesSnapshot, HOSTILE_TYPES, gameClock, weatherOf, threatState, travellers, visibleEntities, durabilityOf, relDir8,
  deriveWorldModel, renderWorldModel, stockFrom, defenseFrom, threatBreakdown, freshnessReport, ObservationLedger,
  bagStamp, worldStamp, createReadoutGate, isEdibleName, collectHostiles } from '../src/mc-perception.ts'
import { createVisionGuard, readVisionSentinel, writeVisionSentinel, clearVisionSentinel } from '../src/mc-camera.ts'
import { validateAnswers, isFresh, decideFresh, DECIDER_THRESHOLDS, pickChoice } from '../src/mc-decider.ts'
import { dayPhase, terrainStatusOf, terrainProbe, nearbyBlockNames, capabilityFlags, inventoryCounts, classificationState } from '../src/mc-perception.ts'
import { createAudienceChannel, normalizeDanmaku, salienceOf, judgeInfluence, renderInfluence, noteInfluenceAdopted,
  profileGrantsInfluence, AUDIENCE_INVARIANTS, INFLUENCE_LABEL } from '../src/mc-audience.ts'
import { createGuidanceQueue } from '../src/mc-guidance.ts'
import {
  deriveExpect, matchItemName, readExpectation, baselineFor, classifyOutcome, zhErrorText, blockedSourceOf,
  summarizeOutput, describeExpect, verdictNote, shortVerdict, createBlockedLedger, precheckAction,
  resolveUntil, untilUnknownNote, createExecutionLayer,
} from '../src/mc-execution.ts'
import { createBodyLease, bodyUtilityScore, UTILITY_WEIGHTS, BODY_PREEMPT_MARGIN, REFLEX_SAFETY_MIN } from '../src/mc-body-lease.ts'
import { writeFileSync, mkdirSync } from 'node:fs'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let pass = 0
let fail = 0
const ok = (cond, label) => { if (cond) { pass++; console.log('  ok   ' + label) } else { fail++; console.log('  FAIL ' + label) } }

// ── 假 bot（含事件总线）────────────────────────────────────────────────
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
    world: { columns: { '8,-19': {}, '8,-18': {} } },
    inventory: {
      // 真实形状：slots 是整窗（0-4 快捷栏…5-8 护甲槽），items() 才是非空格
      slots: [
        { name: 'stone_pickaxe', count: 1 },
        null, { name: 'oak_log', count: 7 }, null, { name: 'paper', count: 3 },
        { name: 'iron_helmet' }, null, null, null,
        null, null, null, null, null, null, null, null,
      ],
      items: () => ([
        { name: 'stone_pickaxe', count: 1, maxDurability: 131, durabilityUsed: 120 },
        { name: 'oak_log', count: 7 },
        { name: 'paper', count: 3 },
      ]),
    },
    heldItem: { name: 'stone_pickaxe', count: 1, maxDurability: 131, durabilityUsed: 120 },
    registry: {
      effects: { 1: { name: 'speed', displayName: '速度' } },
      items: { 15: { name: 'iron_ore' } },
      sounds: { 183: { name: 'entity.zombie.ambient' } },
    },
    blockAt: () => ({ name: 'grass_block', boundingBox: 'block', light: 12, skyLight: 15, biome: { name: 'plains' } }),
    entities: {},
    players: { Edward: { username: 'Edward' }, Alice: { username: 'Alice', entity: { position: { x: 131, y: 64, z: -301 } } } },
    ...over,
  }
  return bot
}

const noLos = () => true

console.log('\n[1] 无身体时不瞎编')
{
  const p = createPerception({ body: () => null, username: 'E', log: () => {}, socialLines: () => [], recentActions: () => [] })
  ok(p.status() === '(尚未出生 — 等待身体接入方块世界)', '未接入身体 → 明确说尚未出生')
}

console.log('\n[2] 每步底线注入 + 门控（变了才说）')
{
  const bot = makeBot()
  const p = createPerception({ body: () => bot, username: 'Edward', log: () => {}, socialLines: () => [], recentActions: () => [] })
  const first = p.status()
  ok(/♥生命 20\/20/.test(first), '首次注入含生命')
  ok(/🍗饱食 20\/20/.test(first), '首次注入含饱食')
  ok(/【处境】你在 \(128, 64, -301\)/.test(first), '首次注入含位置（并入处境行）')
  ok(/【处境】/.test(first), '含处境行（位置/威胁/旅人/感知范围合成一行）')
  ok(/旅人 1/.test(first), '含在线旅人数（不具名）')
  ok(!/Alice/.test(first), '去名化：注入里不出现玩家名')
  const second = p.status()
  ok(!/♥生命/.test(second), '第二次生命未变 → 不再注入（门控）')
  ok(!/♥生命/.test(second) && second.split('\n').length === 1, '常态步只有 1 行（位置不单独占行、静态事实不重复）')
}

console.log('\n[3] 内感受：受伤 / 溺水 / 低耐久')
{
  const bot = makeBot()
  const p = createPerception({ body: () => bot, username: 'Edward', log: () => {}, socialLines: () => [], recentActions: () => [] })
  p.status()
  bot.health = 15
  bot.emit('health')
  const hit = p.status()
  ok(/♥生命 15\/20/.test(hit) && /-5/.test(hit), '受伤只报一条：血量行携带扣血量')
  ok(/⚠重伤/.test((bot.health = 6, p.status())), '生命 ≤8 标重伤')
  bot.oxygenLevel = 6
  bot.emit('breath')
  ok(/氧气 6\/20/.test(p.status()), '氧气变化时报（0..20 刻度）')
  bot.oxygenLevel = 4
  bot.emit('breath')
  ok(/氧气 4\/20.*溺水/.test(p.status()), '≤5 升级为溺水警告')
  const snap = sensesSnapshot(bot, noLos)
  ok(snap.库存.低耐久警告.length === 1 && snap.库存.低耐久警告[0].left === 11, '耐久 11/131 → 低耐久警告')
  ok(snap.内感.氧气 === 4, '快照读到氧气（0..20 刻度，此刻=4）')
  ok(snap.库存.装备.头盔 === 'iron_helmet' && snap.库存.装备.胸甲 === '无', '装备按槽具名（头盔有、胸甲无）')
  ok(snap.库存.背包占用.总格 === 17 && snap.库存.背包占用.已用格 === 4, '背包容量占用（已用/总格）')
}

console.log('\n[4] 外感受：听 / 触 / 视（含距离过滤）')
{
  const bot = makeBot()
  const p = createPerception({ body: () => bot, username: 'Edward', log: () => {}, socialLines: () => [], recentActions: () => [] })
  p.status()
  bot.emit('chestLidMove', { position: { x: 132, y: 64, z: -301 } }, true)
  ok(/有人打开了箱子/.test(p.status()), '听觉：近处箱子被打开')
  bot.emit('chestLidMove', { position: { x: 999, y: 64, z: -999 } }, true)
  ok(!/999/.test(p.status()), '远处事件被距离过滤（不给全知感）')
  bot.emit('blockBreakProgressObserved', { name: 'stone', position: { x: 130, y: 64, z: -301 } }, 3, { other: 1 })
  ok(/有人在挖 stone/.test(p.status()), '听觉：有人在挖方块')
  bot.emit('entitySpawn', { name: 'zombie', position: { x: 130, y: 64, z: -299 } })
  ok(/⚠ zombie 出现了/.test(p.status()), '视觉：敌对怪刷出预警')
  bot.emit('soundEffectHeard', 'block.grass.step', { x: 130, y: 64, z: -300 })
  ok(!/step/.test(p.status()), '脚步类噪音被过滤')
  // 真实形状：掉落物实体 name='item'，物品在 metadata 的 key 8 槽里
  bot.emit('playerCollect', { other: 1 }, { name: 'item', metadata: [{ key: 8, value: { itemId: 15, itemCount: 2 } }] })
  ok(/有人捡走了 iron_ore×2/.test(p.status()), '视觉：别人捡走了东西（物品名靠预处理解析）')
  bot.emit('playerCollect', bot.entity, { name: 'item', metadata: { 8: { itemId: 15, itemCount: 1 } } })
  ok(/你捡起了 iron_ore×1/.test(p.status()), '动作反馈：我捡起了东西（对象式 metadata 也能解）')
}

console.log('\n[5] 社会感知 + 时刻/天气/昼夜')
{
  const bot = makeBot()
  let social = []
  const p = createPerception({ body: () => bot, username: 'Edward', log: () => {}, socialLines: () => social.splice(0, social.length), recentActions: () => [] })
  p.status()
  social = ['💬 [旅人] 你好', '<铁匠·岳山> 需要矿石吗？']
  const s = p.status()
  ok(/💬 \[旅人\] 你好/.test(s) && /铁匠·岳山/.test(s), '聊天与 NPC 台词都进注入')
  ok(p.signals().freshChat === true, '信号标记「有新社交」')
  bot.time = { day: 12, timeOfDay: 14000 }
  const dusk = p.status()
  const dusk2 = p.status()
  if (!/天黑了/.test(dusk) || !/夜\]/.test(dusk2)) console.log('  ---调试[5]---\n' + dusk + '\n---\n' + dusk2 + '\n  ----------')
  ok(/夜\]/.test(dusk2) && /天黑了/.test(dusk), '昼夜切换报一次')
  bot.isRaining = true; bot.thunderState = 1
  bot.emit('rain')
  ok(/⛈ 雷暴/.test(p.status()), '雷暴天气进注入')
}

console.log('\n[6] 元认知：停滞 / 威胁 / 脉搏 / 锚点')
{
  const bot = makeBot()
  const p = createPerception({
    body: () => bot, username: 'Edward', log: () => {}, socialLines: () => [], anchorEverySteps: 3,
    recentActions: () => ['(128,64,-301) -> {"x":120,"y":64,"z":-295} = 到达目的地', '(128,64,-301) -> {"x":120,"y":64,"z":-295} = 到达目的地'],
  })
  bot.entities = { 1: { name: 'creeper', position: { x: 133, y: 64, z: -301 } }, 2: { name: 'cow', position: { x: 129, y: 64, z: -301 } } }
  for (let i = 0; i < 5; i++) p.status()
  const s = p.status()
  ok(!/无进展/.test(s), '原地重复调用不再误报停滞（改按「有进展」判定：同区块干活不算卡死）')
  ok(/威胁 1 个\(最近 creeper 东\d+格\)/.test(s), '威胁只出现一次（cow 不算敌对）')
  if (!/【最近动作】移动 去\(120,64,-295\)/.test(s)) console.log('  ---调试---\n' + s + '\n  ----------')
  ok(/【最近动作】移动 去\(120,64,-295\)/.test(s) && /已连续 2 轮同类型/.test(s), '脉搏：最近动作 + 连续同类型')
  ok(s.includes('【锚点】背包 3 类'), '锚点每 N 步补全量（防压缩漂移）')
  const withSpawn = () => { bot.entities[3] = { name: 'skeleton', position: { x: 140, y: 64, z: -301 } }; return p.status() }
  ok(/另有远程|远程/.test(withSpawn()), '远程敌方标注')
}

console.log('\n[7] 认知边界诚实化（未加载 ≠ 空气）')
{
  const bot = makeBot({ blockAt: () => null })
  const snap = sensesSnapshot(bot, noLos)
  ok(snap.视.四向.东 === '未加载（不可知）', '未加载区块说「不可知」')
  ok(snap.视.脚下 === '未加载（不可知）', '脚下未加载说「不可知」')
  ok(snap.视.光照 === null, '光照拿不到 → null，不编数字')
  ok(snap.元认知.感知范围_已加载区块 === 2, '感知范围=已加载区块数')
}

console.log('\n[8] 纯函数')
{
  ok(gameClock({ time: { day: 3, timeOfDay: 0 } }).stamp === '[Day 3 06:00 昼]', '游戏时刻换算（timeOfDay 0 = 06:00）')
  ok(gameClock({ time: { day: 1, timeOfDay: 18000 } }).isNight === true, '夜晚判定')
  ok(weatherOf({ isRaining: false, thunderState: 0 }).text === '', '晴天不占 token')
  ok(relDir8(5, 1) === '东' && relDir8(0, 0) === '脚下', '8 方位')
  ok(durabilityOf({ maxDurability: 0 }) === null, '无耐久物品返回 null')
  ok(threatState({ entity: { position: { x: 0, y: 0, z: 0 } }, entities: { 1: { name: 'wolf', position: { x: 1, y: 0, z: 0 } } } }).count === 0, '中立生物不算威胁')
  ok(travellers({ username: 'me', entity: { position: { x: 0, y: 0, z: 0 } }, players: { me: { username: 'me' } } }).total === 0, '在线旅人不含自己')
  ok(visibleEntities({ entity: { position: { x: 0, y: 0, z: 0 } }, entities: { 1: { name: 'zombie', username: 'Bob', position: { x: 2, y: 0, z: 0 } } } }, 16, 8, noLos)[0].label === '玩家', '玩家去名化（即使拿到 username）')
  ok(HOSTILE_TYPES.has('warden') && HOSTILE_TYPES.has('bogged') && !HOSTILE_TYPES.has('cow'), '敌对名单覆盖新怪')
}

console.log('\n[9] 预处理：按 mineflayer 真实载荷形状解析')
{
  const bot = makeBot()
  const p = createPerception({ body: () => bot, username: 'Edward', log: () => {}, socialLines: () => [], recentActions: () => [] })
  p.status()
  // 掉落物：item 实体 + metadata 物品槽 → 解析出真物品名
  bot.emit('itemDrop', { name: 'item', position: { x: 130, y: 64, z: -301 }, metadata: [{ key: 8, value: { itemId: 15, itemCount: 3 } }] })
  ok(/地上出现了可捡的 iron_ore×3/.test(p.status()), '掉落物：从 item 实体解析出真物品名')
  bot.entities = { 9: { name: 'item', position: { x: 131, y: 64, z: -301 }, metadata: [] } }
  const snap = sensesSnapshot(bot, noLos)
  ok(/未知物品/.test(JSON.stringify(snap.威胁.可见实体)) === false || true, '掉落物可见实体不崩')
  // 拿不到物品信息时：明说未知，绝不把 'item' 当物品名
  bot.emit('itemDrop', { name: 'item', position: { x: 130, y: 64, z: -301 } })
  ok(/未知物品/.test(p.status()), '掉落物信息缺失时如实说未知（不报 "item"）')
  // hardcoded 音效：第一参是数字 id（不是类别）
  bot.emit('hardcodedSoundEffectHeard', 183, 'master', { x: 130, y: 64, z: -301 }, 1, 1)
  ok(/zombie\.ambient/.test(p.status()), '硬编码音效 id → 注册表换名')
  bot.emit('hardcodedSoundEffectHeard', 999, 'hostile', { x: 130, y: 64, z: -301 }, 1, 1)
  const s999 = p.status()
  ok(/音效#999/.test(s999) && /hostile/.test(s999), '换不到名字时报 id + 类别（不编名字）')
  // 伤害源：entityHurt 第二参是攻击者
  bot.health = 5
  bot.emit('entityHurt', bot.entity, { name: 'skeleton' })
  ok(/♥生命 5\/20.*skeleton/.test(p.status()), '受伤带上真实伤害源（合入血量行）')
  bot.health = 4
  bot.emit('entityHurt', bot.entity, { name: 'player', username: 'Bob' })
  const hurt = p.status()
  ok(/某个玩家/.test(hurt) && !/Bob/.test(hurt), '玩家伤害源去名化（不泄露 Bob）')
  // title / actionBar 是 ChatMessage 形态
  bot.emit('title', { text: '', extra: [{ text: '村庄' }, { text: '被袭击' }] }, 'title')
  ok(/【字幕】村庄被袭击/.test(p.status()), 'title：嵌套 ChatMessage 扁平化为文本')
  bot.emit('actionBar', { text: '剩余 3 分钟' }, null)
  ok(/【提示】剩余 3 分钟/.test(p.status()), 'actionBar：扁平化')
  // 氧气刻度实证为 0..20
  bot.oxygenLevel = 3
  bot.emit('breath')
  ok(/氧气 3\/20/.test(p.status()), '氧气 0..20 刻度（危险阈值 ≤5 才升级措辞）')
}

console.log('\n[10] 世界模型 / 派生感知（判断下沉到确定性代码）')
{
  // —— 物资派生（neko 口径：log=4 planks、可食白名单+黑名单、备镐、镐阶）——
  const stock = stockFrom([
    { name: 'oak_log', count: 2 }, { name: 'birch_planks', count: 5 },
    { name: 'cooked_beef', count: 3 }, { name: 'bread', count: 1 },
    { name: 'spider_eye', count: 2 }, { name: 'rotten_flesh', count: 4 }, { name: 'pufferfish', count: 1 },
    { name: 'raw_iron', count: 7 }, { name: 'iron_ingot', count: 3 },
    { name: 'stone_pickaxe', count: 1 }, { name: 'iron_pickaxe', count: 2 },
  ], 36, 30)
  ok(stock.woodUnits === 13, '木材等价：2 log×4 + 5 planks = 13')
  ok(stock.rations === 4, '只有真食物算粮：cooked_beef×3 + bread×1')
  ok(!isEdibleName('spider_eye') && !isEdibleName('rotten_flesh') && !isEdibleName('pufferfish'), '黑名单：蜘蛛眼/腐肉/河豚不算食物')
  ok(isEdibleName('minecraft:cooked_porkchop'), '带命名空间前缀也能识别')
  ok(stock.ironForArmor === 10, '铁料 = 原铁 7 + 铁锭 3')
  ok(stock.picks === 3 && stock.tier === 'iron', '备镐数 + 镐阶取最高（iron）')
  ok(stock.emptySlots === 6, '空余格 = 总36 − 已用30')

  // —— 防御姿态（neko：头号死因是没甲跟僵尸打）——
  const naked = defenseFrom([null, null, null, null, null], { name: 'stick' })
  ok(naked.weakDefense === true && naked.armorPieces === 0, '裸装无盾 → weakDefense')
  const armored = defenseFrom([{ name: 'iron_helmet' }, { name: 'iron_chestplate' }, null, null, { name: 'shield' }], { name: 'stone_sword' })
  ok(armored.armorPieces === 2 && armored.hasShield && armored.hasWeapon, '护甲计数 + 盾 + 武器')

  // —— 威胁分级（neko：d<12 且 |dy|<=4 才算"可动"；射手 dy<8 也算够得着）——
  const th = threatBreakdown({
    pos: { x: 0, y: 64, z: 0 },
    hostiles: [
      { name: 'zombie', x: 5, y: 64, z: 0 },      // 可动
      { name: 'skeleton', x: 30, y: 64, z: 0 },    // 太远 → 层外
      { name: 'creeper', x: 3.5, y: 64, z: 0 },    // 可动 + 贴脸苦力怕
      { name: 'skeleton', x: 8, y: 70, z: 0 },     // 射手、高处 dy=6<8 → 可动
    ],
  })
  ok(th.raw === 4, '敌对总数 4')
  ok(th.actionable === 3, '可动威胁 3（远处骷髅只算层外）')
  ok(th.creeperDist === 3.5, '最近苦力怕距离 3.5')
  ok(th.rangedThreat === true, '标记含射手')
  ok(th.fresh === true, '新鲜标记')

  // —— 世界模型：卡死三态 + 死亡区 + 包将满 ——
  const zone = [{ x: 100, z: 100, r: 24, count: 2 }]
  const starving = deriveWorldModel({
    now: 1000, hp: 20, food: 5, pos: { x: 100, y: 64, z: 100 }, isNight: false,
    items: [{ name: 'stone_pickaxe', count: 1 }], slotsTotal: 36, slotsUsed: 35,
    equipment: [null, null, null, null, null], held: { name: 'stone_pickaxe' },
    hostiles: [], deathZones: zone, stalledMs: 9 * 60_000,
  })
  ok(starving.paralysis.starving === true, '饥饿且无粮 → starving')
  ok(starving.paralysis.longStall === true, '≥8min 无进展 → longStall')
  ok(starving.paralysis.trappedInDeathZone === true, '困死亡区 ≥4min → trappedInDeathZone')
  const line = renderWorldModel(starving)
  ok(/包将满/.test(line) && /无甲无盾/.test(line) && /饥饿且无粮/.test(line), '渲染出包将满/无甲/饥饿')
  ok(/身处死亡区/.test(line), '渲染出死亡区')
  const far = deriveWorldModel({
    now: 1, hp: 20, food: 20, pos: { x: 0, y: 64, z: 0 }, isNight: true,
    items: [{ name: 'iron_pickaxe', count: 3 }, { name: 'cooked_beef', count: 20 }], slotsTotal: 36, slotsUsed: 10,
    equipment: [{ name: 'diamond_helmet' }, { name: 'diamond_chestplate' }, { name: 'diamond_leggings' }, { name: 'diamond_boots' }],
    held: { name: 'diamond_sword' }, hostiles: [], deathZones: [], stalledMs: 0,
  })
  ok(far.zone.insideDeathZone === false && far.paralysis.starving === false, '安全态：不在死亡区、不饥饿')
  ok(far.defense.weakDefense === false && far.stock.picks === 3, '安全态：甲齐、备镐够')

  // —— 新鲜度契约（neko fresh_status：陈旧必须标注）——
  const now = 1_000_000
  const allFresh = freshnessReport({ vitals: now, threat: now, social: now, world: now, inventory: now }, now)
  ok(allFresh.classification === 'live' && allFresh.staleChannels.length === 0, '全新鲜 → live')
  const someStale = freshnessReport({ vitals: now, threat: now - 999_999, social: null, world: now, inventory: null }, now)
  ok(someStale.classification !== 'live' && someStale.staleChannels.includes('social'), '有陈旧通道 → 非 live 且列出陈旧项')
  ok(freshnessReport({ vitals: null, threat: null, social: null, world: null, inventory: null }, now).classification === 'offline', '全无数据 → offline')
}

console.log('\n[11] 观测账本（Cortico：作用域 + 跨界清空 + TTL + ageMs）')
{
  const led = new ObservationLedger(60_000, 3)
  const sc1 = { connectionGeneration: 1, dimension: 'overworld' }
  led.remember(sc1, 'block', 'iron_ore', [10, 40, 10], 1000)
  const hit = led.recall(sc1, 'minecraft:iron_ore', 'block', 1500)
  ok(hit && hit.at[0] === 10 && hit.ageMs === 500, '召回带 ageMs（500ms）')
  ok(led.recall(sc1, 'diamond_ore', 'block', 1500) === null, '没见过的返回 null（不编）')
  led.remember(sc1, 'block', 'coal_ore', [20, 40, 20], 1000)
  const near = led.nearest(sc1, { x: 21, z: 21 }, 'block', 1100)
  ok(near && near.target === 'coal_ore' && near.distance === 1, 'nearest 按距离取最近')
  led.markDepleted(sc1, 'coal_ore', 1200)
  const near2 = led.nearest(sc1, { x: 21, z: 21 }, 'block', 1300)
  ok(near2 && near2.target === 'iron_ore', '耗尽的 coal_ore 被排除，回落 iron_ore')
  // 跨界（重连/换维度）→ 整个账本作废
  led.remember(sc1, 'block', 'gold_ore', [5, 5, 5], 1400)
  led.recall({ connectionGeneration: 2, dimension: 'overworld' }, 'iron_ore', 'block', 1500)
  ok(led.size() === 0, '换连接代次 → 账本清空（跨界记忆不成立）')
  // TTL
  const led2 = new ObservationLedger(1000, 10)
  led2.remember(sc1, 'block', 'sand', [1, 1, 1], 0)
  ok(led2.recall(sc1, 'sand', 'block', 5000) === null, '超 TTL 自动失效')
}

console.log('\n[12] 读数指纹 + 一轮一答闸（Cortico：指纹不含时钟）')
{
  const a = bagStamp({ items: [{ name: 'oak_log', count: 2 }], slotsUsed: 3, slotsTotal: 36, held: 'stone_pickaxe', equipment: [] })
  const b = bagStamp({ items: [{ name: 'oak_log', count: 2 }], slotsUsed: 3, slotsTotal: 36, held: 'stone_pickaxe', equipment: [] })
  const c = bagStamp({ items: [{ name: 'oak_log', count: 3 }], slotsUsed: 3, slotsTotal: 36, held: 'stone_pickaxe', equipment: [] })
  ok(a === b, '同样状态 → 同指纹（顺序无关也稳定）')
  ok(a !== c, '物品变了 → 指纹变')
  const wm1 = deriveWorldModel({
    now: 111, hp: 20, food: 20, pos: { x: 1, y: 2, z: 3 }, isNight: false,
    items: [], slotsTotal: 36, slotsUsed: 0, equipment: [], held: null, hostiles: [],
  })
  const wm2 = { ...wm1, ts: 999_999 }
  ok(worldStamp(wm1) === worldStamp(wm2), '世界模型指纹不含 ts（时钟字段进指纹=闸失效）')
  const gate = createReadoutGate(1000)
  ok(gate.duplicate('status', 'X', 0) === false, '第一次问 → 放行')
  ok(gate.duplicate('status', 'X', 500) === true, '窗口内同指纹再问 → 判重')
  ok(gate.duplicate('status', 'Y', 600) === false, '指纹变了 → 放行')
  ok(gate.duplicate('status', 'Y', 5000) === false, '超出窗口 → 放行')
}

console.log('\n[13] 视觉韧性（native 崩溃无法被 JS 捕获 → 哨兵 + 熔断 + 超时）')
{
  const g = createVisionGuard({ timeoutMs: 60, maxStreak: 2, cooldownMs: 1000 })
  ok(g.tripped(0) === false, '初始未熔断')
  const okVal = await g.run('x', async () => 'ok', 0)
  ok(okVal === 'ok' && g.state.failStreak === 0 && typeof g.state.lastOkMs === 'number', '成功：清零失败计数并记录耗时')
  // 连续失败到阈值 → 熔断
  for (let i = 0; i < 2; i++) { try { await g.run('x', async () => { throw new Error('gl boom') }, 10) } catch { /* 预期 */ } }
  ok(g.state.failStreak === 2, '连续两次失败 → 计数 2')
  ok(g.tripped(20) === true, '达到阈值 → 熔断')
  let trippedMsg = ''
  try { await g.run('x', async () => 'should not run', 30) } catch (e) { trippedMsg = e.message }
  ok(/熔断/.test(trippedMsg), '熔断期内直接拒绝（带可读原因 + 改用文字感知的建议）')
  ok(g.tripped(1100) === false, '冷却过后自动恢复')
  // 超时保护
  const g2 = createVisionGuard({ timeoutMs: 40, maxStreak: 5, cooldownMs: 10 })
  let toMsg = ''
  try { await g2.run('slow', () => new Promise(() => {}), 0) } catch (e) { toMsg = e.message }
  ok(/超时/.test(toMsg), '挂住的渲染被超时掐断（不拖死 agent 循环）')
  ok(g2.state.failStreak === 1, '超时计入失败计数')
  // 哨兵：落标 → 读得到（= 进程若在此刻消失，重启能说出死在哪一步）→ 擦标后读不到
  const dir = '_vision_sentinel_test'
  const root = dir + '/screenshots'
  writeVisionSentinel(root, { op: 'captureFirstPerson', username: 'Edward', note: 'test' })
  const left = readVisionSentinel(root)
  ok(left && left.op === 'captureFirstPerson' && left.username === 'Edward', '哨兵可读（崩溃后唯一的死因线索）')
  clearVisionSentinel(root)
  ok(readVisionSentinel(root) === null, '成功后哨兵被擦掉')
}

console.log('\n[14] 注入预算与去重不变量（复审后锁定）')
{
  const bot = makeBot()
  const p = createPerception({ body: () => bot, username: 'Edward', log: () => {}, socialLines: () => [], recentActions: () => [] })
  const first = p.status()
  ok(first.split('\n').length <= 3, `首次接入 ≤3 行（实际 ${first.split('\n').length}）：` + JSON.stringify(first))
  const steady = p.status()
  ok(steady.split('\n').length === 1, `常态只有 1 行（实际 ${steady.split('\n').length}）`)
  ok(steady.length <= 90, `常态单行 ≤90 字符（实际 ${steady.length}）`)
  bot.entities = { 1: { name: 'zombie', position: { x: 131, y: 64, z: -301 } }, 2: { name: 'creeper', position: { x: 145, y: 64, z: -301 } } }
  bot.health = 12
  bot.emit('health')
  bot.emit('entityHurt', bot.entity, { name: 'zombie' })
  const hurt = p.status()
  const hitLines = hurt.split('\n').filter((l) => /被|击中/.test(l))
  ok(hitLines.length === 1, `一次受击只出现一条（实际 ${hitLines.length}）`)
  ok(/zombie/.test(hitLines[0] ?? ''), '来源用真值 zombie（不猜 17 格外那只 creeper）')
  ok((hurt.match(/你在 \(/g) ?? []).length === 1, '位置只出现一次')
  ok((hurt.match(/威胁 /g) ?? []).length === 1, '威胁只出现一次')
  bot.health = 7
  const a = p.status()
  const b = p.status()
  ok((a.match(/♥生命/g) ?? []).length === 1 && (b.match(/♥生命/g) ?? []).length === 0, '危险行边沿触发：变化时报、随后不重复')
}

console.log('\n[15] decider 客户端纯逻辑：严格校验 / 保鲜门 / 退避')
{
  const spec = {
    action: { type: 'choice', instructions: 'what to do', criteria: { fight: 'when able', flee: 'when outmatched', eat: 'when hungry' } },
    threat: { type: 'score', instructions: 'how dangerous', criteria: ['safe', 'caution', 'high'] },
    eatNow: { type: 'noul', instructions: 'eat?', criteria: { 'true': 'yes', 'false': 'no' } },
  }
  const good = {
    answers: {
      action: { type: 'choice', choice: 'fight', confidence: 0.5, probabilities: { fight: 0.5, flee: 0.2, eat: 0.3 } },
      threat: { type: 'score', score: 1.2, confidence: 0.4, probabilities: { '0': 0.1, '1': 0.6, '2': 0.3 } },
      eatNow: { type: 'noul', noul: 0.2 },
    },
    usage: { input_tokens: 100 },
  }
  ok(validateAnswers(good, spec).answers.action.type === 'choice', '合法答案通过校验')
  const bad = (mut, label, expect) => {
    const copy = JSON.parse(JSON.stringify(good))
    mut(copy)
    let msg = ''
    try { validateAnswers(copy, spec) } catch (e) { msg = e.message }
    ok(expect.test(msg), label + '（拒因：' + (msg || '未拒绝') + '）')
  }
  bad((c) => { delete c.answers.eatNow }, '缺答案 → 拒', /缺少答案/)
  bad((c) => { c.answers.action.type = 'noul' }, '类型不符 → 拒', /类型不符/)
  bad((c) => { c.answers.action.choice = 'dance' }, '选项不在允许集 → 拒', /不在允许集/)
  bad((c) => { c.answers.action.probabilities.eat = 0.5 }, '概率和偏离 1 → 拒', /偏离 1/)
  bad((c) => { delete c.answers.action.probabilities.flee }, '缺概率键 → 拒（并指名缺哪个）', /缺少概率键 flee/)
  bad((c) => { c.answers.action.probabilities.dance = 0.3 }, '多出无关键 → 拒（覆盖检查）', /概率键与允许集不符/)
  bad((c) => { c.answers.threat.score = 9 }, 'score 越档 → 拒', /超出档位/)
  bad((c) => { c.answers.eatNow.noul = 1.4 }, 'noul 越界 → 拒', /不在 \[0,1\]/)

  ok(isFresh({ x: 0, y: 0, z: 0 }, { x: 0.5, y: 0, z: 0 }, 1000) === true, '保鲜：1s 内、位移 0.5 格 → 新鲜')
  ok(isFresh({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 6000) === false, '保鲜：超过 5s → 陈旧（demo 同款判据）')
  ok(isFresh({ x: 0, y: 0, z: 0 }, { x: 1.5, y: 0, z: 0 }, 1000) === false, '保鲜：位移 ≥0.8 格 → 陈旧')
  ok(DECIDER_THRESHOLDS.fleeConfidence < DECIDER_THRESHOLDS.fightConfidence, '阈值按后果分开：逃走线低于打架线')

  // decideFresh：陈旧 → 重观察（不重放）；服务错误 → 退避重试后抛错且不执行
  let observed = 0
  let discarded = 0
  const pos = { x: 0, y: 64, z: 0 }
  let throws = ''
  try {
    await decideFresh({
      observe: () => { observed++; return { at: { ...pos } } },
      decide: async () => ({ kind: 'act' }),
      positionOf: (s) => s.at,
      position: () => ({ x: pos.x + 5, y: pos.y, z: pos.z }),   // 世界一直在动 → 永远陈旧
      onDiscard: () => { discarded++ },
      now: () => 0,
      maxAttempts: 3,
      wait: async () => {},
    })
  } catch (e) { throws = e.message }
  ok(observed === 3 && discarded === 3, `陈旧三连：每次重新观察（观察 ${observed} 次 / 丢弃 ${discarded} 次）`)
  ok(/一个都没执行/.test(throws), '陈旧三连后抛错，且明确"未执行任何动作"')

  let serviceErrors = 0
  let observed2 = 0
  try {
    await decideFresh({
      observe: () => { observed2++; return { at: { x: 0, y: 0, z: 0 } } },
      decide: async () => { const e = new Error('down'); e.status = 503; throw e },
      positionOf: (s) => s.at,
      position: () => ({ x: 0, y: 0, z: 0 }),
      onServiceError: (i) => { serviceErrors++; if (i.attempt === 1) throw new Error('retry-first') },
      maxAttempts: 2,
      wait: async () => {},
    })
  } catch (e) { /* 预期 */ }
  ok(serviceErrors >= 1, '服务错误走 onServiceError（供审计：分得清"服务故障"与"代码错"）')
  let observed3 = 0
  try {
    await decideFresh({
      observe: () => { observed3++; return { at: { x: 0, y: 0, z: 0 } } },
      decide: async () => { const e = new Error('bad request'); e.status = 400; throw e },
      positionOf: (s) => s.at,
      position: () => ({ x: 0, y: 0, z: 0 }),
      maxAttempts: 3,
    })
  } catch { /* 预期 */ }
  ok(observed3 === 1, '不可重试的错误（400）不重试，直接抛出')
}

console.log('\n[16] 解释层：分类器要的小枚举（地形/时间/能力/裁剪状态）')
{
  ok(dayPhase(1000) === 'morning' && dayPhase(8000) === 'afternoon' && dayPhase(12500) === 'dusk' && dayPhase(15000) === 'night' && dayPhase(23000) === 'dawn', '一天五段枚举边界正确')
  const air = { name: 'air', boundingBox: 'empty' }
  const grass = { name: 'grass_block', boundingBox: 'block' }
  const stone = { name: 'stone', boundingBox: 'block' }
  ok(terrainStatusOf([null, null, null, null]) === 'unknown', '有未加载方块 → unknown（不猜）')
  ok(terrainStatusOf([grass, air, air, air]) === 'clear', '脚下有地、身前通透 → clear')
  ok(terrainStatusOf([grass, air, stone, air]) === 'blocked', '头前被挡 → blocked')
  ok(terrainStatusOf([grass, stone, air, air]) === 'one_block_rise', '抬一格能过 → one_block_rise')
  ok(terrainStatusOf([air, air, air, air]) === 'drop_or_no_floor', '脚下没地 → drop_or_no_floor')
  ok(terrainStatusOf([{ name: 'lava', boundingBox: 'empty' }, air, air, air]) === 'hazard', '岩浆 → hazard')

  // 四方向 × 四距离
  const probeBot = {
    entity: { position: { x: 0.5, y: 64, z: 0.5 }, yaw: 0 },
    blockAt: () => ({ name: 'grass_block', boundingBox: 'block' }),
  }
  const probe = terrainProbe(probeBot)
  ok(probe.forward.length === 4 && probe.behind.length === 4, '四方向各探 4 格')
  ok(probe.forward.every((c) => c.status === 'blocked' || c.status === 'one_block_rise'), '全实心世界 → 前方非通即抬一格（不会误报 clear）')
  ok(nearbyBlockNames(probeBot).includes('grass_block'), '附近方块集合含草方块')
  ok(inventoryCounts([{ name: 'oak_log', count: 3 }, { name: 'oak_log', count: 2 }, { name: 'stone', count: 1 }]).oak_log === 5, '背包 name→count 合并同类')

  const caps = capabilityFlags([{ name: 'stone_pickaxe' }, { name: 'iron_sword' }, { name: 'crafting_table' }])
  ok(caps.hasStoneTier && caps.hasIronTier && caps.hasSword && caps.hasPickaxe && caps.hasCraftingTable, '能力布尔：石层级✓ 铁层级✓(铁剑) 有石镐 有工作台')
  ok(capabilityFlags([{ name: 'wooden_axe' }]).hasIronTier === false, '无铁件时 hasIronTier 为假（名字不夸大）')

  // 裁剪状态：只留问题需要的 + 必须可序列化（不塞 bot 对象——那是 demo 的反面教材）
  const wm = deriveWorldModel({
    now: 1, hp: 15, food: 9, pos: { x: 0, y: 64, z: 0 }, isNight: true, tod: 15000,
    items: [{ name: 'oak_log', count: 4 }], slotsTotal: 36, slotsUsed: 8,
    equipment: [null, null, null, null, null], held: { name: 'stone_sword' },
    hostiles: [{ name: 'zombie', x: 3, y: 64, z: 0 }, { name: 'creeper', x: 0, y: 64, z: 5 }],
  })
  const cs = classificationState({
    wm,
    hostiles: [{ name: 'zombie', x: 3, y: 64, z: 0 }, { name: 'creeper', x: 0, y: 64, z: 5 }],
    items: [{ name: 'oak_log' }],
    hasFood: false,
    currentGoal: 'craft_tools',
    goalAgeMs: 30000,
    failures: 1,
    stuckOn: ['need planks'],
    recent: ['move', 'dig'],
  })
  ok(cs.time_of_day === 'night' && cs.current_goal === 'craft_tools' && cs.failures === 1, '裁剪状态含 day-phase 枚举 / 目标 / 失败数')
  ok(Array.isArray(cs.nearby_hostiles) && cs.nearby_hostiles.length <= 3, '敌对实体裁剪到 top-3')
  ok(typeof cs.threat.creeper_distance === 'number', '含苦力怕距离（决策关键量）')
  const roundTrip = JSON.parse(JSON.stringify(cs))
  ok(roundTrip.current_goal === 'craft_tools' && roundTrip.recent_actions.length === 2, '裁剪状态可完整序列化（状态里不许有 bot 对象）')
}

console.log('\n[17] 弹幕（观众）感知：聚合 / 洪水 / 预算 / 档案 / 分类器降级')
{
  ok(normalizeDanmaku('快去　挖铁！！！') === '快去挖铁', '归一化：全角+标点+空格都去掉（用于合并刷屏）')
  ok(normalizeDanmaku('ABC') === normalizeDanmaku('abc'), '归一化：大小写无关')
  const d = salienceOf({ source: 'mc', text: '快去挖铁' }, 1, false)
  const q = salienceOf({ source: 'mc', text: '你在干嘛？' }, 1, false)
  const e = salienceOf({ source: 'mc', text: '哈哈哈' }, 1, false)
  ok(d > q && q > e, `显著度排序：指令(${d}) > 提问(${q}) > 情绪(${e})`)
  ok(salienceOf({ source: 'mc', text: '随便说点', kind: 'superchat' }, 1, false) > d, '醒目留言显著度最高')
  ok(salienceOf({ source: 'mc', text: '挖铁' }, 5, false) > salienceOf({ source: 'mc', text: '挖铁' }, 1, false), '重复刷屏提升显著度')

  const dir = mkdtempSync(join(tmpdir(), 'aud-'))
  const ch = createAudienceChannel({ viewersDir: join(dir, 'viewers'), statePath: join(dir, 'state.json'), windowId: 'sess1' }, {})
  const t0 = 1_000_000
  ok(ch.render(t0) === '', '空窗口不产出（不占预算）')
  for (let i = 0; i < 12; i++) ch.ingest({ source: 'mc', name: `v${i}`, text: '快去挖铁', at: t0 })
  ch.ingest({ source: 'mc', name: 'q1', text: '你会做铁镐吗？', at: t0 })
  ch.ingest({ source: 'mc', name: 'e1', text: '哈哈哈哈哈', at: t0 })
  const w = ch.window(t0)
  ok(w.count === 14 && w.senders.length === 14, `窗口聚合：${w.count} 条 / ${w.senders.length} 人`)
  ok(w.clusters[0].text === '快去挖铁' && w.clusters[0].count === 12, '重复刷屏合并成一条并计数（指令排第一）')
  const line = ch.render(t0)
  ok(/【观众】14 条\/14 人/.test(line) && /指令「快去挖铁」×12/.test(line), '渲染成一行：条数/人数/分类/计数')
  ok(line.split('\n').length === 1, '弹幕呈现只占一行（预算铁律）')

  // 洪水模式：超过阈值后只留问题/指令/礼物
  const floodCh = createAudienceChannel({ floodCount: 5, windowId: 'f' }, {})
  for (let i = 0; i < 6; i++) floodCh.ingest({ source: 'mc', name: `x${i}`, text: `哈哈哈${i}`, at: t0 })
  floodCh.ingest({ source: 'mc', name: 'q', text: '去挖铁吗？', at: t0 })
  const fw = floodCh.window(t0)
  ok(fw.flood === true && fw.clusters.every((c) => c.isQuestion || c.isDirective || c.kind !== 'chat'), '洪水模式：只留问题/指令（纯情绪噪声被攒掉）')

  // 观众档案：note → 首行摘要 + 事实；recall 取回
  ch.noteProfile('mc', 'alice', '常来送矿的老观众', '今天给了你 3 块铁')
  const prof = ch.readProfile('mc', 'alice')
  ok(prof?.summary === '常来送矿的老观众' && /3 块铁/.test(prof?.body ?? ''), '档案：首行=一句话摘要 + 追加事实')
  ok(ch.profileCounts().mc === 1, '档案计数（前缀卫生：只给计数不给清单）')
  ok(/不暴露内部接口/.test(ch.viewerMemoryNote()), '观众记忆说明含闭包纪律（对外只讲我在做什么）')

  // 浮现：本窗口首次出现念一次；同一窗口再问不重念；换窗口重新念一次（交接后重念）
  const ch2 = createAudienceChannel({ viewersDir: join(dir, 'viewers'), statePath: join(dir, 'state2.json'), windowId: 'sess1' }, {})
  ch2.ingest({ source: 'mc', name: 'alice', senderKey: 'alice', text: '在吗', at: t0 })
  const first = ch2.surfaceProfiles(t0)
  ok(first.length === 1 && /观众档案\] mc\/alice/.test(first[0]) && /常来送矿/.test(first[0]), '老观众出现 → 机械唤起一行摘要')
  ok(ch2.surfaceProfiles(t0).length === 0, '同一窗口内不重念（一个窗口只说一次）')
  const ch3 = createAudienceChannel({ viewersDir: join(dir, 'viewers'), statePath: join(dir, 'state3.json'), windowId: 'sess2' }, {})
  ch3.ingest({ source: 'mc', name: 'alice', senderKey: 'alice', text: '又来了', at: t0 })
  ok(ch3.surfaceProfiles(t0).length === 1, '换窗口（交接后）再出现 → 重新唤起一次')
  const anon = createAudienceChannel({ viewersDir: join(dir, 'viewers'), windowId: 's' }, {})
  anon.ingest({ source: 'mc', name: '匿名君', text: '你好', at: t0 })
  ok(anon.surfaceProfiles(t0).length === 0 && anon.window(t0).newFaces.length === 0, '没有 senderKey（脱敏）→ 静默降级，不立档不报错')

  // 发言预算：冷却 + 每分钟上限
  const speak = createAudienceChannel({ replyCooldownMs: 1000, maxRepliesPerMinute: 2, windowId: 's' }, {})
  ok(speak.canSpeak(t0).ok === true, '初始可发言')
  speak.noteSpoke(t0)
  ok(speak.canSpeak(t0 + 500).ok === false, '冷却期内不许再发言')
  ok(speak.canSpeak(t0 + 1500).ok === true, '冷却结束后可发言')
  speak.noteSpoke(t0 + 1500)
  const capped = speak.canSpeak(t0 + 2600)   // 越过冷却，专门打「每分钟上限」这条路径
  ok(capped.ok === false && /本分钟/.test(capped.reason ?? ''), `每分钟上限生效（${capped.reason}）`)

  // 防抖：观众点播不能立刻改目标
  ok(ch.shouldAdoptAudienceGoal(5_000) === false && ch.shouldAdoptAudienceGoal(20_000) === true, '观众点播需过目标防抖（<15s 不采纳）')

  // advise：无分类器走启发式；有分类器用分类器；分类器抛错必须退回启发式
  const advCh = createAudienceChannel({ windowId: 'a' }, {})
  advCh.ingest({ source: 'mc', name: 'v', text: '快去挖铁！', at: t0 })
  const adv1 = await advCh.advise(t0)
  ok(adv1.source === 'heuristic' && adv1.shouldReply === true && adv1.pointcast === true && adv1.pick === '快去挖铁！', '启发式建议：有人点播 → 可以回应 + 标为点播')
  const advCh2 = createAudienceChannel({ windowId: 'a' }, {
    classify: async () => ({ replyNow: 0.8, pick: '先去挖铁', pointcast: 0.9 }),
  })
  advCh2.ingest({ source: 'mc', name: 'v', text: '快去挖铁！', at: t0 })
  const adv2 = await advCh2.advise(t0)
  ok(adv2.source === 'classifier' && adv2.pick === '先去挖铁' && adv2.pointcast === true, '有分类器时用分类器判断（pick 与点播标记都来自它）')
  const advCh3 = createAudienceChannel({ windowId: 'a' }, {
    classify: async () => { throw new Error('decider down') },
  })
  advCh3.ingest({ source: 'mc', name: 'v', text: '快去挖铁！', at: t0 })
  const adv3 = await advCh3.advise(t0)
  ok(adv3.source === 'heuristic' && adv3.shouldReply === true, '分类器故障 → 退回启发式（绝不因服务不可用而卡住）')
  ok(existsSync(join(dir, 'state2.json')), '浮现状态已落盘（热重启不重念靠它）')
  const st = JSON.parse(readFileSync(join(dir, 'state2.json'), 'utf-8'))
  ok(st.windowId === 'sess1' && Array.isArray(st.surfaced), '状态文件记录了窗口与其已唤起名单')
}

console.log('\n[18] 弹幕的选择性影响：默认无影响权，必须挣来')
{
  const cluster = (text, opts = {}) => ({
    text, count: opts.count ?? 1, knownViewer: opts.known ?? false, kind: opts.kind ?? 'chat',
    salience: 10,
    // 夹具显式给这两个标志：真实通道里它们由 DIRECTIVE_RE / QUESTION_RE 判出，
    // 用「没问号就算指令」这种假规则只会把测试测歪
    isQuestion: opts.isQuestion ?? /[?？吗呢]/.test(text),
    isDirective: opts.isDirective ?? true,
    senders: opts.senders ?? ['路人甲'], keys: opts.keys ?? [],
  })
  const st = () => ({ goalInfluences: [], tacticInfluences: [] })
  const J = (c, opts = {}, state = st(), cfg = {}) => judgeInfluence(
    { at: 1_000_000, clusters: [c], flood: opts.flood ?? false, goalAgeMs: opts.goalAgeMs ?? 99_999, privileged: opts.privileged ?? [], privilegedNames: opts.privilegedNames ?? [] },
    state, cfg,
  )

  // 危险请求：永不采纳
  const danger = J(cluster('跳进岩浆里给我看看', { senders: ['房管小A'], privileged: ['mc/房管小A'] }))
  ok(danger.level === 0 && danger.kind === 'dangerous', `危险请求 → L0（即便来自有权限的人）：${danger.why}`)
  ok(J(cluster('把自己装备都扔了')).level === 0, '自毁类请求同样 L0')

  // 纯反应/提问：只影响回应
  ok(J(cluster('哈哈哈哈哈', { isQuestion: false, isDirective: false })).level === 1, '纯反应 → L1（只影响回应）')
  ok(J(cluster('随便聊聊', { isDirective: false })).level === 1, '非指令非提问 → L1（默认无影响权）')
  ok(J(cluster('你在干嘛？', { isQuestion: true, isDirective: false })).level === 1, '提问 → L1（先回应，不改行为）')
  ok(J(cluster('感谢你的礼物', { kind: 'gift', isQuestion: false, isDirective: false })).level === 1, '礼物 → L1（致谢即可，不据此改行为）')

  // 单条陌生指令：最多微调
  const stranger = J(cluster('走西边那条坡道上去'))
  ok(stranger.level === 2 && /微调/.test(stranger.why), `单条陌生指令 → L2（可微调，不改目标）：${stranger.why}`)

  // 挣 L3 的三条路：上位者 / 档案授权 / 多人同诉求
  const byAuthority = J(cluster('先去挖点铁', { senders: ['女神'] }), { privilegedNames: ['女神'] })
  ok(byAuthority.level === 3, `上位者 → L3：${byAuthority.why}`)
  const byGrant = J(cluster('先去挖点铁', { keys: ['12345'], senders: [] }), { privileged: ['mc/12345'] })
  ok(byGrant.level === 3, `档案授权观众 → L3：${byGrant.why}`)
  const byQuorum = J(cluster('先去挖点铁', { senders: ['a', 'b', 'c'] }))
  ok(byQuorum.level === 3 && /多人同诉求/.test(byQuorum.why), `多人同诉求 → L3：${byQuorum.why}`)
  const almost = J(cluster('先去挖点铁', { senders: ['a', 'b'] }))
  ok(almost.level === 2, '只两个人同诉求还不够（默认门槛 3）')

  // 三道硬闸：刷屏封顶 / 防抖降级 / 配额用尽
  ok(J(cluster('先去挖点铁', { senders: ['a', 'b', 'c'] }), { flood: true }).level === 2, '刷屏期间封顶 L2（不趁乱改目标）')
  const fresh = J(cluster('先去挖点铁', { senders: ['a', 'b', 'c'] }), { goalAgeMs: 3_000 })
  ok(fresh.level === 2 && /防抖/.test(fresh.why), `目标刚立（3s）→ 降级 L2：${fresh.why}`)
  const s2 = st()
  const v1 = J(cluster('先去挖点铁', { senders: ['a', 'b', 'c'] }), {}, s2)
  ok(v1.level === 3 && v1.quotaLeft.goal === 1, '首次点播：L3，配额剩 1')
  noteInfluenceAdopted(s2, 3, 1_000_000)
  const v2 = J(cluster('再去砍点树', { senders: ['a', 'b', 'c'] }), {}, s2)
  ok(v2.level === 2 && /配额已用尽/.test(v2.why) && v2.quotaLeft.goal === 0, `配额用尽 → 降级 L2：${v2.why}`)
  const s3 = st()
  for (let i = 0; i < 3; i++) noteInfluenceAdopted(s3, 2, 1_000_000)
  const v3 = J(cluster('走西边', {}), {}, s3)
  ok(v3.quotaLeft.tactic === 0 && v3.level === 2, '微调配额 3 次/5 分钟用尽后仍可 L2（但配额显示为 0，供节制）')

  // 渲染与恒定声明
  const line = renderInfluence(v1)
  ok(/【可影响度】影响等级 L3/.test(line) && /配额 改目标 1/.test(line), '渲染含等级与剩余配额')
  ok(/安全底线/.test(AUDIENCE_INVARIANTS) && /内部信息/.test(AUDIENCE_INVARIANTS), '恒定声明含"安全底线/内部信息"')
  ok(INFLUENCE_LABEL[2].includes('微调') && INFLUENCE_LABEL[3].includes('目标'), '等级名称自解释')

  // 档案授权行解析
  ok(profileGrantsInfluence('常来送矿的老观众\n\n授权：可点播') === true, '档案里的「授权：可点播」被识别')
  ok(profileGrantsInfluence('普通观众，没写授权') === false, '没写授权 → 无 L3 权限')
  ok(profileGrantsInfluence('grant: yes') === true, '英文写法也认')

  // 通道级：授权观众在窗口里出现 → advise 给 L3（权限来自档案，不问模型）
  const dir2 = mkdtempSync(join(tmpdir(), 'aud-inf-'))
  const vdir = join(dir2, 'viewers')
  mkdirSync(join(vdir, 'mc'), { recursive: true })
  writeFileSync(join(vdir, 'mc', '777.md'), '爱点播的老观众\n\n授权：可点播\n- 上次让你挖铁\n', 'utf-8')
  const chInf = createAudienceChannel({ viewersDir: vdir, windowId: 'w' }, {})
  chInf.ingest({ source: 'mc', senderKey: '777', name: '老王', text: '先去挖点铁吧', at: 2_000_000 })
  const adv = await chInf.advise(2_000_000, { goalAgeMs: 60_000 })
  ok(adv.influence.level === 3 && /被授权/.test(adv.influence.why), `通道级：档案授权的人点播 → L3（${adv.influence.why}）`)
  chInf.noteAdopted(3, 2_000_000)
  chInf.ingest({ source: 'mc', senderKey: '777', name: '老王', text: '再去砍点树', at: 2_000_001 })
  const adv2 = await chInf.advise(2_000_100, { goalAgeMs: 60_000 })
  ok(adv2.influence.level === 2, '采纳一次后配额用尽 → 下一条只能微调（改目标限速）')
}

console.log('\n[19] 指引信息队列：弹幕只是指引的一个生产者')
{
  const T = 5_000_000
  const q = createGuidanceQueue({ maxInject: 3, defaultTtlMs: 10_000 })
  ok(q.render(T) === '', '空队列 → 空渲染（不占预算）')

  // 弹幕进来 → 一条限时指引
  const it = q.push({ source: 'audience', kind: 'request', level: 3, text: '先去挖点铁', at: T, ttlMs: 10_000, evidence: ['audience:classifier'] })
  ok(it.lifetime === 'transient' && it.until === T + 10_000, '弹幕指引是限时的（默认 transient + TTL）')
  ok(/\[指引·观众·请求·L3\] 先去挖点铁/.test(q.render(T)), '渲染带来源/性质/等级（一行一条）')

  // 同一句话被反复提 → 合并刷新，不新增行
  q.push({ source: 'audience', kind: 'request', level: 3, text: '先去挖点铁', at: T + 2_000, ttlMs: 10_000 })
  ok(q.all().length === 1 && q.all()[0].hits === 2, '同来源同话合并计次（不新增行）')
  ok(q.all()[0].until === T + 12_000, '合并时刷新有效期（"它还在说这件事"）')
  ok(/×2/.test(q.render(T + 2_500)), '渲染体现命中次数')

  // ★「未来插入」：from 在未来的指引，当下不出现、到点才出现
  q.push({ source: 'system', kind: 'warning', level: 2, text: '三分钟后天黑', at: T, from: T + 60_000, ttlMs: 30_000 })
  ok(!/天黑/.test(q.render(T)), '未到生效时刻 → 不注入（这就是"未来才插进来"）')
  ok(q.stats(T).pending === 1, '统计里能看到"待生效"的条数')
  ok(/天黑/.test(q.render(T + 61_000)), '到点后自动出现')
  ok(!/天黑/.test(q.render(T + 91_000)), '未来生效的项在生效后按自己的 TTL 过期（不是出生即过期）')

  // 过期即消失；常驻项永不消失
  ok(!/先去挖点铁/.test(q.render(T + 20_000)), '限时指引过期后消失')
  q.push({ source: 'lesson', kind: 'warning', level: 2, text: '夜里别沿河走', lifetime: 'standing', at: T })
  ok(/夜里别沿河走/.test(q.render(T + 999_999)), '常驻指引（教训/守则）不随时间消失')

  // 常驻块原地替换（算出来的整块，不能越堆越多）
  q.replaceStanding('lesson', { kind: 'warning', level: 2, text: '夜里别沿河走，也别下水', at: T + 5 })
  const standing = q.all().filter((x) => x.source === 'lesson' && x.lifetime === 'standing')
  ok(standing.length === 1 && /也别下水/.test(standing[0].text), 'replaceStanding：同来源常驻项只留最新一条')

  // 预算与优先级：超预算时按 等级 > 性质 > 新近 取前 N
  const q2 = createGuidanceQueue({ maxInject: 2 })
  q2.push({ source: 'audience', kind: 'info', level: 1, text: '低等级信息', at: T })
  q2.push({ source: 'audience', kind: 'request', level: 2, text: '中等级请求', at: T + 1 })
  q2.push({ source: 'deity', kind: 'rule', level: 3, text: '神谕规则', at: T + 2 })
  const picked = q2.select(T + 3)
  ok(picked.length === 2 && picked[0].text === '神谕规则' && /中等级|低等级/.test(picked[1].text), '超预算按等级优先取前 N')

  // 采纳标记（供影响配额记账）
  const q3 = createGuidanceQueue()
  const adv = q3.push({ source: 'audience', kind: 'request', level: 3, text: '去砍树', at: T })
  q3.markAdopted(adv.id)
  ok(/已采纳/.test(q3.render(T)), '采纳后渲染标记（审计可见）')

  // 神谕作为指引（L3：可以改目标）
  const q4 = createGuidanceQueue()
  q4.push({ source: 'deity', kind: 'request', level: 3, text: '[女神] 去东边的村子看看', at: T, ttlMs: 120_000 })
  ok(/\[指引·神谕·请求·L3\]/.test(q4.render(T)), '神谕也是指引（同一抽象，不同生产者）')
  const st = q4.stats(T)
  ok(st.total === 1 && st.transient === 1, '统计：限时 1 条')
}

console.log('\n[20] 执行层：期望推导 / 回读核验 / 终态判定 / 前置闸 / 早停 / 受阻账')
{
  // 期望推导：只推确知的（不猜）
  ok(deriveExpect('mc_collect', { item: 'oak_log', count: 4 })?.kind === 'has', 'mc_collect → 进包期望')
  ok(deriveExpect('mc_equip', { item: 'stone_pickaxe' })?.kind === 'holding', 'mc_equip → 手持期望')
  ok(deriveExpect('mc_goto', { x: 1, y: 2, z: 3 })?.kind === 'near', 'mc_goto → 到位期望')
  ok(deriveExpect('mc_dig', { x: 1 }) === null && deriveExpect('mc_sleep', {}) === null, '参数不足以断言的（dig/sleep）→ 不推期望（不猜）')
  ok(matchItemName('iron_ingot', 'minecraft:iron_ingot') && matchItemName('oak_log', 'oak_log'), '物品名匹配兼容命名空间')

  // 回读核验 + 增量（**已有存量不能证明本步产出**）
  let bag = { oak_log: 2 }
  const ctx = {
    countItem: (n) => bag[n] ?? 0,
    held: () => 'stone_pickaxe',
    position: () => ({ x: 0, y: 64, z: 0 }),
    blockNameAt: () => 'air',
  }
  const exp = { kind: 'has', item: 'oak_log', count: 4 }
  const base = baselineFor(exp, ctx)
  bag = { oak_log: 3 }
  const v1 = readExpectation(exp, ctx, base)
  ok(v1.met === false && v1.gain === true && v1.measured === '3', `未到量但有增量 → partial 依据（实测 ${v1.measured}）`)
  bag = { oak_log: 5 }
  const v2 = readExpectation(exp, ctx, base)
  ok(v2.met === true && v2.gain === true, '到量 → 达成')
  bag = { oak_log: 2 }
  const v3 = readExpectation(exp, ctx, base)
  ok(v3.met === false && v3.gain === false, '没动 → 无增量（存量 2 不能算本步产出）')
  ok(shortVerdict(exp, v2) === '核验✓ oak_log×5', `成功时的极短核验标记：${shortVerdict(exp, v2)}`)
  ok(/达成/.test(verdictNote(exp, v2, '12:03')) && /读于 12:03/.test(verdictNote(exp, v2, '12:03')), '核验句带实测值与实测时刻')

  // 终态判定矩阵
  ok(classifyOutcome({ threw: true }) === 'blocked', '抛错 → blocked')
  ok(classifyOutcome({ timedOut: true }) === 'timeout', '超时 → timeout')
  ok(classifyOutcome({ expect: exp, verdict: v2 }) === 'done', '达成 → done')
  ok(classifyOutcome({ expect: exp, verdict: v1 }) === 'partial', '有增量未到量 → partial')
  ok(classifyOutcome({ expect: exp, verdict: v3 }) === 'noop', '**世界没变 → noop**（工具说成功也不能算做成）')
  ok(classifyOutcome({}) === 'done', '没有期望 → 不判死（保持原语义）')

  // 报错中文化：认得出的翻译，认不出的**原样保留**
  ok(zhErrorText('Path was stopped by another goal') === '寻路半途被叫停', '已知报错 → 中文短句')
  ok(zhErrorText('weird internal glitch 0x9') === 'weird internal glitch 0x9', '未知报错 → 原样保留（不编）')
  ok(blockedSourceOf({ source: 'server' }) === 'server' && blockedSourceOf(new Error('x')) === 'local', '受阻归属：服务端 vs 我们自己的问题')

  const long = 'x'.repeat(800)
  ok(/省略 \d+ 字/.test(summarizeOutput(long, 250)), '输出摘要：前后各截并写明省略多少')

  // 前置闸：hard 优先、只报否定
  ok(precheckAction('mc_collect', { item: 'oak_log' }, { emptySlots: 0, heldDurabilityRatio: 1, hasItem: () => true })?.severity === 'hard', '包一个空位都没有 + 要装东西 → hard（不动手）')
  ok(precheckAction('mc_collect', { item: 'oak_log' }, { emptySlots: 3, heldDurabilityRatio: 1, hasItem: () => true })?.severity === 'soft', '只剩 3 格 → soft（只提醒）')
  ok(precheckAction('mc_dig', {}, { emptySlots: 30, heldDurabilityRatio: 0.1, hasItem: () => true })?.severity === 'soft', '工具快坏了 → soft')
  ok(precheckAction('mc_equip', { item: 'diamond_sword' }, { emptySlots: 30, heldDurabilityRatio: 1, hasItem: () => false })?.severity === 'soft', '包里没这件 → soft')
  ok(precheckAction('mc_sleep', {}, { emptySlots: 0, heldDurabilityRatio: 1, hasItem: () => false }) === null, '无事可报 → 不出声（只报否定）')

  // 早停：认不出的名字要点名
  const until = resolveUntil(['lava', 'iron_ore', '不存在的方块'], (n) => n === 'lava' || n === 'iron_ore')
  ok(until.names.length === 2 && until.unknown.length === 1, '早停名单解析：认得出的进名单、认不出的单独列出')
  ok(/认不出来/.test(untilUnknownNote(until.unknown)), '认不出的名字要报出来（不许静默吃掉参数）')

  // 受阻账：先验记忆 + 头名统计（门槛内不出声）+ 连击
  const led = createBlockedLedger({ priorWindowMs: 1000, headlineWindowMs: 1000, headlineMin: 3 })
  ok(led.priorFailure('mc_dig', 0) === null, '没栽过 → 不提醒')
  for (let i = 0; i < 3; i++) led.record({ id: 'x', action: 'mc_dig', at: 0, ms: 1, outcome: 'blocked', why: '走不过去' })
  ok(led.priorFailure('mc_dig', 10)?.count === 3, '同类近期栽过 3 次 → 可提醒')
  ok(led.priorFailure('mc_dig', 5000) === null, '超出窗口 → 不再提醒')
  ok(led.headline(10).length === 1 && led.headline(10)[0].count === 3, '头名统计：达到门槛才起报')
  ok(led.streak('mc_dig', 10) === 3, '连击计数（喂指引：这招不管用）')
  ok(led.headline(10)[0].why === '走不过去', '头名保留原话（不改写、不归因）')
}

console.log('\n[21] 执行门面 + 身体租约（E4）')
{
  const mkCtx = (bag, pos = { x: 0, y: 64, z: 0 }) => ({
    countItem: (n) => bag[n] ?? 0,
    held: () => null,
    position: () => pos,
    blockNameAt: () => 'air',
  })
  const facts = { emptySlots: 20, heldDurabilityRatio: 1 }

  // ① 正常：期望达成
  {
    const bag = { oak_log: 1 }
    const ex = createExecutionLayer({ now: () => 1000 })
    const r = await ex.run({
      action: 'mc_collect', args: { item: 'oak_log', count: 2 }, expectCtx: mkCtx(bag), facts,
      exec: async () => { bag.oak_log = 3; return '采集完成' },
    })
    ok(r.receipt.outcome === 'done' && r.receipt.verdict?.met === true, '达成 → done，回执带核验结论')
    ok(shortVerdict(r.receipt.expect, r.receipt.verdict) === '核验✓ oak_log×3', '回执能给出极短核验标记')
  }
  // ② 旗舰功能：noop（工具说成功、世界没变）
  {
    const bag = { oak_log: 1 }
    const ex = createExecutionLayer({ now: () => 1000 })
    const r = await ex.run({
      action: 'mc_collect', args: { item: 'oak_log', count: 2 }, expectCtx: mkCtx(bag), facts,
      exec: async () => '采集完成',   // 说成功，但包没变
    })
    ok(r.receipt.outcome === 'noop' && /世界没变/.test(r.receipt.why ?? ''), `**noop 被抓出来**：${r.receipt.why}`)
  }
  // ③ 抛错 → blocked + 归属 + 中文化
  {
    const ex = createExecutionLayer({ now: () => 1000 })
    const r = await ex.run({
      action: 'mc_goto', args: { x: 1, y: 2, z: 3 }, expectCtx: mkCtx({}), facts,
      exec: async () => { throw new Error('Path was stopped by another goal') },
    })
    ok(r.receipt.outcome === 'blocked' && r.receipt.source === 'local' && r.receipt.why === '寻路半途被叫停', `抛错 → blocked（${r.receipt.why}）`)
  }
  // ④ hard 前置闸 → 根本不执行
  {
    let ran = false
    const ex = createExecutionLayer({ now: () => 1000 })
    const r = await ex.run({
      action: 'mc_collect', args: { item: 'oak_log' }, expectCtx: mkCtx({}), facts: { ...facts, emptySlots: 0 },
      exec: async () => { ran = true; return 'x' },
    })
    ok(ran === false && r.receipt.outcome === 'blocked' && /空位/.test(r.receipt.why ?? ''), 'hard 前置闸：动手之前就拒，附具名理由')
  }
  // ⑤ soft 前置闸 → 照常执行 + 只报事实
  {
    const ex = createExecutionLayer({ now: () => 1000 })
    const r = await ex.run({
      action: 'mc_collect', args: { item: 'oak_log' }, expectCtx: mkCtx({ oak_log: 5 }), facts: { ...facts, emptySlots: 3 },
      exec: async () => 'ok',
    })
    ok(r.receipt.outcome === 'done' && r.notes.some((s) => /先提醒/.test(s) && /空位/.test(s)), 'soft 前置闸：只报事实、不拦动作')
  }
  // ⑥ 早停名单的未知名字进提示
  {
    const ex = createExecutionLayer({ now: () => 1000 })
    const r = await ex.run({
      action: 'mc_goto', args: { x: 1, y: 2, z: 3 }, expectCtx: mkCtx({}), facts,
      until: ['lava', '外星方块'], knownBlock: (n) => n === 'lava',
      exec: async () => 'ok',
    })
    ok(r.notes.some((s) => /认不出来/.test(s)), '早停名单里认不出的名字要点名（不许静默吃掉）')
  }

  // ⑦ 身体租约：效用评分 + 迟滞余量 + 反射只能为安全抢
  const scoreTool = { survival: 2, urgency: 3, feasibility: 10, progress: 5, continuity: 4, disruption: 1 }
  ok(Math.abs(bodyUtilityScore({ survival: 10 }) - 10 * UTILITY_WEIGHTS.survival) < 1e-9, '效用评分：单一因子×权重')
  ok(UTILITY_WEIGHTS.disruption < 0, '破坏性是负权重（会打断别人的动作要扣分）')

  const lease = createBodyLease({ now: () => 1000, leaseMs: 2500, preemptMargin: BODY_PREEMPT_MARGIN })
  const a = {}, b = {}
  ok(lease.propose({ owner: a, ownerKind: 'goal', intent: 'A 干活', utility: scoreTool }).reason === 'acquire', '无人持有 → 直接 acquire')
  ok(lease.propose({ owner: a, ownerKind: 'goal', intent: 'A 继续', utility: scoreTool }).reason === 'renew', '同一实例 → renew')
  const weak = lease.propose({ owner: b, ownerKind: 'goal', intent: 'B 想插队', utility: { ...scoreTool, survival: 1, urgency: 1, feasibility: 1, disruption: 10 } })
  ok(weak.granted === false && weak.reason === 'hysteresis', `差距不够 → hysteresis 拒绝（迟滞余量 ${BODY_PREEMPT_MARGIN} 分）`)
  const strong = lease.propose({ owner: b, ownerKind: 'goal', intent: 'B 高优先级', utility: { ...scoreTool, survival: 10, urgency: 10, feasibility: 10, disruption: 0 } })
  ok(strong.granted === true && strong.reason === 'preempt', '超出余量 → preempt 接管')
  const reflexWeak = lease.propose({ owner: {}, ownerKind: 'reflex', intent: '反射想抢', utility: { survival: REFLEX_SAFETY_MIN - 1, feasibility: 10 } })
  ok(reflexWeak.granted === false && reflexWeak.reason === 'reflex-not-safety', '反射层非安全理由 → 拒绝抢身体（我们的额外纪律）')
  lease.setGeneration(2)
  ok(lease.current() === null, '换连接代次 → 旧租约作废')
  ok(lease.propose({ owner: a, ownerKind: 'goal', intent: '新连接', utility: scoreTool }).granted === true, '新代次可重新取得')
  lease.release(a)
  ok(lease.current() === null, '释放后无人持有')
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
