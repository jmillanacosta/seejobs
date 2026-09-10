import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {PassThrough} from 'node:stream';
import {stripVTControlCharacters} from 'node:util';
import {render} from 'ink';
import {App} from '../src/ui.js';
import {TerminalInput} from '../src/terminal.js';
const delay=ms=>new Promise(r=>setTimeout(r,ms));

test('project, settings, Help, Esc and new-job workflow render current context',async()=>{
  const source=new PassThrough();source.isTTY=true;source.setRawMode=()=>source;source.ref=()=>source;source.unref=()=>source;
  const input=new TerminalInput(source),output=new PassThrough();output.columns=150;output.rows=38;output.isTTY=true;
  let frame='',diagnostics='';output.on('data',v=>{const s=stripVTControlCharacters(v.toString());diagnostics=(diagnostics+s).slice(-16000);if(s.includes('◉ seejobs'))frame=s;});
  const calls=[],saved=[];
  const jobs=[{id:'20',name:'a-very-long-training-job-name-that-must-wrap',user:'alice',state:'PENDING',reason:'Resources',submitted:'2026-01-01T12:00:00',cpus:'4',elapsed:'00:00:00',memory:'4G',partition:'cpu',gres:'',workdir:'/projects/a',script:'/projects/a/train.sh'},
    {id:'19',name:'analysis',user:'alice',state:'FAILED',submitted:'2026-01-01T11:00:00',elapsed:'00:01:00',cpus:'2',partition:'cpu',workdir:'/projects/b',script:'/projects/b/analyze.sh'}];
  const api=async(host,p)=>{calls.push(p);switch(p.op){
    case 'list':return {jobs,nodes:[],warnings:[]};
    case 'capabilities':return {partitions:[{PartitionName:'cpu',MaxTime:'1-00:00:00'}],nodes:[],qos:[],accounts:[],config:{MaxArraySize:'1001'},sampleSeconds:15};
    case 'new':return {script:'#!/bin/bash\n#SBATCH --job-name=new-job\n',workdir:'/projects/a',source:'New job',isNew:true,command:''};
    case 'detail':return {steps:[],logs:[],meta:{}};
    case 'validate':return {result:'Scheduler validation passed'};
    case 'submit':return {result:'21',jobId:'21'};
    default:return {result:'ok'};
  }};
  const app=render(React.createElement(App,{host:'test',user:'alice',days:7,api,mouse:true,input,persist:c=>{saved.push(c);return c;}}),{stdin:input,stdout:output,stderr:output,debug:true,interactive:true,exitOnCtrlC:false});
  const key=async v=>{source.write(v);await delay(90);};
  try{
    await delay(200);assert.match(frame,/script groups/);assert.match(frame,/SUBMITTED/);assert.match(frame,/2026-01-01 12:00/);assert.match(frame,/1s/);
    const before=calls.filter(p=>p.op==='list').length;await delay(1050);assert(calls.filter(p=>p.op==='list').length>before);
    await key('d');assert.match(frame,/DASHBOARD/);assert.match(frame,/projects\/a/);assert.doesNotMatch(frame,/C cancel/);
    await key('\x1b[F');await key('\r');assert.match(frame,/Project: \/projects\/b/);assert.doesNotMatch(frame,/a-very-long-training/);
    await key('\r');assert.match(frame,/OVERVIEW/);await key('\x1b');assert.match(frame,/SLURM ·/);
    await key(',');assert.match(frame,/Refresh interval/);for(let i=0;i<3;i++)await key('\x1b[B');
    await key('\r');await key('\x15');await key('3');await key('\r');await key('a');
    assert.equal(saved.at(-1).refreshSeconds,3);assert.match(frame,/3s/);assert.match(frame,/SLURM ·/);
    await key('?');assert.match(frame,/START HERE/);await key('\x1b[F');assert.match(frame,/MOVE AND RELOAD/);await key('\x1b');assert.match(frame,/SLURM ·/);
    await key('b');assert.match(frame,/PREPARE A JOB/);await key('\x1b[B');await key('\r');await delay(150);
    assert.match(frame,/BATCH EDITOR/);await key('\x1b[B');await key('\r');await key('python train.py');await key('\r');
    await key('?');assert.match(frame,/Command to run/);await key('\x1b');assert.match(frame,/BATCH EDITOR/);
    await key('v');assert.match(frame,/SUBMISSION PREVIEW/);assert.match(frame,/python train.py/);assert.match(frame,/Enter check/);
    await key('\r');assert.equal(calls.filter(p=>p.op==='submit').length,0);assert.match(frame,/Enter submit/);
    await key('\r');assert.match(frame,/Submit this new job/);await key('\x1b');assert.equal(calls.filter(p=>p.op==='submit').length,0);
    await key('\r');await key('y');assert.equal(calls.filter(p=>p.op==='submit').length,1);
    assert.match(calls.find(p=>p.op==='submit').script,/python train.py/);assert.match(frame,/Submitted job 21/);
    output.columns=80;output.rows=22;output.emit('resize');await delay(250);await key('d');
    for(let i=0;i<30&&!frame.includes('DASHBOARD ·');i++)await delay(50);
    assert.match(frame,/DASHBOARD ·/,diagnostics);
    assert(frame.trimEnd().split('\n').length<=22,'Dashboard exceeds terminal height:\n'+frame);
    assert(frame.split('\n').every(line=>Array.from(line.replace(/\r/g,'')).length<=80),'Dashboard exceeds terminal width:\n'+frame);
    await key(',');assert.match(frame,/Refresh interval/);assert(frame.trimEnd().split('\n').length<=22);
    await key('\x1b');await key('r');await delay(150);assert.match(frame,/SLURM ·/);
    assert.doesNotMatch(frame,/TypeError|same key|unique.*key|Cannot update/);
  }finally{app.unmount();input.close();}
});
