'use strict';
// Technical runtime export only; the source edit was made with built-in image_gen.
const fs=require('node:fs'),path=require('node:path');const {createCanvas,loadImage}=require('@napi-rs/canvas');
const root=path.resolve(__dirname,'..');
(async()=>{const im=await loadImage(path.join(root,'docs/art-assets/blacksmith-state/idle-source.png'));const c=createCanvas(512,469);c.getContext('2d').drawImage(im,0,0,512,469);fs.writeFileSync(path.join(root,'assets/a-style/blacksmith-a-idle.png'),c.toBuffer('image/png'));})();
