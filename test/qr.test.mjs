/**
 * qr.test.mjs —— 自己写的二维码（byte 模式 + 纠错 L）
 *
 * 正确性不是靠"看起来像"：这份实现已经用**独立解码器 jsqr** 解回过原文，
 * 并且和参考编码器（qrcode 包）逐位比对过 v2 是 **0 差异**。
 * 这里钉住：
 *   1. 已知内容的矩阵指纹（防止以后改坏）
 *   2. 定位图案/时序图案的位置
 *   3. 版本选择与容量边界
 *   4. 生成的 PNG 是合法 PNG（魔数）且大到能扫
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { encode, pickVersion, toPng, toDataUrl } from '../lib/fish/qr.js'

// 已验证（jsqr 解码 + 参考编码器比对）：https://b23.tv/abc → v2，25×25
const GOLDEN = '26c708e80d57de72'

test('已知内容：版本、尺寸、矩阵指纹', () => {
  const { matrix, size, version } = encode('https://b23.tv/abc')
  assert.equal(version, 2)
  assert.equal(size, 25)
  const flat = matrix.map((r) => r.map((v) => (v ? '1' : '0')).join('')).join('')
  assert.equal(createHash('sha256').update(flat).digest('hex').slice(0, 16), GOLDEN)
})

test('定位图案在三个角，时序图案在位', () => {
  const { matrix, size } = encode('https://b23.tv/abc')
  // 左上 finder：7×7 外框黑、内圈白、中心 3×3 黑
  for (let i = 0; i < 7; i++) {
    assert.equal(matrix[0][i], true, `第 0 行第 ${i} 列该黑`)
    assert.equal(matrix[6][i], true)
    assert.equal(matrix[i][0], true)
  }
  assert.equal(matrix[3][3], true, '中心该黑')
  assert.equal(matrix[1][1], false, '内圈该白')
  // 时序：第 6 行/列黑白相间
  assert.equal(matrix[6][8], true)
  assert.equal(matrix[6][9], false)
  assert.equal(matrix[8][6], true)
  assert.equal(matrix[9][6], false)
})

test('版本选择：越长越大，超了明确报错', () => {
  assert.equal(pickVersion(Buffer.from('AB')), 1)
  assert.equal(pickVersion(Buffer.from('x'.repeat(100))), 5)
  assert.equal(pickVersion(Buffer.from('x'.repeat(180))), 8) // v8 数据 194 字节
  assert.equal(pickVersion(Buffer.from('x'.repeat(200))), 0, '超过 v8 容量就装不下')
  assert.equal(pickVersion(Buffer.from('x'.repeat(300))), 0)
  assert.throws(() => encode('x'.repeat(300)), /太长/)
})

test('扫码用的那种长 URL 也能装下（v6）', () => {
  const url = 'https://passport.bilibili.com/h5-app/passport/login/scan?navhide=1&qrcode_key=0123456789abcdef0123456789abcdef'
  const r = encode(url)
  assert.equal(r.version, 6)
  assert.equal(r.size, 41)
})

test('PNG：合法魔数，data URL 可直接塞进 img', () => {
  const buf = toPng('https://b23.tv/abc', { scale: 4 })
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const url = toDataUrl('https://b23.tv/abc')
  assert.match(url, /^data:image\/png;base64,[A-Za-z0-9+/=]+$/)
  assert.ok(url.length > 300)
})
