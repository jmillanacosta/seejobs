import {readFileSync, mkdirSync, writeFileSync, chmodSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import {createInterface} from 'node:readline/promises';

export const configPath=process.env.SEEJOBS_CONFIG||join(process.env.XDG_CONFIG_HOME||join(homedir(),'.config'),'seejobs','config.json');
export function loadConfig() {
  try{return JSON.parse(readFileSync(configPath,'utf8'));}
  catch(e){if(e.code==='ENOENT')return {};throw new Error('Cannot read '+configPath+': '+e.message);}
}
export async function configure() {
  if(!process.stdin.isTTY)throw new Error('Run seejobs --config in an interactive terminal');
  const c=loadConfig(), rl=createInterface({input:process.stdin,output:process.stdout});
  const ask=async(label,current)=>{const answer=await rl.question(label+(current?' ['+current+']':'')+': ');return answer.trim()||current||'';};
  try{
    console.log('seejobs setup · SSH credentials stay in your SSH configuration.\nUse "local" when running on a Slurm login node.');
    c.sshHost=await ask('SSH host / alias, or local',c.sshHost);
    c.remoteUser=await ask('Your Slurm username (used for My jobs)',c.remoteUser);
    c.historyDays=Number(await ask('History window in days',String(c.historyDays||7)));
    if(!/^[\w.@-]+$/.test(c.sshHost)||c.sshHost.startsWith('-')||!c.remoteUser||!/^[\w.@-]+$/.test(c.remoteUser)||!Number.isInteger(c.historyDays)||c.historyDays<1||c.historyDays>365)throw new Error('Invalid host, username, or history window (1–365 days)');
    mkdirSync(dirname(configPath),{recursive:true,mode:0o700});
    writeFileSync(configPath,JSON.stringify(c,null,2)+'\n',{mode:0o600});chmodSync(configPath,0o600);
    console.log('Saved private settings to '+configPath);
    return c;
  }finally{rl.close();}
}
