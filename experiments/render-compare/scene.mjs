// Bounded renderer adapter. No simulation, saves, network or production overrides.
export const VIEW = Object.freeze({ width: 960, height: 600, resolution: 1 });
export const SOURCE_FILES = Object.freeze(['core', 'defs', 'map', 'sim', 'fire', 'supply', 'sprites', 'render', 'main']);
export const OMISSIONS = Object.freeze([
  'Only a paused newly generated mountain town is supported (cart, citizens, wildlife, forest and mountains).',
  'Citizen four-pass screen-pixel rim and elliptical ground shadows are omitted from BOTH shared renderers.',
  'No simulation, moving agents, building activity, particles, UI, placement, save loading, dirty-ground updates or context restoration.',
  'Terrain/shore/mineral ground is the production Canvas cache (requested scale 0.5; capped by its pixel budget), split into static guttered chunks once per fixture.',
  'Mountain material/geometry and depth ordering are preserved; Canvas/WebGL edge antialiasing may differ.',
]);
export function mutableCopy(value, seen = new WeakMap()) {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (Object.prototype.toString.call(value) === '[object Set]') { const set=new Set();seen.set(value,set);for(const v of value)set.add(mutableCopy(v,seen));return set; }
  const out=Array.isArray(value)||ArrayBuffer.isView(value)?[]:{};seen.set(value,out);
  for(const [key,v]of Object.entries(value))out[key]=mutableCopy(v,seen);return out;
}
export function immutableCopy(value, seen = new WeakMap()) {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (Object.prototype.toString.call(value) === '[object Set]') {
    const set = new Set([...value].map(v => immutableCopy(v, seen)));
    for (const key of ['add', 'delete', 'clear']) Object.defineProperty(set, key, { value() { throw Error('Immutable fixture Set'); } });
    seen.set(value, set); return Object.freeze(set);
  }
  const out = Array.isArray(value) || ArrayBuffer.isView(value) ? [] : {};
  seen.set(value, out);
  for (const [k, v] of Object.entries(value)) out[k] = immutableCopy(v, seen);
  return Object.freeze(out);
}
export function canonical(value) {
  if (Object.prototype.toString.call(value) === '[object Set]') return [...value].sort((a,b)=>a-b);
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return Array.from(value, canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export async function sha256(text) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export function bounds(points) {
  return { x0: Math.min(...points.map(p=>p[0])), x1: Math.max(...points.map(p=>p[0])), y0: Math.min(...points.map(p=>p[1])), y1: Math.max(...points.map(p=>p[1])) };
}
export function visible(item, cam, width = VIEW.width, height = VIEW.height) {
  const b = item.bounds;
  return b.x1*cam.z+cam.x >= -2 && b.x0*cam.z+cam.x <= width+2 && b.y1*cam.z+cam.y >= -2 && b.y0*cam.z+cam.y <= height+2;
}
export function cameraAt(world, scenario = 'village', step = 0, width = VIEW.width, height = VIEW.height) {
  const s = world.start, theta = step*Math.PI*2;
  let x=s.x, y=s.y, z=1;
  if (scenario === 'ridge') { x=s.x-18; y=s.y-12; z=.85; }
  else if (scenario === 'overview') { x=world.N/2; y=world.N/2; z=Math.min(width/(world.N*64+80),height/(world.N*32+80))*.95; }
  else if (scenario === 'pan-zoom') { x=s.x-11+Math.sin(theta)*15; y=s.y-6+Math.cos(theta)*10; z=.65+.3*(1+Math.sin(theta)); }
  return Object.freeze({ x:width/2-(x-y)*32*z, y:height/2-(x+y)*16*z, z });
}
function sprite(G, asset, x, footY, options = {}) {
  const image=G.SPR.get(asset); if (!image?.width) throw Error('Required scene asset missing: '+asset);
  const size=options.width ? {w:options.width} : G.SPRITE_SIZES[asset] || {};
  const h=size.w ? size.w*image.height/image.width : size.h || image.height;
  const w=size.w || h*image.width/image.height;
  return {kind:'sprite',asset,x:x-w/2,y:footY-h,width:w,height:h,flip:!!options.flip,bounds:{x0:x-w/2,x1:x+w/2,y0:footY-h,y1:footY},triangles:2};
}
function polygon(points, options) { return { kind:'polygon', points, bounds:bounds(points), triangles:points.length-2,...options }; }
export function buildCommands(G) {
  const w=G.world, snowy=G.game.season===3, items=[];
  const groups=[]; let ordinal=0;
  for (let y=0;y<w.N;y++) for(let x=0;x<w.N;x++) {
    if(G.isMountain(w,x,y)) {
      const commands=[],faces=G.mountainPolygons(w,x,y), tops=faces.filter(f=>f.kind.startsWith('top'));
      const asset=snowy?'mountain_rock_snow':'mountain_rock';
      const toe=faces.find(f=>f.kind==='toe');
      if(toe) commands.push(polygon(toe.points,{asset,uv:toe.points,alpha:.48}));
      if(tops.length===2) commands.push(polygon([tops[0].points[0],tops[0].points[1],tops[0].points[2],tops[1].points[2]],{color:snowy?'#a99b83':'#a3957d'}));
      for(const f of faces) {
        if(f.kind==='toe') continue;
        commands.push(polygon(f.points,{color:snowy?'#a99b83':'#a3957d'}));
        const top=f.kind.startsWith('top');
        const uv=top?(f.kind==='topX'?[[x,y],[x+1,y],[x+1,y+1]]:[[x,y],[x+1,y+1],[x,y+1]]).map(p=>G.mountainMaterialUV(...p)):f.points;
        commands.push(polygon(f.points,{asset,uv}));
        const h=f.heights,dx=top?(f.kind==='topX'?h[1]-h[0]:h[1]-h[2]):0,dy=top?(f.kind==='topX'?h[2]-h[1]:h[2]-h[0]):0;
        const shade=Math.max(-.09,Math.min(.11,(dx-dy)*.0045));
        commands.push(polygon(f.points,{color:top?(shade<0?'#fff8de':'#24211b'):'#23221e',alpha:top?Math.abs(shade):f.kind==='left'?.17:.34}));
      }
      groups.push({kind:'mountain',depth:x+y+1,ordinal:ordinal++,commands});
    }
    const ti=w.treeIdx[y*w.N+x];
    if(ti>=0) {
      const t=w.trees[ti],[sx,sy]=G.T2S(x,y),asset='tree_'+['sapling','young','mature'][G.treeStage(t)]+(snowy?'_snow':'');
      // Match production sprDraw exactly; it currently does not consume opts.h.
      groups.push({kind:'tree',depth:x+y,ordinal:ordinal++,commands:[sprite(G,asset,sx,sy+16)]});
    }
  }
  for(const b of w.buildings) {
    if(b.type!=='storage'||b.state!=='ok') throw Error('Fixture scope exceeded: unsupported building '+b.type);
    const [x,y]=G.T2S(b.x+b.w,b.y+b.h);
    groups.push({kind:'building',depth:b.x+b.y+b.w+b.h-2.5,ordinal:ordinal++,commands:[sprite(G,b.type,x,y,{width:(b.w+b.h)*32*(G.BUILD_SPR_W[b.type]||1.08)})]});
  }
  for(const c of w.citizens) {
    if(c.dead || c.state!=='idle'||c.carry||c.task) throw Error('Fixture scope exceeded: non-idle citizen');
    const [x,y]=G.T2S(c.x,c.y),asset=c.age<G.ADULT_AGE?'child_idle':'adult_idle';
    // New-town idle sprites have no movement delta. Do not call citizenFacing: it writes presentation fields.
    const flip=c._fx===-1;
    groups.push({kind:'citizen',depth:c.x+c.y+.01,ordinal:ordinal++,commands:[sprite(G,asset,x,y+16,{flip})]});
  }
  for(const d of w.deer||[]) if(d.returnDay===null) {
    const [x,y]=G.T2S(d.x,d.y);
    groups.push({kind:'deer',depth:d.x+d.y+.015,ordinal:ordinal++,commands:[sprite(G,'deer',x,y,{width:26,flip:d.id%2===0})]});
  }
  groups.sort((a,b)=>a.depth-b.depth||a.ordinal-b.ordinal);
  for(const group of groups) for(const command of group.commands) items.push({...command,groupKind:group.kind,depth:group.depth});
  return immutableCopy({items,counts:groups.reduce((out,g)=>(out[g.kind]=(out[g.kind]||0)+1,out),{}),groups:groups.length});
}
export function splitGround(G, createCanvas = ()=>document.createElement('canvas'), chunkSize=512) {
  const source=G._gcv,assets=new Map(),items=[],gutter=2;
  for(let y=0;y<source.height;y+=chunkSize) for(let x=0;x<source.width;x+=chunkSize) {
    const width=Math.min(chunkSize,source.width-x),height=Math.min(chunkSize,source.height-y),cv=createCanvas();
    cv.width=width+gutter*2;cv.height=height+gutter*2;
    // Neighbouring source pixels supply bilinear sampling beyond the frame.
    cv.getContext('2d').drawImage(source,-x+gutter,-y+gutter);
    const asset=`ground:${x}:${y}`; assets.set(asset,cv);
    const sx=x/G.groundScale-G.groundOX,sy=y/G.groundScale-G.groundOY,sw=width/G.groundScale,sh=height/G.groundScale;
    items.push({kind:'sprite',groupKind:'ground',asset,x:sx,y:sy,width:sw,height:sh,crop:[gutter,gutter,width,height],bounds:{x0:sx,x1:sx+sw,y0:sy,y1:sy+sh},triangles:2});
  }
  return {assets,items:immutableCopy(items),pixels:[...assets.values()].reduce((n,a)=>n+a.width*a.height,0)};
}
export function countVisible(items,cam) {
  const counts={commands:0,triangles:0,sprites:0,polygons:0,byLayer:{}};
  for(const item of items) if(visible(item,cam)) {
    counts.commands++; counts.triangles+=item.triangles;
    counts[item.kind==='sprite'?'sprites':'polygons']++;
    counts.byLayer[item.groupKind]=(counts.byLayer[item.groupKind]||0)+1;
  }
  return counts;
}
export function stats(values) {
  if(!values.length)return {count:0};
  const a=[...values].sort((a,b)=>a-b),pick=p=>a[Math.min(a.length-1,Math.ceil(a.length*p)-1)];
  return {count:a.length,median:pick(.5),p95:pick(.95),min:a[0],max:a.at(-1),mean:a.reduce((s,x)=>s+x,0)/a.length};
}
