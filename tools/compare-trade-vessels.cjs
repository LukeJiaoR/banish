'use strict';
// Compose existing actual Canvas outputs without changing either source image.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createCanvas,loadImage}=require('@napi-rs/canvas');
const [before,after,out]=process.argv.slice(2);if(!out)throw Error('before after output paths required');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const a=JSON.parse(fs.readFileSync(path.join(before,'render-report.json'))),b=JSON.parse(fs.readFileSync(path.join(after,'render-report.json')));assert.deepEqual(a,b,'same camera, phase, day and pose required');const results=[];
 for(const name of [...a.cases.map(x=>x.filename),'directions-bridge.png']){
  const old=await loadImage(path.join(before,name)),now=await loadImage(path.join(after,name));assert.equal(old.width,now.width);assert.equal(old.height,now.height);
  const read=im=>{const c=createCanvas(im.width,im.height),x=c.getContext('2d');x.drawImage(im,0,0);return x.getImageData(0,0,im.width,im.height).data;},p=read(old),q=read(now);let count=0,x0=old.width,y0=old.height,x1=0,y1=0;
  for(let i=0;i<p.length;i+=4)if(p[i]!==q[i]||p[i+1]!==q[i+1]||p[i+2]!==q[i+2]||p[i+3]!==q[i+3]){const x=i/4%old.width,y=Math.floor(i/4/old.width);count++;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
  assert(count>0);if(name!=='directions-bridge.png')assert(x0>=old.width/2-100&&x1<=old.width/2+100&&y0>=old.height/2-70&&y1<=old.height/2+70,'pixels changed outside central +/-100px x +/-70px comparison region');
  const c=createCanvas(old.width*2,old.height+30),x=c.getContext('2d');x.fillStyle='#f4efdd';x.fillRect(0,0,c.width,c.height);x.fillStyle='#244b44';x.font='16px sans-serif';x.fillText('BEFORE — flat hull / canopy',12,21);x.fillText('AFTER — hull boards / curved canopy',old.width+12,21);x.drawImage(old,0,30);x.drawImage(now,old.width,30);fs.writeFileSync(path.join(out,name),c.toBuffer('image/png'));results.push({name,changedPixels:count,bounds:[x0,y0,x1,y1],outsideComparisonRegionUnchanged:name!=='directions-bridge.png'});
 }
 fs.writeFileSync(path.join(out,'comparison.json'),JSON.stringify(results,null,2)+'\n');console.log('7 same-view comparisons; all 6 scenes byte-identical outside central +/-100px x +/-70px region');
})().catch(e=>{console.error(e);process.exitCode=1;});
