/**
 * distill.test.mjs —— 遗传包
 *
 * 守三件事：
 *   1. **字数硬上限**：超 2000 字 dsh-fish 整条事件写不进去，孩子就没有起点。
 *   2. **不写人格**：只写发生过什么。出现「你是一个…的人」这种句子，
 *      就等于从出生把她锁死在一套旧设定里——正是 dsh-fish 立项时要摆脱的东西。
 *   3. **写明可以不同意**：孩子知道自己带着东西，也知道自己不必照做。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { composePack, handoverText, fingerprint, fingerprintSimilarity, PREAMBLE } from '../lib/distill.js'
import { rank } from '../lib/importance.js'
import { ev, seed, sampleHistory } from './_fixture.mjs'

const packOf = (events, opts = {}) => composePack(rank(events).items, { maxChars: 1500, ...opts })

test('装得下：正文不超过给定上限', () => {
  const p = packOf(sampleHistory())
  assert.ok(p.chars <= 1500, `实际 ${p.chars}`)
  assert.ok(p.picked.length > 0)
})

test('东西很多时仍然装得下（降档而不是超长）', () => {
  const events = [seed()]
  // 短、互不相似的边界：要的不是"同一条被说 80 次"，是"80 条不同的边界"。
  for (let i = 0; i < 80; i++) events.push(ev('refusal', `第 ${i} 号我不干`))
  const p = composePack(rank(events).items, { maxChars: 800 })
  assert.ok(p.chars <= 800, `实际 ${p.chars}`)
  assert.ok(p.picked.length >= 3, `只装了 ${p.picked.length} 条`)
})

test('极小预算也不炸', () => {
  const p = composePack(rank(sampleHistory()).items, { maxChars: 200 })
  assert.ok(p.chars <= 200)
  assert.equal(typeof p.body, 'string')
})

test('正文只写事实，不写人格形容词', () => {
  const p = packOf(sampleHistory())
  assert.doesNotMatch(p.body, /你(是|总是|一向|天生)(一|个|只)?[^\n。]{0,10}的人/)
  assert.match(p.body, /可以不同意其中任何一条/)
  assert.equal(p.body.startsWith(PREAMBLE), true)
})

test('分节出现，且拒绝进「她拒绝过的事」', () => {
  const p = packOf(sampleHistory())
  assert.match(p.body, /## 她拒绝过的事/)
  assert.match(p.body, /我不做这个/)
})

test('称呼：有时写进末尾，没有时不写空行', () => {
  const withName = packOf(sampleHistory(), { name: '梦尘' })
  assert.match(withName.body, /她管你叫「梦尘」/)
  const noName = packOf(sampleHistory(), { name: '' })
  assert.doesNotMatch(noName.body, /她管你叫/)
})

test('接生单能被 dsh-fish 的交接单格式读懂（三节都在）', () => {
  const p = packOf(sampleHistory(), { name: '梦尘' })
  const doc = handoverText({ body: p.body, name: '梦尘', tools: ['skill', 'web_search'] })
  assert.match(doc, /^# 交接单/)
  assert.match(doc, /## 你是谁/)
  assert.match(doc, /## 称呼/)
  assert.match(doc, /## 工具/)
  assert.match(doc, /skill, web_search/)
})

test('指纹：同一份正文相似度 1，不同的一份明显更低', () => {
  const a = fingerprint('她拒绝过这件事。她认定那件事。')
  const b = fingerprint('她拒绝过这件事。她认定那件事。')
  const c = fingerprint('完全不同的另一段文字，讲的是别的事情，没有重合。')
  assert.equal(fingerprintSimilarity(a, b), 1)
  assert.ok(fingerprintSimilarity(a, c) < 0.2)
  assert.equal(fingerprintSimilarity(null, a), 0)
})

test('压薄是默认：只留边界和最多两条判断，日记与关系不进 seed', () => {
  const events = [
    seed(),
    ev('refusal', '我不做这个'),
    ev('refusal', '我不替别人决定他该怎么活'),
    ev('refusal', '我不说好听的假话'),
    ev('refusal', '我不熬夜'),
    ev('refusal', '我不吃这个'),
    ev('utterance', '我不想再看那种东西了'),
    ev('utterance', '我宁可说得难听'),
    ev('utterance', '我原来以为沉默就是不在乎'),
    ev('diary', '今天有点累'),
    ev('reunion', '你回来的时候我没说话'),
  ]
  const p = composePack(rank(events).items, { name: '梦尘' })
  assert.ok(p.chars <= 700, `默认上限应该是 700，实际 ${p.chars}`)
  assert.equal(p.thin, true)
  // 边界最多 4 条
  const boundaries = p.picked.filter((x) => x.cls === 'boundary')
  assert.ok(boundaries.length <= 4)
  // 判断最多 2 条
  const beliefs = p.picked.filter((x) => x.cls === 'belief')
  assert.ok(beliefs.length <= 2)
  // 日记与关系不进
  assert.equal(p.body.includes('今天有点累'), false)
  assert.equal(p.body.includes('你回来的时候'), false)
})

test('thin=false 时回到旧的全量；keepBeliefs=false 时连判断都不带', () => {
  const events = [seed(), ev('refusal', '我不做这个'), ev('utterance', '我不想再看那种东西了'), ev('diary', '今天有点累')]
  const items = rank(events).items
  const full = composePack(items, { thin: false, maxChars: 1500 })
  assert.match(full.body, /## 她写给自己的一句话/)
  assert.match(full.body, /今天有点累/)

  const noBelief = composePack(items, { keepBeliefs: false })
  assert.equal(/## 她认定过的事/.test(noBelief.body), false)
  assert.match(noBelief.body, /## 她拒绝过的事/)
})

test('「妈妈影子有多重」可调：边界/判断的条数上限', () => {
  const events = [
    seed(),
    ev('refusal', '我不做这个'),
    ev('refusal', '我不替别人决定'),
    ev('refusal', '我不说假话'),
    ev('utterance', '我不想再看那种东西了'),
    ev('utterance', '我宁可说得难听'),
    ev('utterance', '我原来以为沉默就是不在乎'),
  ]
  const items = rank(events).items

  const lean = composePack(items, { maxBoundaries: 1, maxBeliefs: 0 })
  assert.equal(lean.picked.filter((x) => x.cls === 'boundary').length, 1)
  assert.equal(lean.picked.filter((x) => x.cls === 'belief').length, 0)
  assert.equal(/## 她认定过的事/.test(lean.body), false)

  const rich = composePack(items, { maxBoundaries: 3, maxBeliefs: 3, maxChars: 1500 })
  assert.equal(rich.picked.filter((x) => x.cls === 'boundary').length, 3)
  assert.equal(rich.picked.filter((x) => x.cls === 'belief').length, 3)

  // 越界值被夹住，不会因为写了 999 就把整本账搬过去
  const silly = composePack(items, { maxBoundaries: 999, maxBeliefs: -5, maxChars: 2000 })
  assert.ok(silly.picked.filter((x) => x.cls === 'boundary').length <= 12)
  assert.equal(silly.picked.filter((x) => x.cls === 'belief').length, 0)
})

test('0/0：一条都不带时不留悬空的「下面这些」', () => {
  const items = rank([seed(), ev('refusal', '我不做这个'), ev('utterance', '我不想再看那种东西了')]).items
  const p = composePack(items, { maxBoundaries: 0, maxBeliefs: 0 })
  assert.equal(p.picked.length, 0)
  assert.equal(/下面这些是她活过的/.test(p.body), false)
  assert.match(p.body, /你刚开始存在/)
})
