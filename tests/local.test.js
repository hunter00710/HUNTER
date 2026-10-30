import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,existsSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initializeLocal,loadLocal,checkNode,availablePort} from '../scripts/local.js';
import {openStore,verifyAudit} from '../src/store.js';
import {passwordCheck} from '../src/auth.js';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
test('local setup produces isolated database, five roles, no plaintext password config, no overwrite',async()=>{
 const root=mkdtempSync(join(tmpdir(),'jplus-local-'));try{
  const password='Synthetic-admin-only-2026!';
  const r=initializeLocal({root,adminPassword:password,port:3010});
  assert.equal(r.accounts.length,5);assert.equal(r.plan.poA,'DEMO-001');assert.equal(r.plan.poB,'DEMO-002');
  const file=readFileSync(join(root,'local','config.json'),'utf8');for(const a of r.accounts)assert(!file.includes(a.password));
  assert.equal(loadLocal(root).origin,'http://127.0.0.1:3010');
  const db=openStore(r.config.dbPath),users=db.prepare('SELECT * FROM users').all();assert.equal(users.length,5);
  const sales=users.find(u=>u.role==='sales');assert.deepEqual(JSON.parse(sales.scope),['DEMO-001']);
  const admin=users.find(u=>u.role==='admin');assert(await passwordCheck(password,admin.password_hash));assert(verifyAudit(db.prepare('SELECT * FROM audit ORDER BY seq').all()));db.close();
  assert.throws(()=>initializeLocal({root,adminPassword:password}),e=>e.status===409);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('failed setup does not leave a usable partial configuration',()=>{
 const root=mkdtempSync(join(tmpdir(),'jplus-local-'));try{
  assert.throws(()=>initializeLocal({root,adminPassword:'short'}));assert(!existsSync(join(root,'local','config.json')));
  const r=initializeLocal({root,adminPassword:'Valid-synthetic-password!'});assert(existsSync(r.config.dbPath));
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('runtime version guard and localhost port probe',async()=>{
 checkNode('24.22.1');checkNode('24.22.2');assert.throws(()=>checkNode('22.22.0'));assert.throws(()=>checkNode('26.0.0'));assert.throws(()=>checkNode('24.21.0'));
 assert.equal(typeof await availablePort(31997),'boolean');
});
test('local launcher serves authenticated guide, rejects sales plan access, backs up and restarts persistently',async()=>{
 const root=mkdtempSync(join(tmpdir(),'jplus-launch-')),probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const init=initializeLocal({root,adminPassword:'Synthetic-launch-admin-2026!',port}),origin=init.config.origin;let child;
 const launch=()=>new Promise((resolve,reject)=>{
  child=spawn(process.execPath,['scripts/local.js','start','--home',root,'--no-browser'],{stdio:['ignore','pipe','pipe']});
  const timer=setTimeout(()=>reject(Error('Launcher did not become ready')),10000);child.once('error',e=>{clearTimeout(timer);reject(e);});
  child.stdout.on('data',chunk=>{if(chunk.toString().includes('JPLUS prototype listening')){clearTimeout(timer);resolve();}});
  child.once('exit',code=>{clearTimeout(timer);if(code)reject(Error('Launcher failed'));});
 });
 const stop=async()=>{if(!child||child.exitCode!==null||child.signalCode!==null)return;const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await done;};
 const auth=async role=>{const a=init.accounts.find(a=>a.role===role),r=await fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({login:a.login,password:a.password})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
 try{
  await launch();assert.equal((await fetch(origin+'/health')).status,200);assert.equal((await fetch(origin+'/guide')).status,401);
  let cookie=await auth('admin');const plan=await (await fetch(origin+'/api/uat-plan',{headers:{Cookie:cookie}})).json();assert.equal(plan.poA,'DEMO-001');
  assert((await (await fetch(origin+'/guide',{headers:{Cookie:cookie}})).text()).includes('多PO收款核銷'));
  const sales=await auth('sales');assert.equal((await fetch(origin+'/api/uat-plan',{headers:{Cookie:sales}})).status,403);
  const result=spawnSync(process.execPath,['scripts/local.js','backup','--home',root],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(readdirSync(join(root,'local','backups')).length,1);
  await stop();await launch();cookie=await auth('admin');assert.equal((await (await fetch(origin+'/api/orders',{headers:{Cookie:cookie}})).json()).length,3);
 }finally{await stop();rmSync(root,{recursive:true,force:true});}
});
