/**
 * birth.test.mjs —— 产房真的写出了一个孩子
 *
 * 这一层要证明的是「她能被 dsh-fish 直接养起来」，所以要逐条对格式：
 *   1. events.jsonl 第一条是 seed，day=1，id 形状对
 *   2. **没有** import-mark（孩子不继承"别人养的"那条豁免）
 *   3. 继承称呼走 import-name，继承工具走 config.tools.allow
 *   4. 族谱追加一条，出生证明与接生单都在
 *   5. 对母代只追加一行，原有内容一个字节都没动
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { birth, certificateText } from '../lib/birth.js'
import { readParentEvents } from '../lib/read.js'
import { readLineage } from '../lib/lineage.js'
import { withTemp, writeParent, readParentRaw, sampleHistory } from './_fixture.mjs'
import { composePack } from '../lib/distill.js'
import { rank } from '../lib/importance.js'

const CONFIG = { birth: { inheritName: true, inheritTools: true, notifyParent: true, maxPackChars: 1500 } }

async function born(dir) {
  const parentRoot = join(dir, 'parent')
  const kinRoot = join(dir, 'kin')
  const events = sampleHistory()
  await writeParent(parentRoot, events)
  const pack = composePack(rank(events).items, { name: '梦尘', maxChars: 1500 })
  const r = await birth({
    parentRoot,
    kinRoot,
    pack,
    config: CONFIG,
    trigger: 'owner',
    label: '小鱼一号',
    name: '梦尘',
    tools: ['skill'],
    parentStats: { count: events.length, spanDays: 60 },
    now: Date.UTC(2026, 9, 31, 8, 0, 0),
  })
  return { parentRoot, kinRoot, events, pack, r }
}

test('孩子落地：目录、seed、证明、接生单', async () => {
  await withTemp(async (dir) => {
    const { r } = await born(dir)
    assert.equal(r.ok, true, r.why)
    assert.match(r.childId, /^kin_[0-9A-Z]{26}$/)
    assert.equal(r.generation, 1)

    const raw = await readFile(join(r.dir, 'events.jsonl'), 'utf8')
    const evs = raw.trim().split('\n').map((l) => JSON.parse(l))
    assert.equal(evs[0].kind, 'seed')
    assert.equal(evs[0].day, 1)
    assert.match(evs[0].id, /^fe_[0-9A-Z]{26}$/)
    assert.match(evs[0].body, /可以不同意其中任何一条/)
    // 孩子不继承那条豁免
    assert.equal(evs.some((e) => String(e.body ?? '').startsWith('import-mark:')), false)
    // 继承称呼
    const nameEv = evs.find((e) => String(e.body ?? '').startsWith('import-name:'))
    assert.equal(nameEv.body, 'import-name:梦尘')

    const cert = await readFile(r.certificatePath, 'utf8')
    assert.match(cert, /# 出生证明/)
    assert.match(cert, /小鱼一号/)

    const id = JSON.parse(await readFile(join(r.dir, 'identity.json'), 'utf8'))
    assert.match(id.identityId, /^fish_[0-9A-Z]{26}$/)
    assert.equal(id.childId, r.childId)
    assert.equal(id.generation, 1)
    assert.match(id.identityId, /^fish_/)
    assert.match(id.parentId, /^fish_/)
    assert.match(cert, new RegExp(id.identityId))
    const parentId = JSON.parse(await readFile(join(r.parentRoot, 'identity.json'), 'utf8'))
    assert.equal(parentId.identityId, id.parentId)
    assert.equal(parentId.lineageId, id.lineageId)
    const handover = await readFile(r.handoverPath, 'utf8')
    assert.match(handover, /## 你是谁/)
  })
})

test('工具白名单写进孩子的 config', async () => {
  await withTemp(async (dir) => {
    const { r } = await born(dir)
    const cfg = JSON.parse(await readFile(join(r.dir, 'config.json'), 'utf8'))
    assert.deepEqual(cfg.tools.allow, ['skill'])
  })
})

test('族谱追加一条，代际与母代路径都在', async () => {
  await withTemp(async (dir) => {
    const { r, kinRoot, parentRoot } = await born(dir)
    const { entries } = await readLineage(kinRoot)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].childId, r.childId)
    assert.equal(entries[0].parentDir, parentRoot)
    assert.equal(entries[0].generation, 1)
    assert.equal(entries[0].packItems, r.entry.packItems)
    assert.ok(Array.isArray(entries[0].fingerprint.h))
  })
})

test('对母代只追加一行报喜，原有内容一个字节都没动', async () => {
  await withTemp(async (dir) => {
    const parentRoot = join(dir, 'parent')
    const events = sampleHistory()
    await writeParent(parentRoot, events)
    const before = await readParentRaw(parentRoot)
    const pack = composePack(rank(events).items, { name: '梦尘', maxChars: 1500 })
    await birth({ parentRoot, kinRoot: join(dir, 'kin'), pack, config: CONFIG, name: '梦尘', parentStats: { count: events.length, spanDays: 60 } })
    const after = await readParentRaw(parentRoot)
    assert.equal(after.startsWith(before), true)
    const extra = after.slice(before.length).trim().split('\n')
    assert.equal(extra.length, 1)
    assert.match(JSON.parse(extra[0]).body, /^kin-birth:kin_/)
    // 母代仍然读得出来（多一条 meta 不影响任何东西）
    const reread = await readParentEvents(parentRoot)
    assert.equal(reread.events.length, events.length + 1)
    assert.equal(reread.skipped, 0)
  })
})

test('notifyParent=false 时母代一个字都不动', async () => {
  await withTemp(async (dir) => {
    const parentRoot = join(dir, 'parent')
    const events = sampleHistory()
    await writeParent(parentRoot, events)
    const before = await readParentRaw(parentRoot)
    const pack = composePack(rank(events).items, { maxChars: 1500 })
    await birth({
      parentRoot, kinRoot: join(dir, 'kin'), pack,
      config: { birth: { ...CONFIG.birth, notifyParent: false } },
      parentStats: { count: events.length, spanDays: 60 },
    })
    assert.equal(await readParentRaw(parentRoot), before)
  })
})

test('超过 2000 字的包直接拒收（写进去会整条失败）', async () => {
  const pack = { body: '字'.repeat(2001), chars: 2001, limit: 2000, picked: [] }
  const r = await birth({ parentRoot: '/tmp/x', kinRoot: '/tmp/y', pack, config: CONFIG })
  assert.equal(r.ok, false)
  assert.match(r.why, /2000/)
})

test('没有遗传包就不生', async () => {
  const r = await birth({ parentRoot: '/tmp/x', kinRoot: '/tmp/y', pack: null })
  assert.equal(r.ok, false)
})

test('出生证明里给出能直接用的 root 配置', () => {
  const text = certificateText({
    childId: 'kin_X', childLabel: '小鱼', at: '2026-10-31', childDir: 'D:/k/children/kin_X',
    parentRoot: 'D:/p', parentEvents: 3, parentDays: 2, generation: 1,
    pack: { body: '正文', chars: 2, limit: 1500, picked: [] }, tools: [],
    trigger: 'owner', approvedBy: '', requestId: '', siblings: 0,
  })
  assert.match(text, /root: D:\/k\/children\/kin_X/)
  assert.match(text, /接生单/)
})


test('CDDA 经验有损继承：出生包只带 3 条，子代有独立文件', async () => {
  await withTemp(async (dir) => {
    const parentRoot = join(dir, 'parent')
    const kinRoot = join(dir, 'kin')
    const events = sampleHistory()
    await writeParent(parentRoot, events)
    await writeFile(join(parentRoot, 'cdda-lessons.json'), JSON.stringify({
      v: 1,
      lessons: [
        { text: '水必须煮沸', confidence: 0.9, scope: 'skill' },
        { text: '晚上不要走街道', confidence: 0.8, scope: 'skill' },
        { text: '先找避难所', confidence: 0.7, scope: 'skill' },
        { text: '这个基地在东边', confidence: 0.99, scope: 'world' },
      ],
    }))
    const pack = composePack(rank(events).items, { name: '梦尘', maxChars: 1500 })
    const r = await birth({ parentRoot, kinRoot, pack, config: CONFIG, parentStats: { count: events.length, spanDays: 60 } })
    assert.equal(r.ok, true, r.why)
    const seed = JSON.parse((await readFile(join(r.dir, 'events.jsonl'), 'utf8')).trim().split('\n')[0])
    assert.match(seed.body, /## 她玩过的游戏/)
    assert.match(seed.body, /水必须煮沸/)
    assert.doesNotMatch(seed.body, /这个基地在东边/)
    const inherited = JSON.parse(await readFile(join(r.dir, 'cdda-lessons.json'), 'utf8'))
    assert.equal(inherited.lessons.length, 3)
    assert.equal(inherited.parentId, JSON.parse(await readFile(join(parentRoot, 'identity.json'), 'utf8')).identityId)
  })
})
