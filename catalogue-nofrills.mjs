// Canonical No Frills product URLs. Preserve the full retailer SKU/pack suffix;
// a case-pack _C12 or weighted _KG is NOT equivalent to the single-unit _EA.
// Product navigation parameters and shopping cart identifiers are never saved.
export function canonicalNofrillsUrl(raw){
  if(typeof raw!=='string'||raw.length>1800)return null;
  try{
    const url=new URL(raw);
    if(url.protocol!=='https:'||url.username||url.password||url.port||
       !['nofrills.ca','www.nofrills.ca'].includes(url.hostname.toLowerCase()))return null;
    const m=url.pathname.match(/^\/(?:en\/)?([a-z0-9%._-]+)\/p\/([0-9]{6,14}_(?:EA|KG|C\d{2}))\/?$/i);
    if(!m)return null;
    const slug=m[1].toLowerCase();
    // Keep the SKU case suffix as provided, not an inferred replacement.
    const sku=m[2].toUpperCase();
    return 'https://www.nofrills.ca/en/'+slug+'/p/'+sku;
  }catch{return null;}
}
export function withNofrillsStore(raw,storeId){
  const canonical=canonicalNofrillsUrl(raw);
  if(!canonical)return null;
  if(storeId===null||storeId===undefined||storeId==='')return canonical;
  const value=String(storeId);
  if(!/^\d{4,6}$/.test(value))return null;
  return canonical+'?storeId='+value;
}
export function nofrillsSku(raw){
  const url=canonicalNofrillsUrl(raw);
  return url?url.split('/p/')[1]:null;
}