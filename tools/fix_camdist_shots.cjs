// 1) viewer 初始相机 20/20 → 8/10（拉近，跟随感更强）  2) 面板思考流截图去 260px 像素压缩
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')
let changed = []

// ---------- 1. bundle（立即生效：viewer 静态文件按请求读盘） ----------
const pub = path.join(root, 'node_modules', 'prismarine-viewer', 'public', 'index.js')
let s = fs.readFileSync(pub, 'utf8')
const n = (s.match(/t\.y\+20,t\.z\+20/g) || []).length
if (n === 1) {
  s = s.replace('t.y+20,t.z+20', 't.y+8,t.z+10')
  fs.writeFileSync(pub, s)
  changed.push('bundle public/index.js: initial cam y+20,z+20 -> y+8,z+10')
} else {
  console.error('ABORT bundle: occurrences =', n)
  process.exit(1)
}

// ---------- 2. lib 源码（未来 rebuild 一致） ----------
const src = path.join(root, 'node_modules', 'prismarine-viewer', 'lib', 'index.js')
let t = fs.readFileSync(src, 'utf8')
const m = (t.match(/pos\.y \+ 20, pos\.z \+ 20/g) || []).length
if (m === 1) {
  t = t.replace('pos.y + 20, pos.z + 20', 'pos.y + 8, pos.z + 10')
  fs.writeFileSync(src, t)
  changed.push('lib/index.js: initial cam y+20,z+20 -> y+8,z+10')
} else {
  console.error('WARN lib source: occurrences =', m, '(skip lib)')
}

// ---------- 3. 补丁脚本同步（未来重打补丁保持新距离） ----------
const pf = path.join(root, 'tools', 'patch_viewer_follow.cjs')
let p = fs.readFileSync(pf, 'utf8')
const before = p
p = p.split('t.y+20,t.z+20').join('t.y+8,t.z+10')
p = p.split('pos.y + 20, pos.z + 20').join('pos.y + 8, pos.z + 10')
if (p !== before) { fs.writeFileSync(pf, p); changed.push('tools/patch_viewer_follow.cjs synced') }

// ---------- 4. 面板：截图原画质 + pv=4 缓存穿透 ----------
const wp = path.join(root, 'web-panel.mjs')
let w = fs.readFileSync(wp, 'utf8')
const cssOld = '.step .shot img { max-width:260px; image-rendering:pixelated; border:1px solid var(--line); border-radius:6px; margin:4px 0; cursor:zoom-in; display:block; }'
const cssNew = '.step .shot img { width:100%; max-width:800px; border:1px solid var(--line); border-radius:6px; margin:4px 0; cursor:zoom-in; display:block; }'
if (w.includes(cssOld)) { w = w.replace(cssOld, cssNew); changed.push('panel CSS: shot img 260px pixelated -> full quality (max 800px)') }
else console.error('WARN: panel CSS anchor miss')
const pvCount = (w.match(/&pv=3/g) || []).length
w = w.split('&pv=3').join('&pv=4')
changed.push(`panel iframe: pv=3 -> pv=4 (${pvCount} places)`)
fs.writeFileSync(wp, w)

console.log(changed.join('\n'))
console.log('DONE')
