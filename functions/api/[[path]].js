const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}});
const encode=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const sha=async text=>encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))));
const random=()=>encode(crypto.getRandomValues(new Uint8Array(32)));
async function passwordHash(password,salt){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 return encode(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:210000,hash:'SHA-256'},key,256)));
}
const cookie=(token,maxAge)=>'wlchat_session='+token+'; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age='+maxAge;
const readCookie=req=>req.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('wlchat_session='))?.slice(15)||'';
async function current(req,db){const token=readCookie(req);if(!token||!/^[a-f0-9]{64}$/.test(token))return null;return await db.prepare('SELECT u.id,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(await sha(token),Date.now()).first();}
async function body(req){const s=await req.text();if(s.length>10000)throw Error('Requête trop volumineuse');return JSON.parse(s);}
export async function onRequest({request,env}){
 const db=env.CHAT_DB;if(!db)return json({error:'CHAT_DB non configurée sur Cloudflare.'},503);
 const url=new URL(request.url),path=url.pathname.replace(/^\/api\/?/,'').replace(/\/$/,'');
 const method=request.method;
 if(!['GET','POST'].includes(method))return json({error:'Méthode refusée'},405);
 if(method==='POST'&&request.headers.get('origin')!==url.origin)return json({error:'Origine refusée'},403);
 try{
  if(path==='health'&&method==='GET'){await db.prepare('SELECT id FROM rooms LIMIT 1').first();return json({ok:true,mode:'server'});}
  if(path==='register'&&method==='POST'){
   const b=await body(request);const username=String(b.username||'').trim(),password=String(b.password||'');
   if(!/^[a-zA-Z0-9_]{3,24}$/.test(username)||password.length<12||password.length>128)return json({error:'Identifiant : 3–24 lettres/chiffres/_ ; mot de passe : 12–128 caractères.'},400);
   const salt=random(),id=crypto.randomUUID(),hash=await passwordHash(password,salt);
   try{await db.prepare('INSERT INTO users(id,username,password_hash,salt,created_at) VALUES(?,?,?,?,?)').bind(id,username,hash,salt,Date.now()).run();}catch{return json({error:'Identifiant indisponible'},409);}
   return json({ok:true},201);
  }
  if(path==='login'&&method==='POST'){
   const b=await body(request);const username=String(b.username||'').trim(),password=String(b.password||'');
   if(username.length>24||password.length>128)return json({error:'Identifiants invalides'},401);
   const user=await db.prepare('SELECT id,username,password_hash,salt FROM users WHERE username=?').bind(username).first();
   if(!user||await passwordHash(password,user.salt)!==user.password_hash)return json({error:'Identifiants invalides'},401);
   const token=random();await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await sha(token),user.id,Date.now()+7*86400000).run();
   return json({user:{id:user.id,username:user.username}},200,{'set-cookie':cookie(token,7*86400)});
  }
  const user=await current(request,db);
  if(path==='me'&&method==='GET')return json({user});
  if(path==='logout'&&method==='POST'){const token=readCookie(request);if(token)await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha(token)).run();return json({ok:true},200,{'set-cookie':cookie('',0)});}
  if(!user)return json({error:'Connexion nécessaire'},401);
  if(path==='rooms'&&method==='GET'){const r=await db.prepare('SELECT id,name,description FROM rooms ORDER BY rowid').all();return json({rooms:r.results});}
  if(path==='messages'&&method==='GET'){
   const room=url.searchParams.get('room')||'general';if(!/^[a-z0-9-]{1,48}$/.test(room))return json({error:'Salon invalide'},400);
   const after=Number(url.searchParams.get('after')||0);if(!Number.isSafeInteger(after)||after<0)return json({error:'Curseur invalide'},400);
   const r=await db.prepare('SELECT m.id,m.room_id,m.text,m.created_at,u.username FROM messages m JOIN users u ON u.id=m.user_id WHERE m.room_id=? AND m.created_at>? ORDER BY m.created_at ASC LIMIT 100').bind(room,after).all();
   return json({messages:r.results});
  }
  if(path==='messages'&&method==='POST'){
   const b=await body(request);const room=String(b.room||''),message=String(b.text||'').trim();
   if(!/^[a-z0-9-]{1,48}$/.test(room)||!message||message.length>2000)return json({error:'Message invalide (maximum 2 000 caractères)'},400);
   const exists=await db.prepare('SELECT id FROM rooms WHERE id=?').bind(room).first();if(!exists)return json({error:'Salon introuvable'},404);
   const previous=await db.prepare('SELECT created_at FROM messages WHERE user_id=? ORDER BY created_at DESC LIMIT 1').bind(user.id).first();
   const now=Date.now();if(previous&&now-previous.created_at<1000)return json({error:'Un message par seconde maximum'},429);
   await db.prepare('INSERT INTO messages(id,room_id,user_id,text,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),room,user.id,message,now).run();return json({ok:true},201);
  }
  return json({error:'Route introuvable'},404);
 }catch(e){if(e instanceof SyntaxError)return json({error:'JSON invalide'},400);if(e.message==='Requête trop volumineuse')return json({error:e.message},413);return json({error:'Erreur du serveur'},500);}
}