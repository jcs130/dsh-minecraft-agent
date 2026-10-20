import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const require=createRequire(resolve(process.env.DSH_RUNTIME??'.','package.json'));
test('official DSH parser accepts the public index and generates the exact released Git install target',async()=>{
  const {parseMarketIndex,marketInstallTarget}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-plugin-market-index')));
  const raw=JSON.parse(readFileSync(new URL('./index.json',import.meta.url),'utf8'));
  const index=parseMarketIndex(raw,'https://raw.githubusercontent.com/jcs130/dsh-minecraft-agent/main/market/index.json');
  assert.equal(index.plugins[0].name,'@jcs130/dsh-minecraft-agent');assert.equal(index.plugins[0].title.zh,'我的世界 Agent');
  const target=marketInstallTarget(index.plugins[0].name,index.plugins[0].versions[0]);
  assert.equal(target.spec,'git+https://github.com/jcs130/dsh-minecraft-agent.git#06afaacbafd6db695008c5938f43a93786789426');
});
