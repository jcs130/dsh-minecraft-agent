import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MinecraftAgentClient, MINECRAFT_CLIENT_DEFAULTS, nullLogger, withToolHelp } from 'agent-mc-world/client';
import { HarnessBridge, modelToolSchema } from '../src/harness-bridge.mjs';
import { createMinecraftMcpServer } from 'agent-mc-world/mcp';
import { nativeMcpOutcomeDecision } from '../src/native-mcp-outcome.mjs';

test('SDK/MCP and the DSH bridge preserve explicit action dependencies and a no-effect turn conclusion', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-no-effect-consumer-'));
  let received;
  const schema = { type:'object', required:['steps'], properties:{ steps:{ type:'array', items:{
    type:'object', required:['skill'], properties:{ skill:{type:'string'}, needs:{type:'array',items:{type:'integer',minimum:1}},
      expect:{type:'object'}, text:{type:'string'} } } } } };
  const originalTask = 7;
  const world = { id:'offline-no-effect-contract', envPromptVars:()=>({}), async start(){}, async stop(){},
    tools:()=>withToolHelp([{name:'mc_do',tags:['act'],description:'Inert refusal contract',parameters:schema,
      handler:async args=>{ received=structuredClone(args); return {text:'fixture refusal',failed:true,endsTurn:true,
        data:{status:'blocked',reason:'task.no-observed-effect',goal_completed:false,
          next_safe_read:{tool:'mc_queue',arguments:{taskId:originalTask,detail:true}}},
        meta:{admission:{accepted:false,kind:'repeat',rule:'task.no-observed-effect'}}}; }}], 'mc_tool_help') };
  const runtime = new MinecraftAgentClient({cfg:{...structuredClone(MINECRAFT_CLIENT_DEFAULTS),enabled:false,
    host:'offline.invalid',username:'NoEffectConsumer'},dataDir:dir,log:nullLogger()},world);
  const server=createMinecraftMcpServer(runtime,'no-effect-consumer'), client=new Client({name:'contract',version:'1'});
  const [left,right]=InMemoryTransport.createLinkedPair(), bridge=new HarnessBridge(runtime,client);
  const args={steps:[{skill:'pickup',expect:{count:2}},{skill:'chat',text:'synthetic report',needs:[1]},
    {skill:'chat',text:'synthetic independent help',needs:[]}]};
  try {
    await runtime.connect(); await server.connect(left); await client.connect(right); await bridge.enter('original-session',1,0);
    const tool=(await client.listTools()).tools.find(t=>t.name==='mc_do');
    const model=modelToolSchema(tool.inputSchema);
    assert.deepEqual(model.properties.steps.items.properties.needs, schema.properties.steps.items.properties.needs);
    let concluded=0;
    const result=await bridge.call('mc_do',args,{id:'new-selection-only',concludeTurn(){concluded++;}});
    assert.equal(concluded,1,'A refusal ends this decision turn through the native execution contract');
    assert.deepEqual(received,args,'The adapter must not drop, infer, or rewrite needs/expect');
    assert.equal(result.structuredContent.control.endTurnRequested,true);
    assert.equal(result.structuredContent.failed,true);
    assert.equal(result.structuredContent.execution,null,'A pre-dispatch refusal invents no execution');
    assert.equal(result.structuredContent.data.goal_completed,false);
    assert.equal(result.structuredContent.data.next_safe_read.arguments.taskId,originalTask);
    const decision=await nativeMcpOutcomeDecision({}, {value:result}, async()=>({kind:'accept',concludesTurn:true}));
    assert.equal(decision.kind,'accept'); assert.equal(decision.concludesTurn,true);
    assert.ok(decision.content.some(c=>c.text?.includes('FAILED')));
  } finally {
    await bridge.ended('original-session',1); await bridge.stop(); await client.close(); await server.close();
    assert.equal(dirname(dir),resolve(tmpdir())); await rm(dir,{recursive:true,force:true});
  }
});
