import { mkdir, copyFile } from 'node:fs/promises';
import { build } from 'esbuild';
await mkdir('lib/plugins', { recursive: true });
for (const name of ['mc-harness', 'harness-bridge', 'harness-panel', 'harness-lifecycle', 'harness-goal', 'harness-budget', 'event-condenser-fallback', 'harness2', 'dsh-compat', 'dsh-native-streams', 'qiandengji-access']) await copyFile(`src/${name}.mjs`, `lib/plugins/${name}.mjs`);
await build({entryPoints:['src/client.tsx'],bundle:true,format:'cjs',platform:'browser',target:'es2020',jsx:'automatic',
  outfile:'lib/client.js',external:['react','react/jsx-runtime'],define:{'process.env.NODE_ENV':JSON.stringify('production')},
  banner:{js:'window.__ModuleLoader__.load({id:"@jcs130/dsh-minecraft-agent",factory:(require)=>{var module={exports:{}};var exports=module.exports;'},
  footer:{js:'return module.exports;}});'}});
console.log('Built Minecraft host adapter and DSH native panel. Shared core owns body and visualization.');
