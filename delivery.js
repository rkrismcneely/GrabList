/* GrabList delivery-app assistance: pure URL validation and copied-price parsing.
   There is no automated crawling, delivery-platform API, or cross-site request. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.GrabListDelivery=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const SERVICES={
  doordash:{label:'DoorDash',url:'https://www.doordash.com/',hosts:['doordash.com','www.doordash.com']},
  ubereats:{label:'Uber Eats',url:'https://www.ubereats.com/ca',hosts:['ubereats.com','www.ubereats.com']},
  instacart:{label:'Instacart',url:'https://www.instacart.ca/',hosts:['instacart.ca','www.instacart.ca']}
};
const EXAMPLES={
  freshco:[{service:'doordash',label:'FreshCo · 181 Brock St, Peterborough',
    url:'https://www.doordash.com/convenience/store/freshco-peterborough-40756041/'}],
  independent:[{service:'doordash',label:'Your Independent Grocer · 400 Lansdowne St E, Peterborough',
    url:'https://www.doordash.com/convenience/store/your-independent-grocer-peterborough-24201998/'}],
  costco:[{service:'doordash',label:'Costco · 485 The Parkway, Peterborough',
    url:'https://www.doordash.com/convenience/store/costco-peterborough-50955317/'}]
};
function sanitizeUrl(value,service,storefront=false){
  const provider=SERVICES[service];
  if(!provider||typeof value!=='string'||value.length>1500)return null;
  let u;
  try{u=new URL(value.trim());}catch{return null;}
  if(u.protocol!=='https:'||u.username||u.password||!provider.hosts.includes(u.hostname.toLowerCase()))return null;
  // Storefront URLs must locate a real retailer listing, never an account,
  // search-results, referral, or promotion page.
  if(storefront){
    const path=u.pathname.toLowerCase();
    const accepted=service==='doordash'?/(^|\/)(convenience\/store|store)\/[^/]+/.test(path):
      service==='ubereats'?/(^|\/)(?:[a-z]{2}\/)?store\/[^/]+/.test(path):
      /(?:^|\/)store\/[^/]+/.test(path);
    if(!accepted)return null;
  }
  u.search='';u.hash='';
  return u.href;
}
function moneyCandidates(text){
  if(typeof text!=='string')return [];
  const pattern=/(?:CA\s*)?\$\s*(\d{1,4})(?:[.,](\d{2})|\s+(\d{2})(?=\D|$))/gi;
  const values=[];
  for(const match of text.matchAll(pattern)){
    const end=match.index+match[0].length;
    // Per-kilo/unit price isn't a package sticker price.
    if(/^\s*\/\s*(?:kg|lb|g|100g|ml|l|ea|each|ct|pk|bch)\b/i.test(text.slice(end,end+14)))continue;
    const value=Number(match[1])+Number(match[2]||match[3])/100;
    if(value>0&&value<10000&&!values.includes(value))values.push(value);
  }
  // A copied numeric price is also supported.
  if(!values.length&&/^\s*(?:CA\s*)?\$?\s*\d{1,4}(?:[.,]\d{2})\s*$/i.test(text)){
    const n=Number(text.replace(/[A-Za-z$\s]/g,'').replace(',','.'));
    if(n>0&&n<10000)values.push(n);
  }
  return values;
}
function sizes(text){
 if(typeof text!=='string')return [];
 const matches=[...text.matchAll(/\b\d+(?:[.,]\d+)?\s*(?:kg|g|ml|l|litres?|lb|oz|ct|count)\b/gi)]
   .map(m=>m[0].replace(/\s+/g,' ').trim());
 return [...new Set(matches)];
}
function parse(text){
 const prices=moneyCandidates(text);
 const packSizes=sizes(text);
 return {
  prices,price:prices.length===1?prices[0]:null,
  sizes:packSizes,size:packSizes.length===1?packSizes[0]:null,
  uncertain:prices.length!==1||packSizes.length!==1,
  note:prices.length>1?'Multiple prices found: select the current item price, not an old sale price.':
    !prices.length?'No clearly labelled product price found. Enter the shown price manually.':'Price extracted; verify the item and size.'
 };
}
return {SERVICES,EXAMPLES,sanitizeUrl,moneyCandidates,sizes,parse};
});
