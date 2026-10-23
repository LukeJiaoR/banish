# 归园 · Godot 独立试验版

**这是以用户选定 A 图为目标的独立美术对照试验，不是完整游戏迁移。原网页版本保留不动。**

先看 [A 参考与逐项差距](reference/README.md)：实现了院落构图、地面过渡、曲岸、植被分层、地面投影与象牙/青玉 UI，但**真实 Godot 画面尚未验收，不能宣称已经接近 A 图**。运行中按 R 显示原始参考图，H 收起 UI 查看场景；参考图有明确标注，不冒充运行截图。

基线：`LukeJiaoR/banish` 的 `ab0902720f1c6f76f7a37ffb016e61242317c206`。
本次所有新增文件均位于 `godot-prototype/`；没有改动原 `index.html`、
`js/`、`styles/`、`assets/`、`server.py`、存档格式或原运行命令。

## 先试玩

1. 使用 **Godot 4.6.3 标准版（非 .NET）** 打开本目录的 `project.godot`。
2. 等待首次资源导入，按 **F6 / F5** 运行（F6 须先打开主场景）。
3. 不需要导出模板、Node、Python、联网或账号。也可运行：

   ```sh
   godot --path godot-prototype
   ```

若拿到的是独立源码 ZIP，解压后同样打开里面的 `project.godot`。
另提供的 `.pck` **不是独立可执行程序**；需要同版 Godot：

```sh
godot --main-pack banish-godot-trial.pck
```

实测引擎为 4.6.3；更新版本未实测。桌面鼠标键盘是本切片支持的操作目标，
未实现触屏双指手势，也没有做手机兼容承诺。

## 当前包含

- 固定 24×24 等距村落：7 座灰瓦木屋、草顶仓库和开放木棚；9 块院面、连续土路肩。
- 曲岸浅深水带、厚度土沿与石组、岸草、短石桥、围栏与菜园，后景树群与前景柳树。
- 独立地面投影层与石组接触影；是 2D 美术处理，不是假称物理光照或 3D 全迁移。
- 复用 A 风格木屋、仓库、阔叶树与柳树，保留原精灵校准锚点和建筑排序偏移。
- 鹿、羊、牛、鸡，共 7 只：4 张不同腿形的行走帧，加静止、低头、转身姿态；
  脚点沿明确路线移动，步态按距离推进。不是一张图整体摇晃。
- 相机平移、鼠标位置缩放、界限、暂停；木屋/树/道路的预览、确认、撤销。
- 防止越界、水面、已有物体、道路和动物保留区上的冲突放置。
- 中文界面持续标明原型边界；关闭即丢弃本次试摆，绝不读写原版存档。

动物在此演示中约比网页版放大 1.5 倍，便于比较腿部动画；不是像素完全一致的重现。
草地与河流、固定动物路线、即时放置都是试验场适配，不复刻原版模拟规则。

## 操作

| 操作 | 输入 |
|---|---|
| 平移镜头 | 中键拖动，或 WASD / 方向键 |
| 缩放 | 滚轮，范围 0.65–2.4 |
| 回到初始镜头 | Home |
| 选木屋 / 树木 / 土路 | 右侧按钮，或 1 / 2 / 3 |
| 预览放置 | 左键点地块；绿色合法，红色阻挡 |
| 实际放置 | 确认按钮 / Enter；单击地图本身不建造 |
| 取消预览与工具 | Esc / 右键 / 取消按钮 |
| 撤销本次最后一次试摆 | Z / 撤销按钮；不能删预置场景 |
| 暂停所有动物与水面动画 | Space / 暂停按钮 |
| 网格 | G / 网格按钮 |
| 对照 A 图 | R / 对照按钮；R 或 Esc 返回，恢复此前暂停状态 |
| 纯画面 | H；清除试摆工具并隐藏网格，H 恢复 UI |

UI 点击不透传地图；中键在面板上松开或窗口失焦也结束拖动。
本版没有存档/读档、网络、反馈上报或生产服务器连接。

## 没有迁移的部分

居民 AI、真实任务/搬运/施工、库存与生产、家庭与饥寒、生老病死、季节气候、
原地图生成、导航寻路、贸易、存档兼容及原反馈服务 **均未迁移**。
预置空房与动物不会生产资源，5 个小人只是静态场景摆件，不显示虚构劳动或产出。不可拿这个演示替换原游戏。

## 验证与边界

参见 [VALIDATION.md](VALIDATION.md)。已有引擎导入、主场景启动、5165 次断言的
headless 功能/状态检查；**没有完成真实 GPU 画面、人工操作、浏览器或真机视觉验收**。
当前 VM 的临时图形显示启动受运行环境限制，未使用其他机器绕过，也未伪造截图。

开发验证（Godot 4.6.3 + Python 3，仅标准库）：

```sh
bash godot-prototype/tools/test.sh
python3 godot-prototype/tools/package_source.py
```

`assets/manifest.json` 记录 39 张 PNG 的基线、大小和 SHA-256，均为原素材逐字节复制。
`tools/verify_assets.py` 在完整仓库中还会比较原文件，在独立 ZIP 中验证 manifest。
字体是原 Noto WOFF 无轮廓改动转换成 TTF，许可保留；正常运行无转换依赖。

## 导出约束（官方资料核对于 2026-10-23）

本项目选 **GDScript + Compatibility**。Godot 4 的 Web 导出要求 WebAssembly / WebGL 2.0；
Forward+ / Mobile 渲染器不能直接用于 Web。单线程 Web 导出可避免线程版的
SharedArrayBuffer 跨源隔离部署要求。本项目 `Web Trial` preset 已禁用线程与扩展，
但本 VM **没有对应导出模板，没有生成或验证 Web 包**；未下载全平台模板大包。
详见 [Godot 官方 Web 导出文档](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html)。

安装与引擎完全匹配的官方 Web 模板后才可在独立目录导出：

```sh
mkdir -p godot-prototype/build/web
godot --headless --path godot-prototype --export-release "Web Trial" build/web/index.html
```

不要覆盖原项目根目录的 `index.html`，也不要将此命令理解为生产部署。
现有模板不齐时可导出纯数据包（不包含引擎、不需要模板）：

```sh
mkdir -p godot-prototype/build
godot --headless --path godot-prototype --export-pack "Desktop Pack" build/banish-godot-trial.pck
```

## 下一步验收顺序

先在图形环境检查合法/非法预览、UI遮挡、缩放时的细节、7只动物腿部连贯性；
满意后再决定是否迁移一条最小真实模拟闭环，例如“工人取料→搬运→建屋”。
在此之前保留原版为实际游玩入口，不自动导入旧存档、不扩大为全量重写。
