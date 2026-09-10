import React from 'react';
import {PassThrough} from 'node:stream';
import {mkdirSync,writeFileSync} from 'node:fs';
delete process.env.NO_COLOR;
process.env.FORCE_COLOR='3';
const {render}=await import('ink');
import {spawnSync} from 'node:child_process';
const {App}=await import('../src/ui.js');
import {TerminalInput} from '../src/terminal.js';

const wait=ms=>new Promise(r=>setTimeout(r,ms));
const jobs=[
  {id:'84231',name:'protein-folding',user:'javi',state:'RUNNING',submitted:'2026-09-10T16:12:00',elapsed:'00:47:18',limit:'04:00:00',partition:'gpu',nodes:'gpu-02',cpus:'8',memory:'64G',gres:'gres/gpu=1',workdir:'/projects/folding',script:'/projects/folding/train.sbatch'},
  {id:'84230',name:'variant-calling',user:'javi',state:'PENDING',submitted:'2026-09-10T16:20:00',elapsed:'00:00:00',limit:'02:00:00',partition:'cpu',nodes:'—',cpus:'16',memory:'32G',gres:'',workdir:'/projects/genomics',script:'/projects/genomics/call.sbatch',reason:'Resources'},
  {id:'84229',name:'qc-report',user:'sam',state:'COMPLETED',submitted:'2026-09-10T15:41:00',elapsed:'00:12:11',limit:'01:00:00',partition:'cpu',nodes:'cpu-07',cpus:'4',memory:'8G',gres:'',workdir:'/projects/genomics',script:'/projects/genomics/qc.sbatch'},
  {id:'84228',name:'embedding-index',user:'javi',state:'FAILED',submitted:'2026-09-10T14:02:00',elapsed:'00:03:26',limit:'01:00:00',partition:'gpu',nodes:'gpu-01',cpus:'8',memory:'32G',gres:'gres/gpu=1',workdir:'/projects/search',script:'/projects/search/index.sbatch'}
];
// The same ANSI palette and font as the reference terminal. No recoloring by content.
const palette=['#000000','#cd0000','#00cd00','#cdcd00','#7f7fcf','#cd00cd','#00cdcd','#faebd7','#818181','#ff0000','#00ff00','#ffff00','#7373cc','#ff00ff','#00ffff','#ffffff'];
const background='#002b36',foreground='#bbc5c6';
function cellsFor(frame){
  const cells=[];let x=0,y=0,fg=foreground,bg=background,bold=false,dim=false,inverse=false;
  for(const token of frame.matchAll(/\x1b\[([0-9;?]*)([ -/]*[@-~])|([^\x1b])/gu)){
    if(token[2]){
      if(token[2]!=='m')continue;
      const codes=token[1].split(';').map(Number);
      for(let i=0;i<codes.length;i++){
        const c=codes[i];
        if(c===0){fg=foreground;bg=background;bold=dim=inverse=false;}
        else if(c===1)bold=true;else if(c===2)dim=true;else if(c===22){bold=false;dim=false;}
        else if(c===7)inverse=true;else if(c===27)inverse=false;
        else if(c===39)fg=foreground;else if(c===49)bg=background;
        else if(c>=30&&c<=37)fg=palette[c-30];else if(c>=90&&c<=97)fg=palette[c-90+8];
        else if(c>=40&&c<=47)bg=palette[c-40];else if(c>=100&&c<=107)bg=palette[c-100+8];
        else if(c===38||c===48){
          let color;
          if(codes[++i]===2){color='#'+codes.slice(i+1,i+4).map(v=>v.toString(16).padStart(2,'0')).join('');i+=3;}
          else {const n=codes[++i];color=n<16?palette[n]:n>=232?'#'+(8+(n-232)*10).toString(16).repeat(3):'#'+[Math.floor((n-16)/36),Math.floor((n-16)/6)%6,(n-16)%6].map(v=>(v?55+40*v:0).toString(16).padStart(2,'0')).join('');}
          if(c===38)fg=color;else bg=color;
        }
      }
    }else{
      const ch=token[3];if(ch==='\n'){x=0;y++;continue;}if(ch==='\r'){x=0;continue;}
      if(y<37)cells.push({x,y,ch,fg:inverse?bg:fg,bg:inverse?fg:bg,bold,dim});x++;
    }
  }
  if(!frame.includes('\x1b[')||!cells.some(c=>c.bg!==background))throw new Error('Missing Ink colors or selection background');
  return {cells,background,columns:150,rows:37,font:'Ubuntu Mono'};
}
async function capture(keys,api){
  const source=new PassThrough();source.isTTY=true;source.setRawMode=()=>source;source.ref=()=>source;source.unref=()=>source;
  const input=new TerminalInput(source),output=new PassThrough();output.columns=150;output.rows=38;output.isTTY=true;
  let frame='';output.on('data',b=>{const chunk=b.toString();if(chunk.includes('◉ seejobs'))frame=chunk;});
  const app=render(React.createElement(App,{host:'mock',user:'javi',days:7,config:{refreshSeconds:1,projectMode:'directory'},api,mouse:false,input}),{stdin:input,stdout:output,stderr:output,interactive:true,patchConsole:false,exitOnCtrlC:false,incrementalRendering:false});
  await wait(180);for(const key of keys){source.write(key);await wait(220);}app.unmount();input.close();
  return frame.replace(/\x1b\[[0-9;?]*[ABCDEFGHJKSTfu]/g,'');
}
const api=async(host,p)=>{
  if(p.op==='list')return {jobs:p.user?jobs.filter(j=>j.user===p.user):jobs,nodes:[{name:'gpu-01',state:'idle',partition:'gpu',cpus:'64',memory:'256000',gres:'gpu:a100:2',reason:''}],warnings:[]};
  if(p.op==='capabilities')return {partitions:[{PartitionName:'gpu',MaxTime:'2-00:00:00',MaxNodes:'4'},{PartitionName:'cpu',MaxTime:'7-00:00:00',MaxNodes:'32'}],nodes:[],qos:[{name:'normal',maxWall:'7-00:00:00'}],accounts:[],config:{MaxArraySize:'1001'},sampleSeconds:15};
  if(p.op==='detail')return {logs:[{source:'stderr (recovered script)',path:'/projects/folding/logs/protein-folding-84231.err',text:'epoch 48/100 · validation loss 0.184\nGPU memory stable at 41.2 GiB\n'},{source:'stdout (recovered script)',path:'/projects/folding/logs/protein-folding-84231.out',text:'starting training\nstep 18400 · throughput 2,814 samples/s\n'}],steps:[{id:'84231.batch',state:'RUNNING',cpu:'00:05:42',rss:'41G',tasks:'1'}],meta:{}};
  if(p.op==='script')return {script:'#!/bin/bash\n#SBATCH --job-name=protein-folding\n#SBATCH --partition=gpu\n#SBATCH --time=04:00:00\n#SBATCH --cpus-per-task=8\n#SBATCH --mem=64G\n#SBATCH --gres=gpu:1\n#SBATCH --output=logs/%x-%j.out\n#SBATCH --error=logs/%x-%j.err\n\npython train.py --epochs 100\n',source:'Stored batch script',workdir:'/projects/folding'};
  return {result:'ok'};
};
mkdirSync(new URL('../assets/',import.meta.url),{recursive:true});
for(const [file,keys] of [['seejobs-queue',[]],['seejobs-dashboard',['d']],['seejobs-logs',['\x1b[B','l']],['seejobs-editor',['\x1b[B','e']]]){
  process.stderr.write(file+' capture\n');
  const captured=await capture(keys,api);
  process.stderr.write(file+' rasterize\n');
  const result=spawnSync('python3',[new URL('./render-terminal.py',import.meta.url).pathname,new URL('../assets/'+file,import.meta.url).pathname],{input:JSON.stringify(cellsFor(captured)),encoding:'utf8'});
  if(result.status!==0)throw new Error(result.stderr||'Screenshot rendering failed');
}
