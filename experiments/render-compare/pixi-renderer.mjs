import { VIEW, visible } from './scene.mjs';
export class PixiRenderer {
  static async create(PIXI,canvas,items,assets) {
    const self=new PixiRenderer();self.items=items;self.textures=new Map();self.nodes=[];self.geometry=[];self.destroyed=false;
    self.app=new PIXI.Application();
    try {
    await self.app.init({canvas,width:VIEW.width,height:VIEW.height,resolution:VIEW.resolution,autoStart:false,sharedTicker:false,preference:'webgl',preferWebGLVersion:2,antialias:true,backgroundColor:0x14181d});
    if(!self.app.renderer.gl) throw Error('Explicit WebGL renderer unavailable');
    self.world=new PIXI.Container({isRenderGroup:true});self.world.eventMode='none';self.app.stage.addChild(self.world);
    for(const [name,resource]of assets) {
      const source=PIXI.TextureSource.from(resource);
      source.scaleMode='linear';source.autoGenerateMipmaps=false;
      if(name.startsWith('mountain_'))source.addressMode='repeat';
      const texture=new PIXI.Texture({source});self.textures.set(name,texture);
    }
    for(const item of items) {
      let node;
      if(item.kind==='sprite') {
        let texture=self.textures.get(item.asset);
        if(item.crop) {
          const [x,y,width,height]=item.crop;
          texture=new PIXI.Texture({source:texture.source,frame:new PIXI.Rectangle(x,y,width,height)});
          self.textures.set(item.asset+':frame',texture);
        }
        node=new PIXI.Sprite(texture);node.position.set(item.x+(item.flip?item.width:0),item.y);node.width=item.width;node.height=item.height;
        if(item.flip)node.scale.x=-Math.abs(node.scale.x);
      } else {
        const positions=new Float32Array(item.points.flat()),indices=[];
        for(let i=1;i<item.points.length-1;i++)indices.push(0,i,i+1);
        const texture=item.asset?self.textures.get(item.asset):PIXI.Texture.WHITE;
        const uvs=item.asset?new Float32Array(item.uv.flatMap(p=>[p[0]/texture.source.width,p[1]/texture.source.height])):new Float32Array(positions.length);
        const geometry=new PIXI.MeshGeometry({positions,uvs,indices:new Uint32Array(indices)});
        self.geometry.push(geometry);node=new PIXI.Mesh({geometry,texture});
        if(item.color)node.tint=item.color;
      }
      node.alpha=item.alpha??1;node.eventMode='none';self.nodes.push(node);self.world.addChild(node);
    }
    self.canvas=canvas;
    return self;
    } catch(error) {try {self.destroy();}catch(cleanupError){console.warn('Pixi partial cleanup failed',cleanupError);}throw error;}
  }
  render(cam) {
    this.world.position.set(cam.x,cam.y);this.world.scale.set(cam.z);
    for(let i=0;i<this.items.length;i++)this.nodes[i].visible=visible(this.items[i],cam);
    this.app.render();
  }
  capabilities() {
    const gl=this.app.renderer.gl,ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {engine:'PixiJS',version:globalThis.PIXI.VERSION,backend:'WebGL',glVersion:gl.getParameter(gl.VERSION),vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),maxTextureSize:gl.getParameter(gl.MAX_TEXTURE_SIZE),nativeNodes:this.nodes.length,textureSources:new Set([...this.textures.values()].map(t=>t.source)).size};
  }
  destroy() {
    if(this.destroyed)return;this.destroyed=true;
    if(this.app.renderer)this.app.destroy(false,{children:true,texture:false,textureSource:false});
    else {this.app.stage?.destroy({children:true});this.app.ticker?.destroy();}
    for(const g of this.geometry)if(g.buffers)g.destroy(true);
    const sources=new Set([...this.textures.values()].map(t=>t.source));
    for(const t of this.textures.values())t.destroy(false);
    for(const s of sources)if(!s.destroyed)s.destroy();
    this.nodes=[];this.textures.clear();
  }
}
