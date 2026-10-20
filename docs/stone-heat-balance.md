# 首批生存平衡：石屋供暖效率纠偏

本片从 `9c521bf` 起，只改一个实际经济参数：石屋整冬柴火 **15 → 20**。木屋30、宿舍75、每人每年100食物、食物产量、死亡条件、家庭上限8、果园成熟年限均不改。不是“整体数值平衡全部完成”，也不是让首冬保证零死亡。

## 依据和取舍

[官方Mod Kit下载页](https://shiningrocksoftware.com/game/mods/)与[1.0.7发布说明](https://shiningrocksoftware.com/2017-09-13-1-0-7-released/)。核对Kit 1.0.7 Build170910中的 `resource/Template/WoodHouse.rsc` 与 `StoneHouse.rsc`：`_temperatureForFuel` 同为50，`_fuelPerResource` 分别60、90。同样热需求下，石屋耗量是木屋 **60/90 = 2/3**，不是原实现的一半。因此保留本作木屋30的季节预算，把石屋改为20。原版随温度烧燃料，本作集中12天冬季；不把固定20/30声称为原版全年实测。

所核对ZIP SHA-256：`615d75d111be843c48af2c1544e2a01aea317e26305ec8087b199cf9504ae964`。石屋模板SHA-256：`488e6b8143ec45154b5e38044e9ed2a1c869759df1f42e2ab88237a8ac0d81d2`。不复制官方资产进项目。

这减弱了石屋的过大省柴收益，使升级后仍需稳定伐木和运输。每屋每冬省柴由15降为10；普通工人3柴/木时，理论节省原木5降为10/3，实际整批生产和运输另见下表。原地升级净补16木、36石、10铁、120施工工时不变；单看补入16木的节柴折抵由约3.2冬变成4.8冬，**不计石铁与建造/运输劳动，不能称完整投资回本期**。首冬缺粮更不能靠石屋升级解决。

官方住宅容量5与本作8也有差别，本轮只更正“8是原版”的错误说明，不迁移既有家庭、不挤走旧住户。粮食与住房需要单独处理劳动分配、早期扩张以及旧家庭兼容，未凭单个失败脚本一并调低难度。

## 实际供暖、加工与入库对照

`tests/stone-heat-balance.js`：同种子5、同位置五户、初始50柴/100木、同一个近仓伐木屋目标50，运行完整12天冬季。**隔离fixture预置五栋成屋、仓库、人口与库存，不是从零建村生存测试。** 此后取木、加工、运输入库、扣柴均用游戏原流程；每次真实入库量从 `deposit` 返回值计，不用配方年产冒充实产。

| 五户同策略 | 修改前 | 修改后 |
|---|---:|---:|
| 石屋实际烧柴 | 75 | 100 |
| 石屋所需实际入库柴 | 78 | 102 |
| 实际取用原木 | 26 | 34 |
| 实际加工小时（不含走路/休息） | 45.5 | 59.5 |
| 实际入库次数 | 13 | 17 |
| 冬末公共柴 | 53 | 52 |
| 冷屋日/死亡 | 0/0 | 0/0 |
| 木屋对照烧柴 | 150 | 150 |
| 木屋对照入库/取木/加工小时 | 150/50/87.5 | 150/50/87.5 |

另一相同五石屋fixture，只有75柴且不建伐木屋：前后均实际烧完75；冷屋日从0增至15（末三天五户），两边0死亡。**冷屋日不等于冻死人日**；当前短窗口不能据此声称冻死人数增加。

## 真实开局正反对照

当前版本同种子5/49、同 `first-winter-controls baseline` 普通玩家策略运行48天，无免费建造或资源。前后结果一致：

- 种子5：15人、0死，期末食物468.8/柴98，三木屋在13/19/24日完成。
- 种子49：18人、0死，期末食物392.1/柴104，三木屋在13/18/23日完成。
- 两种子均尚有两户无房；这里的 `coldHouseDays=0` 只计冷屋，**不意味着无人露宿或受冷**。本片没有解决这两户的安居问题。
- 负策略 `neglect`：两个种子均第20天15人饿死灭村。
- 冻结历史 `original` 策略：种子5第39天16人饿死灭村；种子49首年2人饿死、末14人。没有抹去失败策略的死亡。

这些开局没有石屋，结果相同只说明木屋开局/粮食没有旁改，**不能验证石屋新耗柴**；供暖改动由上面的实耗实验直接覆盖。这里不把历史original脚本称为最佳策略，也不从其失败推断玩家无解。

完整按日供暖账单、源码哈希、开局策略哈希与正反记录：[JSON](stone-heat-balance-results.json)。

## 旧档和当前冬季

- 所有石屋，包括旧档已有石屋，下一次冬季每日结算按20/12柴计算；不赠资源、不修改建筑材料或住户。
- 历史已付账单15/12保持原样，包括当日已经得到的暖屋状态。加载、再次保存/加载不重复扣款、不补差额、不退款；下一次冬季日结才替换成20/12。不是让整个当前冬季沿用15。
- 原校验器要求历史账单等于当前参数，直接改参数会拒绝合法旧档。本片仅额外接纳石屋已知历史15/12值，仍校验冬季日期、实际柴/煤、上限与非负；任意16/12等值继续拒绝。
- 自动供给与真实配送的旧账单均覆盖；公共/户内库存不因加载改变。供暖预算、改建面板与住户实际扣柴都读同一新参数。

## 复现与验证边界

```sh
node tests/stone-heat-balance.js --root ../banish-balance-baseline --json /tmp/stone-before.json
node tests/stone-heat-balance.js --assert --json /tmp/stone-after.json
node tests/first-winter-controls.js --root ../banish-balance-baseline --years 1 --seeds 5,49 --scenarios baseline --json /tmp/opening-before.json
node tests/first-winter-controls.js --years 1 --seeds 5,49 --scenarios baseline --json /tmp/opening-after.json
node tests/playability.js --root ../banish-balance-baseline --years 1 --seeds 5,49 --strategies neglect,original
node tests/playability.js --years 1 --seeds 5,49 --strategies neglect,original
```

baseline目录为 `git worktree add --detach ../banish-balance-baseline 9c521bf`。首冬与失败策略是开发观察，不是产品全验gate；本片没有新增美术，没有浏览器/实体手机验收或生产部署。

本片针对检查已执行：stone-heat-balance（含8种旧账单组合）、house-upgrade 17、house-upgrade-ui 20、coal-heating 12、coal-heating-ui 7、fuel-budget-feedback 13、fuel-input 15、household-supply-lifecycles 36、save-input-regressions 28、smoke 226；修改的四份生产JS语法与 `git diff --check` 通过。UI检查为DOM/运行模拟，不冒充浏览器验收。
