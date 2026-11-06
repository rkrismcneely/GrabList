/* GrabList delivery-platform setup — no cross-origin API calls or scraping. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const quote=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ids=()=>state.deliveryOrder||['doordash','ubereats','instacart'];
function configured(store,service){
 const key=store+':'+service;
 return {key,url:state.deliveryLinks?.[key]?.url||'',branch:state.deliveryBranches?.[key]||''};
}
function priority(){
 const area=$('delivery-platform-options');
 area.innerHTML=ids().map((id,index)=>{
  const service=GrabListDelivery.SERVICES[id];
  return '<div class="store-option"><input type="checkbox" data-platform-toggle="'+id+'" id="delivery-enabled-'+id+'" '+
   (state.deliveryEnabled?.includes(id)?'checked':'')+'/>'+
   '<label class="store-option-name" for="delivery-enabled-'+id+'">'+quote(service.label)+'</label>'+
   '<button type="button" class="store-order-button" data-platform-move="'+id+'" data-step="-1" '+
   (index===0?'disabled':'')+' aria-label="Move '+quote(service.label)+' up">↑</button>'+
   '<button type="button" class="store-order-button" data-platform-move="'+id+'" data-step="1" '+
   (index===ids().length-1?'disabled':'')+' aria-label="Move '+quote(service.label)+' down">↓</button></div>';
 }).join('');
}
function initSelectors(){
 const store=$('settings-delivery-store'),service=$('settings-delivery-service');
 const priorStore=store.value,priorService=service.value;
 store.innerHTML=state.storeOrderIds.map(id=>
  '<option value="'+quote(id)+'">'+quote(storeById(id).name)+'</option>').join('');
 store.value=state.storeOrderIds.includes(priorStore)?priorStore:state.enabledStoreIds[0]||state.storeOrderIds[0]||'walmart';
 service.innerHTML=ids().map(id=>'<option value="'+quote(id)+'">'+
  quote(GrabListDelivery.SERVICES[id].label)+(state.deliveryEnabled?.includes(id)?'':' (disabled)')+'</option>').join('');
 service.value=ids().includes(priorService)?priorService:state.deliveryEnabled?.[0]||ids()[0];
 showBranch();
}
function showBranch(){
 const store=$('settings-delivery-store').value,service=$('settings-delivery-service').value;
 if(!GrabListDelivery.SERVICES[service])return;
 const {url,branch}=configured(store,service);
 $('settings-delivery-branch').value=branch;
 $('settings-delivery-url').value=url;
 $('delivery-settings-status').textContent=(url?'Storefront link saved. ':'')+
  (branch?'Branch saved: '+branch:'Enter a branch address if you use the app without a shareable link.');
 const suggest=(String(state.postalCode||'').startsWith('K9')?
  (GrabListDelivery.EXAMPLES[store]||[]).filter(x=>x.service===service):[]);
 const nofrills=store==='nofrills'&&service==='doordash'&&String(state.postalCode||'').startsWith('K9');
 $('delivery-settings-suggestions').innerHTML=
  suggest.map((x,i)=>'<button type="button" data-suggest-store="'+i+'">'+quote(x.label)+'</button>').join('')+
  (nofrills?'<button type="button" data-suggest-nofrills="1">No Frills — 1866 Lansdowne Street West (address only)</button>':'');
 $('delivery-settings-suggestions')._suggest=suggest;
}
$('settings-button').addEventListener('click',()=>{priority();initSelectors();});
$('delivery-platform-options').addEventListener('change',event=>{
 const el=event.target;if(!el.matches('[data-platform-toggle]'))return;
 const id=el.dataset.platformToggle;
 if(!GrabListDelivery.SERVICES[id])return;
 const set=new Set(state.deliveryEnabled||[]);
 if(el.checked)set.add(id);else set.delete(id);
 state.deliveryEnabled=ids().filter(k=>set.has(k));
 save();priority();initSelectors();
});
$('delivery-platform-options').addEventListener('click',event=>{
 const el=event.target.closest('[data-platform-move]');
 if(!el)return;
 const order=ids().slice(),pos=order.indexOf(el.dataset.platformMove),next=pos+Number(el.dataset.step);
 if(pos<0||next<0||next>=order.length)return;
 [order[pos],order[next]]=[order[next],order[pos]];
 state.deliveryOrder=order;
 state.deliveryEnabled=order.filter(k=>state.deliveryEnabled.includes(k));
 save();priority();initSelectors();
});
$('settings-delivery-store').addEventListener('change',showBranch);
$('settings-delivery-service').addEventListener('change',showBranch);
$('delivery-settings-suggestions').addEventListener('click',event=>{
 const button=event.target.closest('button');if(!button)return;
 if(button.dataset.suggestNofrills==='1'){
  $('settings-delivery-branch').value='No Frills · 1866 Lansdowne Street West, Peterborough';
  $('settings-delivery-url').value='';
 }else{
  const entry=$('delivery-settings-suggestions')._suggest?.[Number(button.dataset.suggestStore)];
  if(!entry)return;
  $('settings-delivery-url').value=entry.url;
  $('settings-delivery-branch').value=entry.label;
 }
 $('delivery-settings-status').textContent='Suggested branch selected. Save below after confirming it is your store.';
});
$('settings-save-delivery').addEventListener('click',()=>{
 const store=$('settings-delivery-store').value,service=$('settings-delivery-service').value;
 const branch=$('settings-delivery-branch').value.trim().slice(0,140);
 const raw=$('settings-delivery-url').value.trim();
 if(!STORES.some(s=>s.id===store)||!GrabListDelivery.SERVICES[service])return;
 const url=raw?GrabListDelivery.sanitizeUrl(raw,service,true):null;
 if(raw&&!url){
  $('delivery-settings-status').textContent='This must be an exact HTTPS storefront for '+GrabListDelivery.SERVICES[service].label+'. A link is optional; your branch address is enough.';
  return;
 }
 const key=store+':'+service;
 if(!state.deliveryLinks)state.deliveryLinks={};
 if(!state.deliveryBranches)state.deliveryBranches={};
 if(url)state.deliveryLinks[key]={url,label:branch||storeById(store).name};
 else delete state.deliveryLinks[key];
 if(branch)state.deliveryBranches[key]=branch;
 else delete state.deliveryBranches[key];
 save();
 $('delivery-settings-status').textContent='Saved '+storeById(store).name+' on '+GrabListDelivery.SERVICES[service].label+
  (url?' with link':branch?' with branch address':' (configuration cleared)')+'.';
});
})();
