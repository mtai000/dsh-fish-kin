/**
 * workspace.test.mjs —— 家族工作区
 *
 * 用户 2026-10-31 要的：不要写死在 D 盘、要能自己设置一个「大肥鱼家族」工作区，
 * 所有东西都待在里面，别污染别处。
 *
 * 钉住四条：
 *   1. 解析顺序：环境变量 > 指针文件 > 旧目录（老用户不惊动）> 默认
 *   2. 换工作区只写指针，不搬数据
 *   3. 她的家在 <工作区>/fish，族谱就是工作区本身
 *   4. 工作区里没有任何东西写到外面
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { familyRoot, familySource, setFamilyRoot, familyPointer, kinRoot } from '../lib/locate.js'
import { defaultRoot, injectLocate } from '../lib/fish/store.js'
import * as locate from '../lib/locate.js'

test('默认工作区：<home>/大肥鱼家族', async () => {
  const home = await mkdtemp(join(tmpdir(), 'kin-home-'))
  // 没有旧目录时用新默认
  assert.equal(familyRoot({ env: {}, home }), join(home, '大肥鱼家族'))
  assert.equal(familySource({ env: {}, home }), 'default')
})

test('老用户不惊动：旧目录存在就继续用它', async () => {
  const home = await mkdtemp(join(tmpdir(), 'kin-home2-'))
  await mkdir(join(home, '.dsh-fish-kin'), { recursive: true })
  assert.equal(familyRoot({ env: {}, home }), join(home, '.dsh-fish-kin'))
  assert.equal(familySource({ env: {}, home }), 'legacy')
})

test('指针文件优先，环境变量最高', async () => {
  const home = await mkdtemp(join(tmpdir(), 'kin-home3-'))
  await mkdir(join(home, '.dsh-fish-kin'), { recursive: true })
  await writeFile(familyPointer({ env: {}, home }), JSON.stringify({ familyRoot: join(home, '家族A') }), 'utf8')
  assert.equal(familyRoot({ env: {}, home }), join(home, '家族A'))
  assert.equal(familySource({ env: {}, home }), 'pointer')
  assert.equal(familyRoot({ env: { DSH_KIN_FAMILY_ROOT: 'D:/fam' }, home }), 'D:/fam')
  assert.equal(familySource({ env: { DSH_KIN_FAMILY_ROOT: 'D:/fam' }, home }), 'env')
})

test('换工作区：只写指针，拒绝相对路径', async () => {
  const home = await mkdtemp(join(tmpdir(), 'kin-home4-'))
  const bad = await setFamilyRoot('relative/path', { env: {}, home })
  assert.equal(bad.ok, false)
  const ok = await setFamilyRoot(join(home, '新家族'), { env: {}, home })
  assert.equal(ok.ok, true)
  assert.equal(familyRoot({ env: {}, home }), join(home, '新家族'))
  const raw = JSON.parse(await readFile(familyPointer({ env: {}, home }), 'utf8'))
  assert.match(raw.at, /^\d{4}-/)
})

test('她的家在 <工作区>/fish，族谱就是工作区', async () => {
  const home = await mkdtemp(join(tmpdir(), 'kin-home5-'))
  await setFamilyRoot(join(home, '家族B'), { env: {}, home })
  // store.defaultRoot 走注入的 locate；这里用显式 env 覆盖，不碰真实 HOME
  injectLocate(locate)
  assert.equal(kinRoot({ env: {}, home }), join(home, '家族B'))
  assert.equal(defaultRoot({ DSH_KIN_FAMILY_ROOT: join(home, '家族B') }), join(home, '家族B', 'fish'))
})
