# 原创 Squash 四阶段（#81）

2026-10-12，使用 OpenAI 内置 image_gen 分别生成四张原创耐寒瓜（Squash）作物图。生成前完整阅读 [原始美术规范](../art-assets.md) 与 [豆类四阶段](beans.md)，并实际查看以下原始像素参考：

- assets/props/bean_stage0.png
- assets/props/bean_stage1.png
- assets/props/bean_stage2.png
- assets/props/bean_ripe.png
- assets/props/cabbage_ripe.png

只新增本说明与四张 Squash PNG，没有重绘或改动参考素材。这里的 Squash 采用低矮蔓生耐寒瓜外形：宽而低的灰橄榄绿叶、小黄花、成熟时浅赭黄带绿色纹路的矮椭圆瓜，与高耸橙色 Pumpkin 造型区分。

## 文件、比例与锚点

| 文件 | 阶段 | 源图非零 alpha 包围盒 | 64×48 离线缩放后的非零 alpha 包围盒 |
|---|---|---|---|
| assets/props/squash_stage0.png | 四簇幼苗 | (35,44)–(93,84) | (16,21)–(48,43) |
| assets/props/squash_stage1.png | 四簇年轻短蔓 | (20,35)–(115,90) | (9,16)–(56,46) |
| assets/props/squash_stage2.png | 开花、深绿幼瓜 | (17,33)–(111,90) | (7,15)–(57,46) |
| assets/props/squash_ripe.png | 浅赭黄／绿色成熟耐寒瓜 | (18,34)–(111,90) | (8,16)–(57,46) |

- 每张均为 128×96 RGBA，游戏预期显示 64×48；沿用既有农田作物的画布底边中心脚点。
- 2:1 dimetric 投影、左上软光、土色手绘、四株菱形排列。植株实际内容位于画布下半部，保留与豆类、白菜相近的上方透明留白。
- 根部目标位置以 128×96 坐标约为 (64,58)、(38,70)、(90,70)、(64,82)。独立生成的四阶段存在轻微根位／叶缘变化，未声称逐像素锁定。
- 四张资源的 alpha 均覆盖 0–255，四边全部透明。没有土台、地面菱形、背景、文字或烘焙投影；实际阴影应由既有引擎处理。

## 生成与非创意处理

使用 built-in image_gen，四次独立调用，全部设置 transparent_background=true。先以全部五张旧作物为参考生成成熟 Squash，再以该成熟原图与相应豆类阶段为参考生成其余三阶段。参考用于原创物种的一致风格、尺度与植株排列，没有复制旧作物主体。

每张生成原图均为 1448×1086 RGBA（4:3）。仅对完整画布使用 Pillow Image.Resampling.LANCZOS 等比缩小至 128×96 后保存，不裁株、不拆分、不重新排列、不换色、不画新像素、不算法抠背景。保留生成器 alpha；没有以程序绘图替代 image_gen。未把原图大尺寸另存入游戏资源目录。

| 阶段 | 内置生成输出标识 | 原始 PNG SHA-256 |
|---|---|---|
| stage0 | exec-4080ffe5-7a03-48d9-91a7-5c639b673531.png | bed9f87ba77f2afc58ff0ad96b57f0b2a789fa7e49d59291faea111e8defa8eb |
| stage1 | exec-b032208a-8052-40b4-b5ef-774d397b16d7.png | 0752586bd2a247c965c26ef688fd919fcbb41205890a9208bac6787d36b63320 |
| stage2 | exec-d8603ffe-8eaa-48d7-bdeb-dd07cfba3933.png | df214a9a8d3e3900e1a8773d6a9775d71b1bf080e941de05f722cc11f6ffe464 |
| ripe | exec-e19436a0-9c35-4e55-bb26-82020cd3ce70.png | 3c78f4dbea1e471932498e8f86e074837a6f688cc4125634e3837b762261317f |

## 实际像素检查

查看最终四张 PNG，并在离线联系表中与原豆类四阶段同场对照：包含真实 64×48 像素缩放与最近邻放大视图。幼苗、短蔓、小花幼瓜、浅色成熟瓜能区分；成熟四株仍低矮，未长成橙色高塔，体量与白菜和豆田相容。数值检查透明边框和上述 alpha 包围盒。

此为离线资源像素检查，不是浏览器运行、手机试玩或游戏内集成验收。精灵清单及渲染接入由本次游戏功能变更负责。

## 完整实际生成提示词

### Ripe

参考图顺序：bean_stage0.png、bean_stage1.png、bean_stage2.png、bean_ripe.png、cabbage_ripe.png。

```text
isometric game asset, 2:1 dimetric projection, cozy medieval frontier village style like Banished, hand-painted stylized, soft natural light from upper left, muted warm earthy colors, single object, centered, clean transparent background, no baked shadow, no ground plane, no watermark
Use case: stylized-concept. Asset type: original low-resolution Banish crop sprite, one farm tile consisting of exactly FOUR small squash plants. Input images 1-4 are the actual bean growth stages and input image 5 is mature cabbage; use as STYLE, PALETTE, SCALE, FOOTPOINT, and COMPOSITION references, do not redraw those crops. Generate a NEW squash crop sprite.
Growth stage: RIPE winter squash. Four restrained very low trailing vine plants, broad muted olive-green leaves, each with ONE small squat pale ochre-and-sage-green winter squash gourd visible close to its root; a few tiny faded yellow blossoms are permissible. Gourds should look small, squat, slightly elongated and gently ribbed, never orange pumpkins, never tall towers. Keep leaves and vine coverage restrained enough to distinguish four planted roots.
Composition: output a single 4:3 transparent canvas designed for proportional downscale to exactly 128x96 source pixels, displayed at 64x48 game pixels. Match the supplied bean/cabbage lower-centered diamond arrangement and original unoccupied transparent top margin. Four plant ROOTS must fall at approximately (64,58), (38,70), (90,70), (64,82) when expressed on the eventual 128x96 canvas. Mature leaves may extend upwards to y=28, and sideways from x=14 to x=115, with nothing below y=89. The front root is lower-center. Keep the same ground footpoints for the other growth stages. The crop is low and flat, seen from the same dimetric angle as the supplied sprites, not front-facing.
Paint restrained crisp forms and soft simple highlights that remain readable at tiny game size; the slightly muted yellow-olive palette should match the reference beans and cabbage. Preserve actual alpha transparency. Avoid text, labels, borders, a sheet of multiple stages, scenery, dirt, soil, stones, soil diamond, ground plane, platform, baked shadows, ambient shadow patches, buildings, watermarks and checkerboard pixels. Do not include the reference bean pods or cabbages. Whole four-plant group only, no cropped leaves.
```

### stage0

参考图顺序：上表中的成熟 Squash 1448×1086 原图、bean_stage0.png。

```text
isometric game asset, 2:1 dimetric projection, cozy medieval frontier village style like Banished, hand-painted stylized, soft natural light from upper left, muted warm earthy colors, single object, centered, clean transparent background, no baked shadow, no ground plane, no watermark
Use case: stylized-concept. Asset type: original low-resolution Banish crop sprite, one farm tile consisting of exactly FOUR small squash plants. Input image 1 is our newly created ripe squash sprite: use it as a strict CHARACTER, STYLE, PALETTE, SCALE, ROOT-PLACEMENT and COMPOSITION reference. Input image 2 is the existing bean sprite at the requested growth stage: use it only for plant size and amount of foliage at this stage. Generate a NEW squash stage sprite, not bean plants, and not a multistage sheet.
Composition: single 4:3 transparent canvas, the same exact canvas as the ripe squash reference, designed for proportional downscale to exactly 128x96 source pixels and runtime display 64x48. Preserve the lower-centered four-root diamond arrangement. Four plant ROOTS should remain at approximately (64,58), (38,70), (90,70), (64,82) when expressed on the eventual 128x96 canvas. Keep empty transparent space above plants. The front root is lower-center. Do NOT enlarge seedlings or young vines to fill the empty canvas. Same dimetric overhead angle, soft upper-left lighting, restrained muted olive-green palette, hand-painted crisp small forms. Actual alpha transparency. No soil, dirt, ground plane, platform, baked shadows, scenery, labels, borders, watermarks, checkerboard pixels, extra detached plants or building fragments. Do not crop any part of a plant. Change only plant maturity relative to the ripe squash reference; keep the same four root centers.
Growth stage: SEEDLINGS. Each of the four roots has only one tiny low squash seedling, with a short stalk, two rounded cotyledons and one very small lobed true leaf. The total group visible area should be comparable to the bean_stage0 reference: about x=33..98, y=50..85 on a 128x96 canvas. Very sparse, small young green shoots with lots of transparent space between. No gourds, flowers, pods or mature vines.
```

### stage1

参考图顺序：上表中的成熟 Squash 1448×1086 原图、bean_stage1.png。

```text
isometric game asset, 2:1 dimetric projection, cozy medieval frontier village style like Banished, hand-painted stylized, soft natural light from upper left, muted warm earthy colors, single object, centered, clean transparent background, no baked shadow, no ground plane, no watermark
Use case: stylized-concept. Asset type: original low-resolution Banish crop sprite, one farm tile consisting of exactly FOUR small squash plants. Input image 1 is our newly created ripe squash sprite: use it as a strict CHARACTER, STYLE, PALETTE, SCALE, ROOT-PLACEMENT and COMPOSITION reference. Input image 2 is the existing bean sprite at the requested growth stage: use it only for plant size and amount of foliage at this stage. Generate a NEW squash stage sprite, not bean plants, and not a multistage sheet.
Composition: single 4:3 transparent canvas, the same exact canvas as the ripe squash reference, designed for proportional downscale to exactly 128x96 source pixels and runtime display 64x48. Preserve the lower-centered four-root diamond arrangement. Four plant ROOTS should remain at approximately (64,58), (38,70), (90,70), (64,82) when expressed on the eventual 128x96 canvas. Keep empty transparent space above plants. The front root is lower-center. Do NOT enlarge seedlings or young vines to fill the empty canvas. Same dimetric overhead angle, soft upper-left lighting, restrained muted olive-green palette, hand-painted crisp small forms. Actual alpha transparency. No soil, dirt, ground plane, platform, baked shadows, scenery, labels, borders, watermarks, checkerboard pixels, extra detached plants or building fragments. Do not crop any part of a plant. Change only plant maturity relative to the ripe squash reference; keep the same four root centers.
Growth stage: YOUNG VINES. Four squat young squash plants, each with a few broad muted olive-green lobed leaves and one short restrained vine, still separated clearly. Similar overall foliage footprint to bean_stage1, about x=24..105, y=37..86 on a 128x96 canvas. Plant height is low. No gourds, flowers, bean pods, ripe fruit, or long sprawling tendrils.
```

### stage2

参考图顺序：上表中的成熟 Squash 1448×1086 原图、bean_stage2.png。

```text
isometric game asset, 2:1 dimetric projection, cozy medieval frontier village style like Banished, hand-painted stylized, soft natural light from upper left, muted warm earthy colors, single object, centered, clean transparent background, no baked shadow, no ground plane, no watermark
Use case: stylized-concept. Asset type: original low-resolution Banish crop sprite, one farm tile consisting of exactly FOUR small squash plants. Input image 1 is our newly created ripe squash sprite: use it as a strict CHARACTER, STYLE, PALETTE, SCALE, ROOT-PLACEMENT and COMPOSITION reference. Input image 2 is the existing bean sprite at the requested growth stage: use it only for plant size and amount of foliage at this stage. Generate a NEW squash stage sprite, not bean plants, and not a multistage sheet.
Composition: single 4:3 transparent canvas, the same exact canvas as the ripe squash reference, designed for proportional downscale to exactly 128x96 source pixels and runtime display 64x48. Preserve the lower-centered four-root diamond arrangement. Four plant ROOTS should remain at approximately (64,58), (38,70), (90,70), (64,82) when expressed on the eventual 128x96 canvas. Keep empty transparent space above plants. The front root is lower-center. Do NOT enlarge seedlings or young vines to fill the empty canvas. Same dimetric overhead angle, soft upper-left lighting, restrained muted olive-green palette, hand-painted crisp small forms. Actual alpha transparency. No soil, dirt, ground plane, platform, baked shadows, scenery, labels, borders, watermarks, checkerboard pixels, extra detached plants or building fragments. Do not crop any part of a plant. Change only plant maturity relative to the ripe squash reference; keep the same four root centers.
Growth stage: FLOWERING AND IMMATURE FRUIT. Four low squash vines with broad muted olive-green lobed leaves, one or two small yellow blossoms on each, and a tiny dark sage-green immature gourd near each root. Leaves and root centers are visibly the same crop species and arrangement as the ripe squash reference, but the gourds are smaller and greener and not yet pale. Similar overall foliage footprint to the ripe reference, about x=18..110, y=33..88 on a 128x96 canvas. Short restrained vines, never upright towers, no pumpkins or bean pods.
```


