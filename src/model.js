import {active, clean} from './client.js';

export const GLOBAL_PANELS = [['s','Slurm'],['d','Dashboard'],['h','History'],['n','Nodes'],[',','Settings'],['?','Help']];
export const JOB_PANELS = [['o','Overview'],['l','Logs'],['m','Metrics']];
export const PANELS = [...GLOBAL_PANELS,...JOB_PANELS];
export const DEFAULT_FILTERS = {scope:'mine', username:'', partition:'All', status:'All', gpu:'All', query:'',project:''};
export function stateOf(value) {
  if (Array.isArray(value)) return value[0] || 'UNKNOWN';
  const text = String(value || 'UNKNOWN');
  if (text.startsWith('[')) {try {return stateOf(JSON.parse(text));} catch {}}
  return text.split(' by ')[0].replace(/\+$/, '');
}
export function statusColor(value) {
  const state = stateOf(value);
  if (state === 'PENDING') return 'yellow';
  if (['RUNNING','COMPLETED','COMPLETING'].includes(state)) return 'green';
  if (/FAILED|TIMEOUT|OUT_OF_MEMORY|NODE_FAIL|CANCELLED|PREEMPTED|BOOT_FAIL|DEADLINE/.test(state)) return 'red';
  return 'gray';
}
export function filterJobs(jobs, filters, mine, projectMode='directory') {
  return jobs.filter(j =>
    (filters.scope !== 'mine' || j.user === mine) &&
    (filters.scope !== 'user' || j.user === filters.username) &&
    (filters.partition === 'All' || j.partition === filters.partition) &&
    (filters.status === 'All' || (filters.status === 'Active' ? active(j) : stateOf(j.state) === filters.status)) &&
    (filters.gpu === 'All' || (filters.gpu === 'GPU requested') === /gpu/i.test(j.gres || j.tres || '')) &&
    (!filters.project || projectOf(j,projectMode)===filters.project) &&
    Object.values(j).join(' ').toLowerCase().includes(filters.query.toLowerCase())
  ).sort((a,b)=>Number(active(b))-Number(active(a)) || Number.parseInt(b.id)-Number.parseInt(a.id) || a.id.localeCompare(b.id));
}
export function projectOf(job, mode='directory') {
  if(mode==='script')return job.script||'(script not recorded)';
  return job.workdir||job.script?.replace(/\/[^/]+$/,'')||'(directory not recorded)';
}
export function projectSummary(jobs,mode='directory') {
  const groups=new Map();
  for(const j of jobs){const key=projectOf(j,mode);if(!groups.has(key))groups.set(key,{key,jobs:[],running:0,pending:0,completed:0,failed:0});const p=groups.get(key);p.jobs.push(j);if(j.state==='RUNNING')p.running++;else if(j.state==='PENDING')p.pending++;else if(j.state==='COMPLETED')p.completed++;else if(/FAILED|TIMEOUT|MEMORY|NODE_FAIL|CANCELLED|PREEMPTED/.test(j.state))p.failed++;}
  return [...groups.values()].sort((a,b)=>(b.running+b.pending)-(a.running+a.pending)||b.failed-a.failed||a.key.localeCompare(b.key));
}
export function pendingAdvice(reason='') {
  if(/DependencyNeverSatisfied/.test(reason))return 'A required job failed. Check the dependency before you submit a replacement.';
  if(/Dependency/.test(reason))return 'Waiting for another job. Open Overview to check the required job IDs.';
  if(/Held/.test(reason))return 'This job is held. Ask the owner or administrator to release the hold.';
  if(/QOS|Assoc|Account/.test(reason))return 'An account or quality-of-service limit is blocking this job. Check the live limits in the editor.';
  if(/Partition|ReqNodeNotAvail|Reservation/.test(reason))return 'Required capacity is unavailable or reserved. Check Nodes and reservations.';
  if(/Priority/.test(reason))return 'Other jobs have higher priority. The start estimate can change.';
  if(/Resources/.test(reason))return 'Waiting for free resources. Review the CPU, memory, GPU and time requests.';
  return 'Open Overview to inspect the scheduler reason and job requirements.';
}
export function dateLabel(value) {return value&&!/Unknown|N\/A|None/.test(value)?value.replace('T',' ').slice(0,16):'—';}
export function runtimeSummary(job,detail) {
  const steps=detail?.steps||[],root=steps.find(s=>s.id===job.id);
  const taskSteps=steps.filter(s=>s.id!==job.id&&!s.id.endsWith('.extern'));
  const cpu=seconds(root?.cpu)>0?seconds(root.cpu):taskSteps.length&&taskSteps.every(s=>seconds(s.cpu)!=null)?taskSteps.reduce((n,s)=>n+seconds(s.cpu),0):null;
  const elapsed=seconds(root?.elapsed||job.elapsed),cpus=Number(root?.cpus||job.cpus);
  const efficiency=cpu!=null&&cpu>0&&elapsed>0&&cpus>0?100*cpu/(elapsed*cpus):null;
  const peaks=taskSteps.map(s=>bytes(s.rss)).filter(v=>v>0);
  const limit=seconds(job.limit);
  return {cpu,efficiency,elapsed,cpus,peak:peaks.length?Math.max(...peaks):null,steps:taskSteps,
    timePercent:limit>0&&elapsed!=null?100*elapsed/limit:null,remaining:limit>0&&elapsed!=null?Math.max(0,limit-elapsed):null};
}
export function queueColumns(width) {
  // Name is deliberately bounded. Use the remaining width for useful metadata.
  const cols=[['id','JOB ID',10],['name','NAME',width<110?16:24],['state','STATE',width<110?10:14],['submitted','SUBMITTED',16]];
  const extras=[['user','USER',18],['partition','PARTITION',10],['cpus','CPU',4],['gres','GRES',12],['elapsed','TIME',10],['nodes','NODES',12],['reason','REASON',28],['account','ACCOUNT',12],['qos','QOS',10],['limit','TIME LIMIT',10]];
  let used=cols.reduce((n,c)=>n+c[2]+1,2);
  for(const c of extras)if(used+c[2]+1<=width){cols.push(c);used+=c[2]+1;}
  return cols;
}
export function rowWindow(rows,index,capacity,heightOf) {
  if(!rows.length)return {start:0,items:[],lines:0};
  const heights=rows.map(r=>Math.min(capacity,Math.max(1,heightOf(r))));
  let start=index,used=heights[index]||1;
  while(start>0&&used+heights[start-1]<=Math.ceil(capacity/2)){start--;used+=heights[start];}
  let end=start,lines=0;
  while(end<rows.length&&lines+heights[end]<=capacity){lines+=heights[end];end++;}
  while(start>0&&lines+heights[start-1]<=capacity){start--;lines+=heights[start];}
  return {start,items:rows.slice(start,end),lines,heights:heights.slice(start,end)};
}
export function queueRows(jobs, grouped, folded) {
  if (!grouped) return jobs.map(job=>({key:job.id, job}));
  const groups = new Map();
  for (const job of jobs) {
    const path=job.script || '(script path unavailable)';
    if (!groups.has(path)) groups.set(path, []);
    groups.get(path).push(job);
  }
  return [...groups].flatMap(([path,items])=>[
    {key:'group:'+path, path, label:path.split('/').at(-1), count:items.length},
    ...(folded.has(path)?[]:items.map(job=>({key:job.id,job,path})))
  ]);
}
export function moveIndex(index, length, key, page=10) {
  if (!length) return 0;
  if (key.home) return 0;
  if (key.end) return length-1;
  return Math.max(0,Math.min(length-1,index+(key.pageDown?page:key.pageUp?-page:key.downArrow?1:key.upArrow?-1:0)));
}
export function seconds(value) {
  if (typeof value === 'number') return value;
  const s=String(value||''); if (!/^([0-9]+-)?[0-9]+(:[0-9]+){0,2}(\.[0-9]+)?$/.test(s)) return null;
  const [day,clock]=s.includes('-')?s.split('-'):['0',s];
  return Number(day)*86400+clock.split(':').reduce((n,v)=>n*60+Number(v),0);
}
export function bytes(value) {
  const match=String(value??'').match(/^([0-9.]+)([KMGTPE]?)(?:i?B)?[cn]?$/i);
  return match?Number(match[1])*1024**Math.max(0,' KMGTPE'.indexOf(match[2].toUpperCase())):null;
}
export const formatBytes=value=>value==null?'unavailable':value>=1024**3?(value/1024**3).toFixed(2)+' GiB':(value/1024**2).toFixed(1)+' MiB';
export function sampleMetrics(packet) {
  const steps=packet.steps.filter(s=>!s.id.endsWith('.extern'));
  const sums={cpu:0,rss:0}; let validCPU=false,validRSS=false; const gpu=[];
  for (const s of steps) {
    const count=Number(s.tasks); const cpu=seconds(s.cpu), rss=bytes(s.rss);
    if (count>0&&cpu!=null){sums.cpu+=cpu*count; validCPU=true;}
    if (count>0&&rss!=null){sums.rss+=rss*count;validRSS=true;}
    const tres=Object.fromEntries((s.tres||'').split(',').map(t=>t.split('=')));
    if (tres['gres/gpuutil']!==undefined&&Number.isFinite(Number(tres['gres/gpuutil']))) gpu.push(Number(tres['gres/gpuutil']));
  }
  return {time:packet.time,cpuSeconds:validCPU?sums.cpu:null,rss:validRSS?sums.rss:null,gpu:gpu.length?Math.max(...gpu):null,signature:steps.map(s=>s.id+':'+s.tasks).sort().join('|')};
}
export function appendSample(history, point) {
  // Repeated reads of Slurm's cached counters are not new measurements.
  if(history.at(-1)?.signature!==point.signature)history=[];
  const last=history.at(-1);
  if(last && ['cpuSeconds','rss','gpu'].every(k=>last[k]===point[k]))return history;
  let changed=last;
  for(let i=history.length-2;i>=0&&history[i].cpuSeconds===last?.cpuSeconds;i--)changed=history[i];
  const cores=changed&&point.cpuSeconds!=null&&changed.cpuSeconds!=null&&point.cpuSeconds>changed.cpuSeconds&&point.time>changed.time?
    (point.cpuSeconds-changed.cpuSeconds)/(point.time-changed.time):last?.cpuSeconds===point.cpuSeconds?last?.cores??null:null;
  return [...history,{...point,cores}].slice(-240);
}
export function plot(points, field, width=60, height=5, ceiling=null) {
  const visible=points.slice(-width), values=visible.map(p=>p[field]).filter(v=>v!=null && Number.isFinite(v));
  if (!values.length) return {lines:['No measured samples available'],max:null,start:null,end:null};
  const max=Math.max(ceiling||0,...values,0.01);
  const cells=Array.from({length:height},()=>Array(width).fill(' '));
  const span=(visible.at(-1)?.time||0)-(visible[0]?.time||0);
  visible.forEach((p,i)=>{if(p[field]==null)return;const x=span?Math.round((p.time-visible[0].time)/span*(width-1)):width-1; const y=Math.min(height-1,Math.max(0,Math.round((1-p[field]/max)*(height-1))));cells[y][x]='●';for(let row=y+1;row<height;row++)cells[row][x]='░';});
  return {lines:cells.map((row,i)=>(max*(1-i/(height-1))).toFixed(max>=10?0:1).padStart(6)+' │'+row.join('')),max,start:visible[0]?.time,end:visible.at(-1)?.time};
}
export const safeText=clean;
