// 给 prismarine-viewer 加"追尾镜头"模式：?follow=chase
// 相机锁死在穿越者背后（按 yaw 对齐），平滑跟随 —— 用于截图精确复现人物位置关系（AI 漫剧参考图）。
// 与既有 follow 补丁共存：follow 不带参数=环绕跟随（保留角度）；follow=0=自由镜头；follow=chase=追尾锁定。
// 可选微调：&cdist=<2..12>（默认4.2 背后距离）、&chgt=<0..4>（默认1.1 相机抬高）。
// 用法：node patch_viewer_chase.cjs
const fs = require('fs')
const path = require('path')

const pub = path.resolve(__dirname, '..', 'node_modules', 'prismarine-viewer', 'public', 'index.js')
const src = path.resolve(__dirname, '..', 'node_modules', 'prismarine-viewer', 'lib', 'index.js')

// ---------- 1. bundle（实际被服务的 webpack 产物） ----------
let s = fs.readFileSync(pub, 'utf8')
if (s.includes('__pvChase')) {
  console.log('bundle already patched, skip')
} else {
  // 状态变量
  const S1 = 'let s=!0,z=null;const l=new THREE.WebGLRenderer'
  // 参数解析（挂在 __pvNoFollow 解析之后）
  const S2 = 'try{window.__pvNoFollow="0"===new URLSearchParams(location.search).get("follow")}catch(e){}'
  // position 处理 orbit 分支头部
  const S3 = 'if(t.y>0){if(s)h.target.set(t.x,t.y,t.z)'
  // animate 渲染循环
  const S4 = 'window.requestAnimationFrame(t),h&&h.update(),u.update(),l.render(u.scene,u.camera)}()'

  const S2N = S2 + 'try{const _q=new URLSearchParams(location.search);window.__pvChase="chase"===_q.get("follow");const _d=parseFloat(_q.get("cdist")),_g=parseFloat(_q.get("chgt"));window.__pvChaseDist=(_d>=2&&_d<=12)?_d:4.2;window.__pvChaseH=(_g>=0&&_g<=4)?_g:1.1}catch(e){}'
  const S3N = 'if(t.y>0){if(window.__pvChase){h&&(h.dispose(),h=null),__cs={x:t.x,y:t.y,z:t.z,yaw:void 0!==r?r:__cs?__cs.yaw:0}}else if(s)h.target.set(t.x,t.y,t.z)'
  const CHASE_ANIM = 'window.__pvChase&&__cs&&(function(){var _tx=__cs.x,_ty=__cs.y+1.6,_tz=__cs.z,_dx=-Math.sin(__cs.yaw),_dz=Math.cos(__cs.yaw),_D=window.__pvChaseDist,_H=window.__pvChaseH,_cx=_tx-_dx*_D,_cy=_ty+_H,_cz=_tz-_dz*_D;if(!__cp||Math.hypot(__cp.px-_cx,__cp.py-_cy,__cp.pz-_cz)>8)__cp={px:_cx,py:_cy,pz:_cz,gx:_tx,gy:_ty,gz:_tz};__cp.px+=.18*(_cx-__cp.px);__cp.py+=.18*(_cy-__cp.py);__cp.pz+=.18*(_cz-__cp.pz);__cp.gx+=.25*(_tx-__cp.gx);__cp.gy+=.25*(_ty-__cp.gy);__cp.gz+=.25*(_tz-__cp.gz);u.camera.position.set(__cp.px,__cp.py,__cp.pz);u.camera.lookAt(__cp.gx,__cp.gy,__cp.gz)})(),'
  const S4N = 'window.requestAnimationFrame(t),h&&h.update(),u.update(),' + CHASE_ANIM + 'l.render(u.scene,u.camera)}()'

  if (!s.includes(S1) || !s.includes(S2) || !s.includes(S3) || !s.includes(S4)) {
    console.error('ANCHOR MISS — bundle layout changed, abort (no write)')
    process.exit(1)
  }
  s = s.replace(S1, 'let s=!0,z=null,__cs=null,__cp=null;const l=new THREE.WebGLRenderer')
  s = s.replace(S2, S2N)
  s = s.replace(S3, S3N)
  s = s.replace(S4, S4N)
  fs.copyFileSync(pub, pub + '.bak-nofollow')
  fs.writeFileSync(pub, s)
  console.log('bundle patched (chase)')
}

// ---------- 2. 源码同步 ----------
let t = fs.readFileSync(src, 'utf8')
if (t.includes('__pvChase')) {
  console.log('source already patched, skip')
} else {
  fs.copyFileSync(src, src + '.bak-nofollow')
  t = t.replace(
    'let firstPositionUpdate = true\nlet lastFollowPos = null\ntry { window.__pvNoFollow = new URLSearchParams(location.search).get("follow") === "0" } catch (e) {}',
    `let firstPositionUpdate = true
let lastFollowPos = null
// 追尾镜头状态：__cs=最新目标位姿 {x,y,z,yaw}；__cp=平滑后的相机 pos(px,py,pz)/lookAt 目标(gx,gy,gz)
let chasePose = null
let chaseCam = null
try {
  window.__pvNoFollow = new URLSearchParams(location.search).get("follow") === "0"
  const q = new URLSearchParams(location.search)
  window.__pvChase = q.get("follow") === "chase"
  const d = parseFloat(q.get("cdist")); const g = parseFloat(q.get("chgt"))
  window.__pvChaseDist = (d >= 2 && d <= 12) ? d : 4.2
  window.__pvChaseH = (g >= 0 && g <= 4) ? g : 1.1
} catch (e) {}`)

  t = t.replace(
    `    if (pos.y > 0) {
      if (firstPositionUpdate) {`,
    `    if (pos.y > 0) {
      if (window.__pvChase) {
        // 追尾模式：丢弃 OrbitControls，只记录位姿，相机交给 animate 循环
        if (controls) { controls.dispose(); controls = null }
        chasePose = { x: pos.x, y: pos.y, z: pos.z, yaw: yaw !== undefined ? yaw : (chasePose ? chasePose.yaw : 0) }
      } else if (firstPositionUpdate) {`)

  t = t.replace(
    `function animate () {
  window.requestAnimationFrame(animate)
  if (controls) controls.update()
  viewer.update()
  renderer.render(viewer.scene, viewer.camera)
}`,
    `function animate () {
  window.requestAnimationFrame(animate)
  if (controls) controls.update()
  viewer.update()
  // 追尾镜头：相机=角色背后(按yaw对齐)+抬高，位置/目标双 lerp 平滑；瞬移距离>8 直接吸附
  if (window.__pvChase && chasePose) {
    const tx = chasePose.x; const ty = chasePose.y + 1.6; const tz = chasePose.z
    const dx = -Math.sin(chasePose.yaw); const dz = Math.cos(chasePose.yaw) // MC yaw: 0=+Z(南), 90=-X(西)
    const D = window.__pvChaseDist; const H = window.__pvChaseH
    const cx = tx - dx * D; const cy = ty + H; const cz = tz - dz * D
    if (!chaseCam || Math.hypot(chaseCam.px - cx, chaseCam.py - cy, chaseCam.pz - cz) > 8) {
      chaseCam = { px: cx, py: cy, pz: cz, gx: tx, gy: ty, gz: tz }
    }
    chaseCam.px += 0.18 * (cx - chaseCam.px); chaseCam.py += 0.18 * (cy - chaseCam.py); chaseCam.pz += 0.18 * (cz - chaseCam.pz)
    chaseCam.gx += 0.25 * (tx - chaseCam.gx); chaseCam.gy += 0.25 * (ty - chaseCam.gy); chaseCam.gz += 0.25 * (tz - chaseCam.gz)
    viewer.camera.position.set(chaseCam.px, chaseCam.py, chaseCam.pz)
    viewer.camera.lookAt(chaseCam.gx, chaseCam.gy, chaseCam.gz)
  }
  renderer.render(viewer.scene, viewer.camera)
}`)

  if (!t.includes('__pvChase')) { console.error('SOURCE PATCH FAILED'); process.exit(1) }
  fs.writeFileSync(src, t)
  console.log('source patched (chase)')
}
console.log('DONE')
