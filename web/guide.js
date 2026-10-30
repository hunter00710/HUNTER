const $=id=>document.getElementById(id),checks=[...document.querySelectorAll('[data-check]')];
const status=()=>{$('progress').textContent=`已手動確認 ${checks.filter(c=>c.checked).length} / ${checks.length} 項`;};
checks.forEach(c=>c.onchange=status);$('print-guide').onclick=()=>window.print();
let identity=null,plan=null;
try{
 const r=await fetch('/api/me');if(!r.ok)throw Error('請先登入');identity=await r.json();$('identity').textContent=`目前帳號：${identity.login} · ${identity.role}`;
 const p=await fetch('/api/uat-plan'),data=await p.json();if(!p.ok)throw Error(data.error);plan=data;
 $('plan-status').textContent=plan.mode==='v4'?`完整V4測試模式：${plan.orders}筆PO、${plan.payables}筆應付。`:'合成資料模式：基本權限介面；完整BI需使用V4初始化。';
 const names={asof:'測試工作截止日',poA:'PO A',poB:'PO B',unknownPO:'未知基準PO',payable:'付款項目',currency:'付款原幣'};
 for(const [k,label]of Object.entries(names)){const span=document.createElement('span');span.textContent=`${label}：${plan[k]??'無，略過此項'}`;$('plan').append(span);}
}catch(e){$('plan-status').textContent=e.message+'。五角色測試請先以uat-admin或uat-finance開啟本頁取得完整測試計畫。';}
$('export-results').onclick=()=>{
 const payload={schema:'jplus-manual-uat-v1',at:new Date().toISOString(),origin:location.origin,user:identity?.login||null,plan,manualChecks:checks.map(c=>({step:c.dataset.check,checked:c.checked})),note:'人工勾選紀錄；不代表自動測試或正式上線驗收通過。'};
 const link=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));link.href=url;link.download='JPLUS_本機測試勾選紀錄.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
