# 动态短引导

## 依据与适配

先核对当前游戏：新局原本自动弹整页手册、连续三条提示；清单基于食物/柴火/住房给建议，但不识别玩家正在哪一步操作。现在新局只留村名提示，使用非模态短卡。

参考官方资料（2026-10-19 查阅）：
- [EA SimCity BuildIt 新手说明](https://help.ea.com/en/articles/simcity/simcity-buildit/beginner-guide/)：状态气泡/警示图标按需查看，施工帽进入该建筑材料计划，生产完成后才收取物品。借鉴“动作在对象旁、按真实状态出现”，不照搬其材料/建造规则。
- [EA 交通功能顾问](https://careers.ea.com/games/simcity/simcity-buildit/news/simcity-buildit-trains-arrival)：功能顾问引导具体服务。借鉴按情境提供短帮助；并非声称实玩或完整复刻其新手教程。

## 当前实现

- 一次一个动作：建造 → 分类 → 建筑 → 地图放置。目标控件静态描边，不闪烁、不遮罩、不锁操作，不自动开菜单/移动镜头。
- 工地确认后进入真实清场/缺料/采运/施工状态，不将“已放工地”冒充“完工”。库存不足仍可先放工地；已有足够材料跳过采运建议。
- 已有采运标记或随身货物时不要求重复标记。石、铁标记分别识别；暂停的等待阶段提示继续模拟。
- 完工且有真实已分配工人的食物建筑、伐木屋才跳过对应基础阶段。空牧场、幼果园不冒充持续食物源。这里验证的是岗位已安排，不承诺当前正在生产或产量足够。
- 住房按真实家庭 houseId 判断，工地不算入住。基础路线建立后明确提示仍需留意生存清单，不宣称“首冬已通过”。
- 详细原因折叠在“为什么？”；原长手册保留在帮助内折叠查看。
- “跳过引导”仅隐藏提示，不改游戏/选址/暂停。该浏览器记住隐藏偏好；管理 → 帮助 → “跟着做”随时按当前村状态重看。重看不要求重建已有建筑。
- 引导启用状态以世界对象隔离。读入旧档、恢复临时世界默认不自动启动，无存档字段迁移，无库存或任务变更。浏览器存储不可用时，当前会话仍能跳过。
- 刷新只更新固定节点文字，不替换按钮、不主动聚焦、不修改输入框；有其他模态对话框时隐藏卡片和高亮，关闭后继续。
- 长期风险仍由原生存清单负责，基础路线不是长期保姆任务或完整胜利判定。

## 检查与限制

- `node tests/dynamic-onboarding.js`：真实模型状态 + 最小 DOM 生命周期合同，不是完整教程试玩。
- `node tests/hud-guidance-ui.js`：原 HUD 和清单回归。
- `node tests/start-settings.js`、`node tests/save-input-regressions.js`：新局/旧档及输入回归。
- `python tests/server_deployment.py`、`python tests/server_security.py`：CSS/JS真实HTTP可达，私有路径仍拒绝。现有server允许整个js/assets/styles，无需扩大allowlist。
- `tests/dynamic-onboarding-browser.cjs`：本地真实Chromium桌面/手机交互复跑脚本（先启动 `python dev-server.py 8642`）。此次启动即因 `socket() failed: Operation not permitted` 终止，未执行交互，也未换环境或绕过权限。浏览器布局/手机视觉/完整首冬尚未验收。
