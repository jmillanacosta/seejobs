import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_FILTERS,filterJobs,queueRows,moveIndex,stateOf,statusColor,seconds,bytes,sampleMetrics} from '../src/model.js';
import {parseBatch,buildBatch,validateBatch} from '../src/batch.js';
test('Slurm state, durations and memory units are normalized semantically',()=>{
  assert.equal(stateOf('["PENDING"]'),'PENDING');assert.equal(statusColor(['PENDING']),'yellow');assert.equal(statusColor('COMPLETED'),'green');
  assert.equal(seconds('1-02:03:04.5'),93784.5);assert.equal(bytes('1.5G'),1.5*1024**3);assert.equal(bytes('2048K'),2*1024**2);assert.equal(bytes(''),null);
});
test('global filters include other users and GPU allocations',()=>{
  const jobs=[{id:'1',user:'alice',state:'RUNNING',partition:'cpu',gres:''},{id:'2',user:'bob',state:'PENDING',partition:'gpu',gres:'gres/gpu=1'}];
  assert.equal(filterJobs(jobs,DEFAULT_FILTERS,'alice').length,1);
  const all={...DEFAULT_FILTERS,scope:'all'};assert.equal(filterJobs(jobs,all,'alice').length,2);
  assert.deepEqual(filterJobs(jobs,{...all,scope:'user',username:'bob',gpu:'GPU requested'},'alice').map(j=>j.id),['2']);
});
test('folded groups and paging operate on displayed rows',()=>{
  const jobs=[{id:'1',script:'/a/run.sh'},{id:'2',script:'/a/run.sh'},{id:'3',script:'/b/run.sh'}];
  const rows=queueRows(jobs,true,new Set(['/a/run.sh']));
  assert.equal(rows.length,3);assert.equal(rows[2].job.id,'3');assert.equal(moveIndex(0,3,{end:true}),2);
  assert.equal(moveIndex(2,3,{pageUp:true},10),0);
});
test('header edits support short options, whitespace, duplicate directives, additions and unchanged body',()=>{
  const script='#!/bin/bash\n#SBATCH -J "my job" -p cpu\n#SBATCH --time 01:00:00\n#SBATCH -t02:00:00\n#SBATCH --export=ALL\n\necho "hello"\n#SBATCH --time=ignored-in-body\n';
  const parsed=parseBatch(script);assert.equal(parsed.values['job-name'],'my job');
  assert.equal(parsed.values.time,'02:00:00');
  const changed=buildBatch(parsed,{time:'03:00:00',partition:'gpu',mem:'16G'});
  assert.match(changed,/#SBATCH --time=03:00:00/);assert.match(changed,/#SBATCH --mem=16G/);
  assert.doesNotMatch(changed,/-t02|--time 01/);
  assert.ok(changed.endsWith('echo "hello"\n#SBATCH --time=ignored-in-body\n'));
  assert.match(changed,/--export=ALL/);assert.equal(buildBatch(parsed,{}),script);
  assert.equal(validateBatch(parsed,{mem:'1G','mem-per-cpu':'2G'},{}).length,1);
});
test('measured CPU and memory aggregate tasks without counting extern twice',()=>{
  const s=sampleMetrics({time:10,steps:[{id:'1.batch',tasks:'2',cpu:'00:00:04',rss:'1G',tres:'gres/gpuutil=42'},{id:'1.extern',tasks:'2',cpu:'00:00:04',rss:'1G'}]});
  assert.equal(s.cpuSeconds,8);assert.equal(s.rss,2*1024**3);assert.equal(s.gpu,42);
});
