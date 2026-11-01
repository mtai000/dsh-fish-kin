/**
 * bili/tools.js —— 她手里的 B 站工具（宿主侧窄口）
 *
 * 这些工具**不是**把整台 Python MCP 暴露出去：只有读、挑、分享、记这几类。
 * 上传视频 / 发动态 / 抓全站那些根本不注册。
 *
 * 所有写动作都走宿主定死的路径（报告 / 判重表 / 归档），不接受任何路径参数。
 */

import { defineTool } from '../tool.js'
import { toJsonSchema } from '../toolschema.js'
import { callMcp, callMcpRaw, resetClient } from './runtime.js'
import { loadBili } from './settings.js'
import { appendReport, appendSeen, readReport, seenRecent, countPickedToday, parseSeen } from './store.js'
import { shareItems, markSkipped } from './share.js'
import { asrState, startAsrInstall, startInstall, venvState, appendInstall, appendAsr, installState } from './install.js'
import { loginStart, loginPoll, saveCredential, renderQrPng } from './login.js'
import { ownerUidFallback, sendDm } from './share.js'
import { runRound } from './round.js'
import { isHerPlace } from '../fish/places.js'
import { normPath } from '../text.js'
import { biliPaths, dayKey, inPeak, maxRunsToday, slotsFor } from './config.js'

const textOut = {
  schema: { type: 'object', properties: {}, additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
}

const safe = (v) => {
  if (v === undefined || v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  try { return JSON.parse(JSON.stringify(v)) } catch { return String(v) }
}

const parse = (v) => {
  if (typeof v !== 'string') return v
  try { return JSON.parse(v) } catch { return v }
}

const imageOut = {
  schema: { type: 'object', properties: {}, additionalProperties: true },
  render: (_args, value) => {
    const src = value && typeof value === 'object' ? value : { value }
    const { image, images, ...rest } = src
    const parts = [{ type: 'text', text: JSON.stringify(rest, null, 2) }]
    const refs = [...(image ? [image] : []), ...(Array.isArray(images) ? images : [])]
    for (const ref of refs) parts.push({ type: 'image', attachment: ref })
    return parts
  },
}

function makeAttach(ctx) {
  return async (exec, images) => {
    const attachments = ctx?.get?.('attachments')
    if (!attachments?.saveImages) return { ok: false, reason: 'attachments', hint: '宿主的图片服务不可用' }
    const llm = ctx?.get?.('llm')
    const routed = exec?.agent?.session?.requestHeader?.()?.config
    const provider = routed?.provider ?? exec?.agent?.options?.provider
    const model = routed?.model ?? exec?.agent?.options?.model
    if (!llm?.resolveModelInfo) return { ok: false, reason: 'model_probe', hint: `查不到模型能力（${provider}/${model}）` }
    let modalities
    try { modalities = (await llm.resolveModelInfo(provider, model, exec?.signal))?.inputModalities } catch (e) {
      return { ok: false, reason: 'model_probe', hint: `查模型能力失败：${String(e?.message ?? e)}` }
    }
    if (!Array.isArray(modalities)) return { ok: false, reason: 'model_probe', hint: `模型 ${provider}/${model} 没声明输入模态` }
    if (!modalities.includes('image')) return { ok: false, reason: 'model_no_image', hint: `模型 ${provider}/${model} 不支持图片输入` }
    try {
      const refs = await attachments.saveImages(images.map((i) => ({ data: Buffer.from(i.data, 'base64'), mediaType: i.mimeType })))
      return { ok: true, refs }
    } catch (e) {
      return { ok: false, reason: 'save_failed', hint: '存图片失败：' + String(e?.message ?? e) }
    }
  }
}

/** 读一个视频的封面/帧，把图塞进工具返回。 */
async function withImages(ctx, exec, mcpName, args, attach) {
  const { json, images } = await callMcpRaw(args.__root, args.__cfg, mcpName, args.__mcpArgs, { signal: exec?.signal })
  const meta = json && typeof json === 'object' ? json : { raw: json }
  if (!meta.ok) return meta
  if (!images.length) return { ...meta, ok: false, error: 'MCP 没返回图片' }
  const a = await attach(exec, images)
  return a.ok
    ? { ...meta, image_attached: true, images: a.refs }
    : { ...meta, image_attached: false, image_skip_reason: a.reason, hint: a.hint }
}

export function registerBiliTools(ctx, { root, log = () => {} } = {}) {
  if (!ctx?.tools?.register) return []
  const isHers = (exec) => {
    try {
      const cwd = exec?.agent?.session?.header?.cwd ?? exec?.agent?.header?.cwd ?? exec?.agent?.session?.cwd ?? ''
      return Boolean(cwd) && isHerPlace(root, cwd, normPath)
    } catch { return false }
  }
  const offs = []
  const attach = makeAttach(ctx)
  const cfg = () => loadBili(root)

  const reg = (spec) => {
    try {
      const d = ctx.tools.register(defineTool({
        ...spec,
        output: spec.output || textOut,
        async execute(args = {}, exec) {
          try {
            return safe(await spec.execute(args ?? {}, exec))
          } catch (e) {
            return { ok: false, error: String(e?.message ?? e) }
          }
        },
      }))
      if (typeof d === 'function') offs.push(d)
      else if (d && typeof d.dispose === 'function') offs.push(() => d.dispose())
    } catch (e) {
      log(`工具 ${spec?.name} 没挂上：${String(e?.message ?? e).slice(0, 120)}`)
    }
  }

  const ownerOnly = (exec) => (isHers(exec) ? { ok: false, error: '这是主人自己的设置 / 登录工具，不给她用。' } : null)

  const mcp = async (name, args, cfgNow) => {
    const c = cfgNow ?? (await cfg())
    return parse(await callMcp(root, c, name, args))
  }

  /* ───────── 看：搜索 / 推荐 / 字幕 / 评论 / 详情 / 弹幕 ───────── */

  reg({
    name: 'bili_search',
    description: '搜 B 站视频（标题 / BV 号 / 播放 / UP / 时长 / 简介）。刷的时候先搜，再挑几条读字幕原文，别只看标题下结论。',
    parameters: toJsonSchema({
      keyword: { type: 'string', required: true, description: '关键词' },
      num: { type: 'number', description: '几条（默认 10，最多 50）' },
      order: { type: 'string', enum: ['totalrank', 'click', 'pubdate', 'dm'], description: '排序' },
      page: { type: 'number', description: '第几页（从 1 开始）' },
    }),
    async execute(args) {
      return mcp('bili_search', {
        keyword: String(args.keyword ?? ''),
        num: Math.max(1, Math.min(Number(args.num) || 10, 50)),
        order: String(args.order || 'totalrank'),
        page: Math.max(1, Number(args.page) || 1),
      })
    },
  })

  reg({
    name: 'bili_recommend',
    description: '刷这个账号的 B 站首页推荐流（没填关键词时用它）。返回标题 / BV / UP / 播放 / 时长 / 推荐理由。',
    parameters: toJsonSchema({ ps: { type: 'number', description: '几条（默认 20，最多 40）' } }),
    async execute(args) {
      return mcp('bili_recommend', { ps: Math.max(1, Math.min(Number(args.ps) || 20, 40)) })
    },
  })

  reg({
    name: 'bili_subtitle',
    description: '取一个视频的字幕全文（判断内容就靠它）。没字幕时：转写开着且装好了会自动排一条转写任务，返回 job_id；否则明确告诉你没有字幕。',
    parameters: toJsonSchema({ bvid: { type: 'string', required: true, description: 'BV 号' } }),
    async execute(args) {
      const c = await cfg()
      const bv = (/BV[0-9A-Za-z]{10}/.exec(String(args.bvid ?? '')) || [])[0]
      if (!bv) return { ok: false, error: '给一个 BV 号' }
      const r = await mcp('bili_subtitle', { bvid: bv }, c)
      const noSub = r && typeof r === 'object' && (r.message === '该视频没有字幕' || /没有字幕/.test(String(r.message ?? '')))
      if (!noSub) return r
      if (!c.transcribe.enabled) return { ok: false, bvid: bv, no_subtitle: true, hint: '这条没有字幕；本地转写关着，所以只能跳过。' }
      const st = await asrState(root, c)
      if (!st.ready) return { ok: false, bvid: bv, no_subtitle: true, asr_ready: false, hint: `转写开着但依赖没装好（${st.reason}）⇒ 这一条只能跳过。` }
      const job = await mcp('bili_transcribe_start', { bvid: bv }, c)
      return { ok: true, bvid: bv, no_subtitle: true, transcribe: job, hint: '转写已排队。这一轮先干别的，收尾时用 bili_transcribe_result 取结果。' }
    },
  })

  reg({
    name: 'bili_transcribe_start',
    description: '给一条没字幕的视频排本地转写（立刻返回 job_id，不等）。收尾时用 bili_transcribe_result 取。',
    parameters: toJsonSchema({ bvid: { type: 'string', required: true, description: 'BV 号' } }),
    async execute(args) {
      const c = await cfg()
      const st = await asrState(root, c)
      if (!st.ready) return { ok: false, error: `转写依赖没装好（${st.reason}）⇒ 去设置里点「安装转写依赖」。` }
      return mcp('bili_transcribe_start', { bvid: String(args.bvid ?? '') }, c)
    },
  })

  reg({
    name: 'bili_transcribe_result',
    description: '取一条转写任务的结果（running / done / error）。',
    parameters: toJsonSchema({ job_id: { type: 'string', required: true, description: 'bili_transcribe_start 给的 id' } }),
    async execute(args) {
      return mcp('bili_transcribe_result', { job_id: String(args.job_id ?? '') })
    },
  })

  reg({
    name: 'bili_comments',
    description: '取一个视频的热门评论（含点赞/回复数）。顺手翻一眼，看值不值得占他一次注意力。',
    parameters: toJsonSchema({
      bvid: { type: 'string', required: true, description: 'BV 号' },
      num: { type: 'number', description: '几条（默认 30）' },
    }),
    async execute(args) {
      return mcp('bili_comments', { bvid: String(args.bvid ?? ''), num: Math.max(1, Number(args.num) || 30) })
    },
  })

  reg({
    name: 'bili_video_info',
    description: '看一个视频的详情（播放 / 点赞 / 收藏 / 时长 / 简介 / 分P）。',
    parameters: toJsonSchema({ bvid: { type: 'string', required: true, description: 'BV 号' } }),
    async execute(args) { return mcp('bili_video_info', { bvid: String(args.bvid ?? '') }) },
  })

  reg({
    name: 'bili_danmaku',
    description: '取一个视频的弹幕（判断现场反应有时比评论更直接）。',
    parameters: toJsonSchema({
      bvid: { type: 'string', required: true, description: 'BV 号' },
      num: { type: 'number', description: '几条（默认 100）' },
    }),
    async execute(args) { return mcp('bili_danmaku', { bvid: String(args.bvid ?? ''), num: Math.max(1, Number(args.num) || 100) }) },
  })

  reg({
    name: 'bili_cover',
    description: '看一个视频的封面（最便宜的一档"看一眼"）。模型不支持图片时会退化成文字说明。',
    parameters: toJsonSchema({ bvid: { type: 'string', required: true, description: 'BV 号' } }),
    output: imageOut,
    async execute(args, exec) {
      const c = await cfg()
      return withImages(ctx, exec, 'bili_cover', { __root: root, __cfg: c, __mcpArgs: { bvid: String(args.bvid ?? '') } }, attach)
    },
  })

  reg({
    name: 'bili_frames',
    description: '看视频里的画面（从 B 站故事板裁 1–6 帧）。字幕告诉你说了什么，画面告诉你拍的是什么。',
    parameters: toJsonSchema({
      bvid: { type: 'string', required: true, description: 'BV 号' },
      num: { type: 'number', description: '几帧（1–6，默认 3）' },
      at: { type: 'array', items: { type: 'number' }, description: '指定时间点（秒）；传了就以它为准' },
    }),
    output: imageOut,
    async execute(args, exec) {
      const c = await cfg()
      const at = Array.isArray(args.at) ? args.at.map(Number).filter(Number.isFinite) : undefined
      return withImages(ctx, exec, 'bili_frames', {
        __root: root,
        __cfg: c,
        __mcpArgs: { bvid: String(args.bvid ?? ''), num: Math.max(1, Math.min(Number(args.num) || 3, 6)), ...(at && at.length ? { at } : {}) },
      }, attach)
    },
  })

  /* ───────── 挑：判重 / 分享 / 跳过 / 报告 ───────── */

  reg({
    name: 'bili_seen_recent',
    description: '查她最近看过的视频（判重）。挑之前先看一眼，别把前几天推过的又挑一遍。',
    parameters: toJsonSchema({
      limit: { type: 'number', description: '最近多少行（默认 40）' },
      bvid: { type: 'string', description: '只看某个 BV（可省）' },
    }),
    async execute(args) {
      const rows = seenRecent(root, { limit: Number(args.limit) || 40, bvid: String(args.bvid ?? '') })
      if (!rows.length) return { ok: true, count: 0, items: [], text: '（最近没有记录）' }
      return { ok: true, count: rows.length, items: rows, text: rows.map((r) => `${r.day} | ${r.bvid} | ${r.title} | ${r.up} | ${r.status}`).join('\n') }
    },
  })

  reg({
    name: 'bili_seen_append',
    description: '把一条看过的视频记进判重表（跳过的也记，写一句理由）。宿主只往固定文件里追加。',
    parameters: toJsonSchema({
      bvid: { type: 'string', required: true, description: 'BV 号' },
      title: { type: 'string', description: '标题' },
      up: { type: 'string', description: 'UP 主' },
      status: { type: 'string', description: '例如「跳过 · 太长」「挑了」；默认跳过' },
    }),
    async execute(args) {
      const status = String(args.status || '跳过').trim() || '跳过'
      if (status.startsWith('跳过')) {
        const r = await markSkipped(root, await cfg(), { bvid: args.bvid, title: args.title, up: args.up }, status.replace(/^跳过\s*·?\s*/, ''))
        return r.ok ? { ok: true, bvid: r.bvid, hint: '记下了' } : r
      }
      const bv = (/BV[0-9A-Za-z]{10}/.exec(String(args.bvid ?? '')) || [])[0]
      if (!bv) return { ok: false, error: 'bvid 不对' }
      const r = appendSeen(root, { bvid: bv, title: String(args.title ?? ''), up: String(args.up ?? ''), status })
      return r.ok ? { ok: true, bvid: bv, hint: '记下了' } : r
    },
  })

  reg({
    name: 'bili_share',
    description: '把这一轮挑中的视频分享给他：**私信一条**（标题 + 链接 + 一句话理由），同时写日报 / 判重表 / 归档，并记进她「最近看到」。'
      + '一次最多 5 条；已经看过的不再发。要么传 items 数组，要么传单条的 bvid/title/why。',
    parameters: toJsonSchema({
      items: {
        type: 'array',
        description: '要分享的条目（最多 5 条）',
        items: {
          type: 'object',
          properties: {
            bvid: { type: 'string', description: 'BV 号' },
            title: { type: 'string' },
            up: { type: 'string' },
            why: { type: 'string', description: '一句话理由（别超过 80 字）' },
            tier: { type: 'string', description: '值得看 / 可以看' },
            url: { type: 'string' },
          },
          required: ['bvid'],
        },
      },
      bvid: { type: 'string', description: '单条模式的 BV 号' },
      title: { type: 'string' },
      why: { type: 'string' },
      tier: { type: 'string' },
      force: { type: 'boolean', description: '即使最近看过也再发一次（慎用）' },
    }),
    async execute(args) {
      const items = Array.isArray(args.items) && args.items.length
        ? args.items
        : (args.bvid ? [{ bvid: args.bvid, title: args.title, why: args.why, tier: args.tier }] : [])
      const r = await shareItems(root, await cfg(), items, { log, force: args.force === true })
      if (r.ok) log(`分享了 ${r.items.length} 条（私信${r.sent ? '成功' : '未发出'}）：${r.items.map((x) => x.bvid).join(' ')}`)
      return r
    },
  })

  reg({
    name: 'bili_report_append',
    description: '往今天的 B 站日报末尾追加一段（她自己的总结 / 为什么没挑）。固定写她家，不接受路径。',
    parameters: toJsonSchema({ text: { type: 'string', required: true, description: 'markdown 文本' } }),
    async execute(args) {
      const c = await cfg()
      if (c.report === 'off') return { ok: false, error: '设置里关着日报（report=off）⇒ 这一轮不写日报' }
      const r = appendReport(root, String(args.text ?? ''))
      return r.ok ? { ok: true, file: r.file } : r
    },
  })

  reg({
    name: 'bili_report_read',
    description: '读今天的 B 站日报（看看这一轮已经写了什么，避免重复）。',
    parameters: toJsonSchema({}),
    async execute() {
      const r = readReport(root)
      return { ok: r.ok, text: r.text, pickedToday: countPickedToday(root) }
    },
  })

  /* ───────── 说：评论 / 私信回复（安全闸在工具层） ───────── */

  reg({
    name: 'bili_replies',
    description: '看谁回复了她在 B 站发过的评论（只读通知）。开了「回复评论」时先用它看一眼；只回直接回复到她自己评论下面的人。',
    parameters: toJsonSchema({}),
    async execute() { return mcp('bili_received_replies', {}) },
  })

  reg({
    name: 'bili_reply',
    description: '在视频下发一条公开评论（或回复某条评论）。**默认关着**：设置里开了「自动评论」并填了 @ 谁才会放行；'
      + '本人当场让你发时可以传 force:true。评论要短、干净、纯文本 @，别写隐私和内部术语。',
    parameters: toJsonSchema({
      bvid: { type: 'string', required: true, description: 'BV 号' },
      text: { type: 'string', required: true, description: '评论正文' },
      rpid: { type: 'number', description: '要回复的评论 id（0/不填 = 发新评论）' },
      root: { type: 'number', description: '楼中楼：被回复的那条根评论 id（可省）' },
      force: { type: 'boolean', description: '本人当场让你发的' },
    }),
    async execute(args) {
      const c = await cfg()
      const on = Boolean(c.comment.enabled && c.comment.mention)
      if (!on && args.force !== true) {
        return { ok: false, blocked: true, hint: '公开评论得先在设置里打开「自动评论」并填「要 @ 谁」；本人当场让你发时传 force:true。' }
      }
      return mcp('bili_reply', { bvid: String(args.bvid ?? ''), text: String(args.text ?? ''), rpid: Number(args.rpid) || 0, root: Number(args.root) || 0 }, c)
    },
  })

  reg({
    name: 'bili_dm_reply',
    description: '回一条 B 站私信给主人（只发给设置里的分享对象 / 登录账号自己）。100 字以内，像聊天，别带 markdown。',
    parameters: toJsonSchema({ text: { type: 'string', required: true, description: '要回的话' } }),
    async execute(args) {
      const c = await cfg()
      const uid = Number(c.share.uid) || ownerUidFallback(root)
      const r = await sendDm(root, c, uid, String(args.text ?? '').slice(0, 480))
      return r.ok ? { ok: true, hint: '发出去了' } : { ok: false, error: r.error }
    },
  })

  /* ───────── 环境 / 登录 / 状态（给主人和主会话用） ───────── */

  reg({
    name: 'bili_whoami',
    description: '看 B 站那边登录的是谁（凭证是否有效、昵称、mid）。',
    parameters: toJsonSchema({}),
    async execute() {
      const c = await cfg()
      try {
        const r = await mcp('bili_check_credential', {}, c)
        const obj = r && typeof r === 'object' ? r : { raw: r }
        return { ...obj, ok: obj.logged_in !== false }
      } catch (e) {
        return { ok: false, hint: '还没登录，或后端没装好。去设置 → 大肥鱼 → B站 点「扫码登录」。', error: String(e?.message ?? e) }
      }
    },
  })

  reg({
    name: 'bili_status',
    description: '看她今天的 B 站状态：跑了几轮、挑了几条、额度、登录、转写、下一次什么时候。',
    parameters: toJsonSchema({}),
    async execute() {
      const c = await cfg()
      const p = biliPaths(root)
      const v = await venvState(root, c)
      const a = await asrState(root, c)
      const st = (await import('./store.js')).loadState(root)
      return {
        ok: true,
        enabled: c.enabled,
        schedule: c.schedule,
        windows: { nowPeak: inPeak(), slots: slotsFor(c).map((s) => s.key), maxRuns: maxRunsToday(c) },
        today: dayKey(),
        runs: st.runCount,
        pickedToday: countPickedToday(root),
        lastRunAt: st.lastRunAt,
        lastWhy: st.lastWhy,
        env: { ready: v.ready, python: v.python, asrReady: a.ready, installing: installState(root).installing, asrInstalling: installState(root).installingAsr },
        loggedIn: (await import('node:fs')).existsSync(p.credential),
        share: c.share,
        comment: c.comment,
        report: p.report,
        log: p.log,
      }
    },
  })

  reg({
    name: 'bili_setup',
    description: '给 B 站后端装 Python 环境（建 venv + 装 4 个包）。第一次用之前跑一次；起完就返回，进度看 install.log。',
    parameters: toJsonSchema({}),
    async execute(_args, exec) {
      const deny = ownerOnly(exec); if (deny) return deny
      const c = await cfg()
      const r = startInstall(root, c)
      appendInstall(root, `\n[${new Date().toISOString()}] 从工具触发安装\n`)
      return r
    },
  })

  reg({
    name: 'bili_asr_setup',
    description: '装「本地转写」那一套（独立 venv + faster-whisper + yt-dlp，会下几百 MB 模型）。起完就返回。',
    parameters: toJsonSchema({}),
    async execute(_args, exec) {
      const deny = ownerOnly(exec); if (deny) return deny
      const c = await cfg()
      const r = startAsrInstall(root, c)
      appendAsr(root, `\n[${new Date().toISOString()}] 从工具触发安装\n`)
      return r
    },
  })

  reg({
    name: 'bili_login_start',
    description: '开始 B 站扫码登录：出二维码 PNG（存她家目录），返回路径和 key。用 present 把图给本人扫，再轮询 bili_login_poll。',
    parameters: toJsonSchema({}),
    async execute(_args, exec) {
      const deny = ownerOnly(exec); if (deny) return deny
      const c = await cfg()
      try {
        const { key, url } = await loginStart()
        const png = await renderQrPng(c.pythonPath || (await import('./runtime.js')).pythonFor(root, c), biliPaths(root).home, url)
        return { ok: true, key, url, png, hint: '二维码约 180 秒有效；手机上确认时选「记住我 / 长期」。' }
      } catch (e) {
        return { ok: false, error: String(e?.message ?? e) }
      }
    },
  })

  reg({
    name: 'bili_login_poll',
    description: '查扫码结果：waiting / scanned / ok / expired。成功会自动把凭证写进她家目录。',
    parameters: toJsonSchema({ key: { type: 'string', required: true, description: 'bili_login_start 给的 key' } }),
    async execute(args, exec) {
      const deny = ownerOnly(exec); if (deny) return deny
      try {
        const r = await loginPoll(String(args.key ?? ''))
        if (r.state === 'ok') {
          const file = saveCredential(biliPaths(root).home, r.credential)
          return { ok: true, state: 'ok', file }
        }
        return { ok: r.state !== 'unknown', state: r.state, code: r.code, message: r.message }
      } catch (e) {
        return { ok: false, error: String(e?.message ?? e) }
      }
    },
  })

  reg({
    name: 'bili_config',
    description: '读 / 改 B 站设置（不给 patch 就是读）。只认 schedule / preferences / report / share / comment / transcribe 等字段。',
    parameters: toJsonSchema({ patch: { type: 'object', additionalProperties: true, description: '要改的字段（可省）' } }),
    async execute(args, exec) {
      const deny = ownerOnly(exec); if (deny) return deny
      const c0 = await cfg()
      if (args?.patch && typeof args.patch === 'object' && !Array.isArray(args.patch)) {
        const { saveBili } = await import('./settings.js')
        const r = await saveBili(root, args.patch)
        try { resetClient(root) } catch { /* ignore */ }
        return { ok: r.ok, config: r.bili, why: r.why }
      }
      return { ok: true, config: c0 }
    },
  })

  reg({
    name: 'bili_run',
    description: '**立刻叫她逛一轮 B 站**（不等时间表）。这一轮会递进她自己的会话，用她的人设去挑、去分享。',
    parameters: toJsonSchema({}),
    async execute() {
      const r = await runRound(ctx, { root, log, why: 'manual' })
      return r.ok ? { ok: true, started: true, sessionId: r.sessionId, hint: '已经把「去逛逛」递给她了' } : { ok: false, started: false, why: r.why }
    },
  })

  reg({
    name: 'bili_today',
    description: '看她今天刷过的视频（结构化列表）和日报路径。',
    parameters: toJsonSchema({ limit: { type: 'number', description: '最多几条（默认 30）' } }),
    async execute(args) {
      const rows = parseSeen(root).slice(0, Math.max(1, Math.min(Number(args.limit) || 30, 100)))
      return { ok: true, count: rows.length, items: rows, report: biliPaths(root).report }
    },
  })

  return offs
}

// 让测试/界面能拿到一些纯函数
export { parse, safe }
