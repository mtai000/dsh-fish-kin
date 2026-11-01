import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  ensureIdentity, identityPath, readIdentity, newIdentityId, identityParts,
  reissueIdentity, IDENTITY_PREFIX, NEW_IDENTITY_RE, GONGSHU_IDENTITY_RE,
} from '../lib/identity.js'

async function temp() {
  return mkdtemp(join(tmpdir(), 'fish-identity-'))
}

const localDate = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

test('身份证：ds-fish- + 年月日 + 4 位编码', async () => {
  const dir = await temp()
  try {
    const a = await ensureIdentity(dir, { generation: 1 })
    assert.equal(a.ok, true)
    assert.equal(a.created, true)
    assert.match(a.identity.identityId, NEW_IDENTITY_RE)
    assert.match(a.identity.identityId, /^ds-fish-\d{12}$/)
    assert.ok(a.identity.identityId.startsWith(IDENTITY_PREFIX))
    assert.equal(a.identity.identityId.slice(IDENTITY_PREFIX.length, IDENTITY_PREFIX.length + 8), localDate())
    assert.match(a.identity.identityId.slice(IDENTITY_PREFIX.length + 8), /^\d{4}$/)
    assert.equal(a.identity.parentId, null)
    assert.equal(a.identity.lineageId, a.identity.identityId)
    assert.equal(a.identity.generation, 1)
    const parts = identityParts(a.identity.identityId)
    assert.equal(parts.prefix, IDENTITY_PREFIX)
    assert.equal(parts.date, `${localDate().slice(0, 4)}-${localDate().slice(4, 6)}-${localDate().slice(6, 8)}`)
    assert.match(parts.code, /^\d{4}$/)

    const b = await ensureIdentity(dir, { generation: 9 })
    assert.equal(b.created, false)
    assert.equal(b.identity.identityId, a.identity.identityId)
    assert.equal(b.identity.generation, 1)
    assert.deepEqual(await readIdentity(dir), a.identity)

    // 同一天连续生成不撞号
    const ids = new Set([newIdentityId(), newIdentityId(), newIdentityId()])
    assert.equal(ids.size, 3)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('身份证：子代带 parentId/lineageId/childId；同一天不跟已有编号撞', async () => {
  const dir = await temp()
  try {
    const parent = await ensureIdentity(join(dir, 'parent'))
    const used = [parent.identity.identityId]
    const child = await ensureIdentity(join(dir, 'child'), {
      parentId: parent.identity.identityId,
      lineageId: parent.identity.lineageId,
      childId: 'kin_01KC00000000000000000000',
      generation: 2,
      usedIds: used,
    })
    assert.equal(child.identity.parentId, parent.identity.identityId)
    assert.equal(child.identity.lineageId, parent.identity.lineageId)
    assert.equal(child.identity.childId, 'kin_01KC00000000000000000000')
    assert.equal(child.identity.generation, 2)
    assert.notEqual(child.identity.identityId, parent.identity.identityId)
    assert.match(child.identity.identityId, NEW_IDENTITY_RE)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('身份证：坏文件被忽略并重建', async () => {
  const dir = await temp()
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(identityPath(dir), '{ not json', 'utf8')
    const r = await ensureIdentity(dir)
    assert.equal(r.created, true)
    assert.match(r.identity.identityId, NEW_IDENTITY_RE)
    const onDisk = JSON.parse(await readFile(identityPath(dir), 'utf8'))
    assert.equal(onDisk.identityId, r.identity.identityId)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('身份证：老 fish_ 格式还能读，不因为升级就丢；reissue 才换新格式', async () => {
  const dir = await temp()
  try {
    const legacy = 'fish_' + '0'.repeat(26)
    await mkdir(dir, { recursive: true })
    await writeFile(identityPath(dir), JSON.stringify({
      v: 1, identityId: legacy, childId: null, parentId: null,
      lineageId: legacy, generation: 1, createdAt: '2026-10-31T00:00:00.000Z',
    }), 'utf8')
    const cur = await readIdentity(dir)
    assert.equal(cur.identityId, legacy)
    // ensureIdentity 不会偷偷改老身份证
    const again = await ensureIdentity(dir)
    assert.equal(again.created, false)
    assert.equal(again.identity.identityId, legacy)

    const r = await reissueIdentity(dir)
    assert.equal(r.ok, true)
    assert.equal(r.changed, true)
    assert.equal(r.previousId, legacy)
    assert.match(r.identity.identityId, NEW_IDENTITY_RE)
    assert.equal(r.identity.legacyId, legacy)
    assert.equal(r.identity.lineageId, r.identity.identityId)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('身份证：过渡期 330105 格式也还能读，reissue 会换成 ds-fish-', async () => {
  const dir = await temp()
  try {
    const old = '330105202611010001'
    await mkdir(dir, { recursive: true })
    await writeFile(identityPath(dir), JSON.stringify({
      v: 1, identityId: old, childId: null, parentId: null,
      lineageId: old, generation: 1, createdAt: '2026-11-01T00:00:00.000Z',
    }), 'utf8')
    assert.match(old, GONGSHU_IDENTITY_RE)
    assert.equal((await readIdentity(dir)).identityId, old)
    const r = await reissueIdentity(dir)
    assert.equal(r.changed, true)
    assert.match(r.identity.identityId, NEW_IDENTITY_RE)
    assert.equal(r.identity.legacyId, old)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
