export const FIELDS = [
  ['job-name','Job name','A recognizable name in the queue','J'],
  ['partition','Partition','Choose a partition discovered on the server','p'],
  ['account','Account','Billing account, if required','A'],
  ['qos','Quality of service','Allowed QoS depends on your association','q'],
  ['time','Time limit','D-HH:MM:SS, HH:MM:SS, or minutes','t'],
  ['nodes','Nodes','Node count or range','N'],
  ['ntasks','Tasks','Total processes / MPI ranks','n'],
  ['cpus-per-task','CPUs per task','Threads allocated to each process','c'],
  ['mem','Memory per node','For example 16G; conflicts with memory per CPU',''],
  ['mem-per-cpu','Memory per CPU','For example 4G; conflicts with memory per node',''],
  ['gres','Generic resources','For example gpu:1 or gpu:a100:1',''],
  ['gpus','GPUs total','For example 1 or a100:1','G'],
  ['array','Array tasks','For example 0-99%4','a'],
  ['constraint','Node features','For example gpu_h100','C'],
  ['nodelist','Requested nodes','For example node001,node002','w'],
  ['exclude','Excluded nodes','Nodes to avoid','x'],
  ['output','Standard output','Filename pattern; %j job ID, %A/%a array IDs','o'],
  ['error','Standard error','Filename pattern; omit to merge with stdout','e'],
  ['chdir','Working directory','Absolute job working directory','D'],
  ['dependency','Dependency','For example afterok:12345','d'],
  ['mail-user','Notification email','Your email address',''],
  ['mail-type','Notifications','For example END,FAIL',''],
];
const aliases=Object.fromEntries(FIELDS.filter(f=>f[3]).map(f=>[f[3],f[0]]));
export function tokens(text) {
  const result=[];let word='',quote='',escaped=false,started=false;
  for (const c of text) {
    if(escaped){word+=c;escaped=false;started=true;continue;}
    if(c==='\\'&&quote!=="'"){escaped=true;continue;}
    if(quote){if(c===quote)quote='';else word+=c;started=true;continue;}
    if(c==='"'||c==="'"){quote=c;started=true;continue;}
    if(c==='#'&&!started)break;
    if(/\s/.test(c)){if(started){result.push(word);word='';started=false;}continue;}
    word+=c;started=true;
  }
  if(quote||escaped)throw new Error('Unclosed quote or continuation in #SBATCH directive');
  if(started)result.push(word);
  return result;
}
export function parseBatch(script) {
  if(!script.startsWith('#!'))throw new Error('A batch script must start with #! and its interpreter');
  const lines=script.split('\n'), records=[], values={}, warnings=[];let header=true;
  for(let i=1;i<lines.length;i++){
    const line=lines[i];
    if(!header)continue;
    if(/^\s*#SBATCH\b/.test(line)){
      try {
        const ts=tokens(line.replace(/^\s*#SBATCH\s*/,'')),options=[];
        for(let k=0;k<ts.length;k++){
          const token=ts[k]; let name,value;
          if(token===':')throw new Error('Heterogeneous-job headers must be edited outside the form');
          if(token.startsWith('--')){
            const eq=token.indexOf('=');
            name=token.slice(2,eq<0?undefined:eq);
            value=eq<0?(ts[k+1]&&!ts[k+1].startsWith('-')?ts[++k]:''):token.slice(eq+1);
          }else if(token.startsWith('-')&&aliases[token[1]]){
            name=aliases[token[1]];value=token.length>2?token.slice(2):ts[++k];
            if(value===undefined)throw new Error('Missing value for '+token);
          }else throw new Error('Unsupported option syntax: '+token);
          options.push({name,value});values[name]=value;
        }
        records.push({index:i,options,line});
      }catch(e){warnings.push(e.message);records.push({index:i,options:[],line,opaque:true});}
    }else if(line.trim()&&!line.trim().startsWith('#'))header=false;
  }
  return {script,lines,records,values,warnings};
}
const quote=v=>/^[\w@%.,:/+\-=\[\]]+$/.test(v)?v:JSON.stringify(v);
export function buildBatch(parsed, edits) {
  const changed=new Set(Object.keys(edits).filter(k=>edits[k]!==parsed.values[k]));
  const lines=[...parsed.lines];
  for(const rec of parsed.records){
    if(rec.opaque||!rec.options.some(o=>changed.has(o.name)))continue;
    const keep=rec.options.filter(o=>!changed.has(o.name));
    lines[rec.index]=keep.map(o=>'#SBATCH --'+o.name+(o.value?'='+quote(o.value):'')).join('\n');
  }
  // Append overrides at the END of the directive region, before the first executable line.
  let at=1;while(at<lines.length&&(!lines[at].trim()||lines[at].trim().startsWith('#')))at++;
  lines.splice(at,0,...[...changed].filter(k=>edits[k]!=='').map(k=>'#SBATCH --'+k+'='+quote(edits[k])));
  return lines.join('\n');
}
export function validateBatch(parsed, edits, caps) {
  const value={...parsed.values,...edits}, errors=[];
  if(parsed.warnings.length&&Object.keys(edits).length)errors.push('This script has unsupported directive syntax; edit those directives in a text editor first');
  for(const [k,v] of Object.entries(edits))if(/[\r\n\x00]/.test(v))errors.push(k+': enter a single-line value');
  if(value.mem&&value['mem-per-cpu'])errors.push('Choose memory per node OR memory per CPU');
  for(const key of ['ntasks','cpus-per-task'])if(value[key]&&!/^[1-9]\d*$/.test(value[key]))errors.push(key+': use a positive integer');
  const parts=caps?.partitions||[];
  if(value.partition&&parts.length&&value.partition.split(',').some(p=>!parts.some(x=>x.PartitionName===p)))errors.push('Partition not found on this server');
  return errors;
}
