// prepare 脚本（pnpm 在 git 安装后自动运行；本地开发也可直接 node scripts/build.mjs）。
//
// 两种产物形态（docs/user/develop/basic/publish.md 官方规则）：
//  1. lib/bootstrap.mjs —— 独立进程入口：每个 AI 玩家（穿越者）一个进程，
//     MC_USERNAME=X node lib/bootstrap.mjs 直接拉起，不依赖 dsh 主进程。
//  2. lib/plugins/<name>.mjs —— dsh 主进程内嵌插件：组合包 cordis.patch.yml
//     按包名引用（dsh-minecraft-agent/lib/plugins/mc-bot.mjs），dsh --profile
//     启动时注入 dsh 会话，穿越者工具成为 dsh agent 的身体。
//
// 自包含原则（publish 文档要求）：不假设旁边有 monorepo checkout，只依赖本包内文件
// 与 package.json 声明的 npm 依赖（external）。每个入口独立 bundle（共享模块重复
// 打包可接受），避免 loader 动态 import 相对 chunk 的解析风险。
import { build } from 'esbuild'
import { mkdirSync, readdirSync } from 'node:fs'

mkdirSync('lib', { recursive: true })
mkdirSync('lib/plugins', { recursive: true })

const externals = [
  // peer：宿主 cordis 栈（内嵌形态由 dsh 安装目录提供；独立形态由本包 peer 依赖解析）
  '@deepseek-ai/cordis',
  '@deepseek-ai/cordis-plugin-timer',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/schemastery',
  // npm 依赖：安装时由 pnpm 拉取
  'mineflayer',
  'mineflayer-pathfinder',
  'mineflayer-tool',
  'prismarine-viewer',
  'vec3',
  'minecraft-data',
  'minecraft-protocol',
  'prismarine-chunk',
  'prismarine-block',
  'prismarine-item',
  'prismarine-recipe',
  'prismarine-biome',
  'prismarine-entity',
  'prismarine-windows',
  'node-canvas-webgl',
  'three',
  'playwright-core',
  'canvas',
]

// 穿越者侧插件（世界侧 mc-god/mc-rcon/mc-magic/mc-ritual/mc-social/mc-logwatch/
// mc-worlddb 属服务器端，不在本组合包——见 docs 双仓边界）。
const PLUGIN_ENTRIES = [
  'mc-bot',
  'mc-tools',
  'mc-memory',
  'mc-transmigrator',
  'mc-identity',
  'mc-mystic',
  'mc-wiki',
  'mc-village',
  'mc-memos',
  'mc-evolve',
  'mc-adapt',
  'mc-loop',
  'mc-panel',
]

// 1) 独立进程入口（生产用法）
await build({
  entryPoints: ['bootstrap-mc.mts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: 'lib/bootstrap.mjs',
  external: externals,
  logLevel: 'info',
})

// 2) dsh 内嵌插件入口（官方 dsh.plugin 安装形态）
for (const name of PLUGIN_ENTRIES) {
  await build({
    entryPoints: [`src/${name}.ts`],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    outfile: `lib/plugins/${name}.mjs`,
    external: externals,
    logLevel: 'warning',
  })
}

console.log('[build] lib/bootstrap.mjs + %d plugin entries ready', PLUGIN_ENTRIES.length)
