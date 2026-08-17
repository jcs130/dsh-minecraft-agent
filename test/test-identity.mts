import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chunkStory } from '../src/mc-identity.ts'

test('chunkStory splits by blank lines and normalizes whitespace', () => {
  const story = '第一段。\n\n\n第二段，有多个空行分隔。  \n\n第三段！'
  const chunks = chunkStory(story, 400)
  assert.deepEqual(chunks, ['第一段。', '第二段，有多个空行分隔。', '第三段！'])
})

test('chunkStory keeps short backstory as-is (3 paras, real archive size)', () => {
  const story = Array.from({ length: 3 }, (_, i) => `第${i + 1}段：` + '故事'.repeat(80)).join('\n\n')
  // 每段 ~167 字，全部 <= 400 → 3 片，一段一片
  const chunks = chunkStory(story, 400)
  assert.equal(chunks.length, 3)
  assert.ok(chunks.every((c) => c.length <= 400))
})

test('chunkStory splits overlong paragraph on sentence boundaries', () => {
  const sentences = Array.from({ length: 30 }, (_, i) => `第${i + 1}句话。`)
  const longPara = sentences.join('')
  const chunks = chunkStory(longPara, 60)
  assert.ok(chunks.length >= 3, `expected >=3 chunks, got ${chunks.length}`)
  assert.ok(chunks.every((c) => c.length <= 60), `all chunks <=60, max=${Math.max(...chunks.map((c) => c.length))}`)
  // 句子不被撕碎：每片以句末标点收尾
  assert.ok(chunks.every((c) => /[。！？!?…]$/.test(c)))
  // 无内容丢失
  assert.equal(chunks.join(''), longPara)
})

test('chunkStory drops empty input gracefully', () => {
  assert.deepEqual(chunkStory('', 400), [])
  assert.deepEqual(chunkStory('   \n\n  ', 400), [])
})
