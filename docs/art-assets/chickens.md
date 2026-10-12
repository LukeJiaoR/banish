# 鸡牧场：母鸡与鸡蛋素材

生成日期：2026-10-12。用于原版玩法补全中的鸡牧场，新增文件仅为两张 PNG 与本文，不替换历史资源。

## 交付与接入尺寸

| 文件 | 原图方式 | 最终尺寸 | 建议显示尺寸 | 说明 |
| --- | --- | --- | --- | --- |
| `assets/props/chicken.png` | 内置 imagegen 独立生成 | 64×64 RGBA | 宽 16px，高 16px | 暖白/赭棕母鸡，朝左下，脚点使用底边中心 |
| `assets/icons/res_eggs.png` | 内置 imagegen 独立生成 | 128×128 RGBA | HUD 20×20px | 五枚完整鸡蛋的小编篮，不复用肉图标 |

原始生成结果均为 1254×1254 RGBA。母鸡仅对整张画布用 Lanczos 等比缩小为 64×64；鸡蛋篮仅对整张画布等比缩小为 100×100，居中放入 128×128 透明画布，以保留约 73% 的物体宽度。没有用程序重画轮廓、改色、伪造透明、填补像素或合成其他物体。原始 alpha 被保留。

## 风格来源与参照

生成前完整阅读 `docs/art-assets.md` 的原始规格与全局提示词。统一沿用暖土色手绘中世纪村落、2:1 dimetric、左上光源、透明背景、无地台、无烘焙投影。以同一基线提交 `0d5b6a6ae4d0ce193186ce5552a0ea405621a187` 中的实际 PNG 为视觉参照：

- `assets/props/sheep.png`，blob `7f41f30eb53a41aafb549e41ce5f5287b3f38031`，显示宽 24px
- `assets/props/cattle.png`，blob `4d3b3ac5625c0bbeef68e0a13667b255013d7744`，显示宽 32px
- `assets/icons/res_meat.png`，blob `279afcbf7febea0150ed943009a06a6430f2336b`
- `assets/icons/res_wool.png`，blob `cbb446a7c3c19c6e4513383d60e1f62e0294d7c6`

参照文件通过 GitHub connector 在固定提交下取得，核对返回 blob SHA 后实际查看。参照只用于理解风格，新增资产分别独立生成，不从旧图切取或程序绘制。

## 实际生成提示词

### 母鸡

```text
Use case: stylized-concept. Asset type: a single original hen sprite for Banish, a cozy medieval frontier village game. isometric game asset, 2:1 dimetric projection, cozy medieval frontier village style like Banished, hand-painted stylized, soft natural light from upper left, muted warm earthy colors, single object, centered, clean transparent background, no baked shadow, no ground plane, no watermark. Subject: one small adult laying hen, full body, facing down-left in a three-quarter dimetric view; a rounded warm ivory cream body with restrained ochre-brown feathers, a small terracotta red comb and wattle, pale amber beak, a short raised chestnut tail, two simple thin ochre legs with both feet clearly visible. Natural modest body proportions, no anthropomorphism. Style: painterly dimensional rustic game sprite with a gently defined brown contour, soft broad feather shapes, clean compact silhouette, slightly darker lower-right side, matching classic hand-painted sheep and cattle sprites. The head, comb, pale body, and tail must remain recognizable when the WHOLE canvas is shown at just 16 pixels wide. Composition: square transparent canvas, hen fills about 86 percent of width; two feet lie near the lower center with the lowest foot point at roughly 96 percent canvas height, centered close to x=50%; keep 3 percent clear alpha margin beneath toes and 5 percent at sides. No other objects. Preserve real alpha transparency, including between the legs. Do not draw any ground, straw, grass, contact shadow, drop shadow, scenery, base, platform, labels, letters, eggs, basket, or watermark. Do not make a flat vector icon, sticker, plastic 3D toy, photoreal photo, or pixel art.
```

### 鸡蛋篮

```text
Use case: stylized-concept. Asset type: a single original chicken egg resource inventory icon for Banish, a cozy medieval frontier village game, to be downscaled to a 128x128 transparent PNG and displayed at 20 pixels. isometric game asset, 2:1 dimetric projection, cozy medieval frontier village style like Banished, hand-painted stylized, soft natural light from upper left, muted warm earthy colors, single object, centered, clean transparent background, no baked shadow, no ground plane, no watermark. Subject: one small low oval rustic wicker gathering basket holding exactly five large recognizable whole chicken eggs, three ivory-cream eggs and two light warm buff eggs. Eggs dominate the icon and are clearly individual simple oval egg shapes, nested visibly above the rim. The basket is honey ochre and warm brown woven willow, low sides, no tall handle, compact broad readable weave, a few pale straw strands INSIDE the basket only. Style: painterly dimensional medieval resource icon with softly dark brown contour and broad economical strokes, upper-left egg highlights and restrained lower-right shading, matching hand-painted wool-ball and roast-meat game icons in the same warm earth palette. Composition: square canvas; the basket and eggs together take about 73 percent of canvas width and 68 percent height, centered with generous truly transparent margin. The icon must still read as EGGS IN A SMALL BASKET at only 20 pixels square. Real alpha transparency. No chicken, meat, cooked food, plates, cloth, spilled straw, other produce, ground, base, shadow, background scene, text, letters, watermark, white matte, checkered pattern, sticker border, flat vector or plastic 3D rendering.
```

## 像素与视觉验收

- 母鸡：64×64、RGBA、7276 bytes。完全透明像素占 49.39%；alpha≥16 的内容范围为 `(5,1)–(60,63)`，坐标为左闭右开。下部双脚范围约 x=20…42、y=55…62，脚点中心 x≈31，与画布底边中心 x=32 一致；16px 显示时最后可见脚趾距底边约 0.25px，无需额外锚点补偿。
- 鸡蛋篮：128×128、RGBA、15172 bytes。完全透明像素占 68.74%；alpha≥16 的内容范围为 `(17,29)–(111,99)`，物体宽度约占画布 73.4%。主体居中，五枚浅色鸡蛋与篮缘可分辨。
- 在夏草 `#6a9c4e`、米白 `#f4eee0`、暗灰 `#25282a` 上实际合成查看，确认透明区域正确、没有白底或棋盘格、无明显彩边、没有地面/底座/烘焙投影。
- 实际尺寸对照：母鸡按 16px、羊按 24px、牛按 32px 同时绘制；鸡显著小于羊、牛，脚底对齐，无悬浮感。另查看 2 倍最近邻放大用于检查轮廓。
- HUD 对照：鸡蛋篮、肉、羊毛均按 20×20px 显示并查看 3 倍最近邻放大，鸡蛋篮通过浅色蛋群+深暖篮缘形成独立辨识，不被误作肉块。
- 代码接入与实际游戏回归由同一玩法改动完成；本文验收覆盖资产本身及按游戏尺寸绘制的对照，不冒充完整游戏运行验证。
