// 给 viewer 页面加 ?fov= 参数支持（第一视角广角）。
// 锚点：入口模块 `const u=new r(l);let h=new THREE.OrbitControls(u.camera,l.domElement);`
// 注入：从 URL 读 fov，设置 u.camera.fov + updateProjectionMatrix。幂等。
const fs = require('fs');
const path = require('path');

const PUB = path.resolve(__dirname, '..', 'node_modules', 'prismarine-viewer', 'public');
const INDEX = path.join(PUB, 'index.js');

const OLD = 'const u=new r(l);let h=new THREE.OrbitControls(u.camera,l.domElement);';
const NEW = 'const u=new r(l);try{const FV=parseInt(new URLSearchParams(location.search).get("fov")||"0",10);if(FV>20&&FV<170){u.camera.fov=FV;u.camera.updateProjectionMatrix();}}catch(e){}let h=new THREE.OrbitControls(u.camera,l.domElement);';

let s = fs.readFileSync(INDEX, 'utf8');
if (s.includes(NEW)) {
  console.log('already patched, skip');
} else if (!s.includes(OLD)) {
  console.error('ERROR: pattern not found in index.js');
  process.exit(1);
} else {
  s = s.replace(OLD, NEW);
  fs.writeFileSync(INDEX, s);
  console.log('patched 1 occurrence(s)');
}
