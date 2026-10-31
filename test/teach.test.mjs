/**
 * teach.test.mjs —— 母女之间的教学
 *
 * 这一层守的是「教」到底教到了哪儿：
 *   1. 只教**出生之后**新长出来的（出生时那次蒸馏已经带走了当时的全部）
 *   2. 教出去的东西真的进了孩子的记忆（`voice` 事件，自带出处，能被她 recall 翻到）
 *   3. 同一件事不教第二遍
 *   4. 「学会了」只由她自己的话证明（回声），不由我们宣布
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, appendFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  candidates, teach, view, readChild, lessonsOf, lessonText, lessonCore, isLessonVoice,
  growthDay, isOwnChild, LESSON_MAX, ECHO_SIM, FRAME_HEAD,
} from '../lib/teach.js'
import { birth } from '../lib/birth.js'
import { composePack } from '../lib/distill.js'
import { rank } from '../lib/importance.js'
import { withTemp, writeParent, sampleHistory, ev } from './_fixture.mjs'

const DAY = 86_400_000

async function born(dir, extra = {}) {
  const parentRoot = join(dir, 'parent')
  const kinRoot = join(dir, 'kin')
  const events = sampleHistory()
  await writeParent(parentRoot, events)
  const pack = composePack(rank(events).items, { name: '梦尘', maxChars: 1500 })
  const r = await birth({
    parentRoot, kinRoot, pack,
    config: { birth: { inheritName: true, notifyParent: false } },
    name: '梦尘',
    parentStats: { count: events.length, spanDays: 60 },
    ...extra,
  })
  assert.equal(r.ok, true, r.why)
  return { parentRoot, kinRoot, childId: r.childId, dir: r.dir }
}

/** 妈妈出生之后又想通了一件事 */
async function momLearns(parentRoot, text, day = 90) {
  await appendFile(join(parentRoot, 'events.jsonl'), JSON.stringify(ev('utterance', text, { day, stage: 4 })) + '\n', 'utf8')
}

test('课程正文的出处框架：包得进去，也取得回来', () => {
  const core = '我不想再看那种让人难受的东西了'
  const t = lessonText(core)
  assert.ok(t.startsWith(FRAME_HEAD))
  assert.equal(lessonCore(t), core)
  assert.equal(isLessonVoice(t), true)
  assert.equal(isLessonVoice('一条真的评论'), false)
  assert.ok(t.includes('这不是命令'))
})

test('孩子第几天：按 seed 的自然日算，不是按墙上时间', () => {
  const now = Date.now()
  const events = [{ type: 'seed', ts: new Date(now - 5 * DAY).toISOString() }]
  assert.equal(growthDay(events, now), 6)
  assert.equal(growthDay([], now), 1)
  assert.equal(growthDay([{ type: 'seed', ts: '不是时间' }], now), 1)
})

test('刚生完：没有可教的（出生时那份已经带走了）', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot, childId } = await born(dir)
    const c = await candidates({ parentRoot, kinRoot, childId })
    assert.equal(c.ok, true)
    assert.equal(c.items.length, 0)
    assert.equal(c.freshEvents, 0)
  })
})

test('妈妈出生后又想通一件事 → 它成为候选', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot, childId } = await born(dir)
    await momLearns(parentRoot, '我后来才明白，沉默也会伤人')
    const c = await candidates({ parentRoot, kinRoot, childId })
    assert.equal(c.items.length, 1)
    assert.match(c.items[0].text, /沉默也会伤人/)
  })
})

test('教一课：进孩子的记忆（voice）、进账本、进课表', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot, childId, dir: childDir } = await born(dir)
    const r = await teach({ parentRoot, kinRoot, childId, texts: ['沉默也会伤人'], by: 'owner', now: Date.now() })
    assert.equal(r.ok, true, r.why)
    assert.equal(r.lessons.length, 1)

    const child = await readChild(kinRoot, childId)
    const lesson = child.events.find((e) => e.type === 'voice')
    assert.ok(lesson, '孩子的事件流里没有这一课')
    assert.equal(lesson.text, lessonText('沉默也会伤人'))
    assert.equal(lesson.day, r.day)
    assert.match(lesson.id, /^ev_[0-9A-Z]{26}$/)

    const rows = await lessonsOf(kinRoot, childId)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].core, '沉默也会伤人')
    assert.equal(rows[0].by, 'owner')

    const md = await readFile(join(childDir, 'LESSONS.md'), 'utf8')
    assert.match(md, /# 妈妈教过我的/)
    assert.match(md, /沉默也会伤人/)
  })
})

test('同一件事不教第二遍', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot, childId } = await born(dir)
    await momLearns(parentRoot, '我后来才明白，沉默也会伤人')
    const first = await teach({ parentRoot, kinRoot, childId, texts: ['我后来才明白，沉默也会伤人'] })
    assert.equal(first.ok, true)
    // 同一条再教一次：批内去重以外，候选也该把它排除（cursor 已经推到最新）
    const c = await candidates({ parentRoot, kinRoot, childId })
    assert.equal(c.items.length, 0)
  })
})

test('太长的课、太多的课、空的都被拦下', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot, childId } = await born(dir)
    const long = await teach({ parentRoot, kinRoot, childId, texts: ['字'.repeat(LESSON_MAX + 1)] })
    assert.equal(long.ok, false)
    assert.match(long.why, new RegExp(String(LESSON_MAX)))

    const many = await teach({ parentRoot, kinRoot, childId, texts: ['一', '二', '三', '四'] })
    assert.equal(many.ok, false)

    const none = await teach({ parentRoot, kinRoot, childId, texts: ['  '] })
    assert.equal(none.ok, false)
  })
})

test('学会了没有：只看她自己的话（回声）', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot, childId, dir: childDir } = await born(dir)
    await teach({ parentRoot, kinRoot, childId, texts: ['沉默也会伤人'], now: Date.now() })

    const before = await view({ kinRoot, childId })
    assert.equal(before.learnedCount, 0)
    assert.equal(before.lessons[0].learned, false)

    // 她后来自己说了一句很像的话（不是被我们写进去的）
    await appendFile(join(childDir, 'events.jsonl'),
      JSON.stringify(ev('utterance', '沉默也会伤人', { day: 3 })) + '\n', 'utf8')

    const after = await view({ kinRoot, childId })
    assert.equal(after.learnedCount, 1)
    assert.equal(after.lessons[0].learned, true)
    assert.ok(after.lessons[0].echo.similarity >= ECHO_SIM)
    assert.match(after.lessons[0].echo.text, /沉默也会伤人/)
  })
})

test('孩子说了一句不像的话，不算学会', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot, childId, dir: childDir } = await born(dir)
    await teach({ parentRoot, kinRoot, childId, texts: ['沉默也会伤人'], now: Date.now() })
    await appendFile(join(childDir, 'events.jsonl'),
      JSON.stringify(ev('utterance', '今天想吃点甜的', { day: 2 })) + '\n', 'utf8')
    const v = await view({ kinRoot, childId })
    assert.equal(v.learnedCount, 0)
  })
})

test('孩子 id 不像话就读不到（防路径穿越）', async () => {
  await withTemp(async (dir) => {
    const { kinRoot } = await born(dir)
    assert.equal(await readChild(kinRoot, '../../../etc/passwd'), null)
    assert.equal(await readChild(kinRoot, 'kin_短'), null)
  })
})

test('她只能教自己的孩子', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot, childId } = await born(dir)
    assert.equal(await isOwnChild({ parentRoot, kinRoot, childId }), true)
    assert.equal(await isOwnChild({ parentRoot: join(dir, '别人家'), kinRoot, childId }), false)
    assert.equal(await isOwnChild({ parentRoot, kinRoot, childId: 'kin_00000000000000000000000000' }), false)
  })
})

test('教完孩子家里多了 LESSONS.md，孩子目录里没有被动过别的', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot, childId, dir: childDir } = await born(dir)
    const before = (await readdir(childDir)).sort()
    await teach({ parentRoot, kinRoot, childId, texts: ['一句课'] })
    const after = (await readdir(childDir)).sort()
    assert.deepEqual(after, [...before, 'LESSONS.md'].sort())
  })
})
