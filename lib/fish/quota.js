/**
 * fish/quota.js —— 每日配额（按"批过的"算，不按"她想做的"算）
 *
 * 为什么要分开三种：刷站、评论、回复的风险不一样。刷站是"看"，评论是"在公共场合说话"，
 * 回复是"对着一个具体的人说话"。一刀切的配额会让人要么不敢放，要么放得太松。
 *
 * 计数依据是 `<她家>/approvals.jsonl` 里 `kind: approve` 的行——**批准了才算用掉**。
 * 立单不占额度（她可以想十次，你一次都不批）；批准后执行失败也照算（我们不为失败退额度，
 * 但错误会原样返回，不会假装没发生）。
 */

import { readJsonl } from '../kinstore.js'
import { approvalsLog } from './approvals.js'

/** 本地日期的键：2026-10-31（按本机时区，跟她"今天"的感知一致） */
export function dayKey(now = Date.now()) {
  const d = new Date(now)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 今天这一类用掉了几次。 */
export async function usedToday(root, approvalKind, now = Date.now()) {
  const { rows } = await readJsonl(approvalsLog(root))
  const key = dayKey(now)
  let n = 0
  for (const r of rows) {
    if (r?.kind !== 'approve') continue
    if (String(r.approvalKind ?? '') !== String(approvalKind)) continue
    if (dayKey(Date.parse(String(r.at)) || 0) !== key) continue
    n++
  }
  return n
}

/**
 * 还能不能立这一类的单。
 * @returns {{ok:boolean, used:number, limit:number, why:string}}
 */
export async function checkQuota(root, approvalKind, limit, now = Date.now()) {
  const max = Number(limit)
  if (!Number.isFinite(max) || max < 0) return { ok: true, used: 0, limit: Infinity, why: '' }
  const used = await usedToday(root, approvalKind, now)
  if (used >= max) {
    return { ok: false, used, limit: max, why: `今天的次数用完了（${used}/${max}）` }
  }
  return { ok: true, used, limit: max, why: '' }
}

/** 给界面看的一句：今天各类单子批过几次（不再有 B 站专用统计）。 */
export async function quotaLine(root, _config, now = Date.now()) {
  const used = await usedToday(root, 'source-act', now)
  return `行动许可 ${used} 次`
}
