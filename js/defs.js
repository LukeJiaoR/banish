'use strict';
/* ============================================================
 * defs.js —— 建筑定义、产出参数、季节调色板
 * 所有经济数值对齐原版 Banished（未受教育工人基准）：
 *   每人每年吃 100 食物；1 棵树 = 2 原木；1 原木 = 3 柴火；
 *   木屋每年约烧 30 柴火；农田约 7 食物/格/年；
 *   采集约 300-500 食物/工人/年；护林约 30-50 原木/工人/年。
 * ============================================================ */

/* 建筑（w/h 为占地格数；cost 为建造消耗；buildWork 为建造所需工时（游戏小时））
 * jobs: 工作岗位数；passable: 建成后是否可通行
 * warmWoodPerYear: 每年取暖柴火（原版：木屋 ≈30，石屋省一半 ≈15）
 * isHome/chimney: 渲染用（窗户透光 / 烟囱炊烟） */
G.BDEF = {
  house: {
    id: 'house', name: '木屋', icon: '🏠', w: 2, h: 2,
    cost: { wood: 16, stone: 8 }, buildWork: 90, jobs: 0, passable: false,
    warmWoodPerYear: 30, isHome: true, chimney: true,
    wall: '#8a6242', wallD: '#6d4b32', roof: '#8f4433',
    desc: '原版成本 16木+8石。供一家人居住（原版每屋至多 8 人），每年约烧 30 柴火。没房子住的家庭冬天会冻死人。',
  },
  stonehouse: {
    id: 'stonehouse', name: '石屋', icon: '🏠', w: 2, h: 2,
    cost: { wood: 24, stone: 40, iron: 10 }, buildWork: 120, jobs: 0, passable: false,
    warmWoodPerYear: 15, isHome: true, chimney: true,
    wall: '#9a948a', wallD: '#736e64', roof: '#6d675c',
    desc: '原版成本 24木+40石+10铁。石墙更保暖，每年只烧约 15 柴火（木屋的一半），适合人口定居后的更新换代。',
  },
  boarding: {
    id: 'boarding', name: '宿舍', icon: '🛏️', w: 4, h: 3,
    cost: { wood: 100, stone: 45 }, buildWork: 160, jobs: 0, passable: false,
    warmWoodPerYear: 45, chimney: true,
    wall: '#7d705c', wallD: '#5f5445', roof: '#5a4f3e',
    desc: '原版 Boarding House 成本 100木+45石。最多容纳 5 个家庭的临时住所：市民不会主动入住，但没房子时会搬进来过冬，有空独栋木屋会再搬出。',
  },
  storage: {
    id: 'storage', name: '仓库', icon: '📦', w: 3, h: 3,
    cost: { wood: 48, stone: 16 }, buildWork: 110, jobs: 0, passable: false,
    wall: '#7c7466', wallD: '#5e574c', roof: '#5c5648',
    desc: '原版 Storage Barn 成本 48木+16石。存放全镇资源，工人把收获搬到最近的仓库。',
  },
  gatherer: {
    id: 'gatherer', name: '采集小屋', icon: '🧺', w: 2, h: 2,
    cost: { wood: 30, stone: 12 }, buildWork: 70, jobs: 4, passable: false,
    wall: '#7d6a48', wallD: '#615238', roof: '#5d7040',
    desc: '原版成本 30木+12石，4 名工人。在附近森林采集，约 300-500 食物/工人/年。必须靠近森林。',
  },
  forester: {
    id: 'forester', name: '护林小屋', icon: '🌲', w: 2, h: 2,
    cost: { wood: 32, stone: 12 }, buildWork: 70, jobs: 4, passable: false,
    wall: '#6b5a3e', wallD: '#54462f', roof: '#4a6b3a',
    desc: '原版成本 32木+12石，4 名工人。砍树取原木（未受教育 1 树=2 原木，受教育 3）并补种，约 30-50 原木/工人/年。面板可分别开关「砍伐」与「补种」：只种不砍可育林，只砍不种会清光森林。',
  },
  woodcutter: {
    id: 'woodcutter', name: '伐木屋', icon: '🪓', w: 2, h: 2,
    cost: { wood: 24, stone: 8 }, buildWork: 70, jobs: 1, passable: false,
    wall: '#75563c', wallD: '#5b4230', roof: '#7a5230',
    desc: '原版成本 24木+8石，1 名工人。把原木劈成柴火：1 原木 = 3 柴火（受教育 4）。工人自己去仓库背原木——建在仓库旁边效率更高。入冬前务必多储备。',
  },
  dock: {
    id: 'dock', name: '渔码头', icon: '🎣', w: 2, h: 2,
    cost: { wood: 30, stone: 16 }, buildWork: 90, jobs: 4, passable: false,
    wall: '#6f5b40', wallD: '#574732', roof: '#8a5a3a',
    desc: '原版成本 30木+16石，4 名工人，全年产约 350-500 食物/工人/年。必须紧邻水面。',
  },
  school: {
    id: 'school', name: '学堂', icon: '🏫', w: 3, h: 3,
    cost: { wood: 50, stone: 16, iron: 16 }, buildWork: 100, jobs: 1, passable: false,
    wall: '#7d6f52', wallD: '#615540', roof: '#4a5a6b',
    desc: '原版 School House 成本 50木+16石+16铁，1 名教师。孩子 10 岁入学、17 岁毕业，每所至多 20 名学生。毕业工人干活快 30%，砍树每棵多出 1 原木。教师离职/学堂拆除时在读学生会立即辍学成为工人。',
  },
  farm: {
    id: 'farm', name: '农田', icon: '🌾', w: 8, h: 8,
    cost: {}, buildWork: 12, jobs: 4, passable: true,
    wall: '#6b4f33', wallD: '#573f29', roof: '#6b4f33',
    desc: '原版免费。约 7 食物/格/年：春播秋收，8×8 满收约 448 食物。秋收不完会被冬天冻死。',
  },
  road: {
    id: 'road', name: '土路', icon: '🛣️', w: 1, h: 1,
    cost: {}, buildWork: 0, jobs: 0, passable: true, road: true,
    wall: '#8d7355', wallD: '#8d7355', roof: '#8d7355',
    desc: '原版土路免费。拖拽铺设，市民在路上走得更快。铺设会自动清掉沿途的树和岩石。',
  },
};

/* 工具栏顺序 */
G.TOOLBAR = ['house', 'stonehouse', 'boarding', 'storage', 'gatherer', 'forester', 'woodcutter', 'dock', 'school', 'farm', 'road', 'fell', 'demolish'];

/* 产出参数（workH: 每次工作小时数；目标对齐原版年产量） */
G.PROD = {
  gatherer:  { workH: 5, yield: { type: 'food', qty: 5 },  radius: 6, needTrees: 6 },
  forester:  { workH: 22, logsYield: 2, eduLogsYield: 3, plantH: 3, radius: 12 },
  woodcutter: { workH: 7, logsIn: 2, firewoodOut: 6, eduFirewoodPerLog: 4 },
  dock:      { workH: 5, yield: { type: 'food', qty: 4 } },
  farm:      { perTile: 7, tileWorkH: 0.5, growDays: 24 },
  builderChunk: 4,      // 建筑工人每段工作时长
};

/* 生存参数（原版基准） */
G.LIFE = {
  eatPerYear: 100,        // 每人每年吃 100 食物（原版）
  houseWarmWoodPerYear: 30, // 每栋有人住的木屋每年烧约 30 柴火（原版），冬季集中消耗；石屋 15、宿舍 45
  starveDays: 4,          // 连续挨饿几天死亡
  coldDays: 5,            // 受冻累积几天死亡
  homelessCold: 0.6,      // 无房者每天受冻增速
  coldChildMul: 1.5,      // 儿童受冻倍率
  birthChance: 0.008,     // 有房夫妇每天生育概率（约 2~3 年一胎，原版节奏）
  birthFoodDays: 4,       // 粮食储备需可支撑的天数，才允许生育
  pairEvery: 3,           // 每 N 天尝试为单身者组建家庭
  maxFamily: 8,           // 每个家庭人口上限（原版每栋住宅至多住 8 人）
  restFrom: 22,           // 休息开始时刻（小时）：市民回家睡觉
  restTo: 6,              // 休息结束时刻：天亮起床
  gradAge: 17,            // 学堂毕业年龄（原版 17 岁）
  schoolCap: 20,          // 每所学堂学生容量（原版 20）
  boardingCap: 5,         // 每栋宿舍可入住的家庭数（原版 5）
  eduWorkMul: 0.7,        // 受教育工人任务工时倍率（同产出更快，≈ 产出 +43%）
};
G.LIFE.eatPerDay = G.LIFE.eatPerYear / G.YEAR_DAYS; // ≈2.08 食物/人/天（生育门槛、饥饿警告用）

/* 树木生长（天数阈值；原版一棵树数年成材，本作约 2.5 年——配合护林圈可持续产量） */
G.TREE_YOUNG = 60;
G.TREE_MATURE = 120;
G.TREE_LOGS = 2;          // 1 棵树 = 2 原木（原版未受教育；受教育护林/散工砍出 3 原木）

/* 岩石：清理每格岩石获得石头/铁（原版地表岩石与铁矿是初期石头、铁的来源） */
G.ROCK_STONE = 10;
G.ROCK_IRON = 10;

/* ---------- 季节调色板 ---------- */
G.PAL = [
  { // 春
    bg: '#3f5c38', grass: '#74a85a', grassAlt: '#6da252', grassDark: '#639147',
    sand: '#cdbd8e', water: '#4d80ad', shore: '#7fa8cc', road: '#8d7355', roadAlt: '#836b4e',
    soil: '#6b4f33', snow: null, rock: '#9a9a94', rockD: '#6f6f6a', iron: '#b0856b', ironD: '#7d5a44',
  },
  { // 夏
    bg: '#3b5636', grass: '#6a9c4e', grassAlt: '#639147', grassDark: '#578240',
    sand: '#c9b988', water: '#4478a6', shore: '#7aa2c6', road: '#8a7052', roadAlt: '#80684b',
    soil: '#6b4f33', snow: null, rock: '#9a9a94', rockD: '#6f6f6a', iron: '#ac8165', ironD: '#79563f',
  },
  { // 秋
    bg: '#5c5138', grass: '#a09055', grassAlt: '#998850', grassDark: '#8d7c46',
    sand: '#c4b283', water: '#4a6f96', shore: '#7d99b8', road: '#8a7052', roadAlt: '#80684b',
    soil: '#6b4f33', snow: null, rock: '#98988f', rockD: '#6d6d66', iron: '#a87d62', ironD: '#75543e',
  },
  { // 冬
    bg: '#8fa0ac', grass: '#dfe4e8', grassAlt: '#d5dbe1', grassDark: '#c9d1d8',
    sand: '#cfd6da', water: '#7fa3bd', shore: '#a8c2d3', road: '#b0b4ac', roadAlt: '#a6aa9f',
    soil: '#7e8894', snow: '#ffffff', rock: '#b5bcc2', rockD: '#8b939b', iron: '#bfa08f', ironD: '#8f7461',
  },
];

/* 树冠（松树四季常青，冬季加雪顶） */
G.TREE_COLORS = {
  canopy: ['#2f6e37', '#356e2f', '#2a6539', '#3b7534'],
  trunk: '#5d4a37',
  snowCap: '#e8edf2',
};
