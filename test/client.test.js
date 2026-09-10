import test from 'node:test';
import assert from 'node:assert/strict';
import {clean, diagnosis, active, failed} from '../src/client.js';
test('terminal controls from remote logs are removed',()=>{
  assert.equal(clean('\x1b[31merror\x1b[0m\x1b]0;bad title\x07\x00'),'error');
});
test('scheduler failures are distinguished from log evidence',()=>{
  const result=diagnosis({state:'OUT_OF_MEMORY',exit:'0:9'},{logs:[{text:'CUDA out of memory\nValueError: bad input'}]});
  assert.match(result[0],/Slurm reports out of memory/);
  assert.match(result[1],/^Log clue:/);
  assert.equal(active({state:'PENDING'}),true);
  assert.equal(failed({state:'CANCELLED by 123'}),true);
});
