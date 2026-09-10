import sys, json, subprocess, os, re, stat


def run(args, optional=False):
    p = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, timeout=18)
    if p.returncode and not optional:
        raise RuntimeError(p.stderr.strip() or 'Command failed: ' + args[0])
    return p.stdout if p.returncode == 0 else ''


def fields(line):
    return dict(re.findall(r'(?:^|\s)([A-Za-z][A-Za-z0-9:/]*)=(.*?)(?=\s[A-Za-z][A-Za-z0-9:/]*=|$)', line))


def rows(text, keys):
    return [dict(zip(keys, line.split('|'))) for line in text.splitlines() if line.strip()]


def snapshot(days, user):
    keys = ['id', 'name', 'state', 'exit', 'elapsed', 'partition', 'nodes', 'memory', 'cpus', 'start', 'end', 'workdir', 'reason']
    warnings = []
    jobs = {}
    try:
        history = run(['sacct', '-u', user, '-S', 'now-%ddays' % days, '-X', '-n', '-P', '--format=JobID,JobName%100,State%40,ExitCode,Elapsed,Partition,NodeList,ReqMem,AllocCPUS,Start,End,WorkDir%1000,Reason%200'])
        jobs = {j['id']: j for j in rows(history, keys)}
    except Exception as e:
        warnings.append(str(e))
    queue = run(['squeue', '-u', user, '-r', '-h', '-o', '%i|%j|%u|%T|%M|%l|%P|%N|%m|%C|%b|%S|%Z|%o|%r'])
    for j in rows(queue, ['id', 'name', 'user', 'state', 'elapsed', 'limit', 'partition', 'nodes', 'memory', 'cpus', 'gres', 'start', 'workdir', 'script', 'reason']):
        jobs[j['id']] = dict(jobs.get(j['id'], {}), **j)
    try:
        nodes = rows(run(['sinfo', '-N', '-h', '-o', '%N|%T|%C|%m|%E']), ['name', 'state', 'cpus', 'memory', 'reason'])
    except Exception as e:
        nodes = []
        warnings.append(str(e))
    return {'jobs': list(jobs.values()), 'nodes': nodes, 'warnings': warnings}


def expand(path, job):
    jid = job['id']
    base, _, task = jid.partition('_')
    values = {'j': jid, 'A': base, 'a': task or '4294967294', 'x': job.get('name', ''), 'u': os.environ['USER'], '%': '%'}
    def replace(m):
        val = values.get(m.group(2), m.group(0))
        return val.zfill(int(m.group(1) or 0)) if val.isdigit() else val
    path = re.sub(r'%([0-9]*)([%jAaxu])', replace, path)
    return path if os.path.isabs(path) else os.path.join(job.get('workdir', ''), path)


def tail(path):
    try:
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
    steps = rows(run(['sacct', '-j', jid, '-n', '-P', '--format=JobID,State,ExitCode,MaxRSS,Elapsed,TotalCPU'], optional=True), ['id', 'state', 'exit', 'rss', 'elapsed', 'cpu'])
    logs = []
    seen = set()
    for key in ['StdErr', 'StdOut']:
        path = meta.get(key)
        if path and path not in ('(null)', '/dev/null'):
            path = expand(path, job)
            if path not in seen:
                logs.append({'path': path, 'source': key, 'text': tail(path)})
                seen.add(path)
    if not logs and job.get('workdir'):
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
    return {'meta': meta, 'steps': steps, 'logs': logs}


def job_script(job):
    jid = job['id']
    if not re.fullmatch(r'[0-9]+(?:_[0-9]+)?', jid):
        raise ValueError('Unsupported job ID')
    text = run(['scontrol', 'write', 'batch_script', jid, '-'], optional=True)
    if not text.strip():
        raise ValueError('Slurm did not return a batch script for this job')
    return {'script': text}


def action(request):
    job = request['job']; jid = job['id']
    if not re.fullmatch(r'[0-9]+(?:_[0-9]+)?', jid):
        raise ValueError('Unsupported job ID')
    if request['op'] == 'cancel':
        return {'result': run(['scancel', jid]) or 'Cancellation requested'}
    if request['op'] == 'script':
        return job_script(job)
    if request['op'] == 'submit':
        script = request.get('script', '')
        if not script or len(script) > 200000 or not script.lstrip().startswith('#!'):
            raise ValueError('Invalid batch script')
        p = subprocess.run(['sbatch'], input=script, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=18)
        if p.returncode:
            raise RuntimeError(p.stderr.strip() or 'sbatch failed')
        return {'result': p.stdout.strip()}
    raise ValueError('Unknown action')


if __name__ == '__main__':
    try:
        request = json.loads(sys.argv[1])
        if request['op'] == 'list':
            result = snapshot(request['days'], request['user'])
        elif request['op'] in ('cancel', 'script', 'submit'):
            result = action(request)
        elif request['op'] == 'log':
            result = logpage(request['job'], request['path'], request.get('offset', 0))
        else:
            result = detail(request['job'])
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)
