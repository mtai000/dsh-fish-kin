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
import { join } from 'node:path'
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
    // P2 起：intent 有自己的小节，但**不进「你说过的话」**
    const said = (t.split('## 你说过的话')[1] ?? '').split('## ')[0]
    assert.equal(said.includes('想去看看'), false, 'intent 不能混进她说的话')
    assert.match(t, /## 最近想弄明白/)
    assert.match(t, /想去看看/)
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

test('P1：内建 B 站默认不挂，只有 adapter=builtin 才挂', async () => {
  const { shouldRegisterBuiltinBili } = await import('../lib/fish/index.js')
  assert.equal(shouldRegisterBuiltinBili({}), false)
  assert.equal(shouldRegisterBuiltinBili({ perception: { sources: [] } }), false)
  assert.equal(shouldRegisterBuiltinBili({
    perception: { sources: [{ id: 'x', adapter: 'external', enabled: true }] },
  }), false)
  assert.equal(shouldRegisterBuiltinBili({
    perception: { sources: [{ id: 'x', adapter: 'builtin', enabled: true }] },
  }), true)
  assert.equal(shouldRegisterBuiltinBili({
    perception: { sources: [{ id: 'x', adapter: 'builtin', enabled: false }] },
  }), false)
})

test('P1：没挂内建 B 站时，身份段不再提 fish_bili', async () => {
  await withTemp(async (root) => {
    await appendEvent(root, { kind: 'seed', body: '你刚开始存在。' })
    assert.equal(identityText(root).includes('fish_bili'), false)

    // 配置里显式打开 builtin 才出现
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(root, { recursive: true })
    await writeFile(`${root}/config.json`, JSON.stringify({
      perception: { sources: { bili: { adapter: 'builtin', tools: { read: ['read_tool'], act: ['act_tool'] } } } },
    }), 'utf8')
    assert.equal(identityText(root).includes('fish_bili'), true)
  })
})

test('P1：builtin 源不需要列工具名也能保留', async () => {
  const list = normalizeSources({ bili: { adapter: 'builtin' } })
  assert.equal(list.length, 1)
  assert.equal(list[0].adapter, 'builtin')
  assert.equal(list[0].read.length, 0)
})

test('P2：derive 认识 intent / perceived', async () => {
  const { derive } = await import('../lib/fish/derive.js')
  const E = (kind, text, meta) => ({ id: kind + text, kind, type: kind, text, meta, ts: new Date().toISOString(), refs: [], verdict: null, confidence: 0.5, day: 1, v: 1, source: 'system' })
  const m = derive([
    E('seed', '你刚开始存在。'),
    E('intent', '想去看看', { source: 'a' }),
    E('perceived', '看到一条视频', { source: 'a', ref: 'BV1' }),
  ])
  assert.equal(m.intentCount, 1)
  assert.equal(m.perceivedCount, 1)
  assert.equal(m.intents[0].text, '想去看看')
  assert.equal(m.perceived[0].meta.ref, 'BV1')
})

test('P2：身份段两小节最多三条，多的折一行', async () => {
  await withTemp(async (root) => {
    await appendEvent(root, { kind: 'seed', body: '你刚开始存在。' })
    for (let i = 0; i < 5; i++) {
      await appendEvent(root, { kind: 'intent', body: `想去看看第 ${i} 个地方`, meta: { source: 'a' } })
      await appendEvent(root, { kind: 'perceived', body: `看到了第 ${i} 条东西`, meta: { source: 'a' } })
    }
    const t = identityText(root)
    const section = (title) => (t.split(`## ${title}`)[1] ?? '').split('## ')[0]
    const intents = section('最近想弄明白').split('\n').filter((l) => l.startsWith('- '))
    const seen = section('最近看到').split('\n').filter((l) => l.startsWith('- '))
    assert.equal(intents.length, 4, '三条 + 一行折叠')
    assert.equal(seen.length, 4)
    assert.match(intents[3], /更早还有 2 条/)
  })
})

test('P2：观测台能看到认知小节与感知源', async () => {
  await withTemp(async (root) => {
    await appendEvent(root, { kind: 'seed', body: '你刚开始存在。' })
    await appendEvent(root, { kind: 'intent', body: '想去看看', meta: { source: 'a' } })
    await appendEvent(root, { kind: 'perceived', body: '看到一条', meta: { source: 'a', ref: 'R1' } })
    await saveConfig({ perception: { sources: { a: { title: '某来源', tools: { read: ['read_tool'] } } } } }, root)

    const { fishState } = await import('../lib/fish/observe.js')
    const s = await fishState(root, {})
    assert.equal(s.perception.intents.length, 1)
    assert.equal(s.perception.perceived[0].ref, 'R1')
    assert.equal(s.perception.sources[0].id, 'a')
    assert.equal(s.perception.sources[0].adapter, 'external')
  })
})

test('P3：fish_ask 只给声明过的行动立单', async () => {
  const { registerAskTool } = await import('../lib/perception/ask.js')
  const { listApprovals } = await import('../lib/fish/approvals.js')
  await withTemp(async (root) => {
    const specs = []
    const ctx = { tools: { register: (s) => { specs.push(s); return () => {} } } }
    const sources = normalizeSources({
      bili: { title: '看 B 站', tools: { read: ['read_a'], act: ['act_a'] } },
    })
    registerAskTool(ctx, { root, sources, log: () => {} })
    const tool = specs[0]

    const bad = await tool.execute({ action: 'request', tool: 'rm_rf' })
    assert.equal(bad.ok, false)
    assert.match(bad.note, /我不能做这件事/)

    const ok = await tool.execute({ action: 'request', tool: 'act_a', why: '想说一句', args: { text: 'hi' } })
    assert.equal(ok.ok, true, ok.note)
    const { pending } = await listApprovals(root)
    assert.equal(pending.length, 1)
    assert.equal(pending[0].kind, 'source-act')
    assert.equal(pending[0].payload.tool, 'act_a')
    assert.deepEqual(pending[0].payload.args, { text: 'hi' })

    const check = await tool.execute({ action: 'check' })
    assert.match(check.note, /看 B 站/)
  })
})

test('P3：读类直接放行，行动类要通行证且一次用掉', async () => {
  const { registerRestrict } = await import('../lib/fish/restrict.js')
  const { createApproval, decideApproval } = await import('../lib/fish/approvals.js')
  const { grantFromApproval, findGrantSync } = await import('../lib/perception/grants.js')
  await withTemp(async (root) => {
    const calls = { guard: [] }
    let onCreated = null
    const ctx = { on: (name, fn) => { if (name === 'agent/created') onCreated = fn; return () => {} } }
    registerRestrict(ctx, { root, allow: ['read_a'], act: ['act_a'], log: () => {} })

    const fakeAgent = {
      session: { header: { cwd: join(root, 'home'), id: 's1' }, id: 's1' },
      ctx: {
        tools: { restrict: () => () => {}, guard: (fn) => { calls.guard.push(fn); return () => {} } },
        effect: () => {},
      },
    }
    onCreated({ agent: fakeAgent })
    const guard = calls.guard[0]

    assert.equal(guard({ name: 'read_a' }), undefined, '读类不需要许可')
    assert.match(guard({ name: 'act_a' }), /先问他一声/, '没有许可就拦')

    const made = await createApproval(root, { kind: 'source-act', payload: { source: 'bili', tool: 'act_a', args: {} } })
    const dec = await decideApproval(root, made.approval.id, { verdict: 'approve' })
    await grantFromApproval(root, dec.approval)
    assert.ok(findGrantSync(root, 'act_a'))

    assert.equal(guard({ name: 'act_a' }), undefined, '有许可就放行')
    assert.equal(findGrantSync(root, 'act_a'), null, '放行后许可被用掉')
    assert.match(guard({ name: 'act_a' }), /先问他一声/, '第二次要重新立单')
  })
})

test('P3：批准 source-act = 发通行证（单子留着，守卫用一次）', async () => {
  const { createApproval, decideApproval, readApproval } = await import('../lib/fish/approvals.js')
  const { executeApproval } = await import('../lib/fish/execute.js')
  const { findGrantSync } = await import('../lib/perception/grants.js')
  await withTemp(async (root) => {
    const made = await createApproval(root, { kind: 'source-act', title: 'x：act_a', payload: { source: 'x', tool: 'act_a', args: {} } })
    const dec = await decideApproval(root, made.approval.id, { verdict: 'approve' })
    assert.equal(dec.ok, true)

    const r = await executeApproval({}, { root, approval: dec.approval })
    assert.equal(r.ok, true, r.text)
    assert.match(r.text, /通行证/)
    assert.ok(await readApproval(root, made.approval.id), '单子要留着当通行证')
    assert.ok(findGrantSync(root, 'act_a'))
  })
})

test('P4：接外部源只写配置，本仓库不出现那个插件的代码', async () => {
  const { linkSource, listSources } = await import('../lib/perception/link.js')
  await withTemp(async (root) => {
    const r = await linkSource(root, { id: 'cdda', title: '去游戏里走走', read: 'observe_game', act: 'move_in_game', budget: 1 })
    assert.equal(r.ok, true, r.why)
    assert.equal(r.source.adapter, 'external')
    assert.deepEqual(r.source.read, ['observe_game'])
    assert.deepEqual(r.source.act, ['move_in_game'])
    assert.equal(r.source.budget.perDay, 1)

    const list = await listSources(root)
    assert.equal(list.length, 1)
    assert.equal(list[0].id, 'cdda')

    // 校验拦得住空源
    const bad = await linkSource(root, { id: 'x', read: [], act: [] })
    assert.equal(bad.ok, false)
  })
})
