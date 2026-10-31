/**
 * pressure.test.mjs —— 记忆压力
 *
 * 它是「该提醒了」的唯一判据，但不能变成闸门：它说 hot 只是"可以提"，
 * 生不生仍然由人决定。所以这里钉的是档位与「什么时候 eligible」。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assess } from '../lib/pressure.js'
import { DEFAULTS } from '../lib/kinstore.js'

const cfg = (patch = {}) => ({ ...DEFAULTS, pressure: { ...DEFAULTS.pressure, ...patch } })
const stats = (count, chars, days) => ({ count, chars, spanDays: days })

test('还很空：ok，且不 eligible', () => {
  const r = assess({ stats: stats(10, 1000, 3), config: cfg() })
  assert.equal(r.level, 'ok')
  assert.equal(r.eligible, false)
  assert.equal(r.blockedBy, 'pressure-not-hot')
  assert.ok(r.reasons[0].includes('还很空'))
})

test('过半：warm，提示可以准备', () => {
  const r = assess({ stats: stats(800, 1000, 3), config: cfg() })
  assert.equal(r.level, 'warm')
  assert.equal(r.eligible, false)
})

test('越线：hot，可以提议', () => {
  const r = assess({ stats: stats(1300, 1000, 3), config: cfg() })
  assert.equal(r.level, 'hot')
  assert.equal(r.eligible, true)
  assert.ok(r.reasons.some((x) => x.includes('1300')))
})

test('只看记忆：条数或字数越线就是 hot', () => {
  assert.equal(assess({ stats: stats(1300, 1, 1), config: cfg() }).level, 'hot')
  assert.equal(assess({ stats: stats(1, 500_000, 1), config: cfg() }).level, 'hot')
})

test('天数不算压力：扔在角落 400 天、记忆没长，仍然是 ok', () => {
  const r = assess({ stats: stats(2, 100, 400), config: cfg() })
  assert.equal(r.level, 'ok')
  assert.equal(r.eligible, false)
  // 但天数会作为一句背景给出，不推人做决定
  assert.match(r.context, /400 天/)
  assert.equal(r.reasons.some((x) => x.includes('天')), false)
})

test('已经有待批的单子就不再 eligeble（别拿同一个决定烦两次）', () => {
  const r = assess({ stats: stats(1300, 1, 1), config: cfg(), pending: 1 })
  assert.equal(r.level, 'hot')
  assert.equal(r.eligible, false)
  assert.equal(r.blockedBy, 'pending-request')
})

test('刚生完要等新的事件攒出来', () => {
  const r = assess({ stats: stats(1300, 1, 1), config: cfg(), lastBirthEvents: 1200 })
  assert.equal(r.blockedBy, 'too-soon')
  const later = assess({ stats: stats(1500, 1, 1), config: cfg(), lastBirthEvents: 1200 })
  assert.equal(later.eligible, true)
})

test('阈值坏掉时按默认值兜底，不会永远 hot', () => {
  const r = assess({ stats: stats(1300, 1, 1), config: { pressure: { events: 0, chars: -1 } } })
  assert.equal(r.level, 'ok')
})

test('没有 stats 也不炸', () => {
  const r = assess({ config: cfg() })
  assert.equal(r.level, 'ok')
  assert.ok(Array.isArray(r.reasons))
})
