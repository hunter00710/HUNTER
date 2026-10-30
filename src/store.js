import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync,chmodSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import E from './control-engine.cjs';
import {clone,same} from './state.js';
export const hash=s=>createHash('sha256').update(s).digest('hex');
export class Fault extends Error {constructor(status,message,details){super(message);this.status=status;this.details=details;}}
export const requireThat=(v,status,message)=>{if(!v)throw new Fault(status,message);};
export const money=v=>{requireThat(typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e9,422,'金額須為有效數字且絕對值不超過十億元');const u=Math.round(v*1e6);requireThat(Number.isSafeInteger(u)&&Math.abs(v-u/1e6)<1e-7,422,'最多六位小數');return u;};
const sourceMoney=v=>{requireThat(typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e9,422,'來源金額不正確');return Math.round(v*1e6);};
const parse=JSON.parse,js=JSON.stringify;
export const tables=['orders','payables','plans','receipts','payments','reviews','settings'];
const key=c=>c==='orders'?'po':'id';
export function openStore(path){
 if(path!==':memory:'){mkdirSync(dirname(path),{recursive:true,mode:0o700});}
 const db=new DatabaseSync(path);db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
 if(path!==':memory:')chmodSync(path,0o600);
 return db;
}
export function atomic(db,fn){db.exec('BEGIN IMMEDIATE');try{const v=fn();db.exec('COMMIT');return v;}catch(e){db.exec('ROLLBACK');throw e;}}
export function audit(db,actor,action,resource,before,after){
 const prev=db.prepare('SELECT hash FROM audit ORDER BY seq DESC LIMIT 1').get()?.hash||'';
 const row={at:new Date().toISOString(),actor,action,resource,before_json:before==null?null:js(before),after_json:after==null?null:js(after),prev_hash:prev};
 db.prepare('INSERT INTO audit(at,actor,action,resource,before_json,after_json,prev_hash,hash) VALUES(?,?,?,?,?,?,?,?)').run(...Object.values(row),hash(js(row)));
}
export function verifyAudit(rows){let prev='';for(const r of rows){const row={at:r.at,actor:r.actor,action:r.action,resource:r.resource,before_json:r.before_json,after_json:r.after_json,prev_hash:r.prev_hash};if(r.prev_hash!==prev||hash(js(row))!==r.hash)return false;prev=r.hash;}return true;}
export function revision(db){return +db.prepare("SELECT value FROM meta WHERE key='revision'").get().value;}
export function bump(db){db.prepare("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run();}
export function documents(db){return Object.fromEntries(db.prepare('SELECT * FROM documents').all().map(r=>[r.key,r.value]));}
export function fullScope(user){return parse(user.scope).includes('*');}
export function canPO(user,po){return fullScope(user)||parse(user.scope).includes(po);}
export function snapshot(db){
 const docs=documents(db);requireThat(docs.sourceD,409,'尚未匯入V4或合成資料');
 const D=parse(docs.sourceD),eagle=parse(docs.sourceE),versions={},entities={};
 const s={issues:{},orders:{},tasks:{},forecast:{},investment:{},analysis:{},control:{records:{},plans:{},newPlans:[],receipts:[],logs:[],model:{},asof:docs.asof,mode:'working',editMode:'edit'},ap:{records:{},custom:[],plans:{},newPlans:[],payments:[],reviews:{},log:[],rates:{},asof:docs.asof}};
 D.orders=[];eagle.records=[];
 for(const c of tables){versions[c]={};entities[c]={};for(const r of db.prepare(`SELECT * FROM ${c}`).all()){
  const id=r[key(c)],p=parse(r.data);versions[c][id]=r.version;entities[c][id]=p;
  if(c==='orders'){D.orders.push(parse(r.source));if(Object.keys(p).length)s.control.records[id]=p;}
  if(c==='payables'){const orig=parse(r.source);if(orig)eagle.records.push(orig);else s.ap.custom.push(p);if(orig&&Object.keys(p).length)s.ap.records[id]=p;}
  if(c==='plans'){const {kind,...v}=p;const root=kind==='ar'?s.control:s.ap;if(r.source)root.plans[id]=v;else root.newPlans.push(v);}
  if(c==='receipts')s.control.receipts.push(p);
  if(c==='payments')s.ap.payments.push(p);
  if(c==='reviews'){const i=id.indexOf(':'),prefix=id.slice(0,i),rid=id.slice(i+1);const dest={issue:s.issues,task:s.tasks,ap:s.ap.reviews,legacy:s.orders}[prefix];if(dest)dest[rid]=p;}
  if(c==='settings'){if(id==='control')Object.assign(s.control,p);else if(id==='ap')Object.assign(s.ap,p);else s[id]=p;}
 }}
 return {D,eagle,state:s,versions,entities,revision:revision(db)};
}
function clean(value,depth=0){
 requireThat(depth<35,422,'資料層次過深');
 if(typeof value==='string')requireThat(value.length<=20000&&!/[<>\u0000]/.test(value),422,'文字長度過長或含不允許字元');
 if(typeof value==='number')requireThat(Number.isFinite(value)&&Math.abs(value)<=1e12,422,'數字不合法');
 if(value&&typeof value==='object')for(const [k,v]of Object.entries(value)){requireThat(!['__proto__','constructor','prototype'].includes(k),422,'不允許的欄位');clean(v,depth+1);}
}
function fields(data,allowed){requireThat(data&&typeof data==='object'&&!Array.isArray(data),422,'資料須為物件');for(const k of Object.keys(data))requireThat(allowed.includes(k),422,'不允許的欄位：'+k);}
const orderFields=['po','amount','paidBase','owner','acceptance','billing','nextDate','evidence'];
const payableFields=['id','customer','currency','po','name','model','quantity','total','paid','note','evidence','source','recomputed','unpaid','schedules'];
function access(user,c,id,data,old){
 requireThat(user.role!=='viewer',403,'唯讀角色不可寫入');
 if(user.role==='sales'){
  requireThat(c==='orders'&&old!==undefined&&canPO(user,id),403,'業務只能更新獲授權PO的交付資料');
  // Omitted fields cannot erase a financial override through an apparently harmless sales edit.
  for(const [k,v]of Object.entries(old))if(!Object.hasOwn(data,k))data[k]=v;
  const changes=Object.keys(data).filter(k=>!same(data[k],old[k]));
  requireThat(changes.every(k=>['po','owner','acceptance','billing','nextDate','evidence'].includes(k)),403,'業務不能修改金額或已收基準');return;
 }
 requireThat(fullScope(user),403,'此操作需要完整公司資料權限');
 if(user.role==='reviewer')requireThat(c==='reviews'||['receipts','payments'].includes(c)&&old,403,'覆核角色不可維護財務基準或新增交易');
 else requireThat(['admin','finance'].includes(user.role),403,'角色不允許操作');
}
function enforceReceiptChange(db,user,c,id,data,old){
 fields(data,c==='receipts'?['id','date','ref','bank','tax','fee','verified','evidence','allocations','void','reviewedBy']:['id','recordId','date','ref','amount','evidence','note','verified','void','reviewedBy']);
 requireThat(typeof data.verified==='boolean',422,'銀行核對欄位須為布林值');
 requireThat(typeof data.ref==='string'&&data.ref===data.ref.trim()&&data.ref.length>0,422,'憑證編號不可空白或有前後空白');
 requireThat(data.id===id,422,'ID不符');
 if(!old){requireThat(!data.void&&!data.verified&&!data.reviewedBy,403,'新交易由登錄人建立為待覆核');return;}
 const changed=Object.keys({...old,...data}).filter(k=>!same(old[k],data[k]));
 const reviewer=['admin','reviewer'].includes(user.role);
 requireThat(changed.every(k=>['verified','evidence','reviewedBy','void'].includes(k)),422,'既有交易金額與核銷不可改寫，請作廢後另立');
 if(!same(old.void,data.void)){
  requireThat(['admin','finance'].includes(user.role)&&!old.void&&typeof data.void==='string'&&data.void.trim().length>0,403,'作廢須財務角色與理由；不可取消作廢');
 }
 if(changed.some(k=>['verified','reviewedBy'].includes(k))){
  const creator=db.prepare(`SELECT created_by FROM ${c} WHERE id=?`).get(id).created_by;
  requireThat(reviewer&&creator!==user.id,403,'銀行覆核須由另一名管理者或覆核人執行');
  requireThat(data.evidence?.trim(),422,'覆核需憑證說明');data.reviewedBy=user.id;
 }
 if(user.role==='reviewer')requireThat(changed.every(k=>['verified','reviewedBy','evidence'].includes(k))&&!data.void,403,'覆核角色不可作廢交易');
}
function applyState(s,c,id,p,sources){
 if(c==='orders')s.control.records[id]=p;
 if(c==='payables'){if(sources.eagle.records.some(x=>x.id===id))s.ap.records[id]=p;else {s.ap.custom=s.ap.custom.filter(x=>x.id!==id);s.ap.custom.push(p);}}
 if(c==='plans'){const root=p.kind==='ar'?s.control:s.ap;root.newPlans=root.newPlans.filter(x=>x.id!==id);delete root.plans[id];const raw=p.kind==='ar'?E.plans(sources.D,{asof:s.control.asof}):sources.eagle.records.flatMap(x=>x.schedules);const {kind,...v}=p;if(raw.some(x=>x.id===id))root.plans[id]=v;else root.newPlans.push(v);}
 if(c==='receipts'){s.control.receipts=s.control.receipts.filter(x=>x.id!==id);s.control.receipts.push(p);}
 if(c==='payments'){s.ap.payments=s.ap.payments.filter(x=>x.id!==id);s.ap.payments.push(p);}
 if(c==='settings'){if(id==='control'||id==='ap')Object.assign(s[id],p);else s[id]=p;}
 if(c==='reviews'){const i=id.indexOf(':'),prefix=id.slice(0,i),rid=id.slice(i+1),dest={issue:s.issues,task:s.tasks,ap:s.ap.reviews,legacy:s.orders}[prefix];requireThat(dest,422,'未知覆核類型');dest[rid]=p;}
}
function allPayables(eagle,s){return [...eagle.records,...s.ap.custom].map(r=>{const p={...r,...s.ap.records[r.id]};p.paidBase=p.paid;p.paid+=(s.ap.payments||[]).filter(t=>!t.void&&t.recordId===p.id).reduce((n,t)=>n+t.amount,0);return {...p,balance:p.total-p.paid};});}
function validate(db,snap,s,changes){
 const {D,eagle}=snap;
 for(const ch of changes){const {collection:c,id,data:p}=ch;
  if(c==='orders'){
   fields(p,orderFields);const o=D.orders.find(o=>o.po===id);requireThat(o,422,'未知PO');const master={po:id,amount:o.amount,paidBase:o.monthly?.paidSource??null,...p};E.validateMaster(master,D,s.control);money(master.amount);if(master.paidBase!==null)(master.paidBase===o.monthly?.paidSource?sourceMoney:money)(master.paidBase);
   requireThat(!p.po||p.po===id,422,'PO識別不可改寫');
   if(p.nextDate)requireThat(E.validDate(p.nextDate),422,'目標日期不正確');
   if(p.acceptance)requireThat(['待確認','待出貨','已出貨待安裝','安裝中','驗收中','已驗收','爭議處理'].includes(p.acceptance),422,'驗收狀態不正確');
   if(p.billing)requireThat(['待確認','未開票','部分開票','已開票待請款','已提交請款','爭議處理'].includes(p.billing),422,'請款狀態不正確');
  }
  if(c==='payables'){
   fields(p,payableFields);const r=allPayables(eagle,s).find(r=>r.id===id);requireThat(r&&['CNY','USD','TWD'].includes(r.currency),422,'供應商幣別不正確');
   const orig=eagle.records.find(r=>r.id===id);requireThat(!orig||r.currency===orig.currency,422,'既有幣別不可改寫');
   requireThat(money(r.total)>=0&&money(r.paidBase)>=0&&r.paid<=r.total+1,422,'付款基準或總價錯誤');requireThat(r.evidence?.trim(),422,'請填修改依據');
  }
  if(c==='plans'){
   fields(p,['id','kind','po','recordId','date','net','cash','amount','status','label','source','basis','evidence','promise','note']);
   requireThat(p.id===id&&['ar','ap'].includes(p.kind),422,'計畫ID或種類錯誤');
   if(p.kind==='ar'){requireThat(['待確認','已確認','取消'].includes(p.status),422,'分期狀態錯誤');E.validatePlan(p,D,s.control);money(p.net);if(p.cash!==null&&p.cash!==undefined)money(p.cash);}
   else{requireThat(['待確認','已確認計畫','已付款','取消'].includes(p.status)&&E.validDate(p.date)&&money(p.amount)>0,422,'付款計畫無效');requireThat(allPayables(eagle,s).some(r=>r.id===p.recordId),422,'找不到應付項目');if(p.status==='已確認計畫')requireThat((p.evidence||p.note||p.basis)?.trim(),422,'已確認付款計畫需依據');}
  }
  if(c==='settings'){
   requireThat(['control','ap','forecast','investment','analysis'].includes(id),422,'未知設定');
   if(['control','ap'].includes(id)){fields(p,id==='control'?['asof','model']:['asof','rates','risk','forecastStamp']);requireThat(E.validDate(p.asof),422,'截止日期無效');}
   if(id==='control'){
    fields(p.model||{},['ctStart','ctOpening','ctReserve','ctOpex','ctCny','ctUsd']);
    for(const [k,v]of Object.entries(p.model||{})){if(v===''||v===null)continue;if(k==='ctStart')requireThat(E.validDate(v),422,'模型起日無效');else requireThat(Number.isFinite(+v)&&(k==='ctOpex'||+v>=0),422,'模型金額或匯率無效');}
   }
   if(id==='ap'){fields(p.rates||{},['CNY','USD','note']);for(const k of ['CNY','USD']){const v=p.rates?.[k];if(v!==undefined&&v!==null&&v!=='')requireThat(Number.isFinite(+v)&&+v>0,422,'匯率須大於0');}}
  }
  if(c==='reviews'){fields(p,['status','note','owner','date','paid','evidence']);}
 }
 requireThat(E.validDate(s.control.asof)&&E.validDate(s.ap.asof),422,'工作截止日無效');
 requireThat(s.control.asof>=D.fileDate&&s.ap.asof>=eagle.asof,422,'截止日不可早於快照');
 const seen=new Set();const test={...s.control,receipts:[]};
 for(const t of s.control.receipts){
  requireThat(!seen.has(t.ref),422,'銀行憑證不可重複，作廢後仍保留');seen.add(t.ref);
  requireThat(E.validDate(t.date)&&t.date>D.fileDate&&t.date<=s.control.asof,422,'收款日期無效');
  if(t.void)continue;
  for(const a of t.allocations||[]){fields(a,['po','net','invoice','planId']);money(a.net);}
  E.validateReceipt(t,D,test);
  const net=t.allocations.reduce((v,a)=>v+money(a.net),0);requireThat(Math.abs(net+money(t.tax)-money(t.bank)-money(t.fee))<=5000,422,'銀行核銷差額超過0.005元');
  test.receipts.push(t);
 }
 const pseen=new Set();for(const t of s.ap.payments){
  requireThat(!pseen.has(t.ref),422,'付款憑證不可重複');pseen.add(t.ref);
  requireThat(E.validDate(t.date)&&t.date>eagle.asof&&t.date<=s.ap.asof&&money(t.amount)>0,422,'付款日期或金額無效');
  requireThat(allPayables(eagle,s).some(r=>r.id===t.recordId),422,'找不到應付項目');
 }
 const payables=allPayables(eagle,s);for(const r of payables){
  requireThat(r.paid<=r.total+1,422,'累計付款超過總價');
  const added=s.ap.payments.filter(t=>!t.void&&t.recordId===r.id).reduce((sum,t)=>sum+t.amount,0);
  requireThat(added<=Math.max(0,r.total-r.paidBase)+.005,422,'快照後新增付款超過正未付餘額');
 }
 const pp=[...eagle.records.flatMap(r=>r.schedules),...s.ap.newPlans].map(p=>({...p,...s.ap.plans[p.id]}));
 const allocated={};for(const p of pp.filter(p=>p.status==='已確認計畫'))allocated[p.recordId]=(allocated[p.recordId]||0)+p.amount;
 for(const [id,v]of Object.entries(allocated))requireThat(v<=Math.max(0,payables.find(r=>r.id===id)?.balance??0)+.005,422,'已確認付款排程超過應付餘額');
 // Revalidate confirmed plans after every master/receipt change as well.
 for(const p of E.plans(D,s.control).filter(p=>p.status==='已確認'))E.validatePlan(p,D,s.control);
}
function write(db,user,c,id,p,snap){
 const str=js(p),old=snap.entities[c][id],v=(snap.versions[c][id]||0)+1;
 if(c==='orders'){const o=snap.D.orders.find(o=>o.po===id),paid=Object.hasOwn(p,'paidBase')?p.paidBase:o.monthly?.paidSource??null;db.prepare('UPDATE orders SET data=?,amount_u=?,paid_base_u=?,version=? WHERE po=?').run(str,money(p.amount??o.amount),paid===null?null:sourceMoney(paid),v,id);}
 if(c==='payables'){const o=snap.eagle.records.find(r=>r.id===id)||{};const r={...o,...p};db.prepare('INSERT INTO payables VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,currency=excluded.currency,total_u=excluded.total_u,paid_base_u=excluded.paid_base_u,version=excluded.version').run(id,js(Object.keys(o).length?o:null),str,r.currency,money(r.total),money(r.paid),v);}
 if(c==='plans'){const orig=db.prepare('SELECT source FROM plans WHERE id=?').get(id)?.source??null;db.prepare('INSERT INTO plans VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,po=excluded.po,payable_id=excluded.payable_id,amount_u=excluded.amount_u,version=excluded.version').run(id,p.kind,p.kind==='ar'?p.po:null,p.kind==='ap'?p.recordId:null,orig,str,money(p.kind==='ar'?p.net:p.amount),v);}
 if(c==='receipts'){
  if(old)db.prepare('UPDATE receipts SET data=?,version=? WHERE id=?').run(str,v,id);
  else{db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?,?,?,?,?)').run(id,p.ref,p.date,money(p.bank),money(p.tax),money(p.fee),str,user.id,v);
   p.allocations.forEach((a,i)=>db.prepare('INSERT INTO allocations VALUES(?,?,?,?,?,?)').run(id,i,a.po,a.planId||null,money(a.net),js(a)));}
 }
 if(c==='payments'){if(old)db.prepare('UPDATE payments SET data=?,version=? WHERE id=?').run(str,v,id);else db.prepare('INSERT INTO payments VALUES(?,?,?,?,?,?,?,?)').run(id,p.recordId,p.ref,p.date,money(p.amount),str,user.id,v);}
 if(['reviews','settings'].includes(c))db.prepare(`INSERT INTO ${c} VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=excluded.version`).run(id,str,v);
 audit(db,user.id,old?'update':'create',c+'/'+id,old,p);
}
export function change(db,user,changes){
 requireThat(Array.isArray(changes)&&changes.length>0&&changes.length<=300,422,'每批須1至300筆異動');
 return atomic(db,()=>{
  const snap=snapshot(db),s=clone(snap.state),seen=new Set();
  for(const ch of changes){
   const {collection:c,id,data:p,version}=ch;requireThat(tables.includes(c)&&typeof id==='string'&&/^[\w:.-]{1,120}$/.test(id),422,'資源名稱不正確');
   requireThat(!seen.has(c+'/'+id),422,'同批不可重複修改同一紀錄');seen.add(c+'/'+id);
   requireThat(Number.isInteger(version)&&version===(snap.versions[c][id]||0),409,'版本衝突：'+c+'/'+id);
   clean(p);const old=snap.entities[c][id];let accessOld=old;
   if(c==='orders'&&user.role==='sales'){const source=snap.D.orders.find(o=>o.po===id);accessOld=source?{po:id,amount:source.amount,paidBase:source.monthly?.paidSource??null,...old}:undefined;}
   access(user,c,id,p,accessOld);
   if(['receipts','payments'].includes(c))enforceReceiptChange(db,user,c,id,p,old);
   applyState(s,c,id,p,snap);
  }
  try{validate(db,snap,s,changes);}catch(e){if(e instanceof Fault)throw e;throw new Fault(422,e.message);}
  // Foreign-key parents before receipts/allocations, regardless of request order.
  for(const c of tables)for(const ch of changes.filter(x=>x.collection===c))write(db,user,c,ch.id,ch.data,snap);
  bump(db);return {revision:revision(db),versions:snapshot(db).versions};
 });
}
export function seed(db,{D,eagle,html='',asof='2026-10-30',sourceHash='synthetic'},actor){
 requireThat(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n===0,409,'只能在空資料庫匯入；不可覆蓋現有帳載');
 return atomic(db,()=>{
  const {orders,...dm}=D,{records,...em}=eagle;
  for(const [k,v]of Object.entries({sourceD:js(dm),sourceE:js(em),html,asof,sourceHash}))db.prepare('INSERT INTO documents VALUES(?,?)').run(k,v);
  for(const o of orders)db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,1)').run(o.po,js(o),'{}',money(o.amount),o.monthly?sourceMoney(o.monthly.paidSource):null);
  for(const r of records)db.prepare('INSERT INTO payables VALUES(?,?,?,?,?,?,1)').run(r.id,js(r),'{}',r.currency,money(r.total),money(r.paid));
  const ar=E.plans(D,{asof});const ap=records.flatMap(r=>r.schedules||[]);
  for(const [kind,ps]of [['ar',ar],['ap',ap]])for(const p of ps){if(p.amount===0||p.net===0)continue;db.prepare('INSERT INTO plans VALUES(?,?,?,?,?,?,?,1)').run(p.id,kind,kind==='ar'?p.po:null,kind==='ap'?p.recordId:null,js(p),js({...p,kind}),money(kind==='ar'?p.net:p.amount));}
  audit(db,actor,'import','source',null,{sourceHash,orders:orders.length,payables:records.length});bump(db);
 });
}
export function exportBackup(db,user){
 requireThat(['admin','finance'].includes(user.role)&&fullScope(user),403,'僅全公司管理或財務可匯出備份');
 return atomic(db,()=>{audit(db,user.id,'export','backup',null,{revision:revision(db)});
  const data={schema:1,created:new Date().toISOString(),tables:{}};
  for(const c of ['meta','documents',...tables,'allocations','audit'])data.tables[c]=db.prepare(`SELECT * FROM ${c}`).all();
  data.identities=db.prepare('SELECT id,login,role,scope FROM users').all();return {...data,sha256:hash(js(data))};
 });
}
