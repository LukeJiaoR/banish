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
    desc: '原版 Storage Barn 成本 48木+16石。存放全镇资源，工人把收获搬到预计耗时较短的可达仓库。',
  },
  mine: {
    id: 'mine', name: '矿井', icon: '⛏️', w: 3, h: 3,
    cost: { wood: 80, stone: 40, iron: 10 }, buildWork: 140, jobs: 2, passable: false,
    wall: '#6f6a62', wallD: '#524e47', roof: '#4a463f',
    desc: '深井采矿，2 名专业工人，每批基础产出 6 石或铁，通常每 5 趟有 1 趟铁；满仓或生产目标暂停某矿种时改采另一种。地表矿仍由散工采集，单块产量不变。',
  },
  tradingpost: {
    id: 'tradingpost', name: '贸易站', icon: '⛵', w: 4, h: 4,
    cost: { wood: 80, stone: 40, iron: 10 }, buildWork: 180, jobs: 1, passable: false,
    wall: '#89694a', wallD: '#604936', roof: '#695645',
    desc: '紧邻水面。1名商人按待售目标真实搬入库存，以物易物；待售资源不供居民消费。每年有商船停留一季，可换羊、果树种子和物资。',
  },
  pasture: {
    id: 'pasture', name: '羊牧场', icon: '🐑', w: 6, h: 6,
    cost: { wood: 30 }, buildWork: 50, jobs: 1, passable: true,
    wall: '#938060', wallD: '#725e43', roof: '#b09a73',
    desc: '先从贸易站购买至少2只羊。1名牧人照料繁殖、剪毛；超过保留数量才屠宰产肉。羊不产皮革，羊毛可供裁缝。',
  },
  orchard: {
    id: 'orchard', name: '果园', icon: '🍎', w: 6, h: 6,
    cost: { wood: 12 }, buildWork: 36, jobs: 2, passable: true,
    wall: '#8b7958', wallD: '#695936', roof: '#77924d',
    desc: '贸易购入果树种子后永久解锁。约4年长成，每年秋收，果实并入蔬菜类；需工人照料和搬运，不会建成即产粮。',
  },
  tailor: {
    id: 'tailor', name: '裁缝铺', icon: '🧥', w: 3, h: 3,
    cost: { wood: 32, stone: 48, iron: 16 }, buildWork: 100, jobs: 1, passable: false,
    wall: '#957454', wallD: '#71553d', roof: '#816252',
    desc: '1名裁缝。到仓库取2皮革（缺皮时可用2羊毛）制作1件衣物，受教育产2件。市民每天领取和磨损衣物；穿衣降低户外受冻，住房与柴火仍重要。',
  },
  blacksmith: {
    id: 'blacksmith', name: '铁匠铺', icon: '⚒️', w: 3, h: 3,
    cost: { wood: 42, stone: 24 }, buildWork: 120, jobs: 1, passable: false,
    wall: '#7a5a45', wallD: '#5c4334', roof: '#6b4a3a',
    desc: '1 名铁匠，基础加工 4 小时。1 铁+2 木打 2 件工具（受教育 3 件），原料配比不变。默认备30件，达到目标即停止新批次；工具用尽会降低生产。',
  },
  gatherer: {
    id: 'gatherer', name: '采集小屋', icon: '🧺', w: 2, h: 2,
    cost: { wood: 30, stone: 12 }, buildWork: 70, jobs: 2, passable: false,
    wall: '#7d6a48', wallD: '#615238', roof: '#5d7040',
    desc: '2 名专业采集者，基础每趟 10 蔬菜，受成熟林密度、工具和往返路程影响。减少占工、通常保住原四人小屋的整屋产量；护林大量采伐同一片森林仍会降低收获。',
  },
  hunting: {
    id: 'hunting', name: '猎人小屋', icon: '🏹', w: 2, h: 2,
    cost: { wood: 44, stone: 10 }, buildWork: 80, jobs: 2, passable: false,
    wall: '#5e6b4a', wallD: '#485238', roof: '#4d5e3e',
    desc: '2 名专业猎人，满林基础每趟 10 肉类，并带回皮革，受成熟林密度、工具和往返路程影响。成熟树太少会停工；与采集小屋不同，幼林不能支持狩猎。',
  },
  forester: {
    id: 'forester', name: '护林小屋', icon: '🌲', w: 2, h: 2,
    cost: { wood: 32, stone: 12 }, buildWork: 70, jobs: 2, passable: false,
    wall: '#6b5a3e', wallD: '#54462f', roof: '#4a6b3a',
    desc: '2 名专业护林人。基础砍伐4小时、补种1.5小时；每棵树仍产2原木（受教育3），最多背8原木一批。就近连续采伐后真实送仓，原地补种生长速度不变。可分别关闭砍伐/补种；同址采集和狩猎仍受成熟林减少影响。',
  },
  woodcutter: {
    id: 'woodcutter', name: '伐木屋', icon: '🪓', w: 2, h: 2,
    cost: { wood: 24, stone: 8 }, buildWork: 70, jobs: 1, passable: false,
    wall: '#75563c', wallD: '#5b4230', roof: '#7a5230',
    desc: '1 名工人，基础加工3.5小时。自己到仓库取2原木，劈成6柴火（受教育8），配比不变；靠近仓库和住宅更高效。全镇柴火库存达到本屋燃料目标即停止新批次；目标不代表过冬需求。',
  },
  dock: {
    id: 'dock', name: '渔码头', icon: '🎣', w: 2, h: 2,
    cost: { wood: 30, stone: 16 }, buildWork: 90, jobs: 2, passable: false,
    wall: '#6f5b40', wallD: '#574732', roof: '#8a5a3a',
    desc: '2 名专业渔民，满水域基础每趟8肉类（鱼）。减少占工、通常保住原四人码头的整屋产量；小水域、缺工具和远仓仍影响产出。必须紧邻水面。',
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
    desc: '免费。约 14 主食/格/年：春播秋收，8×8 满收约 896 食物，收获攒满一筐（28）才送仓——挨着仓库建更省工。秋收不完会被冬天冻死。',
  },
  road: {
    id: 'road', name: '土路', icon: '🛣️', w: 1, h: 1,
    cost: {}, buildWork: 0, jobs: 0, passable: true, road: true,
    wall: '#8d7355', wallD: '#8d7355', roof: '#8d7355',
    desc: '原版土路免费。拖拽铺设，市民在路上走得更快。铺设会自动清掉沿途的树和岩石。',
  },
};

/* 工具栏顺序 */
G.TOOLBAR = ['fell', 'quarry', 'house', 'stonehouse', 'boarding', 'storage', 'mine', 'blacksmith', 'gatherer', 'forester', 'woodcutter', 'dock', 'hunting', 'school', 'farm', 'road', 'demolish'];

/* 产出参数（workH: 每次工作小时数；专业岗位按本作真实运输成本校准） */
G.PROD = {
  // gatherer/dock 产出随资源状态浮动：满产基准 qty，圈内成熟树/水域不足时按比例打折
  gatherer:  { workH: 5, yield: { type: 'vegetables', qty: 10 }, radius: 6, needTrees: 6, fullForest: 24 },
  // 散工 workH 8h 不变；专业砍伐4h+补种1.5h，最多8原木一批，仍需真实搬运。
  // 砍一棵在原坑种一棵（可持续轮伐），在护林作业区内选择工人附近的可达目标；
  // minMature：圈内成熟树低于下限即停砍育林（防清穿森林、拖垮同址采集小屋）
  forester:  { workH: 8, cutWorkH: 4, logsYield: 2, eduLogsYield: 3, plantH: 1.5, haulCap: 8, radius: 16, minMature: 15 },
  woodcutter: { workH: 3.5, logsIn: 2, firewoodOut: 6, eduFirewoodPerLog: 4,
    fuelLimit: 100, fuelStep: 50, fuelMax: 2000 }, // 燃料上限（原版 Fuel Limit）：柴火库存达到上限即停产；默认 100 ≈ 3 栋木屋一年取暖量，扩张后按面板需求提高，避免开局过量劈柴挤掉住房木材
  dock:      { workH: 5, yield: { type: 'meat', qty: 8 }, waterR: 10, fullWater: 40 },
  mine:      { workH: 9, yield: 6, ironEvery: 5 }, // 每 5 趟 1 趟铁，其余采石（深井矿脉不枯竭）
  blacksmith: { toolLimit: 30, toolMax: 500, workH: 4, consume: [{ type: 'iron', qty: 1 }, { type: 'wood', qty: 2 }], toolsOut: 2, eduToolsOut: 3 }, // 1铁+2木→2工具（受教育 3）
  hunting:   { workH: 5, yield: 10, radius: 12, needTrees: 10, fullForest: 20 }, // 狩猎依赖成熟林（鹿群栖息地），猎物随森林再生
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

/* 岩石：用「采石采铁」工具标记后由散工清除，每格得石头/铁（原版地表岩石与铁矿是初期石头、铁的来源） */
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
