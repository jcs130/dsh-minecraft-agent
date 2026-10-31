import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativeSessionHistory} from '../src/harness-bridge.mjs';

function fixture({onFlush=async()=>{},onOpen=async()=>{},onRead}={}){
  const calls=[],session={id:'persistent-session'},signal=new AbortController().signal;
  const value={eventState:'shared-frozen',events:[{seq:938,type:'user/message',data:{original:'complete synthetic record'}}]};
  const log={async read(offset,limit,options){calls.push(['read',offset,limit,options]);return onRead?onRead(value):value;},async close(){calls.push(['close']);}};
  const ctx={sessions:{async flush(current){assert.equal(current,session);calls.push(['flush']);await onFlush();}},
    sessionPersistence:{async open(...args){calls.push(['open',...args]);await onOpen(...args);return log;}}};
  return {ctx,calls,session,signal,value};
}

test('history keeps native complete results and offsets, flushes before open, and owns its read handle',async()=>{
  const f=fixture({onRead:async value=>value});
  assert.equal(await nativeSessionHistory(f.ctx,f.session,{offset:938,limit:3},f.signal),f.value);
  assert.deepEqual(f.calls,[['flush'],['open','persistent-session','read',{signal:f.signal}],['read',938,3,{signal:f.signal}],['close']]);
});

test('history retains the existing default and upper bound without rewriting native records',async()=>{
  for(const [input,wanted] of [[{},5],[{limit:null},5],[{limit:40},20]]){
    const f=fixture({onRead:async value=>value});await nativeSessionHistory(f.ctx,f.session,{offset:0,...input},f.signal);
    assert.equal(f.calls.find(x=>x[0]==='read')[2],wanted);
  }
});

test('already cancelled history performs no flush or storage work',async()=>{
  const f=fixture(),abort=new AbortController();abort.abort(new Error('cancelled-before-flush'));
  await assert.rejects(nativeSessionHistory(f.ctx,f.session,{offset:0},abort.signal),/cancelled-before-flush/);
  assert.deepEqual(f.calls,[]);
});

test('cancellation during flush prevents a cold open; cancellation during open reaches the native provider',async()=>{
  const abort=new AbortController(),f=fixture({onFlush:async()=>abort.abort(new Error('cancelled-in-flush'))});
  await assert.rejects(nativeSessionHistory(f.ctx,f.session,{offset:0},abort.signal),/cancelled-in-flush/);
  assert.deepEqual(f.calls,[['flush']]);
  const opening=new AbortController(),g=fixture({onOpen:async(_id,_mode,options)=>{opening.abort(new Error('cancelled-in-open'));options.signal.throwIfAborted();}});
  await assert.rejects(nativeSessionHistory(g.ctx,g.session,{offset:0},opening.signal),/cancelled-in-open/);
  assert.equal(g.calls.filter(x=>x[0]==='read'||x[0]==='close').length,0);
});

test('failed or cancelled native range reads still close their owned handle exactly once',async()=>{
  const f=fixture({onRead:async()=>{throw new Error('read-cancelled');}});
  await assert.rejects(nativeSessionHistory(f.ctx,f.session,{offset:938},f.signal),/read-cancelled/);
  assert.equal(f.calls.filter(x=>x[0]==='close').length,1);
});
