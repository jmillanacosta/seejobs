import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {importGuides,fieldAdvice} from '../src/guides.js';
test('guide import stores sourced advice without applying example options',()=>{
  const dir=mkdtempSync(join(tmpdir(),'seejobs-guides-'));
  try{
    writeFileSync(join(dir,'guide.md'),'# GPU jobs\nUse --gres=gpu:1 with --qos=accelerated.\nCheck your allocation first.\n\n# Time limit\nSet --time=01:00:00 for the example.\n');
    mkdirSync(join(dir,'node_modules'));writeFileSync(join(dir,'node_modules','ignore.md'),'# GPU jobs\n--gres=secret\n');
    const g=importGuides(dir);assert.equal(g.version,1);assert.equal(g.filesRead,1);
    assert.match(fieldAdvice(g,'gres'),/guide.md.*GPU jobs/);assert.match(fieldAdvice(g,'qos'),/accelerated/);
    assert(!JSON.stringify(g).includes('secret'));assert.equal(g.defaults,undefined);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
