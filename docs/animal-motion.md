# 小动物动态修正

牧场牛、羊、鸡此前按固定脚点绘制，完全没有行走表现；野鹿虽每游戏日换一个合法栖息地格，日内仍是静态图片。

本次在原素材上增加轻量的局部移动、朝向和步态起伏。牧场脚点留在围栏内，面积牧场避开棚屋占地；鹿仅在当前真实栖息地格内活动，按视觉脚点排序遮挡。保留原来每日真实移格、猎人认领锁定、真实走近猎物、繁殖、数量、产量及搬运规则。这不是新增动物寻路或逐腿动画，也没有新增美术素材。

动态使用已保存的游戏日/小时，不用墙钟、不消费随机数、不写入模拟状态。暂停保持姿态，继续后随游戏速度推进；读档恢复同一游戏时刻的姿态。系统“减少动态”偏好关闭该动态。旧档无需迁移。

## 验证

- `node tests/animal-motion.js`：7组，三物种日内移动、围栏和棚屋边界、鹿同格活动与视觉深度、暂停/恢复/速度与帧数无关、午夜连续、真实模拟推进、三物种实放养序列化/读档、减少动态与模拟不变。
- `node tests/deer-hunting.js`：22项，通过。
- `node tests/deer-hunting-render.js`：4组，减少动态时原静态绘制合同，通过。
- `node tests/cattle-pasture-render.js`、`node tests/chickens-render.js`：通过。
- `node tests/pasture-work-phases.js`：14项；`node tests/pasture-capacity-birth.js`：13项；`node tests/pasture-care-priority.js`：17项，通过。
- 实际生产 Canvas 绘制函数、现有 PNG 原素材多帧对照，检查局部位移、朝向和原图未裁切；不宣称真实浏览器或手机验收。

基线 `985a6a2` 同样失败、非本次新增：`pasture-area.js` 的旧档无效数据期望异常；`pasture-area-render.js` 的预览只读断言；`pasture-pests-render.js` 的 fixture 缺 `G.isHarvestTool`。未把这些失败计为通过。
