import sys, json, subprocess, os, re, stat, time, shlex, getpass, datetime


def run(args, optional=False):
    try:
        p = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, timeout=12)
    except (OSError, subprocess.TimeoutExpired):
        if optional:
            return ''
        raise
    if p.returncode and not optional:
        raise RuntimeError(p.stderr.strip() or 'Command failed: ' + args[0])
    return p.stdout if p.returncode == 0 else ''


def fields(line):
    return dict(re.findall(r'(?:^|\s)([A-Za-z][A-Za-z0-9:/]*)=(.*?)(?=\s[A-Za-z][A-Za-z0-9:/]*=|$)', line))


def rows(text, keys):
    # SubmitLine can contain embedded newlines; continuation lines are not records.
    return [dict(zip(keys, values)) for line in text.splitlines()
            for values in [line.split('|', len(keys)-1)]
            if line.strip() and len(values) == len(keys)]




def scalar(value, default=''):
    if isinstance(value, dict):
        if value.get('infinite'):
            return 'UNLIMITED'
        if value.get('set') is False:
            return default
        return scalar(value.get('number', value.get('value', default)), default)
    if isinstance(value, list):
        return ','.join(str(scalar(v)) for v in value)
    return default if value is None else value


def duration(value):
    try:
        seconds = max(0, int(value))
        days, seconds = divmod(seconds, 86400)
        hours, seconds = divmod(seconds, 3600)
        minutes, seconds = divmod(seconds, 60)
        return ('%d-' % days if days else '') + '%02d:%02d:%02d' % (hours, minutes, seconds)
    except (ValueError, TypeError):
        return str(value)


def timestamp(value):
    return datetime.datetime.fromtimestamp(value).astimezone().isoformat() if isinstance(value, (int, float)) and value > 0 else ''


def queue_job(q):
    value = lambda k, default='': scalar(q.get(k), default)
    jid = str(value('job_id'))
    array = value('array_job_id', 0)
    task = value('array_task_id', None)
    if array and task is not None:
        jid = '%s_%s' % (array, task)
    elif array and value('array_task_string'):
        jid = '%s_[%s]' % (array, value('array_task_string'))
    state = str(value('job_state')).split(',')[0]
    start = value('start_time', 0)
    elapsed = int(time.time()) - start if isinstance(start, (int, float)) and start > 0 and state != 'PENDING' else 0
    tres = str(value('tres_alloc_str') or value('tres_req_str'))
    gpu = ','.join(v for v in tres.split(',') if v.startswith('gres/gpu'))
    if not gpu:
        gpu = ','.join(str(value(k)) for k in ['tres_per_job', 'tres_per_node', 'tres_per_task'] if 'gpu' in str(value(k)))
    memory = value('memory_per_node')
    per_cpu = value('memory_per_cpu')
    return dict(id=jid, name=str(value('name')), user=str(value('user_name')), state=state,
                elapsed=duration(elapsed), limit=duration(value('time_limit') * 60) if isinstance(value('time_limit'), (int, float)) else str(value('time_limit')),
                partition=str(value('partition')), nodes=str(value('nodes')), cpus=str(value('cpus')),
                memory=(str(memory)+'Mn' if memory else str(per_cpu)+'Mc' if per_cpu else ''),
                gres=gpu, tres=tres, reason=str(value('state_reason')),
                workdir=str(value('current_working_directory') or value('work_dir')),
                script=str(value('command')), stdout=str(value('standard_output')), stderr=str(value('standard_error')),
                start=timestamp(start), submitted=timestamp(value('submit_time')), eligible=timestamp(value('eligible_time')),
                account=str(value('account')), qos=str(value('qos')), priority=str(value('priority')),
                dependency=str(value('dependency')), nodeCount=str(value('node_count')),
                source='queue')


def snapshot(days, user):
    if not isinstance(days, int) or not 1 <= days <= 365:
        raise ValueError('History must be between 1 and 365 days')
    if user and not re.fullmatch(r'[\w.@-]+', user):
        raise ValueError('Invalid username')
    warnings, jobs = [], {}
    scope = ['-u', user] if user else ['--allusers']
    keys = ['id', 'name', 'user', 'state', 'exit', 'elapsed', 'partition', 'nodes', 'memory', 'cpus', 'start', 'end', 'workdir', 'reason', 'tres', 'submitted', 'eligible', 'limit', 'account', 'qos', 'nodeCount', 'submit']
    try:
        history = run(['sacct'] + scope + ['-S', 'now-%ddays' % days, '-X', '-n', '-P',
            '--format=JobID%80,JobName%100,User%100,State%40,ExitCode,Elapsed,Partition,NodeList,ReqMem,AllocCPUS,Start,End,WorkDir%1000,Reason%200,ReqTRES%500,Submit,Eligible,Timelimit,Account,QOS,NNodes,SubmitLine%3000'])
        records = rows(history, keys)
        if len(records) > 5000:
            warnings.append('Showing the latest 5000 accounting jobs; narrow the user or history window.')
        for j in records[-5000:]:
            j['state'] = j['state'].split(' by ')[0].rstrip('+')
            j['gres'] = ','.join(v for v in j.get('tres', '').split(',') if v.startswith('gres/gpu'))
            j['source'] = 'accounting'
            j['script'] = script_from_submit(j.get('submit', ''), j.get('workdir', ''))
            jobs[j['id']] = j
    except Exception as e:
        warnings.append('Accounting: ' + str(e))
    try:
        queue_args = ['-u', user] if user else []
        raw = run(['squeue', '-r', '--json'] + queue_args, optional=True)
        try:
            parsed = json.loads(raw)
            if parsed.get('errors') or not isinstance(parsed.get('jobs'), list):
                raise ValueError('JSON queue unavailable')
            current = [queue_job(q) for q in parsed['jobs']]
        except (ValueError, TypeError, KeyError):
            current = rows(run(['squeue', '-r', '-h'] + queue_args + ['-o', '%i|%j|%u|%T|%M|%l|%P|%N|%m|%C|%b|%S|%Z|%o|%r|%V|%a|%q|%Q|%E|%D']),
                           ['id', 'name', 'user', 'state', 'elapsed', 'limit', 'partition', 'nodes', 'memory', 'cpus', 'gres', 'start', 'workdir', 'script', 'reason', 'submitted', 'account', 'qos', 'priority', 'dependency', 'nodeCount'])
        for j in current:
            jobs[j['id']] = dict(jobs.get(j['id'], {}), **j)
    except Exception as e:
        if not jobs:
            raise
        warnings.append('Live queue unavailable: ' + str(e))
    nodes = rows(run(['sinfo', '-N', '-h', '-o', '%N|%T|%C|%m|%E|%P|%G'], optional=True),
                 ['name', 'state', 'cpus', 'memory', 'reason', 'partition', 'gres'])
    return {'jobs': list(jobs.values()), 'nodes': nodes, 'warnings': warnings,
            'loginUser': getpass.getuser(), 'timestamp': time.time()}


def script_from_submit(submit, workdir):
    try:
        tokens = shlex.split(submit)
        # Only infer a path when the recorded submission has a recognizable script suffix.
        candidates = [t for t in tokens[1:] if not t.startswith('-') and t.endswith(('.sh', '.slurm', '.sbatch'))]
        if candidates:
            path = candidates[0]
            return path if os.path.isabs(path) else os.path.join(workdir, path)
    except ValueError:
        pass
    return ''


def expand(path, job):
    jid = job['id']
    base, _, task = jid.partition('_')
    values = {'j': jid, 'A': base, 'a': task or '4294967294', 'x': job.get('name', ''), 'u': job.get('user') or getpass.getuser(), '%': '%'}
    def replace(m):
        val = values.get(m.group(2), m.group(0))
        return val.zfill(int(m.group(1) or 0)) if val.isdigit() else val
    path = re.sub(r'%([0-9]*)([%jAaxu])', replace, path)
    return path if os.path.isabs(path) else os.path.join(job.get('workdir', ''), path)


def tail(path):
    try:
        if not stat.S_ISREG(os.stat(path).st_mode):
            return '[Not a regular file]'
        with open(path, 'rb') as f:
            if not stat.S_ISREG(os.fstat(f.fileno()).st_mode):
                return '[Not a regular file]'
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - 96000))
            data = f.read(96000).decode('utf-8', errors='replace')
        return '\n'.join(data.splitlines()[-600:]) or '[Log is empty; waiting for output]'
    except OSError as e:
        return '[%s]' % e


def logpage(job, path, offset):
    allowed = [l['path'] for l in detail(job)['logs']]
    if path not in allowed:
        raise ValueError('Log no longer associated with this job')
    with open(path, 'rb') as f:
        if not stat.S_ISREG(os.fstat(f.fileno()).st_mode):
            raise ValueError('Not a regular file')
        size = os.fstat(f.fileno()).st_size
        offset = max(0, min(int(offset), size))
        f.seek(offset)
        data = f.read(48000)
    return {'text': data.decode('utf-8', errors='replace'), 'offset': offset, 'next': offset + len(data), 'size': size}


def detail(job):
    jid = job['id']
    if not re.fullmatch(r'[0-9]+(?:_[0-9]+)?(?:\+[0-9]+)?', jid):
        raise ValueError('Unsupported job ID')
    meta = fields(run(['scontrol', 'show', 'job', '-o', jid], optional=True).strip())
    steps = rows(run(['sacct', '-j', jid, '-n', '-P', '--format=JobID%80,State%40,ExitCode,MaxRSS,Elapsed,TotalCPU,AllocCPUS,NTasks,MaxRSSNode,MaxRSSTask,AveDiskRead,AveDiskWrite,DerivedExitCode'], optional=True),
                 ['id', 'state', 'exit', 'rss', 'elapsed', 'cpu', 'cpus', 'tasks', 'peakNode', 'peakTask', 'read', 'write', 'derivedExit'])
    logs = []
    seen = set()
    for key in ['StdErr', 'StdOut']:
        path = meta.get(key) or job.get('stderr' if key == 'StdErr' else 'stdout')
        if path and path not in ('(null)', '/dev/null'):
            path = expand(path, job)
            if path not in seen:
                logs.append({'path': path, 'source': key, 'text': tail(path)})
                seen.add(path)
    if not logs or all(l['text'].startswith('[Errno') for l in logs):
        # Recover custom output destinations from the actual retained batch
        # script, falling back to the current submission file when necessary.
        try:
            recovered = job_script(job)
            options = log_directives(recovered['script'])
            options.update(log_options(shlex.split(job.get('submit', ''))[1:]))
            context = dict(job)
            if options.get('job-name'):
                context['name'] = options['job-name']
            if options.get('chdir'):
                wd = options['chdir']
                context['workdir'] = wd if os.path.isabs(wd) else os.path.join(job.get('workdir', ''), wd)
            output = options.get('output') or ('slurm-%A_%a.out' if '_' in jid else 'slurm-%j.out')
            error = options.get('error') or output
            inferred = '(inferred from current script)' if 'current file' in recovered['source'] else '(recovered script)'
            for kind, pattern in [('stderr', error), ('stdout', output)]:
                path = expand(pattern, context)
                if path not in seen:
                    logs.append({'path': path, 'source': kind+' '+inferred, 'text': tail(path)})
                    seen.add(path)
        except (OSError, ValueError, RuntimeError):
            pass
    if (not logs or all(l['text'].startswith('[Errno') for l in logs)) and job.get('workdir'):
        try:
            # Only the working directory and its conventional log folders; never a recursive home scan.
            matches = []
            pattern = re.compile(r'(?<![0-9])' + re.escape(jid) + r'(?![0-9])')
            for directory in [job['workdir'], os.path.join(job['workdir'], 'logs'), os.path.join(job['workdir'], 'log')]:
                try:
                    with os.scandir(directory) as entries:
                        for n, entry in enumerate(entries):
                            if n > 10000:
                                break
                            if pattern.search(entry.name) and entry.is_file() and entry.name.endswith(('.out', '.err', '.log')):
                                matches.append(entry.path)
                except OSError:
                    pass
            for path in sorted(matches, key=lambda p: (not p.endswith('.err'), p))[:8]:
                logs.append({'path': path, 'source': ('stderr' if path.endswith('.err') else 'stdout' if path.endswith('.out') else 'log') + ' (inferred)', 'text': tail(path)})
        except OSError:
            pass
    logs.sort(key=lambda item: item['text'].startswith('[Errno'))
    return {'meta': meta, 'steps': steps, 'logs': logs}


def log_options(tokens):
    result = {}
    aliases = {'o':'output', 'e':'error', 'D':'chdir', 'J':'job-name'}
    index = 0
    while index < len(tokens):
        token = tokens[index]
        key = value = None
        if token.startswith('--'):
            part = token[2:].split('=', 1)
            if part[0] in aliases.values():
                key = part[0]
                if len(part) == 2:
                    value = part[1]
                elif index+1 < len(tokens):
                    index += 1; value = tokens[index]
        elif token.startswith('-') and len(token)>1 and token[1] in aliases:
            key = aliases[token[1]]
            if len(token)>2: value = token[2:]
            elif index+1 < len(tokens):
                index += 1; value = tokens[index]
        if key and value is not None:
            result[key] = value
        index += 1
    return result


def log_directives(script):
    options = {}
    for line in script.splitlines()[1:]:
        if re.match(r'^\s*#SBATCH\b', line):
            options.update(log_options(shlex.split(re.sub(r'^\s*#SBATCH\s*', '', line), comments=True)))
        elif line.strip() and not line.lstrip().startswith('#'):
            break
    return options


def job_script(job):
    jid = job['id']
    if not re.fullmatch(r'[0-9]+(?:_[0-9]+)?', jid):
        raise ValueError('Unsupported job ID')
    text = run(['scontrol', 'write', 'batch_script', jid, '-'], optional=True)
    if not text.strip():
        text = run(['sacct', '-j', jid, '--batch-script'], optional=True)
    if '#!' in text:
        return {'script': text[text.index('#!'):], 'workdir': job.get('workdir', ''), 'source': 'Stored batch script for ' + jid}
    path = job.get('script')
    if path:
        result = read_script(path)
        result['source'] += ' (current file; may differ from submitted version)'
        result['workdir'] = job.get('workdir') or result['workdir']
        return result
    raise ValueError('No retained batch script. Use B to open an existing remote .sh/.slurm file.')


def read_script(path):
    path = os.path.abspath(os.path.expanduser(path))
    if not stat.S_ISREG(os.stat(path).st_mode):
        raise ValueError('Not a regular script file')
    with open(path, 'rb') as f:
        if not stat.S_ISREG(os.fstat(f.fileno()).st_mode):
            raise ValueError('Not a regular script file')
        data = f.read(200001)
    if len(data) > 200000:
        raise ValueError('Script exceeds 200 KB')
    text = data.decode('utf-8')
    if not text.startswith('#!'):
        raise ValueError('Batch script needs a #! interpreter line')
    return {'script': text, 'workdir': os.path.dirname(path), 'source': path}


def capabilities():
    warnings = []
    partitions = [fields(l) for l in run(['scontrol', 'show', 'partition', '-o'], optional=True).splitlines()]
    nodes = [fields(l) for l in run(['scontrol', 'show', 'node', '-o'], optional=True).splitlines()]
    qos = run(['sacctmgr', '-n', '-P', 'show', 'qos', 'format=Name,MaxWall,MaxTRESPU,MaxJobsPU,MaxSubmitPU'], optional=True)
    accounts = run(['sacctmgr', '-n', '-P', 'show', 'assoc', 'where', 'user=' + getpass.getuser(), 'format=Account,Partition,QOS,DefaultQOS,MaxJobs,MaxSubmit,GrpTRES'], optional=True)
    # Config uses padded "key = value"; extract only the settings needed by the UI.
    raw = run(['scontrol', 'show', 'config'], optional=True)
    frequency = re.search(r'JobAcctGatherFrequency\s*=\s*(\d+)', raw)
    config = dict(re.findall(r'^\s*(\w+)\s*=\s*(.*?)\s*$', raw, re.M))
    if not accounts:
        warnings.append('Account restrictions unavailable; scheduler validation remains authoritative.')
    return {'partitions': partitions, 'nodes': nodes,
            'qos': rows(qos, ['name', 'maxWall', 'maxTres', 'maxJobs', 'maxSubmit']),
            'accounts': rows(accounts, ['account', 'partition', 'qos', 'defaultQos', 'maxJobs', 'maxSubmit', 'groupTres']),
            'config': {k: config.get(k, '') for k in ['MaxArraySize', 'DefMemPerCPU', 'MaxMemPerCPU', 'PriorityType', 'SchedulerType', 'AccountingStorageTRES', 'JobAcctGatherType']},
            'sampleSeconds': int(frequency.group(1)) if frequency else None, 'warnings': warnings}


def metrics(job):
    jid = job['id']
    if not re.fullmatch(r'[0-9]+(?:_[0-9]+)?(?:\+[0-9]+)?', jid):
        raise ValueError('Select an individual job for metrics')
    output = run(['sstat', '-a', '-j', jid, '-n', '-P',
                  '--format=JobID%80,NTasks,AveCPU,AveRSS,MaxRSS,TRESUsageInAve,AveDiskRead,AveDiskWrite'])
    return {'time': time.time(), 'steps': rows(output, ['id', 'tasks', 'cpu', 'rss', 'peak', 'tres', 'read', 'write'])}


def scheduling(job):
    jid = job['id']
    if not re.fullmatch(r'[0-9]+(?:_[0-9]+)?', jid):
        raise ValueError('Choose one job to inspect scheduling.')
    return {'priority': rows(run(['sprio', '-j', jid, '-h', '-o', '%i|%Y|%A|%F|%Q|%P|%T'], optional=True),
                             ['id', 'total', 'age', 'fairshare', 'qos', 'partition', 'tres']),
            'estimate': rows(run(['squeue', '--start', '-j', jid, '-h', '-o', '%i|%S|%Y|%r'], optional=True),
                             ['id', 'start', 'nodes', 'reason']), 'time': time.time()}


def resources(user):
    if not re.fullmatch(r'[\w.@-]+', user):
        raise ValueError('Choose one username for account information.')
    share = run(['sshare', '-n', '-P', '-u', user, '-o', 'Account,User,RawShares,NormShares,RawUsage,EffectvUsage,FairShare'], optional=True)
    return {'shares': rows(share, ['account', 'user', 'shares', 'normalized', 'usage', 'effective', 'fairshare']),
            'reservations': [fields(l) for l in run(['scontrol', 'show', 'reservation', '-o'], optional=True).splitlines() if 'ReservationName=' in l],
            'time': time.time(), 'warning': '' if share else 'Fair-share information is unavailable on this cluster or for this user.'}


def action(request):
    if request['op'] in ('submit', 'validate'):
        script = request.get('script', '')
        cwd = request.get('workdir', '')
        if not script.startswith('#!') or len(script.encode()) > 200000:
            raise ValueError('Invalid batch script')
        if not os.path.isabs(cwd) or not os.path.isdir(cwd):
            raise ValueError('Choose an existing absolute submission directory')
        command = ['sbatch', '--test-only'] if request['op'] == 'validate' else ['sbatch', '--parsable']
        if request['op'] == 'submit' and request.get('confirmed') is not True:
            raise ValueError('Submission must be confirmed from the preview')
        env = {k: v for k, v in os.environ.items() if not k.startswith('SBATCH_')}
        p = subprocess.run(command, input=script, universal_newlines=True, cwd=cwd, env=env,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=25)
        if p.returncode:
            raise RuntimeError(p.stderr.strip() or 'sbatch rejected the script')
        result = (p.stdout + p.stderr).strip() or 'Scheduler validation passed'
        return {'result': result, 'jobId': p.stdout.strip().split(';')[0] if request['op'] == 'submit' else None}
    job = request['job']; jid = job['id']
    if not re.fullmatch(r'[0-9]+(?:_[0-9]+)?', jid):
        raise ValueError('Unsupported job ID')
    if request['op'] == 'cancel':
        if request.get('confirmed') is not True:
            raise ValueError('Cancellation must be confirmed for this job ID')
        return {'result': run(['scancel', jid]) or 'Cancellation requested'}
    if request['op'] == 'script':
        return job_script(job)
    raise ValueError('Unknown action')


if __name__ == '__main__':
    try:
        request = json.loads(sys.argv[1]) if len(sys.argv) > 1 else json.load(sys.stdin)
        if request['op'] == 'list':
            result = snapshot(request['days'], request['user'])
        elif request['op'] == 'capabilities':
            result = capabilities()
        elif request['op'] == 'open':
            result = read_script(request['path'])
        elif request['op'] == 'new':
            result = {'workdir': os.path.expanduser('~'), 'source': 'New job', 'script': '#!/bin/bash\n#SBATCH --job-name=new-job\n#SBATCH --time=00:10:00\n#SBATCH --cpus-per-task=1\n#SBATCH --mem=1G\n#SBATCH --output=%x-%j.out\n#SBATCH --error=%x-%j.err\n', 'isNew': True, 'command': ''}
        elif request['op'] == 'metrics':
            result = metrics(request['job'])
        elif request['op'] == 'scheduling':
            result = scheduling(request['job'])
        elif request['op'] == 'resources':
            result = resources(request['user'])
        elif request['op'] in ('cancel', 'script', 'submit', 'validate'):
            result = action(request)
        elif request['op'] == 'log':
            result = logpage(request['job'], request['path'], request.get('offset', 0))
        else:
            result = detail(request['job'])
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)
