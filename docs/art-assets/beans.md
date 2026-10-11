# 原创豆类四阶段（0.3.52）

2026-10-11 使用 built-in imagegen 各生成一张早熟豆类阶段图，参考项目既有白菜、小麦与木屋素材，统一土色手绘、2:1地面视角、左上光和低矮植株比例。没有使用原版游戏版权贴图。

- `assets/props/bean_stage0.png`：四簇幼芽
- `assets/props/bean_stage1.png`：四簇年轻豆株
- `assets/props/bean_stage2.png`：开花、少量幼荚
- `assets/props/bean_ripe.png`：成熟绿色长豆荚

每张128×96 RGBA，四边全透明，游戏显示64×48、沿用农田底角居中锚点。没有地台或烘焙投影。保留生成器透明度，仅把完整1448×1086画布等比Lanczos缩小；无拆株、重画、换色或算法抠背景。四株根部跨阶段存在轻微位置变化，但实绘土面与比例相容。

以实际 `drawFarmGround`、`drawFarmCrop`、`sprDraw` 同场对照四阶段、相邻小麦/白菜/豆田与木屋；渲染选择/透明尺寸有定向测试。离线Canvas像素检查不等同浏览器或手机验收。
