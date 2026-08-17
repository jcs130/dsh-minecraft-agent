// 修复 viewer 图集纹理跨 tile 混色（火把显示成红石样污渍）的 patch。
// 根因：浏览器端 loadTexture 用 THREE 默认 LinearMipmapLinearFilter + generateMipmaps，
// 图集无 tile padding，mipmap 缩小窗跨界把邻居 tile 颜色混进来（2px 宽火把面最明显）。
// 修法：index.js 两处（webpack module 3225/2281）改为 Nearest + 禁 mipmap，幂等。
const fs = require('fs');
const path = require('path');

const PUB = path.resolve(__dirname, '..', 'node_modules', 'prismarine-viewer', 'public');
const INDEX = path.join(PUB, 'index.js');

const OLD = 'r[t]||(r[t]=(new n.TextureLoader).load(t)),e(r[t])';
const NEW = 'r[t]||(r[t]=(new n.TextureLoader).load(t),r[t].magFilter=n.NearestFilter,r[t].minFilter=n.NearestFilter,r[t].generateMipmaps=!1),e(r[t])';

let s = fs.readFileSync(INDEX, 'utf8');
if (s.includes(NEW)) {
  console.log('already patched, skip');
} else {
  const count = s.split(OLD).length - 1;
  if (count === 0) {
    console.error('ERROR: pattern not found in index.js — bundle layout changed?');
    process.exit(1);
  }
  s = s.split(OLD).join(NEW);
  fs.writeFileSync(INDEX, s);
  console.log(`patched ${count} occurrence(s) in index.js`);
}
