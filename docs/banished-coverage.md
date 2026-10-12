# Banished 原版玩法覆盖矩阵

## 核查口径

- 核查日期：2026-10-12。已交付基线为 [`main@6cfbe2d7f91d4a41fe3cc06caa3b6954d1fefdea`](https://github.com/LukeJiaoR/banish/tree/6cfbe2d7f91d4a41fe3cc06caa3b6954d1fefdea)，版本 **0.3.64**；[鸡牧场 PR #66](https://github.com/LukeJiaoR/banish/pull/66) 已在此基线上。
- 本文记录 **0.3.65** 牧场疫病/整群搬空增量（[Issue #67](https://github.com/LukeJiaoR/banish/issues/67)，[PR #68](https://github.com/LukeJiaoR/banish/pull/68)已合并），以及 **0.3.66** 两果树/果品酿酒增量（[Issue #69](https://github.com/LukeJiaoR/banish/issues/69)，[PR #70](https://github.com/LukeJiaoR/banish/pull/70)已合并），以及 **0.3.67** 面积牧场增量（[Issue #71](https://github.com/LukeJiaoR/banish/issues/71)，[PR #72](https://github.com/LukeJiaoR/banish/pull/72)已合并），以及 **0.3.68** 地图种子/无种子困难开局增量（[Issue #73](https://github.com/LukeJiaoR/banish/issues/73)，[PR #74](https://github.com/LukeJiaoR/banish/pull/74)已合并），以及 **0.3.69** 可变果园增量（[Issue #75](https://github.com/LukeJiaoR/banish/issues/75)）。增量源码用同提交相对链接；本文若位于未合并分支，最新增量仅是候选，交付仍以普通PR合并main为准。
- 共列 40 项核心系统，按玩家能够做出的经营选择核查，不计算没有统一分母的“整体完成百分比”。本文件是范围审计，不是全功能、全平台或真实浏览器试玩通过证明。
- 查验了实际定义、模拟、菜单、序列化及加载逻辑；先核完整 Git 树，再以固定 SHA 读取本地缺少的相关设计文档。README、旧片文档中的“下一步”不能单独证明现在缺失。例如旧医疗文档称游民传染未做，但当前 `advanceNomads` / `decideNomads` 已接上疾病；旧市政厅文档称市场配送未做，当前 `supply.js` 已实现。
- 以下源码链接固定到上述基线，定位以函数或字段名为准。与原版比较的依据使用用户指定的 [Banished Wiki](https://banished-wiki.com/)；Wiki 里有旧版、预发布及互相不一致的描述，疑点单列，不把本作数值冒称为原版数值。

### 状态定义

| 状态 | 本文含义 |
| --- | --- |
| 已交付 | 本行的核心“选择 → 实际劳动/资源变化 → 结果”已在基线闭环；局部数值或表现差异仍明确列出，不表示逐项精确复刻。 |
| 有适配简化 | 基础系统已经能玩，但物品分类、适用范围、规则或规模有重要简化；不能把整个系统重复列为待开发。 |
| 真实缺失 | 已检查相邻系统、菜单、数据和存档，仍无本行所述玩法；不是只因未找到文档。 |
| 本片在制 | 正在开发，尚不能计入交付基线；只有验证并合并后的事实才能改变状态。 |

**启用条件也属于覆盖事实：**真实家庭配送、衣物配送、个人工具、到港自动购买、住房火灾和农田虫害已有入口，但不是全部新局默认开启。`newGameState` 的默认仍含 `supplyMode:'automatic'`、`clothingSupply:false`、`toolMode:'pooled'`、关闭火灾与农田虫害；共享渔业则为新局默认。功能可用与默认规则不能混写。

## 一、居住、人口与劳动（5 项）

| 编号 / 系统 | 状态 | 真实实现与源码证据 | 相对原版的差异 / 剩余缺口及依据 |
| --- | --- | --- | --- |
| A1 木屋、石屋与原址升级 | 已交付 | [定义][defs] `house` / `stonehouse`；[模拟][sim] `assignHousing`、`upgradeHouse`、`heatHome`；升级会迁出、重新施工，家庭和生活物资有处理。菜单提供两类住宅。 | 已有住房成本、家中取暖和升级时的安置取舍。占地、美术样式数量及施工节奏适配；尚无原版每种住宅六款外观切换。不应再做一套住房升级。[Housing](https://banished-wiki.com/wiki/Housing) |
| A2 宿舍与无房家庭安置 | 有适配简化 | [定义][defs] `boarding`；[模拟][sim] `boardingFamilies`、`assignHousing`，容纳 5 户，空独栋优先，无房多人户与单人户可入住；有独栋后迁出。 | 临时收容闭环已存在。每屋 75 柴/年、4×3 占地是本作设定；Wiki 宿舍页面的燃料说法与现有数值不同，不写成完全对齐。无需以“缺宿舍”另开功能。[Boarding House](https://banished-wiki.com/wiki/Boarding_House) |
| A3 成家、生育、成长与老死 | 有适配简化 | [模拟][sim] `normalizeFamilyRelations`、`areCloseKin`、`joinFamilies`、`formFamilies`、`tryBirths`、`killCitizen`；空房约束新家庭，保存亲属/配偶；日界 `age += 1 / G.YEAR_DAYS`，70 岁后有老死概率。[存档][main]保存年龄与亲属关系。 | 人口不是只增不减。18 岁成家、在读学生不配对、亲属排除和每历年长 1 岁是适配；Wiki 的年龄时间换算与此不同，且其页面内部算例不一致。缺口是人口节奏对齐与展示，不是从零加家庭/寿命。未经独立玩法决策不直接把旧村年龄加速。[Housing](https://banished-wiki.com/wiki/Housing)、[Citizens](https://banished-wiki.com/wiki/Citizens) |
| A4 吃饭、营养、饥饿与御寒 | 有适配简化 | [核心][core] `FOOD_KEYS`、`foodGroup`、`foodBasket`；[模拟][sim] 日界吃饭、`consumeFood`、`coldStep`、`heatHome`、`advanceHealth`；[配送][supply] `eatHousehold`。食物、服装、房屋和燃料各有真实作用，饥饿/寒冷可致死。 | 明确保持肉/蛋白、蔬菜、主食 **三营养组**；鸡蛋是独立货品、与肉共享蛋白组，旧通用树仍产蔬菜；0.3.66苹果/梨为独立物品，营养仍归蔬菜组。原版有更多具体食物及水果/坚果类别。本矩阵不授权新增第四营养组；应与果树品种和酒原料扩展分开决策。[Food](https://banished-wiki.com/wiki/Food)、[Citizens](https://banished-wiki.com/wiki/Citizens#Health) |
| A5 用工、散工、清场和施工优先级 | 有适配简化 | [模拟][sim] `scheduleJobs`、`setWorkerLimit`、`setConstructionPaused`、`setConstructionPriority`、`siteTrees`、`addBuilding`；[地图][map] 标记采伐/采矿；[界面][ui] 用工及工地操作。工人清场、搬货后施工，暂停/撤岗保护既有货批。 | 已有真实工人与生产机会成本；本作以建筑用工上限、自动调度为主，不等同原版按职业总数分配。建材付款仍主要为开工时公共扣款，没有逐件运建材到工地。不为“补职业面板”重写现有调度。[Citizens / Professions](https://banished-wiki.com/wiki/Citizens#Professions) |

## 二、食物生产（10 项）

| 编号 / 系统 | 状态 | 真实实现与源码证据 | 相对原版的差异 / 剩余缺口及依据 |
| --- | --- | --- | --- |
| F1 森林采集 | 有适配简化 | [定义][defs] `gatherer`、`PROD.gatherer`；[模拟][sim] `foodForestCanWork` 及采集任务，林况、工具、工人、往返和送仓共同制约产出。 | 根茎、浆果、蘑菇、洋葱被汇成蔬菜；没有逐个野生食物实体。森林与实际搬运的基础链已做，不列为缺失。Wiki 对树龄的文字有冲突，不能直接以其中一句推翻现有林况玩法。[Gatherer's Hut](https://banished-wiki.com/wiki/Gatherer%27s_Hut) |
| F2 狩猎与皮革 | 有适配简化 | [定义][defs] `hunting`；[模拟][sim] 狩猎 `work` 任务产肉并附皮革，成熟林不足停工、真实送仓。 | 用成熟林密度代理猎物，没有移动鹿群或原版按小屋限制猎杀频率的机制；肉类也未细分鹿肉。这是可独立追加的生态玩法，不能称狩猎未做。[Hunting Cabin](https://banished-wiki.com/wiki/Hunting_Cabin) |
| F3 渔业选址、共享水域与桥占水 | 有适配简化 | [模拟][sim] `fishingWaterSummary`、`fishingPlacementSummary`、`enableSharedFishing`；新村共享规则扣除桥占水，有工人的重叠渔场分摊水域；鱼产为肉类并送仓。 | 两人岗位、范围和产量为适配，旧村可保留经典规则。已做水域竞争，不再立“渔场重叠”重复票；并未实现有限鱼群，但不把旧概述页的“灭绝”文字自动升级成下一轮必做。[Fishing Dock](https://banished-wiki.com/wiki/Fishing_Dock) |
| F4 自由农田、季节劳动与抢收 | 已交付 | [地图][map] `farmDefinition` / `initialFarmWorkers`；[模拟][sim] 逐格播种/收割、`earlyHarvestQuote` / `beginEarlyHarvest`；[主程序][main] 农田框选与 `farmSize` 保存；[界面][ui] 预览确认。新田每边 4–15 格。 | 面积、用工、播种承诺、秋收/早熟收获、冬季未收损失都已有决策；14/格等产量、播种窗口和成熟日数为适配，不是原版精确气温模型。[Crop Field](https://banished-wiki.com/wiki/Crop_Field)、[Farming](https://banished-wiki.com/wiki/Farming) |
| F5 作物种子、换种及生长期差异 | 有适配简化 | [模拟][sim] `CROPS` 为小麦、卷心菜、早熟豆类；`cropUnlocked`、`setFarmCrop`、`cropChoiceOf`、`seedUnlockKey`；交易永久解锁，开种后变更留给下一季，豆类夏季成熟。 | 原版还有玉米、辣椒、马铃薯、南瓜、笋瓜等；当前未覆盖完整八作物，也无逐作物耐寒阈值。**已有三作物而非只有小麦**；12 日/10 每格的豆类是本作适配。[Farming](https://banished-wiki.com/wiki/Farming)、[Seeds](https://banished-wiki.com/wiki/Seeds) |
| F6 果园逐树生长、采果和补种 | 已交付 | [模拟][sim] `newOrchardTrees`、`makeOrchardTask`、`completeOrchardTask`、`advanceOrchard`、`setOrchardReplant`；[存档][main] `orchardTrees`。农夫逐株种植/养护/采果，老树死亡、空位补种，货物仍需送仓。 | 已有多年投资和更新空窗。旧场9株保留，新场树位见F7；4年有效养护、12–20年错峰寿命、每株20果为适配；不要再次开发“老树死亡/补种”。[Orchard](https://banished-wiki.com/wiki/Orchard)、[已交付说明][orchard-doc] |
| F7 果树品种与可变果园面积 | 有适配简化（0.3.66 / 0.3.69 增量） | [模拟](../js/sim.js) `ORCHARD_TYPES` / `orchardLayout` / `orchardPoint`、[地图](../js/map.js) `orchardDefinition` 和[主程序](../js/main.js) 矩形规划与 `orchardSize` 保存；[两果品](fruit-brewing.md)、[可变果园](orchard-area.md)，[Issue #75](https://github.com/LukeJiaoR/banish/issues/75)。苹果梨独立买种/实采/实运；新场4–15边长、东西2格/南北3格树列、实际用工与产物守恒。 | 原版其余果/坚果品种仍缺，营养保留三组。新场按Wiki正文树距，披露尾部矛盾表；成本/岗位为适配。旧6×6/9株/2岗独立保全，寿命12–20年不随树数延长；可变面积不再列缺失。[Orchard](https://banished-wiki.com/wiki/Orchard) |
| F8 羊、牛、鸡及牧产品 | 已交付 | [模拟][sim] `LIVESTOCK`、`setPastureType`、`stockPasture`、`advanceChickenEggs`、`completeEconomyWork`；[核心][core] 独立鸡蛋；[界面][ui] 选种、放入、保留量与生产；[鸡牧场说明](chickens.md)。 | 三物种已覆盖，禁止混养，照料繁殖、羊毛、肉、皮、鸡蛋及真实运出可玩。肉品合并、固定容量和繁殖/蛋产量是适配；鸡已经合并，不再作为下一片。[Pasture](https://banished-wiki.com/wiki/Pasture) |
| F9 按面积规划牧场与容量 | 有适配简化（0.3.67 增量） | [本片地图](../js/map.js) `pastureDefinition`；[模拟](../js/sim.js) `pastureCapacity`；[规划/存档](../js/main.js) `pastureSize`；[规则](pasture-area.md)，[Issue #71](https://github.com/LukeJiaoR/banish/issues/71)。新场两角/拖拽确认7–20格，实际清场建造，容量/材料/岗位预览，放畜、繁殖、分群和搬空统一按目标场容量。 | 新场牛20/羊16/鸡6格；费用/工时为适配。旧6×6场保留羊12/牛10/鸡24与原库存合同。原围栏/棚屋/动物素材复用，畜群按实际区域分布；不含已有场扩缩或逐头转场寻路。[Pasture](https://banished-wiki.com/wiki/Pasture) |
| F10 同种分群扩场 | 已交付 | [模拟][sim] `pastureSplitFacts`、`pastureSplitQuote`、`splitPasture`；不少于 10 头可向可达同种空场分一半，检查容量/残留任务，分配繁殖进度；沿原头数保存。[分群说明][split-doc] | 这是基线功能。牲畜仍按群体直接划拨，没有逐头赶畜行走；别把“分群”与本片“整群搬空”混为一项，后者见 D5。[Farming](https://banished-wiki.com/wiki/Farming#Pasture) |

## 三、材料、衣物、工具与加工（6 项）

| 编号 / 系统 | 状态 | 真实实现与源码证据 | 相对原版的差异 / 剩余缺口及依据 |
| --- | --- | --- | --- |
| M1 地表资源、护林和持续产木 | 已交付 | [地图][map] `markFellAt`、`markRockAt`、`clearRock`、`treeStage`；[模拟][sim] 护林砍伐/补种任务及批量运木；[定义][defs] `forester`。林木成熟、清场、地表石铁耗尽与 `doCut` / `doPlant` 开关存在。 | 可选择开垦、保林或再植，林地影响采集/狩猎/草药。范围、两名工人和作业批次适配；不把已有护林或地表耗尽另列新任务。[Foresting](https://banished-wiki.com/wiki/Foresting) |
| M2 柴火、煤取暖与工业保留 | 有适配简化 | [模拟][sim] 劈柴取料/加工、`fuelLimitOf`、`heatingPolicy`、`heatHome`；[配送][supply] 家庭燃料配送及关闭煤取暖后的退仓；[定义][defs] `woodcutter`。 | 原木真实领回加工，柴火/煤与钢工具争资源已存在。煤政策、保留线、供暖折算和本作冬季节奏属适配；不用新增“煤能取暖”功能。[Wood Cutter](https://banished-wiki.com/wiki/Wood_Cutter)、[Coal](https://banished-wiki.com/wiki/Coal) |
| M3 铁/煤矿井、采石场与永久矿坑 | 有适配简化 | [模拟][sim] `setMineMode`、`MINERAL_RULES`、`mineralAvailable`、`completeMineralTask`、矿点拆除留坑；[定义][defs] `mine` / `stonequarry` / `mineralpit`；[存档][main] `mineralUnits` 与旧档兼容。 | 已有专采、有限储量、真实搬矿和占地不可再用。旧档可保留无限矿；3×3、两人岗位、4000 石等适配，未要求矿井贴山，也未做矿难。**采矿耗尽已经交付**。[Mine](https://banished-wiki.com/wiki/Mine)、[Quarry](https://banished-wiki.com/wiki/Quarry) |
| M4 铁/钢工具与个人领取磨损 | 已交付 | [模拟][sim] `blacksmithRecipe`、`setToolRecipe`、铁匠多阶段取料、`enablePersonalTools`、`tryToolFetch`、`stepToolFetch`、`toolLifeHours`；[存档][main] `toolMode`、`toolType` / `toolHours`。[个人工具说明][tools-doc] | 铁/钢制作、钢双倍耐久、本人缺工具低效及真实到仓领取已做；个人模式须在市政厅明确启用，默认保留共用池。50% 速度、寿命小时是适配，市场不配送工具。不再安排一次“个人工具”。[Tools](https://banished-wiki.com/wiki/Tools) |
| M5 皮/毛裁缝、暖衣与实际穿戴 | 已交付 | [模拟][sim] `setCoatMaterial`、`setCoatRecipe`、裁缝真实取料、`wearClothing`、`clothingColdMul`；[配送][supply] `clothingSupplyEnabled`、衣物需求/配送；[存档][main] 衣型与余寿。 | 皮或毛可做普通衣，皮+毛做暖衣，个人穿旧后更换、户外保暖均已有。皮衣/毛衣仍共用普通衣库存；衣物配送需另行启用。48 日耐穿与保暖倍率为适配，不把“有公共衣服”误说成每人已穿。[Clothing](https://banished-wiki.com/wiki/Clothing) |
| M6 酿酒、口粮竞争与可选原料 | 有适配简化（0.3.66 增量） | [本片模拟](../js/sim.js) `BREW_RECIPES`、`tavernRecipeOf`、`setTavernRecipe`、`completeBrew`；主食、苹果、梨三配方有真实整批取料/携回/加工/送酒，已接批次不随改选漂移。[规则](fruit-brewing.md) | 苹果/梨30→10酒参照原版；原主食30→3/4的本作旧合同不变。通用蔬菜不能冒充果品，其他原版水果来源尚未覆盖。酒仍汇同一ale库存供既有休闲，不新增营养组。[Tavern](https://banished-wiki.com/wiki/Tavern)、[Ale](https://banished-wiki.com/wiki/Ale) |

## 四、物流、储存、贸易与交通（8 项）

| 编号 / 系统 | 状态 | 真实实现与源码证据 | 相对原版的差异 / 剩余缺口及依据 |
| --- | --- | --- | --- |
| L1 仓库与露天堆料场 | 有适配简化 | [模拟][sim] `STOCKPILE_TYPES`、`storageAccepts`、`storageCap`、`storageRoute`；[定义][defs] `storage` / `stockpile`。原料可就近交堆料场，食品/工具等走通用仓。 | 已有分类收货点与容量。公共库存仍全镇共享，各仓没有独立物品账；堆料场固定 2×2，没有原版可变面积和统一重量容量。不因家庭库存已实现便称所有仓储已地方化。[Weight](https://banished-wiki.com/wiki/Weight) |
| L2 真实采运、择路和断路缺货 | 有适配简化 | [地图][map] `findPathToAny`、`travelEdgeHours`；[模拟][sim] `storageRoute`、`startHaul`、`startMineralHaul`；[存档][main] 保存实际位置/携货。断路、远仓、携货和晚归会实际影响生产。 | 已不是全图瞬时送仓；但一般仓库仍共享库存、不同货批容量并非原版统一重量规则，存档不保存所有未完任务/RNG。个别任务兼容分支不能当完整原版物流模拟。[Citizens](https://banished-wiki.com/wiki/Citizens)、[Weight](https://banished-wiki.com/wiki/Weight) |
| L3 市场和家庭真实生活补给 | 已交付 | [配送][supply] `beginSupplyTrip`、`makeVendorTask`、`eatHousehold`、`enablePhysicalSupplyPrototype`、`marketSupplySummary`；[界面][ui] 启用预览/确认；[存档][main] 住房/市场库存、混合携货及散落回收。[配送说明][market-doc] | 公共仓→货商→市场→家庭→真实消耗已打通；迁居、拆除、死亡、火灾与余货归属已有处理。模式默认关闭，范围/携量/容量适配，工具和工业原料不在市场配送范围。不要重复开发整条链。[Market](https://banished-wiki.com/wiki/Market) |
| L4 贸易站备货、交换与购入种畜 | 有适配简化 | [模拟][sim] `TRADE_VALUES`、`TRADE_GOODS`、`makeTradeTask`、`completeTradeTask`、`executeTrade`；贸易站实存与在途占位独立核算，工人按待售目标搬入/运回，种子解锁、牲畜入待安置池。 | 基础以物易物完整；货物目录和 2000 容量是适配。船按到港事件生成，未模拟沿主河航行；当前放置只检查邻水，不识别贸易航道连通。不要把增加商船航线与普通购货混成一片。[Trade](https://banished-wiki.com/wiki/Trade) |
| L5 专营商人、同人订货与自动购买 | 有适配简化 | [模拟][sim] `orderMerchantGoods`、`arriveMerchant`、`setAutoTrade`、`runArrivalAutoTrade`；[存档][main] `merchantOrders`、`autoTrade`、`autoTradeLast`。[订货说明][orders-doc]、[自动购买说明][auto-doc] | 已有差异目录/拒收、同商人回访履约、订货溢价及每船单规则自动购买。缺多条优先级、混合付款、离港自动购买和循环订单，但这不等于“自动贸易缺失”。[Trade](https://banished-wiki.com/wiki/Trade)；Wiki 未完整说明自动购买选项，不能凭该页推断完整规格。 |
| L6 全镇生产限额 | 已交付 | [模拟][sim] `productionGoalOf`、`setProductionGoal`、`effectiveProductionGoal`、`nextGoalPause`、`productionOutputsOf`；[界面][ui] 资源目标窗口；[存档][main] `productionGoals` / `productionPaused`。 | 食物、原料、燃料、工具、衣物、草药、酒等现有资源均有目标；保留本屋工具/柴火目标、已接批次、农田当季承诺和恢复线。限额不是硬仓容，也不保证存活。无需新增第二套“资源限制”。[Achievement Guide：库存目标与生产上限](https://banished-wiki.com/wiki/Tutorials/Achievement_Guide)、[实现说明][goals-doc] |
| L7 土路、石路与跨水木桥 | 有适配简化 | [地图][map] `planRoad`、`planBridge`、`bridgeRemovalStatus`、`surfaceSpeed`；[定义][defs] 三种交通设施；[主程序][main] 规划确认、桥施工与路面存档。[交通说明][transport-doc] | 免费土路、石路付石升级、桥真实岸边施工后通行都已做。路速、24 格桥长和保守拆桥保护适配；道路铺设本身不是完整施工工序。**道路桥梁不是缺失项**。[Road](https://banished-wiki.com/wiki/Road)、[Bridges](https://banished-wiki.com/wiki/Bridges) |
| L8 穿山隧道 | 真实缺失 | [定义][defs] 无 tunnel；[界面][ui] 道路分类只有 `road` / `stoneroad` / `bridge`；[地图][map] `tileBlocked` 无山体高度/隧道覆盖规则；[存档][main] 无隧道实体。 | 原版隧道穿越山地。当前首先缺真正的山地障碍，孤立加一个隧道建筑只会是装饰；应与 D2 的山地选址、两端入口和通行一起做，而非重写已完成道路桥梁。[Tunnel](https://banished-wiki.com/wiki/Tunnel) |

## 五、服务与城镇发展（5 项）

| 编号 / 系统 | 状态 | 真实实现与源码证据 | 相对原版的差异 / 剩余缺口及依据 |
| --- | --- | --- | --- |
| S1 学校、到课、毕业与教育产出 | 有适配简化 | [模拟][sim] `EDUCATION`、`assignSchool`、`schoolTeacherPresent`、`stepSchool`、`leaveSchool`；[存档][main] `studyHours` / `school` / `educated`。师生实际到校才累计，20 座、10 岁入学、至少 17 岁且课时够才毕业。 | 已有完整教育主链。失师且无转校处时，本作等待并保课时，原版 Wiki 描述转未受教育散工；1344 小时和每天 6 小时为适配。此差异可讨论，不能当学校未做。[School House](https://banished-wiki.com/wiki/School_House) |
| S2 采药保健、疾病与诊所 | 有适配简化 | [模拟][sim] `makeHerbalistTask`、`tryMedicalCare`、`medicalStaff`、`stepMedicalCare`、`advanceHealth`；居民沿路求医，医师到岗治疗，住院者不传播，草药保健和疾病治疗分工。 | 已有疾病传播和医疗，不缺整套医院。当前只有非直接致死的季节热病、8 床、自然 8 日恢复；没有原版多病种/致死谱。先扩生产和规划玩法，不把这里变成无穷新增疫情。[Herbalist](https://banished-wiki.com/wiki/Herbalist)、[Hospital](https://banished-wiki.com/wiki/Hospital)、[医疗说明][health-doc] |
| S3 市政厅、经营记录与游民 | 有适配简化 | [模拟][sim] `townLedgerSummary`、`advanceNomads`、`nomadEntry`、`decideNomads`、`townHallSummary`、`townChallengeFacts`；[存档][main] `nomads`、账本和挑战。接纳/拒绝前查看压力，家庭从可达边界步行登记，可携既有热病。 | 已有游民，规模 2–6 人、春夏窗口为小镇适配；不是任意人口比例的大规模移民。历史记录为近 60 日摘要及近 48 日流水，缺原版多跨度百年图；已有三项发展挑战，不等同完整原版成就集。[Town Hall](https://banished-wiki.com/wiki/Town_Hall) |
| S4 礼拜堂、酒馆休闲与幸福 | 有适配简化 | [模拟][sim] `tryLeisure` / `stepLeisure`、`tryChapel` / `stepWorship`、`chapelStaff`、`happinessTarget`；[礼拜堂说明](chapel.md)。成年居民去酒馆耗酒，居民实际礼拜，服务受值守/路线/基本需求约束。 | 礼拜堂已交付，1 牧师/200 人框架有依据；记忆天数、并发和温和劳动加成为适配。尚无原版全部建筑邻近幸福因素与低幸福频繁闲逛；不用为补清单重造礼拜堂或酒馆。[Chapel](https://banished-wiki.com/wiki/Chapel)、[Tavern](https://banished-wiki.com/wiki/Tavern)、[Citizens](https://banished-wiki.com/wiki/Citizens#Happiness) |
| S5 墓园、墓位与家庭哀伤 | 有适配简化 | [模拟][sim] `MEMORIAL`、`griefLoss` 及死亡时安葬/墓位检查；[定义][defs] `cemetery`；[存档][main] `graves` / `grief`；[墓园说明](cemetery.md)。有可达空墓位才缓解新哀伤，墓位自然到期。 | 核心社会后果已做。固定 4×4、8 墓位、4 年、未到期不许拆除为适配；原版可变 7–20 边长且拆围墙后墓仍占地。暂缺祭扫行走及近邻幸福，不等于缺墓园。[Cemetery](https://banished-wiki.com/wiki/Cemetery) |

## 六、地图、开局与灾难（6 项）

| 编号 / 系统 | 状态 | 真实实现与源码证据 | 相对原版的差异 / 剩余缺口及依据 |
| --- | --- | --- | --- |
| D1 玩家地图种子与开局设置 | 有适配简化 | 0.3.68的[主程序](../js/main.js) `startConfigQuote` / `prepareNewGame` / `confirmNewGame`、[预设](../js/defs.js) `START_PRESETS` 和[界面](../js/ui.js) `showNewGameSettings` 支持查看/复用/输入种子（含0）、现行五家庭与无种子四家庭；两阶段最终确认、原子生成、旧档未知配置保全。困难小麦需真实贸易买种后播种，见[说明](start-settings.md)。 | 家庭结构依Wiki，库存与48日年为本作适配；尚无简单六家庭预建村、随机初始种子/牲畜，现行五家庭不是原版中等完整参数。地图类型/气候仍见D2。[Map Seeds](https://banished-wiki.com/wiki/Map_Seeds)、[Difficulty Levels](https://www.banished-wiki.com/wiki/Tutorials/Getting_Started_Guide#Difficulty_Levels) |
| D2 山地、地图类型/尺寸与气候 | 真实缺失 | [地图][map] `genWorld` 的噪声高度只用来划水/沙滩，世界对象不保留山体/坡度；`tileBlocked` 仅处理水/建筑/桥。[核心][core] 固定地图和四季日数；[主程序][main] 无气候/地形类型配置保存。 | 基础随机森林、矿石、水体与四季已存在；缺“选择山地/山谷、小中大、温和/严酷气候”对应的可玩差异、气温与霜期。它们涉及可建区、作物、取暖和存档，不能只添选择框；隧道依赖此项。[Hard Difficulty：Map Settings](https://banished-wiki.com/wiki/Tutorials/First_Year_on_Hard_Difficulty#Map_Settings)、[Mountain Men 条件](https://banished-wiki.com/wiki/Tutorials/Achievement_Guide) |
| D3 住房火灾、水井与真实扑救 | 有适配简化 | [火灾][fire] `setFireDisasters`、`igniteHouse`、`assignFireRescuers`、`fireWaterSpot`、`completeFirefighting`、`finishHouseFire`；[存档][main] `houseFire` / `ruinFrom`。有烟警、迁出、提水、蔓延、烧毁与付费重建。 | 默认关闭；只覆盖独栋住房，至多有限邻屋、无直接火灾死亡，非原版全城建筑火灾。水井供扑救，不制造可交易“水”。已足以产生预备住房/消防路线选择，不优先扩更多火灾条款。[Well](https://banished-wiki.com/wiki/Well)、[Disasters](https://banished-wiki.com/wiki/Disasters) |
| D4 农田虫害、抢收与轮作 | 有适配简化 | [模拟][sim] `setFarmPests`、`advanceFarmPests`、`farmPestSummary`、`beginEarlyHarvest`；[存档][main] `farmPests`、`pestInfestation`、`lastPestCrop`。选择启用后，未收作物会损失，换作物影响复发。 | 核心应对已做，概率/宽限/损失批次为适配；不能从“已有农田虫害”推断果园也感染。Wiki 明确支持抢收和改种，但同页已澄清土壤退化未实现，不应开发伪原版“强制肥力耗尽”。[Farming / Infestation](https://banished-wiki.com/wiki/Farming#Infestation) |
| D5 牧场疫病与整群搬空 | 有适配简化（0.3.65 增量） | [Issue #67](https://github.com/LukeJiaoR/banish/issues/67)；[本片模拟](../js/sim.js) `advancePasturePests` / `emptyPasture`、[规则](pasture-pests.md)。从0.3.64的繁殖/产物/分群扩展为明确确认的可选疫病和独立整群搬空，最后1–2头也可保种；旧村默认关闭。 | 12日宽限、2日预警、每天1死、全镇最多1场为适配，搬空清疫；原场已产物/携货与繁殖进度守恒。动物仍按群体直接安置，不是逐头赶畜；不接人类诊所或无依据邻场传播。交付条件见顶部合并口径。[Pasture](https://banished-wiki.com/wiki/Pasture) |
| D6 其他原版灾难范围 | 真实缺失 | [模拟][sim] 果园生命周期没有虫害；[火灾][fire] 仅住房；[定义][defs]、[地图][map]、[存档][main] 无龙卷风实体/路径及工作事故机制。 | 果园虫害、龙卷风、工作事故等未覆盖。列明事实即可；在地图设置、果园面积/剩余品种仍有空缺时，暂不把连续加灾难作为默认路线。[Farming / Orchards](https://banished-wiki.com/wiki/Farming#Orchards)、[Disasters](https://banished-wiki.com/wiki/Disasters)、[Hunting Cabin / Risk](https://banished-wiki.com/wiki/Hunting_Cabin#Risk) |

## 下一步优先的非灾难玩法

以下是按新增经营选择、现有系统复用和美术可见性排序的建议，**不是已开始实现或已交付的承诺**。后续开发先建对应 Issue，写清最小范围、旧档策略、美术及完成条件，再关联任务分支与 PR；不替已经合并的片段补造“事前跟踪票”。当前 #69 完成后再选下一片，不为填满表格重写已交付系统。

### 已完成的最小切片：两果树与果品酿酒

0.3.66按 [#69](https://github.com/LukeJiaoR/banish/issues/69) 补苹果/梨与真实果品配方，三营养组、旧树旧蔬菜合同保留；详见 [本片说明](fruit-brewing.md)。不再把这两个品种和原料选择重复排为新任务。其余六种果/坚果目录、第四营养组和面积扩展仍需独立范围决策。

### 已交付的下一片：面积牧场（F9）

0.3.67按 [#71](https://github.com/LukeJiaoR/banish/issues/71) 补新场矩形规划、密度容量、成本/用工和转场约束，旧场容量保全；见 [本片说明](pasture-area.md)。原围栏源码本已按宽高画段和入口，因此复用而非新造美术；新增真实区域畜群分布，不再把面积牧场重复排为新任务。

### 已交付的下一片：地图种子与困难开局（D1首片）

0.3.68按 [#73](https://github.com/LukeJiaoR/banish/issues/73) 补真实新局设置、种子0、现行/困难预设与小麦买种闭环；旧村设置未记录就如实显示，未最终确认不清理自动档。见[本片说明](start-settings.md)。不再把整个玩家种子入口排为缺失，简单预建村和原版全部难度仍是剩余范围。

### 已交付的下一片：可变果园树列（F7面积部分）

0.3.69按 [#75](https://github.com/LukeJiaoR/banish/issues/75) 补果园矩形、可复算树列、实际用工与旧9株合同保护。见[本片说明](orchard-area.md)。苹果梨可变面积已经覆盖，不再反复排同一功能；并不表示原版其余果/坚果品种已完成。

### 后续取舍：真实试玩问题优先，剩余玩法按明确闭环拆票

**已核可见问题：**人物劳作仍按任务固定挥工具或抱筐单帧，仅做上下轻动；这是已有反馈所述机械感的真实来源。后续若补帧，应沿原提示词锁同一角色、现17像素显示高、脚点和原透视，区分工具动作/采收动作；不重绘整套人物，也不把未复现的布局朝向问题先当bug修。

**真实玩法缺口仍保留：**移动鹿群/按狩猎小屋冷却、其余作物/果树目录、逐仓实物库存、山地隧道、地图/气候选择。不可把它们一口气扩成框架；气候需要真实霜期/冷伤/取暖差异与旧档保全，隧道先需真实山体。新预设标签没有这些规则就没有玩家价值。

下一片先查现有Issue和具体试玩证据，再选一个最小完整玩法。不得把本段候选当成已经启动或已经交付，也不因一个PR结束就宣称整个原版复刻完成。

## 暂不优先的边界与资料可信度

- **已交付的重点不再重排开发：**市场家庭补给、衣服穿戴/配送、个人工具、贸易订货与自动购买、森林/渔场约束、矿点耗尽、学校到课、礼拜堂、鸡牧场和半群扩场。可在真实试玩发现具体问题时另建修复票。
- **人口寿命不是缺失：**当前每历年长 1 岁导致代际跨度长，是实质适配；Wiki `Citizens` 同时写年龄倍率和不相符的季节换算。可单独核实后做可解释的节奏选择，但不在新增牧场/果树时暗改老村年龄、学校毕业或生育，避免把整个经济重新调平。
- **保留真实缺口，但先解依赖：**隧道需要山地；真实主河商船需要水路拓扑；逐仓本地库存会广泛影响现有工业、贸易和家庭配送。它们有价值，但应拆成有玩家收益的独立票，不能为“原版一模一样”一次性推翻可玩系统。
- **不要把旧概述当发布版精确规则：**[Farming](https://banished-wiki.com/wiki/Farming) 已明确澄清土壤退化没有实现；[Food](https://banished-wiki.com/wiki/Food) 的老概述与专门建筑页在产粮时序/过捕描述上不完全一致。采用对应玩法专页，并明确不确定处。住宅燃料和采集树龄的 Wiki 描述也有冲突，现有成本、产量、容量与日数一律以“本作适配”披露。
- **每片玩法配可见美术，验证跟范围走：**新增果品、围栏、地图差异应在实际状态里看得到。复用已合格原创素材；仅对受影响闭环做代码、存档、界面与实际绘制检查。文档存在、离线图片或 DOM 测试不等于真人浏览器/手机试玩，也不等于生产部署。

## 固定基线证据索引

源码覆盖以函数/字段实读为准。下列历史片说明用于解释设计决策，若其中“未做”段落与当前源码冲突，以本矩阵所指基线源码为准。

- 核心资源/时钟：[core.js][core]；建筑与生产定义：[defs.js][defs]；地图/放置/寻路：[map.js][map]。
- 模拟经济/人口/服务：[sim.js][sim]；家庭生活物流：[supply.js][supply]；住房消防：[fire.js][fire]。
- 新局/序列化/导入：[main.js][main]；实际菜单与确认操作：[ui.js][ui]；世界绘制：[render.js][render]。
- 本地缺少而已按固定 SHA 复核的说明：[生产目标][goals-doc]、[道路桥梁][transport-doc]、[市政厅游民][town-doc]、[逐树果园][orchard-doc]、[医疗][health-doc]、[半群扩场][split-doc]、[个人工具][tools-doc]、[家庭市场][market-doc]、[商人订货][orders-doc]、[自动购买][auto-doc]。

[core]: https://github.com/LukeJiaoR/banish/blob/6cfbe2d7f91d4a41fe3cc06caa3b6954d1fefdea/js/core.js
[defs]: https://github.com/LukeJiaoR/banish/blob/6cfbe2d7f91d4a41fe3cc06caa3b6954d1fefdea/js/defs.js
[map]: https://github.com/LukeJiaoR/banish/blob/6cfbe2d7f91d4a41fe3cc06caa3b6954d1fefdea/js/map.js
[sim]: https://github.com/LukeJiaoR/banish/blob/6cfbe2d7f91d4a41fe3cc06caa3b6954d1fefdea/js/sim.js
[main]: https://github.com/LukeJiaoR/banish/blob/6cfbe2d7f91d4a41fe3cc06caa3b6954d1fefdea/js/main.js
[ui]: https://github.com/LukeJiaoR/banish/blob/6cfbe2d7f91d4a41fe3cc06caa3b6954d1fefdea/js/ui.js
[supply]: https://github.com/LukeJiaoR/banish/blob/6cfbe2d7f91d4a41fe3cc06caa3b6954d1fefdea/js/supply.js
[fire]: https://github.com/LukeJiaoR/banish/blob/6cfbe2d7f91d4a41fe3cc06caa3b6954d1fefdea/js/fire.js
[render]: https://github.com/LukeJiaoR/banish/blob/6cfbe2d7f91d4a41fe3cc06caa3b6954d1fefdea/js/render.js
[goals-doc]: https://github.com/LukeJiaoR/banish/blob/6cfbe2d7f91d4a41fe3cc06caa3b6954d1fefdea/docs/resource-production-goals.md
[transport-doc]: https://github.com/LukeJiaoR/banish/blob/6cfbe2d7f91d4a41fe3cc06caa3b6954d1fefdea/docs/transport-expansion.md
[town-doc]: https://github.com/LukeJiaoR/banish/blob/6cfbe2d7f91d4a41fe3cc06caa3b6954d1fefdea/docs/town-hall.md
[orchard-doc]: https://github.com/LukeJiaoR/banish/blob/6cfbe2d7f91d4a41fe3cc06caa3b6954d1fefdea/docs/orchard-renewal.md
[health-doc]: https://github.com/LukeJiaoR/banish/blob/6cfbe2d7f91d4a41fe3cc06caa3b6954d1fefdea/docs/health-care.md
[split-doc]: https://github.com/LukeJiaoR/banish/blob/6cfbe2d7f91d4a41fe3cc06caa3b6954d1fefdea/docs/pasture-split.md
[tools-doc]: https://github.com/LukeJiaoR/banish/blob/6cfbe2d7f91d4a41fe3cc06caa3b6954d1fefdea/docs/personal-tools.md
[market-doc]: https://github.com/LukeJiaoR/banish/blob/6cfbe2d7f91d4a41fe3cc06caa3b6954d1fefdea/docs/household-market.md
[orders-doc]: https://github.com/LukeJiaoR/banish/blob/6cfbe2d7f91d4a41fe3cc06caa3b6954d1fefdea/docs/merchant-orders.md
[auto-doc]: https://github.com/LukeJiaoR/banish/blob/6cfbe2d7f91d4a41fe3cc06caa3b6954d1fefdea/docs/auto-trade.md
