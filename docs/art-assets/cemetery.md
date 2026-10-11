# 原创墓碑素材（0.3.37）

- 文件：`assets/props/grave.png`，RGBA 32×34，游戏显示 16×17，脚点 (16,34)。透明像素保留，按底角位置留白对齐。
- 工具：内建 imagegen，先生成一块风化圆顶墓碑，再只修正 2:1 投影及透明边缘。没有第三方游戏素材。
- 参考：本仓库 `assets/props/rock_a.png`、`assets/buildings/house.png`、`assets/buildings/pasture.png` 的手绘石材、暖色和光向。实际生成前完整阅读原美术规格，不只使用缩写版提示。
- 生成风格前缀：`isometric game asset, 2:1 dimetric projection, cozy medieval frontier village, style like Banished, hand-painted stylized, soft natural light from upper left, muted warm earthy colors, single object, centered, clean transparent background, no baked shadow, no ground plane, no watermark`。
- 主体要求：一块暖灰风化石墓碑，圆顶、无文字/宗教符号，较亮左面与较暗窄右面；小尺寸下轮廓清楚，无草、底台、额外道具或背景。
- 修订要求：底边沿 2:1 菱形两轴，最低接地角对准底边中心，简化石片，清理物体外游离像素；保持材质、光向与其他资产不变。
- 导出仅做透明区域裁切、脚点留白和 2 倍尺寸缩放，未重绘、变色或透视变形。原生成图和完整两轮提示词留作制作证据。
- 实际游戏渲染将每个有效墓位作为独立地面物件排序，空、单个、满位与到期状态均验证；场景使用同一木屋和施工图作尺寸参照。
