# 美术资源清单（供 AI 生成）

对应游戏现有实体（`js/defs.js`）。当前全部为 Canvas 程序化绘制，替换为精灵图时改 `js/render.js` 的 drawTree / drawBuilding / drawCitizen / drawGroundTile 即可。

## 统一规格（所有资源通用）

- **投影**：等距 2:1（dimetric），瓦片菱形 = 宽:高 = 2:1。
- **光源**：左上受光、右下背光（现引擎左墙亮 `wall`、右墙暗 `wallD`，保持一致）。
- **格式**：PNG 透明背景（地表纹理除外，为不透明可平铺图）。
- **不要烘焙投影**：人物/树的椭圆阴影由引擎绘制。
- **2 倍尺寸生成**：游戏内按 50% 缩放绘制，边缘更干净。
- **锚点**：建筑/树/作物 = 画布底边中心为「脚点」；人物 = 底边中心为双脚。
- **色板锁定**：生成时尽量贴合 `js/defs.js` 里的 `G.PAL`（春夏秋冬四套色板），关键色：春草 `#74a85a`、夏草 `#6a9c4e`、秋草 `#a09055`、冬雪 `#dfe4e8`、水 `#4d80ad`、土路 `#8d7355`、耕地 `#6b4f33`。

## 全局风格提示词模板

每次生成套用这个前缀（英文对多数生成器更稳）：

```
isometric game asset, 2:1 dimetric projection, cozy medieval frontier village
style like Banished, hand-painted stylized, soft natural light from upper left,
muted warm earthy colors, single object, centered, clean transparent background,
no baked shadow, no ground plane, no watermark
```

地表纹理把「single object」换成：`seamless tileable texture, flat top-down, uniform lighting`。
负向词：`text, background scene, isometric ground, drop shadow, blur`。

---

## 1. 地表纹理 —— 必做 18 张

**做法**：生成**正方形无缝可平铺纹理**（不是菱形），引擎用菱形路径裁切填充，这是对 AI 生成最友好的方式。统一 256×256。

| 文件名 | 数量 | 要点 |
|---|---|---|
| `tiles/grass_spring.png` | 1 | 短草地，点缀小花草，色 `#74a85a` 系 |
| `tiles/grass_summer.png` | 1 | 饱和度略高的绿 `#6a9c4e` 系 |
| `tiles/grass_autumn.png` | 1 | 枯黄绿 `#a09055` 系，少量落叶 |
| `tiles/grass_winter.png` | 1 | 积雪覆盖，近白 `#dfe4e8`，隐约露出草茎 |
| `tiles/grass_{season}_b.png` | 4（可选） | 每季第二变体，打破平铺感 |
| `tiles/sand_spring/summer/autumn.png` | 3 | 沙滩/河岸 `#cdbd8e` 系 |
| `tiles/sand_winter.png` | 1 | 雪盖沙地，接近冬草但略暗 |
| `tiles/water_spring/summer/autumn.png` | 3 | 平静水面 `#4d80ad` 系，细微波纹 |
| `tiles/water_winter.png` | 1 | 冬季灰蓝水面 `#7fa3bd`，可带薄冰纹 |
| `tiles/road_spring/summer/autumn.png` | 3 | 压实土路 `#8d7355` 系，碎石纹理 |
| `tiles/road_winter.png` | 1 | 雪盖土路，带脚印/车辙 |
| `tiles/farm_soil.png` | 1 | 翻耕农田，平行犁沟 `#6b4f33` |
| `tiles/farm_soil_snow.png` | 1 | 雪盖耕地，犁沟隐约可见 |

> 岸线（水陆过渡）现由引擎描边画，无需素材；如想升级，可选做 4 个方向的岸边泡沫条（各 256×64）。

## 2. 植被与岩石 —— 必做 10 张

透明 PNG。锚点 = 底边中心。现引擎里成树约 22×33px（显示尺寸），生成内容按 2 倍（约 44×66px）即可，画布 128×128 留余量。

| 文件名 | 尺寸 | 数量 | 要点 |
|---|---|---|---|
| `props/tree_sapling.png` | 128×128 | 1 | 幼苗：细干+单层小树冠（常青松树） |
| `props/tree_young.png` | 128×128 | 1 | 二层塔形松树 |
| `props/tree_mature.png` | 128×128 | 1 | 三层塔形成材松树，深绿 `#2f6e37~#3b7534` |
| `props/tree_young_snow.png` / `tree_mature_snow.png` | 128×128 | 2 | 冬版：枝层顶部积雪白 `#e8edf2` |
| `props/tree_sapling_snow.png` | 128×128 | 1 | 冬版幼苗 |
| `props/rock_a.png` / `rock_b.png` | 128×96 | 2 | 地表岩石露头，灰 `#9a9a94`，两种形状 |
| `props/rock_a_snow.png` / `rock_b_snow.png` | 128×96 | 2 | 冬版顶部积雪 |

> 可选：阔叶树 3 阶段（春夏绿/秋黄/冬枯枝）×3 = 9 张，用于森林多样化。

## 3. 农田作物 —— 必做 5 张

每张对应一块农田瓦片上的作物丛（4 小丛植物），透明 PNG，128×96，锚点=底边中心对准瓦片中心。

| 文件名 | 数量 | 要点 |
|---|---|---|
| `props/crop_stage0.png` | 1 | 刚播种：稀疏小绿芽 |
| `props/crop_stage1.png` | 1 | 青苗半高 `#5d8a3a` |
| `props/crop_stage2.png` | 1 | 植株转黄 `#c2a13a` |
| `props/crop_ripe.png` | 1 | 成熟金黄麦穗 `#d8b23a`，饱满 |
| `props/crop_dead.png` | 1 | 冻死/枯萎：灰褐枯秆倒伏 |

## 4. 建筑 —— 必做 9 张 + 可选冬版

透明 PNG。2×2 建筑画布建议 320×256（内容：菱形底座宽 256px + 屋顶向上 ~90px）；3×3 建筑画布 448×320（底座宽 384px）。锚点 = 菱形**最下角**对准画布底边中心。

| 文件名 | 底座 | 数量 | 要点 |
|---|---|---|---|
| `buildings/house.png` | 2×2 | 1 | 木屋：原木墙 `#8a6242`、红棕屋顶 `#8f4433`、石砌烟囱、暖黄小窗 |
| `buildings/storage.png` | 3×3 | 1 | 谷仓：灰木大屋顶 `#5c5648`，门口可堆麻袋木箱 |
| `buildings/gatherer.png` | 2×2 | 1 | 采集小屋：绿屋顶 `#5d7040`，挂篮筐、草药束 |
| `buildings/forester.png` | 2×2 | 1 | 护林小屋：深绿屋顶 `#4a6b3a`，旁立斧头+苗木 |
| `buildings/woodcutter.png` | 2×2 | 1 | 伐木屋：棕屋顶 `#7a5230`，旁堆原木+劈柴墩 |
| `buildings/dock.png` | 2×2 | 1 | 渔码头：水上木平台+小板屋 `#8a5a3a`，水桶/渔网/钓竿，**底座下不画水** |
| `buildings/school.png` | 3×3 | 1 | 学堂：蓝灰屋顶 `#4a5a6b`，带小钟楼/书桌窗 |
| `buildings/site_2x2.png` | 2×2 | 1 | 工地：木桩脚手架+地基轮廓（进度条引擎画） |
| `buildings/site_3x3.png` | 3×3 | 1 | 同上，大号 |

**可选冬版**（屋顶积雪+门口雪堆，优先做木屋和学堂）：`house_winter.png` 等 ×7。
**可选点缀**：原木堆 / 石堆 / 柴火堆小道具 ×3，可摆在相应建筑旁。

## 5. 人物 —— 必做 20 张

透明 PNG，画布 64×64（显示约 17px 高，2 倍生成），锚点=底边中心双脚。中世纪村民风：粗布衣 `#6e4a33`、肤色 `#d8a37a`。儿童 = 同造型 72% 缩放（引擎缩放），**无需单独生成**，但动作帧少一些。

| 文件名 | 数量 | 要点 |
|---|---|---|
| `citizens/adult_walk_{0..3}.png` | 4 | 行走 4 帧循环（左右腿交替+轻微上下） |
| `citizens/adult_work_{0..1}.png` | 2 | 劳作 2 帧：弯腰挥斧/锄 |
| `citizens/adult_carry_walk_{0..3}.png` | 4 | 背/扛重物行走 4 帧（身体前倾） |
| `citizens/adult_idle.png` | 1 | 站立 |
| `citizens/adult_carry_idle.png` | 1 | 扛物站立 |
| `citizens/child_walk_{0..3}.png` | 4 | 儿童行走（更矮更圆润） |
| `citizens/child_idle.png` | 1 | 儿童站立 |
| `citizens/carry_wood.png` / `carry_stone.png` / `carry_food.png` / `carry_firewood.png` | 4 | 肩扛物小精灵（叠在人物旁）：原木捆/石块/食物袋/柴火捆 |

> 可选：换色即可做发色/衣服变体，无需分别生成；睡觉状态引擎淡显站立帧。

## 6. 资源与工具图标 —— 必做 14 张

透明 PNG，128×128（HUD 显示 ~20px），中心构图，物体占画布 ~70%。

| 文件名 | 数量 | 要点 |
|---|---|---|
| `icons/res_wood.png` | 1 | 原木堆 `#b08850` |
| `icons/res_stone.png` | 1 | 石块堆 `#b8b8b8` |
| `icons/res_food.png` | 1 | 食物（肉+谷物袋组合）`#e0705a` |
| `icons/res_firewood.png` | 1 | 柴火捆 `#e8a33d` |
| `icons/tool_house.png` | 1 | 木屋图标（可与建筑图同风格，简化） |
| `icons/tool_storage.png` / `tool_gatherer.png` / `tool_forester.png` / `tool_woodcutter.png` / `tool_dock.png` / `tool_school.png` / `tool_farm.png` / `tool_road.png` | 8 | 对应建筑的简洁图标 |
| `icons/tool_demolish.png` | 1 | 拆除：锤子+叉/废墟 |
| `icons/alert.png` | 1 | 悬停无工人的警示标（感叹号三角） |

## 7. UI 底材与特效 —— 全部可选

| 文件名 | 尺寸 | 要点 |
|---|---|---|
| `ui/wood_panel.png` | 256×256 可平铺 | 深色木纹 HUD 底板（现 style.css 用渐变模拟） |
| `ui/smoke_{0..2}.png` | 64×64 ×3 | 炊烟软粒子（现用圆绘制） |
| `tiles/water_anim_{0..2}.png` | 256×256 ×3 | 水面 3 帧循环动画 |
| `cover/title.png` | 1920×1080 | 主界面/分享用标题图：河谷小镇全景 |

---

## 数量小结

- **必做 ≈ 76 张**：地表 18 + 植被岩石 10 + 作物 5 + 建筑 9 + 人物 20 + 图标 14。
- **可选 ≈ 32 张**：冬版建筑、草变体、水动画、UI 木纹、标题图等。

## 生成顺序建议

1. 先生成 **1 张建筑 + 1 棵树 + 1 个人物** 确认风格，把满意图作为后续生成的参考图（垫图）。
2. 地表纹理（量大但 prompt 简单，换季换色即可）。
3. 建筑全套 → 树木 → 人物动作帧（人物最难，放最后，或考虑用一致角色参考图锁定形象）。
4. 图标最后做，可直接从建筑成品图缩放裁切。

## 目录约定

```
assets/
  tiles/      地表纹理（不透明，可平铺）
  props/      树/岩石/作物
  buildings/  建筑与工地
  citizens/   人物帧与搬运物
  icons/      资源与工具图标
  ui/         界面底材
```
