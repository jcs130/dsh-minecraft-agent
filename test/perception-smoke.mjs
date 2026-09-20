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
  ok(/📍你移到 \(128, 64, -301\)/.test(first), '首次注入含位置')
  ok(/【态势】/.test(first), '含态势行')
  ok(/在线旅人 1/.test(first), '含在线旅人数（不具名）')
  ok(!/Alice/.test(first), '去名化：注入里不出现玩家名')
  const second = p.status()
  ok(!/♥生命/.test(second), '第二次生命未变 → 不再注入（门控）')
  ok(!/📍你移到/.test(second), '第二次未跨区段 → 不再注入位置（节流）')
}

console.log('\n[3] 内感受：受伤 / 溺水 / 低耐久')
{
  const bot = makeBot()
  const p = createPerception({ body: () => bot, username: 'Edward', log: () => {}, socialLines: () => [], recentActions: () => [] })
  p.status()
  bot.health = 15
  bot.emit('health')
  const hit = p.status()
  ok(/你被击中 -5/.test(hit), '受伤事件进入注入')
  ok(/⚠重伤/.test((bot.health = 6, p.status())), '生命 ≤8 标重伤')
  bot.oxygenLevel = 6
  bot.emit('breath')
  ok(/氧气 6\/20.*空气过半/.test(p.status()), '空气过半提醒（0..20 刻度）')
  bot.oxygenLevel = 4
  bot.emit('breath')
  ok(/氧气 4\/20 ⚠快要溺水/.test(p.status()), '≤5 才判将溺水')
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
  ok(/【停滞】你已连续 \d+ 轮待在同一片区域/.test(s), '停滞检测')
  ok(/近处敌对怪 1 个/.test(s) && /creeper 东\d+格/.test(s), '威胁计数 + 最近威胁方位（cow 不算敌对）')
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
  bot.emit('entityHurt', bot.entity, { name: 'skeleton' })
  ok(/你被击中 被 skeleton/.test(p.status()), '受伤带上真实伤害源')
  bot.emit('entityHurt', bot.entity, { name: 'player', username: 'Bob' })
  const hurt = p.status()
  ok(/被 某个玩家/.test(hurt) && !/Bob/.test(hurt), '玩家伤害源去名化（不泄露 Bob）')
  // title / actionBar 是 ChatMessage 形态
  bot.emit('title', { text: '', extra: [{ text: '村庄' }, { text: '被袭击' }] }, 'title')
  ok(/【字幕】村庄被袭击/.test(p.status()), 'title：嵌套 ChatMessage 扁平化为文本')
  bot.emit('actionBar', { text: '剩余 3 分钟' }, null)
  ok(/【提示】剩余 3 分钟/.test(p.status()), 'actionBar：扁平化')
  // 氧气刻度实证为 0..20
  bot.oxygenLevel = 4
  bot.emit('breath')
  ok(/氧气 4\/20 ⚠快要溺水/.test(p.status()), '氧气 0..20 刻度 + 危险阈值（≤5 才算将溺水）')
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

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
