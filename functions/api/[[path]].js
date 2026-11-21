const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const COOKIE='__Host-warlike_chat',TOKEN=/^[A-Za-z0-9_-]{43}$/,SERVER='https://warlike-server.pages.dev';
const readCookie=req=>{const parts=(req.headers.get('cookie')||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(COOKIE+'='));if(parts.length!==1)return null;const token=parts[0].slice(COOKIE.length+1);return TOKEN.test(token)?token:null};
const setCookie=(token,age)=>`${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
async function readBody(req){if(req.headers.get('content-type')?.split(';')[0]!=='application/json')throw new Error('format');if(Number(req.headers.get('content-length')||0)>65536)throw new Error('size');const reader=req.body?.getReader();if(!reader)throw new Error('format');const chunks=[];let size=0;for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();throw new Error('size')}chunks.push(value)}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}return JSON.parse(new TextDecoder().decode(bytes));}
async function server(req,env,path,{method='GET',token,body}={}){if(!env.WARLIKE_SERVER)throw new Error('server');const headers={origin:SERVER};const ip=req.headers.get('cf-connecting-ip');if(ip)headers['cf-connecting-ip']=ip;if(token)headers.cookie='__Host-warlike_session='+token;if(body)headers['content-type']='application/json';return env.WARLIKE_SERVER.fetch(new Request(SERVER+path,{method,headers,body,redirect:'manual'}));}
async function current(req,env){const token=readCookie(req);if(!token)return null;const r=await server(req,env,'/api/warlike-auth/session',{token});if(r.status===401||r.status===403)return null;if(!r.ok)throw new Error('server');const x=await r.json();return x.user&&!x.mustChange?{id:x.user.id,username:x.user.name,role:x.user.role}:null;}
export async function onRequest({request,env}){
 const db=env.CHAT_DB;if(!db||!env.WARLIKE_SERVER)return json({error:'Service Chat en cours de configuration.'},503);
 const url=new URL(request.url),path=url.pathname.replace(/^\/api\/?/,'').replace(/\/$/,''),method=request.method;
 if(!['GET','POST'].includes(method))return json({error:'Méthode refusée.'},405);
 if(method==='POST'&&(url.protocol!=='https:'||request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site'))return json({error:'Origine refusée.'},403);
 try{
  if(path==='health'&&method==='GET'){await db.prepare('SELECT id FROM chat_rooms LIMIT 1').first();return json({ok:true,mode:'warlike-server'});}
  if(path==='register'&&method==='POST')return json({error:'Utilise ton compte WarLike fourni par ton administrateur.'},403);
  if(path==='login'&&method==='POST'){
   const b=await readBody(request);if(typeof b.username!=='string'||b.username.length>254||typeof b.password!=='string'||b.password.length>256)return json({error:'Identifiants invalides.'},400);
   const res=await server(request,env,'/api/warlike-auth/login',{method:'POST',body:JSON.stringify({login:b.username,password:b.password})});
   if(!res.ok)return json({error:res.status===429?'Trop de tentatives. Réessaie plus tard.':'Connexion impossible. Vérifie tes identifiants.'},res.status===429?429:res.status>=500?503:401);
   const data=await res.json(),match=/^__Host-warlike_session=([A-Za-z0-9_-]{43});/.exec(res.headers.get('set-cookie')||'');if(!match)return json({error:'Session serveur invalide.'},502);
   if(data.mustChange){await server(request,env,'/api/warlike-auth/logout',{method:'POST',token:match[1]}).catch(()=>{});return json({error:'Modifie d’abord tes identifiants temporaires sur WarLike Server.'},403)}
   return json({ok:true},200,{'set-cookie':setCookie(match[1],28800)});
  }
  if(path==='logout'&&method==='POST'){const token=readCookie(request);if(token)await server(request,env,'/api/warlike-auth/logout',{method:'POST',token}).catch(()=>{});return json({ok:true},200,{'set-cookie':setCookie('',0)});}
  const user=await current(request,env);
  if(path==='me'&&method==='GET')return json({user});
  if(!user)return json({error:'Connexion WarLike nécessaire.'},401);
  const canRead=async room=>!!await db.prepare('SELECT r.id FROM chat_rooms r LEFT JOIN chat_direct d ON d.room_id=r.id WHERE r.id=? AND (d.room_id IS NULL OR d.member_a=? OR d.member_b=?)').bind(room,user.id,user.id).first();
  if(path==='availability'&&method==='POST'){
   const b=await readBody(request);if(!['available','busy','away','dnd','meeting'].includes(b.status))return json({error:'Statut invalide.'},400);
   await db.prepare('INSERT INTO chat_availability(user_id,status) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET status=excluded.status').bind(user.id,b.status).run();return json({ok:true});
  }
  if(path==='availability'&&method==='GET'){
   const own=await db.prepare('SELECT status FROM chat_availability WHERE user_id=?').bind(user.id).first();return json({status:own?.status||'available'});
  }
  if(path==='call-history'&&method==='GET'){
   const now=Date.now();const r=await db.prepare("SELECT c.id,c.caller,c.callee,c.kind,CASE WHEN c.state='ringing' AND c.updated<=? THEN 'missed' ELSE c.state END AS state,c.updated,p.username AS peer_name FROM chat_calls c LEFT JOIN chat_presence p ON p.user_id=CASE WHEN c.caller=? THEN c.callee ELSE c.caller END WHERE c.caller=? OR c.callee=? ORDER BY c.updated DESC LIMIT 100").bind(now-120000,user.id,user.id,user.id).all();return json({calls:r.results});
  }
  if(path==='calls'&&method==='GET'){
   const r=await db.prepare("SELECT * FROM chat_calls WHERE (caller=? OR callee=?) AND updated>? ORDER BY updated DESC LIMIT 30").bind(user.id,user.id,Date.now()-3600000).all();return json({calls:r.results});
  }
  if(path==='calls'&&method==='POST'){
   const b=await readBody(request),now=Date.now();
   if(b.action==='invite'){
    if(typeof b.member!=='string'||b.member===user.id||!['audio','video'].includes(b.kind)||typeof b.offer!=='string'||b.offer.length>48000)return json({error:'Invitation invalide.'},400);
    if(!await db.prepare('SELECT user_id FROM chat_presence WHERE user_id=?').bind(b.member).first())return json({error:'Membre inconnu.'},404);
    const preference=await db.prepare('SELECT status FROM chat_availability WHERE user_id=?').bind(b.member).first();
    if(preference?.status==='dnd')return json({error:'Le correspondant ne souhaite pas être dérangé.'},409);
    const id=crypto.randomUUID();const result=await db.prepare("INSERT INTO chat_calls(id,caller,callee,kind,state,updated,offer) SELECT ?,?,?,?,'ringing',?,? WHERE NOT EXISTS (SELECT 1 FROM chat_calls WHERE (caller=? AND updated>?) OR (state='accepted' AND updated>? AND (caller IN (?,?) OR callee IN (?,?))) OR (state='ringing' AND updated>? AND (caller IN (?,?) OR callee IN (?,?))))").bind(id,user.id,b.member,b.kind,now,b.offer,user.id,now-3000,now-3600000,user.id,b.member,user.id,b.member,now-120000,user.id,b.member,user.id,b.member).run();if(!result.meta.changes)return json({error:'Correspondant occupé ou appel déjà en cours.'},429);return json({id},201);
   }
   if(typeof b.id!=='string')return json({error:'Appel invalide.'},400);
   let result;
   if(b.action==='accept'&&typeof b.answer==='string'&&b.answer.length<=48000)result=await db.prepare("UPDATE chat_calls SET state='accepted',answer=?,updated=? WHERE id=? AND callee=? AND state='ringing' AND updated>?").bind(b.answer,now,b.id,user.id,now-120000).run();
   else if(b.action==='decline')result=await db.prepare("UPDATE chat_calls SET state='declined',updated=? WHERE id=? AND callee=? AND state='ringing'").bind(now,b.id,user.id).run();
   else if(b.action==='end')result=await db.prepare("UPDATE chat_calls SET state='ended',updated=? WHERE id=? AND (caller=? OR callee=?) AND state IN ('ringing','accepted')").bind(now,b.id,user.id,user.id).run();
   else return json({error:'Action invalide.'},400);
   if(!result.meta.changes)return json({error:'Appel inaccessible ou expiré.'},404);return json({ok:true});
  }
  if(path==='members'&&method==='GET'){
   await db.prepare('INSERT INTO chat_presence(user_id,username,seen_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,seen_at=excluded.seen_at').bind(user.id,String(user.username).slice(0,80),Date.now()).run();
   const r=await db.prepare('SELECT p.user_id AS id,p.username,p.seen_at,COALESCE(a.status,'available') AS status, EXISTS(SELECT 1 FROM chat_calls c WHERE c.state='accepted' AND c.updated>? AND (c.caller=p.user_id OR c.callee=p.user_id)) AS in_call FROM chat_presence p LEFT JOIN chat_availability a ON a.user_id=p.user_id WHERE p.user_id<>? ORDER BY p.username LIMIT 200').bind(Date.now()-3600000,user.id).all();return json({members:r.results.map(m=>({id:m.id,username:m.username,online:Date.now()-m.seen_at<45000,status:Date.now()-m.seen_at>=45000?'offline':m.in_call?'in_call':m.status}))});
  }
  if(path==='direct'&&method==='POST'){
   const b=await readBody(request);if(typeof b.member!=='string'||b.member===user.id)return json({error:'Membre invalide.'},400);
   const peer=await db.prepare('SELECT user_id FROM chat_presence WHERE user_id=?').bind(b.member).first();if(!peer)return json({error:'Membre introuvable.'},404);
   const [a,z]=[String(user.id),b.member].sort();const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([a,z])));const room='dm-'+Array.from(new Uint8Array(hash).slice(0,20),x=>x.toString(16).padStart(2,'0')).join('');
   await db.prepare('INSERT OR IGNORE INTO chat_direct(room_id,member_a,member_b) VALUES (?,?,?)').bind(room,a,z).run();
   await db.prepare("INSERT OR IGNORE INTO chat_rooms(id,name,description) VALUES (?,'Privé','Conversation privée')").bind(room).run();return json({room});
  }
  if(path==='rooms'&&method==='GET'){const r=await db.prepare("SELECT r.id,COALESCE(p.username,r.name) AS name,r.description FROM chat_rooms r LEFT JOIN chat_direct d ON d.room_id=r.id LEFT JOIN chat_presence p ON p.user_id=CASE WHEN d.member_a=? THEN d.member_b ELSE d.member_a END WHERE d.room_id IS NULL OR d.member_a=? OR d.member_b=? ORDER BY r.rowid").bind(user.id,user.id,user.id).all();return json({rooms:r.results});}
  if(path==='search'&&method==='GET'){
   const room=url.searchParams.get('room')||'general',q=(url.searchParams.get('q')||'').trim();
   if(q.length<2||q.length>100)return json({error:'Recherche : 2 à 100 caractères.'},400);
   if(!await canRead(room))return json({error:'Salon inaccessible.'},404);
   const r=await db.prepare('SELECT id,username,text,created_at FROM chat_messages WHERE room_id=? AND deleted_at IS NULL AND instr(lower(text),lower(?))>0 ORDER BY created_at DESC,id DESC LIMIT 50').bind(room,q).all();return json({messages:r.results});
  }
  if(path==='messages'&&method==='GET'){
   const room=url.searchParams.get('room')||'general',after=Number(url.searchParams.get('after')||0),afterId=url.searchParams.get('afterId')||'';
   if(!/^[a-z0-9-]{1,48}$/.test(room)||!Number.isSafeInteger(after)||after<0||(afterId&&!/^[a-zA-Z0-9-]{1,64}$/.test(afterId)))return json({error:'Paramètres invalides.'},400);
   if(!await canRead(room))return json({error:'Salon inaccessible.'},404);
   const r=await db.prepare('SELECT id,room_id,text,created_at,username,user_id FROM chat_messages WHERE room_id=? AND (created_at>? OR (created_at=? AND id>?)) AND deleted_at IS NULL ORDER BY created_at,id LIMIT 100').bind(room,after,after,afterId).all();return json({messages:r.results});
  }
  if(path==='messages'&&method==='POST'){
   const b=await readBody(request),room=String(b.room||''),message=String(b.text||'').trim();if(!/^[a-z0-9-]{1,48}$/.test(room)||!message||message.length>2000)return json({error:'Message invalide (maximum 2 000 caractères).'},400);
   if(!await canRead(room))return json({error:'Salon introuvable.'},404);
   const now=Date.now(),id=crypto.randomUUID();const result=await db.prepare('INSERT INTO chat_messages(id,room_id,user_id,username,text,created_at) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM chat_messages WHERE user_id=? AND created_at>?)').bind(id,room,user.id,String(user.username).slice(0,80),message,now,user.id,now-1000).run();
   if(!result.meta.changes)return json({error:'Un message par seconde maximum.'},429);return json({ok:true},201);
  }
  if(path==='moderate'&&method==='POST'){
   if(user.role!=='owner')return json({error:'Réservé au propriétaire.'},403);const b=await readBody(request);if(typeof b.id!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(b.id))return json({error:'Message invalide.'},400);
   const now=Date.now();const r=await db.prepare('UPDATE chat_messages SET deleted_at=?,deleted_by=? WHERE id=? AND deleted_at IS NULL AND room_id NOT IN (SELECT room_id FROM chat_direct)').bind(now,user.id,b.id).run();if(!r.meta.changes)return json({error:'Message introuvable.'},404);return json({ok:true});
  }
  return json({error:'Route introuvable.'},404);
 }catch(e){if(e instanceof SyntaxError)return json({error:'JSON invalide.'},400);if(e.message==='size')return json({error:'Requête trop volumineuse.'},413);if(e.message==='format')return json({error:'Requête invalide.'},400);return json({error:'Service temporairement indisponible.'},503);}
}
