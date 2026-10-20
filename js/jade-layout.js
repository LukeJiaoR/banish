'use strict';
/* A single build tray, compact HUD and expandable coach. Existing game controls
   are moved, never cloned: their authority, event handlers and focus survive. */
// Register before DOMContentLoaded installs the existing menu Escape handlers.
window.addEventListener('keydown', e => {
  const hud=document.getElementById('hud'), chip=document.getElementById('jade-guide-chip');
  if(e.key!=='Escape'||e.repeat||G.hasOpenModal?.()||G.isEditingTarget?.(e.target))return;
  if(chip&&hud?.classList.contains('jade-guide-open')) {
    hud.classList.remove('jade-guide-open');chip.setAttribute('aria-expanded','false');chip.focus();
  } else if(G.ui?._resourceExpanded) {
    G.ui.setResourceExpanded(false);document.getElementById('resource-more')?.focus();
  } else return;
  e.preventDefault();e.stopImmediatePropagation();
}, true);
window.addEventListener('DOMContentLoaded', () => {
  const ui=G.ui, $=id=>document.getElementById(id), hud=$('hud'), toolbar=$('toolbar');
  // Primary stocks stay in the strip; all other real nodes remain in More.
  ui.hudVisibleResources=()=>['food','wood','stone'];
  for(const key of ['iron','tools','firewood'])$('secondary-resources').prepend($('res-'+key));
  const populationDetail=document.createElement('p');populationDetail.id='jade-population-detail';populationDetail.setAttribute('aria-label','人口与健康明细');$('secondary-resources').append(populationDetail);
  const status=document.createElement('div'); status.id='jade-status';
  status.append($('date'),$('pop')); $('topbar').append(status,$('resource-more'));
  const head=document.createElement('div'); head.id='jade-build-header';
  const art=document.createElement('button'); art.type='button';art.id='jade-build-art';art.title='返回建筑分类';art.setAttribute('aria-label','返回建筑分类');art.addEventListener('click',()=>{if(!G.hasOpenModal?.())ui.backToCategories();});
  const copy=document.createElement('div'); copy.id='jade-build-copy';
  const title=document.createElement('span'); title.id='jade-build-title';
  const hint=document.createElement('small');hint.id='jade-build-hint';
  const actions=document.createElement('div'); actions.id='jade-build-actions';
  actions.append($('toolbar-cancel'),$('close-build')); const nameRow=document.createElement('div');nameRow.id='jade-build-name';nameRow.append(title,hint);copy.append(nameRow,$('placement-panel')); head.append(art,copy,actions); toolbar.prepend(head);
  const originals={refreshToolbarNavigation:ui.refreshToolbarNavigation,refreshHUD:ui.refreshHUD};
  const buildings=new Set(['house','stonehouse','boarding','storage','stockpile','market','well','gatherer','hunting','dock','forester','woodcutter','stonequarry','mine','blacksmith','tailor','tavern','school','herbalist','hospital','chapel','tradingpost','townhall','pasture','orchard']);
  const paths=type=>buildings.has(type)?`assets/buildings/${type}.png`:null;
  const crops={stockpile:[29,68,260,126,320,224],market:[9,30,416,288,448,320],well:[70,60,180,194,320,256],stonequarry:[32,63,384,257,448,320],herbalist:[26,65,268,191,320,256],hospital:[24,35,401,285,448,320],tavern:[15,21,418,299,448,320],tradingpost:[25,33,402,324,448,360],townhall:[14,17,421,335,448,352]};
  function artwork(type) {
    if(crops[type]){const [x,y,w,h,iw,ih]=crops[type];return `<svg class="jade-thumbnail" viewBox="${x} ${y} ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><image href="${paths(type)}" width="${iw}" height="${ih}"/></svg>`;}
    if(type==='farm')return `<span class="jade-field-art" aria-hidden="true">${[0,1,2,3].map(i=>`<img src="assets/props/crop_ripe.png" alt="" class="crop-${i}">`).join('')}</span>`;
    if(type==='bridge')return '<img src="assets/bridges/bridge_x.png" alt="">';
    return paths(type)?`<img src="${paths(type)}" alt="" onerror="this.remove()">`:ui.icon(type);
  }
  // Real building silhouettes replace tiny inventory-style tool icons only here.
  for(const button of toolbar.querySelectorAll('[data-tool]')) {
    const type=button.dataset.tool;
    button.setAttribute('aria-label',button.querySelector('.lb')?.textContent||G.BDEF[type]?.name||type);
    if(paths(type)||['farm','bridge'].includes(type))button.querySelector('.ic').innerHTML=artwork(type);
  }
  const categoryArt={homes:'house',food:'gatherer',industry:'woodcutter',services:'storage',land:'stockpile'};
  for(const button of toolbar.querySelectorAll('[data-category]')) {
    const type=categoryArt[button.dataset.category]; if(type)button.querySelector('.ic').innerHTML=artwork(type);
  }
  let previousArt='';
  function syncTray(){
    const type=G.tool&&(G.tool.kind==='build'?G.tool.type:G.tool.kind==='road'?(G.tool.surface==='stone'?'stoneroad':G.tool.surface==='bridge'?'bridge':G.tool.surface==='tunnel'?'tunnel':'road'):G.tool.kind);
    const group=ui.toolGroups.find(g=>g.id===ui.menuCategory);
    const picture=type||categoryArt[group?.id]||'house';
    if(previousArt!==picture){art.innerHTML=artwork(picture);previousArt=picture;}
    const name=type?(G.BDEF[type]?.name||({fell:'砍伐',quarry:'采石采铁',demolish:'拆除'}[type]||'道路规划')):group?.name||'建造小镇';
    title.textContent=name;hint.textContent=G.tool?.kind==='build'?'点地图建造':type?'地图选取':'选择一项';
    $('toolbar-cancel').textContent='取消'; $('close-build').textContent='收起';
    // Navigation owns close.hidden; use CSS for the mutually-exclusive action.
    hud.classList.toggle('jade-has-tool',!!type);
    head.dataset.selected=type||'';
    head.dataset.planning=String(!!type && (G.tool.kind!=='build'||type==='cemetery'));
    for(const b of toolbar.querySelectorAll('[data-tool]'))b.title=b.getAttribute('title')||G.BDEF[b.dataset.tool]?.name||b.dataset.tool;
  }
  ui.refreshToolbarNavigation=function(...args){const result=originals.refreshToolbarNavigation.apply(this,args);syncTray();return result;};
  const chip=document.createElement('button');chip.type='button';chip.id='jade-guide-chip';chip.setAttribute('aria-controls','survival-guide');chip.setAttribute('aria-expanded','false');
  hud.append(chip);
  chip.addEventListener('click',()=>{if(G.hasOpenModal?.())return;const open=hud.classList.toggle('jade-guide-open');chip.setAttribute('aria-expanded',String(open));});
  function syncGuide(){
    const urgent=$('guide-list').querySelector('[data-level="urgent"]');
    const coach=!$('dynamic-coach').hidden?$('coach-text').textContent:'';
    const first=$('guide-list').querySelector('li');
    const text=urgent?.querySelector('.guide-text')?.textContent||coach||first?.querySelector('.guide-text')?.textContent||'查看生存清单';
    chip.textContent=`${urgent?'!':'▤'}  ${text}  ›`; chip.title=text+'；展开全部提醒与引导';chip.classList.toggle('is-urgent',!!urgent);
    const count=$('guide-count');if(count&&!count.hidden)chip.setAttribute('aria-label',text+'，'+count.textContent+'，展开全部提醒');else chip.setAttribute('aria-label',text+'，展开生存清单');
  }
  ui.refreshHUD=function(...args){const result=originals.refreshHUD.apply(this,args);syncGuide();populationDetail.textContent='人口与健康 · '+$('pop').textContent;return result;};
  syncTray();syncGuide();populationDetail.textContent='人口与健康 · '+$('pop').textContent;
});
