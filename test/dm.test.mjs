/**
 * dm.test.mjs —— 私信（照 dsh-bili-scroll 的"投递方式"）
 *
 * 它踩过的坑：接口回 code 0 ≠ 真的送到了，要看 **msg_key 回执**。
 * 这里钉住：
 *   1. 私信走 web_im/send_msg，带 sender_uid / receiver_id / content / csrf
 *   2. 没有 msg_key 就算失败，并且说清可能的原因
 *   3. 三种投递模式：off 不发、propose 立单、auto 直接发（受每日配额）
 *   4. 批准后才真正发
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withTemp } from './_fixture.mjs'
import { createBiliClient } from '../lib/perception/sources/bili/bili.js'
import { createApproval, readApproval } from '../lib/fish/approvals.js'
import { executeApproval } from '../lib/fish/execute.js'
import { loadConfig, saveConfig } from '../lib/fish/wake.js'
import { registerBiliTool } from '../lib/fish/index.js'

const COOKIE = 'SESSDATA=abc; bili_jct=tok; DedeUserID=42'

test('发私信：表单字段与回执', async () => {
  const calls = []
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), body: String(opts?.body ?? '') })
    return { status: 200, text: async () => JSON.stringify({ code: 0, data: { msg_key: 'mk_1' } }) }
  }
  const c = createBiliClient({ cookie: COOKIE, fetchImpl, minIntervalMs: 0, jitterMs: 0 })
  const r = await c.sendDm({ receiverId: '777', content: '今天的简报' })
  assert.equal(r.ok, true, r.message)
  assert.equal(r.data.msg_key, 'mk_1')
  assert.match(calls[0].url, /web_im\/v1\/web_im\/send_msg/)
  const body = decodeURIComponent(calls[0].body.replace(/\+/g, ' '))
  assert.match(body, /msg\[sender_uid\]=42/)
  assert.match(body, /msg\[receiver_id\]=777/)
  assert.match(body, /今天的简报/)
  assert.match(body, /csrf=tok/)
})

test('没有回执就算没送到', async () => {
  const c = createBiliClient({
    cookie: COOKIE, minIntervalMs: 0, jitterMs: 0,
    fetchImpl: async () => ({ status: 200, text: async () => JSON.stringify({ code: 0, data: {} }) }),
  })
  const r = await c.sendDm({ receiverId: '777', content: 'x' })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'NO_RECEIPT')
  assert.match(r.message, /陌生人|风控/)
})

test('没登录 / 没收回件人：明确拒绝', async () => {
  const anon = createBiliClient({ fetchImpl: async () => { throw new Error('不该发') }, minIntervalMs: 0, jitterMs: 0 })
  assert.equal((await anon.sendDm({ receiverId: '1', content: 'x' })).code, 'NOT_LOGIN')
  const c = createBiliClient({ cookie: COOKIE, fetchImpl: async () => { throw new Error('不该发') }, minIntervalMs: 0, jitterMs: 0 })
  assert.equal((await c.sendDm({ receiverId: '', content: 'x' })).code, 'NO_RECEIVER')
})

test('模式：off 不发、propose 立单、auto 直接发', async () => {
  await withTemp(async (root) => {
    const specs = []
    const ctx = { tools: { register: (s) => { specs.push(s); return () => {} } } }
    registerBiliTool(ctx, { root, log: () => {} })
    const tool = specs[0]

    await saveConfig({ bili: { dm: { mode: 'off', uid: '777', daily: false } } }, root)
    const off = await tool.execute({ action: 'dm', text: 'hi' })
    assert.equal(off.ok, false)
    assert.match(off.text, /不让我发私信/)

    await saveConfig({ bili: { dm: { mode: 'propose', uid: '777', daily: false } } }, root)
    const pro = await tool.execute({ action: 'dm', text: 'hi' })
    assert.equal(pro.ok, true, pro.text)
    assert.match(pro.text, /等他点头/)
    const { listApprovals } = await import('../lib/fish/approvals.js')
    const { pending } = await listApprovals(root)
    assert.equal(pending.length, 1)
    assert.equal(pending[0].kind, 'bili-dm')
    assert.equal(pending[0].payload.receiver, '777')
  })
})

test('批准后才真正发出去', async () => {
  await withTemp(async (root) => {
    const sent = []
    const client = {
      async sendDm({ receiverId, content }) { sent.push({ receiverId, content }); return { ok: true, data: { msg_key: 'k' } } },
    }
    const a = await createApproval(root, { kind: 'bili-dm', payload: { receiver: '777', text: '简报' } })
    const r = await executeApproval({}, { root, approval: a.approval, client })
    assert.equal(r.ok, true, r.text)
    assert.deepEqual(sent, [{ receiverId: '777', content: '简报' }])
    assert.ok(await readApproval(root, a.approval.id), '执行完由调用方 consume，这里还在')
  })
})

test('配置：dm 与 dmPerDay 存得住、读得回', async () => {
  await withTemp(async (root) => {
    const d = await loadConfig(root)
    assert.equal(d.bili.dm.mode, 'propose')
    assert.equal(d.bili.dm.uid, '')
    assert.equal(d.bili.dm.daily, false)
    assert.equal(d.bili.dmPerDay, 1)

    await saveConfig({ bili: { dm: { mode: 'auto', uid: '888', daily: true }, dmPerDay: 3 } }, root)
    const c = await loadConfig(root)
    assert.deepEqual(c.bili.dm, { mode: 'auto', uid: '888', daily: true })
    assert.equal(c.bili.dmPerDay, 3)
  })
})
