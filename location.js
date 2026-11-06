/* GrabList location matching. No geocoding, tracking or external requests. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.GrabListLocation=api;
})(typeof globalThis!=='undefined'?globalThis:null,function(){
  'use strict';
  const POSTAL_PATTERN=/^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/;
  const PROVINCE_BY_PREFIX={
    A:'NL',B:'NS',C:'PE',E:'NB',G:'QC',H:'QC',J:'QC',K:'ON',L:'ON',M:'ON',N:'ON',P:'ON',
    R:'MB',S:'SK',T:'AB',V:'BC',Y:'YT'
  };
  function normalizePostalCode(raw){
    const compact=String(raw||'').trim().toUpperCase().replace(/[\s-]+/g,'');
    return POSTAL_PATTERN.test(compact)?compact.slice(0,3)+' '+compact.slice(3):null;
  }
  function contextForPostalCode(raw,verifiedDetails={}){
    const postalCode=normalizePostalCode(raw);
    if(!postalCode)return {postalCode:null,fsa:null,province:null,cityId:null,regionId:null,preferredBranchIds:{}};
    const province=PROVINCE_BY_PREFIX[postalCode[0]]||null; // X spans Nunavut/NWT: never guess.
    return {
      postalCode,fsa:postalCode.slice(0,3),province,
      // City and region require confirmed data from a location provider, not guessing from an FSA.
      cityId:verifiedDetails.cityId||null,
      regionId:verifiedDetails.regionId||null,
      preferredBranchIds:verifiedDetails.preferredBranchIds||{}
    };
  }
  // A lower rank means more geographically relevant; null means the quote doesn't apply.
  // A manual offer with no location is still usable but explicitly unscoped (rank 8).
  function offerLocationRank(offer,context,storeId){
    const loc=offer&&offer.location;
    if(!loc)return 8;
    const ctx=context||{};
    switch(loc.scope){
      case 'branch':return loc.branchId&&loc.branchId===ctx.preferredBranchIds?.[storeId]?1:null;
      case 'postal':return normalizePostalCode(loc.postalCode)===ctx.postalCode&&ctx.postalCode?2:null;
      case 'fsa':return ctx.fsa&&String(loc.fsa||'').toUpperCase()===ctx.fsa?3:null;
      case 'city':return ctx.cityId&&loc.cityId===ctx.cityId?4:null;
      case 'region':return ctx.regionId&&loc.regionId===ctx.regionId?5:null;
      case 'province':return ctx.province&&String(loc.province||'').toUpperCase()===ctx.province?6:null;
      case 'national':return 7;
      default:return null;
    }
  }
  function distanceKm(a,b){
    if(!a||!b||!Number.isFinite(a.lat)||!Number.isFinite(a.lon)||!Number.isFinite(b.lat)||!Number.isFinite(b.lon))return null;
    if(Math.abs(a.lat)>90||Math.abs(b.lat)>90||Math.abs(a.lon)>180||Math.abs(b.lon)>180)return null;
    const r=Math.PI/180,dLat=(b.lat-a.lat)*r,dLon=(b.lon-a.lon)*r;
    const h=Math.sin(dLat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLon/2)**2;
    return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
  }
  function nearestBranch(userCoordinates,branches){
    if(!Array.isArray(branches)||!userCoordinates)return null;
    const candidates=branches.map(branch=>({branch,distanceKm:distanceKm(userCoordinates,branch)}))
      .filter(x=>x.distanceKm!==null).sort((a,b)=>a.distanceKm-b.distanceKm);
    return candidates[0]||null;
  }
  return {normalizePostalCode,contextForPostalCode,offerLocationRank,distanceKm,nearestBranch};
});
