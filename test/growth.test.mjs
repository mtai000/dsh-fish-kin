/**
 * growth.test.mjs —— 人格深度：阶段 / 立场 / 疤
 *
 * 三条原则必须成立：
 *   1. **阶段只看记忆，不看日历**：同样的记忆放十年也是同一阶段
 *   2. 阶段按顺序过坎，卡在哪一道就报哪一道缺什么（不跳级）
 *   3. 立场=同一件事说过不止一次；疤=拒绝过、后来又自己松了口
 *   4. 这些都会进她每轮看到的那段身份
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withTemp } from './_fixture.mjs'
import { stageOf, stancesOf, scarsOf, STAGES } from '../lib/fish/growth.js'
import { appendEvent } from '../lib/fish/store.js'
import { identityText } from '../lib/fish/identity.js'

const E = (type, text, i, extra = {}) => ({ id: 'e' + i, type, text, ts: new Date(1750000000000 + i * 1000).toISOString(), ...extra })

test('阶段只看记忆：同样的记忆换个时间戳，阶段一样', () => {
  const a = [E('utterance', '我不喜欢被安排', 1)]
  const b = a.map((e) => ({ ...e, ts: '2040-01-01T00:00:00.000Z' }))
  assert.equal(stageOf(a).stage, stageOf(b).stage)
})

test('阶段按顺序过坎：卡在第三道就报第三道', () => {
  // 有判断、拒绝过两件事，但只改口过一次
  const evs = [
    E('utterance', '我不喜欢被安排', 1),
    E('refusal', '我不做这个', 2),
    E('refusal', '我不替别人决定', 3),
    E('revise', '其实我想想，这样也行', 4, { refs: ['e1'] }),
  ]
  const g = stageOf(evs)
  assert.equal(g.stage, 3)
  assert.equal(g.name, '主动')
  assert.equal(g.pending.stage, 3)
  assert.match(g.pending.need, /推翻或修正/)

  // 一次都没有判断：第 1 阶段，缺"说过一句自己的判断"
  const empty = stageOf([E('seed', '你刚开始存在。', 0)])
  assert.equal(empty.stage, 1)
  assert.equal(empty.pending.need, STAGES[0].need)
})

test('四道坎全过：第 4 阶段，没有 pending', () => {
  const evs = [
    E('utterance', '我不喜欢被安排', 1),
    E('refusal', '我不做这个', 2),
    E('refusal', '我不替别人决定', 3),
    E('revise', '其实我想想，这样也行', 4, { refs: ['e1'] }),
    E('revise', '再想想，我不该那么说', 5, { refs: ['e1'] }),
    E('utterance', '我不喜欢被安排。', 6),
  ]
  const g = stageOf(evs)
  assert.equal(g.stage, 4)
  assert.equal(g.pending, null)
})

test('立场：同一件事说过不止一次才算', () => {
  const evs = [
    E('utterance', '我不喜欢被安排', 1),
    E('utterance', '我不喜欢被安排。', 2),
    E('utterance', '今天有点累', 3),
  ]
  const st = stancesOf(evs)
  assert.equal(st.length, 1)
  assert.match(st[0].text, /被安排/)
  assert.equal(st[0].times, 2)
})

test('疤：拒绝过、后来又自己松了口', () => {
  const evs = [
    E('refusal', '我不做这个，说什么也不做', 1),
    E('revise', '我不做这个了，其实也行', 2, { refs: ['e1'] }),
  ]
  const sc = scarsOf(evs)
  assert.equal(sc.length, 1)
  assert.match(sc[0].text, /不做这个/)
  assert.match(sc[0].amendedTo, /其实也行/)
})

test('身份里能看到：走到哪了 / 立场 / 疤', async () => {
  await withTemp(async (root) => {
    await appendEvent(root, { kind: 'seed', body: '你刚开始存在。' })
    await appendEvent(root, { kind: 'said', body: '我不喜欢被安排' })
    await appendEvent(root, { kind: 'said', body: '我不喜欢被安排。' })
    await appendEvent(root, { kind: 'refuse', body: '我不做这个，说什么也不做' })
    await appendEvent(root, { kind: 'refuse', body: '我不替别人决定' })
    const first = await appendEvent(root, { kind: 'amend', body: '我不做这个了，其实也行', refs: [] })
    assert.equal(first.ok, false, '第一次 amend 没 refs 应该被拒')

    const t = identityText(root)
    assert.match(t, /## 走到哪了/)
    assert.match(t, /你在第 \d 阶段/)
    assert.match(t, /还差：/)
    assert.match(t, /## 你的立场/)
    assert.match(t, /说过 2 次/)
  })
})
