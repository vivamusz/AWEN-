/* AWEN My Playlists v1: private device library with verified local writes and JSON backup. */
(function(root){
'use strict';
const KEY='awen-user-playlists-v1',MAX_LISTS=100,MAX_TRACKS=500,MAX_BACKUP=1250000;
const validTrackId=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;',"'":'&#39;'}[c]));
const uniq=a=>[...new Set(a)];
const cleanName=s=>String(s||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,70);
const now=()=>new Date().toISOString();
const empty=()=>({schema_version:1,kind:'AWEN_MY_PLAYLISTS',lists:[]});
function sanitize(src){
 if(!src||src.schema_version!==1||!Array.isArray(src.lists))throw Error('Неподдерживаемый формат плейлистов');
 if(src.lists.length>MAX_LISTS)throw Error('Максимум 100 плейлистов');
 const out=empty(),keys=new Set();
 for(const p of src.lists){
  if(!p||typeof p!=='object'||typeof p.id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(p.id)||keys.has(p.id))throw Error('Некорректный ID плейлиста');
  const name=cleanName(p.name);if(!name)throw Error('Название плейлиста не может быть пустым');
  if(!Array.isArray(p.track_ids)||p.track_ids.length>MAX_TRACKS)throw Error('Максимум 500 треков в одном плейлисте');
  const ids=p.track_ids;
  if(!ids.every(validTrackId))throw Error('Некорректный ID композиции');
  keys.add(p.id);
  out.lists.push({
   id:p.id,name,track_ids:uniq(ids),
   created_at:typeof p.created_at==='string'?p.created_at.slice(0,30):now(),
   updated_at:typeof p.updated_at==='string'?p.updated_at.slice(0,30):now()
  });
 }
 return out;
}
let state=empty(),activeId=null,pickerTrack=null,pendingShare=null,notice='',returnFocus=null,creating=false;
try{const raw=localStorage.getItem(KEY);if(raw)state=sanitize(JSON.parse(raw));}
catch(error){console.warn('AWEN: локальные плейлисты повреждены или недоступны',error);notice='Не удалось прочитать сохранённые плейлисты; старые данные не перезаписаны.';}
const bridge=()=>root.AWENBridge||{},tracks=()=>typeof bridge().getTracks==='function'?bridge().getTracks():[],byId=id=>tracks().find(t=>t.id===id);
function notify(s){if(typeof bridge().notify==='function')bridge().notify(s);}
function refresh(){if(bridge().getView&&bridge().getView()==='myplaylists'&&bridge().refresh)bridge().refresh();}
function persist(next){
 try{localStorage.setItem(KEY,JSON.stringify(next));state=next;return true;}
 catch(e){console.warn('AWEN: не удалось сохранить плейлисты',e);notify('Не удалось сохранить на устройстве. Проверьте память и настройки браузера.');return false;}
}
function transact(fn){
 let copy=JSON.parse(JSON.stringify(state));
 try{fn(copy);copy=sanitize(copy);}catch(e){notify(e.message||'Ошибка плейлиста');return false;}
 if(!persist(copy))return false;refresh();return true;
}
function newId(){
 const random=root.crypto&&typeof root.crypto.randomUUID==='function'?root.crypto.randomUUID():(Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12));
 return 'pl-'+random;
}
function create(name,ids=[]){
 const n=cleanName(name);
 if(!n){notify('Введите название плейлиста');return null;}
 if(state.lists.length>=MAX_LISTS){notify('Достигнут лимит: 100 плейлистов');return null;}
 if(!Array.isArray(ids)||ids.length>MAX_TRACKS||!ids.every(validTrackId)){notify('Некорректный список композиций');return null;}
 const id=newId(),stamp=now(),item={id,name:n,track_ids:uniq(ids),created_at:stamp,updated_at:stamp};
 const worked=transact(s=>{s.lists.unshift(item);});
 return worked?id:null;
}
function add(listId,trackId){
 if(!validTrackId(trackId)||!byId(trackId)){notify('Композиция не найдена в текущем каталоге');return false;}
 let already=false,full=false;
 const worked=transact(s=>{
  let p=s.lists.find(x=>x.id===listId);if(!p)throw Error('Плейлист не найден');
  if(p.track_ids.includes(trackId)){already=true;return;}
  if(p.track_ids.length>=MAX_TRACKS){full=true;throw Error('В плейлисте уже 500 композиций');}
  p.track_ids.push(trackId);p.updated_at=now();
 });
 if(worked)notify(already?'Уже находится в плейлисте':'Добавлено в «'+state.lists.find(x=>x.id===listId).name+'»');
 return worked&&!full;
}
function remove(listId,trackId){
 return transact(s=>{const p=s.lists.find(x=>x.id===listId);if(!p)throw Error('Плейлист не найден');p.track_ids=p.track_ids.filter(x=>x!==trackId);p.updated_at=now();});
}
function move(listId,trackId,dir){
 return transact(s=>{const p=s.lists.find(x=>x.id===listId);if(!p)throw Error('Плейлист не найден');const i=p.track_ids.indexOf(trackId),j=i+dir;if(i<0||j<0||j>=p.track_ids.length)return;[p.track_ids[i],p.track_ids[j]]=[p.track_ids[j],p.track_ids[i]];p.updated_at=now();});
}
function rename(listId,name){
 let n=cleanName(name);if(!n){notify('Введите название');return false;}
 return transact(s=>{const p=s.lists.find(x=>x.id===listId);if(!p)throw Error('Плейлист не найден');p.name=n;p.updated_at=now();});
}
function deletePlaylist(id){const p=state.lists.find(x=>x.id===id);if(!p)return false;
 if(!root.confirm('Удалить плейлист «'+p.name+'»? Композиции из общего каталога не удалятся.'))return false;
 const done=transact(s=>{s.lists=s.lists.filter(x=>x.id!==id);});
 if(done&&activeId===id){activeId=null;refresh();}
 return done;
}
const btn=(action,label,props='',extra='')=>'<button type="button" class="mpl-btn '+extra+'" data-mypl-action="'+action+'" '+props+'>'+esc(label)+'</button>';
function renderLibrary(){
 const list=state.lists.find(x=>x.id===activeId),received=pendingShare,known=new Map(tracks().map(t=>[t.id,t]));
 const banner=received?'<div class="mpl-import-banner"><h2>Получена подборка: '+esc(received.name)+'</h2><p>'+received.ids.length+' треков. Вы можете сохранить копию на своём устройстве; исходный плейлист другого человека не изменится.</p><div class="mpl-actions">'+btn('save-shared','Сохранить в «Мои плейлисты»','','primary')+btn('dismiss-shared','Не сохранять')+'</div></div>':'';
 const controls='<div class="mpl-actions">'+btn('create-open','＋ Новый плейлист','','primary')+btn('backup-export','Скачать резервную копию JSON')+btn('backup-import','Восстановить из JSON')+'</div>'+
 (creating?'<form class="mpl-create-form" id="mpl-create-form"><label for="mpl-create-name">Название нового плейлиста</label>'+
 '<div class="mpl-create-fields"><input id="mpl-create-name" name="name" maxlength="70" required placeholder="Например, Вечерняя дорога" autocomplete="off">'+
 '<button class="mpl-btn primary" type="submit">Создать</button>'+btn('create-cancel','Отмена')+'</div></form>':'');
 let body='';
 if(!list){
  const cards=state.lists.map(p=>{
   const missing=p.track_ids.filter(id=>!known.has(id)).length;
   return '<button class="mpl-card" type="button" data-mypl-action="open" data-list-id="'+esc(p.id)+'">'+
    '<span class="mpl-card-cover" aria-hidden="true">♫</span><strong>'+esc(p.name)+'</strong>'+
    '<small>'+p.track_ids.length+' треков'+(missing?' · '+missing+' нет в каталоге':'')+'</small>'+
    '</button>';
  }).join('');
  body=state.lists.length?'<div class="mpl-grid">'+cards+'</div>':'<div class="mpl-empty"><strong>Ваших плейлистов пока нет</strong><p>Создайте первый список и добавляйте понравившиеся песни кнопкой ＋ в каталоге, карточках и рекомендациях.</p>'+btn('create-open','Создать первый плейлист','','primary')+'</div>';
 }else{
  const rows=list.track_ids.map((id,i)=>{
   const t=known.get(id),missing=!t;
   const detail=t?'<button type="button" class="mpl-song-link" data-mypl-action="details" data-track-id="'+esc(id)+'"><strong>'+esc(t.title)+'</strong><small>'+esc(t.artist)+' · '+esc(t.genre)+'</small></button>':'<div class="mpl-song-link"><strong>Трек недоступен в этом каталоге</strong><small>'+esc(id)+' · ID сохранён в плейлисте</small></div>';
   return '<div class="mpl-song"><span class="mpl-number">'+(i+1)+'.</span>'+detail+
   '<div class="mpl-song-controls">'+btn('up','↑','data-track-id="'+esc(id)+'" '+(i===0?'disabled':''),'compact')+
   btn('down','↓','data-track-id="'+esc(id)+'" '+(i===list.track_ids.length-1?'disabled':''),'compact')+
   btn('remove','×','data-track-id="'+esc(id)+'" aria-label="Удалить из плейлиста"','compact')+'</div></div>';
  }).join('');
  body='<div class="mpl-open-head"><div><button class="mpl-back" data-mypl-action="back" type="button">← Все мои плейлисты</button>'+
   '<h2>'+esc(list.name)+'</h2><p>'+list.track_ids.length+' композиций. Порядок меняется стрелками ↑↓.</p></div></div>'+
   '<div class="mpl-actions">'+btn('rename','Переименовать')+btn('share','Поделиться ссылкой')+btn('delete','Удалить','', 'danger')+'</div>'+
   '<div class="mpl-song-list">'+(rows||'<div class="mpl-empty">Пока пусто. Используйте кнопку ＋ у песен в каталоге.</div>')+'</div>';
 }
 return '<div class="mpl-wrap"><div class="mpl-hero"><h1>Мои плейлисты</h1><p>Личные подборки из каталога AWEN. Сохраняйте композиции, меняйте порядок, создавайте тематические списки и делитесь ими.</p></div>'+
 banner+controls+(notice?'<p class="mpl-notice">'+esc(notice)+'</p>':'')+body+
 '<div class="mpl-privacy"><strong>Ваши данные остаются на этом устройстве.</strong> Без аккаунта списки не синхронизируются между телефонами и могут пропасть после очистки браузера. Регулярно скачивайте резервную копию JSON. Передача по ссылке отправляет только имя и максимум 50 AWEN ID — без истории и лайков.</div></div>';
}
function closePicker(){
 const m=document.getElementById('mpl-picker-overlay');if(m){m.hidden=true;m.innerHTML='';}
 pickerTrack=null;
 if(returnFocus&&typeof returnFocus.focus==='function')returnFocus.focus();
 returnFocus=null;
}
function redrawPicker(){
 const el=document.getElementById('mpl-picker-overlay');if(!el||!pickerTrack)return;
 const t=byId(pickerTrack),rows=state.lists.map(p=>{
  const already=p.track_ids.includes(pickerTrack);
  return '<button type="button" class="mpl-pick-row" data-mypl-action="pick-list" data-list-id="'+esc(p.id)+'" '+(already?'disabled':'')+'><span>'+esc(p.name)+' <small>'+p.track_ids.length+' треков</small></span><span>'+(already?'✓ Добавлено':'＋ Добавить')+'</span></button>';
 }).join('');
 el.hidden=false;
 el.innerHTML='<div class="mpl-pick-backdrop" data-mypl-action="close-picker"></div><section class="mpl-picker" role="dialog" aria-modal="true" aria-labelledby="mpl-dialog-title">'+
 '<div class="mpl-picker-head"><h2 id="mpl-dialog-title">Добавить в плейлист</h2>'+btn('close-picker','✕','aria-label="Закрыть"','compact')+'</div>'+
 '<p class="mpl-picker-title">'+esc(t?t.title:'Композиция')+'</p>'+
 (rows?'<div class="mpl-picker-list">'+rows+'</div>':'<p class="mpl-hint">Плейлистов пока нет — создайте первый.</p>')+
 '<form id="mpl-picker-create"><label for="mpl-picker-name">Новый плейлист</label><div class="mpl-picker-form"><input id="mpl-picker-name" name="name" required maxlength="70" autocomplete="off" placeholder="Например, Любимые песни">'+
 '<button class="mpl-btn primary" type="submit">Создать и добавить</button></div></form></section>';
}
function openPicker(trackId,focusNode){
 if(!validTrackId(trackId)||!byId(trackId)){notify('Композиция не найдена');return;}
 pickerTrack=trackId;returnFocus=focusNode||null;
 redrawPicker();
 document.getElementById('mpl-picker-name')?.focus();
}
function createFromMix(name,ids){
 const valid=uniq((Array.isArray(ids)?ids:[]).filter(validTrackId)).slice(0,MAX_TRACKS);
 const id=create(name,valid);
 if(id){activeId=id;if(bridge().openMyPlaylists)bridge().openMyPlaylists();return id;}return null;
}
function sharePlaylist(id){
 const p=state.lists.find(x=>x.id===id),core=root.AWENDiscoveryCore;if(!p||!core){notify('Ссылка недоступна');return;}
 const shareable=p.track_ids.filter(x=>/^awen-\d+$/.test(x));
 if(!shareable.length){notify('Для ссылки нужны треки с ID AWEN');return;}
 if(p.track_ids.length>50){notify('В ссылке максимум 50 песен. Для полного списка скачайте резервную копию JSON.');return;}
 if(shareable.length!==p.track_ids.length){notify('В плейлисте есть локальные ID без AWEN — экспортируйте полный список в JSON.');return;}
 let url=new URL(root.location.href);
 url.searchParams.delete('awen_mix');url.searchParams.set('awen_pl',core.encodeMix(p.name,shareable));
 const value=url.toString();
 try{if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(value).then(()=>notify('Ссылка на плейлист скопирована')).catch(()=>root.prompt('Скопируйте ссылку:',value));}else root.prompt('Скопируйте ссылку:',value);}
 catch{root.prompt('Скопируйте ссылку:',value);}
}
function downloadJSON(name,content){
 const a=document.createElement('a'),url=URL.createObjectURL(new Blob([content],{type:'application/json;charset=utf-8'}));
 a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportBackup(){
 downloadJSON('AWEN_My_Playlists_Backup.json',JSON.stringify({...state,exported_at:now()},null,2));
 notify('Резервная копия создана');
}
async function importBackup(file){
 if(!file||file.size>MAX_BACKUP){notify('Файл отсутствует или превышает 1,25 МБ');return;}
 let backup;try{backup=sanitize(JSON.parse(await file.text()));}catch(e){notify('Некорректная резервная копия: '+e.message);return;}
 if(!root.confirm('Импортировать '+backup.lists.length+' плейлистов и объединить с текущими? Существующие списки сохранятся.'))return;
 const count=backup.lists.length,done=transact(s=>{
  if(s.lists.length+backup.lists.length>MAX_LISTS)throw Error('Не хватает места: максимум 100 плейлистов');
  const keys=new Set(s.lists.map(x=>x.id));
  for(const x of backup.lists){
   const fresh={...x,track_ids:x.track_ids.slice()};
   if(keys.has(fresh.id))fresh.id=newId();
   keys.add(fresh.id);s.lists.push(fresh);
  }
 });
 if(done)notify('Импортировано '+count+' плейлистов. Ранее сохранённые списки сохранены.');
}
function handleAction(btnNode){
 const action=btnNode.dataset.myplAction,id=btnNode.dataset.listId||activeId,track=btnNode.dataset.trackId;
 if(action==='add'){openPicker(track,btnNode);return;}
 if(action==='pick-list'){if(pickerTrack&&add(id,pickerTrack)){closePicker();refresh();}return;}
 if(action==='close-picker'){closePicker();return;}
 if(action==='create-open'){creating=true;refresh();document.getElementById('mpl-create-name')?.focus();return;}
 if(action==='create-cancel'){creating=false;refresh();return;}
 if(action==='open'){activeId=id;refresh();return;}
 if(action==='back'){activeId=null;refresh();return;}
 if(action==='details'){bridge().openDetails&&bridge().openDetails(track);return;}
 if(action==='remove'){remove(id,track);return;}
 if(action==='up'||action==='down'){move(id,track,action==='up'?-1:1);return;}
 if(action==='rename'){const list=state.lists.find(x=>x.id===id);if(!list)return;const name=root.prompt('Новое название:',list.name);if(name!==null)rename(id,name);return;}
 if(action==='delete'){deletePlaylist(id);return;}
 if(action==='share'){sharePlaylist(id);return;}
 if(action==='backup-export'){exportBackup();return;}
 if(action==='backup-import'){document.getElementById('mpl-backup-import')?.click();return;}
 if(action==='save-shared'){if(pendingShare){const imported=createFromMix(pendingShare.name,pendingShare.ids);if(imported){pendingShare=null;notice='Подборка сохранена в вашем личном списке.';refresh();}}return;}
 if(action==='dismiss-shared'){pendingShare=null;refresh();return;}
}
function init(){
 const picker=document.getElementById('mpl-picker-overlay');if(picker)picker.hidden=true;
 document.addEventListener('click',event=>{
  const node=event.target.closest('[data-mypl-action]');
  if(!node)return;
  event.preventDefault();
  // Keep existing AWEN song-detail click handlers from opening on a save control.
  event.stopPropagation();
  handleAction(node);
 });
 document.addEventListener('submit',e=>{
  if(e.target.id==='mpl-create-form'){
    e.preventDefault();const name=e.target.querySelector('[name="name"]')?.value,fresh=create(name);
    if(fresh){creating=false;activeId=fresh;refresh();notify('Личный плейлист создан');}
    return;
  }
  if(e.target.id!=='mpl-picker-create')return;
  e.preventDefault();const name=e.target.querySelector('[name="name"]')?.value,trackId=pickerTrack;
  const fresh=create(name,trackId?[trackId]:[]);
  if(fresh){closePicker();notify('Новый плейлист создан, композиция добавлена');}
 });
 document.addEventListener('change',e=>{
  if(e.target.id==='mpl-backup-import'){
   const file=e.target.files&&e.target.files[0];
   if(file)importBackup(file).catch(err=>notify('Ошибка импорта: '+err.message));
   e.target.value='';
  }
 });
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&pickerTrack)closePicker();});
 try{
  const url=new URL(root.location.href),token=url.searchParams.get('awen_pl'),core=root.AWENDiscoveryCore;
  if(token&&core&&typeof core.decodeMix==='function'){
   const shared=core.decodeMix(token);
   if(shared){pendingShare=shared;notice='Откройте «Мои плейлисты», чтобы сохранить подборку, полученную по ссылке.';}
   else notice='Ссылка на плейлист повреждена или имеет неизвестный формат.';
   if(bridge().openMyPlaylists)bridge().openMyPlaylists();
  }
 }catch(e){console.warn('AWEN: не удалось открыть ссылку на плейлист',e);}
}
root.AWENMyPlaylists={
 version:'1.0.0',render:renderLibrary,init,openPicker,create,add,remove,move,rename,deletePlaylist,
 createFromMix,exportBackup,importBackup,getLists:()=>JSON.parse(JSON.stringify(state.lists)),
 decodeBackup:sanitize,openList:id=>{activeId=id;if(bridge().openMyPlaylists)bridge().openMyPlaylists();}
};
init();
})(window);
