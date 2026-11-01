/**
 * bili/index.js —— B 站子系统的启动器
 *
 * 顺序：铺文件 → 一次性搬老 dsh-bili-scroll 的家 → 注册工具 → 起两条计时器
 *      （刷一轮 / 私信监听）。
 *
 * 它**不**起 headless 会话，也不改她的 config：人设永远是 dsh-fish-kin 的身份段。
 */

import { existsSync } from 'node:fs'
import { loginStart, loginPoll, saveCredential, renderQrPng } from './login.js'
import { biliPaths } from './config.js'
import { ensureFiles, ensureHomeFiles, loadState, countPickedToday, readReport, parseSeen, readJson, logLine } from './store.js'
import { loadBili, saveBili } from './settings.js'
import { maybeImportBili } from './import.js'
import { registerBiliTools } from './tools.js'
import { runRound, startBiliLoop, status as roundStatus, nextRunAt } from './round.js'
import { startDmWatch } from './dmwatch.js'
import { startInstall, startAsrInstall, venvState, asrState, installState, appendInstall, appendAsr, tail, clearProbeCache } from './install.js'
import { pythonFor, defaultVenvPython, stopClients, callMcp, resetClient } from './runtime.js'
import { join } from 'node:path'

export { biliPaths, loadBili, saveBili, venvState, asrState }

// 给设置页路由用：ctx.provide 万一不可用/晚到，还能拿到同一个实例
let currentApi = null
export function getBiliApi() { return currentApi }

export function bootBili(ctx, { root, log = () => {} } = {}) {
  const disposers = []
  let api = null
  // 登录/连接状态缓存：设置页打开时先给一个立刻能显示的答案，再按需强制刷新
  let connCache = { at: 0, value: null }
  const coverCache = new Map()
  const parseObj = (v) => (typeof v === 'string' ? (() => { try { return JSON.parse(v) } catch { return null } })() : (v && typeof v === 'object' ? v : null))
  const disposer = () => {
    const fns = disposers.splice(0)
    for (const f of fns) { try { f() } catch { /* ignore */ } }
    try { stopClients() } catch { /* ignore */ }
  }

  // 控制台 + 她家里的 duty.log 都留一份：出问题时用户能直接看日志
  const biliLog = (msg) => {
    try { log(String(msg)) } catch { /* ignore */ }
    try { logLine(root, msg) } catch { /* ignore */ }
  }

  /**
   * B 站连接状态（不是"文件在不在"——真的问一次 B站 凭证）。
   * state: no-credential | no-env | ok | expired | error
   */
  const connection = async (force = false) => {
    const p = biliPaths(root)
    const hasCred = existsSync(p.credential)
    const cached = connCache.value
    if (!force && cached && Date.now() - connCache.at < 60_000) return cached
    if (!hasCred) {
      const v = { state: 'no-credential', loggedIn: false, verified: false, nickname: '', mid: '', message: '还没登录', checkedAt: new Date().toISOString() }
      connCache = { at: Date.now(), value: v }
      return v
    }
    let v
    try {
      const c = await loadBili(root)
      const env = await venvState(root, c)
      if (!env.ready) {
        v = { state: 'no-env', loggedIn: true, verified: false, nickname: '', mid: '', message: '凭证在，但 B 站后端还没装好：' + (env.reason || '缺依赖'), checkedAt: new Date().toISOString() }
      } else {
        const r = await callMcp(root, c, 'bili_check_credential', {})
        const obj = parseObj(r) || {}
        if (obj.logged_in === true) {
          v = { state: 'ok', loggedIn: true, verified: true, nickname: String(obj.username || ''), mid: String(obj.uid || ''), message: '凭证有效', checkedAt: new Date().toISOString() }
        } else {
          v = { state: 'expired', loggedIn: true, verified: true, nickname: '', mid: '', message: String(obj.message || '登录已失效，请重新扫码'), checkedAt: new Date().toISOString() }
        }
      }
    } catch (e) {
      v = { state: 'error', loggedIn: true, verified: false, nickname: '', mid: '', message: '连接检测失败：' + String(e?.message ?? e), checkedAt: new Date().toISOString() }
    }
    connCache = { at: Date.now(), value: v }
    return v
  }
  const boot = async () => {
    try {
      ensureFiles(root)
      ensureHomeFiles(root, biliLog)
      const fishCfg = readJson(join(root, 'config.json'), {}) || {}
      if (!fishCfg.bili) await saveBili(root, {})
    } catch (e) { log(`B站的家没铺好：${String(e?.message ?? e).slice(0, 120)}`) }

    // 工具先挂：她能不能用 B 站，取决于工具在不在（搬家慢也不该拖着工具）
    try {
      const offs = registerBiliTools(ctx, { root, log: biliLog })
      for (const off of offs) disposers.push(off)
    } catch (e) { log(`B站工具没挂上：${String(e?.message ?? e).slice(0, 160)}`) }

    try {
      let legacy = ''
      try {
        const dshHome = ctx?.get?.('dshHomePath')
        if (typeof dshHome === 'function') {
          const got = dshHome('bili-duty')
          legacy = got ? String(got) : join(String(dshHome() || ''), 'bili-duty')
        }
        else if (typeof dshHome === 'string' && dshHome) legacy = join(dshHome, 'bili-duty')
      } catch { /* 拿不到就用默认 ~/.dsh */ }
      const imp = await maybeImportBili(root, biliLog, { legacyHome: legacy })
      if (imp.imported) biliLog(`B站：${imp.why}`)
    } catch (e) { log(`B站搬家失败（不影响使用）：${String(e?.message ?? e).slice(0, 120)}`) }

    // 两条计时器都只读配置；开关关着时它们什么都不做
    try {
      const off = startBiliLoop(ctx, { root, log: biliLog })
      if (typeof off === 'function') disposers.push(off)
    } catch (e) { log(`B站时间表没起来：${String(e?.message ?? e).slice(0, 120)}`) }

    try {
      const off = startDmWatch(ctx, { root, log: biliLog })
      if (typeof off === 'function') disposers.push(off)
    } catch (e) { log(`B站私信监听没起来：${String(e?.message ?? e).slice(0, 120)}`) }

    biliLog('B站子系统就绪（人设由她自己的身份段负责）')
  }

  void boot().catch((e) => log(`B站子系统启动失败：${String(e?.stack ?? e).slice(0, 300)}`))

  api = {
    async status() {
      const cfg = await loadBili(root)
      const base = await roundStatus(root, cfg)
      const p = biliPaths(root)
      const v = await venvState(root, cfg)
      const a = await asrState(root, cfg)
      const st = loadState(root)
      return {
        ...base,
        config: cfg,
        env: {
          ready: v.ready,
          python: v.python,
          missing: v.missing || [],
          reason: v.reason || '',
          asrReady: a.ready,
          asrPython: a.python,
          asrReason: a.reason || '',
          asrMissing: a.missing || [],
          asrModel: a.model || cfg.transcribe.model,
          asrModelReady: a.modelReady === true,
          asrCache: a.cache || '',
          ...installState(root),
        },
        loggedIn: existsSync(p.credential),
        connection: connCache.value,
        connectionAt: connCache.at ? new Date(connCache.at).toISOString() : null,
        credential: p.credential,
        home: p.home,
        paths: { report: p.report, seen: p.seen, log: p.log, installLog: p.installLog, asrLog: p.asrLog },
        installTail: tail(p.installLog),
        asrTail: tail(p.asrLog),
        state: st,
        seen: parseSeen(root).slice(0, 60),
        nextRunAt: nextRunAt(cfg)?.toISOString?.() ?? null,
      }
    },
    async saveConfig(patch) {
      const r = await saveBili(root, patch)
      try { resetClient(root) } catch { /* ignore */ }
      try { clearProbeCache() } catch { /* ignore */ }
      return r
    },
    async recheck() {
      try { clearProbeCache() } catch { /* ignore */ }
      return { ok: true, ...(await api.status()) }
    },
    async runNow() {
      const r = await runRound(ctx, { root, log: biliLog, why: 'manual' })
      return r
    },
    async setup() {
      const c = await loadBili(root)
      appendInstall(root, `\n[${new Date().toISOString()}] 设置页触发安装\n`)
      return startInstall(root, c)
    },
    async asrSetup() {
      const c = await loadBili(root)
      appendAsr(root, `\n[${new Date().toISOString()}] 设置页触发转写安装\n`)
      return startAsrInstall(root, c)
    },
    async connection(force = false) {
      return { ok: true, ...(await connection(force === true)) }
    },
    async loginStart() {
      const c = await loadBili(root)
      const { key, url } = await loginStart()
      // 二维码可能画不出来（qrcode 没装 / pythonPath 不指向有 qrcode 的环境）⇒ 逐个解释器试，别一失败就放弃
      const candidates = [...new Set([
        c.pythonPath,
        pythonFor(root, c),
        defaultVenvPython(root),
        process.platform === 'win32' ? 'python' : 'python3',
        'python',
      ].filter(Boolean))]
      let png = null
      let pngPython = ''
      for (const py of candidates) {
        png = await renderQrPng(py, biliPaths(root).home, url)
        if (png) { pngPython = py; break }
      }
      if (png) biliLog(`B站登录二维码已生成（${pngPython}）`)
      else biliLog('B站登录二维码没画出来：qrcode 没装好或没有可用的 Python')
      return {
        ok: true, key, url, png, hasQr: Boolean(png), python: pngPython,
        hint: png ? '二维码约 180 秒有效；手机上确认时选「记住我 / 长期」' : '二维码没画出来：先去「安装依赖」，或确认 pythonPath 里有 qrcode。',
      }
    },
    async loginPoll(key) {
      const r = await loginPoll(String(key ?? ''))
      if (r.state === 'ok') {
        const file = saveCredential(biliPaths(root).home, r.credential)
        biliLog('B站扫码登录成功，凭证已写入 ' + file)
        // 立刻验证一次：登录成功 ≠ 凭证一定能用（过期/风控）
        const conn = await connection(true)
        if (conn.state === 'ok') biliLog(`B站登录已确认：${conn.nickname || ''} UID ${conn.mid || '?'}`)
        else biliLog(`B站凭证已写入，但验证没通过：${conn.state} ${conn.message}`)
        return { ok: true, state: 'ok', file, connection: conn, warning: conn.state === 'ok' ? '' : conn.message }
      }
      return { ok: r.state !== 'unknown', state: r.state, code: r.code, message: r.message }
    },
    async test() {
      const c = await loadBili(root)
      const out = { ok: false, steps: [] }
      const v = await venvState(root, c)
      if (!v.ready) { out.error = `环境没装好（${v.reason || '缺依赖'}）—— 点「安装依赖」`; return out }
      if (!existsSync(biliPaths(root).credential)) { out.error = '还没登录——点「扫码登录」'; return out }
      try {
        const who = await callMcp(root, c, 'bili_check_credential', {})
        const obj = typeof who === 'string' ? (() => { try { return JSON.parse(who) } catch { return null } })() : who
        out.who = String(obj?.message || obj?.username || JSON.stringify(who)).slice(0, 160)
        if (obj && obj.logged_in === false) { out.error = '登录无效：' + String(obj.message || '请重新扫码'); return out }
        out.steps.push('登录有效')
      } catch (e) { out.error = '登录检查失败：' + String(e?.message ?? e); return out }
      try {
        const s = await callMcp(root, c, 'bili_search', { keyword: 'DeepSeek Harness', num: 3 })
        const t = typeof s === 'string' ? s : JSON.stringify(s)
        const obj = typeof s === 'string' ? (() => { try { return JSON.parse(s) } catch { return null } })() : s
        out.sample = t.slice(0, 180)
        if (obj && obj.ok === false) { out.error = '搜索失败：' + String(obj.error || obj.message || '接口拒绝'); return out }
        out.steps.push('能搜到东西')
        out.ok = Boolean(obj && Array.isArray(obj.videos)) ? obj.videos.length > 0 : t.length > 2
        if (!out.ok) out.error = '搜到了空结果'
      } catch (e) { out.error = '搜索失败：' + String(e?.message ?? e) }
      return out
    },
    async cover(bvid) {
      const bv = (/BV[0-9A-Za-z]{10}/.exec(String(bvid ?? '')) || [])[0]
      if (!bv) return { ok: false, error: 'bvid 不对' }
      const hit = coverCache.get(bv)
      if (hit && Date.now() - hit.at < 6 * 3600_000) return { ok: true, ...hit }
      try {
        const r = await fetch('https://api.bilibili.com/x/web-interface/view?bvid=' + bv, {
          signal: AbortSignal.timeout(8000),
          headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://www.bilibili.com/' },
        })
        const j = await r.json().catch(() => null)
        const pic = String(j?.data?.pic || '')
        if (!pic) return { ok: false, error: '取不到封面' }
        const img = await fetch(pic, {
          signal: AbortSignal.timeout(10_000),
          headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://www.bilibili.com/' },
        })
        if (!img.ok) return { ok: false, error: '封面图 HTTP ' + img.status }
        const buf = Buffer.from(await img.arrayBuffer())
        const value = { at: Date.now(), buf, type: img.headers.get('content-type') || 'image/jpeg' }
        coverCache.set(bv, value)
        while (coverCache.size > 120) coverCache.delete(coverCache.keys().next().value)
        return { ok: true, ...value }
      } catch (e) {
        return { ok: false, error: String(e?.message ?? e) }
      }
    },
    async report() {
      return readReport(root)
    },
    async seen() {
      return { ok: true, items: parseSeen(root), pickedToday: countPickedToday(root) }
    },
    async logTail(kind = 'duty', n = 3000) {
      const p = biliPaths(root)
      const f = kind === 'asr' ? p.asrLog : kind === 'install' ? p.installLog : p.log
      return { ok: true, file: f, text: tail(f, n) }
    },
    qr() {
      return biliPaths(root).qr
    },
  }

  currentApi = api
  try {
    if (typeof ctx?.provide === 'function') ctx.provide('fishBili', api)
  } catch { /* 没有 provide 就只走路由 */ }

  return {
    api,
    dispose: () => {
      if (currentApi === api) currentApi = null
      disposer()
    },
  }
}
