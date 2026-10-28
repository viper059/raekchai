const {JSDOM,VirtualConsole}=require('jsdom');const fs=require('fs');
const errs=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errs.push(e.message));vc.on('error',e=>errs.push(String(e)));
let html=fs.readFileSync(''+require('path').join(__dirname,'..','index.html')+'','utf8').replace(/<script src="https:\/\/cdn.jsdelivr[^>]*><\/script>/,'');
const rows=[{id:1,kind:'movie',title_th:'หลานม่า',title_en:'How to Make Millions Before Grandma Dies',poster_url:null,release_year:2024,release_month:4,like_count:3,country:'TH',zone:'thai',season_count:0,genres:['ดราม่า'],platforms_th:['Netflix'],platforms_thai_audio:['Netflix']},
 {id:2,kind:'series',title_th:null,title_en:'Squid Game',poster_url:'https://image.tmdb.org/t/p/w342/x.jpg',release_year:2021,release_month:9,like_count:0,country:'KR',zone:'asia',season_count:3,genres:[],platforms_th:[],platforms_thai_audio:[]},
 {id:3,kind:'movie',title_th:'แผลเก่า',title_en:'The Scar',poster_url:null,release_year:1977,release_month:null,like_count:0,country:'TH',zone:'thai',season_count:0,genres:[],platforms_th:[],platforms_thai_audio:[]}];
const detail={id:2,kind:'series',title_th:null,title_en:'Squid Game',title_original:'오징어 게임',release_year:2021,release_month:9,release_source:'broadcast',series_status:'ended',end_year:2025,synopsis_th:null,synopsis_en:'Games.',poster_url:null,like_count:0,
 title_countries:[{country:'KR',is_primary:true,countries:{name_th:'เกาหลีใต้',zone:'asia'}}],title_genres:[{genres:{name_th:'ดราม่า'}}],title_companies:[{billing:0,companies:{name:'Siren'}}],
 title_cast:[{billing:1,character:'B',people:{name_th:null,name_en:'Park'}},{billing:0,character:'A',people:{name_th:null,name_en:'Lee'}}],title_creators:[{role:'creator',people:{name_en:'Hwang'}}],
 title_networks:[{networks:{name:'Netflix'}}],title_platforms:[{region:'TH',offer:'stream',audio_th:'dub',sub_th:true,link:'https://x.test',platforms:{name:'Netflix',logo_url:'https://image.tmdb.org/t/p/w92/n.png'}}],
 seasons:[{season_number:2,release_year:2024,release_month:12,episode_count:7},{season_number:1,release_year:2021,release_month:9,episode_count:9}]};
const calls=[];
function builder(table){const b={_t:table,_f:[]};const chain=['select','eq','neq','contains','in','order','range','limit'];
 chain.forEach(m=>b[m]=(...a)=>{b._f.push([m,...a]);calls.push(table+'.'+m);return b;});
 b.single=()=>Promise.resolve({data:detail,error:null});
 b.then=(res,rej)=>{let data;
   if(table==='genres')data=[{name_th:'ดราม่า'}];else if(table==='platforms')data=[{name:'Netflix'}];
   else if(table==='title_likes')data=[{title_id:1}];else if(table==='title_ranking')data=[rows[0]];
   else data=rows.filter(r=>b._f.every(f=>f[0]!=='eq'||f[1]==='region'||r[f[1]]===f[2]));
   return Promise.resolve({data,error:null,count:data.length}).then(res,rej);};
 return b;}
let authCb;
const sb={from:builder,rpc:(fn,args)=>{calls.push('rpc.'+fn);if(fn==='toggle_like')return Promise.resolve({data:[{liked:true,like_count:4}],error:null});
   if(fn==='trending_titles')return Promise.resolve({data:[{title_id:1,recent_likes:2}],error:null});return builder('rpc:'+fn);},
 auth:{onAuthStateChange:cb=>{authCb=cb;},signInWithOtp:async()=>({error:null}),signOut:async()=>authCb('SIGNED_OUT',null)}};
const d=new JSDOM(html,{runScripts:'dangerously',virtualConsole:vc,url:'https://viper059.github.io/raekchai/',beforeParse(w){w.supabase={createClient:()=>sb};}});
const w=d.window,doc=w.document;const tick=()=>new Promise(r=>setTimeout(r,30));
(async()=>{
 await tick();
 console.log('years:',[...doc.querySelectorAll('.year-label')].map(e=>e.firstChild.textContent).join(','),'| count:',doc.querySelector('#count').textContent,'| cards:',doc.querySelectorAll('.ticket').length);
 console.log('no-month group:',!!doc.body.textContent.includes('ไม่ระบุเดือน'),'| options:',doc.querySelectorAll('#genre option').length,doc.querySelectorAll('#platform option').length);
 doc.querySelector('[data-kind=series]').click();await tick();console.log('series filter cards:',doc.querySelectorAll('.ticket').length);
 doc.querySelector('[data-kind=all]').click();await tick();
 doc.querySelector('.ticket[data-id="2"]').click();await tick();
 const dr=doc.querySelector('#drawer').textContent.replace(/\s+/g,' ');
 console.log('drawer has seasons in order:',/ซีซัน 1.*ซีซัน 2/.test(dr),'| cast order Lee first:',dr.indexOf('Lee')<dr.indexOf('Park'),'| dub:',dr.includes('พากย์ไทย'));
 doc.querySelector('#drawer [data-like]').click();await tick();
 console.log('like while signed out → login open:',!doc.querySelector('#login').hidden);
 doc.querySelector('#login-email').value='a@b.co';doc.querySelector('#login-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
 console.log('login msg:',doc.querySelector('#login-msg').textContent.slice(0,40));
 authCb('SIGNED_IN',{user:{id:'u1',email:'a@b.co'}});await tick();
 console.log('account:',doc.querySelector('#account').textContent.trim().slice(0,30),'| modal closed:',doc.querySelector('#login').hidden);
 doc.querySelector('#drawer [data-like]').click();await tick();
 console.log('liked → pressed:',doc.querySelector('#drawer [data-like]').getAttribute('aria-pressed'),'count',doc.querySelector('#drawer [data-like] span').textContent);
 doc.querySelector('#close').click();
 doc.querySelector('#tab-ranking').click();await tick();console.log('ranking rows:',doc.querySelectorAll('.rank-row').length);
 doc.querySelector('[data-period="30"]').click();await tick();console.log('trending rows:',doc.querySelectorAll('.rank-row').length, doc.querySelector('.rank-row .sub').textContent);
 doc.querySelector('#tab-timeline').click();
 const q=doc.querySelector('#q');q.value='nolan';q.dispatchEvent(new w.Event('input'));await new Promise(r=>setTimeout(r,400));
 console.log('search used rpc:',calls.includes('rpc.search_titles'));
 doc.querySelector('#audio').value='sub';doc.querySelector('#audio').dispatchEvent(new w.Event('change'));await tick();
 console.log('sub filter used title_platforms:',calls.some(c=>c.startsWith('title_platforms')));
 console.log('errors:',errs.length?errs:'none');
})();
