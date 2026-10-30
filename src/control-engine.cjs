
/* Deterministic accounting and scenario engine. No inferred bank facts or default PD/LGD. */
var ControlEngine=(()=>{
 const n=v=>v===''||v===null||v===undefined?null:Number(v);
 const sum=(rs,k)=>rs.reduce((s,r)=>s+(+r[k]||0),0);
 const day=(s,i)=>{const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+i);return d.toISOString().slice(0,10)};
 const days=(a,b)=>(Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/86400000;
 const validDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&!isNaN(Date.parse(d))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
 function orders(D,S,mode='working'){
  return D.orders.map(o=>{
   const edit=mode==='working'?S.records?.[o.po]||{}:{},amount=edit.amount??o.amount;
   const base=n(Object.hasOwn(edit,'paidBase')?edit.paidBase:o.monthly?.paidSource);
   const receipts=mode==='working'?(S.receipts||[]).filter(t=>!t.void&&t.date<=S.asof):[];
   const added=receipts.reduce((s,t)=>s+(t.allocations||[]).filter(a=>a.po===o.po).reduce((n,a)=>n+a.net,0),0);
   const paid=base===null?null:base+added,balance=paid===null?null:amount-paid;
   return {...o,...edit,amount,paidBase:base,paid,balance,added,owner:edit.owner||'Ann（建議）',acceptance:edit.acceptance||'待確認',billing:edit.billing||'待確認',sourcePaid:o.monthly?.paidSource??null,sourceBalance:o.monthly?.balanceSource??null};
  });
 }
 function plans(D,S){
  const raw=D.orders.flatMap(o=>(o.monthly?.schedule||[]).filter(p=>p.date>D.fileDate&&p.amount>0&&!['H','I','J'].includes(p.cell.replace(/\d/g,''))).map(p=>({id:'AR-'+o.po+'-'+p.cell,po:o.po,date:p.date,net:p.amount,cash:null,status:'待確認',label:p.periodLabel||'原表排程',source:'月收帳款!'+p.cell,basis:'',evidence:''})));
  return [...raw,...(S.newPlans||[])].map(p=>{
   const merged={...p,...S.plans?.[p.id]},applied=(S.receipts||[]).filter(t=>!t.void&&t.date<=S.asof).flatMap(t=>t.allocations||[]).filter(a=>a.planId===p.id).reduce((s,a)=>s+a.net,0);
   const remaining=Math.max(0,merged.net-applied),cash=n(merged.cash);
   return {...merged,applied,remaining,cashRemaining:cash===null?null:merged.net>0?cash*remaining/merged.net:0};
  });
 }
 function metrics(rows,plans,asof){
  const known=rows.filter(r=>r.paid!==null),open=known.filter(r=>r.balance>0),positive=sum(open,'balance');
  const top=[...open].sort((a,b)=>b.balance-a.balance),top3=sum(top.slice(0,3),'balance');
  const confirmed=plans.filter(p=>p.status==='已確認'&&p.remaining>0),due=confirmed.filter(p=>p.date<asof),next=confirmed.filter(p=>p.date>=asof&&p.date<=day(asof,29));
  const datedByPo={};for(const p of confirmed)datedByPo[p.po]=(datedByPo[p.po]||0)+p.remaining;
  const covered=open.reduce((s,r)=>s+Math.min(r.balance,datedByPo[r.po]||0),0);
  return {count:rows.length,knownCount:known.length,unknown:rows.filter(r=>r.paid===null),amount:sum(rows,'amount'),knownAmount:sum(known,'amount'),paid:sum(known,'paid'),balance:sum(known,'balance'),positive,top,top3,concentration:positive?top3/positive:0,rate:sum(known,'amount')?sum(known,'paid')/sum(known,'amount'):0,covered,coverage:positive?covered/positive:0,confirmedDue:sum(due,'remaining'),dueCount:due.length,nextCash:sum(next,'cashRemaining'),nextCount:next.length,undated:positive-covered};
 }
 function validateReceipt(t,D,S){
  if(!validDate(t.date)||t.date<=D.fileDate||t.date>S.asof)throw Error('入帳日須在來源快照之後、工作截止日以前');
  if(!t.ref?.trim())throw Error('請填銀行交易／憑證編號');
  if((S.receipts||[]).some(x=>!x.void&&x.ref===t.ref))throw Error('銀行交易編號已存在，請勿重複入帳');
  if(!Array.isArray(t.allocations)||!t.allocations.length)throw Error('至少分配一張PO');
  const rs=orders(D,S),byPo={},byPlan={};
  for(const a of t.allocations){
   const r=rs.find(x=>x.po===a.po);if(!r)throw Error('找不到PO：'+a.po);
   if(r.paid===null)throw Error(a.po+'缺已收基準，請先完成主檔覆核');
   if(!Number.isFinite(a.net)||a.net<=0)throw Error('核銷額必須大於0');
   byPo[a.po]=(byPo[a.po]||0)+a.net;
   if(a.planId){const p=plans(D,S).find(x=>x.id===a.planId);if(!p||p.po!==a.po)throw Error('期款ID與PO不符');byPlan[a.planId]=(byPlan[a.planId]||0)+a.net;}
  }
  for(const [po,net] of Object.entries(byPo))if(net>Math.max(0,rs.find(x=>x.po===po).balance)+.005)throw Error(po+'核銷合計超過未收餘額');
  for(const [id,net] of Object.entries(byPlan))if(net>plans(D,S).find(x=>x.id===id).remaining+.005)throw Error('核銷合計超過分期剩餘額');
  for(const k of ['tax','bank','fee'])if(n(t[k])===null||!Number.isFinite(+t[k])||+t[k]<0)throw Error('稅額、銀行實入與匯費須填有效非負數；無金額請填0');
  const net=sum(t.allocations,'net'),variance=net+(+t.tax)-(+t.bank)-(+t.fee);
  if(Math.abs(variance)>.005)throw Error('未稅核銷＋稅額須等於銀行實入＋匯費；目前差額'+variance.toFixed(2));
  if(t.verified&&!t.evidence?.trim())throw Error('銀行已核對需填核對人／憑證說明');
  return {net,variance};
 }
 function validatePlan(p,D,S){
  if(!validDate(p.date)||!Number.isFinite(p.net)||p.net<=0)throw Error('請填有效到期日與未稅期款');
  if(p.status==='已確認'){
   if(n(p.cash)===null||!Number.isFinite(+p.cash)||+p.cash<0||!p.basis?.trim()||!p.evidence?.trim())throw Error('已確認計畫需銀行預計淨流入、到期依據與確認證據');
   const order=orders(D,S).find(r=>r.po===p.po);if(!order||order.balance===null)throw Error('PO未收基準待補');
   const ps=plans(D,S),other=ps.filter(x=>x.id!==p.id&&x.po===p.po&&x.status==='已確認').reduce((s,x)=>s+x.remaining,0),applied=ps.find(x=>x.id===p.id)?.applied||0;
   if(p.net<applied-.005)throw Error('期款不可小於已核銷金額');
   if(other+p.net-applied>Math.max(0,order.balance)+.005)throw Error('已確認期款合計超過PO剩餘未收');
  }
  return true;
 }
 function validateMaster(p,D,S){
  const r=D.orders.find(r=>r.po===p.po);if(!r)throw Error('未知PO');
  if(!Number.isFinite(p.amount)||p.amount<0||n(p.paidBase)!==null&&(!Number.isFinite(p.paidBase)||p.paidBase<0||p.paidBase>p.amount+1))throw Error('訂單／基準已收金額不正確');
  const net=(S.receipts||[]).filter(t=>!t.void).flatMap(t=>t.allocations||[]).filter(a=>a.po===p.po).reduce((s,a)=>s+a.net,0);
  if(net>0&&p.paidBase===null)throw Error('已有收款核銷，不能清除基準');
  if(p.paidBase!==null&&p.paidBase+net>p.amount+1)throw Error('基準加新增核銷超過訂單金額');
  if(!p.evidence?.trim())throw Error('請填修改依據');return true;
 }
 function cash({D,S,start,opening,reserve,ratio=1,delay=0,apPlans=[],rates={},opex,fxShock=0}){
  const balances=orders(D,S),ps=plans(D,S),end=day(start,90);
  const confirmed=ps.filter(p=>p.status==='已確認'&&p.remaining>0),included=confirmed.filter(p=>p.date>=start&&p.date<=end);
  const payments=apPlans.filter(p=>p.status==='已確認計畫'&&p.date>=start&&p.date<=end);
  const problems=[];
  if(n(opening)===null)problems.push('期初銀行可用資金');if(n(reserve)===null)problems.push('安全水位');if(n(opex)===null)problems.push('每週其他淨支出假設');
  for(const cc of new Set(payments.map(p=>p.currency)))if(!Number.isFinite(+rates[cc])||+rates[cc]<=0)problems.push(cc+'情境匯率');
  const allocated={};for(const p of confirmed)allocated[p.po]=(allocated[p.po]||0)+p.remaining;
  if(Object.entries(allocated).some(([po,n])=>n>Math.max(0,balances.find(r=>r.po===po)?.balance??0)+.005))problems.push('已確認期款超過更新後未收，需重核');
  const rows=Array.from({length:13},(_,i)=>({i,start:day(start,i*7),end:day(start,i*7+6),receipt:0,payment:0,opex:n(opex),balance:null}));
  let delayedOutside=0;
  for(const p of included){const i=Math.floor(days(p.date,start)/7)+delay;if(i>=0&&i<13)rows[i].receipt+=p.cashRemaining*ratio;else delayedOutside+=p.cashRemaining*ratio;}
  for(const p of payments){const i=Math.floor(days(p.date,start)/7);if(i>=0&&i<13)rows[i].payment+=p.amount*(+rates[p.currency]||0)*(1+fxShock);}
  let bal=n(opening);if(!problems.length)for(const r of rows){bal+=r.receipt-r.payment-r.opex;r.balance=bal;}
  const minimum=problems.length?null:Math.min(...rows.map(r=>r.balance)),gap=minimum===null?null:Math.max(0,+reserve-minimum);
  return {rows,minimum,gap,problems,receipt:sum(rows,'receipt'),payment:sum(rows,'payment'),receiptCount:included.length,paymentCount:payments.length,delayedOutside};
 }
 return {n,sum,day,days,validDate,orders,plans,metrics,validateReceipt,validatePlan,validateMaster,cash};
})();
if(typeof module!=='undefined')module.exports=ControlEngine;
