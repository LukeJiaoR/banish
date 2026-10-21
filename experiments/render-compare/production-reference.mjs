import { VIEW,mutableCopy } from './scene.mjs';
// G.frame is intentionally unmodified. Its citizen presentation fields must not
// mutate the immutable fixture shared by the measured adapters.
export class ProductionReference {
  constructor(G,world,game,canvas) {
    this.G=G;this.world=mutableCopy(world);this.game=mutableCopy(game);this.canvas=canvas;
    canvas.width=VIEW.width;canvas.height=VIEW.height;this.ctx=canvas.getContext('2d');
    this.viewport={width:VIEW.width,height:VIEW.height,clientWidth:VIEW.width,clientHeight:VIEW.height};
  }
  render(cam) {
    const G=this.G,keys=['world','game','cv','ctx','dpr','cam','ui','flakes','_groundWorld','_gsTimer'],saved=Object.fromEntries(keys.map(k=>[k,G[k]]));
    try {
      G.world=this.world;G.game=this.game;G.cv=this.viewport;G.ctx=this.ctx;G.dpr=VIEW.resolution;G.cam=cam;
      G.ui={refreshPlacement(){},refreshHarvest(){}};G.flakes=[];
      // Same already-built cache, same numeric terrain. No rebuild or adaptive
      // zoom timer is included in this static reference comparison.
      G._groundWorld=this.world;G._gsTimer=null;
      G.frame(0);
    } finally {
      if(G._gsTimer)clearTimeout(G._gsTimer);
      for(const [key,value]of Object.entries(saved))G[key]=value;
    }
  }
}
