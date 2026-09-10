export const HELP = `START HERE
1. Press S to open the job list. Use Up and Down to select a row.
2. Press Enter to open a job. Press L to read its logs.
3. Press Esc to return to the job list.

FIND YOUR WORK
Press D to open the project dashboard. Select a project, then press Enter.
Projects use the job's working directory. Press G on the dashboard to group by script instead.
The project path is shown in full. Jobs with no recorded path have their own group.
Press F to change the user, partition, state, GPU request, or project.
Select a field. Press Enter. Choose a value. Press A to apply the filters.
Choose All projects to clear a project filter. Press K to search job names or IDs.
The job list includes running, waiting, and finished jobs. Script groups start expanded.
On a group row, press Enter, Space, Left, or Right to close or open the group.
Press G in the job list to turn script groups off or on.
Names wrap onto more lines. Select the job to see all of its details.

READ A JOB
O Overview: Read the reason for a delay, dates, resources, dependencies, and log clues.
Press W in Overview to request a start estimate and priority details.
L Logs: Read output and errors. Press / to show the two files side by side.
Use Left and Right to select a file. Press V to read the full file.
In full-file mode, use [ and ] to read the previous or next chunk.
Use Page Up, Page Down, Home, and End to move within the displayed text.
For old jobs, a path may come from the current script. The viewer labels this source.
Missing files may have moved, been deleted, or be private. No viewer can recover deleted files.
M Metrics: Compare CPU use, time, and recorded memory with the job request.
Values depend on the cluster's measurements. Missing data means unknown.
Peak task memory is not the total memory of a job with many tasks.
Charts start when you open Metrics. They are not a recording of the whole run.

CHANGE OR CREATE A JOB
Select a job and press E to prepare a new run from its script.
Press B to open another script or create a new job.
1. Select a field. Press Enter to change it. Clear the field to use the scheduler default.
2. Read the field help and any live cluster limits. Press ? for more help.
3. Press V to review the complete script and its submission directory.
4. Press Enter to check the job with the scheduler. This does not submit the job.
5. Press Enter again to review the final confirmation. Press Y to submit.
The check cannot guarantee that your program will run or that resources will be free.
Your original script is kept. Editing prepares a new submission.
Press Esc from the review to return to the fields. Esc from the fields asks before discarding changes.
An array submission can create many tasks. Check the array field before you confirm.
To stop a job, select its row and press C. Check the job ID, then press Y.
Your normal Slurm permissions apply. No bulk cancellation command is provided.

SEE THE BIGGER PICTURE
D Dashboard: See projects, failures, waiting jobs, and the next useful action.
H History: Read finished jobs under the current filters. Select one and press Enter.
N Nodes: Check unavailable nodes, partitions, and reasons.
Press A in Nodes to read account shares and reservations for the chosen user.
An estimated start time can change. Idle CPUs alone do not mean your job can start.

SET UP SEEJOBS
Press , (comma) to open Settings. Use the same SSH alias and username as your usual login.
Use local as the host when seejobs runs on a cluster login node.
Set the history window and how projects are grouped. Press A to save.
You can import a local folder of Markdown user guides. Their advice stays in your private settings.
Guide examples are advice. They are not applied to jobs automatically.
Use seejobs --config from your shell to run setup again.

MOVE AND RELOAD
Up/Down selects a row or scrolls text. Page Up/Down moves by a page. Home/End jumps to an end.
Tab changes the focused panel. You can also click a panel, job, project, or menu item.
R reloads the current data. Jobs update every second by default, when the previous request has finished.
Press , to change the refresh interval from 1 to 300 seconds.
The clock and plots redraw twice per second. Slurm may measure less often.
Esc closes the current edit or returns to Slurm. Q quits from a normal page.
Uppercase and lowercase shortcuts do the same action. The footer shows the current actions.`;

export function footerFor({modal,filter,draft,preview,validated,panel,job,cancellable,group,full,focus,busy}) {
  if(busy)return ['Working… Wait for the result.',''];
  if(modal){
    if(['cancel','submit','discard'].includes(modal.kind))return ['Y confirm · Esc go back',''];
    if(modal.kind==='open')return ['↑↓ choose · Enter continue · Esc close',''];
    if(modal.kind==='advice')return ['↑↓ scroll · PgUp/PgDn · Home/End · Esc return to fields',''];
    return ['Enter save · Ctrl+U clear · Backspace delete · Esc cancel',''];
  }
  if(filter)return ['↑↓ choose · Enter options · A apply · X reset · Esc discard',''];
  if(draft)return preview?['↑↓ scroll · E edit · T check · '+(validated?'Enter submit':'Enter check with scheduler'),'Esc back to fields · The original script is kept']:
    ['↑↓ fields · Enter edit · ? field help · V review and continue','T check with scheduler · Esc close editor'];
  const global='R reload · F filters · K search · , settings · ? help · Esc Slurm · Q quit';
  if(panel===',')return ['↑↓ settings · Enter edit · A save and reconnect · Esc discard','Settings are private to this computer.'];
  if(panel==='d')return ['↑↓ projects · Enter select project · G directory/script · X all projects',global];
  if(panel==='s'||panel==='h'||focus==='queue')return [group?'↑↓ rows · Enter/Space fold · ←/→ fold/unfold · G toggle groups · B open/new job':
    '↑↓ rows · Enter open · '+(job?'E edit/rerun · ':'')+(cancellable?'C cancel · ':'')+'G toggle groups · B open/new job',global];
  if(panel==='l')return ['↑↓ scroll · ←/→ file · / split · V '+(full?'tail':'whole file')+(full?' · [ ] chunks':''),global];
  if(panel==='o')return ['↑↓ scroll · W start/priority · E edit/rerun · '+(cancellable?'C cancel · ':'')+'L logs · M metrics',global];
  if(panel==='m')return ['↑↓ scroll · O overview · L logs · E edit/rerun · Tab job list',global];
  if(panel==='n')return ['↑↓ scroll · A account shares/reservations · F partition filter',global];
  return ['↑↓ scroll · PgUp/PgDn · Home/End',global];
}
