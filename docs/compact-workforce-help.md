# 用工详情默认只显示事实和操作

建筑与工地的用工卡不再把完整调度规则默认铺在控件前。默认内容保留当前人数、用工上限、真实状态原因和操作控件；长规则放在控件后的「用工说明」，默认收起，用户可按需展开。输入框短注为「0 停接新工作；点击应用后生效」。

不改变派工、产量、人数上限、收尾或停用规则。缺料、仓满、缺人、暂停、收尾等实际原因依旧来自原 `workforceSummary`，常显在说明之外；应用结果和输入校验照旧。完整规则仍可读取，全镇人力概览不变。

使用原生 details/summary：保留原生键盘交互，无自定义按键拦截或伪造展开状态。用工刷新不替换节点，已展开说明、键盘焦点和未应用的输入草稿继续保留。

验证：`node tests/workforce-controls-ui.js` 新增默认折叠、控件顺序、实时原因不隐藏、说明展开/焦点/输入草稿保留断言。现有数值校验、重复提交、旧节点隔离、工地暂停和收尾规则回归继续执行。DOM fixture 不能替代真实浏览器的键盘和布局验收；当前环境 Chromium 因 socket 权限启动失败，浏览器与手机视觉验收仍待完成。

本片通过的回归：workforce-controls-ui 16组、workforce-controls 20组、focused-building-state 9组、building-detail-navigation-ui 9组、details-readability-ui 11组。`git diff --check` 通过。
