/* AWEN anonymous genre inbox — Cloudflare Worker + D1.
   Public submissions require no GitHub account. Private export requires AWEN_ADMIN_KEY.
   This worker must be deployed by the owner; repo source alone does not create an inbox. */
const GENRES=new Set([
 'Pop','Hip-Hop / Rap','R&B / Soul','Phonk','Funk / Disco','Chill / Lo-Fi / Ambient',
 'House','Techno / Trance','Bass Music / EDM','Drum & Bass / UK Bass',
 'Latin / Brazilian Club','Afro / Global Club','Synth / Retro Electronic',
 'Rock / Indie','Metal / Punk','Jazz / Blues','Folk / Ethno / World',
 'Classical / Cinematic','Country','Electronica / Experimental'
]);
const MAX_BODY=4096;
const field=(v,n)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,n):'';
const validId=id=>/^awen-[1-9]\d{0,6}$/.test(id);
const validSubmissionId=id=>/^[A-Za-z0-9_-]{12,100}$/.test(id);
const hasToken=(request,env)=>{
 const token=env.AWEN_ADMIN_KEY;
 if(typeof token!=='string'||token.length<24)return false;
 const supplied=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
 if(supplied.length!==token.length)return false;
 // Constant-time comparison avoids leaking token prefixes.
 let diff=0;for(let i=0;i<token.length;i++)diff|=token.charCodeAt(i)^supplied.charCodeAt(i);
 return diff===0;
};
const cors=(request,env)=>{
 const origin=request.headers.get('origin'),expected=env.ALLOWED_ORIGIN||'https://vivamusz.github.io';
 return origin===expected?{
  'access-control-allow-origin':expected,
  'access-control-allow-methods':'GET, POST, OPTIONS',
  'access-control-allow-headers':'content-type, authorization',
  'access-control-max-age':'600','vary':'Origin'
 }:{'vary':'Origin'};
};
function respond(request,env,body,status=200,kind='application/json; charset=utf-8',extra={}){
 return new Response(typeof body==='string'?body:JSON.stringify(body),{
  status,headers:{...cors(request,env),'content-type':kind,'cache-control':'no-store','x-content-type-options':'nosniff',...extra}
 });
}
function validate(data){
 if(!data||typeof data!=='object'||Array.isArray(data))return {error:'Формат должен быть объектом JSON'};
 const id=field(data.submission_id,100),track_id=field(data.track_id,100),genre=field(data.genre,100);
 if(!validSubmissionId(id)||!validId(track_id))return {error:'Некорректный ID предложения или трека'};
 if(!GENRES.has(genre))return {error:'Жанр отсутствует в структуре AWEN'};
 const artist=field(data.artist,130),title=field(data.title,130);
 if(!artist||!title)return {error:'Не указаны исполнитель или название'};
 const previous_genre=field(data.previous_genre,120);
 const subgenre=field(data.subgenre,100),note=field(data.note,450);
 if(typeof data.subgenre==='string'&&data.subgenre.length>100)return {error:'Поджанр слишком длинный'};
 if(typeof data.note==='string'&&data.note.length>450)return {error:'Комментарий слишком длинный'};
 if(data.website||data.homepage)return {error:'Недопустимый запрос'};
 return {value:{submission_id:id,track_id,title,artist,previous_genre,genre,subgenre,note}};
}
function formatText(rows){
 const clean=v=>field(v,650).replace(/[\u2028\u2029]/g,' ');
 let lines=['AWEN — предложения музыкальных жанров','Дата выгрузки: '+new Date().toISOString(),'Предложения: '+rows.length,''];
 for(const [index,r] of rows.entries()){
  lines.push('----- ПРЕДЛОЖЕНИЕ '+(index+1)+' -----');
  lines.push('Получено: '+clean(r.submitted_at));
  lines.push('Номер: '+clean(r.submission_id));
  lines.push('AWEN ID: '+clean(r.track_id));
  lines.push('Исполнитель: '+clean(r.artist));
  lines.push('Песня: '+clean(r.title));
  lines.push('Было: '+clean(r.previous_genre));
  lines.push('Предлагают: '+clean(r.proposed_genre));
  lines.push('Поджанр: '+clean(r.proposed_subgenre||'Не указан'));
  lines.push('Комментарий: '+clean(r.note||'Нет'));
  lines.push('Статус: '+clean(r.status));
  lines.push('');
 }
 return lines.join('\r\n');
}
async function handle(request,env){
 const path=new URL(request.url).pathname;
 if(!env.DB)return respond(request,env,{ok:false,error:'Database not configured'},503);
 if(request.method==='OPTIONS'){
  if(request.headers.get('origin')!==env.ALLOWED_ORIGIN)return respond(request,env,{ok:false,error:'Origin not allowed'},403);
  return new Response(null,{status:204,headers:{...cors(request,env),'cache-control':'no-store'}});
 }
 if(path==='/health'&&request.method==='GET')return respond(request,env,{ok:true,service:'awen-genre-inbox',version:1});
 if(path==='/api/genre-suggestions'&&request.method==='POST'){
  // Check Origin to disallow simple cross-site scripted abuse. This is not authentication;
  // server-side abuse/rate limits should additionally be enabled in Cloudflare.
  if(request.headers.get('origin')!==env.ALLOWED_ORIGIN)return respond(request,env,{ok:false,error:'Origin not allowed'},403);
  const length=Number(request.headers.get('content-length')||0);
  if(length>MAX_BODY)return respond(request,env,{ok:false,error:'Request too large'},413);
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))return respond(request,env,{ok:false,error:'JSON required'},415);
  const raw=await request.text();
  if(raw.length>MAX_BODY)return respond(request,env,{ok:false,error:'Request too large'},413);
  let input;
  try{input=JSON.parse(raw);}catch{return respond(request,env,{ok:false,error:'Invalid JSON'},400);}
  const checked=validate(input);
  if(checked.error)return respond(request,env,{ok:false,error:checked.error},400);
  const x=checked.value;
  try{
   await env.DB.prepare('INSERT OR IGNORE INTO genre_suggestions (submission_id, track_id, title, artist, previous_genre, proposed_genre, proposed_subgenre, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(x.submission_id,x.track_id,x.title,x.artist,x.previous_genre,x.genre,x.subgenre,x.note).run();
  }catch(e){
   console.error('AWEN genre queue write failed',String(e));
   return respond(request,env,{ok:false,error:'Server storage temporarily unavailable'},503);
  }
  return respond(request,env,{ok:true,receipt_id:x.submission_id,stored:true},201);
 }
 if(path==='/admin/export.txt'&&request.method==='GET'){
  if(!hasToken(request,env))return respond(request,env,{ok:false,error:'Admin access required'},401);
  const rows=[];
  let offset=0;
  try{
   for(;;){
    const result=await env.DB.prepare('SELECT submission_id,track_id,title,artist,previous_genre,proposed_genre,proposed_subgenre,note,submitted_at,status FROM genre_suggestions ORDER BY submitted_at DESC LIMIT 500 OFFSET ?')
     .bind(offset).all();
    const batch=result.results||[];
    rows.push(...batch);
    if(batch.length<500||rows.length>=10000)break;
    offset+=batch.length;
   }
  }catch(e){console.error('AWEN export read error',String(e));return respond(request,env,{ok:false,error:'Export unavailable'},503);}
  return respond(request,env,formatText(rows),200,'text/plain; charset=utf-8',{
   'content-disposition':'attachment; filename="AWEN_Genre_Suggestions.txt"'
  });
 }
 if(path==='/admin/summary'&&request.method==='GET'){
  if(!hasToken(request,env))return respond(request,env,{ok:false,error:'Admin access required'},401);
  try{
   const row=await env.DB.prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN status=\'pending\' THEN 1 ELSE 0 END) AS pending FROM genre_suggestions').first();
   return respond(request,env,{ok:true,total:row?.total||0,pending:row?.pending||0});
  }catch{return respond(request,env,{ok:false,error:'Summary unavailable'},503);}
 }
 return respond(request,env,{ok:false,error:'Not found'},404);
}
export default {async fetch(request,env){try{return await handle(request,env);}catch(e){
 console.error('AWEN inbox error',String(e));return respond(request,env,{ok:false,error:'Internal server error'},500);
}}};
export {validate,formatText,hasToken};
