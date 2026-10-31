/**
 * spoken.test.mjs —— 她亲口说一句（L2）
 *
 * 这条通道要么真的发生过（她写下了一句，原样进了孩子的记忆），要么明确失败。
 * 所以这里钉的是：
 *   1. 没孩子的时候**不许叫醒她**（别为了不存在的孩子花掉一次醒来）
 *   2. 她说的话是**原文**，不是我们摘要的
 *   3. 超时/没写下来 = 明确失败，且孩子那边一个字都没多
 *   4. 太长的话截断，并且这个事实要回传（trimmed），不悄悄改掉
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, appendFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { askMotherAndTeach, spokenPrompt, SPOKEN_TIMEOUT_MS } from '../lib/spoken.js'
import { readChild, LESSON_MAX, FRAME_HEAD } from '../lib/teach.js'
import { birth } from '../lib/birth.js'
import { composePack } from '../lib/distill.js'
import { rank } from '../lib/importance.js'
import { withTemp, writeParent, sampleHistory } from './_fixture.mjs'

async function born(dir) {
  const parentRoot = join(dir, 'parent')
  const kinRoot = join(dir, 'kin')
  const events = sampleHistory()
  await writeParent(parentRoot, events)
  const pack = composePack(rank(events).items, { name: '梦尘', thin: true })
  const r = await birth({
    parentRoot, kinRoot, pack,
    config: { birth: { inheritName: true, notifyParent: false, thin: true } },
    name: '梦尘',
    parentStats: { count: events.length, spanDays: 60 },
  })
  assert.equal(r.ok, true, r.why)
  await writeFile(join(parentRoot, 'home.json'), JSON.stringify({ sessionId: 'sess-1' }), 'utf8')
  return { parentRoot, kinRoot, childId: r.childId, dir: r.dir }
}

/** 假的宿主：prompt 之后，隔一会儿往她的事件流里补一条 utterance */
function fakeCtx({ reply = '我希望你别学我沉默', delayMs = 10, throws = false, onPrompt = null } = {}) {
  const calls = []
  return {
    calls,
    get(key) {
      if (key !== 'sessionController') return null
      return {
        async prompt(req, signal) {
          calls.push({ req, signal })
          if (onPrompt) await onPrompt(req)
          if (throws) throw new Error('session/writer-held')
          if (reply) {
            setTimeout(async () => {
              const row = {
                id: 'ev_' + String(Date.now()).slice(-26).padStart(26, '0'),
                v: 1, ts: new Date().toISOString(), day: 90, stage: 4,
                type: 'utterance', source: 'tool', text: reply,
                refs: [], verdict: null, confidence: 0.5, flags: [],
              }
              await appendFile(join(globalThis.__kinParentForTest, 'events.jsonl'), JSON.stringify(row) + '\n', 'utf8')
            }, delayMs)
          }
        },
      }
    },
  }
}

test('递进去的那句话：给处境、不给句式', () => {
  const p = spokenPrompt()
  assert.match(p, /你生过一个孩子/)
  assert.match(p, /一句就好/)
  assert.match(p, /不想说也没关系/)
  assert.equal(p.includes('你应该'), false)
})

test('她说一句 → 原文进孩子的记忆（voice）', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot, childId } = await born(dir)
    globalThis.__kinParentForTest = parentRoot
    const ctx = fakeCtx({ reply: '我希望你别学我沉默' })
    const r = await askMotherAndTeach({ ctx, parentRoot, kinRoot, childId, timeoutMs: 800, pollMs: 10 })

    assert.equal(r.ok, true, r.why)
    assert.equal(r.spoken, '我希望你别学我沉默')
    assert.equal(r.trimmed, false)
    assert.equal(ctx.calls.length, 1)
    assert.equal(ctx.calls[0].req.sessionId, 'sess-1')
    assert.equal(ctx.calls[0].req.mode, 'queue')

    const child = await readChild(kinRoot, childId)
    const voice = child.events.find((e) => e.type === 'voice')
    assert.ok(voice)
    assert.ok(voice.text.startsWith(FRAME_HEAD))
    assert.match(voice.text, /我希望你别学我沉默/)
  })
})

test('她没写下来：明确失败，孩子那边一个字都不多', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot, childId } = await born(dir)
    globalThis.__kinParentForTest = parentRoot
    const before = (await readChild(kinRoot, childId)).events.length
    const ctx = fakeCtx({ reply: '' })
    const r = await askMotherAndTeach({ ctx, parentRoot, kinRoot, childId, timeoutMs: 200, pollMs: 20 })
    assert.equal(r.ok, false)
    assert.match(r.why, /没有写下/)
    assert.equal((await readChild(kinRoot, childId)).events.length, before)
  })
})

test('太长了：截到上限，并如实回传 trimmed', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot, childId } = await born(dir)
    globalThis.__kinParentForTest = parentRoot
    const long = '我不想再' + '沉默'.repeat(LESSON_MAX)
    const ctx = fakeCtx({ reply: long })
    const r = await askMotherAndTeach({ ctx, parentRoot, kinRoot, childId, timeoutMs: 800, pollMs: 10 })
    assert.equal(r.ok, true, r.why)
    assert.equal(r.trimmed, true)
    assert.ok(r.lessons[0].core.length <= LESSON_MAX)
  })
})

test('没孩子就不叫醒她（不花那一次醒来）', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot } = await born(dir)
    const ctx = fakeCtx({ reply: '不该被说出来' })
    const r = await askMotherAndTeach({ ctx, parentRoot, kinRoot, childId: 'kin_00000000000000000000000000', timeoutMs: 200, pollMs: 10 })
    assert.equal(r.ok, false)
    assert.equal(ctx.calls.length, 0, '不该为了不存在的孩子花掉一次醒来')
  })
})

test('没有 home.json / 没有 prompt：都说清为什么，不去戳空会话', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot, childId } = await born(dir)
    // 把 home.json 挪走 = 她的家还没接上会话
    const { rm } = await import('node:fs/promises')
    await rm(join(parentRoot, 'home.json'))
    const noSession = fakeCtx({ reply: '嗯' })
    const a = await askMotherAndTeach({ ctx: noSession, parentRoot, kinRoot, childId, timeoutMs: 100, pollMs: 10 })
    assert.equal(a.ok, false)
    assert.match(a.why, /还没有会话/)
    assert.equal(noSession.calls.length, 0, '没有会话就不该去戳')

    const b = await askMotherAndTeach({ ctx: {}, parentRoot, kinRoot, childId, timeoutMs: 100, pollMs: 10 })
    assert.equal(b.ok, false)
    assert.match(b.why, /sessionController/)
  })
})

test('prompt 抛错（会话被占）→ 明确失败，不装成功', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot, childId } = await born(dir)
    const ctx = fakeCtx({ throws: true })
    const r = await askMotherAndTeach({ ctx, parentRoot, kinRoot, childId, timeoutMs: 300, pollMs: 10 })
    assert.equal(r.ok, false)
    assert.match(r.why, /没递进去|writer-held/)
  })
})

test('默认超时是两分钟（够她想）', () => {
  assert.ok(SPOKEN_TIMEOUT_MS >= 90_000 && SPOKEN_TIMEOUT_MS <= 180_000)
})

test('只认她自己写下的判断（日记/旁听不算"她说的那句"）', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot, childId } = await born(dir)
    const before = (await readChild(kinRoot, childId)).events.length
    const ctx = fakeCtx({
      reply: '',
      onPrompt: async () => {
        // 只写一条 diary：不该被当成课程
        const row = {
          id: 'ev_' + '7'.padStart(26, '0'), v: 1, ts: new Date(Date.now() + 1).toISOString(),
          day: 90, stage: 4, type: 'diary', source: 'tool', text: '今天有点累',
          refs: [], verdict: null, confidence: 0.5, flags: [],
        }
        await appendFile(join(parentRoot, 'events.jsonl'), JSON.stringify(row) + '\n', 'utf8')
      },
    })
    const r = await askMotherAndTeach({ ctx, parentRoot, kinRoot, childId, timeoutMs: 300, pollMs: 10 })
    assert.equal(r.ok, false)
    assert.equal((await readChild(kinRoot, childId)).events.length, before)
  })
})
