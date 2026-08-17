/**
 * Unit tests for mc-panel (pure functions only — HTTP layer stays thin).
 * Run: ..\node_modules\.bin\tsx.CMD test-panel.mts
 */
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { collect, facingLabel, resolveShotPath, resolveUsername } from './src/mc-panel.ts'

let passed = 0
function ok(name: string, fn: () => void): void {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

const FIX = join(import.meta.dirname, '.tmp-panel-fixture')
rmSync(FIX, { recursive: true, force: true })
mkdirSync(join(FIX, 'screenshots', 'Kirito'), { recursive: true })
mkdirSync(join(FIX, 'defects'), { recursive: true })

// fixture data
writeFileSync(
  join(FIX, 'status-Kirito.json'),
  JSON.stringify({
    updatedAt: new Date().toISOString(),
    bot: {
      online: true, username: 'Kirito', personaName: '桐人', viewerPort: 3000,
      position: { x: -79, y: 63, z: 163 }, yaw: -Math.PI / 2, health: 18, food: 12,
      sleeping: false, heldItem: 'cobblestone',
      inventory: [
        { name: 'cobblestone', count: 58 }, { name: 'cobblestone', count: 54 },
        { name: 'bread', count: 6 },
      ],
    },
    recentSteps: [
      { ts: new Date().toISOString(), step: 1, thought: '先看看四周', goal: '活下去', tool: 'mc_look', args: {}, outcome: 'ok', shot: 'Kirito/a.jpg' },
      { ts: new Date().toISOString(), step: 2, thought: '挖个木头', goal: '收集木材', tool: 'mc_dig', args: { x: 1 }, outcome: 'tool error: timeout', shot: 'Kirito/b.jpg' },
    ],
  }),
  'utf-8',
)
writeFileSync(join(FIX, 'status-Stale.json'), JSON.stringify({ updatedAt: '2020-01-01T00:00:00Z' }), 'utf-8')
// make Stale older on disk so auto-pick prefers Kirito
utimesSync(join(FIX, 'status-Stale.json'), new Date('2020-01-01'), new Date('2020-01-01'))
writeFileSync(
  join(FIX, 'transmigrators.json'),
  JSON.stringify({ transmigrators: [{ id: 'kirito', name: '桐人', username: 'Kirito', epithet: '黑色剑士 · 二刀流', source: '《刀剑神域》SAO' }] }),
  'utf-8',
)
writeFileSync(join(FIX, 'mystic-state.json'), JSON.stringify({ players: { Kirito: { innateSkill: '归乡', level: 23 } } }), 'utf-8')
writeFileSync(
  join(FIX, 'wiki-Kirito.jsonl'),
  ['{"id":"1","ts":1,"source":"death","topic":"别在夜里乱跑","content":"会死","uses":0}', '{"id":"2","ts":2,"source":"fail","topic":"熔炉别硬刚","content":"用 put_chest","uses":0}', 'not-json'].join('\n'),
  'utf-8',
)
writeFileSync(join(FIX, 'mc-memory.json'), JSON.stringify({ base: { x: -109, y: 64, z: 147 }, resourcePoints: { coal_ore: [{ x: -89, y: 44, z: 161 }] }, currentGoal: '往北走出坑洞' }), 'utf-8')
writeFileSync(join(FIX, 'defects', 'DEFECT-20260817-080630-mc_place.json'), JSON.stringify({ tool: 'mc_place', count: 6, lastSample: 'nothing solid' }), 'utf-8')
writeFileSync(join(FIX, 'screenshots', 'Kirito', 'b.jpg'), 'jpeg-bytes', 'utf-8')

console.log('mc-panel unit tests')

ok('facing: yaw=-π/2 → 东 (实测标定)', () => {
  assert.equal(facingLabel(-Math.PI / 2), '东 (+X)')
  assert.equal(facingLabel(0), '南 (+Z)')
  assert.equal(facingLabel(Math.PI), '北 (-Z)')
  assert.equal(facingLabel(Math.PI / 2), '西 (-X)')
  assert.equal(facingLabel(null), '—')
})

ok('resolveUsername: 显式名优先', () => {
  assert.equal(resolveUsername(FIX, 'Kirito'), 'Kirito')
})

ok('resolveUsername: 空名 → 最新 status 文件', () => {
  assert.equal(resolveUsername(FIX, ''), 'Kirito')
})

ok('resolveShotPath: 合法路径 + 越界拦截', () => {
  assert.ok(resolveShotPath(FIX, 'Kirito/b.jpg'))
  assert.equal(resolveShotPath(FIX, '../status-Kirito.json'), null)
  assert.equal(resolveShotPath(FIX, 'Kirito/missing.jpg'), null)
})

ok('collect: 完整 payload', () => {
  const p = collect(FIX, 'Kirito')
  assert.equal(p.username, 'Kirito')
  assert.ok(p.online, 'status 刚写，应判在线')
  assert.equal(p.archive?.name, '桐人')
  assert.equal(p.archive?.epithet, '黑色剑士 · 二刀流')
  assert.equal(p.mystic?.level, 23)
  assert.equal(p.mystic?.innateSkill, '归乡')
  assert.equal(p.wiki.total, 3)
  assert.equal(p.wiki.cards.length, 3) // 损坏行也计数，渲染为 (损坏行)
  assert.equal(p.memory?.currentGoal, '往北走出坑洞')
  assert.equal(p.defects.length, 1)
  assert.equal(p.defects[0].tool, 'mc_place')
  // 最新一步有 shot=b.jpg（存在）→ latestShot 取它，而非 a.jpg（不存在）
  assert.equal(p.latestShot, 'Kirito/b.jpg')
  assert.ok(p.uptimeSec >= 0)
})

ok('collect: 过期 status → 判离线', () => {
  const p = collect(FIX, 'Stale')
  assert.equal(p.online, false)
  assert.ok((p.staleMs ?? 0) > 60_000)
})

ok('collect: 全空目录不炸', () => {
  const empty = join(FIX, 'empty')
  mkdirSync(empty, { recursive: true })
  const p = collect(empty, '')
  assert.equal(p.username, '')
  assert.equal(p.status, null)
  assert.equal(p.online, false)
  assert.deepEqual(p.defects, [])
})

rmSync(FIX, { recursive: true, force: true })
console.log(`\n${passed} passed`)
