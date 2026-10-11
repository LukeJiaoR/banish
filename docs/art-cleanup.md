# 仓库与大型工地残片清理（v0.3.61）

## 玩家可见变化

- 仓库右下不再挂着另一栋建筑的蓝灰屋顶三角。
- 大型工地顶部不再带旧图集文字标签。
- 两张透明 PNG 沿用原画布尺寸：仓库 298×254，大型工地 433×255。渲染宽度、底边中心锚点、占地、施工进度条和所有经济规则不变。

这两件使用原图作为编辑目标，通过内置 imagegen 精确清除残片，带完整原规格及已核现有素材参考；生成后仅整张缩放回原画布。未用脚本对原素材做像素掩膜或涂抹，也不宣称生成结果逐像素不变。主体轮廓与旧图主件交并比约为 98.6% / 96.5%，实际原生比例同场检查未见新透视或落脚问题。原始两张图集保持不变。

## 编辑提示词

完整共用规范保留在 [美术资源清单](art-assets.md)：2:1 dimetric、左上光、暖土色手绘、透明背景、无烘焙阴影、无新地台、底边中心锚点。本次具体编辑要求：

- 仓库：Image 1 is the edit target. Remove only the detached blue-gray triangular roof fragment at the lower-right corner to transparency. Preserve the barn, barrels, sacks, flowers, contact stones, wood grain, roof shingles, exact camera, colors, silhouette, relative geometry and 298:254 canvas. Do not tighten the crop, redesign or add objects. Reference market is style only; never insert it.
- 工地：Image 1 is the edit target. Remove only stray baked-in label fragments outside the scaffolding. Preserve every structural post, rope, scaffold, stone wall, floor, crate, plank, barrel and log, their positions and 433:255 canvas. No redesign, tighter crop, text, label, comparison, shadow or new ground plane. Reference storage is style only.

## 切片器根因与保护

旧实现先找最大连通域的包围框，随后导出框里的全部像素，导致框内独立屋顶/标签一并进入输出。新 `cut_component` 在以后切图时只导出已选主体，保留原 RGBA 和一像素低透明抗锯齿边缘。合成 C 形主体 fixture 的包围框内特意放两个独立杂块，验证主体与边缘保持、杂块不泄漏。没有把此函数应用到本次实际 PNG 编辑。

`storage.png` 与 `site_3x3.png` 现为独立审过编辑版。切片脚本跳过它们；文件缺失时明确报错，不能悄悄恢复旧污染。其余历史素材本次没有重新切图或改动。

## 验证与仍待改善项

- 两张实际资源的透明度、画布、落脚包围范围、残片区域；精灵路径/逐件失败回退；实际 `drawBuilding` 的完工/施工同场绘制。
- 原有地面与人物呈现回归保持通过；游戏启动和存档核心回归另行记录。
- 原生比例离线 Canvas 已目视检查，未做真实浏览器或手机试玩。
- 草地已使用世界连续纹理，但黄绿细点较密、8格周期重复仍可见。人物帧体型/衣形不连续与简单劳作动画仍在；本片没有修复或宣称修复这些问题。其他旧切片应按实际目视证据逐件处理，不能靠全量脚本重切替代检查。
