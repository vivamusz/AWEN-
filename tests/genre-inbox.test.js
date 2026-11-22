/* AWEN genre inbox integration tests: node tests/genre-inbox.test.js (Node 20+). */
'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const read=p=>fs.readFileSync(__dirname+'/../'+p,'utf8');
(async()=>{
 const source=read('backend/awen-genre-inbox/src/worker.js');
 const {default:worker,validate,formatText}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const ORIGIN='https://vivamusz.github.io',ADMIN='test-secret-with-at-least-24-chars';
 const rows=new Map();
 const DB={prepare(sql){
  let args=[];
  return {bind(...vals){args=vals;return this;},async run(){
   if(!sql.includes('INSERT OR IGNORE'))throw Error('unexpected query');
   const [submission_id,track_id,title,artist,previous_genre,proposed_genre,proposed_subgenre,note]=args;
   if(!rows.has(submission_id))rows.set(submission_id,{submission_id,track_id,title,artist,previous_genre,proposed_genre,proposed_subgenre,note,submitted_at:'2026-11-23T00:00:00Z',status:'pending'});
   return {success:true};
  },async all(){
   if(!sql.includes('SELECT submission_id'))throw Error('unexpected query');
   const offset=args[0]||0;return {results:[...rows.values()].slice(offset,offset+500)};
  },async first(){return {total:rows.size,pending:rows.size};}
  };
 }};
 const env={DB,ALLOWED_ORIGIN:ORIGIN,AWEN_ADMIN_KEY:ADMIN};
 const payload={submission_id:'awen-test-submission-123456',track_id:'awen-44',title:'Sample Song',artist:'Sample Artist',previous_genre:'Не определён',genre:'House',subgenre:'Deep House',note:'Bass and groove',website:''};
 const call=(path,method='GET',body=null,extra={})=>worker.fetch(new Request('https://awen-inbox.example'+path,{
  method,headers:{Origin:ORIGIN,...(body?{'content-type':'application/json'}:{}),...extra},
  ...(body?{body:JSON.stringify(body)}:{})
 }),env);
 assert.equal(validate(payload).value.track_id,'awen-44');
 assert.ok(validate({...payload,genre:'Not a genre'}).error);
 assert.ok(validate({...payload,website:'spam'}).error);
 const preflight=await call('/api/genre-suggestions','OPTIONS',null,{'access-control-request-headers':'content-type'});
 assert.equal(preflight.status,204);
 assert.equal(preflight.headers.get('access-control-allow-origin'),ORIGIN);
 assert.equal((await call('/api/genre-suggestions','POST',{...payload,genre:'Wrong'})).status,400);
 let response=await call('/api/genre-suggestions','POST',payload);
 assert.equal(response.status,201);
 const receipt=await response.json();
 assert.equal(receipt.ok,true);
 assert.equal(receipt.receipt_id,payload.submission_id);
 assert.equal(receipt.stored,true);
 await call('/api/genre-suggestions','POST',payload);
 assert.equal(rows.size,1,'idempotent submission ID must not duplicate');
 const reject=await worker.fetch(new Request('https://awen-inbox.example/api/genre-suggestions',{
  method:'POST',headers:{Origin:'https://untrusted.example','content-type':'application/json'},body:JSON.stringify(payload)
 }),env);
 assert.equal(reject.status,403,'reject foreign Origin');
 const unauthorized=await call('/admin/export.txt');
 assert.equal(unauthorized.status,401);
 const authorized=await call('/admin/export.txt','GET',null,{authorization:'Bearer '+ADMIN});
 assert.equal(authorized.status,200);
 const txt=await authorized.text();
 assert.match(txt,/AWEN — предложения музыкальных жанров/);
 assert.match(txt,/Sample Song/);
 assert.match(txt,/Deep House/);
 assert.match(txt,/AWEN ID: awen-44/);
 assert.match(formatText([]),/Предложения: 0/);
 const summary=await (await call('/admin/summary','GET',null,{authorization:'Bearer '+ADMIN})).json();
 assert.equal(summary.total,1);
 assert.equal(summary.pending,1);
 const handlers={},notices=[],stored=new Map(),downloads=[],tracks=[{
  id:'awen-44',title:'Sample Song',artist:'Sample Artist',genre:'Не определён',
  subgenres:[],curation_review_needed:true
 }];
 const bridge={getTracks:()=>tracks,getGenreTaxonomy:()=>[{name:'House',styles:['Deep House']}],
  notify:s=>notices.push(s),refresh:()=>{}};
 const win={AWENBridge:bridge,crypto:{randomUUID:()=> 'test-submission-id-1234'},prompt:()=>{}};
 const overlay={hidden:true,innerHTML:'',querySelector:()=>({focus(){}})};
 const doc={
  getElementById:id=>id==='awg-overlay'?overlay:null,
  addEventListener:(name,fn)=>(handlers[name]??=[]).push(fn),
  createElement:()=>({click(){downloads.push('file')},remove(){}}),
  body:{appendChild(){}}
 };
 const storage={getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)};
 let failing=false;
 const siteFetch=async (url,options={})=>{
  if(String(url).startsWith('./awen-genre-inbox-config.json'))return {ok:true,json:async()=>({schema_version:1,api_base_url:'https://awen-inbox.example'})};
  if(failing)throw Error('offline');
  if(String(url).startsWith('https://awen-inbox.example')){
   return worker.fetch(new Request(url,{...options,headers:{...options.headers,Origin:ORIGIN}}),env);
  }
  throw Error('unexpected fetch '+url);
 };
 const frontend=read('awen-genre-contributions.js');
 new Function('window','document','localStorage','navigator','URL','Blob','fetch','AbortController','setTimeout','clearTimeout','console',frontend)(
  win,doc,storage,{},URL,Blob,siteFetch,AbortController,setTimeout,clearTimeout,console);
 const module=win.AWENGenreContributions;
 for(let i=0;i<10&&!module.inboxConfigured();i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(module.inboxConfigured(),true);
 assert.equal(module.save('awen-44','House','Deep House','Bass and groove'),true);
 assert.equal(module.getSuggestion('awen-44').delivery_status,'local');
 let sent=await module.send('awen-44');
 assert.equal(sent,true,'actual API receipt required');
 assert.equal(module.getSuggestion('awen-44').delivery_status,'sent');
 assert.equal(rows.size,2);
 module.save('awen-44','House','Deep House','New edited reason');
 failing=true;
 sent=await module.send('awen-44');
 assert.equal(sent,false,'failed network submission must not count as delivered');
 assert.equal(module.getSuggestion('awen-44').delivery_status,'local');
 assert.match(module.suggestionText('awen-44'),/Только на устройстве/);
 assert.doesNotMatch(frontend,/github\.com\/vivamusz\/AWEN-\/issues\/new/,'visitors must not be directed to GitHub Issues');
 console.log('PASS: anonymous Worker API, origin guards, valid genres, duplicate prevention, secured TXT, private queue, real client receipts and offline fallback');
})().catch(error=>{console.error(error);process.exitCode=1;});
