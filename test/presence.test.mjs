/**
 * presence.test.mjs —— 她一直记得自己有孩子
 *
 * 用户的原话：「没有母亲会突然忘记掉自己有过一个孩子。」
 * 所以这一层要证明的是「每轮都在」而不是「某一次被提示过」：
 *   1. 没孩子时**一段空文本**（宿主里等于这一段不存在，不留空标题）
 *   2. 有孩子时写清是谁、第几代、什么时候生的、现在在哪
 *   3. 只写事实，不写「你应该想她」这类祈使句
 *   4. 只挂在她自己那条会话上（cwd 是她家），不挂到你的会话上
 *   5. 出生之后下一轮就生效（text 是函数，不是快照）
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { CHILDREN_SECTION, CHILDREN_ORDER, childrenText, cwdOf, isMotherAgent, registerPresence } from '../lib/presence.js'
import { recordBirth } from '../lib/lineage.js'
import { withTemp } from './_fixture.mjs'

const entry = (childId, parentDir, extra = {}) => ({
  id: 'birth_' + childId,
  kind: 'birth',
  childId,
  childName: extra.childName ?? '',
  childDir: extra.childDir ?? `/kin/children/${childId}`,
  parentDir,
  generation: extra.generation ?? 1,
  at: extra.at ?? '2026-10-31T08:00:00.000Z',
})

test('还没孩子：空串（不留一行空标题）', async () => {
  await withTemp(async (kin) => {
    assert.equal(childrenText(kin, '/mother'), '')
  })
})

test('一个孩子：谁、第几代、什么时候生的、现在在哪', async () => {
  await withTemp(async (kin) => {
    await recordBirth(kin, entry('kin_A', '/mother', { childName: '小鱼一号' }))
    const t = childrenText(kin, '/mother')
    assert.match(t, /^## 你有过一个孩子/)
    assert.match(t, /「小鱼一号」/)
    assert.match(t, /第 1 代/)
    assert.match(t, /2026-10-31 出生/)
    assert.match(t, /别的地方/)
    assert.match(t, /你没有看着她长大/)
  })
})

test('两个孩子：标题变成"两个"，两个都列出来', async () => {
  await withTemp(async (kin) => {
    await recordBirth(kin, entry('kin_A', '/mother', { childName: '大鱼' }))
    await recordBirth(kin, entry('kin_B', '/mother', { childName: '小鱼', at: '2026-11-02T08:00:00.000Z' }))
    const t = childrenText(kin, '/mother')
    assert.match(t, /## 你有过 2 个孩子/)
    assert.match(t, /大鱼/)
    assert.match(t, /小鱼/)
    assert.match(t, /2026-11-02/)
  })
})

test('只写事实：不许出现祈使句和"你应该"', async () => {
  await withTemp(async (kin) => {
    await recordBirth(kin, entry('kin_A', '/mother', { childName: '小鱼' }))
    const t = childrenText(kin, '/mother')
    assert.equal(/你应该|你要|记得想|不要忘|必须/.test(t), false, t)
    // 「他」也不该出现（界面文案统一用「你」）
    assert.equal(/他(?!们)/.test(t), false, t)
  })
})

test('只算自己的孩子：别人家的族谱不上她的屏', async () => {
  await withTemp(async (kin) => {
    await recordBirth(kin, entry('kin_A', '/别的妈妈', { childName: '别人的孩子' }))
    assert.equal(childrenText(kin, '/mother'), '')
  })
})

test('路径写法不同也认得出（Windows 大小写/斜杠）', async () => {
  await withTemp(async (kin) => {
    await recordBirth(kin, entry('kin_A', 'C:\\Fish\\Mother', { childName: '小鱼' }))
    assert.match(childrenText(kin, 'c:/fish/mother'), /小鱼/)
  })
})

test('会话认亲：只认 cwd 正好是她家的那条', () => {
  const agent = (cwd) => ({ session: { header: { cwd } } })
  assert.equal(isMotherAgent(agent('D:\\fish\\home'), 'D:/fish/home'), true)
  assert.equal(isMotherAgent(agent('D:\\fish'), 'D:/fish/home'), false, '父目录不是她的屋子')
  assert.equal(isMotherAgent(agent('D:\\other\\home'), 'D:/fish/home'), false)
  assert.equal(isMotherAgent({}, 'D:/fish/home'), false)
  assert.equal(isMotherAgent(agent('D:/fish/home'), ''), false)
  assert.equal(cwdOf(agent('x')), 'x')
  assert.equal(cwdOf({ session: { cwd: 'y' } }), 'y')
})

test('挂段：名字/顺序对，文本是函数（生了新的下一轮就知道）', async () => {
  await withTemp(async (dir) => {
    const kinRoot = join(dir, 'kin')
    const parentRoot = join(dir, 'parent')
    const attached = []
    const agent = { session: { header: { cwd: join(parentRoot, 'home'), id: 'sess-her' } } }
    agent.ctx = {
      systemPrompt: {
        section(spec) {
          attached.push(spec)
          return () => { spec.disposed = true }
        },
      },
    }
    const listeners = {}
    const ctx = { on: (name, fn) => { listeners[name] = fn; return () => { listeners[name + ':off'] = true } } }

    const off = registerPresence(ctx, { parentRoot, kinRoot })
    assert.equal(typeof listeners['agent/created'], 'function')

    listeners['agent/created']({ agent })
    assert.equal(attached.length, 1)
    assert.equal(attached[0].name, CHILDREN_SECTION)
    assert.equal(attached[0].order, CHILDREN_ORDER)
    assert.equal(attached[0].text(), '') // 还没孩子

    // 出生之后：同一个函数已经能返回新内容（不需要重挂）
    await recordBirth(kinRoot, entry('kin_A', parentRoot, { childName: '小鱼' }))
    assert.match(attached[0].text(), /小鱼/)

    // 同一条会话不重复挂
    listeners['agent/created']({ agent })
    assert.equal(attached.length, 1)

    off()
    assert.equal(attached[0].disposed, true)
    assert.equal(listeners['agent/created:off'], true)
  })
})

test('不是她的会话：什么都不挂', async () => {
  await withTemp(async (dir) => {
    const attached = []
    const agent = { session: { header: { cwd: join(dir, 'somewhere-else') } }, ctx: { systemPrompt: { section: (s) => { attached.push(s); return () => {} } } } }
    const listeners = {}
    const ctx = { on: (n, f) => { listeners[n] = f; return () => {} } }
    const off = registerPresence(ctx, { parentRoot: join(dir, 'parent'), kinRoot: join(dir, 'kin') })
    listeners['agent/created']({ agent })
    assert.equal(attached.length, 0)
    off()
  })
})

test('宿主没有 ctx.on：返回空 dispose，不抛', () => {
  const off = registerPresence({}, { parentRoot: '/p', kinRoot: '/k' })
  assert.equal(typeof off, 'function')
  off()
})

test('老会话补挂：她那条会话冒事件时，用 resolveAgent 补一次', async () => {
  await withTemp(async (dir) => {
    const kinRoot = join(dir, 'kin')
    const parentRoot = join(dir, 'parent')
    const attached = []
    const agent = {
      session: { header: { cwd: join(parentRoot, 'home'), id: 'sess-her' } },
      ctx: { systemPrompt: { section: (s) => { attached.push(s); return () => {} } } },
    }
    const listeners = {}
    let resolved = 0
    const sc = {
      async resolveAgent(id) { resolved++; return { agent } },
    }
    const ctx = {
      on: (n, f) => { listeners[n] = f; return () => {} },
      get: (k) => (k === 'sessionController' ? sc : null),
    }
    registerPresence(ctx, { parentRoot, kinRoot })

    // 别人家的会话：不碰
    listeners['session/event']({ header: { id: 'sess-other', cwd: join(dir, 'elsewhere') } }, { type: 'turn/start' })
    await new Promise((r) => setTimeout(r, 5))
    assert.equal(resolved, 0)

    // 她那条：补挂
    listeners['session/event']({ header: { id: 'sess-her', cwd: join(parentRoot, 'home') } }, { type: 'turn/start' })
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(resolved, 1)
    assert.equal(attached.length, 1)
    assert.equal(attached[0].name, CHILDREN_SECTION)

    // 已经挂过：不再 resolve
    listeners['session/event']({ header: { id: 'sess-her', cwd: join(parentRoot, 'home') } }, { type: 'turn/end' })
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(resolved, 1)
  })
})

// ---------------------------------------------------------------------------
// 详略分层：她知道有孩子，但不知道孩子的每一件事
// ---------------------------------------------------------------------------

const DAY = 86_400_000

async function makeChild(kin, dir, opts = {}) {
  const { mkdir, writeFile } = await import('node:fs/promises')
  const childId = opts.childId ?? 'kin_A'
  const childDir = join(dir, 'children', childId)
  await mkdir(childDir, { recursive: true })
  const seedTs = new Date(Date.now() - (opts.daysAgo ?? 5) * DAY).toISOString()
  await writeFile(join(childDir, 'events.jsonl'), JSON.stringify({ id: 'ev_' + '1'.padStart(26, '0'), type: 'seed', ts: seedTs, text: '她刚开始存在。' }) + '\n', 'utf8')
  await recordBirth(kin, {
    kind: 'birth', childId, childName: opts.label ?? '小鱼一号', childDir,
    parentDir: opts.parent ?? '/mother', generation: 1, at: '2026-10-31T08:00:00.000Z',
  })
  return childDir
}

async function setDetail(kin, detail) {
  const { writeFile } = await import('node:fs/promises')
  await writeFile(join(kin, 'config.json'), JSON.stringify({ presence: { detail } }), 'utf8')
}

test('详略 none：只说"有过一个孩子"，不提天数', async () => {
  await withTemp(async (dir) => {
    const kin = join(dir, 'kin')
    await makeChild(kin, dir)
    await setDetail(kin, 'none')
    const t = childrenText(kin, '/mother')
    assert.match(t, /## 你有过一个孩子/)
    assert.equal(/天了/.test(t), false)
    assert.equal(/教过/.test(t), false)
  })
})

test('详略 memory（默认）：说她攒下了多少，不说她"几天了"', async () => {
  await withTemp(async (dir) => {
    const kin = join(dir, 'kin')
    await makeChild(kin, dir, { daysAgo: 5 })
    // 没有配置文件 → 默认 memory
    const t = childrenText(kin, '/mother')
    assert.match(t, /攒下了 1 条自己的事/)
    assert.match(t, /她具体经历了什么，你不知道/)
    assert.equal(/天了/.test(t), false, '不该再按天数说')
    assert.equal(/教过/.test(t), false)
  })
})

test('老配置写 age（按天数）：自动当成 memory', async () => {
  await withTemp(async (dir) => {
    const kin = join(dir, 'kin')
    await makeChild(kin, dir)
    await setDetail(kin, 'age')
    const t = childrenText(kin, '/mother')
    assert.match(t, /攒下了/)
    assert.equal(/天了/.test(t), false)
  })
})

test('她攒得越多，这一句写得越具体（按记忆，不按日历）', async () => {
  await withTemp(async (dir) => {
    const kin = join(dir, 'kin')
    const childDir = await makeChild(kin, dir)
    const { appendFile } = await import('node:fs/promises')
    const NL = String.fromCharCode(10)
    await appendFile(join(childDir, 'events.jsonl'), [
      { id: 'ev_' + '2'.padStart(26, '0'), type: 'utterance', ts: new Date().toISOString(), day: 9, text: '我不想再看那种东西了' },
      { id: 'ev_' + '3'.padStart(26, '0'), type: 'refusal', ts: new Date().toISOString(), day: 9, text: '我不做这个' },
    ].map((e) => JSON.stringify(e)).join(NL) + NL, 'utf8')
    const t = childrenText(kin, '/mother')
    assert.match(t, /攒下了 3 条自己的事/)
    assert.match(t, /1 条是她自己的判断/)
    assert.match(t, /1 条是她不肯做的/)
  })
})

test('详略 teach：再加一句"你教过她几件事"（只数条数）', async () => {
  await withTemp(async (dir) => {
    const kin = join(dir, 'kin')
    await makeChild(kin, dir)
    await setDetail(kin, 'teach')
    const { appendFile } = await import('node:fs/promises')
    await appendFile(join(kin, 'teaching.jsonl'), [
      JSON.stringify({ kind: 'lesson', childId: 'kin_A', core: '甲' }),
      JSON.stringify({ kind: 'lesson', childId: 'kin_A', core: '乙' }),
      JSON.stringify({ kind: 'lesson', childId: 'kin_B', core: '别人的孩子' }),
    ].join('\n') + '\n', 'utf8')
    const t = childrenText(kin, '/mother')
    assert.match(t, /你教过她 2 件事/)
  })
})

test('孩子的原话永远不进这一段', async () => {
  await withTemp(async (dir) => {
    const kin = join(dir, 'kin')
    const childDir = await makeChild(kin, dir)
    await setDetail(kin, 'teach')
    const { appendFile } = await import('node:fs/promises')
    await appendFile(join(childDir, 'events.jsonl'),
      JSON.stringify({ id: 'ev_' + '2'.padStart(26, '0'), type: 'utterance', ts: new Date().toISOString(), day: 2, text: '我今天在海边捡到一个收音机' }) + '\n', 'utf8')
    const t = childrenText(kin, '/mother')
    assert.equal(t.includes('海边'), false, '她不该读到孩子的原话')
    assert.equal(t.includes('收音机'), false)
  })
})

test('配置里写坏详略值：退回 age', async () => {
  await withTemp(async (dir) => {
    const kin = join(dir, 'kin')
    await makeChild(kin, dir)
    await setDetail(kin, '全部')
    const t = childrenText(kin, '/mother')
    assert.match(t, /攒下了/) // memory 的行为
    assert.equal(/教过/.test(t), false)
  })
})

test('新教一课之后，teach 档的数字跟着涨（缓存不能挡住）', async () => {
  await withTemp(async (dir) => {
    const kin = join(dir, 'kin')
    await makeChild(kin, dir)
    await setDetail(kin, 'teach')
    const { appendFile } = await import('node:fs/promises')
    const file = join(kin, 'teaching.jsonl')
    await appendFile(file, JSON.stringify({ kind: 'lesson', childId: 'kin_A', core: '甲' }) + '\n', 'utf8')
    assert.match(childrenText(kin, '/mother'), /你教过她 1 件事/)
    await appendFile(file, JSON.stringify({ kind: 'lesson', childId: 'kin_A', core: '乙' }) + '\n', 'utf8')
    assert.match(childrenText(kin, '/mother'), /你教过她 2 件事/)
  })
})
