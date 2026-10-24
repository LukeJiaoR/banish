import { VIEW, visible } from './scene.mjs';
export class CanvasRenderer {
  constructor(canvas,items,assets) {
    this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:false});this.items=items;this.assets=assets;this.patterns=new Map();
    canvas.width=VIEW.width;canvas.height=VIEW.height;
    for(const i of items)if(i.kind==='polygon'&&i.asset&&!this.patterns.has(i.asset))this.patterns.set(i.asset,this.ctx.createPattern(assets.get(i.asset),'repeat'));
  }
  render(cam) {
    const c=this.ctx;c.setTransform(1,0,0,1,0,0);c.fillStyle='#14181d';c.fillRect(0,0,VIEW.width,VIEW.height);c.setTransform(cam.z,0,0,cam.z,cam.x,cam.y);
    for(const item of this.items) {
      if(!visible(item,cam))continue;
      c.globalAlpha=item.alpha??1;
      if(item.kind==='sprite') {
        const im=this.assets.get(item.asset),{x,y,width:w,height:h}=item;
        if(item.flip){c.save();c.translate(x+w,y);c.scale(-1,1);c.drawImage(im,0,0,w,h);c.restore();}
        else if(item.crop)c.drawImage(im,...item.crop,x,y,w,h);
        else c.drawImage(im,x,y,w,h);
      } else {
        c.beginPath();item.points.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.closePath();
        if(item.asset) {
          c.save();c.clip();
          if(item.points.length===3) {
            const m=affine(item.points,item.uv); c.transform(...m);
          }
          const b=item.uv.reduce((b,[x,y])=>[Math.min(b[0],x),Math.min(b[1],y),Math.max(b[2],x),Math.max(b[3],y)],[Infinity,Infinity,-Infinity,-Infinity]);
          c.fillStyle=this.patterns.get(item.asset);c.fillRect(b[0]-1,b[1]-1,b[2]-b[0]+2,b[3]-b[1]+2);c.restore();
        } else { c.fillStyle=item.color;c.fill(); }
      }
    }
    c.globalAlpha=1;
  }
  destroy() {this.patterns.clear();}
}
// Same affine interpolation as the production mountain material transform.
export function affine([p,q,r],[u,v,z]) {
  const ux=v[0]-u[0],uy=v[1]-u[1],vx=z[0]-u[0],vy=z[1]-u[1],det=ux*vy-vx*uy;
  if(Math.abs(det)<1e-8)throw Error('Degenerate material UV');
  const a=((q[0]-p[0])*vy-(r[0]-p[0])*uy)/det,c=((r[0]-p[0])*ux-(q[0]-p[0])*vx)/det,b=((q[1]-p[1])*vy-(r[1]-p[1])*uy)/det,d=((r[1]-p[1])*ux-(q[1]-p[1])*vx)/det;
  return [a,b,c,d,p[0]-a*u[0]-c*u[1],p[1]-b*u[0]-d*u[1]];
}
