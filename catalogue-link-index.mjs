// Read-only, deployment-bundled index of published retailer product URLs.
// Constructed from the existing approved catalogue shard manifests. Unlike
// owner-only D1 imports, this does not require a write key or modify D1.
const PARTS=8,MAX_BYTES=260000,VERSION='2026-11-08';
const HOSTS={
 walmart:new Set(['walmart.ca','www.walmart.ca']),
 nofrills:new Set(['nofrills.ca','www.nofrills.ca']),
 freshco:new Set(['freshco.com','www.freshco.com']),
 independent:new Set(['yourindependentgrocer.ca','www.yourindependentgrocer.ca']),
 costco:new Set(['costco.ca','www.costco.ca']),
 gianttiger:new Set(['gianttiger.com','www.gianttiger.com'])
};
let cached=null,loading=null;
function clean(v,max=190){return typeof v==='string'?v.trim().slice(0,max):'';}
function safe(record){
 if(!Array.isArray(record)||record.length!==7)return null;
 const [masterId,key,retailer,name,brand,size,rawUrl]=record;
 if(!/^[a-z0-9_-]{1,100}$/i.test(masterId)||!key.startsWith(retailer+'|online|')||
    !HOSTS[retailer]||!clean(name,200)||!clean(rawUrl,1500))return null;
 try{
   const u=new URL(rawUrl);
   if(u.protocol!=='https:'||u.username||u.password||u.port||!HOSTS[retailer].has(u.hostname.toLowerCase()))return null;
   if(retailer==='gianttiger'&&!/^\/products\/[a-z0-9%._-]+\/?$/i.test(u.pathname))return null;
   if(retailer==='freshco'&&!u.pathname.startsWith('/products/'))return null;
   if((retailer==='nofrills'||retailer==='independent')&&!u.pathname.includes('/p/'))return null;
   if(retailer==='walmart'&&!u.pathname.includes('/ip/'))return null;
   const sizeHint=clean(size,55) || (name.match(/\b\d+(?:[.,]\d+)?\s*(?:kg|g|ml|l|lb|lbs|oz|ct|count|pk|pack)\b/i)||[])[0] || '';
   return {key,productId:masterId,retailer,branchId:'online',productName:clean(name,190),
    masterName:'',brand:clean(brand,75),size:sizeHint,barcode:'',
    url:u.href,priceCents:null,source:null,scope:'online_unverified',status:'unavailable',
    observedAt:null,lastError:null};
 }catch{return null;}
}
export async function loadQuickLinks(assets,origin){
 if(cached&&Date.now()-cached.at<15*60*1000)return cached;
 if(loading)return loading;
 if(!assets||typeof assets.fetch!=='function')throw Error('Catalogue link assets binding missing');
 loading=(async()=>{
   const parts=await Promise.all(Array.from({length:PARTS},async(_,i)=>{
     const url=new URL('/data/quick-links/'+String(i).padStart(2,'0')+'.json',origin);
     const response=await assets.fetch(new Request(url));
     if(!response.ok)throw Error('Retailer link index part '+i+' is not deployed');
     const text=await response.text();
     if(text.length>MAX_BYTES)throw Error('Retailer link index part too large');
     let data;
     try{data=JSON.parse(text);}catch{throw Error('Retailer link index invalid JSON part '+i)}
     if(data?.version!==VERSION||data.scope!=='online_unverified'||!Array.isArray(data.records)||data.records.length>1600)
       throw Error('Retailer link index invalid');
     return data.records;
   }));
   const byKey=new Map();
   for(const raw of parts.flat()){
     const row=safe(raw);
     if(row&&!byKey.has(row.key))byKey.set(row.key,row);
   }
   cached={at:Date.now(),byKey,rows:[...byKey.values()]};
   return cached;
 })();
 try{return await loading;}finally{loading=null;}
}
function normalized(v){return String(v||'').toLowerCase().replace(/[^\p{L}\p{N}%]+/gu,' ').trim().replace(/\s+/g,' ');}
function normalizeSize(v){return normalized(v).replace(/(\d)\s+(kg|g|l|ml|lb|oz|ct|pk)\b/g,'$1$2');}
export function quickLinkMatches(index,item,stores,limit=140){
 if(!index||!item||!item.name)return [];
 const terms=normalized(item.name).split(' ').filter(Boolean);
 if(!terms.length)return [];
 const size=normalizeSize(item.size||'');
 const brand=normalized(item.brand||'');
 const rows=[];
 for(const row of index.rows){
   if(!stores.includes(row.retailer))continue;
   const hay=normalized(row.productName);
   const words=hay.split(' ');
   if(!terms.every(t=>words.includes(t)||((t.endsWith('s')||t.endsWith('es'))&&words.includes(t.replace(/(?:es|s)$/,'')))))continue;
   const rowSize=normalizeSize(row.size||row.productName);
   const sizeMatch=Boolean(size)&&size===rowSize;
   if(brand&&!hay.includes(brand)&&normalized(row.brand)!==brand)continue;
   // Keep some mismatched sizes out of the cap, but let the client's stronger
   // package-size guard make the final decision.
   const score=(sizeMatch?100:0)+(row.productName.toLowerCase().startsWith(item.name.toLowerCase())?20:0)
     -(row.productName.length/1000);
   rows.push({row,score});
 }
 rows.sort((a,b)=>b.score-a.score||a.row.retailer.localeCompare(b.row.retailer));
 const counts=new Map(),out=[];
 for(const x of rows){
   const n=counts.get(x.row.retailer)||0;
   if(n>=35)continue;
   counts.set(x.row.retailer,n+1);
   out.push(x.row);
   if(out.length>=limit)break;
 }
 return out;
}
