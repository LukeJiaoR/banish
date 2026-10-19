'use strict';
const assert=require('node:assert'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p));
for(const [runtime,candidate]of [['meadow_summer','meadow-summer'],['water_open','water-open']]){
 const bytes=read(`assets/terrain-v2/${runtime}.png`);
 assert(bytes.equals(read(`docs/art-assets/candidates/issue-87/${candidate}-candidate-v2.png`)),'Runtime must use reviewed v2 pixels exactly');
 assert(!bytes.equals(read(`docs/art-assets/candidates/issue-87/${candidate}-baseline.png`)),'Adoption must actually replace baseline');
 assert.equal(bytes.readUInt32BE(16),512);assert.equal(bytes.readUInt32BE(20),512);
}
for(const [name,sha]of [['mountain_rock','89c9eb686d133893107e6759b0f1d1b8ec3259009b8bb7e74fe785620ebe366e'],['mountain_rock_snow','aca76cb93616e3034458fb5d86734056bcd313aa45259d139b6bffd3fa94c718']])assert.equal(crypto.createHash('sha256').update(read(`assets/tiles/${name}.png`)).digest('hex'),sha);
const report=JSON.parse(read('docs/art-assets/warm-scene/report.json'));assert.equal(report.cases.length,36);assert(report.cases.every(c=>c.gameplayUnchanged));
console.log('Warm-scene assets: exact v2 adoption, 512px format, unchanged mountain materials, 36 recorded offline cases.');
