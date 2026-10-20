import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const require=createRequire(resolve(process.env.DSH_RUNTIME??'.','package.json'));
test('official DSH parser accepts the withheld index without advertising a blocked install target',async()=>{
  const {parseMarketIndex,marketInstallTarget}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-plugin-market-index')));
  const raw=JSON.parse(readFileSync(new URL('./index.json',import.meta.url),'utf8'));
  const index=parseMarketIndex(raw,'https://raw.githubusercontent.com/jcs130/dsh-minecraft-agent/main/market/index.json');
  assert.deepEqual(index.plugins,[]);assert.match(index.description.en,/registry-only/);
});
