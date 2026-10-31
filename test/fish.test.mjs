/**
 * fish.test.mjs —— 自研的这条鱼：事件流、身份、写入、屋子、唤醒、B站客户端
 *
 * 这里守的是"她真的能活"的最小集合：
 *   1. 只能追加，不能改；改口必须指回真实事件
 *   2. 身份段只写事实（第几天、称呼、她说过什么），不写人格形容词
 *   3. 她的工具只能写 HER_TYPES，且不回显状态
 *   4. 屋子/唤醒在没有宿主服务时明确失败，不假装成功
 *   5. B 站客户端：串行、风控熔断、永不抛（用假 fetch）
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { withTemp } from './_fixture.mjs'

const NL = String.fromCharCode(10)
const load = (f) => import(`../lib/fish/${f}`)

test('事件流：只能追加；revise 必须指回真实 id', async () => {
  const { withTemp: wt } = await import('./_fixture.mjs')
  const { appendEvent, readEvents, paths } = await load('store.js')
  await wt(async (root) => {
    const a = await appendEvent(root, { type: 'utterance', text: '我不想再看那种东西了' })
    assert.equal(a.ok, true)
    assert.match(a.event.id, /^fe_[0-9A-Z]{26}$/)

    const badType = await appendEvent(root, { type: '人格设定', text: '温柔' })
    assert.equal(badType.ok, false)

    const empty = await appendEvent(root, { type: 'utterance', text: '   ' })
    assert.equal(empty.ok, false)

    const noRef = await appendEvent(root, { type: 'revise', text: '其实不是不在乎' })
    assert.equal(noRef.ok, false)

    const fakeRef = await appendEvent(root, { type: 'revise', text: '其实不是不在乎', refs: ['ev_不存在'] })
    assert.equal(fakeRef.ok, false)

    const good = await appendEvent(root, { type: 'revise', text: '其实不是不在乎', refs: [a.event.id], verdict: 'refined' })
    assert.equal(good.ok, true)

    const { events } = await readEvents(root)
    assert.equal(events.length, 2)
    // 原文还在，改口是新增的一条
    assert.equal(events[0].text, '我不想再看那种东西了')
    const raw = await readFile(paths(root).events, 'utf8')
    assert.equal(raw.trim().split(NL).length, 2)
  })
})

test('播种只播一次', async () => {
  const { ensureSeed, readEvents } = await load('store.js')
  await withTemp(async (root) => {
    const a = await ensureSeed(root)
    const b = await ensureSeed(root)
    assert.equal(a.created, true)
    assert.equal(b.created, false)
    const { events } = await readEvents(root)
    assert.equal(events.filter((e) => e.type === 'seed').length, 1)
  })
})

test('派生：第几天、称呼、判断、拒绝', async () => {
  const { appendEvent } = await load('store.js')
  const { derive } = await load('derive.js')
  await withTemp(async (root) => {
    await appendEvent(root, { type: 'seed', text: '你刚开始存在。' }, { now: Date.now() - 3 * 86400000 })
    await appendEvent(root, { type: 'utterance', text: '以后叫你梦尘吧' })
    await appendEvent(root, { type: 'refusal', text: '我不做这个' })
    const { events } = await import('../lib/fish/store.js').then((m) => m.readEvents(root))
    const m = derive(events)
    assert.equal(m.day, 4)
    assert.equal(m.name, '梦尘')
    assert.equal(m.beliefCount, 1)
    assert.equal(m.refusalCount, 1)
  })
})

test('身份段：只有事实，没有"你是一个…的人"', async () => {
  const { appendEvent } = await load('store.js')
  const { identityText } = await load('identity.js')
  await withTemp(async (root) => {
    await appendEvent(root, { type: 'seed', text: '你刚开始存在。' }, { now: Date.now() - 86400000 })
    await appendEvent(root, { type: 'meta', text: 'import-name:梦尘' }, { source: 'system' })
    await appendEvent(root, { type: 'utterance', text: '我不想再看那种东西了' })
    const t = identityText(root)
    assert.match(t, /## 你是谁/)
    assert.match(t, /你存在了 2 天/)
    assert.match(t, /你管那个人叫「梦尘」/)
    assert.match(t, /我不想再看那种东西了/)
    assert.doesNotMatch(t, /你(是|总是|一向)[^\n。]{0,10}的人/)
    assert.equal(/他(?!们)/.test(t), false, '文案里不该有男字旁的他')
  })
})

test('她的工具：只写 HER_TYPES，且不回显状态', async () => {
  const { registerCommit } = await load('commit.js')
  const { readEvents } = await load('store.js')
  await withTemp(async (root) => {
    const specs = []
    const ctx = { tools: { register: (s) => { specs.push(s); return () => {} } } }
    registerCommit(ctx, { root })
    const tool = specs[0]
    assert.equal(tool.name, 'fish_commit')

    const ok = await tool.execute({ type: 'utterance', text: '我想说一句' })
    assert.equal(ok.ok, true)
    assert.doesNotMatch(String(ok.note), /[0-9]/)

    const bad = await tool.execute({ type: 'seed', text: '偷偷改自己' })
    assert.equal(bad.ok, false)

    const { events } = await readEvents(root)
    assert.equal(events.length, 1)
  })
})

test('屋子：没有 sessionController 就明确失败', async () => {
  const { ensureHome } = await load('home.js')
  await withTemp(async (root) => {
    const r = await ensureHome({}, { root })
    assert.equal(r.ok, false)
    assert.match(r.why, /sessionController/)
  })
})

test('屋子：建一次、写进 home.json、第二次复用', async () => {
  const { ensureHome } = await load('home.js')
  await withTemp(async (root) => {
    let created = 0
    const sc = {
      async list() { return [{ sessionId: 'session-1' }] },
      async create() { created++; return { sessionId: 'session-1' } },
      async rename() {},
    }
    const ctx = { get: (k) => (k === 'sessionController' ? sc : null) }
    const a = await ensureHome(ctx, { root })
    assert.equal(a.ok, true)
    assert.equal(created, 1)
    const b = await ensureHome(ctx, { root })
    assert.equal(b.ok, true)
    assert.equal(b.reused, true)
    assert.equal(created, 1)
    const saved = JSON.parse(await readFile(join(root, 'home.json'), 'utf8'))
    assert.equal(saved.sessionId, 'session-1')
  })
})

test('唤醒：只给处境，不给任务清单', async () => {
  const { wakeText, slotsFor, loadConfig } = await load('wake.js')
  const t = wakeText({ day: 5, beliefCount: 0, lastAt: '' }, {})
  assert.match(t, /你醒了/)
  assert.equal(/写日记|想一想|你应该/.test(t), false)

  const cfg = await loadConfig('/不存在的目录')
  const slots = slotsFor(cfg)
  assert.equal(slots.length, cfg.wake.perDay)
})

test('唤醒：到点才叫，叫过就记下来', async () => {
  const { wake, loadConfig } = await load('wake.js')
  await withTemp(async (root) => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(root, 'config.json'), JSON.stringify({ wake: { perDay: 1, window: ['00:00', '23:59'] } }), 'utf8')
    let prompted = 0
    const sc = {
      async list() { return [{ sessionId: 's1' }] },
      async create() { return { sessionId: 's1' } },
      async rename() {},
      async prompt() { prompted++ },
    }
    const ctx = { get: (k) => (k === 'sessionController' ? sc : null) }
    const first = await wake(ctx, { root })
    assert.equal(first.ok, true, first.why)
    assert.equal(prompted, 1)
    const second = await wake(ctx, { root })
    assert.equal(second.skipped, true)
    assert.equal(prompted, 1)
    const cfg = await loadConfig(root)
    assert.equal(cfg.wake.perDay, 1)
  })
})

test('B站：串行调用、风控熔断、永不抛（假 fetch）', async () => {
  const { createBiliClient } = await load('bili.js')
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    if (String(url).includes('finger/spi')) {
      return { json: async () => ({ data: { b_3: 'b3', b_4: 'b4' } }), text: async () => '{}', status: 200 }
    }
    if (String(url).includes('/x/web-interface/popular')) {
      return {
        status: 200,
        json: async () => ({}),
        text: async () => JSON.stringify({ code: 0, data: { list: [{ bvid: 'BV1xx', title: '标题', owner: { name: 'UP' }, stat: { view: 10 }, duration: 5 }] } }),
      }
    }
    return { status: 200, json: async () => ({}), text: async () => JSON.stringify({ code: -412, message: '请求被拦截' }) }
  }
  const c = createBiliClient({ fetchImpl, minIntervalMs: 0, jitterMs: 0 })
  const pop = await c.popular(3)
  assert.equal(pop.ok, true)
  assert.equal(pop.data[0].title, '标题')
  assert.equal(pop.data[0].bvid, 'BV1xx')

  const bad = await c.view('BVbad')
  assert.equal(bad.ok, false)
  assert.equal(bad.code, -412)
  assert.equal(c.cooling(), true, '风控之后应该进冷却')

  const blocked = await c.popular(1)
  assert.equal(blocked.ok, false)
  assert.equal(blocked.code, 'COOLDOWN')
})

test('刚出生被叫醒：不提"上次说话"（还没说过）', async () => {
  const { wakeText } = await load('wake.js')
  const t = wakeText({ day: 1, beliefCount: 0, lastAt: new Date().toISOString() }, { lastAt: '' })
  assert.equal(/上次说话/.test(t), false)
  const t2 = wakeText({ day: 3, beliefCount: 2, lastAt: new Date(Date.now() - 7200_000).toISOString() }, { lastAt: new Date(Date.now() - 7200_000).toISOString() })
  assert.match(t2, /上次说话/)
})

test('搬家：dsh-fish 的旧档 → 我们的格式（判断保留，其余降级成 note）', async () => {
  const { convert } = await load('import.js')
  const NL2 = String.fromCharCode(10)
  const old = [
    { id: 'ev_1', type: 'seed', text: '你刚开始存在。', ts: '2026-10-30T00:00:00.000Z', day: 1 },
    { id: 'ev_2', type: 'utterance', text: '我不想再看那种东西了', ts: '2026-10-30T01:00:00.000Z', day: 1 },
    { id: 'ev_3', type: 'narration', text: '我变成了另一个样子', ts: '2026-10-30T02:00:00.000Z', day: 2 },
    { id: 'ev_4', type: 'voice', text: '别人的一句话', ts: '2026-10-30T03:00:00.000Z', day: 2 },
  ].map((e) => JSON.stringify(e)).join(NL2) + NL2

  const { rows, skipped, counts } = convert(old)
  assert.equal(skipped, 0)
  assert.equal(rows.length, 4)
  assert.equal(counts.seed, 1)
  assert.equal(counts.said, 1)
  assert.equal(counts.note, 2)      // narration / voice 都降级成 note
  assert.equal(rows[1].kind, 'said')
  assert.equal(rows[1].body, '我不想再看那种东西了')
  assert.equal(rows[2].kind, 'note')
  assert.equal(rows[2].origin, 'narration')
  // id 换成我们自己的，原来的类型记在 origin 里
  assert.match(rows[0].id, /^fe_[0-9A-Z]{26}$/)
  assert.equal(rows[0].origin, 'seed')
})

test('搬家：目标已有记忆就拒绝覆盖', async () => {
  const { importFromDshFish, maybeAutoImport } = await load('import.js')
  const { appendEvent, readEvents } = await load('store.js')
  const { mkdir, writeFile } = await import('node:fs/promises')
  await withTemp(async (dir) => {
    const from = join(dir, 'old')
    const to = join(dir, 'new')
    await mkdir(from, { recursive: true })
    await writeFile(join(from, 'events.jsonl'), JSON.stringify({ id: 'ev_1', type: 'seed', text: '旧', ts: '2026-10-30T00:00:00.000Z', day: 1 }) + NL, 'utf8')

    const first = await maybeAutoImport({ from, to })
    assert.equal(first.ok, true)
    assert.equal(first.count, 1)

    const again = await importFromDshFish({ from, to })
    assert.equal(again.ok, false)
    assert.match(again.why, /已经有她的记忆/)

    const forced = await importFromDshFish({ from, to, force: true })
    assert.equal(forced.ok, true)
    const { events } = await readEvents(to)
    assert.equal(events.length, 2)

    const missing = await importFromDshFish({ from: join(dir, 'nope'), to })
    assert.equal(missing.ok, false)
  })
})
