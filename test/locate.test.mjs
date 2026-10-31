/**
 * locate.test.mjs —— 读哪个目录
 *
 * 这一层错，整个插件就是个"她的记忆是空的"的空壳，而且不会报错。
 * 所以三种来源的优先级必须逐条钉死，并且要能和 dsh-fish 的 resolve 对上。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parentRoot, kinRoot, parentSource, readLocation, parentPaths, kinPaths, childPaths } from '../lib/locate.js'
import { withTemp } from './_fixture.mjs'

test('环境变量最优先', async () => {
  await withTemp(async (home) => {
    await writeFile(join(home, '.dsh-fish-location.json'), JSON.stringify({ root: join(home, 'moved') }), 'utf8')
    const env = { DSH_FISH_HOME: join(home, 'envroot') }
    assert.equal(parentRoot({ env, home }), join(home, 'envroot'))
    assert.equal(parentSource({ env, home }), 'env')
  })
})

test('其次是指针文件', async () => {
  await withTemp(async (home) => {
    await mkdir(join(home, 'moved'), { recursive: true })
    await writeFile(join(home, '.dsh-fish-location.json'), JSON.stringify({ root: join(home, 'moved') }), 'utf8')
    assert.equal(parentRoot({ env: {}, home }), join(home, 'moved'))
    assert.equal(parentSource({ env: {}, home }), 'pointer')
  })
})

test('都没有就是 ~/.dsh-fish', async () => {
  await withTemp(async (home) => {
    assert.equal(parentRoot({ env: {}, home }), join(home, '.dsh-fish'))
    assert.equal(parentSource({ env: {}, home }), 'default')
    assert.equal(readLocation({ env: {}, home }), '')
  })
})

test('坏指针文件当成没迁过，不抛', async () => {
  await withTemp(async (home) => {
    await writeFile(join(home, '.dsh-fish-location.json'), '{ 坏 json', 'utf8')
    assert.equal(parentRoot({ env: {}, home }), join(home, '.dsh-fish'))
    // 相对路径不算数：那会变成"相对于当前工作目录"
    await writeFile(join(home, '.dsh-fish-location.json'), JSON.stringify({ root: 'relative/path' }), 'utf8')
    assert.equal(readLocation({ env: {}, home }), '')
  })
})

test('产房目录与母代分居', async () => {
  await withTemp(async (home) => {
    // 0.12.0 起：产房 = 家族工作区（默认 <home>/大肥鱼家族，旧目录存在则沿用）
    assert.equal(kinRoot({ env: {}, home }), join(home, '大肥鱼家族'))
    assert.equal(kinRoot({ env: { DSH_FISH_KIN_HOME: join(home, 'k') }, home }), join(home, 'k'))
    assert.notEqual(kinRoot({ env: {}, home }), parentRoot({ env: {}, home }))
  })
})

test('目录布局', () => {
  const p = parentPaths('/x')
  assert.equal(p.events, join('/x', 'events.jsonl'))
  assert.equal(p.config, join('/x', 'config.json'))
  const k = kinPaths('/k')
  assert.equal(k.lineage, join('/k', 'lineage.jsonl'))
  assert.equal(k.childrenDir, join('/k', 'children'))
  const c = childPaths('/k', 'kin_ABC')
  assert.equal(c.dir, join('/k', 'children', 'kin_ABC'))
  assert.equal(c.events, join('/k', 'children', 'kin_ABC', 'events.jsonl'))
})
