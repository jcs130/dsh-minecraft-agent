/** Read-only release gate: inspect the actual DSH profile, not an npm dev checkout. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,realpathSync} from 'node:fs';
import {dirname,isAbsolute,join} from 'node:path';
const [profile,...flags]=process.argv.slice(2);
assert.ok(profile&&isAbsolute(profile),'Usage: node scripts/verify-installed-core.mjs <absolute DSH profile> [--require-server-pack]');
assert.ok(flags.every(flag=>flag==='--require-server-pack'),'Unknown verification option');
const local=createRequire(join(realpathSync(profile),'package.json'));
const anchor=local.resolve('@jcs130/dsh-minecraft-agent/package.json'),plugin=createRequire(anchor);
const pkg=JSON.parse(readFileSync(anchor,'utf8'));
const coreAnchor=realpathSync(plugin.resolve('agent-mc-world/package.json'));
const core=JSON.parse(readFileSync(coreAnchor,'utf8'));
assert.equal(core.version,pkg.dependencies['agent-mc-world'],'Installed core differs from the adapter pin');
assert.equal(core.dependencies?.tsx,undefined,'Production core must not require the development loader');
let serverPackVersion=null,sharedPhysicalCore=null;
try{
 const entry=plugin.resolve('agent-mc-qiandengji'),pack=createRequire(entry);
 const manifest=JSON.parse(readFileSync(join(dirname(dirname(entry)),'package.json'),'utf8'));
 assert.equal(manifest.name,'agent-mc-qiandengji');
 assert.equal(realpathSync(pack.resolve('agent-mc-world/package.json')),coreAnchor,'Server pack installs another core');
 serverPackVersion=manifest.version;sharedPhysicalCore=true;
}catch(error){
 if(error.code!=='MODULE_NOT_FOUND'||!error.message.includes("'agent-mc-qiandengji'"))throw error;
 assert.ok(!flags.includes('--require-server-pack'),'Required server pack is missing');
}
console.log(JSON.stringify({adapterVersion:pkg.version,coreVersion:core.version,productionTsxDependency:false,
 serverPackVersion,sharedPhysicalCore,readOnly:true,modelRequests:0,gameConnections:0},null,2));
