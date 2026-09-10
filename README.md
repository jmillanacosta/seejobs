# seejobs

A clean terminal dashboard for Slurm. Find your projects, see why jobs wait or fail, read their logs, and prepare the next run.

Warning: vibecoded for my own use, I don't have a plan to maintain it.

## Install

You need **Node.js 22 or newer** and **Git** on the computer where you run seejobs. The cluster needs **Python 3** and its usual Slurm commands. If you use SSH, make sure `ssh YOUR_ALIAS` works first.

```sh
git clone https://github.com/jmillanacosta/seejobs.git
cd seejobs
npm install
npm install --global .
seejobs
```

First use starts setup. Enter:

1. **SSH host:** your usual SSH alias or hostname. Enter `local` if you are already on a cluster login node.
2. **Slurm username:** the user whose jobs you want under “My jobs”.
3. **History days:** press Enter for 7 days.
4. **Refresh interval:** press Enter for 1 second. You can choose 1–300 seconds.
5. **Projects:** press Enter to group by working directory, or enter `script`.
6. **Guide folder:** optional. Enter a local folder of Markdown cluster guides, or leave it empty.

No global install permission? Run `npm start` from this folder instead. Install Node with a user-owned version manager if your system's global npm folder is not writable. You do not need Node on the remote cluster when seejobs connects over SSH.

## Start using it

The Slurm page opens first. It combines live jobs and history, including failures. Script groups start expanded. Names wrap, and the queue shows submission dates. Wide terminals show more columns. Pending is yellow, successful is green, and failed is red.

Use **Up/Down** to select a row. Press **Enter** to open it. **Esc** returns to Slurm when no form is open. The footer shows the actions for the current page.

| Global pages | Selected job |
| --- | --- |
| **S** Slurm: live and finished jobs | **O** Overview: reasons, dates, resources, dependencies and error clues |
| **D** Dashboard: projects and next actions | **L** Logs: output and errors, side by side |
| **H** History: select and open finished jobs | **M** Metrics: measured use, time limits and final accounting |
| **N** Nodes: capacity, drain/down reasons and limits | **E** Edit a script to prepare a new run |
| **,** Settings: change setup and refresh rate | **C** Cancel the selected job, after confirmation |
| **?** Help: step-by-step instructions | **W** in Overview: request start estimate and priority factors |

**F** opens filters for user, partition, status, GPU request and project. Choose a field, press Enter, choose its value, then press **A** to apply. “All visible users” requests other users' jobs; their file permissions still apply. **K** searches job fields. **R** reloads. **Q** quits. Uppercase and lowercase keys work the same way.

On **D**, choose a project and press Enter to see its jobs. **G** switches between working directories and script paths. Full paths keep projects with the same name separate. **X** clears the project filter. On **S/H**, **G** toggles script groups; Enter, Space or Left/Right folds a selected group.

Click a job to open it. Click a panel to focus it. **Tab** switches focus between the job list and the document. Page Up/Down and Home/End work in lists and documents. Run `seejobs --no-mouse` if you prefer your terminal's text selection.

## Read logs

Select a job, then press **L**. **/** toggles the split view. Left/Right selects a file. **V** switches between recent output and the whole file. Whole files load in chunks; **[ / ]** loads the previous/next chunk. Navigation keys scroll within the chunk.

For older jobs, seejobs tries the retained batch script, then the current script file, then matching files in the job's directory and its `log`/`logs` folders. Inferred paths are labelled. Files that moved, were deleted, or are private may not be readable. Error excerpts are clues, not a guaranteed diagnosis.

## Prepare a job

Press **E** on a job to recover its script. Or press **B** to open a script by path or create a new job.

1. Select a field and press Enter to edit it. Check the submission directory. For a new job, enter the command to run.
2. Read the field help and live cluster limits. Press **?** for more help, including imported guide advice. An empty option uses the scheduler default.
3. Press **V** to review the complete script.
4. Press **Enter** to check it with `sbatch --test-only`. This does not submit it.
5. Press **Enter** again to open the final confirmation, then **Y** to submit.

Editing prepares a **new submission** and keeps the original file. The check does not guarantee that your program will succeed or that resources will be available. Check array and dependency fields before sending. Cancellation also requires confirmation and uses your normal Slurm permissions. Actions are never automatically retried after connection errors.

## Measurements you can trust

Jobs and selected details reload every **1 second** by default. Change this in **Settings (`,`)**. Requests do not overlap; slow servers reduce the effective rate. Metrics poll no faster than the configured refresh interval or Slurm's known collection interval, whichever is longer. The display redraws twice per second.

Metrics show estimated CPU cores from counter changes, reported current task memory, CPU efficiency, time used versus the limit, and final step accounting. GPU counters appear only when Slurm supplies them. A GPU allocation does not prove GPU use. The largest task's peak memory is **not** whole-job peak memory. Missing measurements stay unknown. Time-limit use is **not** task progress.

Charts cover the current viewing session. History comes from Slurm, is limited to 5000 accounting records, and depends on cluster retention and privacy settings. seejobs is not a permanent metrics recorder. On Nodes, **A** requests account fair-share information and reservations. On Overview, **W** requests start and priority details. These extra requests run on demand.

## Private settings and cluster guides

Press **,** in the app, or run `seejobs --config`, to change setup. Settings are saved with owner-only permissions in `~/.config/seejobs/config.json` (or `$XDG_CONFIG_HOME/seejobs/config.json`). SSH credentials stay in your SSH configuration.

Guide advice is optional and stays in that private file. It includes the source file and section. Examples are never applied to jobs automatically. Saving a guide folder imports it again; clearing it removes the advice.

```sh
seejobs --import-guides /path/to/markdown-guides
seejobs --host local --user YOUR_USERNAME
seejobs --days 30
seejobs --once  # print one JSON snapshot
```

`SEEJOBS_CONFIG`, `SEEJOBS_HOST`, and `SEEJOBS_USER` can override the settings path or connection. The portable [guide configuration format](docs/slurm-data.md#private-guide-format) contains no site-specific content.

## Built with

[Ink](https://github.com/vadimdemedes/ink) renders the terminal interface with React. [React](https://react.dev/) manages its state. [wrap-ansi](https://github.com/chalk/wrap-ansi) wraps terminal text. Node.js handles SSH and settings; a small Python standard-library helper reads Slurm data on the server. No database, web service, or extra Python package is required.

The in-app **? Help** page explains what each Slurm command contributes, how to interpret metrics, and which limitations remain.

For development: `npm test`, `python3 test/remote_test.py`, and `node test/smoke.mjs` (read-only live checks using your private settings). Use `npm link` in a source checkout to run local edits immediately.
