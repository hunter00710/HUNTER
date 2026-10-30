import {scrypt,scryptSync,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {hash,Fault,requireThat,atomic,audit} from './store.js';
const scryptAsync=promisify(scrypt);
const options={N:32768,r:8,p:1,maxmem:64*1024*1024};
export function passwordHash(password){
 requireThat(typeof password==='string'&&password.length>=14&&password.length<=256,422,'密碼須14至256個字元');
 const salt=randomBytes(16).toString('hex');return `scrypt$${salt}$${scryptSync(password,salt,64,options).toString('hex')}`;
}
export async function passwordCheck(password,stored){
 const [,salt,digest]=stored?.split('$')||[];
 const actual=await scryptAsync(password||'',salt||'dummy-constant-salt',64,options);
 return !!digest&&timingSafeEqual(actual,Buffer.from(digest,'hex'));
}
export function addUser(db,{login,password,role='viewer',scope=['*']},actor='cli'){
 requireThat(/^[a-zA-Z0-9@._-]{2,100}$/.test(login),422,'登入名稱格式不正確');
 requireThat(['admin','finance','reviewer','sales','viewer'].includes(role),422,'未知角色');
 requireThat(Array.isArray(scope)&&scope.length>0&&scope.every(x=>typeof x==='string'&&/^(\*|[\w.-]{1,120})$/.test(x)),422,'PO範圍無效');
 const id=randomUUID(),encoded=passwordHash(password);
 atomic(db,()=>{db.prepare('INSERT INTO users(id,login,password_hash,role,scope) VALUES(?,?,?,?,?)').run(id,login,encoded,role,JSON.stringify(scope));audit(db,actor,'create','users/'+id,null,{login,role,scope});});
 return {id,login,role,scope};
}
export function cookie(req){const raw=req.headers.cookie||'';return raw.split(';').map(x=>x.trim()).find(x=>x.startsWith('jplus_session='))?.slice(14);}
export const csrfForSession=token=>hash('jplus-csrf:'+token);
export function session(db,req){
 const token=cookie(req);if(!token)return null;
 const row=db.prepare('SELECT u.*,s.csrf_hash,s.expires FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>? AND u.active=1').get(hash(token),Date.now());
 return row||null;
}
export async function login(db,req,{login,password}){
 requireThat(typeof login==='string'&&login.length<=100&&typeof password==='string'&&password.length<=256,400,'登入資料不完整');
 const key=hash(login.toLowerCase()),now=Date.now(),limit=db.prepare('SELECT * FROM login_limits WHERE key=?').get(key);
 requireThat(!limit||limit.failures<5||limit.until_ms<now,429,'登入失敗次數過多，請15分鐘後再試');
 const u=db.prepare('SELECT * FROM users WHERE login=? AND active=1').get(login);
 const good=await passwordCheck(password,u?.password_hash);
 if(!good){const n=limit&&limit.until_ms>now?limit.failures+1:1;db.prepare('INSERT INTO login_limits VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET failures=excluded.failures,until_ms=excluded.until_ms').run(key,n,now+900000);audit(db,u?.id||'anonymous','login_failed','auth',null,{loginHash:key});throw new Fault(401,'帳號或密碼不正確');}
 const token=randomBytes(32).toString('base64url'),csrf=csrfForSession(token);
 atomic(db,()=>{db.prepare('DELETE FROM sessions WHERE expires<?').run(now);db.prepare('DELETE FROM login_limits WHERE key=?').run(key);db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(token),u.id,hash(csrf),now+8*3600000);audit(db,u.id,'login','auth',null,null);});
 return {token,csrf,user:{id:u.id,login:u.login,role:u.role,scope:JSON.parse(u.scope)}};
}
