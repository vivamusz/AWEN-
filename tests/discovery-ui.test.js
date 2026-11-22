/* Run: node tests/discovery-ui.test.js (Node 18+; no browser dependencies) */
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const read=name=>fs.readFileSync(__dirname+'/../'+name,'utf8');
const listeners={},els={},saved=new Map(),messages=[],favs=[],downloads=[];
const tracks=Array.from({length:45},(_,i)=>({id:'awen-'+(i+1),title:'Track '+i,artist:'Artist '+i,
 genre:['Pop','House','Chill / Lo-Fi / Ambient','Phonk','R&B / Soul'][i%5],
 subgenres:['Indie Pop','Deep House','Chillout','Chill Phonk','Neo Soul'].slice(i%5,i%5+1),
 moods:['Спокойное'],year:2010+i%10,language:i%2?'English':'Русский',awen_quality:{editorial_energy:2+i%3}}));
const storage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)};
const ctx2d={createLinearGradient:()=>({addColorStop(){}}),fillRect(){},beginPath(){},arc(){},fill(){},
 moveTo(){},bezierCurveTo(){},stroke(){},fillText(){}};
const document={addEventListener:(type,fn)=>{(listeners[type]??=[]).push(fn);},
 getElementById:id=>els[id]||null,
 createElement:tag=>tag==='canvas'?{width:0,height:0,getContext:()=>ctx2d,toDataURL:()=>'data:image/png;base64,AAA'}:{click(){downloads.push(tag)}}};
const window={
 location:{href:'https://vivamusz.github.io/AWEN-/'},
 confirm:()=>true,
 prompt:(...args)=>messages.push(['prompt',...args])
};
window.AWENBridge={getTracks:()=>tracks,getFavorites:()=>favs,getView:()=>'discover',
 refresh:()=>window.AWENDiscoveryUI.render(),openDiscover:()=>{},
 notify:m=>messages.push(['notice',m]),
 openDetails:id=>messages.push(['detail',id]),
 toggleFavorite:id=>{const i=favs.indexOf(id);i<0?favs.push(id):favs.splice(i,1);}
};
const navigator={clipboard:{writeText:async s=>messages.push(['clipboard',s])}};
const fetch=async()=>({ok:false});
vm.runInNewContext(read('awen-discovery-core.js'),{window,btoa,atob});
vm.runInNewContext(read('awen-discovery-ui.js'),{window,document,localStorage:storage,navigator,fetch,URL,console});
assert.ok(window.AWENDiscoveryUI);
const press=(action,data={})=>listeners.click[0]({target:{closest:()=>({dataset:{adAction:action,...data}})},preventDefault(){}});
assert.match(window.AWENDiscoveryUI.render(),/10 открытий дня/);
for(const tab of ['start','radio','taste','prompt','mix','stats']){
 press('tab',{tab});
 assert.ok(window.AWENDiscoveryUI.render().length>100,'Tab renders '+tab);
}
press('boost',{genre:'Pop'});
press('exclude',{genre:'Phonk'});
press('lang-boost',{language:'Қазақша'});
press('dislike',{id:'awen-2'});
press('block-artist',{artist:'Artist 4'});
let s=window.AWENDiscoveryUI.getState();
assert.ok(s.boostGenres.includes('Pop')&&s.excludeGenres.includes('Phonk')&&s.boostLanguages.includes('Қазақша'));
assert.ok(s.dislikes.includes('awen-2')&&s.excludedArtists.includes('Artist 4'));
press('radio',{id:'awen-6'});
assert.match(window.AWENDiscoveryUI.render(),/Радио: Track 5/);
press('tab',{tab:'prompt'});
els['ad-prompt']={value:'25 спокойных песен для вечерней дороги без рэпа, 2010-х'};
press('generate-prompt');
assert.match(window.AWENDiscoveryUI.render(),/2010–2019/);
press('tab',{tab:'mix'});
press('mix-add',{id:'awen-2'});
assert.equal(window.AWENDiscoveryUI.getState().draft.ids.length,1);
press('mix-sort');
press('mix-share');
press('tab',{tab:'stats'});
window.AWENDiscoveryUI.beginPlayback('awen-1');
for(let t=0;t<35;t++)window.AWENDiscoveryUI.observePlayback('awen-1',t,200,false);
assert.equal(window.AWENDiscoveryUI.getState().plays.length,1,'Count real playback only');
press('download-recap');
assert.ok(downloads.length===1,'PNG download should trigger anchor');
assert.ok(saved.has('awen-discovery-local-v1'),'Local preferences stored');
assert.match(window.AWENDiscoveryUI.render(),/Подтверждённых прослушиваний/);
console.log('PASS: discovery UI tabs, reactions, radio, prompt, shared mix, playback and PNG export');

