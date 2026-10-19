# 固定8×8农田：交互候选与验证

基于 main `9dd4aac7b1962ff55031d293b54a8525e30a6d1a`，2026-10-19。

## 变化与边界

- 新农田与现有固定果园/牧场一样点按落地；固定8×8，免费，先清场并完成12基础施工工时。可连续在合法位置建造，无需选两角或拖框。
- 新农田仍写入 `farmSize:[8,8]`，完工后初始2农夫、最大4；施工期间沿用最多4建筑工。最近可用地块调度不变。
- 保留全部面积数据与API，旧无size农田仍8×8/默认4人/旧遍历；旧面积农田、果园、牧场的尺寸和状态不迁移。
- 未改模拟、产量、成熟周期、材料、死亡、开局、资产或存档格式。小麦仍14/格，满收理论896不是保证实际入库。没有农业等级系统，也未宣称数值平衡已完成。
- 触摸复用固定果园/牧场输入；鼠标按下也保存工具、世界、游戏与版本快照，松开时严格复核：移动、多指、touchcancel、Escape、换工具/世界/游戏、弹窗、失焦/隐藏、输入框打断均不误建。选工具时拖动只取消这次放置，不新增拖动平移行为；原有无工具单指平移不变。
- 两角入口关闭，旧规划函数/隐藏面板保留但不可创建新工地，避免扩大其他使用相同辅助函数的规划模块改动。

## 离线验证

已通过：
- `node tests/farm-planning.js`：13组。新固定、旧入口无副作用、新建快照与现行8×8面积API完全相等、实际清树施工后2农夫、默认旧田、最小/最大面积档、坏档原子拒绝、最近地块调度与存读、抢收、跨季收获、三次载入携货守恒。
- `node tests/farm-planning-ui.js`：29组，生产鼠标/触摸绑定、连续/重复点按与中断、老档详情。
- `node tests/fixed-farm-preview.js`：实际frame预览只读、与落地同位置同8×8规格，取消后幽灵消失。
- `node tests/farm-planning-render.js`：旧矩形绘制辅助的隔离测试，测试内显式启用旧入口；不代表运行时恢复拖框。
- `node tests/pasture-area-ui.js`、`node tests/orchard-area-ui.js`：各29组。
- `node tests/orchard-area.js`（11组）、`node tests/orchard-renewal.js`（15组），覆盖旧面积果园实运养护/收获与保存、真实5年历法。
- `node tests/simple-fields-save.js`：固定工地与旧大面积牧场/果园两次存读，容量/牲畜/树木不变。
- `node tests/placement-ux.js`、`node tests/build-affordance-ui.js`。
- `node tests/workforce-controls.js`（20）、`node tests/workforce-controls-ui.js`（14）、`node tests/construction-staffing.js`（10）。
- `node tests/crop-seeds.js`（15）、`node tests/early-beans.js`（11）、`node tests/cold-squash.js`（16）、`node tests/early-harvest.js`（14）、`node tests/farm-pests.js`（12）、`node tests/personal-tools.js`。
- 修改的main/ui/render语法检查及 `git diff --check`。

已观察到两项基线失败，候选和原main均复现：
- `node tests/farm-occlusion.js`：第18行 `calls.includes('house')` 失败；本次未修改建筑绘制逻辑。
- `node tests/pasture-area.js`：水面篡改存档应拒绝的用例失败；本次未修改地图和存档验证。

这些失败不计为通过，也未为凑通过而移除断言。完整日志由执行方保留，后续审查需决定是否另开修复。

本报告为离线契约/模拟验证，不是浏览器像素或真手机试玩，不是全量CI；尚未发布。数值平衡需要另做同劳力、同物流、多年实际入库对照。
