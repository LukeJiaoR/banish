'use strict';
/* Optional, bounded housing incidents. Water is a rescue task's temporary
 * state, never public stock/c.carry; an old-world task cannot apply water. */
G.FIRE={graceDays:48,warningHours:12,burnHours:36,waterTrips:3,waterDelayHours:6,maxRescuers:2,maxHomes:3,spreadGap:2,spreadHours:6,spreadChance:.15,dailyChance:.015,cooldownDays:24,fetchHours:.5,applyHours:.5};
G.activeHouseFires=()=>G.world.buildings.filter(b=>!!b.houseFire);
G.fireTaskOf=c=>[c.task,c.pausedTask].find(t=>t?.kind==='firefight'&&!t.completed)||null;
G.fireRescueEligible=c=>!!c&&!c.dead&&c.age>=18&&c.adult&&!c.student&&!G.isArriving(c)&&!G.isSick(c)&&c.hunger<1&&c.cold<G.LIFE.coldDays*.5&&c.job==null&&c.staffingRelease==null&&!c.carry&&!c.task&&!c.pausedTask;
G.fireRulesSummary=function(){const f=G.game.fireDisasters,active=G.activeHouseFires(),rescuers=G.world.citizens.filter(c=>!c.dead&&G.fireTaskOf(c)).length,availableRescuers=G.world.citizens.filter(G.fireRescueEligible).length;
 return {enabled:f.enabled,startedDay:f.startedDay,graceUntil:f.graceUntil,graceDays:Math.max(0,f.graceUntil-G.game.day),activeCount:active.length,rescuers,availableRescuers,ruins:G.world.buildings.filter(b=>b.type==='burntruins').length,
 reason:active.length&&!rescuers&&!availableRescuers?'缺少健康空闲散工：可降低非关键建筑用工上限，等待其当前批次和送货结束；不会抽调教师、医师或其他在岗者':active.length?'现有火情仍需真实取水扑救；关闭开关也不会灭掉现有火':!f.enabled?'住房火灾已关闭':G.game.day<f.graceUntil?'起火宽限期内，可先建设水井与备用住房':'风险已启用：仅独栋住房，先烟警后受损，无直接火灾死亡'};};
G.fireToggleQuote=function(enabled){const f=G.game.fireDisasters,active=G.activeHouseFires();return {ok:typeof enabled==='boolean',enabled,activeCount:active.length,graceUntil:f.startedDay===null?G.game.day+G.FIRE.graceDays:f.graceUntil,
 key:JSON.stringify([f.enabled,f.startedDay,f.graceUntil,f.serial,active.map(b=>b.id),enabled]),reason:enabled?'启用未来住房火情；首次启用有48日宽限。需健康空闲散工真实取水救援，迁出家庭仍有饥寒风险。':'关闭仅停止新的起火和邻屋传播；已发生的烟警/火焰仍会继续，须扑灭或最终烧毁。不会自动修复房屋。'};};
G.setFireDisasters=function(enabled,key,expectedGame=G.game){const q=G.fireToggleQuote(enabled);if(expectedGame!==G.game||!q.ok||q.key!==key)return false;const f=G.game.fireDisasters;
 if(enabled&&f.startedDay===null){f.startedDay=G.game.day;f.graceUntil=G.game.day+G.FIRE.graceDays;}f.enabled=enabled;f.lastDay=G.game.day;return true;};
G.fireHomeEligible=b=>!!b&&G.world.bmap[b.id]===b&&b.state==='ok'&&['house','stonehouse'].includes(b.type)&&!b.houseFire;
G.evacuateFireHome=function(b){const w=G.world,families=w.families.filter(f=>f.houseId===b.id),residents=new Set(families.flatMap(f=>f.members));
 for(const f of families)f.houseId=null;b.family=null;delete b.lastHeating;delete b.unheated;G.assignHousing();
 for(const c of w.citizens)if(residents.has(c.id)&&(c.state==='rest'||(c.state==='walk'&&c.walkKind==='home'))){c.path=null;c.pi=0;c.walkKind='';c.state='idle';c.camped=false;c.wanderT=.5;if(G.isRestTime())G.goHome(c);}
 return families.map(f=>f.id);};
G.igniteHouse=function(b,incident=null){if(!G.fireHomeEligible(b))return false;const f=G.game.fireDisasters;
 if(incident===null){if(G.activeHouseFires().length)return false;f.serial++;f.incidentHomes=[];f.nextIgnitionDay=G.game.day+G.FIRE.cooldownDays;incident=f.serial;}
 if(incident!==f.serial||f.incidentHomes.length>=G.FIRE.maxHomes||f.incidentHomes.includes(b.id))return false;
 f.incidentHomes.push(b.id);b.houseFire={incident,elapsed:0,need:G.FIRE.waterTrips,spreadAt:G.FIRE.warningHours+G.FIRE.spreadHours};
 G.evacuateFireHome(b);G.ui.toast(`🔥 ${G.BDEF[b.type].name}出现烟警：住户已迁出，12小时后开始受损；最多2名健康空闲散工取水救援`,'warn');
 G.assignFireRescuers();if(!G.world.citizens.some(c=>G.fireTaskOf(c)))G.ui.toast(G.fireRulesSummary().reason,'warn');return true;};
G.advanceFireDay=function(){const f=G.game.fireDisasters;if(f.lastDay>=G.game.day)return;f.lastDay=G.game.day;
 if(!f.enabled||G.game.day<f.graceUntil||G.game.day<f.nextIgnitionDay||G.activeHouseFires().length)return;
 const homes=G.world.buildings.filter(b=>G.fireHomeEligible(b)&&G.isOccupiedHome(G.world,b));if(!homes.length||!G.chance(G.FIRE.dailyChance))return;
 const target=homes[Math.floor(G.rng()*homes.length)];if(target.type==='stonehouse'&&!G.chance(.5))return;G.igniteHouse(target);};
G.fireFootprintGap=(a,b)=>Math.max(Math.max(0,a.x-b.x-b.w,b.x-a.x-a.w),Math.max(0,a.y-b.y-b.h,b.y-a.y-a.h));
G.cancelFireRescue=function(c){for(const k of ['task','pausedTask'])if(c[k]?.kind==='firefight')c[k]=null;c.path=null;c.pi=0;c.walkKind='';c.state='idle';c.wanderT=.5;};
G.finishHouseFire=function(b,burned){if(!b?.houseFire||G.world.bmap[b.id]!==b)return false;
 const incident=b.houseFire.incident;delete b.houseFire;for(const c of G.world.citizens)if(G.fireTaskOf(c)?.b===b)G.cancelFireRescue(c);
 if(burned){G.recordConstructionLoss(G.constructionEntitlement(b));delete b.construction;if(G.burnSupplyStock)G.burnSupplyStock(b);b.ruinIncident=incident;b.ruinFrom=b.type;b.type='burntruins';b.progress=1;b.workLeft=0;b.paidCost={};b.family=null;b.workers=[];b.noWork=false;b.warnText='';delete b.workerLimit;delete b.upgradeFrom;delete b.lastHeating;delete b.unheated;G.bumpNavigation(G.world);G.ui.toast('住房已烧毁，留下可清理的废墟；可支付新建材原址重建，无旧建材退款','warn');}
 else{G.assignHousing();G.ui.toast('火情已扑灭，房屋重新开放入住；按当前空床重新安置，不挤占其他家庭','good');}
 return true;};
G.advanceHousingFires=function(dtH){for(const b of G.activeHouseFires()){
 const h=b.houseFire;h.elapsed+=dtH;
 if(h.elapsed>=G.FIRE.warningHours+G.FIRE.burnHours){G.finishHouseFire(b,true);continue;}
 if(G.game.fireDisasters.enabled&&h.elapsed>=h.spreadAt){h.spreadAt+=G.FIRE.spreadHours;
  const f=G.game.fireDisasters;if(f.incidentHomes.length>=G.FIRE.maxHomes)continue;
  const candidates=G.world.buildings.filter(x=>x!==b&&G.fireHomeEligible(x)&&!f.incidentHomes.includes(x.id)&&G.fireFootprintGap(b,x)<=G.FIRE.spreadGap);
  for(const target of candidates){if(G.chance(G.FIRE.spreadChance*(target.type==='stonehouse'?.5:1))){G.igniteHouse(target,h.incident);break;}}
 }
}};
G.isFireBank=function(x,y){const w=G.world;if(!G.surfaceAccess(w,x,y))return false;return [[x+1,y],[x-1,y],[x,y+1],[x,y-1]].some(([a,b])=>a>=0&&b>=0&&a<w.N&&b<w.N&&w.water[b*w.N+a]===1);};
G.fireWaterSpot=function(c){const w=G.world,targets=[];
 for(const b of w.buildings)if(b.type==='well'&&b.state==='ok')for(let y=b.y-1;y<=b.y+b.h;y++)for(let x=b.x-1;x<=b.x+b.w;x++)if((x<b.x||x>=b.x+b.w||y<b.y||y>=b.y+b.h)&&x>=0&&y>=0&&x<w.N&&y<w.N&&G.surfaceAccess(w,x,y))targets.push({x,y,building:b,state:b.state,waterKind:'well'});
 for(let y=0;y<w.N;y++)for(let x=0;x<w.N;x++)if(G.isFireBank(x,y))targets.push({x,y,waterKind:'bank'});
 return targets.length?G.routeSpot(G.findPathToAny(w,c.x,c.y,targets)):null;};
G.fireSourceCurrent=t=>t?.source?.waterKind==='well'?G.world.bmap[t.source.building?.id]===t.source.building&&t.source.building.state==='ok':t?.source?.waterKind==='bank'&&G.isFireBank(t.source.x,t.source.y);
G.fireTaskCurrent=(c,t)=>!!c&&G.world.cmap[c.id]===c&&!c.dead&&!G.isSick(c)&&c.age>=18&&!c.student&&!c.carry&&c.job==null&&t?.kind==='firefight'&&!t.completed&&(c.task===t||c.pausedTask===t)&&G.world.bmap[t.b?.id]===t.b&&t.b.houseFire?.incident===t.incident;
G.fireLegSpot=function(c,t){if(!G.fireTaskCurrent(c,t))return null;return t.phase==='fetch'?G.fireWaterSpot(c):G.workSpot(G.world,t.b,c.x,c.y);};
G.planFireLeg=function(c,t){if(!G.fireTaskCurrent(c,t)){G.cancelFireRescue(c);return false;}const spot=G.fireLegSpot(c,t);
 if(!spot){c.path=null;c.pi=0;c.state='fireWait';t.retryH=2;t.waitReason=t.phase==='fetch'?'没有可达水井或河岸，等候通路；水井无占工需求':'取水后火点不可达，保留本桶水等待通路';return false;}
 if(t.phase==='fetch')t.source=spot.route.target;t.tx=spot.x;t.ty=spot.y;t.waitReason='';return G.sendTo(c,t.tx,t.ty,spot.route);};
G.assignFireRescuers=function(){if(!G.activeHouseFires().length)return;let slots=G.FIRE.maxRescuers-G.world.citizens.filter(c=>G.fireTaskOf(c)).length;if(slots<=0)return;
 for(const c of G.world.citizens.filter(G.fireRescueEligible)){if(slots<=0)break;
  const targets=G.activeHouseFires().map(b=>({b,spot:G.workSpot(G.world,b,c.x,c.y)})).filter(q=>q.spot).sort((a,b)=>a.spot.route.eta-b.spot.route.eta);
  const q=targets[0];if(!q)continue;
  const t={kind:'firefight',b:q.b,incident:q.b.houseFire.incident,phase:'fetch',water:false,work:G.FIRE.fetchHours,workLeft:G.FIRE.fetchHours,tx:q.spot.x,ty:q.spot.y,retryH:0};c.warmthJourney=null;c.task=t;c.path=null;c.pausedTask=null;c.camped=false;G.planFireLeg(c,t);slots--;
 }
};
G.atFireLeg=function(c,t){if(!G.fireTaskCurrent(c,t)||G.d2(c.x,c.y,t.tx,t.ty)>.000001||G.tileBlocked(G.world,Math.round(c.x),Math.round(c.y)))return false;
 return t.phase==='fetch'?G.fireSourceCurrent(t)&&(t.source.waterKind==='bank'||G.atMedicalDoor(c,t.source.building)):t.water&&G.atMedicalDoor(c,t.b);};
G.stepFirefighting=function(c,dtH){const t=G.fireTaskOf(c);if(!t)return false;
 if(!G.fireTaskCurrent(c,t)){G.cancelFireRescue(c);return false;}
 if(c.state==='fireWait'){t.retryH-=dtH;if(t.retryH<=0)G.planFireLeg(c,t);return true;}
 if(t.phase==='fetch'&&!G.fireSourceCurrent(t)){G.planFireLeg(c,t);return true;}
 if(c.state!=='work')return false;
 if(!G.atFireLeg(c,t)){G.planFireLeg(c,t);return true;}
 t.workLeft-=dtH;if(t.workLeft<=0)G.completeFirefighting(c,t);return true;};
G.completeFirefighting=function(c,t){if(!G.atFireLeg(c,t)||t.workLeft>0)return false;
 if(t.phase==='fetch'){t.phase='apply';t.water=true;t.work=t.workLeft=G.FIRE.applyHours;G.planFireLeg(c,t);return true;}
 const b=t.b;t.completed=true;t.water=false;c.task=null;c.path=null;c.state='idle';c.wanderT=.5;b.houseFire.need--;b.houseFire.elapsed=Math.max(0,b.houseFire.elapsed-G.FIRE.waterDelayHours);
 if(b.houseFire.need<=0)G.finishHouseFire(b,false);return true;};
G.fireRescueState=function(c){const t=G.fireTaskOf(c);return t?(t.waitReason||(t.phase==='fetch'?'救火：前往可达井/河岸取水':'救火：携水前往火点并浇水')):'';};
G.houseFireSummary=function(b){if(b?.type==='burntruins')return {active:false,ruin:true,phase:'ruin',status:'住房已烧毁，不能居住；清理不返还旧建材，可支付新材料原址重建',origin:b.ruinFrom,elapsed:0,warningHours:G.FIRE.warningHours,damage:100,waterNeeded:0,rescuers:0,reason:'原家庭身份和已经携带的货物保留，需现有空房或宿舍安置'};
 const h=b?.houseFire;if(!h)return null;const phase=h.elapsed<G.FIRE.warningHours?'warning':'burning',rescuers=G.world.citizens.filter(c=>G.fireTaskOf(c)?.b===b),reason=rescuers.map(c=>G.fireTaskOf(c).waitReason).find(Boolean)||(!rescuers.length?'缺少健康空闲散工或火点不可达；可调低非关键岗位释放散工，先等在途货送净':'救援者真实取水往返，不占用原有货物');
 return {active:true,ruin:false,phase,status:phase==='warning'?'烟警：住户已迁出，尚未发生结构损失':'火焰：正在受损，需取水扑救',elapsed:h.elapsed,warningHours:G.FIRE.warningHours,damage:Math.max(0,(h.elapsed-G.FIRE.warningHours)/G.FIRE.burnHours*100),waterNeeded:h.need,rescuers:rescuers.length,origin:b.type,reason};};
G.fireRebuildQuote=function(b){const invalid={ok:false,key:'',cost:{},origin:null,homelessFamilies:0,winter:G.isWinter(),reason:'只能重建本村烧毁的独栋住房'};
 if(!b||G.world.bmap[b.id]!==b||b.type!=='burntruins'||!['house','stonehouse'].includes(b.ruinFrom))return invalid;
 const cost={...G.BDEF[b.ruinFrom].cost},missing=Object.entries(cost).filter(([k,n])=>G.game.res[k]<n),homelessFamilies=G.world.families.filter(f=>f.houseId==null).length;
 const reachable=G.world.citizens.some(c=>!c.dead&&c.adult&&!c.student&&G.workSpot(G.world,b,c.x,c.y));
 const reason=missing.length?'重建材料不足：'+missing.map(([k,n])=>G.RES[k].name+' '+n).join('、'):!reachable?'没有成人可到达废墟施工':'原址按原房型重新建造，完成前仍需临时住房；原烧毁材料不回收';
 return {ok:!missing.length&&reachable,key:JSON.stringify([b.id,b.ruinFrom,b.ruinIncident,cost,!missing.length,reachable,homelessFamilies,G.isWinter()]),cost,origin:b.ruinFrom,homelessFamilies,winter:G.isWinter(),reason};};
G.rebuildBurntHome=function(b,key,expectedGame=G.game){const q=G.fireRebuildQuote(b);if(expectedGame!==G.game||!q.ok||q.key!==key)return {ok:false,reason:'重建条件或村庄已改变，请重新确认'};
 b.construction=G.newConstruction(q.cost);b.type=q.origin;delete b.ruinFrom;delete b.ruinIncident;b.state='site';b.paidCost={...q.cost};b.workLeft=b.totalWork=G.BDEF[b.type].buildWork;b.progress=0;b.constructionStarted=false;b.family=null;b.workers=[];b.noWork=false;b.warnText='';b.sitePaused=false;delete b.sitePriority;delete b.workerLimit;G.bumpNavigation(G.world);G.scheduleJobs();return {ok:true,b};};
