// 给 prismarine-viewer 浏览器 worker bundle 打 1.21.11 支持补丁
// 补丁 A：PC lazy data 表加 "1.21.11" 别名项（复用 1.21.4 数据模块）
// 补丁 B：PC versions.json 列表加 1.21.11 条目（registry 解析版本号用）
const fs = require('fs')
const p = 'node_modules/prismarine-viewer/public/worker.js'

let t = fs.readFileSync(p, 'utf8')
if (t.includes('"1.21.11":{get attributes')) {
  console.log('already patched, skip')
  process.exit(0)
}

// ---- 补丁 B：versions 列表（先做，字符串唯一性高）----
const vEntry = '{"minecraftVersion":"1.21.4","version":769,"dataVersion":4189,"usesNetty":true,"majorVersion":"1.21","releaseType":"release"}'
const vNew = vEntry + ',{"minecraftVersion":"1.21.11","version":774,"dataVersion":4671,"usesNetty":true,"majorVersion":"1.21","releaseType":"release"}'
const cntB = t.split(vEntry).length - 1
if (cntB !== 1) { console.error('ABORT B: versions entry count=' + cntB); process.exit(1) }
t = t.replace(vEntry, vNew)
console.log('patch B ok: versions list +1.21.11')

// ---- 补丁 A：lazy data 表 ----
const marker = '"1.21.4":{get attributes'
const iStart = t.indexOf(marker)
if (iStart < 0) { console.error('ABORT A: marker not found'); process.exit(1) }
const iEnd = t.indexOf('},bedrock:', iStart)
if (iEnd < 0) { console.error('ABORT A: table end not found'); process.exit(1) }
const entry = t.slice(iStart, iEnd)
const newEntry = entry.replace('"1.21.4":', '"1.21.11":')
t = t.slice(0, iEnd) + ',' + newEntry + t.slice(iEnd)
console.log('patch A ok: data table +1.21.11 alias (entry len=' + entry.length + ')')

fs.copyFileSync(p, p + '.bak-12111')
fs.writeFileSync(p, t)
console.log('written, backup at worker.js.bak-12111')
