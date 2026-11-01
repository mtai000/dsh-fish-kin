/**
 * bili/store.js —— 刷 B 站那点"家底"：目录、判重表、日报、归档、账本、日志
 *
 * 原则跟 dsh-bili-scroll 一致：**运行数据只写她自己的家**（`<她的家>/bili/`），
 * 不写进插件包；路径全部由宿主定死，模型拿不到任何路径参数。
 */

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { biliPaths, dayKey, normalize } from './config.js'
import { scrub } from '../fish/guard.js'

const HERE = dirname(fileURLToPath(import.meta.url))

export function readJson(file, fallback = null) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback }
}

export function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
}

export function logLine(root, msg) {
  try {
    const p = biliPaths(root)
    mkdirSync(p.home, { recursive: true })
    appendFileSync(p.log, `${new Date().toISOString()}  ${String(msg ?? '')}\n`, 'utf8')
    rotateLog(p.log)
  } catch { /* 日志写不进去不能影响任何功能 */ }
}

function rotateLog(file, limit = 2 * 1024 * 1024) {
  try {
    if (!existsSync(file) || statSync(file).size < limit) return
    const bak = file + '.1'
    try { rmSync(bak, { force: true }) } catch { /* ignore */ }
    renameSync(file, bak)
  } catch { /* ignore */ }
}

/** 铺运行时文件：mcp_server.py / asr.py / favops.py。内容变了就覆盖（旧份备份）。 */
export function ensureHomeFiles(root, log = () => {}) {
  const p = biliPaths(root)
  mkdirSync(p.home, { recursive: true })
  const copies = [
    [join(HERE, 'vendor', 'mcp_server.py'), p.mcpServer],
    [join(HERE, 'asr.py'), p.asr],
    [join(HERE, 'favops.py'), p.favops],
  ]
  for (const [from, to] of copies) {
    try {
      if (!existsSync(from)) { log(`缺文件：${from}`); continue }
      if (existsSync(to)) {
        const a = readFileSync(from)
        const b = readFileSync(to)
        if (a.equals(b)) continue
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        try { copyFileSync(to, `${to}.bak-${stamp}`) } catch { /* 备份不了也继续 */ }
      }
      copyFileSync(from, to)
    } catch (e) { log(`铺 ${to} 失败：${e?.message ?? e}`) }
  }
}

const SEEN_HEAD = [
  '# 刷B站 · 判重表（宿主预建，只往后面追加）',
  '',
  '## 评论记录（BV | rpid | root（楼中楼才填） | 时间 | 正文前 20 字）',
  '',
  '| BV | rpid | root（楼中楼才填） | 时间 | 正文前 20 字 |',
  '| --- | --- | --- | --- | --- |',
  '',
  '## 看过的视频',
  '',
  '| 日期 | BV | 标题 | UP | 状态 |',
  '| --- | --- | --- | --- | --- |',
  '',
].join('\n')

export function ensureFiles(root) {
  const p = biliPaths(root)
  for (const d of [p.home, p.out, p.seenDir, p.digest, p.tmp, p.asrTmp, p.bin]) {
    try { mkdirSync(d, { recursive: true }) } catch { /* ignore */ }
  }
  try { if (!existsSync(p.seen)) writeFileSync(p.seen, SEEN_HEAD, 'utf8') } catch { /* ignore */ }
  try { if (!existsSync(p.state)) writeJson(p.state, { day: dayKey(), runs: {}, runCount: 0, picked: 0, manualExtra: 0 }) } catch { /* ignore */ }
  try { if (!existsSync(p.comments)) writeFileSync(p.comments, '# 她在 B 站发过的评论（只追加）\n\n', 'utf8') } catch { /* ignore */ }
  return p
}

const cell = (s, limit = 80) => scrub(String(s ?? '').replace(/\s+/g, ' ')).replace(/\|/g, '\\|').slice(0, limit)
const normBv = (v) => {
  const m = /BV[0-9A-Za-z]{10}/.exec(String(v ?? ''))
  return m ? m[0] : ''
}

/** 往今天的日报追加一段。 */
export function appendReport(root, text) {
  const body = scrub(String(text ?? '').replace(/\r\n/g, '\n')).trim()
  if (!body) return { ok: false, why: '空内容' }
  const file = biliPaths(root).report
  const fresh = !existsSync(file)
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, (fresh ? `# 刷B站日报 ${dayKey()}\n\n` : '') + body + '\n', 'utf8')
  return { ok: true, file }
}

export function readReport(root, day = dayKey()) {
  const file = join(biliPaths(root).out, `${day}.md`)
  try { return { ok: true, file, text: readFileSync(file, 'utf8') } } catch { return { ok: false, file, text: '' } }
}

/** 从今天的报告里数"挑中的"（行首 ### BV 号）。 */
export function countPickedToday(root, day = dayKey()) {
  const file = join(biliPaths(root).out, `${day}.md`)
  let text = ''
  try { text = readFileSync(file, 'utf8') } catch { return 0 }
  const noFence = text.replace(/```[\s\S]*?```/g, '')
  return new Set([...noFence.matchAll(/^#{2,3}[ \t]*(BV[0-9A-Za-z]{10})/gm)].map((m) => m[1])).size
}

/** 往判重表追加一行。 */
export function appendSeen(root, { bvid, title = '', up = '', status = '跳过', date = '', now = Date.now() } = {}) {
  const bv = normBv(bvid)
  if (!bv) return { ok: false, why: 'bvid 是空的' }
  const p = ensureFiles(root)
  const d = /^\d{4}-\d{2}-\d{2}/.test(String(date)) ? String(date).slice(0, 10) : dayKey(now)
  const row = `| ${cell(d, 10)} | ${cell(bv, 16)} | ${cell(title)} | ${cell(up, 40)} | ${cell(status, 30)} |\n`
  appendFileSync(p.seen, row, 'utf8')
  return { ok: true, file: p.seen }
}

/** 按未转义的 `|` 切表格行（标题里的 `\|` 不算分隔符）。 */
function splitRow(line) {
  const s = String(line).replace(/\\\|/g, '\u0000')
  return s.split('|').map((x) => x.trim()).slice(1, -1).map((x) => x.replace(/\u0000/g, '|'))
}

/** 最近看过的行（给工具/界面用）。 */
export function seenRecent(root, { limit = 40, bvid = '' } = {}) {
  const p = ensureFiles(root)
  let text = ''
  try { text = readFileSync(p.seen, 'utf8') } catch { return [] }
  const rows = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('|')) continue
    const cells = splitRow(line)
    if (cells.length < 5) continue
    const bv = normBv(cells[1])
    if (!bv) continue
    if (bvid && bv !== normBv(bvid)) continue
    rows.push({ day: cells[0], bvid: bv, title: cells[2], up: cells[3], status: cells[4], line })
  }
  return rows.slice(-Math.max(1, Math.min(Number(limit) || 40, 5000)))
}

/** 最近 N 天里是不是已经看过这个 BV。 */
export function alreadySeen(root, bvid, days = 30, now = Date.now()) {
  const bv = normBv(bvid)
  if (!bv) return false
  const cutoff = new Date(now - Math.max(1, Number(days) || 30) * 86400_000)
  const cutKey = dayKey(cutoff)
  for (const r of seenRecent(root, { limit: 5000, bvid: bv })) {
    const d = String(r.day || '').slice(0, 10)
    if (!d) continue
    if (d >= cutKey) return true
  }
  return false
}

/** 给界面用的结构化列表（最近 200 行）。 */
export function parseSeen(root) {
  return seenRecent(root, { limit: 200 }).map((r) => {
    const skipped = /跳过|跳了|没挑/.test(r.status)
    const picked = !skipped && /挑|收|选|值得看|可以看/.test(r.status)
    return { ...r, picked, skipped, url: `https://www.bilibili.com/video/${r.bvid}` }
  }).sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
}

/** 往本月归档追加一段。 */
export function appendDigest(root, text) {
  const body = scrub(String(text ?? '').replace(/\r\n/g, '\n')).trim()
  if (!body) return { ok: false, why: '空内容' }
  const p = ensureFiles(root)
  const f = join(p.digest, `${dayKey().slice(0, 7)}.md`)
  const fresh = !existsSync(f)
  appendFileSync(f, (fresh ? `# 刷B站归档 ${dayKey().slice(0, 7)}\n\n` : '') + body + '\n', 'utf8')
  return { ok: true, file: f }
}

/** 账本：今天跑了几轮、挑了几条、手动额外额度。 */
export function loadState(root, now = Date.now()) {
  const p = ensureFiles(root)
  const raw = readJson(p.state, {}) || {}
  const today = dayKey(now)
  if (raw.day !== today) {
    return { day: today, runs: {}, runCount: 0, picked: 0, manualExtra: 0, lastRunAt: null, lastWhy: null, lastManualAt: raw.lastManualAt ?? null }
  }
  return {
    day: today,
    runs: raw.runs && typeof raw.runs === 'object' ? raw.runs : {},
    runCount: Number(raw.runCount) || 0,
    picked: Number(raw.picked) || 0,
    manualExtra: Number(raw.manualExtra) || 0,
    lastRunAt: raw.lastRunAt ? (typeof raw.lastRunAt === 'number' ? new Date(raw.lastRunAt).toISOString() : raw.lastRunAt) : null,
    lastWhy: raw.lastWhy ?? null,
    lastManualAt: raw.lastManualAt ? (typeof raw.lastManualAt === 'number' ? new Date(raw.lastManualAt).toISOString() : raw.lastManualAt) : null,
    lastError: raw.lastError ?? '',
    activeWhy: raw.activeWhy ?? '',
    activeAt: Number(raw.activeAt) || 0,
    lastDmAt: raw.lastDmAt ? (typeof raw.lastDmAt === 'number' ? new Date(raw.lastDmAt).toISOString() : raw.lastDmAt) : null,
  }
}

export function saveState(root, state) {
  writeJson(biliPaths(root).state, state)
  return state
}

export function markRun(root, { key = '', why = 'auto', now = Date.now(), error = '' } = {}) {
  const st = loadState(root, now)
  if (key) st.runs = { ...st.runs, [key]: 'run' }
  st.runCount = (st.runCount || 0) + 1
  st.lastRunAt = new Date(now).toISOString()
  st.lastWhy = why
  st.activeWhy = why
  st.activeAt = now
  if (why === 'manual') st.lastManualAt = new Date(now).toISOString()
  if (error) st.lastError = String(error).slice(0, 300)
  saveState(root, st)
  return st
}

export function markMissed(root, key, now = Date.now()) {
  if (!key) return
  const st = loadState(root, now)
  st.runs = { ...st.runs, [key]: 'missed' }
  saveState(root, st)
}

/** 手动轮挑中的条数记进 manualExtra —— 手动是"额外的一次"，不占自动额度。 */
export function noteManualExtra(root, n = 1, now = Date.now()) {
  const add = Math.max(0, Math.floor(Number(n) || 0))
  if (!add) return 0
  const st = loadState(root, now)
  if (st.activeWhy !== 'manual') return 0
  if (st.activeAt && now - st.activeAt > 2 * 3600_000) return 0
  st.manualExtra = Math.max(0, Number(st.manualExtra) || 0) + add
  saveState(root, st)
  return st.manualExtra
}

/** 记一条私信发出的时间（防同一轮/手滑连发）。 */
export function markDmSent(root, now = Date.now()) {
  const st = loadState(root, now)
  st.lastDmAt = new Date(now).toISOString()
  saveState(root, st)
  return st.lastDmAt
}

/** 自动额度还剩几条（手动轮挑的不扣）。 */
export function autoPickedToday(root, now = Date.now()) {
  const st = loadState(root, now)
  const picked = countPickedToday(root, dayKey(now))
  return Math.max(0, picked - Math.max(0, Number(st.manualExtra) || 0))
}

/** 从报告里同步"今天挑了几条"（报告是事实来源）。 */
export function syncPicked(root, now = Date.now()) {
  const st = loadState(root, now)
  const picked = countPickedToday(root, dayKey(now))
  if (picked !== st.picked) {
    st.picked = picked
    saveState(root, st)
  }
  return picked
}

/** 已经私信/评论过的 BV（评论记录表里出现过 rpid 的）。 */
export function deliveredBvs(root) {
  const p = ensureFiles(root)
  const set = new Set()
  let text = ''
  try { text = readFileSync(p.seen, 'utf8') } catch { return set }
  for (const raw of text.split(/\r?\n/)) {
    const hit = /\|\s*(BV[0-9A-Za-z]{10})\s*\|\s*(\d{6,})\s*\|/.exec(raw)
    if (hit) set.add(hit[1])
  }
  return set
}

export { normalize }
