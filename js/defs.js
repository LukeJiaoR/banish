'use strict';
/* ============================================================
 * defs.js —— 建筑定义、产出参数、季节调色板
 * 经济基准对齐原版 Banished（未受教育工人基准），产能以 tests/bench.js 实测为准：
 *   每人每年吃 100 食物；1 棵树 = 2 原木；1 原木 = 3 柴火；
 *   木屋每年约烧 30 柴火；农田 14 食物/格/年（8×8 满收 896）；
 *   采集约 150-370 食物/工人/年；渔码头 150-450；护林 ~40-70 原木/工人/年（砍倒即原地补种，与采集/猎人同林取低值）；
 *   伐木屋约 320-640 柴火/工人/年（紧邻仓库取高值）。具体随地图与布局浮动，以 tests/bench.js 实测为准。
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
    warmWoodPerYear: 75, chimney: true,
    wall: '#7d705c', wallD: '#5f5445', roof: '#5a4f3e',
    desc: '原版 Boarding House 成本 100木+45石。最多容纳 5 个家庭的临时住所：市民不会主动入住，但没房子时会搬进来过冬，有空独栋木屋会再搬出。全屋每年约烧 75 柴火（5 家分摊，人均约木屋一半）。',
  },
  storage: {
    id: 'storage', name: '仓库', icon: '📦', w: 3, h: 3,
    cost: { wood: 48, stone: 16 }, buildWork: 110, jobs: 0, passable: false,
    wall: '#7c7466', wallD: '#5e574c', roof: '#5c5648',
    desc: '原版 Storage Barn 成本 48木+16石。存放全镇资源，工人把收获搬到最近的仓库。',
  },
  mine: {
    id: 'mine', name: '矿井', icon: '⛏️', w: 3, h: 3,
    cost: { wood: 80, stone: 40, iron: 10 }, buildWork: 140, jobs: 4, passable: false,
    wall: '#6f6a62', wallD: '#524e47', roof: '#4a463f',
    desc: '深井采矿，不受地表矿藏限制：4 名工人轮流下井，每 5 趟有 1 趟采铁。石:铁产出比约 4:1，让石头/铁不再完全依赖地表矿（地表矿清得快、仍是早期最快来源）。',
  },
  blacksmith: {
    id: 'blacksmith', name: '铁匠铺', icon: '⚒️', w: 3, h: 3,
    cost: { wood: 42, stone: 24 }, buildWork: 120, jobs: 1, passable: false,
    wall: '#7a5a45', wallD: '#5c4334', roof: '#6b4a3a',
    desc: '原版 Blacksmith 成本 42木+24石，1 名工人。1 铁+2 木打 2 件工具（受教育 3 件）。工具是市民干活的饭碗：每人每天磨损一点，约 2.5 年用坏一件；工具用尽时生产减半。默认备30件，达到工具上限即停工，避免把过冬木材全打成工具。',
  },
  gatherer: {
    id: 'gatherer', name: '采集小屋', icon: '🧺', w: 2, h: 2,
    cost: { wood: 30, stone: 12 }, buildWork: 70, jobs: 4, passable: false,
    wall: '#7d6a48', wallD: '#615238', roof: '#5d7040',
    desc: '原版成本 30木+12石，4 名工人。在附近森林采集，实测约 150-370 食物/工人/年（森林贴着仓库取高值，与护林同址被砍林取低值），随圈内成熟林密度浮动——护林小屋把森林砍穿会砸了这里的饭碗。必须靠近森林。',
  },
  hunting: {
    id: 'hunting', name: '猎人小屋', icon: '🏹', w: 2, h: 2,
    cost: { wood: 44, stone: 10 }, buildWork: 80, jobs: 4, passable: false,
    wall: '#5e6b4a', wallD: '#485238', roof: '#4d5e3e',
    desc: '原版 Hunting Cabin 成本 44木+10石，4 名猎人。去圈内最近的成熟林狩猎鹿群（满产 5 食物/次，实测约 150 食物/猎人/年，随成熟林密度与仓库距离浮动）——森林被砍穿猎物就没了。与采集小屋的区别：猎物再生依赖成熟树，采集只要树在就行。',
  },
  forester: {
    id: 'forester', name: '护林小屋', icon: '🌲', w: 2, h: 2,
    cost: { wood: 32, stone: 12 }, buildWork: 70, jobs: 4, passable: false,
    wall: '#6b5a3e', wallD: '#54462f', roof: '#4a6b3a',
    desc: '原版成本 32木+12石，4 名工人。砍树取原木（未受教育 1 树=2 原木，受教育 3），砍倒即原地补种、可持续轮伐，约 40-70 原木/工人/年（受教育近翻倍；与采集/猎人同林会被摊薄）。面板可分别开关「砍伐」与「补种」：只种不砍可育林，只砍不种会清光森林。圈内成熟树存量过低时会自动停砍育林。',
  },
  woodcutter: {
    id: 'woodcutter', name: '伐木屋', icon: '🪓', w: 2, h: 2,
    cost: { wood: 24, stone: 8 }, buildWork: 70, jobs: 1, passable: false,
    wall: '#75563c', wallD: '#5b4230', roof: '#7a5230',
    desc: '原版成本 24木+8石，1 名工人。把原木劈成柴火：1 原木 = 3 柴火（受教育 4）。工人自己去仓库背原木——建在仓库旁边效率更高。面板可设本屋燃料目标（原版 Fuel Limit）：全镇柴火库存达到目标时，本屋停止接新批次；目标不代表过冬需求。',
  },
  dock: {
    id: 'dock', name: '渔码头', icon: '🎣', w: 2, h: 2,
    cost: { wood: 30, stone: 16 }, buildWork: 90, jobs: 4, passable: false,
    wall: '#6f5b40', wallD: '#574732', roof: '#8a5a3a',
    desc: '原版成本 30木+16石，4 名工人，实测约 150-450 食物/工人/年，随周边水域大小与仓库距离浮动。必须紧邻水面。',
  },
  school: {
    id: 'school', name: '学堂', icon: '🏫', w: 3, h: 3,
    cost: { wood: 50, stone: 16, iron: 16 }, buildWork: 100, jobs: 1, passable: false,
    wall: '#7d6f52', wallD: '#615540', roof: '#4a5a6b',
    desc: '原版 School House 成本 50木+16石+16铁，1 名教师。孩子 10 岁入学、17 岁毕业，每所至多 20 名学生。毕业工人干活工时 −30%（产出 +43%），砍树每棵多出 1 原木。教师离职/学堂拆除时在读学生会立即辍学成为工人。',
  },
  farm: {
    id: 'farm', name: '农田', icon: '🌾', w: 8, h: 8,
    cost: {}, buildWork: 12, jobs: 4, passable: true,
    wall: '#6b4f33', wallD: '#573f29', roof: '#6b4f33',
    desc: '免费。约 14 食物/格/年：春播秋收，8×8 满收约 896 食物，收获攒满一筐（28）才送仓——挨着仓库建更省工。秋收不完会被冬天冻死。',
  },
  road: {
    id: 'road', name: '土路', icon: '🛣️', w: 1, h: 1,
    cost: {}, buildWork: 0, jobs: 0, passable: true, road: true,
    wall: '#8d7355', wallD: '#8d7355', roof: '#8d7355',
    desc: '原版土路免费。拖拽铺设，市民在路上走得更快。铺设会自动清掉沿途的树和岩石。',
  },
};

/* 工具栏顺序 */
G.TOOLBAR = ['house', 'stonehouse', 'boarding', 'storage', 'mine', 'blacksmith', 'gatherer', 'forester', 'woodcutter', 'dock', 'hunting', 'school', 'farm', 'road', 'fell', 'demolish'];

/* 产出参数（workH: 每次工作小时数；目标对齐原版年产量） */
G.PROD = {
  // gatherer/dock 产出随资源状态浮动：满产基准 qty，圈内成熟树/水域不足时按比例打折
  gatherer:  { workH: 5, yield: { type: 'food', qty: 5 }, radius: 6, needTrees: 6, fullForest: 24 },
  // workH 8h + 原地补种 3h = 11h/棵：赶路+砍+种+送仓刚好排进 16h 工作日，
  // 砍一棵在原坑种一棵（可持续轮伐），采伐区锁定在护林屋周围成熟林带；
  // minMature：圈内成熟树低于下限即停砍育林（防清穿森林、拖垮同址采集小屋）
  forester:  { workH: 8, logsYield: 2, eduLogsYield: 3, plantH: 3, radius: 16, minMature: 15 },
  woodcutter: { workH: 7, logsIn: 2, firewoodOut: 6, eduFirewoodPerLog: 4,
    fuelLimit: 100, fuelStep: 50, fuelMax: 2000 }, // 燃料上限（原版 Fuel Limit）：柴火库存达到上限即停产；默认 100 ≈ 3 栋木屋一年取暖量，扩张后按面板需求提高，避免开局过量劈柴挤掉住房木材
  dock:      { workH: 5, yield: { type: 'food', qty: 4 }, waterR: 10, fullWater: 40 },
  mine:      { workH: 9, yield: 3, ironEvery: 5 }, // 每 5 趟 1 趟铁，其余采石（深井矿脉不枯竭）
  blacksmith: { toolLimit: 30, toolMax: 500, workH: 8, consume: [{ type: 'iron', qty: 1 }, { type: 'wood', qty: 2 }], toolsOut: 2, eduToolsOut: 3 }, // 1铁+2木→2工具（受教育 3）
  hunting:   { workH: 5, yield: 5, radius: 12, needTrees: 10, fullForest: 20 }, // 狩猎依赖成熟林（鹿群栖息地），猎物随森林再生
  // perTile 14/格：原版 7/格但田块可放大到 15×15，本作固定 8×8，翻倍对齐原版人均产出；
  // haulCap 28：收获攒满 4 格再送一趟仓，否则 64 趟搬运会把秋收窗口耗在走路 上
  farm:      { perTile: 14, tileWorkH: 0.5, growDays: 24, haulCap: 28 },
  builderChunk: 4,      // 建筑工人每段工作时长
};

/* 生存参数（原版基准） */
G.LIFE = {
  eatPerYear: 100,        // 每人每年吃 100 食物（原版）
  houseWarmWoodPerYear: 30, // 每栋有人住的木屋每年烧约 30 柴火（原版），冬季集中消耗；石屋 15、宿舍 75（5 家分摊，人均 15 = 木屋一半）
  starveDays: 4,          // 连续挨饿几天死亡
  coldDays: 5,            // 受冻值达到该值死亡（1.0 = 在户外挨满一整天）
  // 受冻双侧模型（原版：户外累积寒冷、回家烤火恢复）。速率为「处于该状态每满 24 小时」的量，按实际小时数折算
  coldOutdoor: 0.4,       // 冬季户外——露宿/远岗露营全天在外 ≈0.4/天，整冬 12 天 ≈4.8<5 勉强扛住，儿童×1.5 扛不住；衣物（路线图）将来降低此值
  coldIndoors: 0.3,       // 冷屋（自家没分到柴火）内——屋子挡风但不取暖，屋内缓慢累积
  warmRecover: 1.5,       // 暖屋（自家烧着柴）内——一夜 8h 恢复 0.5，盖过白天 16h 户外累积的 0.27，暖屋市民恒 ≈0
  coldChildMul: 1.5,      // 儿童受冻倍率（只作用于累积，恢复速率相同）
  birthChance: 0.014,     // 有房夫妇每天生育概率；非冬季 36 生育日 → 年受孕率 ≈ 40%（约 2.5 年一胎，原版节奏）
  birthFoodDays: 4,       // 粮食储备需可支撑的天数，才允许生育
  pairEvery: 3,           // 每 N 天尝试为单身者组建家庭
  maxFamily: 8,           // 每个家庭人口上限（原版每栋住宅至多住 8 人）
  restFrom: 22,           // 休息开始时刻（小时）：市民回家睡觉
  restTo: 6,              // 休息结束时刻：天亮起床
  campDist: 10,           // 深夜离家超过该格数就地在工地露宿（护林人常驻林中的真实做法，避免长途回家又折返）；冬季露宿整夜受冻，是省工时还是保命的真实权衡
  gradAge: 17,            // 学堂毕业年龄（原版 17 岁）
  schoolCap: 20,          // 每所学堂学生容量（原版 20）
  boardingCap: 5,         // 每栋宿舍可入住的家庭数（原版 5）
  eduWorkMul: 0.7,        // 受教育工人任务工时倍率（同产出更快，≈ 产出 +43%）
  toolLifeDays: 120,      // 工具寿命（约 2.5 年，原版 2~3 年）：每个成人每天磨损 1/寿命
};
G.NO_TOOL_MULT = 0.5;     // 工具用尽时生产任务产出倍率（原版无工具减产）
G.STORAGE_CAP = 500;      // 每座仓库/储物车的每种资源存放上限（工具随身小件不受限）——逼出仓储建设与运输规划
G.LIFE.eatPerDay = G.LIFE.eatPerYear / G.YEAR_DAYS; // ≈2.08 食物/人/天（生育门槛、饥饿警告用）

  /* 树木生长（天数阈值；原版一棵树 4-5 年成材，本作约 2 年——配合小地图快节奏与护林可持续产量） */
G.TREE_YOUNG = 60;
G.TREE_MATURE = 100;
G.TREE_LOGS = 2;          // 1 棵树 = 2 原木（原版未受教育；受教育护林/散工砍出 3 原木）
G.TREE_SPREAD_CHANCE = 0.8; // 非冬季每天自播概率（附近空地长一棵幼苗）——全图每年约新增 25-30 棵；杯水车薪但聊胜于无，规模造林还是得靠护林屋补种

/* 岩石：用「拆除」工具标记后由散工清除，每格得石头/铁（原版地表岩石与铁矿是初期石头、铁的来源） */
G.ROCK_STONE = 10;
G.ROCK_IRON = 10;
G.ROCK_WORK = 6;          // 清除一块岩石所需工时（游戏小时）

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
