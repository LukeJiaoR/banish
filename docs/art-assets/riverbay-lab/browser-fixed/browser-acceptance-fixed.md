# 修复版浏览器验收（2026-10-18）

状态：**结构修复通过浏览器验证；美术仍未签字；首帧性能明显改善但仍有 2–3 帧卡顿；真机未验收。** 保持 Draft。

对象：`2857b94`（草纹理叠加 + 连续水陆裁剪）。前一版 `07607c6` 的浏览器记录保留在 `../browser/`，未覆盖。

## 环境与方法

- macOS Chromium（ego-browser），真实页面 `http://127.0.0.1:8627/riverbay-lab.html`，`python3 dev-server.py 8627`。
- 桌面视口 1215×751 CSS，画布 1200×521，DPR 1；窄屏用 CDP `Emulation.setDeviceMetricsOverride` 390×620、DPR 2。**不是实体手机。**
- 四个预设逐一实点；0.75/1/2 缩放；拖动平移；`window.__errs` 为空。
- 计时取页面自带的 `window.riverbayLab.metrics().profile.operations` 最近一条 `setOptions`：`totalSyncMs`、`frameSyncMs`、`sections`；暖帧为连续 40 次 `render()`。
- 截图来自 CDP `Page.captureScreenshot`，未绕过权限、未部署。

## 结果

### 草地：原纹理保留

`drawGroundTile` 现在始终调用原版绘制，随后以 26% 透明度叠加低频色域；不再用不透明 `fillLow` 替换草地。1:1 对照里原草的细颗粒、明暗笔触都还在，只是整体更平、更冷一点。`grass-compare.png` 为同机位对照（左原版、右完整候选）。

低频色域均值改为 `100/121/53`，与原夏草一致；此前 `112/126/75` 的偏亮偏黄消失。叠加是区域级单次填充，不再每格提交 pattern。

### 岸线：连续裁剪生效

`continuousMask()` 用闭合水多边形 even-odd 裁剪，陆域取其反向；湿沙/浅水带按连续路径绘制，不再是逐格菱形 mask。2 倍近景与岛屿边都连成曲线，没有初版的菱形阶梯、三角缺口或被切断的湿沙带（`desktop-z2-study.png`、`island-z2.png`）。

仍在的问题：岸带颜色和宽度偏均匀，像一条等宽手绘描边；原草高频感、水 v2 的 8 格重复仍在。结构错误修好了，但这不是“自然岸形设计完成”。

### 首帧性能

桌面 1 倍，逐个预设首次切换：

| 切换 | totalSyncMs | build | 首次地面 drawImage | 其余 |
|---|---|---|---|---|
| 原版（无变化） | 1.1 | 0.0 | 0.1 | 0.9 |
| 仅水 v2 | 27.9 | 9.6 | 17.6 | 0.5 |
| 水+岸线 | 28.0 / 26.5 | 2.7 / 1.4 | 24.5 / 23.8 | 0.7 / 0.8 |
| 完整候选 | 47.8 / 35.7 | 8.8 / 2.5 | 38.0 / 32.5 | 0.8 / 0.6 |

0.75/1/2 三档，完整候选：`31.9 / 40.6 / 32.3 ms`；原版 `0.8–19.0 ms`（含缓存重建）。缓存 1448×751 或 2128×1104，均在预算内。

暖帧连续 40 次：p50 0.3 ms、p95 0.7 ms、max 0.7 ms。拖动正常，相机位移生效，无 console error。

对比上一版 `07607c6` 的 Chromium 记录（完整研究 236–283 ms、buildGround 仅 2–9 ms）：**首帧从 6 倍左右降到 32–48 ms**，卡顿来源仍是首次地面 `drawImage`（17–38 ms），不是 tile 构建。48 ms 在 60 fps 下约 3 帧，属于可感知的短卡顿，不能宣称“零卡顿”或 60 fps 通过。

## 判定

- 浏览器可见性、预设/开关、拖动、0.75/1/2、窄屏布局：**通过**。
- 草地覆盖与岸线裁剪这两个结构问题：**通过**（原纹理保留；岸线连续）。
- 美术：**未签字**。等宽岸带、旧草高频感、水 8 格重复仍在；需要美术方向确认。
- 首帧性能：**明显改善，未达 60 fps 零卡顿**。仍需 30 秒以上平移/缩放 P95、实体手机热量/触摸/帧率。
- 保持 Draft，不启用正式入口。

## 复现

```sh
cd <repo>
python3 dev-server.py 8627
# 浏览器打开 http://127.0.0.1:8627/riverbay-lab.html
```

证据：`desktop-original.png`、`desktop-study.png`、`desktop-z2-study.png`、`island-z2.png`、`z075-original.png`、`z075-study.png`、`z075-compare.png`、`phone-study.png`、`grass-compare.png`、`shore-closeup-z2.png`。
