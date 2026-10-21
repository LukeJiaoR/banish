'use strict';
/* ============================================================
 * defs.js —— 建筑定义、产出参数、季节调色板
 * 经济基准对齐原版 Banished（未受教育工人基准），产能以 tests/bench.js 实测为准：
 *   每人每年吃 100 食物；1 棵树 = 2 原木；1 原木 = 3 柴火；
 *   木屋每年约烧 30 柴火；农田 14 食物/格/年（8×8 满收 896）；
 *   采集约 150-370 食物/工人/年；渔码头 150-450；护林 ~40-70 原木/工人/年（砍倒即原地补种，与采集/猎人同林取低值）；
 *   伐木屋约 320-640 柴火/工人/年（紧邻仓库取高值）。具体随地图与布局浮动，以 tests/bench.js 实测为准。
 * ============================================================ */

/* Two explicit starting conditions. Stocks and population totals are this
 * small-map adaptation; selecting a preset never changes an existing town. */
G.START_PRESETS = Object.freeze({
  classic: Object.freeze({name:'经典开局',kidPlan:Object.freeze([2,2,1,0,0]),stocks:Object.freeze({wood:80,stone:48,grain:500,firewood:50,tools:15}),wheat:true}),
  hard: Object.freeze({name:'困难（无种子）',kidPlan:Object.freeze([2,2,1,0]),stocks:Object.freeze({grain:400,firewood:40,tools:12}),wheat:false}),
});

/* Celsius temperatures and 48-day timing are this game's adaptation, not the
 * original engine's undocumented weather formula. Version 1 is save-stable. */
G.CLIMATE_VERSION = 1;
G.CLIMATES = Object.freeze({
  mild: Object.freeze({name:'温和 · Mild',offset:3,variation:1.2,snap:2,note:'温差较小，农田生长期较长；仍有霜害与冬季收割截止'}),
  fair: Object.freeze({name:'均衡 · Fair',offset:0,variation:2.4,snap:6,note:'季节温差适中，秋季可能提前降霜；留意预警并按需抢收'}),
  harsh: Object.freeze({name:'严寒 · Harsh',offset:-3,variation:3.6,snap:8,note:'春季生长较慢、秋霜更早；早熟、耐寒与非农食物更重要'}),
});
G.CROP_TEMPERATURES = Object.freeze({
  wheat: Object.freeze({growthMin:1,growthFull:10,frostBelow:0}),
  cabbage: Object.freeze({growthMin:2,growthFull:11,frostBelow:-2}),
  beans: Object.freeze({growthMin:4,growthFull:14,frostBelow:2}),
  squash: Object.freeze({growthMin:0,growthFull:10,frostBelow:-5}),
});

G.START_TERRAINS = Object.freeze({classic: Object.freeze({name:'现行地形',mapVersion:1}), mountain: Object.freeze({name:'山地山谷',mapVersion:2})});

/* 建筑（w/h 为占地格数；cost 为建造消耗；buildWork 为建造所需工时（游戏小时））
 * jobs: 工作岗位数；passable: 建成后是否可通行
 * warmWoodPerYear: 每年取暖柴火（本作冬季预算：木屋30、石屋20；效率比例60/90取自官方工具包）
 * isHome/chimney: 渲染用（窗户透光 / 烟囱炊烟） */
G.BDEF = {
  house: {
    id: 'house', name: '木屋', icon: '🏠', w: 2, h: 2,
    cost: { wood: 16, stone: 8 }, buildWork: 90, jobs: 0, passable: false,
    warmWoodPerYear: 30, isHome: true, chimney: true,
    wall: '#8a6242', wallD: '#6d4b32', roof: '#8f4433',
    desc: '原版成本 16木+8石。供一家人居住（本作每户至多 8 人），每年约烧 30 柴火。没房子住的家庭冬天会冻死人。',
  },
  stonehouse: {
    id: 'stonehouse', name: '石屋', icon: '🏠', w: 2, h: 2,
    cost: { wood: 24, stone: 40, iron: 10 }, buildWork: 120, jobs: 0, passable: false,
    warmWoodPerYear: 20, isHome: true, chimney: true,
    wall: '#9a948a', wallD: '#736e64', roof: '#6d675c',
    desc: '原版成本 24木+40石+10铁。石墙更保暖，每年约烧 20 柴火（比木屋省三分之一），适合人口定居后的更新换代。',
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
  stockpile: {
    id:'stockpile', name:'露天堆料场', icon:'🪵', w:2, h:2,
    cost:{wood:8}, buildWork:20, jobs:0, passable:true,
    wall:'#95724d', wallD:'#685139', roof:'#967755',
    desc:'低成本原料交货点，需清场和施工。只收原木、石头、铁、煤与柴火；各类公共仓容增加250，按实际可达耗时选择。食物与工具仍送通用仓库；沿用公共库存，不代表独立地方存货。',
  },
  well: {
    id:'well',name:'水井',icon:'🪣',w:2,h:2,cost:{wood:16,stone:24},buildWork:60,jobs:0,
    wall:'#978a71',wallD:'#6d6453',roof:'#775b3d',desc:'无固定岗位。救火者从可达水井或河岸实际取水，再送到火点。只为可选住房火灾供水，不增加公共可交易库存。',
  },
  burntruins: {
    id:'burntruins',name:'烧毁的住房',icon:'🔥',w:2,h:2,cost:{},buildWork:0,jobs:0,unbuildable:true,
    wall:'#615449',wallD:'#413c35',roof:'#514941',desc:'不能居住；可清理（不退还原建材）或支付新材料原址重建。原家庭身份与已有携货不受损。',
  },
  mineralpit: {
    id:'mineralpit',name:'永久矿坑',icon:'⛏️',w:3,h:3,cost:{},buildWork:0,jobs:0,passable:false,unbuildable:true,
    wall:'#786d5a',wallD:'#504b40',roof:'#686254',
    desc:'已开采矿点拆除后留下的永久3×3坑。不能移除、重建、铺路或继续采矿；此前实际背出的矿物仍归原工人送仓。',
  },
  mine: {
    id: 'mine', name: '矿井', icon: '⛏️', w: 3, h: 3,
    cost: { wood: 80, stone: 40, iron: 10 }, buildWork: 140, jobs: 2, passable: false,
    wall: '#6f6a62', wallD: '#524e47', roof: '#4a463f',
    desc: '2名矿工，可选择专采铁或煤；基础每批6铁或8煤，需要真实送仓。新井共用储量最多3500铁或7000煤；一经实际开采，拆除永久留下3×3矿坑且剩余矿失去。未开采取消不留坑。旧档矿点保留旧版无限，旧混采也不自动切换。',
  },
  stonequarry: {
    id: 'stonequarry', name: '采石场', icon: '🪨', w: 3, h: 3,
    cost: { wood: 64, stone: 32 }, buildWork: 140, jobs: 2, passable: false,
    wall: '#999084', wallD: '#726a60', roof: '#6b5b45',
    desc: '2名石匠专门采石，每批基础6石、9小时，仍要搬到可达仓库。满仓余石由工人保留，目标达到后暂停。新场储量4000石（本作适配）；一经实际开采，拆除永久留下3×3矿坑。未开采取消不留坑，旧档仍旧版无限；无塌方伤亡。',
  },
  tradingpost: {
    id: 'tradingpost', name: '贸易站', icon: '⛵', w: 4, h: 4,
    cost: { wood: 80, stone: 40, iron: 10 }, buildWork: 180, jobs: 1, passable: false,
    wall: '#89694a', wallD: '#604936', roof: '#695645',
    desc: '紧邻水面。1名商人按待售目标真实搬入库存，以物易物；待售资源不供居民消费。综合、物资、种子商轮流到访，收货范围不同；停靠时可向同一商人订下次回访货物，无需预付。',
  },
  pasture: {
    id: 'pasture', name: '牧场', icon: '🐑', w: 6, h: 6,
    cost: { wood: 30 }, buildWork: 50, jobs: 1, passable: true,
    wall: '#938060', wallD: '#725e43', roof: '#b09a73',
    desc: '点击放置固定6×6牧场：羊12头、牛10头或鸡24只，1名牧人。先贸易买同种牲畜，禁止混养。产物实际送仓；增加容量可另建牧场。已有面积牧场保留原容量。',
  },
  orchard: {
    id: 'orchard', name: '果园', icon: '🍎', w: 6, h: 6,
    cost: { wood: 12 }, buildWork: 36, jobs: 2, passable: true,
    wall: '#8b7958', wallD: '#695936', roof: '#77924d',
    desc: '点击放置固定6×6果园：9株、2名农夫。种子永久解锁对应果树；逐株种植、养护4年，每株未来秋季最多50果（全园450），已结旧果不补发。苹果与梨分别入库，旧通用果树仍产蔬菜；改选只影响后续补种，老树12–20岁错峰枯尽，果实须实际送仓。',
  },
  chapel: {
    id:'chapel', name:'礼拜堂', icon:'⛪', w:3, h:3,
    cost:{wood:50,stone:130,iron:30}, buildWork:150, jobs:1, passable:false,
    wall:'#a18a68', wallD:'#746248', roof:'#5b626b',
    desc:'1名健康牧师实际到岗后服务至多200名居民。居民步行到场礼拜2小时，获得6天礼拜记忆，幸福目标+0.5；不耗麦酒。最多8人在途或在场，先保口粮、医疗与课业。',
  },
  tavern: {
    id: 'tavern', name: '酒馆', icon: '🍺', w: 3, h: 3,
    cost: {wood:52,stone:12,iron:20}, buildWork:90, jobs:1, passable:false,
    wall:'#956a45', wallD:'#704b32', roof:'#804f3a',
    desc:'1名成年酿酒工，可选30主食酿3麦酒（受教育4），或30苹果／梨酿10麦酒。改配方只影响下一批，实际取料、携回加工6小时后送仓。先留足设定天数的全村口粮；18岁以上居民真实到馆休闲，耗1麦酒、2小时，获得6天休闲记忆。幸福仅给予温和正向劳动加成。',
  },
  tailor: {
    id: 'tailor', name: '裁缝铺', icon: '🧥', w: 3, h: 3,
    cost: { wood: 32, stone: 48, iron: 16 }, buildWork: 100, jobs: 1, passable: false,
    wall: '#957454', wallD: '#71553d', roof: '#816252',
    desc: '1名裁缝。普通衣可选自动、仅2皮革或仅2羊毛；到通用仓实际领料，携回制作。保暖外套需2皮革+2羊毛，均产1件（受教育2）。两种都耐穿48天，穿坏后才换新，优先领暖衣；普通衣户外寒冷×0.6，暖衣×0.3，仍需房屋与柴火。',
  },
  blacksmith: {
    id: 'blacksmith', name: '铁匠铺', icon: '⚒️', w: 3, h: 3,
    cost: { wood: 42, stone: 24 }, buildWork: 120, jobs: 1, passable: false,
    wall: '#7a5a45', wallD: '#5c4334', roof: '#6b4a3a',
    desc: '1名铁匠，可选择铁/钢工具。铁配方1铁+2木→2件（受教育3）；钢配方额外2煤，产量相同。钢工具耐久是铁工具的2倍，生产速度相同。默认备当前种类30件；已接批次沿用原配方。',
  },
  market: {id:'market',name:'市场',icon:'🧺',w:3,h:3,cost:{wood:58,stone:62,iron:40},buildWork:150,jobs:1,passable:false,wall:'#987850',wallD:'#73563b',roof:'#786040',desc:'货商集中搬运食物与取暖燃料，居民真实采购送回住房；明确启用衣物配送后也运普通衣和暖衣。'},
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
    desc: '2名猎人在原点±12格方形圈内寻找真实可达的鹿；每屋共用8天狩猎冷却。每只鹿产肉160/受教育200、皮革4/受教育6（本作适配，另受工具规则影响），工作后实际送仓才入库；鹿群真实觅食迁徙并按年恢复。',
  },
  forester: {
    id: 'forester', name: '护林小屋', icon: '🌲', w: 2, h: 2,
    cost: { wood: 32, stone: 12 }, buildWork: 70, jobs: 2, passable: false,
    wall: '#6b5a3e', wallD: '#54462f', roof: '#4a6b3a',
    desc: '2 名专业护林人。基础砍伐4小时、补种1.5小时；每棵树仍产2原木（受教育3），最多背8原木一批。就近连续采伐后真实送仓，原地补种生长速度不变。可分别关闭砍伐/补种；同址采集仍受成熟林减少影响，清空林地也会使野鹿另寻栖地。',
  },
  woodcutter: {
    id: 'woodcutter', name: '伐木屋', icon: '🪓', w: 2, h: 2,
    cost: { wood: 24, stone: 8 }, buildWork: 70, jobs: 1, passable: false,
    wall: '#75563c', wallD: '#5b4230', roof: '#7a5230',
    desc: '1 名工人，基础加工3.5小时。到堆料场/仓库实际领取2原木，携回劈成6柴火（受教育8）；近仓与道路缩短往返，原料或成柴满仓保留。全镇柴火库存达到本屋燃料目标即停止新批次；目标不代表过冬需求。',
  },
  dock: {
    id: 'dock', name: '渔码头', icon: '🎣', w: 2, h: 2,
    cost: { wood: 30, stone: 16 }, buildWork: 90, jobs: 2, passable: false,
    wall: '#6f5b40', wallD: '#574732', roof: '#8a5a3a',
    desc: '2 名专业渔民，满水域基础每批8肉类（鱼）。新规则排除桥面占水，并与有渔民的重叠码头分享水域；无可用水不产鱼。旧村保持经典规则，主动确认后全村启用。缺工具和远仓仍影响实际产出，必须紧邻水面。',
  },
  herbalist: {
    id: 'herbalist', name: '采药屋', icon: '🌿', w: 2, h: 2,
    cost: { wood: 30, stone: 12 }, buildWork: 75, jobs: 1, passable: false,
    wall: '#857252', wallD: '#61533d', roof: '#65704e',
    desc: '1名采药员从附近成熟森林采药并真实送仓。市民需走到有人值守的采药屋，消耗1草药恢复0.5健康；药材库存不会自行治病。保留成熟林，搭配肉、蔬菜、主食维持健康。',
  },
  hospital: {
    id: 'hospital', name: '诊所', icon: '⚕️', w: 3, h: 3,
    cost: { wood: 52, stone: 78, iron: 16 }, buildWork: 140, jobs: 1, passable: false,
    wall: '#b3a28a', wallD: '#8b7963', roof: '#675e51',
    desc: '1名医师、8个床位。患病市民需沿可达路线入诊，医师到岗累计照料24小时后康复；入诊后不再向周围传播。无医师时不能治疗。本批季节热病自然8天康复，不直接致死。',
  },
  townhall: {
    id: 'townhall', name: '市政厅', icon: '🏛️', w: 3, h: 3,
    cost: {wood:63,stone:124,iron:48}, buildWork:160, jobs:0, passable:false,
    wall:'#a09077',wallD:'#746958',roof:'#6e7775',
    desc: '不占工人。查看城镇与近60天记录，主动接纳或拒绝来访家庭。2～6人是小镇节奏适配；接纳前查看住房、粮柴与医疗压力，来者从可达边界步行入村登记后才工作。',
  },
  cemetery: {
    id:'cemetery',name:'墓园',icon:'🪦',w:4,h:4,
    cost:{wood:16,stone:40},buildWork:80,jobs:0,passable:true,
    wall:'#948b7a',wallD:'#6e6558',roof:'#837b6b',
    desc:'新墓园框选7–20格矩形，石材与工时按围栏周长计算，不占常驻工人。死亡时须有可达空位才减轻新哀伤；墓位保留192天。确认拆围栏后仅实际墓位留在原格，到原期限自然释放；旧4×4墓园仍保留8位及旧成本。坐标与期限为本作适配。',
  },
  graveremnant: {
    id:'graveremnant',name:'留存墓位',icon:'🪦',w:1,h:1,cost:{},buildWork:0,jobs:0,passable:true,unbuildable:true,hidden:true,
    desc:'拆除墓园围栏后保留的原墓位。沿用姓名、位置和到期日；仅占此格，可步行通过，不能拆除、建造、铺新路或重复退款。',
  },
  school: {
    id: 'school', name: '学堂', icon: '🏫', w: 3, h: 3,
    cost: { wood: 50, stone: 16, iron: 16 }, buildWork: 100, jobs: 1, passable: false,
    wall: '#7d6f52', wallD: '#615540', roof: '#4a5a6b',
    desc: '原版 School House 成本 50木+16石+16铁，1 名教师。孩子10岁入学，至少17岁且修满1344小时才毕业；每日最多6小时，老师和学生实际到校才记课，每所20座。失师优先转校，无处可去则保留学籍和课时等待。受教育生产加成不变；手动永久结束学业需确认。',
  },
  farm: {
    id: 'farm', name: '农田', icon: '🌾', w: 8, h: 8,
    cost: {}, buildWork: 12, jobs: 4, passable: true,
    wall: '#6b4f33', wallD: '#573f29', roof: '#6b4f33',
    desc: '免费；点击放置固定8×8农田，初始2名农夫，可调整0–4人；先清场并完成12工时施工。旧田保留原尺寸和用工设置。小麦产主食；困难开局需先买种子。贸易购种解锁卷心菜、早熟豆类和耐寒瓜，均产蔬菜。豆类12日成熟，夏秋可收；耐寒瓜24日成熟，入冬后的前两日仍可收已种作物，第3日未收部分损失。冬季不播种、不成长，耐寒时限是48日年适配。攒满一筐（28）才送仓。本季开种后改选只用于下一春，不改在田作物或在途收获。',
  },
  stoneroad: {
    id: 'stoneroad', name: '石路', icon: '🧱', w: 1, h: 1,
    cost: { stone: 1 }, buildWork: 0, jobs: 0, passable: true, road: true,
    desc: '每格1石，可把土路升级为石路。基础速度3.2格/小时（土路2.6、野地1.6）；仍先预览并确认，拆除不退石。',
  },
  bridge: {
    id: 'bridge', name: '木桥', icon: '🌉', w: 1, h: 1,
    cost: { wood: 4, stone: 1 }, buildWork: 3, jobs: 0, passable: true,
    desc: '选两岸陆地端点，自动吸附直线。每格4木1石、3工时；工人从可达岸边建造，完工前不可通行。最多24格。桥上有人或没有替代跨岸通路时不能拆除。',
  },
  roadwork: {id:'roadwork',name:'铺路工程',icon:'🚧',w:1,h:1,cost:{},buildWork:1,jobs:0,passable:true,unbuildable:true,desc:'非阻路的铺路工程，工人实运石材并逐格施工；取消只退未用现场材料，保留已铺道路。'},
  tunnel: {
    id:'tunnel',name:'隧道',icon:'🚇',w:1,h:1,cost:{stone:4},buildWork:3,jobs:0,passable:true,
    desc:'两个清场陆地洞口夹连续山体，只沿水平或竖直轴线。每格4石材、3本作工时（含两端）；首洞口实运施工，完工后以土路速度穿山。洞内有人、留货或无替代通路时不能拆。',
  },
  road: {
    id: 'road', name: '土路', icon: '🛣️', w: 1, h: 1,
    cost: {}, buildWork: 0, jobs: 0, passable: true, road: true,
    wall: '#8d7355', wallD: '#8d7355', roof: '#8d7355',
    desc: '原版土路免费。拖拽铺设，市民在路上走得更快。铺设会自动清掉沿途的树和岩石。',
  },
};

/* 工具栏顺序 */
G.TOOLBAR = ['gatherall', 'fell', 'collectstone', 'collectiron', 'cancelremoval', 'house', 'stonehouse', 'boarding', 'storage', 'mine', 'blacksmith', 'gatherer', 'forester', 'woodcutter', 'dock', 'hunting', 'school', 'chapel', 'farm', 'road', 'demolish'];

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
  mine:      { workH: 9, yield: 6, coalYield: 8, ironEvery: 5 }, // 新井专采铁/煤；旧档混采每5趟1趟铁，其余石（旧档仍无限）
  stonequarry: { workH: 9, yield: 6 },
  blacksmith: { toolLimit: 30, toolMax: 500, workH: 4, consume: [{ type: 'iron', qty: 1 }, { type: 'wood', qty: 2 }], toolsOut: 2, eduToolsOut: 3 }, // 1铁+2木→2工具（受教育 3）
  hunting:   { workH: 5, radius: 12 }, // 遇见真实鹿群；每屋共用八天冷却
  // perTile 14/格：原版 7/格但田块可放大到 15×15，本作固定 8×8，翻倍对齐原版人均产出；
  // haulCap 28：收获攒满 4 格再送一趟仓，否则 64 趟搬运会把秋收窗口耗在走路 上
  farm:      { perTile: 14, tileWorkH: 0.5, growDays: 24, haulCap: 28 },
  herbalist: { workH: 9, yield: 3, radius: 12, needTrees: 6, fullForest: 24 },
  builderChunk: 4,      // 建筑工人每段工作时长
};

/* 生存参数（原版基准） */
G.LIFE = {
  eatPerYear: 100,        // 每人每年吃 100 食物（原版）
  houseWarmWoodPerYear: 30, // 本作冬季预算：木屋30、石屋20、宿舍75；只在冬季按已入住建筑扣除
  starveDays: 4,          // 连续挨饿几天死亡
  coldDays: 5,            // 受冻值达到该值死亡（1.0 = 在户外挨满一整天）
  // 受冻双侧模型（原版：户外累积寒冷、回家烤火恢复）。速率为「处于该状态每满 24 小时」的量，按实际小时数折算
  coldOutdoor: 0.4,       // 冬季户外——露宿/远岗露营全天在外 ≈0.4/天，整冬 12 天 ≈4.8<5 勉强扛住，儿童×1.5 扛不住；普通衣×0.6，保暖外套×0.3，仅降低户外值
  coldIndoors: 0.3,       // 冷屋（自家没分到柴火）内——屋子挡风但不取暖，屋内缓慢累积
  warmRecover: 1.5,       // 暖屋（自家烧着柴）内——一夜 8h 恢复 0.5，盖过白天 16h 户外累积的 0.27，暖屋市民恒 ≈0
  coldChildMul: 1.5,      // 儿童受冻倍率（只作用于累积，恢复速率相同）
  birthChance: 0.014,     // 有房夫妇每天生育概率；非冬季 36 生育日 → 年受孕率 ≈ 40%（约 2.5 年一胎，原版节奏）
  birthFoodDays: 4,       // 粮食储备需可支撑的天数，才允许生育
  pairEvery: 3,           // 每 N 天尝试为单身者组建家庭
  maxFamily: 8,           // 本作每户人口上限；原版住宅5人，旧家庭兼容另行设计
  restFrom: 22,           // 休息开始时刻（小时）：市民回家睡觉
  restTo: 6,              // 休息结束时刻：天亮起床
  campDist: 10,           // 深夜离家超过该格数就地在工地露宿（护林人常驻林中的真实做法，避免长途回家又折返）；冬季露宿整夜受冻，是省工时还是保命的真实权衡
  gradAge: 17,            // 学堂毕业年龄（原版 17 岁）
  schoolCap: 20,          // 每所学堂学生容量（原版 20）
  boardingCap: 5,         // 每栋宿舍可入住的家庭数（原版 5）
  eduWorkMul: 0.7,        // 受教育工人任务工时倍率（同产出更快，≈ 产出 +43%）
  steelToolLifeDays: 240, // 本作适配寿命；钢为铁两倍，不额外提速
  toolLifeDays: 120,      // 共用池按成人天；个人工具换算16小时劳动日，均为本作适配
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

/* Serialized household-supply values, shared by the save validator. */
G.CLOTHING_KEYS=['clothes','warmCoats'];
G.SUPPLY={types:['grain','vegetables','meat','eggs','apples','pears','firewood','coal',...G.CLOTHING_KEYS],marketCap:240,homeCap:350,vendorCarry:80,homeCarry:40,marketRadius:18,foodDays:4,fuelDays:4,fetchH:.35,unloadH:.25};
G.emptySupplyStock=()=>Object.fromEntries(G.SUPPLY.types.map(k=>[k,0]));
G.supplySum=s=>G.SUPPLY.types.reduce((n,k)=>n+(s?.[k]||0),0);
G.supplyFood=s=>G.FOOD_KEYS.reduce((n,k)=>n+(s?.[k]||0),0);
G.supplyCargoItems=cargo=>cargo?{[cargo.type]:cargo.qty,...cargo.extra}:{};

// Encounter hunting values are this game's explicit bounded adaptation.
G.HUNTING={population:24,cooldownDays:8,replenishDays:8,moveDays:1,roamRadius:4,workH:5,meat:160,eduMeat:200,leather:4,eduLeather:6};
