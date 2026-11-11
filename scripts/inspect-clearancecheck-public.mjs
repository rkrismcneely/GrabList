// Read-only research of *public* HTML and JavaScript only.
// Never send SKU lookup requests, fetch auth/session data, or probe unlisted paths.
// Report public code structure/URL templates without copying whole bundles.
const origin='https://www.clearancecheck.ca';
const targets=['/pricecheck','/?retailer=nofrills&store=3142'];
const allowed=new Set(['www.clearancecheck.ca','clearancecheck.ca']);
const printed=new Set();
const log=(...x)=>console.log(...x);
async function safeGet(url,max=1_800_000){
  const u=new URL(url,origin);
  if(u.protocol!=='https:'||!allowed.has(u.hostname))throw Error('Disallowed source '+u.origin);
  const response=await fetch(u,{method:'GET',redirect:'manual',headers:{Accept:'text/html,application/javascript,text/javascript,*/*'},signal:AbortSignal.timeout(18000)});
  log('FETCH',u.href,'STATUS',response.status,'TYPE',response.headers.get('content-type'),'LENGTH',response.headers.get('content-length'));
  if(!response.ok)return null;
  const length=Number(response.headers.get('content-length')||0);
  if(length>max){log('SKIP_TOO_LARGE',length);return null;}
  const txt=await response.text();
  return txt.length<=max?txt:null;
}
function snippets(label,text,maxCount=50){
  const matchers=[/price\s*check/ig,/pricecheck/ig,/\bcheckstores\b/ig,
    /\/api\/[^"' \`<>()\\]{3,180}/ig,/\/v\d+\/[^"' \`<>()\\]{4,180}/ig,
    /graphql/ig,/inventory/ig,/stocklookup/ig,/skuLookup/ig,/getPrices/ig,
    /fetch\s*\(/g];
  let count=0;
  for(const re of matchers){
    let m;
    while((m=re.exec(text))&&count<maxCount){
      const from=Math.max(0,m.index-135),to=Math.min(text.length,m.index+220);
      const excerpt=text.slice(from,to).replace(/[\r\n\t]+/g,' ').replace(/\s{2,}/g,' ');
      const key=label+':'+Math.floor(m.index/200);
      if(printed.has(key))continue;
      printed.add(key);count++;
      log('SNIPPET',label,m.index,excerpt.slice(0,355));
    }
  }
  log('SNIPPET_COUNT',label,count);
}
function scriptSources(html){
  const matches=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  log('SCRIPT_TAG_COUNT',matches.length);
  const targets=[];
  for(const [index,m] of matches.entries()){
    const attrs=m[1],src=attrs.match(/\bsrc\s*=\s*(["'])(.*?)\1/i)?.[2];
    if(src){
      try{
        const parsed=new URL(src,origin);
        log('SCRIPT',index,parsed.href,allowed.has(parsed.hostname)?'first-party':'third-party');
        if(allowed.has(parsed.hostname)&&targets.length<18)targets.push(parsed.href);
      }catch(e){log('BAD_SCRIPT_SRC',String(e))}
    }else if(m[2].length>100){log('INLINE_SCRIPT',index,'LENGTH',m[2].length);snippets('inline-'+index,m[2],18);}
  }
  return targets;
}
const js=new Set();
for(const path of targets){
  try{
    const html=await safeGet(path,2_000_000);
    if(!html)continue;
    log('HEAD',path,html.slice(0,550).replace(/\s+/g,' '));
    const scripts=scriptSources(html);
    for(const src of scripts)js.add(src);
    const links=[...html.matchAll(/<(?:link|script)\b[^>]*(?:href|src)=['"]([^'"]+)['"]/gi)];
    log('ASSET_LINKS',path,links.slice(0,25).map(m=>m[1]));
    snippets('html-'+path,html,24);
  }catch(e){log('FETCH_FAILED',path,String(e))}
}
for(const url of [...js].slice(0,18)){
  try{
    const script=await safeGet(url,1_800_000);
    if(script)snippets('js-'+new URL(url).pathname,script,80);
  }catch(e){log('SCRIPT_FAILED',url,String(e))}
}
log('RESEARCH_FINISHED');
