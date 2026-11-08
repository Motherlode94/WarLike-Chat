const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const COOKIE='__Host-warlike_chat',TOKEN=/^[A-Za-z0-9_-]{43}$/,SERVER='https://warlike-server.pages.dev';
const readCookie=req=>{const parts=(req.headers.get('cookie')||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(COOKIE+'='));if(parts.length!==1)return null;const token=parts[0].slice(COOKIE.length+1);return TOKEN.test(token)?token:null};
const setCookie=(token,age)=>`${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
async function readBody(req){if(req.headers.get('content-type')?.split(';')[0]!=='application/json')throw new Error('format');if(Number(req.headers.get('content-length')||0)>8192)throw new Error('size');const reader=req.body?.getReader();if(!reader)throw new Error('format');const chunks=[];let size=0;for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();throw new Error('size')}chunks.push(value)}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}return JSON.parse(new TextDecoder().decode(bytes));}
async function server(req,env,path,{method='GET',token,body}={}){if(!env.WARLIKE_SERVER)throw new Error('server');const headers={origin:SERVER};const ip=req.headers.get('cf-connecting-ip');if(ip)headers['cf-connecting-ip']=ip;if(token)headers.cookie='__Host-warlike_session='+token;if(body)headers['content-type']='application/json';return env.WARLIKE_SERVER.fetch(new Request(SERVER+path,{method,headers,body,redirect:'manual'}));}
async function current(req,env){const token=readCookie(req);if(!token)return null;const r=await server(req,env,'/api/warlike-auth/session',{token});if(!r.ok)return null;const x=await r.json();return x.user&&!x.mustChange?{id:x.user.id,username:x.user.name,role:x.user.role}:null;}
export async function onRequest({request,env}){
 const db=env.CHAT_DB;if(!db||!env.WARLIKE_SERVER)return json({error:'Service Chat en cours de configuration.'},503);
 const url=new URL(request.url),path=url.pathname.replace(/^\/api\/?/,'').replace(/\/$/,''),method=request.method;
 if(!['GET','POST'].includes(method))return json({error:'Méthode refusée.'},405);
 if(method==='POST'&&(url.protocol!=='https:'||request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site'))return json({error:'Origine refusée.'},403);
 try{
  if(path==='validation'&&method==='GET'){const x=await server(request,env,'/api/warlike-auth/login',{method:'POST',body:JSON.stringify({login:'test-chat-inexistant',password:'faux-mot-de-passe-test'})});return json({status:x.status,expected:x.status===401})}
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
  if(path==='rooms'&&method==='GET'){const r=await db.prepare('SELECT id,name,description FROM chat_rooms ORDER BY rowid').all();return json({rooms:r.results});}
  if(path==='messages'&&method==='GET'){
   const room=url.searchParams.get('room')||'general',after=Number(url.searchParams.get('after')||0),afterId=url.searchParams.get('afterId')||'';
   if(!/^[a-z0-9-]{1,48}$/.test(room)||!Number.isSafeInteger(after)||after<0||(afterId&&!/^[a-zA-Z0-9-]{1,64}$/.test(afterId)))return json({error:'Paramètres invalides.'},400);
   const r=await db.prepare('SELECT id,room_id,text,created_at,username FROM chat_messages WHERE room_id=? AND (created_at>? OR (created_at=? AND id>?)) AND deleted_at IS NULL ORDER BY created_at,id LIMIT 100').bind(room,after,after,afterId).all();return json({messages:r.results});
  }
  if(path==='messages'&&method==='POST'){
   const b=await readBody(request),room=String(b.room||''),message=String(b.text||'').trim();if(!/^[a-z0-9-]{1,48}$/.test(room)||!message||message.length>2000)return json({error:'Message invalide (maximum 2 000 caractères).'},400);
   if(!await db.prepare('SELECT id FROM chat_rooms WHERE id=?').bind(room).first())return json({error:'Salon introuvable.'},404);
   const now=Date.now(),id=crypto.randomUUID();const result=await db.prepare('INSERT INTO chat_messages(id,room_id,user_id,username,text,created_at) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM chat_messages WHERE user_id=? AND created_at>?)').bind(id,room,user.id,String(user.username).slice(0,80),message,now,user.id,now-1000).run();
   if(!result.meta.changes)return json({error:'Un message par seconde maximum.'},429);return json({ok:true},201);
  }
  if(path==='moderate'&&method==='POST'){
   if(user.role!=='owner')return json({error:'Réservé au propriétaire.'},403);const b=await readBody(request);if(typeof b.id!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(b.id))return json({error:'Message invalide.'},400);
   const now=Date.now();const r=await db.prepare('UPDATE chat_messages SET deleted_at=?,deleted_by=? WHERE id=? AND deleted_at IS NULL').bind(now,user.id,b.id).run();if(!r.meta.changes)return json({error:'Message introuvable.'},404);return json({ok:true});
  }
  return json({error:'Route introuvable.'},404);
 }catch(e){if(e instanceof SyntaxError)return json({error:'JSON invalide.'},400);if(e.message==='size')return json({error:'Requête trop volumineuse.'},413);if(e.message==='format')return json({error:'Requête invalide.'},400);return json({error:'Service temporairement indisponible.'},503);}
}
