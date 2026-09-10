import React,{useEffect,useRef,useState} from 'react';
import {Box,Text,useInput,useApp,useStdout} from 'ink';
import wrapAnsi from 'wrap-ansi';
import {request,clean,active,failed,diagnosis} from './client.js';
import {PANELS,GLOBAL_PANELS,JOB_PANELS,DEFAULT_FILTERS,filterJobs,queueRows,moveIndex,stateOf,statusColor,sampleMetrics,appendSample,plot,formatBytes,projectOf,projectSummary,pendingAdvice,dateLabel,runtimeSummary,queueColumns,rowWindow} from './model.js';
import {FIELDS,parseBatch,buildBatch,validateBatch} from './batch.js';
import {saveConfig,validateConfig} from './config.js';
import {importGuides,fieldAdvice} from './guides.js';
import {HELP,footerFor} from './help.js';

const h=React.createElement;
const text=(value,props={})=>h(Text,{wrap:'truncate',...props},clean(value));
const clamp=(n,max)=>Math.max(0,Math.min(Math.max(0,max),n));
const fit=(v,n)=>{const chars=Array.from(clean(v??'—'));return (chars.length>n?chars.slice(0,n-1).join('')+'…':chars.join('')).padEnd(n);};
const terminalKey=key=>key.upArrow||key.downArrow||key.pageUp||key.pageDown||key.home||key.end;
const scopeLabel=(f,user)=>f.scope==='mine'?'My jobs ('+user+')':f.scope==='all'?'All visible users':f.username;
// ANSI colors follow the user's terminal theme; status hues survive selection.
const selectedStyle={backgroundColor:'blue',bold:true};
const shortcut=(key,label)=>h(Text,null,h(Text,{color:'cyan',bold:true},key),h(Text,{color:'gray'},label));
const SETTINGS_FIELDS=[['sshHost','SSH host','Enter an SSH alias or host name. Use local on a Slurm login node.'],['remoteUser','My Slurm username','The username used by My jobs. This does not change your SSH login.'],['historyDays','History days','Choose 1 to 365 days. A shorter window loads faster.'],['refreshSeconds','Refresh interval (seconds)','Choose 1 to 300 seconds. Default: 1 second. Requests do not overlap.'],['projectMode','Projects grouped by','Choose directory or script.'],['guideFolder','Local guide folder','Optional folder on this computer with Markdown user guides. Clear to remove imported advice.']];

export function App({host:initialHost,user:initialUser,days:initialDays,config={},persist=saveConfig,mouse=false,input,api=request}) {
  const [settings,setSettings]=useState({...config,sshHost:initialHost,remoteUser:initialUser,historyDays:initialDays,projectMode:config.projectMode||'directory',refreshSeconds:config.refreshSeconds??1});
  const {sshHost:host,remoteUser:user,historyDays:days,projectMode,refreshSeconds}=settings;
  const [settingsDraft,setSettingsDraft]=useState(null),[settingsIndex,setSettingsIndex]=useState(0);
  const [projectKey,setProjectKey]=useState(''),[scheduling,setScheduling]=useState(null),[resources,setResources]=useState(null);
  const [metricFetched,setMetricFetched]=useState(null);
  const {exit}=useApp(),{stdout}=useStdout();
  const [size,setSize]=useState([stdout.columns||120,stdout.rows||32]);
  const [panel,setPanel]=useState('s'),[focus,setFocus]=useState('queue');
  const [data,setData]=useState({jobs:[],nodes:[],warnings:[]}),[caps,setCaps]=useState(null);
  const [filters,setFilters]=useState({...DEFAULT_FILTERS}),[filterDraft,setFilterDraft]=useState(null),[field,setField]=useState(0),[choices,setChoices]=useState(null);
  const [selectedKey,setSelectedKey]=useState(''),[grouped,setGrouped]=useState(true),[folded,setFolded]=useState(new Set());
  const [detail,setDetail]=useState(null),[detailId,setDetailId]=useState(''),[detailError,setDetailError]=useState('');
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[loading,setLoading]=useState(false),[tick,setTick]=useState(0);
  const [clock,setClock]=useState(Date.now()),[updated,setUpdated]=useState(null),[modal,setModal]=useState(null);
  const [busy,setBusy]=useState(false),busyRef=useRef(false);
  const [draft,setDraft]=useState(null),[editorIndex,setEditorIndex]=useState(0),[preview,setPreview]=useState(false);
  const [offsets,setOffsets]=useState({}),[logIndex,setLogIndex]=useState(0),[split,setSplit]=useState(true),[full,setFull]=useState(false),[pageOffset,setPageOffset]=useState(0),[page,setPage]=useState(null);
  const [samples,setSamples]=useState([]),[metricError,setMetricError]=useState('');
  const limits=useRef({}),hits=useRef([]),live=useRef(null);
  const width=size[0],height=size[1],body=Math.max(8,height-10),queuePage=Math.max(1,body-5);
  const jobs=filterJobs(data.jobs,filters,user,projectMode);
  const projects=projectSummary(filterJobs(data.jobs,{...filters,project:''},user,projectMode),projectMode);
  const projectIndex=Math.max(0,projects.findIndex(p=>p.key===projectKey));
  function setProjectIndex(value){const index=typeof value==='function'?value(projectIndex):value;setProjectKey(projects[clamp(index,projects.length-1)]?.key||'');}
  const rows=queueRows(panel==='h'?jobs.filter(j=>!active(j)):jobs,grouped,folded);
  const selectedIndex=Math.max(0,rows.findIndex(r=>r.key===selectedKey));
  const row=rows[selectedIndex],selected=row?.job;
  const selectedId=selected?.id;
  live.current={selected};
  const sidebar=JOB_PANELS.some(p=>p[0]===panel)&&!filterDraft&&!draft?Math.min(33,Math.floor(width*.25)):0;
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
    load();const t=setInterval(load,refreshSeconds*1000);return()=>{clearInterval(t);c.abort();};
  },[scope,days,host,tick,api,refreshSeconds]);
  useEffect(()=>{const c=new AbortController();api(host,{op:'capabilities'},c.signal).then(v=>{if(!c.signal.aborted)setCaps(v);}).catch(e=>{if(!c.signal.aborted)setNotice('Cluster limits unavailable: '+e.message);});return()=>c.abort();},[host,tick,api]);
  useEffect(()=>{setDetail(null);setDetailId('');setDetailError('');setSamples([]);setMetricFetched(null);setScheduling(null);setPage(null);setPageOffset(0);setFull(false);setLogIndex(0);setOffsets({});},[selectedId,host]);
  useEffect(()=>{
    if(!selectedId||!JOB_PANELS.some(p=>p[0]===panel)||filterDraft||draft)return;
    const c=new AbortController();let pending=false;
    const load=async()=>{if(pending)return;pending=true;try{const result=await api(host,{op:'detail',job:live.current.selected},c.signal);if(!c.signal.aborted){setDetail(result);setDetailId(selectedId);setDetailError('');}}catch(e){if(!c.signal.aborted)setDetailError(e.message);}finally{pending=false;}};
    load();const t=setInterval(load,refreshSeconds*1000);return()=>{clearInterval(t);c.abort();};
  },[selectedId,panel,!!filterDraft,!!draft,host,tick,api,refreshSeconds]);
  useEffect(()=>{
    if(panel!=='m'||!selectedId||selected.state!=='RUNNING'||filterDraft||draft)return;
    const c=new AbortController();let timer;
    const load=async()=>{const began=Date.now();try{const result=await api(host,{op:'metrics',job:live.current.selected},c.signal);if(!c.signal.aborted){setSamples(prev=>appendSample(prev,sampleMetrics(result)));setMetricFetched(Date.now());setMetricError('');}}catch(e){if(!c.signal.aborted)setMetricError(e.message);}finally{if(!c.signal.aborted)timer=setTimeout(load,Math.max(0,Math.max(refreshSeconds,caps?.sampleSeconds||1)*1000-(Date.now()-began)));}};
    setMetricError('');load();return()=>{clearTimeout(timer);c.abort();};
  },[selectedId,selected?.state,panel,host,api,!!filterDraft,!!draft,tick,caps?.sampleSeconds,refreshSeconds]);
  useEffect(()=>{
    if(!full||!log||!selected)return;
    const c=new AbortController();setPage(null);
    api(host,{op:'log',job:selected,path:log.path,offset:pageOffset},c.signal).then(v=>{if(!c.signal.aborted){setPage(v);setOffsets(v=>({...v,logs:0}));}}).catch(e=>{if(!c.signal.aborted)setDetailError(e.message);});
    return()=>c.abort();
  },[full,log?.path,pageOffset,selectedId,host,api]);

  function navigatePanel(p){
    if(busyRef.current)return;
    if(p===','){setSettingsDraft({...settings,guideFolder:settings.guidance?.directory||''});setSettingsIndex(0);}
    else setSettingsDraft(null);
    setNotice('');setPanel(p);setFocus(p==='s'||p==='h'?'queue':'content');setOffsets(v=>({...v,[p]:0}));
  }
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
    if(index===3)return ['All','GPU requested','CPU only'].map(v=>({label:v,value:v}));
    return [{label:'All projects',value:''},...projects.map(p=>({label:p.key,value:p.key}))];
  }
  function chooseFilter(item){
    if(field===0&&item.value==='user'){setModal({kind:'username',title:'Slurm username',value:filterDraft.username||'',hint:'Visible users: '+availableUsers.join(', ')});setChoices(null);return;}
    const key=['scope','partition','status','gpu','project'][field];setFilterDraft(v=>({...v,[key]:item.value}));setChoices(null);
  }
  function saveTextModal(){
    const m=modal;setModal(null);
    if(m.kind==='search'){setFilters(v=>({...v,query:m.value}));return;}
    if(m.kind==='username'){if(!/^[\w.@-]+$/.test(m.value)){setNotice('Enter a valid Slurm username');return;}setFilterDraft(v=>({...v,scope:'user',username:m.value}));return;}
    if(m.kind==='path'){openEditor({op:'open',path:m.value});return;}
    if(m.kind==='setting'){setSettingsDraft(v=>({...v,[m.name]:m.value}));return;}
    if(m.kind==='edit'){setDraft(v=>({...v,validated:null,...(m.name==='@workdir'?{workdir:m.value}:m.name==='@command'?{command:m.value}:{edits:{...v.edits,[m.name]:m.value}})}));return;}
  }
  const editable=draft?[['@workdir','Submission directory','Existing absolute directory on the server. Relative files are resolved from here.',''],...(draft.isNew?[['@command','Command to run','Enter the command that runs your program. You will review it before submission.','']]:[]),...FIELDS,
    ...Object.keys(draft.parsed.values).filter(k=>!FIELDS.some(f=>f[0]===k)).map(k=>[k,k,'Additional original directive',''])]:[];
  function editField(index){
    const f=editable[index];if(!f)return;
    const value=f[0]==='@workdir'?draft.workdir:f[0]==='@command'?draft.command:(draft.edits[f[0]]??draft.parsed.values[f[0]]??'');
    const hints=f[0]==='partition'?(caps?.partitions||[]).map(p=>p.PartitionName+' (max time '+p.MaxTime+', max nodes '+p.MaxNodes+', accounts '+p.AllowAccounts+', QoS '+p.AllowQos+')').join('; '):f[0]==='qos'?(caps?.qos||[]).map(q=>q.name).join(', '):f[0]==='account'?(caps?.accounts||[]).map(a=>a.account).join(', '):f[0]==='constraint'?(caps?.nodes||[]).map(n=>n.AvailableFeatures).filter(Boolean).join(', '):f[0]==='gres'?(caps?.nodes||[]).map(n=>n.Gres).filter(Boolean).join(', '):'';
    const suggestions=f[0]==='partition'?availableParts:f[0]==='qos'?(caps?.qos||[]).map(q=>q.name):f[0]==='account'?[...new Set((caps?.accounts||[]).map(a=>a.account))]:[];
    setModal({kind:'edit',title:f[1],name:f[0],value,suggestions,suggestion:-1,hint:f[2]+(hints?' · Live choices: '+hints:'')+'\n'+(suggestions.length?'↑↓ selects a suggested value. You can also type a value.\n':'')+'Enter saves this field. Press ? in the field list for local guide advice.'});
  }
  const draftScript=()=>buildBatch(draft.parsed,draft.edits)+(draft.isNew?'\n'+draft.command+'\n':'');
  function draftErrors(){return [...validateBatch(draft.parsed,draft.edits,caps),...(draft.isNew&&!draft.command?.trim()?['Enter the command to run.']:[])];}
  function checkDraft(){const errors=draftErrors();if(errors.length){setNotice(errors.join(' · '));return;}const script=draftScript();operation({op:'validate',script,workdir:draft.workdir},r=>setDraft(v=>({...v,validated:{script,workdir:v.workdir,result:r.result}})));}
  function review(){
    const errors=draftErrors();
    if(errors.length){setNotice(errors.join(' · '));return;}
    setPreview(true);setOffsets(v=>({...v,editor:0}));
    setNotice('Read the script. Press Enter to check it with the scheduler.');
  }
  function confirmSubmit(){
    const errors=draftErrors();
    if(errors.length){setNotice(errors.join(' · '));return;}
    if(draft.validated?.script!==draftScript()||draft.validated?.workdir!==draft.workdir){checkDraft();return;}
    setModal({kind:'submit',title:'Submit this new job?',script:draftScript(),workdir:draft.workdir,values:{...draft.parsed.values,...draft.edits}});
  }
  function applySettings(){
    try{
      const {guideFolder,...next}=settingsDraft;
      let value=validateConfig(next);
      if(guideFolder)value.guidance=importGuides(guideFolder);else delete value.guidance;
      value=persist(value);setSettings(value);setSettingsDraft(null);setData({jobs:[],nodes:[],warnings:[]});setCaps(null);setResources(null);setUpdated(null);setSelectedKey('');setFilters({...DEFAULT_FILTERS});setPanel('s');setFocus('queue');setTick(t=>t+1);setNotice('Settings saved. Connecting…');
    }catch(e){setNotice(e.message);}
  }
  function chooseProject(index){const p=projects[index];if(p){setFilters(v=>({...v,project:p.key}));setSelectedKey((p.jobs.find(failed)||p.jobs.find(j=>j.state==='PENDING')||p.jobs[0])?.id||'');navigatePanel('s');}}
  function editSetting(index){const f=SETTINGS_FIELDS[index];if(!f)return;setSettingsIndex(index);if(f[0]==='projectMode'){setSettingsDraft(v=>({...v,projectMode:v.projectMode==='directory'?'script':'directory'}));return;}setModal({kind:'setting',name:f[0],title:f[1],hint:f[2],value:String(settingsDraft[f[0]]||'')});}

  useInput((inputText,key)=>{
    const letter=inputText.toLowerCase();
    if(modal){
      if(key.escape){if(!busy)setModal(null);return;}
      if(modal.kind==='advice'){if(terminalKey(key))scroll(key,'advice');return;}
      if(modal.kind==='open'){
        if(terminalKey(key))setModal(v=>({...v,index:moveIndex(v.index,2,key,2)}));
        if(key.return){const index=modal.index;setModal(null);if(index===1)openEditor({op:'new'});else setModal({kind:'path',title:'Open an existing script',value:'',hint:'Absolute path or ~/path on '+host+'. The original file will be kept.'});}
        return;
      }
      if(['cancel','submit','discard'].includes(modal.kind)){
        if(letter==='y'&&!busy){
          const m=modal;setModal(null);
          if(m.kind==='discard'){setDraft(null);setPreview(false);setNotice('Draft discarded.');return;}
          operation(m.kind==='cancel'?{op:'cancel',job:m.job,confirmed:true}:{op:'submit',script:m.script,workdir:m.workdir,confirmed:true},
            result=>{if(m.kind==='submit'){setDraft(null);setPreview(false);setPanel('s');setFocus('queue');setGrouped(false);setFilters({...DEFAULT_FILTERS});setSelectedKey(result.jobId||'');setNotice('Submitted job '+(result.jobId||result.result)+'. It will appear after reload.');}setTick(t=>t+1);});
        }
        return;
      }
      if(key.return){saveTextModal();return;}
      if((key.upArrow||key.downArrow)&&modal.suggestions?.length){setModal(v=>{const i=moveIndex(v.suggestion,v.suggestions.length,key);return {...v,suggestion:i,value:v.suggestions[i],cursor:v.suggestions[i].length};});return;}
      if(key.home)setModal(v=>({...v,cursor:0}));
      else if(key.end)setModal(v=>({...v,cursor:v.value.length}));
      else if(key.leftArrow||key.rightArrow)setModal(v=>({...v,cursor:clamp((v.cursor??v.value.length)+(key.rightArrow?1:-1),v.value.length)}));
      else if(key.backspace||key.delete)setModal(v=>{const at=v.cursor??v.value.length;return {...v,value:v.value.slice(0,Math.max(0,at-1))+v.value.slice(at),cursor:Math.max(0,at-1)};});
      else if(key.ctrl&&letter==='u')setModal(v=>({...v,value:'',cursor:0}));
      else if(!key.ctrl&&!key.meta&&inputText)setModal(v=>{const at=v.cursor??v.value.length,insert=clean(inputText).replace(/\n/g,'');return {...v,value:v.value.slice(0,at)+insert+v.value.slice(at),cursor:at+insert.length};});
      return;
    }
    if(filterDraft){
      if(key.escape){if(choices)setChoices(null);else setFilterDraft(null);return;}
      if(choices){if(terminalKey(key))setChoices(v=>({...v,index:moveIndex(v.index,v.items.length,key,queuePage)}));else if(key.return)chooseFilter(choices.items[choices.index]);return;}
      if(terminalKey(key)){setField(v=>moveIndex(v,5,key,5));return;}
      if(key.return){setChoices({items:filterOptions(field),index:0});return;}
      if(letter==='a'){setFilters(filterDraft);setFilterDraft(null);setSelectedKey('');return;}
      if(letter==='x')setFilterDraft({...DEFAULT_FILTERS});
      return;
    }
    if(draft){
      if(busy)return;
      if(key.escape){if(preview)setPreview(false);else setModal({kind:'discard',title:'Discard this draft?'});return;}
    if(key.ctrl&&key.return){if(preview)confirmSubmit();else review();return;}
      if(letter==='t'){checkDraft();return;}
      if(letter==='v'){if(preview)setPreview(false);else review();return;}
      if(preview){if(terminalKey(key))scroll(key,'editor');else if(letter==='e')setPreview(false);else if(letter==='u'||key.return)confirmSubmit();return;}
      if(inputText==='?'){const f=editable[editorIndex];setOffsets(v=>({...v,advice:0}));setModal({kind:'advice',title:f[1]+' · help',text:f[2]+'\n\n'+liveFieldHelp(f[0])+'\n\n'+(fieldAdvice(settings.guidance,f[0])||'No local guide advice for this field. Import guides in Settings.')});return;}
      if(terminalKey(key)){setEditorIndex(i=>moveIndex(i,editable.length,key,queuePage));return;}
      if(key.return){editField(editorIndex);return;}
      return;
    }
    if(settingsDraft){if(key.escape){setSettingsDraft(null);navigatePanel('s');return;}if(terminalKey(key)){setSettingsIndex(i=>moveIndex(i,SETTINGS_FIELDS.length,key,5));return;}if(key.return)editSetting(settingsIndex);else if(letter==='a')applySettings();return;}
    if(busy)return;
    if(key.escape){navigatePanel('s');return;}
    if(letter==='q'){if(busy){setNotice('Wait for the current action to finish before exiting.');return;}exit();return;}
    if(letter==='f'){setFilterDraft({...filters});setField(0);setChoices(null);return;}
    if(letter==='k'){setModal({kind:'search',title:'Search jobs',value:filters.query,hint:'Job ID, name, user, state, partition, nodes, resources or script path · Ctrl+U clears'});return;}
    if(letter==='b'){setModal({kind:'open',title:'Prepare a job',index:0});return;}
    const jobPage=panel==='s'||panel==='h'||JOB_PANELS.some(p=>p[0]===panel);
    if(letter==='e'&&selected&&jobPage){openEditor({op:'script',job:selected});return;}
    if(letter==='c'&&selected&&jobPage){if(!active(selected)){setNotice('This job has finished. E prepares a new run.');return;}setModal({kind:'cancel',title:'Cancel job '+selected.id+'?',job:{...selected}});return;}
    if(letter==='w'&&selected&&panel==='o'){operation({op:'scheduling',job:selected},r=>setScheduling({...r,jobId:selected.id}));return;}
    if(letter==='a'&&panel==='n'){operation({op:'resources',user:scope||user},setResources);return;}
    if(letter==='r'){setTick(t=>t+1);return;}
    if(inputText==='/'){setSplit(v=>!v);navigatePanel('l');return;}
    if(inputText==='?'){navigatePanel('?');return;}
    if(PANELS.some(p=>p[0]===letter)){navigatePanel(letter);return;}
    if(panel==='d'){
      if(terminalKey(key))setProjectIndex(i=>moveIndex(i,projects.length,key,Math.max(1,Math.floor((body-9)/3))));
      else if(key.return)chooseProject(clamp(projectIndex,projects.length-1));
      else if(letter==='g'){setSettings(v=>({...v,projectMode:v.projectMode==='directory'?'script':'directory'}));setFilters(v=>({...v,project:''}));setProjectIndex(0);}
      else if(letter==='x')setFilters(v=>({...v,project:''}));
      return;
    }
    if(key.tab){if(sidebar)setFocus(f=>f==='queue'?'content':'queue');return;}
    if(panel==='s'||panel==='h'||focus==='queue'){
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
      if(e.release||busy)return;
      if(modal){if(modal.kind==='advice'&&(e.button===64||e.button===65))scroll({[e.button===65?'downArrow':'upArrow']:true},'advice');return;}
      const hit=[...hits.current].reverse().find(r=>e.x>=r.x&&e.x<r.x+r.w&&e.y>=r.y&&e.y<r.y+r.h);
      if(e.button===64||e.button===65){const key={[e.button===65?'downArrow':'upArrow']:true};
        if(filterDraft){if(choices)setChoices(v=>({...v,index:moveIndex(v.index,v.items.length,key)}));else setField(v=>moveIndex(v,5,key));}
        else if(draft)setEditorIndex(v=>moveIndex(v,editable.length,key));
        else if(settingsDraft)setSettingsIndex(v=>moveIndex(v,SETTINGS_FIELDS.length,key));
        else if(panel==='d')setProjectIndex(v=>moveIndex(v,projects.length,key));
        else if(hit?.queue){selectAt(selectedIndex+(e.button===65?1:-1));}else scroll(key,panel==='l'?'logs':panel);return;}
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
  function frame(title,content,w=contentWidth,accent='cyan',focused=modal||filterDraft||draft||focus==='content'||panel==='s'||panel==='h'){
    return h(Box,{width:w,height:body,flexShrink:0,borderStyle:'round',borderColor:focused?accent:'gray',borderDimColor:!focused,paddingX:1,flexDirection:'column',overflow:'hidden'},
      text(title,{bold:true,color:accent}),content);
  }
  function queue(w,compact=false){
    const columns=queueColumns(w-4),nameWidth=columns.find(c=>c[0]==='name')[2];
    const nameLines=r=>wrapAnsi(clean(r.job?.name||''),nameWidth,{hard:true,trim:false}).split('\n');
    const view=rowWindow(rows,selectedIndex,queuePage,r=>!compact&&r.job?Math.min(3,nameLines(r).length):1);
    let screenY=9;
    const title=panel==='h'?'HISTORY':'SLURM';
    return frame(compact?'JOBS':title+' · '+(panel==='h'?jobs.filter(j=>!active(j)).length:jobs.length)+' jobs · '+(grouped?'script groups':'all rows'),
      h(Box,{flexDirection:'column',flexGrow:1},
        text(compact?'Select a job':'  '+columns.map(c=>fit(c[1],c[2])).join(' '),{color:'gray',bold:true}),
        ...view.items.map((r,i)=>{
          const rowHeight=view.heights[i];
          hit(0,screenY,w-2,rowHeight,()=>{setSelectedKey(r.key);setFocus('queue');if(r.job)navigatePanel('o');else toggleGroup(r.path);},true);screenY+=rowHeight;
          const chosen=r.key===row?.key;
          const marker=text(chosen?'› ':'  ',{color:'cyan'});
          if(!r.job||compact)return h(Box,{key:r.key,width:w-4,height:1,...(chosen?{backgroundColor:'blue'}:{})},h(Text,{wrap:'truncate',bold:chosen},marker,text(r.job?r.job.id+' '+r.job.name:(folded.has(r.path)?'▸ ':'▾ ')+r.label+' · '+r.count+' jobs',{color:r.job?statusColor(r.job.state):'cyan'})));
          return h(Box,{key:r.key,width:w-4,height:rowHeight,flexDirection:'column',...(chosen?{backgroundColor:'blue'}:{})},...Array.from({length:rowHeight},(_,line)=>h(Text,{key:line,wrap:'truncate',bold:chosen},line===0?marker:'  ',...columns.map(([key,label,n])=>{
            const value=key==='name'?nameLines(r)[line]:line?'':key==='submitted'?dateLabel(r.job.submitted):r.job[key];
            return text((line&&key!=='name'?' '.repeat(n):fit(value,n))+' ',{key,color:key==='state'?statusColor(r.job.state):key==='id'?'cyan':chosen?'white':key==='name'?undefined:'gray'});
          }))));
        }),
        !rows.length?text(loading?'Loading jobs…':'No matching jobs. F opens filters.',{color:'gray'}):null,
        h(Box,{flexGrow:1}),
        text(compact?(rows.length?`${selectedIndex+1} / ${rows.length} · Tab focus`:'F filters'):
          `${rows.length?view.start+1:0}–${view.start+view.items.length} / ${rows.length} rows  ·  ${row?.path||'Select a job; Enter opens its details'}`,{color:'gray'})
      ),w,'cyan',focus==='queue'||panel==='s'||panel==='h');
  }
  function metricChart(label,key,unit,color,values,ceiling){
    const p=plot(values,key,Math.max(15,contentWidth-18),4,ceiling);
    return [text(label+' · '+unit,{color,bold:true,key:label}),...p.lines.map((l,i)=>text(l,{color,key:label+i})),
      text(p.start?'       └'+ '─'.repeat(Math.max(15,contentWidth-18)):'',{key:label+'axis',color:'gray'}),
      text(p.start?'        '+new Date(p.start*1000).toLocaleTimeString()+' → '+new Date(p.end*1000).toLocaleTimeString():'',{key:label+'time',color:'gray'})];
  }
  function liveFieldHelp(field){
    if(!caps)return 'Live cluster limits are not available yet. R reloads them from a normal page.';
    if(field==='partition'||field==='time'||field==='nodes'||field==='mem'||field==='mem-per-cpu')return (caps.partitions||[]).map(p=>`${p.PartitionName}: time ${p.MaxTime||'unknown'} · nodes ${p.MaxNodes||'unknown'} · default time ${p.DefaultTime||'unset'} · memory/CPU ${p.DefMemPerCPU||'unset'} MiB`).join('\n');
    if(field==='qos')return (caps.qos||[]).map(q=>`${q.name}: max time ${q.maxWall||'unset'} · per-user resources ${q.maxTres||'unset'} · running ${q.maxJobs||'unset'} · submitted ${q.maxSubmit||'unset'}`).join('\n');
    if(field==='account')return (caps.accounts||[]).map(a=>`${a.account}: QoS ${a.qos||'unset'} · default QoS ${a.defaultQos||'unset'} · running ${a.maxJobs||'unset'} · submitted ${a.maxSubmit||'unset'}`).join('\n')||'No account associations were visible. Enter the account from your cluster guide, or leave this field empty for the default. The scheduler check will verify it.';
    if(['gres','gpus','constraint','nodelist','exclude'].includes(field))return (caps.nodes||[]).map(n=>`${n.NodeName}: ${n.Gres||'no resources listed'} · features ${n.AvailableFeatures||'none'}`).join('\n');
    if(field==='array')return 'Largest permitted task index: '+(Number(caps.config?.MaxArraySize)>0?Number(caps.config.MaxArraySize)-1:'unknown')+'. Use %N to limit the number of tasks running at once.';
    return 'The scheduler checks the full combination of options before submission.';
  }
  let main;
  if(filterDraft){
    const labels=[['User scope',scopeLabel(filterDraft,user)],['Partition',filterDraft.partition],['Status',filterDraft.status],['GPU allocation',filterDraft.gpu],['Project',filterDraft.project||'All projects']];
    const options=choices?.items||[];
    const optionStart=choices?clamp(choices.index-Math.floor(queuePage/2),options.length-queuePage):0;
    main=frame('FILTERS'+(choices?' · '+labels[field][0]:''),h(Box,{flexDirection:'column'},
      text(choices?'Choose a value. Enter saves it. Esc returns to the fields.':'Choose a field. Changes apply only when you press A.',{color:'gray'}),
      ...(choices?options.slice(optionStart,optionStart+queuePage).map((o,i)=>{hit(1,9+i,width-2,1,()=>chooseFilter(o));return text((optionStart+i===choices.index?'› ':'  ')+o.label,{key:o.value,...(optionStart+i===choices.index?selectedStyle:{})});}):
        labels.map(([label,value],i)=>{hit(1,9+i,width-2,1,()=>{setField(i);setChoices({items:filterOptions(i),index:0});});return text((field===i?'› ':'  ')+fit(label,20)+' '+value+'  ›',{key:label,...(field===i?selectedStyle:{}),color:field===i?'cyan':undefined});}))
    ),width);
  }else if(draft){
    if(preview)main=frame('SUBMISSION PREVIEW · 2 Review → 3 Check → 4 Submit',h(Box,{flexDirection:'column'},
      text(draft.validated?'✓ Scheduler check passed. Enter opens the final confirmation.':'Read the complete script. Enter checks it without submitting.',{color:draft.validated?'green':'cyan'}),
      linesView('SUBMISSION DIRECTORY\n'+draft.workdir+'\n\n'+draftScript(),width-4,'editor',body-5)),width);
    else{
      const fieldPage=Math.max(2,body-7),start=clamp(editorIndex-Math.floor(fieldPage/2),editable.length-fieldPage);
      const f=editable[editorIndex];
      const fieldWidth=width>=120?Math.floor((width-4)*.56):width-4;
      main=frame('BATCH EDITOR · 1 Edit → 2 Review → 3 Check → 4 Submit',h(Box,{flexDirection:'column'},
        text(draft.source,{color:'gray'}),
        h(Box,null,h(Box,{width:fieldWidth,flexDirection:'column'},...editable.slice(start,start+fieldPage).map((f,i)=>{
          hit(1,9+i,fieldWidth,1,()=>{setEditorIndex(start+i);editField(start+i);});
          const value=f[0]==='@workdir'?draft.workdir:f[0]==='@command'?draft.command:draft.edits[f[0]]??draft.parsed.values[f[0]]??'';
          return text((start+i===editorIndex?'› ':'  ')+fit(f[1],24)+' '+(value||'— default / omitted'),{key:f[0],...(start+i===editorIndex?selectedStyle:{}),color:Object.hasOwn(draft.edits,f[0])?'yellow':value?undefined:'gray'});
        })),width>=120?h(Box,{width:width-4-fieldWidth,paddingLeft:2,flexDirection:'column'},text(f[1],{bold:true,color:'cyan'}),linesView(f[2]+'\n\nLIVE LIMITS\n'+liveFieldHelp(f[0])+'\n\n'+fieldAdvice(settings.guidance,f[0]),width-fieldWidth-8,'fieldHelp',fieldPage-1)):null),
        text(f?.[2]||'',{color:'gray'}),text('? More field help · V Review and continue',{color:'cyan'}),
        text(draft.parsed.warnings.join(' · '),{color:'yellow'})
      ),width);
    }
  }else if(settingsDraft){
    main=frame('SETTINGS · private to this computer',h(Box,{flexDirection:'column'},text('Select a setting. Enter changes it. A saves and reconnects.',{color:'gray'}),
      ...SETTINGS_FIELDS.map(([key,label],i)=>{hit(1,9+i,width-2,1,()=>editSetting(i));return text((i===settingsIndex?'› ':'  ')+fit(label,29)+' '+(settingsDraft[key]||'— optional'),{key,...(i===settingsIndex?selectedStyle:{})});}),
      text(''),text(settings.guidance?'Guide advice imported from '+settings.guidance.filesRead+' files. Saving imports the folder again.':'No guide advice imported. Cluster limits are discovered automatically.',{color:'gray'})
    ),width);
  }else if(panel==='s'||panel==='h')main=queue(width);
  else if(panel==='d'){
    const index=clamp(projectIndex,projects.length-1),capacity=Math.max(1,Math.floor((body-8)/3)),start=clamp(index-Math.floor(capacity/2),projects.length-capacity);
    const current=projects[index];
    const urgent=current?.jobs.find(failed),waiting=current?.jobs.find(j=>j.state==='PENDING');
    const action=urgent?`${urgent.id} ${urgent.state}: Enter → select job → L to inspect logs before rerunning.`:waiting?`${waiting.id}: ${pendingAdvice(waiting.reason)}`:current?.running?'Work is running. Enter → select job → M to inspect measured use.':'Choose a project to inspect its runs or prepare the next job.';
    const listWidth=width>=130?Math.floor((width-4)*.53):width-4,labelWidth=Math.max(18,listWidth-31);
    const recent=current?.jobs.slice(0,5)||[];
    const reasons=[...new Set((current?.jobs||[]).filter(j=>j.state==='PENDING').map(j=>j.reason||'Not supplied'))];
    main=frame('DASHBOARD · '+scopeLabel(filters,user)+' · projects by '+projectMode,h(Box,{flexDirection:'column'},
      text(fit('PROJECT',labelWidth+2)+'RUN    WAIT     OK    FAILED',{color:'gray',bold:true}),
      h(Box,null,h(Box,{width:listWidth,flexDirection:'column'},
      ...projects.slice(start,start+capacity).map((p,i)=>{
        const chosen=start+i===index;hit(1,9+i*3,listWidth,3,()=>{setProjectIndex(start+i);chooseProject(start+i);});
        return h(Box,{key:p.key,flexDirection:'column',height:3,...(chosen?{backgroundColor:'blue'}:{})},h(Text,null,text((chosen?'› ':'  ')+fit(p.key.split('/').filter(Boolean).at(-1)||p.key,labelWidth),{bold:chosen,color:'cyan'}),text(fit(p.running,7),{color:'green'}),text(fit(p.pending,8),{color:'yellow'}),text(fit(p.completed,6),{color:'green'}),text(String(p.failed),{color:'red'})),text('  '+p.key,{color:chosen?'white':'gray',wrap:'truncate-middle'}),text(''));
      }),
      !projects.length?text('No matching projects. F opens filters.',{color:'gray'}):null),
      width>=130?h(Box,{width:width-4-listWidth,paddingLeft:2,flexDirection:'column',height:Math.max(3,capacity*3)},
        text('SELECTED PROJECT',{color:'cyan',bold:true}),text((current?.jobs.length||0)+' runs in this history window',{color:'gray'}),
        text((current?.jobs.filter(j=>j.state==='RUNNING').reduce((n,j)=>n+(Number(j.cpus)||0),0)||0)+' CPUs allocated to running jobs',{color:'gray'}),
        text('RECENT RUNS',{color:'cyan',bold:true}),...recent.map(j=>text(j.id+' '+fit(j.state,14)+' '+dateLabel(j.submitted)+' '+j.name,{key:j.id,color:statusColor(j.state)})),
        ...(reasons.length?[text('WAITING REASONS',{key:'reasons',color:'yellow',bold:true}),...reasons.slice(0,3).map(r=>text(r,{key:r,color:'yellow'}))]:[])):
        null),
      text('NEXT ACTION',{color:'cyan',bold:true}),text(action,{wrap:'wrap'}),
      text(`${projects.length?index+1:0} / ${projects.length} projects · G switches directory/script · F changes scope`,{color:'gray'})
    ),width);
  }
  else if(panel==='n'){
    const nodes=data.nodes.filter(n=>filters.partition==='All'||n.partition?.replace('*','')===filters.partition);
    main=frame('NODES · partition '+filters.partition,linesView(nodes.map(n=>n.name+'  '+n.state.toUpperCase()+'  '+n.partition+'\nCPUs allocated / idle / other / total: '+n.cpus+'  · RAM capacity '+n.memory+' MiB\nGRES '+(n.gres||'—')+'  · Reason: '+n.reason+'\n').join('\n')+
      '\nPARTITION LIMITS\n'+liveFieldHelp('partition')+'\n\nACCOUNT SHARES AND RESERVATIONS · A loads these details\n'+(resources?(resources.warning||'')+'\n'+resources.shares.map(s=>s.account+' · '+s.user+' · fair-share factor '+(s.fairshare||'unavailable')+' · weighted, decayed usage '+s.usage).join('\n')+'\n'+resources.reservations.map(r=>r.ReservationName+' · '+r.StartTime+' → '+r.EndTime+' · nodes '+r.Nodes+' · accounts '+r.Accounts).join('\n')+'\nChecked '+new Date(resources.time*1000).toLocaleTimeString():'')));
  }else if(panel==='?'){
    main=frame('HELP · find work, read results, prepare a job',linesView(HELP));
  }else if(!selected)main=frame('SELECT A JOB',text(row?.path?'This is a script group. Expand it and select a job.':'No job matches the current filters. Press F.'));
  else if(panel==='l'){
    if(!logs.length)main=frame('LOGS · '+selected.id,text(detailError||(!detail?'Loading…':'No readable log paths found. Other-user files may be private.'),{wrap:'wrap'}));
    else{
      const visible=split&&!full?logs.slice(0,2):[log],pw=Math.floor(contentWidth/visible.length);
      main=h(Box,{width:contentWidth},...visible.map((l,i)=>{
        hit(sidebar+i*pw,6,pw,body,()=>{setFocus('content');setLogIndex(logs.indexOf(l));});
        return h(Box,{key:l.path,width:pw,height:body,borderStyle:'round',borderColor:log===l&&focus==='content'?'cyan':'gray',paddingX:1,flexDirection:'column'},
          text(l.source+(full?' · FULL FILE':' · TAIL'),{bold:true,color:'cyan'}),text(l.path,{color:'gray',wrap:'truncate-middle'}),
          linesView(full?(page?.text||'Loading file…'):l.text,pw-4,'logs',body-6),
          text(full&&page?'Bytes '+page.offset+'–'+page.next+' / '+page.size+' · [ ] chunks':'V full file · / split · arrows select file',{color:'gray'})
        );
      }));
    }
  }else if(panel==='m'){
    const stats=runtimeSummary(selected,detail);
    const summary=`${selected.state} · ${selected.cpus||'—'} CPUs · RAM request ${selected.memory||'—'} · ${selected.gres||'no GPU request'}\n`+
      `Run time ${selected.elapsed||'—'} / ${selected.limit||'no limit recorded'}${stats.timePercent!=null?' · '+stats.timePercent.toFixed(1)+'% of time limit (not task progress)':''}\n`+
      `CPU efficiency ${stats.efficiency!=null?stats.efficiency.toFixed(1)+'% of allocated CPU time':'unavailable'} · largest recorded task RSS ${formatBytes(stats.peak)}\n`;
    const advice=stats.efficiency!=null&&stats.efficiency<50?'CPU use is low relative to the allocation. Check thread settings, I/O waits and requested CPUs.':stats.timePercent>90?'The time limit is nearly used. Check progress and save a checkpoint if your program supports it.':'Compare several similar runs before changing the resource request.';
    if(selected.state!=='RUNNING')main=frame('METRICS · '+selected.id,linesView(selected.state==='PENDING'?'WAITING FOR RESOURCES\nNo usage exists before this job starts.\n\n'+pendingAdvice(selected.reason)+'\n\n'+summary:
      summary+'\n'+advice+'\n\nRECORDED STEPS\n'+stats.steps.map(s=>s.id+' · '+s.state+' · CPU time '+(s.cpu||'unavailable')+'\nLargest task RSS '+(s.rss||'unavailable')+' · node '+(s.peakNode||'—')+' · task '+(s.peakTask||'—')+'\nAverage bytes/task read '+(s.read||'unavailable')+' · written '+(s.write||'unavailable')).join('\n\n')+
      '\n\nPeak task RSS is not total job memory. CPU efficiency = CPU time / (allocated CPUs × elapsed time).\nSlurm can omit measurements or report zero when a plugin does not provide them.'));
    else{
      const values=samples.map(p=>({...p,rssGiB:p.rss==null?null:p.rss/1024**3})),last=samples.at(-1);
      const charts=[...summary.trim().split('\n').map((s,i)=>text(s,{key:'summary'+i,color:'gray'})),
        text(metricError||'Read '+(metricFetched?new Date(metricFetched).toLocaleTimeString():'pending')+' · counters last changed '+(last?new Date(last.time*1000).toLocaleTimeString():'unknown'),{key:'freshness',color:metricError?'yellow':'gray'}),
        ...metricChart('CPU · '+(last?.cores!=null?last.cores.toFixed(2)+' cores':'waiting for two distinct CPU readings'),'cores','estimated cores from counter changes','cyan',values,Number(selected.cpus)||null),
        ...metricChart('Memory · '+formatBytes(last?.rss),'rssGiB','GiB · sum of reported current task RSS','green',values),
        text(last?.gpu!=null?'GPU counter reported by Slurm: '+last.gpu+' · highest step average; not a device-wide live reading':'GPU measurements unavailable. A GPU request does not prove GPU use.',{key:'gpu',color:last?.gpu!=null?'magenta':'gray'}),
        text('Slurm collection '+(caps?.sampleSeconds||'?')+'s · unchanged counters are cached · chart covers this viewing session',{key:'cadence',color:'gray'}),
        text(advice,{key:'advice',color:'cyan'})];
      limits.current.m=Math.max(0,charts.length-(body-4));
      const start=clamp(offsets.m||0,limits.current.m);
      main=frame('METRICS · '+selected.id,h(Box,{flexDirection:'column'},...charts.slice(start,start+body-4)));
    }
  }else{
    const meta=detail?.meta||{};
    main=frame('OVERVIEW · '+selected.id,linesView(selected.name+' · '+selected.user+'\n'+selected.state+' · exit '+(selected.exit||meta.ExitCode||'—')+'\n\n'+
      diagnosis(selected,detail).join('\n')+'\n\nPartition '+selected.partition+' · nodes '+(selected.nodes||'—')+'\nElapsed '+selected.elapsed+' / '+(selected.limit||meta.TimeLimit||'—')+
      '\nCPUs '+selected.cpus+' · requested RAM '+selected.memory+' · GRES '+(selected.gres||'none')+
      '\nAccount '+(selected.account||meta.Account||'—')+' · QoS '+(selected.qos||meta.QOS||'—')+' · Priority '+(selected.priority||meta.Priority||'—')+
      '\n\nDATES\nSubmitted '+dateLabel(selected.submitted||meta.SubmitTime)+'\nEligible '+dateLabel(selected.eligible||meta.EligibleTime)+'\n'+(selected.state==='PENDING'?'Estimated start ':'Started ')+dateLabel(selected.start||meta.StartTime)+'\nEnded '+dateLabel(selected.end||meta.EndTime)+
      '\nDependency '+(selected.dependency||meta.Dependency||'none recorded')+
      (selected.state==='PENDING'?'\n\n'+pendingAdvice(selected.reason):'')+
      '\n\nSTART AND PRIORITY · W requests details\n'+(scheduling?.jobId===selected.id?(scheduling.estimate.map(s=>'Estimated start '+dateLabel(s.start)+' · '+s.reason).join('\n')||'No start estimate published.')+'\n'+(scheduling.priority.map(p=>'Weighted priority '+p.total+' · age '+p.age+' · fair-share '+p.fairshare+' · QoS '+p.qos+' · partition '+p.partition+' · resources '+p.tres).join('\n')||'Priority factors unavailable.')+'\nEstimates can change. Checked '+new Date(scheduling.time*1000).toLocaleTimeString():'')+
      '\nScript '+(selected.script||meta.Command||'unavailable')+'\nDirectory '+(selected.workdir||meta.WorkDir||'unavailable')+
      '\n\nLOGS · L opens viewer\n'+logs.map(l=>l.source+': '+l.path).join('\n')+
      '\n\nACCOUNTING\n'+(detail?.steps||[]).map(s=>s.id+' '+s.state+' · exit '+s.exit+' · derived exit '+(s.derivedExit||'—')+' · largest task RSS '+(s.rss||'—')+' · CPU '+(s.cpu||'—')).join('\n')));
  }
  hit(sidebar,6,contentWidth,body,()=>setFocus('content'));
  // More specific mouse targets must win over the content background.
  if(hits.current.length>1){const background=hits.current.pop();hits.current.unshift(background);}
  function navigation(items,y,prefix){
    let x=prefix.length;
    return h(Text,{wrap:'truncate'},text(prefix,{color:'gray'}),...items.map(([key,label])=>{
      const special=key===','||key==='?',shown=special?'['+key+'] '+label:label;
      if(!modal&&!draft&&!filterDraft&&!settingsDraft)hit(x,y,shown.length+3,1,()=>navigatePanel(key));x+=shown.length+3;
      return h(Text,{key,color:panel===key?'white':'gray',bold:panel===key},text(special?'['+key+'] ':label[0],{color:'cyan',bold:true}),special?label:label.slice(1),'   ');
    }));
  }
  const nav=navigation(GLOBAL_PANELS,2,' ALL  '),jobNav=navigation(JOB_PANELS,3,' JOB  ');
  const logButtons=selected&&logs.length&&JOB_PANELS.some(p=>p[0]===panel)?['stdout','stderr'].map((kind,i)=>{
    const index=logs.findIndex(l=>new RegExp(kind==='stdout'?'stdout|output':'stderr|error','i').test(l.source));
    if(!modal&&!draft&&!filterDraft)hit(width-22+i*11,5,10,1,()=>{if(index>=0){setLogIndex(index);setSplit(false);navigatePanel('l');}});
    return text('['+kind+']',{key:kind,color:index>=0?'cyan':'gray'});
  }):[];
  let modalContent=null;
  if(modal){
    const confirm=['cancel','submit','discard'].includes(modal.kind);
    const info=modal.kind==='cancel'?'Job '+modal.job.id+' · '+modal.job.name+' · '+modal.job.user+'\nSlurm applies your existing cancellation permissions.':
      modal.kind==='submit'?'Submission directory: '+modal.workdir+'\nJob: '+(modal.values['job-name']||'scheduler default')+' · partition '+(modal.values.partition||'default')+' · time '+(modal.values.time||'default')+'\nArray: '+(modal.values.array||'no array')+'\nThis sends the checked script as a NEW job. Your original job is not changed.':modal.kind==='discard'?'Unsaved field changes will be discarded. The original script is kept.':modal.hint;
    if(modal.kind==='advice')modalContent=frame(modal.title,linesView(modal.text,width-4,'advice'),width);
    else if(modal.kind==='open')modalContent=frame('PREPARE A JOB',h(Box,{flexDirection:'column'},text('Choose where to start.',{color:'gray'}),...['Open an existing script on the server','Create a new job'].map((label,i)=>text((modal.index===i?'› ':'  ')+label,{key:label,...(modal.index===i?selectedStyle:{})}))),width);
    else{
      const at=modal.cursor??modal.value?.length??0,start=Math.max(0,at-width+12);
      const inputLine=confirm?'Y confirm · Esc go back':(start?'‹ ':'> ')+modal.value.slice(start,at)+'▌'+modal.value.slice(at,at+Math.max(0,width-8-(at-start)));
      modalContent=frame(modal.title,h(Box,{flexDirection:'column'},linesView(info,width-4,'modalInfo',Math.max(2,body-7)),
        text(inputLine,{color:confirm?'yellow':'cyan'}),
        text(confirm?'':'Enter save · Ctrl+U clear · ←/→ cursor · Home/End · Esc cancel',{color:'gray'})),width,'yellow');
    }
  }
  if(width<80||height<22)return h(Box,{flexDirection:'column'},text('seejobs needs at least 80 columns × 22 rows. Enlarge the terminal.'),text('Q quit'));
  const status=busy?'Working…':notice||error||detailError||data.warnings.join(' · ')||'Ready';
  const footers=footerFor({modal,filter:filterDraft,draft,preview,validated:!!draft?.validated,panel,job:!!selected,cancellable:!!selected&&active(selected),group:row?.path&&!row?.job,full,focus,busy});
  const footerLine=s=>h(Text,{key:s,wrap:'truncate'},' ',...s.split(' · ').map((part,i)=>h(Text,{key:i},i?' · ':'',shortcut(part.split(' ')[0],part.includes(' ')?' '+part.split(' ').slice(1).join(' '):''))));
  return h(Box,{width,height:height-1,flexDirection:'column'},
    h(Box,{height:1,flexShrink:0,justifyContent:'space-between'},text(' ◉ seejobs',{color:'cyan',bold:true}),text('◷ '+new Date(clock).toLocaleTimeString()+' · '+refreshSeconds+'s · '+(loading?'refreshing':updated?'updated '+new Date(updated).toLocaleTimeString():'connecting'),{color:'gray'})),
    h(Text,{wrap:'truncate'},' ',text('● '+jobs.filter(j=>j.state==='RUNNING').length+' running',{color:'green'}),'   ',text('◷ '+jobs.filter(j=>j.state==='PENDING').length+' pending',{color:'yellow'}),'   ',text('✓ '+jobs.filter(j=>j.state==='COMPLETED').length+' completed',{color:'green'}),'   ',text('× '+jobs.filter(failed).length+' unsuccessful',{color:'red'}),text('   ·   '+days+' day history',{color:'gray'})),
    nav,jobNav,
    text(' '+scopeLabel(filters,user)+'  ·  Partition: '+filters.partition+'  ·  Status: '+filters.status+'  ·  GPU: '+filters.gpu+(filters.project?' · Project: '+filters.project:'')+(filters.query?'  ·  Search: '+filters.query:''),{color:'gray'}),
    h(Box,{height:1,flexShrink:0,justifyContent:'space-between'},
      h(Box,{width:logButtons.length?width-23:width},text(error?' STALE · '+error:' '+(selected?selected.id+' · '+selected.name+(selected.state==='PENDING'?' · Waiting: '+selected.reason:''):row?.path||'Slurm queue'),{color:error||selected?.state==='PENDING'?'yellow':'cyan'})),
      ...logButtons),
    modalContent||h(Box,{height:body,flexShrink:0},sidebar?queue(sidebar,true):null,main),
    text(' '+status,{color:error||/error|failed|denied|invalid/i.test(status)?'yellow':'gray'}),
    ...footers.map(footerLine)
  );
}
