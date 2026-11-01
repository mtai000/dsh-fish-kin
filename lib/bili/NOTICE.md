# 内置的 B 站能力与署名

`dsh-fish-kin` 的 B 站子系统（`lib/bili/`）把 **dsh-bili-scroll** 的后端能力内置进来，
让「大肥鱼」本人去刷 B 站，而不是另起一个没有她人设的值班会话。

## 第三方代码

- `lib/bili/vendor/mcp_server.py` —— 来自 **bilibili-mcp**（MIT，Copyright (c) 2026 AGI_Ananas），
  经 dsh-bili-scroll 改造（增长白名单、判重表、归档、转写任务、看画面等）。
- `lib/bili/vendor/LICENSE` —— 该项目的 MIT 许可证原文。
- `lib/bili/asr.py` / `lib/bili/favops.py` / `lib/bili/uvfetch.js` / `lib/bili/mcp.js` /
  `lib/bili/login.js` / `lib/bili/dm.js` / `lib/bili/uid.js` —— 来自 **dsh-bili-scroll**（MIT，
  Copyright (c) 2026 c1overzz），本仓库按 MIT 许可二次分发并做了适配。

## 本仓库的做法

- 工具注册、调度、人设、记忆、审批都在 dsh-fish-kin 自己的运行时里；
- 调度不再起 headless 会话，而是直接叫醒「大肥鱼」本人（她的身份段就是人设）；
- 原 dsh-bili-scroll 的配置/凭证会在第一次启动时一次性搬进 `<她的家>/bili/`，旧目录保留。

MIT 许可证见仓库根目录 `LICENSE`。
