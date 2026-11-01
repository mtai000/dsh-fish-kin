/**
 * bili/config.js —— 刷 B 站的设置（存在她自己的 config.json 里，`bili` 这一组）
 *
 * 这里只做三件事：默认值、白名单式归一化、时间窗/时间点计算。
 * 所有值都会被钳到安全范围；坏值永远退回默认，不让一个手滑把调度写死。
 */

import { join } from 'node:path'
import { homedir } from 'node:os'

export const SORTS = Object.freeze(['totalrank', 'click', 'pubdate', 'dm'])
export const REPORT_LEVELS = Object.freeze(['full', 'brief', 'off'])
export const SHARE_MODES = Object.freeze(['dm', 'note', 'off'])
export const COMMENT_LENGTHS = Object.freeze(['short', 'medium', 'long'])
export const ASR_MODELS = Object.freeze(['tiny', 'base', 'small', 'medium'])

export const DEFAULTS = Object.freeze({
  enabled: true,
  schedule: {
    enabled: false,
    times: [],
    window: ['12:00', '14:00'],
    perDay: 1,
    offPeakOnly: false,
    cooldownMin: 20,
    catchUpMin: 180,
  },
  preferences: {
    taste: '',
    keywords: [],
    excludeWords: [],
    sort: 'pubdate',
    pages: 2,
    fetchPerRound: 8,
    maxPicks: 5,
  },
  report: 'full',
  share: {
    enabled: true,
    mode: 'dm',
    uid: 0,
    watch: false,
    watchMinutes: 3,
    replyPerDay: 20,
    maxChars: 480,
  },
  comment: {
    enabled: false,
    mention: '',
    perRound: 1,
    length: 'medium',
    replyToComments: false,
    replyPerRound: 1,
  },
  transcribe: {
    enabled: false,
    model: 'small',
  },
  dedupeDays: 30,
  favFolderId: 0,
  pythonPath: '',
  asrPython: '',
  asrCache: '',
})

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const bool = (v, dflt) => (typeof v === 'boolean' ? v : dflt)
const int = (v, lo, hi, dflt) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt
}
const str = (v, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : '')
const oneOf = (v, list, dflt) => (list.includes(String(v)) ? String(v) : dflt)
const list = (v, maxItems = 40, maxLen = 60) => {
  if (!Array.isArray(v)) return []
  const out = []
  for (const x of v) {
    const s = String(x ?? '').trim()
    if (s) out.push(s.slice(0, maxLen))
    if (out.length >= maxItems) break
  }
  return [...new Set(out)]
}

export function minutesOf(hhmm, dflt = 0) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim())
  if (!m) return dflt
  return Math.min(1439, Math.max(0, Number(m[1]) * 60 + Number(m[2])))
}

const validTime = (v) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? '').trim())
  if (!m) return false
  return Number(m[1]) <= 23 && Number(m[2]) <= 59
}

const normTime = (v) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? '').trim())
  return m ? `${String(Number(m[1])).padStart(2, '0')}:${m[2]}` : ''
}

/** 归一化一份 bili 配置。坏值一律退回默认。 */
export function normalize(input = {}) {
  const src = isObj(input) ? input : {}
  const sch = isObj(src.schedule) ? src.schedule : {}
  const pref = isObj(src.preferences) ? src.preferences : {}
  const share = isObj(src.share) ? src.share : {}
  const comment = isObj(src.comment) ? src.comment : {}
  const transcribe = isObj(src.transcribe) ? src.transcribe : {}

  const times = list(sch.times, 8, 5).filter(validTime).map(normTime).filter(Boolean)
    .sort((a, b) => minutesOf(a) - minutesOf(b))
  const win = Array.isArray(sch.window) && sch.window.length === 2 && validTime(sch.window[0]) && validTime(sch.window[1])
    ? [normTime(sch.window[0]), normTime(sch.window[1])]
    : [...DEFAULTS.schedule.window]

  return {
    enabled: bool(src.enabled, DEFAULTS.enabled),
    schedule: {
      enabled: bool(sch.enabled, DEFAULTS.schedule.enabled),
      times: [...new Set(times)],
      window: win,
      perDay: int(sch.perDay, 0, 8, DEFAULTS.schedule.perDay),
      offPeakOnly: bool(sch.offPeakOnly, DEFAULTS.schedule.offPeakOnly),
      cooldownMin: int(sch.cooldownMin, 0, 180, DEFAULTS.schedule.cooldownMin),
      catchUpMin: int(sch.catchUpMin, 10, 720, DEFAULTS.schedule.catchUpMin),
    },
    preferences: {
      taste: str(pref.taste, 4000),
      keywords: list(pref.keywords, 30, 40),
      excludeWords: list(pref.excludeWords, 60, 40),
      sort: oneOf(pref.sort, SORTS, DEFAULTS.preferences.sort),
      pages: int(pref.pages, 1, 5, DEFAULTS.preferences.pages),
      fetchPerRound: int(pref.fetchPerRound, 1, 20, DEFAULTS.preferences.fetchPerRound),
      maxPicks: int(pref.maxPicks, 1, 10, DEFAULTS.preferences.maxPicks),
    },
    report: oneOf(src.report, REPORT_LEVELS, DEFAULTS.report),
    share: {
      enabled: bool(share.enabled, DEFAULTS.share.enabled),
      mode: oneOf(share.mode, SHARE_MODES, DEFAULTS.share.mode),
      uid: int(share.uid, 0, 99999999999, DEFAULTS.share.uid),
      watch: bool(share.watch, DEFAULTS.share.watch),
      watchMinutes: int(share.watchMinutes, 1, 60, DEFAULTS.share.watchMinutes),
      replyPerDay: int(share.replyPerDay, 0, 100, DEFAULTS.share.replyPerDay),
      maxChars: int(share.maxChars, 200, 490, DEFAULTS.share.maxChars),
    },
    comment: {
      enabled: bool(comment.enabled, DEFAULTS.comment.enabled),
      mention: str(comment.mention, 40),
      perRound: int(comment.perRound, 0, 20, DEFAULTS.comment.perRound),
      length: oneOf(comment.length, COMMENT_LENGTHS, DEFAULTS.comment.length),
      replyToComments: bool(comment.replyToComments, DEFAULTS.comment.replyToComments),
      replyPerRound: int(comment.replyPerRound, 0, 5, DEFAULTS.comment.replyPerRound),
    },
    transcribe: {
      enabled: bool(transcribe.enabled, DEFAULTS.transcribe.enabled),
      model: oneOf(transcribe.model, ASR_MODELS, DEFAULTS.transcribe.model),
    },
    dedupeDays: int(src.dedupeDays, 1, 365, DEFAULTS.dedupeDays),
    favFolderId: int(src.favFolderId, 0, 99999999999, DEFAULTS.favFolderId),
    pythonPath: str(src.pythonPath, 500),
    asrPython: str(src.asrPython, 500),
    asrCache: str(src.asrCache, 500),
  }
}

/** 只合并白名单里的组/字段，然后归一化。 */
export function merge(current, patch) {
  const cur = normalize(current)
  const p = isObj(patch) ? patch : {}
  const out = { ...cur }
  for (const k of ['enabled', 'report', 'dedupeDays', 'favFolderId', 'pythonPath', 'asrPython', 'asrCache']) {
    if (p[k] !== undefined) out[k] = p[k]
  }
  for (const group of ['schedule', 'preferences', 'share', 'comment', 'transcribe']) {
    if (!isObj(p[group])) continue
    out[group] = { ...cur[group], ...p[group] }
  }
  return normalize(out)
}

/** 时间戳 → 本机日期键（跟她"今天"的感知一致）。 */
export function dayKey(now = Date.now()) {
  const d = new Date(now)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 今天要跑的分钟点。显式 times 优先；否则用 window + perDay 摊平。 */
export function slotsFor(config, now = new Date()) {
  const c = normalize(config)
  const times = c.schedule.times
  if (times.length) {
    return times.map((t) => {
      const at = new Date(now)
      at.setHours(Math.floor(minutesOf(t) / 60), minutesOf(t) % 60, 0, 0)
      return { at, key: t }
    })
  }
  const perDay = c.schedule.perDay
  if (perDay <= 0) return []
  const [a, b] = c.schedule.window
  const start = minutesOf(a, 9 * 60)
  const end = minutesOf(b, 23 * 60)
  const span = Math.max(30, end - start)
  const base = new Date(now)
  base.setHours(0, 0, 0, 0)
  const out = []
  for (let i = 0; i < perDay; i++) {
    const mins = start + Math.round((span * (i + 0.5)) / perDay)
    const at = new Date(base.getTime() + mins * 60_000)
    out.push({ at, key: `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}` })
  }
  return out
}

/** 今天最多跑几轮（显式 times 时按 times 的条数）。 */
export function maxRunsToday(config) {
  const c = normalize(config)
  return c.schedule.times.length || c.schedule.perDay
}

/** 现在是不是 DeepSeek 高峰（工作日 9–12、14–18 北京时间；其余含周末都是谷时）。 */
export function inPeak(now = new Date()) {
  const d = new Date(now)
  const day = d.getDay()
  if (day === 0 || day === 6) return false
  const mins = d.getHours() * 60 + d.getMinutes()
  return (mins >= 9 * 60 && mins < 12 * 60) || (mins >= 14 * 60 && mins < 18 * 60)
}

export function inWindow(now, win) {
  const mins = new Date(now).getHours() * 60 + new Date(now).getMinutes()
  const a = minutesOf(win?.[0], 0)
  const b = minutesOf(win?.[1], 1439)
  return a <= b ? mins >= a && mins < b : mins >= a || mins < b
}

/**
 * 现在该不该自动跑一轮。
 * @returns {{due:boolean, slot?:Date, key?:string, missed?:string, reason?:string}}
 */
export function dueSlot(config, state = {}, now = new Date()) {
  const c = normalize(config)
  if (!c.enabled || !c.schedule.enabled) return { due: false, reason: '关着' }
  if (c.schedule.offPeakOnly && inPeak(now)) return { due: false, reason: '现在是高峰，等谷时' }
  const today = dayKey(now)
  if (state.day !== today) return { due: false, reason: '今天的账还没开' }
  const runs = state.runs && typeof state.runs === 'object' ? state.runs : {}
  const done = new Set(Object.keys(runs))
  const max = maxRunsToday(c)
  if (Object.values(runs).filter((v) => v === 'run').length >= max) return { due: false, reason: '今天的额度用完了' }
  for (const s of slotsFor(c, now)) {
    if (done.has(s.key)) continue
    if (now < s.at) continue
    const lateMin = (now.getTime() - s.at.getTime()) / 60_000
    if (lateMin > c.schedule.catchUpMin) return { due: false, missed: s.key, reason: `错过了 ${s.key}（超过 ${c.schedule.catchUpMin} 分钟）` }
    return { due: true, slot: s.at, key: s.key }
  }
  return { due: false, reason: '还没到下一个时间点' }
}

/** B 站运行数据放哪：`<她的家>/bili/`。 */
export function biliHome(root) {
  return join(String(root), 'bili')
}

/** 老 dsh-bili-scroll 的家（一次性搬运用）。 */
export function legacyBiliHome(env = process.env) {
  const dshHome = String(env.DSH_HOME ?? '').trim() || join(homedir(), '.dsh')
  return join(dshHome, 'bili-duty')
}

export function biliPaths(root) {
  const home = biliHome(root)
  return {
    home,
    config: join(home, 'config.json'),
    credential: join(home, 'bili_credential.json'),
    mcpServer: join(home, 'mcp_server.py'),
    asr: join(home, 'asr.py'),
    favops: join(home, 'favops.py'),
    out: join(home, 'out'),
    report: join(home, 'out', `${dayKey()}.md`),
    seen: join(home, 'seen.md'),
    seenDir: join(home, 'seen'),
    digest: join(home, 'digest'),
    state: join(home, 'state.json'),
    log: join(home, 'duty.log'),
    installLog: join(home, 'install.log'),
    asrLog: join(home, 'asr-install.log'),
    venv: join(home, '.venv'),
    asrVenv: join(home, '.venv-asr'),
    tmp: join(home, 'tmp'),
    asrTmp: join(home, 'tmp', 'asr'),
    hfCache: join(home, '.hf-cache'),
    runLock: join(home, 'run-lock.json'),
    dmSeen: join(home, 'dm-seen.json'),
    dmQuota: join(home, 'dm-quota.json'),
    dmLock: join(home, 'dm-lock.json'),
    uidCache: join(home, 'uid-cache.json'),
    comments: join(home, 'comments.md'),
    qr: join(home, 'qrcode_login.png'),
    bin: join(home, 'bin'),
  }
}
