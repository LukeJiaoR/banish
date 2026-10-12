# 苹果与梨：既有树图复用和新增果品素材

版本0.3.66，2026-10-12，关联 [Issue #69](https://github.com/LukeJiaoR/banish/issues/69)。

## 参照与不变部分

生成前完整阅读 `docs/art-assets.md` 原始规格和全局前缀，实际查看固定基线 `af087371014d4c06f7afaaeec93b3279bc939e9f` 的图像：
- `assets/buildings/orchard.png`，blob `77a004a8b64869e3cdfd1d4faf5603ccdb945290`。红色圆果树已是苹果外观，苹果与旧通用树继续复用此原创资产，字节不变。
- `assets/props/orchard_leafy.png`，blob `fe27c215b7e934b377343d87b51954c785dc66a3`。苹果采空/幼树沿用此图，字节不变。
- `assets/icons/res_vegetables.png`，blob `b5c51c0e0630e6778aad9bc70906fabd9b615a72`；`res_eggs.png`，blob `64f6f77fe604ee63d7da5073bda7076f8fde987c`，用于20px资源图标的视觉重量对照。

参照经固定SHA读取并核Git blob SHA，再实际查看。没有重绘全套或覆盖合格资产。旧树继续产蔬菜的合同不因复用苹果外观改变。

## 交付

| 新文件 | 像素尺寸 | 字节 | 接入 |
| --- | --- | --- | --- |
| assets/props/orchard_pear.png | 128×128 RGBA | 31691 | 秋季有果，宽52px |
| assets/props/orchard_pear_leafy.png | 128×128 RGBA | 32245 | 无果/幼树，宽24–52px |
| assets/icons/res_apples.png | 128×128 RGBA | 18548 | 库存/携货共享，HUD20px |
| assets/icons/res_pears.png | 128×128 RGBA | 16741 | 库存/携货共享，HUD20px |

使用内置imagegen。梨树以实际原果树为编辑参照创建新文件；采空图再以新梨树为目标去果，要求保留轮廓、树干和脚点。四次输出均1254×1254 RGBA。树图仅等比缩小到128px；篮图等比缩小到112px后居中放入128px透明画布。保留原alpha，没有程序重画、改色、合成果实或伪造透明。

## 完整提示词

### 梨树带果

```text
Use case: precise-object-edit. Asset type: original ripe pear orchard tree sprite for a 2:1 dimetric medieval village game. Input image 1 is the actual existing Banish orchard tree and is the edit target/style reference. Keep its hand-painted stylized warm earthy palette, soft upper-left light, compact leafy canopy, natural trunk, centered bottom root footpoint and transparent background. Make a sister PEAR TREE: replace every red round apple with a clearly pear-shaped golden-yellow/ochre fruit with a narrow neck and broad bottom; show about 10 to 14 readable pears spaced through foliage. Slightly elongate the upper canopy but retain the existing tree's overall width, pixel-detail scale, trunk proportions and visual weight; it will be displayed only 52 pixels wide, so pears must read as yellow pear fruit and not flowers. Keep the whole tree centered, trunk/root base at x50% and within 2% of canvas bottom; no roots trailing horizontally. Match this existing production asset rather than inventing a different art style. Real alpha transparency, no ground plane, no soil patch, no platform, no baked shadow, no background scene, no text or watermark. Preserve crisp painterly game-sprite edges; no blurry halo, flat vector, sticker outline, or plastic 3D rendering.
```

### 同一梨树采空及幼树

```text
Use case: precise-object-edit. Asset type: the harvested/young leafy state of the SAME pear orchard tree game sprite. The supplied image is the exact edit target. Remove ALL golden pear fruits from the canopy and replace only those fruit areas with matching green leaves. Keep the trunk, roots, every branch, entire outside canopy silhouette, canopy width and height, camera projection, lighting, watercolor/painterly texture, leaf colors, canvas dimensions and bottom-centered root anchor unchanged. This must be a frame-perfect sister sprite so the tree does not jump or change size after harvest; it will also be shrunk for immature trees. No fruit, flowers, blossoms, hanging objects or baskets anywhere. Preserve genuine alpha transparency, including holes between branches. Do not add any ground, shadow, platform, background, text or outline. Do not zoom, move, redesign or crop the tree.
```

### 苹果篮

```text
Use case: stylized-concept. Asset type: original apple resource icon for Banish, a cozy medieval frontier village game, to display at 20px and save as 128x128 transparent PNG. isometric game asset, 2:1 dimetric projection, cozy medieval frontier village style like Banished, hand-painted stylized, soft natural light from upper left, muted warm earthy colors, single object, centered, clean transparent background, no baked shadow, no ground plane, no watermark. Subject: a low compact warm wicker harvest basket holding four large red russet apples with tiny brown stems and one small muted olive green leaf. Apples dominate the icon; round red fruit silhouettes remain obvious at 20 pixels. Same dimensional broad-stroke rustic painting, restrained warm dark-brown contour and honey basket color as existing egg and vegetable resource sprites. Compact centered composition taking 73 percent of canvas width and about 65 percent of height, generous truly transparent margins. No tall handle, no other fruit, no pear, no ground, no scattered leaves, no scene, no text, no border, no white matte, no checkered background, no cast shadow. Not photorealistic, not vector or plastic.
```

### 梨篮

```text
Use case: stylized-concept. Asset type: original pear resource icon for Banish, a cozy medieval frontier village game, to display at 20px and save as 128x128 transparent PNG. isometric game asset, 2:1 dimetric projection, cozy medieval frontier village style like Banished, hand-painted stylized, soft natural light from upper left, muted warm earthy colors, single object, centered, clean transparent background, no baked shadow, no ground plane, no watermark. Subject: a low compact warm wicker harvest basket holding three large golden-yellow pears with narrow upper necks, broad rounded bottoms, short brown stems and one tiny muted olive leaf. Pear fruit shapes dominate the icon and remain readable as PEARS rather than round apples or eggs when shown at 20 pixels. Same dimensional broad-stroke rustic painting, restrained warm dark-brown contour and honey basket color as existing egg and vegetable resource sprites. Compact centered composition taking 73 percent of canvas width and about 70 percent of height, generous truly transparent margins. No tall handle, no other fruit, no red apples, no ground, no scattered leaves, no scene, no text, no border, no white matte, no checkered background, no cast shadow. Not photorealistic, not vector or plastic.
```

## 检查结果

- 成树实际52px与既有苹果树并排，树冠视觉重量、树干比例、左上光、底边中心脚点一致；苹果红圆果与梨黄色梨形果可辨。幼树仍按原24px起始比例缩放，不提前画成熟果。
- 梨两状态alpha≥16边界为(4,1)–(124,125)和(4,0)–(124,126)，透明像素约44.1%/43.6%；52px下边界差小于1px。
- 苹果篮alpha≥16边界(18,23)–(114,107)，梨篮(21,22)–(110,105)，透明像素约62.4%/67.0%。20px与蛋篮/蔬菜并排，红圆果与黄色梨形轮廓独立可辨。
- 在夏草#6a9c4e、米白#f4eee0、暗灰#25282a上实际查看透明边缘，无地台、地面、烘焙投影或白底。
- 离线绘图契约核PNG/清单、携货别名、按已种品种绘制、采空/幼树、缺梨图回退叶树及旧PNG SHA不变。这不是浏览器或手机试玩验收。
