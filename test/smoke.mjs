import assert from 'node:assert/strict';
import {request} from '../src/client.js';
import {loadConfig} from '../src/config.js';
import {parseBatch,buildBatch} from '../src/batch.js';
const c=loadConfig(),host=process.env.SEEJOBS_TEST_HOST||c.sshHost,user=process.env.SEEJOBS_TEST_USER||c.remoteUser;
const mine=await request(host,{op:'list',days:7,user});
const all=await request(host,{op:'list',days:7,user:''});
assert(all.jobs.length>=mine.jobs.length);
assert(all.jobs.every(j=>typeof j.state==='string'&&!j.state.startsWith('[')&&!j.cpus?.startsWith('{')));
const caps=await request(host,{op:'capabilities'});assert(caps.partitions.length>0);
assert(mine.jobs.every(j=>typeof j.submitted==='string'));
const resources=await request(host,{op:'resources',user});assert(Array.isArray(resources.shares));assert(Array.isArray(resources.reservations));
const pending=all.jobs.find(j=>j.state==='PENDING');
if(pending){const schedule=await request(host,{op:'scheduling',job:pending});assert(Array.isArray(schedule.estimate));assert(Array.isArray(schedule.priority));}
console.log(JSON.stringify({accountAssociations:caps.accounts.length,qosLevels:caps.qos.length,fairShareRows:resources.shares.length,reservations:resources.reservations.length}));
const own=mine.jobs.filter(j=>j.script).sort((a,b)=>Number(b.id)-Number(a.id))[0];
if(own){
  const d=await request(host,{op:'detail',job:own});assert(Array.isArray(d.logs));
  const recovered=await request(host,{op:'script',job:own});
  const parsed=parseBatch(recovered.script),changed=buildBatch(parsed,{time:'00:10:00'});
  assert(changed.includes('#SBATCH --time=00:10:00'));
  console.log('PASS: recovered script, header editing, log discovery');
}
console.log(JSON.stringify({ownJobs:mine.jobs.length,visibleJobs:all.jobs.length,users:new Set(all.jobs.map(j=>j.user)).size,partitions:caps.partitions.length,accountingSeconds:caps.sampleSeconds}));
for(const job of mine.jobs.filter(j=>j.source==='accounting'&&j.script).slice(0,4)){
  const d=await request(host,{op:'detail',job});
  console.log(JSON.stringify({job:job.id,logs:d.logs.length,readable:d.logs.filter(l=>!l.text.startsWith('[Errno')).length,sources:d.logs.map(l=>l.source)}));
}
assert.equal(mine.warnings.length,0);
