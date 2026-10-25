import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const require=createRequire(resolve(process.env.DSH_RUNTIME??'.','package.json'));
test('official DSH parser accepts the exact public npm release and metadata',async()=>{
  const {parseMarketIndex,marketInstallTarget}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-plugin-market-index')));
  const raw=JSON.parse(readFileSync(new URL('./index.json',import.meta.url),'utf8'));
  const index=parseMarketIndex(raw,'https://raw.githubusercontent.com/jcs130/dsh-minecraft-agent/main/market/index.json');
  assert.equal(index.plugins.length,1);
  const plugin=index.plugins[0];
  assert.equal(plugin.name,'@jcs130/dsh-minecraft-agent');
  assert.equal(plugin.versions.length,1);
  assert.equal(plugin.versions[0].version,'0.3.0-rc.19');
  assert.deepEqual(marketInstallTarget(plugin.name,plugin.versions[0]),
    {spec:'@jcs130/dsh-minecraft-agent@0.3.0-rc.19',registry:'https://registry.npmjs.org/'});
  assert.ok(Number.isInteger(plugin.versions[0].publishTimestamp));
  assert.match(plugin.icon,/6e283ee2b5abf0974196094e2e1c71f05b738ce2\/assets\/icon\.svg$/);
});
