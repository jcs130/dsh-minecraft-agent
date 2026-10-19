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
  await ready({webServer:{port:17850},connection:{fetch:{register(route){channel=route.path;handler=route.fetch;}}}});
  assert.deepEqual(created,[[],['http://127.0.0.1:17850']]);assert.equal(closed,1);assert.equal(channel,'/api/mc-harness/panel');
  const request=id=>new Request('http://localhost/api/mc-harness/panel',{method:'POST',body:JSON.stringify({type:'client-request',rpcId:'fixture-rpc',method:'mc-harness/panel',payload:{sessionId:id}})});
  assert.equal((await(await handler(request('owned'))).json()).result.ok,true);
  assert.equal((await(await handler(request('other'))).json()).result.ok,false);
  await panel.close();await panel.close();assert.equal(closed,2);assert.equal(panel.url,undefined);
});
test('headless console closes normally and a disposed host cannot reopen it on a late service',async()=>{
  let ready,count=0,closed=0,registered=0;
  const panel=await openHostConsole({inject(_deps,fn){ready=fn;}},async()=>{count++;return{url:'http://127.0.0.1:17851/',close:async()=>{closed++;}};},'owned');
  await panel.close();await ready({webServer:{port:17850},connection:{fetch:{register(){registered++;}}}});
  assert.equal(count,1);assert.equal(closed,1);assert.equal(registered,0);
});
test('native separated service providers register and dispose the authenticated exact route',async()=>{
  const req=createRequire(resolve(process.env.DSH_RUNTIME??'.','package.json'));
  const {Context}=await import(pathToFileURL(req.resolve('@deepseek-ai/cordis')));
  const {HostConnectionService}=await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-client-connection')));
  const root=new Context();
  const web=await root.plugin({name:'fixture-web',apply(ctx){ctx.provide('webServer',{port:17850});}}).await();
  const connection=await root.plugin({name:'fixture-connection',apply(ctx){new HostConnectionService(ctx,[],{isAuthenticated:()=>true});}}).await();
  let fiber;const panel=await openHostConsole({inject:(deps,fn)=>(fiber=root.inject(deps,fn))},async()=>({url:'http://127.0.0.1:17851/',close:async()=>{}}),'owned');
  try{
    await fiber.await();
    const handler=root.get('connection').createSharedFetchHandler('/api');
    const make=()=>new Request('http://localhost/api/mc-harness/panel',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'native-rpc',method:'mc-harness/panel',payload:{sessionId:'owned'}})});
    const owner={principal:{kind:'owner'}};
    assert.equal((await(await handler.fetch(make(),owner)).json()).result.value.sessionId,'owned');
    if(req('@deepseek-ai/dsh/package.json').version==='0.2.1-rc.2')
      assert.equal((await handler.fetch(make(),{principal:{kind:'delegate'}})).status,403);
    await panel.close();await fiber.dispose();
    assert.equal((await handler.fetch(make(),owner)).status,404);
  }finally{await panel.close();await fiber.dispose();await connection.dispose();await web.dispose();}
});
test('native DSH patch composition keeps one configured body and a passive frontend entry',async()=>{
  const req=createRequire(resolve(process.env.DSH_RUNTIME??'.','package.json'));
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
