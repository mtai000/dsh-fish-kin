/**
 * seed.test.mjs —— 起点风格（可爱天真）
 *
 * 要守住的是"起点不是判词"：
 *   1. 默认 cute：seed 里有说话的样子，也明确写着"你随时可以改"
 *   2. none：只有处境，一个字的人格都不带
 *   3. 只影响**播种那一刻**：已有的鱼改配置也不会变
 *   4. 身份段里能看到它（因为 seed 是「你是谁」那一段）
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withTemp } from './_fixture.mjs'
import { seedText, BASE, CUTE, STYLES } from '../lib/fish/seed.js'
import { ensureSeed, readEvents } from '../lib/fish/store.js'
import { identityText } from '../lib/fish/identity.js'
import { loadConfig, saveConfig } from '../lib/fish/wake.js'

test('cute：有说话的样子，也写着可以改', () => {
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
  // 不认识的风格也当 none，不乱写
  assert.equal(seedText('whatever'), BASE)
})

test('播种：默认 cute，且身份段里能看到', async () => {
  await withTemp(async (root) => {
    const cfg = await loadConfig(root)
    assert.equal(cfg.style, 'cute', '默认可爱天真')
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

test('已有记忆不会被改：再播种不覆盖，改配置也不回溯', async () => {
  await withTemp(async (root) => {
    await ensureSeed(root, seedText('none'))
    const again = await ensureSeed(root, seedText('cute'))
    assert.equal(again.created, false, '只播一次')
    const { events } = await readEvents(root)
    assert.equal(String(events[0].text).includes('好奇'), false)

    await saveConfig({ style: 'cute' }, root)
    const cfg = await loadConfig(root)
    assert.equal(cfg.style, 'cute')
    const { events: after } = await readEvents(root)
    assert.equal(String(after[0].text).includes('好奇'), false, '旧档不该变')
  })
})
