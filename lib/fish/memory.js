/**
 * fish/memory.js —— 记忆的重量：哪些摆在眼前，哪些折成一句话
 *
 * 用户要的不是"更多记忆"，是"记忆多了也别吵"。
 *
 * 做法（比 dsh-fish 简单，但同一条思路）：
 *   - **不删任何东西**。事件流永远留着，她 `her_recall` 那种能力将来再加；
 *   - 只在**渲染身份**时排序 + 折叠：重的东西摆出来，轻的折成一行「还有 N 条更早的，你记不清原话了」；
 *   - 重量只由三件事实决定：**被反复提起**、**被她自己改口过**、**最近说过**。
 *     没有"好感度""亲密度"这类东西——重量是记忆的属性，不是关系的分数。
 *
 * 为什么需要它：身份段每轮都在，条数一多就会把「现在」挤得只剩流水账；
 * 而她真正没变的那些判断，反而会被埋在最近三十句里。
 */

import { similarity, squeeze } from '../text.js'

/** 全量摆出来的条数 */
export const SHOWN = 4
/** 折成一句话的最多条数 */
export const FOLDED = 3
/** 相似到这个程度算"同一件事" */
const SAME = 0.55
/** 最近多少天内说过，算"还热" */
const FRESH_MS = 7 * 86_400_000

/** 她改口时指向过谁（refs）。 */
function revisedIds(events) {
  const m = new Map()
  for (const e of events) {
    if (e?.type !== 'revise') continue
    for (const r of Array.isArray(e.refs) ? e.refs : []) m.set(r, (m.get(r) ?? 0) + 1)
  }
  return m
}

/**
 * 把她的判断按"同一件事"聚起来，算出重量。
 * @returns {{items: Array, folded: number}}
 */
export function weighBeliefs(events = [], now = Date.now()) {
  const refs = revisedIds(events)
  const raw = events.filter((e) => ['utterance', 'revise'].includes(String(e?.type)) && String(e?.text ?? '').trim())
  const clusters = []
  for (const ev of raw) {
    const text = String(ev.text).trim()
    let hit = null
    for (const c of clusters) {
      if (similarity(c.rep, text) >= SAME) { hit = c; break }
    }
    if (hit) {
      hit.items.push(ev)
      // 代表句取更像"定论"的那条：改口后的优先，其次更长的
      if (ev.type === 'revise' || String(ev.text).length > String(hit.rep).length) hit.rep = String(ev.text).trim()
    } else {
      clusters.push({ rep: text, items: [ev] })
    }
  }

  const items = clusters.map((c) => {
    const times = c.items.length
    const amended = c.items.reduce((n, e) => n + (refs.get(e.id) ?? 0) + (e.type === 'revise' ? 1 : 0), 0)
    const lastTs = Math.max(...c.items.map((e) => Date.parse(String(e.ts)) || 0))
    const fresh = lastTs && now - lastTs <= FRESH_MS
    const score = 1 + 0.5 * Math.min(3, Math.max(0, times - 1)) + 0.6 * Math.min(2, amended) + (fresh ? 0.3 : 0)
    return { text: c.rep, times, amended, lastTs, fresh, score: Number(score.toFixed(2)), ids: c.items.map((e) => e.id) }
  })

  items.sort((a, b) => b.score - a.score || b.lastTs - a.lastTs)
  return { items, raw: raw.length }
}

/** 拒绝过的也一样：重的摆出来，轻的折一行。 */
export function weighRefusals(events = [], now = Date.now()) {
  const list = events.filter((e) => String(e?.type) === 'refusal' && String(e?.text ?? '').trim())
  const items = list.map((e) => {
    const t = Date.parse(String(e.ts)) || 0
    return {
      text: String(e.text).trim(),
      id: e.id,
      lastTs: t,
      fresh: t && now - t <= FRESH_MS,
      score: 1 + (t && now - t <= FRESH_MS ? 0.3 : 0),
    }
  })
  items.sort((a, b) => b.score - a.score || b.lastTs - a.lastTs)
  return { items }
}

/** 折成一句：只写"还剩几条"，不假装记得原文。 */
export function foldedLine(items, shown) {
  const older = items.slice(shown)
  if (!older.length) return ''
  const picked = older.slice(0, FOLDED).map((x) => squeeze(x.text, 24))
  const more = older.length - picked.length
  const tail = more > 0 ? `，还有 ${more} 条更早的` : ''
  return `${picked.join('；')}${tail}（你记不清原话了）`
}

/**
 * 一次算全，给身份段用。
 * @returns {{shown: object[], folded: string, shownRefusals: object[], foldedRefusals: string, total:number}}
 */
export function memoryView(events = [], { now = Date.now(), shown = SHOWN } = {}) {
  const b = weighBeliefs(events, now)
  const r = weighRefusals(events, now)
  return {
    shown: b.items.slice(0, shown),
    folded: foldedLine(b.items, shown),
    shownRefusals: r.items.slice(0, 3),
    foldedRefusals: foldedLine(r.items, 3),
    total: b.items.length,
  }
}
