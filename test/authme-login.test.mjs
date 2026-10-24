import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {MinecraftAgentClient,MINECRAFT_CLIENT_DEFAULTS,parseMinecraftServerAddress,nullLogger} from 'agent-mc-world/client';
import {createMinecraftMcpServer} from 'agent-mc-world/mcp';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createQuickSetup} from '../src/quick-setup.mjs';
import {authMeWorld} from './fixtures/authme-world.mjs';
const require=createRequire(import.meta.url);
for(const mode of ['login','session'])test(`first-run password configuration authenticates a real AuthMe-style protocol world (${mode})`,{timeout:30000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'dsh-authme-')),password='local-fixture-password';let runtime,readyBeforeConfirmation=null;
  const world=await authMeWorld(require.resolve('agent-mc-world/package.json'),{password,mode,onCommand:()=>{readyBeforeConfirmation=runtime.status().connection?.ready;}});
  const setup=await createQuickSetup({directory,parseAddress:parseMinecraftServerAddress,
    selection:()=>({provider:'metadata-only',model:'unused'}),modelInfo:async()=>({context:{contextWindow:131072}}),
    launch:config=>{runtime=new MinecraftAgentClient({cfg:{...structuredClone(MINECRAFT_CLIENT_DEFAULTS),...config.minecraft,viewerPort:0},
      dataDir:config.dataDir,agentName:'AuthMeFixture',log:nullLogger()});return{ready:runtime.connect(),dispose:()=>runtime.disconnect()};}});
  try{
    await setup.configure({address:'127.0.0.1:'+world.port,username:'AuthMeFixture',auth:'offline',version:'1.21.1',loginPassword:password,goal:''});
    const end=Date.now()+18000;
    while(!runtime?.status().connection?.ready&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,25));
    assert.equal(runtime?.status().connection?.ready,true,'World must become ready only after an authorization receipt');
    assert.equal(world.summary.joins,1);assert.equal(world.summary.registrationCommands,0);
    if(mode==='login'){assert.equal(readyBeforeConfirmation,false);assert.equal(world.summary.loginCommands,1);assert.equal(world.summary.validCredential,true);assert.equal(world.summary.successSent,true);}
    else{assert.equal(world.summary.loginCommands,0);assert.equal(world.summary.sessionReceiptSent,true);}
    const events=await runtime.events({run:runtime.journal.run,after:0,limit:200,waitMs:0});
    assert.ok(!JSON.stringify({status:runtime.status(),events,setup:setup.snapshot()}).includes(password),'Credentials must stay outside status/events');
    const server=createMinecraftMcpServer(runtime,'authme-fixture'),client=new Client({name:'authme-fixture',version:'1'});
    try{
      const [left,right]=InMemoryTransport.createLinkedPair();await server.connect(left);await client.connect(right);
      assert.ok((await client.listTools()).tools.some(tool=>tool.name==='mc_bag'));
      assert.notEqual((await client.callTool({name:'mc_tool_help',arguments:{name:'mc_bag'}})).isError,true);
    }finally{await client.close();await server.close();}
  }finally{await setup.close();await world.close();await rm(directory,{recursive:true,force:true});}
});
