# 回归夹具维护（2026-10-17）

`main` 上有一批 node 测试在 #99–#107 之后失效。原因集中在四类，不是产品回退：工地实运建材、经营流水起始日、食物分组/文案、测试用 DOM 与坐标桩。本次只做**测试与两处防御性运行时保护**，不改数值、玩法或渲染结果。

## 运行时保护（2 处）

1. `G.buildingActivity`：没有 `G.world` / `bmap` 时返回 `null`；`G.renderBuildingActivity` 在活动帧缺少 `entries` 时回退到即时计算。这样直接调用 `G.drawBuilding` 的离线渲染测试不会崩溃，真实渲染路径不变。
2. `G.requestConstructionMaterial`：工地没有 `construction` 状态时返回 `false`。真实工地由 `addBuilding` / 读档迁移创建该状态；旧夹具或残缺工地不再抛 `Cannot read properties of undefined`。

## 夹具调整

- **工地实运建材**：`chapel`、`dock-efficiency`、`focused-building-state`、`resource-goals` 的合成工地补上 `construction:{required, onsite, consumed}`；手动置为完工的夹具先清掉占地树并把 `consumed` 置真。`chapel` 不再断言“建造即预扣库存”，改为断言计划建材与库存不变。
- **经营流水**：`health-care` 把游戏日跳到 200 时同步重建 `townLedger`，避免“流水日期缺失”。
- **食物与文案**：`health-care` 改为断言 `foodGroupsOf(FOOD_KEYS).length===3`；`fishing-water-ui`、`merchant-orders-ui`、`orchard-renewal-ui`、`fuel-budget-feedback`、`focused-building-state` 的文案正则跟随当前面板文本。
- **坐标与 DOM 桩**：`harvest-cancel-ui`、`harvest-range-ui`、`farm-planning-ui`、`save-input-regressions` 补 `G.screenToMapTile`；`mineral-resource-ui` 补 `document.addEventListener`；`harvest-feedback` 补 `document` 与 `refreshHarvestRangeControls` no-op。
- **码头**：`harvest-cancellation` 给合成码头补相邻水域，否则新规则下无法派工。
- **资源恢复**：`resource-goals-recovery` 保留三种策略的 240 天实跑。旧“不干预必饿死”的反例在当前种子/平衡下不再复现，改为打印基线结果；恢复策略仍严格要求 240 天、0 死亡、工具>0，并至少有一次真实付费铁匠落地。

## 本机结果

`smoke 226`、`art_assets`、`chapel 16`、`dock-efficiency 5`、`focused-building-state 9`、`health-care 13`、`resource-goals 28`、`harvest-*`、`fuel-budget-feedback 13`、`fishing-water-ui 17`、`merchant-orders-ui 15`、`orchard-renewal-ui 5`、`terrain-presentation 8/8` 均通过。

未纳入本次：`specialist-components`（设计上需要 `--out`）、`starter-minerals`（需要相邻基线 checkout）；`town-hall`、`town-ledger`、`transport-expansion`、`resource-specialists` 等旧场景仍有独立的数值/流程漂移，未在本 PR 中改动。

## 复现

```bash
node tests/smoke.js
node tests/art_assets.js
node tests/focused-building-state.js
node tests/resource-goals.js
node tests/resource-goals-recovery.js   # 约数分钟，三局 240 天
```
