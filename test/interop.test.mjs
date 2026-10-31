/**
 * interop.test.mjs —— 子代存档用的是**我们自己的格式**（不再依赖 dsh-fish）
 *
 * 2026-10-31 用户定：连格式也自定。所以这个文件从"dsh-fish 能不能读"改成了
 * "我们自己的运行时能不能把它当一条新鱼读起来"：
 *   1. 落盘是 kind/body/at + fe_ 开头的 id
 *   2. 我们自己的 readEvents 能读，derive 能算出第 1 天、称呼
 *   3. 身份段能拼出来（说明它以后可以被"再养起来"）
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { withTemp, writeParent, sampleHistory } from './_fixture.mjs'

const LIB = pathToFileURL(join(process.cwd(), 'lib')).href + '/'
const load = (f) => import(LIB + 'fish/' + f)
const kinLoad = (f) => import(LIB + f)

test('孩子的存档是我们的格式，我们自己的运行时可读', async () => {
  const { birth } = await kinLoad('birth.js')
  const { composePack } = await kinLoad('distill.js')
  const { rank } = await kinLoad('importance.js')
  const { readEvents } = await load('store.js')
  const { derive } = await load('derive.js')
  const { identityText } = await load('identity.js')

  await withTemp(async (dir) => {
    const parentRoot = join(dir, 'parent')
    const kinRoot = join(dir, 'kin')
    const events = sampleHistory()
    await writeParent(parentRoot, events)
    const pack = composePack(rank(events).items, { name: '梦尘' })
    const born = await birth({
      parentRoot, kinRoot, pack,
      config: { birth: { inheritName: true, notifyParent: false } },
      name: '梦尘',
      parentStats: { count: events.length, spanDays: 60 },
    })
    assert.equal(born.ok, true, born.why)

    // 磁盘上是我们的字段
    const raw = await readFile(join(born.dir, 'events.jsonl'), 'utf8')
    const rows = raw.trim().split('\n').map((l) => JSON.parse(l))
    assert.equal(rows[0].kind, 'seed')
    assert.equal(typeof rows[0].body, 'string')
    assert.equal(typeof rows[0].at, 'string')
    assert.match(rows[0].id, /^fe_[0-9A-Z]{26}$/)
    assert.equal(rows.some((r) => 'type' in r || 'text' in r), false, '不该再写旧字段')

    // 我们自己的运行时能把它读起来
    const { events: childEvents, skipped } = await readEvents(born.dir)
    assert.equal(skipped, 0)
    assert.equal(childEvents.length, 2)
    const m = derive(childEvents)
    assert.equal(m.day, 1)
    assert.equal(m.name, '梦尘')
    assert.match(m.seed, /可以不同意其中任何一条/)

    const text = identityText(born.dir)
    assert.match(text, /## 你是谁/)
    assert.match(text, /你管那个人叫「梦尘」/)
  })
})

test('旧档（dsh-fish 形状）也能被我们的读法吃下去（一次性搬家用）', async () => {
  const { normalize } = await load('schema.js')
  const old = { id: 'ev_00000000000000000000000001', v: 1, ts: '2026-10-31T00:00:00.000Z', day: 3, type: 'utterance', source: 'tool', text: '我不想再看那种东西了', refs: [], verdict: null, confidence: 0.5, flags: [] }
  const ev = normalize(old)
  assert.equal(ev.type, 'utterance')
  assert.equal(ev.kind, 'said')
  assert.equal(ev.text, '我不想再看那种东西了')
  assert.equal(ev.origin, 'utterance')

  const unknown = normalize({ id: 'ev_2', type: 'narration', text: '我变成了另一个样子', ts: '2026-10-31T00:00:00.000Z' })
  assert.equal(unknown.kind, 'note')
  assert.equal(unknown.origin, 'narration')
})
