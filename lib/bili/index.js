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
import { startInstall, startAsrInstall, venvState, asrState, installState, appendInstall, appendAsr, tail } from './install.js'
import { pythonFor, stopClients, callMcp, resetClient } from './runtime.js'
import { join } from 'node:path'

export { biliPaths, loadBili, saveBili, venvState, asrState }

// 给设置页路由用：ctx.provide 万一不可用/晚到，还能拿到同一个实例
let currentApi = null
export function getBiliApi() { return currentApi }

export function bootBili(ctx, { root, log = () => {} } = {}) {
  const disposers = []
  let api = null
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
          ...installState(root),
        },
        loggedIn: existsSync(p.credential),
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
      return r
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
    async loginStart() {
      const c = await loadBili(root)
      const { key, url } = await loginStart()
      const png = await renderQrPng(c.pythonPath || pythonFor(root, c), biliPaths(root).home, url)
      return { ok: true, key, url, png, hasQr: Boolean(png) }
    },
    async loginPoll(key) {
      const r = await loginPoll(String(key ?? ''))
      if (r.state === 'ok') {
        const file = saveCredential(biliPaths(root).home, r.credential)
        biliLog('B站扫码登录成功，凭证已写入 ' + file)
        return { ok: true, state: 'ok', file }
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
