import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { WikiStore } from '../src/mc-wiki.ts'

function freshStore(): { store: WikiStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'mcwiki-'))
  return { store: new WikiStore(dir, 'Tester', 50), dir }
}

test('add persists to jsonl and reloads', () => {
  const { store, dir } = freshStore()
  store.add('death', '夜晚遇怪', '天黑后不要离开基地，怪物在夜里刷新且伤害高。')
  assert.equal(store.size, 1)
  const raw = readFileSync(join(dir, 'wiki-Tester.jsonl'), 'utf8').trim()
  assert.ok(raw.includes('夜晚遇怪'))
  const reloaded = new WikiStore(dir, 'Tester', 50)
  assert.equal(reloaded.size, 1)
  rmSync(dir, { recursive: true, force: true })
})

test('search ranks by keyword overlap and bumps uses', () => {
  const { store, dir } = freshStore()
  store.add('fail', '寻路超时', '去铁矿的路上有悬崖，pathfinder 走不通，绕东边河谷走。')
  store.add('death', '岩浆危险', '挖矿时不要往脚下挖，下面可能是岩浆。')
  const hits = store.search('去找 iron_ore 铁矿 寻路', 3)
  assert.ok(hits.length >= 1)
  assert.equal(hits[0]!.topic, '寻路超时')
  assert.equal(hits[0]!.uses, 1)
  const none = store.search('完全无关的查询词组', 3)
  assert.equal(none.length, 0)
  rmSync(dir, { recursive: true, force: true })
})

test('hasTopicLike dedupes exact topics', () => {
  const { store, dir } = freshStore()
  store.add('death', '夜晚遇怪', '教训 A')
  assert.ok(store.hasTopicLike('夜晚遇怪'))
  assert.ok(!store.hasTopicLike('岩浆危险'))
  rmSync(dir, { recursive: true, force: true })
})

test('maxCards trims oldest', () => {
  const { store, dir } = freshStore()
  for (let i = 0; i < 12; i++) store.add('manual', `topic-${i}`, 'content')
  const trimmed = new WikiStore(dir, 'Tester', 5)
  assert.equal(trimmed.size, 5)
  assert.ok(trimmed.hasTopicLike('topic-11'))
  assert.ok(!trimmed.hasTopicLike('topic-0'))
  rmSync(dir, { recursive: true, force: true })
})
