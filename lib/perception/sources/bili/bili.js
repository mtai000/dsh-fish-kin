/**
 * fish/bili.js —— B 站客户端（零依赖）
 *
 * 读：热门、详情、标签、热评 —— 不需要登录
 * 搜：搜索接口要 **wbi 签名**（不签会 -412）；签名后不带 cookie 也能用
 * 写：评论 / 回复评论 —— 必须登录（cookie 里的 SESSDATA + bili_jct）
 *
 * 四条纪律：
 *   1. **永不抛**：一律返回 { ok, code, message, data }。
 *   2. **串行 + 最小间隔 + 抖动**：把本机 IP 刷成 -412 是最容易犯的错。
 *   3. **风控分级熔断**：读 60 秒起、写 5 分钟起，只关自己那一级。
 *   4. **凭据不进日志**：日志只打打码后的东西（由调用方用 guard.scrub 处理）。
 */

import { createHash } from 'node:crypto'
import { inflateRawSync, inflateSync, gunzipSync } from 'node:zlib'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const API = 'https://api.bilibili.com'
const RISK_CODES = new Set([-352, -412, -509])

/** wbi 混淆表（B 站前端写死的常量，不是密钥） */
const MIXIN = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
]

const READ_COOLDOWN_MS = 60_000
const WRITE_COOLDOWN_MS = 5 * 60_000

export function mixinKey(imgKey, subKey) {
  const s = String(imgKey ?? '') + String(subKey ?? '')
  let out = ''
  for (const i of MIXIN) out += s[i] ?? ''
  return out.slice(0, 32)
}

/** 参数排序 → 取值去特殊字符 → md5(q + mk) 得 w_rid。 */
export function signQuery(params, mk, wts = Math.floor(Date.now() / 1000)) {
  const all = { ...params, wts }
  const q = Object.keys(all).sort().map((k) => {
    const v = String(all[k] ?? '').replace(/[!'()*]/g, '')
    return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`
  }).join('&')
  const w_rid = createHash('md5').update(q + mk).digest('hex')
  return `${q}&w_rid=${w_rid}`
}

export function stripEm(s) {
  return String(s ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}

export function createBiliClient(opts = {}) {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  const log = opts.log ?? (() => {})
  const minInt = Number.isFinite(opts.minIntervalMs) ? opts.minIntervalMs : 900
  const jitter = Number.isFinite(opts.jitterMs) ? opts.jitterMs : 400
  const timeoutMs = opts.timeoutMs ?? 12_000
  const now = opts.now ?? (() => Date.now())
  const cookie = String(opts.cookie ?? '')

  let last = 0
  let chain = Promise.resolve()
  let buvid = ''
  let buvidFailedAt = 0
  let mk = ''
  let mkAt = 0
  const risk = { read: 0, write: 0, readStreak: 0, writeStreak: 0 }

  const cooling = (kind = 'read') => now() < risk[kind]

  function noteRisk(kind) {
    if (kind === 'write') {
      risk.writeStreak += 1
      risk.write = now() + Math.min(30 * 60_000, WRITE_COOLDOWN_MS * 2 ** (risk.writeStreak - 1))
      return risk.write - now()
    }
    risk.readStreak += 1
    risk.read = now() + Math.min(10 * 60_000, READ_COOLDOWN_MS * 2 ** (risk.readStreak - 1))
    return risk.read - now()
  }

  function noteOk(kind) {
    if (kind === 'write') risk.writeStreak = 0
    else risk.readStreak = 0
  }

  function throttle(fn) {
    const run = chain.then(async () => {
      const wait = minInt + Math.floor(Math.random() * jitter) - (now() - last)
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      last = now()
      return fn()
    })
    chain = run.catch(() => {})
    return run
  }

  function cookieHeader() {
    return [buvid, cookie].filter(Boolean).join('; ')
  }

  async function raw(url, { referer, method = 'GET', body } = {}) {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      return await fetchImpl(url, {
        method,
        signal: ctl.signal,
        body,
        headers: {
          'user-agent': UA,
          referer: referer ?? 'https://www.bilibili.com/',
          accept: 'application/json, text/plain, */*',
          'accept-language': 'zh-CN,zh;q=0.9',
          ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
          ...(cookieHeader() ? { cookie: cookieHeader() } : {}),
        },
      })
    } finally {
      clearTimeout(t)
    }
  }

  async function ensureBuvid() {
    if (buvid) return true
    if (buvidFailedAt && now() - buvidFailedAt < 10 * 60_000) return false
    try {
      const r = await throttle(() => raw(`${API}/x/frontend/finger/spi`))
      const j = await r.json()
      const b3 = j?.data?.b_3
      if (!b3) { buvidFailedAt = now(); return false }
      buvid = `buvid3=${b3}${j?.data?.b_4 ? `; buvid4=${j.data.b_4}` : ''}`
      return true
    } catch {
      buvidFailedAt = now()
      return false
    }
  }

  /** 取 wbi 密钥（导航接口给 img_key/sub_key）；10 分钟内复用。 */
  async function ensureMk() {
    if (mk && now() - mkAt < 10 * 60_000) return mk
    try {
      const r = await throttle(() => raw(`${API}/x/web-interface/nav`))
      const j = await r.json()
      const wbi = j?.data?.wbi_img ?? {}
      const img = String(wbi.img_url ?? '').split('/').pop()?.split('.')[0] ?? ''
      const sub = String(wbi.sub_url ?? '').split('/').pop()?.split('.')[0] ?? ''
      if (!img || !sub) return ''
      mk = mixinKey(img, sub)
      mkAt = now()
      return mk
    } catch {
      return ''
    }
  }

  async function api(path, params = {}) {
    if (cooling('read')) return { ok: false, code: 'COOLDOWN', message: 'B 站风控冷却中（读）', data: null }
    await ensureBuvid()
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]))
    const url = `${API}${path}${qs.toString() ? `?${qs}` : ''}`
    try {
      const r = await throttle(() => raw(url))
      const j = JSON.parse(await r.text())
      if (j?.code === 0) { noteOk('read'); return { ok: true, code: 0, message: 'OK', data: j.data ?? null } }
      if (RISK_CODES.has(j?.code)) { const ms = noteRisk('read'); log(`B 站风控 ${j.code}，关 ${Math.round(ms / 1000)} 秒`) }
      return { ok: false, code: j?.code ?? 'UNKNOWN', message: String(j?.message ?? j?.code ?? '未知'), data: null }
    } catch (err) {
      return { ok: false, code: 'NETWORK', message: String(err?.message ?? err), data: null }
    }
  }

  /** 搜索（必须签名）。 */
  async function search(keyword, { page = 1, pageSize = 10 } = {}) {
    const kw = String(keyword ?? '').trim().slice(0, 40)
    if (!kw) return { ok: false, code: 'EMPTY', message: '关键词是空的', data: [] }
    const key = await ensureMk()
    if (!key) return { ok: false, code: 'NO_WBI', message: '拿不到 wbi 密钥，搜索用不了（稍后再试）', data: [] }
    if (cooling('read')) return { ok: false, code: 'COOLDOWN', message: 'B 站风控冷却中（读）', data: [] }
    await ensureBuvid()
    const q = signQuery({ search_type: 'video', keyword: kw, page, page_size: Math.min(20, pageSize) }, key)
    const url = `${API}/x/web-interface/search/type?${q}`
    try {
      const r = await throttle(() => raw(url, { referer: `https://search.bilibili.com/all?keyword=${encodeURIComponent(kw)}` }))
      const j = JSON.parse(await r.text())
      if (j?.code !== 0) {
        if (RISK_CODES.has(j?.code)) noteRisk('read')
        return { ok: false, code: j?.code ?? 'UNKNOWN', message: String(j?.message ?? '搜索失败'), data: [] }
      }
      noteOk('read')
      return { ok: true, code: 0, message: 'OK', data: (j.data?.result ?? []).map((v) => ({ ...toVideo(v), title: stripEm(v.title) })) }
    } catch (err) {
      return { ok: false, code: 'NETWORK', message: String(err?.message ?? err), data: [] }
    }
  }

  /** 导航：登录了就能拿到昵称/mid（校验 cookie 还活着的最便宜方式）。 */
  async function nav() {
    const r = await api('/x/web-interface/nav')
    if (!r.ok) return r
    const d = r.data ?? {}
    return { ok: true, code: 0, message: 'OK', data: { logged: d.isLogin === true, name: String(d.uname ?? ''), mid: String(d.mid ?? '') } }
  }

  function csrf() {
    const m = /(?:^|;\s*)bili_jct=([^;]+)/.exec(cookie)
    return m ? m[1] : ''
  }

  /** 写操作：必须登录 + 必须 csrf + 风控冷却期间不写。 */
  async function apiPost(path, form, { referer } = {}) {
    if (!cookie) return { ok: false, code: 'NOT_LOGIN', message: '没有登录凭据', data: null }
    const token = csrf()
    if (!token) return { ok: false, code: 'NO_CSRF', message: 'cookie 里没有 bili_jct，写不了', data: null }
    if (cooling('write')) return { ok: false, code: 'COOLDOWN', message: 'B 站风控冷却中（写）', data: null }
    const body = new URLSearchParams({ ...form, csrf: token, csrf_token: token }).toString()
    try {
      const url = /^https?:/i.test(path) ? path : `${API}${path}`
      const r = await throttle(() => raw(url, { referer, method: 'POST', body }))
      const j = JSON.parse(await r.text())
      if (j?.code === 0) { noteOk('write'); return { ok: true, code: 0, message: 'OK', data: j.data ?? null } }
      if (RISK_CODES.has(j?.code)) { const ms = noteRisk('write'); log(`写操作被风控 ${j.code}，关 ${Math.round(ms / 1000)} 秒`) }
      return { ok: false, code: j?.code ?? 'UNKNOWN', message: String(j?.message ?? j?.code ?? '未知'), data: null }
    } catch (err) {
      return { ok: false, code: 'NETWORK', message: String(err?.message ?? err), data: null }
    }
  }

  /** 在视频下发一条评论。 */
  async function replyAdd(aid, message) {
    const msg = String(message ?? '').trim()
    if (!aid) return { ok: false, code: 'NO_AID', message: '不知道是哪条视频（要 aid）', data: null }
    if (!msg) return { ok: false, code: 'EMPTY', message: '评论是空的', data: null }
    if (msg.length > 1000) return { ok: false, code: 'TOO_LONG', message: '太长了（B 站上限 1000 字）', data: null }
    return apiPost('/x/v2/reply/add', { oid: aid, type: 1, message: msg, plat: 1 }, { referer: `https://www.bilibili.com/video/av${aid}` })
  }

  /**
   * 回复别人的一条评论（楼中楼）。root 是这条楼的**主评论** rpid，parent 是要回的那条。
   * 两个传错不会报错，但回复会平铺在主楼下——看起来像"她对着空气说话"。
   */
  async function replyToComment(aid, { root, parent, message } = {}) {
    const msg = String(message ?? '').trim()
    if (!aid) return { ok: false, code: 'NO_AID', message: '不知道是哪条视频', data: null }
    if (!root || !parent) return { ok: false, code: 'NO_RPID', message: '缺评论 id（root/parent）', data: null }
    if (!msg) return { ok: false, code: 'EMPTY', message: '回复是空的', data: null }
    if (msg.length > 1000) return { ok: false, code: 'TOO_LONG', message: '太长了（上限 1000 字）', data: null }
    return apiPost('/x/v2/reply/add', { oid: aid, type: 1, message: msg, root, parent, plat: 1 }, { referer: `https://www.bilibili.com/video/av${aid}` })
  }

  /** 自己的 UID：cookie 里的 DedeUserID（扫码登录后就带着）。 */
  function selfUid() {
    const m = /(?:^|;\s*)DedeUserID=(\d+)/.exec(cookie)
    return m ? m[1] : ''
  }

  /**
   * 发私信（需要登录）。
   *
   * 照 dsh-bili-scroll 的教训：**接口回 code 0 ≠ 真的送到了**，
   * 要看有没有 `msg_key` 这个投递回执；没有就当失败，并且说清楚可能是"对方不收陌生人私信"。
   */
  async function sendDm({ receiverId, content } = {}) {
    const text = String(content ?? '').trim()
    if (!receiverId) return { ok: false, code: 'NO_RECEIVER', message: '不知道发给谁（缺 UID）', data: null }
    if (!text) return { ok: false, code: 'EMPTY', message: '私信是空的', data: null }
    if (text.length > 1000) return { ok: false, code: 'TOO_LONG', message: '太长了（上限 1000 字）', data: null }
    if (!cookie) return { ok: false, code: 'NOT_LOGIN', message: '没有登录凭据', data: null }
    const sender = selfUid()
    if (!sender) return { ok: false, code: 'NO_SENDER', message: '不知道发件人 UID（cookie 里没有 DedeUserID）', data: null }
    const r = await apiPost('https://api.vc.bilibili.com/web_im/v1/web_im/send_msg', {
      'msg[sender_uid]': sender,
      'msg[receiver_id]': String(receiverId),
      'msg[receiver_type]': 1,
      'msg[msg_type]': 1,
      'msg[content]': text,
    }, { referer: 'https://message.bilibili.com/' })
    if (!r.ok) return r
    const key = r.data?.msg_key
    if (!key) {
      return { ok: false, code: 'NO_RECEIPT', message: '接口回了成功，但没有投递回执（可能没送到：对方不收陌生人私信，或被风控）', data: r.data }
    }
    return { ok: true, code: 0, message: 'OK', data: { msg_key: key } }
  }

  async function popular(ps = 10) {
    const r = await api('/x/web-interface/popular', { ps: Math.min(50, Math.max(1, ps)), pn: 1 })
    return r.ok ? { ...r, data: (r.data?.list ?? []).map(toVideo) } : { ...r, data: [] }
  }

  async function view(bvid) {
    const r = await api('/x/web-interface/view', { bvid })
    if (!r.ok) return r
    const d = r.data ?? {}
    return {
      ok: true,
      code: 0,
      message: 'OK',
      data: {
        ...toVideo(d),
        desc: String(d.desc ?? ''),
        aid: Number(d.aid) || 0,
        cid: Number(d.pages?.[0]?.cid) || 0,
        pic: String(d.pic ?? ''),
      },
    }
  }

  /** 播放地址（DASH）。ffmpeg 直接从这条 http 流拉帧。 */
  async function playurl(bvid, cid, { qn = 64 } = {}) {
    if (!bvid || !cid) return { ok: false, code: 'BAD_ARG', message: '缺 bvid 或 cid', data: null }
    const r = await api('/x/player/playurl', { bvid, cid, qn, fnval: 16, fourk: 0 })
    if (!r.ok) return r
    const d = r.data ?? {}
    const v = d.dash?.video?.[0]
    const url = v?.baseUrl ?? v?.base_url ?? d.durl?.[0]?.url ?? ''
    return {
      ok: Boolean(url),
      code: r.code,
      message: url ? 'OK' : '没有可用的视频地址',
      data: { url, duration: d.timelength ? d.timelength / 1000 : 0 },
    }
  }

  async function tags(bvid) {
    const r = await api('/x/tag/archive/tags', { bvid })
    return r.ok ? { ...r, data: (r.data ?? []).map((t) => String(t?.tag_name ?? '')).filter(Boolean) } : { ...r, data: [] }
  }

  /**
   * 弹幕（不需要登录）。
   *
   * 为什么用弹幕而不是字幕：① 字幕要登录，且整段 2000–3000 字；
   * ② 弹幕是"人群此刻的反应"，采样 8 条只要一两百 token。
   * 返回按时间铺开采样，不取开头那几条（开头往往是"来了""前排"）。
   */
  async function danmaku(cid, { limit = 8 } = {}) {
    if (!cid) return { ok: false, code: 'NO_CID', message: '缺 cid', data: [] }
    if (cooling('read')) return { ok: false, code: 'COOLDOWN', message: 'B 站风控冷却中（读）', data: [] }
    await ensureBuvid()
    const url = `${API}/x/v1/dm/list.so?oid=${encodeURIComponent(cid)}`
    try {
      const r = await throttle(() => raw(url, { referer: 'https://www.bilibili.com/' }))
      const buf = Buffer.from(await r.arrayBuffer())
      let xml = ''
      try {
        xml = String(buf)
        if (!xml.includes('<d ')) {
          // 这个接口返回的是 deflate-raw 压缩的 XML
          xml = String(inflateRawSync(buf))
        }
      } catch {
        try { xml = String(inflateSync(buf)) } catch { try { xml = String(gunzipSync(buf)) } catch { /* 保持原样 */ } }
      }
      const items = parseDanmaku(xml)
      noteOk('read')
      return { ok: true, code: 0, message: 'OK', data: sampleDanmaku(items, limit) }
    } catch (err) {
      return { ok: false, code: 'NETWORK', message: String(err?.message ?? err), data: [] }
    }
  }

  async function replies(aid, { sort = 2, ps = 8 } = {}) {
    const r = await api('/x/v2/reply', { type: 1, oid: aid, sort, ps: Math.min(20, ps), pn: 1 })
    if (!r.ok) return { ...r, data: [] }
    return {
      ...r,
      data: (r.data?.replies ?? []).map((x) => ({ like: Number(x?.like) || 0, user: String(x?.member?.uname ?? ''), text: String(x?.content?.message ?? '') })),
    }
  }

  return { popular, view, tags, replies, search, nav, replyAdd, replyToComment, sendDm, playurl, danmaku, ensureBuvid, ensureMk, cooling, selfUid, _risk: risk }
}

/**
 * 解析弹幕 XML：`<d p="时间,模式,字号,颜色,时间戳,池,uid,rowid">内容</d>`
 * 只留时间与文本；时间单位是秒（带小数）。
 */
export function parseDanmaku(xml) {
  const out = []
  const re = /<d\s+p="([^"]*)"[^>]*>([\s\S]*?)<\/d>/g
  let m
  while ((m = re.exec(String(xml ?? '')))) {
    const p = String(m[1]).split(',')
    const t = Number(p[0])
    const text = String(m[2]).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim()
    if (!text || !Number.isFinite(t)) continue
    out.push({ t, text })
  }
  out.sort((a, b) => a.t - b.t)
  return out
}

/**
 * 均匀采样：从头到尾铺开取 n 条，跳过开头一堆"来了/前排"。
 * 短句优先（长弹幕常常是吵架或刷屏）。
 */
export function sampleDanmaku(list, n = 8) {
  const arr = (list ?? []).filter((x) => x.text.length >= 2 && x.text.length <= 40)
  if (!arr.length) return []
  if (arr.length <= n) return arr.map((x) => ({ at: Math.round(x.t), text: x.text }))
  const out = []
  const picked = new Set()
  for (let i = 0; i < n; i++) {
    const idx = Math.min(arr.length - 1, Math.round(((i + 0.5) / n) * arr.length))
    if (picked.has(idx)) continue
    picked.add(idx)
    out.push({ at: Math.round(arr[idx].t), text: arr[idx].text })
  }
  return out
}

function toVideo(v) {
  return {
    bvid: String(v?.bvid ?? ''),
    aid: Number(v?.aid) || 0,
    title: String(v?.title ?? ''),
    up: String(v?.owner?.name ?? ''),
    play: Number(v?.stat?.view) || 0,
    danmaku: Number(v?.stat?.danmaku) || 0,
    like: Number(v?.stat?.like) || 0,
    duration: Number(v?.duration) || 0,
    desc: String(v?.desc ?? '').slice(0, 300),
  }
}
