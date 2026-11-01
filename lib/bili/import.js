/**
 * bili/import.js —— 第一次启动时，把老 dsh-bili-scroll 的家搬过来
 *
 * 只搬一次：凭证、判重表、评论账本、UID 缓存、配置偏好，以及"现成的 venv / 转写环境"
 * 的路径（不复制 venv，只把 pythonPath 指过去）。旧目录**保留不删**。
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { biliPaths, legacyBiliHome, normalize } from './config.js'
import { ensureFiles, readJson } from './store.js'
import { loadBili, saveBili } from './settings.js'
import { probeModules } from './install.js'

const SENTINEL = '.imported-from-bili-scroll'

function copyIfMissing(from, to, log) {
  try {
    if (!existsSync(from) || existsSync(to)) return false
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
    log(`搬过来：${to}`)
    return true
  } catch { return false }
}

function copyDirIfEmpty(fromDir, toDir, log) {
  try {
    if (!existsSync(fromDir)) return 0
    mkdirSync(toDir, { recursive: true })
    let n = 0
    for (const name of readdirSync(fromDir)) {
      const from = join(fromDir, name)
      const to = join(toDir, name)
      if (existsSync(to)) continue
      try {
        if (statSync(from).isDirectory()) continue
        copyFileSync(from, to)
        n++
      } catch { /* skip */ }
    }
    if (n) log(`搬过来 ${n} 个归档文件：${toDir}`)
    return n
  } catch { return 0 }
}

function mapLegacyConfig(old = {}) {
  const dmMode = String(old.dmMode || 'only')
  const noon = old.noon !== false
  const night = old.night !== false
  const times = []
  if (noon) times.push('12:30')
  if (night) times.push('20:30')
  const autoComment = old.autoComment === true
  return {
    enabled: true,
    schedule: {
      enabled: old.peakValley === true && Number(old.perDay) > 0,
      times: old.peakValley === true ? times : [],
      window: ['12:00', '14:00'],
      // 老 perDay 是「每天最多挑几条」，不是轮数 ⇒ 轮数按开着的窗口算
      perDay: old.peakValley === true ? Math.max(1, times.length) : 1,
      offPeakOnly: false,
      cooldownMin: Math.max(0, Math.min(180, Number(old.manualCooldownMin) || 20)),
      catchUpMin: 180,
    },
    preferences: {
      taste: '',
      keywords: Array.isArray(old.keywords) ? old.keywords : [],
      excludeWords: Array.isArray(old.excludeWords) ? old.excludeWords : [],
      sort: String(old.searchSort || 'pubdate'),
      pages: Math.max(1, Math.min(5, Number(old.searchPages) || 2)),
      fetchPerRound: Math.max(1, Math.min(20, Number(old.fetchPerRound) || 8)),
      maxPicks: Math.max(1, Math.min(10, Number(old.perDay) || 5)),
    },
    report: String(old.reportLevel || 'full'),
    share: {
      enabled: dmMode !== 'off',
      mode: dmMode === 'off' ? 'off' : 'dm',
      uid: Math.max(0, Number(old.dmUid) || 0),
      watch: old.dmWatch === true,
      watchMinutes: Math.max(1, Math.min(60, Number(old.dmWatchMinutes) || 3)),
      replyPerDay: Math.max(0, Math.min(100, Number(old.dmReplyPerDay) || 20)),
      maxChars: 480,
    },
    comment: {
      enabled: autoComment,
      mention: String(old.mentionName || ''),
      perRound: Math.max(0, Math.min(20, Number(old.commentPerRound) || 1)),
      length: String(old.commentLength || 'medium'),
      replyToComments: old.replyToComments === true,
      replyPerRound: Math.max(0, Math.min(5, Number(old.replyPerRound) || 1)),
    },
    transcribe: {
      enabled: old.transcribe === true,
      model: String(old.asrModel || 'small'),
    },
    dedupeDays: 30,
    favFolderId: Math.max(0, Number(old.favFolderId) || 0),
    pythonPath: String(old.pythonPath || ''),
    asrPython: '',
    asrCache: '',
  }
}

function hasRows(file) {
  try {
    const text = readFileSync(file, 'utf8')
    return /\n\|\s*\d{4}-\d{2}-\d{2}/.test(text) || text.length > 1200
  } catch { return false }
}

/**
 * 一次性搬运。返回 {ok, imported, why}。
 * 新家已有凭证/判重表时不覆盖；只补缺的东西。
 */
export async function maybeImportBili(root, log = () => {}, { legacyHome = '' } = {}) {
  const p = ensureFiles(root)
  const marker = join(p.home, SENTINEL)
  if (existsSync(marker)) return { ok: true, imported: false, why: '搬过了' }
  const old = String(legacyHome || '').trim() || legacyBiliHome()
  if (!existsSync(old) || old === p.home) {
    try { writeFileSync(marker, JSON.stringify({ at: new Date().toISOString(), source: old, found: false }) + '\n', 'utf8') } catch { /* ignore */ }
    return { ok: true, imported: false, why: '没有老的家' }
  }
  let imported = 0
  for (const name of ['bili_credential.json', 'uid-cache.json', 'dm-seen.json', 'dm-quota.json']) {
    if (copyIfMissing(join(old, name), join(p.home, name), log)) imported++
  }
  // comments.md 由 ensureFiles 预建了表头 ⇒ 只有"还没写进东西"时才搬老账本
  try {
    const oldComments = join(old, 'comments.md')
    const cur = existsSync(p.comments) ? readFileSync(p.comments, 'utf8') : ''
    if (existsSync(oldComments) && cur.trim().length < 200) {
      copyFileSync(oldComments, p.comments); imported++; log(`搬过来：${p.comments}`)
    }
  } catch { /* ignore */ }
  if (!hasRows(p.seen) && existsSync(join(old, 'seen.md'))) {
    try { copyFileSync(join(old, 'seen.md'), p.seen); imported++; log(`搬过来：${p.seen}`) } catch { /* ignore */ }
  }
  copyDirIfEmpty(join(old, 'seen'), p.seenDir, log)
  copyDirIfEmpty(join(old, 'digest'), p.digest, log)

  // 配置：只有新家还是默认值时才映射，避免覆盖用户后来改过的
  const cur = await loadBili(root)
  const looksDefault = JSON.stringify(cur) === JSON.stringify(normalize({}))
  if (looksDefault) {
    let mapped = mapLegacyConfig(readJson(join(old, 'config.json'), {}) || {})
    // 现成的 venv：只指路径，不复制
    const oldPy = join(old, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python')
    if (existsSync(oldPy)) {
      const ok = (await probeModules(oldPy)).ok
      if (ok) { mapped.pythonPath = oldPy; log(`沿用老环境的解释器：${oldPy}`) }
    }
    const oldAsr = join(old, '.venv-asr', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python')
    if (existsSync(oldAsr) && (await probeModules(oldAsr, ['faster_whisper', 'yt_dlp'])).ok) mapped.asrPython = oldAsr
    const oldCache = join(old, '.hf-cache')
    if (existsSync(oldCache)) mapped.asrCache = oldCache
    const r = await saveBili(root, mapped)
    if (r.ok) { imported++; log('把老 dsh-bili-scroll 的偏好搬过来了（人设不再搬：人设由大肥鱼自己负责）') }
  }
  try { writeFileSync(marker, JSON.stringify({ at: new Date().toISOString(), source: old, imported }) + '\n', 'utf8') } catch { /* ignore */ }
  return { ok: true, imported: imported > 0, why: imported ? `从 ${old} 搬了 ${imported} 项` : '没有可搬的' }
}

export { mapLegacyConfig }
