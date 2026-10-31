/**
 * read.test.mjs —— 读母代存档
 *
 * 这一层要证明两件事：
 *   1. 一行坏数据不会让她"整份记忆消失"（宽容读 + 计数）
 *   2. 称呼读得出来（继承称呼是唯一"必须带走"的关系事实）
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { readParentEvents, readParentTools, summarize, deriveName, collect, tsMs } from '../lib/read.js'
import { withTemp, ev, seed, writeParent, writeParentConfig, sampleHistory } from './_fixture.mjs'

test('没有存档时返回空，不是崩', async () => {
  await withTemp(async (dir) => {
    const r = await readParentEvents(dir)
    assert.equal(r.exists, false)
    assert.deepEqual(r.events, [])
  })
})

test('坏行跳过并计数，好行照读', async () => {
  await withTemp(async (dir) => {
    const good = [ev('utterance', '我不想看这个'), ev('diary', '今天有点累')]
    await writeFile(join(dir, 'events.jsonl'),
      [JSON.stringify(good[0]), '{坏行', '', '"一串字符串"', JSON.stringify(good[1]), JSON.stringify({ noId: 1 })].join('\n'), 'utf8')
    const r = await readParentEvents(dir)
    assert.equal(r.exists, true)
    assert.equal(r.events.length, 2)
    assert.equal(r.skipped, 3)
  })
})

test('summarize：条数、字数、天数、类型、seed', async () => {
  const events = sampleHistory()
  const s = summarize(events)
  assert.equal(s.count, events.length)
  assert.equal(s.types.utterance, 4)
  assert.equal(s.types.refusal, 1)
  assert.equal(s.spanDays, 60)
  assert.ok(s.chars > 0)
  assert.match(s.seedText, /你不是助手/)
  assert.equal(s.imported, false)
})

test('import-mark 会被认出来（她这一局是接来的）', () => {
  const s = summarize([seed(), ev('meta', 'import-mark:别处', { source: 'system' })])
  assert.equal(s.imported, true)
})

test('tsMs 两种形态都认', () => {
  assert.equal(tsMs({ ts: 1000 }), 1000)
  assert.equal(tsMs({ ts: new Date(1700000000000).toISOString() }), 1700000000000)
  assert.equal(tsMs({ ts: '不是时间' }), 0)
  assert.equal(tsMs({}), 0)
})

test('称呼：import-name 优先，其次她说过的原话', () => {
  assert.equal(deriveName([seed(), ev('meta', 'import-name:梦尘', { source: 'system' })]), '梦尘')
  assert.equal(deriveName([seed(), ev('utterance', '以后叫他时梦尘吧')]), '时梦尘')
  assert.equal(deriveName([seed(), ev('utterance', '他给了自己的名字：开灯的')]), '开灯的')
  assert.equal(deriveName([seed(), ev('utterance', '你叫什么名字')]), '')
  assert.equal(deriveName([seed(), ev('meta', 'import-name:他', { source: 'system' })]), '')
})

test('工具白名单读得出来，坏文件当空表', async () => {
  await withTemp(async (dir) => {
    await writeParentConfig(dir, { tools: { allow: ['skill', 'web_search', ''] } })
    assert.deepEqual(await readParentTools(dir), ['skill', 'web_search'])
    await writeFile(join(dir, 'config.json'), '坏', 'utf8')
    assert.deepEqual(await readParentTools(dir), [])
  })
})

test('collect 一次拿全', async () => {
  await withTemp(async (dir) => {
    await writeParent(dir, sampleHistory())
    await writeParentConfig(dir, { tools: { allow: ['skill'] } })
    const c = await collect({ root: dir })
    assert.equal(c.exists, true)
    assert.equal(c.stats.count, sampleHistory().length)
    assert.deepEqual(c.tools, ['skill'])
  })
})
