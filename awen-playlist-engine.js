/* AWEN Algotorial v2: explainable playlist selection; NO simulated BPM or listening data. */
(()=>{'use strict';
function build(tracks,editorial,settings){
  const profiles=settings.playlists,w=settings.parameters;
  const result={schema_version:2,method:settings.model,generated_at:settings.generated_at,playlists:{},diagnostics:{}};
  const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const lower=s=>String(s||'').toLowerCase();
  const has=(styles,needles)=>needles.some(x=>styles.includes(lower(x)));
  for(const [pid,cfg] of Object.entries(profiles)){
    const seeds=new Set(editorial.playlists?.[pid]?.track_ids||[]);
    const pins=new Set(editorial.playlists?.[pid]?.manual_pins||[]);
    const pool=[],errors={};
    const reject=reason=>{errors[reason]=(errors[reason]||0)+1;};
    for(const t of tracks){
      if(!t||!t.id||!t.title||!t.artist||t.import_review_needed||t.potential_import_error||t.entry_type==='album'||t.entry_type==='EP'||t.entry_type_review_needed){
        reject('non_track');continue;
      }
      if(/^(id|gif|показать список)$/i.test(t.title.trim())){reject('unidentified');continue;}
      const genre=t.genre||'Не определён',styles=(t.subgenres||[]).map(lower),moods=(t.moods||[]).map(lower);
      const q=t.awen_quality||{},energy=Number.isFinite(q.editorial_energy)?q.editorial_energy:null;
      const conf=q.genre_confidence||'none',seed=seeds.has(t.id),pin=pins.has(t.id);
      if(genre==='Не определён'){reject('unknown_genre');continue;}
      if(has(styles,cfg.blockedStyles)&&!pin){reject('blocked_style');continue;}
      const main=cfg.mainGenres.includes(genre),secondary=cfg.secondaryGenres.includes(genre),conditional=cfg.conditionalGenres[genre];
      if(!(main||secondary||(conditional&&has(styles,conditional))||pin)){reject('outside_playlist_theme');continue;}
      if(pid==='nightplus'&&energy!==null&&energy<=2&&!pin){reject('low_energy_for_aggressive');continue;}
      if(pid==='night'&&energy!==null&&energy>=5&&!pin){reject('high_energy_for_calm');continue;}
      let score=main?w.coreGenre:secondary?w.secondaryGenre:25;
      const reasons=[main?'Основной жанр':secondary?'Смежный жанр':'Подходящий стиль'];
      if(pin){score+=50;reasons.push('Редакторское закрепление');}
      else if(seed){score+=w.editorialBonus;reasons.push('Редакторская подборка');}
      if(has(styles,cfg.preferredStyles)){score+=w.preferredStyle;reasons.push('Поджанр соответствует');}
      if(conf==='high'){score+=w.confidenceHigh;reasons.push('Жанр с высокой уверенностью');}
      else if(conf==='medium')score+=w.confidenceMedium;
      else if(conf==='none')score-=6;
      if(energy!==null){
        if(energy>=cfg.energy[0]&&energy<=cfg.energy[1]){score+=w.energyBonus;reasons.push('Редакторская оценка энергии подходит');}
        else{score-=w.energyPenalty;reasons.push('Редакторская энергия не соответствует');}
      }
      const good=cfg.goodMoods.filter(x=>moods.includes(lower(x))).length,bad=cfg.badMoods.filter(x=>moods.includes(lower(x))).length;
      score+=Math.min(2,good)*w.positiveMoodBonus;
      score-=Math.min(2,bad)*w.negativeMoodPenalty;
      if(good)reasons.push('Метка настроения соответствует');
      if(q.genre_review_needed||conf==='low')score-=3;
      // Optional measurements from a locally authorized FULL track only.
      // The score is a heuristic energy proxy, not perceived emotion or Spotify energy.
      const audio=q.acoustic_features;
      if(audio&&audio.source_type==='authorized_local_file'&&audio.coverage==='full_track'&&
         audio.analyzer==='awen-acoustics-v1'&&Number(audio.duration_seconds)>=20){
        const e=Number(audio.features?.energy_proxy_0_1);
        if(Number.isFinite(e)&&e>=0&&e<=1){
          const target=(cfg.energy[0]+cfg.energy[1]-2)/8;
          const distance=Math.abs(e-target);
          if(distance<=0.25){score+=5;reasons.push('Измеренные акустические признаки подходят (эвристика)');}
          else if(distance>=0.60){score-=5;reasons.push('Акустические признаки отличаются (эвристика)');}
        }
      }

      if(!seed&&!pin){
        // An auto-added track must have track-level identity evidence, never
        // only an artist-level genre guess. Apple confirms song identity, not
        // automatically its narrow genre, energy or mood.
        const apple=t.verified_metadata||{};
        const exactApple=Boolean(/^https:\/\/music\.apple\.com\//i.test(String(apple.url||'')) &&
          apple.title && apple.artist && norm(apple.title)===norm(t.title) && norm(apple.artist)===norm(t.artist));
        const reviewedEvidence=q.auto_evidence_validated===true;
        if(!exactApple&&!reviewedEvidence){reject('auto_missing_exact_track_evidence');continue;}
        reasons.push(exactApple?'Точная идентификация релиза Apple Music':'Ручная проверка доказательств');
        if(!['medium','high'].includes(conf)){reject('auto_low_confidence');continue;}
        if(!has(styles,cfg.preferredStyles)&&!good&&energy===null){reject('auto_no_style_or_mood');continue;}
        if(energy!==null&&(energy<cfg.energy[0]||energy>cfg.energy[1])&&!good){reject('auto_energy_mismatch');continue;}
        if(score<cfg.minAutoScore){reject('auto_score_low');continue;}
      }else if(score<cfg.minSeedScore&&!pin){reject('editorial_seed_mismatch');continue;}
      pool.push({id:t.id,title:t.title,artist:t.artist,score,seed:seed||pin,pin,reasons,key:norm(t.artist)+'|'+norm(t.title),artistKey:norm(t.artist)});
    }
    pool.sort((a,b)=>Number(b.pin)-Number(a.pin)||Number(b.seed)-Number(a.seed)||b.score-a.score||a.id.localeCompare(b.id));
    const chosen=[],keys=new Set(),artistCounts=new Map();let auto=0;
    for(const candidate of pool){
      if(chosen.length>=cfg.targetSize)break;
      if(keys.has(candidate.key)){reject('duplicate');continue;}
      if(!candidate.seed&&auto>=cfg.maxAutoAdds)continue;
      if((artistCounts.get(candidate.artistKey)||0)>=cfg.maxPerArtist&&!candidate.pin){reject('artist_cap');continue;}
      chosen.push(candidate);keys.add(candidate.key);
      artistCounts.set(candidate.artistKey,(artistCounts.get(candidate.artistKey)||0)+1);
      if(!candidate.seed)auto++;
    }
    result.playlists[pid]={track_ids:chosen.map(x=>x.id),count:chosen.length,editorial_count:chosen.filter(x=>x.seed).length,auto_count:auto,explanations:Object.fromEntries(chosen.map(x=>[x.id,{score:x.score,reasons:x.reasons,source:x.seed?'editorial':'auto'}]))};
    result.diagnostics[pid]={candidates:pool.length,accepted:chosen.length,sourceSeeds:seeds.size,autoAdded:auto,rejected:errors};
  }
  return result;
}
window.AWENPlaylistEngine={build,version:'2.0.0'};
})();
