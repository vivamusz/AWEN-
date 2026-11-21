/* AWEN: official embedded players and shared JSON catalog. */
(() => {
  'use strict';
  const STORAGE = 'awen-official-sources-v1';
  const STREAM_STORAGE = 'awen-authorized-streams-v1';
  let links = {};
  try {
    const v=JSON.parse(localStorage.getItem(STORAGE)||'{}');
    if(v && typeof v==='object' && !Array.isArray(v)) links=v;
  } catch (_) {}
  let authorizedStreams = {};
  try {
    const a=JSON.parse(localStorage.getItem(STREAM_STORAGE)||'{}');
    if(a && typeof a==='object' && !Array.isArray(a)) authorizedStreams=a;
  } catch (_) {}
  function approvedAudioUrl(value){
    if(typeof value!=='string'||value.length>1800)return '';
    try {
      const u=new URL(value.trim());
      if(u.protocol!=='https:' || u.username || u.password)return '';
      // A MuzPace song page is not an audio stream.
      if(/^(?:www\.)?muzpace\.net$/i.test(u.hostname) && /^\/mp3\/\d+\/?$/i.test(u.pathname))return '';
      return u.href;
    }catch(_){return '';}
  }
  function applyAuthorizedStreams(){
    for(const t of tracks){
      const stream=approvedAudioUrl(authorizedStreams[t.id]);
      if(stream){t.audio_url=stream;t.source_status='available';}
    }
  }

  function provider(value) {
    if(typeof value!=='string'||value.length>1800)return null;
    let u;try{u=new URL(value.trim());}catch(_){return null;}
    if(u.protocol!=='https:')return null;
    const host=u.hostname.toLowerCase(),path=u.pathname;
    let video=null;
    if(host==='youtu.be')video=path.split('/')[1];
    if(['youtube.com','www.youtube.com','m.youtube.com'].includes(host))
      video=path==='/watch'?u.searchParams.get('v'):(path.match(/^\/(?:embed|shorts|live)\/([\w-]+)/)||[])[1];
    if(['youtube-nocookie.com','www.youtube-nocookie.com'].includes(host))
      video=(path.match(/^\/embed\/([\w-]+)/)||[])[1];
    if(video && /^[a-zA-Z0-9_-]{11}$/.test(video))
      return {name:'YouTube',src:'https://www.youtube-nocookie.com/embed/'+video,height:270};
    if(host==='open.spotify.com'){
      const m=path.match(/^\/(?:intl-[a-z-]+\/)?track\/([A-Za-z0-9]{22})\/?$/);
      if(m)return {name:'Spotify',src:'https://open.spotify.com/embed/track/'+m[1],height:160};
    }
    if(host==='music.apple.com'){
      const m=path.match(/^\/(?:[a-z]{2}\/)?album\/(\d+)\/?$/i);
      const trackId=u.searchParams.get('i');
      if(m&&trackId&&/^\d+$/.test(trackId)){
        const country=(path.match(/^\/([a-z]{2})\//i)||[])[1]||'kz';
        return {name:'Apple Music',src:'https://embed.music.apple.com/'+country+'/album/'+m[1]+'?i='+trackId,height:175};
      }
    }
    if(host==='muzpace.net'||host==='www.muzpace.net'){
      if(/^\/mp3\/\d+\/?$/.test(path)){
        return {name:'MuzPace',external:true,pageUrl:u.origin+u.pathname};
      }
    }
    if(host==='soundcloud.com'||host==='www.soundcloud.com'){
      const bits=path.split('/').filter(Boolean);
      if(bits.length>=2&&!['search','discover','you','stream','charts','stations'].includes(bits[0].toLowerCase())){
        const link='https://soundcloud.com/'+bits.map(encodeURIComponent).join('/');
        return {name:'SoundCloud',src:'https://w.soundcloud.com/player/?url='+encodeURIComponent(link)+'&auto_play=false&show_artwork=true',height:170};
      }
    }
    return null;
  }
  function playerLaunchUrl(src){
    if(!src||src.external)return '';
    if(src.name==='YouTube'){
      const u=new URL(src.src);
      u.searchParams.set('autoplay','1');
      u.searchParams.set('playsinline','1');
      return u.href;
    }
    if(src.name==='SoundCloud'){
      const u=new URL(src.src);
      u.searchParams.set('auto_play','true');
      return u.href;
    }
    // Spotify and Apple Music embeds do not guarantee automatic full-track playback.
    return src.src;
  }
  function getSource(t){
    if(!t)return null;
    return provider(links[t.id])||provider(t.source_url);
  }
  const oldDetails=openDetails;
  openDetails=function(id){
    oldDetails(id);
    const t=byId(id),root=document.querySelector('#modalContent');
    if(!t||!root)return;
    const box=document.createElement('section');
    box.style.cssText='border-top:1px solid #494053;margin-top:20px;padding-top:18px;display:grid;gap:10px';
    const h=document.createElement('h3');
    h.textContent='Онлайн-прослушивание';h.style.margin='0';box.appendChild(h);
    const src=getSource(t);
    if(src){
      const dt=[...root.querySelectorAll('dt')].find(x=>x.textContent==='Статус');
      if(dt?.nextElementSibling)dt.nextElementSibling.textContent=src.external?'Страница '+src.name+' (открывается отдельно)':'Официальный плеер '+src.name;
      const notice=[...root.querySelectorAll('.selection-note')].find(x=>x.textContent.includes('Аудиофайл не подключён'));
      if(notice)notice.textContent=src.external?'Для прослушивания открой страницу MuzPace. Для плеера внутри ӘУЕН требуется разрешённый прямой аудиопоток.':'Можно слушать через '+src.name+' в плеере ниже.';
      if(!src.external){
      const open=document.createElement('button');open.className='btn';open.textContent='▶ Встроенный плеер '+src.name;
      open.dataset.awenEmbed='1';
      open.addEventListener('click',()=>{
        const frame=document.createElement('iframe');frame.title=t.artist+' — '+t.title+' / '+src.name;
        frame.src=playerLaunchUrl(src);frame.loading='eager';frame.referrerPolicy='strict-origin-when-cross-origin';
        frame.allow='autoplay; encrypted-media; fullscreen; picture-in-picture';frame.allowFullscreen=true;
        frame.style.cssText='display:block;width:100%;height:'+(src.name==='YouTube'?'min(45vh,370px)':src.height+'px')+';border:0;border-radius:10px;background:#16131a';
        open.replaceWith(frame);
      });
      box.appendChild(open);
      }
      const full=document.createElement('a');full.className='btn tiny';
      full.href=src.external?src.pageUrl:(links[id]||t.source_url);full.textContent='Открыть в '+src.name;
      full.target='_blank';full.rel='noopener noreferrer';box.appendChild(full);
    }
    const info=document.createElement('p');
    info.textContent='Выбери точную запись на официальном сервисе, скопируй ссылку на песню и сохрани её. Поиск не гарантирует совпадения версий.';
    info.style.cssText='color:#b5aebe;line-height:1.5;margin:0;font-size:12px';box.appendChild(info);
    const query=encodeURIComponent(t.artist+' '+t.title);
    const sources=[
      ['YouTube','https://www.youtube.com/results?search_query='+query],
      ['Spotify','https://open.spotify.com/search/'+query],
      ['SoundCloud','https://soundcloud.com/search/sounds?q='+query],
      ['Apple Music','https://music.apple.com/kz/search?term='+query],
      ['MuzPace (главная)','https://muzpace.net/']
    ];
    const bar=document.createElement('div');bar.className='actions';bar.style.margin='0';
    for(const entry of sources){
      const a=document.createElement('a');a.className='btn tiny';a.textContent='Найти: '+entry[0];
      a.href=entry[1];a.target='_blank';a.rel='noopener noreferrer';bar.appendChild(a);
    }
    box.appendChild(bar);
    const input=document.createElement('input');
    input.type='url';input.placeholder='Ссылка на трек YouTube / Spotify / SoundCloud / Apple Music / MuzPace';
    input.value=links[id]||((provider(t.source_url)&&t.source_url)||'');
    input.setAttribute('aria-label','Ссылка на конкретную песню');
    input.style.cssText='padding:11px;width:100%;min-width:0;background:#252130;color:white;border:1px solid #5b506a;border-radius:9px';
    box.appendChild(input);
    const save=document.createElement('button');save.className='btn primary';save.textContent='Сохранить ссылку на этом устройстве';
    save.addEventListener('click',()=>{
      const v=input.value.trim();
      if(v&&!provider(v)){notify('Нужна ссылка на конкретную запись поддерживаемого сервиса');return;}
      if(v)links[id]=v;else delete links[id];
      try{localStorage.setItem(STORAGE,JSON.stringify(links));}catch(_){notify('Нет доступа к хранилищу браузера');return;}
      notify(v?'Ссылка сохранена':'Ссылка удалена');render();openDetails(id);
    });
    box.appendChild(save);
    const foot=document.createElement('p');
    foot.textContent=src?.name==='YouTube'||src?.name==='SoundCloud'?'По нажатию ▶ плеер запрашивает автоматический старт. Если Chrome или сервис его запретит, нажми Play на самом плеере.':'Воспроизведение зависит от правил сервиса. Apple Music может дать только фрагмент. Прямое MP3 и офлайн через внешние плееры недоступны.';
    foot.style.cssText='color:#aaa3b7;font-size:11px;line-height:1.5;margin:0';box.appendChild(foot);
    { // Direct licensed HTTPS audio may be configured for any track.
      const licensed=document.createElement('div');
      licensed.style.cssText='display:grid;gap:10px;padding:12px;border:1px solid #5c4b69;border-radius:10px';
      const desc=document.createElement('p');
      desc.textContent='Собственный разрешённый аудиопоток: вставь прямой HTTPS-адрес MP3 или другого поддерживаемого аудиофайла. Ссылка на веб-страницу не подходит. Файл должен быть разрешён к воспроизведению через ӘУЕН.';
      desc.style.cssText='font-size:12px;color:#d5c8e0;margin:0';
      const streamInput=document.createElement('input');
      streamInput.type='url';streamInput.placeholder='https://.../authorized-stream.mp3';
      streamInput.value=authorizedStreams[id]||'';
      streamInput.style.cssText='width:100%;background:#252130;color:white;border:1px solid #5b506a;border-radius:9px;padding:11px';
      const streamSave=document.createElement('button');streamSave.className='btn';
      streamSave.textContent='Сохранить прямое аудио (▶ в ӘУЕН)';
      streamSave.addEventListener('click',()=>{
        const value=streamInput.value.trim();
        if(value&&!approvedAudioUrl(value)){notify('Нужна HTTPS-ссылка непосредственно на поток, не страница MuzPace');return;}
        const oldUrl=authorizedStreams[id]||'';
        if(value)authorizedStreams[id]=value;else delete authorizedStreams[id];
        try{localStorage.setItem(STREAM_STORAGE,JSON.stringify(authorizedStreams));}catch(_){notify('Не удалось сохранить ссылку в браузере');return;}
        if(value){t.audio_url=value;t.source_status='available';}
        else if(t.audio_url===oldUrl){t.audio_url='';t.source_status='unknown';}
        render();openDetails(id);
        notify(value?'Аудиопоток подключён на этом устройстве':'Локальный аудиопоток удалён');
      });
      licensed.append(desc,streamInput,streamSave);
      box.appendChild(licensed);
    }
    const settings=document.createElement('details');
    settings.style.cssText='margin-top:5px;padding:12px 14px;border:1px solid #4a3d58;border-radius:10px';
    settings.open=!src;
    const summary=document.createElement('summary');
    summary.textContent=src?'Поиск и настройка источника':'Найти запись в музыкальных сервисах';
    summary.style.cssText='cursor:pointer;font-weight:700;color:#d2b8f5';
    settings.appendChild(summary);
    for(const el of [info,bar,input,save,foot])settings.appendChild(el);
    box.appendChild(settings);
    if(src){
      // Source player belongs immediately beneath the track title and artist, not at the bottom.
      const coverEl=root.querySelector('.cover');
      if(coverEl)coverEl.style.display='none';
      const titleEl=root.querySelector('h2');
      const artistEl=titleEl?.nextElementSibling;
      if(artistEl)artistEl.insertAdjacentElement('afterend',box);
      else root.prepend(box);
    }else root.appendChild(box);
    const modal=document.querySelector('#modal');
    if(modal)modal.scrollTop=0;
  };
  const oldPlay=playTrack;
  playTrack=function(id){
    const t=byId(id);
    if(t)applyAuthorizedStreams();
    const src=getSource(t);
    if(t&&!playable(t)&&src?.external){
      // An external MuzPace song page cannot be played as a media file.
      // One click opens the provider's own player, without mislabeling it as in-site audio.
      window.open(src.pageUrl,'_blank','noopener,noreferrer');
      return;
    }
    if(t&&!playable(t)&&src){
      openDetails(id);
      // This call is synchronous within the user's ▶ click.
      document.querySelector('[data-awen-embed]')?.click();
      return;
    }
    oldPlay(id);
  };
  let matchingStatus=null;
  const oldRender=render;
  render=function(){
    applyAuthorizedStreams();
    oldRender();
    const linked=tracks.filter(t=>{const p=getSource(t);return !!p&&!p.external;}).length;
    const muzpaceLinks=tracks.filter(t=>getSource(t)?.external).length;
    const label=document.querySelector('.top-label');
    if(label)label.textContent='AWEN · '+linked+' плееров'+(muzpaceLinks?' · '+muzpaceLinks+' ссылок MuzPace':'');
    if(st.view==='home'&&!demo){
      const main=document.querySelector('#app');
      if(main){
        const banner=document.createElement('div');
        banner.className='notice';
        banner.id='awen-connection-status';
        const intro=document.createElement('strong');
        intro.textContent=linked+' песен имеют встроенные источники; '+muzpaceLinks+' — ссылки MuzPace. ';
        banner.appendChild(intro);
         const classified=tracks.filter(t=>t.genre&&t.genre!=='Не определён').length;
         banner.appendChild(document.createTextNode(classified+' из '+tracks.length+' композиций предварительно распределены по жанрам. '));
          const appleAlbums=tracks.filter(t=>t.verified_metadata&&t.year&&t.album&&t.album!=='Без альбома').length;
          banner.appendChild(document.createTextNode('Подтверждённые релизы Apple Music: '+appleAlbums+'. '));
        if(matchingStatus){
          const text=document.createTextNode('Автоподбор Apple Music: обработано '+Number(matchingStatus.next_index||0)+' из '+Number(matchingStatus.total||tracks.length)+', найдено новых точных совпадений '+Number(matchingStatus.matched||0)+', на проверку '+Number(matchingStatus.review||0)+'. ');
          banner.appendChild(text);
        } else {
          banner.appendChild(document.createTextNode('Остальные треки ищем по официальным каталогам. '));
        }
        const link=document.createElement('a');
        link.href='https://github.com/vivamusz/AWEN-/actions/workflows/awen-match.yml';
        link.target='_blank';link.rel='noopener noreferrer';link.textContent='Статус подбора на GitHub';
        banner.appendChild(link);
        main.prepend(banner);
      }
    }
    for(const button of document.querySelectorAll('.song button[data-play]')){
      const t=byId(button.dataset.play);
      const src=getSource(t);
      if(!src||playable(t))continue;
      button.textContent=src.external?'↗':'▶';
      button.title=src.external?'Перейти на MuzPace (не воспроизведение в ӘУЕН)':src.name==='YouTube'||src.name==='SoundCloud'?'Попробовать воспроизвести одним нажатием через '+src.name:'Открыть плеер '+src.name;
      const status=button.closest('.song')?.querySelector('.song-status');
      if(status){status.textContent=src.external?'Перейти · '+src.name:src.name==='Apple Music'?'Предпрослушивание · Apple Music':'Онлайн · '+src.name;if(!src.external)status.classList.add('yes');}
    }
  };
  const oldAbout=aboutPage;
  aboutPage=function(){
    return oldAbout()+'<section class="notice"><strong>Редактор каталога:</strong> для жанров, настроений, подборок и ручной проверки записей открой <a href="./curator.html">AWEN Curator</a>. Изменения сохраняются на этом устройстве; скачай JSON для публикации.</section>'+'<section class="notice"><strong>Тест MuzPace:</strong> <a href="https://muzpace.net/mp3/31281" target="_blank" rel="noopener noreferrer">Открыть присланную страницу /mp3/31281</a>. Для воспроизведения внутри ӘУЕН нужна отдельная разрешённая ссылка на аудиопоток.</section>'+'<section class="notice"><strong>Официальные источники:</strong> открой карточку трека, нажми «Найти» и сохрани ссылку на конкретную песню. Ссылки хранятся в твоём браузере; для переноса скачай JSON со ссылками.<div class="actions"><button class="btn primary" id="awenExportSources">Экспорт JSON со ссылками</button><button class="btn" id="awenUseShared">Загрузить общий каталог</button></div></section>';
  };
  document.addEventListener('click',e=>{
    if(e.target.id==='awenExportSources'){
      const merged=tracks.map(t=>({...t,source_url:links[t.id]||t.source_url||''}));
      download('awen-catalog-with-sources.json',JSON.stringify({tracks:merged},null,2));
    }else if(e.target.id==='awenUseShared'){
      try{localStorage.setItem('awen-catalog-mode','shared');}catch(_){}
      dbWrite(null).catch(()=>{});
      loadShared();
      notify('Загружаем общий каталог GitHub...');
    }
  });
  async function loadShared(){
    try{
      const r=await fetch('./awen-catalog.json',{cache:'no-cache'});
      if(!r.ok)throw Error('HTTP '+r.status);
      const found=parseCatalog(await r.json());
      if(!found.length)throw Error('Нет треков в файле');
      // Дополнительный справочник, независимый от оригинального каталога и автопоиска ссылок.
      try{
        const cur=await fetch('./awen-curation.json',{cache:'no-cache'});
        if(cur.ok){
          const payload=await cur.json();
          const extra=payload&&payload.tracks&&typeof payload.tracks==='object'?payload.tracks:{};
          for(const t of found){
            const patch=extra[t.id];
            if(!patch||typeof patch!=='object')continue;
            const emptyGenre=!t.genre||t.genre==='Не определён';
            const manual=/^(ручная|массовая)\s/i.test(String(patch.curation_method||''));
            if(manual&&typeof patch.genre==='string'){
              t.genre=patch.genre.trim()||'Не определён';
            }else if(emptyGenre&&typeof patch.genre==='string'&&patch.genre.trim()){
              t.genre=patch.genre.trim();
            }
            if(Array.isArray(patch.subgenres)&&(manual||!t.subgenres.length)){
              t.subgenres=patch.subgenres.filter(x=>typeof x==='string').slice(0,10);
            }
            if(Array.isArray(patch.moods)){
              const candidate=patch.moods.filter(x=>typeof x==='string');
              t.moods=manual?candidate.slice(0,15):[...new Set([...t.moods,...candidate])].slice(0,15);
            }
            if(Array.isArray(patch.playlists)){
              const candidate=patch.playlists.filter(x=>lists.some(p=>p.id===x));
              t.playlists=manual?[...new Set(candidate)]:[...new Set([...t.playlists,...candidate])];
            }
            if((manual||!t.language||t.language==='Не определён')&&typeof patch.language==='string'&&patch.language.trim()){
              t.language=patch.language.trim();
            }
            // Verified official metadata or edits explicitly saved in the owner-side curator.
            if((manual||!t.album||t.album==='Без альбома')&&typeof patch.album==='string'&&(manual||patch.verified_metadata)){
              t.album=patch.album.trim()||'Без альбома';
            }
            if((manual||!t.year)&&patch.year&&(manual||patch.verified_metadata))t.year=Number(patch.year)||null;
            if(!t.duration&&patch.duration&&patch.verified_metadata)t.duration=Number(patch.duration)||0;
            if(patch.verified_metadata&&typeof patch.verified_metadata==='object'&&
               String(patch.verified_metadata.url||'').startsWith('https://music.apple.com/')){
              // Song/artist identity was verified by the official matching workflow.
              t.verified_metadata=patch.verified_metadata;
              if(patch.year_type==='album_release')t.year_type='album_release';
              if(patch.album)t.album_source='Apple Music · конкретное издание';
            }
            if(patch.genre_review_candidate)t.genre_review_candidate=patch.genre_review_candidate;
            if((manual||emptyGenre)&&patch.genre&&Number.isFinite(Number(patch.energy))){
              t.energy=Math.min(5,Math.max(1,Number(patch.energy)));
            }
            if(patch.review_needed)t.curation_review_needed=true;
            if(patch.potential_import_error)t.import_review_needed=true;
            if(manual){
              t.genre_source='Ручная правка каталога';
              t.playlist_manual=true;
              t.curation_review_needed=Boolean(patch.review_needed);
              t.import_review_needed=Boolean(patch.potential_import_error);
            }
          }
        }
      }catch(err){console.warn('AWEN: справочник жанров временно недоступен',err);}
      // Low-confidence MusicBrainz ARTIST tags only fill still-unknown track genres.
      // They never replace manual curation or a verified Apple song match.
      try{
        const mb=await fetch('./awen-musicbrainz.json',{cache:'no-cache'});
        if(mb.ok){
          const payload=await mb.json();
          const ext=(payload&&payload.tracks&&typeof payload.tracks==='object')?payload.tracks:{};
          for(const t of found){
            const hint=ext[t.id];
            if(t.genre_source==='Ручная правка каталога')continue;
            if(!hint||typeof hint.genre!=='string')continue;
            if(t.genre&&t.genre!=='Не определён')continue;
            if(!genres.some(g=>g.name===hint.genre))continue;
            t.genre=hint.genre;
            t.curation_review_needed=true;
            t.genre_source='MusicBrainz artist tags — предварительно';
            if(hint.genre==='Chill / Lo-Fi / Ambient')t.playlists=[...new Set([...t.playlists,'chill'])];
            else if(['House','Techno / Trance','Funk / Disco','Latin / Brazilian Club','Drum & Bass / UK Bass'].includes(hint.genre)){
              t.playlists=[...new Set([...t.playlists,'dance'])];
            }
            if(hint.genre==='Phonk'){
              const labels=(hint.evidence_tags||[]).map(x=>String(x).toLowerCase());
              if(labels.some(x=>x.includes('drift phonk')))t.playlists=[...new Set([...t.playlists,'nightplus'])];
              else if(labels.some(x=>x.includes('chill phonk')||x.includes('atmospheric phonk')))t.playlists=[...new Set([...t.playlists,'night'])];
            }
          }
        }
      }catch(err){console.warn('AWEN: MusicBrainz временно недоступен',err);}
      // Proven release information from Apple ID-based lookups. This is not an audio URL.
      try{
        const ar=await fetch('./awen-apple-metadata.json',{cache:'no-cache'});
        if(ar.ok){
          const payload=await ar.json();
          const extra=(payload&&payload.tracks&&typeof payload.tracks==='object')?payload.tracks:{};
          for(const t of found){
            const patch=extra[t.id];
            if(!patch||!patch.verified_metadata||
               patch.metadata_confidence!=='exact_apple_track_id_artist_title')continue;
            const manual=t.genre_source==='Ручная правка каталога';
            // A manual genre decision must not block album/year enrichment
            // unless the editor explicitly set those particular fields.
            if((!t.album||t.album==='Без альбома')&&typeof patch.album==='string'){
              t.album=patch.album;
            }
            if(!t.year&&Number.isInteger(patch.year)){
              t.year=patch.year;
              t.year_type='album_release';
            }
            if(!t.duration&&Number.isInteger(patch.duration))t.duration=patch.duration;
            if(typeof patch.genre==='string'&&genres.some(g=>g.name===patch.genre)){
              if(!manual&&(!t.genre||t.genre==='Не определён')){
                t.genre=patch.genre;
                t.genre_source='Apple Music · подтверждённое совпадение';
                t.curation_review_needed=false;
              }else if(t.genre!==patch.genre){
                t.genre_review_candidate=patch.genre;
                t.curation_review_needed=true;
              }else if(!manual&&t.genre_source!=='Ручная правка каталога'){
                t.genre_source='Apple Music · подтверждённое совпадение';
                t.curation_review_needed=false;
              }
            }
            t.verified_metadata=patch.verified_metadata;
            t.album_source='Apple Music · конкретное издание';
          }
        }
      }catch(err){console.warn('AWEN: данные релизов Apple Music временно недоступны',err);}
      // Extra evidence is independently checked against the original track/artist.
      // Manual decisions always win; ambiguous album tags do not overwrite track genres.
      try{
        const er=await fetch('./awen-genre-sources.json',{cache:'no-cache'});
        if(er.ok){
          const evidence=await er.json();
          const patches=evidence&&evidence.tracks&&typeof evidence.tracks==='object'?evidence.tracks:{};
          for(const t of found){
            const patch=patches[t.id];
            if(!patch||t.genre_source==='Ручная правка каталога'||t.import_review_needed)continue;
            if(patch.status==='conflict'){
              t.genre_source_conflict=patch.suggestions||[];
              t.curation_review_needed=true;
              continue;
            }
            const proposed=String(patch.genre||'');
            if(!genres.some(g=>g.name===proposed))continue;
            const unknown=!t.genre||t.genre==='Не определён';
            const direct=patch.status==='track_evidence';
            const apple=t.genre_source==='Apple Music · подтверждённое совпадение';
            if(apple&&!unknown&&t.genre!==proposed){
              t.genre_review_candidate=proposed;
              t.curation_review_needed=true;
              continue;
            }
            if(unknown||direct){
              const old=t.genre;
              if(old&&old!==proposed&&old!=='Не определён')t.subgenres=[];
              t.genre=proposed;
              t.genre_source=direct?'Теги конкретного трека · '+(patch.evidence||[]).map(x=>x.provider).join(', '):'Deezer · жанр альбома (предварительно)';
              t.genre_evidence_urls=(patch.evidence||[]).map(x=>x.url).filter(Boolean);
              t.curation_review_needed=Boolean(patch.review_needed)||(Boolean(old&&old!==proposed&&old!=='Не определён'));
            }else if(t.genre!==proposed){
              t.genre_review_candidate=proposed;
              t.curation_review_needed=true;
            }
          }
        }
      }catch(err){console.warn('AWEN: дополнительные жанровые свидетельства недоступны',err);}
      // Keep questionable VK post fragments in the source JSON and curator for review,
      // but do not present them to listeners as actual music recordings.
      const quarantined=found.filter(t=>t.import_review_needed).length;
      tracks=found.filter(t=>!t.import_review_needed);
      demo=false;applyAuthorizedStreams();render();
      if(quarantined)console.info('AWEN: '+quarantined+' текстовых фрагментов скрыты из музыкального списка; исходные записи сохранены');
    }catch(err){
      console.warn('AWEN: каталог GitHub недоступен',err);
      tracks=[];demo=false;render();
      notify('Не удалось загрузить общий каталог — проверь интернет');
    }
  }
  fetch('./awen-match-status.json',{cache:'no-cache'}).then(r=>r.ok?r.json():null).then(status=>{
    if(status&&typeof status==='object'){matchingStatus=status;render();}
  }).catch(()=>{});
  const mode=localStorage.getItem('awen-catalog-mode')||'shared';
  if(mode==='local'){
    dbRead().then(local=>{
      if(Array.isArray(local)&&local.length){tracks=parseCatalog(local);demo=false;render();}
      else loadShared();
    }).catch(()=>loadShared());
  }else if(mode!=='demo'){
    loadShared();
  }
})();