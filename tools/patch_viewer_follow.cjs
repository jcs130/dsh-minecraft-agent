// 给 prismarine-viewer 网页端 orbit 模式（第三人称）加"跟随人物"：
// 相机 target 与 position 按玩家每步位移平移，保留用户拖拽出的环绕角度/距离。
// 同时支持 ?follow=0 关闭跟随（自由镜头）。
// 用法：node patch-viewer-follow.cjs
const fs = require('fs')
const path = require('path')

const pub = path.resolve(__dirname, '..', 'node_modules', 'prismarine-viewer', 'public', 'index.js')
const src = path.resolve(__dirname, '..', 'node_modules', 'prismarine-viewer', 'lib', 'index.js')

// ---------- 1. bundle ----------
let s = fs.readFileSync(pub, 'utf8')
const orig = s

const A1 = 'let s=!0;const l=new THREE.WebGLRenderer'
const A2 = '}catch(e){}let h=new THREE.OrbitControls'
const A3 = 'if(t.y>0&&s&&(h.target.set(t.x,t.y,t.z),u.camera.position.set(t.x,t.y+8,t.z+10),h.update(),s=!1),i){'

if (s.includes('__pvNoFollow')) {
  console.log('bundle already patched, skip')
} else if (!s.includes(A1) || !s.includes(A2) || !s.includes(A3)) {
  console.error('ANCHOR MISS — bundle layout changed, abort (no write)')
  process.exit(1)
} else {
  s = s.replace(A1, 'let s=!0,z=null;const l=new THREE.WebGLRenderer')
  s = s.replace(A2, '}catch(e){}try{window.__pvNoFollow="0"===new URLSearchParams(location.search).get("follow")}catch(e){}let h=new THREE.OrbitControls')
  s = s.replace(A3,
    'if(t.y>0){if(s)h.target.set(t.x,t.y,t.z),u.camera.position.set(t.x,t.y+8,t.z+10),h.update(),s=!1;' +
    'else if(h&&!window.__pvNoFollow){var __dx=t.x-z.x,__dy=t.y-z.y,__dz=t.z-z.z;' +
    '(__dx||__dy||__dz)&&(h.target.x+=__dx,h.target.y+=__dy,h.target.z+=__dz,' +
    'u.camera.position.x+=__dx,u.camera.position.y+=__dy,u.camera.position.z+=__dz,h.update())}' +
    'z={x:t.x,y:t.y,z:t.z}}if(i){')
  fs.copyFileSync(pub, pub + '.bak-nofollow')
  fs.writeFileSync(pub, s)
  console.log('bundle patched:', (s.length - orig.length), 'bytes delta; backup -> index.js.bak-nofollow')
}

// ---------- 2. 源码同步（未来 webpack 重build保持行为一致） ----------
let t = fs.readFileSync(src, 'utf8')
if (t.includes('__pvNoFollow')) {
  console.log('source already patched, skip')
} else {
  fs.copyFileSync(src, src + '.bak-nofollow')
  // 声明 follow 状态
  t = t.replace('let firstPositionUpdate = true',
    'let firstPositionUpdate = true\nlet lastFollowPos = null\ntry { window.__pvNoFollow = new URLSearchParams(location.search).get("follow") === "0" } catch (e) {}')
  // orbit 分支加跟随
  const B =
`    if (pos.y > 0 && firstPositionUpdate) {
      controls.target.set(pos.x, pos.y, pos.z)
      viewer.camera.position.set(pos.x, pos.y + 8, pos.z + 10)
      controls.update()
      firstPositionUpdate = false
    }`
  const BN =
`    if (pos.y > 0) {
      if (firstPositionUpdate) {
        controls.target.set(pos.x, pos.y, pos.z)
        viewer.camera.position.set(pos.x, pos.y + 8, pos.z + 10)
        controls.update()
        firstPositionUpdate = false
      } else if (controls && !window.__pvNoFollow && lastFollowPos) {
        // 第三人称跟随：按玩家位移平移相机与目标，保留用户环绕角度/缩放
        const dx = pos.x - lastFollowPos.x
        const dy = pos.y - lastFollowPos.y
        const dz = pos.z - lastFollowPos.z
        if (dx || dy || dz) {
          controls.target.x += dx; controls.target.y += dy; controls.target.z += dz
          viewer.camera.position.x += dx; viewer.camera.position.y += dy; viewer.camera.position.z += dz
          controls.update()
        }
      }
      lastFollowPos = { x: pos.x, y: pos.y, z: pos.z }
    }`
  if (!t.includes(B)) { console.error('SOURCE ANCHOR MISS, abort source write'); process.exit(1) }
  t = t.replace(B, BN)
  fs.writeFileSync(src, t)
  console.log('source patched (lib/index.js); backup -> index.js.bak-nofollow')
}
console.log('DONE')
