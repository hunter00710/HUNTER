// Shared V4 adapter: the database owns business records; local UI logs are not audit evidence.
export const clone = x => JSON.parse(JSON.stringify(x));
export const same = (a,b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function canonical(x) { return Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x; }
export function flatten(s) {
 const m={orders:{},payables:{},plans:{},receipts:{},payments:{},reviews:{},settings:{}};
 Object.assign(m.orders,s.control?.records);
 Object.assign(m.payables,s.ap?.records);
 for(const p of s.ap?.custom||[])m.payables[p.id]=p;
 for(const [id,p]of Object.entries(s.control?.plans||{}))m.plans[id]={...p,kind:'ar'};
 for(const p of s.control?.newPlans||[])m.plans[p.id]={...p,kind:'ar'};
 for(const [id,p]of Object.entries(s.ap?.plans||{}))m.plans[id]={...p,kind:'ap'};
 for(const p of s.ap?.newPlans||[])m.plans[p.id]={...p,kind:'ap'};
 for(const p of s.control?.receipts||[])m.receipts[p.id]=p;
 for(const p of s.ap?.payments||[])m.payments[p.id]=p;
 for(const [prefix,rs]of Object.entries({issue:s.issues,task:s.tasks,ap:s.ap?.reviews,legacy:s.orders}))
  for(const [id,v]of Object.entries(rs||{}))m.reviews[prefix+':'+id]=v;
 for(const k of ['forecast','investment','analysis'])if(s[k])m.settings[k]=s[k];
 if(s.control)m.settings.control={asof:s.control.asof,model:s.control.model||{}};
 if(s.ap)m.settings.ap={asof:s.ap.asof,rates:s.ap.rates||{},risk:s.ap.risk||{},forecastStamp:s.ap.forecastStamp||''};
 return m;
}
export function diff(before,after,versions) {
 const a=flatten(before),b=flatten(after),changes=[];
 for(const c of Object.keys(b))for(const [id,data]of Object.entries(b[c]))
  if(!same(a[c][id],data))changes.push({collection:c,id,data,version:versions[c]?.[id]||0});
 for(const c of ['receipts','payments'])for(const id of Object.keys(a[c]))
  if(!b[c][id])throw Error('交易不可刪除，請作廢並填理由');
 return changes;
}
