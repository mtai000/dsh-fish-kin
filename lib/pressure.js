/**
 * pressure.js —— 什么时候该提「她该生孩子了」
 *
 * 这个文件只回答一个问题：**记忆压力到哪一档了**。它不做决定，也不写盘。
 *
 * 判据只有**记忆**，没有日历（2026-10-31 用户：「生命周期不应该按时间算」）：
 *   - 事件条数、记忆字数，两项取相对阈值的最大值；
 *   - **存在了几天不参与判定**。一条鱼可以被扔在角落里 200 天、一条记忆都没多，
 *     按天数算她"该分家了"，按记忆算她还是空壳——时间不是她的尺度。
 *     天数只作为一句背景写在界面上（`context`），不推任何人做决定。
 *
 * 三档：
 *   ok    还早
 *   warm  到了一半以上（提示可以准备，但不催）
 *   hot   越线了（可以提议生育；仍然要主人点头）
 *
 * 提议还会被两件事挡住（eligible=false）：
 *   1. 已经有一张待批准的请求单——别拿同一个决定烦两次；
 *   2. 上个孩子出生后新增的事件还不够多——刚生完就再提，等于把生孩子当清理缓存。
 */

import { summarize } from './read.js'

export const LEVELS = Object.freeze(['ok', 'warm', 'hot'])

/** 0–1 的条，用来画那个压力环；超过 1 就封在 1，避免界面爆掉。 */
function ratio(v, limit) {
  const l = Number(limit)
  const n = Number(v)
  if (!Number.isFinite(l) || l <= 0) return 0
  if (!Number.isFinite(n) || n < 0) return 0
  return n / l
}

/**
 * @param {object} input
 *   stats      summarize() 的结果
 *   bytes      events.jsonl 字节数（只用于展示）
 *   config     kinstore.loadConfig() 的 config
 *   pending    待批准请求数
 *   lastBirthAt 上一个孩子出生时母代有多少条事件（null = 没生过）
 * @returns {{level:string, pressure:number, ratios:object, reasons:string[], eligible:boolean, blockedBy:string, headline:string}}
 */
export function assess({ stats, bytes = 0, config, pending = 0, lastBirthEvents = null } = {}) {
  const limits = config?.pressure ?? { events: 1200, chars: 400_000 }
  const s = stats ?? summarize([])
  const r = {
    events: ratio(s.count, limits.events),
    chars: ratio(s.chars, limits.chars),
  }
  const pressure = Math.max(r.events, r.chars)
  const level = pressure >= 1 ? 'hot' : pressure >= 0.6 ? 'warm' : 'ok'

  const reasons = []
  if (r.events >= 1) reasons.push(`攒了 ${s.count} 条事件（上限 ${limits.events}）`)
  else if (r.events >= 0.6) reasons.push(`事件已经到 ${s.count} 条（上限 ${limits.events}）`)
  if (r.chars >= 1) reasons.push(`她的记忆有 ${s.chars} 字（上限 ${limits.chars}）`)
  else if (r.chars >= 0.6) reasons.push(`记忆字数到 ${s.chars}（上限 ${limits.chars}）`)
  if (!reasons.length) reasons.push('还很空，远没到该分家的时候')

  let blockedBy = ''
  const cooldown = Number(config?.auto?.cooldownEvents ?? 200)
  if (level !== 'hot') blockedBy = 'pressure-not-hot'
  else if (pending > 0) blockedBy = 'pending-request'
  else if (lastBirthEvents !== null && Number.isFinite(Number(lastBirthEvents)) && s.count - Number(lastBirthEvents) < cooldown) {
    blockedBy = 'too-soon'
  }

  const headline = level === 'hot'
    ? (blockedBy ? '她撑到上限了，但这件事还得你点头' : '她撑到上限了：可以生一个孩子，把重要的带走')
    : level === 'warm'
      ? '她的记忆开始变重了，可以先把遗传包看一眼'
      : '还早，让她继续长'

  // 天数只做背景，不进 reasons、不参与判定
  const context = s.spanDays > 0 ? `她存在了 ${s.spanDays} 天（这只是背景，不算压力）` : ''
  return { level, pressure: Math.min(1, pressure), ratios: r, reasons, eligible: !blockedBy, blockedBy, headline, bytes, context }
}
