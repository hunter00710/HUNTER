import {createHash} from 'node:crypto';
import {Fault,requireThat} from './store.js';
const expected='4b100a2958618f2245dd3eedbb19fbe4b047a68bf9e2734bd1926de5d8b60368';
export const safeJSON=x=>JSON.stringify(x).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026');
export function parseV4(html){
 const embedded=id=>{const scripts=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];const m=scripts.find(m=>new RegExp(`id=["']${id}["']`).test(m[1]));requireThat(m,422,'缺少V4資料區：'+id);return JSON.parse(m[2]);};
 const D=embedded('embedded-data'),eagle=embedded('eagle-data'),initial=embedded('embedded-state');
 requireThat(Object.keys(initial).length===0,422,'V4已有內嵌工作紀錄；請先匯出JSON，由管理者用異動API逐筆驗證遷移，避免隱性改寫');
 const all=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
 const body=all.find(m=>m[2].includes('var ControlEngine='))?.[2];requireThat(body,422,'找不到原會計引擎');
 const end=body.indexOf(';',body.indexOf('if(typeof module'))+1;
 requireThat(createHash('sha256').update(body.slice(0,end)+'\n').digest('hex')===expected,422,'會計引擎版本不同，請先比對後升級轉接器');
 // Source HTML is a protected database asset, never a public repository file.
 for(const id of ['embedded-data','embedded-state','eagle-data'])html=html.replace(new RegExp(`(<script[^>]*id=["']${id}["'][^>]*>)[\\s\\S]*?(<\\/script>)`),`$1@@${id}@@$2`);
 const local="try{const saved=JSON.parse(localStorage.getItem(KEY)||'null');if(saved&&!Object.keys(seed).length)state={...state,...saved}}catch{}";
 requireThat(html.includes(local),422,'V4儲存啟動碼不同，拒絕不完整轉換');html=html.replace(local,'');
 const old="function persist(){try{localStorage.setItem(KEY,JSON.stringify(state))}catch{toast('目前無法寫入瀏覽器；請匯出覆核檔備份')}}";
 // Exact V4 has two wording variants; both must remove the full original persistence function.
 const re=/function persist\(\)\{try\{localStorage\.setItem\(KEY,JSON\.stringify\(state\)\)\}catch\{toast\('[^']*'\)\}\}/;
 requireThat(re.test(html),422,'找不到V4儲存函式');html=html.replace(re,"function persist(){window.dispatchEvent(new Event('jplus-dirty'))}");
 requireThat(!html.includes('localStorage'),422,'V4仍有本機儲存路徑，需人工檢查');
 html=html.replace(/保存本機/g,'保存草稿').replace(/已保存覆核紀錄/g,'已更新草稿').replace(/資料仍儲存在目前瀏覽器[^<]*/g,'資料由登入後的公司API載入；修改需按頂部送出。');
 return {D,eagle,html,asof:'2026-10-30',sourceHash:createHash('sha256').update(html).digest('hex')};
}
export function renderV4(template,snapshot,user,csrf,nonce){
 let html=template;for(const [id,obj]of Object.entries({'embedded-data':snapshot.D,'eagle-data':snapshot.eagle,'embedded-state':snapshot.state}))html=html.replace('@@'+id+'@@',safeJSON(obj));
 html=html.replace(/<script(?![^>]*\bnonce=)/g,`<script nonce="${nonce}"`);
 const boot={user:{id:user.id,login:user.login,role:user.role},csrf,versions:snapshot.versions,revision:snapshot.revision};
 const bar=`<style>#collab{position:sticky;top:0;z-index:1000;background:#003366;color:white;padding:12px 18px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;font:14px system-ui}#collab button{background:white;color:#003366;padding:8px 12px;border:0;border-radius:5px}#collab #sync-status{color:#ffe3a3;flex:1}#collab button:disabled{opacity:.5}</style><div id="collab"><b>JPLUS 共用原型</b><span>${user.role}</span><span id="sync-status" role="status">已載入伺服器資料</span><button id="sync-save">送出至伺服器</button><button id="sync-draft">下載未送出草稿</button><button id="sync-refresh">載入最新資料</button><button id="sync-audit">稽核／覆核／帳號</button><button id="sync-backup">匯出公司備份</button><button id="sync-logout">登出</button></div>`;
 html=html.replace(/<body([^>]*)>/,`<body$1>${bar.replace('<button id="sync-save">','<a href="/guide" target="_blank" rel="noopener" style="color:white">測試操作指南</a><button id="sync-save">')}`);
 // A public request can never receive this protected HTML without a validated session.
 html+=`<script nonce="${nonce}">window.COLLAB_BOOT=${safeJSON(boot)};</script><script nonce="${nonce}" type="module" src="/assets/adapter.js"></script>`;
 return html;
}
