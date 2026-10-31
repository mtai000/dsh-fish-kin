/**
 * installed.test.mjs —— 扫描 profile 里装了哪些插件（给"勾选工具"用）
 *
 * 边界：只读 package.json 和入口文件；工具名是**推测**，标 suggest。
 * 本插件自己不出现在列表里（否则会诱惑你把自己接成源）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listInstalledPlugins, guessToolNames, sourceIdOf } from '../lib/perception/installed.js'

test('从 defineTool 里猜工具名（只在附近找）', () => {
  const src = `
    const a = ctx.tools.register(defineTool({ name: 'alpha_tool', description: 'x' }))
    const b = ctx.tools.register(defineTool({ name: 'beta_tool', description: 'y' }))
    const notATool = { name: 'something_else' }
  `
  assert.deepEqual(guessToolNames(src), ['alpha_tool', 'beta_tool'])
})

test('包名 → 源 id', () => {
  assert.equal(sourceIdOf('dsh-bili-scroll'), 'bili_scroll')
  assert.equal(sourceIdOf('@scope/dsh-play-cdda'), 'play_cdda')
  assert.equal(sourceIdOf(''), 'source')
})

test('扫描：只认 DSH 插件，排除自己', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kin-mods-'))
  const mk = async (name, pkg, index = '') => {
    const d = join(dir, name)
    await mkdir(d, { recursive: true })
    await writeFile(join(d, 'package.json'), JSON.stringify({ name, ...pkg }), 'utf8')
    if (index) await writeFile(join(d, 'index.js'), index, 'utf8')
  }
  await mk('dsh-fake', { version: '1.2.3', dsh: { client: {} } }, "defineTool({ name: 'fake_read' })")
  await mk('plain-lib', { version: '0.0.1' })
  await mk('dsh-fish-kin', { version: '9.9.9', dsh: {} })
  await mk('@scope/dsh-other', { version: '2.0.0' }, "defineTool({ name: 'other_act' })")

  const { plugins } = await listInstalledPlugins({ baseDir: dir })
  const names = plugins.map((p) => p.name)
  assert.deepEqual(names.sort(), ['@scope/dsh-other', 'dsh-fake'])
  const fake = plugins.find((p) => p.name === 'dsh-fake')
  assert.equal(fake.version, '1.2.3')
  assert.equal(fake.hasClient, true)
  assert.deepEqual(fake.tools, ['fake_read'])
  assert.equal(plugins.find((p) => p.name === 'dsh-fish-kin'), undefined, '不列自己')
})

test('扫描：目录不存在时不抛', async () => {
  const r = await listInstalledPlugins({ baseDir: join(tmpdir(), 'kin-not-exist-' + Date.now()) })
  assert.deepEqual(r.plugins, [])
})
