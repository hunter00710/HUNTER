import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {openStore,seed,snapshot,change,exportBackup,verifyAudit,hash,Fault,revision} from '../src/store.js';
import {addUser} from '../src/auth.js';
import {createApp} from '../src/server.js';
import E from '../src/control-engine.cjs';
import F from '../src/finance-engine.cjs';
import {fixture} from './fixture.js';
const password='Synthetic-only!Password-2026';
function setup(){const db=openStore(':memory:');seed(db,fixture(),'test');const users={};for(const role of ['admin','finance','reviewer','sales','viewer']){const u=addUser(db,{login:role,password,role,scope:role==='sales'?['DEMO-001']:['*']});users[role]=db.prepare('SELECT * FROM users WHERE id=?').get(u.id);}return {db,users};}
const receipt=(id='R1',po='DEMO-001',net=1000)=>({id,ref:'BANK-'+id,date:'2026-10-29',bank:net+50,tax:50,fee:0,verified:false,evidence:'Synthetic evidence',allocations:[{po,net,invoice:'INV-DEMO',planId:''}]});
const op=(collection,id,data,version=0)=>({collection,id,data,version});
test('multi-PO receipt, exact balance, unknown opening, duplicate reference, over allocation and void',()=>{
 const {db,users:u}=setup();try{
  const t=receipt();t.allocations.push({po:'DEMO-002',net:500,invoice:'',planId:''});t.bank=1550;
  change(db,u.finance,[op('receipts','R1',t)]);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM allocations').get().n,2);
  assert.equal(E.orders(snapshot(db).D,snapshot(db).state.control).find(x=>x.po==='DEMO-001').balance,7000);
  for(const bad of [{...receipt('R2'),bank:1},receipt('R2','DEMO-UNKNOWN'),receipt('R2','DEMO-001',9000),{...receipt('R2'),ref:'BANK-R1'}])assert.throws(()=>change(db,u.finance,[op('receipts',bad.id,bad)]));
  assert.throws(()=>change(db,u.finance,[op('receipts','R1',{...t,bank:2},1)]));
  change(db,u.finance,[op('receipts','R1',{...t,void:'Synthetic reversal'},1)]);
  assert.equal(E.orders(snapshot(db).D,snapshot(db).state.control)[0].balance,8000);
  assert.throws(()=>change(db,u.finance,[op('receipts','R2',{...receipt('R2'),ref:t.ref})]));
 }finally{db.close();}
});
test('role and PO scope, maker-checker separation, immutable transactions and audit chain',()=>{
 const {db,users:u}=setup();try{
  assert.throws(()=>change(db,u.viewer,[op('orders','DEMO-001',{owner:'x',evidence:'test'},1)]),e=>e.status===403);
  change(db,u.sales,[op('orders','DEMO-001',{po:'DEMO-001',amount:10000,paidBase:2000,owner:'sales',acceptance:'已驗收',evidence:'test'},1)]);
  assert.throws(()=>change(db,u.sales,[op('orders','DEMO-002',{owner:'sales',evidence:'test'},1)]),e=>e.status===403);
  assert.throws(()=>change(db,u.sales,[op('orders','DEMO-001',{amount:20000,evidence:'test'},2)]),e=>e.status===403);
  change(db,u.finance,[op('orders','DEMO-001',{amount:11000,paidBase:2100,owner:'finance',evidence:'Financial correction'},2)]);
  change(db,u.sales,[op('orders','DEMO-001',{owner:'sales followup',evidence:'Delivery only'},3)]);
  assert.equal(snapshot(db).state.control.records['DEMO-001'].amount,11000);
  assert.equal(snapshot(db).state.control.records['DEMO-001'].paidBase,2100);
  change(db,u.finance,[op('receipts','R1',receipt())]);
  assert.throws(()=>change(db,u.finance,[op('receipts','R1',{...receipt(),verified:true},1)]),e=>e.status===403);
  assert.throws(()=>change(db,u.admin,[op('receipts','R2',{...receipt('R2'),verified:true})]),e=>e.status===403);
  change(db,u.reviewer,[op('receipts','R1',{...receipt(),verified:true,evidence:'Reviewer check'},1)]);
  const verified=snapshot(db).state.control.receipts[0];assert.equal(verified.reviewedBy,u.reviewer.id);
  assert.throws(()=>change(db,u.reviewer,[op('receipts','R1',{...verified,bank:2},2)]));
  const rows=db.prepare('SELECT * FROM audit ORDER BY seq').all();assert(verifyAudit(rows));const tampered=structuredClone(rows);tampered[0].actor='tampered';assert(!verifyAudit(tampered));
  assert.throws(()=>db.prepare("UPDATE audit SET actor='x'").run());assert.throws(()=>db.prepare('DELETE FROM audit').run());
 }finally{db.close();}
});
test('record versions allow independent changes and reject same-record lost updates atomically',()=>{
 const {db,users:u}=setup();try{
  const rev=revision(db);change(db,u.finance,[op('orders','DEMO-001',{owner:'A',evidence:'test'},1)]);
  change(db,u.finance,[op('orders','DEMO-002',{owner:'B',evidence:'test'},1)]);
  assert.equal(revision(db),rev+2);
  assert.throws(()=>change(db,u.finance,[op('orders','DEMO-002',{owner:'C',evidence:'test'},2),op('orders','DEMO-001',{owner:'stale',evidence:'test'},1)]),e=>e.status===409);
  assert.equal(snapshot(db).state.control.records['DEMO-002'].owner,'B');
 }finally{db.close();}
});
test('AP currency totals, snapshot dates, reference uniqueness and overpayment',()=>{
 const {db,users:u}=setup();try{
  const p={id:'P1',recordId:'DEMO-AP-1',ref:'PAY-DEMO',date:'2026-10-29',amount:200,verified:false,note:'test'};
  change(db,u.finance,[op('payments','P1',p)]);
  assert.throws(()=>change(db,u.finance,[op('payments','P2',{...p,id:'P2',ref:'PAY-2',amount:3000})]));
  assert.throws(()=>change(db,u.finance,[op('payments','P2',{...p,id:'P2',ref:'PAY-2',amount:2300.5})]));
  assert.throws(()=>change(db,u.finance,[op('payments','P2',{...p,id:'P2'})]));
  assert.throws(()=>change(db,u.finance,[op('payments','P2',{...p,id:'P2',ref:'PAY-2',date:'2026-10-26'})]));
  change(db,u.reviewer,[op('payments','P1',{...p,verified:true,evidence:'independent check'},1)]);
  assert.equal(snapshot(db).state.ap.payments[0].verified,true);
 }finally{db.close();}
});
test('AR plan allocation remaining, cancellation and scenario missing inputs/delay outside 13 weeks',()=>{
 const {db,users:u}=setup();try{
  const p={id:'ARP-DEMO',kind:'ar',po:'DEMO-001',date:'2026-10-30',net:2000,cash:2100,status:'已確認',basis:'Synthetic contract',evidence:'Synthetic check'};
  change(db,u.finance,[op('plans',p.id,p)]);
  const t=receipt();t.allocations[0].planId=p.id;change(db,u.finance,[op('receipts','R1',t)]);
  const ss=snapshot(db),pl=E.plans(ss.D,ss.state.control).find(x=>x.id===p.id);assert.equal(pl.remaining,1000);assert.equal(pl.cashRemaining,1050);
  const missing=E.cash({D:ss.D,S:ss.state.control,start:'2026-10-30'});assert.equal(missing.minimum,null);assert(missing.problems.length>=3);
  const delayed=E.cash({D:ss.D,S:ss.state.control,start:'2026-10-30',opening:100,reserve:20,opex:0,delay:13});assert.equal(delayed.receipt,0);assert.equal(delayed.delayedOutside,1050);
  const fx=E.cash({D:ss.D,S:ss.state.control,start:'2026-10-30',opening:10000,reserve:0,opex:0,apPlans:[{status:'已確認計畫',date:'2026-10-31',amount:100,currency:'USD'}],rates:{USD:30},fxShock:.1});assert.equal(fx.payment,3300.0000000000005);
  assert.equal(F.investment({capex:null,working:0,annual:[1],salvage:0,recovery:0,rate:0}).ready,false);
 }finally{db.close();}
});
test('logical backup restore, no credentials and full foreign-key/audit validation',()=>{
 const {db,users:u}=setup(),dir=mkdtempSync(join(tmpdir(),'jplus-backup-'));try{
  change(db,u.finance,[op('receipts','R1',receipt())]);const backup=exportBackup(db,u.admin);const str=JSON.stringify(backup);assert(!str.includes('password_hash'));assert(!str.includes('csrf_hash'));assert(!str.includes('scrypt$'));
  const file=join(dir,'test.backup.json'),dbFile=join(dir,'restored.sqlite');writeFileSync(file,str);
  execFileSync(process.execPath,['scripts/admin.js','restore',file],{env:{...process.env,DB_PATH:dbFile},stdio:'pipe'});
  const restored=openStore(dbFile);assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM receipts').get().n,1);assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM allocations').get().n,1);assert(verifyAudit(restored.prepare('SELECT * FROM audit ORDER BY seq').all()));assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM users WHERE active=1').get().n,0);restored.close();
  assert.throws(()=>exportBackup(db,u.sales),e=>e.status===403);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('HTTP authentication, CSRF, origin, scope, session revoke and real two-client conflicts',async()=>{
 const {db,users:u}=setup();const server=createApp({db,origin:'http://127.0.0.1:31991'});await new Promise(r=>server.listen(31991,'127.0.0.1',r));
 const origin='http://127.0.0.1:31991';
 const req=async(path,{cookie,csrf,method='GET',data,originHeader=origin}={})=>fetch(origin+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...(method!=='GET'?{'Content-Type':'application/json',Origin:originHeader}:{})},body:data===undefined?undefined:JSON.stringify(data)});
 const auth=async who=>{const r=await req('/api/login',{method:'POST',data:{login:who,password}});assert.equal(r.status,200);return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:(await r.json()).csrf};};
 try{
  assert.equal((await req('/api/snapshot')).status,401);assert.equal((await req('/workspace')).status,401);
  const a=await auth('finance'),b=await auth('finance'),sales=await auth('sales'),viewer=await auth('viewer');
  await req('/desk',a); // Opening another authenticated tab must not invalidate an earlier form's CSRF.
  assert.equal((await req('/api/changes',{...a,csrf:'wrong',method:'POST',data:{changes:[]}})).status,403);
  assert.equal((await req('/api/changes',{...a,originHeader:'https://evil.invalid',method:'POST',data:{changes:[]}})).status,403);
  assert.equal((await req('/api/snapshot',sales)).status,403);assert.equal((await req('/api/backup',viewer)).status,403);
  const limited=await (await req('/api/orders',sales)).json();assert.equal(limited.length,1);assert.equal(limited[0].po,'DEMO-001');
  assert.equal((await req('/api/orders/DEMO-002',sales)).status,404);
  assert.equal((await req('/api/payables',sales)).status,403);
  assert.equal((await (await req('/api/payables/DEMO-AP-1',a)).json()).source.currency,'USD');
  const update={method:'POST',data:{changes:[op('orders','DEMO-001',{owner:'Client A',evidence:'test'},1)]}};
  const results=await Promise.all([req('/api/changes',{...a,...update}),req('/api/changes',{...b,...update})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal((await req('/api/logout',{...a,method:'POST',data:{}})).status,200);assert.equal((await req('/api/orders',a)).status,401);
  const admin=await auth('admin'),ur=await req('/api/users/'+u.finance.id,{...admin,method:'PATCH',data:{version:1,active:0}});assert.equal(ur.status,200);assert.equal((await req('/api/orders',b)).status,401);
 }finally{await new Promise(r=>server.close(r));db.close();}
});
