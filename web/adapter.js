import {diff,clone} from './state.js';
const boot=window.COLLAB_BOOT,el=id=>document.getElementById(id);
let baseline=clone(state),dirty=false,versions=boot.versions,rev=boot.revision;
const status=t=>el('sync-status').textContent=t;
const save=el('sync-save');
const api=async(path,options={})=>{const r=await fetch(path,{...options,headers:{'Content-Type':'application/json','X-CSRF-Token':boot.csrf,...options.headers}});if(r.status===401){status('登入已失效；請下載草稿後重新登入');throw Error('登入已失效')}const j=await r.json();if(!r.ok)throw Error(j.error);return j;};
window.addEventListener('jplus-dirty',()=>{dirty=true;status('尚有草稿；按「送出至伺服器」才完成共用存檔');});
const draft=()=>download('JPLUS_未送出草稿.json',JSON.stringify({schema:'jplus-draft-v1',baseRevision:rev,state},null,2));
el('sync-draft').onclick=draft;
save.disabled=['viewer','sales'].includes(boot.user.role);
save.onclick=async()=>{save.disabled=true;document.body.inert=true;try{
 const submitted=clone(state),changes=diff(baseline,submitted,versions);
 if(!changes.length){dirty=false;status('目前沒有業務資料異動');return;}
 const result=await api('/api/changes',{method:'POST',body:JSON.stringify({changes})});
 // Reload after a successful atomic commit to obtain values committed by other users.
 baseline=submitted;dirty=false;rev=result.revision;versions=result.versions;location.reload();
 }catch(e){dirty=true;status('未送出：'+e.message+'。草稿保留；可先下載，再載入最新資料比較。')}finally{document.body.inert=false;save.disabled=['viewer','sales'].includes(boot.user.role);}};
el('sync-refresh').onclick=()=>{if(!dirty||confirm('載入前請先下載未送出草稿。確定捨棄目前草稿？')){dirty=false;location.reload();}};
el('sync-logout').onclick=async()=>{if(dirty&&!confirm('尚有未送出草稿，請先下載。確定登出？'))return;try{await api('/api/logout',{method:'POST',body:'{}'});dirty=false;location.href='/';}catch(e){status(e.message)}};
el('sync-audit').onclick=()=>window.open('/desk','_blank','noopener');
el('sync-backup').disabled=!['admin','finance'].includes(boot.user.role);
el('sync-backup').onclick=()=>{location.href='/api/backup';};
// Local backup controls now export a server backup; import requires the managed migration path.
el('saveState').onclick=()=>el('sync-backup').click();
el('importState').disabled=true;el('importState').title='舊備份須管理者驗證遷移；避免整包覆蓋共用資料';
const saveHTML=el('saveHtml');if(saveHTML){saveHTML.disabled=true;saveHTML.title='共用系統請使用伺服器備份';}
// V4 text is retained in its protected source asset; clarify actual save semantics in one persistent notice.
document.querySelector('.footnote').textContent='JPLUS 多人共用原型 · 原表與核對規則沿用V4 · 修改先為記憶體草稿，頂部送出成功才存入公司資料庫 · 15秒檢查版本；發現異動時手動載入 · 尚未宣告正式部署';
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
setInterval(async()=>{try{const result=await api('/api/revision');if(result.revision!==rev)status(dirty?'其他人已更新資料；送出前請下載草稿並載入比較，衝突會被拒絕':'其他人已更新資料；按「載入最新資料」查看');}catch(e){status(e.message)}},15000);
