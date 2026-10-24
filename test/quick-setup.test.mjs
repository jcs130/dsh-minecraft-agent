import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createQuickSetup,attachQuickSetup,setupFields} from '../src/quick-setup.mjs';
const profileRequire=createRequire(resolve(process.env.MC_DSH_PROFILE??process.env.DSH_RUNTIME??'.','package.json'));
const adapterRequire=createRequire(profileRequire.resolve('@jcs130/dsh-minecraft-agent/package.json'));
const {parseMinecraftServerAddress}=await import(pathToFileURL(adapterRequire.resolve('agent-mc-world/client')));

const input={address:'example.test:25565',username:'DemoAgent',auth:'offline',version:'1.21.1',goal:''};
test('first-run defaults to server negotiation and preserves explicit versions including 1.21.11',()=>{
  assert.equal(setupFields({...input,version:undefined},parseMinecraftServerAddress).version,'auto');
  for(const version of ['1.21.1','1.21.11','26.1','auto'])
    assert.equal(setupFields({...input,version},parseMinecraftServerAddress).version,version);
  assert.throws(()=>setupFields({...input,version:'../1.21.1'},parseMinecraftServerAddress),/INVALID_VERSION/);
});
async function fixture(t,overrides={}) {
  const directory=await mkdtemp(join(tmpdir(),'dsh-mc-setup-')),launches=[],models=[];let disposed=0,nextPort=18000;
  const options={directory,parseAddress:parseMinecraftServerAddress,selection:()=>({provider:'existing-dsh',model:'existing-model',reasoningEffort:'high'}),
    modelInfo:async(p,m)=>{models.push([p,m]);return{context:{contextWindow:262144}};},allocatePort:async()=>++nextPort,
    launch:config=>{launches.push(config);return{ready:Promise.resolve(),async dispose(){disposed++;}};},...overrides};
  const setup=await createQuickSetup(options);
  t.after(async()=>{await setup.close();await rm(directory,{recursive:true,force:true});});
  return{setup,options,directory,launches,models,disposed:()=>disposed};
}
async function settled(setup){for(let i=0;i<100&&setup.snapshot().phase==='opening';i++)await new Promise(r=>setTimeout(r,2));return setup.snapshot();}

test('fresh profile setup only reads metadata; install does not create data, a session, game or inference',async t=>{
  const f=await fixture(t);assert.equal(f.setup.snapshot().phase,'unconfigured');f.setup.resume();
  assert.deepEqual(await readdir(f.directory),[]);assert.deepEqual(f.launches,[]);assert.deepEqual(f.models,[]);
  assert.deepEqual(f.setup.snapshot().model,{provider:'existing-dsh',model:'existing-model'});
});

test('generic Mineflayer servers need no password, login commands or server-specific capability pack',async t=>{
  const f=await fixture(t);await f.setup.configure(input);await settled(f.setup);
  const config=f.launches[0];assert.equal(config.serverPack,'none');assert.equal(config.minecraft.auth,'offline');
  assert.equal(config.minecraft.loginConfigFile,undefined);assert.equal(f.setup.snapshot().fields.hasLoginPassword,false);
  assert.deepEqual((await readdir(config.dataDir)).sort(),['connection-state.json','persona.md']);
  await f.setup.stop();await f.setup.configure({...input,auth:'microsoft',username:'microsoft-fixture@example.test'});await settled(f.setup);
  assert.equal(f.launches[1].minecraft.auth,'microsoft');assert.equal(f.launches[1].minecraft.loginConfigFile,undefined);
});
test('first-run input uses the core address parser and rejects command or credential URLs',()=>{
  assert.equal(setupFields({...input,address:'[::1]:25566'},parseMinecraftServerAddress).port,25566);
  for(const bad of [{address:'https://user:password@example.test'}, {username:'other;command'}, {version:'javascript:bad'}, {auth:'auto'}, {loginPassword:'space password'}, {name:42}])
    assert.throws(()=>setupFields({...input,...bad},parseMinecraftServerAddress));
});
test('explicit connect reuses DSH model/effort, true context limit and a stable private account scope',async t=>{
  let port=18000;const f=await fixture(t,{allocatePort:async()=>++port});
  await f.setup.configure({...input,goal:'Find a safe home',loginPassword:'private-fixture-secret'});
  const state=await settled(f.setup);assert.equal(state.phase,'enabled');assert.equal(state.gameReady,false);assert.equal(f.launches.length,1);
  const c=f.launches[0];assert.equal(c.provider,'existing-dsh');assert.equal(c.model,'existing-model');assert.equal(c.reasoningEffort,'high');assert.equal(c.contextTokens,262144);
  assert.notEqual(c.consolePort,c.minecraft.viewerPort);assert.equal(c.minecraft.enabled,true);assert.equal(c.minecraft.version,'1.21.1');assert.equal(c.minecraft.auth,'offline');assert.equal(c.serverPack,'none');
  const saved=await readFile(join(f.directory,'quick-setup.json'),'utf8');assert.ok(!saved.includes('private-fixture-secret'));
  assert.ok(!JSON.stringify(state).includes('private-fixture-secret'));assert.ok(!JSON.stringify(state).includes(f.directory.replaceAll('\\','\\\\')));
  assert.equal(state.fields.hasLoginPassword,true);assert.equal((await readFile(join(c.dataDir,'server-login.password'),'utf8')),'private-fixture-secret');
  await assert.rejects(f.setup.configure(input),/SETUP_BUSY/);assert.equal(f.launches.length,1);
});
test('restart keeps original data/session scope and resolves the then-current DSH route without duplicating credentials',async t=>{
  const f=await fixture(t);await f.setup.configure({...input,loginPassword:'another-secret'});await settled(f.setup);const old=f.launches[0];await f.setup.close();
  const calls=[];const next=await createQuickSetup({...f.options,selection:()=>({provider:'new-default',model:'new-model'}),launch:c=>{calls.push(c);return{ready:Promise.resolve(),async dispose(){}};}});
  t.after(()=>next.close());assert.equal(calls.length,0);next.resume();await settled(next);
  assert.equal(calls.length,1);assert.equal(calls[0].dataDir,old.dataDir);assert.equal(calls[0].provider,'new-default');assert.equal(calls[0].model,'new-model');assert.equal(calls[0].reasoningEffort,undefined);
  assert.equal(next.snapshot().fields.hasLoginPassword,true);assert.ok(!JSON.stringify(next.snapshot()).includes('another-secret'));
});

test('reconfiguration preserves the same identity scope and isolates a different account without inheriting its password',async t=>{
  const f=await fixture(t);await f.setup.configure({...input,loginPassword:'private-scope-secret'});await settled(f.setup);
  const first=f.launches[0];await f.setup.stop();await f.setup.configure(input);await settled(f.setup);
  assert.equal(f.launches[1].dataDir,first.dataDir);assert.equal(f.setup.snapshot().fields.hasLoginPassword,true);
  await f.setup.stop();await f.setup.configure({...input,username:'OtherAgent'});await settled(f.setup);
  assert.notEqual(f.launches[2].dataDir,first.dataDir);assert.equal(f.launches[2].minecraft.loginConfigFile,undefined);
  assert.equal(f.setup.snapshot().fields.hasLoginPassword,false);
});

test('corrupt or mismatched saved setup stays unknown and cannot auto-connect to an unshown identity or path',async t=>{
  const f=await fixture(t);await f.setup.configure(input);await settled(f.setup);await f.setup.close();
  const file=join(f.directory,'quick-setup.json'),saved=JSON.parse(await readFile(file,'utf8'));
  for(const broken of [{...saved,fields:null},{...saved,config:{...saved.config,dataDir:resolve(f.directory,'..')}},
    {...saved,config:{...saved.config,minecraft:{...saved.config.minecraft,username:'DifferentAgent'}}}]){
    await writeFile(file,JSON.stringify(broken));const before=f.launches.length;
    const restored=await createQuickSetup(f.options);t.after(()=>restored.close());restored.resume();
    assert.equal(restored.snapshot().phase,'failed');assert.equal(restored.snapshot().fields,null);assert.equal(f.launches.length,before);
    assert.equal(await readFile(file,'utf8'),JSON.stringify(broken));
  }
});
test('missing DSH model refuses to persist/launch and a startup failure is sanitized, finite and explicitly retryable',async t=>{
  const missing=await fixture(t,{selection:()=>undefined});await assert.rejects(missing.setup.configure(input),/DSH.*模型/);assert.equal(missing.launches.length,0);assert.deepEqual(await readdir(missing.directory),[]);
  let attempts=0;const bad=await fixture(t,{launch:()=>{attempts++;throw Error('Authorization: Bearer private-fixture-secret');}});
  await bad.setup.configure(input);const state=await settled(bad.setup);assert.equal(state.phase,'failed');assert.ok(!state.error.includes('private-fixture-secret'));
  await new Promise(r=>setTimeout(r,15));assert.equal(attempts,1);bad.setup.retry();await settled(bad.setup);assert.equal(attempts,2);
});
test('closing pending metadata preparation prevents a late launch',async t=>{
  let resolveInfo;const info=new Promise(r=>{resolveInfo=r;});const f=await fixture(t,{modelInfo:()=>info});await f.setup.configure(input);
  await new Promise(r=>setImmediate(r));const closed=f.setup.close();resolveInfo({context:{contextWindow:32768}});await closed;assert.equal(f.launches.length,0);
});
test('explicit stop cancels a pending startup, persists disabled intent and keeps the account data for reconfiguration',async t=>{
  let resolveInfo;const info=new Promise(r=>{resolveInfo=r;});const f=await fixture(t,{modelInfo:()=>info});await f.setup.configure(input);
  await new Promise(r=>setImmediate(r));await f.setup.stop();assert.equal(f.setup.snapshot().phase,'configured');assert.equal(f.launches.length,0);
  assert.equal(JSON.parse(await readFile(join(f.directory,'quick-setup.json'),'utf8')).config.enabled,false);
  f.setup.resume();assert.equal(f.setup.snapshot().phase,'configured');resolveInfo({context:{contextWindow:32768}});
});
test('setup Fetch API inherits native DSH owner authorization and only explicitly configured actions write/start',async t=>{
  const req=createRequire(resolve(process.env.DSH_RUNTIME??'.','package.json'));
  const{Context}=await import(pathToFileURL(req.resolve('@deepseek-ai/cordis')));
  const{HostConnectionService}=await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-client-connection')));
  const f=await fixture(t),root=new Context();
  const web=await root.plugin({name:'fixture-web',apply(ctx){ctx.provide('webServer',{port:17850});}}).await();
  const connection=await root.plugin({name:'fixture-connection',apply(ctx){new HostConnectionService(ctx,[],{isAuthenticated:()=>true});}}).await();
  let fiber;const effects=[];
  attachQuickSetup({inject:(deps,fn)=>(fiber=root.inject(deps,fn)),effect(fn){effects.push(fn());}},f.setup);await fiber.await();
  const handler=root.get('connection').createSharedFetchHandler('/api'),owner={principal:{kind:'owner'}};
  const request=(action,config)=>new Request('http://localhost/api/mc-harness/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'fixture-setup',method:'mc-harness/setup',payload:{action,config}})});
  try{
    assert.equal((await handler.fetch(request('configure',input),{principal:{kind:'delegate'}})).status,403);assert.equal(f.launches.length,0);
    for(let i=0;i<3;i++)assert.equal((await(await handler.fetch(request('state'),owner)).json()).result.value.phase,'unconfigured');assert.equal(f.launches.length,0);
    assert.equal((await handler.fetch(request('execute'),owner)).status,400);
    assert.equal((await(await handler.fetch(request('configure',input),owner)).json()).result.ok,true);await settled(f.setup);assert.equal(f.launches.length,1);
    for(const close of effects)await close();assert.equal((await handler.fetch(request('state'),owner)).status,410);
    await fiber.dispose();assert.equal((await handler.fetch(request('state'),owner)).status,404);
  }finally{await f.setup.close();await fiber.dispose();await connection.dispose();await web.dispose();}
});
