# 礼拜堂独立精灵

本次仅新增 `assets/buildings/chapel.png`，没有刷新旧图集，也没有覆盖现有建筑。

## 来源与风格核对

- 先完整阅读 `docs/art-assets.md` 中的统一规格、原全局提示词和建筑规格。
- 通过 GitHub connector 从 `LukeJiaoR/banish` 的 `main` 核取并实际查看两张透明 PNG：
  - [school.png](https://github.com/LukeJiaoR/banish/blob/main/assets/buildings/school.png)，原图 294×289；blob SHA `406c652bb5bc121a7cb025a5960a96fc43c927cf`。
  - [townhall.png](https://github.com/LukeJiaoR/banish/blob/main/assets/buildings/townhall.png)，原图 448×352；blob SHA `b6d8ac978dbecc00a7e99e38bfaff0ad8c4e2bd2`。
- 原创建筑由内置 imagegen 生成；两张已有精灵仅作风格参考。保留暖石材、褐色木梁、蓝灰瓦顶、左上光源、两面墙的明暗差异和手绘轮廓；不复制学堂旧切片边缘的相邻物体残片。
- 采用 2:1 dimetric 小镇视角。单层礼拜空间、短钟楼、小十字架、木门和琥珀色窗户，保持 3×3 公共建筑的量级。没有地表菱形、草地、人物或烘焙投影。

## 导出与接入参数

- 文件：`assets/buildings/chapel.png`
- 格式：RGBA PNG，真实透明 alpha，448×496，304,253 字节。
- imagegen 首稿后用 imagegen 进行一次构图收紧；收紧版为 1192×1320。最终仅按同一比例用 Lanczos 缩小至约 448px 宽，四舍五入高度至 496px，保留全部主体与原有透明余量。没有用程序重画建筑。
- 推荐 `G.BUILD_SPR_W.chapel = 1.08`，与现有默认建筑系数相同。
- 3×3 占地时画布显示宽 `(3 + 3) × 32 × 1.08 = 207.36px`，显示高约 `229.58px`，不透明主体宽约 199.5px。
- 最前方石基角脚点约为 `(224, 483)`，归一化坐标约 `(0.5000, 0.9738)`；主要透明底边约 13px。推荐 `sprFootY = B[1] + 6`，无需横向补偿。该补偿应位于缩放前的游戏坐标体系，与已有市场等建筑的脚点补偿一致。
- 对照图中，学堂沿用宽 203.52px、市政厅沿用宽 224px、礼拜堂使用宽 207.36px，三者都对准同一 192×96px 的 3×3 占地菱形。礼拜堂的普通屋身没有放大，钟楼自然高于市政厅屋顶；最终脚点与占地最下角一致。

## 验证

- 已实际打开最终 PNG 和同显示尺度的三建筑对照图检查材质、尺寸、透明边缘和脚点。
- 最终 alpha 范围为 0–255。alpha≥32 的像素边界为 `(16, 3, 448, 484)`；alpha≥128 的边界为 `(16, 4, 447, 483)`。边缘只有正常的透明抗锯齿，没有不透明底色。
- 本文件描述素材本身；精灵加载与 renderer 接入由对应玩法改动完成。

## 生成提示词

### 第一轮：原创单建筑

```text
Use case: stylized-concept. Asset type: a single production-ready transparent PNG building sprite for the existing Banished-like town game. Primary request: create ONE original modest medieval frontier village chapel for a 3 by 3 tile footprint. This is a new matching asset, not a contact sheet and not a redraw of the references.

Input image 1 school.png: visual reference only for painterly blue-gray roof tile texture, warm earth palette and building level of detail; ignore all stray adjacent-object fragments, landscaping and banners in that old sliced image. Input image 2 townhall.png: visual reference only for especially the clean silhouette, warm timber and light limestone block walls, lighting and ground anchoring. The chapel must match these actual pixels as a sibling building.

Global style verbatim: isometric game asset, 2:1 dimetric projection, cozy medieval frontier village style like Banished, hand-painted stylized, soft natural light from upper left, muted warm earthy colors, single object, centered, clean transparent background, no baked shadow, no ground plane, no watermark.

Subject: a compact rectangular chapel, warm pale limestone ground walls, muted brown structural timbers, restrained blue-gray pitched tiled roof, a single small square bell tower with a simple timber belfry and tiny cross finial, one humble arched wooden entrance on the visible left-facing wall, few small softly amber arched windows. Town-scale modest single-story nave, a bell tower only somewhat taller than the roof, sturdy chunky readable hand-painted game-asset silhouette.

Composition: the two visible wall base axes slope exactly +1/2 and -1/2 (2:1 dimetric); verticals stay vertical; no perspective convergence. The frontmost masonry foundation corner must be exactly centered horizontally and touch the bottom center edge of the transparent canvas. The whole roof/tower fits fully inside the canvas; only minimal transparent margin at sides and top. Keep the lowest stone foundation corner directly at bottom center as the foot anchor, with no transparent band beneath it. Target art canvas 448 x 384 pixels if supported. Light from upper left, left wall brighter and right wall darker.

Materials: warm neutral stone #b4a389, brown oak #805b38, soft slate blue #4a5a6b; weathered but cozy. Use a simple shallow one-course attached masonry plinth that follows the actual building perimeter only. No broad terrain diamond or platform. This must feel like a small frontier chapel, not a cathedral.

Avoid: characters, people, fences, trees, planted landscaping, graves, paths, cast or drop shadows, ground tile, grass, extraneous props, text, letters, labels, watermarks, background scene, white background, checkerboard painted into image, blur, photorealism, slick 3D rendering, elaborate ornament, cropped roof, adjacent buildings. Preserve genuine transparent alpha outside the isolated chapel.
```

### 第二轮：收紧构图与居中脚点

```text
Use case: precise-object-edit. This reference is the completed chapel sprite; keep the actual painted building IDENTICAL. Change only its transparent canvas framing to prepare a production game sprite. Tightly frame the isolated chapel in a PORTRAIT aspect ratio 448 wide by 496 high. Preserve all pixels and all chapel details, camera, orientation, colors and material appearance as closely as possible; do not redesign anything. Keep the whole cross, belfry, roof and stone base visible. Transparent padding should be about 4 pixels on left, right and top at 448 x 496 final size.

Most important: the tip of the foremost lowest stone foundation corner must land at the exact bottom-center point of the image canvas, x=224 and y=495. This is the game renderer's foot anchor. Adjust the transparent framing and the chapel's placement to accomplish that, without adding any new material or ground. No transparent strip below the frontmost corner.

Retain genuine alpha transparency outside the building, no baked shadow, no ground plane, no text or labels, no extra objects, no checkerboard. Remove the near-invisible stray translucent pixels outside the building; retain only a normal clean antialiased silhouette.
```

生成工具保留了少量透明底边，因此实际接入采用上文测量后的 +6px 脚点补偿，而不假定提示词要求的底边位置已经精确实现。
