# seejobs

An Ink / React dashboard for your Slurm jobs over SSH. On first launch it asks for a label, SSH host/alias, Slurm username, and history window, then stores them in a mode-600 local config at `$XDG_CONFIG_HOME/seejobs/config.json` (or `~/.config/seejobs/config.json`). Run `seejobs --config` any time to edit it.

```sh
cluster seejobs
cluster seejobs --days 30
seejobs --host cluster.example
seejobs --once
```

Requires Node 22+, SSH authentication, and Python 3 plus Slurm commands on the server. The supplied local launcher selects an installed compatible Node. `cluster seejobs` is a local convenience wrapper that launches seejobs against the configured SSH host. Nothing is installed on the cluster, and no jobs are submitted or changed.

- **1 Overview**: state, resources, scheduler reason, error excerpts, measured peak RSS and total CPU time per job step.
- **2 Logs**: stderr and stdout side by side. Tail refreshes every five seconds. `s` toggles split/single; arrows select a file in single/full mode.
- **3 Nodes**: node state, allocated/idle/other/total CPUs, RAM and scheduler drain/down reason.
- **4 History**: recent outcomes, durations and resource requests. Select a job and use Overview for measured performance.
- Up/down or j/k selects a job. Tab moves focus to scroll details/logs. Page Up/Down scroll without moving the job selection. g/G jumps to top/bottom of the loaded text.
- `f` opens the full log from the beginning, in bounded 48 KB chunks. `[` / `]` loads the previous/next chunk; scroll within each chunk normally. This allows arbitrarily large logs without downloading the entire file. Byte boundaries may split a line or UTF-8 character.
- The queue list includes Job ID, user, state, partition, node(s), CPUs, GRES, and elapsed time. `/` searches across these fields; `a` cycles all, active, and unsuccessful jobs.
- `c` then `c` cancels the selected job. `R` recovers its batch script; `e` edits an existing `#SBATCH` header using `HEADER=value`; `S` submits the modified rerun. Escape discards the draft.
- Tab `5` shows live accounting performance with per-step CPU time, elapsed time, peak RSS, and compact RSS bars.
- `/` searches job ID/name/state; Enter finishes, Backspace edits. `a` cycles all/active/unsuccessful jobs. `r` refreshes, `p` pauses automatic refresh, `q` exits.

Jobs and nodes refresh every 15 seconds. History defaults to seven days, configurable with `--days 1..365`. Connection errors preserve the last snapshot and mark it stale. Live RSS may be absent until accounting is updated; CPU time is accumulated CPU usage, not wall time. Cancelled/preempted jobs count as unsuccessful in the history summary.

Log paths come from `scontrol` while available. On Slurm 23.11 accounting does not provide StdOut/StdErr. For expired scheduler records, seejobs checks the working directory and its `log`/`logs` folders for `.err`, `.out`, and `.log` names containing the exact job ID. These are labelled inferred. Custom filenames without job IDs may be unavailable. Log excerpts are clues, not a guaranteed root cause. Tail reads are capped at 96 KB / 600 lines; full-file browsing is available with `f`. Remote terminal control sequences are stripped.

Development: `npm install`, `npm test`, `npm start`. Package with `npm pack`.

API references: [Ink](https://github.com/vadimdemedes/ink), [Slurm scontrol](https://slurm.schedmd.com/scontrol.html), [Slurm sacct](https://slurm.schedmd.com/sacct.html).
