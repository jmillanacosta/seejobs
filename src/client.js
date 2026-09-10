import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
const script = readFileSync(new URL('./remote.py', import.meta.url), 'utf8');
const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";
export function request(host, payload, signal) {
  return new Promise((resolve, reject) => {
    const child = host === 'local'
      ? spawn('python3', ['-c', script], {signal})
      : spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=2', host, 'python3 -c '+quote(script)], {signal});
    let out = '', err = '';
    const timer = setTimeout(() => child.kill(), 45000);
    child.stdout.on('data', b => {out += b; if (out.length > 16000000) {err='Response exceeds 16 MB; narrow the user or history window.';child.kill();}});
    child.stderr.on('data', b => {err += b;});
    child.on('error', e => {clearTimeout(timer); reject(e);});
    child.on('close', code => {
      clearTimeout(timer);
      try {
        const data = JSON.parse(out);
        if (data.error) throw new Error(data.error);
        if (code !== 0) throw new Error('Remote request failed');
        resolve(data);
      } catch (e) {reject(new Error(err.trim() || (out ? e.message : `SSH exited ${code}. Check your SSH connection to ${host}.`)));}
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}
export const clean = s => String(s ?? '').replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
export const active = j => /^(RUNNING|PENDING|CONFIGURING|COMPLETING|SUSPENDED|RESIZING)/.test(j.state);
export const failed = j => /FAILED|OUT_OF_MEMORY|TIMEOUT|NODE_FAIL|BOOT_FAIL|CANCELLED|PREEMPTED|DEADLINE/.test(j.state);
export function diagnosis(job, detail) {
  const state = job.state || '';
  const known = [
    [/OUT_OF_MEMORY/, 'Slurm reports out of memory. Check peak RSS and the requested memory.'],
    [/TIMEOUT/, 'Slurm stopped the job at its time limit.'],
    [/NODE_FAIL|BOOT_FAIL/, 'Slurm reports a node failure.'],
    [/CANCELLED/, 'The job was cancelled; see the state for any recorded user ID.'],
    [/PREEMPTED/, 'The job was preempted by the scheduler.'],
    [/PENDING/, `Waiting: ${job.reason || 'scheduler has not supplied a reason'}.`]
  ];
  const lines = (detail?.logs || []).flatMap(l => clean(l.text).split('\n'));
  const candidates = lines.filter(l => /error|exception|out of memory|killed|failed|not found|permission denied|no space/i.test(l) && !/\bFile "|\breturn await\b|\braise error\b|^\s*[|+]?\s*raise\b/.test(l));
  const evidence = candidates.slice(-3).reverse();
  const exact = known.find(([re]) => re.test(state));
  const badStep=(detail?.steps||[]).find(s=>s.id!==job.id&&!s.id.endsWith('.extern')&&(failed(s)||/^[1-9]\d*:\d+$|^0:[1-9]\d*$/.test(s.exit||'')));
  const derived=(detail?.steps||[]).find(s=>s.id===job.id)?.derivedExit;
  const hiddenFailure=state==='COMPLETED'&&(badStep||/^[1-9]\d*:\d+$|^0:[1-9]\d*$/.test(derived||''));
  return [hiddenFailure?`The batch script completed, but ${badStep?'step '+badStep.id:'the derived exit code'} reports a failure. Check step results and logs before accepting the output.`:exact?.[1] || (failed(job) ? `Exited ${job.exit || detail?.meta?.ExitCode || 'with failure'}. Log clues below may explain why.` : state === 'COMPLETED' ? 'Completed successfully.' : 'Job is active; logs refresh automatically.'), ...evidence.map(l => 'Log clue: ' + l.trim())];
}
