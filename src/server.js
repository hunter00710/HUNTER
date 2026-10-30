import http from 'node:http';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {openStore,snapshot,change,exportBackup,documents,revision,Fault,requireThat,fullScope,canPO,hash,audit,atomic,bump,verifyAudit} from './store.js';
import {session,login,cookie,csrfForSession,addUser,passwordHash} from './auth.js';
import {renderV4} from './v4.js';
const root=new URL('../',import.meta.url);
const assets={'/assets/adapter.js':'web/adapter.js','/assets/state.js':'src/state.js','/assets/desk.js':'web/desk.js'};
export function createApp({db,origin='http://127.0.0.1:3000',secure=false}){
 requireThat(!secure||origin.startsWith('https://'),500,'正式模式需要HTTPS APP_ORIGIN');
 return http.createServer(async(req,res)=>{
  const nonce=randomBytes(18).toString('base64');
  const headers={'Cache-Control':'no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':`default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`};
  if(secure)headers['Strict-Transport-Security']='max-age=31536000';
  const send=(status,body,type='application/json',extra={})=>{res.writeHead(status,{...headers,'Content-Type':type+'; charset=utf-8',...extra});res.end(type==='application/json'?JSON.stringify(body):body);};
  try{
   const url=new URL(req.url,origin),path=url.pathname,method=req.method;
   if(path==='/health'&&method==='GET')return send(200,{status:'ok',prototype:true});
   if(path==='/'&&method==='GET')return send(200,readFileSync(new URL('web/login.html',root),'utf8').replaceAll('@@NONCE@@',nonce),'text/html');
   if(assets[path]&&method==='GET')return send(200,readFileSync(new URL(assets[path],root),'utf8'),'text/javascript');
   let user=session(db,req);
   const mutation=!['GET','HEAD'].includes(method);
   if(mutation){
    requireThat(req.headers.origin===origin,403,'來源驗證失敗');
    requireThat((req.headers['content-type']||'').split(';')[0]==='application/json',415,'請使用application/json');
    requireThat(!req.headers['sec-fetch-site']||['same-origin','none'].includes(req.headers['sec-fetch-site']),403,'拒絕跨站請求');
   }
   let body={};if(mutation){let bytes=0,parts=[];for await(const part of req){bytes+=part.length;requireThat(bytes<=2*1024*1024,413,'請求超過2MB');parts.push(part);}try{body=JSON.parse(Buffer.concat(parts).toString()||'{}');}catch{throw new Fault(400,'JSON格式錯誤');}}
   if(path==='/api/login'&&method==='POST'){
    const r=await login(db,req,body);return send(200,{user:r.user,csrf:r.csrf},'application/json',{'Set-Cookie':`jplus_session=${r.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure?'; Secure':''}`});
   }
   requireThat(user,401,'請先登入');
   if(mutation)requireThat(hash(req.headers['x-csrf-token']||'')===user.csrf_hash,403,'CSRF驗證失敗');
   if(path==='/api/logout'&&method==='POST'){atomic(db,()=>{db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(cookie(req)));audit(db,user.id,'logout','auth',null,null);});return send(200,{ok:true},'application/json',{'Set-Cookie':`jplus_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure?'; Secure':''}`});}
   // Deterministic per-session CSRF supports multiple tabs without invalidating an older form.
   if(['/workspace','/desk'].includes(path)&&method==='GET'){
    const csrf=csrfForSession(cookie(req));
    const snap=snapshot(db),docs=documents(db);
    if(path==='/workspace'&&fullScope(user)&&user.role!=='sales'&&docs.html)return send(200,renderV4(docs.html,snap,user,csrf,nonce),'text/html');
    const boot=JSON.stringify({csrf,user:{id:user.id,login:user.login,role:user.role,scope:JSON.parse(user.scope)}}).replace(/</g,'\\u003c');
    return send(200,readFileSync(new URL('web/desk.html',root),'utf8').replaceAll('@@NONCE@@',nonce).replace('@@BOOT@@',boot),'text/html');
   }
   if(path==='/api/me'&&method==='GET')return send(200,{id:user.id,login:user.login,role:user.role,scope:JSON.parse(user.scope)});
   if(path==='/api/revision'&&method==='GET')return send(200,{revision:revision(db)});
   if(path==='/api/snapshot'&&method==='GET'){requireThat(fullScope(user)&&user.role!=='sales',403,'完整原表僅供全公司資料權限');const s=snapshot(db);delete s.entities;return send(200,s);}
   if(path==='/api/changes'&&method==='POST')return send(200,change(db,user,body.changes));
   if(path==='/api/backup'&&method==='GET')return send(200,exportBackup(db,user),'application/json',{'Content-Disposition':'attachment; filename="jplus.backup.json"'});
   if(path==='/api/audit'&&method==='GET'){requireThat(['admin','reviewer'].includes(user.role)&&fullScope(user),403,'稽核僅供管理或覆核');const rows=db.prepare('SELECT * FROM audit ORDER BY seq DESC LIMIT 200').all();return send(200,{rows,fullChainValid:verifyAudit(db.prepare('SELECT * FROM audit ORDER BY seq').all())});}
   if(path==='/api/users'&&method==='GET'){requireThat(user.role==='admin',403,'僅管理者');return send(200,db.prepare('SELECT id,login,role,scope,active,version FROM users').all());}
   if(path==='/api/users'&&method==='POST'){requireThat(user.role==='admin',403,'僅管理者');return send(201,addUser(db,body,user.id));}
   if(path.startsWith('/api/users/')&&method==='PATCH'){
    requireThat(user.role==='admin',403,'僅管理者');const id=decodeURIComponent(path.slice(11)),u=db.prepare('SELECT * FROM users WHERE id=?').get(id);requireThat(u,404,'找不到帳號');
    atomic(db,()=>{requireThat(body.version===u.version,409,'帳號版本衝突');const role=body.role??u.role,active=body.active??u.active,scope=body.scope??JSON.parse(u.scope);
     requireThat(['admin','finance','reviewer','sales','viewer'].includes(role)&&[0,1].includes(active)&&Array.isArray(scope)&&scope.length>0&&scope.every(x=>typeof x==='string'&&/^(\*|[\w.-]{1,120})$/.test(x)),422,'角色、狀態或範圍錯誤');
     requireThat(role==='admin'&&active===1||db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND active=1 AND id<>?").get(id).n>0,422,'需保留至少一名啟用的管理者');
     const pw=body.password?passwordHash(body.password):u.password_hash;
     db.prepare('UPDATE users SET role=?,active=?,scope=?,password_hash=?,version=version+1 WHERE id=?').run(role,active,JSON.stringify(scope),pw,id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
     audit(db,user.id,'update','users/'+id,{role:u.role,active:u.active,scope:JSON.parse(u.scope)},{role,active,scope,passwordReset:!!body.password});
    });return send(200,{ok:true});
   }
   const match=/^\/api\/(orders|payables|plans|receipts|payments|reviews)(?:\/([\w:.-]+))?$/.exec(path);
   if(match){const [,c,id]=match,snap=snapshot(db);
    if(method==='GET'){
     if(c==='orders'){const rows=snap.D.orders.filter(o=>canPO(user,o.po)).map(o=>({po:o.po,name:o.name,amount:o.amount,paidBase:o.monthly?.paidSource??null,...snap.entities.orders[o.po],version:snap.versions.orders[o.po]}));const out=id?rows.find(r=>r.po===id):rows;requireThat(out,404,'找不到資料');return send(200,out);}
     requireThat(fullScope(user)&&user.role!=='sales',403,'無此資料權限');const rows=Object.entries(snap.entities[c]).map(([id,data])=>({id,data,version:snap.versions[c][id],...(c==='payables'?{source:snap.eagle.records.find(r=>r.id===id)||null}:{})}));const out=id?rows.find(x=>x.id===id):rows;requireThat(out,404,'找不到資料');return send(200,out);
    }
    if(['POST','PATCH'].includes(method)){const rid=id||body.data?.id;requireThat(rid,422,'缺少ID');if(method==='POST')requireThat(!snap.versions[c][rid],409,'紀錄已存在');return send(method==='POST'?201:200,change(db,user,[{collection:c,id:rid,data:body.data,version:body.version}]));}
   }
   throw new Fault(404,'找不到路徑');
  }catch(e){const status=e.status||500;if(status===500)console.error('Request failed:',e.code||e.name);send(status,{error:status===500?'伺服器無法完成請求':e.message,details:e.details});}
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const port=+(process.env.PORT||3000),host=process.env.HOST||'127.0.0.1',origin=process.env.APP_ORIGIN||`http://127.0.0.1:${port}`,secure=process.env.NODE_ENV==='production';
 if(!secure&&!['127.0.0.1','localhost','::1'].includes(host))throw Error('對外綁定需NODE_ENV=production及HTTPS反向代理');
 const db=openStore(process.env.DB_PATH||'data/jplus.sqlite');createApp({db,origin,secure}).listen(port,host,()=>console.log(`JPLUS prototype listening at ${origin}`));
}
