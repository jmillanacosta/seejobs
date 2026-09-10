import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {PassThrough} from 'node:stream';
import {render} from 'ink';
import {App} from '../src/ui.js';
import {TerminalInput} from '../src/terminal.js';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('queue, filters, script editor, preview and confirmations work in Ink',async()=>{
  const source=new PassThrough();source.isTTY=true;source.setRawMode=()=>source;source.ref=()=>source;source.unref=()=>source;
  const input=new TerminalInput(source),output=new PassThrough();output.columns=140;output.rows=36;output.isTTY=true;
  let screen='';output.on('data',v=>screen+=v.toString());
  const jobs=[{id:'20',name:'train',user:'alice',state:'PENDING',cpus:'16',elapsed:'00:00:00',memory:'16G',partition:'gpu',gres:'gpu:1',workdir:'/work',script:'/work/train.sh'},
    {id:'19',name:'failed',user:'bob',state:'FAILED',cpus:'2',elapsed:'00:01:00',partition:'cpu',gres:'',workdir:'/work'}];
  const calls=[];
  const api=async(host,payload)=>{calls.push(payload);switch(payload.op){
    case 'list':return {jobs:payload.user?jobs.filter(j=>j.user===payload.user):jobs,nodes:[],warnings:[]};
    case 'capabilities':return {partitions:[{PartitionName:'gpu'},{PartitionName:'cpu'}],sampleSeconds:15};
    case 'detail':return {steps:[],logs:[{source:'StdErr',path:'/work/job.err',text:'ValueError: failed'}],meta:{}};
    case 'script':return {script:'#!/bin/bash\n#SBATCH -p gpu\n#SBATCH -t 01:00:00\necho hello\n',source:'stored script',workdir:'/work'};
    default:return {result:'ok'};
  }};
  const app=render(React.createElement(App,{host:'test',user:'alice',days:7,api,mouse:true,input}),{stdin:input,stdout:output,stderr:output,interactive:true,exitOnCtrlC:false});
  const key=async(v)=>{source.write(v);await delay(65);};
  try{
    await delay(100);assert.match(screen,/SLURM/);
    await key('f');await key('\r');await key('\x1b[B');await key('\r');await key('a');
    assert.ok(calls.some(p=>p.op==='list'&&p.user===''));
    await key('\x1b[F');await key('\r');
    assert.ok(calls.some(p=>p.op==='detail'&&p.job.id==='19'));
    await key('s');await key('\x1b[H');await key('e');await delay(150);assert.ok(screen.includes('BATCH EDITOR'),JSON.stringify(calls)+'\n'+screen.slice(-4000));
    // Submission directory, job name, partition, account, QoS, then time.
    for(let i=0;i<5;i++)await key('\x1b[B');
    await key('\r');await key('\x15');await key('02:00:00');await key('\r');
    await key('v');assert.match(screen,/SUBMISSION PREVIEW/);
    await key('t');const check=calls.find(p=>p.op==='validate');assert.match(check.script,/--time=02:00:00/);assert.equal(check.workdir,'/work');
    await key('u');await key('\x1b');assert.equal(calls.filter(p=>p.op==='submit').length,0);
    await key('u');await key('y');assert.equal(calls.filter(p=>p.op==='submit').length,1);
    await key('s');await key('c');await key('\x1b[B');await key('y');
    assert.equal(calls.find(p=>p.op==='cancel').job.id,'20');
    // Mouse queue row opens overview.
    await key('s');await key('\x1b[<0;5;9M');assert.match(screen,/OVERVIEW/);
    assert.doesNotMatch(screen,/TypeError|same key|unique.*key|Cannot update/);
  }finally{app.unmount();input.close();}
});
