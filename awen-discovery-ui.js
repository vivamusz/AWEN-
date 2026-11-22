/* AWEN Discovery UI v1 — offline-first features; no account or streaming access implied. */
(function(root){'use strict';
const Core=root.AWENDiscoveryCore,KEY='awen-discovery-local-v1';
if(!Core){console.warn('AWEN Discovery: core module missing');return;}
const read=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}')||{};}catch{return {};}};
const defaults=()=>({boostGenres:[],boostLanguages:[],excludeGenres:[],excludedArtists:[],dislikes:[],seen:[],plays:[],opens:[],novelty:60,hideVerifiedAI:false,draft:{name:'Мой AWEN микс',ids:[]},prompt:'25 спокойных песен для вечерней дороги без рэпа, 2010-х'});
let state=Object.assign(defaults(),read()),tab='start',radioId='',smooth=false,radioQuery='',mixQuery='',selectedYear=new Date().getFullYear(),provenance={tracks:{}},importMessage='';
if(!state.draft||typeof state.draft!=='object')state.draft={name:'Мой AWEN микс',ids:[]};
const arr=x=>Array.isArray(x)?x:[],esc=x=>String(x===null||x===undefined?'':x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const bridge=()=>root.AWENBridge||{},tracks=()=>arr(bridge().getTracks&&bridge().getTracks()),likes=()=>arr(bridge().getFavorites&&bridge().getFavorites());
const ctx=()=>({tracks:tracks(),likes:likes(),state,provenance});
function save(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch{notify('Место для сохранения локальных настроек закончилось');}}
function refresh(){if(bridge().refresh)bridge().refresh();}
function notify(text){if(bridge().notify)bridge().notify(text);}
function button(action,title,extra='',cls='ad-btn'){return '<button type="button" class="'+cls+'" data-ad-action="'+esc(action)+'" '+extra+'>'+esc(title)+'</button>';}
function htmlList(items,{limit=25}={}){
 let list=arr(items).slice(0,limit);
 if(!list.length)return '<div class="ad-empty">Пока нет подходящих записей. Попробуйте изменить жанры или исключения.</div>';
 if(smooth)list=Core.smartOrder(list);
 return '<div class="ad-card-list">'+list.map((it,i)=>{
  let t=it.track||it,reason=arr(it.reasons).join(' · '),favorite=likes().includes(t.id),blocked=arr(state.dislikes).includes(t.id);
  return '<div class="ad-song"><button type="button" class="ad-song-main" data-ad-action="detail" data-id="'+esc(t.id)+'" title="'+esc(reason)+'"><strong>'+(i+1)+'. '+esc(t.title)+'</strong><small>'+esc(t.artist)+' · '+esc(t.genre)+(t.curation_review_needed?' · предварительный жанр':'')+'</small></button><div class="ad-song-acts">'+
   '<button type="button" class="ad-mini" data-ad-action="radio" data-id="'+esc(t.id)+'" title="Радио по композиции" aria-label="Радио по композиции">♫</button>'+
   '<button type="button" class="ad-mini" data-ad-action="like" data-id="'+esc(t.id)+'" aria-pressed="'+favorite+'" title="Избранное">'+(favorite?'♥':'♡')+'</button>'+
   '<button type="button" class="ad-mini" data-ad-action="dislike" data-id="'+esc(t.id)+'" aria-pressed="'+blocked+'" title="Не рекомендовать" aria-label="Не рекомендовать">×</button>'+
   '<button type="button" class="ad-mini" data-ad-action="mix-add" data-id="'+esc(t.id)+'" title="В мой микс" aria-label="Добавить в микс">＋</button></div></div>';
 }).join('')+'</div>';
}
function listTitle(name,subtitle,items,count=25){
 const measured=arr(items).filter(x=>Core.bpm(x.track||x)!==null).length;
 return '<div class="ad-section"><h2>'+esc(name)+'</h2><p>'+esc(subtitle)+'</p>'+
 '<div class="ad-actions">'+button('smooth',smooth?'Обычный порядок':'Плавный порядок', 'aria-pressed="'+smooth+'"','ad-btn ghost')+
 '<span class="ad-note">BPM измерен у '+measured+' из '+arr(items).length+'; при отсутствии данных используется редакторская энергия и жанр.</span></div>'+htmlList(items,{limit:count})+'</div>';
}
const section=(title,body,desc='')=>'<div class="ad-section"><h2>'+esc(title)+'</h2>'+(desc?'<p>'+esc(desc)+'</p>':'')+body+'</div>';
function startPanel(){
 let current=ctx(),period=Core.daylist(current,new Date()),ten=Core.discovery(current,new Date());
 return '<div class="ad-grid">'+
  listTitle('1. '+period.title,'Музыка по местному времени браузера; обновляется при открытии раздела.',period.items,12)+
  listTitle('6. '+ten.title,'Не показываем понравившееся, ранее открытое или прослушанное на этом устройстве.',ten.items,10)+
  '</div>'+section('Все 12 инструментов AWEN',
   '<div class="ad-actions">'+button('tab-radio','Радио по треку')+button('tab-taste','Мой вкус')+button('tab-prompt','Подборка по тексту')+button('tab-mix','Общие миксы')+button('tab-stats','Моя статистика')+'</div>'+
   '<div class="ad-note">Рекомендации основаны на доступных жанрах и метаданных. Пока не все песни имеют разрешённое воспроизведение.</div>');
}
function radioSearch(){let q=Core.norm(radioQuery);if(!q)return '';let m=tracks().filter(t=>Core.norm(t.title+' '+t.artist).includes(q)).slice(0,12);
 return m.map(t=>'<div class="ad-song"><button type="button" class="ad-song-main" data-ad-action="radio" data-id="'+esc(t.id)+'"><strong>'+esc(t.title)+'</strong><small>'+esc(t.artist)+'</small></button></div>').join('')||'<div class="ad-empty">Совпадений нет</div>';
}
function radioPanel(){
 let song=tracks().find(t=>t.id===radioId),favorites=likes().map(id=>tracks().find(t=>t.id===id)).filter(Boolean).slice(0,6);
 let body='<div class="ad-section"><h2>2. Радио по выбранной композиции</h2><p>Алгоритм сравнивает жанр, поджанры, настроение и редакторскую энергию. Это список рекомендаций, а не непрерывная трансляция.</p>'+
  '<label class="ad-label" for="ad-radio-search">Название или исполнитель</label><input class="ad-input" id="ad-radio-search" type="search" maxlength="100" placeholder="Начните вводить название" value="'+esc(radioQuery)+'">'+
  '<div class="ad-search-list" id="ad-radio-found">'+radioSearch()+'</div>'+
  (favorites.length?'<p>Из избранного:</p><div class="ad-actions">'+favorites.map(t=>button('radio',t.title,'data-id="'+esc(t.id)+'"')).join('')+'</div>':'')+'</div>';
 if(song){const results=Core.radio(ctx(),song.id);body+=listTitle('Похожее на '+song.title,'Начальная композиция: '+song.artist+'.',results.items,25);}
 else body+=section('Выберите песню','<div class="ad-empty">Найдите любую композицию через поиск выше или нажмите ♫ возле песни в каталоге.</div>');
 return '<div class="ad-panel">'+body+'</div>';
}
const allGenres=['Pop','Hip-Hop / Rap','R&B / Soul','Phonk','Funk / Disco','Chill / Lo-Fi / Ambient','House','Techno / Trance','Bass Music / EDM','Drum & Bass / UK Bass','Latin / Brazilian Club','Afro / Global Club','Synth / Retro Electronic','Rock / Indie','Metal / Punk','Jazz / Blues','Folk / Ethno / World','Classical / Cinematic','Country','Electronica / Experimental'];
function chips(prop,action){
 return '<div class="ad-chip-list">'+allGenres.map(g=>'<button class="ad-chip" data-ad-action="'+action+'" data-genre="'+esc(g)+'" aria-pressed="'+arr(state[prop]).includes(g)+'">'+esc(g)+'</button>').join('')+'</div>';
}
function tastePanel(){
 let confirmed=tracks().filter(t=>Core.verifiedAI(t.id,provenance)).length;
 return '<div class="ad-panel"><div class="ad-grid">'+
 section('3. Настройка жанров — Flow Tuner',
 '<label class="ad-label">Любимые жанры (получают повышенный приоритет)</label>'+chips('boostGenres','boost')+
 '<label class="ad-label">Исключить жанры из рекомендаций</label>'+chips('excludeGenres','exclude')+
 '<label class="ad-label">Предпочитаемые языки (приоритет, не исключение)</label><div class="ad-chip-list">'+['Қазақша','Русский','English','Без слов'].map(l=>'<button class="ad-chip" data-ad-action="lang-boost" data-language="'+esc(l)+'" aria-pressed="'+arr(state.boostLanguages).includes(l)+'">'+esc(l)+'</button>').join('')+'</div>'+'<div class="ad-actions">'+button('reset-tuner','Сбросить жанровые настройки')+'</div>')+
 section('5. Реакции и 9. Разнообразие',
 '<p>♥ сохраняет в существующее избранное AWEN. × скрывает песню только из рекомендаций. Эти действия не удаляют её из каталога.</p>'+
 '<div class="ad-stats"><div class="ad-stat"><strong>'+likes().length+'</strong><small>Избранных</small></div><div class="ad-stat"><strong>'+arr(state.dislikes).length+'</strong><small>Не рекомендовать</small></div><div class="ad-stat"><strong>'+arr(state.boostGenres).length+'</strong><small>Любимых жанров</small></div></div>'+
 '<label class="ad-label" for="ad-novelty">Знакомое по вашим лайкам ← → Новое относительно них: <span id="ad-novelty-value">'+esc(state.novelty)+'</span>%</label>'+
 '<input class="ad-range" id="ad-novelty" data-ad-control="novelty" type="range" min="0" max="100" step="5" value="'+esc(state.novelty)+'"><p class="ad-note">Это не рейтинг популярности: AWEN не располагает достоверными счётчиками прослушиваний для всего каталога.</p>'+
 button('reset-dislikes','Очистить «Не рекомендовать»','', 'ad-btn ghost'))+'</div>'+
 section('12. Прозрачность AI-музыки',
 '<label class="ad-label"><input type="checkbox" data-ad-control="hideAI" '+(state.hideVerifiedAI?'checked':'')+'> Скрывать подтверждённую полностью ИИ-сгенерированную музыку</label>'+
 '<p>Подтверждено по источникам: <strong>'+confirmed+'</strong>. Неизвестный статус ≠ ИИ. Нельзя автоматически определять происхождение по одному жанру или звучанию.</p>')+
 section('Приватность',
 '<p>Настройки, история и миксы сохраняются в браузере этого устройства. Без регистрации они не синхронизируются.</p>'+button('clear-history','Очистить историю и настройки рекомендаций','', 'ad-btn ghost')+
 '<p class="ad-note">Избранное основного каталога AWEN при этой очистке остаётся нетронутым.</p>')+'</div>';
}
function promptPanel(){
 let q=String(state.prompt||''),result=promptResult(q);
 return '<div class="ad-panel">'+section('4. Подборка по текстовому запросу',
 '<label class="ad-label" for="ad-prompt">Опишите музыку обычными словами</label><textarea class="ad-input ad-textarea" id="ad-prompt" maxlength="400">'+esc(q)+'</textarea>'+
 '<div class="ad-actions">'+button('generate-prompt','Подобрать песни','','ad-btn primary')+button('prompt-example','Пример запроса')+'</div>'+
 '<p class="ad-note">Первая версия использует распознавание жанров, годов, языков и настроений по правилам — без внешней языковой модели. Непонятные формулировки могут быть проигнорированы.</p>')+
 (result?section('Распознано','<div>'+result.parsed.terms.map(t=>'<span class="ad-pill">'+esc(t)+'</span>').join('')+'</div><p class="ad-note">Запрошено '+result.parsed.count+' композиций. Найдено '+result.items.length+'. Неизвестные параметры не учитываются.</p>')+
 listTitle('Результаты запроса','Список из каталога AWEN, а не генерация новой музыки.',result.items,50):'')+
 '</div>';
}
let lastPromptText=null;
function promptResult(q){if(q!==lastPromptText)return null;return Core.prompted(ctx(),q);}
function mixSearchHTML(){let q=Core.norm(mixQuery);if(!q)return '<div class="ad-note">Поиск позволяет добавлять песни только по действительным ID каталога.</div>';let matched=tracks().filter(t=>Core.norm(t.title+' '+t.artist).includes(q)).slice(0,15);return matched.length?matched.map(t=>'<div class="ad-song"><div><strong>'+esc(t.title)+'</strong><small style="display:block;color:#aba7ba">'+esc(t.artist)+'</small></div>'+
 '<button class="ad-mini" data-ad-action="mix-add" data-id="'+esc(t.id)+'" title="Добавить">＋</button></div>').join(''):'<div class="ad-empty">Не найдено</div>';}
function mixPanel(){
 let draft=state.draft,ids=arr(draft.ids),by=new Map(tracks().map(t=>[t.id,t])),body=ids.map(id=>{let t=by.get(id);return '<div class="ad-song"><div><strong>'+esc(t?t.title:id)+'</strong><small style="display:block;color:#aba7ba">'+esc(t?t.artist:'В этой версии каталога не найден')+'</small></div><button class="ad-mini" data-ad-action="mix-remove" data-id="'+esc(id)+'" title="Удалить">×</button></div>';}).join('');
 return '<div class="ad-panel"><div class="ad-grid">'+
 section('10. Совместный микс (обмен версиями)',
 '<label class="ad-label" for="ad-mix-name">Название</label><input id="ad-mix-name" class="ad-input" maxlength="60" value="'+esc(draft.name||'Мой AWEN микс')+'">'+
 '<label class="ad-label" for="ad-mix-search">Добавить композицию</label><input id="ad-mix-search" class="ad-input" type="search" maxlength="100" placeholder="Название, исполнитель" value="'+esc(mixQuery)+'">'+
 '<div id="ad-mix-found" class="ad-search-list">'+mixSearchHTML()+'</div>'+
 '<div class="ad-actions">'+button('mix-share','Скопировать ссылку на микс','','ad-btn primary')+button('mix-clear','Очистить микс')+'</div>'+
 '<div class="ad-warning">Совместная работа здесь означает передачу версии по ссылке: получатель может добавить песни и отправить новую ссылку. Это НЕ одновременное редактирование и не облачная синхронизация.</div>')+
 section('8. Умный порядок',
 '<p>Перестановка по доступным измеренным BPM; если их нет, по редакторской энергии и близости жанров. Автоматического сведения и кроссфейда нет.</p>'+
 button('mix-sort','Упорядочить микс')+'<p class="ad-note">BPM доступен лишь для композиций с измеренными аудиоданными.</p>')+
 '</div>'+section('Состав микса: '+ids.length+' из 50',body||'<div class="ad-empty">Пока пусто. Используйте поиск, кнопку ＋ у рекомендаций или импорт ссылки.</div>')+
 (importMessage?'<p class="ad-share-status">'+esc(importMessage)+'</p>':'')+'</div>';
}
function statsPanel(){
 let st=Core.stats(ctx(),selectedYear),y=new Date().getFullYear(),years=[y,y-1,y-2,y-3];
 const genres=st.topGenres.map(([g,n])=>'<span class="ad-pill">'+esc(g)+': '+n+'</span>').join('');
 const artists=st.topArtists.map(([g,n])=>'<span class="ad-pill">'+esc(g)+': '+n+'</span>').join('');
 return '<div class="ad-panel">'+section('7. Моя музыкальная статистика',
 '<label class="ad-label" for="ad-stats-year">Период</label><select class="ad-select" id="ad-stats-year">'+years.map(v=>'<option value="'+v+'" '+(v===selectedYear?'selected':'')+'>'+v+'</option>').join('')+'</select>'+
 '<div class="ad-stats"><div class="ad-stat"><strong>'+st.plays+'</strong><small>Подтверждённых прослушиваний</small></div><div class="ad-stat"><strong>'+st.unique+'</strong><small>Разных прослушанных песен</small></div><div class="ad-stat"><strong>'+st.opens+'</strong><small>Открытий карточек</small></div></div>'+
 '<p class="ad-note">Прослушивание засчитывается только после реального воспроизведения примерно 30 секунд (для коротких песен — меньший порог). Открытия карточек считаются отдельно. Данные с других устройств отсутствуют.</p>')+
 '<div class="ad-grid">'+section('Любимые жанры',genres||'<div class="ad-empty">Нет прослушиваний с подключённым аудио</div>')+section('Любимые исполнители',artists||'<div class="ad-empty">Нет прослушиваний с подключённым аудио</div>')+'</div>'+
 section('11. Мой музыкальный год — '+selectedYear,
 '<div class="ad-recap"><h2>AWEN · '+selectedYear+'</h2><div class="ad-value">'+st.plays+' прослушиваний</div><p>'+st.unique+' разных композиций · '+st.favorites+' песен в текущем избранном</p>'+
 '<p>Любимый жанр: '+esc(st.topGenres.length?st.topGenres[0][0]:'Пока нет данных')+'</p></div>'+
 '<div class="ad-actions">'+button('share-recap','Поделиться итогами','','ad-btn primary')+button('download-recap','Скачать карточку PNG 9:16')+'</div>'+
 '<p class="ad-note">Статистика строится из действий на этом устройстве; это не Spotify Wrapped и не импортированная история сервисов.</p>')+'</div>';
}
function render(){
 const names=[['start','Главная'],['radio','Радио'],['taste','Мой вкус'],['prompt','По тексту'],['mix','Общие миксы'],['stats','Статистика']];
 const tabs='<div class="ad-tabs" role="tablist" aria-label="Музыкальные открытия">'+names.map(([k,v])=>'<button class="ad-tab" role="tab" aria-selected="'+(tab===k)+'" data-ad-action="tab" data-tab="'+k+'">'+v+'</button>').join('')+'</div>';
 const content=tab==='start'?startPanel():tab==='radio'?radioPanel():tab==='taste'?tastePanel():tab==='prompt'?promptPanel():tab==='mix'?mixPanel():statsPanel();
 return '<div class="ad-wrap"><div class="ad-hero"><h1>AWEN · Музыкальные открытия</h1><p>Радио по песне, музыка под настроение, новые открытия, настройка рекомендаций и совместные миксы. Всё на основе каталога AWEN.</p></div>'+tabs+content+
 '<div class="ad-privacy">Личные реакции, рекомендации и статистика сохраняются только на устройстве. Поддержка воспроизведения зависит от разрешённых аудиоисточников. Без истории нельзя достоверно показать любимые композиции за год.</div></div>';
}
function toggle(key,value){let items=arr(state[key]),i=items.indexOf(value);if(i===-1)items.push(value);else items.splice(i,1);state[key]=items;save();refresh();}
function openRadio(id){radioId=id;radioQuery='';tab='radio';if(bridge().openDiscover)bridge().openDiscover();else refresh();}
function markOpened(id){if(!id||!tracks().some(t=>t.id===id))return;state.seen=[...new Set([...arr(state.seen),id])].slice(-1800);state.opens=[...arr(state.opens),{id,at:new Date().toISOString()}].slice(-2500);save();}
let playback={id:null,last:null,seconds:0,counted:false};
function beginPlayback(id){playback={id,last:null,seconds:0,counted:false};}
function observePlayback(id,position,duration,paused){
 if(!id||paused||!Number.isFinite(position)||!Number.isFinite(duration)||duration<=0||/^demo-|^soundcheck$/.test(id))return;
 if(playback.id!==id)beginPlayback(id);
 if(playback.last!==null){let delta=position-playback.last;if(delta>0&&delta<=4)playback.seconds+=delta;}
 playback.last=position;
 let threshold=Math.min(30,Math.max(8,duration*.5));
 if(!playback.counted&&playback.seconds>=threshold){playback.counted=true;state.plays=[...arr(state.plays),{id,at:new Date().toISOString(),seconds:Math.round(playback.seconds)}].slice(-2500);state.seen=[...new Set([...arr(state.seen),id])].slice(-1800);save();}
}
async function copyText(value){
 try{if(navigator.clipboard&&navigator.clipboard.writeText){await navigator.clipboard.writeText(value);notify('Скопировано');return;}}catch{}
 root.prompt('Скопируйте текст:',value);
}
function mixLink(){let url=new URL(root.location.href);url.searchParams.set('awen_mix',Core.encodeMix(state.draft.name,state.draft.ids));return url.toString();}
function downloadRecap(){
 const stats=Core.stats(ctx(),selectedYear);
 const canvas=document.createElement('canvas');
 canvas.width=1080;canvas.height=1920;
 const g=canvas.getContext('2d');
 if(!g){notify('Браузер не поддерживает экспорт изображения');return;}
 const bg=g.createLinearGradient(0,0,1080,1920);
 bg.addColorStop(0,'#191b35');bg.addColorStop(.50,'#492969');bg.addColorStop(1,'#101d35');
 g.fillStyle=bg;g.fillRect(0,0,1080,1920);
 g.fillStyle='rgba(186,135,248,.11)';
 for(let i=0;i<10;i++){g.beginPath();g.arc(850,200+i*175,150+(i%3)*40,0,Math.PI*2);g.fill();}
 g.lineWidth=2;g.strokeStyle='rgba(223,194,255,.26)';
 for(let j=0;j<12;j++){g.beginPath();g.moveTo(-100,1160+j*51);g.bezierCurveTo(310,920+j*20,770,1400-j*20,1220,1000+j*75);g.stroke();}
 const label=(v,x,y,size=32,color='#ffffff',weight='600')=>{g.fillStyle=color;g.font=weight+' '+size+'px Inter,Arial,sans-serif';g.fillText(String(v||''),x,y);};
 const clip=(v,max=31)=>{v=String(v||'');return v.length>max?v.slice(0,max-1)+'…':v;};
 label('AWEN',80,146,66,'#ffffff','800');
 label('MUSIC · МОЯ СТАТИСТИКА',80,192,29,'#d5c2f6','600');
 label(String(stats.year),74,410,174,'#d6aeff','800');
 label('МОЙ МУЗЫКАЛЬНЫЙ ГОД',82,482,40,'#ffffff','700');
 g.fillStyle='rgba(255,255,255,.10)';g.fillRect(75,555,930,300);
 label('ПОДТВЕРЖДЁННЫХ ПРОСЛУШИВАНИЙ',110,626,28,'#e1d3f7','650');
 label(String(stats.plays),106,769,132,'#ffffff','800');
 g.fillStyle='rgba(255,255,255,.10)';g.fillRect(75,900,450,235);g.fillRect(553,900,452,235);
 label('РАЗНЫХ ПЕСЕН',106,970,27,'#e8d8fa','600');
 label(String(stats.unique),104,1071,91,'#ffffff','800');
 label('В ИЗБРАННОМ СЕЙЧАС',579,970,25,'#e8d8fa','600');
 label(String(stats.favorites),575,1071,91,'#ffffff','800');
 label('ЛЮБИМЫЙ ЖАНР',88,1245,27,'#ccb8f4','650');
 label(clip(stats.topGenres[0]?stats.topGenres[0][0]:'Пока нет данных',30),84,1332,46,'#ffffff','700');
 label('ЛЮБИМЫЙ ИСПОЛНИТЕЛЬ',88,1450,27,'#ccb8f4','650');
 label(clip(stats.topArtists[0]?stats.topArtists[0][0]:'Пока нет данных',28),84,1537,46,'#ffffff','700');
 g.fillStyle='#bb8cf1';g.fillRect(84,1612,170,7);
 label('Только реальные прослушивания этого устройства.',84,1716,28,'#e6d6f0','500');
 label('Без импорта статистики из других сервисов.',84,1759,27,'#e6d6f0','500');
 label('AWEN · әуен',84,1858,28,'#b4adcc','600');
 const a=document.createElement('a');a.download='AWEN_My_Music_Year_'+stats.year+'.png';a.href=canvas.toDataURL('image/png');a.click();
 notify('Карточка PNG создана на устройстве');
}
function shareText(stats){
 return 'Мой музыкальный '+stats.year+' с AWEN: '+stats.plays+' подтверждённых прослушиваний, '+stats.unique+' разных композиций. Любимый жанр: '+(stats.topGenres[0]?stats.topGenres[0][0]:'нет данных')+'.';
}
function act(node){
 let kind=node.dataset.adAction,id=node.dataset.id,g=node.dataset.genre;
 if(kind==='tab'||kind.startsWith('tab-')){tab=kind==='tab'?node.dataset.tab:kind.slice(4);refresh();return;}
 if(kind==='radio'){openRadio(id);return;}
 if(kind==='detail'){bridge().openDetails&&bridge().openDetails(id);return;}
 if(kind==='like'){bridge().toggleFavorite&&bridge().toggleFavorite(id);refresh();return;}
 if(kind==='dislike'){toggle('dislikes',id);return;}
 if(kind==='lang-boost'){toggle('boostLanguages',node.dataset.language);return;}
 if(kind==='boost'||kind==='exclude'){let key=kind==='boost'?'boostGenres':'excludeGenres';toggle(key,g);return;}
 if(kind==='reset-tuner'){state.boostGenres=[];state.boostLanguages=[];state.excludeGenres=[];save();refresh();return;}
 if(kind==='reset-dislikes'){state.dislikes=[];save();refresh();return;}
 if(kind==='clear-history'){if(!root.confirm('Очистить локальную историю и настройки AWEN Discover? Избранное основного сайта останется.'))return;state=defaults();save();refresh();return;}
 if(kind==='smooth'){smooth=!smooth;refresh();return;}
 if(kind==='generate-prompt'){state.prompt=String(document.getElementById('ad-prompt')?.value||'').slice(0,400);lastPromptText=state.prompt;save();refresh();return;}
 if(kind==='prompt-example'){state.prompt='25 спокойных песен для вечерней дороги без рэпа, 2010-х';lastPromptText=state.prompt;save();refresh();return;}
 if(kind==='mix-add'){if(!/^awen-\d+$/.test(String(id||''))||!tracks().some(t=>t.id===id)){notify('Нет такого трека');return;}let all=arr(state.draft.ids);if(!all.includes(id)){if(all.length>=50){notify('Максимум 50 треков');return;}all.push(id);}state.draft.ids=all;save();if(tab==='mix')refresh();else notify('Добавлено в мой микс');return;}
 if(kind==='mix-remove'){state.draft.ids=arr(state.draft.ids).filter(x=>x!==id);save();refresh();return;}
 if(kind==='mix-clear'){if(!root.confirm('Очистить текущий микс?'))return;state.draft.ids=[];save();refresh();return;}
 if(kind==='mix-sort'){let list=arr(state.draft.ids).map(id=>tracks().find(t=>t.id===id)).filter(Boolean);state.draft.ids=Core.smartOrder(list).map(x=>x.track.id);save();refresh();return;}
 if(kind==='mix-share'){let input=document.getElementById('ad-mix-name');if(input)state.draft.name=input.value.slice(0,60);save();copyText(mixLink());return;}
 if(kind==='download-recap'){downloadRecap();return;}
 if(kind==='share-recap'){const summary=shareText(Core.stats(ctx(),selectedYear));if(navigator.share){navigator.share({title:'AWEN · Мой музыкальный год',text:summary}).catch(()=>copyText(summary));}else copyText(summary);return;}
}
document.addEventListener('click',e=>{const node=e.target.closest('[data-ad-action]');if(!node)return;e.preventDefault();act(node);});
document.addEventListener('input',e=>{
 if(e.target.id==='ad-radio-search'){radioQuery=e.target.value;let n=document.getElementById('ad-radio-found');if(n)n.innerHTML=radioSearch();}
 if(e.target.id==='ad-mix-search'){mixQuery=e.target.value;let n=document.getElementById('ad-mix-found');if(n)n.innerHTML=mixSearchHTML();}
 if(e.target.id==='ad-novelty'){let v=Number(e.target.value);state.novelty=v;let n=document.getElementById('ad-novelty-value');if(n)n.textContent=v;save();}
});
document.addEventListener('change',e=>{
 if(e.target.id==='ad-mix-name'){state.draft.name=e.target.value.slice(0,60);save();}
 if(e.target.id==='ad-prompt'){state.prompt=e.target.value.slice(0,400);save();}
 if(e.target.id==='ad-novelty'){refresh();}
 if(e.target.id==='ad-stats-year'){selectedYear=Number(e.target.value);refresh();}
 if(e.target.dataset.adControl==='hideAI'){state.hideVerifiedAI=!!e.target.checked;save();refresh();}
});
function init(){
 try{const url=new URL(root.location.href),encoded=url.searchParams.get('awen_mix');
 if(encoded){const imported=Core.decodeMix(encoded);if(imported){
  state.draft={name:imported.name,ids:imported.ids};save();tab='mix';importMessage='Открыта версия, полученная по ссылке. При редактировании поделитесь новой ссылкой.';
  if(bridge().openDiscover)bridge().openDiscover();
 }else{importMessage='Некорректная или слишком длинная ссылка на микс';}}
 }catch{}
 fetch('./awen-ai-provenance.json?rev=20261122-discovery-v1',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(data=>{
  if(data&&data.schema_version===1&&data.tracks&&typeof data.tracks==='object'){provenance=data;refresh();}
 }).catch(()=>{});
 if(bridge().getView&&bridge().getView()==='discover')refresh();
}
root.AWENDiscoveryUI={render,openRadio,markOpened,beginPlayback,observePlayback,version:'1.0.0',getState:()=>state,init};
init();
})(window);
