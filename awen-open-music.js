/* AWEN Open Music. Isolated Audius/Jamendo integration. Does not modify shared catalog. */
(()=>{
'use strict';
if(window.__awenOpenMusic)return;window.__awenOpenMusic=true;
const AU='https://api.audius.co/v1',JM='https://api.jamendo.com/v3.0/tracks/',KEY='awen-jamendo-client-id-v1';
let service='Audius',query='',items=[],busy=false,nonce=0,msg='Загружаем открытую музыку…',jamId='';
let matches = {}, matchStats = null;
const matchURL = './awen-audius-matches.json';
function applyMatches(){
  if(typeof tracks==='undefined')return;
  for(const t of tracks){
    const m=matches[t.id];
    if(!m || t.audio_url || !/^[a-zA-Z0-9_-]{2,55}$/.test(String(m.audius_id||'')))continue;
    // The full-track stream is an official Audius URL, not an MP3 copied by AWEN.
    t.audio_url='https://api.audius.co/v1/tracks/'+m.audius_id+'/stream?app_name=AWEN';
    t.source_status='available';
  }
}
async function refreshMatches(){
  try{
    const response=await fetch(matchURL,{cache:'no-store'});
    if(!response.ok)return;
    const data=await response.json();
    if(!data||typeof data!=='object'||typeof data.matches!=='object')return;
    matches=data.matches;matchStats=data;applyMatches();
    render();
  }catch(error){console.info('AWEN: Audius match map not published yet',error);}
}
try{jamId=localStorage.getItem(KEY)||''}catch(_){}
const css=document.createElement('style');
css.textContent='.awen-open{background:linear-gradient(120deg,#2c203a,#191421);border:1px solid #604d70;border-radius:15px;padding:17px;margin:16px 0 24px}.awen-open h2{font-size:22px;margin:0 0 6px}.awen-open p{font-size:12px;line-height:1.6;color:#bfb1c8}.awen-ctrl{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}.awen-open button{background:#493359;border:1px solid #805f98;border-radius:10px;padding:9px 13px;color:#fff;cursor:pointer}.awen-open button.on{background:#874eb5}.awen-open input{min-width:140px;flex:1;max-width:400px;padding:10px;color:#fff;background:#191320;border:1px solid #746080;border-radius:9px}.awen-result{display:grid;grid-template-columns:repeat(auto-fill,minmax(225px,1fr));gap:9px}.awen-result button{display:flex;align-items:center;gap:10px;text-align:left;width:100%;background:#241c30;padding:8px}.awen-result button:hover{border-color:#dfb2fc}.awen-result .awen-name{flex:1;min-width:0}.awen-result strong,.awen-result small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.awen-result small{color:#bfaecc}.awen-result img{width:44px;height:44px;border-radius:7px;object-fit:cover}.awen-open .awen-state{font-size:12px;color:#cbb9d6;margin:10px 0}.awen-open details{margin-top:12px;color:#bfaecc;font-size:12px}@media(max-width:600px){.awen-open{padding:12px}.awen-result{grid-template-columns:1fr}}';
document.head.appendChild(css);
const el=(tag,content,cl)=>{const x=document.createElement(tag);if(content!==undefined)x.textContent=content;if(cl)x.className=cl;return x};
const url=s=>{try{const x=new URL(s);return x.protocol==='https:'?x.href:''}catch(_){return ''}};
function normalize(t){
 if(service==='Audius'){
  const id=String(t?.id||'');if(!/^[a-zA-Z0-9_-]{2,55}$/.test(id)||t.is_streamable===false||t.is_stream_gated===true||t.is_unlisted===true||t.access?.stream===false)return null;
  const artist=String(t.user?.name||t.artist||''),title=String(t.title||'');
  if(!artist||!title)return null;
  let page=String(t.permalink||'');if(page.startsWith('/'))page='https://audius.co'+page;page=url(page);
  if(page&&new URL(page).hostname!=='audius.co')page='';
  return {id:'awen-audius-'+id,artist,title,audio:AU+'/tracks/'+id+'/stream?app_name=AWEN',image:url(t.artwork?.['150x150']||''),page,duration:Number(t.duration)||0,genre:String(t.genre||'Electronic'),source:'Audius'};
 }
 const id=String(t?.id||'');if(!/^\d+$/.test(id)||!url(t.audio))return null;
 return {id:'awen-jamendo-'+id,artist:String(t.artist_name||''),title:String(t.name||''),audio:url(t.audio),image:url(t.image||t.album_image||''),page:'https://www.jamendo.com/track/'+id,duration:Number(t.duration)||0,genre:'Indie',source:'Jamendo'};
}
function paint(){
 const app=document.querySelector('#app');if(!app||st.view!=='home')return;
 app.querySelector('#awen-open-music')?.remove();
 const s=el('section',undefined,'awen-open');s.id='awen-open-music';
 s.append(el('h2','🎧 Открытая музыка — нажал ▶ и слушаешь'),
  el('p','Ниже — открытая подборка Audius (первые 20 записей), а НЕ результат проверки твоего Excel. Сопоставление каталога по исполнителю и названию идёт отдельно. Jamendo доступен по client_id.'));
 const bar=el('div',undefined,'awen-ctrl');
 for(const name of ['Audius','Jamendo']){const b=el('button',name,service===name?'on':'');b.dataset.awenSource=name;bar.appendChild(b)}
 const input=el('input');input.type='search';input.id='awen-open-query';input.value=query;input.placeholder='Название или исполнитель';input.maxLength=110;bar.appendChild(input);
 const find=el('button','Найти');find.dataset.awenSearch='1';bar.appendChild(find);s.appendChild(bar);
 s.appendChild(el('p',msg,'awen-state'));
 if(matchStats){
  const scanned=Number(matchStats.scanned)||0,total=Number(matchStats.total)||0,
    exact=Number(matchStats.found)||0,review=Number(matchStats.needs_review)||0;
  const line='Твой каталог: проверено '+scanned+' из '+total+'; точных совпадений Audius: '+exact+
    '; требуют проверки: '+review+(matchStats.complete?'. Проверка завершена.':'. Проверка продолжается.');
  s.appendChild(el('p',line,'awen-state'));
 }else{
  s.appendChild(el('p','Автопроверка твоего каталога Audius запущена. Цифры появятся после первой сохранённой партии.','awen-state'));
 }
 const list=el('div',undefined,'awen-result');
 for(const t of items){
  const b=el('button');b.dataset.awenTrack=t.id;b.title='Слушать '+t.artist+' — '+t.title;
  if(t.image){const art=el('img');art.src=t.image;art.alt='';art.loading='lazy';b.appendChild(art)}else b.appendChild(el('span','♫'));
  const desc=el('span',undefined,'awen-name');desc.append(el('strong',t.title),el('small',t.artist+' · '+t.source));b.append(desc,el('span','▶'));list.appendChild(b);
 }
 s.appendChild(list);
 if(service==='Jamendo'){
  const opts=el('details');opts.open=!jamId;opts.appendChild(el('summary',jamId?'Настройки Jamendo':'Jamendo: нужен client_id'));
  const row=el('div',undefined,'awen-ctrl');const field=el('input');field.id='awen-jam-id';field.value=jamId;field.placeholder='client_id из devportal.jamendo.com';
  const save=el('button','Сохранить ID');save.dataset.awenJamSave='1';row.append(field,save);opts.appendChild(row);
  opts.appendChild(el('p','Создай приложение на devportal.jamendo.com. Тестовый ID из документации не используется на публичном сайте.'));s.appendChild(opts);
 }
 app.prepend(s);
}
async function fetchJSON(path){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),14000);
 try{const r=await fetch(path,{mode:'cors',cache:'no-store',signal:controller.signal});if(!r.ok)throw Error('HTTP '+r.status);return await r.json()}finally{clearTimeout(timeout)}
}
async function load(){
 if(busy)return;busy=true;const token=++nonce;items=[];msg='Ищем доступную музыку…';paint();
 try{
  if(service==='Jamendo'&&!jamId){msg='Чтобы использовать Jamendo, введи свой бесплатный client_id ниже.';return}
  let data;
  if(service==='Audius'){
   const p=new URLSearchParams({app_name:'AWEN',limit:'20'});
   if(query)p.set('query',query);else p.set('time','week');
   data=await fetchJSON(AU+(query?'/tracks/search':'/tracks/trending')+'?'+p);
   items=(Array.isArray(data?.data)?data.data:[]).map(normalize).filter(Boolean);
  }else{
   const p=new URLSearchParams({client_id:jamId,format:'json',limit:'20',audioformat:'mp32'});
   if(query)p.set('search',query);else p.set('order','popularity_week');
   data=await fetchJSON(JM+'?'+p);
   if(data?.headers?.status!=='success')throw Error(data?.headers?.error_message||'Ошибка Jamendo');
   items=(Array.isArray(data?.results)?data.results:[]).map(normalize).filter(x=>x&&x.title&&x.artist);
  }
  msg=items.length?'Найдено '+items.length+' песен. Нажми ▶ — звук пойдёт в стандартном плеере ӘУЕН.':'Подходящих записей не найдено. Попробуй другой запрос.';
 }catch(e){msg='Источник '+service+' недоступен: '+(e.name==='AbortError'?'превышено время ожидания':e.message)+'. Попробуй позже.'}
 finally{if(token===nonce){busy=false;paint()}}
}
function play(id){
 const t=items.find(x=>x.id===id);if(!t)return;
 let rec=tracks.find(x=>x.id===id);
 if(!rec){
  rec=sanitize({id:t.id,artist:t.artist,title:t.title,genre:t.genre,album:t.source,duration:t.duration,audio_url:t.audio,source_url:t.page,source_status:'available'},tracks.length);
  if(!rec){notify('Не удалось добавить запись');return}tracks.push(rec);
 }else{rec.audio_url=t.audio;rec.source_status='available'}
 playTrack(id);
}
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-awen-track],[data-awen-source],[data-awen-search],[data-awen-jam-save]');if(!b)return;
 if(b.dataset.awenTrack){play(b.dataset.awenTrack);return}
 if(b.dataset.awenSource){service=b.dataset.awenSource;query='';items=[];busy=false;nonce++;load();return}
 if(b.dataset.awenSearch){query=(document.querySelector('#awen-open-query')?.value||'').trim();load();return}
 if(b.dataset.awenJamSave){const v=(document.querySelector('#awen-jam-id')?.value||'').trim();if(!/^[\w-]{3,120}$/.test(v)){msg='Неверный client_id';paint();return}jamId=v;try{localStorage.setItem(KEY,v)}catch(_){}load()}
});
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target?.id==='awen-open-query'){e.preventDefault();query=e.target.value.trim();load()}});
const oldRender=render;
render=function(){applyMatches();oldRender();paint()};
paint();load();refreshMatches();
})();