/**
 * ids.test.mjs —— 事件 id 必须和 dsh-fish 同形
 *
 * 子代的第一条事件是我们亲手写进去的。id 形状一旦不对，dsh-fish 的 idTime()
 * 会把她那条 seed 解成 1970 年，观测台排序全乱——而界面上不会报任何错。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newEventId, newId, idTime, isEventId } from '../lib/ids.js'

test('形状：ev_ + 26 位 Crockford', () => {
  for (let i = 0; i < 50; i++) {
    const id = newEventId()
    assert.match(id, /^ev_[0-9A-Z]{26}$/)
    assert.equal(isEventId(id), true)
  }
})

test('同毫秒内单调递增（行序 == 时间序）', () => {
  const at = Date.now()
  const a = newEventId(at)
  const b = newEventId(at)
  assert.notEqual(a, b)
  assert.ok(b > a, `${b} 应该大于 ${a}`)
})

test('idTime 能解回生成时间', () => {
  // 注意：id 是**单调**的（同一进程里不会因为传了个更早的时间就倒退），
  // 所以这里要用未来时间，否则会撞上"只增不减"的保护。
  const now = Date.now() + 60_000
  const id = newEventId(now)
  assert.equal(idTime(id), now)
})

test('坏 id 解成 0，不抛', () => {
  assert.equal(idTime('nope'), 0)
  assert.equal(idTime(''), 0)
  assert.equal(isEventId('ev_短'), false)
})

test('本插件自己的 id 有独立前缀', () => {
  assert.match(newId('req'), /^req_[0-9A-Z]{26}$/)
  assert.match(newId('kin'), /^kin_[0-9A-Z]{26}$/)
  assert.equal(isEventId(newId('kin')), false)
})
