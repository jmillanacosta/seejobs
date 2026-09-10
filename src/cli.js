#!/usr/bin/env node
import React, {useState, useEffect, useRef} from 'react';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {basename} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {render, Box, Text, useInput, useApp, useStdout} from 'ink';
import wrapAnsi from 'wrap-ansi';
import {request, clean, active, failed, diagnosis} from './client.js';
const h = React.createElement;
const args = process.argv.slice(2);
const option = (name, fallback) => {const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1];};
const configPath = process.env.SEEJOBS_CONFIG || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'seejobs', 'config.json');
const defaults = {sshHost: '', remoteUser: '', historyDays: 7, displayName: ''};
function loadConfig() {try {return {...defaults, ...JSON.parse(readFileSync(configPath, 'utf8'))};} catch {return {...defaults};}}
async function configure() {
  const rl = createInterface({input: process.stdin, output: process.stdout}); const c = loadConfig();
  try {
    c.displayName = (await rl.question(`Name/label [${c.displayName}]: `)).trim() || c.displayName;
    c.sshHost = (await rl.question(`SSH host or alias [${c.sshHost || 'cluster.example'}]: `)).trim() || c.sshHost;
    c.remoteUser = (await rl.question(`Slurm username to monitor [${c.remoteUser || 'your-username'}]: `)).trim() || c.remoteUser;
    const d = (await rl.question(`History days [${c.historyDays}]: `)).trim(); if (d) c.historyDays = Number(d);
    if (!c.sshHost || !c.remoteUser || !/^[\w.@-]+$/.test(c.sshHost) || !/^[\w.@-]+$/.test(c.remoteUser) || !Number.isInteger(c.historyDays) || c.historyDays < 1 || c.historyDays > 365) throw new Error('Invalid host, username, or history days');
    mkdirSync(join(configPath, '..'), {recursive: true, mode: 0o700}); writeFileSync(configPath, JSON.stringify(c, null, 2) + '\n', {mode: 0o600}); console.log(`Saved ${configPath}`);
  } finally {rl.close();}
}
if (args.includes('--config') || (!existsSync(configPath) && process.stdin.isTTY)) {await configure(); if (args.includes('--config')) process.exit(0);}
const config = loadConfig();
const host = option('--host', process.env.SEEJOBS_HOST || config.sshHost);
const user = option('--user', process.env.SEEJOBS_USER || config.remoteUser);
const days = Number(option('--days', String(config.historyDays)));
if (!host || !user || host.startsWith('-') || !/^[\w.@-]+$/.test(host) || !/^[\w.@-]+$/.test(user) || !Number.isInteger(days) || days < 1 || days > 365) {
  console.error(`Run seejobs --config first. Config file: ${configPath}`); process.exit(1);
}
if (args.includes('--help')) {
  console.log(`seejobs — Slurm dashboard over SSH\n\ncluster seejobs [--config]\nseejobs --config          first-run or edit local identity settings\nseejobs --once             JSON snapshot, without a terminal\n\n↑/↓ or j/k jobs   Tab focus pane   1 overview   2 logs   3 nodes   4 history\n/ search   a all/active/failed   r refresh   p pause   q quit\nLogs: ←/→ choose file   s split stdout/stderr   f full file / live tail\nPgUp/PgDn scroll   g top   G bottom   [/] previous/next full-file chunk\nQueue refreshes every 15s; active job metrics every 0.5s.\n`); process.exit(0);
}
if (args.includes('--once')) {
  try {console.log(JSON.stringify(await request(host, {op:'list', days, user}), null, 2));} catch(e) {console.error(e.message); process.exitCode = 1;}
} else if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('Open a terminal to use seejobs, or pass --once for JSON.'); process.exitCode = 1;
} else {
  process.stdout.write('\x1b[?1049h');
  const restore = () => process.stdout.write('\x1b[?1049l');
  process.once('exit', restore);
  const app = render(h(App), {exitOnCtrlC: true});
  await app.waitUntilExit();
}
function App() {
  const {exit} = useApp(); const {stdout} = useStdout();
  const [size, setSize] = useState([stdout.columns || 100, stdout.rows || 30]);
  const [data, setData] = useState({jobs:[], nodes:[], warnings:[]});
  const [id, setId] = useState(''); const [detail, setDetail] = useState(null);
  const [error, setError] = useState(''); const [detailError, setDetailError] = useState('');
  const [updated, setUpdated] = useState('');
  const [tick, setTick] = useState(0); const [view, setView] = useState(1); const [focus, setFocus] = useState(false);
  const [filter, setFilter] = useState(0); const [query, setQuery] = useState(''); const [search, setSearch] = useState(false); const [queueView, setQueueView] = useState(true); const [filterPanel, setFilterPanel] = useState(false); const [filterMode, setFilterMode] = useState(0); const [partition, setPartition] = useState('All'); const [userFilter, setUserFilter] = useState('My jobs'); const [statusFilter, setStatusFilter] = useState('All'); const [gpuFilter, setGpuFilter] = useState('All');
  const [logIndex, setLogIndex] = useState(0); const [split, setSplit] = useState(true); const [scroll, setScroll] = useState(0);
  const [full, setFull] = useState(false); const [offset, setOffset] = useState(0); const [page, setPage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState(''); const [pendingAction, setPendingAction] = useState('');
  const [draft, setDraft] = useState(null); const [editInput, setEditInput] = useState(null);
  const [perfHistory, setPerfHistory] = useState([]);
  const [now, setNow] = useState(new Date());
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
  const maxScroll=useRef(0);
  const partitions=['All',...new Set(data.jobs.map(j=>j.partition).filter(Boolean))]; const users=['My jobs',...new Set(data.jobs.map(j=>j.user).filter(Boolean))]; const statuses=['All','RUNNING','PENDING','COMPLETED','FAILED','CANCELLED']; const gpus=['All','GPU requested','CPU only'];
  const jobs = data.jobs.filter(j => (!filter || (filter === 1 ? active(j) : failed(j))) && (partition==='All'||j.partition===partition) && (userFilter==='My jobs'||j.user===userFilter) && (statusFilter==='All'||j.state.includes(statusFilter)) && (gpuFilter==='All'||(gpuFilter==='GPU requested'?/gpu/i.test(j.gres||''):! /gpu/i.test(j.gres||''))) && `${j.id} ${j.name} ${j.user||''} ${j.state} ${j.partition||''} ${j.nodes||''} ${j.cpus||''} ${j.gres||''}`.toLowerCase().includes(query.toLowerCase())).sort((a,b) => Number(active(b))-Number(active(a)) || Number(b.id.split('_')[0])-Number(a.id.split('_')[0]) || b.id.localeCompare(a.id));
  const queueJobs = jobs;
  const selected = jobs.find(j => j.id === id) || jobs[0];
  const selectedId = selected?.id;
  const jobRef = useRef(selected); jobRef.current = selected;
  useEffect(() => {const fn = () => setSize([stdout.columns || 100, stdout.rows || 30]); stdout.on('resize', fn); return () => stdout.off('resize', fn);}, [stdout]);
  useEffect(() => {const t=setInterval(()=>setNow(new Date()),1000); return ()=>clearInterval(t);}, []);
  useEffect(() => {
    const c = new AbortController(); let busy = false;
    const load = async () => {if(busy) return; busy = true; setLoading(true); try {const d = await request(host,{op:'list',days,user},c.signal); if(!c.signal.aborted) {setData(d);setError('');setUpdated(new Date().toLocaleTimeString());}} catch(e) {if(!c.signal.aborted)setError(clean(e.message));} finally {busy=false; if(!c.signal.aborted)setLoading(false);}};
    load(); const timer = setInterval(load,15000);
    return () => {clearInterval(timer); c.abort();};
  }, [tick]);
  useEffect(() => {setDetail(null);setDetailError('');setLogIndex(0);setScroll(view===2?1000000:0);setFull(false);setOffset(0);setPage(null);}, [selectedId]);
  useEffect(() => {
    if(!selectedId) return;
    const c = new AbortController(); let busy = false;
    const load = async () => {if(busy) return; busy=true; try {const d=await request(host,{op:'detail',job:jobRef.current},c.signal);if(!c.signal.aborted){setDetail(d);setDetailError(''); const rss=(d.steps||[]).reduce((n,s)=>Math.max(n,Number.parseInt(s.rss)||0),0); const cpu=(d.steps||[]).reduce((n,s)=>n+Number.parseFloat(s.cpu)||n,0); setPerfHistory(h=>[...h,{rss,cpu}].slice(-48));}}catch(e){if(!c.signal.aborted)setDetailError(clean(e.message));}finally{busy=false;}};
    load(); const timer=setInterval(load,active(jobRef.current)?500:5000); return()=>{clearInterval(timer);c.abort();};
  }, [selectedId,tick]);
  const logs = detail?.logs || []; const log = logs[logIndex] || logs[0];
  useEffect(() => {
    if(!full || !log) {setPage(null);return;}
    const c=new AbortController();setPage(null);
    request(host,{op:'log',job:jobRef.current,path:log.path,offset},c.signal).then(d=>{if(!c.signal.aborted){setPage(d);setScroll(0);}}).catch(e=>{if(!c.signal.aborted)setDetailError(clean(e.message));});
    return()=>c.abort();
  },[full,offset,log?.path,selectedId,tick]);
  const width=size[0], height=size[1]; const body=Math.max(6,height-8); const pageHeight=Math.max(2,body-7);
  useInput((input,key)=>{
    if (filterPanel) { if (key.escape||key.return) {setFilterPanel(false); return;} if (key.upArrow||key.downArrow) {setFilterMode(m=>Math.max(0,Math.min(3,m+(key.downArrow?1:-1)))); return;} if (key.leftArrow||key.rightArrow||input==='['||input===']') {const dir=key.leftArrow||input==='['?-1:1; const next=(a,v)=>a[(Math.max(0,a.indexOf(v))+dir+a.length)%a.length]; if(filterMode===0)setPartition(next(partitions,partition)); else if(filterMode===1)setUserFilter(next(users,userFilter)); else if(filterMode===2)setStatusFilter(next(statuses,statusFilter)); else setGpuFilter(next(gpus,gpuFilter)); return;} }
    if (editInput !== null && draft) { if (key.return) { const m=editInput.match(/^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+)$/); if (m) setDraft(d=>({...d,overrides:{...d.overrides,[m[1]]:m[2]}})); else setActionMessage('Use HEADER=value, for example TimeLimit=01:00:00'); setEditInput(null); } else if (key.escape) setEditInput(null); else if (key.backspace||key.delete) setEditInput(v=>v.slice(0,-1)); else if (!key.ctrl&&!key.meta) setEditInput(v=>v+input); return; }
    if(search){if(key.return||key.escape)setSearch(false);else if(key.backspace||key.delete)setQuery(q=>q.slice(0,-1));else if(!key.ctrl&&!key.meta)setQuery(q=>q+input);return;}
    if(input==='q')exit();
    else if(key.return&&queueView){setQueueView(false);setView(1);}
    else if(input==='c'&&selected){if(pendingAction==='cancel'){setPendingAction('');request(host,{op:'cancel',job:selected}).then(d=>setActionMessage(d.result)).catch(e=>setActionMessage(clean(e.message)));}else{setPendingAction('cancel');setActionMessage(`Press c again to cancel #${selected.id}`);}}
    else if(input==='R'&&selected){setActionMessage('Fetching batch script…');request(host,{op:'script',job:selected}).then(d=>{setDraft({script:d.script,overrides:{}});setActionMessage('Draft ready: e edits a header, S submits, Esc discards.');}).catch(e=>setActionMessage(clean(e.message)));}
    else if(input==='e'&&draft){setEditInput('');setActionMessage('Type HEADER=value then Enter (Esc cancels)');}
    else if(input==='S'&&draft){const script=draft.script.replace(/^#SBATCH\s+--([A-Za-z][\w-]*)(?:=(.*))?$/gm,(line,key)=>draft.overrides[key.replaceAll('-','_')]===undefined?line:`#SBATCH --${key}=${draft.overrides[key.replaceAll('-','_')]}`);setActionMessage('Submitting rerun…');request(host,{op:'submit',script}).then(d=>{setDraft(null);setActionMessage(d.result);setTick(t=>t+1);}).catch(e=>setActionMessage(clean(e.message)));}
    else if(key.escape&&draft){setDraft(null);setActionMessage('Rerun draft discarded.');}
    else if(input==='/')setSplit(true);
    else if(input==='k')setSearch(true);
    else if(input==='a'){setFilterPanel(true);setFilterMode(2);setId('');}
    else if(input==='r')setTick(t=>t+1);
    else if(input==='f')setFilterPanel(true);
    else if(key.tab)setFocus(f=>!f);
    else if(input==='o'||input==='O'){setView(1);setQueueView(false);} else if(input==='l'||input==='L'){setView(2);setQueueView(false);} else if(input==='n'||input==='N'){setView(3);setQueueView(false);} else if(input==='h'||input==='H'){setView(4);setQueueView(false);} else if(input==='m'||input==='M'){setView(5);setQueueView(false);} else if(input==='S'){setQueueView(true);setView(1);setScroll(0);}
    else if(input==='v'){setFull(f=>!f);setOffset(0);setScroll(0);setView(2);setFocus(true);}
    else if(key.leftArrow||key.rightArrow){setLogIndex(i=>Math.max(0,Math.min(logs.length-1,i+(key.rightArrow?1:-1))));setOffset(0);setScroll(0);}
    else if(input===']'&&full&&page&&page.next<page.size)setOffset(page.next);
    else if(input==='['&&full)setOffset(o=>Math.max(0,o-48000));
    else if(key.pageDown)setScroll(s=>Math.min(maxScroll.current,Math.min(s,maxScroll.current)+pageHeight));
    else if(key.pageUp)setScroll(s=>Math.max(0,Math.min(s,maxScroll.current)-pageHeight));
    else if(input==='g')setScroll(0);
    else if(input==='G'||key.end)setScroll(1000000);
    else if(key.home)setScroll(0);
    else if(input==='g'&&queueView&&selected){const group=basename(selected.script||'unknown script');setCollapsedGroups(s=>{const n=new Set(s);n.has(group)?n.delete(group):n.add(group);return n;});}
    else if(key.upArrow||key.downArrow||input==='j'||input==='k'){
      const delta=key.downArrow||input==='j'?1:-1;
      if(focus)setScroll(s=>Math.max(0,Math.min(maxScroll.current,Math.min(s,maxScroll.current)+delta)));
      else {const list=queueView?queueJobs:jobs; const i=list.findIndex(j=>j.id===selectedId);setId(list[Math.max(0,Math.min(list.length-1,i+delta))]?.id||'');}
    }
  });
  const color=j=>failed(j)?'red':j.state==='PENDING'?'yellow':j.state==='RUNNING'||j.state==='COMPLETED'?'green':'gray';
  const sval=v=>String(v??'');
  let elementKey=0;
  const line=(s,props={})=>h(Text,{key:`auto-${elementKey++}`,...props},clean(s));
  const pane=(title,content,w)=>h(Box,{key:`auto-${elementKey++}`,flexDirection:'column',borderStyle:'round',borderColor:focus?'cyan':'gray',width:w,minWidth:0,flexGrow:w?0:1,flexShrink:1,paddingX:1,overflow:'hidden'},line(title,{bold:true,color:'cyan',wrap:'truncate'}),content);
  maxScroll.current=0;
  const displayLines=(text,available=pageHeight,columns=width-Math.min(36,Math.floor(width*.3))-4)=>{
    const lines=wrapAnsi(clean(text).replaceAll('\t','    '),Math.max(8,columns),{hard:true,trim:false}).split('\n'); const start=Math.min(scroll,Math.max(0,lines.length-available)); maxScroll.current=Math.max(maxScroll.current,lines.length-available);
    return [line(`${start+1}–${Math.min(lines.length,start+available)} / ${lines.length} lines`,{dimColor:true}),...lines.slice(start,start+available).map((l,i)=>line(l||' ',{key:i,wrap:'truncate',color:/error|exception|failed|traceback/i.test(l)?'red':/^CPU|CPU HISTORY/.test(l)?'cyan':/^RSS|RSS HISTORY/.test(l)?'yellow':/█/.test(l)?'green':undefined}))];
  };
  let right;
  if(filterPanel){
    const rows=[['Partition',partition],['User scope',userFilter],['Status',statusFilter],['GPU use',gpuFilter]];
    const fl=rows.map(([k,v],i)=>`${i===filterMode?'›':' '} ${k.padEnd(14)} ${v}`); right=pane('FILTERS · ↑↓ FIELD · ←→ VALUE',displayLines([...fl,'','Enter/Esc close · k search · S queue'].join('\n'),body-4));
  }else if(queueView){
    const shown=queueJobs.slice(Math.max(0,queueJobs.findIndex(j=>j.id===selectedId)-Math.floor((body-8)/2)),Math.max(0,queueJobs.findIndex(j=>j.id===selectedId)-Math.floor((body-8)/2))+body-8); const rows=[h(Text,{key:'qh',color:'cyan',bold:true},'JOB ID       USER                 STATE       TIME       PARTITION  NODE(S)     CPU  GRES / SCRIPT'),...shown.map(j=>h(Text,{key:`qr-${sval(j.id)}`,color:color(j),inverse:j.id===selectedId,wrap:'truncate'},`${j.id===selectedId?'›':' '} ${sval(j.id).padEnd(11)} ${sval(j.user||user).padEnd(20)} ${sval(j.state).padEnd(11)} ${sval(j.elapsed||'—').padEnd(10)} ${sval(j.partition||'—').padEnd(10)} ${sval(j.nodes||'—').padEnd(11)} ${sval(j.cpus||'—').padEnd(4)} ${sval(j.gres||basename(sval(j.script)||'—'))}`)),line('','dimColor'),line('↑↓ navigate rows  Enter opens  c cancel  g fold script group  f filters',{dimColor:true})];
    right=pane('SQUEUE · LIVE + ACCOUNTING HISTORY',h(Box,{flexDirection:'column'},...rows));
  }else if(view===3){
    const lines=data.nodes.flatMap(n=>[`${n.name}  ${n.state.toUpperCase()}`,`CPUs allocated/idle/other/total: ${n.cpus}`,`RAM ${(Number(n.memory)/1024).toFixed(0)} GiB  •  ${n.reason}`, '']);
    right=pane('CLUSTER HEALTH · drain / down reasons',displayLines(lines.join('\n'),body-4));
  }else if(view===4){
    const done=data.jobs.filter(j=>!active(j));const bad=done.filter(failed);
    const lines=[`${days} days · ${done.length} finished · ${bad.length} unsuccessful`,`${done.length?Math.round((done.length-bad.length)/done.length*100):0}% completed successfully`,'','JOB        STATE              ELAPSED     CPUS  REQUESTED RAM',...jobs.map(j=>`${j.id.padEnd(10)} ${j.state.padEnd(18)} ${j.elapsed.padEnd(11)} ${(j.cpus||'—').padEnd(5)} ${j.memory||'—'}`),'','Select a job and press 1 for measured RSS and CPU time.'];
    right=pane('PAST PERFORMANCE',displayLines(lines.join('\n'),body-4));
  }else if(view===5){
    const steps=detail?.steps||[]; const rss=steps.map(s=>Number.parseInt(s.rss)||0); const max=Math.max(1,...rss);
    const spark=(key,maxValue)=>{const glyph='▁▂▃▄▅▆▇█';const vals=perfHistory.map(p=>p[key]||0);return vals.length?vals.map(v=>glyph[Math.min(7,Math.round((v/Math.max(1,maxValue))*7))]).join(''):'—';};
    const lines=[`${selected?selected.name:'Select a job'} · live accounting view`,'','CPU HISTORY  '+spark('cpu',Math.max(1,...perfHistory.map(p=>p.cpu||0))),`RSS HISTORY  ${spark('rss',Math.max(1,...perfHistory.map(p=>p.rss||0)))}`,'','RESOURCE PROFILE',...steps.map((s,i)=>`${s.id}  CPU ${s.cpu||'—'}  elapsed ${s.elapsed||'—'}  RSS ${s.rss||'—'}`),'','PEAK RSS'];
    if(rss.length) lines.push(...rss.map((v,i)=>`${steps[i].id.padEnd(12)} ${'█'.repeat(Math.max(1,Math.round(v/max*24)))} ${steps[i].rss||'—'}`)); else lines.push('No accounting samples are available yet.');
    lines.push('','Live samples update every 0.5s for running jobs. Use M for metrics.');
    right=pane('JOB PERFORMANCE · CPU / MEMORY',displayLines(lines.join('\n'),body-4));
  }else if(!selected){right=pane('JOBS',line(loading?'Connecting to Slurm…':'No jobs match. Press a to change filter or / to search.'));
  }else if(view===2){
    if(!logs.length)right=pane('LOGS',line(detailError||(!detail?'Loading log paths…':'No logs found. Interactive jobs may have no output file. Older custom paths may no longer be available.')));
    else {
      const visible=split&&!full?logs.slice(0,2):[log];
      right=h(Box,{flexDirection:'row',flexGrow:1},...visible.map((l,i)=>pane(`${l.source}${full?' · FULL FILE':' · LIVE TAIL'}`,h(Box,{flexDirection:'column'},line(l.path,{dimColor:true,wrap:'truncate-middle'}),...(full?(page?displayLines(page.text):[line('Loading file…')]):displayLines(l.text,pageHeight,Math.floor((width-Math.min(36,Math.floor(width*.3)))/visible.length)-4)),line(full&&page?`Bytes ${page.offset}–${page.next} / ${page.size} · [ ] chunks`:'Last 600 lines · f opens full file',{dimColor:true})),visible.length===2?'50%':undefined)));
    }
  }else {
    const m=detail?.meta||{};
    const lines=[`${selected.name}  #${selected.id}`,`${selected.state} · exit ${selected.exit||m.ExitCode||'—'}`,'',...diagnosis(selected,detail),'','RESOURCES / TIMING',`Elapsed ${selected.elapsed} / limit ${m.TimeLimit||'—'}`,`Nodes ${selected.nodes||'—'} · ${selected.partition} · CPUs ${selected.cpus}`,`Requested RAM ${selected.memory} · ${m.AllocTRES||m.ReqTRES||''}`,`Started ${selected.start||'—'} · ended ${selected.end||'—'}`,`Directory ${selected.workdir||'—'}`,'','MEASURED PERFORMANCE (accounting steps)',...(detail?.steps||[]).map(s=>`${s.id} · ${s.state} · peak RSS ${s.rss||'not recorded'} · CPU ${s.cpu||'—'} · elapsed ${s.elapsed}`),'','Actions: c cancel (confirm c) · R rerun · e edit header · S submit'];
    if (draft) lines.push('','RERUN DRAFT',...Object.entries(draft.overrides).map(([k,v])=>`${k} = ${v}`),'e edit header  S submit  Esc discard');
    if (editInput !== null) lines.push('',`Edit header: ${editInput}▌`);
    if (actionMessage) lines.push('',actionMessage);
    right=pane('JOB OVERVIEW',displayLines(lines.join('\n'),body-4));
  }
  const idx=Math.max(0,jobs.findIndex(j=>j.id===selectedId)); const start=Math.max(0,Math.min(idx-Math.floor((body-4)/2),jobs.length-(body-4)));
  if(width<72||height<18)return h(Box,{flexDirection:'column'},line('seejobs · enlarge terminal to at least 72 × 18',{color:'yellow'}),line('q quit'));
  return h(Box,{flexDirection:'column',height:height-1,width},
    h(Box,{justifyContent:'space-between'},line(' ◉ seejobs',{bold:true,color:'cyan'}),line(`◷ ${now.toLocaleTimeString()} · ${loading?'refreshing…':updated||'connecting…'} `,{dimColor:true})),
    line(` ${data.jobs.filter(active).length} active   ${data.jobs.filter(failed).length} unsuccessful   ${data.jobs.length} jobs / ${days}d   ${data.nodes.filter(n=>/drain|down|fail/i.test(n.state)).length} unhealthy nodes`,{color:'white'}),
    h(Text,{key:'nav'},h(Text,{color:'yellow',bold:true},'O'),line('verview   ',{color:'cyan'}),h(Text,{color:'yellow',bold:true},'L'),line('ogs   ',{color:'cyan'}),h(Text,{color:'yellow',bold:true},'N'),line('odes   ',{color:'cyan'}),h(Text,{color:'yellow',bold:true},'H'),line('istory   ',{color:'cyan'}),h(Text,{color:'yellow',bold:true},'M'),line('etrics   ',{color:'cyan'}),h(Text,{color:'yellow',bold:true},'S'),line(`queue  │ F:filters`,{color:'cyan'})),
    h(Box,{height:body},h(Box,{width:Math.min(36,Math.floor(width*.3)),flexShrink:0,flexDirection:'column',borderStyle:'round',borderColor:!focus?'cyan':'gray',paddingX:1},line(`JOBS ${!focus?'• focused':''}`,{bold:true,color:'cyan'}),...jobs.slice(start,start+body-4).map(j=>line(`${j.id===selectedId?'›':' '} ${j.id} ${j.state==='RUNNING'?'●':failed(j)?'×':j.state==='PENDING'?'◷':'✓'} ${j.name} ${j.partition||''} ${j.nodes||''} ${j.cpus||''} ${j.gres||''}`,{key:j.id,color:color(j),inverse:j.id===selectedId,wrap:'truncate'}))),right),
    line(error?`STALE · ${error}`:detailError?`DETAIL ERROR · ${detailError}`:data.warnings.join(' · ')||`Focus: ${focus?'details/logs':'job list'} · View ${view} · ${full?'full file': 'live tail'} · ${split?'split logs':'single log'}`,{color:error||detailError||data.warnings.length?'yellow':'gray',wrap:'truncate'}),
    line(' ↑↓ jobs/scroll  Tab focus  k search  f filters  r refresh  c cancel  q quit',{dimColor:true}),
    line(' O/L/N/H/M panels  S queue  / split logs  PgUp/PgDn/Home/End scroll',{dimColor:true})
  );
}
