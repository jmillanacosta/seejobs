import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_FILTERS,filterJobs,queueRows,moveIndex,stateOf,statusColor,seconds,bytes,sampleMetrics,appendSample,projectSummary,projectOf,rowWindow,queueColumns,runtimeSummary} from '../src/model.js';
import {parseBatch,buildBatch,validateBatch} from '../src/batch.js';
import {validateConfig} from '../src/config.js';
import {footerFor} from '../src/help.js';
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
test('projects use full paths and all filters apply within the selected project',()=>{
  const jobs=[{id:'1',name:'train',user:'alice',state:'RUNNING',workdir:'/a',script:'/a/train.sh'},{id:'2',user:'alice',state:'FAILED',workdir:'/b',script:'/b/train.sh'}];
  assert.equal(projectSummary(jobs).length,2);assert.equal(projectSummary(jobs,'script').length,2);
  assert.equal(projectOf(jobs[0]),'/a');assert.equal(projectOf(jobs[0],'script'),'/a/train.sh');
  assert.deepEqual(filterJobs(jobs,{...DEFAULT_FILTERS,project:'/b'},'alice').map(j=>j.id),['2']);
});
test('wrapped queue rows fit and keep the selected row visible at either end',()=>{
  const rows=Array.from({length:50},(_,i)=>({key:String(i),height:i%3+1}));
  for(let i=0;i<rows.length;i++){const v=rowWindow(rows,i,8,r=>r.height);assert(v.items.includes(rows[i]));assert(v.lines<=8);}
  for(const w of [76,96,116,146,220]){const c=queueColumns(w);assert(c.reduce((n,v)=>n+v[2]+1,2)<=w);assert(c.find(c=>c[0]==='name')[2]<=24);assert(c.some(c=>c[0]==='submitted'));}
});
test('metrics avoid duplicated job CPU totals and reset deltas when step membership changes',()=>{
  const job={id:'4',cpus:'4',elapsed:'00:01:00',limit:'00:02:00'};
  const s=runtimeSummary(job,{steps:[{id:'4',cpu:'00:02:00',elapsed:'00:01:00',cpus:'4'},{id:'4.batch',cpu:'00:02:00',rss:'1G'},{id:'4.extern',cpu:'00:02:00',rss:'99G'}]});
  assert.equal(s.efficiency,50);assert.equal(s.peak,1024**3);assert.equal(s.timePercent,50);
  let points=appendSample([],{time:10,cpuSeconds:10,rss:1,signature:'batch'});
  points=appendSample(points,{time:20,cpuSeconds:30,rss:1,signature:'batch'});assert.equal(points.at(-1).cores,2);
  assert.equal(appendSample(points,{...points.at(-1),time:21}).length,2);
  points=appendSample(points,{time:30,cpuSeconds:60,rss:1,signature:'batch+step'});assert.equal(points.length,1);assert.equal(points[0].cores,null);
});
test('default refresh is one second and settings reject invalid intervals',()=>{
  const c={sshHost:'local',remoteUser:'alice',historyDays:7};
  assert.equal(validateConfig(c).refreshSeconds,1);assert.equal(validateConfig({...c,refreshSeconds:'3'}).refreshSeconds,3);
  for(const value of [0,-1,301,'abc'])assert.throws(()=>validateConfig({...c,refreshSeconds:value}),/Refresh/);
});
test('footers match the active action and global pages do not suggest cancellation',()=>{
  assert.match(footerFor({panel:'d'}).join(' '),/projects/);
  assert.doesNotMatch(footerFor({panel:'d'}).join(' '),/C cancel/);
  assert.match(footerFor({panel:'l',full:true}).join(' '),/chunks/);
  assert.doesNotMatch(footerFor({modal:{kind:'edit'}}).join(' '),/Reload|cancel.*job/);
  assert.match(footerFor({draft:{},preview:true,validated:false}).join(' '),/Enter check/);
  assert.match(footerFor({draft:{},preview:true,validated:true}).join(' '),/Enter submit/);
});
