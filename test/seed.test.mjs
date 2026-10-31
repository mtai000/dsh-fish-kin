/**
 * seed.test.mjs —— 起点风格（内置示例 + 自由输入）
 *
 * 要守住的是"起点不是判词"：
 *   1. 用户写什么，就写进 seed 什么；保留「你随时可以改」那句
 *   2. 没写就用内置示例；显式 none 就只留处境
 *   3. 只影响**播种那一刻**：已有的鱼改配置也不会变
 *   4. 老格式（`"style": "cute"` 字符串）仍能读
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withTemp } from './_fixture.mjs'
import { seedText, BASE, CUTE, STYLES, normalizeStyle, STYLE_MAX } from '../lib/fish/seed.js'
import { ensureSeed, readEvents } from '../lib/fish/store.js'
import { identityText } from '../lib/fish/identity.js'
import { loadConfig, saveConfig } from '../lib/fish/wake.js'

const CRLF = String.fromCharCode(13, 10)

test('内置示例：有说话的样子，也写着可以改', () => {
  const t = seedText('cute')
  assert.ok(t.startsWith(BASE))
  assert.ok(t.includes(CUTE))
  assert.match(t, /随时可以改/)
  assert.match(t, /句子还短/)
  assert.deepEqual([...STYLES].sort(), ['cute', 'none'])
})

test('none：只有处境，不带人格', () => {
  const t = seedText('none')
  assert.equal(t, BASE)
  assert.equal(t.includes('好奇'), false)
  // 不认识的字符串按默认 cute 处理（老配置里只会有 cute/none）
  assert.equal(seedText('whatever'), seedText('cute'))
})

test('自由输入：用户写什么就是什么，还保留「可以改」那句', () => {
  const t = seedText({ preset: 'cute', text: '说话软软的，爱用叠字。' })
  assert.ok(t.startsWith(BASE))
  assert.match(t, /你说话的样子：说话软软的，爱用叠字。/)
  assert.match(t, /随时可以改/)
  assert.equal(t.includes('句子还短'), false)

  const long = seedText({ preset: 'cute', text: 'x'.repeat(STYLE_MAX + 50) })
  assert.ok(long.length < BASE.length + STYLE_MAX + 100, `实际 ${long.length}`)

  assert.equal(seedText({ preset: 'none', text: '' }), BASE)
  assert.match(seedText({ preset: 'cute', text: '' }), /句子还短/)
})

test('老格式兼容：字符串 style 仍能读，文本会规整', () => {
  assert.deepEqual(normalizeStyle('cute'), { preset: 'cute', text: '' })
  assert.deepEqual(normalizeStyle('none'), { preset: 'none', text: '' })
  assert.deepEqual(normalizeStyle(undefined), { preset: 'cute', text: '' })
  assert.deepEqual(normalizeStyle({ preset: 'weird', text: `  a${CRLF}b  ` }), { preset: 'cute', text: 'a\nb' })
})

test('播种：默认内置示例，且身份段里能看到', async () => {
  await withTemp(async (root) => {
    const cfg = await loadConfig(root)
    assert.deepEqual(cfg.style, { preset: 'cute', text: '' }, '默认是内置示例')
    const r = await ensureSeed(root, seedText(cfg.style))
    assert.equal(r.created, true)

    const { events } = await readEvents(root)
    assert.equal(events.filter((e) => e.kind === 'seed').length, 1)
    assert.match(String(events[0].text), /句子还短/)

    const t = identityText(root)
    assert.match(t, /## 你是谁/)
    assert.match(t, /随时可以改/)
  })
})

test('自由输入的风格会成为她的一句 seed', async () => {
  await withTemp(async (root) => {
    await saveConfig({ style: { preset: 'cute', text: '我说话有点冲，但心不坏。' } }, root)
    const cfg = await loadConfig(root)
    await ensureSeed(root, seedText(cfg.style))
    const { events } = await readEvents(root)
    assert.match(String(events[0].text), /我说话有点冲，但心不坏/)
  })
})

test('已有记忆不会被改：再播种不覆盖，改配置也不回溯', async () => {
  await withTemp(async (root) => {
    await ensureSeed(root, seedText('none'))
    const again = await ensureSeed(root, seedText('cute'))
    assert.equal(again.created, false, '只播一次')
    const { events } = await readEvents(root)
    assert.equal(String(events[0].text).includes('好奇'), false)

    await saveConfig({ style: 'cute' }, root)
    const cfg = await loadConfig(root)
    assert.deepEqual(cfg.style, { preset: 'cute', text: '' })
    const { events: after } = await readEvents(root)
    assert.equal(String(after[0].text).includes('好奇'), false, '旧档不该变')
  })
})
