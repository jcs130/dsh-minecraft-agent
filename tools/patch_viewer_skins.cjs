// 给 viewer 3D 里的玩家/bot 换皮肤：
//   A. module 8773（entities）：其他玩家实体按 entity.username 匹配 /skins/<name>.png
//   B. 入口模块：own player mesh（第三人称自己）从 URL ?skin=<name> 读参数
// 皮肤来自观察面板 :9090 的 /skins/ 路由（需 CORS，面板侧已加）。
// 幂等：已 patch 则跳过。
const fs = require('fs');
const path = require('path');

const PUB = path.resolve(__dirname, '..', 'node_modules', 'prismarine-viewer', 'public');
const INDEX = path.join(PUB, 'index.js');
let s = fs.readFileSync(INDEX, 'utf8');
let n = 0;

const A_OLD = 'if(t.name)try{const i=new a("1.16.4",t.name,e);if(void 0!==t.username){';
const A_NEW = 'if(t.name)try{const i=new a("1.16.4",t.name,e);if(i&&i.mesh&&t.username){const SK="http://"+location.hostname+":9090/skins/"+t.username.toLowerCase()+".png";(new n.TextureLoader).setCrossOrigin("anonymous").load(SK,function(tx){tx.magFilter=n.NearestFilter,tx.minFilter=n.NearestFilter,tx.flipY=false,tx.wrapS=n.RepeatWrapping,tx.wrapT=n.RepeatWrapping,i.mesh.traverse(function(m){m.isSkinnedMesh&&m.material&&(m.material.map=tx,m.material.needsUpdate=true)})})}if(void 0!==t.username){';

const B_OLD = 'e=new a("1.16.4","player",u.scene).mesh,u.scene.add(e)';
const B_NEW = 'e=new a("1.16.4","player",u.scene).mesh,u.scene.add(e),function(){const q=new URLSearchParams(location.search).get("skin");if(!q)return;const SK="http://"+location.hostname+":9090/skins/"+q+".png";(new THREE.TextureLoader).setCrossOrigin("anonymous").load(SK,function(tx){tx.magFilter=THREE.NearestFilter,tx.minFilter=THREE.NearestFilter,tx.flipY=false,tx.wrapS=THREE.RepeatWrapping,tx.wrapT=THREE.RepeatWrapping,e.traverse(function(m){m.isSkinnedMesh&&m.material&&(m.material.map=tx,m.material.needsUpdate=true)})})}()';

if (!s.includes(A_NEW)) {
  if (!s.includes(A_OLD)) { console.error('ERROR: pattern A not found'); process.exit(1); }
  s = s.replace(A_OLD, A_NEW); n++;
}
if (!s.includes(B_NEW)) {
  if (!s.includes(B_OLD)) { console.error('ERROR: pattern B not found'); process.exit(1); }
  s = s.replace(B_OLD, B_NEW); n++;
}
if (n > 0) {
  fs.writeFileSync(INDEX, s);
  console.log(`patched ${n} occurrence(s)`);
} else {
  console.log('already patched, skip');
}
