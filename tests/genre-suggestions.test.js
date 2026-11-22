/* Run: node tests/genre-suggestions.test.js */
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const read=n=>fs.readFileSync(__dirname+'/../'+n,'utf8');
const handlers={},saved=new Map(),feedback=[],opened=[];
const overlay={hidden:true,innerHTML:'',querySelector:()=>({focus(){}})};
const document={addEventListener:(name,fn)=>(handlers[name]??=[]).push(fn),
 getElementById:id=>id==='awg-overlay'?overlay:null};
const storage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)};
const original=[
 {id:'awen-1',title:'Unassigned',artist:'Artist <Test>',genre:'Не определён',subgenres:[],curation_review_needed:true},
 {id:'awen-2',title:'Pop Song',artist:'Another',genre:'Pop',subgenres:['Indie Pop'],curation_review_needed:false},
 {id:'awen-3',title:'Album header',artist:'Artist',genre:'Не определён',import_review_needed:true,subgenres:[]}
];
let tracks=JSON.parse(JSON.stringify(original)),rendered=0;
const window={open:(url)=>opened.push(url),prompt:()=>{},AWENBridge:{
 getTracks:()=>tracks,
 getGenreTaxonomy:()=>[{name:'Pop',styles:['Indie Pop','Dance Pop']},{name:'House',styles:['Deep House','Tech House']}],
 refresh:()=>rendered++,
 notify:msg=>feedback.push(msg)
}};
vm.runInNewContext(read('awen-genre-contributions.js'),{window,document,localStorage:storage,navigator:{},URLSearchParams,console});
const m=window.AWENGenreContributions;
assert.ok(m,'genre contribution module loaded');
assert.equal(m.valid({genre:'House',subgenre:'Deep House'}),true);
assert.equal(m.valid({genre:'House',subgenre:'Dance Pop'}),false,'subgenre must belong to chosen genre');
assert.equal(m.save('awen-1','House','Dance Pop'),false,'reject invalid genre/subgenre combination');
assert.equal(m.save('awen-3','House','Deep House'),false,'reject quarantine entries');
assert.equal(m.save('awen-1','House','Deep House'),true);
assert.equal(tracks[0].genre,'House','local genre is reflected in current display');
assert.deepEqual(Array.from(tracks[0].subgenres),['Deep House']);
assert.equal(tracks[0].genre_source,'Выбрано вами — только на этом устройстве');
assert.equal(tracks[0].awen_local_original.genre,'Не определён','original global genre kept');
assert.equal(m.getCount(),1);
assert.match(m.issueURL('awen-1'),/github\.com\/vivamusz\/AWEN-\/issues\/new/);
assert.match(m.issueURL('awen-1'),/awen-1/);
assert.match(m.suggestionText('awen-1'),/требует проверки редактором/i);
const fresh=JSON.parse(JSON.stringify(original));
m.apply(fresh);
assert.equal(fresh[0].genre,'House','local edit restored after catalog reload');
m.open('awen-1');
assert.equal(overlay.hidden,false);
assert.match(overlay.innerHTML,/&lt;Test&gt;/,'artist escaped in dialog');
assert.match(overlay.innerHTML,/Поджанр/);
assert.match(overlay.innerHTML,/Отправить на проверку/);
assert.equal(m.reset('awen-1'),true);
assert.equal(tracks[0].genre,'Не определён','undo restores original global genre');
assert.equal(m.getCount(),0);
assert.equal(saved.get('awen-genre-suggestions-v1').includes('"items":{}'),true);
const site=read('index.html');
assert.match(site,/isOtherGenre\(t\)/);
assert.match(site,/otherCategory=\{name:'Другие'/);
assert.match(site,/getGenreTaxonomy:\(\)=>genres/);
assert.match(site,/data-awg-action="open"/);
assert.match(site,/awen-genre-contributions\.css\?v=/);
assert.match(site,/awen-genre-contributions\.js\?v=/);
assert.match(read('awen-services.js'),/AWENGenreContributions\.apply\(tracks\)/);
const mobile=read('awen-genre-contributions.css');
assert.match(mobile,/\.genre-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
assert.match(mobile,/data-nav="genres"/);
console.log('PASS: Other genre, local overrides, taxonomy validation, restore, moderator link, modal XSS, mobile layout');
