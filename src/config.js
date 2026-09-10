import {readFileSync, mkdirSync, writeFileSync, chmodSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {importGuides} from './guides.js';

export const configPath=process.env.SEEJOBS_CONFIG||join(process.env.XDG_CONFIG_HOME||join(homedir(),'.config'),'seejobs','config.json');
export function loadConfig() {
  try{return JSON.parse(readFileSync(configPath,'utf8'));}
  catch(e){if(e.code==='ENOENT')return {};throw new Error('Cannot read '+configPath+': '+e.message);}
}
export function validateConfig(c) {
  if(!/^[\w.@-]+$/.test(c.sshHost||'')||c.sshHost.startsWith('-'))throw new Error('Enter an SSH alias, host name, or local.');
  if(!/^[\w.@-]+$/.test(c.remoteUser||''))throw new Error('Enter your Slurm username.');
  if(!Number.isInteger(Number(c.historyDays))||Number(c.historyDays)<1||Number(c.historyDays)>365)throw new Error('History must be 1 to 365 days.');
  if(!['directory','script'].includes(c.projectMode||'directory'))throw new Error('Choose directory or script for projects.');
  const refreshSeconds=Number(c.refreshSeconds??1);
  if(!Number.isFinite(refreshSeconds)||refreshSeconds<1||refreshSeconds>300)throw new Error('Refresh interval must be 1 to 300 seconds.');
  return {...c,historyDays:Number(c.historyDays),projectMode:c.projectMode||'directory',refreshSeconds};
}
export function saveConfig(settings) {
  const c=validateConfig(settings);
  mkdirSync(dirname(configPath),{recursive:true,mode:0o700});
  writeFileSync(configPath,JSON.stringify(c,null,2)+'\n',{mode:0o600});chmodSync(configPath,0o600);
  return c;
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
    c.refreshSeconds=Number(await ask('Refresh interval in seconds (1–300)',String(c.refreshSeconds??1)));
    c.projectMode=await ask('Group projects by directory or script',c.projectMode||'directory');
    const guide=await ask('Local Markdown guide folder (optional; - removes imported advice)',c.guidance?.directory||'');
    if(guide==='-')delete c.guidance;else if(guide)c.guidance=importGuides(guide);
    saveConfig(c);
    console.log('Saved private settings to '+configPath);
    return c;
  }finally{rl.close();}
}
