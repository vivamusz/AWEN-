/* Run: node tests/discovery-core.test.js (Node 18+) */
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const read=n=>fs.readFileSync(__dirname+'/../'+n,'utf8');
const root={};vm.runInNewContext(read('awen-discovery-core.js'),{window:root,btoa,atob});
const D=root.AWENDiscoveryCore;
assert.ok(D&&D.version,'Discovery core must load');
const tracks=Array.from({length:50},(_,i)=>({
 id:'awen-'+(i+1),title:'Track '+i,artist:'Artist '+i,
 genre:i%5===0?'Phonk':i%5===1?'House':i%5===2?'Pop':i%5===3?'Chill / Lo-Fi / Ambient':'Hip-Hop / Rap',
 subgenres:[i%5===1?'Deep House':i%5===0?'Chill Phonk':'Indie Pop'],
 moods:[i%5===3?'Спокойное':'Танцевальное'],
 year:2010+i%10,language:i%2?'English':'Русский',awen_quality:{editorial_energy:1+i%5},
 awen_audio_features:i===1?{tempo_bpm_estimate:120}:null
}));
const state={boostGenres:[],excludeGenres:[],excludedArtists:[],dislikes:[],plays:[],seen:[],novelty:60,hideVerifiedAI:false};
const ctx={tracks,likes:[],state,provenance:{tracks:{}}};
assert.equal(D.dateKey(new Date(2026,10,22)),'2026-11-22');
assert.equal(D.daypart(new Date(2026,10,22,7)).key,'morning');
assert.equal(D.daypart(new Date(2026,10,22,20)).key,'evening');
assert.equal(D.daypart(new Date(2026,10,22,1)).key,'night');
assert.equal(D.daylist(ctx,new Date(2026,10,22,20)).items.length,25);
assert.equal(D.discovery(ctx,new Date(2026,10,22)).items.length,10);
assert.equal(D.radio(ctx,'awen-2').items.length,9);
assert.ok(D.radio(ctx,'awen-2').items.every(x=>x.track.id!=='awen-2'));
state.excludeGenres=['Phonk'];
assert.ok(D.rank(tracks,ctx,{count:30}).every(x=>x.track.genre!=='Phonk'));
state.excludeGenres=[];
state.dislikes=['awen-3'];ctx.likes=['awen-4'];state.seen=['awen-5'];state.plays=[{id:'awen-6',at:'2026-11-22T10:00:00Z'}];
const daily=D.discovery(ctx,new Date(2026,10,22)).items.map(x=>x.track.id);
assert.ok(!daily.some(id=>['awen-3','awen-4','awen-5','awen-6'].includes(id)));
const parsed=D.parsePrompt('25 спокойных песен для вечерней дороги без рэпа, преимущественно 2010-х');
assert.equal(parsed.count,25);
assert.equal(parsed.yearFrom,2010);
assert.equal(parsed.yearTo,2019);
assert.ok(parsed.exclude.includes('Hip-Hop / Rap'));
const results=D.prompted(ctx,'25 спокойных песен для вечерней дороги без рэпа, 2010-х');
assert.ok(results.items.length>0);
assert.ok(results.items.every(x=>x.track.year>=2010&&x.track.year<=2019&&x.track.genre!=='Hip-Hop / Rap'));
assert.equal(D.decodeMix(D.encodeMix('Әуен тест',['awen-1','awen-2','awen-1'])).name,'Әуен тест');
assert.deepEqual(Array.from(D.decodeMix(D.encodeMix('Hello',['awen-1','awen-2'])).ids),['awen-1','awen-2']);
assert.equal(D.decodeMix('<script>alert(1)</script>'),null);
assert.equal(D.decodeMix('x'.repeat(5000)),null);
const verified={tracks:{'awen-1':{status:'fully_ai',verified:true,evidence_url:'https://example.org/record'},'awen-2':{status:'fully_ai',verified:false,evidence_url:'https://example.org/no'}}};
state.hideVerifiedAI=true;ctx.provenance=verified;
assert.ok(!D.eligible(tracks[0],ctx));
assert.ok(D.eligible(tracks[1],ctx));
state.hideVerifiedAI=false;
const annual=D.stats(ctx,2026);
assert.equal(annual.plays,1);assert.equal(annual.unique,1);
const order=D.smartOrder(tracks.slice(0,10));
assert.equal(order.length,10);
assert.equal(new Set(order.map(x=>x.track.id)).size,10);
assert.equal(D.bpm(tracks[1]),120);
assert.equal(D.energy({awen_quality:{editorial_energy:null}}),null);
const site=read('index.html');
assert.match(site,/awen-discovery-core\.js\?v=/);
assert.match(site,/awen-discovery-ui\.js\?v=/);
assert.match(site,/awen-discovery\.css\?v=/);
assert.match(site,/\['discover','Открытия'\]/);
assert.match(site,/window\.AWENBridge=/);
assert.match(site,/AWENDiscoveryUI\.observePlayback/);
const registry=JSON.parse(read('awen-ai-provenance.json'));
assert.equal(registry.schema_version,1);
console.log('PASS: 12 discovery capabilities, AI evidence gate, share links, listening hook and navigation');

