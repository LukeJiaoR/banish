'use strict';
/* A single build tray, compact HUD and expandable coach. Existing game controls
   are moved, never cloned: their authority, event handlers and focus survive. */
// Register before DOMContentLoaded installs the existing menu Escape handlers.
window.addEventListener('keydown', e => {
  const hud=document.getElementById('hud'), chip=document.getElementById('jade-guide-chip');
  if(e.key!=='Escape'||e.repeat||G.hasOpenModal?.()||G.isEditingTarget?.(e.target))return;
  if(chip&&hud?.classList.contains('jade-guide-open')) {
    hud.classList.remove('jade-guide-open');chip.setAttribute('aria-expanded','false');chip.focus();
  } else if(document.getElementById('jade-build-header')?.classList.contains('jade-details-open')) {
    document.getElementById('jade-build-header').classList.remove('jade-details-open');const title=document.getElementById('jade-build-title');title.setAttribute('aria-expanded','false');title.focus();
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
  const title=document.createElement('button'); title.type='button';title.id='jade-build-title';title.setAttribute('aria-expanded','false');title.setAttribute('aria-controls','placement-panel');title.addEventListener('click',()=>{if(G.hasOpenModal?.())return;const open=head.classList.toggle('jade-details-open');title.setAttribute('aria-expanded',String(open));});
  const titleLabel=document.createElement('span');title.append(titleLabel);
  const hint=document.createElement('small');hint.id='jade-build-hint';
  const actions=document.createElement('div'); actions.id='jade-build-actions';
  actions.append($('toolbar-cancel'),$('close-build')); const nameRow=document.createElement('div');nameRow.id='jade-build-name';nameRow.append(title,hint);copy.append(nameRow,$('placement-panel')); head.append(art,copy,actions); toolbar.prepend(head);
  const description=document.createElement('p');description.id='jade-build-description';$('placement-panel').append(description);
  const back=document.createElement('button');back.type='button';back.id='jade-back-categories';back.textContent='返回建筑分类';back.addEventListener('click',()=>{if(!G.hasOpenModal?.()){head.classList.remove('jade-details-open');title.setAttribute('aria-expanded','false');ui.backToCategories();}});$('placement-panel').append(back);
  const benefit=document.createElement('small');benefit.id='jade-build-benefit';title.append(benefit);
  const costs=document.createElement('div');costs.id='jade-build-costs';copy.append(costs);
  const confirm=document.createElement('button');confirm.id='jade-build-confirm';confirm.type='button';confirm.textContent='选择位置';actions.append(confirm);
  // Keep keyboard traversal in the same order as the visible workspace.
  toolbar.prepend(toolbar.querySelector('.toolbar-heading'));toolbar.append(actions);
  let confirmIntent;let confirmArmed=false,confirmKeyHeld=false,confirmKeyUsed=false;
  const arm=e=>{if(e.button!==undefined&&e.button!==0)return;confirmIntent=G.pendingBuildingPlacement;confirmArmed=true;if(e.type!=='keydown'){confirmKeyHeld=false;confirmKeyUsed=false;}};
  const disarm=()=>{if(confirmArmed){confirmIntent=null;confirmArmed=true;}};confirm.addEventListener('pointercancel',disarm);confirm.addEventListener('touchcancel',disarm);confirm.addEventListener('blur',disarm);window.addEventListener('blur',disarm);document.addEventListener('visibilitychange',()=>{if(document.hidden)disarm();});
  confirm.addEventListener('pointerdown',arm);confirm.addEventListener('mousedown',arm);
  confirm.addEventListener('keydown',e=>{if(!['Enter',' '].includes(e.key))return;if(e.repeat||confirmKeyHeld){e.preventDefault();return;}confirmKeyHeld=true;confirmKeyUsed=false;arm(e);});
  confirm.addEventListener('keyup',e=>{if(['Enter',' '].includes(e.key))confirmKeyHeld=false;});
  confirm.addEventListener('click',()=>{if(G.hasOpenModal?.()||(confirmKeyHeld&&confirmKeyUsed))return;if(confirmKeyHeld)confirmKeyUsed=true;const result=G.confirmBuildingPlacement?.(confirmArmed?confirmIntent:undefined);confirmIntent=undefined;confirmArmed=false;if(result?.reason)ui.toast(result.reason,'warn');syncSelection();});
  const originalIcon=ui.icon;
  ui.icon=function(name){return ['food','wood','stone','people'].includes(name)?`<span class="ui-icon" aria-hidden="true"><img src="assets/icons/jade/${name}.svg" alt=""></span>`:originalIcon.call(this,name);};
  for(const key of ['food','wood','stone']){const icon=$('res-'+key)?.querySelector('.res-icon');if(icon)icon.innerHTML=ui.icon(key);}
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
  let previousArt='',previousTool=null;
  function syncSelection(){
    const type=G.tool?.kind==='build'?G.tool.type:null,def=G.BDEF[type];
    const ordinary=!!G.isBuildingPlacementPlanning?.();
    description.textContent=def?.desc||'选择建筑分类，查看各项用途与建造消耗。';
    confirm.hidden=!ordinary;
    const status=ordinary?G.buildingPlacementStatus?.():null;
    confirm.disabled=!status?.ok;
    confirm.textContent=status?.pending?'确认建造':'选择位置';
    confirm.title=status?.reason||'确认在地图标记的位置建造';
    head.dataset.ordinary=String(ordinary);
    benefit.textContent=def?({house:'一家人的住所',stonehouse:'更温暖的家',boarding:'临时安置 5 户',storage:'全镇资源交货点',stockpile:'原料仓容 +250',well:'消防取水点',cemetery:'7–20格矩形 · 消耗按规划计算'}[type]||(def.jobs?'工作岗位 '+def.jobs: def.w+' × '+def.h+' 占地')):'选择建筑，规划小镇';
    if(status?.pending&&!status.ok){benefit.textContent=status.reason;benefit.classList.add('is-blocked');}else benefit.classList.remove('is-blocked');
    costs.innerHTML=def&&type!=='cemetery'?Object.entries(def.cost||{}).map(([key,qty])=>`<span class="jade-cost ${(G.game?.res[key]||0)<qty?'is-short':''}" aria-label="${G.RES[key].name} ${qty}${(G.game?.res[key]||0)<qty?'，库存不足':''}">${ui.resourceIcon(key)}<b>${qty}</b></span>`).join(''):'';
    costs.title=def&&type!=='cemetery'?'建造消耗，红色表示库存不足':'';
    if(ordinary)$('toolbar-state').textContent=status?.pending?(status.ok?'位置已选定，确认后建造':status.reason):'点击地图选择位置，再确认建造';
  }
  if(G.stageBuildingPlacement){const stage=G.stageBuildingPlacement;G.stageBuildingPlacement=function(...args){const result=stage.apply(this,args);syncSelection();return result;};}
  function syncTray(){
    if(previousTool!==G.tool){head.classList.remove('jade-details-open');title.setAttribute('aria-expanded','false');disarm();previousTool=G.tool;}
    const type=G.tool&&(G.tool.kind==='build'?G.tool.type:G.tool.kind==='road'?(G.tool.surface==='stone'?'stoneroad':G.tool.surface==='bridge'?'bridge':G.tool.surface==='tunnel'?'tunnel':'road'):G.tool.kind);
    const group=ui.toolGroups.find(g=>g.id===ui.menuCategory);
    const picture=type||categoryArt[group?.id]||'house';
    if(previousArt!==picture){art.innerHTML=artwork(picture);previousArt=picture;}
    const name=type?(G.BDEF[type]?.name||({fell:'砍伐',quarry:'采石采铁',demolish:'拆除'}[type]||'道路规划')):group?.name||'建造小镇';
    syncSelection();titleLabel.textContent=name;hint.textContent=G.tool?.kind==='build'?'点地图建造':type?'地图选取':'选择一项';
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
    chip.innerHTML='<img src="assets/icons/jade/book.svg" alt=""><span></span><b>›</b>';chip.querySelector('span').textContent=text; chip.title=text+'；展开全部提醒与引导';chip.classList.toggle('is-urgent',!!urgent);
    const count=$('guide-count');if(count&&!count.hidden)chip.setAttribute('aria-label',text+'，'+count.textContent+'，展开全部提醒');else chip.setAttribute('aria-label',text+'，展开生存清单');
  }
  ui.refreshHUD=function(...args){const result=originals.refreshHUD.apply(this,args);syncGuide();syncSelection();populationDetail.textContent=$('date').textContent+' · 人口与健康 · '+$('pop').textContent;return result;};
  syncTray();syncGuide();syncSelection();populationDetail.textContent=$('date').textContent+' · 人口与健康 · '+$('pop').textContent;
});
