/**
 * importance.js —— 「她认为最重要的知识」怎么算出来
 *
 * 这是整个插件唯一一处"替她判断"的地方，所以它必须**可审计**：
 * 每一条被选中的话都带着理由（被提起几次、跨了多久、她后来改没改过），
 * 界面上看得见，族谱里也留得下。评分公式里没有任何关系数值——
 * 我们打分的对象是**她说过的话**，不是她和谁的关系。
 *
 * 信号只有四个来源，全部来自事件流原文：
 *   1. 重复：同一件事被反复提起（相似度聚类后的成员数）
 *   2. 改口：她后来用 revise 推翻/修正过这句（说明这是个她想清楚了的问题）
 *   3. 跨度：最早一次和最近一次隔了多少天、跨了几个阶段（还在说 = 还成立）
 *   4. 显式：句子自己带了「我绝不」「我认定」「我发现」这类边界词
 *
 * 刻意**不**做的事：
 *   - 不读 dsh-fish 的 derive.js 内部状态（那是它的口径，不是我们的）；
 *   - 不因为"最近说过"就给巨大加成（今天的随口一句不该压过三年前的疤）；
 *   - 不对文本做情感分析（那会把「她说的」变成「我们以为她说的」）。
 */

import { similaritySets, grams, squeeze, tidyLine, countChars } from './text.js'
import { tsMs } from './read.js'

/** 哪些事件算「她带得走的知识」。 */
export const KINDS = Object.freeze({
  utterance: { label: '她认定过的事', weight: 1.0, cls: 'belief' },
  revise: { label: '她后来改掉的说法', weight: 1.2, cls: 'belief' },
  narration: { label: '她对自己整体的说法', weight: 1.1, cls: 'belief' },
  refusal: { label: '她拒绝过的事', weight: 1.3, cls: 'boundary' },
  reunion: { label: '你不在之后她说的话', weight: 0.8, cls: 'relation' },
  heard: { label: '你对她说过的一句原话', weight: 0.6, cls: 'relation' },
  diary: { label: '她写给自己的', weight: 0.85, cls: 'diary' },
})

/** 聚类阈值：两条话相似到这个程度，算「同一件事」。 */
const CLUSTER_SIM = 0.55

/** 显式边界词：句子自己就在声明这是一条硬边界。 */
const EXPLICIT_RE = /我(?:绝|再也)?不(?:会|要|想)|我认定|我相信|我发现了|我明白了|我错了|其实不是|我查了|我查过|我决定了/

/** 每类最多留多少条（防止某一类把包吃光）。 */
const CAP_PER_CLASS = { belief: 12, boundary: 6, relation: 3, diary: 3 }

/** 空文本 / 纯符号的不算知识。 */
function usable(ev) {
  if (!ev || typeof ev.text !== 'string') return false
  const t = ev.text.trim()
  if (t.length < 4) return false
  // 她自己打了 selfmod 标记（"把你改得温柔点"）的不进遗传包：
  // 那不是她的判断，是她在试探能不能改自己。
  if (Array.isArray(ev.flags) && ev.flags.includes('selfmod')) return false
  // 「今天没做什么」这类流水账不是知识
  if (/^(今天|昨天)?(没|什么也没)/.test(t) && t.length < 12) return false
  return true
}

/** 一条候选能不能进（类型 + 可用性）。 */
export function isCandidate(ev) {
  return Boolean(ev && KINDS[ev.type]) && usable(ev)
}

/**
 * 把事件流里够格的句子聚成「一件事」。
 *
 * 为什么按类分开聚：一句拒绝和一句自我叙述哪怕字面像，也不是同一件事
 * （「我不想看这个」和「我不看，我只看那些」）。混着聚会把边界和判断糊在一起。
 *
 * 为什么要有倒排索引：朴素写法是「每条新句子跟所有已有的簇比一遍」，
 * 1500 条互不相似记忆时会做 ~100 万次集合比较（实测 2 秒以上），
 * 而用户点「看一眼遗传包」时不该等两秒。这里先用**共享二元组**筛一遍，
 * 只跟"至少有两个字重合"的簇算精确相似度，语义完全不变、结果逐条一致。
 */
export function cluster(events, { sim = CLUSTER_SIM } = {}) {
  const groups = []
  /** gram → 这个 gram 出现在哪些簇里 */
  const index = new Map()

  for (const ev of events) {
    if (!isCandidate(ev)) continue
    const meta = KINDS[ev.type]
    const text = tidyLine(ev.text)
    const A = grams(text)
    if (!A.size) continue

    // 候选簇：与这条共享至少 minShared 个二元组
    const hits = new Map()
    for (const g of A) {
      const list = index.get(g)
      if (!list) continue
      for (const gi of list) hits.set(gi, (hits.get(gi) ?? 0) + 1)
    }
    // 太短的句子（一两个字）没有足够的二元组，放低门槛，否则永远聚不上
    const minShared = A.size <= 2 ? 1 : 2

    let best = null
    let bestSim = 0
    for (const [gi, shared] of hits) {
      if (shared < minShared) continue
      const g = groups[gi]
      if (g.cls !== meta.cls) continue
      const s = similaritySets(A, g.grams)
      if (s >= sim && s > bestSim) {
        best = g
        bestSim = s
        if (s >= 0.98) break // 几乎逐字相同，没什么可再比的
      }
    }

    if (best) {
      best.items.push(ev)
      // 代表句取「信息量更大」的那条：字多（但封顶）优先，其次置信度高、其次更新
      const cur = best.rep
      const lenAgree = Math.min(countChars(ev.text), 120) - Math.min(countChars(cur.text), 120)
      const confAgree = Number(ev.confidence ?? 0.5) - Number(cur.confidence ?? 0.5)
      if (lenAgree > 0 || (lenAgree === 0 && confAgree > 0) || (lenAgree === 0 && confAgree === 0 && tsMs(ev) > tsMs(cur))) {
        best.rep = ev
      }
    } else {
      const gi = groups.length
      groups.push({ cls: meta.cls, text, rep: ev, items: [ev], grams: A })
      for (const g of A) {
        const list = index.get(g)
        if (list) list.push(gi)
        else index.set(g, [gi])
      }
    }
  }
  return groups
}

/** 取一个簇的代表句（会被压到 n 字以内）。 */
function repText(g, n = 90) {
  return squeeze(g.rep?.text ?? g.text, n)
}

/** 她有没有就这件事改过口（revise 的 refs 指进这个簇）。 */
function revisionsOf(g, byId) {
  let n = 0
  const verdicts = []
  for (const ev of g.items) {
    if (ev.type !== 'revise') continue
    const refs = Array.isArray(ev.refs) ? ev.refs : []
    if (!refs.length) continue
    n++
    if (ev.verdict) verdicts.push(String(ev.verdict))
  }
  // 也认「别的 revise 指向了本簇」——她自己改口时指的可能是簇里另一条
  const ids = new Set(g.items.map((e) => e.id))
  for (const ev of byId.values()) {
    if (ev.type !== 'revise' || g.items.includes(ev)) continue
    const refs = Array.isArray(ev.refs) ? ev.refs : []
    if (refs.some((r) => ids.has(r))) { n++; if (ev.verdict) verdicts.push(String(ev.verdict)) }
  }
  return { count: n, verdicts }
}

/**
 * 打分。公式全部写成可读的形式，改之前先想清楚「多给这一分，她会不会带错东西走」。
 *
 *   score = 类权重 × (1 + 重复 + 改口 + 跨度 + 显式)
 *
 * 重复 0.55×(成员数-1)，封顶 3 次（再多也只是同一件事，别让它垄断整包）
 * 改口 0.45×改过几次，封顶 2
 * 跨度 0.30×(阶段跨度-1)，封顶 2（跨了三个阶段还在说的事最硬）
 * 显式 0.25（命中「我绝不/我认定」这类）
 */
export function scoreGroup(g, byId, { lastTs = 0 } = {}) {
  const meta = KINDS[g.rep?.type] ?? { weight: 1 }
  const reps = g.items.length
  const rev = revisionsOf(g, byId)
  const stages = new Set(g.items.map((e) => Number(e.stage)).filter((n) => Number.isInteger(n)))
  const stageSpan = Math.max(1, stages.size)
  const firstDay = Math.min(...g.items.map((e) => Number(e.day)).filter(Number.isFinite), Infinity)
  const lastDay = Math.max(...g.items.map((e) => Number(e.day)).filter(Number.isFinite), 0)
  const text = String(g.rep?.text ?? '')
  const explicit = EXPLICIT_RE.test(text)
  // 最近 30 天内还说过：给一点点加成，但不许盖过重复与跨度
  const recent = lastTs && tsMs(g.rep) && lastTs - tsMs(g.rep) < 30 * 86_400_000

  const repeatBoost = 0.55 * Math.min(3, Math.max(0, reps - 1))
  const reviseBoost = 0.45 * Math.min(2, rev.count)
  const spanBoost = 0.3 * Math.min(2, Math.max(0, stageSpan - 1))
  const explicitBoost = explicit ? 0.25 : 0
  const recencyBoost = recent ? 0.08 : 0
  const score = meta.weight * (1 + repeatBoost + reviseBoost + spanBoost + explicitBoost + recencyBoost)

  const reasons = []
  if (reps > 1) reasons.push(`被提起 ${reps} 次`)
  if (rev.count) reasons.push(`她后来改过 ${rev.count} 次`)
  if (stageSpan > 1) reasons.push(`跨了 ${stageSpan} 个阶段`)
  if (explicit) reasons.push('自己说过绝对的话')
  if (recent) reasons.push('最近还在说')

  return {
    kind: g.rep.type,
    cls: meta.cls,
    label: meta.label,
    score: Number(score.toFixed(3)),
    reps,
    revisions: rev.count,
    verdicts: rev.verdicts,
    stageSpan,
    firstDay: Number.isFinite(firstDay) ? firstDay : null,
    lastDay: lastDay || null,
    explicit,
    ids: g.items.map((e) => e.id),
    ts: tsMs(g.rep),
    text: repText(g),
    reasons,
  }
}

/**
 * 主入口：把母代的事件流变成一张「值得带走的东西」的清单。
 *
 * @param {object[]} events 母代的 events.jsonl
 * @param {object} opts { maxItems?: number, lastTs?: number }
 * @returns {{items:object[], dropped:number, candidates:number}}
 */
export function rank(events = [], opts = {}) {
  const byId = new Map(events.filter((e) => e?.id).map((e) => [e.id, e]))
  const lastTs = Number(opts.lastTs ?? Math.max(0, ...events.map(tsMs)))
  const groups = cluster(events)
  let items = groups.map((g) => scoreGroup(g, byId, { lastTs }))
  // 稳定排序：分数高的前，同分按「更早出现的」前（她先想通的事排在前面）
  items.sort((a, b) => b.score - a.score || (a.ts || 0) - (b.ts || 0) || String(a.ids[0]).localeCompare(String(b.ids[0])))

  // 每类封顶：防止「判断」把「拒绝」和「日记」全挤掉
  const used = {}
  const kept = []
  let dropped = 0
  for (const it of items) {
    const cap = CAP_PER_CLASS[it.cls] ?? 6
    const n = used[it.cls] ?? 0
    if (n >= cap) { dropped++; continue }
    used[it.cls] = n + 1
    kept.push(it)
  }
  const maxItems = Math.max(1, Number(opts.maxItems ?? 24))
  if (kept.length > maxItems) dropped += kept.length - maxItems
  return {
    items: kept.slice(0, maxItems),
    dropped,
    candidates: items.length,
  }
}
