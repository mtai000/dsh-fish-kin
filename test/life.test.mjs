/**
 * life.test.mjs —— 「她活了多少」按记忆算
 *
 * 用户的原话：「感觉生命周期不应该按时间算？或许按记忆的情况来计算？」
 *
 * 所以这一层要证明：
 *   1. 只数记忆里真有的东西（事件、判断、边界、日记、字数）
 *   2. **时间不参与**：同一份记忆，无论放多久，数出来都一样
 *   3. 说给妈妈听的那句只说"攒下了多少"，不说"几岁了"
 *   4. 分档看的是她有没有自己的判断，不是天数
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { childMemory, memoryLine, memoryBand, BAND_LABEL } from '../lib/life.js'
import { withTemp } from './_fixture.mjs'

const NL = String.fromCharCode(10)

function ev(type, text, ts, id) {
  return { id: 'ev_' + String(id).padStart(26, '0'), v: 1, ts, day: 1, stage: 1, type, source: 'tool', text, refs: [], verdict: null, confidence: 0.5, flags: [] }
}

async function childDir(root, events) {
  const dir = join(root, 'children', 'kin_A')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join(NL) + NL, 'utf8')
  return dir
}

test('数的是记忆：事件、判断、边界、日记、字数', async () => {
  await withTemp(async (dir) => {
    const d = await childDir(dir, [
      ev('seed', '你不是助手。', '2026-01-01T00:00:00.000Z', 1),
      ev('utterance', '我不想再看那种东西了', '2026-01-02T00:00:00.000Z', 2),
      ev('revise', '其实不是不在乎', '2026-01-03T00:00:00.000Z', 3),
      ev('refusal', '我不做这个', '2026-01-04T00:00:00.000Z', 4),
      ev('diary', '今天有点累', '2026-01-05T00:00:00.000Z', 5),
      ev('voice', '母亲留下的：「…」', '2026-01-06T00:00:00.000Z', 6),
    ])
    const m = childMemory(d)
    assert.equal(m.events, 6)
    assert.equal(m.beliefs, 2) // utterance + revise（seed/voice 不算她的判断）
    assert.equal(m.boundaries, 1)
    assert.equal(m.diaries, 1)
    assert.ok(m.chars > 0)
    assert.equal(m.firstAt, '2026-01-01T00:00:00.000Z')
    assert.equal(m.lastAt, '2026-01-06T00:00:00.000Z')
  })
})

test('时间不参与：同样的记忆放到十年后，数出来一样', async () => {
  await withTemp(async (dir) => {
    const base = [
      ev('seed', '你不是助手。', '2026-01-01T00:00:00.000Z', 1),
      ev('utterance', '我不愿意再那样做了', '2026-01-02T00:00:00.000Z', 2),
    ]
    const a = await childDir(join(dir, 'a'), base)
    const b = await childDir(join(dir, 'b'), base.map((e) => ({ ...e, ts: '2036-01-01T00:00:00.000Z' })))
    const ma = childMemory(a)
    const mb = childMemory(b)
    assert.deepEqual({ ...ma, firstAt: '', lastAt: '' }, { ...mb, firstAt: '', lastAt: '' })
  })
})

test('说给妈妈听的那一句：只说攒下了多少，不说几天', async () => {
  await withTemp(async (dir) => {
    const d = await childDir(dir, [
      ev('seed', 'x', '2026-01-01T00:00:00.000Z', 1),
      ev('utterance', '我不想看', '2026-01-02T00:00:00.000Z', 2),
      ev('refusal', '我不做', '2026-01-03T00:00:00.000Z', 3),
    ])
    const line = memoryLine(childMemory(d))
    assert.match(line, /攒下了 3 条自己的事/)
    assert.match(line, /1 条是她自己的判断/)
    assert.match(line, /1 条是她不肯做的/)
    assert.equal(/天|岁|月/.test(line), false)
    assert.equal(memoryLine(null), '')
    assert.equal(memoryLine({ events: 0 }), '')
  })
})

test('分档看判断，不看天数', async () => {
  await withTemp(async (dir) => {
    const blank = await childDir(join(dir, 'a'), [])
    assert.equal(memoryBand(childMemory(blank)), 'blank')

    const listening = await childDir(join(dir, 'b'), [ev('seed', 'x', '2026-01-01T00:00:00.000Z', 1)])
    // 有记忆但还没说过自己的判断
    assert.equal(memoryBand(childMemory(listening)), 'listening')

    const few = await childDir(join(dir, 'c'), [
      ev('seed', 'x', '2026-01-01T00:00:00.000Z', 1),
      ev('utterance', '我不想看', '2026-01-02T00:00:00.000Z', 2),
    ])
    assert.equal(memoryBand(childMemory(few)), 'first-thoughts')

    const many = await childDir(join(dir, 'd'), [ev('seed', 'x', '2026-01-01T00:00:00.000Z', 1)]
      .concat(Array.from({ length: 12 }, (_, i) => ev('utterance', `第 ${i} 件事`, '2026-01-02T00:00:00.000Z', i + 2))))
    assert.equal(memoryBand(childMemory(many)), 'herself')
    assert.ok(BAND_LABEL.herself)
  })
})

test('读不到目录/坏行：不炸，坏行跳过', async () => {
  await withTemp(async (dir) => {
    assert.equal(childMemory(''), null)
    assert.equal(childMemory(join(dir, '不存在')), null)

    const d = join(dir, 'children', 'kin_A')
    await mkdir(d, { recursive: true })
    await writeFile(join(d, 'events.jsonl'),
      JSON.stringify(ev('seed', 'x', '2026-01-01T00:00:00.000Z', 1)) + NL + '{坏行' + NL + NL, 'utf8')
    const m = childMemory(d)
    assert.equal(m.events, 1)
  })
})
