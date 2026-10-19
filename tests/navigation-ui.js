/* Mode transitions with a minimal DOM, not browser/visual acceptance. */
'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const nodes=new Map(),listeners={};
function node(id){ if(nodes.has(id))return nodes.get(id);const classes=new Set();const n={id,hidden:false,dataset:{},attrs:{},children:[],handlers:{},textContent:'',classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(x,on){on?classes.add(x):classes.delete(x)}},setAttribute(k,v){this.attrs[k]=v},getAttribute(k){return this.attrs[k]},append(...children){this.children.push(...children)},addEventListener(k,f){this.handlers[k]=f},click(){this.handlers.click?.()},focus(){document.activeElement=this},contains(x){return x===this||this.children.includes(x)},querySelector(s){return node(s==='.town-controls-body'?'town-body':s==='[data-category]'?'category':'first-button')}};nodes.set(id,n);return n}
const document={getElementById:node,createElement:()=>node('label'+nodes.size),querySelectorAll:()=>[],activeElement:null};
const G={game:{paused:false},tool:null,sel:null,hasOpenModal:()=>false,isEditingTarget:()=>false};
G.ui={el:{info:node('info')},menuCategory:null,showInfo(){node('info').classList.remove('hidden')},hideInfo(){G.sel=null;node('info').classList.add('hidden')},setToolActive(){},refreshHUD(){},backToCategories(){this.menuCategory=null}};
G.setTool=t=>{G.tool=t?{kind:'build',type:t}:null;G.ui.setToolActive()};
const window={addEventListener(k,f){(listeners[k]??=[]).push(f)}};
node('town-controls').hidden=true;
vm.runInNewContext(fs.readFileSync('js/navigation.js','utf8'),{window,document,G});
listeners.DOMContentLoaded[0]();
const mode=()=>node('hud').dataset.mode;
assert.equal(mode(),'explore');assert(node('toolbar').hidden);assert(!node('town-dock').hidden);
node('open-build').click();assert.equal(mode(),'build');assert(!node('toolbar').hidden);assert.equal(document.activeElement.id,'category');
G.setTool('pasture');assert.equal(mode(),'build');assert.equal(G.tool.type,'pasture');
node('close-build').click();assert.equal(G.tool,null);assert.equal(mode(),'explore');assert.equal(document.activeElement.id,'open-build');
node('open-town').click();assert(!node('town-controls').hidden);assert.equal(node('open-town').attrs['aria-expanded'],'true');
node('open-build').click();assert(node('town-controls').hidden);
G.sel={kind:'b',id:7};G.ui.showInfo();assert.equal(mode(),'detail');assert(node('toolbar').hidden);assert(node('town-dock').hidden);assert.equal(G.tool,null);assert.equal(G.sel.id,7);
node('info').focus();G.ui.hideInfo();assert.equal(mode(),'explore');assert.equal(document.activeElement.id,'open-build');
node('quick-pause').click();assert.equal(G.game.paused,true);assert.equal(node('quick-pause').textContent,'▶ 继续');
G.hasOpenModal=()=>true;node('open-build').click();assert.equal(mode(),'explore');node('quick-pause').click();assert.equal(G.game.paused,true);G.hasOpenModal=()=>false;
G.ui.menuCategory='homes';node('open-build').click();assert.equal(G.ui.menuCategory,null);let stopped=false;listeners.keydown[0]({key:'Escape',repeat:false,preventDefault(){},stopImmediatePropagation(){stopped=true}});assert.equal(mode(),'explore');assert(stopped);
node('open-town').click();listeners.keydown[0]({key:'Escape',repeat:false,preventDefault(){},stopImmediatePropagation(){}});assert(node('town-controls').hidden);assert.equal(document.activeElement.id,'open-town');
console.log('Navigation: 10 transition groups passed (minimal DOM; browser checks separate).');
