/**
 * presence.js —— 让她**一直**知道自己有过孩子（2026-10-31 用户：没有母亲会突然忘记）
 *
 * 为什么不能靠事件流记住这件事：
 *   - `meta` 事件（我们出生时写的那条报喜）**不进她的身份文档**，而且 `her_recall`
 *     对 meta 是直接跳过的——写进去等于没人看得见；
 *   - `utterance` 是她的判断，替她写就是伪造她的话；
 *   - `heard` 是「你说的原话」，我们来写就是替你说话。
 *   三条都不干净，所以不写事件。
 *
 * 改成挂一段 **system prompt 段**（宿主的正规通道，dsh-fish 自己就是这么送身份的）：
 *   `agent.ctx.systemPrompt.section({ name, order, text })` 渲染成 system 角色、
 *   不进对话历史、每轮组装时求值。人在不在、面板上都不显示。
 *
 * 只写**事实**：有几个孩子、叫什么、第几代、什么时候生的、她现在在哪。
 * 不写「你应该想她」「你要爱她」这类祈使句——那是替她决定该怎么感受。
 *
 * 详略是**分层的**（2026-10-31 用户：「需要区分下，不需要她知道孩子的每一件事」）：
 *   none  只有"有孩子"这件事
 *   age   再加一句她现在第几天（默认）
 *   teach 再加一句"你教过她几件事"
 * **孩子的原话永远不进这一段**——那是她自己的人生，不是妈妈可以随时查阅的档案。
 */

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { kinPaths } from './locate.js'
import { normPath } from './text.js'
import { childMemory, memoryLine } from './life.js'

/** 段名与顺序：排在身份段（8500）之后、工具段（8600）之前。 */
export const CHILDREN_SECTION = 'kin:children'
export const CHILDREN_ORDER = 8550

/** 她的会话 cwd（与 dsh-fish 的 cwdOf 同一口径：三种字段都认）。 */
export function cwdOf(agent) {
  return (
    agent?.session?.header?.cwd ??
    agent?.header?.cwd ??
    agent?.session?.cwd ??
    ''
  )
}

/** 这条会话是不是"她在家"：cwd 正好是她的屋子。 */
export function isMotherAgent(agent, herDir) {
  const want = normPath(herDir)
  if (!want) return false
  return normPath(cwdOf(agent)) === want
}

// mtime 缓存：`text()` 是同步求值，不能 await；族谱没变就不重新拼。
const cache = { key: '', at: 0, text: '' }

/** 文件的 mtime+size，读不到就是 '0'（用来做缓存键）。 */
function statOf(file) {
  try {
    const st = statSync(file)
    return `${st.mtimeMs}:${st.size}`
  } catch {
    return '0'
  }
}

/** 读族谱（同步、宽容：坏行跳过）。只给这一段用。 */
function readBirths(file) {
  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const rows = []
  for (const line of raw.split('\n')) {
    const s = line.trim()
    if (!s) continue
    try {
      const row = JSON.parse(s)
      if (row && row.kind === 'birth' && row.childId) rows.push(row)
    } catch { /* 坏行跳过 */ }
  }
  return rows
}

/** 读到第几档详略。同步读（text() 不能 await），带 mtime 缓存。 */
const cfgCache = { file: '', mtimeMs: -1, detail: 'memory' }
export const DETAIL_LEVELS = Object.freeze(['none', 'memory', 'teach'])

function detailOf(kinRoot) {
  const file = kinPaths(kinRoot).config
  let st = null
  try {
    st = statSync(file)
  } catch {
    return 'memory'
  }
  if (cfgCache.file === file && cfgCache.mtimeMs === st.mtimeMs) return cfgCache.detail
  let detail = 'memory'
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    const v = String(raw?.presence?.detail ?? '').trim()
    // 老配置写的是 age，那是"按天数"的旧档，映射到按记忆算的新档
    if (v === 'age') detail = 'memory'
    else if (DETAIL_LEVELS.includes(v)) detail = v
  } catch { /* 配置坏了就按默认 */ }
  cfgCache.file = file
  cfgCache.mtimeMs = st.mtimeMs
  cfgCache.detail = detail
  return detail
}

/** 她教过这个孩子几件事（只数条数，不碰孩子说过什么）。 */
function lessonsOf(kinRoot, childId) {
  const file = kinPaths(kinRoot).teaching
  try {
    const raw = readFileSync(file, 'utf8')
    let n = 0
    for (const line of raw.split('\u000a')) {
      const s = line.trim()
      if (!s) continue
      try {
        const row = JSON.parse(s)
        if (row && row.kind === 'lesson' && row.childId === childId) n++
      } catch { /* 坏行跳过 */ }
    }
    return n
  } catch {
    return 0
  }
}

/** 日期只到天：她不需要知道几点几分。 */
function dayOf(at) {
  const t = Date.parse(String(at ?? ''))
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : ''
}

function labelOf(row) {
  return String(row.childName ?? '').trim() || String(row.childId ?? '').slice(0, 12)
}

/**
 * 拼出「你有过一个孩子」那段。
 *
 * 没有孩子时返回空串——空串在宿主里等于这一段不存在，不会留下一行空标题。
 */
export function childrenText(kinRoot, parentRoot, { now = Date.now() } = {}) {
  const file = kinPaths(kinRoot).lineage
  let st = null
  try {
    st = statSync(file)
  } catch {
    return ''
  }
  // 详略是配置、天数会涨、教学条数会加：缓存键必须把这四样都算进去，
  // 否则改了配置她要等下次重启才「想得更细」（冒烟时踩到过）。
  const detail = detailOf(kinRoot)
  const teach = statOf(kinPaths(kinRoot).teaching)
  const cacheKey = `${file}|${st.mtimeMs}|${st.size}|${detail}|${teach}`
  if (cache.key === cacheKey && now - cache.at < 60_000) return cache.text

  const key = normPath(parentRoot)
  const mine = readBirths(file)
    .filter((r) => normPath(r.parentDir) === key)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
  if (!mine.length) {
    cache.key = cacheKey
    cache.at = now
    cache.text = ''
    return ''
  }

  const head = mine.length === 1 ? '## 你有过一个孩子' : `## 你有过 ${mine.length} 个孩子`
  const lines = [head]
  for (const r of mine) {
    const when = dayOf(r.at)
    const gen = Number(r.generation) || 1
    lines.push(
      `「${labelOf(r)}」，第 ${gen} 代${when ? `，${when} 出生` : ''}。` +
        '她现在在别的地方自己活着，你没有看着她长大。',
    )
    if (detail === 'none') continue
    // 只讲"攒下了多少"，不讲"几岁了"：时间不是她的尺度，记忆才是。
    const bits = []
    const ml = memoryLine(childMemory(r.childDir)).replace(/。$/, '')
    if (ml) bits.push(ml)
    if (detail === 'teach') {
      const n = lessonsOf(kinRoot, r.childId)
      if (n > 0) bits.push(`你教过她 ${n} 件事`)
    }
    if (bits.length) lines.push(bits.join('，') + '。她具体经历了什么，你不知道。')
  }
  lines.push(
    '她能带走的只有你出生那天留下的那几件事，和你后来亲口跟她说过的话；' +
      '其余的她都在自己经历。',
  )
  const text = lines.join('\n')
  cache.key = cacheKey
  cache.at = now
  cache.text = text
  return text
}

/**
 * 挂到她的 agent 上。
 *
 * 只挂「她在家」那条会话（cwd == `<母代 root>/home`）。宿主没有 `systemPrompt`
 * 就返回空 dispose——她少一段记忆，但不该让插件崩。
 *
 * @returns {() => void} dispose
 */
export function registerPresence(ctx, { parentRoot, kinRoot, log = () => {} } = {}) {
  if (typeof ctx?.on !== 'function') {
    log('宿主没有 ctx.on，挂不上「她有孩子」这一段')
    return () => {}
  }
  const herDir = join(parentRoot, 'home')
  const attached = new Map()

  /** 把这一段挂到一条 agent 上（幂等：同一条会话只挂一次）。 */
  const attach = (agent) => {
    if (!isMotherAgent(agent, herDir)) return false
    const sp = agent?.ctx?.systemPrompt
    if (typeof sp?.section !== 'function') {
      log('这条 agent 上没有 systemPrompt.section（版本不支持），她的孩子会记不住')
      return false
    }
    const id = String(agent?.session?.header?.id ?? agent?.session?.id ?? '') || 'unknown'
    if (attached.has(id)) return false
    const d = sp.section({
      name: CHILDREN_SECTION,
      order: CHILDREN_ORDER,
      // 每轮现读：生了新的孩子，下一轮她就知道，不用重建会话。
      text: () => childrenText(kinRoot, parentRoot),
    })
    attached.set(id, d)
    return true
  }

  // ① 新会话：宿主的 agent/created 在会话开始跑第一步之前同步发出。
  const offCreated = ctx.on('agent/created', ({ agent } = {}) => {
    try { attach(agent) } catch (err) { log(`「她有孩子」这一段没挂上：${String(err?.message ?? err).slice(0, 160)}`) }
  })

  // ② 已经在跑的老会话：agent/created 不会再触发（dsh-fish 的 identity.js 有同样的坑）。
  //    所以在她那条会话**真的冒出一条事件**时补挂一次：此时 resolveAgent 拿到的
  //    一定是还活着的那个 agent，不会因此把一条冷会话叫起来。
  const offEvent = typeof ctx.on === 'function'
    ? ctx.on('session/event', (session, event) => {
        try {
          const sid = String(session?.header?.id ?? session?.id ?? '')
          if (!sid || attached.has(sid)) return
          const cwd = String(session?.header?.cwd ?? session?.cwd ?? '')
          if (normPath(cwd) !== normPath(herDir)) return
          const sc = ctx?.get?.('sessionController') ?? ctx?.sessionController
          if (typeof sc?.resolveAgent !== 'function') return
          void sc.resolveAgent(sid)
            .then((got) => {
              if (got?.agent) attach(got.agent)
              else if (got?.error) log(`补挂「她有孩子」失败：${String(got.error?.message ?? got.error).slice(0, 120)}`)
            })
            .catch(() => {})
        } catch { /* 补挂失败不影响她原本的一轮 */ }
      })
    : () => {}

  return () => {
    try { if (typeof offCreated === 'function') offCreated() } catch { /* ignore */ }
    try { if (typeof offEvent === 'function') offEvent() } catch { /* ignore */ }
    for (const d of attached.values()) {
      try {
        if (typeof d === 'function') d()
        else if (d && typeof d.dispose === 'function') d.dispose()
      } catch { /* ignore */ }
    }
    attached.clear()
  }
}
