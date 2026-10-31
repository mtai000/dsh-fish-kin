/**
 * memory.test.mjs —— 遗忘/折叠：记忆多了也别吵
 *
 * 守住四件事：
 *   1. **一条都不删**：折叠只影响"摆在眼前的"，事件流长度不变
 *   2. 同一件事说三遍 → 合成一条，算"重"
 *   3. 她改口指过的那条 → 更重，排前面
 *   4. 身份段有条数上限；多出来的折成一行「更早以前：…（你记不清原话了）」
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withTemp } from './_fixture.mjs'
import { appendEvent, readEvents } from '../lib/fish/store.js'
import { identityText } from '../lib/fish/identity.js'
import { weighBeliefs, weighRefusals, foldedLine, memoryView, SHOWN } from '../lib/fish/memory.js'

const distinct = [
  '我不想再看那种让人难受的东西了',
  '我宁可说得难听，也不说好听的假话',
  '沉默也会伤人，我后来才明白',
  '我不替别人决定他该怎么活',
  '今天的天很闷，我什么也没做',
  '我不喜欢被人安排好的时间',
  '我大概不是个会撒娇的人',
  '我不愿意为了讨好谁改口',
  '有些事我确实做错了',
  '我想把话说慢一点',
]

const mk = (text, i, over = {}) => ({
  id: 'e' + i, type: 'utterance', text, ts: new Date(Date.now() - (10 - i) * 86400000).toISOString(), ...over,
})

test('同一件事说三遍：合成一条，重量更高', () => {
  const events = [
    mk('我不想再看那种让人难受的东西了', 1),
    mk('我不想再看那种让人难受的东西了。', 2),
    mk('我不想再看那种让人难受的东西了', 3),
    mk('我宁可说得难听，也不说好听的假话', 4),
  ]
  const { items } = weighBeliefs(events)
  assert.equal(items.length, 2)
  const top = items[0]
  assert.equal(top.times, 3)
  assert.ok(top.score > items[1].score, `重复的 ${top.score} 应该更重`)
})

test('改口指过的那条更重', () => {
  const base = [mk('我原来以为沉默就是不在乎', 1), mk('我宁可说得难听，也不说好听的假话', 2)]
  const amended = [mk('我原来以为沉默就是不在乎', 1), mk('我宁可说得难听，也不说好听的假话', 2), mk('其实不是不在乎，是不知道怎么开口', 3, { type: 'revise', refs: ['e1'] })]
  const a = weighBeliefs(base).items
  const b = weighBeliefs(amended).items
  const pick = (items) => items.find((x) => x.text.includes('沉默就是不在乎'))
  assert.ok(pick(b).score > pick(a).score, '被改口的应该更重')
})

test('折叠：不超过上限时不折；超了折成一句并报剩几条', () => {
  const items = distinct.map((text, i) => ({ text, lastTs: Date.now() - i, score: 1 }))
  assert.equal(foldedLine(items.slice(0, 3), 3), '')
  const line = foldedLine(items, SHOWN)
  assert.match(line, /更早以前|条更早的|记不清原话/)
})

test('身份段：条数有上限，多出来的折成一行', async () => {
  await withTemp(async (root) => {
    await appendEvent(root, { kind: 'seed', body: '你刚开始存在。' })
    for (const t of distinct) await appendEvent(root, { kind: 'said', body: t })

    const text = identityText(root)
    const bullets = text.split('\n').filter((l) => l.startsWith('- '))
    // 4 条摆出来 + 1 行折叠
    assert.ok(bullets.length <= SHOWN + 1, `摆出来的太多：${bullets.length}`)
    assert.match(text, /更早以前：/)
    assert.match(text, /记不清原话了/)

    // 一条都没删
    const { events } = await readEvents(root)
    assert.equal(events.filter((e) => e.kind === 'said').length, distinct.length)
  })
})

test('记忆越多，身份段越不该无限长', async () => {
  await withTemp(async (root) => {
    await appendEvent(root, { kind: 'seed', body: '你刚开始存在。' })
    for (const t of distinct) await appendEvent(root, { kind: 'said', body: t })
    const small = identityText(root).length

    for (let i = 0; i < 40; i++) await appendEvent(root, { kind: 'said', body: `第 ${i} 号不同的想法，跟前面都不太像` })
    const big = identityText(root).length
    assert.ok(big < small + 400, `加了 40 条之后身份段暴涨：${small} → ${big}`)
  })
})

test('拒绝过的事也会折，但摆出来的那几条仍在', async () => {
  const events = Array.from({ length: 7 }, (_, i) => ({ id: 'r' + i, type: 'refusal', text: `第 ${i} 件我不干`, ts: new Date(Date.now() - i * 1000).toISOString() }))
  const r = weighRefusals(events)
  assert.equal(r.items.length, 7)
  const mv = memoryView(events)
  assert.equal(mv.shownRefusals.length, 3)
  assert.match(mv.foldedRefusals, /记不清原话/)
})
