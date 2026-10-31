/**
 * lineage.test.mjs —— 族谱与防近亲
 *
 * 族谱只追加，所以它的正确性完全由「从路径与代数现算」保证。
 * 这里守的是三件事：
 *   1. 孩子长大再生孩子，代数自动 +1（不需要手填家谱）
 *   2. 同一个妈生了几个数得出来（冷却与展示都用它）
 *   3. 两份几乎一样的遗传包不许当成"新一代"（那不是繁衍，是复制）
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { recordBirth, readLineage, generationOf, childrenOf, lastBirthEvents, findEntryByDir, kinCheck, flatLines } from '../lib/lineage.js'
import { fingerprint } from '../lib/distill.js'
import { withTemp } from './_fixture.mjs'

const entry = (childId, parentDir, generation, extra = {}) => ({
  id: 'birth_' + childId,
  kind: 'birth',
  childId,
  childName: extra.childName ?? '',
  childDir: extra.childDir ?? `/kin/children/${childId}`,
  parentDir,
  generation,
  at: '2026-10-31T00:00:00.000Z',
  parentEvents: extra.parentEvents ?? 100,
  packChars: 900,
  fingerprint: extra.fingerprint ?? fingerprint('一份东西'),
})

test('空族谱和第 1 代', async () => {
  await withTemp(async (kin) => {
    const { entries } = await readLineage(kin)
    assert.deepEqual(entries, [])
    assert.equal(generationOf(entries, '/some/mother'), 1)
  })
})

test('路径对上了就是上一代的孩子：代数自动 +1', async () => {
  await withTemp(async (kin) => {
    await recordBirth(kin, entry('kin_A', '/orig/parent', 1))
    const { entries } = await readLineage(kin)
    // 把 A 的存档目录当成"母代"来生 —— 就是第三代
    const g = generationOf(entries, '/kin/children/kin_A')
    assert.equal(g, 2)
    assert.equal(findEntryByDir(entries, '/kin/children/kin_A').childId, 'kin_A')
  })
})

test('路径大小写与斜杠方向不影响认亲（Windows）', async () => {
  await withTemp(async (kin) => {
    await recordBirth(kin, entry('kin_A', '/orig/parent', 1))
    const { entries } = await readLineage(kin)
    // 同一个目录换个写法仍然认得出来
    assert.equal(findEntryByDir(entries, '/KIN/Children/KIN_A')?.childId, 'kin_A')
    assert.equal(generationOf(entries, '/KIN/Children/KIN_A'), 2)
    // 别的路径不会瞎认亲
    assert.equal(findEntryByDir(entries, '/kin/children/kin_B'), null)
  })
})

test('同一个妈生了几个、上次生的时候她多大', async () => {
  await withTemp(async (kin) => {
    const mom = '/mother'
    await recordBirth(kin, entry('kin_A', mom, 1, { parentEvents: 800 }))
    await recordBirth(kin, entry('kin_B', mom, 1, { parentEvents: 1600 }))
    const { entries } = await readLineage(kin)
    assert.equal(childrenOf(entries, mom).length, 2)
    assert.equal(lastBirthEvents(entries, mom), 1600)
    assert.equal(lastBirthEvents(entries, '/nobody'), null)
  })
})

test('近亲检查：几乎一样的包被拦，不一样的放行', async () => {
  const same = fingerprint('她拒绝过这件事，她认定那件事，她管你叫梦尘。')
  const other = fingerprint('完全不同的经历：海边的风、修不好的旧收音机、一只总在窗台上的猫。')
  const entries = [entry('kin_A', '/p', 1, { childName: '小鱼', fingerprint: same })]
  const blocked = kinCheck(entries, same)
  assert.equal(blocked.ok, false)
  assert.ok(blocked.why.includes('小鱼'))
  const passed = kinCheck(entries, other)
  assert.equal(passed.ok, true)
  assert.ok(passed.similarity < 0.75)
})

test('族谱平铺：带代际与兄弟姐妹数', async () => {
  await withTemp(async (kin) => {
    await recordBirth(kin, entry('kin_A', '/p', 1))
    await recordBirth(kin, entry('kin_B', '/p', 1))
    const lines = flatLines((await readLineage(kin)).entries)
    assert.equal(lines.length, 2)
    assert.equal(lines[0].siblings, 2)
  })
})

test('坏行不会让血统断掉', async () => {
  await withTemp(async (kin) => {
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(kin, { recursive: true })
    await writeFile(join(kin, 'lineage.jsonl'), '{坏的\n' + JSON.stringify(entry('kin_A', '/p', 1)) + '\n', 'utf8')
    const { entries, skipped } = await readLineage(kin)
    assert.equal(entries.length, 1)
    assert.equal(skipped, 1)
  })
})
