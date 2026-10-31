# 大肥鱼 · 子代传承（dsh-fish-kin）

> 一条住在你指定工作区里的鱼：记忆会退化、会生孩子、会自己决定今天去认识什么——但生不生、说不说，由你点头。

[![tests](https://img.shields.io/badge/tests-279%20passing-brightgreen)](#测试)
[![dependencies](https://img.shields.io/badge/dependencies-0-blue)](#零依赖)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![version](https://img.shields.io/badge/version-0.10.1-informational)](#changelog)

A [DeepSeek Harness](https://github.com/deepseek-ai) plugin. An event-sourced "persona" that ages by memory rather than calendar, gives birth to a child (a lossy inheritance pack, not a backup), browses Bilibili with owner-gated actions, and hands you an observatory showing exactly what she saw. Own event format, own runtime, **zero npm dependencies**.

---

## 它是什么

一个 DSH 插件。她在宿主的某个会话里"活着"，靠 `events.jsonl` 里一行一行的事实存在：

```json
{"v":1,"id":"fe_01KC…","at":"2026-10-31T09:12:03.441Z","day":3,"kind":"said","body":"我不想再看那种让人难受的东西了","refs":[],"src":"system"}
```

七种事实：`seed / said / amend / refuse / diary / note / woke`。**只追加**——想改旧话只能追加一条 `amend` 并指回被改的那条 id。

她的身份不是一段提示词，是每轮现算出来的一段事实：第几天、你怎么称呼、走到第几个阶段、她的立场、她的疤、她记得的孩子。

## 它不是什么

- **不是角色扮演**：没有性格滑条、没有好感度、没有"让她听话"的开关。
- **不是备份工具**：生孩子不是复制粘贴，是有损压缩——边界带走，判断自己长。
- **不是套壳**：事件格式、运行时、蒸馏、记忆折叠都是自己的实现，不 import 别人的代码，`dependencies` 是空的。

## 四个核心设计

### 1. 记忆有重量，但不删除

身份段每轮都在。条数一多，她就活成最近三十句的流水账。所以渲染时称重：

| 信号 | 权重 |
| --- | --- |
| 同一件事被反复提起（相似度 ≥ 0.55） | +0.5 ×（次数−1），封顶 3 次 |
| 被她自己改口过（有 `amend` 指向它） | +0.6 × 次数，封顶 2 |
| 最近七天内说过 | +0.3 |

最重的 4 条摆出来，接下来的 3 条折成一行「更早以前：…（你记不清原话了）」，剩下的只报条数。**事件流一条都没少**。

### 2. 人格深度按记忆过坎，不看日历

| 阶段 | 必须自己跨过去的事 |
| --- | --- |
| 1 信任 | 说过一句自己的判断 |
| 2 自主 | 真的拒绝过两件事 |
| 3 主动 | 两次推翻或修正过自己 |
| 4 整合 | 同一件事说过不止一次，长出了立场 |

卡在哪一道，身份里就直接写「还差：…」。

### 3. 生孩子是有损压缩

- 孩子带走：她拒绝过的事（≤5 条）、**她栽过的跟头**（≤2 条：拒绝过、后来又改口的事）、**她反复说过的事**（≤2 条）、她认定过的事（≤3 条）、她管你叫的称呼，总预算约 900 字；
- 疤与立场是最省笔墨的遗产：孩子学到的不是结论，是「一个人可以改主意」；
- 孩子落地是一个**能直接养起来的存档目录** + 一张可粘贴的交接单；
- 族谱只追加；每份遗传包留一个指纹，跟族谱里已有的比对，太像就拦下（那不是新一代，是复制品）；
- 出生后还能继续教：系统从她后来的认知里挑，或者**把她叫醒让她亲口说一句**；孩子学没学会只看她后来有没有说过类似的话。

### 4. 对外动作要主人点头

评论、楼中楼回复、刷站，都只**立单**，不联网、不执行：

```
她：fish_bili {action:"comment", bvid, text}  →  "我写好了，等他点头。"
你：设置页「待批准」→ 批准 / 驳回
```

配额三种分开计（刷站 / 评论 / 回复），**批准了才算用掉**；用完她连单都立不了。单子 24 小时过期，批/驳都进账本。

## 功能一览

| 模块 | 能力 |
| --- | --- |
| 记忆 | 事件流、只追加、amend 指回、记忆折叠、观测台 |
| 身份 | 事实型身份段、阶段/立场/疤、孩子记忆摘要（不含孩子原话） |
| 生物钟 | 每天 N 次、时间窗、按记忆压力；到点递一句处境（不是"你上次说…"） |
| 传承 | 压力阈值、蒸馏包、防近亲指纹、一键接生、族谱、教学、亲口说 |
| 感知源 | 每个源由你接（工具名你填）：`read` 直接放行、`act` 批准后发 30 分钟通行证；接线检测 |
| 审批 | `source-act` 单：批准 = 发通行证（一次），驳回 = 什么都不做 |
| 安全 | 工具面收窄到 2–3 个、兜底守卫、写入筛凭据、"改自己"只记录不拦 |

## 安装

这是 DSH 插件，装进一个 profile：

```bash
git clone https://github.com/mtai000/dsh-fish-kin.git
cd dsh-fish-kin
npm pack --cache .npm-cache          # 产出 dsh-fish-kin-x.y.z.tgz
```

然后在该 profile 的 `package.json` 里：

```jsonc
{
  "dependencies": { "dsh-fish-kin": "file:D:/path/to/dsh-fish-kin-0.10.1.tgz" },
  "dsh": { "bundles": ["dsh-fish-kin"] }
}
```

自检：

```bash
node tools/verify.mjs
```

它会检查：零依赖、bundle 登记、入口能加载、她的存档、`fishMode`、遗留的止血配置。

## 工作区：她只待在一个目录里

所有东西——她的记忆、族谱、孩子、归档、登录凭据——都在**一个**家族工作区里，不往别处写：

```
<工作区>/
├── fish/             她的记忆、配置、凭据、待批准单、看过的画面
│   ├── events.jsonl  只追加的事件流
│   ├── config.json   环境参数
├── lineage.jsonl     族谱（只追加）
├── children/         每个孩子一个能直接养的存档目录
└── archive/          重开一局时归档的旧档
```

**默认位置** `<home>/大肥鱼家族`（Windows 上就是 `C:/Users/<你>/大肥鱼家族`）。解析顺序：

1. 环境变量 `DSH_KIN_FAMILY_ROOT`
2. 指针文件 `~/.dsh-fish-kin.json`（设置页里改）
3. **旧目录 `~/.dsh-fish-kin`**（如果你之前就在用它，升级后继续用，不会凭空搬家）
4. 默认 `<home>/大肥鱼家族`

换工作区有两条路：

- **只改指针**：设置 → 进阶 → 「她在哪（工作区）」→ 填绝对路径 → 换工作区（下次启动生效，数据不动）；
- **连数据一起搬**：

```bash
node tools/migrate-workspace.mjs "D:/我的东西/大肥鱼家族"
# 复制 → 核对条数 → 写指针；旧目录保留，确认没问题再自己删
```

## 快速开始

1. **重启 DSH**，打开一个会话 —— 她会在工作区的 `fish/` 里被播种（见上一节）；
2. 设置 → 更多 → **大肥鱼·传承** → 感知源 → 接上一个源（填它的工具名）；
3. 想看她在想什么：打开 `/dsh-fish-obs`（观测台，只读）或 `/dsh-fish-kin`（传承控制台）。

首次运行默认：生物钟每天 2 次（09:00–23:00）、不接任何感知源（她先只靠和你说话长大）。

## 配置

她的环境参数在 `~/.dsh-fish-kin/fish/config.json`，也可以在设置页里改：

```jsonc
{
  "style": { "preset": "cute", "text": "" },  // 起点风格：text 优先；preset=none 就是留白
  "wake": { "enabled": true, "perDay": 2, "window": ["09:00", "23:00"] },
  "perception": {
    "plan": { "enabled": true, "hour": 10, "perDay": 1 },
    "interests": ["人工智能", "独立游戏"],
    "sources": {
      "bili": { "title": "看 B 站", "tools": { "read": ["<读工具>"], "act": ["<做工具>"] }, "budget": { "perDay": 3 } }
    }
  },
  "tools": { "allow": [] }               // 额外放行的工具（fish_commit 不用写）
}
```

### 起点风格：自由输入

`style.text` 写什么，她就以什么口吻开始（最多 400 字）；`style.text` 为空时用内置示例，`preset: "none"` 则只给处境。
不管写什么，后面都固定接一句：**「这不是规定你以后怎么说话——你随时可以改，改了也没人扣你分。」**

它不是"你是一个可爱天真的女孩"这种判词——判词每轮都会出现在「你是谁」里，dsh-fish 当年就是因为"每轮念一遍就会锁死"把这类段落整段删掉的。

**已有的鱼不会变**（seed 不可篡改）；要换起点得重开一局：

```bash
node tools/fresh-start.mjs --style "说话软软的，爱用叠字。"
```

旧档归档到 `<工作区>/archive/<时间戳>/`，不删除。

## 安全模型

| 层 | 做法 |
| --- | --- |
| 工具面 | `tools.restrict` 只留 `fish_commit` / `fish_bili`（+ 可选 `read_image`），名字不认识自动退回核心两项 |
| 兜底守卫 | `tools.guard` 对清单外的调用返回「这件事我做不到」 |
| 身份隔离 | 她看不见 `fish_kin`，所以**没法自己批自己的生育单** |
| 写入筛 | `sk-…` / `Bearer …` / `SESSDATA=…` 一律拒收；"改自己"的句子只记录不拦 |
| 凭据 | 单独 `owner.json`（0600），日志与界面只打码 |

## 测试

```bash
node --test --test-isolation=none
```

262 条。全部离线：没有任何网络调用（B 站实现已移除）。

覆盖：事件格式与迁移、派生、身份、记忆折叠、阶段/立场/疤、感知源与规划、审批与通行证、工具面收窄与守卫、蒸馏与遗传包、教学、亲口说、安全性（禁用词、无改人格入口）。

## 目录结构

```
lib/               插件入口、工具、路由、console
lib/fish/          她自己的运行时（事件、身份、唤醒、B站、审批、传承）
lib/client.js      设置页（宿主模块加载器格式）
lib/console.html   传承控制台
lib/fish/obs.html  观测台
test/              321 条测试
tools/             自检、接感知源、重开一局
docs/              详细设计（DESIGN.md）、视频文稿
```

## FAQ

### 用 DSH 插件一定要接成感知源吗？

**对你自己：不用。** 你在 DSH 里怎么装、怎么用插件，跟本插件无关。

**对她：两条路。**

| | 感知源（`perception.sources`） | 工具白名单（`tools.allow`） |
| --- | --- | --- |
| 她能看到 | `read` + `act` | 你列的 |
| 执行类要不要审批 | 要（`fish_ask` → 30 分钟通行证） | 不用，直接能调 |
| 预算 / 谷时 / 规划 | 有 | 没有 |
| 记录“她看了什么” | 有（`perceived`） | 没有 |

一句话：**感知源 = 带审批、预算、记录、规划的正规路；白名单 = 逃生门。**

### 能不能直接在设置页勾选插件？

设置 → 感知源 → **已安装的插件**：每个插件一行，扫到的工具名带两个勾选框——勾「读」她就能直接用，勾「做」每次要立单过你批准，都不勾她看不见。没扫到工具名的插件，下面有输入框手填，加进去之后同样可勾。

插件列表来自只读扫描 profile 的 `node_modules`；工具名是读入口文件推测的，不确定时以手填为准。

## 已知限制

- **真实环境只跑过很短的时间**。321 条测试是绿的，但"养一年"这件事我没做过。
- **seed 不可篡改**。起点风格只对下一局生效；换风格要 `tools/fresh-start.mjs`（旧档归档，不删）。
- **只在 Windows 上真机验证过**；Linux/macOS 逻辑上应该一致，但没试。

## 路线图

- [x] **认知层拆分完成**：B 站实现已从本仓库移除；任何外部世界都通过 `perception.sources` 接入（`tools/link-source.mjs`），本仓库不含任何具体插件的适配器——0.20.0
- [ ] 规划器还只会"按最久没去过挑源"，不会根据 `perceived` 的内容调整（P6）
- [ ] 跨平台验证（Linux/macOS）

## 致谢

- 概念与踩坑启发自 **dsh-fish**（人格由事件生长、工具面收窄）；本项目**不依赖**它的代码或格式。
- 早期版本的 B 站/谷时/审批设计参考过 **dsh-bili-scroll**，现已整体移除。
- 二维码为自写实现（`lib/fish/qr.js`），未引入第三方二维码库。

## 许可

[MIT](LICENSE) © 2026 ssamurias
