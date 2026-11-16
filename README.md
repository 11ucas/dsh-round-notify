# dsh-round-notify

给 [DeepSeek Harness](https://github.com/deepseek-ai) Web GUI 用的客户端插件：**每一轮结束后发一条系统通知**，只在窗口不在前台时发。

A client-side plugin for the DeepSeek Harness Web GUI: **one system notification per finished round**, only while the window is in the background.

```
Agent 每完成一轮（一次 turn，含目标自动续轮）
        │  session.running: true → false
        ▼
页面检测窗口是否在前台 ── 在前台 ──► 静默
        │ 不在前台
        ▼
浏览器 Notification API ──► 系统通知（会话名 + 本轮用时）
        │ 点击
        ▼
聚焦窗口 + 打开该会话
```

## 为什么需要它

长任务（尤其是开启了目标自动续轮）跑起来以后，人不会一直盯着页面。这个插件把"这一轮结束了"这件事推到你的操作系统通知中心，点一下就能回到对应会话继续。

它完全跑在浏览器里：**Host 侧没有任何逻辑**，不读会话正文、不写文件、不联网；轮次信号来自 Host 本来就推给页面的每会话 `running` 状态。

## 安装

本仓库是一个 **DSH bundle**（不是 npm 包），通过 Harness 的插件管理器以本地目录安装：

在 DSH 会话里让 Agent 执行：

```
plugin_manager  action: install_bundle
                target: /绝对路径/dsh-round-notify
```

安装成功后结果里的 `application` 应为 `applied`，然后**刷新一次页面**（客户端模块是页面加载时取的）。

卸载：

```
plugin_manager  action: remove_bundle
                target: @local/dsh-round-notify
```

> `@local/` 前缀是本仓库作为"本地 bundle"的约定，`private: true` 也表明它不发布到 npm。若你想发布到 npm，需要改 `package.json` 的 `name`，并同步 `client.js` 里 `__ModuleLoader__.load({ id })` 与 `cordis.patch.yml` 的行名。

## 启用与授权（重要）

浏览器规定：通知权限**只能由一次用户点击**触发申请，页面加载时不能自动弹框。所以：

1. 装好并刷新后，页面右下角会出现提示条「**开启轮次通知**」；
2. 点「**允许通知**」→ 浏览器弹出该站点的通知权限 → 允许；
3. 之后这个站点就一直在授权状态，插件开始工作。

也可以随时在 **Settings › General › 轮次通知** 里：

- 用开关开启/关闭（默认开启，授权后立即生效）；
- 点「**发送测试**」立刻验证通知是否正常；
- 如果之前把站点通知拒了，这一行会显示"已被阻止"的提示，去地址栏左侧的站点设置里改回来即可。

偏好存在本页 origin 的 `localStorage`：`dsh.round-notify.enabled`（`on`/`off`）、`dsh.round-notify.promptDismissed`（点了「以后再说」）。

## 行为规则

| 规则 | 说明 |
| --- | --- |
| 什么算"一轮" | 一次 Agent turn。目标续轮驱动只在 agent 完全 idle 时才启动下一轮，所以 `running` 由 true 变 false 恰好是一轮结束 |
| 什么时候发 | 标签页隐藏，**或**窗口失焦（看得见但没焦点）；页面在前台且聚焦时静默 |
| 发什么 | 标题「一轮已完成 / Round finished」，正文是会话名 + 本轮用时（只统计实际观察到开始的那一轮） |
| 点击通知 | 聚焦窗口并打开该会话 |
| 同会话连续多轮 | 用同一个 `tag` 覆盖，不会堆一屏 |
| 子会话 | 子代理 / 队友会话（`parentId`、`origin: 'subagent'`）不通知，避免一次 Agent Teams 运行刷屏 |
| 起点基线 | 页面加载时已在运行的轮次不补发；它结束时会正常通知 |

## 限制

- **页面必须开着**（后台标签可以）。这是 Web GUI 的固有限制：关掉页面/浏览器就没有通知。需要"浏览器关了也能提醒"只能做成系统级 daemon，那是另一个东西。
- **多个标签页会各发一条**（每个页面独立判断），暂未做跨标签去重。
- Android Chrome 这类不允许直接 `new Notification()` 的浏览器会被 `try/catch` 静默跳过。
- 站点权限被拒后，只能由用户在站点设置里恢复。

## 开发与测试

纯 JavaScript，无构建步骤。客户端模块直接是 `window.__ModuleLoader__.load(...)` 形式。

```bash
npm test          # 或 node test/round-notify-check.mjs
```

`test/round-notify-check.mjs` 用桩浏览器（`Notification`、`document.visibilityState`、`localStorage`）和桩 Cordis 上下文驱动插件，覆盖 18 项：基线不误报、失焦通知、前台静默、权限/偏好门控、子会话过滤、用时、点击打开会话、开关持久化、拒绝/不支持降级、授权提示条的显示与「以后再说」。

因为仓库是**软链接安装**进 profile 的，改完 `client.js` 刷新页面即生效（服务器会按文件内容算新的 module rev），不需要重装。

## 目录结构

```
dsh-round-notify/
├── cordis.patch.yml      # bundle patch：插入插件行
├── index.js              # Host 半边（空实现）
├── client.js             # 全部逻辑：轮次监听 + 通知 + 设置行 + 授权提示条
├── locale/{en,zh}.json   # 插件清单里的标题/描述
├── icon.svg              # 插件图标
└── test/round-notify-check.mjs
```

## License

[MIT](LICENSE)

---

## English summary

A client-only DSH Harness Web GUI plugin: it watches each Session's `running` flag (a round is one Agent turn — goal continuation rounds included, because the round driver only starts a round at whole-agent idle) and raises a browser system notification when a round ends **while the page is hidden or the window is unfocused**. Clicking the notification focuses the window and opens that Session. Child Sessions (subagents/teammates) are filtered out; per-Session `tag` replaces instead of stacking; the Settings › General row owns the switch, the permission handshake (browsers only allow `requestPermission()` from a user gesture, hence the in-page prompt), and a "Send test" action.

Install it through the Harness plugin manager as a local bundle (`plugin_manager install_bundle`, target = this directory), then reload the page. `npm test` runs the stubbed-browser harness (18 checks). MIT licensed.
