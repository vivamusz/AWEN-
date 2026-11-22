/* Run: node tests/playlist-engine.test.js (Node 18+). No packages needed. */
'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const read=file=>fs.readFileSync(__dirname+'/../'+file,'utf8');
const window={};
vm.runInNewContext(read('awen-playlist-engine.js'),{window});
const build=window.AWENPlaylistEngine.build;
const settings=JSON.parse(read('awen-playlist-profiles.json'));
const row=(id,title,artist,genre,style,energy,quality={})=>({
  id,title,artist,genre,subgenres:style?[style]:[],moods:['Спокойное'],
  awen_quality:{genre_confidence:'medium',editorial_energy:energy,...quality}
});
const fixtures=[
  row('seed-ok','Soft Track','Seed Artist','Pop','Indie Pop',2),
  row('duplicate-1','Same Title','Duplicate Artist','Pop','Indie Pop',2),
  row('duplicate-2','Same Title','Duplicate Artist','Pop','Indie Pop',2),
  {...row('bad-import','Bad media','Imported','Pop','Indie Pop',2),import_review_needed:true},
  row('unknown-seed','Unknown','Mystery','Не определён','',2),
  row('outside-seed','Tech House Set','House Music','House','Tech House',4),
  row('auto-unverified','Guess Track','No Source','Pop','Indie Pop',2),
  {...row('auto-verified','Verified Track','Apple Artist','Pop','Indie Pop',2),
    verified_metadata:{url:'https://music.apple.com/test-track',title:'Verified Track',artist:'Apple Artist'}},
  {...row('auto-wrong-artist','Other Track','True Artist','Pop','Indie Pop',2),
    verified_metadata:{url:'https://music.apple.com/wrong',title:'Other Track',artist:'Wrong Artist'}},
  {...row('auto-low-confidence','Low Confidence','Apple 2','Pop','Indie Pop',2,{genre_confidence:'low'}),
    verified_metadata:{url:'https://music.apple.com/low',title:'Low Confidence',artist:'Apple 2'}},
  row('phonk-calm','Calm Phonk','Night Artist','Phonk','Atmospheric Phonk',2),
  row('phonk-aggressive','Drift Phonk','Drift Artist','Phonk','Drift Phonk',5),
  ...Array.from({length:7},(_,i)=>row('artist-'+i,'Track '+i,'One Artist','Pop','Indie Pop',2))
];
const fixtureManifest={playlists:{
  road:{track_ids:['seed-ok','duplicate-1','duplicate-2','bad-import','unknown-seed','outside-seed',
    ...Array.from({length:7},(_,i)=>'artist-'+i)]},
  night:{track_ids:['phonk-calm','phonk-aggressive']},
  nightplus:{track_ids:['phonk-calm','phonk-aggressive']}
}};
const test=build(fixtures,fixtureManifest,settings);
const road=test.playlists.road.track_ids;
assert.ok(road.includes('seed-ok'),'Editor-approved seed should stay');
assert.ok(road.includes('auto-verified'),'Exact Apple record should be eligible');
assert.ok(!road.includes('auto-unverified'),'Artist-based guesses must NOT enter automatically');
assert.ok(!road.includes('auto-wrong-artist'),'Wrong Apple artist must fail exact match');
assert.ok(!road.includes('auto-low-confidence'),'Low-confidence auto tracks must be rejected');
for(const id of ['bad-import','unknown-seed','outside-seed'])assert.ok(!road.includes(id),'Unsafe seed excluded: '+id);
assert.equal(['duplicate-1','duplicate-2'].filter(id=>road.includes(id)).length,1,'Deduplicate artist/title');
assert.equal(Array.from({length:7},(_,i)=>'artist-'+i).filter(id=>road.includes(id)).length,5,'Per-artist cap');
assert.ok(test.playlists.night.track_ids.includes('phonk-calm'),'Calm Phonk belongs in night');
assert.ok(!test.playlists.night.track_ids.includes('phonk-aggressive'),'Drift Phonk excluded from night');
assert.ok(test.playlists.nightplus.track_ids.includes('phonk-aggressive'),'Drift Phonk belongs in night+');
assert.ok(!test.playlists.nightplus.track_ids.includes('phonk-calm'),'Calm Phonk excluded from night+');

const catalog=JSON.parse(read('awen-catalog.json')).tracks;
const curation=JSON.parse(read('awen-curation.json')).tracks;
const editorial=JSON.parse(read('awen-playlists.json'));
const tracks=catalog.map(t=>{
 const p=curation[t.id]||{};
 return {...t,genre:p.genre||t.genre,subgenres:p.subgenres||t.subgenres||[],moods:p.moods||t.moods||[],
   verified_metadata:p.verified_metadata||null,import_review_needed:Boolean(t.import_review_needed||p.potential_import_error),
   entry_type:p.entry_type,entry_type_review_needed:Boolean(p.entry_type_review_needed),
   awen_quality:{genre_confidence:p.curation_confidence||'none',genre_review_needed:Boolean(p.review_needed),
     editorial_energy:p.energy!==undefined&&p.energy!==null&&Number.isFinite(Number(p.energy))?Number(p.energy):null,
     auto_evidence_validated:p.auto_evidence_validated===true}};
});
const ranked=build(tracks,editorial,settings),lookup=new Map(tracks.map(t=>[t.id,t]));
const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
for(const [id,entry] of Object.entries(ranked.playlists)){
 const seen=new Set(),artistCounts=new Map();
 for(const trackId of entry.track_ids){
   const t=lookup.get(trackId);
   assert.ok(t&&!t.import_review_needed&&!t.entry_type&&!t.entry_type_review_needed,'Valid catalog track: '+trackId);
   assert.ok(t.genre&&t.genre!=='Не определён','Known genre: '+trackId);
   const key=norm(t.artist)+'|'+norm(t.title),a=norm(t.artist);
   assert.ok(!seen.has(key),'No duplicate artist/title: '+key);
   seen.add(key);artistCounts.set(a,(artistCounts.get(a)||0)+1);
   assert.ok(artistCounts.get(a)<=settings.playlists[id].maxPerArtist,'Artist limit: '+id);
   assert.ok(entry.explanations[trackId],'Explanation available: '+trackId);
   if(entry.explanations[trackId].source==='auto'){
     const vm=t.verified_metadata||{};
     const exact=Boolean(/^https:\/\/music\.apple\.com\//i.test(vm.url||'')&&norm(vm.title)===norm(t.title)&&norm(vm.artist)===norm(t.artist));
     assert.ok(exact||t.awen_quality.auto_evidence_validated,'Auto track has exact recording identity: '+trackId);
   }
 }
 assert.equal(entry.track_ids.length,entry.count,'Playlist count accurate: '+id);
}
console.log('PASS: playlist engine fixture and complete catalog invariants',
  Object.fromEntries(Object.entries(ranked.playlists).map(([id,p])=>[id,{total:p.count,auto:p.auto_count}])));

