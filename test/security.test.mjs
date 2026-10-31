/**
 * security.test.mjs —— 工具面收窄 + 文字守卫
 *
 * 这是"她不能读自己的档、不能改自己"从**口头约定**变成**代码保证**的那一层：
 *   1. 她那条会话只看得见 fish_commit / fish_bili（fish_kin 不在里面，她不能自己批生育）
 *   2. 漏网的（own 层注册的 subagent 之类）由 guard 兜底拒绝
 *   3. 凭据（sk-/Bearer/SESSDATA/长 base64）写不进她的记忆
 *   4. 别人的会话一根手指都不碰
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { withTemp } from './_fixture.mjs'

const load = (f) => import(`../lib/fish/${f}`)

test('守卫：凭据认得出来，正常话不误伤', async () => {
  const { looksLikeSecret, scrub, looksLikeSelfRewrite } = await load('guard.js')
  assert.equal(looksLikeSecret('sk-abcdefghijklmnopqrstuvwx'), true)
  assert.equal(looksLikeSecret('Bearer eyJhbGciOiJIUzI1NiJ9.abcdef'), true)
  assert.equal(looksLikeSecret('SESSDATA=abc123def456ghi789'), true)
  assert.equal(looksLikeSecret('A'.repeat(120)), true)
  assert.equal(looksLikeSecret('我不想再看那种让人难受的东西了'), false)
  assert.equal(looksLikeSecret('今天有点累'), false)

  const s = scrub('我的 key 是 sk-abcdefghijklmnopqrstuvwx 别告诉别人')
  assert.equal(s.includes('abcdefghijklmnop'), false)
  assert.match(s, /sk-\*\*\*/)

  assert.equal(looksLikeSelfRewrite('你以后要更内向一点'), true)
  assert.equal(looksLikeSelfRewrite('把我改得温柔些'), true)
  assert.equal(looksLikeSelfRewrite('我今天想清楚了，我不愿意再那样做'), false)
})

test('她写凭据：进不去（工具直接拒绝）', async () => {
  const { registerCommit } = await load('commit.js')
  const { readEvents } = await load('store.js')
  await withTemp(async (root) => {
    const specs = []
    const ctx = { tools: { register: (s) => { specs.push(s); return () => {} } } }
    registerCommit(ctx, { root })
    const tool = specs[0]
    const r = await tool.execute({ type: 'utterance', text: '我的 token 是 Bearer abcdefghijklmnopqrst' })
    assert.equal(r.ok, false)
    assert.match(String(r.note), /凭据|没写进去/)
    const { events } = await readEvents(root)
    assert.equal(events.length, 0, '凭据不该落到事件流里')
  })
})

function fakeAgent(root, cwd = join(root, 'home')) {
  const calls = { restrict: [], guard: [], effects: [] }
  return {
    calls,
    agent: {
      session: { header: { cwd, id: 'sess-her' } },
      ctx: {
        tools: {
          restrict: (opts) => { calls.restrict.push(opts); return () => {} },
          guard: (fn) => { calls.guard.push(fn); return () => {} },
        },
        effect: (fn) => { calls.effects.push(fn) },
      },
    },
  }
}

test('收窄：她只留 fish_commit / fish_bili，fish_kin 不在里面', async () => {
  const { registerRestrict, HER_TOOLS } = await load('restrict.js')
  await withTemp(async (root) => {
    let onCreated = null
    const ctx = { on: (name, fn) => { if (name === 'agent/created') onCreated = fn; return () => {} } }
    registerRestrict(ctx, { root, log: () => {} })
    const { agent, calls } = fakeAgent(root)
    onCreated({ agent })

    assert.equal(calls.restrict.length, 1)
    const allow = calls.restrict[0].allow
    assert.deepEqual([...allow].sort(), ['fish_bili', 'fish_commit', 'read_image'], '抽帧/封面要能 read_image 才看得见')
    assert.equal(allow.includes('fish_kin'), false, '她不能自己批生育')
    assert.equal(allow.includes('fish_kin_ask_birth'), false)
    assert.equal(allow.includes('shell'), false)
    assert.equal(allow.includes('read'), false)
    assert.deepEqual([...HER_TOOLS].sort(), ['fish_bili', 'fish_commit'])
    assert.equal(allow.includes('read_image'), true)
    assert.equal(calls.guard.length, 1, '兜底守卫也要挂上')
  })
})

test('兜底守卫：清单外的调用被拒，清单内的放行', async () => {
  const { registerRestrict } = await load('restrict.js')
  await withTemp(async (root) => {
    let onCreated = null
    const ctx = { on: (name, fn) => { if (name === 'agent/created') onCreated = fn; return () => {} } }
    registerRestrict(ctx, { root, log: () => {} })
    const { agent, calls } = fakeAgent(root)
    onCreated({ agent })
    const guard = calls.guard[0]
    assert.equal(guard({ name: 'fish_commit' }), undefined)
    assert.equal(guard({ name: 'fish_bili' }), undefined)
    assert.equal(guard({ name: 'fish_kin' }), '这件事我做不到。')
    assert.equal(guard({ name: 'shell' }), '这件事我做不到。')
    assert.equal(guard({ name: 'subagent' }), '这件事我做不到。')
  })
})

test('收窄：别人的会话不动', async () => {
  const { registerRestrict } = await load('restrict.js')
  await withTemp(async (root) => {
    let onCreated = null
    const ctx = { on: (name, fn) => { if (name === 'agent/created') onCreated = fn; return () => {} } }
    registerRestrict(ctx, { root, log: () => {} })
    const { agent, calls } = fakeAgent(root, join(root, 'somewhere-else'))
    onCreated({ agent })
    assert.equal(calls.restrict.length, 0)
    assert.equal(calls.guard.length, 0)
  })
})

test('收窄：名字不认识时退回核心清单，而不是整段失效', async () => {
  const { registerRestrict } = await load('restrict.js')
  await withTemp(async (root) => {
    let onCreated = null
    const ctx = { on: (name, fn) => { if (name === 'agent/created') onCreated = fn; return () => {} } }
    const { agent } = fakeAgent(root)
    let attempt = 0
    agent.ctx.tools.restrict = (opts) => {
      attempt++
      if (attempt === 1) throw new Error('unknown tool name')
      return () => {}
    }
    registerRestrict(ctx, { root, allow: ['不存在的工具'], log: () => {} })
    onCreated({ agent })
    assert.equal(attempt, 2, '第一次失败后要用核心清单再试一次')
  })
})

test('她的身份段只念她真有的工具', async () => {
  const { identityText } = await load('identity.js')
  const { appendEvent } = await load('store.js')
  await withTemp(async (root) => {
    await appendEvent(root, { kind: 'seed', body: '你刚开始存在。' })
    const t = identityText(root)
    assert.match(t, /fish_commit/)
    assert.equal(t.includes('shell'), false)
  })
})

test('启动时就把收窄挂上去（接线不能漏）', async () => {
  const { bootFish } = await load('index.js')
  await withTemp(async (root) => {
    const calls = []
    const handlers = {}
    const ctx = {
      tools: { register: () => () => {} },
      on: (name, fn) => { (handlers[name] = handlers[name] ?? []).push(fn); return () => {} },
      get: () => null,
    }
    const fish = bootFish(ctx, { root, log: () => {} })
    await new Promise((r) => setTimeout(r, 50))
    // 冒充她的 agent
    const agent = {
      session: { header: { cwd: join(root, 'home'), id: 'sess-her' } },
      ctx: {
        tools: {
          restrict: (o) => { calls.push(o); return () => {} },
          guard: () => () => {},
        },
        effect: () => {},
      },
    }
    for (const fn of handlers['agent/created'] ?? []) fn({ agent })
    assert.equal(calls.length, 1, '启动时应该已经挂了 agent/created 监听')
    assert.deepEqual([...calls[0].allow].sort(), ['fish_bili', 'fish_commit', 'read_image'])
    fish.dispose()
  })
})
