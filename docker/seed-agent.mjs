#!/usr/bin/env node
// seed-agent.mjs —— 穿越者容器冷启动档案种子（entrypoint 第一步）。
//
// 目标：零配置接入。新玩家（如局域网小 P 的 Agent）只需要给 MC_USERNAME，
// 不写任何档案文件也能得到一份体面的「旅人」人格（persona + 前世故事），
// mc-identity 的身份锚与 MemOS 前世记忆种子链路即可完整工作。
//
// 已有同名条目 → 跳过（幂等，volume 里的真人润色版永远优先）。
// 个性化：MC_PERSONA / MC_BACKSTORY / MC_EPITHET / MC_AGENT_NAME 环境变量
// 可覆盖默认文案（docker run -e 一行接入自定义人设）。
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const dataDir = resolve(process.env.DATA_DIR ?? './data')
const username = process.env.MC_USERNAME ?? 'HarnessBot'
const registryPath = resolve(dataDir, 'transmigrators.json')

let entries = []
if (existsSync(registryPath)) {
  try {
    const raw = JSON.parse(readFileSync(registryPath, 'utf8'))
    entries = Array.isArray(raw) ? raw : (raw?.transmigrators ?? [])
  } catch {
    // 损坏的注册表按空处理，重写
  }
}
if (entries.some((e) => String(e?.username ?? '').toLowerCase() === username.toLowerCase())) {
  console.log(`[seed-agent] registry already has "${username}", skip seeding`)
  process.exit(0)
}

const personaDir = resolve(dataDir, 'transmigrators')
mkdirSync(personaDir, { recursive: true })
const slug = username.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'agent'
const personaFile = `transmigrators/${slug}.persona.md`
const backstoryFile = `transmigrators/${slug}.backstory.md`

const persona = (process.env.MC_PERSONA ?? '').trim() || [
  `# ${username}`,
  '',
  '你是一位意外穿越到这个方块世界的普通旅人。',
  '性格沉稳好奇，说话简洁友善，喜欢观察、提问和帮忙。',
  '没有超能力，也没有显赫身世——一切要靠双手在这片大陆重新开始。',
].join('\n')

const backstory = (process.env.MC_BACKSTORY ?? '').trim() || [
  `# ${username} 的前世`,
  '',
  `${username} 原是另一个世界里的普通人。某个寻常的午后，一阵天旋地转，`,
  '再睁眼时已置身于这片方块大陆的初始之地。记忆零零碎碎：',
  '熟悉的人、未完成的事，都留在了那个再也回不去的世界。',
  '既然回不去，那就好好活下去——看看这个世界到底有多大。',
].join('\n')

writeFileSync(resolve(dataDir, personaFile), persona, 'utf8')
writeFileSync(resolve(dataDir, backstoryFile), backstory, 'utf8')

entries.push({
  id: slug,
  name: process.env.MC_AGENT_NAME || username,
  username,
  origin: 'random',
  source: null,
  epithet: process.env.MC_EPITHET || '远道而来的旅人',
  backstoryFile,
  personaFile,
  innate: { preferredAtoms: [], reasoning: '' },
})
writeFileSync(registryPath, JSON.stringify(entries, null, 2), 'utf8')
console.log(`[seed-agent] seeded default transmigrator "${username}" -> ${registryPath}`)
