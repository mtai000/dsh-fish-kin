/**
 * approvals.test.mjs —— 她要对外做的事，必须等主人点头
 *
 * 守住四件事：
 *   1. 单子能立、能列、会过期；决定只追加进账本
 *   2. **批准之前不联网**（立单不碰 B 站）
 *   3. 批准之后才执行：评论带对 aid、楼中楼带对 root/parent
 *   4. 驳回 = 什么都不做
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withTemp } from './_fixture.mjs'
import { createApproval, listApprovals, readApproval, decideApproval, consumeApproval, readDecisions, KINDS } from '../lib/fish/approvals.js'
import { executeApproval } from '../lib/fish/execute.js'

test('立单 / 列出来 / 过期', async () => {
  await withTemp(async (root) => {
    const now = Date.now()
    const a = await createApproval(root, { kind: 'bili-comment', title: '在 BV1 下留一句', detail: '一句', payload: { bvid: 'BV1', text: '一句' }, now })
    assert.equal(a.ok, true)
    assert.match(a.approval.id, /^ap_[0-9A-Za-z]+$/)
    assert.deepEqual([...KINDS].sort(), ['bili-comment', 'bili-reply', 'bili-scroll'])

    const { pending } = await listApprovals(root, { now })
    assert.equal(pending.length, 1)
    assert.equal(pending[0].kind, 'bili-comment')

    const later = await listApprovals(root, { now: now + 25 * 3600_000 })
    assert.equal(later.pending.length, 0)
    assert.equal(later.expired, 1)
  })
})

test('决定：批准取走单子、驳回删掉；都进账本', async () => {
  await withTemp(async (root) => {
    const a = await createApproval(root, { kind: 'bili-scroll', title: '想刷一会儿', payload: {} })
    const d = await decideApproval(root, a.approval.id, { verdict: 'reject', why: '今天不行' })
    assert.equal(d.ok, true)
    assert.equal(await readApproval(root, a.approval.id), null)
    const log = await readDecisions(root)
    assert.equal(log[0].kind, 'reject')
    assert.equal(log[0].why, '今天不行')

    const b = await createApproval(root, { kind: 'bili-scroll', title: '再来', payload: {} })
    const ap = await decideApproval(root, b.approval.id, { verdict: 'approve' })
    assert.equal(ap.ok, true)
    // 批准不等于执行完：单子还在，等执行完才 consume
    assert.ok(await readApproval(root, b.approval.id))
    await consumeApproval(root, b.approval.id)
    assert.equal(await readApproval(root, b.approval.id), null)
  })
})

test('执行评论：批准后才联网，用对 aid', async () => {
  await withTemp(async (root) => {
    const sent = []
    const client = {
      async view(bvid) { return { ok: true, data: { aid: 42, title: 'x' } } },
      async replyAdd(aid, text) { sent.push({ aid, text }); return { ok: true, data: { rpid: 7 } } },
    }
    const a = await createApproval(root, { kind: 'bili-comment', payload: { bvid: 'BV1xx', text: '一句' } })
    const r = await executeApproval({}, { root, approval: a.approval, client })
    assert.equal(r.ok, true, r.text)
    assert.deepEqual(sent, [{ aid: 42, text: '一句' }])
  })
})

test('执行楼中楼：root / parent 都要传对', async () => {
  await withTemp(async (root) => {
    const calls = []
    const client = {
      async view(bvid) { return { ok: true, data: { aid: 99 } } },
      async replyToComment(aid, o) { calls.push({ aid, ...o }); return { ok: true, data: { rpid: 8 } } },
    }
    const a = await createApproval(root, { kind: 'bili-reply', payload: { bvid: 'BV1yy', root: '111', parent: '222', text: '回你' } })
    const r = await executeApproval({}, { root, approval: a.approval, client })
    assert.equal(r.ok, true, r.text)
    assert.deepEqual(calls, [{ aid: 99, root: '111', parent: '222', message: '回你' }])
  })
})

test('执行刷站：把她叫醒，让她自己看（不替她看）', async () => {
  await withTemp(async (root) => {
    let prompted = ''
    const ctx = {
      get: (k) => (k === 'sessionController' ? {
        async list() { return [{ sessionId: 's1' }] },
        async create() { return { sessionId: 's1' } },
        async rename() {},
        async prompt(req) { prompted = req.content[0].text },
      } : null),
    }
    const a = await createApproval(root, { kind: 'bili-scroll', payload: {} })
    const r = await executeApproval(ctx, { root, approval: a.approval })
    assert.equal(r.ok, true, r.text)
    assert.match(prompted, /点头/)
  })
})

test('执行失败不发假成功', async () => {
  await withTemp(async (root) => {
    const client = {
      async view() { return { ok: false, message: '视频没了' } },
      async replyAdd() { throw new Error('不该发') },
    }
    const a = await createApproval(root, { kind: 'bili-comment', payload: { bvid: 'BVgone', text: '一句' } })
    const r = await executeApproval({}, { root, approval: a.approval, client })
    assert.equal(r.ok, false)
    assert.match(r.text, /视频没了/)
  })
})
