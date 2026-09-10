#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import {request} from './client.js';
import {loadConfig, configure} from './config.js';
import {App} from './ui.js';
import {TerminalInput} from './terminal.js';

const args=process.argv.slice(2);
const help=`seejobs · Slurm jobs, logs and submission editor

seejobs                 open the queue; setup runs on first use
seejobs --config        edit private connection settings
seejobs --host local    run directly on a Slurm login node
seejobs --once          JSON snapshot
Options: --host ALIAS  --user USER  --days 1..365

s Slurm   o Overview   l Logs   n Nodes   h History   m Metrics
f Filters   k Search   / split logs   b open batch file   e edit/rerun
c Cancel selected job   r Refresh   ? Help   q Quit
Arrows / PageUp / PageDown / Home / End navigate the focused panel.
Tab or click focuses a panel; click a queue row to open its overview.
No pause binding. Uppercase panel letters work too.
`;
try {
  if(args.includes('--help')||args.includes('-h')){console.log(help);process.exit(0);}
  let config=loadConfig();
  if(args.includes('--config')){await configure();process.exit(0);}
  const option=(name,fallback)=>{const i=args.indexOf(name);if(i<0)return fallback;if(!args[i+1]||args[i+1].startsWith('--'))throw new Error('Missing value for '+name);return args[i+1];};
  const known=new Set(['--config','--once','--host','--user','--days','--no-mouse']);
  for(let i=0;i<args.length;i++){if(!known.has(args[i]))throw new Error('Unknown option: '+args[i]);if(['--host','--user','--days'].includes(args[i]))i++;}
  if((!config.sshHost||!config.remoteUser)&&!args.includes('--host')&&!process.env.SEEJOBS_HOST)config=await configure();
  const host=option('--host',process.env.SEEJOBS_HOST||config.sshHost);
  const user=option('--user',process.env.SEEJOBS_USER||config.remoteUser);
  const days=Number(option('--days',config.historyDays||7));
  if(!host||host.startsWith('-')||!/^[\w.@-]+$/.test(host)||!user||!/^[\w.@-]+$/.test(user)||!Number.isInteger(days)||days<1||days>365)throw new Error('Set host, Slurm username and history (1–365 days) with seejobs --config');
  if(args.includes('--once'))console.log(JSON.stringify(await request(host,{op:'list',days,user}),null,2));
  else{
    if(!process.stdin.isTTY||!process.stdout.isTTY)throw new Error('Use an interactive terminal, or --once for JSON');
    const mouse=!args.includes('--no-mouse');
    const restore=()=>process.stdout.write('\x1b[?1000l\x1b[?1006l\x1b[?25h');
    process.once('exit',restore);
    const input=new TerminalInput(process.stdin);
    const app=render(React.createElement(App,{host,user,days,mouse,input}),{stdin:input,alternateScreen:true,exitOnCtrlC:true,maxFps:20});
    await app.waitUntilExit();input.close();
  }
}catch(e){console.error('seejobs: '+e.message);process.exitCode=1;}
