'use strict';
/* ============================================================
 * render.js —— 等距渲染：地面缓存、建筑、市民、树木、粒子
 * 坐标系：tile(z=1) 屏幕 = ((tx-ty)*32, (tx+ty)*16) + 相机
 * ============================================================ */

G.cam = { x: 0, y: 0, z: 1 };
G.groundScale = 0.5;   // 地面缓存画布降采样
G.CACHE_MAX_PX = 16000000; // 地面缓存画布像素上限（Safari 单画布约 1677 万像素，超出会静默空白）
G.groundOX = 0; G.groundOY = 0;
G.needGround = true;
G.groundDirty = new Set();  // 只变了道路/岩石的瓦片：局部重绘，不整图重建
G.smoke = [];
G.flakes = null;

/* 初建、缩放和换图共用同一预算；约束实际向上取整后的整数像素，而非仅浮点面积。 */
G.groundCacheSize = function (requestedScale) {
  const N = G.world.N, fullW = N * 64 + 80, fullH = N * 32 + 80;
  let scale = Math.min(requestedScale, 1, Math.sqrt(G.CACHE_MAX_PX / (fullW * fullH)));
  let width = Math.ceil(fullW * scale), height = Math.ceil(fullH * scale);
  if (width * height > G.CACHE_MAX_PX) {
    // 保留原高度的预算，缩减取整带来的少量宽度；避开浮点乘法在整数边界向上取整。
    scale = Math.min(scale, Math.floor(G.CACHE_MAX_PX / height) / fullW) * (1 - Number.EPSILON);
    width = Math.ceil(fullW * scale); height = Math.ceil(fullH * scale);
  }
  return { scale, width, height };
};

G.maxGroundScale = function () {
  return G.world ? G.groundCacheSize(1).scale : 1;
};

/* 夜色浓度（0-1）：20 点入夜 → 22 点全暗 → 4 点最暗 → 6 点天亮 */
G.nightAlpha = function () {
  const h = G.game.h;
  if (h >= G.LIFE.restFrom || h < 4) return 0.42;
  if (h >= 20) return 0.42 * (h - 20) / (G.LIFE.restFrom - 20);
  if (h >= 4 && h < G.LIFE.restTo) return 0.42 * (1 - (h - 4) / (G.LIFE.restTo - 4));
  return 0;
};

/* tile → z=1 屏幕坐标（返回瓦片顶角） */
G.T2S = function (tx, ty) { return [(tx - ty) * 32, (tx + ty) * 16]; };

/* 屏幕(css px) → tile 浮点坐标 */
G.screenToTile = function (sx, sy) {
  const u = (sx - G.cam.x) / G.cam.z;
  const v = (sy - G.cam.y) / G.cam.z;
  const tx = u / 64 + v / 32;
  const ty = v / 32 - u / 64;
  return { tx, ty };
};

G.diamondPath = function (ctx, sx, sy) {
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + 32, sy + 16);
  ctx.lineTo(sx, sy + 32);
  ctx.lineTo(sx - 32, sy + 16);
  ctx.closePath();
};

/* Collision remains binary. Shared deterministic surface vertices make rounded
 * ridges: low at the footprint edge, rising inward. No saved elevation rules. */
G.MOUNTAIN_MAX_RISE = 88;
G.mountainHeights = new WeakMap();
G.mountainCornerHeight = function(w,x,y) {
  let heights=G.mountainHeights.get(w);
  if(!heights){heights=new Float32Array((w.N+1)*(w.N+1)).fill(NaN);G.mountainHeights.set(w,heights);}
  const i=y*(w.N+1)+x;if(Number.isFinite(heights[i]))return heights[i];
  let distance=5;
  for(let yy=y-5;yy<=y+4;yy++)for(let xx=x-5;xx<=x+4;xx++)
    if(!G.isMountain(w,xx,yy))distance=Math.min(distance,Math.hypot(xx+.5-x,yy+.5-y));
  const inset=Math.max(0,distance-Math.SQRT1_2);
  const ripple=9*Math.min(1,inset/2)*Math.sin(x*.32+(w.seed||0)%97)*Math.cos(y*.27+(w.seed||0)%43);
  heights[i]=Math.max(3,Math.min(G.MOUNTAIN_MAX_RISE,3+24*Math.pow(inset,.82)+ripple));return heights[i];
};
G.mountainPolygons = function(w,x,y) {
  if(!G.isMountain||!G.isMountain(w,x,y))return [];
  const [sx,sy]=G.T2S(x,y),heights=[[x,y],[x+1,y],[x+1,y+1],[x,y+1]].map(([xx,yy])=>G.mountainCornerHeight(w,xx,yy));
  const top=[[sx,sy-heights[0]],[sx+32,sy+16-heights[1]],[sx,sy+32-heights[2]],[sx-32,sy+16-heights[3]]];
  const out=[];
  if(!G.isMountain(w,x,y+1))out.push({kind:'left',points:[top[3],top[2],[sx,sy+32],[sx-32,sy+16]]});
  if(!G.isMountain(w,x+1,y))out.push({kind:'right',points:[top[2],top[1],[sx+32,sy+16],[sx,sy+32]]});
  out.push({kind:'topX',points:[top[0],top[1],top[2]],heights:[heights[0],heights[1],heights[2]]});
  out.push({kind:'topY',points:[top[0],top[2],top[3]],heights:[heights[0],heights[2],heights[3]]});
  return out;
};
G.mountainPolygonPath = function(ctx,points) {
  ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();
};
G.pointInMountainPolygon = function(x,y,points) {
  let sign=0;
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],cross=(b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]);
    if(Math.abs(cross)<1e-7)continue;
    const next=Math.sign(cross);if(sign&&sign!==next)return false;sign=next;
  }
  return true;
};
/* Use for pointer actions only; camera transforms/culling retain the plane inverse. */
G.screenToMapTile = function(sx,sy) {
  const flat=G.screenToTile(sx,sy),w=G.world;
  if(!w||!w.mountain)return flat;
  const px=(sx-G.cam.x)/G.cam.z,py=(sy-G.cam.y)/G.cam.z,candidates=[];
  for(let y=Math.floor(flat.ty)-1;y<=Math.floor(flat.ty)+3;y++)
    for(let x=Math.floor(flat.tx)-1;x<=Math.floor(flat.tx)+3;x++)
      {if(G.isMountain(w,x,y))candidates.push({x,y,d:x+y+1});
       const b=G.tunnelAt(w,x,y);if(b){const ends=G.tunnelEndpoints(b);for(const [p,first]of [[ends.start,true],[ends.end,false]])if(p.x===x&&p.y===y)candidates.push({x,y,d:x+y+.62,portal:G.tunnelPortalGeometry(b,p,first)});}}
  candidates.sort((a,b)=>b.d-a.d||b.y-a.y||b.x-a.x);
  for(const p of candidates){if(p.portal?G.pointInMountainPolygon(px,py,p.portal.points):G.mountainPolygons(w,p.x,p.y).some(face=>G.pointInMountainPolygon(px,py,face.points)))
    return {tx:p.x+.5,ty:p.y+.5,...(p.portal?{tunnel:true}:{mountain:true})};}
  return flat;
};
G.drawMountain = function(ctx,w,x,y) {
  const snowy=G.game.season===3,name=snowy?'mountain_rock_snow':'mountain_rock',im=G.SPR&&G.SPR.get(name);
  const faces=G.mountainPolygons(w,x,y),tops=faces.filter(f=>f.kind.startsWith('top'));
  // One continuous backing prevents separately antialiased texture triangles
  // revealing the winter ground through their shared diagonal. Exact vertices,
  // no stroke expansion: this does not paint outside the picked footprint.
  const backing=snowy?'#a99b83':'#a3957d';
  if(tops.length===2){G.mountainPolygonPath(ctx,[tops[0].points[0],tops[0].points[1],tops[0].points[2],tops[1].points[2]]);ctx.fillStyle=backing;ctx.fill();}
  for(const face of faces){
    ctx.save();G.mountainPolygonPath(ctx,face.points);ctx.clip();
    ctx.fillStyle=backing;ctx.fill();
    if(face.kind.startsWith('top')){
      if(im&&im.width&&ctx.createPattern){
        const [t,m,n]=face.points;
        const a=face.kind==='topX'?(m[0]-t[0])/64:(m[0]-n[0])/64;
        const b=face.kind==='topX'?(m[1]-t[1])/64:(m[1]-n[1])/64;
        const c=face.kind==='topX'?(n[0]-m[0])/64:(n[0]-t[0])/64;
        const d=face.kind==='topX'?(n[1]-m[1])/64:(n[1]-t[1])/64;
        ctx.save();ctx.transform(a,b,c,d,t[0]-a*x*64-c*y*64,t[1]-b*x*64-d*y*64);
        ctx.fillStyle=ctx.createPattern(im,'repeat');ctx.fillRect(x*64-.5,y*64-.5,65,65);ctx.restore();
      }
      const h=face.heights,dx=face.kind==='topX'?h[1]-h[0]:h[1]-h[2],dy=face.kind==='topX'?h[2]-h[1]:h[2]-h[0];
      const shade=Math.max(-.09,Math.min(.11,(dx-dy)*.0045));
      ctx.fillStyle=shade<0?'rgba(255,248,222,'+(-shade)+')':'rgba(36,33,27,'+shade+')';ctx.fill();
    } else {
      const [sx,sy]=G.T2S(x,y);
      if(im&&im.width&&ctx.createPattern){ctx.fillStyle=ctx.createPattern(im,'repeat');ctx.fillRect(sx-32,sy-G.MOUNTAIN_MAX_RISE,64,G.MOUNTAIN_MAX_RISE+32);}
      ctx.fillStyle=face.kind==='left'?'rgba(35,34,30,.17)':'rgba(35,34,30,.34)';ctx.fill();
    }
    ctx.restore();
  }
};
G.drawMountainHover = function(ctx,w,x,y) {
  const faces=G.mountainPolygons(w,x,y);if(!faces.length)return false;
  ctx.save();ctx.strokeStyle=G.tool?'rgba(238,133,100,.95)':'rgba(245,237,200,.75)';ctx.lineWidth=1.5/G.cam.z;
  for(const face of faces){G.mountainPolygonPath(ctx,face.points);ctx.stroke();}
  ctx.restore();return true;
};

/* ---------- 精灵辅助（assets/ 图片；任一缺失时调用方回退程序化绘制） ---------- */
/* 以「脚点」(cx, by=底边中心) 画一张精灵，按 G.SPRITE_SIZES 或 opts.w 定尺寸。
 * 命中返回 [dw, dh]，缺失返回 null。opts.flip = 水平镜像。 */
G.sprDraw = function (ctx, name, cx, by, opts) {
  const im = G.SPR && G.SPR.get(name);
  if (!im || !im.width) return null;
  const sz = (opts && opts.w) ? { w: opts.w } : (G.SPRITE_SIZES[name] || {});
  let dw, dh;
  if (sz.w) { dw = sz.w; dh = dw * im.height / im.width; }
  else if (sz.h) { dh = sz.h; dw = dh * im.width / im.height; }
  else { dw = im.width; dh = im.height; }
  if (opts && opts.flip) {
    ctx.save();
    ctx.translate(cx, by);
    ctx.scale(-1, 1);
    ctx.drawImage(im, -dw / 2, -dh, dw, dh);
    ctx.restore();
  } else {
    const air=opts?.omitSmokeAir&&G.BUILD_SMOKE_AIR?.[name];
    if(air&&im.width===air.source[0]&&im.height===air.source[1]){
      // Runtime visibility only: preserve source pixels and the chimney/roof.
      // The omitted rectangle ends above the first masonry pixel.
      const [x,y,w,h]=air.rect;ctx.save();ctx.beginPath();ctx.rect(cx-dw/2,by-dh,dw,dh);ctx.rect(cx-dw/2+x*dw/im.width,by-dh+y*dh/im.height,w*dw/im.width,h*dh/im.height);ctx.clip('evenodd');
      ctx.drawImage(im,cx-dw/2,by-dh,dw,dh);ctx.restore();
    }else ctx.drawImage(im, cx - dw / 2, by - dh, dw, dh);
  }
  return [dw, dh];
};

/* 地表纹理：季节后缀映射（G.PAL 下标 → 切图文件名后缀） */
G.TEX_SEASON = ['spring', 'summer', 'autumn', 'winter'];
/* 在地面缓存里以菱形裁切铺一张可平铺纹理（轻微外溢 1px 消除瓦片接缝），
 * tint/tintA 可选：叠加一层同色系平色制造瓦片变化 */
G.fillTexDiamond = function (c, name, sx, sy, tint, tintA) {
  const im = G.SPR.get(name);
  if (!im || !im.width) return false;
  G.diamondPath(c, sx, sy);
  c.save();
  c.clip();
  c.drawImage(im, sx - 32.5, sy - 0.5, 65, 33);
  if (tint) {
    c.globalAlpha = tintA;
    c.fillStyle = tint;
    c.fillRect(sx - 33, sy - 1, 66, 34);
    c.globalAlpha = 1;
  }
  c.restore();
  return true;
};

/* Continuous world-anchored terrain. One texture covers eight tiles per axis;
 * tile boundaries never restart the picture or introduce a decorative outline.
 * Patterns are local to their Canvas context and invalidated when the image loads. */
G.terrainPatterns = new WeakMap();
G.fillTerrainSurface = function (c, name, x, y) {
  const im = G.SPR.get(name);
  if (!im || !im.width || !c.createPattern || !c.transform) return false;
  let entries = G.terrainPatterns.get(c);
  if (!entries) { entries = new Map(); G.terrainPatterns.set(c, entries); }
  let cached = entries.get(name);
  if (!cached || cached.image !== im) {
    cached = { image: im, pattern: c.createPattern(im, 'repeat') };
    entries.set(name, cached);
  }
  if (!cached.pattern) return false;
  c.save();
  c.transform(0.5, 0.25, -0.5, 0.25, 0, 0);
  c.fillStyle = cached.pattern;
  // Tiny overlap avoids subpixel cracks at low ground-cache resolutions.
  c.fillRect(x * 64 - 0.5, y * 64 - 0.5, 65, 65);
  c.restore();
  return true;
};

/* 建筑精灵按占地菱形的宽度比例缩放（图里自带栅栏/台阶等出格装饰） */
G.BUILD_SPR_W = {
  house: 1.16, stonehouse: 1.12, boarding: 1.04, storage: 1.03, stockpile:1.25, mine: 1.12,
  gatherer: 1.10, forester: 1.06, woodcutter: 1.12, dock: 1.0,
  school: 1.06, blacksmith: 1.06, hunting: 1.08, site_2x2: 1.0, site_3x3: 1.0,
  market:7/6, well: 1.25, burntruins: 1.25, tailor: 1.04, tavern: 7 / 6, tradingpost: 0.875, herbalist: 1.25, hospital: 7 / 6, stonequarry: 7 / 6, mineralpit: 7 / 6, townhall: 7 / 6, chapel: 1.08,
};

/* Building cues are presentation-only. Stock, tasks, family ownership and save
 * data remain owned by simulation. Shared 250ms snapshots serve visible objects;
 * detail-panel callers obtain current facts without mutating the simulation. */
G.BUILD_ACTIVITY_TYPES=['house','stonehouse','boarding','blacksmith','woodcutter','tailor','tavern'];
// Verified source-space air rectangles exclude all chimney masonry. A few
// pre-existing pixels inside the chimney throat are deliberately retained.
G.BUILD_SMOKE_AIR={house:{source:[280,285],rect:[155,0,80,49]},stonehouse:{source:[633,514],rect:[315,0,100,54]}};
G.BUILD_EFFECT_ANCHORS={
 house:{chimney:[.603571,.207018],window:[.471429,.712281]},
 stonehouse:{chimney:[.541864,.126459],window:[.424961,.671206]},
 boarding:{chimney:[.290698,.118534],window:[.456072,.418103]},
 blacksmith:{work:[.355469,.729167]},woodcutter:{work:[.315789,.8]},
 tailor:{work:[.668,.72038]},tavern:{work:[.823661,.675]}
};
G.buildingActivityContext=function(){
 const w=G.world,homes=new Map();
 for(const f of w.families||[])if(f.houseId!=null){if(!homes.has(f.houseId))homes.set(f.houseId,[]);homes.get(f.houseId).push(f);}
 return {world:w,homes,population:(w.citizens||[]).reduce((n,c)=>n+!c.dead,0)};
};
G.buildingProcessingWorker=function(b,c,context){
 const t=c?.task,w=G.world,k=({blacksmith:'smith',woodcutter:'fuel',tailor:'tailor',tavern:'brew'})[b.type];
 if(!k||!c||c.dead||c.job!==b.id||w.cmap[c.id]!==c||c.state!=='work'||!t||t.kind!==k||t.b!==b||t.phase!=='process'||t.completed||!(t.workLeft>0)||G.d2(c.x,c.y,t.tx,t.ty)>.04||G.tileBlocked(w,Math.round(c.x),Math.round(c.y))||!G.atMedicalDoor(c,b))return false;
 const cargo=c.carry;
 if(k==='smith')return G.smithTaskCurrent(c,t)&&G.smithCargoMatches(c,t);
 if(k==='fuel')return G.fuelTaskCurrent(c,t)&&cargo===t.inputCargo&&cargo?.fuelInput===true&&cargo.staffingReturn===true&&cargo.type==='wood'&&cargo.qty===t.consume?.qty&&!cargo.extra;
 if(k==='tailor'){
  const contents=cargo?{[cargo.type]:cargo.qty,...(cargo.extra||{})}:{};
  return G.tailorTaskCurrent(c,t)&&cargo===t.inputCargo&&cargo?.coatInput===b.id&&cargo.staffingReturn===true&&Array.isArray(t.consume)&&Object.keys(contents).length===t.consume.length&&t.consume.every(x=>contents[x.type]===x.qty);
 }
 const recipe=G.brewRecipeSnapshot(t),population=context?.population??w.citizens.filter(x=>!x.dead).length;
 return !G.isSick(c)&&cargo?.brewIngredient===true&&cargo.type===recipe.inputType&&cargo.qty===recipe.inputQty&&G.game.res.food>=population*G.LIFE.eatPerDay*G.tavernReserveDays(b);
};
G.buildingActivity=function(b,context){
 const w=G.world;if(!b||!w||!w.bmap||w.bmap[b.id]!==b||b.state!=='ok'||b.houseFire||!G.BUILD_ACTIVITY_TYPES.includes(b.type))return null;
 context=context?.world===w?context:G.buildingActivityContext();
 const paused=!!G.game.paused;
 if(['house','stonehouse','boarding'].includes(b.type)){
  const residents=(context.homes.get(b.id)||[]).filter(f=>f.houseId===b.id).flatMap(f=>(f.members||[]).map(id=>w.cmap[id]).filter(c=>c&&!c.dead&&c.familyId===f.id));
  const atHome=residents.filter(c=>G.citizenIndoorHome(c,new Map([[c.familyId,b]]))===b).length;
  const last=b.lastHeating,heating=G.isWinter()&&residents.length>0&&!b.unheated&&last?.day===G.game.day&&(last.wood+(last.coal||0)*G.COAL_HEAT)>0;
  const state=!residents.length?'vacant':atHome?'home':'away';
  return {kind:'home',state,occupied:residents.length,atHome,heating,active:false,paused,
   label:!residents.length?'空置：没有住户':`已入住 ${residents.length} 人 · 此刻在家 ${atHome} 人`,
   detail:(!residents.length?'无新增炊烟；原画窗色不代表入住。':atHome?'夜间仅在家时增加窗内暖光。':'住户在外，入住不代表此刻在家。')+(heating?' 本日已有实际取暖燃料消耗。':G.isWinter()?' 尚无本日有效取暖燃料记录，不新增炊烟。':' 非冬季不新增取暖炊烟。')+(paused?' 游戏已暂停，动态冻结。':'')+' 标记：空门框=空置，人形=住户在外，小屋=此刻在家。'};
 }
 const workers=(b.workers||[]).map(id=>w.cmap[id]).filter(c=>c&&!c.dead&&c.job===b.id),processing=workers.find(c=>G.buildingProcessingWorker(b,c,context));
 let state,label,detail;
 if(processing){const limited=G.productionLimited(b)||(b.type==='tavern'&&(G.goalPaused('ale')||G.game.res.ale>=Math.min(G.productionGoalOf('ale')??30,G.storageCap())));state='working';label=paused?'全局暂停：已接加工批次保留':'正在现场加工';detail=`${processing.name||'工人'}已携实料到工作点；动效只代表本批加工。`+(G.workerLimitOf(b)<=0?' 用工上限为0，本批完成后停接。':limited?' 生产目标或备货上限已达，本批完成后停接。':'');}
 else if(paused){state='paused';label='全局暂停';detail='动效冻结；不会因此消耗材料或完成批次。';}
 else if(workers.some(c=>c.task?.b===b&&c.task.phase==='fetch')){state='fetching';label='取料途中或正在领料';detail='工人尚未回到加工点，不播放生产动效。';}
 else if(workers.some(c=>c.task?.b===b&&c.task.phase==='process'&&c.state!=='work')){state='returning';label='实料返工坊途中';detail='材料仍由工人持有，到场实际加工后才播放动效。';}
 else if(workers.some(c=>c.carry&&(c.state==='haul'||!c.task))){state='hauling';label='搬运产物或退还材料';detail='接受的货物继续实际搬运，工坊此刻不播放生产动效。';}
 else if(G.workerLimitOf(b)<=0){state='paused';label='暂停新批次：用工上限为0';detail='已接任务和实货仍按现有合同处理。';}
 else if(!workers.length){state='unstaffed';label='无人值岗';detail='分配到可用工人并真正开工后才播放生产动效。';}
 else if(G.productionLimited(b)){state='paused';label='暂停新批次：达到生产目标';detail='达到目标不会丢弃已接受的批次或货物。';}
 else if(b.type==='tavern'&&workers.some(c=>c.state==='work'&&c.task?.kind==='host'&&c.task.b===b&&G.atMedicalDoor(c,b))){state='hosting';label='酒馆接待中，未酿造';detail='接待住民与酿酒是不同实际任务。';}
 else if(b.type==='tavern'&&workers.every(c=>G.isSick(c))){state='blocked';label='酿酒工生病，暂停酿造';detail='已取原料按既有规则退回，等待健康酿酒工。';}
 else if((b.type==='woodcutter'&&G.game.res.wood<G.PROD.woodcutter.logsIn)||(b.type==='blacksmith'&&G.blacksmithRecipe(b).some(x=>G.game.res[x.type]<x.qty))){state='blocked';label='缺少加工原料';detail='等待所选配方需要的真实库存；取到料并回到工坊后才播放动效。';}
 else if(b.type==='tailor'&&!G.tailorProductionStatus(b).ok){state='blocked';label=G.tailorProductionStatus(b).reason;detail='等待真实衣料或仓容条件，不播放加工动效。';}
 else if(b.type==='tavern'&&!G.tavernBrewStatus(b).ok){state='blocked';label=G.tavernBrewStatus(b).reason;detail='当前未酿造；接待与加工分别显示。';}
 else if(b.noWork||b.warnText){state='blocked';label='等待条件：'+(b.warnText||'当前无法开工');detail='未发生现场加工，静态炉色/窗色不代表正在生产。';}
 else{state='idle';label='空闲：尚未开始现场加工';detail='已分配工人可能在休息、应急或等待任务；静态炉色/窗色不代表生产。';}
 detail+=' 标记：▶加工，Ⅱ暂停，!条件受阻，—无人，○取料/搬运/空闲。';
 return {kind:'workshop',state,label,detail,active:!!processing,workerId:processing?.id,paused};
};
G.prepareBuildingActivities=function(buildings,now){
 const bucket=Math.floor(now*4),w=G.world;
 let frame=G._buildingActivityFrame;
 if(!frame||frame.world!==w||frame.bucket!==bucket||frame.paused!==!!G.game.paused||(!frame.context&&buildings.length)){frame={world:w,bucket,paused:!!G.game.paused,context:buildings.length?G.buildingActivityContext():null,entries:new Map()};G._buildingActivityFrame=frame;}
 for(const b of buildings)if(!frame.entries.has(b.id))frame.entries.set(b.id,G.buildingActivity(b,frame.context));
 return frame;
};
G.buildingAnchor=function(b,spr,footX,footY,name){const uv=G.BUILD_EFFECT_ANCHORS[b.type]?.[name];return uv?[footX+(uv[0]-.5)*spr[0],footY+(uv[1]-1)*spr[1]]:null;};
G.buildingReducedMotion=function(){if(!G._buildingMotionQuery&&typeof matchMedia==='function')G._buildingMotionQuery=matchMedia('(prefers-reduced-motion: reduce)');return !!G._buildingMotionQuery?.matches;};
G.buildingEffectTime=0;
// Consistent ~11px footpoint badge remains legible without movement or color.
G.drawBuildingStateMarker=function(ctx,s,x,y,active){
 ctx.save();ctx.globalAlpha=.96;ctx.fillStyle='#3e4538';ctx.strokeStyle='#c2b494';ctx.lineWidth=.85;
 ctx.beginPath();ctx.arc(x,y,5.6,0,Math.PI*2);ctx.fill();ctx.stroke();
 ctx.fillStyle=s.kind==='home'?(s.atHome?'#f0cc82':'#b9cf9a'):'#ecd190';ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=1.1;
 if(s.kind==='home'){
  if(!s.occupied)ctx.strokeRect(x-2,y-3,4,6);
  else if(s.atHome){ctx.beginPath();ctx.moveTo(x-3,y-1);ctx.lineTo(x,y-3.6);ctx.lineTo(x+3,y-1);ctx.closePath();ctx.fill();ctx.fillRect(x-2,y-1,4,4);}
  else{ctx.beginPath();ctx.arc(x,y-2,1.2,0,Math.PI*2);ctx.fill();ctx.fillRect(x-1.5,y,3,3);}
 }else if(G.game.paused||s.state==='paused'){ctx.fillRect(x-2.5,y-3,1.7,6);ctx.fillRect(x+.8,y-3,1.7,6);}
 else if(active){ctx.beginPath();ctx.moveTo(x-1.8,y-3.3);ctx.lineTo(x+3.1,y);ctx.lineTo(x-1.8,y+3.3);ctx.closePath();ctx.fill();}
 else if(s.state==='blocked'){ctx.fillRect(x-.7,y-3,1.4,3.6);ctx.fillRect(x-.7,y+2,1.4,1.4);}
 else if(s.state==='unstaffed'){ctx.fillRect(x-3,y-.6,6,1.2);}
 else{ctx.beginPath();ctx.arc(x,y,2.8,0,Math.PI*2);ctx.stroke();}
 ctx.restore();
};
G.renderBuildingActivity=function(b){
 const frame=G._buildingActivityFrame;let s=frame&&frame.entries&&frame.world===G.world?frame.entries.get(b.id):G.buildingActivity(b);if(!s)return;
 // Recheck live household references without another whole-world scan.
 if(s.kind==='home'){s=G.buildingActivity(b,frame?.context);if(!s)return;if(frame)frame.entries.set(b.id,s);}
 return s;
};
G.drawBuildingActivity=function(ctx,b,spr,footX,footY){
 const frame=G._buildingActivityFrame,s=G.renderBuildingActivity(b);if(!s)return;
 const reduced=G.buildingReducedMotion(),time=reduced?0:G.buildingEffectTime,phase=(time+b.id*.37)%1;
 ctx.save();
 if(s.kind==='home'){
  const chimney=G.buildingAnchor(b,spr,footX,footY,'chimney');if(chimney)b._chimney=chimney;
  const win=G.buildingAnchor(b,spr,footX,footY,'window');
  if(s.atHome&&G.nightAlpha()>.15&&win){ctx.fillStyle=`rgba(255,202,105,${reduced?.52:.49+Math.sin(time*1.4+b.id)*.04})`;for(const dx of [-1.65,1.65])for(const dy of [-1.9,1.9])ctx.fillRect(win[0]+dx-.65,win[1]+dy-.9,1.3,1.8);}
  G.drawBuildingStateMarker(ctx,s,footX+7,footY+5,false);
 }else{
  const anchor=G.buildingAnchor(b,spr,footX,footY,'work');
  const active=s.active&&G.buildingProcessingWorker(b,G.world.cmap[s.workerId],frame?.context);
  if(active&&anchor){
   ctx.fillStyle=b.type==='woodcutter'?'#c8a576':b.type==='tailor'?'#e1d1b4':'#e5be7a';
   if(reduced){ctx.beginPath();ctx.arc(anchor[0],anchor[1],1.3,0,Math.PI*2);ctx.fill();}
   else if(b.type==='blacksmith'||b.type==='woodcutter')for(let i=0;i<3;i++){const t=(phase+i*.23)%1;if(t>.58)continue;ctx.globalAlpha=1-t/.58;ctx.fillRect(anchor[0]+(i-1)*t*10,anchor[1]-Math.sin(t/.58*Math.PI)*5,1.4,1.4);}
   else{ctx.globalAlpha=.35+.45*Math.sin(phase*Math.PI);ctx.fillRect(anchor[0]-1.5+phase*3,anchor[1],1.5,.8);}
  }
  G.drawBuildingStateMarker(ctx,s,footX+7,footY+5,active);
 }
 ctx.restore();
};

/* ---------- 地面缓存（半分辨率整图；道路/岩石改动只局部重绘脏瓦片） ---------- */
G.markGroundDirty = function (x, y) {
  if (!G.world || x < 0 || y < 0 || x >= G.world.N || y >= G.world.N) return;
  G.groundDirty.add(y * G.world.N + x);
};

/* 画单个地面瓦片（陆地/道路/岩石 或 水体+岸线），整图与局部重绘共用 */
G.drawGroundTile = function (c, w, pal, x, y) {
  const N = w.N;
  const i = y * N + x;
  const [sx, sy] = G.T2S(x, y);
  const tex = G.TEX_SEASON[G.game.season];
  if (w.water[i] === 1) {
    // Open water stays blue through autumn; only winter selects ice material.
    if (G.game.season !== 3 && G.fillTerrainSurface(c, 'water_open', x, y)) {
      // Continuous water pattern; no checkerboard seasonal variants.
    } else if (G.fillTexDiamond(c, G.game.season === 3 ? 'water_winter' : 'water_spring', sx, sy)) {
      // Existing blue/ice texture remains a safe asynchronous-loading fallback.
    } else {
      G.diamondPath(c, sx, sy);
      c.fillStyle = pal.water;
      c.fill();
      c.strokeStyle = pal.water;
      c.lineWidth = 1;
      c.stroke();
    }
    c.strokeStyle = pal.shore;
    c.lineWidth = 1.5;
    const corner = [[sx, sy, sx + 32, sy + 16], [sx + 32, sy + 16, sx, sy + 32], [sx, sy + 32, sx - 32, sy + 16], [sx - 32, sy + 16, sx, sy]];
    const nbs = [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]];
    for (let k = 0; k < 4; k++) {
      const nx = nbs[k][0], ny = nbs[k][1];
      if (nx < 0 || ny < 0 || nx >= N || ny >= N || w.water[ny * N + nx] === 1) continue; // 只在邻格是陆地时描岸线
      c.beginPath();
      c.moveTo(corner[k][0], corner[k][1]);
      c.lineTo(corner[k][2], corner[k][3]);
      c.stroke();
    }
    return;
  }
  const h = G.h2(w.seed + 5, x, y);
  let col = pal.grass;
  let texName = 'grass_' + tex;
  if (w.water[i] === 2) { col = pal.sand; texName = 'sand_' + tex; }
  else col = h < 0.33 ? pal.grassAlt : (h > 0.8 ? pal.grassDark : pal.grass);
  if (w.road[i]) { col = h < 0.5 ? pal.road : pal.roadAlt; texName = 'road_' + tex; }
  // 纹理优先；平色只作为变体淡染与纹理缺失时的回退
  if (!w.road[i] && w.water[i] !== 2 && G.fillTerrainSurface(c, 'meadow_' + tex, x, y)) {
    // Natural meadow is not outlined/tinted one tile at a time.
  } else if (G.fillTexDiamond(c, texName, sx, sy, col, w.road[i] || w.water[i] === 2 ? 0 : 0.14)) {
    c.strokeStyle = 'rgba(0,0,0,0.05)';
    c.lineWidth = 1;
    G.diamondPath(c, sx, sy);
    c.stroke();
  } else {
    G.diamondPath(c, sx, sy);
    c.fillStyle = col;
    c.fill();
    c.strokeStyle = col;   // 同色描边消除瓦片接缝
    c.lineWidth = 1;
    c.stroke();
  }
  if(w.road[i]===2){
    c.save();G.diamondPath(c,sx,sy);c.clip();c.fillStyle=G.game.season===3?'#a4ada9':'#929487';c.fillRect(sx-32,sy,64,32);
    c.strokeStyle='#656d64';c.lineWidth=.7;
    for(let row=0;row<4;row++)for(let col=0;col<4;col++){const corners=[[row+.08,col+.08],[row+.92,col+.08],[row+.92,col+.92],[row+.08,col+.92]];c.beginPath();corners.forEach(([u,v],j)=>{const[px,py]=G.T2S(u/4,v/4);if(j)c.lineTo(sx+px,sy+py);else c.moveTo(sx+px,sy+py)});c.closePath();c.fillStyle=(row+col)%3?'#98998b':'#a5a492';c.fill();c.stroke();}
    c.restore();
  }
  // 岩石露头（1=石头 2=铁矿，锈色标记）
  if (w.rock[i]) {
    const iron = w.rock[i] === 2;
    const rk = iron ? pal.iron : pal.rock, rkD = iron ? pal.ironD : pal.rockD;
    const cx = sx, cy = sy + 16;
    const rn = iron ? 'res_iron' : 'rock_' + (((x * 7 + y * 13) % 2) ? 'b' : 'a') + (G.isWinter() ? '_snow' : '');
    const spr = G.sprDraw(c, rn, cx, cy + 10, { w: 26 });
    if (spr) {
      if (iron && G.isWinter()) { // 雪顶保持矿脉轮廓可辨，不依赖颜色区分
        c.fillStyle = '#d8e6ef';
        c.beginPath(); c.ellipse(cx - 2, cy - 8, 4, 1.5, 0, 0, Math.PI * 2); c.fill();
      }
    } else {
      c.fillStyle = rkD;
      c.beginPath(); c.ellipse(cx + 4, cy + 4, 9, 5, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = rk;
      c.beginPath(); c.ellipse(cx - 2, cy - 1, 10, 6, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = rkD;
      c.beginPath(); c.ellipse(cx - 6, cy + 5, 5, 3, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.18)';
      c.beginPath(); c.ellipse(cx - 4, cy - 3, 5, 2.5, 0, 0, Math.PI * 2); c.fill();
    }
  }
};

G.buildGround = function () {
  const w = G.world, N = w.N;
  const { scale: s, width: gw, height: gh } = G.groundCacheSize(G.groundScale);
  const sameSize = G._gcv && G._gcv.width === gw && G._gcv.height === gh;
  const partial = !G.needGround && sameSize && G._groundWorld === w &&
    G._groundScale === s && G.groundDirty.size > 0;
  G.groundScale = s;
  G.groundOX = N * 32 + 40;
  G.groundOY = 40;
  if (!G._gcv) G._gcv = document.createElement('canvas');
  // 先缩窄再改高度，避免换图时「新宽度 × 旧高度」的临时分配也突破预算。
  if (!sameSize) { G._gcv.width = 1; G._gcv.height = gh; G._gcv.width = gw; }
  const c = G._gcv.getContext('2d');
  c.setTransform(s, 0, 0, s, G.groundOX * s, G.groundOY * s);
  const pal = G.PAL[G.game.season];

  if (partial) {
    // 局部重绘：脏瓦片 + 四邻（描边会轻微外溢到相邻瓦片）；先陆地后水体，保持岸线压在陆地上
    const uniq = new Set();
    for (const idx of G.groundDirty) {
      const x = idx % N, y = (idx / N) | 0;
      uniq.add(idx);
      if (x > 0) uniq.add(idx - 1);
      if (x < N - 1) uniq.add(idx + 1);
      if (y > 0) uniq.add(idx - N);
      if (y < N - 1) uniq.add(idx + N);
    }
    for (const idx of uniq) if (w.water[idx] !== 1) G.drawGroundTile(c, w, pal, idx % N, (idx / N) | 0);
    for (const idx of uniq) if (w.water[idx] === 1) G.drawGroundTile(c, w, pal, idx % N, (idx / N) | 0);
  } else {
    c.clearRect(-G.groundOX, -G.groundOY, N * 64 + 80, N * 32 + 80);
    c.fillStyle = pal.bg;
    c.fillRect(-G.groundOX, -G.groundOY, N * 64 + 80, N * 32 + 80);
    // 陆地（含道路、岩石），再水体（含岸线）——保持水面岸线压在陆地上
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++)
        if (w.water[y * N + x] !== 1) G.drawGroundTile(c, w, pal, x, y);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++)
        if (w.water[y * N + x] === 1) G.drawGroundTile(c, w, pal, x, y);
  }
  G.groundDirty.clear();
  G.needGround = false;
  G._groundWorld = w;
  G._groundScale = s;
};

/* ---------- 树 ---------- */
G.drawTree = function (ctx, t) {
  const [sx, sy] = G.T2S(t.x, t.y);
  const by = sy + 16;
  const stage = G.treeStage(t);
  const winter = G.isWinter();
  const sprName = 'tree_' + ['sapling', 'young', 'mature'][stage] + (winter ? '_snow' : '');
  if (G.sprDraw(ctx, sprName, sx, by)) return;
  const col = G.TREE_COLORS.canopy[(t.x * 7 + t.y * 13) % G.TREE_COLORS.canopy.length];
  const trunk = G.TREE_COLORS.trunk;
  if (stage === 0) {
    ctx.fillStyle = trunk; ctx.fillRect(sx - 0.7, by - 5, 1.4, 5);
    tri(ctx, sx, by - 5, 4.5, 7, col);
  } else if (stage === 1) {
    ctx.fillStyle = trunk; ctx.fillRect(sx - 1.2, by - 9, 2.4, 9);
    tri(ctx, sx, by - 14, 7, 9, col);
    tri(ctx, sx, by - 8, 8.5, 9, col);
    if (winter) tri(ctx, sx, by - 14, 5.5, 4, G.TREE_COLORS.snowCap);
  } else {
    ctx.fillStyle = trunk; ctx.fillRect(sx - 1.8, by - 13, 3.6, 13);
    tri(ctx, sx, by - 19, 7.5, 10, col);
    tri(ctx, sx, by - 13, 9.5, 10, col);
    tri(ctx, sx, by - 7, 11, 10, col);
    if (winter) {
      tri(ctx, sx, by - 19, 6, 4, G.TREE_COLORS.snowCap);
      tri(ctx, sx, by - 13, 7.5, 3.5, G.TREE_COLORS.snowCap);
    }
  }
};
function tri(ctx, cx, top, halfW, h, col) {
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(cx + halfW, top + h);
  ctx.lineTo(cx - halfW, top + h);
  ctx.closePath();
  ctx.fillStyle = col;
  ctx.fill();
}

/* ---------- 建筑 ---------- */
function quadFill(ctx, x1, y1, x2, y2, x3, y3, x4, y4, col) {
  ctx.beginPath();
  ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4);
  ctx.closePath();
  ctx.fillStyle = col;
  ctx.fill();
}

G.drawBuilding = function (ctx, b, time) {
  const w = G.world;
  const T = G.T2S(b.x, b.y);
  const R = G.T2S(b.x + b.w, b.y);
  const B = G.T2S(b.x + b.w, b.y + b.h);
  const L = G.T2S(b.x, b.y + b.h);
  const def = G.BDEF[b.type];

  if(b.type==='roadwork'){G.drawRoadWorkGround(ctx,b);return;}
  if (b.type === 'bridge') { G.drawBridge(ctx,b); return; }
  if(b.type==='tunnel'){const ends=G.tunnelEndpoints(b);G.drawTunnelPortal(ctx,b,ends.start,true);G.drawTunnelPortal(ctx,b,ends.end,false);return;}
  if (b.type === 'farm') { G.drawFarm(ctx, b); return; }
  if (b.type === 'dock') { G.drawDock(ctx, b); return; }

  if (b.state === 'site') {
    // 工地：脚手架精灵 + 引擎画进度条
    const siteSpr = (b.w >= 3 || b.h >= 3) ? 'site_3x3' : 'site_2x2';
    if (G.sprDraw(ctx, siteSpr, B[0], B[1], { w: (b.w + b.h) * 32 * (G.BUILD_SPR_W[siteSpr] || 1) })) {
      const px = (T[0] + B[0]) / 2, py = T[1] - 10;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(px - 16, py, 32, 4);
      ctx.fillStyle = '#d8b25a';
      ctx.fillRect(px - 16, py, 32 * b.progress, 4);
      return;
    }
    // 工地：地基 + 木架
    G.diamondPath(ctx, T[0], T[1]);
    ctx.fillStyle = 'rgba(120,90,55,0.35)';
    ctx.fill();
    ctx.strokeStyle = '#a8845a';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.strokeStyle = '#8a6a42';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(T[0], T[1]); ctx.lineTo(T[0], T[1] - 16);
    ctx.moveTo(R[0], R[1]); ctx.lineTo(R[0], R[1] - 16);
    ctx.moveTo(B[0], B[1]); ctx.lineTo(B[0], B[1] - 16);
    ctx.moveTo(L[0], L[1]); ctx.lineTo(L[0], L[1] - 16);
    ctx.stroke();
    // 进度条
    const px = (T[0] + B[0]) / 2, py = T[1] - 24;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(px - 16, py, 32, 4);
    ctx.fillStyle = '#d8b25a';
    ctx.fillRect(px - 16, py, 32 * b.progress, 4);
    return;
  }

  if(b.type==='graveremnant'){if(b.grave.expiresDay>G.game.day)G.drawEconomyFieldPart(ctx,{kind:'grave',...G.remnantGravePoint(b)});return;}
  // Direct-draw compatibility. The main frame sorts field props individually below.
  if (b.type === 'orchard' || b.type === 'pasture' || b.type === 'cemetery') {
    G.drawEconomyFieldGround(ctx, b);
    const parts = [];
    G.addEconomyFieldParts(parts, b);
    parts.sort((a, c) => a.d - c.d);
    for (const part of parts) G.drawEconomyFieldPart(ctx, part, time);
    if (b.type === 'pasture') G.drawPasturePestBadge(ctx, b);
    return;
  }

  // 建筑精灵：脚点 = 占地菱形最下角，宽度 = 占地菱形宽 × 出格系数
  const sprW = (b.w + b.h) * 32 * (G.BUILD_SPR_W[b.type] || 1.08);
  // 贸易站按原图50%显示；补偿底角下方3px透明余量，让石基脚点贴合占地底角。
  const sprFootY = B[1] + ((b.type === 'tradingpost'||b.type==='market') ? 1.5 : b.type === 'mineralpit' ? 2 : b.type==='burntruins'?2.5:b.type==='well'?1:b.type==='chapel'?6:0);
  const spr = G.sprDraw(ctx, b.type, B[0], sprFootY, { w: sprW, omitSmokeAir:true });
  if (spr) {
    G.drawBuildingActivity(ctx,b,spr,B[0],sprFootY);
    if(b.houseFire)G.drawHouseFire(ctx,b,time,spr);
    return;
  }

  if(b.type==='burntruins'){quadFill(ctx,...T,...R,...B,...L,'#625044');ctx.fillStyle='#382e28';ctx.fillRect(B[0]-12,B[1]-20,18,6);return;}
  if(b.type==='well'){ctx.fillStyle='#8b806b';ctx.beginPath();ctx.ellipse(B[0],B[1]-18,20,10,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#4d6470';ctx.beginPath();ctx.ellipse(B[0],B[1]-22,13,6,0,0,Math.PI*2);ctx.fill();return;}
  if(b.type==='mineralpit'){
    // Offline/no-sprite fallback is an empty hollow, never a roofed building.
    quadFill(ctx,...T,...R,...B,...L,'#766c59');
    const inset=p=>[p[0]*.72+B[0]*.28,p[1]*.72+(T[1]+B[1])*.14+7];
    const points=[T,R,B,L].map(inset);
    quadFill(ctx,...T,...R,...points[1],...points[0],'#a9997c');
    quadFill(ctx,...T,...points[0],...points[3],...L,'#665d4e');
    quadFill(ctx,...points[0],...points[1],...points[2],...points[3],'#8c7d61');
    return;
  }
  if(b.type==='stockpile'){
    ctx.strokeStyle='#846745';ctx.lineWidth=3;
    ctx.beginPath();ctx.moveTo(L[0],L[1]-5);ctx.lineTo(T[0],T[1]-5);ctx.lineTo(R[0],R[1]-5);ctx.stroke();
    for(const p of [T,L,R]){ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.lineTo(p[0],p[1]-12);ctx.stroke();}
    return;
  }
  const H = b.type === 'storage' ? 17 : 20;
  // 右墙（东南面，暗）
  quadFill(ctx, R[0], R[1], B[0], B[1], B[0], B[1] - H, R[0], R[1] - H, def.wallD);
  // 左墙（西南面，亮）
  quadFill(ctx, L[0], L[1], B[0], B[1], B[0], B[1] - H, L[0], L[1] - H, def.wall);
  // 门（左墙中部）
  const mx = (L[0] + B[0]) / 2, my = (L[1] + B[1]) / 2 - H;
  quadFill(ctx, mx - 3, my + 6, mx + 1, my + 8, mx + 1, my + 13, mx - 3, my + 11, '#3a2a1a');
  const fallbackActivity=G.renderBuildingActivity(b);
  // 窗（住宅冬夜透光）
  if (def.isHome) {
    const wx = (B[0] + R[0]) / 2, wy = (B[1] + R[1]) / 2 - H;
    ctx.fillStyle = fallbackActivity?.atHome && G.nightAlpha() > 0.15 ? '#ffd98a' : '#2e2013';
    ctx.fillRect(wx - 2.5, wy + 3, 5, 4);
  }
  // 屋顶（整体上移，微外扩）
  const o = 0.22;
  const Tr = G.T2S(b.x - o, b.y - o), Rr = G.T2S(b.x + b.w + o, b.y - o),
        Br = G.T2S(b.x + b.w + o, b.y + b.h + o), Lr = G.T2S(b.x - o, b.y + b.h + o);
  const roofH = H + (def.isHome ? 8 : 4);
  // 屋顶两坡
  quadFill(ctx, Tr[0], Tr[1] - roofH, Br[0], Br[1] - roofH, Lr[0], Lr[1] - roofH + 0.1, Lr[0], Lr[1] - roofH + 0.1, def.roof);
  ctx.beginPath();
  ctx.moveTo(Tr[0], Tr[1] - roofH);
  ctx.lineTo(Rr[0], Rr[1] - roofH);
  ctx.lineTo(Br[0], Br[1] - roofH);
  ctx.lineTo(Lr[0], Lr[1] - roofH);
  ctx.closePath();
  ctx.fillStyle = def.roof;
  ctx.fill();
  // 屋脊亮线
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Tr[0], Tr[1] - roofH);
  ctx.lineTo(Br[0], Br[1] - roofH);
  ctx.stroke();
  // 烟囱（住宅与宿舍）
  if (def.chimney) {
    const cx = Tr[0] + (Br[0] - Tr[0]) * 0.25, cy = Tr[1] + (Br[1] - Tr[1]) * 0.25 - roofH;
    ctx.fillStyle = '#5a5148';
    ctx.fillRect(cx - 2.5, cy - 7, 5, 9);
    b._chimney = [cx, cy - 7];
  }
  if(fallbackActivity)G.drawBuildingStateMarker(ctx,fallbackActivity,B[0]+7,B[1]+5,fallbackActivity.active&&G.buildingProcessingWorker(b,G.world.cmap[fallbackActivity.workerId],G._buildingActivityFrame?.context));
  if(b.houseFire)G.drawHouseFire(ctx,b,time);
};

// Bounded code-native smoke/flames. State is also explained in textual details.
G.drawHouseFire=function(ctx,b,time,sprite){
 const fire=b.houseFire;if(!fire)return;const [x,y]=G.T2S(b.x+b.w,b.y+b.h),height=sprite?sprite[1]:65,burning=fire.elapsed>=12,phase=(time||0)*.001;
 ctx.save();
 for(let i=0;i<5;i++){const lift=((phase*.4+i*.23)%1)*24;ctx.globalAlpha=.45*(1-lift/40);ctx.fillStyle=burning?'#4b463f':'#817b6d';ctx.beginPath();ctx.ellipse(x-14+i*7+Math.sin(i+phase)*2,y-height*.83-lift,5+lift*.15,7+lift*.15,0,0,Math.PI*2);ctx.fill();}
 if(burning)for(let i=0;i<4;i++){const px=x-17+i*11,py=y-height*.35-i%2*7,tip=24+Math.sin(phase*3+i)*5;ctx.globalAlpha=.88;ctx.fillStyle='#c77a35';ctx.beginPath();ctx.moveTo(px-5,py);ctx.quadraticCurveTo(px-7,py-8,px+1,py-tip);ctx.quadraticCurveTo(px+8,py-5,px+5,py);ctx.closePath();ctx.fill();ctx.fillStyle='#e2b75c';ctx.beginPath();ctx.moveTo(px-2,py);ctx.lineTo(px,py-tip*.6);ctx.lineTo(px+3,py);ctx.closePath();ctx.fill();}
 ctx.globalAlpha=1;ctx.fillStyle='#3e3228';ctx.fillRect(x-4,y-height-12,8,11);ctx.fillStyle='#e6c56e';ctx.fillRect(x-1,y-height-10,2,5);ctx.fillRect(x-1,y-height-4,2,2);ctx.restore();
};

G.drawFarmPlan=function(ctx){
  if(!G.isFarmPlanning||!G.isFarmPlanning())return;
  const p=G.farmDrag||G.farmPlan;if(!p||p.world!==G.world)return;
  const bounds=G.farmBounds(p.end?p:{...p,end:p.start});if(!bounds)return;
  const {x,y,w,h}=bounds,size=[w,h],valid=!!G.farmDefinition(size),check=valid?G.canPlace(G.world,'farm',x,y,size):{ok:false};
  ctx.save();ctx.fillStyle=check.ok?'rgba(120,230,140,.28)':'rgba(230,90,80,.25)';ctx.strokeStyle=check.ok?'#c4e89b':'#e78f80';ctx.lineWidth=1/G.cam.z;
  if(valid)for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){G.diamondPath(ctx,...G.T2S(xx,yy));ctx.fill();ctx.stroke();}
  else{const corners=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];ctx.beginPath();corners.forEach(([xx,yy],i)=>{const [sx,sy]=G.T2S(xx,yy);if(i)ctx.lineTo(sx,sy);else ctx.moveTo(sx,sy);});ctx.closePath();ctx.fill();ctx.stroke();}
  ctx.restore();
};

// New pasture previews share the established tile/outline drawing vocabulary.
G.drawPasturePlan=function(ctx){
  if(!G.isPasturePlanning||!G.isPasturePlanning())return;
  const p=G.pastureDrag||G.pasturePlan;if(!p||p.world!==G.world)return;
  const bounds=G.farmBounds(p.end?p:{...p,end:p.start});if(!bounds)return;
  const {x,y,w,h}=bounds,size=[w,h],def=G.pastureDefinition(size),check=def?G.canPlace(G.world,'pasture',x,y,size):{ok:false};
  const ok=check.ok&&Object.entries(def.cost).every(([k,v])=>G.game.res[k]>=v);
  ctx.save();ctx.fillStyle=ok?'rgba(120,230,140,.28)':'rgba(230,90,80,.25)';ctx.strokeStyle=ok?'#c4e89b':'#e78f80';ctx.lineWidth=1/G.cam.z;
  if(def)for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){G.diamondPath(ctx,...G.T2S(xx,yy));ctx.fill();ctx.stroke();}
  else{ctx.beginPath();[[x,y],[x+w,y],[x+w,y+h],[x,y+h]].forEach(([xx,yy],i)=>{const [sx,sy]=G.T2S(xx,yy);if(i)ctx.lineTo(sx,sy);else ctx.moveTo(sx,sy);});ctx.closePath();ctx.fill();ctx.stroke();}
  ctx.restore();
};

// New orchard previews show the same tree centers used by the actual field.
G.drawOrchardPlan=function(ctx){
  if(!G.isOrchardPlanning||!G.isOrchardPlanning())return;
  const p=G.orchardDrag||G.orchardPlan;if(!p||p.world!==G.world)return;
  const bounds=G.farmBounds(p.end?p:{...p,end:p.start});if(!bounds)return;
  const {x,y,w,h}=bounds,size=[w,h],def=G.orchardDefinition(size),check=def?G.canPlace(G.world,'orchard',x,y,size):{ok:false};
  const ok=check.ok&&Object.entries(def.cost).every(([k,v])=>G.game.res[k]>=v);
  ctx.save();ctx.fillStyle=ok?'rgba(120,230,140,.28)':'rgba(230,90,80,.25)';ctx.strokeStyle=ok?'#c4e89b':'#e78f80';ctx.lineWidth=1/G.cam.z;
  if(def)for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){G.diamondPath(ctx,...G.T2S(xx,yy));ctx.fill();ctx.stroke();}
  else{ctx.beginPath();[[x,y],[x+w,y],[x+w,y+h],[x,y+h]].forEach(([xx,yy],i)=>{const [sx,sy]=G.T2S(xx,yy);if(i)ctx.lineTo(sx,sy);else ctx.moveTo(sx,sy);});ctx.closePath();ctx.fill();ctx.stroke();}
  if(def){
    const b={type:'orchard',x,y,w,h,orchardSize:size};ctx.fillStyle=ok?'#ecdda5':'#dc9b86';
    for(let i=0;i<G.orchardTreeCount(b);i++){const p=G.orchardDisplayPoint(b,i),[sx,sy]=G.T2S(p.x,p.y);ctx.beginPath();ctx.ellipse(sx,sy,2.8/G.cam.z,1.4/G.cam.z,0,0,Math.PI*2);ctx.fill();}
  }
  ctx.restore();
};

G.drawCemeteryPlan=function(ctx){
  if(!G.isCemeteryPlanning||!G.isCemeteryPlanning())return;
  const p=G.cemeteryDrag||G.cemeteryPlan;if(!p||p.world!==G.world)return;
  const bounds=G.farmBounds(p.end?p:{...p,end:p.start});if(!bounds)return;
  const {x,y,w,h}=bounds,size=[w,h],def=G.cemeteryDefinition(size),check=def?G.canPlace(G.world,'cemetery',x,y,size):{ok:false};
  const ok=check.ok&&Object.entries(def.cost).every(([k,v])=>G.game.res[k]>=v);
  ctx.save();ctx.fillStyle=ok?'rgba(120,230,140,.28)':'rgba(230,90,80,.25)';ctx.strokeStyle=ok?'#c4e89b':'#e78f80';ctx.lineWidth=1/G.cam.z;
  if(def)for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){G.diamondPath(ctx,...G.T2S(xx,yy));ctx.fill();ctx.stroke();}
  else{ctx.beginPath();[[x,y],[x+w,y],[x+w,y+h],[x,y+h]].forEach(([xx,yy],i)=>{const [sx,sy]=G.T2S(xx,yy);if(i)ctx.lineTo(sx,sy);else ctx.moveTo(sx,sy);});ctx.closePath();ctx.fill();ctx.stroke();}
  if(def){
    const b={type:'cemetery',x,y,w,h,cemeterySize:size};ctx.fillStyle=ok?'#ecdda5':'#dc9b86';
    for(let i=0;i<G.cemeteryCapacity(b);i++){const p=G.cemeteryGravePoint(b,i),[sx,sy]=G.T2S(p.x,p.y);ctx.beginPath();ctx.ellipse(sx,sy,2.8/G.cam.z,1.4/G.cam.z,0,0,Math.PI*2);ctx.fill();}
  }
  ctx.restore();
};

G.drawFarmGround = function (ctx, b, bounds) {
  const pal = G.PAL[G.game.season];
  const soilTex = pal.snow ? 'farm_soil_snow' : 'farm_soil';
  for (const f of b.farm) {
    if (bounds && (f.x < bounds.tx0 || f.x > bounds.tx1 || f.y < bounds.ty0 || f.y > bounds.ty1)) continue;
    const [sx, sy] = G.T2S(f.x, f.y);
    if (!G.fillTexDiamond(ctx, soilTex, sx, sy, f.pestLost ? '#51483c' : f.harvested ? '#5c452c' : null, f.pestLost ? .58 : f.harvested ? 0.25 : 0)) {
      G.diamondPath(ctx, sx, sy);
      ctx.fillStyle = f.pestLost ? (pal.snow?'#999f9d':'#665746') : f.harvested ? (pal.snow ? '#aeb6bd' : '#7a5c39') : pal.soil;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
    if(f.pestLost){ // Muted dead stalks on the real lost cells, not a permanent grid.
      ctx.save();ctx.strokeStyle='#4e4231';ctx.lineWidth=1.8;
      for(const [dx,dy] of [[-13,8],[9,17],[2,5]]){ctx.beginPath();ctx.moveTo(sx+dx-4,sy+dy+2);ctx.lineTo(sx+dx+3,sy+dy-2);ctx.lineTo(sx+dx+5,sy+dy-7);ctx.stroke();}
      ctx.restore();
    }
  }
};
G.drawFarmPestBadge=function(ctx,b){
  if(!G.pestFieldActive||!G.pestFieldActive(b))return;
  const [x,y]=G.T2S(b.x+b.w/2,b.y+b.h),warning=G.game.day<b.pestInfestation.startedDay+G.FARM_PESTS.warningDays;
  ctx.save();ctx.translate(x,y+12);ctx.beginPath();ctx.arc(0,0,12,0,Math.PI*2);ctx.fillStyle=warning?'#c0a369':'#ad7553';ctx.fill();ctx.strokeStyle='#554332';ctx.lineWidth=1.5;ctx.stroke();
  ctx.fillStyle='#514131';ctx.beginPath();ctx.ellipse(0,0,3.5,5,0,0,Math.PI*2);ctx.fill();
  for(const side of [-1,1])for(const dy of [-3,0,3]){ctx.beginPath();ctx.moveTo(side*3,dy);ctx.lineTo(side*7,dy-2);ctx.stroke();}
  ctx.beginPath();ctx.arc(0,-6,2,0,Math.PI*2);ctx.fill();ctx.restore();
};
// Native warning seal, matching the farm badge palette without replacing herd art.
// The summary is read-only: drawing cannot create or advance an infestation.
G.drawPasturePestBadge=function(ctx,b){
  if(!b||b.type!=='pasture'||b.state!=='ok'||!G.pasturePestSummary)return;
  const p=G.pasturePestSummary(b);if(!p.enabled||!p.active)return;
  const [x,y]=G.T2S(b.x+b.w/2,b.y+b.h);
  ctx.save();ctx.translate(x,y+12);ctx.beginPath();ctx.arc(0,0,12,0,Math.PI*2);
  ctx.fillStyle=p.warningLeft>0?'#c0a369':'#ad7553';ctx.fill();ctx.strokeStyle='#554332';ctx.lineWidth=1.5;ctx.stroke();
  ctx.beginPath();ctx.moveTo(0,-8);ctx.lineTo(8,6);ctx.lineTo(-8,6);ctx.closePath();ctx.stroke();
  ctx.strokeStyle='#514131';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,-3);ctx.lineTo(0,1);ctx.stroke();
  ctx.fillStyle='#514131';ctx.beginPath();ctx.arc(0,4,1,0,Math.PI*2);ctx.fill();ctx.restore();
};
G.drawFarmCrop = function (ctx, b, f) {
  const [sx, sy] = G.T2S(f.x, f.y);
  if (f.sown && !f.harvested) {
    const g = b.growth;
    const prefix = G.CROPS[G.farmCropOf(b)].sprite;
    const stage = prefix + (g >= 1 ? '_ripe' : g >= 0.66 ? '_stage2' : g >= 0.33 ? '_stage1' : '_stage0');
    if (G.sprDraw(ctx, stage, sx, sy + 26)) return;
    const cropCol = G.farmCropOf(b)!=='wheat'?G.lerpColor('#699248','#a2aa63',g):g >= 1 ? (G.game.season === 2 ? '#d8b23a' : '#c8a83a') : G.lerpColor('#5d8a3a', '#c2a13a', g);
    const rr = 1 + g * 1.6;
    ctx.fillStyle = cropCol;
    for (let k = 0; k < 4; k++) {
      const dx = (k % 2 ? 10 : -10), dy = (k < 2 ? -5 : 5) + 16;
      ctx.beginPath();
      ctx.arc(sx + dx, sy + dy - rr, rr, 0, Math.PI * 2);
      ctx.fill();
    }
  }
};
// Direct-draw compatibility; the main frame separates soil and per-cell crops.
G.drawFarm = function (ctx, b) {
  G.drawFarmGround(ctx, b);
  for (const f of b.farm) G.drawFarmCrop(ctx, b, f);
  G.drawFarmPestBadge(ctx,b);
};

/* 果园/牧场不能是一张铺满 6×6 的“大建筑图”：地面在底层，
 * 羊、果树、棚屋和每段围栏各自按脚点排序，不让草地盖到邻屋。 */
G.drawEconomyFieldGround = function (ctx, b, bounds) {
  const snow = G.PAL[G.game.season].snow;
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
    if (bounds && (x < bounds.tx0 || x > bounds.tx1 || y < bounds.ty0 || y > bounds.ty1)) continue;
    const [sx, sy] = G.T2S(x, y);
    G.diamondPath(ctx, sx, sy);
    ctx.fillStyle = snow ? 'rgba(225,226,208,.14)' : b.type === 'orchard'
      ? ((x - b.x) % 2 ? 'rgba(133,96,52,.15)' : 'rgba(107,84,43,.08)')
      : 'rgba(144,158,80,.14)';
    ctx.fill();
  }
};

// Keep legacy pen composition intact; area-sized pens distribute actual animals
// over their true footprint without stretching any original sprite.
G.pastureAnimalSpots=function(b){
  const count=Math.max(0,Math.floor(b.animals||0));
  if(!b.pastureSize){
    const spots=[[3.2,1.2],[4.7,1.6],[2.8,2.7],[4.5,3.1],[1.2,3.2],[1.5,4.7],[3.1,4.8],[4.8,4.8],[2.2,3.9],[3.8,4],[4,2],[.9,4.2]];
    if(G.pastureTypeOf(b)==='chicken')spots.push(...spots.map(([x,y])=>[Math.min(5.5,x+.35),Math.min(5.5,y+.35)]));
    return spots.slice(0,count);
  }
  if(!count)return [];
  const cols=Math.ceil(Math.sqrt((count+10)*b.w/b.h)),rows=Math.ceil((count+10)/cols),spots=[];
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
    const x=.8+(b.w-1.6)*(col+.5)/cols+Math.sin(col*2.1+row*3.7)*.13,
      y=.8+(b.h-1.6)*(row+.5)/rows+Math.cos(row*2.3+col*3.1)*.13;
    if(x<3.4&&y<3.4)continue; // Keep feet out of the original shelter footprint.
    spots.push([x,y]);
  }
  return Array.from({length:Math.min(count,spots.length)},(_,i)=>spots[Math.floor((i+.5)*spots.length/count)]);
};

// Work uses integer tiles; new tree feet sit at those tiles' visual centers.
G.orchardDisplayPoint=function(b,i){const p=G.orchardPoint(b,i),offset=b.orchardSize ? 0.5 : 0;return {x:p.x+offset,y:p.y+offset};};

G.addEconomyFieldParts = function (items, b, bounds) {
  const add = part => {
    if (bounds && (part.x < bounds.tx0 - 2 || part.x > bounds.tx1 + 2 || part.y < bounds.ty0 - 2 || part.y > bounds.ty1 + 2)) return;
    items.push({ ...part, b, k: 5, d: part.x + part.y + (part.kind === 'fence' ? 0.025 : 0.01) });
  };
  if(b.type==='graveremnant'){if(b.grave.expiresDay>G.game.day)add({kind:'grave',...G.remnantGravePoint(b)});return;}
  const x0 = b.x + 0.12, y0 = b.y + 0.12, x1 = b.x + b.w - 0.12, y1 = b.y + b.h - 0.12;
  const fence = (ax, ay, bx, by) => add({ kind: 'fence', x: (ax + bx) / 2, y: (ay + by) / 2, ax, ay, bx, by });
  for (let i = 0; i < b.w; i++) {
    const a = x0 + i * (x1 - x0) / b.w, c = x0 + (i + 1) * (x1 - x0) / b.w;
    fence(a, y0, c, y0);
    if (i !== Math.floor(b.w / 2)) fence(a, y1, c, y1); // Open gate for the field's workers.
  }
  for (let i = 0; i < b.h; i++) {
    const a = y0 + i * (y1 - y0) / b.h, c = y0 + (i + 1) * (y1 - y0) / b.h;
    fence(x0, a, x0, c); fence(x1, a, x1, c);
  }
  if(b.type==='cemetery'){
    for(const r of G.activeGraves(b))add({kind:'grave',...G.cemeteryGravePoint(b,r.slot)});
  } else if (b.type === 'orchard') {
    for(let ti=0;ti<G.orchardTreeCount(b);ti++){const point=G.orchardDisplayPoint(b,ti);add({kind:'fruitTree',...point,ti});}
  } else {
    add({ kind: 'sheepShelter', x: b.x + 2.1, y: b.y + 2.1 });
    const spots=G.pastureAnimalSpots(b),count=spots.length;
    for (let i = 0; i < count; i++) add({ kind: G.pastureTypeOf(b), x: b.x + spots[i][0], y: b.y + spots[i][1], n: i });
  }
};

/* Wildlife uses the same bottom-center anchor and scene depth as citizens.
 * Dead/replenishing slots are never painted; drawing never advances wildlife. */
G.addDeerDrawItems = function(items, w, bounds) {
  for(const deer of w.deer||[]) if(deer.returnDay===null &&
    (!bounds || (deer.x>=bounds.tx0-1&&deer.x<=bounds.tx1+1&&deer.y>=bounds.ty0-1&&deer.y<=bounds.ty1+1)))
    items.push({d:deer.x+deer.y+.015,k:7,deer});
};
G.drawDeer = function(ctx, deer) {
  if(deer.returnDay!==null)return;
  const [x,y]=G.T2S(deer.x,deer.y);
  ctx.fillStyle='rgba(26,32,19,.16)';ctx.beginPath();ctx.ellipse(x,y-1,8,2.6,0,0,Math.PI*2);ctx.fill();
  if(G.sprDraw(ctx,'deer',x,y,{w:26,flip:deer.id%2===0}))return;
  // Missing-image fallback, consistent with other entity fallbacks.
  ctx.save();ctx.translate(x,y);if(deer.id%2===0)ctx.scale(-1,1);
  ctx.strokeStyle='#705039';ctx.lineWidth=1.5;ctx.beginPath();
  for(const dx of [-6,-3,4,7]){ctx.moveTo(dx,-7);ctx.lineTo(dx-1,-1);}ctx.stroke();
  ctx.fillStyle='#a77c51';ctx.beginPath();ctx.ellipse(0,-9,9,4,0,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.ellipse(-8,-13,2.4,5,-.25,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.ellipse(-10,-16,4,2.5,.15,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#936a44';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-9,-18);ctx.lineTo(-10,-21);ctx.moveTo(-7,-18);ctx.lineTo(-5,-20);ctx.stroke();
  ctx.fillStyle='#ded0ad';ctx.fillRect(6,-10,2,3);ctx.fillStyle='#30291d';ctx.fillRect(-12,-17,1,1);ctx.restore();
};

G.drawEconomyFieldPart = function (ctx, p) {
  const [sx, sy] = G.T2S(p.x, p.y);
  if (p.kind === 'fence') {
    const a = G.T2S(p.ax, p.ay), b = G.T2S(p.bx, p.by);
    ctx.save(); ctx.lineCap = 'round';
    for (const h of [4, 9]) {
      ctx.strokeStyle = '#735538'; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(a[0], a[1] - h); ctx.lineTo(b[0], b[1] - h); ctx.stroke();
      ctx.strokeStyle = '#ba9460'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(a[0], a[1] - h - 0.6); ctx.lineTo(b[0], b[1] - h - 0.6); ctx.stroke();
    }
    ctx.strokeStyle = '#85613e'; ctx.lineWidth = 3.2;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(a[0], a[1] - 12); ctx.moveTo(b[0], b[1]); ctx.lineTo(b[0], b[1] - 12); ctx.stroke();
    ctx.fillStyle = '#d0ad75'; ctx.fillRect(a[0] - 1.4, a[1] - 12.6, 2.8, 1.5); ctx.fillRect(b[0] - 1.4, b[1] - 12.6, 2.8, 1.5);
    ctx.restore(); return;
  }
  if(p.kind==='grave'){
    if(!G.sprDraw(ctx,'grave',sx,sy,{w:16})){ctx.fillStyle='#b0a895';ctx.fillRect(sx-4,sy-12,8,12);ctx.fillStyle='#7b7365';ctx.fillRect(sx+4,sy-10,3,10);}
    return;
  }
  if (p.kind === 'sheepShelter') {
    G.sprDraw(ctx, 'pasture', sx, sy, { w: 112 }); return;
  }
  if(p.kind==='chicken'){G.sprDraw(ctx,'chicken',sx,sy,{w:16,flip:p.n%3===1});return;}
  if(p.kind==='cattle'){G.sprDraw(ctx,'cattle',sx,sy,{w:32,flip:p.n%3===1});return;}
  if (p.kind === 'sheep') {
    G.sprDraw(ctx, 'sheep', sx, sy, { w: 24, flip: p.n % 3 === 1 }); return;
  }
  if (p.kind === 'fruitTree') {
    const tree=p.b.orchardTrees?.[p.ti];
    if(tree&&!tree.planted){ctx.fillStyle='#876947';ctx.beginPath();ctx.ellipse(sx,sy,4,2,0,0,Math.PI*2);ctx.fill();return;}
    const growth=Math.max(0,Math.min(1,(tree?tree.age:p.b.orchardAge||0)/(G.YEAR_DAYS*4)));
    const fruit=G.game.season===2&&(tree?tree.fruit>0:growth>=1&&p.b.orchardYield>0);
    // Small new trees have no misleading harvest-ready fruit; the ripe sprite appears in autumn.
    const pear=G.orchardTreeType(tree)==='pear',sprite=pear?(fruit?'orchard_pear':'orchard_pear_leafy'):(fruit?'orchard':'orchard_leafy');
    // Apples reuse the established red-fruit art; old generic trees keep it too.
    // Missing pear art falls back to foliage, not misleading red apple fruit.
    if(!G.sprDraw(ctx,sprite,sx,sy,{w:24+28*growth})&&pear)G.sprDraw(ctx,'orchard_leafy',sx,sy,{w:24+28*growth});
  }
};

G.drawDock = function (ctx, b) {
  const T = G.T2S(b.x, b.y);
  const R = G.T2S(b.x + b.w, b.y);
  const B = G.T2S(b.x + b.w, b.y + b.h);
  const L = G.T2S(b.x, b.y + b.h);
  // 码头精灵（木平台+小板屋一体）；缺失回退程序化平台
  if (G.sprDraw(ctx, 'dock', B[0], B[1] + 6, { w: (b.w + b.h) * 32 })) return;
  // 平台
  ctx.beginPath();
  ctx.moveTo(T[0], T[1]); ctx.lineTo(R[0], R[1]); ctx.lineTo(B[0], B[1]); ctx.lineTo(L[0], L[1]);
  ctx.closePath();
  ctx.fillStyle = '#96714a';
  ctx.fill();
  ctx.strokeStyle = '#6d5034';
  ctx.lineWidth = 1;
  ctx.stroke();
  // 木纹
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  for (let k = 1; k < 4; k++) {
    const a = G.T2S(b.x + k * b.w / 4, b.y), c2 = G.T2S(b.x + k * b.w / 4, b.y + b.h);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c2[0], c2[1]); ctx.stroke();
  }
  // 小屋
  const H = 12;
  const M = G.T2S(b.x + 0.5, b.y + 0.5);
  quadFill(ctx, M[0], M[1] - 8, M[0] + 14, M[1] + 0, M[0] + 14, M[1] - H, M[0], M[1] - 8 - H, '#7a5c3e');
  quadFill(ctx, M[0] + 14, M[1], M[0] + 22, M[1] - 8, M[0] + 22, M[1] - 8 - H, M[0] + 14, M[1] - H, '#5e4630');
  // 水桶
  ctx.fillStyle = '#8a5a3a';
  ctx.fillRect(M[0] - 8, M[1] - 6, 4, 5);
};

G.lerpColor = (function () {
  const cache = {};
  return function (a, b, t) {
    t = G.clamp(t, 0, 1);
    const key = a + b + ((t * 10) | 0);
    if (cache[key]) return cache[key];
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const r = Math.round(G.lerp((pa >> 16) & 255, (pb >> 16) & 255, t));
    const g = Math.round(G.lerp((pa >> 8) & 255, (pb >> 8) & 255, t));
    const bl = Math.round(G.lerp(pa & 255, pb & 255, t));
    const v = `rgb(${r},${g},${bl})`;
    cache[key] = v;
    return v;
  };
})();

/* ---------- 市民 ---------- */
/* sim 的入屋约定是：到达住房周边可站立格，rest 且非露宿。
 * 只在确实到达有效住房时隐藏室内居民；无房、远岗、失效路径仍在室外。 */
// 每帧/每次点击最多建一次索引，避免 C 位居民各自扫描 F 个家庭。
G.citizenHomeLookup = function (w) {
  const homes = new Map();
  for (const f of w.families) if (f.houseId != null) homes.set(f.id, w.bmap[f.houseId]);
  return homes;
};

G.citizenIndoorHome = function (c, homes) {
  if (c.state !== 'rest' || c.camped !== false || (c.path && c.path.length)) return null;
  const h = homes ? homes.get(c.familyId) : G.homeOf(c);
  if (!h || h.state !== 'ok' || !(G.BDEF[h.type].isHome || h.type === 'boarding')) return null;
  const dx = Math.max(h.x - c.x, 0, c.x - (h.x + h.w - 1));
  const dy = Math.max(h.y - c.y, 0, c.y - (h.y + h.h - 1));
  return dx <= 1.01 && dy <= 1.01 ? h : null;
};

/* 劳作面向实际树/田格或邻接建筑，不能沿用赶路时朝向而背对工地。 */
G.citizenWorkTarget = function (c) {
  const t = c.state === 'work' && c.task;
  if (!t) return null;
  if (t.tree) return t.tree;
  if (t.b && (t.kind === 'build' || t.kind === 'firewood' || ['dock', 'mine', 'stonequarry', 'blacksmith'].includes(t.b.type)))
    return { x: t.b.x + (t.b.w - 1) / 2, y: t.b.y + (t.b.h - 1) / 2 };
  return { x: t.tx, y: t.ty };
};

G.citizenFacing = function (c, workTarget) {
  const sx = (c.x - c.y) * 32;
  const walking = c.state === 'walk' || c.state === 'haul';
  let target = walking && c.path && c.path[c.pi];
  if (!target) target = workTarget === undefined ? G.citizenWorkTarget(c) : workTarget;
  const dx = target ? (target.x - c.x - target.y + c.y) * 32 :
    (c._psx == null ? 0 : sx - c._psx);
  if (dx > 0.03) c._fx = 1;
  else if (dx < -0.03) c._fx = -1;
  c._psx = sx;
  return c._fx === -1 ? -1 : 1; // 现有 PNG 朝右；真正的八向帧尚未提供。
};

G.drawCitizen = function (ctx, c, time, homes) {
  if(G.tunnelInteriorAt(G.world,Math.round(c.x),Math.round(c.y)))return;
  if (G.citizenIndoorHome(c, homes) || (G.inMedicalCare && G.inMedicalCare(c)) || (G.inSchool && G.inSchool(c)) || (G.inChapel && G.inChapel(c))) return;
  const [sx0, sy0] = G.T2S(c.x, c.y);
  const sy = sy0 + 16 - (G.bridgeAt(G.world,Math.round(c.x),Math.round(c.y))?.state==='ok'?8:0);
  const child = c.age < G.ADULT_AGE;
  const s = child ? 0.72 : 1;
  const walking = c.state === 'walk' || c.state === 'haul';
  const rescue=G.fireTaskOf&&G.fireTaskOf(c);
  const shopping=G.supplyTaskOf&&G.supplyTaskOf(c);
  // Loading/unloading uses the existing empty/holding pose, not a hammer swing.
  const materialTransfer = c.task?.kind === 'constructionMaterial'||c.task?.kind==='roadPave'&&c.task.phase==='load';
  const working = c.state === 'work'&&!rescue&&!shopping&&!materialTransfer;
  const bob = walking ? Math.abs(Math.sin(c.animT)) * 1.2 : (working ? Math.abs(Math.sin(c.animT)) * 0.6 : 0);
  const target = G.citizenWorkTarget(c);
  const facing = G.citizenFacing(c, target), flip = facing < 0;
  // 砍树/采集的模拟脚点与资源同格；画在资源旁，避免工具和身体压在树干中。
  const atTarget = target && G.d2(target.x, target.y, c.x, c.y) < 0.01;
  const sx = sx0 - (atTarget ? facing * 4 * s : 0);
  // 阴影；露宿者保持可见，不用透明度伪装成入屋。
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, 3.4 * s, 1.7 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  const f = Math.floor(c.animT / 1.5);
  let frame, fallback;
  if (child) frame = walking ? 'child_walk_' + (f % 4) : 'child_idle';
  else if (working) {
    // 旧两张“work”图其实是挥工具与抱筐两种姿态，交替播放会整个人跳变。
    const t = c.task;
    const basket = t && (t.kind === 'sow' || t.kind === 'harvest' || t.kind === 'plant' || t.kind === 'orchard' || (t.yield && G.isFood(t.yield.type)));
    frame = basket ? 'adult_work_1' : 'adult_work_0';
    fallback = 'adult_idle';
  } else if (c.carry||rescue?.water) {
    frame = walking ? 'adult_carry_walk_' + (f % 4) : 'adult_carry_idle';
    fallback = walking ? 'adult_walk_' + (f % 4) : 'adult_idle';
  } else frame = walking ? 'adult_walk_' + (f % 4) : 'adult_idle';
  const bodyY = sy - (working ? bob : 0);
  if (!G.sprDraw(ctx, frame, sx, bodyY, { flip }) &&
      !(fallback && G.sprDraw(ctx, fallback, sx, bodyY, { flip }))) {
    ctx.fillStyle = child ? '#a3703f' : '#6e4a33';
    ctx.fillRect(sx - 1.7 * s, sy - 7.5 * s - bob, 3.4 * s, 5.2 * s);
    ctx.fillStyle = '#d8a37a';
    ctx.beginPath();
    ctx.arc(sx, sy - 8.6 * s - bob, 1.8 * s, 0, Math.PI * 2);
    ctx.fill();
  }
  // 携带物跟随抱持侧镜像；专用帧缺失时仍保持正常小人和资源回退。
  if (c.carry) {
    const cx = sx + facing * 3.2 * s;
    if (!G.sprDraw(ctx, 'carry_' + c.carry.type, cx, bodyY - 4 * s, { w: 10 * s, flip })) {
      ctx.fillStyle = G.RES[c.carry.type].color;
      ctx.fillRect(cx - 1.3, sy - 5.4 * s - bob, 2.6, 2.6);
    }
  }
  if(rescue?.water){const bx=sx+facing*3.5*s,by=bodyY-4*s;ctx.fillStyle='#795737';ctx.fillRect(bx-2,by-4,4,4);ctx.strokeStyle='#625b50';ctx.lineWidth=.7;ctx.beginPath();ctx.arc(bx,by-4,2,Math.PI,0);ctx.stroke();ctx.fillStyle='#6699a7';ctx.beginPath();ctx.ellipse(bx,by-4,2,1,0,0,Math.PI*2);ctx.fill();}
  if (G.sel && G.sel.kind === 'c' && G.sel.id === c.id) {
    ctx.strokeStyle = 'rgba(255,235,170,0.9)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(sx, sy, 5.5 * s, 2.8 * s, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (G.isSick && G.isSick(c)) {
    ctx.save(); ctx.fillStyle = '#b86655'; ctx.beginPath(); ctx.arc(sx, sy - (child ? 19 : 24), 3, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  // Only sustained danger gets a badge, so normal winter exposure stays quiet.
  const cold = c.cold >= G.LIFE.coldDays * 0.5;
  const hungry = c.hunger >= G.LIFE.starveDays * 0.5;
  if (cold || hungry) G.drawNeedBadge(ctx, sx, sy - (child ? 19 : 24), cold ? 'cold' : 'food');
};

// Code-native HUD symbols: a snowflake and a food bowl, not font/emoji dependent.
G.drawNeedBadge = function (ctx, x, y, kind) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#242b30';
  ctx.strokeStyle = kind === 'cold' ? '#bce9ff' : '#ffd174';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath();
  if (kind === 'cold') {
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI / 3, dx = Math.cos(a) * 3.4, dy = Math.sin(a) * 3.4;
      ctx.moveTo(x - dx, y - dy); ctx.lineTo(x + dx, y + dy);
    }
  } else {
    ctx.moveTo(x - 3.5, y - 1); ctx.lineTo(x + 3.5, y - 1);
    ctx.lineTo(x + 2, y + 2); ctx.lineTo(x - 2, y + 2); ctx.closePath();
    ctx.moveTo(x, y - 4); ctx.lineTo(x, y - 2);
  }
  ctx.stroke(); ctx.restore();
};

/* ---------- 粒子 ---------- */
G.updateParticles = function (dt) {
  // Only visible completed homes can emit; never scan the whole building list.
  if(G._buildingParticleWorld!==G.world){G.smoke=[];G._buildingParticleWorld=G.world;G._buildingSmokeNext=new Map();}
  const reduced=G.buildingReducedMotion(),frame=G._buildingActivityFrame;
  if(reduced)G.smoke=[];
  if(!reduced&&!G.game.paused&&G.isWinter())for(const b of G._visibleActivityBuildings||[]){
    const s=frame?.entries.get(b.id);if(G.world.bmap[b.id]!==b||s?.kind!=='home'||!s.heating||!b._chimney)continue;
    if(G.buildingEffectTime<(G._buildingSmokeNext.get(b.id)||0))continue;
    G._buildingSmokeNext.set(b.id,G.buildingEffectTime+.85+(b.id%5)*.05);
    if(G.smoke.length<96)G.smoke.push({home:b.id,x:b._chimney[0],y:b._chimney[1],age:0,max:2.6});
  }
  for(let i=G.smoke.length-1;i>=0;i--){
    const p=G.smoke[i],b=G.world.bmap[p.home];
    if(!b||b.state!=='ok'||b.houseFire){G.smoke.splice(i,1);continue;}
    if(!G.game.paused){p.age+=dt;p.y-=dt*5;p.x+=Math.sin(p.age*2+p.home)*dt;}
    if(p.age>p.max)G.smoke.splice(i,1);
  }
  // 雪
  if (G.isWinter()) {
    if (!G.flakes) {
      G.flakes = [];
      for (let i = 0; i < 130; i++)
        G.flakes.push({ x: Math.random(), y: Math.random(), v: 0.05 + Math.random() * 0.1, ph: Math.random() * 10, r: 0.8 + Math.random() * 1.4 });
    }
    for (const f of G.flakes) {
      f.y += f.v * dt;
      f.ph += dt;
      if (f.y > 1.02) { f.y = -0.02; f.x = Math.random(); }
    }
  } else G.flakes = null;
};

/* Ground-level food forest warning while marking resources; no path queries. */
G.drawFoodForestBounds = function (ctx) {
  for (const [x0, y0, x1, y1] of G.foodForestBounds(G.world)) {
    ctx.save(); ctx.beginPath();
    [[x0,y0],[x1,y0],[x1,y1],[x0,y1]].forEach(([x,y], i) => {
      const [sx,sy] = G.T2S(x,y); if (i) ctx.lineTo(sx,sy); else ctx.moveTo(sx,sy);
    });
    ctx.closePath(); ctx.fillStyle = 'rgba(143,200,102,0.07)'; ctx.fill();
    ctx.strokeStyle = '#8fc866'; ctx.lineWidth = 1.5 / G.cam.z;
    ctx.setLineDash([6 / G.cam.z, 4 / G.cam.z]); ctx.stroke(); ctx.restore();
  }
};

/* ---------- 主绘制 ---------- */
G.frame = function (dtReal) {
  const cv = G.cv, ctx = G.ctx;
  if(!G.game.paused)G.buildingEffectTime+=dtReal;
  if (G.needGround || G.groundDirty.size || G._groundWorld !== G.world || G._groundScale !== G.groundScale) G.buildGround();

  ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
  ctx.fillStyle = '#14181d';
  ctx.fillRect(0, 0, cv.clientWidth, cv.clientHeight);

  const z = G.cam.z;
  ctx.setTransform(G.dpr * z, 0, 0, G.dpr * z, G.dpr * G.cam.x, G.dpr * G.cam.y);

  // 地面
  ctx.drawImage(G._gcv, -G.groundOX, -G.groundOY,
    G._gcv.width / G.groundScale, G._gcv.height / G.groundScale);

  const w = G.world;
  // 可视瓦片范围
  const W = cv.clientWidth, H = cv.clientHeight;
  const corners = [G.screenToTile(0, 0), G.screenToTile(W, 0), G.screenToTile(0, H), G.screenToTile(W, H)];
  let tx0 = 1e9, ty0 = 1e9, tx1 = -1e9, ty1 = -1e9;
  for (const c of corners) {
    tx0 = Math.min(tx0, c.tx); tx1 = Math.max(tx1, c.tx);
    ty0 = Math.min(ty0, c.ty); ty1 = Math.max(ty1, c.ty);
  }
  tx0 = Math.max(0, Math.floor(tx0) - 2); ty0 = Math.max(0, Math.floor(ty0) - 2);
  tx1 = Math.min(G.world.N - 1, Math.ceil(tx1) + 4); ty1 = Math.min(G.world.N - 1, Math.ceil(ty1) + 4);

  // All farm soil is ground, never a tall object sorted by the field's far corner.
  for (const b of w.buildings) if (b.type === 'farm') G.drawFarmGround(ctx, b, { tx0, ty0, tx1, ty1 });
  for (const b of w.buildings) if (b.state === 'ok' && (b.type === 'pasture' || b.type === 'orchard' || b.type === 'cemetery'))
    G.drawEconomyFieldGround(ctx, b, { tx0, ty0, tx1, ty1 });

  for(const b of w.buildings)if(b.type==='bridge')G.drawBridge(ctx,b);
  for(const b of w.buildings)if(b.type==='roadwork')G.drawRoadWorkGround(ctx,b,{tx0,ty0,tx1,ty1});

  const harvesting = G.tool && (G.tool.kind === 'fell' || G.tool.kind === 'quarry');
  if (harvesting) G.drawFoodForestBounds(ctx);

  // 建造幽灵：贴着地面画、在建筑之前——后面的建筑/树会正确把它挡住，
  // 不会出现“绿色预览浮在已有建筑上”的误导
  if (G.tool && G.tool.kind === 'build' && G.hover.tx >= 0 && !(G.isFarmPlanning&&G.isFarmPlanning()) && !(G.isPasturePlanning&&G.isPasturePlanning()) && !(G.isOrchardPlanning&&G.isOrchardPlanning()) && !(G.isCemeteryPlanning&&G.isCemeteryPlanning())) {
    const def = G.BDEF[G.tool.type];
    const ox = G.hover.tx - ((def.w - 1) >> 1), oy = G.hover.ty - ((def.h - 1) >> 1);
    const chk = G.canPlace(w, G.tool.type, ox, oy);
    const preview = G.ui.refreshPlacement(G.tool.type, ox, oy);
    const radius = preview && preview.radius;
    if (radius) {
      const [x0,y0,x1,y1] = preview.bounds;
      const corners = [[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
      ctx.save(); ctx.beginPath();
      corners.forEach(([x,y], i) => { const [sx,sy] = G.T2S(x,y); if (i) ctx.lineTo(sx,sy); else ctx.moveTo(sx,sy); });
      ctx.closePath(); ctx.fillStyle = 'rgba(216,178,90,0.08)'; ctx.fill();
      ctx.strokeStyle = '#f0ce84'; ctx.lineWidth = 1.5 / G.cam.z; ctx.setLineDash([6 / G.cam.z,4 / G.cam.z]); ctx.stroke(); ctx.restore();
    }
    for (let j = 0; j < def.h; j++)
      for (let i = 0; i < def.w; i++) {
        const [sx, sy] = G.T2S(ox + i, oy + j);
        G.diamondPath(ctx, sx, sy);
        ctx.fillStyle = (!chk.ok || (preview && !preview.affordable)) ? 'rgba(230,90,80,0.4)' : (preview && preview.warning) ? 'rgba(235,180,65,0.4)' : 'rgba(120,230,140,0.4)';
        ctx.fill();
      }
    G._ghost = { ox, oy };
  } else {
    G._ghost = null;
    if (harvesting) G.ui.refreshHarvest();
    else G.ui.refreshPlacement(null);
  }

  G.drawFarmPlan(ctx);
  G.drawPasturePlan(ctx);
  G.drawOrchardPlan(ctx);
  G.drawCemeteryPlan(ctx);

  // 矿石与道路工具悬停（同样贴地）
  if (G.tool && G.tool.kind === 'quarry' && G.hover.tx >= 0 && G.hover.ty >= 0 && G.hover.tx < w.N && G.hover.ty < w.N) {
    const mineral = w.rock[G.hover.ty * w.N + G.hover.tx];
    const [sx, sy] = G.T2S(G.hover.tx, G.hover.ty);
    G.diamondPath(ctx, sx, sy);
    ctx.fillStyle = mineral ? 'rgba(120,230,140,0.4)' : 'rgba(230,90,80,0.25)';
    ctx.fill();
  }

  if (harvesting && G.harvestPlan && G.harvestPlan.world === w && G.harvestPlan.kind === G.tool.kind) {
    const p = G.harvestPlan, a = p.start, b = p.end;
    const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y), x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    ctx.save(); ctx.beginPath();
    // Four outside diamond vertices enclose the complete inclusive rectangle.
    const corners = [[x0, y0], [x1 + 1, y0], [x1 + 1, y1 + 1], [x0, y1 + 1]];
    corners.forEach(([x, y], i) => { const [sx, sy] = G.T2S(x, y); if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); });
    ctx.closePath(); ctx.fillStyle = 'rgba(235,180,65,.08)'; ctx.fill();
    ctx.strokeStyle = '#ffd17a'; ctx.lineWidth = 2 / G.cam.z; ctx.stroke(); ctx.restore();
    if (p.frozen) for (const t of p.targets) {
      const x = t.i % w.N, y = Math.floor(t.i / w.N);
      if (x < tx0 || x > tx1 || y < ty0 || y > ty1) continue;
      if (t.tree ? w.treeIdx[t.i] < 0 || w.trees[w.treeIdx[t.i]] !== t.tree : w.rock[t.i] !== t.rock) continue;
      const [sx, sy] = G.T2S(x, y); G.diamondPath(ctx, sx, sy);
      ctx.fillStyle = (t.tree ? w.marked : w.markedRocks).has(t.i) ? 'rgba(110,190,230,.55)' : 'rgba(235,180,65,.55)'; ctx.fill();
    }
  }

  // Cheap endpoint guide only; bounded route search runs once on release.
  if (G.tool && G.tool.kind === 'road' && G.roadDrag && G.roadDrag.world === w) {
    const a = G.T2S(G.roadDrag.start.x, G.roadDrag.start.y), b = G.T2S(G.roadDrag.end.x, G.roadDrag.end.y);
    ctx.save(); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    ctx.strokeStyle = '#f0ce84'; ctx.lineWidth = 2 / G.cam.z; ctx.setLineDash([6 / G.cam.z, 4 / G.cam.z]); ctx.stroke(); ctx.restore();
  }

  if (G.tool && G.tool.kind === 'road' && G.roadPlan && G.roadPlan.world === w) {
    const plan = G.roadPlan, route = plan.result.ok ? plan.result.path : plan.start ? [plan.start] : [];
    for (const p of route) {
      const [sx, sy] = G.T2S(p.x, p.y), i = p.y * w.N + p.x;
      const px = sx * G.cam.z + G.cam.x, py = sy * G.cam.z + G.cam.y;
      if (px < -40 * G.cam.z || px > cv.clientWidth + 40 * G.cam.z || py < -20 * G.cam.z || py > cv.clientHeight + 20 * G.cam.z) continue;
      G.diamondPath(ctx, sx, sy);
      ctx.fillStyle = (w.water[i] === 1 && plan.surface!=='bridge') || (plan.surface!=='tunnel'&&G.isMountain&&G.isMountain(w,p.x,p.y)) || w.rock[i] || w.bgrid[i] >= 0 ? 'rgba(230,90,80,.6)' : w.treeIdx[i] >= 0 ? 'rgba(235,180,65,.6)' : 'rgba(120,230,140,.5)';
      ctx.fill();
    }
  }

  if (G.tool && G.tool.kind === 'road' && G.hover.tx >= 0) {
    const [sx, sy] = G.T2S(G.hover.tx, G.hover.ty);
    G.diamondPath(ctx, sx, sy);
    const hx = G.hover.tx, hy = G.hover.ty, hi = hy * w.N + hx;
    ctx.fillStyle = hx >= 0 && hy >= 0 && hx < w.N && hy < w.N && w.water[hi] !== 1 && !(G.isMountain&&G.isMountain(w,hx,hy)) && !w.rock[hi] && w.bgrid[hi] < 0 ? 'rgba(120,230,140,0.4)' : 'rgba(230,90,80,0.4)';
    ctx.fill();
  }

  const items = [];
  // 树
  for (let y = ty0; y <= ty1; y++)
    for (let x = tx0; x <= tx1; x++) {
      const idx = w.treeIdx[y * w.N + x];
      if(G.isMountain&&G.isMountain(w,x,y))items.push({d:x+y+1,k:8,x,y});
      if (idx >= 0) items.push({ d: x + y, k: 0, x, y, t: w.trees[idx], marked: w.marked.has(y * w.N + x) });
      if (w.rock[y * w.N + x] && w.markedRocks && w.markedRocks.has(y * w.N + x))
        items.push({ d: x + y + 0.02, k: 3, x, y });
    }
  // Farm crops are individual upright cells; soil was already painted below all objects.
  for (const b of w.buildings) if (b.type === 'farm') for (const f of b.farm) {
    if (f.sown && !f.harvested && f.x >= tx0 && f.x <= tx1 && f.y >= ty0 && f.y <= ty1)
      items.push({ d: f.x + f.y + 1, k: 4, b, f });
  }
  for (const b of w.buildings) if (b.state === 'ok' && (b.type === 'pasture' || b.type === 'orchard' || b.type === 'cemetery' || b.type==='graveremnant'))
    G.addEconomyFieldParts(items, b, { tx0, ty0, tx1, ty1 });
  // 建筑
  for (const b of w.buildings) {
    if(b.type==='tunnel'){const ends=G.tunnelEndpoints(b);for(const [p,first]of [[ends.start,true],[ends.end,false]])if(p.x>=tx0-2&&p.x<=tx1+2&&p.y>=ty0-2&&p.y<=ty1+2)items.push({d:p.x+p.y+.62,k:9,b,p,first});continue;}
    if(['bridge','graveremnant','roadwork'].includes(b.type))continue; // Decks sit above water, below people and bankside objects.
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    if (cx < tx0 - 3 || cx > tx1 + 3 || cy < ty0 - 3 || cy > ty1 + 3) continue;
    items.push({ d: b.x + b.y + b.w + b.h - 2 - 0.5, k: 1, b });
  }
  // 市民：只为屏内的休息者构建住房索引，不触碰离屏人物状态。
  let citizenHomes = null;
  for (const c of w.citizens) {
    if (c.x < tx0 - 1 || c.x > tx1 + 1 || c.y < ty0 - 1 || c.y > ty1 + 1) continue;
    if (c.state === 'rest' && c.camped === false && !citizenHomes) citizenHomes = G.citizenHomeLookup(w);
    items.push({ d: c.x + c.y + 0.01, k: 2, c });
  }
  for(const pile of [...(w.supplyCaches||[]),...(w.families||[]).map(f=>f.supplyCamp).filter(Boolean)])if(!G.tunnelInteriorAt(w,pile.x,pile.y)&&G.supplySum(pile.supplyStock)>1e-8&&pile.x>=tx0-3&&pile.x<=tx1+3&&pile.y>=ty0-3&&pile.y<=ty1+3)items.push({d:pile.x+pile.y+.005,k:6,pile});
  G.addDeerDrawItems(items,w,{tx0,ty0,tx1,ty1});
  items.sort((a, b) => a.d - b.d);
  const now = performance.now() / 1000;
  G._visibleActivityBuildings=items.filter(it=>it.k===1&&it.b.state==='ok'&&!it.b.houseFire&&G.BUILD_ACTIVITY_TYPES.includes(it.b.type)).map(it=>it.b);
  G.prepareBuildingActivities(G._visibleActivityBuildings,now);
  for (const it of items) {
    if (it.k === 0) {
      G.drawTree(ctx, it.t);
      if (it.marked) { // 待砍标记（原版 Harvest Trees 的选中态）
        const [msx, msy] = G.T2S(it.x, it.y);
        G.diamondPath(ctx, msx, msy);
        ctx.strokeStyle = 'rgba(255,170,60,0.85)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    else if (it.k === 3) { // 待清除岩石标记
      const [msx, msy] = G.T2S(it.x, it.y);
      G.diamondPath(ctx, msx, msy);
      ctx.strokeStyle = 'rgba(255,170,60,0.85)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    else if (it.k === 4) G.drawFarmCrop(ctx, it.b, it.f);
    else if (it.k === 5) G.drawEconomyFieldPart(ctx, it);
    else if (it.k === 6) G.drawSupplyPile(ctx,it.pile);
    else if (it.k === 7) G.drawDeer(ctx,it.deer);
    else if (it.k === 8) G.drawMountain(ctx,w,it.x,it.y);
    else if(it.k===9)G.drawTunnelPortal(ctx,it.b,it.p,it.first);
    else if (it.k === 1) {
      if(it.b.type==='farm')G.drawFarmPestBadge(ctx,it.b);
      if(it.b.type==='pasture')G.drawPasturePestBadge(ctx,it.b);
      // Farm ground/crops were split above; keep its building-level badges.
      if (it.b.type !== 'farm' && !(it.b.state === 'ok' && (it.b.type === 'pasture' || it.b.type === 'orchard' || it.b.type === 'cemetery')))
        G.drawBuilding(ctx, it.b, now);
      if(G.game.supplyMode==='physical'&&G.supplyHome(it.b)&&G.supplyResidents(it.b).length&&G.supplyFood(it.b.supplyStock)<G.supplyResidents(it.b).length*G.LIFE.eatPerDay){const p=G.T2S(it.b.x+it.b.w/2,it.b.y);G.drawNeedBadge(ctx,p[0]-3,p[1]-25,'food');}
      // Cold homes get a distinct snowflake; no-work warning remains separate.
      if (G.isWinter() && it.b.unheated && it.b.state === 'ok') {
        const T = G.T2S(it.b.x + it.b.w / 2, it.b.y);
        G.drawNeedBadge(ctx, T[0] + 13, T[1] - 25, 'cold');
      }
      // 警告标记
      if (it.b.noWork && it.b.state === 'ok') {
        const T = G.T2S(it.b.x + it.b.w / 2, it.b.y);
        if (!G.sprDraw(ctx, 'alert', T[0], T[1] - 16, {})) {
          ctx.font = '13px system-ui';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#ffcf4d';
          ctx.fillText('⚠', T[0], T[1] - 30);
        }
      }
    } else G.drawCitizen(ctx, it.c, now, citizenHomes);
  }

  if(G.tool?.kind==='road'&&G.roadPlan?.surface==='tunnel'&&G.roadPlan.world===w&&G.roadPlan.start&&G.roadPlan.end)G.drawTunnelGuide(ctx,G.roadPlan.start,G.roadPlan.end,G.roadPlan.result.ok);
  if(G.sel?.kind==='b'&&w.bmap[G.sel.id]?.type==='tunnel'){const ends=G.tunnelEndpoints(w.bmap[G.sel.id]);G.drawTunnelGuide(ctx,ends.start,ends.end,true);}

  // Raised mountain hit surfaces stay visible for all tools, including invalid builds.
  const mountainHover=G.hover&&G.hover.tx>=0&&G.drawMountainHover(ctx,w,G.hover.tx,G.hover.ty);
  // 悬停瓦片
  if (G.hover && G.hover.tx >= 0 && !G.tool && !mountainHover) {
    const [sx, sy] = G.T2S(G.hover.tx, G.hover.ty);
    G.diamondPath(ctx, sx, sy);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // 选中建筑高亮
  if (G.sel && G.sel.kind === 'b') {
    const b = w.bmap[G.sel.id];
    if (b) {
      const T = G.T2S(b.x, b.y), R = G.T2S(b.x + b.w, b.y), B = G.T2S(b.x + b.w, b.y + b.h), L = G.T2S(b.x, b.y + b.h);
      ctx.strokeStyle = `rgba(255,235,170,${0.5 + Math.sin(now * 4) * 0.25})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(T[0], T[1]); ctx.lineTo(R[0], R[1]); ctx.lineTo(B[0], B[1]); ctx.lineTo(L[0], L[1]);
      ctx.closePath();
      ctx.stroke();
    }
  }

  // Same-frame visible anchors and facts are ready before particle emission.
  G.updateParticles(dtReal);
  // 炊烟（世界层）
  for (const p of G.smoke) {
    const a = Math.max(0, 1 - p.age / p.max);
    ctx.fillStyle = `rgba(210,210,215,${a * 0.35})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2 + p.age * 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // 屏幕空间：夜色 + 雪
  ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
  const na = G.nightAlpha();
  if (na > 0) {
    ctx.fillStyle = `rgba(14,20,48,${na})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (G.flakes) {
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (const f of G.flakes) {
      const fx = (f.x + Math.sin(f.ph) * 0.01) * W;
      ctx.beginPath();
      ctx.arc(fx, f.y * H, f.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 地面缓存清晰度：缩放稳定后按当前倍率重建（受画布像素上限约束，控制内存）
  const gcap = G.maxGroundScale();
  const tgt = Math.min(Math.max(z, 0.55), gcap);
  if (Math.abs(tgt - G.groundScale) > 0.12 && !G._gsTimer) {
    G._gsTimer = setTimeout(() => {
      G._gsTimer = null;
      G.groundScale = Math.min(Math.max(G.cam.z, 0.55), G.maxGroundScale());
      G.needGround = true;
    }, 250);
  } else if (Math.abs(tgt - G.groundScale) <= 0.12 && G._gsTimer) {
    clearTimeout(G._gsTimer);
    G._gsTimer = null;
  }
};

G.drawBridge = function(ctx,b) {
  const complete=b.state==='ok', length=b.w+b.h-1;
  for(let n=0;n<length;n++){
    const x=b.x+(b.w>1?n:0),y=b.y+(b.h>1?n:0),[sx,sy]=G.T2S(x,y);
    if(complete&&G.sprDraw(ctx,'bridge_'+b.bridgeAxis,sx,sy+32,{w:64}))continue;
    ctx.save();
    // Construction is an explicitly dashed water footprint, never a finished deck.
    G.diamondPath(ctx,sx,sy+(complete?-8:0));ctx.fillStyle=complete?'#98774b':'rgba(176,137,77,.22)';ctx.fill();
    ctx.strokeStyle=complete?'#624b32':'#d9b064';ctx.lineWidth=1;ctx.setLineDash(complete?[]:[4,3]);ctx.stroke();
    if(complete){for(let k=1;k<5;k++){const u=k/5;ctx.beginPath();if(b.w>1){ctx.moveTo(sx-32*u,sy+16*u-8);ctx.lineTo(sx+32-32*u,sy+16+16*u-8)}else{ctx.moveTo(sx+32*u,sy+16*u-8);ctx.lineTo(sx-32+32*u,sy+16+16*u-8)}ctx.stroke();}}
    ctx.restore();
  }
  if(!complete){const [sx,sy]=G.T2S(b.x,b.y);ctx.fillStyle='#403924';ctx.fillRect(sx-19,sy-19,38,5);ctx.fillStyle='#dbb25f';ctx.fillRect(sx-19,sy-19,38*b.progress,5);}
};

/* Existing resource art on a small code-native crate: actual recoverable goods,
 * not another warehouse or a passive transfer. Camps remain unheated outdoors. */
G.drawSupplyPile=function(ctx,pile){
 if(!G.supplySum(pile.supplyStock))return;const[x,y]=G.T2S(pile.x,pile.y),by=y+16;
 quadFill(ctx,x-6,by-4,x,by-7,x+6,by-4,x,by-1,'#98734d');
 quadFill(ctx,x-6,by-4,x,by-1,x,by+3,x-6,by,'#785238');
 quadFill(ctx,x,by-1,x+6,by-4,x+6,by,x,by+3,'#5d452e');
 const types=G.SUPPLY.types.filter(k=>(pile.supplyStock[k]||0)>1e-8).slice(0,3);
 types.forEach((type,i)=>G.sprDraw(ctx,'carry_'+type,x+(i-(types.length-1)/2)*5,by-2,{w:8}));
};


/* Small code-native masonry mouths reuse the existing warm stone/wood palette.
 * No bitmap is generated or repainted. Mountain collision and body stay intact;
 * each mouth is depth-sorted/cullable separately even for a very long tunnel. */
G.tunnelArchOutline=(half,h)=>[[-half,0],[-half,h-7],[-half*.83,h-2],[-half*.5,h+1],[0,h+2],[half*.5,h+1],[half*.83,h-2],[half,h-7],[half,0]];
G.tunnelPortalGeometry=function(b,p,first){const {start,end}=G.tunnelEndpoints(b),other=first?end:start,dx=Math.sign(other.x-p.x),dy=Math.sign(other.y-p.y),[sx,sy]=G.T2S(p.x+dx*.45,p.y+dy*.45),ux=.894,uy=b.tunnelAxis==='x'?-.447:.447,outline=b.state==='ok'?G.tunnelArchOutline(12,23):[[-12,0],[-12,19],[12,19],[12,0]];return {sx,sy,ux,uy,points:outline.map(([x,h])=>[sx+ux*x,sy+16+uy*x-h])};};
G.drawTunnelPortal=function(ctx,b,p,first){
 const {sx,sy,ux,uy}=G.tunnelPortalGeometry(b,p,first),complete=b.state==='ok';ctx.save();ctx.transform(ux,uy,0,-1,sx,sy+16);
 const arch=(half,h)=>G.mountainPolygonPath(ctx,G.tunnelArchOutline(half,h));
 if(complete){arch(12,23);ctx.fillStyle=first?'#9d8d73':'#ad9c80';ctx.fill();ctx.strokeStyle='#625b4c';ctx.lineWidth=1;ctx.stroke();arch(7,18);ctx.fillStyle='#282b24';ctx.fill();
  ctx.strokeStyle='#756955';ctx.lineWidth=.7;for(const side of [-1,1])for(const y of [6,12,17]){ctx.beginPath();ctx.moveTo(side*7,y);ctx.lineTo(side*12,y);ctx.stroke();}
  for(const x of [-6,0,6]){ctx.beginPath();ctx.moveTo(x*.7,19-Math.abs(x)*.17);ctx.lineTo(x,25-Math.abs(x)*.23);ctx.stroke();}
  ctx.strokeStyle='#c2b292';ctx.beginPath();ctx.moveTo(-11,1);ctx.lineTo(-11,16);ctx.stroke();
 }else{ctx.fillStyle='#615b49';ctx.fillRect(-10,0,20,2);ctx.strokeStyle='#a4875f';ctx.lineWidth=2.5;for(const x of [-10,10]){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,18);ctx.stroke();}ctx.beginPath();ctx.moveTo(-11,17);ctx.lineTo(11,17);ctx.moveTo(-9,3);ctx.lineTo(9,14);ctx.moveTo(-9,14);ctx.lineTo(9,3);ctx.stroke();}
 ctx.restore();if(!complete&&first){ctx.save();ctx.fillStyle='#493f30';ctx.fillRect(sx-13,sy-15,26,4);ctx.fillStyle=b.sitePaused?'#9b9585':'#d0af71';ctx.fillRect(sx-13,sy-15,26*b.progress,4);ctx.restore();}
};
G.drawTunnelGuide=function(ctx,start,end,valid){
 const a=G.T2S(start.x,start.y),b=G.T2S(end.x,end.y);ctx.save();ctx.strokeStyle=valid?'rgba(220,188,124,.8)':'rgba(203,121,92,.9)';ctx.lineWidth=1.2/G.cam.z;ctx.setLineDash([5/G.cam.z,4/G.cam.z]);ctx.beginPath();ctx.moveTo(a[0],a[1]+16);ctx.lineTo(b[0],b[1]+16);ctx.stroke();ctx.setLineDash([]);ctx.font='10px sans-serif';ctx.textAlign='center';ctx.fillStyle='#edddb5';ctx.fillText('A',a[0],a[1]+29);ctx.fillText('B',b[0],b[1]+29);ctx.restore();
};

/* Pending road markers sit on ground; they never paint a finished road or own a hit target. */
G.drawRoadWorkGround=function(ctx,b,bounds){const selected=G.sel?.kind==='b'&&G.sel.id===b.id;ctx.save();ctx.lineWidth=selected?1.3:.85;
 for(const p of b.roadWork.cells){if(p.done||bounds&&(p.x<bounds.tx0||p.x>bounds.tx1||p.y<bounds.ty0||p.y>bounds.ty1))continue;const [x,y]=G.T2S(p.x,p.y);ctx.strokeStyle=b.sitePaused?'#8c8678':p.used?'#c19762':selected?'#d2ae75':'#a18a65';ctx.setLineDash(selected?[4,4]:[2,10]);G.diamondPath(ctx,x,y);ctx.stroke();if(p.workLeft<G.ROAD_WORK_H){ctx.setLineDash([]);ctx.strokeStyle='#d3b784';ctx.beginPath();ctx.moveTo(x-9,y+16);ctx.lineTo(x-9+18*(1-p.workLeft/G.ROAD_WORK_H),y+16);ctx.stroke();}}
 if(!bounds||b.x>=bounds.tx0&&b.x<=bounds.tx1&&b.y>=bounds.ty0&&b.y<=bounds.ty1){const [x,y]=G.T2S(b.x,b.y);ctx.setLineDash([]);ctx.strokeStyle='#765e43';ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(x-10,y+22);ctx.lineTo(x-10,y+9);ctx.stroke();ctx.fillStyle=b.sitePaused?'#989184':'#c69a64';ctx.fillRect(x-10,y+9,8,5);const n=Math.min(4,Math.ceil((b.construction.onsite.stone||0)/5));for(let i=0;i<n;i++){ctx.fillStyle=i%2?'#aaa391':'#8c8b80';ctx.beginPath();ctx.ellipse(x+1+(i%2)*4,y+21-Math.floor(i/2)*3,3.5,2,0,0,Math.PI*2);ctx.fill();}if(selected){ctx.fillStyle='#e1cda9';ctx.font='9px sans-serif';ctx.textAlign='center';ctx.fillText('料',x-6,y+5);}}
 ctx.restore();
};
