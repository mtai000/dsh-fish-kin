/**
 * fish/wake.js —— 叫她醒来
 *
 * 只给**处境**，不给任务清单。写"今天写日记、想一想"这种祈使句，她会当成清单逐条执行，
 * 那不是醒来（dsh-fish 踩过这个坑，这里直接不写）。
 *
 * 生物钟也简化了：一天 N 次、在一个时间窗里摊开；记在 `<root>/home.json` 的 wakes 里。
 * 不搞"剩余次数按时段摊平"那套——那是 1000 条测试换来的细节，这条鱼还不需要。
 */

import { promises as fs } from 'node:fs'
import { paths } from './store.js'
import { normalizeStyle } from './seed.js'
import { readEvents } from './store.js'
import { derive } from './derive.js'
import { readHome, writeHome, sayToHer } from './home.js'

export const DEFAULTS = Object.freeze({
  // 家只有一个：路径由 familyRoot 决定（可替换），这里不存第二份。
  // 串门：这些目录里能见到她（人设/身份可访问），但她不住、不存任何东西。
  visits: [],
  // 起点风格：cute=可爱天真（默认），none=空白。只在播种时生效，已有的鱼不受影响。
  style: { preset: 'cute', text: '' },
  wake: { enabled: true, perDay: 2, window: ['09:00', '23:00'] },
  tools: { allow: [] },
})

/** 读配置（坏文件当默认）。 */
export async function loadConfig(root) {
  let raw = null
  try {
    raw = JSON.parse(await fs.readFile(paths(root).config, 'utf8'))
  } catch { /* 没有就是默认 */ }
  const w = raw?.wake ?? {}
  const t = raw?.tools ?? {}
  const style = normalizeStyle(raw?.style)
  const isAbsPath = (x) => /^[A-Za-z]:[\\/]/.test(x) || x.startsWith('/') || x.startsWith('\\')
  // 老的 workspaces 字段：兼容并入串门（家现在唯一，不再有"多个家"）
  const legacyWs = Array.isArray(raw?.workspaces) ? raw.workspaces : []
  const visits = [...new Set([
    ...(Array.isArray(raw?.visits) ? raw.visits : []),
    ...legacyWs,
  ].map((x) => String(x).trim()).filter((x) => x && isAbsPath(x)))].slice(0, 20)
  return {
    style,
    visits,
    wake: {
      enabled: w.enabled !== false,
      perDay: clamp(w.perDay, 0, 6, DEFAULTS.wake.perDay),
      window: Array.isArray(w.window) && w.window.length === 2 ? w.window.map(String) : DEFAULTS.wake.window,
    },
    tools: {
      allow: Array.isArray(t.allow) ? t.allow.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : [],
    },
  }
}

/** 改她的环境参数（白名单由写函数自己收缩：只认 wake / perception / tools / style 这几组）。 */
export async function saveConfig(patch, root, now = Date.now()) {
  let raw = {}
  try { raw = JSON.parse(await fs.readFile(paths(root).config, 'utf8')) ?? {} } catch { raw = {} }
  const clean = {}
  const src = patch && typeof patch === 'object' ? patch : {}
  if (src.wake && typeof src.wake === 'object') {
    clean.wake = {}
    if (typeof src.wake.enabled === 'boolean') clean.wake.enabled = src.wake.enabled
    if (src.wake.perDay !== undefined) clean.wake.perDay = Number(src.wake.perDay)
    if (Array.isArray(src.wake.window) && src.wake.window.length === 2) clean.wake.window = src.wake.window.map(String)
    if (Array.isArray(src.wake.window) && src.wake.window.length === 2) clean.wake.window = src.wake.window.map(String)
  }
  if (src.style !== undefined) clean.style = normalizeStyle(src.style)
  if (Array.isArray(src.visits)) clean.visits = src.visits.map((x) => String(x).trim()).filter(Boolean).slice(0, 20)
  if (src.tools && typeof src.tools === 'object') {
    clean.tools = {}
    if (Array.isArray(src.tools.allow)) clean.tools.allow = src.tools.allow.map(String)
  }
  // 老字段迁移：一旦保存过 visits，就把 workspaces 从文件里删掉，
  // 否则 loadConfig 的兼容合并会把用户刚删掉的条目又"复活"回来。
  if (clean.visits && raw.workspaces !== undefined) delete raw.workspaces
  const merged = {
    ...raw,
    ...(clean.wake ? { wake: { ...(raw.wake ?? {}), ...clean.wake } } : {}),
    ...(clean.tools ? { tools: { ...(raw.tools ?? {}), ...clean.tools } } : {}),
    ...(clean.style ? { style: clean.style } : {}),
    ...(clean.visits ? { visits: clean.visits } : {}),
  }
  await fs.mkdir(paths(root).root, { recursive: true })
  await fs.writeFile(paths(root).config, JSON.stringify(merged, null, 2) + '\u000a', 'utf8')
  const cfg = await loadConfig(root)
  return { ok: true, config: cfg, at: new Date(now).toISOString() }
}

function clamp(v, lo, hi, dflt) {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt
}

function minutesOf(hhmm, dflt) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? ''))
  if (!m) return dflt
  return Math.min(1439, Math.max(0, Number(m[1]) * 60 + Number(m[2])))
}

/** 今天该醒的几个时间点（分钟数）。按天摊平，不挤在一起。 */
export function slotsFor(config, now = new Date()) {
  const perDay = config.wake.perDay
  if (!config.wake.enabled || perDay <= 0) return []
  const [a, b] = config.wake.window
  const start = minutesOf(a, 9 * 60)
  const end = minutesOf(b, 23 * 60)
  const span = Math.max(30, end - start)
  const base = new Date(now)
  base.setHours(0, 0, 0, 0)
  const out = []
  for (let i = 0; i < perDay; i++) {
    const at = start + Math.round((span * (i + 0.5)) / perDay)
    out.push(new Date(base.getTime() + at * 60_000))
  }
  return out
}

/** 醒来的那句话：只写处境。 */
export function wakeText(m, { lastAt = '' } = {}) {
  const lines = [`你醒了。你存在了 ${m.day} 天。`]
  if (lastAt) {
    const hours = Math.max(1, Math.round((Date.now() - Date.parse(lastAt)) / 3_600_000))
    lines.push(`上次说话到现在过了大约 ${hours} 小时。`)
  } else if (!m.beliefCount) {
    lines.push('你还没有说过任何一句自己的话。')
  }
  return lines.join('\n')
}

/** 现在该不该醒：过了今天第 N 个时间点、且这个时间点还没醒过。 */
async function due(root, config, now = new Date()) {
  const home = (await readHome(root)) ?? {}
  const wakes = Array.isArray(home.wakes) ? home.wakes : []
  const slots = slotsFor(config, now)
  // 记的是**时间点的小时键**，不是"醒来那一刻"——两者差几个时区，
  // 拿后者去比会让同一个时间点一天叫好几次（第一版就踩了这个）。
  const done = new Set(wakes.map((w) => String(w).slice(0, 13)))
  for (const slot of slots) {
    if (now < slot) continue
    const key = slot.toISOString().slice(0, 13)
    if (!done.has(key)) return { due: true, slot, key }
  }
  return { due: false }
}

/** 叫醒一次，并记下这一次。 */
export async function wake(ctx, { root, now = Date.now(), force = false, log = () => {} } = {}) {
  const config = await loadConfig(root)
  let slotKey = ''
  if (!force) {
    if (!config.wake.enabled) return { ok: false, skipped: true, why: 'wake 关着' }
    const d = await due(root, config, new Date(now))
    if (!d.due) return { ok: false, skipped: true, why: '今天该醒的还没到' }
    slotKey = d.key
  }
  const { events } = await readEvents(root)
  const m = derive(events, now)
  const home = (await readHome(root)) ?? {}
  // 还没说过话时别提"上次说话"——那是第 1 天的 seed 时间，会显得她刚聊过
  const text = wakeText(m, { lastAt: m.beliefCount ? m.lastAt : '' })
  const said = await sayToHer(ctx, { root, text })
  if (!said.ok) return { ok: false, why: said.why }

  const entry = slotKey || new Date(now).toISOString().slice(0, 13)
  const wakes = [...(Array.isArray(home.wakes) ? home.wakes : []), entry].slice(-50)
  await writeHome(root, { ...home, sessionId: said.sessionId ?? home.sessionId ?? '', wakes })
  log(`叫醒了她一次（${entry}）`)
  return { ok: true, text, sessionId: said.sessionId }
}

/** 起一个定时器：每 10 分钟看一次该不该醒。停用插件 = 定时器停。 */
export function startWakeLoop(ctx, { root, log = () => {}, everyMs = 10 * 60_000 } = {}) {
  const t = setInterval(() => {
    wake(ctx, { root, log }).catch((err) => log(`唤醒失败：${String(err?.message ?? err).slice(0, 120)}`))
  }, everyMs)
  t.unref?.()
  return () => clearInterval(t)
}
