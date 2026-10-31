/**
 * settings-save.test.mjs —— 设置页"点了保存却没存"的回归测试
 *
 * 2026-10-31 用户报过："只在命中兴趣的视频下才建议说话"保存后没生效，
 * 根因是保存载荷漏字段。B 站配置已随内建实现一起移除，现在盯的是
 * 剩下的几组：style / perception / tools。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { withTemp } from './_fixture.mjs'
import { saveConfig, loadConfig } from '../lib/fish/wake.js'

test('后端：style / perception / tools 存得下也读得回', async () => {
  await withTemp(async (root) => {
    const r = await saveConfig({
      style: { preset: 'cute', text: '说话软软的。' },
      perception: { plan: { hour: 9, perDay: 2 }, interests: ['人工智能'], sources: { bili: { title: '看 B 站', tools: { read: ['search_tool'] } } } },
      tools: { allow: ['schedule_create'] },
    }, root)
    assert.equal(r.ok, true)
    const cfg = await loadConfig(root)
    assert.equal(cfg.style.text, '说话软软的。')
    assert.equal(cfg.perception.plan.hour, 9)
    assert.deepEqual(cfg.perception.interests, ['人工智能'])
    assert.equal(cfg.perception.sources[0].read[0], 'search_tool')
    assert.deepEqual(cfg.tools.allow, ['schedule_create'])
  })
})

test('前端：保存载荷必须带上 style / perception / tools', async () => {
  const src = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  for (const key of ['style:', 'tools:']) {
    assert.ok(src.includes(key), `client.js 里找不到 ${key} 的保存载荷`)
  }
  // 感知源走独立接口，不在 fish-config 载荷里
  assert.ok(src.includes('/api/sources'), 'client.js 里找不到感知源的接口调用')
})
