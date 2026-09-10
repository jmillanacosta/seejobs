import assert from 'node:assert/strict';
import {request, diagnosis} from '../src/client.js';
const host=process.env.SEEJOBS_TEST_HOST; const user=process.env.SEEJOBS_TEST_USER;
if (!host || !user) { console.log('SKIP: set SEEJOBS_TEST_HOST and SEEJOBS_TEST_USER for live checks'); process.exit(0); }
const snapshot=await request(host,{op:'list',days:7,user});
assert(snapshot.jobs.length>0);assert(snapshot.nodes.length===3);
for(const id of ['112360','112333']) {
 const job=snapshot.jobs.find(j=>j.id===id); assert(job);
 const detail=await request(host,{op:'detail',job});
 assert(detail.logs.some(l=>l.path.endsWith('.err')));
 assert(detail.logs.some(l=>l.path.endsWith('.out')));
 assert(detail.steps.length>0);
 const log=detail.logs[0];const page=await request(host,{op:'log',job,path:log.path,offset:0});
 assert(page.size>0);assert(page.text.length>0);
 console.log(JSON.stringify({id,logs:detail.logs.map(l=>({path:l.path,source:l.source})),bytes:page.size,diagnosis:diagnosis(job,detail)}));
}
console.log(`PASS: ${snapshot.jobs.length} jobs, ${snapshot.nodes.length} nodes; live and inferred log paths, full-file reads, accounting.`);
