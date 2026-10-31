/**
 * quota.test.mjs —— 每日配额 + 兴趣点
 *
 * 配额的口径：**批准了才算用掉**（立单不占）。三种分开计：刷站 / 评论 / 回复。
 * 用完就不再接单——省得她天天立一堆没人批的单子。
 *
 * 兴趣点只影响"排序与标注"，不裁列表：命中的排前面并标出来，其余照旧。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withTemp } from './_fixture.mjs'
import { appendJsonl } from '../lib/kinstore.js'
import { approvalsLog, createApproval } from '../lib/fish/approvals.js'
import { dayKey, usedToday, checkQuota, quotaLine } from '../lib/fish/quota.js'
import { matchInterests, sortByInterests } from '../lib/fish/interests.js'
import { loadConfig } from '../lib/fish/wake.js'
import { registerBiliTool } from '../lib/fish/index.js'

const approve = (root, approvalKind, at) => appendJsonl(approvalsLog(root), {
  v: 1, kind: 'approve', id: 'ap_x', at: new Date(at).toISOString(), by: 'owner', approvalKind,
})

test('配额：只数"今天的、批准了的、同一类"', async () => {
  await withTemp(async (root) => {
    const now = Date.now()
    await approve(root, 'bili-scroll', now)
    await approve(root, 'bili-scroll', now)
    await approve(root, 'bili-comment', now)
    await approve(root, 'bili-scroll', now - 2 * 86_400_000) // 前天
    assert.equal(await usedToday(root, 'bili-scroll', now), 2)
    assert.equal(await usedToday(root, 'bili-comment', now), 1)
    assert.equal(await usedToday(root, 'bili-reply', now), 0)

    assert.equal((await checkQuota(root, 'bili-scroll', 3, now)).ok, true)
    const full = await checkQuota(root, 'bili-scroll', 2, now)
    assert.equal(full.ok, false)
    assert.match(full.why, /次数用完/)
    assert.equal((await checkQuota(root, 'bili-scroll', 0, now)).ok, false)
    assert.equal((await checkQuota(root, 'bili-scroll', NaN, now)).ok, true, '不限额')
  })
})

test('配额：日期按本机时区，跨天清零', async () => {
  await withTemp(async (root) => {
    const today = Date.now()
    const yesterday = today - 86_400_000
    await approve(root, 'bili-scroll', yesterday)
    assert.equal(await usedToday(root, 'bili-scroll', today), 0)
    assert.notEqual(dayKey(today), dayKey(yesterday))
  })
})

test('配额：一行摘要', async () => {
  await withTemp(async (root) => {
    await approve(root, 'bili-scroll', Date.now())
    const cfg = await loadConfig(root)
    const line = await quotaLine(root, cfg)
    assert.match(line, /刷站 1\/1/)
    assert.match(line, /评论 0\/2/)
  })
})

test('用完配额：她连单都立不了（不浪费你的注意力）', async () => {
  await withTemp(async (root) => {
    const cfg = await loadConfig(root)
    await approve(root, 'bili-scroll', Date.now())
    const specs = []
    const ctx = { tools: { register: (s) => { specs.push(s); return () => {} } } }
    registerBiliTool(ctx, { root, log: () => {} })
    const tool = specs[0]
    const r = await tool.execute({ action: 'scroll' })
    assert.equal(r.ok, false)
    assert.match(r.text, /次数用完/)

    // 立单也真的没建
    const { listApprovals } = await import('../lib/fish/approvals.js')
    const { pending } = await listApprovals(root)
    assert.equal(pending.length, 0)
    assert.equal(cfg.bili.scrollPerDay, 1)
  })
})

test('兴趣点：命中排序 + 标注，但不裁列表', () => {
  const list = [
    { bvid: 'BV1', title: '今天吃了什么', desc: '' },
    { bvid: 'BV2', title: '聊聊独立游戏', desc: '' },
    { bvid: 'BV3', title: 'AI 又更新了', desc: '人工智能' },
  ]
  const sorted = sortByInterests(list, ['人工智能', '独立游戏'])
  assert.equal(sorted.length, 3, '一条都不许裁掉')
  assert.equal(sorted[0].bvid, 'BV2')
  assert.deepEqual(sorted[0]._hits, ['独立游戏'])
  assert.equal(sorted[2].bvid, 'BV1')
  assert.deepEqual(matchInterests({ title: 'AI 又更新了', desc: '人工智能' }, ['人工智能']), ['人工智能'])
  assert.deepEqual(matchInterests({ title: '没关系的' }, ['人工智能']), [])
})

test('配置：配额与兴趣点都有默认值，越界被夹住', async () => {
  await withTemp(async (root) => {
    const cfg = await loadConfig(root)
    assert.equal(cfg.bili.scrollPerDay, 1)
    assert.equal(cfg.bili.commentPerDay, 2)
    assert.equal(cfg.bili.replyPerDay, 2)
    assert.deepEqual(cfg.bili.interests, [])

    const { writeFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    await writeFile(join(root, 'config.json'), JSON.stringify({
      bili: { scrollPerDay: 99, commentPerDay: -1, replyPerDay: 3, interests: ['人工智能', '  ', '独立游戏', 'x'.repeat(40)] },
    }), 'utf8')
    const c2 = await loadConfig(root)
    assert.equal(c2.bili.scrollPerDay, 12)
    assert.equal(c2.bili.commentPerDay, 0)
    assert.equal(c2.bili.replyPerDay, 3)
    assert.equal(c2.bili.interests.length, 3, '空的被丢掉，长的被截到 12 字')
    assert.ok(c2.bili.interests.every((x) => x.length <= 12))
  })
})
