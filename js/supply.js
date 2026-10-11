'use strict';
/* Physical household provisioning. Public stock is never copied: pickup moves
 * an atomic mixed basket, arrival moves it again, and meals/heating consume only
 * the destination's stock. Automatic supply remains the new/legacy default. */
G.supplyEnabled=()=>G.game.supplyMode==='physical';
G.clothingSupplyEnabled=()=>G.supplyEnabled()&&G.game.clothingSupply===true;
G.supplyCoats=s=>(s?.clothes||0)+(s?.warmCoats||0);
G.supplyCoatDemand=b=>G.clothingSupplyEnabled()?G.supplyResidents(b).filter(c=>(c.clothingLeft||0)<=7).length:0;
G.supplyStock=b=>b.supplyStock||(b.supplyStock=G.emptySupplyStock());
G.supplyCargo=c=>c?.carry?.supplyBatch?c.carry:null;
G.supplyHome=b=>!!b&&['house','stonehouse','boarding'].includes(b.type)&&b.state==='ok'&&!b.houseFire;
G.supplyResidents=b=>G.world.citizens.filter(c=>!c.dead&&G.world.families.some(f=>f.id===c.familyId&&(b.type==='supplycamp'?f.supplyCamp===b:f.houseId===b.id)));
G.supplyTaskOf=c=>[c.task,c.pausedTask].find(t=>t?.kind==='supply')||null;
G.supplyEntityCurrent=b=>!!b&&(b.type==='supplycache'?(G.world.supplyCaches||[]).includes(b):b.type==='supplycamp'?G.world.families.some(f=>f.supplyCamp===b):G.world.bmap[b.id]===b);
G.supplyEntitySpot=function(c,b){
 if(!G.supplyEntityCurrent(b))return null;
 if(b.type!=='supplycache'&&b.type!=='supplycamp')return G.workSpot(G.world,b,c.x,c.y);
 // Loose goods/camps occupy no navigation tile. Reach the point itself when
 // possible, otherwise a real perimeter tile; never teleport through a wall.
 const w=G.world,targets=[];
 for(let y=b.y-1;y<=b.y+b.h;y++)for(let x=b.x-1;x<=b.x+b.w;x++)if(!G.tileBlocked(w,x,y))targets.push({x,y});
 return targets.length?G.routeSpot(G.findPathToAny(w,c.x,c.y,targets)):null;
};
G.supplyCache=function(stock,at){
 if(G.supplySum(stock)<1e-8)return null;
 const cache={id:G.nextId(),type:'supplycache',x:Math.round(at.x),y:Math.round(at.y),w:at.w||1,h:at.h||1,state:'ok',supplyStock:{...G.emptySupplyStock(),...stock}};
 (G.world.supplyCaches||(G.world.supplyCaches=[])).push(cache);return cache;
};
G.packBuildingSupply=function(b){if(G.world.bmap[b.id]!==b)return;if(b.supplyStock){G.supplyCache(b.supplyStock,b);delete b.supplyStock;}};
G.recoverCitizenSupply=function(c){if(G.world.cmap[c.id]!==c||c.dead)return;const cargo=G.supplyCargo(c);if(cargo){G.supplyCache(G.supplyCargoItems(cargo),c);c.carry=null;}};
G.supplyFamilyTarget=function(f,create=false){
 if(!f)return null;const home=G.world.bmap[f.houseId];if(G.supplyHome(home))return home;
 if(f.supplyCamp)return f.supplyCamp;if(!create)return null;
 const c=G.world.citizens.find(c=>!c.dead&&c.familyId===f.id);if(!c)return null;
 f.supplyCamp={id:f.id,type:'supplycamp',x:Math.round(c.x),y:Math.round(c.y),w:1,h:1,state:'ok',supplyStock:G.emptySupplyStock()};return f.supplyCamp;
};
G.reconcileSupplyHomes=function(){
 if(!G.supplyEnabled())return;
 for(const f of G.world.families){
  if(f.supplyCamp&&G.supplyHome(G.world.bmap[f.houseId])){G.supplyCache(f.supplyCamp.supplyStock,f.supplyCamp);delete f.supplyCamp;}
  else G.supplyFamilyTarget(f,true);
 }
 G.world.supplyCaches=(G.world.supplyCaches||[]).filter(b=>G.supplySum(b.supplyStock)>1e-8);
};
G.supplyDestination=function(batch){
 if(batch.kind==='return')return null;
 if(batch.kind==='vendor'){const b=G.world.bmap[batch.to];return b?.type==='market'&&b.state==='ok'?b:null;}
 return G.supplyFamilyTarget(G.world.families.find(f=>f.id===batch.familyId),false);
};
G.supplyIncoming=function(b){const s=G.emptySupplyStock();for(const c of G.world.citizens){const cargo=G.supplyCargo(c);if(!cargo||G.supplyDestination(cargo.supplyBatch)!==b)continue;for(const [k,q]of Object.entries(G.supplyCargoItems(cargo)))s[k]+=q;}return s;};
G.supplyNeeds=function(b){
 const stock=b.supplyStock||G.emptySupplyStock(),incoming=G.supplyIncoming(b),all=Object.fromEntries(G.SUPPLY.types.map(k=>[k,(stock[k]||0)+incoming[k]]));
 if(b.type==='market'){
  const residents=G.world.buildings.filter(h=>G.supplyHome(h)&&Math.max(Math.abs(h.x-b.x),Math.abs(h.y-b.y))<=G.SUPPLY.marketRadius).reduce((n,h)=>n+G.supplyResidents(h).length,0);
  return {coats:G.clothingSupplyEnabled()?Math.max(0,Math.min(12,residents)-G.supplyCoats(all)):0,food:Math.max(0,Math.min(180,residents*G.LIFE.eatPerDay*3)-G.supplyFood(all)),firewood:Math.max(0,(G.game.season>=2?40:10)-all.firewood),coal:Math.max(0,(G.heatingPolicy().allowCoal?20:0)-all.coal),room:Math.max(0,G.SUPPLY.marketCap-G.supplySum(all))};
 }
 const residents=G.supplyResidents(b).length,heat=residents&&G.BDEF[b.type]?.warmWoodPerYear?G.BDEF[b.type].warmWoodPerYear/G.SEASON_DAYS*G.SUPPLY.fuelDays:0;
 return {coats:Math.max(0,G.supplyCoatDemand(b)-G.supplyCoats(all)),food:Math.max(0,residents*G.LIFE.eatPerDay*G.SUPPLY.foodDays-G.supplyFood(all)),firewood:Math.max(0,(G.game.season>=2?heat:Math.min(heat,3))-all.firewood-(G.heatingPolicy().allowCoal?all.coal*G.COAL_HEAT:0)),coal:0,room:Math.max(0,G.SUPPLY.homeCap-G.supplySum(all))};
};
G.supplyBasket=function(stock,needs,cap,publicStock=false){
 const out=G.emptySupplyStock();let room=Math.min(cap,needs.room);
 const take=(k,n)=>{const available=publicStock&&k==='coal'?Math.min(stock[k]||0,G.heatingCoalAvailable()):(stock[k]||0);const q=Math.max(0,Math.min(n,available-out[k],room));out[k]+=q;room-=q;return q;};
 let fuel=needs.firewood;if(G.game.season>=2){fuel-=take('firewood',fuel);if(G.heatingPolicy().allowCoal&&fuel>0)take('coal',fuel/G.COAL_HEAT);}
 // Only whole garments travel. Warm coats are preferred at actual pickup,
 // never replace a still-worn coat, and share the same finite cargo capacity.
 let coats=needs.coats||0;for(const k of ['warmCoats','clothes'])if(coats>=1){const n=Math.floor(Math.min(coats,stock[k]||0,room));if(n>0)coats-=take(k,n);}
 let food=needs.food;
 for(let pass=0;pass<3&&food>1e-8&&room>1e-8;pass++){const keys=G.FOOD_KEYS.filter(k=>(stock[k]||0)-out[k]>1e-8),part=keys.length?food/keys.length:0;if(!keys.length)break;for(const k of keys)food-=take(k,part);}
 if(G.game.season<2)fuel-=take('firewood',fuel);if(needs.coal>0)take('coal',needs.coal);
 return Object.fromEntries(Object.entries(out).filter(([,q])=>q>1e-8));
};
G.supplyRestockWanted=function(b){
 const n=G.supplyNeeds(b);if(b.type==='market')return n.room>0&&(n.food>=20||n.firewood>=5||n.coal>=5||n.coats>=1);
 const r=G.supplyResidents(b).length,s=b.supplyStock||G.emptySupplyStock(),heat=(G.BDEF[b.type]?.warmWoodPerYear||0)/G.SEASON_DAYS;
 return r>0&&(n.coats>=1||G.supplyFood(s)<r*G.LIFE.eatPerDay*2||(G.game.season>=2&&s.firewood+(G.heatingPolicy().allowCoal?s.coal*G.COAL_HEAT:0)<heat*2));
};
G.supplyClaimed=b=>G.world.citizens.some(c=>G.supplyTaskOf(c)?.to===b||(G.supplyCargo(c)&&G.supplyDestination(c.carry.supplyBatch)===b));
G.supplySourceStock=function(b,to,vendor){
 if(!G.supplyEntityCurrent(b)||b===to||b.state!=='ok')return null;
 if(b.type==='supplycache')return {stock:G.supplyStock(b),publicStock:false};
 if(G.supplyHome(b)&&!G.supplyResidents(b).length)return {stock:G.supplyStock(b),publicStock:false};
 if(!vendor&&b.type==='market'&&Math.max(Math.abs(to.x-b.x),Math.abs(to.y-b.y))<=G.SUPPLY.marketRadius)return {stock:G.supplyStock(b),publicStock:false};
 if(b.type==='storage'||b.type==='stockpile'){const stock={...G.game.res};if(b.type==='stockpile')for(const k of [...G.FOOD_KEYS,...G.CLOTHING_KEYS])stock[k]=0;return {stock,publicStock:true};}
 return null;
};
G.supplySourceRoute=function(c,to,vendor=false){
 const needs=G.supplyNeeds(to),candidates=[];
 for(const b of [...G.world.buildings,...(G.world.supplyCaches||[])]){
  const source=G.supplySourceStock(b,to,vendor);if(!source)continue;
  const basket=G.supplyBasket(source.stock,needs,vendor?G.SUPPLY.vendorCarry:G.SUPPLY.homeCarry,source.publicStock);if(!Object.keys(basket).length)continue;
  const spot=G.supplyEntitySpot(c,b);if(spot)candidates.push({b,spot,...source});
 }
 candidates.sort((a,b)=>(Number(a.b.type!=='market')-Number(b.b.type!=='market'))||a.spot.route.eta-b.spot.route.eta);return candidates[0]||null;
};
G.supplyTaskCurrent=(c,t)=>!!c&&G.world.cmap[c.id]===c&&!c.dead&&t?.kind==='supply'&&(c.task===t||c.pausedTask===t);
G.finishSupplyTask=function(c){c.task=null;c.pausedTask=null;c.path=null;c.haulTo=null;c.haulPending=false;c.haulWait='';c.state='idle';c.wanderT=.5;};
G.returnSupplyCargo=function(c){if(!G.supplyCargo(c))return false;c.carry.supplyBatch={to:null,kind:'return'};G.finishSupplyTask(c);return G.resumeSupplyCargo(c);};
G.cancelSupplyTask=function(c){G.finishSupplyTask(c);if(G.supplyCargo(c))G.returnSupplyCargo(c);};
G.supplyLegSpot=function(c,t){
 if(!G.supplyTaskCurrent(c,t))return null;
 if(t.phase==='return'){const r=G.storageRoute(c.x,c.y,G.cargoStorageTypes(c.carry));if(!r)return null;t.source=r.storage;return r.spot;}
 if(t.phase==='recover')return G.supplyEntitySpot(c,t.source);
 if(t.phase==='fetch'){
  const target=t.vendor?G.world.bmap[t.to.id]:G.supplyFamilyTarget(G.world.families.find(f=>f.id===t.familyId),true);
  if(!target||target!==t.to)return null;
  const src=G.supplySourceRoute(c,t.to,t.vendor);if(!src)return null;t.source=src.b;return src.spot;
 }
 const dest=G.supplyDestination(c.carry?.supplyBatch||{});if(!dest)return null;t.to=dest;c.carry.supplyBatch.to=dest.id;return G.supplyEntitySpot(c,dest);
};
G.planSupplyLeg=function(c,t){
 if(!G.supplyTaskCurrent(c,t))return false;
 const spot=G.supplyLegSpot(c,t);if(!spot){c.path=null;c.state='supplyWait';t.retryH=2;return false;}
 t.tx=spot.x;t.ty=spot.y;return G.sendTo(c,t.tx,t.ty,spot.route);
};
G.resumeSupplyCargo=function(c){
 const cargo=G.supplyCargo(c);if(!cargo||G.world.cmap[c.id]!==c||c.dead)return false;G.reconcileSupplyHomes();
 const dest=G.supplyDestination(cargo.supplyBatch),returning=!dest;
 if(returning)cargo.supplyBatch={to:null,kind:'return'};
 const t={kind:'supply',b:dest?.type==='market'?dest:null,to:dest,vendor:cargo.supplyBatch.kind==='vendor',familyId:cargo.supplyBatch.familyId,
  phase:returning?'return':'deliver',work:G.SUPPLY.unloadH,workLeft:G.SUPPLY.unloadH};c.task=t;c.pausedTask=null;c.camped=false;G.planSupplyLeg(c,t);return true;
};
G.beginSupplyTrip=function(c,to,vendor=false,familyId=c.familyId){
 if(!G.supplyEnabled()||G.world.cmap[c.id]!==c||c.dead||c.carry||c.pausedTask||G.supplyClaimed(to)||!G.supplyRestockWanted(to))return false;
 const source=G.supplySourceRoute(c,to,vendor);if(!source)return false;
 const t={kind:'supply',b:vendor?to:null,to,vendor,familyId,phase:'fetch',source:source.b,work:G.SUPPLY.fetchH,workLeft:G.SUPPLY.fetchH,tx:source.spot.x,ty:source.spot.y};
 c.task=t;c.camped=false;G.sendTo(c,t.tx,t.ty,source.spot.route);return true;
};
G.tryHouseholdSupply=function(c){
 if(!G.supplyEnabled()||!c.adult||c.student||c.carry||c.pausedTask||G.isSick(c))return false;
 G.reconcileSupplyHomes();const own=G.supplyFamilyTarget(G.familyOf(c),true);if(own&&G.beginSupplyTrip(c,own))return true;
 // Only genuinely idle adults assist a household with no healthy adult buyer.
 // Existing teachers/doctors/builders are never pulled away to do this.
 if(c.job!=null)return false;
 for(const f of G.world.families){if(f.id===c.familyId||G.world.citizens.some(a=>!a.dead&&a.familyId===f.id&&a.adult&&!a.student&&!G.isSick(a)))continue;
  const target=G.supplyFamilyTarget(f,true);if(target&&G.beginSupplyTrip(c,target,false,f.id))return true;
 }
 return G.beginSupplyRecovery(c);
};
G.recoverableSupply=function(b){
 if(!G.supplyEntityCurrent(b))return {};
 if(b.type==='supplycache'||G.supplyHome(b)&&!G.supplyResidents(b).length)return G.supplyStock(b);
 if(!G.heatingPolicy().allowCoal&&(G.supplyHome(b)||b.type==='market'&&b.state==='ok'))return {coal:G.supplyStock(b).coal};
 return {};
};
G.beginSupplyRecovery=function(c){
 if(c.job!=null||c.carry||c.pausedTask)return false;
 const candidates=[];for(const b of [...G.world.buildings,...(G.world.supplyCaches||[])]){
  if(!Object.entries(G.recoverableSupply(b)).some(([k,q])=>q>1e-8&&G.mineralStorageSpace(k)>1e-8)||G.world.citizens.some(a=>G.supplyTaskOf(a)?.phase==='recover'&&G.supplyTaskOf(a).source===b))continue;
  const spot=G.supplyEntitySpot(c,b);if(spot)candidates.push({b,spot});
 }
 candidates.sort((a,b)=>a.spot.route.eta-b.spot.route.eta);const q=candidates[0];if(!q)return false;
 const t={kind:'supply',phase:'recover',source:q.b,to:null,vendor:false,work:G.SUPPLY.fetchH,workLeft:G.SUPPLY.fetchH,tx:q.spot.x,ty:q.spot.y};c.task=t;c.camped=false;G.sendTo(c,t.tx,t.ty,q.spot.route);return true;
};
G.makeVendorTask=function(b,c){if(!G.supplyEnabled()||b.state!=='ok'||G.workerLimitOf(b)<=0)return null;G.beginSupplyTrip(c,b,true);return c.task?.kind==='supply'?c.task:null;};
G.compactSupplyCargo=function(c,items){const entries=Object.entries(items).filter(([,q])=>q>1e-8);if(!entries.length){c.carry=null;return;}const[type,qty]=entries.shift();c.carry.type=type;c.carry.qty=qty;c.carry.extra=Object.fromEntries(entries);};
G.stepSupply=function(c,dt){
 let t=G.supplyTaskOf(c);if(!t)return false;if(!G.supplyTaskCurrent(c,t))return false;
 if(t.phase==='recover'&&!G.supplyEntityCurrent(t.source)){G.cancelSupplyTask(c);return true;}
 if(t.phase==='fetch'){
  const dest=t.vendor?G.world.bmap[t.to.id]:G.supplyFamilyTarget(G.world.families.find(f=>f.id===t.familyId),true);
  if(dest!==t.to||!G.supplyEntityCurrent(t.to)||t.vendor&&(t.to.state!=='ok'||c.job!==t.to.id||G.workerLimitOf(t.to)<=0)){G.cancelSupplyTask(c);return true;}
 }else if(t.phase==='deliver'){
  let dest=G.supplyDestination(c.carry?.supplyBatch||{});if(!dest){G.reconcileSupplyHomes();dest=G.supplyDestination(c.carry?.supplyBatch||{});}if(!dest){G.returnSupplyCargo(c);return true;}if(dest!==t.to){t.to=dest;G.planSupplyLeg(c,t);return true;}
 }
 if(c.state==='supplyWait'){
  if(t.phase==='return'&&c.carry){const home=G.supplyFamilyTarget(G.familyOf(c),false);if(home&&G.supplyFood(home.supplyStock)<G.supplyResidents(home).length*G.LIFE.eatPerDay){G.recoverCitizenSupply(c);G.finishSupplyTask(c);return true;}}
  t.retryH-=dt;if(t.retryH<=0)G.planSupplyLeg(c,t);return true;}
 if(c.state!=='work')return false;
 const endpoint=t.phase==='deliver'?t.to:t.source;
 const physical=G.supplyEntityCurrent(endpoint)&&G.d2(c.x,c.y,t.tx,t.ty)<1e-6&&!G.tileBlocked(G.world,Math.round(c.x),Math.round(c.y))&&
  (['supplycache','supplycamp'].includes(endpoint.type)?c.x>=endpoint.x-1&&c.x<=endpoint.x+endpoint.w&&c.y>=endpoint.y-1&&c.y<=endpoint.y+endpoint.h:G.atMedicalDoor(c,endpoint));
 if(!physical){G.planSupplyLeg(c,t);return true;}
 t.workLeft-=dt;if(t.workLeft>0)return true;
 if(t.phase==='recover'){
  const items=G.recoverableSupply(t.source),stock=G.supplyStock(t.source);let room=G.SUPPLY.homeCarry;const basket={};
  for(const[k,q]of Object.entries(items)){const raw=Math.min(q,room,G.mineralStorageSpace(k)),n=G.CLOTHING_KEYS.includes(k)?Math.floor(raw):raw;if(n>1e-8){basket[k]=n;stock[k]-=n;room-=n;}}
  const entries=Object.entries(basket);if(!entries.length){G.cancelSupplyTask(c);return true;}
  const[type,qty]=entries.shift();c.carry={type,qty,extra:Object.fromEntries(entries),staffingReturn:true,supplyBatch:{kind:'return',to:null}};
  G.resumeSupplyCargo(c);return true;
 }
 if(t.phase==='fetch'){
  const src=G.supplySourceStock(t.source,t.to,t.vendor);if(!src){G.planSupplyLeg(c,t);return true;}
  const basket=G.supplyBasket(src.stock,G.supplyNeeds(t.to),t.vendor?G.SUPPLY.vendorCarry:G.SUPPLY.homeCarry,src.publicStock),items=Object.entries(basket);
  if(!items.length){G.cancelSupplyTask(c);return true;}
  for(const[k,q]of items){if(src.publicStock)G.withdrawResource(k,q);else src.stock[k]=Math.max(0,(src.stock[k]||0)-q);}
  const[type,qty]=items.shift();c.carry={type,qty,extra:Object.fromEntries(items),staffingReturn:true,supplyBatch:{to:t.to.id,kind:t.vendor?'vendor':'home',...(!t.vendor?{familyId:t.familyId}:{})}};
  t.phase='deliver';t.work=t.workLeft=G.SUPPLY.unloadH;G.planSupplyLeg(c,t);return true;
 }
 const cargo=G.supplyCargo(c);if(!cargo){G.finishSupplyTask(c);return true;}
 const items=G.supplyCargoItems(cargo);
 if(t.phase==='return'){
  for(const[k,q]of Object.entries(items)){const amount=G.CLOTHING_KEYS.includes(k)?Math.floor(Math.min(q,G.mineralStorageSpace(k))):q;items[k]-=G.deposit(k,amount,true);}
  G.compactSupplyCargo(c,items);G.updateProductionGoals();
  if(c.carry){c.state='supplyWait';t.retryH=2;t.workLeft=G.SUPPLY.unloadH;c.path=null;return true;}
 }else{
  const stock=G.supplyStock(t.to);let room=Math.max(0,(t.to.type==='market'?G.SUPPLY.marketCap:G.SUPPLY.homeCap)-G.supplySum(stock));
  for(const[k,q]of Object.entries(items)){const raw=Math.min(q,room),n=G.CLOTHING_KEYS.includes(k)?Math.floor(raw):raw;stock[k]=(stock[k]||0)+n;items[k]-=n;room-=n;}
  G.compactSupplyCargo(c,items);if(c.carry){G.returnSupplyCargo(c);return true;}
 }
 G.finishSupplyTask(c);return true;
};
G.useSupplyStock=function(stock,type,qty){stock[type]=Math.max(0,(stock[type]||0)-qty);G.game.supplyUsed[type]=(G.game.supplyUsed[type]||0)+qty;G.ledgerRecord('distributedUsed',type,qty);};
G.eatHousehold=function(c,qty){const target=G.supplyFamilyTarget(G.familyOf(c),true);if(!target)return [];const stock=G.supplyStock(target);if(G.supplyFood(stock)+1e-8<qty)return [];
 const basket=G.supplyBasket(stock,{food:qty,firewood:0,coal:0,room:qty},qty),eaten=[];for(const[k,n]of Object.entries(basket)){G.useSupplyStock(stock,k,n);eaten.push(k);}return eaten;
};
G.heatSuppliedHome=function(b,need){const r=G.supplyStock(b),wood=Math.min(r.firewood,need),coal=G.heatingPolicy().allowCoal?Math.min(r.coal,Math.max(0,need-wood)/G.COAL_HEAT):0;
 G.useSupplyStock(r,'firewood',wood);G.useSupplyStock(r,'coal',coal);b.lastHeating={day:G.game.day,wood,coal,need};b.unheated=wood+coal*G.COAL_HEAT+1e-8<need;
};
G.burnSupplyStock=function(b){if(!b.supplyStock)return;for(const[k,q]of Object.entries(b.supplyStock)){G.game.supplyLost[k]=(G.game.supplyLost[k]||0)+q;G.ledgerRecord('distributedLost',k,q);}delete b.supplyStock;};
G.enablePhysicalSupplyPrototype=function(){if(G.supplyEnabled())return false;G.game.supplyMode='physical';G.game.supplyStartedDay=G.game.day;G.game.supplyUsed=G.emptySupplyStock();G.game.supplyLost=G.emptySupplyStock();for(const b of G.world.buildings)if(G.supplyHome(b)||(b.type==='market'&&b.state==='ok'))G.supplyStock(b);G.reconcileSupplyHomes();return true;};

/* Read-only aggregate. Industry and trade still see public stock only; food
 * warnings and production limits also see already distributed food/fuel. */
G.supplyInventory=function(g=G.game,w=G.world){
 const result={public:Object.fromEntries(G.SUPPLY.types.map(k=>[k,g.res[k]||0])),market:G.emptySupplyStock(),home:G.emptySupplyStock(),camp:G.emptySupplyStock(),cache:G.emptySupplyStock(),transit:G.emptySupplyStock(),locked:G.emptySupplyStock()};
 const add=(target,stock)=>{for(const k of G.SUPPLY.types)target[k]+=stock?.[k]||0;};
 for(const b of w.buildings)if(b.supplyStock)add(b.houseFire?result.locked:b.type==='market'?result.market:result.home,b.supplyStock);
 for(const f of w.families)add(result.camp,f.supplyCamp?.supplyStock);
 for(const b of w.supplyCaches||[])add(result.cache,b.supplyStock);
 for(const c of w.citizens)if(c.carry?.supplyBatch)add(result.transit,G.supplyCargoItems(c.carry));
 result.available=G.emptySupplyStock();for(const key of ['public','market','home','camp','cache','transit'])add(result.available,result[key]);return result;
};
G.supplyEconomyStock=function(type,g=G.game,w=G.world){
 if(g.supplyMode!=='physical'||!['food',...G.FOOD_KEYS,'firewood',...(g.clothingSupply?G.CLOTHING_KEYS:[])].includes(type))return g.res[type]||0;
 const total=G.supplyInventory(g,w).available;return type==='food'?G.supplyFood(total):total[type];
};

G.supplyModeQuote=function(){
 const g=G.game,w=G.world,rows=[],byHome=new Map();
 if(G.supplyEnabled())return {ok:false,reason:'本村已使用真实配送；该存档不能切回自动供给',rows,cost:G.emptySupplyStock(),key:''};
 for(const f of w.families){
  const people=w.citizens.filter(c=>!c.dead&&c.familyId===f.id);if(!people.length)continue;
  const b=w.bmap[f.houseId],home=G.supplyHome(b)?b:null,key=home?'building:'+home.id:'camp:'+f.id;
  let row=byHome.get(key);if(!row){row={target:home?'building':'camp',id:home?home.id:f.id,name:home?G.BDEF[home.type].name:'无房家庭临时补给点',x:home?home.x:Math.round(people[0].x),y:home?home.y:Math.round(people[0].y),families:[],people:0,stock:G.emptySupplyStock(),fuelNeed:home&&g.season>=2?G.BDEF[home.type].warmWoodPerYear/G.SEASON_DAYS*2:0};rows.push(row);byHome.set(key,row);}
  row.families.push(f.id);row.people+=people.length;
 }
 rows.sort((a,b)=>a.id-b.id);const pop=rows.reduce((n,r)=>n+r.people,0),foodNeed=pop*G.LIFE.eatPerDay*2,foodHave=G.supplyFood(g.res),ratio=foodHave?Math.min(1,foodNeed/foodHave):0;
 const fuelNeed=rows.reduce((n,r)=>n+r.fuelNeed,0),wood=Math.min(g.res.firewood,fuelNeed),coal=G.heatingPolicy().allowCoal?Math.min(G.heatingCoalAvailable(),Math.max(0,fuelNeed-wood)/G.COAL_HEAT):0;
 const cost=G.emptySupplyStock();for(const row of rows){
  for(const k of G.FOOD_KEYS)row.stock[k]=pop?(g.res[k]||0)*ratio*row.people/pop:0;
  row.stock.firewood=fuelNeed?wood*row.fuelNeed/fuelNeed:0;row.stock.coal=fuelNeed?coal*row.fuelNeed/fuelNeed:0;
  row.foodDays=row.people?G.supplyFood(row.stock)/(row.people*G.LIFE.eatPerDay):0;
  for(const k of G.SUPPLY.types)cost[k]+=row.stock[k];
 }
 const familiesWithoutBuyer=w.families.filter(f=>!w.citizens.some(c=>!c.dead&&c.familyId===f.id&&c.adult&&!c.student&&!G.isSick(c))).length;
 const readyStores=w.buildings.filter(b=>b.state==='ok'&&b.type==='storage').length;
 const key=JSON.stringify([g.day,g.season,g.supplyMode,G.SUPPLY.types.map(k=>g.res[k]),g.heating,rows,w.citizens.map(c=>[c.id,c.familyId,c.adult,c.student,G.isSick(c),c.job]),w.buildings.map(b=>[b.id,b.type,b.state,b.houseFire?.incident]),w.navigationRevision||0]);
 return {ok:pop>0,reason:pop?'':'当前没有居民',key,rows,cost,population:pop,foodDays:pop?G.supplyFood(cost)/(pop*G.LIFE.eatPerDay):0,foodShortfall:Math.max(0,foodNeed-G.supplyFood(cost)),fuelShortfall:Math.max(0,fuelNeed-wood-coal*G.COAL_HEAT),familiesWithoutBuyer,readyStores,
  rule:'一次性从公共库存划入最多两日启动口粮；冷季另划入最多两日取暖燃料。以后必须实际搬运，本存档不能切回自动供给。库存不足只按实际数量分配，无重复领取。'};
};
G.enableHouseholdSupply=function(key,expectedGame=G.game){
 const q=G.supplyModeQuote();if(expectedGame!==G.game||!q.ok||q.key!==key)return false;
 G.enablePhysicalSupplyPrototype();
 for(const row of q.rows){const target=row.target==='building'?G.world.bmap[row.id]:G.world.families.find(f=>f.id===row.id)?.supplyCamp;
  const stock=G.supplyStock(target);for(const[k,qty]of Object.entries(row.stock))stock[k]+=G.withdrawResource(k,qty);
 }
 G.game.prevFood=G.supplyEconomyStock('food');G.game.schedT=0;return true;
};
G.householdSupplySummary=function(b){
 const stock={...G.emptySupplyStock(),...b.supplyStock},people=G.supplyResidents(b).length,incoming=G.supplyIncoming(b),buyers=G.world.citizens.filter(c=>G.supplyTaskOf(c)?.to===b||G.supplyCargo(c)&&G.supplyDestination(c.carry.supplyBatch)===b);
 const foodDays=people?G.supplyFood(stock)/(people*G.LIFE.eatPerDay):0,heat=(G.BDEF[b.type]?.warmWoodPerYear||0)/G.SEASON_DAYS;
 let reason=!G.supplyEnabled()?'自动供给：仍按旧规则从公共库存每日食用和取暖':b.houseFire?'火情封闭：屋内物资暂不可取，烧毁时才计损':!people?'空屋物资由空闲散工实际回收':buyers.length?'采购或返家途中，送到后才可食用':G.supplyFood(stock)<people*G.LIFE.eatPerDay?'家中口粮不足一日：需有空手健康成人、可达仓库/市场及道路':'家中有粮，低于两日储备时成人会在当前任务收尾后采购';
 if(G.clothingSupplyEnabled()&&!buyers.length&&!b.houseFire&&people&&G.supplyNeeds(b).coats>=1)reason+='；备换衣物不足，需实际采购送回（已穿衣未到期不更换）';
 return {mode:G.game.supplyMode,stock,incoming,people,foodDays,fuelDays:heat?(stock.firewood+(G.heatingPolicy().allowCoal?stock.coal*G.COAL_HEAT:0))/heat:0,buyers:buyers.map(c=>({id:c.id,name:c.name})),reason};
};
G.marketSupplySummary=function(b){
 const stock={...G.emptySupplyStock(),...b.supplyStock},incoming=G.supplyIncoming(b),workers=G.workforceWorkers(b),targets=G.supplyEnabled()?G.supplyNeeds(b):null;
 return {mode:G.game.supplyMode,stock,incoming,capacity:G.SUPPLY.marketCap,stored:G.supplySum(stock),workers:workers.length,target:G.workerLimitOf(b),radius:G.SUPPLY.marketRadius,targets,
  reason:!G.supplyEnabled()?'请先确认全村真实配送规则；自动供给模式下市场不搬货':b.state!=='ok'?'施工中，完工才可取货':!G.workerLimitOf(b)?'0人停止补货；已有现货仍可供居民采购':!workers.length?'缺货商，等待健康空闲劳力；不会凭空产生货物':'一名货商最多搬80，家庭成人最多搬40；长途仓库适合集中运输，近仓绕市场可能更慢'};
};
G.supplyCitizenStatus=function(c){const t=G.supplyTaskOf(c);if(!t)return '';
 if(c.state==='supplyWait')return t.phase==='return'?'带生活物资等待可达仓位':t.phase==='fetch'?'等待有货且可达的采购点':'带生活物资等待可达住处/市场';
 return t.phase==='recover'?'回收散落或闲置生活物资':t.phase==='return'?'退回生活物资':t.phase==='fetch'?(t.vendor?'货商前往补货':'为家庭前往采购'):(t.vendor?'把生活物资送到市场':'把生活物资送到住处');
};

G.supplyDailyWarnings=function(){
 if(!G.supplyEnabled())return;const hungry=G.world.citizens.filter(c=>!c.dead&&c.hunger>0).length,cold=G.world.buildings.filter(b=>G.supplyHome(b)&&b.unheated&&G.supplyResidents(b).length).length;
 if(hungry&&!G.game.warned.supplyFood){G.ui.toast(`⚠ ${hungry} 人未收到家庭口粮，请检查采购者、现货和可达通路；公共有粮也不会瞬送到家`,'warn');G.game.warned.supplyFood=true;}if(!hungry)G.game.warned.supplyFood=false;
 if(cold&&!G.game.warned.supplyFuel){G.ui.toast(`⚠ ${cold} 户家中取暖燃料不足，请检查实际搬运距离与供货路线`,'warn');G.game.warned.supplyFuel=true;}if(!cold)G.game.warned.supplyFuel=false;
};

/* Teaching, clinic duty and hosting have no finite production batch. Offer a
 * grocery break at most every two hours while in service, and at morning
 * resumption; no goods or production work is canceled and the role stays held. */
G.supplyServiceBreak=function(c,dt){
 if(!G.supplyEnabled()||c.carry||c.pausedTask||c.state!=='work'||!['teach','clinic','host'].includes(c.task?.kind))return false;
 c.supplyServiceRetry=Math.max(0,(c.supplyServiceRetry||0)-dt);if(c.supplyServiceRetry>0)return false;c.supplyServiceRetry=2;
 const previous=c.task;if(G.tryHouseholdSupply(c))return true;c.task=previous;return false;
};


/* A separate one-time choice preserves the food/fuel-only contract of existing
 * physical saves. Worn durability is untouched; replacement needs real delivery. */
G.clothingSupplyQuote=function(){
 const g=G.game,w=G.world,enabled=G.clothingSupplyEnabled(),people=w.citizens.filter(c=>!c.dead);
 const key=JSON.stringify([g.supplyMode,g.clothingSupply,g.day,g.season,G.CLOTHING_KEYS.map(k=>g.res[k]),w.navigationRevision||0,
  people.map(c=>[c.id,c.familyId,c.clothingType,c.clothingLeft,c.adult,c.student,G.isSick(c)]),w.families.map(f=>[f.id,f.houseId]),w.buildings.map(b=>[b.id,b.state,b.houseFire?.incident])]);
 return {key,enabled,ok:G.supplyEnabled()&&!enabled&&people.length>0,unclothed:people.filter(c=>!(c.clothingLeft>0)).length,soon:people.filter(c=>c.clothingLeft>0&&c.clothingLeft<=7).length,
  public:{clothes:g.res.clothes,warmCoats:g.res.warmCoats},rule:'一次性启用后，穿坏才从住处或临时补给点的现货换衣；成人提前为7日内需换衣的家人采购。已穿衣耐久保留，不划拨或赠送衣物，不能切回远程领取。衣物不到家时即使公共有货也不能换上。'};
};
G.enableClothingSupply=function(key,expectedGame=G.game){const q=G.clothingSupplyQuote();if(expectedGame!==G.game||!q.ok||q.key!==key)return false;G.game.clothingSupply=true;G.game.schedT=0;return true;};
