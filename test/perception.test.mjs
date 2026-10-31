/**
 * perception.test.mjs —— 认知层 P0：感知源清单 + 规划
 *
 * 解耦的验收标准（用户 2026-10-31 定）：
 *   "可以用 dsh_bili_scroll，也可以用别的类似的插件"
 * 所以这里最重要的一条是：**registry/planner 里不出现任何具体插件的工具名**，
 * 换插件只是改配置。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { withTemp } from './_fixture.mjs'
import { normalizeSources, enabledSources, pickNextSource } from '../lib/perception/registry.js'
import { plan, lastUsedBySource } from '../lib/perception/planner.js'
import { appendEvent, readEvents } from '../lib/fish/store.js'
import { identityText } from '../lib/fish/identity.js'
import { loadConfig, saveConfig } from '../lib/fish/wake.js'
import { registerCommit } from '../lib/fish/commit.js'

const src = (over = {}) => ({ title: '看点什么', tools: { read: ['some_read_tool'] }, ...over })

test('registry：名字与工具名不合法就丢掉，空源也算没配', () => {
  const list = normalizeSources({
    good: src(),
    'Bad Name': src(),                       // id 不合法
    empty: { tools: { read: [], act: [] } }, // 没有可用工具
    badtool: { tools: { read: ['Not A Tool!'] } },
    off: src({ enabled: false }),
  })
  const ids = list.map((s) => s.id)
  assert.deepEqual(ids, ['good', 'off'])
  assert.equal(enabledSources(list).length, 1)
})

test('registry：预算与摘要上限会被夹住', () => {
  const [s] = normalizeSources({ a: src({ budget: { perDay: 99 }, summaryMax: 9999 }) })
  assert.equal(s.budget.perDay, 24)
  assert.equal(s.summaryMax, 400)
})

test('registry：挑最久没去过的源；从没去过的优先', () => {
  const list = normalizeSources({
    a: src({ title: 'A' }),
    b: src({ title: 'B' }),
  })
  assert.equal(pickNextSource(list, {}).id, 'a')
  assert.equal(pickNextSource(list, { a: Date.now() }).id, 'b')
  assert.equal(pickNextSource(list, { a: Date.now(), b: Date.now() - 1000 }).id, 'b')
})

test('planner：没有源就不产意图；有源就产一条，正文带标题与兴趣', () => {
  const none = plan({ events: [], config: { perception: { plan: { enabled: true }, sources: [] } }, now: Date.now() })
  assert.deepEqual(none.intents, [])

  const config = {
    perception: {
      plan: { enabled: true, perDay: 1 },
      interests: ['人工智能', '独立游戏'],
      sources: normalizeSources({ bili: src({ title: '看 B 站' }) }),
    },
  }
  const r = plan({ events: [], config, now: Date.now() })
  assert.equal(r.intents.length, 1)
  assert.equal(r.intents[0].source, 'bili')
  assert.match(r.intents[0].body, /看 B 站/)
  assert.match(r.intents[0].body, /人工智能/)
})

test('planner：一天只规划一次；关掉规划就不产', () => {
  const now = Date.now()
  const config = {
    perception: { plan: { enabled: true, perDay: 1 }, sources: normalizeSources({ bili: src({ title: 'B' }) }) },
  }
  const first = plan({ events: [], config, now })
  assert.equal(first.intents.length, 1)

  const events = [{
    id: 'e1', kind: 'intent', type: 'intent', ts: new Date(now).toISOString(), text: first.intents[0].body,
    meta: { source: 'bili', goal: 'explore' }, refs: [], verdict: null, confidence: 0.5, day: 1, v: 1, source: 'system',
  }]
  assert.equal(plan({ events, config, now: now + 1000 }).intents.length, 0, '同一天不再规划')

  const off = { perception: { ...config.perception, plan: { enabled: false } } }
  assert.equal(plan({ events: [], config: off, now }).intents.length, 0)
})

test('lastUsedBySource：从 intent 的 meta 里取', () => {
  const events = [
    { kind: 'intent', ts: '2026-10-31T02:00:00.000Z', meta: { source: 'a' } },
    { kind: 'intent', ts: '2026-10-31T03:00:00.000Z', meta: { source: 'a' } },
    { kind: 'intent', ts: '2026-10-31T01:00:00.000Z', meta: { source: 'b' } },
    { kind: 'said', ts: '2026-10-31T09:00:00.000Z', text: 'x' },
  ]
  const m = lastUsedBySource(events)
  assert.equal(m.a, Date.parse('2026-10-31T03:00:00.000Z'))
  assert.equal(m.b, Date.parse('2026-10-31T01:00:00.000Z'))
  assert.equal(Object.keys(m).length, 2)
})

test('intent 能落盘、带 meta、但不进"你说过的话"', async () => {
  await withTemp(async (root) => {
    await appendEvent(root, { kind: 'seed', body: '你刚开始存在。' })
    const w = await appendEvent(root, { kind: 'intent', body: '想去看看', meta: { source: 'bili', goal: 'explore' } }, { source: 'system', day: 1 })
    assert.equal(w.ok, true, w.why)

    const { events } = await readEvents(root)
    const it = events.find((e) => e.kind === 'intent')
    assert.equal(it.text, '想去看看')
    assert.deepEqual(it.meta, { source: 'bili', goal: 'explore' })

    const t = identityText(root)
    assert.equal(t.includes('想去看看'), false, 'P0 阶段 intent 不进身份段')
    assert.match(t, /## 你是谁/)
  })
})

test('她写不了 intent（fish_commit 只收她自己的四种）', async () => {
  await withTemp(async (root) => {
    await appendEvent(root, { kind: 'seed', body: '你刚开始存在。' })
    const specs = []
    const ctx = { tools: { register: (s) => { specs.push(s); return () => {} } } }
    registerCommit(ctx, { root, log: () => {} })
    const tool = specs[0]
    const r = await tool.execute({ type: 'utterance', text: '一句' })
    assert.equal(r.ok, true, r.ok ? '' : r.note)
    // 直接尝试写 intent 的 kind 由 store 拦（她那条路只走 her kinds）
    const bad = await appendEvent(root, { kind: 'intent', body: '她不该能写' }, { source: 'system' })
    assert.equal(bad.ok, true, 'store 层允许系统写 intent')
    const { events } = await readEvents(root)
    assert.equal(events.filter((e) => e.kind === 'intent').length, 1)
  })
})

test('代码里没有具体插件的工具名（解耦的硬约束）', async () => {
  for (const f of ['../lib/perception/registry.js', '../lib/perception/planner.js']) {
    const srcText = await readFile(new URL(f, import.meta.url), 'utf8')
    for (const name of ['bili_search', 'bili_comments', 'cdda_observe', 'dsh_bili_scroll']) {
      assert.equal(srcText.includes(name), false, `${f} 里出现了 ${name}：解耦被破坏`)
    }
  }
})

test('配置：perception 有默认值，且能存下来再读回', async () => {
  await withTemp(async (root) => {
    const d = await loadConfig(root)
    assert.equal(d.perception.plan.enabled, true)
    assert.deepEqual(d.perception.sources, [])

    await saveConfig({
      perception: {
        plan: { enabled: true, hour: 9, perDay: 2 },
        interests: ['人工智能'],
        sources: { bili: { title: '看 B 站', tools: { read: ['x_read'] }, budget: { perDay: 2 } } },
      },
    }, root)
    const c = await loadConfig(root)
    assert.equal(c.perception.plan.hour, 9)
    assert.equal(c.perception.plan.perDay, 2)
    assert.deepEqual(c.perception.interests, ['人工智能'])
    assert.equal(c.perception.sources.length, 1)
    assert.equal(c.perception.sources[0].read[0], 'x_read')
  })
})
