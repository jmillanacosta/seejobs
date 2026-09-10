# seejobs

A keyboard-and-mouse Slurm dashboard for finding jobs, reading logs, understanding failures, and preparing submissions.

Warning: vibecoded for my own use, I don't have a plan to maintain it.

## Install

Requires Node.js 22 or later on the machine displaying the dashboard. Python 3 and Slurm commands must be available on the login node.

```sh
npm install
npm link
seejobs --config
seejobs
```

Choose an SSH alias from your SSH configuration and your Slurm username. Existing SSH authentication is used; seejobs never stores SSH passwords. When running directly on a login node, choose `local` as the host.

```sh
seejobs --host local --user YOUR_USERNAME
seejobs --days 30
seejobs --once
```

Settings live in `$XDG_CONFIG_HOME/seejobs/config.json` or `~/.config/seejobs/config.json`, with owner-only file permissions. `seejobs --config` edits them. `SEEJOBS_CONFIG`, `SEEJOBS_HOST`, and `SEEJOBS_USER` can override the location or connection. Personal configuration, logs, and credentials are not part of the package.

## Find a job

The landing page combines the live queue with accounting history, including failures and completed jobs. Pending jobs are yellow, running/completed jobs green, and unsuccessful jobs red. The selected row remains the target of job actions.

| Key | Action |
| --- | --- |
| **S** | Slurm queue |
| **O** | Selected job overview, failure clues and resource requests |
| **L** | Logs |
| **N** | Node state, resources and drain/down reasons |
| **H** | History under the current filters |
| **M** | Measured performance |
| **F** | Explicit filter dialog |
| **K** | Search job fields; Ctrl+U clears the text |
| Arrows, PageUp/Down, Home/End | Navigate the focused list or document |
| Tab | Switch focus between jobs and content |
| Enter | Open a job or expand a script group |
| **G** in queue | Group by script path |
| Left/Right or Space on a group | Fold / expand |
| **R** | Refresh |
| **?** | Help |
| **Q** | Quit |

Uppercase and lowercase panel letters are equivalent. There is no pause command. Click a queue row to open its overview; click a panel or its navigation label to focus/open it. Mouse wheel scrolls. Use `--no-mouse` to leave mouse selection to your terminal.

### Filters

Press **F**, choose a field with the arrows, then **Enter** to see its options. **A** applies the whole filter; **X** resets it; **Esc** discards changes.

- **User scope:** My jobs, All visible users, or a typed username. Choosing another scope actually re-queries Slurm.
- **Partition:** discovered partitions, including partitions without current jobs.
- **Status:** all, active, or an individual Slurm state.
- **GPU allocation:** all, GPU requested, or CPU only. This describes allocation, not measured GPU utilization.

Job filters apply to the queue, history and selection used by logs/metrics. Node health follows the partition filter. Slurm's visibility policy remains authoritative; other users' logs can still be unreadable even when their jobs are visible.

## Read logs and diagnose failures

**L** opens logs; **/** toggles split stderr/stdout. Left/Right selects a file. **V** switches between the tail and full-file browsing. Full files are read in 48 KB chunks; **[** and **]** change chunks and the navigation keys scroll within a chunk. Byte boundaries can split a line or UTF-8 character.

Live paths come from Slurm. For older jobs, seejobs recovers output/error directives from retained batch scripts, then the current script file if available, and finally job-ID-matched files in the working directory and its `log`/`logs` folders. Inferred paths are labelled because the current script may have changed since submission. Missing or inaccessible files are reported explicitly.

The overview combines scheduler reasons with error excerpts. Excerpts are evidence to investigate, not a guaranteed root cause. Tail reads are bounded to 96 KB / 600 lines and terminal control sequences are removed.

## Edit and rerun a batch script

Press **E** on a job to recover its script, or **B** to open a remote script by path. Scripts that Slurm no longer retains can fall back to the current submission file, labelled accordingly.

1. Select a readable field and press **Enter** to edit it. Empty values remove an existing option. Fields include partition, time, CPUs, memory, GPUs, arrays, dependencies, account, QoS, paths and notifications.
2. The submission directory is explicit. This is where `sbatch` runs, preserving relative paths.
3. **V** shows the exact resulting script. The executable body remains unchanged. Short options, quoted values, whitespace forms and duplicate editable options are handled.
4. **T** checks the script with `sbatch --test-only`. This does not submit a job.
5. From the preview, **U** opens submission confirmation; **Y** submits. **Esc** backs out. Ctrl+Enter is also supported where the terminal transmits it.

Partition limits, available node features, GRES, accounts and QoS are discovered when permissions allow. Local checks catch basic conflicts; the scheduler is authoritative for associations, QoS limits, dependencies and site policy. Unrecognized directive syntax is preserved with a warning. Heterogeneous-job directive blocks are not safely editable through the form.

**C** opens a job-specific cancellation confirmation. **Y** invokes `scancel` under the connected account's existing permissions. Refreshing or moving elsewhere cannot change the job in that confirmation.

No submissions or cancellations are automatically retried after a connection error. Check the queue before retrying a submission whose outcome is uncertain.

## Performance

Running jobs use `sstat`; finished jobs show final `sacct` accounting. The metrics view queries at a target interval of 0.5 seconds, without overlapping requests, only while open on a running job. Slower SSH/Slurm responses reduce that rate.

Slurm controls the underlying collection interval, which is displayed when discoverable. A 15-second accounting interval cannot provide true half-second measurements. Repeated cached counters do not create new samples.

- **CPU:** estimated cores used from changes in accumulated CPU time, with time units parsed correctly.
- **Resident memory:** reported average RSS multiplied by tasks, summed across steps (extern is excluded).
- **GPU:** reported accounting GPU-utilization averages when available; never node-wide utilization presented as job-specific data.

Charts have colored axes and timestamps. Missing data stays unavailable. History is held in memory for the selected job and resets on selection; seejobs is not a long-term telemetry database.

Queue/accounting updates every 15 seconds, selected details/logs every 5 seconds. Errors retain the last snapshot and label it stale. History is bounded to the latest 5000 accounting records; narrow the username or days for larger installations.

## Development

```sh
npm test
PYTHONDONTWRITEBYTECODE=1 python3 test/remote_test.py
node test/smoke.mjs  # read-only live checks using private config
npm pack
```

Tests cover Slurm JSON shapes, header edits, filtering, grouping, units, log recovery, submission arguments, cancellation confirmation, keyboard navigation and mouse selection in Ink.

References: [Ink](https://github.com/vadimdemedes/ink), [Slurm squeue](https://slurm.schedmd.com/squeue.html), [sacct](https://slurm.schedmd.com/sacct.html), [sstat](https://slurm.schedmd.com/sstat.html), [sbatch](https://slurm.schedmd.com/sbatch.html).
