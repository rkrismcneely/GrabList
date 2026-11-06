/* GrabList Phase 2: conservative price comparison, independent of data providers.
   No network access and no fabricated prices. Manual offers are explicitly labelled. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.GrabListComparison=api;
})(typeof globalThis!=='undefined'?globalThis:null,function(){
  'use strict';
  const STALE_MS=30*24*60*60*1000;
  function normalizedSize(value){
    const s=String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
    const m=s.match(/^(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|lb|oz|ct|count|pack|pk)$/);
    if(!m)return s;
    const n=Number(m[1].replace(',','.'));
    if(!Number.isFinite(n))return s;
    const unit=m[2]==='kg'||m[2]==='g'?'g':m[2]==='l'||m[2]==='ml'?'ml':m[2]==='ct'||m[2]==='count'?'ct':m[2]==='pack'||m[2]==='pk'?'pack':m[2];
    const valueInUnit=m[2]==='kg'||m[2]==='l'?n*1000:n;
    return Number(valueInUnit.toFixed(3))+unit;
  }
  function validOffer(item,offer,now){
    if(!offer||offer.source!=='manual'&&offer.source!=='provider')return false;
    if(!Number.isFinite(offer.price)||offer.price<0)return false;
    if(!Number.isFinite(offer.observedAt)||offer.observedAt>now+86400000||now-offer.observedAt>STALE_MS)return false;
    if(normalizedSize(item.size)!==normalizedSize(offer.size))return false;
    if(item.brand&&String(item.brand).trim().toLowerCase()!==String(offer.brand||'').trim().toLowerCase())return false;
    return true;
  }
  function comparableOffer(item,storeId,now=Date.now()){
    if(!storeId||!Array.isArray(item.offers))return null;
    return item.offers.filter(o=>o.storeId===storeId&&validOffer(item,o,now))
      .sort((a,b)=>b.observedAt-a.observedAt)[0]||null;
  }
  function quantity(item){
    const n=parseFloat(String(item.quantity||'1'));
    return Number.isFinite(n)&&n>0?n:1;
  }
  function evaluate(items,enabledStoreIds,minimumExtraStoreSavings=5,now=Date.now()){
    const enabled=[...new Set(enabledStoreIds)].filter(Boolean);
    const active=items.filter(item=>!item.complete&&!item.storeManuallyCleared&&enabled.includes(item.storeId));
    const originalStores=new Set(active.map(i=>i.storeId));
    const route=new Set(originalStores);
    const planned=new Map();
    for(const item of active){
      const base=comparableOffer(item,item.storeId,now);
      if(base)planned.set(item.id,{item,storeId:item.storeId,offer:base,originalStore:item.storeId,originalPrice:base.price});
    }
    // Improve baskets within existing stops first. A change of shop costs no extra stop.
    function improveAt(storeId){
      for(const p of planned.values()){
        const offer=comparableOffer(p.item,storeId,now);
        if(offer&&Math.round(offer.price*100)<Math.round(p.offer.price*100)){
          p.storeId=storeId;p.offer=offer;
        }
      }
    }
    for(const storeId of route)improveAt(storeId);
    // Evaluate all potential additional stops, adding only when incremental savings
    // at that store meets the user's threshold. No unknown price counts as $0.
    const threshold=Math.round(Math.max(0,Number(minimumExtraStoreSavings)||0)*100);
    while(true){
      let best=null;
      for(const candidate of enabled){
        if(route.has(candidate))continue;
        let cents=0;
        for(const p of planned.values()){
          const offer=comparableOffer(p.item,candidate,now);
          if(offer)cents+=Math.max(0,Math.round((p.offer.price-offer.price)*quantity(p.item)*100));
        }
        if(cents>0&&cents>=threshold&&(!best||cents>best.cents))best={storeId:candidate,cents};
      }
      if(!best)break;
      route.add(best.storeId);
      improveAt(best.storeId);
    }
    const changes=[...planned.values()]
      .filter(p=>p.storeId!==p.originalStore)
      .map(p=>({id:p.item.id,name:p.item.name,from:p.originalStore,to:p.storeId,originalPrice:p.originalPrice,newPrice:p.offer.price,source:p.offer.source,observedAt:p.offer.observedAt,savings:Math.round((p.originalPrice-p.offer.price)*quantity(p.item)*100)/100}));
    return {changes,totalSavings:Math.round(changes.reduce((sum,c)=>sum+Math.round(c.savings*100),0))/100,addedStores:[...route].filter(id=>!originalStores.has(id)),eligibleCount:planned.size,activeCount:items.filter(i=>!i.complete).length};
  }
  return {normalizedSize,comparableOffer,evaluate,STALE_MS};
});
