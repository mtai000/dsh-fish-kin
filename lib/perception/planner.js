/**
 * perception/planner.js —— 规划"今天该去认识什么"
 *
 * P0 只做一件事：**产出一张意图（intent）**，不驱动任何执行。
 * 执行在 P3 之后交给外部插件；审批与配额仍在 approvals/quota 那一层。
 *
 * 怎么选：
 *   - 已经启用、且今天还没用满的源里，挑**最久没去过的**；
 *   - 意图正文只写"想去哪儿、最近在意什么"，不写"我要得出什么结论"——
 *     结论是她自己的事（她的判断只能由 fish_commit 写）。
 */

import { dayKey } from '../fish/quota.js'
import { enabledSources, pickNextSource } from './registry.js'

const INTENTS_PER_DAY = 1

/** 最近一次用每个源是什么时候（读 intent 事件的 meta.source）。 */
export function lastUsedBySource(events = []) {
  const out = {}
  for (const e of events) {
    if (String(e?.kind ?? '') !== 'intent') continue
    const id = String(e?.meta?.source ?? '')
    if (!id) continue
    const ts = Date.parse(String(e.ts ?? '')) || 0
    if (ts > (out[id] ?? 0)) out[id] = ts
  }
  return out
}

/**
 * 产出今天的意图（纯函数，不落盘）。
 * @returns {{ok:boolean, why:string, intents:Array<{source:string,goal:string,body:string}>}}
 */
export function plan({ events = [], config = {}, now = Date.now() } = {}) {
  const p = config?.perception ?? {}
  const planCfg = p.plan ?? {}
  if (planCfg.enabled === false) return { ok: false, why: '规划关着', intents: [] }

  const sources = enabledSources(p.sources)
  if (!sources.length) return { ok: true, why: '没有启用的感知源', intents: [] }

  const perDay = Math.max(1, Math.min(6, Number(planCfg.perDay) || INTENTS_PER_DAY))
  const today = dayKey(now)
  const todays = (events ?? []).filter((e) => String(e?.kind ?? '') === 'intent' && dayKey(Date.parse(String(e.ts)) || 0) === today)
  if (todays.length >= perDay) return { ok: true, why: '今天的意图已经够了', intents: [] }

  // 今天的源去重：同一个源一天只规划一次
  const usedToday = new Set(todays.map((e) => String(e?.meta?.source ?? '')))
  const fresh = sources.filter((s) => !usedToday.has(s.id))
  if (!fresh.length) return { ok: true, why: '每个源今天都去过了', intents: [] }

  const next = pickNextSource(fresh, lastUsedBySource(events ?? []))
  if (!next) return { ok: true, why: '没有可去的源', intents: [] }

  const interests = Array.isArray(p.interests) ? p.interests.map(String).filter(Boolean).slice(0, 3) : []
  const tail = interests.length ? `（最近在意：${interests.join('、')}）` : ''
  const body = `想去${next.title}看看${tail}`
  return {
    ok: true,
    why: '',
    intents: [{ source: next.id, goal: 'explore', body }],
  }
}
