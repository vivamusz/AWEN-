/* AWEN Community Genre Suggestions v1.
   Local corrections are private. Global changes need editorial review. */
(function(root){'use strict';
const KEY='awen-genre-suggestions-v1';
const clean=s=>String(s||'').trim().slice(0,100);
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(id);
const empty=()=>({schema_version:1,items:{}});
let data=empty(),activeId=null,focusReturn=null,feedback='';
try{const raw=localStorage.getItem(KEY);if(raw){const parsed=JSON.parse(raw);if(parsed&&parsed.schema_version===1&&parsed.items&&typeof parsed.items==='object')data=parsed;}}catch(error){console.warn('AWEN genre suggestions: local storage unavailable',error);}
const bridge=()=>root.AWENBridge||{};
const getTrack=id=>typeof bridge().getTracks==='function'?bridge().getTracks().find(t=>t.id===id):null;
const taxa=()=>typeof bridge().getGenreTaxonomy==='function'?bridge().getGenreTaxonomy():[];
const classification=t=>({genre:t.genre,subgenres:Array.isArray(t.subgenres)?t.subgenres.slice():[],genre_source:t.genre_source,curation_review_needed:t.curation_review_needed});
function validated(item){
 const main=taxa().find(g=>g.name===item.genre);
 return Boolean(main&&(!item.subgenre||main.styles.includes(item.subgenre)));
}
function restore(t){
 if(t&&t.awen_local_original){
  const old=t.awen_local_original;
  t.genre=old.genre;t.subgenres=old.subgenres.slice();t.genre_source=old.genre_source;
  t.curation_review_needed=old.curation_review_needed;
  delete t.awen_local_original;delete t.awen_user_genre;
 }
}
function apply(tracks){
 if(!Array.isArray(tracks))return tracks;
 for(const t of tracks){restore(t);
  const rec=data.items[t.id];
  if(!rec||!validated(rec)||t.import_review_needed)continue;
  t.awen_local_original=classification(t);
  t.genre=rec.genre;
  t.subgenres=rec.subgenre?[rec.subgenre]:[];
  t.genre_source='Выбрано вами — только на этом устройстве';
  t.curation_review_needed=true;
  t.awen_user_genre=true;
 }
 return tracks;
}
function persist(next){
 try{localStorage.setItem(KEY,JSON.stringify(next));data=next;return true;}
 catch(e){bridge().notify?.('Не удалось сохранить жанр на устройстве');return false;}
}
function save(id,genre,subgenre){
 const t=getTrack(id),choice={genre:clean(genre),subgenre:clean(subgenre)};
 if(!t||t.import_review_needed||!validated(choice)){bridge().notify?.('Выберите основной жанр и подходящий поджанр');return false;}
 const original=t.awen_local_original||classification(t);
 const record={id,title:clean(t.title).slice(0,100),artist:clean(t.artist).slice(0,100),
   genre:choice.genre,subgenre:choice.subgenre,previous_genre:original.genre,
   updated_at:new Date().toISOString()};
 const next={schema_version:1,items:{...data.items,[id]:record}};
 if(!persist(next))return false;
 apply(bridge().getTracks());
 bridge().refresh?.();
 bridge().notify?.('Жанр сохранён на устройстве. Для всех слушателей — отправьте предложение редактору.');
 return true;
}
function reset(id){
 if(!data.items[id])return false;
 const next={schema_version:1,items:{...data.items}};
 delete next.items[id];
 if(!persist(next))return false;
 apply(bridge().getTracks());bridge().refresh?.();
 bridge().notify?.('Исходная классификация восстановлена');
 return true;
}
const getSuggestion=id=>data.items[id]||null;
const suggestionText=id=>{
 const p=getSuggestion(id);if(!p)return '';
 return ['Предложение исправления жанра AWEN','Трек: '+p.artist+' — '+p.title,
  'AWEN ID: '+p.id,'Жанр на сайте: '+p.previous_genre,
  'Предложенный жанр: '+p.genre,
  'Предложенный поджанр: '+(p.subgenre||'Не указан'),
  'Статус: предложение пользователя; требует проверки редактором и подтверждения по источникам',
  'Сайт: https://vivamusz.github.io/AWEN-/'].join('\n');
};
const issueURL=id=>{
 const p=getSuggestion(id);if(!p)return '';
 const params=new URLSearchParams({
  title:'[Предложение жанра] '+p.id+' — '+p.title.slice(0,50),
  body:suggestionText(id)
 });
 return 'https://github.com/vivamusz/AWEN-/issues/new?'+params.toString();
};
function close(){
 const overlay=document.getElementById('awg-overlay');
 if(overlay){overlay.hidden=true;overlay.innerHTML='';}
 const previous=focusReturn;focusReturn=null;activeId=null;
 if(previous?.isConnected)previous.focus();
}
function styleOptions(genre,selected=''){
 const main=taxa().find(x=>x.name===genre);
 const styles=main?.styles||[];
 return '<option value="">Поджанр не указан / не уверен</option>'+styles.map(style=>
 '<option value="'+escapeHTML(style)+'"'+(style===selected?' selected':'')+'>'+escapeHTML(style)+'</option>').join('');
}
function renderModal(){
 const overlay=document.getElementById('awg-overlay'),t=getTrack(activeId);
 if(!overlay||!t)return;
 const saved=getSuggestion(t.id);
 const candidate=saved?.genre||((taxa().some(g=>g.name===(t.awen_local_original?.genre||t.genre)))?(t.awen_local_original?.genre||t.genre):'');
 const sub=saved?.subgenre||((candidate===t.genre&&Array.isArray(t.subgenres))?t.subgenres[0]:'')||'';
 const all=taxa();
 overlay.hidden=false;
 overlay.innerHTML='<div class="awg-backdrop" data-awg-action="close"></div>'+
 '<section class="awg-dialog" role="dialog" aria-modal="true" aria-labelledby="awg-title" tabindex="-1">'+
 '<div class="awg-heading"><div><h2 id="awg-title">Предложить жанр</h2><p>'+escapeHTML(t.title)+' — '+escapeHTML(t.artist)+'</p></div><button class="awg-close" type="button" data-awg-action="close" aria-label="Закрыть">×</button></div>'+
 '<p class="awg-hint">Выбор сразу изменит жанр этой песни <strong>только на вашем устройстве</strong>. Для всего AWEN предложение должен проверить редактор.</p>'+
 '<form id="awg-form"><label for="awg-genre">Основной жанр</label>'+
 '<select id="awg-genre" name="genre" required><option value="">Выберите жанр…</option>'+all.map(g=>
 '<option value="'+escapeHTML(g.name)+'"'+(g.name===candidate?' selected':'')+'>'+escapeHTML(g.name)+'</option>').join('')+'</select>'+
 '<label for="awg-style">Поджанр (по желанию)</label><select id="awg-style" name="subgenre">'+styleOptions(candidate,sub)+'</select>'+
 '<div class="awg-actions"><button type="submit" class="awg-btn primary">Сохранить у меня</button>'+
 (saved?'<button type="button" class="awg-btn" data-awg-action="undo">Отменить мою правку</button>':'')+'</div></form>'+
 '<div class="awg-review"><strong>Хотите помочь всему AWEN?</strong><p>Сначала сохраните предложение, затем отправьте его редактору через GitHub. Для отправки потребуется аккаунт GitHub; изменение не публикуется автоматически.</p>'+
 '<div class="awg-actions"><button type="button" class="awg-btn" data-awg-action="submit"'+(saved?'':' disabled')+'>Отправить на проверку ↗</button>'+
 '<button type="button" class="awg-btn" data-awg-action="copy"'+(saved?'':' disabled')+'>Скопировать предложение</button></div></div>'+
 (feedback?'<p class="awg-feedback" role="status">'+escapeHTML(feedback)+'</p>':'')+
 '</section>';
 overlay.querySelector('.awg-dialog')?.focus();
}
function open(id,node){
 const t=getTrack(id);if(!t||t.import_review_needed){bridge().notify?.('Для этой записи предложение жанра пока недоступно');return;}
 activeId=id;focusReturn=node||null;feedback='';renderModal();
}
function handleClick(event){
 const node=event.target.closest('[data-awg-action]');if(!node)return;
 event.preventDefault();event.stopPropagation();
 const action=node.dataset.awgAction;
 if(action==='open'){open(node.dataset.trackId,node);return;}
 if(action==='close'){close();return;}
 if(action==='undo'){const id=activeId;close();reset(id);return;}
 if(action==='submit'){
  const url=issueURL(activeId);
  if(!url)return;
  // Open only in a direct user gesture. GitHub requires sign-in; it is not an auto-submit.
  root.open(url,'_blank','noopener,noreferrer');
  feedback='Открыта форма GitHub. Отправьте её там для проверки редактором.';
  renderModal();
  return;
 }
 if(action==='copy'){
  const text=suggestionText(activeId);
  if(!text)return;
  if(navigator.clipboard?.writeText){
   navigator.clipboard.writeText(text).then(()=>bridge().notify?.('Предложение скопировано'))
    .catch(()=>root.prompt('Скопируйте предложение:',text));
  }else root.prompt('Скопируйте предложение:',text);
 }
}
function handleChange(e){
 if(e.target.id!=='awg-genre')return;
 const styles=document.getElementById('awg-style');
 if(styles)styles.innerHTML=styleOptions(e.target.value);
}
function handleSubmit(e){
 if(e.target.id!=='awg-form')return;
 e.preventDefault();
 const id=activeId,genre=document.getElementById('awg-genre')?.value||'',sub=document.getElementById('awg-style')?.value||'';
 if(save(id,genre,sub)){feedback='Жанр сохранён локально. Можно отправить предложение на проверку.';renderModal();}
}
document.addEventListener('click',handleClick);
document.addEventListener('change',handleChange);
document.addEventListener('submit',handleSubmit);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&activeId)close();});
root.AWENGenreContributions={version:'1.0.0',open,close,save,reset,apply,issueURL,getSuggestion,suggestionText,valid:validated,getCount:()=>Object.keys(data.items).length};
})(window);

