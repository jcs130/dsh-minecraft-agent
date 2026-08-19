// prepare 脚本（pnpm 在 git 安装后自动运行）：
// esbuild 把 bootstrap-mc.mts + 全部 src/*.ts 打包成自包含 lib/bootstrap.mjs。
// 自包含原则（publish 文档要求）：不假设旁边有 monorepo checkout，只依赖本包内文件
// 与 package.json 声明的 npm 依赖（external）。
// 产物形态：bundle 安装后 node lib/bootstrap.mjs 即可拉起一个穿越者进程。
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'

mkdirSync('lib', { recursive: true })

const externals = [
  // peer：宿主 cordis 栈
  '@deepseek-ai/cordis',
  '@deepseek-ai/cordis-plugin-timer',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/schemastery',
  // npm 依赖：安装时由 pnpm 拉取
  'better-sqlite3',
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

await build({
  entryPoints: ['bootstrap-mc.mts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: 'lib/bootstrap.mjs',
  external: externals,
  // .mts/.ts 直接转译；图片/二进制不涉及
  logLevel: 'info',
})

console.log('[build] lib/bootstrap.mjs ready — run: MC_USERNAME=<name> node lib/bootstrap.mjs')
