'use strict';
/* ============================================================
 * 《放逐小镇》—— Banished 风格城市建造复刻原型
 * core.js —— 全局命名空间、常量、工具函数
 * ============================================================ */
window.G = {};

/* ---------- 常量 ---------- */
G.TILE_W = 64;            // 等距菱形瓦片宽（缩放 1 时的像素）
G.TILE_H = 32;
G.MAP = 76;               // 地图边长（格）
G.DAY_H = 24;             // 一天 = 24 游戏小时
G.HOURS_PER_SEC = 2.0;    // 1x 速度：每真实秒 = 2 游戏小时
G.SEASON_DAYS = 12;       // 每季天数
G.YEAR_DAYS = 48;         // 一年天数（4 季）
G.SEASON_NAMES = ['春', '夏', '秋', '冬'];
G.SEASON_ICONS = ['🌸', '☀️', '🍂', '❄️'];

G.ADULT_AGE = 10;         // 年满可工作（同 Banished：孩子 10 岁开始干活或入学）
G.MOTHER_MIN = 15;
G.MOTHER_MAX = 45;
G.OLD_AGE = 70;           // 自然死亡概率开始上升（原版多在 70~85 岁去世）

/* 资源（数值对齐原版 Banished） */
G.RES = {
  wood:     { name: '木材', color: '#b08850', icon: '🪵' },
  stone:    { name: '石头', color: '#b8b8b8', icon: '🪨' },
  iron:     { name: '铁', color: '#c08a5a', icon: '🔩' },
  food:     { name: '食物', color: '#e0705a', icon: '🍖' },
  firewood: { name: '柴火', color: '#e8a33d', icon: '🔥' },
};
G.RES_KEYS = ['wood', 'stone', 'iron', 'food', 'firewood'];

/* ---------- 随机数 ---------- */
// 可播种 RNG（地形生成用）
G.makeRng = function (seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
G.rng = G.makeRng((Date.now() & 0xffffffff) ^ 0x9e3779b9); // 游戏逻辑随机流
G.ri = function (min, max) { return min + Math.floor(G.rng() * (max - min + 1)); };
G.chance = function (p) { return G.rng() < p; };
G.pick = function (arr) { return arr[Math.floor(G.rng() * arr.length)]; };

/* 存档键：手动存档 + 自动存档（换季/离开页面时写入，启动时自动恢复） */
G.SAVE_KEY = 'banish_save_v1';
G.AUTOSAVE_KEY = 'banish_autosave_v1';

// 稳定的坐标哈希（纹理抖动用，不消耗随机流）
G.h2 = function (seed, x, y) {
  let n = (x | 0) * 374761393 + (y | 0) * 668265263 + (seed | 0) * 1442695041;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};

/* ---------- 数学 / 通用 ---------- */
G.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
G.lerp = function (a, b, t) { return a + (b - a) * t; };
G.dist = function (x0, y0, x1, y1) { return Math.hypot(x1 - x0, y1 - y0); };
G.d2 = function (x0, y0, x1, y1) { const dx = x1 - x0, dy = y1 - y0; return dx * dx + dy * dy; };

let _uid = 1;
G.nextId = function () { return _uid++; };
G.setUid = function (v) { _uid = v; };

/* ---------- 市民姓名 ---------- */
G.NAMES = {
  s: '赵钱孙李周吴郑王冯陈沈韩杨朱秦许何吕张孔曹严金魏陶姜林苏叶高罗',
  m: '松岩川阳禾舟木谷峰溪青云山原野柏',
  f: '穗桃杏兰梅竹薇露月雪晴初苇棠',
};
G.citizenName = function (sex) {
  const s = G.NAMES.s[G.ri(0, G.NAMES.s.length - 1)];
  const pool = sex === 'm' ? G.NAMES.m : G.NAMES.f;
  return s + pool[G.ri(0, pool.length - 1)];
};
