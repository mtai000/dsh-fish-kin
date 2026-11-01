import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureIdentity, identityPath, readIdentity } from '../lib/identity.js'

async function temp() {
  const dir = await mkdtemp(join(tmpdir(), 'fish-identity-'))
  return dir
}

test('身份证：新生成 fish_ + 26 位，可重复读取', async () => {
  const dir = await temp()
  try {
    const a = await ensureIdentity(dir, { generation: 1 })
    assert.equal(a.ok, true)
    assert.equal(a.created, true)
    assert.match(a.identity.identityId, /^fish_[0-9A-Z]{26}$/)
    assert.equal(a.identity.parentId, null)
    assert.equal(a.identity.lineageId, a.identity.identityId)
    assert.equal(a.identity.generation, 1)
    const b = await ensureIdentity(dir, { generation: 9 })
    assert.equal(b.created, false)
    assert.equal(b.identity.identityId, a.identity.identityId)
    assert.equal(b.identity.generation, 1)
    assert.deepEqual(await readIdentity(dir), a.identity)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('身份证：子代带 parentId/lineageId/childId', async () => {
  const dir = await temp()
  try {
    const parent = await ensureIdentity(join(dir, 'parent'))
    const child = await ensureIdentity(join(dir, 'child'), {
      parentId: parent.identity.identityId,
      lineageId: parent.identity.lineageId,
      childId: 'kin_01KC00000000000000000000',
      generation: 2,
    })
    assert.equal(child.identity.parentId, parent.identity.identityId)
    assert.equal(child.identity.lineageId, parent.identity.lineageId)
    assert.equal(child.identity.childId, 'kin_01KC00000000000000000000')
    assert.equal(child.identity.generation, 2)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('身份证：坏文件被忽略并重建', async () => {
  const dir = await temp()
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(identityPath(dir), '{ not json', 'utf8')
    const r = await ensureIdentity(dir)
    assert.equal(r.created, true)
    assert.match(r.identity.identityId, /^fish_/)
    const onDisk = JSON.parse(await readFile(identityPath(dir), 'utf8'))
    assert.equal(onDisk.identityId, r.identity.identityId)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
