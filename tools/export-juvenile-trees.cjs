'use strict';
// Lossless PNG packaging of original alpha; SOURCE_ROOT contains the eight named originals.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createCanvas,loadImage}=require('@napi-rs/canvas');
const manifest=require('../docs/art-assets/juvenile-trees.json');
const [source,out]=process.argv.slice(2);if(!source||!out)throw Error('Usage: node tools/export-juvenile-trees.cjs SOURCE_ROOT OUTPUT_ROOT');
(async()=>{for(const a of manifest.assets){const src=path.join(source,a.name+'.png'),dest=path.join(out,'assets/a-style',a.name+'.png');if(path.resolve(src)===path.resolve(dest))throw Error('Do not overwrite original');const data=fs.readFileSync(src);if(crypto.createHash('sha256').update(data).digest('hex')!==a.sourceSha256)throw Error('Unexpected source '+a.name);const im=await loadImage(src);if(im.width!==1254||im.height!==1254)throw Error('Invalid dimensions');const cv=createCanvas(384,384);cv.getContext('2d').drawImage(im,0,0,384,384);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,cv.toBuffer('image/png'));}console.log('8 original alpha PNGs exported to 384x384');})().catch(e=>{console.error(e);process.exitCode=1;});
