/**
 * approvals.test.mjs —— 待批准层（内建 B 站移除后只剩 action 单）
 *
 * 现在只有一种单：`source-act`（她想去外部世界做一件事）。
 * 批准 = 发一张 30 分钟一次性通行证；驳回 = 什么都不做。
 * 执行由外部插件负责——本插件不再有任何网络调用。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withTemp } from './_fixture.mjs'
import { createApproval, listApprovals, readApproval, decideApproval, consumeApproval, readDecisions, KINDS } from '../lib/fish/approvals.js'
import { executeApproval } from '../lib/fish/execute.js'
import { grantFromApproval, findGrantSync } from '../lib/perception/grants.js'

test('立单 / 列出来 / 过期', async () => {
  await withTemp(async (root) => {
    const now = Date.now()
    const a = await createApproval(root, { kind: 'source-act', title: '看 B 站：say', detail: '想说一句', payload: { source: 'bili', tool: 'say', args: { text: 'hi' } }, now })
    assert.equal(a.ok, true)
    assert.match(a.approval.id, /^ap_[0-9A-Za-z]+$/)
    assert.deepEqual([...KINDS], ['source-act'])

    const { pending } = await listApprovals(root, { now })
    assert.equal(pending.length, 1)
    assert.equal(pending[0].payload.tool, 'say')

    const later = await listApprovals(root, { now: now + 25 * 3600_000 })
    assert.equal(later.pending.length, 0)
    assert.equal(later.expired, 1)
  })
})

test('不认识的类型立不了单', async () => {
  await withTemp(async (root) => {
    const r = await createApproval(root, { kind: 'bili-comment', payload: {} })
    assert.equal(r.ok, false)
    assert.match(r.why, /不认识/)
  })
})

test('决定：批准留着当通行证，驳回删掉；都进账本', async () => {
  await withTemp(async (root) => {
    const a = await createApproval(root, { kind: 'source-act', title: 'x：act_a', payload: { source: 'x', tool: 'act_a', args: {} } })
    const ap = await decideApproval(root, a.approval.id, { verdict: 'approve' })
    assert.equal(ap.ok, true)
    // 批准不等于执行完：单子还在（守卫要靠它发通行证）
    assert.ok(await readApproval(root, a.approval.id))

    const b = await createApproval(root, { kind: 'source-act', title: 'y：act_b', payload: { source: 'y', tool: 'act_b', args: {} } })
    const d = await decideApproval(root, b.approval.id, { verdict: 'reject', why: '今天不行' })
    assert.equal(d.ok, true)
    assert.equal(await readApproval(root, b.approval.id), null)
    const log = await readDecisions(root)
    assert.equal(log[0].kind, 'reject')
    assert.equal(log[0].why, '今天不行')

    await consumeApproval(root, a.approval.id)
    assert.equal(await readApproval(root, a.approval.id), null)
  })
})

test('批准 source-act = 发通行证（执行不联网）', async () => {
  await withTemp(async (root) => {
    const made = await createApproval(root, { kind: 'source-act', title: 'x：act_a', payload: { source: 'x', tool: 'act_a', args: {} } })
    const dec = await decideApproval(root, made.approval.id, { verdict: 'approve' })
    const r = await executeApproval({}, { root, approval: dec.approval })
    assert.equal(r.ok, true, r.text)
    assert.match(r.text, /通行证/)
    assert.ok(findGrantSync(root, 'act_a'))
  })
})

test('不认识的单子不装成功', async () => {
  await withTemp(async (root) => {
    const r = await executeApproval({}, { root, approval: { kind: 'bili-comment' } })
    assert.equal(r.ok, false)
    assert.match(r.text, /不认识的单子/)
  })
})
