'use strict';
// Preserve original transparent canvas and aspect; only uniform runtime scaling.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createCanvas,loadImage}=require('@napi-rs/canvas');
const [src,out]=process.argv.slice(2);
(async()=>{if(!src||!out||path.resolve(src)===path.resolve(out))throw Error('Provide distinct source/output PNG paths');const data=fs.readFileSync(src),im=await loadImage(src);if(im.width!==1394||im.height!==1128)throw Error('Expected original 1394x1128');const scale=256/im.width,cv=createCanvas(256,Math.ceil(im.height*scale));cv.getContext('2d').drawImage(im,0,0,im.width*scale,im.height*scale);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,cv.toBuffer('image/png'));console.log(JSON.stringify({sourceSha256:crypto.createHash('sha256').update(data).digest('hex'),runtimeSha256:crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex')}));})().catch(e=>{console.error(e);process.exitCode=1});
