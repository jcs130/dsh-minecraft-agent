import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {connectionPreference,panelDescriptor,openHostConsole} from '../src/harness-panel.mjs';

test('operator pause survives restart and invalid persisted state cannot reconnect',()=>{
  const dir = mkdtempSync(join(tmpdir(),'dsh-panel-'));
  try {
    const file = join(dir,'connection.json'), pref = connectionPreference(file);
    assert.equal(pref.paused,false);pref.set(true);
    assert.equal(connectionPreference(file).paused,true);
    pref.set(false);assert.equal(connectionPreference(file,true).paused,false);
    writeFileSync(file,'{}');assert.throws(()=>connectionPreference(file));
  } finally {assert.equal(dirname(dir),resolve(tmpdir()));rmSync(dir,{recursive:true});}
});
test('panel binding refuses unrelated sessions and contains no controls, credentials or prompts',()=>{
  assert.equal(panelDescriptor('owned','other','http://127.0.0.1:17851/').ok,false);
  assert.equal(panelDescriptor('owned','owned').ok,false);
  assert.deepEqual(panelDescriptor('owned','owned','http://127.0.0.1:17851/'),{ok:true,value:{sessionId:'owned',url:'http://127.0.0.1:17851/'}});
});
test('packaged native DSH browser half registers and uses actual session identity',()=>{
  let module, tab;
  vm.runInNewContext(readFileSync(new URL('../lib/client.js',import.meta.url),'utf8'),{
    URL,window:{__ModuleLoader__:{load(value){module=value.factory(name=>name==='react'?{}:{});}}},
  });
  assert.deepEqual([...module.inject],['slots','connection']);
  module.apply({slots:{inject(_name,cb){cb();},register(options,view){tab={options,view};}}});
  assert.equal(tab.options.id,'mc-panel');assert.equal(typeof tab.view,'function');
  assert.equal(module.localPanelUrl('http://127.0.0.1:17851/'),'http://127.0.0.1:17851/');
  for(const url of ['https://remote.test/','javascript:alert(1)','http://user:pass@127.0.0.1:17851/','http://127.0.0.1:17851/?token=secret']) assert.equal(module.localPanelUrl(url),null);
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));
  assert.equal(pkg.exports['./client'],'./lib/client.js');assert.ok(pkg.files.includes('lib/client.js'));
});
test('late DSH Web service binds the real port and authenticates the matching panel channel',async()=>{
  let ready,channel,handler,closed=0;const created=[];
  const ctx={inject(deps,fn){assert.deepEqual(deps,['connection','webServer']);ready=fn;}};
  const panel=await openHostConsole(ctx,async origins=>{created.push([...origins]);return{url:'http://127.0.0.1:17851/',close:async()=>{closed++;}};},'owned');
  assert.deepEqual(created,[[]]);assert.equal(panel.url,'http://127.0.0.1:17851/');
  await ready({webServer:{port:17850},connection:{rpc:{handle(c,h){channel=c;handler=h;}}}});
  assert.deepEqual(created,[[],['http://127.0.0.1:17850']]);assert.equal(closed,1);assert.equal(channel,'/mc-harness');
  assert.equal((await handler('panel',{sessionId:'owned'})).ok,true);
  assert.equal((await handler('panel',{sessionId:'other'})).ok,false);
  await panel.close();await panel.close();assert.equal(closed,2);assert.equal(panel.url,undefined);
});
test('headless console closes normally and a disposed host cannot reopen it on a late service',async()=>{
  let ready,count=0,closed=0,registered=0;
  const panel=await openHostConsole({inject(_deps,fn){ready=fn;}},async()=>{count++;return{url:'http://127.0.0.1:17851/',close:async()=>{closed++;}};},'owned');
  await panel.close();await ready({webServer:{port:17850},connection:{rpc:{handle(){registered++;}}}});
  assert.equal(count,1);assert.equal(closed,1);assert.equal(registered,0);
});
test('native DSH patch composition keeps one configured body and a passive frontend entry',async()=>{
  const req=createRequire(new URL('../package.json',import.meta.url));
  const {loadOverlayPatches}=await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-app-boot')));
  const {applyEntryPatches}=await import(pathToFileURL(req.resolve('@deepseek-ai/cordis-plugin-include')));
  const patches=loadOverlayPatches('offline',fileURLToPath(new URL('../cordis.patch.yml',import.meta.url)));
  const warnings=[];
  const installed=applyEntryPatches([],patches,(...args)=>warnings.push(args));
  assert.equal(installed.filter(row=>row.config?.configFile).length,0);
  const configured=applyEntryPatches([],[...patches,{id:'mc-harness',config:{configFile:'offline-agent.json'}}],(...args)=>warnings.push(args));
  const bodies=configured.filter(row=>row.config?.configFile);
  assert.equal(bodies.length,1);assert.equal(bodies[0].name,'dsh-minecraft-agent/lib/plugins/mc-harness.mjs');
  assert.equal(configured.find(row=>row.id==='mc-frontend').config.configFile,'');
  assert.equal(configured.find(row=>row.id==='mc-frontend').name,'dsh-minecraft-agent');
  assert.deepEqual(warnings,[]);
});
