
/* Pure calculations. No assumed company bank balance, credit terms or investment returns. */
var FinanceEngine = (() => {
  const number = v => v === '' || v === null || v === undefined ? null : Number(v);
  const plusDays = (iso,n) => { const d=new Date(iso+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10); };
  const days = (a,b) => (Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/86400000;
  const futureSchedule = (order,start,end) => (order.monthly?.schedule||[]).filter(p=>!['H','I','J'].includes(p.cell.replace(/\d/g,''))&&p.date>=start&&p.date<=end);
  function structure(orders,asof,balanceFn=o=>o.monthly?.balanceSource??null,paidFn=o=>o.monthly?.paidSource??null){
    const known=orders.filter(o=>o.monthly), end=plusDays(asof,90), start=plusDays(asof,1);
    const rows=known.map(o=>{
      const balance=balanceFn(o), future=futureSchedule(o,start,end), planned=future.reduce((s,p)=>s+p.amount,0);
      const covered=Math.min(Math.max(0,balance),Math.max(0,planned));
      return {po:o.po,order:o,balance,paid:paidFn(o),planned,covered,undated:Math.max(0,balance)-covered,future};
    });
    const total=known.reduce((s,o)=>s+o.amount,0), paid=rows.reduce((s,r)=>s+r.paid,0), balance=rows.reduce((s,r)=>s+r.balance,0);
    const positive=rows.filter(r=>r.balance>0).reduce((s,r)=>s+r.balance,0);
    const top=rows.filter(r=>r.balance>1).sort((a,b)=>b.balance-a.balance), top3=top.slice(0,3).reduce((s,r)=>s+r.balance,0);
    const covered=rows.reduce((s,r)=>s+r.covered,0);
    const categories=[...new Set(known.map(o=>o.category))].map(category=>{const rs=rows.filter(r=>r.order.category===category);return {category,count:rs.length,order:rs.reduce((s,r)=>s+r.order.amount,0),paid:rs.reduce((s,r)=>s+r.paid,0),balance:rs.reduce((s,r)=>s+r.balance,0)}});
    return {rows,total,paid,balance,positive,top,top3,concentration:positive?top3/positive:0,covered,uncovered:positive-covered,coverage:positive?covered/positive:0,categories,start,end};
  }
  function cash(data,{start,opening=null,reserve=null,ratio=1,delay=0,tax=.05,flows={}}){
    const keys=['other','ap','opex','capex','finance'];
    const rows=Array.from({length:13},(_,i)=>({i,start:plusDays(start,i*7),end:plusDays(start,i*7+6),customer:0,...(flows[i]||{})}));
    for(const o of data.orders)for(const p of futureSchedule(o,start,plusDays(start,90))){const i=Math.floor(days(p.date,start)/7)+delay;if(i>=0&&i<13)rows[i].customer+=p.amount*(1+tax)*ratio;}
    let balance=number(opening);
    for(const row of rows){row.missing=keys.filter(k=>number(row[k])===null).length;const v=k=>number(row[k])||0;if(balance!==null)balance+=row.customer+v('other')-v('ap')-v('opex')-v('capex')+v('finance');row.balance=balance;}
    const minimum=balance===null?null:Math.min(...rows.map(r=>r.balance)), safety=number(reserve);
    return {rows,totalIn:rows.reduce((s,r)=>s+r.customer,0),minimum,gap:minimum===null||safety===null?null:Math.max(0,safety-minimum),firstBreach:minimum===null||safety===null?null:rows.find(r=>r.balance<safety)?.i??null,missing:rows.reduce((s,r)=>s+r.missing,0)};
  }
  const npv=(initial,flows,rate)=>-initial+flows.reduce((s,c,i)=>s+c/Math.pow(1+rate,i+1),0);
  function irr(initial,flows){
    const signs=[-initial,...flows].filter(x=>x!==0).map(x=>Math.sign(x));let changes=0;for(let i=1;i<signs.length;i++)if(signs[i]!==signs[i-1])changes++;
    if(initial<=0||!flows.some(x=>x>0))return {value:null,reason:'缺有效初始投入或正回收現金流'};
    if(changes!==1)return {value:null,reason:'現金流非單次變號，不提供可能誤導的單一IRR'};
    let lo=-.999999,hi=1;while(npv(initial,flows,hi)>0&&hi<1000000)hi*=2;
    if(npv(initial,flows,lo)<0||npv(initial,flows,hi)>0)return {value:null,reason:'指定搜尋範圍無法取得唯一根'};
    for(let i=0;i<180;i++){const mid=(lo+hi)/2;if(npv(initial,flows,mid)>0)lo=mid;else hi=mid;}
    return {value:(lo+hi)/2,reason:''};
  }
  function investment({capex,working,annual,salvage,recovery,rate}){
    const all=[capex,working,salvage,recovery,rate,...annual].map(number);
    if(all.some(v=>v===null||!Number.isFinite(v)))return {ready:false,reason:'請完整輸入投入、營運資金、逐年淨現金流、殘值、回收資金及折現率；無金額項目請明確輸入0。'};
    capex=Number(capex);working=Number(working);salvage=Number(salvage);recovery=Number(recovery);rate=Number(rate);
    if(capex<0||working<0||salvage<0||recovery<0||rate<0||capex+working<=0||recovery>working)return {ready:false,reason:'初始總投入須大於0；投入、殘值、回收與折現率不得為負，營運資金回收不得高於期初投入。'};
    const initial=+capex + +working, flows=annual.map(Number);flows[flows.length-1]+= +salvage + +recovery;
    let cumulative=-initial,payback=null;const rows=flows.map((flow,i)=>{const before=cumulative;cumulative+=flow;if(payback===null&&cumulative>=0&&flow>0)payback=i+(-before/flow);return {year:i+1,annual:+annual[i],terminal:i===flows.length-1?+salvage + +recovery:0,flow,pv:flow/Math.pow(1+rate,i+1),cumulative};});
    const irrResult=irr(initial,flows);
    const rates=[Math.max(0,rate-.02),rate,rate+.02];
    const sensitivity=rates.map(r=>({rate:r,values:[-1,0,1].map(direction=>{const cf=annual.map(v=>{v=+v;return direction===0?v:v*(v>=0?1+direction*.2:1-direction*.2)});cf[cf.length-1]+= +salvage + +recovery;return npv(initial,cf,r);})}));
    return {ready:true,initial,flows,rows,npv:npv(initial,flows,rate),irr:irrResult.value,irrReason:irrResult.reason,payback,sensitivity};
  }
  return {number,plusDays,futureSchedule,structure,cash,npv,irr,investment};
})();
if(typeof module!=='undefined')module.exports=FinanceEngine;
