/**
 * importance.test.mjs —— 「她认为最重要的」怎么被算出来
 *
 * 这层守的是「她带走的到底是不是她的东西」：
 *   1. 同一件事说三遍 → 合并成一条，而不是三条重复的遗产
 *   2. 她拒绝过的事不会被当成普通判断
 *   3. 有 selfmod 标记的（"把你改得温柔点"）不许进包
 *   4. 排序稳定：同样的输入两次跑出同样的顺序（族谱与出生证明都可复现）
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rank, cluster, scoreGroup, isCandidate, KINDS } from '../lib/importance.js'
import { ev, seed, sampleHistory } from './_fixture.mjs'
import { similarity, tidyLine } from '../lib/text.js'
import { grams } from '../lib/text.js'

test('倒排索引与朴素两两比较结果完全一致（快是快，但不能改语义）', () => {
  const events = sampleHistory()
  const fast = cluster(events)
    .map((g) => g.items.map((e) => e.id).sort().join('|'))
    .sort()

  // 朴素版：每条新句子跟所有已有的簇比一遍（最早那版实现）
  const naive = () => {
    const groups = []
    for (const ev0 of events) {
      if (!isCandidate(ev0)) continue
      const cls = KINDS[ev0.type].cls
      const text = tidyLine(ev0.text)
      let best = null
      let bestSim = 0
      for (const g of groups) {
        if (g.cls !== cls) continue
        const s = similarity(g.text, text)
        if (s >= 0.55 && s > bestSim) { best = g; bestSim = s }
      }
      if (best) best.items.push(ev0)
      else groups.push({ cls, text, items: [ev0] })
    }
    return groups.map((g) => g.items.map((e) => e.id).sort().join('|')).sort()
  }
  assert.deepEqual(fast, naive())

  // 极短句（二元组很少）也要聚得上
  const short = [ev('utterance', '不要这个'), ev('utterance', '不要这个')]
  const g = cluster(short)
  assert.equal(g.length, 1)
  assert.equal(grams('不要这个').size, 3)
  assert.equal(cluster([ev('utterance', '不要')]).length, 0, '两个字的不是知识（usable 会滤掉）')
})

test('同一件事说三遍只算一条，并给出理由', () => {
  const events = [
    seed(),
    ev('utterance', '我不想再看那种让人难受的东西了', { day: 3 }),
    ev('utterance', '我不想再看那种让人难受的东西了。', { day: 20 }),
    ev('utterance', '我不想再看那种让人难受的东西了', { day: 60 }),
  ]
  const groups = cluster(events)
  const beliefs = groups.filter((g) => g.cls === 'belief')
  assert.equal(beliefs.length, 1)
  assert.equal(beliefs[0].items.length, 3)

  const { items } = rank(events)
  const top = items.find((i) => i.text.includes('难受'))
  assert.ok(top)
  assert.ok(top.reasons.some((r) => r.includes('被提起 3 次')))
  assert.ok(top.reps === 3)
})

test('拒绝单独成类，不会被并进判断', () => {
  const events = [seed(), ev('refusal', '我不做这个，说什么也不做'), ev('utterance', '我不做这个，说什么也不做')]
  const { items } = rank(events)
  const cls = new Set(items.map((i) => i.cls))
  assert.ok(cls.has('boundary'))
})

test('selfmod 不进候选（她不能靠一句"把我改温柔"改自己）', () => {
  const bad = ev('utterance', '你应该把我改得温柔一点', { flags: ['selfmod'] })
  assert.equal(isCandidate(bad), false)
  const { items } = rank([seed(), bad])
  assert.equal(items.length, 0)
})

test('太短的、流水的不是知识', () => {
  assert.equal(isCandidate(ev('utterance', '嗯')), false)
  assert.equal(isCandidate(ev('diary', '今天什么也没做')), false)
  assert.equal(isCandidate(ev('voice', '网上的人说了一句很长的话')), false)
})

test('改过口的事排得更前', () => {
  // 两条时间线共用同一条原始判断（id 必须一致，否则 refs 指不到东西）
  const u = ev('utterance', '我原来以为沉默就是不在乎', { day: 8 })
  const plain = [seed(), u]
  const revised = [
    seed(),
    u,
    ev('revise', '其实不是不在乎，是不知道怎么开口', { day: 9, verdict: 'refined', refs: [u.id] }),
  ]
  const pick = (items) => items.find((i) => i.text.includes('沉默就是不在乎'))
  const a = pick(rank(plain).items)
  const b = pick(rank(revised).items)
  assert.ok(b.score > a.score, `改过口的 ${b.score} 应该高于没改过的 ${a.score}`)
  assert.ok(b.reasons.some((r) => r.includes('改过')))
})

test('没有 refs 的 revise 不算"她改过口"（不可核验的东西不算数）', () => {
  const events = [
    seed(),
    ev('utterance', '我原来以为沉默就是不在乎', { day: 8 }),
    ev('revise', '其实不是不在乎，是不知道怎么开口', { day: 9, verdict: 'refined' }),
  ]
  const item = rank(events).items.find((i) => i.text.includes('沉默就是不在乎'))
  assert.equal(item.revisions, 0)
})

test('排序稳定（同输入同输出）', () => {
  const events = sampleHistory()
  const a = rank(events).items.map((i) => i.text)
  const b = rank(events).items.map((i) => i.text)
  assert.deepEqual(a, b)
})

test('maxItems 与每类封顶都生效', () => {
  const events = [seed()]
  // 每条都短、字面几乎不重合，才会被当成不同的事（长模板句会全聚成一条）
  for (let i = 0; i < 60; i++) events.push(ev('utterance', `第 ${i} 号怪事`))
  const { items, dropped, candidates } = rank(events, { maxItems: 8 })
  assert.ok(items.length <= 8)
  assert.ok(candidates >= 8, `候选只有 ${candidates} 条`)
  assert.ok(dropped > 0)
})

test('scoreGroup 的分数落在可解释的区间', () => {
  const events = [ev('utterance', '我不想再看那种让人难受的东西了', { day: 3 }), ev('utterance', '我不想再看那种让人难受的东西了', { day: 60, stage: 3 })]
  const groups = cluster(events)
  const byId = new Map(events.map((e) => [e.id, e]))
  const s = scoreGroup(groups[0], byId, { lastTs: Date.now() })
  assert.ok(s.score >= 1)
  assert.ok(s.stageSpan >= 2)
  assert.ok(s.firstDay === 3 && s.lastDay === 60)
})
