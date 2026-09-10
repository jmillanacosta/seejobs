import unittest, importlib.util, tempfile, os
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('remote','src/remote.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class RemoteTests(unittest.TestCase):
    def test_json_normalization(self):
        q={'job_id':7,'array_job_id':{'set':True,'number':4},'array_task_id':{'set':True,'number':2},
           'job_state':['PENDING'],'cpus':{'set':True,'number':16},'time_limit':{'set':True,'number':60},
           'current_working_directory':'/work','tres_per_node':'gres/gpu:1','user_name':'bob'}
        j=m.queue_job(q)
        self.assertEqual(j['id'],'4_2');self.assertEqual(j['state'],'PENDING')
        self.assertEqual(j['cpus'],'16');self.assertEqual(j['limit'],'01:00:00')
        self.assertIn('gpu',j['gres']);self.assertEqual(j['workdir'],'/work')
    def test_all_user_scope_and_json_fallback(self):
        calls=[]
        def fake(args,optional=False):
            calls.append(args)
            if args[0]=='squeue' and '--json' in args:return '{"errors":[{"error":"unavailable"}]}'
            if args[0]=='squeue':return '9|train|bob|PENDING|00:00|01:00|gpu||1G|2|gpu:1|||/work/train.sh|Resources|2026-01-01T12:00:00|account|normal|1||1'
            return ''
        with patch.object(m,'run',side_effect=fake):
            result=m.snapshot(7,'')
        self.assertEqual(result['jobs'][0]['user'],'bob')
        self.assertTrue(any('--allusers' in c for c in calls))
        self.assertTrue(all('-u' not in c for c in calls if c[0]=='squeue'))
    def test_submit_requires_confirmation_and_cwd(self):
        with tempfile.TemporaryDirectory() as d:
            payload={'op':'submit','script':'#!/bin/bash\necho hello','workdir':d}
            with self.assertRaises(ValueError):m.action(payload)
            payload['confirmed']=True
            with patch.object(m.subprocess,'run') as run:
                run.return_value.returncode=0;run.return_value.stdout='123';run.return_value.stderr=''
                self.assertEqual(m.action(payload)['result'],'123')
                self.assertEqual(run.call_args.kwargs['cwd'],d)
                self.assertEqual(run.call_args.args[0],['sbatch','--parsable'])
    def test_fields_with_spaces(self):
        self.assertEqual(m.fields('JobId=12 WorkDir=/tmp/a b StdOut=/tmp/c d')['WorkDir'],'/tmp/a b')
    def test_array_paths(self):
        self.assertEqual(m.expand('logs/%x-%A_%04a.out',{'id':'12_3','name':'train','workdir':'/work'}),'/work/logs/train-12_0003.out')
    def test_old_custom_logs_from_script(self):
        with tempfile.TemporaryDirectory() as d:
            path=os.path.join(d,'custom output.err')
            with open(path,'w') as f:f.write('Original failure')
            script='#!/bin/bash\n#SBATCH -e "custom output.err"\n#SBATCH --output=missing.out\necho hello\n'
            with patch.object(m,'run',return_value=''), patch.object(m,'job_script',return_value={'script':script,'source':'Stored batch script'}):
                result=m.detail({'id':'12','workdir':d,'name':'train'})
            self.assertEqual(result['logs'][0]['text'],'Original failure')
            self.assertIn('recovered',result['logs'][0]['source'])
    def test_header_body_not_interpreted_and_multiline_accounting(self):
        opts=m.log_directives('#!/bin/bash\n#SBATCH -o logs/%j.out\necho hello\n#SBATCH -o wrong.out')
        self.assertEqual(opts['output'],'logs/%j.out')
        self.assertEqual(m.rows('1|FAILED|foo\ncontinuation\n2|COMPLETED|bar',['id','state','submit'])[1]['id'],'2')
    def test_log_match_and_full_chunks(self):
        with tempfile.TemporaryDirectory() as d:
            for name in ['slurm-12.err','slurm-12.out','slurm-112.err']:
                with open(os.path.join(d,name),'w') as f:f.write('first\n'+'a'*100000+'\nlast')
            job={'id':'12','workdir':d,'name':'train'}
            with patch.object(m,'run',return_value=''):
                logs=m.detail(job)['logs']
                self.assertEqual(len(logs),2)
                path=logs[0]['path']; a=m.logpage(job,path,0); b=m.logpage(job,path,a['next'])
                self.assertEqual(a['next'],b['offset'])
                self.assertTrue(a['text'].startswith('first'))
                self.assertTrue(m.tail(path).endswith('last'))
                with self.assertRaises(ValueError):m.logpage(job,'/etc/passwd',0)
if __name__=='__main__': unittest.main()
