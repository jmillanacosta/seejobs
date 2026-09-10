import {readdirSync,readFileSync,statSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {homedir} from 'node:os';
import {FIELDS} from './batch.js';

// Import advice as quoted data. Never execute guide commands or adopt them as defaults.
export function importGuides(folder) {
  const root=resolve(folder.replace(/^~(?=\/|$)/,homedir()));
  if(!statSync(root).isDirectory())throw new Error('Choose a folder that contains Markdown guides.');
  const files=[],skip=new Set(['node_modules','.git','.venv','venv','seejobs','.agents','.codex']);
  function walk(dir,depth=0){
    if(depth>3||files.length>=100)return;
    for(const e of readdirSync(dir,{withFileTypes:true})){
      if(e.isDirectory()&&!skip.has(e.name)&&!e.name.startsWith('.'))walk(join(dir,e.name),depth+1);
      else if(e.isFile()&&e.name.endsWith('.md')&&files.length<100)files.push(join(dir,e.name));
    }
  }
  walk(root);
  const notes={};let read=0;
  for(const path of files.sort()){
    if(statSync(path).size>250000)continue;
    const content=readFileSync(path,'utf8');read++;
    let heading='',section=[];
    const flush=()=>{
      const raw=section.join('\n');
      if(!/slurm|sbatch|srun|sacct|qos|resource|memory|GPU/i.test(heading+' '+raw))return;
      for(const [field] of FIELDS){
        const option=new RegExp('--'+field+'(?:[=\\s`|]|$)');
        const topic=({qos:/quality of service|qos/i,gres:/requesting.*GPU|GPU.*limit/i,account:/account limit/i,time:/time limit|wall time/i,array:/array/i,mem:/out of memory|choosing resources/i})[field];
        if(!option.test(raw)&&!(topic?.test(heading)))continue;
        const lines=section.filter(l=>l.trim()&&!/^```/.test(l));
        // Keep the explanation around the option, including short tables of limits.
        const at=lines.findIndex(l=>option.test(l));
        const excerpt=lines.slice(Math.max(0,at-2),Math.max(0,at-2)+14).join('\n').slice(0,1600);
        if(!excerpt)continue;
        notes[field]??=[];
        if(notes[field].length<6)notes[field].push({source:relative(root,path),section:heading,text:excerpt});
      }
    };
    for(const line of content.split('\n')){if(/^#{1,6}\s/.test(line)){flush();heading=line.replace(/^#+\s*/,'');section=[];}else section.push(line);}
    flush();
  }
  if(!Object.keys(notes).length)throw new Error('No Slurm option guidance found in these Markdown files.');
  return {version:1,importedAt:new Date().toISOString(),directory:root,filesRead:read,notes};
}

export function fieldAdvice(guidance,field) {
  return (guidance?.notes?.[field]||[]).map(n=>'GUIDE · '+n.source+' / '+n.section+'\n'+n.text).join('\n\n');
}
