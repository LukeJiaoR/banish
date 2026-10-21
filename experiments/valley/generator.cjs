'use strict';
// Experimental, offline-only generation. Not registered in genWorld/newGame/save.
module.exports = function generateValley(G, seed, N = 128) {
  if (!Number.isSafeInteger(seed) || seed < -2147483648 || seed > 4294967295) throw Error('Invalid seed');
  if (![128,192,384].includes(N)) throw Error('Unsupported prototype size');
  const w = G.emptyWorld(seed, -1, N), size=N*N;
  const noise=(salt,x,y)=>{const a=Math.floor(x),b=Math.floor(y),u=x-a,v=y-b,s=u*u*(3-2*u),t=v*v*(3-2*v);return G.lerp(G.lerp(G.h2(seed+salt,a,b),G.h2(seed+salt,a+1,b),s),G.lerp(G.h2(seed+salt,a,b+1),G.h2(seed+salt,a+1,b+1),s),t);};
  const phase=G.h2(seed,71,19)*Math.PI*2;
  const riverX=y=>N*(.48+.12*Math.sin(y/N*5.1+phase)+.045*Math.sin(y/N*12.7+phase*.7));
  const joinY=N*(.34+.25*G.h2(seed,21,99));
  const riverWidth=y=>2.2+N*.011+1.1*Math.sin(y/N*9+phase)**2;
  const elevation=new Float32Array(size),moisture=new Float32Array(size),distance=new Float32Array(size);
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    const i=y*N+x,main=Math.abs(x-riverX(y));
    // Continuous side tributary joins the main river, not a rectangular pond.
    const end=riverX(joinY), t=Math.max(0,Math.min(1,x/end));
    const branchY=joinY+Math.sin(t*Math.PI)*N*.11;
    const tributary=x<=end?Math.abs(y-branchY):Infinity;
    const d=Math.min(main-riverWidth(y),tributary-(1.4+1.3*t));distance[i]=d;
    const hills=noise(1701,x/(N*.24),y/(N*.27));
    const ridge=Math.abs(Math.sin(y/N*6.4+x/N*2.2+phase));
    const h=Math.max(0,main/N-.10)*1.9+hills*.22+ridge*.07;
    elevation[i]=h;moisture[i]=Math.max(0,1-Math.max(0,d)/(N*.22));
    if(d<=0)w.water[i]=1;
    else if(d<.9+noise(531,x/12,y/12)*1.2)w.water[i]=2;
    else if(h>.47+noise(291,x/17,y/17)*.08)w.mountain[i]=1;
  }
  // Forest follows moisture and foothills, with clearings at a coarser scale.
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    const i=y*N+x;if(w.water[i]||w.mountain[i])continue;
    const cluster=noise(777,x/13,y/13),density=.18+moisture[i]*.30+elevation[i]*.30;
    if(cluster>.40&&G.h2(seed+13,x,y)<density)G.addTree(w,x,y,-120-(G.h2(seed+29,x,y)*300|0));
    if(w.treeIdx[i]<0&&elevation[i]>.22&&noise(555,x/9,y/9)>.66&&G.h2(seed+977,x,y)<.30)w.rock[i]=noise(888,x/7,y/7)>.62?2:1;
  }
  const land=(x,y)=>x>=0&&y>=0&&x<N&&y<N&&!w.water[y*N+x]&&!w.mountain[y*N+x];
  const square=(x,y,r)=>{for(let yy=y-r;yy<=y+r;yy++)for(let xx=x-r;xx<=x+r;xx++)if(!land(xx,yy))return false;return true;};
  // Select a naturally open bank. Never flatten terrain or move the river.
  const choices=[];
  for(let y=16;y<N-16;y+=2)for(let x=16;x<N-16;x+=2){
    const d=distance[y*N+x];if(d<6||d>16||!square(x,y,3))continue;
    let clear=0,trees=0;for(let yy=y-9;yy<=y+9;yy++)for(let xx=x-9;xx<=x+9;xx++)if(land(xx,yy)){clear++;if(w.treeIdx[yy*N+xx]>=0)trees++;}
    choices.push({x,y,score:clear+Math.min(trees,60)*.5-Math.hypot(x-N/2,y-N/2)*.12+G.h2(seed+91,x,y)});
  }
  choices.sort((a,b)=>b.score-a.score||a.y-b.y||a.x-b.x);
  if(!choices.length)throw Error('No natural starting bank');
  w.start={x:choices[0].x,y:choices[0].y};const s=w.start;
  const terrainBefore=Buffer.from([...w.water,...w.mountain]);
  // Reserve only a 3x3 cart footprint; model its solid occupancy in the proof.
  const reserved=new Set();for(let y=s.y-1;y<=s.y+1;y++)for(let x=s.x-1;x<=s.x+1;x++)reserved.add(y*N+x);
  const reached=new Uint8Array(size),steps=new Int32Array(size).fill(-1),queue=[(s.y+2)*N+s.x];reached[queue[0]]=1;steps[queue[0]]=0;
  for(let at=0;at<queue.length;at++){const i=queue[at],x=i%N,y=Math.floor(i/N);for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,ny=y+dy,j=ny*N+nx;if(nx<0||ny<0||nx>=N||ny>=N||w.water[j]===1||w.mountain[j]||reached[j]||reserved.has(j))continue;reached[j]=1;steps[j]=steps[i]+1;queue.push(j);}}
  const nearby=queue.filter(i=>steps[i]<=24&&steps[i]>=6&&!w.water[i]).sort((a,b)=>steps[a]-steps[b]||G.h2(seed+441,a%N,Math.floor(a/N))-G.h2(seed+441,b%N,Math.floor(b/N))||a-b);
  let removedTrees=0,removedRocks=0;for(const i of reserved){if(w.treeIdx[i]>=0){G.removeTree(w,i%N,Math.floor(i/N));removedTrees++;}if(w.rock[i]){w.rock[i]=0;removedRocks++;}}
  const additions=[];
  // Bounded local resources are physical deposits; no free inventory or terrain edits.
  for(const kind of [1,2]){let count=nearby.filter(i=>w.rock[i]===kind).length;for(const i of nearby){if(count>=3)break;if(w.rock[i]||w.treeIdx[i]>=0)continue;w.rock[i]=kind;count++;additions.push({kind,i});}if(count<3)throw Error('Insufficient reachable mineral sites');}
  let mature=nearby.filter(i=>w.treeIdx[i]>=0&&w.trees[w.treeIdx[i]].b<=-G.TREE_MATURE).length;
  for(const i of nearby){if(mature>=32)break;if(w.rock[i]||w.treeIdx[i]>=0)continue;G.addTree(w,i%N,Math.floor(i/N),-G.TREE_MATURE-1);mature++;additions.push({kind:'tree',i});}
  if(mature<32)throw Error('Insufficient reachable forest');
  if(!terrainBefore.equals(Buffer.from([...w.water,...w.mountain])))throw Error('Spawn repair changed terrain');
  const shoreline=queue.filter(i=>steps[i]<=24&&[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>{const x=i%N+dx,y=Math.floor(i/N)+dy;return x>=0&&y>=0&&x<N&&y<N&&w.water[y*N+x]===1;}));
  if(!shoreline.length)throw Error('No reachable riverbank');
  return {world:w,elevation,moisture,distance,proof:{reachable:queue.length,nearby:nearby.length,matureTrees:mature,stone:nearby.filter(i=>w.rock[i]===1).length,iron:nearby.filter(i=>w.rock[i]===2).length,shoreApproaches:shoreline.length,shoreTarget:shoreline[0],removedTrees,removedRocks,additions,terrainEdits:0,cartCells:[...reserved],resourceTargets:{stone:nearby.filter(i=>w.rock[i]===1).slice(0,3),iron:nearby.filter(i=>w.rock[i]===2).slice(0,3)},scope:'offline experiment; three deposits each and 32 mature trees, not a first-winter economy proof'}};
};
