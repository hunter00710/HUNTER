// Optional DOM integration smoke test; this does not replace a real browser or device test.
// V4_SOURCE=/private/V4.html JPLUS_JSDOM_PATH=/path/to/node_modules/jsdom/lib/api.js node scripts/v4-smoke.js
import {readFileSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {openStore,seed,snapshot} from '../src/store.js';
import {addUser} from '../src/auth.js';
import {parseV4} from '../src/v4.js';
import {createApp} from '../src/server.js';
import {initializeLocal} from './local.js';
const {JSDOM,VirtualConsole}=await import(pathToFileURL(process.env.JPLUS_JSDOM_PATH).href);
const dir=mkdtempSync(join(tmpdir(),'jplus-v4-'));
const local=initializeLocal({root:dir,sourceHTML:readFileSync(process.env.V4_SOURCE,'utf8'),adminPassword:randomBytes(20).toString('hex'),port:31992}),db=openStore(local.config.dbPath);
const password=randomBytes(20).toString('hex');addUser(db,{login:'smoke-test',password,role:'finance'});
const server=createApp({db,origin:'http://127.0.0.1:31992'});await new Promise(r=>server.listen(31992,'127.0.0.1',r));
const origin='http://127.0.0.1:31992',doms=[],errors=[];
async function client(){
 const auth=await fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({login:'smoke-test',password})});const cookie=auth.headers.get('set-cookie').split(';')[0];
 const html=await (await fetch(origin+'/workspace',{headers:{Cookie:cookie}})).text();
 assert(!html.includes('localStorage'));assert(html.includes('送出至伺服器'));
 const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!e.message.includes('Not implemented: navigation'))errors.push(e.message);});
 const dom=new JSDOM(html,{runScripts:'dangerously',url:origin+'/workspace',virtualConsole:vc,beforeParse(w){w.scrollTo=()=>{};w.confirm=()=>false;w.fetch=(path,opt={})=>fetch(new URL(path,origin),{...opt,headers:{...opt.headers,Cookie:cookie,...(opt.method&&opt.method!=='GET'?{Origin:origin}:{})}});}});
 doms.push(dom);assert.equal(dom.window.eval('D.orders.length'),36);assert.equal(dom.window.eval('EAGLE.records.length'),20);
 assert.equal(dom.window.document.querySelectorAll('#arOrders tr').length,0); // Orders view is lazy-rendered.
 dom.window.eval("CONTROL.goto('orders')");assert.equal(dom.window.document.querySelectorAll('#arOrders tr').length,36);
 const common=readFileSync(new URL('../src/state.js',import.meta.url),'utf8').replaceAll('export ','');
 const adapter=readFileSync(new URL('../web/adapter.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'');
 dom.window.eval(`(()=>{${common}\n${adapter}})()`);
 return dom;
}
try{
 const a=await client(),b=await client(),po=snapshot(db).D.orders[0].po;
 for(const [client,label]of [[a,'client-A'],[b,'client-B']]){
  client.window.eval(`CONTROL.orderDetail(${JSON.stringify(po)})`);
  client.window.document.getElementById('omOwner').value=label;
  client.window.document.getElementById('omEvidence').value='Synthetic DOM test';
  client.window.document.getElementById('omSave').click();
  assert(client.window.document.getElementById('sync-status').textContent.includes('草稿'));
 }
 await a.window.document.getElementById('sync-save').onclick();
 assert.equal(snapshot(db).state.control.records[po].owner,'client-A');
 await b.window.document.getElementById('sync-save').onclick();
 assert(b.window.document.getElementById('sync-status').textContent.includes('版本衝突'));
 assert.equal(b.window.eval(`state.control.records[${JSON.stringify(po)}].owner`),'client-B');
 assert.equal(snapshot(db).state.control.records[po].owner,'client-A');
 const c=await client(),positive=snapshot(db).D.orders.find(o=>o.monthly&&o.amount-o.monthly.paidSource>1000).po;
 c.window.eval(`CONTROL.receiptForm(${JSON.stringify(positive)})`);
 for(const [id,value]of Object.entries({bkDate:'2026-10-30',bkRef:'SYNTHETIC-DOM-RECEIPT',bkBank:'105',bkTax:'5',bkFee:'0',bkEvidence:'Synthetic DOM receipt'}))c.window.document.getElementById(id).value=value;
 const amount=c.window.document.querySelector('[data-alloc][data-k="net"]');amount.value='100';amount.dispatchEvent(new c.window.Event('input'));
 c.window.document.getElementById('bkSave').click();
 await c.window.document.getElementById('sync-save').onclick();
 assert.equal(snapshot(db).state.control.receipts.length,1);
 assert.equal(snapshot(db).state.control.receipts[0].ref,'SYNTHETIC-DOM-RECEIPT');
 const d=await client();d.window.eval(`AP.payment(${JSON.stringify(local.plan.payable)})`);
 for(const [id,value]of Object.entries({pyDate:local.plan.asof,pyAmount:'100',pyRef:'SYNTHETIC-DOM-PAYMENT',pyNote:'Synthetic DOM payment'}))d.window.document.getElementById(id).value=value;
 d.window.document.getElementById('pySave').click();await d.window.document.getElementById('sync-save').onclick();
 assert.equal(snapshot(db).state.ap.payments.length,1);
 assert.equal(snapshot(db).state.ap.payments[0].ref,'SYNTHETIC-DOM-PAYMENT');
 for(const tab of ['overview','orders','financial','forecast','investment','audit','source','payables','collection','control'])c.window.eval(`view(${JSON.stringify(tab)})`);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({domErrors:errors.length,localV4Setup:true,ordersRendered:36,payablesLoaded:20,serverSave:true,receiptFormServerSave:true,paymentFormServerSave:true,twoClientConflict:true,conflictDraftPreserved:true,realBrowserTest:false}));
}finally{for(const d of doms)d.window.close();await new Promise(r=>server.close(r));db.close();rmSync(dir,{recursive:true,force:true});}
