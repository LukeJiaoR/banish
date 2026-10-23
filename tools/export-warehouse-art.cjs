'use strict';
// Uniform alpha-preserving runtime export; never overwrite the original source.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createCanvas,loadImage}=require('@napi-rs/canvas');
const [src,out]=process.argv.slice(2);if(!src||!out)throw Error('Usage: node tools/export-warehouse-art.cjs SOURCE_PNG OUTPUT_PNG');
(async()=>{if(path.resolve(src)===path.resolve(out))throw Error('Keep source intact');const data=fs.readFileSync(src),im=await loadImage(src);if(im.width!==1254||im.height!==1254)throw Error('Expected original 1254 square');const cv=createCanvas(768,768);cv.getContext('2d').drawImage(im,0,0,768,768);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,cv.toBuffer('image/png'));console.log(JSON.stringify({sourceSha256:crypto.createHash('sha256').update(data).digest('hex'),runtimeSha256:crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex')}));})().catch(e=>{console.error(e);process.exitCode=1});
