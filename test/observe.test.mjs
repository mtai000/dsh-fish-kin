/**
 * observe.test.mjs —— 观测台（只读）
 *
 * 它要能回答三个救命问题：
 *   1. 她这一轮**实际看到**的身份段是什么（原文）
 *   2. 哪些话摆出来、哪些被折了（折叠是渲染层的判断，得能核对）
 *   3. 工具面收窄挂没挂、守卫挡了几次
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withTemp } from './_fixture.mjs'
import { appendEvent } from '../lib/fish/store.js'
import { fishState, registerObserve, PREFIX } from '../lib/fish/observe.js'

const distinct = [
  '我不想再看那种让人难受的东西了',
  '我宁可说得难听，也不说好听的假话',
  '沉默也会伤人，我后来才明白',
  '我不替别人决定他该怎么活',
  '今天的天很闷，我什么也没做',
  '我不喜欢被人安排好的时间',
]

async function seed(root) {
  await appendEvent(root, { kind: 'seed', body: '你刚开始存在。' })
  for (const t of distinct) await appendEvent(root, { kind: 'said', body: t })
  await appendEvent(root, { kind: 'refuse', body: '我不做这个' })
  await appendEvent(root, { kind: 'diary', body: '今天有点累' })
  await appendEvent(root, { kind: 'note', body: 'bili-look:BV1xx411c7mD' })
}

test('状态：身份原文、记忆折叠、最近的事、B站', async () => {
  await withTemp(async (root) => {
    await seed(root)
    const s = await fishState(root, {
      tools: { ok: true, allow: ['fish_commit', 'fish_bili'], guard: true, blocked: 3, why: '' },
      guard: { rejects: 1, selfMod: 0 },
    })
    assert.equal(s.ok, true)
    assert.equal(s.day, 1)
    assert.equal(s.counts.events, 10)
    assert.equal(s.counts.beliefs, 6)
    assert.equal(s.counts.refusals, 1)
    assert.equal(s.counts.diaries, 1)

    // 她实际看到的身份段
    assert.match(s.identity, /## 你是谁/)
    assert.match(s.identity, /fish_commit/)

    // 记忆：最多 4 条摆出来 + 折叠行
    assert.ok(s.memory.shown.length <= 4)
    assert.match(s.memory.folded, /记不清原话/)
    assert.equal(s.memory.totalBeliefs, 6)

    // 工具面与守卫
    assert.equal(s.tools.ok, true)
    assert.deepEqual(s.tools.allow, ['fish_commit', 'fish_bili'])
    assert.equal(s.tools.blocked, 3)
    assert.equal(s.guard.rejects, 1)

    // 最近的事是倒序，且第一条是最后写的那条
    assert.equal(s.recent[0].kind, 'note')
    assert.ok(s.recent.length <= 20)

    // B站看过什么
    assert.equal(s.bili.length, 1)
    assert.match(s.bili[0].text, /BV1xx411c7mD/)
  })
})

test('观测台路由：页面 + JSON', async () => {
  await withTemp(async (root) => {
    await seed(root)
    const registered = []
    const ctx = { get: () => ({ register: (ex) => { registered.push(ex); return () => { registered[0].disposed = true } } }) }
    const off = registerObserve(ctx, { root, state: { tools: { ok: true, allow: ['fish_commit'], guard: true, blocked: 0, why: '' }, guard: { rejects: 0, selfMod: 0 } }, log: () => {} })
    assert.equal(registered.length, 1)
    assert.equal(registered[0].kind, 'prefix')
    assert.equal(registered[0].path, PREFIX)

    const call = async (url) => {
      const res = { code: 0, headers: {}, body: '', writeHead(c, h) { this.code = c; Object.assign(this.headers, h || {}) }, end(b) { this.body += String(b ?? '') } }
      await registered[0].handler({ url, method: 'GET' }, res)
      return res
    }
    const page = await call(PREFIX + '/')
    assert.equal(page.code, 200)
    assert.match(page.body, /观测台/)
    assert.match(page.body, /她这一轮实际看到的身份段/)

    const api = await call(PREFIX + '/api/state')
    assert.equal(api.code, 200)
    const json = JSON.parse(api.body)
    assert.equal(json.ok, true)
    assert.equal(json.counts.events, 10)

    const nope = await call(PREFIX + '/api/nope')
    assert.equal(nope.code, 404)

    off()
  })
})

test('没有 webServer：不注册也不抛', () => {
  const off = registerObserve({}, { root: '/x' })
  assert.equal(typeof off, 'function')
  off()
})
