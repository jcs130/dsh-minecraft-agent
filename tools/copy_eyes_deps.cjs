// 从 Mindcraft node_modules 递归补拷缺失的运行时依赖（以 gl/node-canvas-webgl/canvas 为根）
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SRC = 'C:/Users/lzl19/Documents/mindcraft/node_modules';
const DST = 'C:/Users/lzl19/.copaw/workspaces/default/deepseek-harness/scratch-plugin/node_modules';
const SKIP = new Set(['nan', 'node-abi', 'node-gyp', 'prebuild-install', 'node-pre-gyp', 'typescript']);
const seen = new Set();

function copyPkg(name) {
  if (seen.has(name) || SKIP.has(name)) return;
  seen.add(name);
  const dst = path.join(DST, name);
  if (fs.existsSync(path.join(dst, 'package.json'))) {
    console.log('exists', name);
  } else {
    const src = path.join(SRC, name);
    if (!fs.existsSync(src)) { console.log('!! not in mindcraft:', name); return; }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    try { execSync(`robocopy "${src}" "${dst}" /E /NFL /NDL /NJH /NJS /NP`, { stdio: 'ignore' }); } catch (e) { if ((e.status ?? 0) >= 8) throw e; } // robocopy 1-7 均为成功
    console.log('copied', name);
  }
  // 递归其 dependencies（含 scoped）
  const pj = path.join(DST, name, 'package.json');
  if (!fs.existsSync(pj)) return;
  const deps = Object.keys(require(pj).dependencies || {});
  for (const d of deps) copyPkg(d);
}

for (const root of ['gl', 'node-canvas-webgl', 'canvas']) copyPkg(root);
console.log('done');
