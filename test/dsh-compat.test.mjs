import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,cpSync,rmSync,existsSync,readdirSync,linkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {repairDshResolver} from '../src/dsh-compat.mjs';

const require=createRequire(import.meta.url);
const published=dirname(require.resolve('@deepseek-ai/dsh-app-boot/package.json'));
const entries=['lib/index.js','lib/worker/profile-resolution-bootstrap.js'];
function fixture(t){
  const dir=mkdtempSync(join(tmpdir(),'dsh-resolver-repair-'));
  t.after(()=>{assert.equal(dirname(dir),resolve(tmpdir()));assert.match(dir.split(/[\\/]/).at(-1),/^dsh-resolver-repair-/);rmSync(dir,{recursive:true,force:true});});
  const modules=join(dir,'node_modules/@deepseek-ai'),dshRoot=join(modules,'dsh'),boot=join(modules,'dsh-app-boot');
  mkdirSync(dshRoot,{recursive:true});mkdirSync(boot,{recursive:true});
  writeFileSync(join(dshRoot,'package.json'),JSON.stringify({name:'@deepseek-ai/dsh',version:'0.2.1-rc.2'}));
  writeFileSync(join(boot,'package.json'),JSON.stringify({name:'@deepseek-ai/dsh-app-boot',version:'0.2.1-rc.2'}));
  for(const file of entries){mkdirSync(dirname(join(boot,file)),{recursive:true});cpSync(join(published,file),join(boot,file));}
  return {dir,dshRoot,boot,paths:entries.map(file=>join(boot,file))};
}
test('DSH repair check reads exact published files without writing',t=>{
  const f=fixture(t),before=f.paths.map(path=>readFileSync(path));
  const report=repairDshResolver({dshRoot:f.dshRoot});
  assert.equal(report.status,'repair-required');assert.equal(report.restarted,false);
  assert.deepEqual(f.paths.map(path=>readFileSync(path)),before);
  assert.equal(existsSync(join(f.boot,'.agent-mc-resolver-repair.lock')),false);
  assert.equal(readdirSync(join(f.boot,'lib')).some(name=>name.includes('agent-mc')),false);
});
test('explicit repair covers main and worker, is idempotent and rolls back exact bytes',t=>{
  const f=fixture(t),before=f.paths.map(path=>readFileSync(path));
  assert.equal(repairDshResolver({dshRoot:f.dshRoot,action:'apply'}).status,'repaired');
  const fixed=f.paths.map(path=>readFileSync(path));
  for(const bytes of fixed){assert.equal(bytes.toString().split('createRequire(parent).resolve.paths(request)').length-1,2);}
  assert.equal(repairDshResolver({dshRoot:f.dshRoot,action:'apply'}).status,'repaired');
  assert.deepEqual(f.paths.map(path=>readFileSync(path)),fixed);
  assert.equal(repairDshResolver({dshRoot:f.dshRoot,action:'rollback'}).status,'restored');
  assert.deepEqual(f.paths.map(path=>readFileSync(path)),before);
});
test('one unknown file refuses the whole repair before any mutation',t=>{
  const f=fixture(t),before=readFileSync(f.paths[0]);writeFileSync(f.paths[1],'unknown custom resolver');
  assert.throws(()=>repairDshResolver({dshRoot:f.dshRoot,action:'apply'}),/Unrecognized DSH bytes/);
  assert.deepEqual(readFileSync(f.paths[0]),before);assert.equal(readFileSync(f.paths[1],'utf8'),'unknown custom resolver');
});
test('repair replaces its directory entry without modifying a shared store hardlink',t=>{
  const f=fixture(t),mirror=join(f.dir,'store-original.js'),before=readFileSync(f.paths[0]);linkSync(f.paths[0],mirror);
  repairDshResolver({dshRoot:f.dshRoot,action:'apply'});
  assert.deepEqual(readFileSync(mirror),before);assert.notDeepEqual(readFileSync(f.paths[0]),before);
});
test('another repair lock is retained and prevents writes',t=>{
  const f=fixture(t),path=join(f.boot,'.agent-mc-resolver-repair.lock'),before=readFileSync(f.paths[0]);writeFileSync(path,'other owner');
  assert.throws(()=>repairDshResolver({dshRoot:f.dshRoot,action:'apply'}),{code:'EEXIST'});
  assert.deepEqual(readFileSync(f.paths[0]),before);assert.equal(readFileSync(path,'utf8'),'other owner');
});
test('a corrupted backup prevents rollback without replacing current files',t=>{
  const f=fixture(t);repairDshResolver({dshRoot:f.dshRoot,action:'apply'});
  const fixed=f.paths.map(path=>readFileSync(path)),backup=readdirSync(join(f.boot,'lib')).find(name=>name.includes('.agent-mc-original-'));
  writeFileSync(join(f.boot,'lib',backup),'wrong backup');
  assert.throws(()=>repairDshResolver({dshRoot:f.dshRoot,action:'rollback'}),/Backup mismatch/);
  assert.deepEqual(f.paths.map(path=>readFileSync(path)),fixed);
});
test('doctor help and a missing explicit target cannot change an installation',()=>{
  const command=fileURLToPath(new URL('../bin/repair-dsh.mjs',import.meta.url));
  const help=spawnSync(process.execPath,[command,'--help'],{encoding:'utf8',timeout:5000,windowsHide:true});
  assert.equal(help.status,0);assert.match(help.stdout,/Default: read-only check/);
  const missing=spawnSync(process.execPath,[command,'--apply'],{encoding:'utf8',timeout:5000,windowsHide:true});
  assert.equal(missing.status,1);assert.match(missing.stderr,/Specify --dsh-root/);
});
