// 给 prismarine-viewer 加"智能运镜"模式：?follow=smart
// = 追尾镜头(follow=chase) + 对话双人体镜头：
//   面板 postMessage {type:'pv-cam', cmd:'dialogue', npc:{x,y,z}, ttl} → 相机平滑切到
//   穿越者×NPC 的过肩双人构图（近=特写两景 / 中=标准双人 / 远=全景长镜），ttl 到期自动回追尾。
// 与 follow=chase / follow=0 / 无参环绕 全部兼容；cdist/chgt 仍控制追尾参数。
// 用法：node patch_viewer_smart.cjs   （可重复执行；已打 v1 chase 会先还原 .bak-nofollow 再打 v2）
const fs = require('fs')
const path = require('path')

const pub = path.resolve(__dirname, '..', 'node_modules', 'prismarine-viewer', 'public', 'index.js')
const src = path.resolve(__dirname, '..', 'node_modules', 'prismarine-viewer', 'lib', 'index.js')

// ---------- 1. bundle（实际被服务的 webpack 产物） ----------
let s = fs.readFileSync(pub, 'utf8')
if (s.includes('__pvSmart')) {
  console.log('bundle already smart-patched, skip')
} else {
  if (s.includes('__pvChase')) {
    // v1 已打：先还原到 nofollow 基线（.bak-nofollow = 无 chase 的状态）
    if (!fs.existsSync(pub + '.bak-nofollow')) {
      console.error('bundle has v1 chase but .bak-nofollow missing — abort')
      process.exit(1)
    }
    fs.copyFileSync(pub + '.bak-nofollow', pub)
    s = fs.readFileSync(pub, 'utf8')
    console.log('bundle restored from .bak-nofollow (v1 chase rolled back)')
  }
  const S1 = 'let s=!0,z=null;const l=new THREE.WebGLRenderer'
  const S2 = 'try{window.__pvNoFollow="0"===new URLSearchParams(location.search).get("follow")}catch(e){}'
  const S3 = 'if(t.y>0){if(s)h.target.set(t.x,t.y,t.z)'
  const S4 = 'window.requestAnimationFrame(t),h&&h.update(),u.update(),l.render(u.scene,u.camera)}()'

  const S2N = S2 + 'try{var _q=new URLSearchParams(location.search);window.__pvSmart="smart"===_q.get("follow");window.__pvChase=window.__pvSmart||"chase"===_q.get("follow");var _d=parseFloat(_q.get("cdist")),_g=parseFloat(_q.get("chgt"));window.__pvChaseDist=(_d>=2&&_d<=12)?_d:4.2;window.__pvChaseH=(_g>=0&&_g<=4)?_g:1.1}catch(e){}'
  + 'try{window.addEventListener("message",function(e){var d=e&&e.data;if(d&&"pv-cam"===d.type&&"dialogue"===d.cmd&&d.npc&&window.__pvSmart){window.__pvDial={x:+d.npc.x||0,y:+d.npc.y||0,z:+d.npc.z||0,until:Date.now()+(d.ttl||9000)}}})}catch(e){}'
  const S3N = 'if(t.y>0){if(window.__pvChase){h&&(h.dispose(),h=null),__cs={x:t.x,y:t.y,z:t.z,yaw:void 0!==r?r:__cs?__cs.yaw:0}}else if(s)h.target.set(t.x,t.y,t.z)'
  // 智能运镜核心：默认追尾；有活跃 __pvDial（对话运镜未过期）→ 过肩双人构图
  const SMART_ANIM = 'window.__pvChase&&__cs&&(function(){'
    + 'var _P=__cs,_tx=_P.x,_ty=_P.y+1.6,_tz=_P.z,_dx=-Math.sin(_P.yaw),_dz=Math.cos(_P.yaw),'
    + '_D=window.__pvChaseDist,_H=window.__pvChaseH,'
    + '_cx=_tx-_dx*_D,_cy=_ty+_H,_cz=_tz-_dz*_D,_gx=_tx,_gy=_ty,_gz=_tz;'
    + 'var _dl=window.__pvDial;'
    + 'if(_dl){if(Date.now()>_dl.until){window.__pvDial=null}else{'
    + 'var _ax=_dl.x-_tx,_az=_dl.z-_tz,_L=Math.hypot(_ax,_az)||1e-4,_nx=_ax/_L,_nz=_az/_L,_sx=_nz,_sz=-_nx,'
    + '_dd=Math.hypot(_ax,_az);'
    + 'if(_dd<=4.5){_cx=_tx-_nx*1.7+_sx;_cy=_ty+1.75;_cz=_tz-_nz*1.7+_sz;_gx=_tx+_nx*2.6;_gy=_ty+.55;_gz=_tz+_nz*2.6}'
    + 'else if(_dd<=9){_cx=_tx-_nx*3.2+1.5*_sx;_cy=_ty+2.1;_cz=_tz-_nz*3.2+1.5*_sz;_gx=_tx+_nx*3.4;_gy=_ty+.3;_gz=_tz+_nz*3.4}'
    + 'else{_cx=_tx-_nx*4.6;_cy=_ty+2.4;_cz=_tz-_nz*4.6;_gx=_tx+_nx*4.5;_gy=_ty+.2;_gz=_tz+_nz*4.5}}}'
    + 'if(!__cp||Math.hypot(__cp.px-_cx,__cp.py-_cy,__cp.pz-_cz)>8)__cp={px:_cx,py:_cy,pz:_cz,gx:_gx,gy:_gy,gz:_gz};'
    + '__cp.px+=.14*(_cx-__cp.px);__cp.py+=.14*(_cy-__cp.py);__cp.pz+=.14*(_cz-__cp.pz);'
    + '__cp.gx+=.22*(_gx-__cp.gx);__cp.gy+=.22*(_gy-__cp.gy);__cp.gz+=.22*(_gz-__cp.gz);'
    + 'u.camera.position.set(__cp.px,__cp.py,__cp.pz);u.camera.lookAt(__cp.gx,__cp.gy,__cp.gz)})(),'
  const S4N = 'window.requestAnimationFrame(t),h&&h.update(),u.update(),' + SMART_ANIM + 'l.render(u.scene,u.camera)}()'

  if (!s.includes(S1) || !s.includes(S2) || !s.includes(S3) || !s.includes(S4)) {
    console.error('ANCHOR MISS — bundle layout changed, abort (no write)')
    process.exit(1)
  }
  s = s.replace(S1, 'let s=!0,z=null,__cs=null,__cp=null;const l=new THREE.WebGLRenderer')
  s = s.replace(S2, S2N)
  s = s.replace(S3, S3N)
  s = s.replace(S4, S4N)
  if (!fs.existsSync(pub + '.bak-nofollow')) fs.copyFileSync(pub, pub + '.bak-nofollow')
  fs.writeFileSync(pub, s)
  console.log('bundle patched (smart)')
}

// ---------- 2. 源码同步（可读版） ----------
let t = fs.readFileSync(src, 'utf8')
if (t.includes('__pvSmart')) {
  console.log('source already smart-patched, skip')
} else {
  if (t.includes('__pvChase')) {
    if (!fs.existsSync(src + '.bak-nofollow')) {
      console.error('source has v1 chase but .bak-nofollow missing — abort')
      process.exit(1)
    }
    fs.copyFileSync(src + '.bak-nofollow', src)
    t = fs.readFileSync(src, 'utf8')
    console.log('source restored from .bak-nofollow (v1 chase rolled back)')
  }
  t = t.replace(
    'let firstPositionUpdate = true\nlet lastFollowPos = null\ntry { window.__pvNoFollow = new URLSearchParams(location.search).get("follow") === "0" } catch (e) {}',
    `let firstPositionUpdate = true
let lastFollowPos = null
// 智能运镜状态：chasePose=最新目标位姿；chaseCam=平滑后的相机 pos/lookAt；__pvDial=对话运镜 cue（window 上）
let chasePose = null
let chaseCam = null
try {
  window.__pvNoFollow = new URLSearchParams(location.search).get("follow") === "0"
  const q = new URLSearchParams(location.search)
  window.__pvSmart = q.get("follow") === "smart"
  window.__pvChase = window.__pvSmart || q.get("follow") === "chase"
  const d = parseFloat(q.get("cdist")); const g = parseFloat(q.get("chgt"))
  window.__pvChaseDist = (d >= 2 && d <= 12) ? d : 4.2
  window.__pvChaseH = (g >= 0 && g <= 4) ? g : 1.1
} catch (e) {}
// 面板 → viewer 的运镜指令：{type:'pv-cam', cmd:'dialogue', npc:{x,y,z}, ttl}
try {
  window.addEventListener('message', (e) => {
    const d = e && e.data
    if (d && d.type === 'pv-cam' && d.cmd === 'dialogue' && d.npc && window.__pvSmart) {
      window.__pvDial = { x: +d.npc.x || 0, y: +d.npc.y || 0, z: +d.npc.z || 0, until: Date.now() + (d.ttl || 9000) }
    }
  })
} catch (e) {}`)

  t = t.replace(
    `    if (pos.y > 0) {
      if (firstPositionUpdate) {`,
    `    if (pos.y > 0) {
      if (window.__pvChase) {
        // 追尾/智能模式：丢弃 OrbitControls，只记录位姿，相机交给 animate 循环
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
  // 智能运镜：默认追尾；对话 cue 活跃期 → 过肩双人构图（近=特写/中=标准双人/远=长镜），到期回落追尾
  if (window.__pvChase && chasePose) {
    const P = chasePose
    const tx = P.x; const ty = P.y + 1.6; const tz = P.z
    const dx = -Math.sin(P.yaw); const dz = Math.cos(P.yaw) // MC yaw: 0=+Z(南), 90=-X(西)
    let cx = tx - dx * window.__pvChaseDist
    let cy = ty + window.__pvChaseH
    let cz = tz - dz * window.__pvChaseDist
    let gx = tx; let gy = ty; let gz = tz
    const dl = window.__pvDial
    if (dl) {
      if (Date.now() > dl.until) { window.__pvDial = null } else {
        const ax = dl.x - tx; const az = dl.z - tz
        const L = Math.hypot(ax, az) || 1e-4
        const nx = ax / L; const nz = az / L // 玩家→NPC 单位向量
        const sx = nz; const sz = -nx // 侧向（右肩）
        const dd = Math.hypot(ax, az)
        if (dd <= 4.5) { // 特写两景：贴玩家右后肩，看向 NPC
          cx = tx - nx * 1.7 + sx; cy = ty + 1.75; cz = tz - nz * 1.7 + sz
          gx = tx + nx * 2.6; gy = ty + 0.55; gz = tz + nz * 2.6
        } else if (dd <= 9) { // 标准双人：稍远侧后
          cx = tx - nx * 3.2 + 1.5 * sx; cy = ty + 2.1; cz = tz - nz * 3.2 + 1.5 * sz
          gx = tx + nx * 3.4; gy = ty + 0.3; gz = tz + nz * 3.4
        } else { // 长镜：正后全景
          cx = tx - nx * 4.6; cy = ty + 2.4; cz = tz - nz * 4.6
          gx = tx + nx * 4.5; gy = ty + 0.2; gz = tz + nz * 4.5
        }
      }
    }
    if (!chaseCam || Math.hypot(chaseCam.px - cx, chaseCam.py - cy, chaseCam.pz - cz) > 8) {
      chaseCam = { px: cx, py: cy, pz: cz, gx, gy, gz }
    }
    chaseCam.px += 0.14 * (cx - chaseCam.px); chaseCam.py += 0.14 * (cy - chaseCam.py); chaseCam.pz += 0.14 * (cz - chaseCam.pz)
    chaseCam.gx += 0.22 * (gx - chaseCam.gx); chaseCam.gy += 0.22 * (gy - chaseCam.gy); chaseCam.gz += 0.22 * (gz - chaseCam.gz)
    viewer.camera.position.set(chaseCam.px, chaseCam.py, chaseCam.pz)
    viewer.camera.lookAt(chaseCam.gx, chaseCam.gy, chaseCam.gz)
  }
  renderer.render(viewer.scene, viewer.camera)
}`)

  if (!t.includes('__pvSmart')) { console.error('SOURCE PATCH FAILED'); process.exit(1) }
  if (!fs.existsSync(src + '.bak-nofollow')) fs.copyFileSync(src, src + '.bak-nofollow')
  fs.writeFileSync(src, t)
  console.log('source patched (smart)')
}
console.log('DONE')
