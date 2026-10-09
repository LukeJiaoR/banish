'use strict';
/* ============================================================
 * sprites.js —— 精灵图加载（assets/ 由 tools/slice_assets.py 切图生成）
 * 全部异步加载、逐个可用；任何一张缺失/失败只记录名字，
 * 渲染层对每个精灵单独回退到原程序化绘制（render.js），游戏始终可玩。
 * ============================================================ */

G.SPR = {
  map: new Map(),
  failed: [],
  get: function (n) { return this.map.get(n) || null; },
};

/* 渲染尺寸（游戏像素）。h = 显示高、w = 显示宽，另一边按原图比例；
 * 建筑不在此表，由 render.js 按占地菱形宽度换算。 */
G.SPRITE_SIZES = {
  tree_sapling: { h: 16 }, tree_young: { h: 26 }, tree_mature: { h: 38 },
  tree_sapling_snow: { h: 16 }, tree_young_snow: { h: 26 }, tree_mature_snow: { h: 38 },
  rock_a: { w: 26 }, rock_b: { w: 24 }, rock_a_snow: { w: 26 }, rock_b_snow: { w: 24 },
  crop_stage0: { w: 40 }, crop_stage1: { w: 42 }, crop_stage2: { w: 44 },
  crop_ripe: { w: 46 }, crop_dead: { w: 42 },
  adult_walk_0: { h: 17 }, adult_walk_1: { h: 17 }, adult_walk_2: { h: 17 }, adult_walk_3: { h: 17 },
  adult_work_0: { h: 17 }, adult_work_1: { h: 17 },
  adult_carry_walk_0: { h: 17 }, adult_carry_walk_1: { h: 17 },
  adult_carry_walk_2: { h: 17 }, adult_carry_walk_3: { h: 17 },
  adult_idle: { h: 17 }, adult_carry_idle: { h: 17 },
  child_walk_0: { h: 12.5 }, child_walk_1: { h: 12.5 }, child_walk_2: { h: 12.5 }, child_walk_3: { h: 12.5 },
  child_idle: { h: 12.5 },
  carry_wood: { w: 10 }, carry_stone: { w: 10 }, carry_food: { w: 10 }, carry_firewood: { w: 10 },
  carry_iron: { w: 10 }, carry_tools: { w: 10 },
  alert: { h: 15 },
};

(function () {
  if (typeof Image === 'undefined') return; // node 测试环境：无渲染，保持回退路径
  const SHEET = {
    tiles: ['grass_spring', 'grass_summer', 'grass_autumn', 'grass_winter',
      'sand_spring', 'sand_summer', 'sand_autumn', 'sand_winter',
      'water_spring', 'water_summer', 'water_summer_b', 'water_autumn', 'water_winter',
      'road_spring', 'road_summer', 'road_autumn', 'road_winter', 'farm_soil', 'farm_soil_snow'],
    props: ['tree_sapling', 'tree_young', 'tree_mature',
      'tree_sapling_snow', 'tree_young_snow', 'tree_mature_snow',
      'rock_a', 'rock_b', 'rock_a_snow', 'rock_b_snow',
      'crop_stage0', 'crop_stage1', 'crop_stage2', 'crop_ripe', 'crop_dead'],
    buildings: ['house', 'stonehouse', 'boarding', 'storage', 'mine', 'gatherer',
      'forester', 'woodcutter', 'dock', 'school', 'blacksmith', 'hunting', 'site_2x2', 'site_3x3'],
    citizens: ['adult_walk_0', 'adult_walk_1', 'adult_walk_2', 'adult_walk_3',
      'adult_work_0', 'adult_work_1',
      'adult_carry_walk_0', 'adult_carry_walk_1', 'adult_carry_walk_2', 'adult_carry_walk_3',
      'adult_idle', 'adult_carry_idle',
      'child_walk_0', 'child_walk_1', 'child_walk_2', 'child_walk_3', 'child_idle',
      'carry_wood', 'carry_stone', 'carry_food', 'carry_firewood', 'carry_iron', 'carry_tools'],
    icons: ['res_wood', 'res_stone', 'res_food', 'res_firewood', 'res_iron', 'res_tools',
      'tool_stonehouse', 'tool_boarding', 'tool_mine', 'tool_blacksmith', 'tool_hunting',
      'tool_house', 'tool_storage', 'tool_gatherer', 'tool_forester', 'tool_woodcutter',
      'tool_dock', 'tool_school', 'tool_farm', 'tool_road', 'tool_demolish', 'alert'],
  };
  let pending = 0;
  for (const dir of Object.keys(SHEET))
    for (const n of SHEET[dir]) {
      pending++;
      const im = new Image();
      im.onload = () => {
        G.SPR.map.set(n, im);
        if (dir === 'tiles' || n === 'res_iron') G.needGround = true; // 地表纹理到位后重建地面缓存
        if (--pending === 0) G.SPR.ready = true;
      };
      im.onerror = () => {
        G.SPR.failed.push(n);
        if (--pending === 0) G.SPR.ready = true;
      };
      im.src = 'assets/' + dir + '/' + n + '.png';
    }
})();
