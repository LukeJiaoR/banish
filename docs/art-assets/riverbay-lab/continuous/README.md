# 河湾结构修正版：草纹理叠加与连续水陆裁剪

状态：**隔离候选，保持 Draft，不启用正式入口；结构测试通过，不等于美术、当前版本浏览器或真机通过。**

基于 PR #109 用户验收提交 `07607c6d647ed391b22945ce3cf2c3fd8b3af342`。保留原 32×32 场景、种子、建筑、树、人物、道路、玩法与碰撞；`index.html`、`js/`、`assets/` 均未改。`browser/` 内验收文件和 8 张截图逐文件哈希与该提交相同。没有生成新图片素材或重新画草贴图，水 v2 仍为 #98 的同一文件。

## 修正内容

- 原版 `drawGroundTile` 始终调用。原 meadow 纹理之后，以 26% 透明度叠加低频色域；不再用不透明 `fillLow` 替换草地。低频场仍是一个可复用的 256×256 代码色域，不是新手绘素材。按区域填色，避免每格重复提交高倍率 pattern；开启岸线时，岸带先恢复原底纹再重叠一次，最终有效覆盖不累积。
- 水域沿边界形成闭环，包含地图边界及岛洞；与岸线共享同一组顶点、一次有界平滑及二次曲线连接。水域使用闭合多边形 even-odd 裁剪，陆域使用其反向区域；没有逐 tile 水/陆 mask。一次平滑保留窄渠、点接触及格中心归属，边界出口固定。
- 以连续线段带和圆接头限定重绘区域，先恢复草/水纹理，再画湿沙、浅水与稀疏泡沫，去除旧沙滩格残角。道路/岩石保留原 footprint；展示轮廓变化不写入碰撞、水数组或寻路。
- 继续复用原单张地面缓存，额外只有 256×256 色域。候选脏区先按整数缓存像素裁剪、清空，再重建局部和叠加，不累积透明层。暖帧不重建，16MP 上限不变。
- 增加共享同步计时器：buildGround 提交、首次/全部地面 drawImage 调用、其余 G.frame 时间，以及浏览器 setOptions 的控件、统计文本、resize 读布局等分段。缓存控件引用与 resize 后视口，跳过重复属性写入。所有时钟都标明同步调用边界，不能据此断言 GPU 或异步栅格完成。

## 同场景原生 Canvas A/B

以下为 `@napi-rs/canvas` 离线调用生产 `G.frame`，**不是浏览器截图、CDP 手机模拟或真机数据**。固定 scene/pose/camera，同尺寸同缩放比较。两次修正版渲染全部 14 张 PNG 字节相同。

- 桌面 1 倍：[原版](../evidence/desktop-z1-original.png)、[仅水 v2](../evidence/desktop-z1-water.png)、[连续水岸](desktop-z1-shore.png)、[纹理叠加 + 岸线 + 杂物](desktop-z1-study.png)
- 桌面 2 倍：[修正版近景](desktop-z2-study.png)
- 窄画布 1 倍：[原版](../evidence/phone-z1-original.png)、[完整修正版](phone-z1-study.png)

上面复用的 3 张原版/仅水图片与本轮重新渲染结果字节一致；其余缩放结果可用以下命令复现。完整报告包含桌面 1227×763、窄画布 390×620，在 0.75/1/2 倍下的原版/完整候选及桌面 1 倍的仅水/水岸，共 14 例、每例 30 暖帧：

```sh
node tools/riverbay-lab/render.cjs --out /tmp/riverbay-continuous
```

[本轮串行报告](native-canvas-report.json) 的 source 记录实际 terrain、controller/profiler、scene、runner、production renderer SHA-256。`base` 是未修改生产代码的历史基线，`candidateParent` 是用户验收父提交，不把工作树假称为已提交的测试版本。报告列出的其余 PNG 未重复提交，需上述命令生成。

### 实际观感与未通过项

已查看桌面 1/2 倍及窄画布：草的原笔触/纹理保留，水岸和岛边在本场景中连成曲线，没有初版逐格截断的菱形阶梯。**仍不宣布美术通过**：岸带颜色与宽度偏均匀，有人工等宽描边感；原草纹理本身的高频感和水 8 格重复仍在。此版解决结构错误，不能代替自然岸形设计、新手绘笔触或使用者审美确认。

## 测试与脏区证据

```sh
node tests/riverbay-lab.js
node --expose-gc tests/riverbay-lab.js --pixels
node tests/riverbay-lab-app.js
node tests/riverbay-lab-profile.js
node tests/ground-cache-budget.js
node tests/terrain-presentation.js
node tests/mountain-render.js
```

- 地表 14 组零依赖契约 + 4 组 native 像素，共 18 组通过。覆盖闭合 mask、内湖/岛洞、四边出口、点接触、窄渠、原草纹理调用、道路/岩石保护、连续带范围、开关、缓存、确定性、碰撞和路径不变。
- 真实原 meadow 图片的低频叠加后，测试采样区梯度细节能量比 **0.741**、梯度相关 **0.999**。这是特定区域/实现的结构性细节保留指标，不是“画风改善 74%”或通用视觉评分。全关闭恢复与生产像素完全一致。
- 51 次编辑（含临岸道路与清岩），每次重复局部修补 3 次，共 153 次均字节稳定。**实际 partial 写入矩形之外的像素变化为 0**；独立重复 full 也字节稳定。
- partial 对新 full 的局部参考误差，实测最大通道差 12、平均通道差 ≤0.1039，仍按原有 ≤32 / 不同像素≤局部 12% / 平均≤0.25 约束，没有放宽内部标准。
- 仅在远处岸带 AA 边缘，改变保护道路的复合 inverse clip 会使新 full 参考有最多 **8 像素、2 色阶**差异；关闭 shore 则无此差异。为此参考比较独立限 ≤16 像素、每通道≤2。该预算不适用于实际 partial 越界写入，后者仍必须为 0；不声称 partial/full 完全像素相同。
- 控制器 9 组、同步计时器 8 组通过；现有地面缓存预算、地表 8 组、山体 10 组回归通过。128/192/256 的 16MP 缓存上限保持，不表示这些都是开放给玩家的地图尺寸。未运行全套经济回归。
- 独立结构审查全枚举 512 种 3×3 水陆组合，闭合区域面积、岛洞、边界及 shore/mask 曲线一致；无结构阻断。源码语法与 diff 检查通过。

## 性能：有分段证据，冷切换仍未过关

本轮串行 native 报告中，桌面 1 倍完整候选整个同步 G.frame 调用 **122.942ms**。计时器内部帧段为 **122.579ms**：buildGround 提交 **35.557ms**，首次地面 drawImage 调用约 **85.2ms**，其余 G.frame 约 **1.8ms**；外层差值含包装/记录开销。旧 terrain 自计时 coldBuildMs=35.515ms，不能与新提交段混同。完整候选各尺寸/缩放冷帧 **121.2–155.4ms**，暖帧 P95 **1.47–3.10ms**，14 例均为 0 暖帧重建。缓存 1448×751，额外色域 65,536 像素。

同一套新计时器另测 [07607c6 的旧 terrain](terrain-07607-profile.json)，不是旧版完整 browser controller：桌面 1 倍旧 terrain 同步帧 181.294ms、构建 64.570ms。两次串行观察顺序不同、共用 VM，不能据此宣称稳定提速。首轮修正版测量曾与轻量回归交叠，[原始报告](initial-shared-vm-profile.json) 保留：有 443.568ms 冷帧及 127.049ms 暖 P95 离群，随后停止并行回归单独重测；这些波动不能掩盖为性能已达标。

尤其不能把 native 的 drawImage 同步耗时直接归因为浏览器 GPU 栅格。用户在 `07607c6` 的真实 Chromium 首次切换 **236–283ms**、buildGround **2–9ms**、暖 P95 约 **0.6ms** 的记录仍有效；修复版本轮已补测，见下节。

## 浏览器复测（修复版，2026-10-18）

真实 Chromium 桌面 1215×751 DPR1 / CDP 390×620 DPR2 已复测四预设、开关、拖动和 0.75/1/2。旧版记录仍保留在 [用户验收](../browser/browser-acceptance.md)，未覆盖；本轮记录与截图在 [browser-fixed](../browser-fixed/browser-acceptance-fixed.md)。

- 草地：原 meadow 绘制始终执行，26% 低频色域叠加后原纹理仍在；不再出现纯色平地。
- 岸线：连续多边形裁剪生效，2 倍近景与岛屿边连成曲线，初版的菱形阶梯/三角缺口消失。等宽岸带与旧草高频感仍在，美术未签字。
- 首帧：完整候选首次切换 32–48ms（0.75/1/2 为 31.9/40.6/32.3ms），水+岸 26.5–28.0ms，仅水 27.9ms；同一台机器上一版为 236–283ms，约 6 倍改善。暖帧 p95 0.7ms。48ms 在 60fps 下仍约 3 帧卡顿，不能宣称零卡顿。
- 未验：30 秒以上平移/缩放 P95、实体手机热量/触摸/帧率、美术方向确认。继续保持 Draft。

控制台 `window.riverbayLab.metrics().profile` 提供 frames 与 operations；取最新 `setOptions` 的 `totalSyncMs`、`sections`，首次冷切换与稳定暖帧分开报告，不用仅 buildGround 数字代表整帧。
