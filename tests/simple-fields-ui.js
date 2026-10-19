'use strict';
// Production input + live DOM/simulation contracts, not browser visual acceptance.
const assert=require('node:assert/strict');
const {fixture}=require('./helpers/field-ui');
function bindInput(type) {
  const f=fixture(), canvas=f.mount('game');
  f.G.ui.initToolbar(); f.G.setTool(type);
  canvas.style={}; canvas.getContext=()=>({}); canvas.getBoundingClientRect=()=>({left:17,top:29});
  f.G.ui.init=()=>{}; f.G.feedback={init(){}}; f.G.tryReplayLoad=()=>true; f.G.probeServerSaves=()=>{}; f.G.init();
  function point(x,y){const [sx,sy]=f.G.T2S(x+.25,y+.25);return {clientX:17+sx*f.G.cam.z+f.G.cam.x,clientY:29+sy*f.G.cam.z+f.G.cam.y,target:canvas,button:0};}
  function mouse(event,x,y,props={}){const e={...point(x,y),...props};return event==='mousedown'?canvas.emit(event,e):f.windowEvent(event,e);}
  function touch(event,x,y,props={}){const p=point(x,y);return canvas.emit(event,{touches:event==='touchend'?[]:[p],changedTouches:[p],...props});}
  return Object.assign(f,{canvas,mouse,touch,point});
}
function run(type){
  let passed=0;function test(name,fn){fn();passed++;console.log('ok '+type+': '+name);}
  const sizeKey=type+'Size', cap=type==='pasture'?1:2;
  test('toolbar gives fixed footprint and no two-corner instructions',()=>{
    const f=bindInput(type);assert.equal(f.G[type==='pasture'?'isPasturePlanning':'isOrchardPlanning'](),false);
    assert.match(f.doc.getElementById('toolbar-state').textContent,/点击地图放置固定6×6/);
    assert.match(f.toolbar.querySelector(`[data-tool="${type}"]`).textContent,/6×6/);
    assert.doesNotMatch(f.toolbar.querySelector(`[data-tool="${type}"]`).textContent,/7–20|4–15|按面积|按树列/);
  });
  for(const mode of ['mouse','touch','api'])test(mode+' places one original-capacity construction site',()=>{
    const f=bindInput(type),G=f.G,wood=G.game.res.wood;
    if(mode==='mouse'){f.mouse('mousedown',10,10);f.mouse('mouseup',10,10);}
    else if(mode==='touch'){assert(f.touch('touchstart',10,10).defaultPrevented);assert(f.touch('touchend',10,10).defaultPrevented);}
    else G.tryPlace(10,10);
    assert.equal(G.world.buildings.length,1);const b=G.world.buildings[0];
    assert.equal(b.w,6);assert.equal(b.h,6);assert.equal(b[sizeKey],undefined);assert.equal(b.state,'site');
    assert.equal(G.workerMaximumOf(b),cap);assert.equal(G.game.res.wood,wood);assert.equal(b.construction.required.wood,G.BDEF[type].cost.wood);
    assert.equal(b.totalWork,G.BDEF[type].buildWork);
    if(type==='pasture')for(const [kind,n]of Object.entries({sheep:12,cattle:10,chicken:24}))assert.equal(G.pastureCapacity(b,kind),n);
    else assert.equal(G.orchardTreeCount(b),9);
    // Repeated tap on the same location cannot charge/build twice.
    const after=G.game.res.wood;f.touch('touchstart',10,10);f.touch('touchend',10,10);
    assert.equal(G.world.buildings.length,1);assert.equal(G.game.res.wood,after);
    f.touch('touchstart',25,25);f.touch('touchend',25,25);assert.equal(G.world.buildings.length,2,JSON.stringify(f.toasts));
  });
  for(const mode of ['move','multi','cancel','blur','hidden','world','game','tool','modal','focus','escape'])test('interrupted '+mode+' tap never builds',()=>{
    const f=bindInput(type),G=f.G;f.touch('touchstart',10,10);
    if(mode==='move')f.touch('touchmove',15,15);
    if(mode==='multi')f.touch('touchstart',10,10,{touches:[f.point(10,10),f.point(12,12)]});
    if(mode==='cancel')f.touch('touchcancel',10,10);
    if(mode==='blur')f.windowEvent('blur');
    if(mode==='hidden'){f.doc.visibilityState='hidden';f.documentEvent('visibilitychange');}
    if(mode==='world')G.world={...G.world};
    if(mode==='game')G.game={...G.game};
    if(mode==='tool'){G.setTool('house');G.setTool(type);}
    if(mode==='modal')G.hasOpenModal=()=>true;
    if(mode==='focus')f.documentEvent('focusin',{target:{tagName:'INPUT'}});
    if(mode==='escape')f.windowEvent('keydown',{key:'Escape',target:f.canvas});
    const wood=G.game.res.wood;f.touch('touchend',10,10);assert.equal(G.world.buildings.length,0);assert.equal(G.game.res.wood,wood);
  });
  test('drag does not create a larger field and farm still uses corners',()=>{
    const f=bindInput(type);f.mouse('mousedown',10,10);f.mouse('mousemove',25,25);f.mouse('mouseup',25,25);assert.equal(f.G.world.buildings.length,0);
    f.G.setTool('farm');f.touch('touchstart',5,5);f.touch('touchend',5,5);f.touch('touchstart',10,10);f.touch('touchend',10,10);
    assert(f.G.farmPlan?.end);assert.equal(f.G.world.buildings.length,0);
  });
  for(const size of [undefined,type==='pasture'?[20,20]:[15,15]])test((size?'existing area':'fixed')+' details keep true capacity and staff limit',()=>{
    const f=fixture(),G=f.G;const r=G.addBuilding(type,2,2,{instant:true,free:true,...(size?{[sizeKey]:size}:{})});assert(r.ok,r.reason);const b=r.b;f.select(b);
    const max=size?(type==='pasture'?2:3):cap;
    assert.equal(f.doc.getElementById('worker-limit-input').getAttribute('max'),String(max));
    if(type==='pasture'){
      const text=f.info.querySelector('[data-economy-live="pasture-capacity-rule"]').textContent;
      assert.match(text,size?/羊 25 头/:/羊12头/);
    }else{
      const text=f.info.querySelector('[data-economy-live="orchard-area"]').textContent;
      assert.match(text,size?/40树位/:/9树位/);
    }
  });
  console.log(`${type}: ${passed} fixed-placement and area-save UI contracts passed.`);
}
module.exports={run};
if(require.main===module){run('pasture');run('orchard');}
