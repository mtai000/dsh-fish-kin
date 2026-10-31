/**
 * shellopen.test.mjs —— 用系统文件管理器打开目录
 *
 * 只接受绝对路径；只把路径当**单个参数**交给系统 opener（不拼 shell 字符串）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openFolder, openerFor } from '../lib/fish/shellopen.js'

test('opener：三平台各自有命令', () => {
  assert.equal(openerFor('win32').cmd, 'explorer.exe')
  assert.equal(openerFor('darwin').cmd, 'open')
  assert.equal(openerFor('linux').cmd, 'xdg-open')
})

test('打开存在的目录：路径作为单个参数传进去', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kin-open-'))
  const calls = []
  const spawnImpl = (cmd, args, opts) => {
    calls.push({ cmd, args, opts })
    return { unref: () => {} }
  }
  const r = await openFolder(dir, { spawnImpl, platform: 'win32' })
  assert.equal(r.ok, true, r.why)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].cmd, 'explorer.exe')
  assert.deepEqual(calls[0].args, [dir])
  assert.equal(calls[0].opts.detached, true)
})

test('拒绝相对路径 / 不存在的目录 / 文件', async () => {
  const calls = []
  const spawnImpl = () => { calls.push(1); return { unref: () => {} } }

  assert.equal((await openFolder('relative/path', { spawnImpl })).ok, false)
  const missing = await openFolder(join(tmpdir(), 'kin-nope-' + Date.now()), { spawnImpl })
  assert.equal(missing.ok, false)
  assert.match(missing.why, /不存在/)
  assert.equal(calls.length, 0, '校验不过就不该 spawn')
})

test('opener 起不来也不抛', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kin-open2-'))
  const r = await openFolder(dir, { spawnImpl: () => { throw new Error('ENOENT') } })
  assert.equal(r.ok, false)
  assert.match(r.why, /ENOENT/)
})
