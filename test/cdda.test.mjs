import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readCddaLessons, selectCddaLessons, childCddaPath } from '../lib/cdda.js'

async function temp() { return mkdtemp(join(tmpdir(), 'fish-cdda-')) }

test('CDDA 经验：只取 skill/高置信度，最多 3 条/300 字', async () => {
  const dir = await temp()
  try {
    const lessons = []
    for (let i = 0; i < 10; i++) {
      lessons.push({ text: `第 ${i} 条经验，水要煮沸，晚上不要走街道`, confidence: i === 9 ? 0.9 : 0.7, scope: 'skill' })
    }
    await writeFile(join(dir, 'cdda-lessons.json'), JSON.stringify({ v: 1, lessons }))
    const all = await readCddaLessons(dir)
    assert.equal(all.length, 10)
    const picked = selectCddaLessons(all, { maxItems: 3, maxChars: 300 })
    assert.ok(picked.length <= 3)
    assert.ok(picked.reduce((n, x) => n + x.text.length, 0) <= 300)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('CDDA 经验：没有文件/坏文件返回空', async () => {
  const dir = await temp()
  try {
    assert.deepEqual(await readCddaLessons(dir), [])
    await writeFile(join(dir, 'cdda-lessons.json'), '{bad')
    assert.deepEqual(await readCddaLessons(dir), [])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('CDDA 经验：子代路径在 child 目录', () => {
  assert.equal(childCddaPath('/kin/children/kin_x'), '/kin/children/kin_x/cdda-lessons.json')
})
