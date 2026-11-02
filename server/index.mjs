import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDatabase, seedDemo, hashPassword, verifyPassword, today } from './db.mjs';
import { act, snapshot, BusinessError } from './operations.mjs';
const ROOT=resolve(fileURLToPath(new URL('..',import.meta.url)));
const demo=process.argv.includes('--demo');
const db=openDatabase(resolve(ROOT,process.env.ERP_DB||(demo?'data/demo.sqlite':'data/mehers.sqlite')));
if(demo){
 seedDemo(db);
 const owner=db.prepare("SELECT * FROM users WHERE id='demo-owner'").get();
 if(!db.prepare('SELECT 1 FROM documents LIMIT 1').get()){
  const total=db.prepare('SELECT SUM(cost) total FROM units').get().total;
  db.prepare('INSERT INTO documents(id,kind,date,party,amount,status,data,actor) VALUES(?,?,?,?,?,?,?,?)').run('OPEN-DEMO','opening',today(),'Demo opening stock',total,'Posted','{}',owner.id);
  db.prepare('INSERT INTO ledger(document_id,account,debit,credit) VALUES(?,?,?,?)').run('OPEN-DEMO','Inventory',total,0);
  db.prepare('INSERT INTO ledger(document_id,account,debit,credit) VALUES(?,?,?,?)').run('OPEN-DEMO','Opening equity',0,total);
  for(const [unitId,customer,method,employeeId] of [['u1','Aarav Pradhan','UPI','e2'],['u9','Sushant Sahu','Card','e1'],['u14','Ananya Mishra','Cash','e2'],['u23','Debasis Meher','UPI','e4'],['u34','Rohit Das','Cash','e1']]){
   const u=db.prepare('SELECT p.price FROM units u JOIN products p ON p.id=u.product_id WHERE u.id=?').get(unitId);act(db,owner,'sale',{customer,employeeId,items:[{unitId,discount:0}],payments:[{method,amount:u.price}]});
  }
  for(const [customer,device,issue,estimate,imei] of [['Pooja Sahu','iPhone 13','Display replacement',650000,'990000000000901'],['Amit Pradhan','Samsung Galaxy M34','Battery drains quickly',180000,'990000000000902'],['Sanjay Nayak','Vivo Y21','Charging port not working',120000,'990000000000903']])act(db,owner,'service',{customer,device,issue,estimate,imei,phone:'',technician:'Rakesh Nayak'});
 }
}else if(!db.prepare('SELECT 1 FROM users LIMIT 1').get()){
 const password=process.env.ERP_ADMIN_PASSWORD;
 if(!password||password.length<12){console.error('Set ERP_ADMIN_PASSWORD to a unique password of at least 12 characters before first start. For sample data run npm run demo.');process.exit(1);}
 db.prepare('INSERT INTO users VALUES(?,?,?,?,?,1)').run('owner','Mehers owner','owner',hashPassword(password),'owner');
}
const digest=t=>createHash('sha256').update(t).digest('hex');
const port=Number(process.env.PORT||4310), host=process.env.HOST||'127.0.0.1';
if(demo&&!['127.0.0.1','localhost','::1'].includes(host))throw new Error('Demo must be bound to loopback.');
const attempts=new Map();
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function body(req){let raw='';for await(const chunk of req){raw+=chunk; if(Buffer.byteLength(raw)>65536)throw new BusinessError('Request too large',413);}try{return JSON.parse(raw||'{}');}catch{throw new BusinessError('Invalid JSON');}}
function authenticate(req){const token=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('mehers_session='))?.slice(15);if(!token)return null;return db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.active=1').get(digest(token),Date.now());}
function session(res,user){const token=randomBytes(32).toString('hex');db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),user.id,Date.now()+8*60*60*1000);res.setHeader('Set-Cookie',`mehers_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.ERP_SECURE_COOKIE==='1'?'; Secure':''}`);}
const server=createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
 try{
  const url=new URL(req.url,'http://localhost');
  if(demo&&!['127.0.0.1','localhost','[::1]'].includes((req.headers.host||'').replace(/:\d+$/,'')))throw new BusinessError('Demo accepts localhost requests only',403);
  if(req.method==='POST'){
   if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`&&req.headers.origin!==`https://${req.headers.host}`)throw new BusinessError('Cross-origin requests are not allowed',403);
   if(!req.headers['content-type']?.includes('application/json'))throw new BusinessError('Use application/json',415);
   const input=await body(req);
   if(url.pathname==='/api/login'){
    const ip=req.socket.remoteAddress;let attempt=attempts.get(ip)||{count:0,until:Date.now()+900000};if(Date.now()>attempt.until)attempt={count:0,until:Date.now()+900000};if(attempt.count>=10)throw new BusinessError('Too many attempts. Try again in 15 minutes.',429);
    const user=db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(String(input.username||''));if(!user||!verifyPassword(String(input.password||''),user.password)){attempt.count++;attempts.set(ip,attempt);throw new BusinessError('Username or password is incorrect',401);}attempts.delete(ip);session(res,user);return json(res,200,{ok:true});
   }
   if(url.pathname==='/api/demo'&&demo){session(res,db.prepare("SELECT * FROM users WHERE id='demo-owner'").get());return json(res,200,{ok:true});}
   const user=authenticate(req);if(!user)throw new BusinessError('Please sign in',401);
   if(url.pathname==='/api/logout'){const token=req.headers.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('mehers_session=')).slice(15);db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token));res.setHeader('Set-Cookie','mehers_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,200,{ok:true});}
   if(url.pathname.startsWith('/api/actions/')){
    const key=req.headers['idempotency-key'];if(typeof key!=='string'||key.length<8||key.length>100)throw new BusinessError('A valid idempotency key is required');
    return json(res,200,act(db,user,url.pathname.slice(13),input,key));
   }
   throw new BusinessError('Not found',404);
  }
  if(req.method!=='GET')throw new BusinessError('Method not allowed',405);
  if(url.pathname==='/api/health')return json(res,200,{ok:true,demo});
  if(url.pathname==='/api/state'){const user=authenticate(req);if(!user)throw new BusinessError('Please sign in',401);return json(res,200,snapshot(db,user,demo));}
  if(url.pathname.startsWith('/api/'))throw new BusinessError('Not found',404);
  const files={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css','/favicon.svg':'favicon.svg'};
  const filename=files[url.pathname];if(!filename)throw new BusinessError('Not found',404);
  const path=resolve(ROOT,'public',filename);res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'})[extname(path)],'Cache-Control':'no-cache'});res.end(readFileSync(path));
 }catch(error){if(!res.headersSent){const expected=error instanceof BusinessError;json(res,expected?error.status:500,{error:expected?error.message:error.code?.startsWith('ERR_SQLITE')?'The record conflicts with existing data. Check unique values and try again.':'Unexpected server error'});}else res.end();if(!(error instanceof BusinessError))console.error(error);}
});
server.listen(port,host,()=>console.log(`Mehers ERP ${demo?'DEMO':'LOCAL'}: http://${host}:${server.address().port}`));
process.on('SIGINT',()=>server.close(()=>{db.close();process.exit(0);}));
