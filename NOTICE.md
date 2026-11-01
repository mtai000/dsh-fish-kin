# 第三方代码与署名

本插件（`dsh-fish-kin` / 大肥鱼·子代传承）本体以 **MIT** 协议发布，正文见仓库根目录 `LICENSE`。

## 内置的 B 站能力

`lib/bili/` 把 **dsh-bili-scroll** 的后端能力内置进来，让「大肥鱼」本人去刷 B 站，
而不是另起一个没有她人设的值班会话。

- **dsh-bili-scroll**（MIT，Copyright (c) 2026 c1overzz）
  - 来源：https://github.com/c1overzz/dsh-bili-scroll
  - 本仓库内置/改写的部分：`lib/bili/` 下的 MCP 客户端、扫码登录、私信、UID 解析、
    `asr.py`、`favops.py`、`uv` 下载器，以及调度/分享/转写这几层的思路。
- **bilibili-mcp**（MIT，Copyright (c) 2026 AGI_Ananas）
  - 来源：https://github.com/adoresever/bilibili-mcp
  - 本仓库内置：`lib/bili/vendor/mcp_server.py`（经 dsh-bili-scroll 改造）。
  - 完整许可见 `lib/bili/vendor/LICENSE`。

## 我们改了什么

- 调度不再起 headless 值班会话；到点往「大肥鱼」自己的会话里递一句处境，
  人设、工具闸门、记忆都由 dsh-fish-kin 自己的运行时负责。
- 配置存进 `<家族工作区>/fish/config.json` 的 `bili` 组；运行数据在 `<家族工作区>/fish/bili/`。
- 第一次启动时一次性搬老 `$DSH_HOME/bili-duty/` 的凭证、判重表与偏好（不搬人设）。
- 只注册读 / 挑 / 分享 / 记 / 转写这些窄口工具；上传视频、发动态、发专栏、抓全站**不注册**。

MIT 许可证允许修改、再分发与商用；保留原版权行与 MIT 正文即可。
