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
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'

mkdirSync('lib', { recursive: true })
mkdirSync('lib/plugins', { recursive: true })

const externals = [
  // peer：宿主 cordis 栈（内嵌形态由 dsh 安装目录提供；独立形态由本包 peer 依赖解析）
  '@deepseek-ai/cordis',
  '@deepseek-ai/cordis-plugin-timer',
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-agent-loop',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-attachment',
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
  'mc-progress',
  'mc-mystic',
  'mc-wiki',
  'mc-village',
  'mc-memos',
  'mc-evolve',
  'mc-adapt',
  'mc-loop',
  'mc-panel',
  'llm-qwen-local',
  'mc-session',
]

// 1) 独立进程入口（生产用法：进程级 mc-loop 自驱形态）
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

// 1b) 独立进程入口（新形态：dsh 原生 session agent）
await build({
  entryPoints: ['bootstrap-session.mts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: 'lib/bootstrap-session.mjs',
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

// 3) 浏览器 client 半（官方 dsh.client 插件形态）：会话视图环 conversation.view
//    tab「MC面板」（与「对话」「轨迹」同一行），视图内嵌 <iframe src="/mc-panel/">
//    复用 server 端 dashboard。产物 lib/client.js 由 package.json 的
//    exports["./client"] 暴露，dsh web 扫描 dsh.client 声明后经
//    /plugins/dsh-minecraft-agent/client.js 注入。
//    产出形态对齐官方 packages/client/tsdown.client.ts 的 clientConfig：
//    format cjs + platform browser + banner/footer 包 window.__ModuleLoader__.load。
const CLIENT_EXTERNALS = [
  // dsh web 平台的 seed 模块（运行时由 factory 的 require 从 loader module
  // table 解析，见 packages/client/web/src/platform.ts PLATFORM_MODULES）。
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
  // runtime 的 client 面（ClientContext 类型来源）+ conversation 的
  // conversation.view slot 声明。均为 type-only import（esbuild 擦除），列
  // external 防 resolve。
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-ui-conversation/client',
]

await build({
  entryPoints: ['src/client.tsx'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  outfile: 'lib/client.js',
  external: CLIENT_EXTERNALS,
  logLevel: 'info',
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  banner: {
    js: 'window.__ModuleLoader__.load({ id: "dsh-minecraft-agent", factory: (require) => { var module = { exports: {} }; var exports = module.exports;',
  },
  footer: {
    js: 'return module.exports; } });',
  },
})

console.log('[build] lib/bootstrap.mjs + lib/bootstrap-session.mjs + lib/client.js + %d plugin entries ready', PLUGIN_ENTRIES.length)

// node half（空壳 apply）：`"."` main 指向此文件，给 Loader 一个 host 侧 row，
// client 半经 exports["./client"]（lib/client.js）走。对齐官方 browser-only 插件
//（如 dsh-client-ui-brand-official）形态；lib/bootstrap.mjs 仍由 bin/cli.mjs 相对路径引用。
writeFileSync('lib/index.js', '// node half (empty apply) — host-side row for the client-only plugin.\n// The browser half ships through exports["./client"] (lib/client.js).\nfunction apply() {}\nexport { apply };\n')
console.log('[build] lib/index.js (node half) written')
