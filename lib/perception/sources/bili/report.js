/**
 * fish/report.js —— 她今天在 B 站做了什么（报告）
 *
 * 来源只有两处，都是既有的真相，不额外记账：
 *   - `approvals.jsonl`：批了/驳了哪几张单（含时间与类型）
 *   - `events.jsonl` 里的 `bili-*` 附注：看过、只看到封面、说过、回过、谷时刷过
 *
 * 报告是**只读的汇总**，不触发任何动作；生成失败就返回一句人话，不给半截报告。
 */

import { readEvents } from '../../../fish/store.js'
import { listApprovals, readDecisions, approvalsLog } from '../../../fish/approvals.js'
import { readJsonl } from '../../../kinstore.js'
import { loadConfig } from '../../../fish/wake.js'
import { quotaLine, usedToday, dayKey } from '../../../fish/quota.js'
import { whyOffPeak } from './offpeak.js'

const KINDS = {
  'bili-comment': '评论',
  'bili-reply': '回复',
  'bili-scroll': '刷站',
}

function today(now) {
  return dayKey(now)
}

/**
 * 生成今天的报告（Markdown 文本）。
 * @returns {Promise<{ok:boolean, text:string, why:string, stats:object}>}
 */
export async function buildReport(root, { now = Date.now(), day = '' } = {}) {
  try {
    const key = day || today(now)
    const config = await loadConfig(root)
    const { events } = await readEvents(root)
    const { pending } = await listApprovals(root, { now })
    const decisions = await readDecisions(root, { limit: 200 })
    const { rows } = await readJsonl(approvalsLog(root))

    const todayRows = (rows ?? []).filter((r) => {
      const at = Date.parse(String(r?.at)) || 0
      return at && dayKey(at) === key
    })
    const approved = todayRows.filter((r) => r.kind === 'approve')
    const rejected = todayRows.filter((r) => r.kind === 'reject')
    const expired = todayRows.filter((r) => r.kind === 'expire')

    const notes = (events ?? []).filter((e) => String(e?.text ?? '').startsWith('bili-') && dayKey(Date.parse(String(e.ts)) || 0) === key)
    const count = (prefix) => notes.filter((e) => String(e.text).startsWith(prefix)).length

    const watched = count('bili-watch:')
    const covers = count('bili-cover:')
    const said = count('bili-said:')
    const replied = count('bili-replied:')
    const scrolled = count('bili-scroll:')

    const off = whyOffPeak(now)
    const quota = await quotaLine(root, config, now)
    const lines = []
    lines.push(`# ${key} 她今天在 B 站`)
    lines.push('')
    lines.push(`- 现在：${off.text} · ${off.why}`)
    lines.push(`- 用量：${quota}`)
    lines.push(`- 待批准：${pending.length} 张${pending.length ? `（${pending.map((a) => KINDS[a.kind] ?? a.kind).join('、')}）` : ''}`)
    lines.push(`- 今天批了 ${approved.length} 张、驳了 ${rejected.length} 张${expired.length ? `、过期 ${expired.length} 张` : ''}`)
    if (approved.length) {
      lines.push('   - ' + approved.map((r) => `${KINDS[r.approvalKind] ?? r.approvalKind}「${r.title ?? ''}」`).join('；'))
    }
    lines.push(`- 看过画面 ${watched} 条、只看到封面 ${covers} 条`)
    lines.push(`- 说过 ${said} 条、回过 ${replied} 条${scrolled ? `、谷时刷过 ${scrolled} 次` : ''}`)
    const failed = todayRows.filter((r) => r.kind === 'approve' && r.failed === true).length
    if (failed) lines.push(`- 执行失败：${failed} 张（单子没被吞，原因看账本）`)
    if (!approved.length && !watched && !covers && !said && !replied) lines.push('- 今天还什么都没做。')

    const text = lines.join('\n')
    return {
      ok: true,
      why: '',
      day: key,
      text,
      stats: {
        day: key,
        watched, covers, said, replied, scrolled,
        approved: approved.length, rejected: rejected.length, expired: expired.length, pending: pending.length,
        quota, offPeak: off.off, offWhy: off.why, failed,
      },
    }
  } catch (err) {
    return { ok: false, why: String(err?.message ?? err).slice(0, 200), text: '', stats: null, day: '' }
  }
}
