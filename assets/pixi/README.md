# Pixi 独立版素材

2026-10-24 使用内置 imagegen，参考 `docs/ui-reference/selected-a.png` 生成。原始透明 PNG 按字节复制到本目录，保留 alpha；没有脚本重绘、抠图、裁剪、调色或拉伸。其他建筑、树木、地面和人物复用项目既有素材。

| 文件 | 源尺寸 | 源像素落地锚点 | 显示基准跨度 |
| --- | --- | --- | --- |
| `courtyard-house-v1.png` | 1536×1024 | (800, 978) | 1280 |
| `river-garden-v1.png` | 1536×1024 | (780, 923) | 1350 |

锚点与跨度在 `js/pixi-art.js` 声明。房屋按真实占地计算尺寸，装饰按 56–77 个世界像素宽显示，不改变碰撞、可采矿石、居民工作或保存数据。花草冬季隐藏；住房失火时沿用原有状态绘制。

生成简报（内容归档，非逐字提示词）：

- 院落：独立 2:1 等距游戏建筑，江南白色抹灰墙、暗灰瓦顶、低矮方形院落、小石铺地、木门、陶罐、少量花草；与参考 A 的暖色手绘材质一致，左上光，真实透明背景，小接触阴影。无人物、文字、UI、整片场景或底座矩形。
- 河岸组合：独立、低矮、非对称的等距河岸装饰，5–7 块覆苔灰石、芦苇、黄绿色草叶、少量白黄野花，暖光手绘，真实透明背景。无水面、地形矩形、建筑、人物或 UI。

生成源标识：院落 `exec-d17e1699-61af-41e1-a530-55d91be3a4be.png`；河岸 `exec-cddf8aa4-4f07-47b3-b9ba-62efa9daac08.png`。

SHA-256：

```text
a9fcf8360c0a1b5ed6d34397d9872ad10dbc95a2b4967f480b57b2fd3d89acee  courtyard-house-v1.png
10169e85f81b74ab2eeecc11ba4c82432df8e10f9cc1b40c60b0233468665708  river-garden-v1.png
```

`village-plan.json` 是样板村的作者布局和初始条件；`river-village.json` 是由它构建、通过游戏存档校验的可玩存档。更新美术本身不需要重建存档。

## 河畔院落切片 · v2

本轮同样使用内置 `image_gen`，以 A 图及原院落为画风参考，分别生成粮仓、水井、铁匠铺和土路纹理。四个源文件完整复制到这里；透明 PNG 的 alpha 和不透明土纹理的原始像素均保留。逐字提示词与工具模式保存在 [courtyard-prompts.json](courtyard-prompts.json)。

| 文件 | 源尺寸 | 锚点 / 源跨度 | 世界显示宽度 |
| --- | --- | --- | --- |
| `granary-v2.png` | 1536×1024 | (788,990) / 1240 | 152 |
| `well-v2.png` | 1536×1024 | (777,938) / 768 | 64 |
| `smithy-v2.png` | 1536×1024 | (775,945) / 1360 | 168 |
| `path-earth-v2.png` | 1254×1254 | 四格连续纹理，无脚点 | 地表缓存使用 |

院落民居本轮显示基准宽度 144；已有四坡小民居使用 112 的基准宽度，继续按真实在家状态选择已有空屋／有人素材。建筑的预览与落地共用同一规格，不修改逻辑占地。

源标识依次为 `exec-3e3f539e-3ef0-4a15-a190-bc42d41261af.png`、`exec-262932cd-fe7b-466c-aafa-b82981d3a561.png`、`exec-98c8cc47-db64-4c15-8d39-ac2fa4d761aa.png`、`exec-c7663fb6-bd12-4ec3-8ad2-f2c434690713.png`。

```text
fe18bccefa2d95172166a93a20dd7d64593eecd0f8b38f444a128af1a3e034db  granary-v2.png
670253d7594b07d2cb2a32dd932cd5cb1280efef21eb3cf4e54fa250409d2d10  well-v2.png
0515f5a4c322bc3b5bf62790282a8f33ec29fa38f016d20a27cbb6d38b577bbf  smithy-v2.png
85ff296ce26a37be0cd19a3c8f8a3c2c604422d8c38c99a131747c2a9a5a4dc7  path-earth-v2.png
```

`courtyard-plan.json` / `courtyard-village.json` 使用独立切片入口和独立存档键，重建命令为 `node tools/build-pixi-village.cjs courtyard`。
