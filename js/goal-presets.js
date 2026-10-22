'use strict';
/* Read-only planning suggestions. These never set goals, move stock, choose jobs,
 * change local cutoffs, or claim that a village can survive their limits. */
G.goalRecommendationContext = function () {
  const g=G.game,w=G.world,people=w.citizens.filter(c=>!c.dead);
  const homes=w.buildings.filter(b=>G.isOccupiedHome(w,b));
  return {
    population:people.length,season:g.season,day:g.day,
    occupiedHomes:homes.length,
    fullWinter:G.townHeatingBudget().fullWinter,
    capacities:Object.fromEntries(G.RES_KEYS.map(k=>[k,G.isTool(k)?Infinity:G.storageCap(k)])),
    localLimits:w.buildings.filter(b=>b.state==='ok'&&['woodcutter','blacksmith'].includes(b.type)).map(b=>({
      type:b.type==='woodcutter'?'firewood':G.blacksmithOutput(b),
      limit:b.type==='woodcutter'?G.fuelLimitOf(b):G.toolLimitOf(b)
    })),
    specificGoals:Object.fromEntries(G.FOOD_KEYS.map(k=>[k,G.productionGoalOf(k)]))
  };
};
G.recommendProductionGoals = function (mode, context) {
  const labels={balanced:'均衡储备',winter:'备冬储备',stockpile:'储粮'};
  if(!Object.prototype.hasOwnProperty.call(labels,mode))return null;
  const c=context||G.goalRecommendationContext(),pop=Math.max(0,Math.floor(c.population||0));
  const season=Number.isInteger(c.season)?c.season:0;
  const dayInSeason=((c.day||0)%G.SEASON_DAYS+G.SEASON_DAYS)%G.SEASON_DAYS;
  // The future heating window excludes today's calendar day, also after loading
  // a pre-burn season autosave. Food does not promise next-meal reachability.
  const futureWinterDays=season===3?Math.max(0,G.SEASON_DAYS-1-dayInSeason):G.SEASON_DAYS;
  const foodDays=mode==='stockpile'?2*G.SEASON_DAYS:mode==='winter'?
    (season===2?G.SEASON_DAYS-dayInSeason+G.SEASON_DAYS+2:Math.max(G.SEASON_DAYS,futureWinterDays+2)):G.SEASON_DAYS;
  const values={},requested={},limited=[],warnings=[];
  const add=(type,amount)=>{
    const wanted=Math.max(1,Math.ceil(amount)),capacity=c.capacities[type];
    // Leave public storage headroom for accepted batches. Distributed storage is
    // deliberately not assumed usable as extra warehouse capacity.
    const ceiling=Number.isFinite(capacity)?Math.max(0,Math.floor(capacity*.85)):G.PRODUCTION_GOAL_MAX;
    requested[type]=Math.min(G.PRODUCTION_GOAL_MAX,wanted);
    if(ceiling<1){limited.push(type);return;}
    values[type]=Math.min(G.PRODUCTION_GOAL_MAX,wanted,ceiling);
    if(values[type]<wanted)limited.push(type);
  };
  if(pop>0){
    add('food',pop*G.LIFE.eatPerDay*foodDays*1.15);
    if(mode!=='stockpile'){
      add('wood',Math.max(48,pop*4));
      add('stone',Math.max(16,pop*2));
      add('iron',Math.max(10,pop));
      add('tools',pop*.5);
      add('clothes',pop*(mode==='balanced'?.5:1));
      add('herbs',pop*.5);
      if(c.occupiedHomes>0&&c.fullWinter>0)add('firewood',c.fullWinter*({balanced:1.1,winter:1.25}[mode]));
      else warnings.push('没有已入住且可取暖的住房：柴火草稿保留，先检查住房；有柴也不能解决露宿。');
    }

  }else warnings.push('当前没有在世居民，不生成生产目标；现有草稿保留。');
  if(limited.length)warnings.push('仓容不足：'+limited.map(k=>`${G.RES[k].name}估算${requested[k]} → ${values[k]??'未填写'}`).join('；')+'。建议受公共仓容85%限制，未覆盖原估算需求。');
  const local=(c.localLimits||[]).filter(x=>values[x.type]!=null&&x.limit<values[x.type]);
  if(local.length)warnings.push(`${local.length}座工坊的本屋上限更低，仍按较低值停产；本屋上限不会改动。`);
  const specific=Object.entries(c.specificGoals||{}).filter(([,x])=>x!==null&&x!==undefined);
  if(specific.length)warnings.push('单项食物草稿保留：'+specific.map(([k,x])=>G.RES[k].name+' '+x).join('、')+'；这些限制与总食物同时生效，可能先停产，需逐项检查。');
  return {mode,label:labels[mode],values,requested,limited,foodDays,futureWinterDays,
    population:pop,occupiedHomes:c.occupiedHomes,fullWinter:c.fullWinter,
    notes:[
      `${pop}名居民 · ${G.SEASON_NAMES[season]||'当前'}季 · ${c.occupiedHomes}处已入住取暖建筑。`,
      `食物按每人每天${G.LIFE.eatPerDay.toFixed(2)}份 × ${foodDays}天，再加15%余量；只设置六种食物之和，不分摊到单项。`,
      mode==='stockpile'?'储粮只填写总食物；柴火、单项食物及其他资源草稿保留。':`柴火按当前住房整冬${Math.ceil(c.fullWinter||0)}份 × ${{balanced:1.1,winter:1.25,stockpile:1.5}[mode]}估算，不抵扣煤；${season===3?'本冬此后还有'+futureWinterDays+'次取暖扣除。':'住房入住变化后需重新估算。'}`,
      ...(mode==='stockpile'?[]:['材料按当前人口估算周转储备；工具、衣物与草药是备用件建议，不是产能或消耗预测。']),
      '仅替换下列资源草稿，其余保持原草稿。建议不高于现有公共仓容85%（工具不受硬仓容限制）；不计未来扩仓、出生、迁入、路程与损耗。'
    ],warnings};
};
