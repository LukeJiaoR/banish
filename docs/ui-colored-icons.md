# 原版彩色界面图标

恢复用户确认的改版前图标，来源为 `b9dc5469254fc43bf3cebc1c46507266c5c4b483`（#110 之前）的 `js/ui.js` 与现有素材：

- 20 种资源：原 `assets/icons/res_*.png`，所有库存和成本文字旁共用。
- 23 种建造/操作：原 `assets/icons/tool_*.png`；裁缝铺、贸易站、牧场、果园、礼拜堂使用原建筑缩略图。
- 市场、水井、墓园、隧道、砍伐、采石采铁保留原注册表 emoji。历史市场路径 `tool_market.png` 不存在，原界面实际回退为 emoji；现在直接显示同一 emoji，不请求缺失文件。
- 分类保留原 🏠 🌾 ⚒️ 🏘️ 🛣️ 🔨；保存、存档、新局、反馈、帮助恢复 💾 📂 🌱 📮 ❓。人口和速度恢复原符号。
- 当前 UI 新增的资源目标、时钟、居民、关闭、展开、警报和勾选控件保留中性 SVG 与上下文颜色，不重排当前控件。

PNG 与注册表 emoji 只显示一个；图片加载失败后移除图片并显示相同的 emoji。所有图标仍为装饰，资源保留可访问名称，按钮保留现有可访问文字与焦点。缺料文字/边框、选中背景和焦点独立表达状态。木屋成本仍为「木材 16 石头 8」。没有新增或修改美术素材，也没有回滚布局、资源折叠、玩法或存档逻辑。

## 轻量检查

- `node tests/color-icons-ui.js`：原图路径存在性、20 种资源、23 种工具、5 张建筑缩略图、原 emoji、中性状态符号、安全降级、HTML 转义和 CSS 回退合同
- `node tests/mineral-resource-ui.js`
- `node tests/category-cards-ui.js`
- `node tests/build-affordance-ui.js`
- `node tests/hud-guidance-ui.js`
- `node tests/details-readability-ui.js`
- `node --check js/ui.js` 与 `git diff --check`

2026-10-19 dot 云电脑 Chromium 1180×757 实测：20 种资源 PNG 全部加载，住房三个原图加载，木屋成本、石屋/宿舍缺料提示、选择与取消、Tab 焦点、返回分类、更多资源及 Esc 收起通过。系统按钮仍为 32×32；独立缺图夹具确认坏图移除、原 emoji 回退且正常图片旁 fallback 不显示。总览与住房保存最终截图。独立审查另记录在 PR。

未运行全量游戏测试、移动端矩阵或系统高对比度浏览器仿真。截图只证明图标和相关界面，不作模拟或地形回归证据。没有修改世界美术或生产部署。
