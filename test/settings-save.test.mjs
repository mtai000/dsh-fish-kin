/**
 * settings-save.test.mjs —— 设置页"点了保存却没存"的回归测试
 *
 * 2026-10-31 用户报："只在命中兴趣的视频下，才建议她说话" 保存后没生效。
 * 根因是 0.8.1 把设置页改成页签时，保存载荷只带了旧字段，
 * 把 prefs / interact / offpeak 三组漏在了外面——页面上有控件，点保存却不提交。
 *
 * 这里钉两层：
 *   1. 后端：saveConfig 收得下这三组，loadConfig 读得回
 *   2. 前端：client.js 的"保存 B 站设置"载荷里必须出现这三组（静态检查，防再丢）
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { withTemp } from './_fixture.mjs'
import { saveConfig, loadConfig } from '../lib/fish/wake.js'

test('后端：interact / prefs / offpeak 存得下也读得回', async () => {
  await withTemp(async (root) => {
    const r = await saveConfig({
      bili: {
        interact: { onlyOnTopic: true },
        prefs: { topics: ['人工智能'], exclude: ['吵架'], searchSort: 'new' },
        offpeak: { mode: 'on', windows: ['night'] },
      },
    }, root)
    assert.equal(r.ok, true)
    const cfg = await loadConfig(root)
    assert.equal(cfg.bili.interact.onlyOnTopic, true)
    assert.deepEqual(cfg.bili.prefs.topics, ['人工智能'])
    assert.deepEqual(cfg.bili.prefs.exclude, ['吵架'])
    assert.equal(cfg.bili.prefs.searchSort, 'new')
    assert.equal(cfg.bili.offpeak.mode, 'on')
    assert.deepEqual(cfg.bili.offpeak.windows, ['night'])
  })
})

test('前端：保存 B 站设置的载荷必须带上这三组', async () => {
  const src = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  // 找到"保存 B 站设置"那个按钮前面的 saveFish 调用区间
  const idx = src.indexOf("'保存 B 站设置'")
  assert.ok(idx > 0, '没找到保存按钮')
  const nearby = src.slice(Math.max(0, idx - 1600), idx)
  for (const key of ['prefs:', 'interact:', 'offpeak:', 'dm:']) {
    assert.ok(nearby.includes(key), `保存载荷里缺了 ${key}（页面上有控件却没提交）`)
  }
})
