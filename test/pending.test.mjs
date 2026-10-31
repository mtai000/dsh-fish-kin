/**
 * pending.test.mjs —— 待批准的生育请求
 *
 * 这一层是「主人点头」的物证。它要守住的性质：
 *   1. 请求单里存的是**当时那份**遗传包（批准时不许悄悄重新蒸馏）
 *   2. 批准/驳回都留痕（decisions.jsonl 只追加）
 *   3. 过期就是过期，不留一张永远能批的死单子
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequest, listRequests, readRequest, decide, consume, readDecisions, TTL_MS } from '../lib/pending.js'
import { withTemp } from './_fixture.mjs'

const pack = (body = '## 她认定过的事\n- 我不想再看那种让人难受的东西了') => ({
  body, chars: body.length, limit: 1500,
  picked: [{ text: '我不想再看那种让人难受的东西了', kind: 'utterance', score: 2.1, reasons: ['被提起 3 次'] }],
})

test('立单：落盘、能读到、内容原样', async () => {
  await withTemp(async (kin) => {
    const r = await createRequest(kin, { trigger: 'her', note: '她想留个接得住的人', pack: pack(), name: '梦尘', tools: ['skill'] })
    assert.equal(r.ok, true)
    assert.match(r.id, /^req_[0-9A-Z]{26}$/)

    const got = await readRequest(kin, r.id)
    assert.equal(got.pack.body, pack().body)
    assert.equal(got.trigger, 'her')
    assert.equal(got.name, '梦尘')

    const { requests } = await listRequests(kin)
    assert.equal(requests.length, 1)
  })
})

test('没有包就不立单', async () => {
  await withTemp(async (kin) => {
    const r = await createRequest(kin, { pack: { body: '' } })
    assert.equal(r.ok, false)
  })
})

test('驳回：留痕 + 单子消失', async () => {
  await withTemp(async (kin) => {
    const r = await createRequest(kin, { pack: pack() })
    const d = await decide(kin, r.id, { verdict: 'reject', by: 'owner', why: '再等等' })
    assert.equal(d.ok, true)
    assert.equal(await readRequest(kin, r.id), null)
    const { requests } = await listRequests(kin)
    assert.equal(requests.length, 0)
    const log = await readDecisions(kin)
    assert.equal(log[0].kind, 'reject')
    assert.equal(log[0].why, '再等等')
  })
})

test('批准：决定进账本，单子等调用方 consume', async () => {
  await withTemp(async (kin) => {
    const r = await createRequest(kin, { pack: pack() })
    const d = await decide(kin, r.id, { verdict: 'approve', by: 'owner' })
    assert.equal(d.ok, true)
    assert.equal(d.request.id, r.id)
    // 还没 consume，单子仍然在（出生失败时不能把单子吃掉）
    assert.ok(await readRequest(kin, r.id))
    await consume(kin, r.id)
    assert.equal(await readRequest(kin, r.id), null)
  })
})

test('非法 verdict / 不存在的单子都拒绝', async () => {
  await withTemp(async (kin) => {
    assert.equal((await decide(kin, 'req_00000000000000000000000000', { verdict: 'approve' })).ok, false)
    const r = await createRequest(kin, { pack: pack() })
    assert.equal((await decide(kin, r.id, { verdict: 'maybe' })).ok, false)
  })
})

test('过期单子被清掉并留痕', async () => {
  await withTemp(async (kin) => {
    const now = Date.now()
    const r = await createRequest(kin, { pack: pack(), now, ttlMs: 60_000 })
    const later = await listRequests(kin, { now: now + 120_000 })
    assert.equal(later.requests.length, 0)
    assert.equal(later.expired, 1)
    assert.equal(await readRequest(kin, r.id), null)
    const log = await readDecisions(kin)
    assert.equal(log[0].kind, 'expire')
  })
})

test('默认寿命是一天', () => {
  assert.equal(TTL_MS, 24 * 60 * 60 * 1000)
})

test('id 不像请求单的不会被当文件路径读（防路径穿越）', async () => {
  await withTemp(async (kin) => {
    assert.equal(await readRequest(kin, '../../../etc/passwd'), null)
    assert.equal(await readRequest(kin, 'req_../../x'), null)
  })
})

test('过期的单子不能批（一天没人理，就不该按原样生）', async () => {
  await withTemp(async (kin) => {
    const now = Date.now()
    const r = await createRequest(kin, { pack: pack(), now, ttlMs: 60_000 })
    const d = await decide(kin, r.id, { verdict: 'approve', now: now + 120_000 })
    assert.equal(d.ok, false)
    assert.match(d.why, /过期/)
  })
})
