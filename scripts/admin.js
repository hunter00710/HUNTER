import {readFileSync,writeFileSync,existsSync,chmodSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {openStore,seed,hash,atomic,verifyAudit,audit,exportBackup,requireThat} from '../src/store.js';
import {addUser,passwordHash} from '../src/auth.js';
import {parseV4} from '../src/v4.js';
import {fixture} from '../tests/fixture.js';
const [command,...args]=process.argv.slice(2),path=process.env.DB_PATH||'data/jplus.sqlite';
const db=openStore(path);
try{
 if(command==='create-user'){
  requireThat(process.env.JPLUS_PASSWORD,422,'請以JPLUS_PASSWORD環境變數提供密碼，不要把密碼寫入命令參數或程式碼');
  const [login,role='viewer',scopes='*']=args;const result=addUser(db,{login,role,scope:scopes.split(','),password:process.env.JPLUS_PASSWORD});console.log(JSON.stringify(result));
 }else if(command==='reset-password'){
  const [login]=args;const encoded=passwordHash(process.env.JPLUS_PASSWORD);atomic(db,()=>{const u=db.prepare('SELECT id FROM users WHERE login=?').get(login);requireThat(u,404,'找不到帳號');db.prepare('UPDATE users SET password_hash=?,version=version+1 WHERE id=?').run(encoded,u.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);audit(db,'cli','password_reset','users/'+u.id,null,null);});console.log('Password reset; all user sessions revoked.');
 }else if(command==='import-v4'){
  const [file]=args;const parsed=parseV4(readFileSync(file,'utf8'));parsed.sourceHash=hash(readFileSync(file));seed(db,parsed,'cli');console.log(JSON.stringify({imported:true,orders:parsed.D.orders.length,payables:parsed.eagle.records.length,sourceHash:parsed.sourceHash}));
 }else if(command==='demo'){
  seed(db,fixture(),'cli');const password=randomBytes(20).toString('base64url');addUser(db,{login:'demo-admin',password,role:'admin'});console.log('Synthetic data only. Login: demo-admin');console.log('One-time display of generated demo password: '+password);
 }else if(command==='backup'){
  const [file]=args;requireThat(file&&!existsSync(file),422,'請指定尚不存在的備份檔');const backup=exportBackup(db,{id:'cli',role:'admin',scope:'["*"]'});writeFileSync(file,JSON.stringify(backup),{mode:0o600});console.log('Backup written.');
 }else if(command==='restore'){
  const [file]=args,backup=JSON.parse(readFileSync(file,'utf8')),{sha256,...payload}=backup;
  requireThat(hash(JSON.stringify(payload))===sha256&&payload.schema===1,422,'備份校驗失敗');
  requireThat(verifyAudit(payload.tables.audit),422,'稽核鏈校驗失敗');
  requireThat(db.prepare('SELECT count(*) AS n FROM users').get().n===0&&db.prepare('SELECT count(*) AS n FROM documents').get().n===0,409,'僅可還原至全新資料庫');
  atomic(db,()=>{
   for(const u of payload.identities)db.prepare('INSERT INTO users(id,login,password_hash,role,scope,active) VALUES(?,?,?,?,?,0)').run(u.id,u.login,'locked',u.role,u.scope);
   const allowed=['meta','documents','orders','payables','plans','receipts','payments','reviews','settings','allocations','audit'];
   for(const table of allowed){
    if(table==='meta')db.exec('DELETE FROM meta');
    const columns=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name));
    for(const row of payload.tables[table]||[]){const keys=Object.keys(row);requireThat(keys.every(k=>columns.has(k)),422,'備份欄位不正確');db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]));}
   }
   requireThat(db.prepare('PRAGMA foreign_key_check').all().length===0,422,'還原外鍵檢查失敗');
   audit(db,'cli','restore','backup',null,{sha256});
  });console.log('Restored. Historical identities are disabled. Create a new administrator and re-enable accounts after setting passwords.');
 }else if(command==='check'){
  const ok=db.prepare('PRAGMA integrity_check').get().integrity_check==='ok',chain=verifyAudit(db.prepare('SELECT * FROM audit ORDER BY seq').all()),fk=db.prepare('PRAGMA foreign_key_check').all();console.log(JSON.stringify({integrity:ok,auditChain:chain,foreignKeys:fk.length===0}));if(!ok||!chain||fk.length)process.exitCode=1;
 }else throw Error('Usage: create-user LOGIN ROLE [PO_SCOPE] | reset-password LOGIN | import-v4 FILE | demo | backup NEW_FILE | restore FILE | check');
}catch(e){console.error(e.message);process.exitCode=1;}finally{db.close();}
