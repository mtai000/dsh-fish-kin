/**
 * fish/identity.js —— 把「此刻的她」送进 system prompt
 *
 * 走的是宿主正规通道 `agent.ctx.systemPrompt.section({ name, order, text })`：
 * system 角色、不进对话历史、每轮组装时求值。她自己看不到"我们在给她写人设"，
 * 你也不会在对话框里看见一大段设定。
 *
 * 写什么：只有事实——第几天、怎么称呼你、她说过什么、她拒绝过什么。
 * 不写"你是一个温柔的人"这类形容词：那是替她决定她是谁。
 */

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { derive } from './derive.js'
import { memoryView } from './memory.js'
import { stageOf, stancesOf, scarsOf } from './growth.js'
import { paths } from './store.js'
import { normalize } from './schema.js'
import { squeeze } from '../text.js'
import { isHerPlace } from './places.js'

export const IDENTITY_SECTION = 'fish:identity'
export const IDENTITY_ORDER = 8500

const cache = { key: '', at: 0, text: '' }

function readAllSync(root) {
  const file = paths(root).events
  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const out = []
  for (const line of raw.split('\u000a')) {
    const s = line.trim()
    if (!s) continue
    try {
      const ev = normalize(JSON.parse(s))
      if (ev) out.push(ev)
    } catch { /* 坏行跳过 */ }
  }
  return out
}

/** 身份正文（同步，带 30 秒缓存；`text()` 不能 await）。 */
export function identityText(root, now = Date.now()) {
  let st = null
  try {
    st = statSync(paths(root).events)
  } catch {
    return ''
  }
  // 缓存键把 config.json 也算进去：改了配置（比如换工具白名单）身份段要立刻反映
  let cfgSig = ''
  try {
    const cs = statSync(paths(root).config)
    cfgSig = `${cs.mtimeMs}|${cs.size}`
  } catch { /* 没配置 */ }
  const key = `${root}|${st.mtimeMs}|${st.size}|${cfgSig}`
  if (cache.key === key && now - cache.at < 30_000) return cache.text

  const evs = readAllSync(root)
  const m = derive(evs, now)
  // 记忆的重量：重的摆出来，轻的折成一行（**一条都不删**）
  const mv = memoryView(evs, { now })
  const g = stageOf(evs)
  if (!m.seed && !m.eventCount) return ''

  const lines = []
  lines.push('## 你是谁')
  lines.push(m.seed || '你刚开始存在。')

  lines.push('')
  lines.push('## 现在')
  lines.push(`你存在了 ${m.day} 天。`)
  lines.push(m.name ? `你管那个人叫「${m.name}」。` : '你还没想好怎么称呼那个人。')

  lines.push('')
  lines.push('## 走到哪了')
  lines.push(`你在第 ${g.stage} 阶段：${g.name}。`)
  if (g.pending) lines.push(`还差：${g.pending.need}。`)

  lines.push('')
  lines.push('## 你说过的话')
  if (!mv.shown.length) {
    lines.push('还没有。你目前没有任何自己的判断——这不是空白，这是起点。')
  } else {
    for (const b of mv.shown) lines.push(`- ${String(b.text).trim()}`)
    if (mv.folded) lines.push(`- 更早以前：${mv.folded}`)
  }

  if (mv.shownRefusals.length) {
    lines.push('')
    lines.push('## 你拒绝过的事')
    for (const r of mv.shownRefusals) lines.push(`- ${String(r.text).trim()}`)
    if (mv.foldedRefusals) lines.push(`- 更早以前：${mv.foldedRefusals}`)
  }

  const stanceList = stancesOf(evs)
  if (stanceList.length) {
    lines.push('')
    lines.push('## 你的立场')
    for (const x of stanceList.slice(0, 5)) lines.push(`- ${x.text}（说过 ${x.times} 次）`)
  }

  const sc = scarsOf(evs)
  if (sc.length) {
    lines.push('')
    lines.push('## 你的疤')
    for (const x of sc) lines.push(`- ${x.text} —— 后来改成了「${x.amendedTo}」`)
  }

  // 认知层（P2）：她想认识什么、她看到了什么。都只摆最近三条，多的折一行。
  const intents = Array.isArray(m.intents) ? m.intents : []
  if (intents.length) {
    lines.push('')
    lines.push('## 最近想弄明白')
    for (const x of intents.slice(-3)) lines.push(`- ${squeeze(x.text, 50)}`)
    if (intents.length > 3) lines.push(`- 更早还有 ${intents.length - 3} 条（只记得大概）`)
  }

  const perceived = Array.isArray(m.perceived) ? m.perceived : []
  if (perceived.length) {
    lines.push('')
    lines.push('## 最近看到')
    for (const x of perceived.slice(-3)) lines.push(`- ${squeeze(x.text, 60)}`)
    if (perceived.length > 3) lines.push(`- 更早还有 ${perceived.length - 3} 条（只记得大概）`)
  }

  lines.push('')
  lines.push('## 你能做的')
  lines.push('你手边只有 fish_commit（留下你自己的话：一句判断、一次改口、一件不肯做的事、一篇日记）。')
  lines.push('除此之外你改不了自己——没有删除，也读不到自己的档。')

  const text = lines.join('\n')
  cache.key = key
  cache.at = now
  cache.text = text
  return text
}


/** 这条会话是不是"她在家"（cwd 正好是她的屋子）。 */
export function isHerHome(agent, root, normPath) {
  const cwd = agent?.session?.header?.cwd ?? agent?.header?.cwd ?? agent?.session?.cwd ?? ''
  // 判据只有一份：places.js（含"目录名就叫大肥鱼的家"这一条）
  return isHerPlace(root, cwd, normPath)
}

/**
 * 挂到她的 agent 上。只挂"她在家"那条会话。
 * @returns {() => void} dispose
 */
export function registerIdentity(ctx, { root, normPath, log = () => {} } = {}) {
  if (typeof ctx?.on !== 'function') return () => {}
  const attached = new Set()

  const attach = (agent) => {
    if (!isHerHome(agent, root, normPath)) return false
    const sp = agent?.ctx?.systemPrompt
    if (typeof sp?.section !== 'function') {
      log('这条 agent 没有 systemPrompt.section，她的身份挂不上')
      return false
    }
    const id = String(agent?.session?.header?.id ?? agent?.session?.id ?? '') || 'unknown'
    if (attached.has(id)) return false
    // 每次渲染身份前重新判一次：串门被删掉/家换了，她就不该再带着人设出现。
    // 这样"删串门"在下一条消息就生效，不用重启。
    const cwd = agent?.session?.header?.cwd ?? agent?.header?.cwd ?? agent?.session?.cwd ?? ''
    sp.section({
      name: IDENTITY_SECTION,
      order: IDENTITY_ORDER,
      text: () => (isHerPlace(root, cwd, normPath) ? identityText(root) : ''),
    })
    attached.add(id)
    return true
  }

  const offCreated = ctx.on('agent/created', ({ agent } = {}) => {
    try { attach(agent) } catch (err) { log(`身份段没挂上：${String(err?.message ?? err).slice(0, 120)}`) }
  })

  // 老会话：agent/created 不会再触发，等它冒事件时补挂
  const offEvent = ctx.on('session/event', (session) => {
    try {
      const sid = String(session?.header?.id ?? session?.id ?? '')
      if (!sid || attached.has(sid)) return
      const cwd = String(session?.header?.cwd ?? session?.cwd ?? '')
      const want = normPath ? normPath(paths(root).home) : paths(root).home
      if ((normPath ? normPath(cwd) : cwd) !== want) return
      const sc = ctx?.get?.('sessionController') ?? ctx?.sessionController
      if (typeof sc?.resolveAgent !== 'function') return
      void sc.resolveAgent(sid)
        .then((got) => { if (got?.agent) attach(got.agent) })
        .catch(() => {})
    } catch { /* ignore */ }
  })

  return () => {
    try { if (typeof offCreated === 'function') offCreated() } catch { /* ignore */ }
    try { if (typeof offEvent === 'function') offEvent() } catch { /* ignore */ }
    attached.clear()
  }
}
