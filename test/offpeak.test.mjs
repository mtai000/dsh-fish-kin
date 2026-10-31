/**
 * offpeak.test.mjs —— 谷时（参考 dsh-bili-scroll 的口径）+ 每日报告
 *
 * 三条要钉住：
 *   1. 谷时按**北京时间固定 +8** 算，不读本机时区（部署在 UTC 机器上不会错 8 小时）
 *   2. **周末全天**算谷时（只看小时会把周六上午误判成高峰）
 *   3. 到点只做一件事：propose=立一张要你点头的单；一天最多一次；配额没了就不立
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withTemp } from './_fixture.mjs'
import { isOffPeak, whyOffPeak, beijing, startOffpeakLoop, WINDOWS } from '../lib/fish/offpeak.js'
import { createApproval, listApprovals } from '../lib/fish/approvals.js'
import { appendJsonl } from '../lib/kinstore.js'
import { approvalsLog } from '../lib/fish/approvals.js'
import { buildReport } from '../lib/fish/report.js'
import { appendEvent } from '../lib/fish/store.js'
import { saveConfig } from '../lib/fish/wake.js'

// 2026-11-02 是周一。北京 10:00 = UTC 02:00
const bj = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h - 8, mi)

test('谷时：工作日高峰不跑，中午/夜间跑', () => {
  assert.deepEqual(Object.keys(WINDOWS).sort(), ['night', 'noon'])
  assert.equal(isOffPeak(bj(2026, 11, 2, 10)), false, '周一 10:00 是高峰')
  assert.equal(isOffPeak(bj(2026, 11, 2, 9)), false, '9:00 整属于高峰')
  assert.equal(isOffPeak(bj(2026, 11, 2, 12)), true, '12:00 进入中午谷时')
  assert.equal(isOffPeak(bj(2026, 11, 2, 13, 59)), true)
  assert.equal(isOffPeak(bj(2026, 11, 2, 14)), false, '14:00 回到高峰')
  assert.equal(isOffPeak(bj(2026, 11, 2, 18)), true, '18:00 进入夜间谷时')
  assert.equal(isOffPeak(bj(2026, 11, 2, 8)), true)
})

test('谷时：周末全天算谷时', () => {
  // 2026-11-07 周六、11-08 周日
  assert.equal(isOffPeak(bj(2026, 11, 7, 10)), true, '周六上午也是谷时')
  assert.equal(isOffPeak(bj(2026, 11, 8, 15)), true)
})

test('谷时：按北京时间算，不读本机时区', () => {
  // 同一个 UTC 时刻，无论本机时区怎么设，结论一致
  const t = Date.UTC(2026, 10, 2, 2, 30) // 北京 10:30 周一
  assert.equal(isOffPeak(t), false)
  const p = beijing(t)
  assert.equal(p.h, 10)
  assert.equal(p.day, 1, '周一')
  assert.match(whyOffPeak(t).why, /高峰/)
})

test('谷时：窗口可收窄（只留夜间）', () => {
  assert.equal(isOffPeak(bj(2026, 11, 2, 13), { windows: ['night'] }), false)
  assert.equal(isOffPeak(bj(2026, 11, 2, 20), { windows: ['night'] }), true)
})

test('到点立单：propose 只立一张，一天一次', async () => {
  await withTemp(async (root) => {
    const t = bj(2026, 11, 2, 13) // 周一中午谷时
    await saveConfig({ bili: { offpeak: { mode: 'propose', windows: ['noon', 'night'] } } }, root)
    const stop = startOffpeakLoop({}, { root, intervalMs: 10 ** 9, now: () => t, log: () => {} })
    await new Promise((r) => setTimeout(r, 50))
    stop()

    const { pending } = await listApprovals(root)
    assert.equal(pending.length, 1)
    assert.equal(pending[0].kind, 'bili-scroll')
    assert.match(pending[0].title, /谷时/)

    // 再跑一次：同一天不重复立
    const stop2 = startOffpeakLoop({}, { root, intervalMs: 10 ** 9, now: () => t + 60_000, log: () => {} })
    await new Promise((r) => setTimeout(r, 50))
    stop2()
    const again = await listApprovals(root)
    assert.equal(again.pending.length, 1)
  })
})

test('到点立单：高峰不立、配额用完不立、关掉不立', async () => {
  await withTemp(async (root) => {
    const peak = bj(2026, 11, 2, 10) // 周一高峰
    const stop = startOffpeakLoop({}, { root, intervalMs: 10 ** 9, now: () => peak, log: () => {} })
    await new Promise((r) => setTimeout(r, 50))
    stop()
    assert.equal((await listApprovals(root)).pending.length, 0, '高峰不立单')

    const noon = bj(2026, 11, 2, 13)
    await saveConfig({ bili: { offpeak: { mode: 'off' } } }, root)
    const stop2 = startOffpeakLoop({}, { root, intervalMs: 10 ** 9, now: () => noon, log: () => {} })
    await new Promise((r) => setTimeout(r, 50))
    stop2()
    assert.equal((await listApprovals(root)).pending.length, 0, '关掉不立单')
  })
})

test('报告：把她今天做过的事汇成一段', async () => {
  await withTemp(async (root) => {
    const t = bj(2026, 11, 2, 20)
    await appendEvent(root, { kind: 'note', body: 'bili-watch:BV1' }, { source: 'system', day: 1 })
    await appendEvent(root, { kind: 'note', body: 'bili-cover:BV2' }, { source: 'system', day: 1 })
    await appendEvent(root, { kind: 'note', body: 'bili-said:BV1:9' }, { source: 'system', day: 1 })
    await appendJsonl(approvalsLog(root), { v: 1, kind: 'approve', id: 'ap_a', at: new Date().toISOString(), by: 'owner', approvalKind: 'bili-comment', title: '在 BV1 下留一句' })
    await createApproval(root, { kind: 'bili-reply', title: '回一条评论', payload: {} })

    const r = await buildReport(root)
    assert.equal(r.ok, true, r.why)
    assert.match(r.text, /看过画面 1 条、只看到封面 1 条/)
    assert.match(r.text, /说过 1 条/)
    assert.match(r.text, /待批准：1 张/)
    assert.match(r.text, /今天批了 1 张/)
    assert.match(r.text, /北京时间/)
    assert.equal(r.stats.watched, 1)
  })
})
