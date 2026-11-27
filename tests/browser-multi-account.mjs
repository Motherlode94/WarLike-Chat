import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {onRequest} from '../functions/api/[[path]].js';
const raw=new DatabaseSync(':memory:');
for(const name of ['0002_warlike_chat','0003_private_chat','0004_calls','0005_availability'])raw.exec(readFileSync(new URL('../migrations/'+name+'.sql',import.meta.url),'utf8'));
const db={prepare(sql){const s=raw.prepare(sql);let args=[];return {bind(...a){args=a;return this},async first(){return s.get(...args)||null},async all(){return {results:s.all(...args)}},async run(){return {meta:{changes:Number(s.run(...args).changes)}}}}}};
const identities=['Alice','Bob','Carol'].map((name,i)=>({id:'u'+i,name,role:'member',token:String.fromCharCode(65+i).repeat(43)}));
const active=new Set();let blocked=false;
const env={CHAT_DB:db,WARLIKE_SERVER:{async fetch(req){const path=new URL(req.url).pathname;const token=req.headers.get('cookie')?.split('=')[1];if(path.endsWith('/login')){const body=await req.json();const u=identities.find(x=>x.name===body.login);if(!u||body.password!=='qa-password')return Response.json({}, {status:401});active.add(u.token);return Response.json({mustChange:false},{headers:{'set-cookie':'__Host-warlike_session='+u.token+'; Path=/; Secure; HttpOnly'}});}if(path.endsWith('/logout')){active.delete(token);return Response.json({ok:true});}const u=identities.find(x=>x.token===token&&active.has(token));return Response.json({user:u?{id:u.id,name:u.name,role:u.role}:null});}},NETWORKS:{async fetch(req){if(new URL(req.url).pathname.endsWith('/chat-policy'))return Response.json({allowed:!blocked});return Response.json({contacts:[],meetings:[]});}}};
const browser=await chromium.launch({headless:true});
try{
 const pages=[];
 for(const u of identities){
  const ctx=await browser.newContext();let sessionCookie='';
  await ctx.route('**/api/**',async route=>{const q=route.request(),url=new URL(q.url());const headers=new Headers(q.headers());headers.set('origin','https://chat.test');if(sessionCookie)headers.set('cookie',sessionCookie);const res=await onRequest({env,request:new Request('https://chat.test'+url.pathname+url.search,{method:q.method(),headers,body:q.postData()??undefined})});const cookie=res.headers.get('set-cookie');if(cookie)sessionCookie=cookie.split(';')[0];await route.fulfill({status:res.status,contentType:'application/json',body:await res.text()});});
  const page=await ctx.newPage();pages.push(page);await page.goto('http://127.0.0.1:8765/');await page.locator('#loginSubmit:enabled').waitFor();await page.locator('[name=username]').fill(u.name);await page.locator('[name=password]').fill('qa-password');await page.locator('#loginSubmit').click();await page.locator('#chat').waitFor({state:'visible'});
 }
 const [a,b,c]=pages;
 await a.locator('#members button').filter({hasText:'Bob'}).click({timeout:25000});
 await a.waitForFunction(()=>document.querySelector('#room').value.startsWith('dm-'));
 const room=await a.locator('#room').inputValue();
 await a.locator('#message').fill('QA secret Alice');await a.locator('#sendForm button').click();await a.locator('#feed').getByText('QA secret Alice',{exact:true}).waitFor();
 await b.locator('#members button').filter({hasText:'Alice'}).click();await b.locator('#feed').getByText('QA secret Alice',{exact:true}).waitFor();
 await b.locator('#message').fill('QA secret Bob');await b.locator('#sendForm button').click();await a.locator('#feed').getByText('QA secret Bob',{exact:true}).waitFor();
 assert.equal(await c.evaluate(async room=>(await fetch('/api/messages?room='+room)).status,room),404);
 blocked=true;assert.equal(await b.evaluate(async room=>(await fetch('/api/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({room,text:'blocked'})})).status,room),403);
 await b.locator('#accountMenu summary').click();await b.locator('#logout').click();await b.locator('#auth').waitFor({state:'visible'});assert.equal(await b.locator('#feed article').count(),0);
 assert.equal(await b.evaluate(async room=>(await fetch('/api/messages?room='+room)).status,room),401);
 console.log('PASS: three browser contexts, real Chat handler and SQLite, mocked Server and Networks');
}finally{await browser.close();raw.close();}
