import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runJoin, qiandengjiAccess, verifyQiandengjiConnection, publicAccessState} from '../src/qiandengji-access.mjs';
import {portalFixture} from './fixtures/portal-api.mjs';

const invite='https://mc.kangqiang.site/join#invite=qdi_'+'i'.repeat(43);
async function fixture(fn) {
  const directory = await fs.mkdtemp(join(tmpdir(),'dsh-join-'));
  const api = portalFixture(), originalFetch = globalThis.fetch;
  globalThis.fetch = api.fetch;
  const configFile=join(directory,'agent.json'),inviteFile=join(directory,'invitation.txt');
  const config={enabled:false,startPaused:true,name:'Existing persona',model:'unchanged-model',provider:'existing-provider',
    personaFile:join(directory,'persona.md'),dataDir:join(directory,'body'),goal:'Existing goal',
    serverPack:'qiandengji',qiandengjiAccess:{directory:join(directory,'access')},minecraft:{viewerPort:17852}};
  await fs.writeFile(configFile,JSON.stringify(config),{mode:0o600});
  await fs.writeFile(inviteFile,invite,{mode:0o600});
  const call=async(action,extra=[])=>{
    const output=[];await runJoin([action,'--config-file',configFile,...extra],line=>output.push(JSON.parse(line)));
    return output[0];
  };
  try { await fn({directory,api,config,configFile,inviteFile,call}); }
  finally {globalThis.fetch=originalFetch;assert.equal(dirname(directory),resolve(tmpdir()));await fs.rm(directory,{recursive:true});}
}

test('prepare, restart and status retain one official identity, password and activation request',()=>fixture(async f=>{
  const pending=await f.call('prepare',['--invite-url-file',f.inviteFile,'--username','ag_Fixture']);
  assert.equal(pending.state,'pending');assert.equal(pending.gameReady,false);assert.equal(pending.gameConnections,0);
  const identityFile=join(f.directory,'access/identity.json'),before=await fs.readFile(identityFile,'utf8');
  await fs.unlink(f.inviteFile);await f.call('prepare');await f.call('status');
  const after=await fs.readFile(identityFile,'utf8');assert.equal(after,before);
  assert.equal(f.api.requests.filter(x=>x.route==='register').length,1);
  assert.equal(f.api.requests.filter(x=>x.route==='activate').length,1);
  const identity=JSON.parse(before),visible=JSON.stringify(pending);
  for(const key of ['gamePassword','clientSecret','token'])assert.ok(!visible.includes(identity[key]));
  assert.ok(!visible.includes('qdi_'));assert.equal(await fs.readFile(f.configFile,'utf8'),JSON.stringify(f.config));
}));

test('unknown activation is reconciled without another submission or new identity',()=>fixture(async f=>{
  f.api.unknownActivation=true;
  await assert.rejects(f.call('prepare',['--invite-url-file',f.inviteFile,'--username','ag_Fixture']),/RESULT_UNKNOWN/);
  await f.call('prepare');await f.call('status');
  assert.equal(f.api.requests.filter(x=>x.route==='activate').length,1);
  assert.equal(f.api.requests.filter(x=>x.route==='register').length,1);
}));

test('bind requires fresh ready AND creation, preserves host choices, stages paused and creates a rollback',()=>fixture(async f=>{
  await f.call('prepare',['--invite-url-file',f.inviteFile,'--username','ag_Fixture']);
  await assert.rejects(f.call('bind'),/GAME_ACCOUNT_NOT_READY/);
  assert.equal(await fs.readFile(f.configFile,'utf8'),JSON.stringify(f.config));
  f.api.ready=true;f.api.createdOverride=false;await assert.rejects(f.call('bind'),/GAME_CONNECTION_MISMATCH/);
  f.api.createdOverride=undefined;const ready=await f.call('bind');
  const bound=JSON.parse(await fs.readFile(f.configFile,'utf8'));
  for(const key of ['enabled','name','model','provider','personaFile','dataDir','goal'])assert.deepEqual(bound[key],f.config[key]);
  assert.equal(bound.startPaused,true);assert.equal(bound.minecraft.viewerPort,17852);
  assert.deepEqual({...bound.minecraft,viewerPort:undefined,loginConfigFile:undefined},
    {host:'micro.kangqiang.site',port:25702,version:'1.21.1',username:'ag_Fixture',auth:'offline',viewerPort:undefined,loginConfigFile:undefined});
  assert.equal(await fs.readFile(ready.backupFile,'utf8'),JSON.stringify(f.config));
  assert.equal(ready.stagedForNextLoad,true);assert.equal(ready.modelRequests,0);
  const login=JSON.parse(await fs.readFile(bound.minecraft.loginConfigFile,'utf8'));
  assert.equal(login.accounts[0].credentialField,'gamePassword');assert.equal(login.accounts[0].credentialFormat,'json');
  const identity=JSON.parse(await fs.readFile(login.accounts[0].credentialFile,'utf8'));
  assert.ok(!(await fs.readFile(f.configFile,'utf8')).includes(identity.gamePassword));
}));

test('existing role or realm cannot be replaced and API ready cannot authorize a mismatched game body',()=>fixture(async f=>{
  await f.call('prepare',['--invite-url-file',f.inviteFile,'--username','ag_Fixture']);f.api.ready=true;
  const access=await qiandengjiAccess(f.config),settings=await access.connectionSettings();
  await verifyQiandengjiConnection(access,settings);
  for(const field of ['host','port','version','username','auth','loginConfigFile'])
    await assert.rejects(verifyQiandengjiConnection(access,{...settings,[field]:'wrong'}),/BINDING_MISMATCH/);
  await fs.writeFile(f.configFile,JSON.stringify({...f.config,minecraft:{...settings,host:'old.invalid'}}),{mode:0o600});
  await assert.rejects(f.call('bind'),/EXISTING_BODY_IDENTITY_CONFLICT/);
  f.api.wrongAddress=true;await assert.rejects(verifyQiandengjiConnection(access,settings),/GAME_CONNECTION_MISMATCH/);
}));

test('continuing an official identity imports it without registration or changing its password',()=>fixture(async f=>{
  await f.call('prepare',['--invite-url-file',f.inviteFile,'--username','ag_Fixture']);f.api.ready=true;
  const identity=join(f.directory,'access/identity.json'),before=await fs.readFile(identity,'utf8');
  const next={...f.config,qiandengjiAccess:{directory:join(f.directory,'continued')}};
  await fs.writeFile(f.configFile,JSON.stringify(next),{mode:0o600});
  assert.equal((await f.call('import',['--identity-file',identity])).username,'ag_Fixture');
  await f.call('bind');assert.equal(await fs.readFile(identity,'utf8'),before);
  assert.equal(f.api.requests.filter(x=>x.route==='register').length,1);
}));

test('separate CLI processes cannot race the same config and an existing lock is retained',()=>fixture(async f=>{
  await fs.writeFile(f.configFile+'.join.lock','existing operation',{mode:0o600});
  await assert.rejects(f.call('prepare',['--invite-url-file',f.inviteFile,'--username','ag_Fixture']),{code:'EEXIST'});
  assert.equal(f.api.requests.length,0);assert.equal(await fs.readFile(f.configFile+'.join.lock','utf8'),'existing operation');
}));

test('metadata is whitelisted and API readiness remains separate from actual authenticated world readiness',()=>{
  const state={username:'ag_Test',state:'ready',identitySaved:true,gameAccountCreated:true,checkedAt:'2026-10-23T00:00:00Z',token:'qda_secret',gamePassword:'secret'};
  assert.equal(publicAccessState(state).gameReady,false);assert.equal(publicAccessState(state,true).gameReady,true);
  assert.deepEqual(Object.keys(publicAccessState(state)),['username','state','identitySaved','gameAccountCreated','checkedAt','gameReady']);
  assert.deepEqual(publicAccessState({...state,state:'qdi_secret',username:'password',checkedAt:'secret'}),
    {...publicAccessState(state),state:'unknown',username:null,checkedAt:null});
});

test('CLI help and malformed arguments expose no credential and start no body, model or website request',()=>{
  const bin=fileURLToPath(new URL('../bin/join-qiandengji.mjs',import.meta.url));
  const help=spawnSync(process.execPath,[bin,'--help'],{encoding:'utf8',timeout:5000,windowsHide:true});
  assert.equal(help.status,0);assert.match(help.stdout,/No game, model/);assert.equal(help.stderr,'');
  const failed=spawnSync(process.execPath,[bin,'prepare','--invite-url',invite],{encoding:'utf8',timeout:5000,windowsHide:true});
  assert.equal(failed.status,1);assert.ok(!(failed.stdout+failed.stderr).includes('qdi_'));assert.ok(!failed.stderr.includes(invite));
});
