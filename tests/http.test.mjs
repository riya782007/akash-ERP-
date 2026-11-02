import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve,sep } from 'node:path';

test('HTTP authentication, CSRF, idempotency, validation and browser assets',async t=>{
 const temp=mkdtempSync(join(tmpdir(),'mehers-http-'));
 const child=spawn(process.execPath,['server/index.mjs','--demo'],{env:{...process.env,DATABASE_URL:'',PORT:'0',HOST:'127.0.0.1',ERP_SECURE_COOKIE:'0'},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null){const exit=new Promise(r=>child.once('exit',r));child.kill();await exit;}if(resolve(temp).startsWith(resolve(tmpdir())+sep)&&temp.includes('mehers-http-'))rmSync(temp,{recursive:true,force:true});});
 const origin=await new Promise((resolve,reject)=>{let log='';const timeout=setTimeout(()=>reject(Error('Test server did not start')),60000);child.stdout.on('data',b=>{log+=b;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timeout);resolve(m[0]);}});child.once('error',e=>{clearTimeout(timeout);reject(e);});child.once('exit',code=>{clearTimeout(timeout);reject(Error(`Test server exited ${code}`));});});
 assert.equal((await fetch(origin+'/api/state')).status,401);
 const login=await fetch(origin+'/api/demo',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
 const state=await(await fetch(origin+'/api/state',{headers:{cookie}})).json();assert.equal(state.user.role,'owner');assert.equal(state.demo,true);
 const html=await(await fetch(origin)).text();assert.match(html,/app.js/);assert.match(html,/styles.css/);const js=await(await fetch(origin+'/app.js')).text();assert.match(js,/function renderPOS/);assert.match(js,/boot\(\)/);assert.ok(js.length>20000);assert.match(js,/function aiModal/);
 assert.equal((await fetch(origin+'/server/db.mjs')).status,404);
 const action={party:'Test landlord',amount:10000,category:'Rent',method:'Cash'};
 const headers={'Content-Type':'application/json',cookie,'Idempotency-Key':'http-test-request'};
 assert.equal((await fetch(origin+'/api/actions/expense',{method:'POST',headers:{...headers,Origin:'https://untrusted.example'},body:JSON.stringify(action)})).status,403);
 assert.equal((await fetch(origin+'/api/actions/expense',{method:'POST',headers:{'Content-Type':'application/json',cookie},body:JSON.stringify(action)})).status,400);
 const first=await(await fetch(origin+'/api/actions/expense',{method:'POST',headers,body:JSON.stringify(action)})).json();const retry=await(await fetch(origin+'/api/actions/expense',{method:'POST',headers,body:JSON.stringify(action)})).json();assert.equal(first.id,retry.id);
 assert.equal((await fetch(origin+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password:'wrong'})})).status,401);
 await fetch(origin+'/api/logout',{method:'POST',headers:{'Content-Type':'application/json',cookie},body:'{}'});assert.equal((await fetch(origin+'/api/state',{headers:{cookie}})).status,401);
});
