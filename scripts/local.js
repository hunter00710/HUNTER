import {readFileSync,writeFileSync,mkdirSync,existsSync,rmSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createInterface} from 'node:readline/promises';
import {createServer} from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import {openStore,seed,audit,snapshot,requireThat,hash} from '../src/store.js';
import {addUser} from '../src/auth.js';
import E from '../src/control-engine.cjs';
import {parseV4} from '../src/v4.js';
import {createApp} from '../src/server.js';
import {fixture} from '../tests/fixture.js';

const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const localHome=()=>{const at=process.argv.indexOf('--home');return at<0?projectRoot:resolve(process.argv[at+1]);};
export function checkNode(version=process.versions.node){
 const [major,minor,patch]=version.split('.').map(Number);
 requireThat(major===24&&(minor>22||minor===22&&patch>=1),422,'需要 Node.js 24.22.1 至24.x；請先安裝官方Node 24版本。');
}
export async function availablePort(port){return new Promise(resolve=>{const s=createServer();s.once('error',()=>resolve(false));s.listen(port,'127.0.0.1',()=>s.close(()=>resolve(true)));});}
export function initializeLocal({root=projectRoot,sourceHTML=null,adminPassword,port=3000}){
 checkNode();requireThat(Number.isInteger(port)&&port>=1024&&port<=65535,422,'連接埠須在1024至65535之間');
 const configPath=join(root,'local','config.json');
 requireThat(!existsSync(configPath),409,'本機設定已存在。請使用02_Start.cmd；初始化不會覆蓋原資料。');
 const stamp=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)+'-'+randomBytes(3).toString('hex');
 const dbPath=join(root,'data','uat-'+stamp+'.sqlite');
 const db=openStore(dbPath);let complete=false;
 try{
  const imported=sourceHTML?parseV4(sourceHTML):fixture();
  if(sourceHTML)imported.sourceHash=hash(sourceHTML);
  seed(db,imported,'local-setup');
  const snap=snapshot(db),rows=E.orders(snap.D,snap.state.control),candidates=rows.filter(o=>o.balance>=2000),unknown=rows.find(o=>o.paid===null);
  requireThat(candidates.length>=2,422,'完整驗收需至少兩筆已知基準且正未收不低於2000元的PO');
  const ap=snap.eagle.records.find(r=>r.currency==='USD'&&r.total-r.paid>=100)||snap.eagle.records.find(r=>r.total-r.paid>=100);
  requireThat(ap,422,'驗收需至少一筆正未付不低於100元的應付項目');
  const accounts=[
   {login:'uat-admin',role:'admin',scope:['*'],password:adminPassword},
   ...['finance','reviewer','sales','viewer'].map(role=>({login:'uat-'+role,role,scope:role==='sales'?[candidates[0].po]:['*'],password:randomBytes(18).toString('base64url')}))
  ];
  for(const a of accounts)addUser(db,a,'local-setup');
  const plan={mode:sourceHTML?'v4':'synthetic',created:new Date().toISOString(),asof:snap.state.control.asof,orders:rows.length,payables:snap.eagle.records.length,poA:candidates[0].po,poB:candidates[1].po,unknownPO:unknown?.po||null,payable:ap.id,currency:ap.currency,receiptsPrefix:'UAT-REC-',paymentPrefix:'UAT-PAY-'};
  db.prepare('INSERT INTO documents VALUES(?,?)').run('localUAT',JSON.stringify(plan));
  audit(db,'local-setup','initialize','uat',null,{mode:plan.mode,orders:plan.orders,payables:plan.payables});
  const config={schema:1,dbPath,port,origin:`http://127.0.0.1:${port}`,mode:plan.mode};
  mkdirSync(dirname(configPath),{recursive:true,mode:0o700});
  writeFileSync(configPath,JSON.stringify(config,null,2),{flag:'wx',mode:0o600});complete=true;
  return {config,plan,accounts};
 }finally{
  db.close();if(!complete)for(const suffix of ['','-wal','-shm'])rmSync(dbPath+suffix,{force:true});
 }
}
export function loadLocal(root=projectRoot){
 const path=join(root,'local','config.json');requireThat(existsSync(path),404,'尚未初始化，請先執行01_Setup.cmd');
 const c=JSON.parse(readFileSync(path,'utf8'));requireThat(c.schema===1&&c.origin===`http://127.0.0.1:${c.port}`&&Number.isInteger(c.port)&&c.port>=1024&&c.port<=65535&&existsSync(c.dbPath),422,'本機設定不完整或資料庫不存在');return c;
}
async function hiddenQuestion(prompt){
 if(!process.stdin.isTTY){const rl=createInterface({input:process.stdin,output:process.stdout});try{return await rl.question(prompt);}finally{rl.close();}}
 process.stdout.write(prompt);process.stdin.setRawMode(true);process.stdin.resume();let value='';
 return new Promise((resolve,reject)=>{
  const done=()=>{process.stdin.removeListener('data',onData);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');};
  const onData=data=>{for(const c of data.toString()){
   if(c==='\r'||c==='\n'){done();resolve(value);return;}
   if(c==='\u0003'){done();reject(Error('已取消'));return;}
   if(c==='\u007f'||c==='\b'){value=value.slice(0,-1);continue;}
   if(c>=' '&&c!=='\u001b')value+=c;
  }};process.stdin.on('data',onData);
 });
}
async function setup(){
 checkNode();if(existsSync(join(localHome(),'local','config.json'))){console.log('已找到本機設定；不重建資料。請執行02_Start.cmd。');return;}
 const rl=createInterface({input:process.stdin,output:process.stdout});let html=null;
 try{
  console.log('\nJPLUS 本機測試初始化（不修改原V4，也不建立正式帳戶）');
  console.log('1 = 匯入V4，完整BI與收付款操作測試（建議）');
  console.log('2 = 合成資料，基本權限介面；完整財務規則由自動測試驗證');
  const mode=(await rl.question('請選1或2 [1]：')).trim()||'1';requireThat(['1','2'].includes(mode),422,'請輸入1或2');
  if(mode==='1'){
   const path=(await rl.question('請貼上下載的V4 HTML完整路徑（可含雙引號）：')).trim().replace(/^"(.*)"$/,'$1');
   requireThat(path,422,'需提供V4 HTML路徑');html=readFileSync(resolve(path),'utf8');parseV4(html);
  }
 }finally{rl.close();}
 const pass=await hiddenQuestion('設定uat-admin密碼（至少14字，不顯示輸入）：');
 const confirm=await hiddenQuestion('再次輸入密碼：');requireThat(pass===confirm,422,'兩次密碼不相同');
 let port=3000;while(port<=3010&&!await availablePort(port))port++;
 requireThat(port<=3010,409,'3000至3010埠均被使用；請關閉其他測試服務再試');
 console.log('\n執行核心測試…');
 const test=spawnSync(process.execPath,['--test','tests/system.test.js','tests/local.test.js'],{cwd:projectRoot,stdio:'inherit'});
 requireThat(test.status===0,500,'核心測試未通過，初始化停止');
 const result=initializeLocal({root:localHome(),sourceHTML:html,adminPassword:pass,port});
 console.log('\n已建立獨立UAT測試資料庫。管理者密碼為你剛才設定的密碼。');
 console.log('下列其餘角色密碼僅顯示這一次；請存入自己的密碼管理工具：\n');
 for(const a of result.accounts)console.log(`${a.login} | ${a.role} | ${a.login==='uat-admin'?'（自行設定）':a.password}`);
 console.log(`\n啟動後網址：${result.config.origin}`);
 console.log(`完整操作指南：${result.config.origin}/guide`);
 console.log('下一步：執行02_Start.cmd。關閉本視窗前請先保存上述測試密碼。');
}
function openBrowser(url){
 const cmd=process.platform==='win32'?['cmd.exe',['/d','/c','start','',url]]:process.platform==='darwin'?['open',[url]]:['xdg-open',[url]];
 const c=spawn(cmd[0],cmd[1],{stdio:'ignore',detached:true});c.on('error',()=>console.log('請手動在瀏覽器開啟：'+url));c.unref();
}
async function start(){
 checkNode();const c=loadLocal(localHome());requireThat(await availablePort(c.port),409,`連接埠${c.port}已被使用。若已啟動JPLUS，請使用原視窗；不要重複開服務。`);
 const db=openStore(c.dbPath),server=createApp({db,origin:c.origin,secure:false});
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(c.port,'127.0.0.1',resolve);});
  console.log(`JPLUS prototype listening at ${c.origin}\n本機測試服務已啟動。保持此視窗開啟；停止服務請按Ctrl+C。`);
  if(!process.argv.includes('--no-browser'))openBrowser(c.origin);
  const stop=()=>server.close();process.once('SIGINT',stop);process.once('SIGTERM',stop);
  await new Promise(resolve=>server.once('close',resolve));
  process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
 }finally{db.close();}
}
async function backup(){
 const c=loadLocal(localHome()),dir=join(localHome(),'local','backups');mkdirSync(dir,{recursive:true,mode:0o700});
 const file=join(dir,'jplus-'+new Date().toISOString().replace(/[:.]/g,'-')+'.backup.json');
 const p=spawnSync(process.execPath,['scripts/admin.js','backup',file],{cwd:projectRoot,env:{...process.env,DB_PATH:c.dbPath},stdio:'inherit'});requireThat(p.status===0,500,'備份失敗');console.log('備份位置：'+file);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const command=process.argv[2];if(command==='setup')await setup();else if(command==='start')await start();else if(command==='backup')await backup();else if(command==='check'){const c=loadLocal(localHome());const p=spawnSync(process.execPath,['scripts/admin.js','check'],{cwd:projectRoot,env:{...process.env,DB_PATH:c.dbPath},stdio:'inherit'});process.exitCode=p.status??1;}else throw Error('Usage: node scripts/local.js setup | start | backup | check');}
 catch(e){console.error('\n未完成：'+e.message);process.exitCode=1;}
}
