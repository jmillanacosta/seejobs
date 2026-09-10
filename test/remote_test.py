import unittest, importlib.util, tempfile, os
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('remote','src/remote.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class RemoteTests(unittest.TestCase):
    def test_fields_with_spaces(self):
        self.assertEqual(m.fields('JobId=12 WorkDir=/tmp/a b StdOut=/tmp/c d')['WorkDir'],'/tmp/a b')
    def test_array_paths(self):
        self.assertEqual(m.expand('logs/%x-%A_%04a.out',{'id':'12_3','name':'train','workdir':'/work'}),'/work/logs/train-12_0003.out')
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
