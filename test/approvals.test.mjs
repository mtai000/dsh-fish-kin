/**
 * approvals.test.mjs —— 待批准层（现在只有一种：她想用某个工具）
 *
 * 单子只是"她在问"；真正的判决写进 permissions.json
 * （一次性 / 永久允许 / 永久禁止），单子随后删掉。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withTemp } from './_fixture.mjs'
import { createApproval, createApprovalSync, listApprovals, readApproval, decideApproval, consumeApproval, readDecisions, KINDS } from '../lib/fish/approvals.js'
import { grantOnce, persist, loadPolicy } from '../lib/fish/permissions.js'

test('立单 / 列出来 / 过期', async () => {
  await withTemp(async (root) => {
    const now = Date.now()
    const a = await createApproval(root, { kind: 'tool-call', title: '想用 shell', payload: { tool: 'shell' }, now })
    assert.equal(a.ok, true)
    assert.match(a.approval.id, /^ap_[0-9A-Za-z]+$/)
    assert.deepEqual([...KINDS], ['tool-call'])

    const { pending } = await listApprovals(root, { now })
    assert.equal(pending.length, 1)
    assert.equal(pending[0].payload.tool, 'shell')

    const later = await listApprovals(root, { now: now + 25 * 3600_000 })
    assert.equal(later.pending.length, 0)
    assert.equal(later.expired, 1)
  })
})

test('同步立单：同一条工具不重复堆（守卫是同步的）', async () => {
  await withTemp(async (root) => {
    const a = createApprovalSync(root, { kind: 'tool-call', title: '想用 shell', payload: { tool: 'shell' } })
    assert.equal(a.ok, true)
    const b = createApprovalSync(root, { kind: 'tool-call', title: '想用 shell', payload: { tool: 'shell' } })
    assert.equal(b.approval.id, a.approval.id, '同一工具复用现有单子')
    const { pending } = await listApprovals(root)
    assert.equal(pending.length, 1)
  })
})

test('不认识的类型立不了单', async () => {
  await withTemp(async (root) => {
    const r = await createApproval(root, { kind: 'bili-comment', payload: {} })
    assert.equal(r.ok, false)
    assert.match(r.why, /不认识/)
  })
})

test('决定：批/驳都进账本，单子删掉，策略写进 permissions.json', async () => {
  await withTemp(async (root) => {
    const a = await createApproval(root, { kind: 'tool-call', title: '想用 shell', payload: { tool: 'shell' } })
    const ap = await decideApproval(root, a.approval.id, { verdict: 'approve', by: 'owner', why: 'allow-always' })
    assert.equal(ap.ok, true)
    persist(root, 'shell', 'allow')
    await consumeApproval(root, a.approval.id)
    assert.equal(await readApproval(root, a.approval.id), null)

    const b = await createApproval(root, { kind: 'tool-call', title: '想用 read_file', payload: { tool: 'read_file' } })
    await decideApproval(root, b.approval.id, { verdict: 'reject', by: 'owner', why: 'deny-once' })
    await consumeApproval(root, b.approval.id)

    const log = await readDecisions(root)
    assert.equal(log.length >= 2, true)
    assert.equal(log[0].kind, 'reject')

    const p = loadPolicy(root)
    assert.deepEqual(p.alwaysAllow, ['shell'])
    assert.deepEqual(p.alwaysDeny, [])
  })
})

test('一次性许可 30 分钟、用掉即作废', async () => {
  await withTemp(async (root) => {
    grantOnce(root, 'web_search')
    const p = loadPolicy(root)
    assert.ok(Number(p.once.web_search) > Date.now())
  })
})
