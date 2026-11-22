/* AWEN Community Genre Suggestions v2.
   User: no GitHub account. Shared moderation: configured Cloudflare inbox only.
   Until configured, saved suggestions remain private and can be downloaded as TXT. */
(function(root){'use strict';
const KEY='awen-genre-suggestions-v1';
const clean=(s,n=100)=>String(s||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,n);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const empty=()=>({schema_version:1,items:{}});
let data=empty(),activeId=null,focusReturn=null,feedback='',sending=false,inbox={api_base_url:''};
try{const raw=localStorage.getItem(KEY);if(raw){const obj=JSON.parse(raw);if(obj?.schema_version===1&&obj.items&&typeof obj.items==='object')data=obj;}}
catch(error){console.warn('AWEN: genre suggestions not available locally',error);}
const bridge=()=>root.AWENBridge||{};
const getTrack=id=>typeof bridge().getTracks==='function'?bridge().getTracks().find(t=>t.id===id):null;
const taxonomy=()=>typeof bridge().getGenreTaxonomy==='function'?bridge().getGenreTaxonomy():[];
const getSuggestion=id=>Object.prototype.hasOwnProperty.call(data.items,id)?data.items[id]:null;
const classification=t=>({genre:t.genre,subgenres:Array.isArray(t.subgenres)?t.subgenres.slice():[],genre_source:t.genre_source,curation_review_needed:t.curation_review_needed});
const valid=x=>Boolean(x&&taxonomy().some(g=>g.name===x.genre&&(!x.subgenre||g.styles.includes(x.subgenre))));
function restore(t){
 if(!t?.awen_local_original)return;
 const p=t.awen_local_original;
 t.genre=p.genre;t.subgenres=p.subgenres.slice();t.genre_source=p.genre_source;
 t.curation_review_needed=p.curation_review_needed;
 delete t.awen_local_original;delete t.awen_user_genre;
}
function apply(rows){
 if(!Array.isArray(rows))return rows;
 for(const t of rows){
  restore(t);
  const rec=getSuggestion(t.id);
  if(!rec||!valid(rec)||t.import_review_needed)continue;
  t.awen_local_original=classification(t);
  t.genre=rec.genre;t.subgenres=rec.subgenre?[rec.subgenre]:[];
  t.genre_source='Выбрано вами — только на этом устройстве';
  t.curation_review_needed=true;t.awen_user_genre=true;
 }
 return rows;
}
function persist(next){
 try{localStorage.setItem(KEY,JSON.stringify(next));data=next;return true;}
 catch(error){console.warn('AWEN genre local store error',error);bridge().notify?.('Не удалось сохранить предложение');return false;}
}
function makeId(){return 'awen-'+(root.crypto?.randomUUID?.()||String(Date.now())+'-'+Math.random().toString(36).slice(2,13));}
function save(id,genre,subgenre,note=''){
 const t=getTrack(id),choice={genre:clean(genre),subgenre:clean(subgenre)};
 if(!t||t.import_review_needed||!/^awen-[1-9]\d*$/.test(id)||!valid(choice)){bridge().notify?.('Выберите основной жанр и подходящий поджанр');return false;}
 const existing=getSuggestion(id),original=t.awen_local_original||classification(t),comment=clean(note,450);
 const same=existing&&existing.genre===choice.genre&&existing.subgenre===choice.subgenre&&(existing.note||'')===comment;
 const rec={id,title:clean(t.title,130),artist:clean(t.artist,130),
  genre:choice.genre,subgenre:choice.subgenre,previous_genre:original.genre,
  note:comment,submission_id:same&&existing.submission_id?existing.submission_id:makeId(),
  delivery_status:same&&existing.delivery_status?existing.delivery_status:'local',
  sent_at:same&&existing.sent_at?existing.sent_at:null,updated_at:new Date().toISOString()};
 if(!persist({schema_version:1,items:{...data.items,[id]:rec}}))return false;
 apply(bridge().getTracks());bridge().refresh?.();return true;
}
function reset(id){
 if(!getSuggestion(id))return false;
 const next={schema_version:1,items:{...data.items}};delete next.items[id];
 if(!persist(next))return false;
 apply(bridge().getTracks());bridge().refresh?.();bridge().notify?.('Исходный жанр восстановлен');return true;
}
const suggestionText=id=>{
 const p=getSuggestion(id);if(!p)return '';
 return [
  'AWEN — предложение музыкального жанра',
  'AWEN ID: '+p.id,'Песня: '+p.title,'Исполнитель: '+p.artist,
  'Раньше: '+p.previous_genre,'Предлагаемый жанр: '+p.genre,
  'Поджанр: '+(p.subgenre||'Не указан'),
  'Комментарий: '+(p.note||'Нет'),'Номер: '+(p.submission_id||'не присвоен'),
  'Дата: '+p.updated_at,
  'Доставка: '+(p.delivery_status==='sent'?'Принято общей очередью':'Только на устройстве'),
  'Жанр требует проверки редактором.'].join('\n');
};
function downloadTxt(id){
 const body=suggestionText(id);if(!body)return false;
 try{
  const url=URL.createObjectURL(new Blob(['\ufeff'+body+'\n'],{type:'text/plain;charset=utf-8'}));
  const link=document.createElement('a');
  link.href=url;link.download='AWEN_Genre_'+id+'.txt';
  document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  bridge().notify?.('TXT сохранён на устройстве. Это не отправка редактору.');
  return true;
 }catch(e){console.warn('AWEN TXT download error',e);bridge().notify?.('Не удалось скачать TXT');return false;}
}
const endpoint=()=>typeof inbox.api_base_url==='string'?inbox.api_base_url.replace(/\/+$/,''):'';
async function configure(){
 try{
  const r=await fetch('./awen-genre-inbox-config.json?rev=20261123-inbox-v1',{cache:'no-store'});
  if(!r.ok)return;
  const conf=await r.json(),raw=String(conf?.api_base_url||'').trim();
  if(!raw)return;
  const url=new URL(raw);
  if(conf.schema_version===1&&url.protocol==='https:'&&!url.username&&!url.password){
   inbox.api_base_url=url.origin+url.pathname.replace(/\/+$/,'');
   if(activeId&&!document.getElementById('awg-genre')?.matches(':focus'))renderModal();
  }
 }catch(e){console.info('AWEN inbox not configured',String(e));}
}
async function send(id){
 const p=getSuggestion(id),url=endpoint();
 if(!p)return false;
 if(!url){feedback='Общая очередь ещё не подключена. Предложение осталось на устройстве. Можно скачать TXT.';if(activeId===id)renderModal();return false;}
 if(sending)return false;
 sending=true;feedback='Отправляем предложение…';if(activeId===id)renderModal();
 try{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  let response;
  try{
   response=await fetch(url+'/api/genre-suggestions',{
    method:'POST',mode:'cors',credentials:'omit',cache:'no-store',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
     submission_id:p.submission_id,track_id:p.id,title:p.title,artist:p.artist,
     previous_genre:p.previous_genre,genre:p.genre,subgenre:p.subgenre,note:p.note||'',website:''
    }),signal:controller.signal
   });
  }finally{clearTimeout(timer);}
  const result=await response.json();
  if(!response.ok||result.ok!==true||result.stored!==true||result.receipt_id!==p.submission_id)
   throw Error(result.error||'Сервер не подтвердил запись');
  const current=getSuggestion(id);
  if(current?.submission_id===p.submission_id){
   persist({schema_version:1,items:{...data.items,[id]:{...current,delivery_status:'sent',sent_at:new Date().toISOString()}}});
  }
  feedback='Отправлено! Предложение записано в общую очередь AWEN и ожидает проверки редактора.';
  bridge().notify?.('Предложение получено AWEN');return true;
 }catch(error){
  console.warn('AWEN inbox submit failed',error);
  feedback='Сервер не подтвердил отправку. Предложение сохранилось на устройстве; повторите попытку или скачайте TXT.';
  return false;
 }finally{sending=false;if(activeId===id)renderModal();}
}
function close(){
 const overlay=document.getElementById('awg-overlay');
 if(overlay){overlay.hidden=true;overlay.innerHTML='';}
 const prev=focusReturn;activeId=null;focusReturn=null;
 if(prev?.isConnected)prev.focus();
}
function stylesHTML(genre,selected=''){
 const genres=taxonomy().find(g=>g.name===genre)?.styles||[];
 return '<option value="">Поджанр не указан / не уверен</option>'+
  genres.map(x=>'<option value="'+esc(x)+'"'+(x===selected?' selected':'')+'>'+esc(x)+'</option>').join('');
}
function renderModal(){
 const overlay=document.getElementById('awg-overlay'),t=getTrack(activeId);
 if(!overlay||!t)return;
 const old=getSuggestion(t.id),base=t.awen_local_original?.genre||t.genre;
 const genre=old?.genre||(taxonomy().some(x=>x.name===base)?base:''),
  subgenre=old?.subgenre||(genre===t.genre?t.subgenres?.[0]||'':'');
 const enabled=Boolean(endpoint());
 overlay.hidden=false;
 overlay.innerHTML=
 '<div class="awg-backdrop" data-awg-action="close"></div>'+
 '<section class="awg-dialog" role="dialog" aria-modal="true" aria-labelledby="awg-title" tabindex="-1">'+
 '<div class="awg-heading"><div><h2 id="awg-title">Предложить жанр</h2><p>'+esc(t.title)+' — '+esc(t.artist)+'</p></div>'+
 '<button class="awg-close" type="button" data-awg-action="close" aria-label="Закрыть">×</button></div>'+
 '<p class="awg-hint">Выберите жанр и поджанр. Личная правка останется на устройстве. Отправленную заявку редактор проверит перед публикацией для всех.</p>'+
 '<form id="awg-form"><label for="awg-genre">Основной жанр</label>'+
 '<select id="awg-genre" required><option value="">Выберите жанр…</option>'+
 taxonomy().map(g=>'<option value="'+esc(g.name)+'"'+(g.name===genre?' selected':'')+'>'+esc(g.name)+'</option>').join('')+'</select>'+
 '<label for="awg-style">Поджанр (по желанию)</label><select id="awg-style">'+stylesHTML(genre,subgenre)+'</select>'+
 '<label for="awg-note">Почему подходит этот жанр? (необязательно)</label>'+
 '<textarea id="awg-note" maxlength="450" rows="2" placeholder="Например, звучание похоже на Deep House">'+esc(old?.note||'')+'</textarea>'+
 '<div class="awg-actions"><button type="submit" name="mode" value="local" class="awg-btn">Сохранить у меня</button>'+
 (old?'<button type="button" class="awg-btn" data-awg-action="undo">Отменить мою правку</button>':'')+'</div></form>'+
 '<div class="awg-review"><strong>Предложение для AWEN</strong><p>'+
 (enabled?'Для отправки не нужны GitHub или регистрация. Ваше предложение попадёт в закрытую очередь редактора.':
 'Приёмник ещё не подключён владельцем AWEN. Можно сохранить своё предложение и скачать TXT, но общая доставка пока не работает.')+
 '</p><div class="awg-actions"><button type="submit" form="awg-form" name="mode" value="send" class="awg-btn primary"'+(!enabled||sending?' disabled':'')+'>'+
 (sending?'Отправляем…':'Отправить на проверку')+'</button>'+
 '<button type="button" class="awg-btn" data-awg-action="download"'+(old?'':' disabled')+'>Скачать TXT</button>'+
 '<button type="button" class="awg-btn" data-awg-action="copy"'+(old?'':' disabled')+'>Скопировать</button></div>'+
 (old?.delivery_status==='sent'?'<p class="awg-receipt">✓ Предложение получено общей очередью AWEN.</p>':'')+
 '</div>'+(feedback?'<p class="awg-feedback" role="status">'+esc(feedback)+'</p>':'')+
 '</section>';
 overlay.querySelector('.awg-dialog')?.focus();
}
function open(id,node){
 const t=getTrack(id);
 if(!t||t.import_review_needed){bridge().notify?.('Для этой записи нельзя предложить жанр');return;}
 activeId=id;focusReturn=node||null;feedback='';renderModal();
}
function onClick(e){
 const node=e.target.closest('[data-awg-action]');if(!node)return;
 e.preventDefault();e.stopPropagation();
 const action=node.dataset.awgAction;
 if(action==='open')return open(node.dataset.trackId,node);
 if(action==='close')return close();
 if(action==='undo'){const id=activeId;close();return reset(id);}
 if(action==='download')return downloadTxt(activeId);
 if(action==='copy'){
  const text=suggestionText(activeId);if(!text)return;
  if(navigator.clipboard?.writeText)navigator.clipboard.writeText(text)
   .then(()=>bridge().notify?.('Предложение скопировано'))
   .catch(()=>root.prompt('Скопируйте предложение:',text));
  else root.prompt('Скопируйте предложение:',text);
 }
}
function onChange(e){
 if(e.target.id==='awg-genre'){const el=document.getElementById('awg-style');if(el)el.innerHTML=stylesHTML(e.target.value);}
}
function onSubmit(e){
 if(e.target.id!=='awg-form')return;
 e.preventDefault();
 const id=activeId,genre=document.getElementById('awg-genre')?.value||'',
  sub=document.getElementById('awg-style')?.value||'',
  note=document.getElementById('awg-note')?.value||'',
  mode=e.submitter?.value||'local';
 if(save(id,genre,sub,note)){
  if(mode==='send'){send(id);return;}
  feedback='Жанр сохранён на устройстве. Когда общая очередь подключена, можно отправить предложение редактору.';
  renderModal();
 }
}
document.addEventListener('click',onClick);
document.addEventListener('change',onChange);
document.addEventListener('submit',onSubmit);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&activeId)close();});
root.AWENGenreContributions={
 version:'2.0.0',open,close,save,reset,apply,send,downloadTxt,getSuggestion,suggestionText,
 valid,getCount:()=>Object.keys(data.items).length,inboxConfigured:()=>Boolean(endpoint())
};
configure();
})(window);
