import React,{useEffect,useRef,useState} from 'react';
import {Box,Text,useInput,useApp,useStdout} from 'ink';
import wrapAnsi from 'wrap-ansi';
import {request,clean,active,failed,diagnosis} from './client.js';
import {PANELS,DEFAULT_FILTERS,filterJobs,queueRows,moveIndex,stateOf,statusColor,sampleMetrics,appendSample,plot,formatBytes} from './model.js';
import {FIELDS,parseBatch,buildBatch,validateBatch} from './batch.js';

const h=React.createElement;
const text=(value,props={})=>h(Text,{wrap:'truncate',...props},clean(value));
const clamp=(n,max)=>Math.max(0,Math.min(Math.max(0,max),n));
const fit=(v,n)=>{const chars=Array.from(clean(v||'—'));return (chars.length>n?chars.slice(0,n-1).join('')+'…':chars.join('')).padEnd(n);};
const terminalKey=key=>key.upArrow||key.downArrow||key.pageUp||key.pageDown||key.home||key.end;
const scopeLabel=(f,user)=>f.scope==='mine'?'My jobs ('+user+')':f.scope==='all'?'All visible users':f.username;
// ANSI colors follow the user's terminal theme; status hues survive selection.
const selectedStyle={backgroundColor:'blue',bold:true};
const shortcut=(key,label)=>h(Text,null,h(Text,{color:'cyan',bold:true},key),h(Text,{color:'gray'},label));

export function App({host,user,days,mouse=false,input,api=request}) {
  const {exit}=useApp(),{stdout}=useStdout();
  const [size,setSize]=useState([stdout.columns||120,stdout.rows||32]);
  const [panel,setPanel]=useState('s'),[focus,setFocus]=useState('queue');
  const [data,setData]=useState({jobs:[],nodes:[],warnings:[]}),[caps,setCaps]=useState(null);
  const [filters,setFilters]=useState({...DEFAULT_FILTERS}),[filterDraft,setFilterDraft]=useState(null),[field,setField]=useState(0),[choices,setChoices]=useState(null);
  const [selectedKey,setSelectedKey]=useState(''),[grouped,setGrouped]=useState(false),[folded,setFolded]=useState(new Set());
  const [detail,setDetail]=useState(null),[detailId,setDetailId]=useState(''),[detailError,setDetailError]=useState('');
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[loading,setLoading]=useState(false),[tick,setTick]=useState(0);
  const [clock,setClock]=useState(Date.now()),[updated,setUpdated]=useState(null),[modal,setModal]=useState(null);
  const [busy,setBusy]=useState(false),busyRef=useRef(false);
  const [draft,setDraft]=useState(null),[editorIndex,setEditorIndex]=useState(0),[preview,setPreview]=useState(false);
  const [offsets,setOffsets]=useState({}),[logIndex,setLogIndex]=useState(0),[split,setSplit]=useState(true),[full,setFull]=useState(false),[pageOffset,setPageOffset]=useState(0),[page,setPage]=useState(null);
  const [samples,setSamples]=useState([]),[metricError,setMetricError]=useState('');
  const limits=useRef({}),hits=useRef([]),live=useRef(null);
  const width=size[0],height=size[1],body=Math.max(8,height-9),queuePage=Math.max(1,body-5);
  const jobs=filterJobs(data.jobs,filters,user);
  const rows=queueRows(jobs,grouped,folded);
  const selectedIndex=Math.max(0,rows.findIndex(r=>r.key===selectedKey));
  const row=rows[selectedIndex],selected=row?.job;
  const selectedId=selected?.id;
  live.current={selected};
  const queueStart=clamp(selectedIndex-Math.floor(queuePage/2),rows.length-queuePage);
  const sidebar=panel==='s'||filterDraft||draft?0:Math.min(33,Math.floor(width*.25));
  const contentWidth=width-sidebar;
  const logs=detailId===selectedId?detail?.logs||[]:[];
  const log=logs[clamp(logIndex,logs.length-1)];
  const scope=filters.scope==='all'?'':filters.scope==='user'?filters.username:user;
  const availableUsers=[...new Set([user,...data.jobs.map(j=>j.user)].filter(Boolean))].sort();
  const availableParts=[...new Set([...(caps?.partitions||[]).map(p=>p.PartitionName),...data.jobs.map(j=>j.partition)].filter(Boolean))].sort();

  useEffect(()=>{const fn=()=>setSize([stdout.columns||120,stdout.rows||32]);stdout.on('resize',fn);const t=setInterval(()=>setClock(Date.now()),500);return()=>{stdout.off('resize',fn);clearInterval(t);};},[stdout]);
  useEffect(()=>{
    const c=new AbortController();let pending=false;
    const load=async()=>{if(pending)return;pending=true;setLoading(true);try{const result=await api(host,{op:'list',user:scope,days},c.signal);if(!c.signal.aborted){setData(result);setError('');setUpdated(Date.now());}}catch(e){if(!c.signal.aborted)setError(e.message);}finally{pending=false;if(!c.signal.aborted)setLoading(false);}};
    load();const t=setInterval(load,15000);return()=>{clearInterval(t);c.abort();};
  },[scope,days,host,tick,api]);
  useEffect(()=>{const c=new AbortController();api(host,{op:'capabilities'},c.signal).then(v=>{if(!c.signal.aborted)setCaps(v);}).catch(()=>{});return()=>c.abort();},[host,api]);
  useEffect(()=>{setDetail(null);setDetailId('');setDetailError('');setSamples([]);setPage(null);setPageOffset(0);setFull(false);setLogIndex(0);setOffsets({});},[selectedId]);
  useEffect(()=>{
    if(!selectedId||panel==='s'||filterDraft||draft)return;
    const c=new AbortController();let pending=false;
    const load=async()=>{if(pending)return;pending=true;try{const result=await api(host,{op:'detail',job:live.current.selected},c.signal);if(!c.signal.aborted){setDetail(result);setDetailId(selectedId);setDetailError('');}}catch(e){if(!c.signal.aborted)setDetailError(e.message);}finally{pending=false;}};
    load();const t=setInterval(load,5000);return()=>{clearInterval(t);c.abort();};
  },[selectedId,panel,!!filterDraft,!!draft,host,tick,api]);
  useEffect(()=>{
    if(panel!=='m'||!selectedId||selected.state!=='RUNNING'||filterDraft||draft)return;
    const c=new AbortController();let timer;
    const load=async()=>{const began=Date.now();try{const result=await api(host,{op:'metrics',job:live.current.selected},c.signal);if(!c.signal.aborted){setSamples(prev=>appendSample(prev,sampleMetrics(result)));setMetricError('');}}catch(e){if(!c.signal.aborted)setMetricError(e.message);}finally{if(!c.signal.aborted)timer=setTimeout(load,Math.max(0,500-(Date.now()-began)));}};
    setMetricError('');load();return()=>{clearTimeout(timer);c.abort();};
  },[selectedId,selected?.state,panel,host,api,!!filterDraft,!!draft]);
  useEffect(()=>{
    if(!full||!log||!selected)return;
    const c=new AbortController();setPage(null);
    api(host,{op:'log',job:selected,path:log.path,offset:pageOffset},c.signal).then(v=>{if(!c.signal.aborted){setPage(v);setOffsets(v=>({...v,logs:0}));}}).catch(e=>{if(!c.signal.aborted)setDetailError(e.message);});
    return()=>c.abort();
  },[full,log?.path,pageOffset,selectedId,host,api]);

  function navigatePanel(p){setPanel(p);setFocus(p==='s'?'queue':'content');setOffsets(v=>({...v,[p]:0}));}
  function selectAt(index){const next=rows[clamp(index,rows.length-1)];if(next)setSelectedKey(next.key);}
  function toggleGroup(path){setFolded(prev=>{const next=new Set(prev);next.has(path)?next.delete(path):next.add(path);return next;});}
  function scroll(key,target=panel){setOffsets(prev=>({...prev,[target]:moveIndex(clamp(prev[target]||0,limits.current[target]||0),(limits.current[target]||0)+1,key,Math.max(1,body-5))}));}
  async function operation(payload,onSuccess){
    if(busyRef.current)return;
    busyRef.current=true;setBusy(true);setNotice('Working…');
    try{const result=await api(host,payload);setNotice(result.result||'Ready');onSuccess?.(result);}
    catch(e){setNotice(e.message+(payload.op==='submit'?' · If the connection failed, check the queue before resubmitting.':''));}
    finally{busyRef.current=false;setBusy(false);}
  }
  function openEditor(payload){operation(payload,result=>{
    try{setDraft({...result,parsed:parseBatch(result.script),edits:{}});setEditorIndex(0);setPreview(false);setOffsets({});setNotice('Edit the fields, then review the complete script.');}
    catch(e){setNotice(e.message);}
  });}
  function filterOptions(index){
    if(index===0)return [{label:'My jobs ('+user+')',value:'mine'},{label:'All visible users',value:'all'},{label:'Choose / type a username',value:'user'}];
    if(index===1)return ['All',...availableParts].map(v=>({label:v,value:v}));
    if(index===2)return ['All','Active',...new Set(['RUNNING','PENDING','COMPLETED','FAILED','CANCELLED','OUT_OF_MEMORY','TIMEOUT',...data.jobs.map(j=>j.state)])].map(v=>({label:v,value:v}));
    return ['All','GPU requested','CPU only'].map(v=>({label:v,value:v}));
  }
  function chooseFilter(item){
    if(field===0&&item.value==='user'){setModal({kind:'username',title:'Slurm username',value:filterDraft.username||'',hint:'Visible users: '+availableUsers.join(', ')});setChoices(null);return;}
    const key=['scope','partition','status','gpu'][field];setFilterDraft(v=>({...v,[key]:item.value}));setChoices(null);
  }
  function saveTextModal(){
    const m=modal;setModal(null);
    if(m.kind==='search'){setFilters(v=>({...v,query:m.value}));return;}
    if(m.kind==='username'){if(!/^[\w.@-]+$/.test(m.value)){setNotice('Enter a valid Slurm username');return;}setFilterDraft(v=>({...v,scope:'user',username:m.value}));return;}
    if(m.kind==='path'){openEditor({op:'open',path:m.value});return;}
    if(m.kind==='edit'){setDraft(v=>m.name==='@workdir'?{...v,workdir:m.value}:{...v,edits:{...v.edits,[m.name]:m.value}});return;}
  }
  const editable=draft?[['@workdir','Submission directory','Directory used when invoking sbatch',''],...FIELDS,
    ...Object.keys(draft.parsed.values).filter(k=>!FIELDS.some(f=>f[0]===k)).map(k=>[k,k,'Additional original directive',''])]:[];
  function editField(index){
    const f=editable[index];if(!f)return;
    const value=f[0]==='@workdir'?draft.workdir:(draft.edits[f[0]]??draft.parsed.values[f[0]]??'');
    const hints=f[0]==='partition'?(caps?.partitions||[]).map(p=>p.PartitionName+' (max time '+p.MaxTime+', max nodes '+p.MaxNodes+', accounts '+p.AllowAccounts+', QoS '+p.AllowQos+')').join('; '):f[0]==='qos'?(caps?.qos||[]).map(q=>q.name).join(', '):f[0]==='account'?(caps?.accounts||[]).map(a=>a.account).join(', '):f[0]==='constraint'?(caps?.nodes||[]).map(n=>n.AvailableFeatures).filter(Boolean).join(', '):f[0]==='gres'?(caps?.nodes||[]).map(n=>n.Gres).filter(Boolean).join(', '):'';
    setModal({kind:'edit',title:f[1],name:f[0],value,hint:f[2]+(hints?' · Available: '+hints:'')});
  }
  function review(){
    const errors=validateBatch(draft.parsed,draft.edits,caps);
    if(errors.length){setNotice(errors.join(' · '));return;}
    setPreview(true);setOffsets(v=>({...v,editor:0}));
    setNotice('Review the script and submission directory. T validates; Ctrl+Enter submits after confirmation.');
  }
  function confirmSubmit(){
    const errors=validateBatch(draft.parsed,draft.edits,caps);
    if(errors.length){setNotice(errors.join(' · '));return;}
    setModal({kind:'submit',title:'Submit this batch script?',script:buildBatch(draft.parsed,draft.edits),workdir:draft.workdir});
  }

  useInput((inputText,key)=>{
    const letter=inputText.toLowerCase();
    if(modal){
      if(key.escape){if(!busy)setModal(null);return;}
      if(['cancel','submit'].includes(modal.kind)){
        if(letter==='y'&&!busy){
          const m=modal;setModal(null);
          operation(m.kind==='cancel'?{op:'cancel',job:m.job,confirmed:true}:{op:'submit',script:m.script,workdir:m.workdir,confirmed:true},
            ()=>{if(m.kind==='submit')setDraft(null);setTick(t=>t+1);});
        }
        return;
      }
      if(key.return){saveTextModal();return;}
      if(key.backspace||key.delete)setModal(v=>({...v,value:v.value.slice(0,-1)}));
      else if(key.ctrl&&letter==='u')setModal(v=>({...v,value:''}));
      else if(!key.ctrl&&!key.meta&&inputText)setModal(v=>({...v,value:v.value+clean(inputText).replace(/\n/g,'')}));
      return;
    }
    if(filterDraft){
      if(key.escape){setFilterDraft(null);setChoices(null);return;}
      if(choices){if(terminalKey(key))setChoices(v=>({...v,index:moveIndex(v.index,v.items.length,key,queuePage)}));else if(key.return)chooseFilter(choices.items[choices.index]);return;}
      if(terminalKey(key)){setField(v=>moveIndex(v,4,key,4));return;}
      if(key.return){setChoices({items:filterOptions(field),index:0});return;}
      if(letter==='a'){setFilters(filterDraft);setFilterDraft(null);setSelectedKey('');return;}
      if(letter==='x')setFilterDraft({...DEFAULT_FILTERS});
      return;
    }
    if(draft){
      if(key.escape){setDraft(null);setPreview(false);return;}
    if(key.ctrl&&key.return){if(preview)confirmSubmit();else review();return;}
      if(letter==='t'){operation({op:'validate',script:buildBatch(draft.parsed,draft.edits),workdir:draft.workdir});return;}
      if(letter==='v'){if(preview)setPreview(false);else review();return;}
      if(preview){if(terminalKey(key))scroll(key,'editor');else if(letter==='e')setPreview(false);else if(letter==='u')confirmSubmit();return;}
      if(terminalKey(key)){setEditorIndex(i=>moveIndex(i,editable.length,key,queuePage));return;}
      if(key.return){editField(editorIndex);return;}
      return;
    }
    if(letter==='q'){if(busy){setNotice('Wait for the current action to finish before exiting.');return;}exit();return;}
    if(letter==='f'){setFilterDraft({...filters});setField(0);setChoices(null);return;}
    if(letter==='k'){setModal({kind:'search',title:'Search jobs',value:filters.query,hint:'Job ID, name, user, state, partition, nodes, resources or script path · Ctrl+U clears'});return;}
    if(letter==='b'){setModal({kind:'path',title:'Open batch script on '+host,value:'',hint:'Absolute path or ~/path to an existing .sh, .slurm or .sbatch script'});return;}
    if(letter==='e'&&selected){openEditor({op:'script',job:selected});return;}
    if(letter==='c'&&selected){setModal({kind:'cancel',title:'Cancel job '+selected.id+'?',job:{...selected}});return;}
    if(letter==='r'){setTick(t=>t+1);return;}
    if(inputText==='/'){setSplit(v=>!v);navigatePanel('l');return;}
    if(inputText==='?'){navigatePanel('?');return;}
    if(PANELS.some(p=>p[0]===letter)){navigatePanel(letter);return;}
    if(key.tab){setFocus(f=>f==='queue'?'content':'queue');return;}
    if(panel==='s'||focus==='queue'){
      if(terminalKey(key)){selectAt(moveIndex(selectedIndex,rows.length,key,queuePage));return;}
      if(letter==='g'){setGrouped(v=>!v);return;}
      if(key.return){if(row?.job)navigatePanel('o');else if(row)toggleGroup(row.path);return;}
      if(key.leftArrow&&row?.path){setFolded(v=>new Set([...v,row.path]));setSelectedKey('group:'+row.path);return;}
      if(key.rightArrow&&row?.path){setFolded(v=>{const n=new Set(v);n.delete(row.path);return n;});return;}
      if(inputText===' '&&row?.path){toggleGroup(row.path);return;}
    }
    if(panel==='l'){
      if(letter==='v'){setFull(v=>!v);setPageOffset(0);return;}
      if(key.leftArrow||key.rightArrow){setLogIndex(i=>clamp(i+(key.rightArrow?1:-1),logs.length-1));setPageOffset(0);return;}
      if(inputText===']'&&full&&page?.next<page?.size){setPageOffset(page.next);return;}
      if(inputText==='['&&full){setPageOffset(v=>Math.max(0,v-48000));return;}
    }
    if(terminalKey(key))scroll(key,panel==='l'?'logs':panel);
  });

  useEffect(()=>{
    if(!mouse||!input)return;
    stdout.write('\x1b[?1000h\x1b[?1006h');
    return()=>stdout.write('\x1b[?1000l\x1b[?1006l');
  },[mouse,input,stdout]);
  useEffect(()=>{
    if(!mouse||!input)return;
    const handler=e=>{
      if(e.release||modal)return;
      const hit=[...hits.current].reverse().find(r=>e.x>=r.x&&e.x<r.x+r.w&&e.y>=r.y&&e.y<r.y+r.h);
      if(e.button===64||e.button===65){if(hit?.queue){selectAt(selectedIndex+(e.button===65?1:-1));}else scroll({[e.button===65?'downArrow':'upArrow']:true},panel==='l'?'logs':panel);return;}
      if(e.button!==0)return;
      hit?.click?.();
    };
    input.on('mouse',handler);return()=>input.off('mouse',handler);
  });

  hits.current=[];limits.current={};
  const hit=(x,y,w,h,click,queue=false)=>hits.current.push({x,y,w,h,click,queue});
  function linesView(value,w=contentWidth-4,key=panel,capacity=body-4){
    const lines=wrapAnsi(clean(value).replaceAll('\t','    '),Math.max(10,w),{hard:true,trim:false}).split('\n');
    const max=Math.max(0,lines.length-capacity);limits.current[key]=Math.max(limits.current[key]||0,max);
    const start=clamp(offsets[key]||0,max);
    return h(Box,{flexDirection:'column'},...lines.slice(start,start+capacity).map((l,i)=>text(l||' ',{key:i,color:/\bPENDING\b|Waiting:/.test(l)?'yellow':/\bCOMPLETED\b|successfully/.test(l)?'green':/error|failed|exception|timeout|out of memory/i.test(l)?'red':undefined})));
  }
  function frame(title,content,w=contentWidth,accent='cyan'){
    const focused=modal||filterDraft||draft||focus==='content'||panel==='s';
    return h(Box,{width:w,height:body,borderStyle:'round',borderColor:focused?accent:'gray',borderDimColor:!focused,paddingX:1,flexDirection:'column',overflow:'hidden'},
      text(title,{bold:true,color:accent}),content);
  }
  function queue(w,compact=false){
    const start=queueStart,visible=rows.slice(start,start+queuePage);
    const columns=w>=140?[10,20,18,14,11,12,5,12,10]:w>=105?[9,12,12,11,9,8,4,9,8]:[8,10,8,9,6,5,4,6,7];
    const spare=Math.max(0,w-6-8-columns.reduce((a,b)=>a+b,0));
    const userExtra=Math.min(spare,Math.max(0,Math.min(28,Math.max(0,...jobs.map(j=>clean(j.user).length)))-columns[2]));
    columns[2]+=userExtra;columns[1]+=spare-userExtra;
    const header=['JOB ID','NAME','USER','STATE','PARTITION','NODES','CPUs','GRES','TIME'].map((v,i)=>fit(v,columns[i])).join(' ');
    return frame(compact?'JOBS':'SLURM · '+jobs.length+' jobs · '+(grouped?'grouped by script':'live + accounting'),
      h(Box,{flexDirection:'column',flexGrow:1},
        text(compact?'Select a job':'  '+header,{color:'gray',bold:true}),
        ...visible.map((r,i)=>{
          hit(0,8+i,w-2,1,()=>{setSelectedKey(r.key);setFocus('queue');if(r.job)navigatePanel('o');else toggleGroup(r.path);},true);
          const chosen=r.key===row?.key;
          const marker=text(chosen?'› ':'  ',{color:'cyan'});
          const cells=r.job&&!compact?
            [r.job.id,r.job.name,r.job.user,stateOf(r.job.state),r.job.partition,r.job.nodes,r.job.cpus,r.job.gres,r.job.elapsed].map((v,j)=>text(fit(v,columns[j])+(j<8?' ':''),{key:j,color:j===3?statusColor(r.job.state):j===0?'cyan':chosen?'white':j===1?undefined:'gray'})):
            [text(r.job?r.job.id+' '+r.job.name:(folded.has(r.path)?'▸ ':'▾ ')+r.label+' · '+r.count+' jobs',{key:'label',color:r.job?statusColor(r.job.state):'cyan'})];
          return h(Box,{key:r.key,width:w-4,height:1,...(chosen?{backgroundColor:'blue'}:{})},h(Text,{wrap:'truncate',bold:chosen},marker,...cells));
        }),
        !rows.length?text(loading?'Loading jobs…':'No matching jobs. F opens filters.',{color:'gray'}):null,
        h(Box,{flexGrow:1}),
        text(compact?(rows.length?`${selectedIndex+1} / ${rows.length} · Tab focus`:'F filters'):
          `${rows.length?start+1:0}–${Math.min(start+queuePage,rows.length)} / ${rows.length} rows  ·  ↑↓ select  ·  Enter open  ·  C cancel  ·  G ${grouped?'ungroup':'group by script'}`,{color:'gray'})
      ),w,focus==='queue'||panel==='s'?'cyan':'gray');
  }
  function metricChart(label,key,unit,color,values,ceiling){
    const p=plot(values,key,Math.max(15,contentWidth-18),4,ceiling);
    return [text(label+' · '+unit,{color,bold:true,key:label}),...p.lines.map((l,i)=>text(l,{color,key:label+i})),
      text(p.start?'       └'+ '─'.repeat(Math.max(15,contentWidth-18)):'',{key:label+'axis',color:'gray'}),
      text(p.start?'        '+new Date(p.start*1000).toLocaleTimeString()+' → '+new Date(p.end*1000).toLocaleTimeString():'',{key:label+'time',color:'gray'})];
  }
  let main;
  if(filterDraft){
    const labels=[['User scope',scopeLabel(filterDraft,user)],['Partition',filterDraft.partition],['Status',filterDraft.status],['GPU allocation',filterDraft.gpu]];
    const options=choices?.items||[];
    main=frame('FILTERS · applies to jobs, logs, history and metrics',h(Box,{flexDirection:'column'},
      text('↑↓ choose a field · Enter opens options · A apply · X reset · Esc discard',{color:'gray'}),
      ...labels.map(([label,value],i)=>{hit(1,8+i,width-2,1,()=>{setField(i);setChoices({items:filterOptions(i),index:0});});return text((field===i?'› ':'  ')+fit(label,20)+' '+value+'  ›',{key:label,...(field===i&&!choices?selectedStyle:{}),color:field===i?'cyan':undefined});}),
      text(''),
      ...(choices?options.slice(clamp(choices.index-3,options.length-8),clamp(choices.index-3,options.length-8)+Math.max(2,body-12)).map((o,i)=>{hit(1,13+i,width-2,1,()=>chooseFilter(o));return text((choices.items.indexOf(o)===choices.index?'› ':'  ')+o.label,{key:o.value,inverse:choices.items.indexOf(o)===choices.index});}):
        [text('All visible users queries Slurm for other users too.',{key:'scope',color:'gray'}),text('Slurm privacy settings and file permissions still apply.',{key:'access',color:'gray'})])
    ),width);
  }else if(draft){
    if(preview)main=frame('SUBMISSION PREVIEW · '+draft.workdir,linesView(buildBatch(draft.parsed,draft.edits),width-4,'editor'),width);
    else{
      const start=clamp(editorIndex-Math.floor(queuePage/2),editable.length-queuePage);
      const f=editable[editorIndex];
      main=frame('BATCH EDITOR · '+draft.source,h(Box,{flexDirection:'column'},
        text('↑↓ fields · Enter edit · V review · T scheduler check · Esc discard',{color:'gray'}),
        ...editable.slice(start,start+queuePage).map((f,i)=>{
          hit(1,8+i,width-2,1,()=>{setEditorIndex(start+i);editField(start+i);});
          const value=f[0]==='@workdir'?draft.workdir:draft.edits[f[0]]??draft.parsed.values[f[0]]??'';
          return text((start+i===editorIndex?'› ':'  ')+fit(f[1],24)+' '+(value||'— default / omitted'),{key:f[0],...(start+i===editorIndex?selectedStyle:{}),color:Object.hasOwn(draft.edits,f[0])?'yellow':value?undefined:'gray'});
        }),text(f?.[2]||'',{color:'gray'}),
        text(draft.parsed.warnings.join(' · '),{color:'yellow'})
      ),width);
    }
  }else if(panel==='s')main=queue(width);
  else if(panel==='n'){
    const nodes=data.nodes.filter(n=>filters.partition==='All'||n.partition?.replace('*','')===filters.partition);
    main=frame('NODES · partition '+filters.partition,linesView(nodes.map(n=>n.name+'  '+n.state.toUpperCase()+'  '+n.partition+'\nCPUs allocated / idle / other / total: '+n.cpus+'  · RAM '+n.memory+' MiB\nGRES '+(n.gres||'—')+'  · Reason: '+n.reason+'\n').join('\n')));
  }else if(panel==='h'){
    const done=jobs.filter(j=>!active(j));
    main=frame('HISTORY · current filters',linesView(done.length+' finished · '+done.filter(j=>j.state==='COMPLETED').length+' completed · '+done.filter(failed).length+' unsuccessful\n\n'+done.map(j=>j.id+'  '+j.state+'  '+j.elapsed+'  '+j.name+'\n'+j.user+' · '+j.partition+' · '+(j.memory||'—')+' requested RAM').join('\n\n')));
  }else if(panel==='?'){
    main=frame('HELP · keyboard and mouse',linesView('S Slurm queue · O Overview · L Logs · N Nodes · H History · M Metrics\nF Filters: choose field, Enter for options, A apply\nK Search: type to filter all job views; Ctrl+U clears\nArrows, PageUp/Down, Home/End navigate focused panel\nTab changes focus. Click a row to open Overview.\nG groups queue by full script path. Enter/Space or arrows fold groups.\nC cancels a selected job after a job-specific confirmation.\nE recovers a job script. B opens a remote script file.\nEditor: Enter edits a field; V previews; T checks with sbatch --test-only.\nCtrl+Enter requests submission, then Y confirms.\nLogs: / toggles split; arrows select a file; V full-file view; [ ] chunks.\nR refresh · Q quit. No pause command.\n\nMetrics refresh the display every 0.5s; Slurm controls metric collection cadence. Missing measurements remain unavailable.'));
  }else if(!selected)main=frame('SELECT A JOB',text(row?.path?'This is a script group. Expand it and select a job.':'No job matches the current filters. Press F.'));
  else if(panel==='l'){
    if(!logs.length)main=frame('LOGS · '+selected.id,text(detailError||(!detail?'Loading…':'No readable log paths found. Other-user files may be private.'),{wrap:'wrap'}));
    else{
      const visible=split&&!full?logs.slice(0,2):[log],pw=Math.floor(contentWidth/visible.length);
      main=h(Box,{width:contentWidth},...visible.map((l,i)=>{
        hit(sidebar+i*pw,5,pw,body,()=>{setFocus('content');setLogIndex(logs.indexOf(l));});
        return h(Box,{key:l.path,width:pw,height:body,borderStyle:'round',borderColor:log===l?'cyan':'gray',paddingX:1,flexDirection:'column'},
          text(l.source+(full?' · FULL FILE':' · TAIL'),{bold:true,color:'cyan'}),text(l.path,{color:'gray',wrap:'truncate-middle'}),
          linesView(full?(page?.text||'Loading file…'):l.text,pw-4,'logs',body-6),
          text(full&&page?'Bytes '+page.offset+'–'+page.next+' / '+page.size+' · [ ] chunks':'V full file · / split · arrows select file',{color:'gray'})
        );
      }));
    }
  }else if(panel==='m'){
    const rows=detail?.steps||[];
    if(selected.state!=='RUNNING')main=frame('METRICS · '+selected.id,linesView('State: '+selected.state+'\n'+(selected.state==='PENDING'?'No resource usage before the job starts.':'Final accounting summary; no live measurements for finished jobs.')+'\n\n'+rows.map(s=>s.id+' · peak RSS '+(s.rss||'unavailable')+' · CPU time '+(s.cpu||'unavailable')+' · elapsed '+s.elapsed).join('\n')));
    else{
      const gpu=samples.some(p=>p.gpu!=null),values=samples.map(p=>({...p,rssGiB:p.rss==null?null:p.rss/1024**3}));
      const charts=[...metricChart('CPU','cores','cores used (accounting delta)','cyan',values,Number(selected.cpus)||null),
        ...metricChart('Resident memory','rssGiB','GiB · sum across reported tasks','green',values),
        ...(gpu?metricChart('GPU','gpu','% · reported task average, highest step','magenta',values):[text('GPU telemetry: unavailable or not allocated',{key:'gpu',color:'gray'})]),
        text('Display 0.5s · Slurm collects every '+(caps?.sampleSeconds||'?')+'s · '+(metricError||'Missing data is not zero.'),{key:'cadence',color:metricError?'yellow':'gray'})];
      limits.current.m=Math.max(0,charts.length-(body-4));
      const start=clamp(offsets.m||0,limits.current.m);
      main=frame('METRICS · '+selected.id,h(Box,{flexDirection:'column'},...charts.slice(start,start+body-4)));
    }
  }else{
    const meta=detail?.meta||{};
    main=frame('OVERVIEW · '+selected.id,linesView(selected.name+' · '+selected.user+'\n'+selected.state+' · exit '+(selected.exit||meta.ExitCode||'—')+'\n\n'+
      diagnosis(selected,detail).join('\n')+'\n\nPartition '+selected.partition+' · nodes '+(selected.nodes||'—')+'\nElapsed '+selected.elapsed+' / '+(selected.limit||meta.TimeLimit||'—')+
      '\nCPUs '+selected.cpus+' · requested RAM '+selected.memory+' · GRES '+(selected.gres||'none')+
      '\nScript '+(selected.script||meta.Command||'unavailable')+'\nDirectory '+(selected.workdir||meta.WorkDir||'unavailable')+
      '\n\nLOGS · L opens viewer\n'+logs.map(l=>l.source+': '+l.path).join('\n')+
      '\n\nACCOUNTING\n'+(detail?.steps||[]).map(s=>s.id+' '+s.state+' · peak RSS '+(s.rss||'—')+' · CPU '+(s.cpu||'—')).join('\n')));
  }
  hit(sidebar,5,contentWidth,body,()=>setFocus('content'));
  // More specific mouse targets must win over the content background.
  if(hits.current.length>1){const background=hits.current.pop();hits.current.unshift(background);}
  let navX=1;
  const nav=PANELS.map(([key,label])=>{const x=navX;navX+=label.length+3;hit(x,2,label.length+3,1,()=>navigatePanel(key));return h(Text,{key,color:panel===key?'white':'gray',bold:panel===key},h(Text,{color:'cyan',bold:true},label[0]),label.slice(1)+'   ');});
  hit(navX,2,8,1,()=>{setFilterDraft({...filters});setField(0);setChoices(null);});
  const logButtons=selected&&logs.length?['stdout','stderr'].map((kind,i)=>{
    const index=logs.findIndex(l=>new RegExp(kind==='stdout'?'stdout|output':'stderr|error','i').test(l.source));
    hit(width-22+i*11,4,10,1,()=>{if(index>=0){setLogIndex(index);setSplit(false);navigatePanel('l');}});
    return text('['+kind+']',{key:kind,color:index>=0?'cyan':'gray'});
  }):[];
  let modalContent=null;
  if(modal){
    const confirm=['cancel','submit'].includes(modal.kind);
    const info=modal.kind==='cancel'?'Job '+modal.job.id+' · '+modal.job.name+' · '+modal.job.user+'\nSlurm applies your existing cancellation permissions.':
      modal.kind==='submit'?'Submission directory: '+modal.workdir+'\nThe previewed script will be sent to sbatch.':modal.hint;
    modalContent=frame(modal.title,h(Box,{flexDirection:'column'},text(info,{wrap:'wrap',color:'gray'}),text(''),
      text(confirm?'Y confirm · Esc go back':'> '+modal.value+'▌',{color:confirm?'yellow':'cyan',wrap:'wrap'}),
      text(confirm?'':'Enter save · Ctrl+U clear · Esc cancel',{color:'gray'})),width,'yellow');
  }
  if(width<80||height<22)return h(Box,{flexDirection:'column'},text('seejobs needs at least 80 columns × 22 rows. Enlarge the terminal.'),text('Q quit'));
  const status=busy?'Working…':notice||detailError||data.warnings.join(' · ')||'Ready';
  return h(Box,{width,height:height-1,flexDirection:'column'},
    h(Box,{justifyContent:'space-between'},text(' ◉ seejobs',{color:'cyan',bold:true}),text('◷ '+new Date(clock).toLocaleTimeString()+' · '+(loading?'refreshing':updated?'updated '+new Date(updated).toLocaleTimeString():'connecting'),{color:'gray'})),
    h(Text,null,' ',text('● '+jobs.filter(j=>j.state==='RUNNING').length+' running',{color:'green'}),'   ',text('◷ '+jobs.filter(j=>j.state==='PENDING').length+' pending',{color:'yellow'}),'   ',text('✓ '+jobs.filter(j=>j.state==='COMPLETED').length+' completed',{color:'green'}),'   ',text('× '+jobs.filter(failed).length+' unsuccessful',{color:'red'}),text('   ·   '+days+' day history',{color:'gray'})),
    h(Text,null,' ',...nav,text('F',{color:'cyan',bold:true}),'ilters  ',text('K',{color:'cyan',bold:true}),' search'),
    text(' '+scopeLabel(filters,user)+'  ·  Partition: '+filters.partition+'  ·  Status: '+filters.status+'  ·  GPU: '+filters.gpu+(filters.query?'  ·  Search: '+filters.query:''),{color:'gray'}),
    h(Box,{justifyContent:'space-between'},
      h(Box,{width:logButtons.length?width-23:width},text(error?' STALE · '+error:' '+(selected?selected.id+' · '+selected.name+(selected.state==='PENDING'?' · Waiting: '+selected.reason:''):row?.path||'Slurm queue'),{color:error||selected?.state==='PENDING'?'yellow':'cyan'})),
      ...logButtons),
    modalContent||h(Box,{height:body},sidebar?queue(sidebar,true):null,main),
    text(' '+status,{color:error||/error|failed|denied|invalid/i.test(status)?'yellow':'gray'}),
    text(draft?(preview?' E edit · T validate · U submit · Esc discard':' Enter edit · V preview · T validate · Esc discard'):
      filterDraft?' ↑↓ fields · Enter options · A apply · X reset · Esc discard':
      ' ↑↓ select/scroll · PgUp/PgDn Home/End · Enter open · Tab focus · F filters · K search',{color:'gray'}),
    h(Text,{wrap:'truncate'},' ',shortcut('S',' queue  '),shortcut('O',' overview  '),shortcut('L',' logs  '),shortcut('/',' split  '),shortcut('B',' open script  '),shortcut('E',' edit/rerun  '),shortcut('C',' cancel  '),shortcut('?',' help  '),shortcut('Q',' quit'))
  );
}
