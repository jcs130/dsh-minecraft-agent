// 监听网络请求再截一次，确认页面 fetch 的是 1.21.11 资源
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true });
  const pg = await b.newPage({ viewport: { width: 960, height: 540 } });
  const reqs = [];
  pg.on('request', r => { if (/blocksStates|textures\/1\./.test(r.url())) reqs.push(r.url().split('/').slice(-1)[0] + ' ' + (r.response ? '' : '')); });
  pg.on('response', r => { if (/blocksStates|textures\/1\./.test(r.url())) reqs.push(r.status() + ' ' + r.url().split('/').pop()); });
  await pg.goto('http://127.0.0.1:3101/', { waitUntil: 'load', timeout: 15000 });
  await pg.waitForTimeout(9000);
  await pg.screenshot({ path: 'shot_first2.png' });
  console.log('asset requests:\n' + reqs.join('\n'));
  await b.close();
})();
