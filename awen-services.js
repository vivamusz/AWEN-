/* AWEN: official embedded players and shared JSON catalog. */
(() => {
  'use strict';
  const STORAGE = 'awen-official-sources-v1';
  let links = {};
  try {
    const v=JSON.parse(localStorage.getItem(STORAGE)||'{}');
    if(v && typeof v==='object' && !Array.isArray(v)) links=v;
  } catch (_) {}

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
    if(host==='soundcloud.com'||host==='www.soundcloud.com'){
      const bits=path.split('/').filter(Boolean);
      if(bits.length>=2&&!['search','discover','you','stream','charts','stations'].includes(bits[0].toLowerCase())){
        const link='https://soundcloud.com/'+bits.map(encodeURIComponent).join('/');
        return {name:'SoundCloud',src:'https://w.soundcloud.com/player/?url='+encodeURIComponent(link)+'&auto_play=false&show_artwork=true',height:170};
      }
    }
    return null;
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
    const info=document.createElement('p');
    info.textContent='Выбери точную запись на официальном сервисе, скопируй ссылку на песню и сохрани её. Поиск не гарантирует совпадения версий.';
    info.style.cssText='color:#b5aebe;line-height:1.5;margin:0;font-size:12px';box.appendChild(info);
    const query=encodeURIComponent(t.artist+' '+t.title);
    const sources=[
      ['YouTube','https://www.youtube.com/results?search_query='+query],
      ['Spotify','https://open.spotify.com/search/'+query],
      ['SoundCloud','https://soundcloud.com/search/sounds?q='+query],
      ['Apple Music','https://music.apple.com/kz/search?term='+query]
    ];
    const bar=document.createElement('div');bar.className='actions';bar.style.margin='0';
    for(const entry of sources){
      const a=document.createElement('a');a.className='btn tiny';a.textContent='Найти: '+entry[0];
      a.href=entry[1];a.target='_blank';a.rel='noopener noreferrer';bar.appendChild(a);
    }
    box.appendChild(bar);
    const input=document.createElement('input');
    input.type='url';input.placeholder='Ссылка на трек YouTube / Spotify / SoundCloud';
    input.value=links[id]||((provider(t.source_url)&&t.source_url)||'');
    input.setAttribute('aria-label','Ссылка на конкретную песню');
    input.style.cssText='padding:11px;width:100%;min-width:0;background:#252130;color:white;border:1px solid #5b506a;border-radius:9px';
    box.appendChild(input);
    const save=document.createElement('button');save.className='btn primary';save.textContent='Сохранить ссылку на этом устройстве';
    save.addEventListener('click',()=>{
      const v=input.value.trim();
      if(v&&!provider(v)){notify('Нужна HTTPS-ссылка на конкретный трек YouTube, Spotify или SoundCloud');return;}
      if(v)links[id]=v;else delete links[id];
      try{localStorage.setItem(STORAGE,JSON.stringify(links));}catch(_){notify('Нет доступа к хранилищу браузера');return;}
      notify(v?'Ссылка сохранена':'Ссылка удалена');render();openDetails(id);
    });
    box.appendChild(save);
    const src=getSource(t);
    if(src){
      const dt=[...root.querySelectorAll('dt')].find(x=>x.textContent==='Статус');
      if(dt?.nextElementSibling)dt.nextElementSibling.textContent='Официальный плеер '+src.name;
      const notice=[...root.querySelectorAll('.selection-note')].find(x=>x.textContent.includes('Аудиофайл не подключён'));
      if(notice)notice.textContent='Можно слушать через '+src.name+' в плеере ниже.';
      const open=document.createElement('button');open.className='btn';open.textContent='▶ Встроенный плеер '+src.name;
      open.dataset.awenEmbed='1';
      open.addEventListener('click',()=>{
        open.disabled=true;
        const frame=document.createElement('iframe');frame.title=t.artist+' — '+t.title+' / '+src.name;
        frame.src=src.src;frame.loading='lazy';frame.referrerPolicy='strict-origin-when-cross-origin';
        frame.allow='autoplay; encrypted-media; fullscreen; picture-in-picture';frame.allowFullscreen=true;
        frame.style.cssText='display:block;width:100%;height:'+src.height+'px;border:0;border-radius:10px;background:#16131a';
        box.appendChild(frame);
      });
      box.appendChild(open);
      const full=document.createElement('a');full.className='btn tiny';
      full.href=links[id]||t.source_url;full.textContent='Открыть в '+src.name;
      full.target='_blank';full.rel='noopener noreferrer';box.appendChild(full);
    }
    const foot=document.createElement('p');
    foot.textContent='Плеер принадлежит выбранному сервису. Apple Music может воспроизводить фрагмент без подписки; полная песня зависит от авторизации и условий сервиса. MP3 и офлайн-загрузка через ӘУЕН недоступны.';
    foot.style.cssText='color:#aaa3b7;font-size:11px;line-height:1.5;margin:0';box.appendChild(foot);
    if(src){const grid=root.querySelector('.details-grid');if(grid)root.insertBefore(box,grid);else root.appendChild(box);}else root.appendChild(box);
  };
  const oldPlay=playTrack;
  playTrack=function(id){
    const t=byId(id);
    if(t&&!playable(t)&&getSource(t)){openDetails(id);document.querySelector('[data-awen-embed]')?.click();return;}
    oldPlay(id);
  };
  let matchingStatus=null;
  const oldRender=render;
  render=function(){
    oldRender();
    const linked=tracks.filter(t=>!!getSource(t)).length;
    const label=document.querySelector('.top-label');
    if(label)label.textContent='AWEN · '+linked+' онлайн-источников';
    if(st.view==='home'&&!demo){
      const main=document.querySelector('#app');
      if(main){
        const banner=document.createElement('div');
        banner.className='notice';
        banner.id='awen-connection-status';
        const intro=document.createElement('strong');
        intro.textContent=linked+' песен имеют официальные источники прослушивания. ';
        banner.appendChild(intro);
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
      button.textContent='▶';
      button.title='Слушать через '+src.name;
      const status=button.closest('.song')?.querySelector('.song-status');
      if(status){status.textContent='Онлайн · '+src.name;status.classList.add('yes');}
    }
  };
  const oldAbout=aboutPage;
  aboutPage=function(){
    return oldAbout()+'<section class="notice"><strong>Официальные источники:</strong> открой карточку трека, нажми «Найти» и сохрани ссылку на конкретную песню. Ссылки хранятся в твоём браузере; для переноса скачай JSON со ссылками.<div class="actions"><button class="btn primary" id="awenExportSources">Экспорт JSON со ссылками</button><button class="btn" id="awenUseShared">Загрузить общий каталог</button></div></section>';
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
      tracks=found;demo=false;render();
    }catch(err){
      console.warn('AWEN: каталог GitHub недоступен',err);
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