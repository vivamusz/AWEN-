/* AWEN My Playlists regression tests. Run: node tests/my-playlists.test.js */
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const read=n=>fs.readFileSync(__dirname+'/../'+n,'utf8');
const script=read('awen-my-playlists.js'),coreSrc=read('awen-discovery-core.js');
const track=(id,title)=>({id,title,artist:'AWEN Artist',genre:'Pop',subgenres:['Indie Pop']});
const sample=[track('awen-1','First'),track('awen-2','Second'),track('awen-3','Third')];
function browser(share='',reuse){
 const stored=reuse||new Map(),listeners={},messages=[],focus=[],downloaded=[];
 const els={
  'mpl-picker-overlay':{hidden:true,innerHTML:''},
  'mpl-picker-name':{focus(){focus.push('picker');}},
  'mpl-create-name':{focus(){focus.push('create');}},
  'mpl-backup-import':{click(){messages.push('import-click');}}
 };
 const location='https://vivamusz.github.io/AWEN-/'+(share?'?awen_pl='+share:'');
 const window={location:{href:location},confirm:()=>true,prompt:()=>null};
 const fakeDocument={
  getElementById:id=>els[id]||null,
  addEventListener:(kind,handler)=>(listeners[kind]??=[]).push(handler),
  body:{appendChild(){}},
  createElement:tag=>({click(){downloaded.push(tag);},remove(){},href:'',download:''})
 };
 const storage={getItem:k=>stored.get(k)||null,setItem:(k,val)=>stored.set(k,val)};
 window.AWENBridge={getTracks:()=>sample,getView:()=>'myplaylists',refresh(){},openMyPlaylists(){},
  notify:text=>messages.push(text),openDetails:id=>messages.push('details:'+id)};
 const clipboard=[];
 const nav={clipboard:{writeText:async text=>clipboard.push(text)}};
 const ctx={window,document:fakeDocument,localStorage:storage,navigator:nav,console,URL,Blob,setTimeout,btoa,atob};
 vm.runInNewContext(coreSrc,ctx);
 vm.runInNewContext(script,ctx);
 const click=(action,attrs={})=>listeners.click[0]({target:{closest:()=>({dataset:{myplAction:action,...attrs}})},preventDefault(){},stopPropagation(){}});
 const submit=(id,value)=>listeners.submit[0]({target:{id,querySelector:()=>({value})},preventDefault(){}});
 return {p:window.AWENMyPlaylists,window,els,listeners,messages,focus,clipboard,stored,click,submit,downloaded};
}
(async()=>{
 const b=browser(),p=b.p;
 assert.equal(p.getLists().length,0,'starts without private playlists');
 assert.match(p.render(),/Мои плейлисты/);
 b.click('create-open');
 assert.match(p.render(),/mpl-create-form/,'creation form is accessible');
 b.submit('mpl-create-form','Вечерние <хиты>');
 const id=p.getLists()[0].id;
 assert.ok(id,'new playlist created');
 assert.match(p.render(),/&lt;хиты&gt;/,'name escaped against HTML injection');
 p.openPicker('awen-1');
 assert.match(b.els['mpl-picker-overlay'].innerHTML,/Создать и добавить/);
 b.click('pick-list',{listId:id});
 assert.deepEqual(Array.from(p.getLists()[0].track_ids),['awen-1']);
 p.add(id,'awen-2');p.add(id,'awen-2');
 assert.deepEqual(Array.from(p.getLists()[0].track_ids),['awen-1','awen-2'],'no duplicates');
 p.move(id,'awen-2',-1);
 assert.deepEqual(Array.from(p.getLists()[0].track_ids),['awen-2','awen-1']);
 p.rename(id,'Дорога домой');
 assert.equal(p.getLists()[0].name,'Дорога домой');
 p.openList(id);
 p.remove(id,'awen-1');
 assert.deepEqual(Array.from(p.getLists()[0].track_ids),['awen-2']);
 const reloaded=browser('',b.stored);
 assert.equal(reloaded.p.getLists()[0].name,'Дорога домой','persists across reloads');
 assert.deepEqual(Array.from(reloaded.p.getLists()[0].track_ids),['awen-2']);
 const backup={schema_version:1,kind:'AWEN_MY_PLAYLISTS',lists:[{id:'pl-from-backup',name:'Микс с отсутствующим треком',track_ids:['awen-1','awen-404']}]};
 await p.importBackup({size:450,text:async()=>JSON.stringify(backup)});
 const imported=p.getLists().find(x=>x.id==='pl-from-backup');
 assert.deepEqual(Array.from(imported.track_ids),['awen-1','awen-404'],'missing ID must remain intact');
 p.openList(imported.id);
 assert.match(p.render(),/awen-404/);
 assert.match(p.render(),/Трек недоступен/);
 let badFailed=false;
 try{p.decodeBackup({schema_version:1,lists:[{id:'evil!',name:'bad',track_ids:[]}]});}catch{badFailed=true;}
 assert.equal(badFailed,true,'reject unsafe identifiers');
 const shared=b.window.AWENDiscoveryCore.encodeMix('Наш общий микс',['awen-1','awen-2']);
 const recipient=browser(shared);
 assert.equal(recipient.p.getLists().length,0,'incoming link must not auto-save');
 assert.match(recipient.p.render(),/Получена подборка/);
 recipient.click('save-shared');
 assert.equal(recipient.p.getLists().length,1,'explicit import saves list');
 assert.equal(recipient.p.getLists()[0].name,'Наш общий микс');
 assert.deepEqual(Array.from(recipient.p.getLists()[0].track_ids),['awen-1','awen-2']);
 assert.ok(read('index.html').includes("['myplaylists','Мои плейлисты']"));
 assert.ok(read('index.html').includes('data-mypl-action="add"'));
 assert.ok(read('index.html').includes('awen-my-playlists.js?v='));
 assert.ok(read('awen-discovery-ui.js').includes("data-mypl-action"));
 p.deletePlaylist(id);
 assert.ok(!p.getLists().some(x=>x.id===id),'delete only removes user playlist');
 console.log('PASS: My Playlists CRUD, ordering, saving, local persistence, backup, XSS, shared-link consent, catalog integration');
})().catch(error=>{console.error(error);process.exitCode=1;});

