/**
 * service.test.mjs —— 整条链：读 → 蒸馏 → 立单 → 批 → 生
 *
 * 这是唯一一个把五个写盘点串起来的测试。它要证明的是账能对上：
 * 族谱、出生证明、孩子的事件流、决定账本，四处说的是同一件事。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as svc from '../lib/service.js'
import { readLineage } from '../lib/lineage.js'
import { readDecisions } from '../lib/pending.js'
import { withTemp, writeParent, sampleHistory, ev } from './_fixture.mjs'

async function setup(dir, { pressureEvents = null } = {}) {
  const parentRoot = join(dir, 'parent')
  const kinRoot = join(dir, 'kin')
  await writeParent(parentRoot, sampleHistory())
  await mkdir(kinRoot, { recursive: true })
  if (pressureEvents) {
    await writeFile(join(kinRoot, 'config.json'), JSON.stringify({ pressure: { events: pressureEvents } }), 'utf8')
  }
  return { parentRoot, kinRoot }
}

test('snapshot：没有存档时说"没找到"，不崩', async () => {
  await withTemp(async (dir) => {
    const s = await svc.snapshot({ parentRoot: join(dir, 'nope'), kinRoot: join(dir, 'kin') })
    assert.equal(s.parent.exists, false)
    assert.equal(s.pressure.level, 'ok')
    assert.equal(s.kin.generation, 1)
  })
})

test('snapshot：读出条数、天数、称呼、代数', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot } = await setup(dir)
    const s = await svc.snapshot({ parentRoot, kinRoot })
    assert.equal(s.parent.exists, true)
    assert.equal(s.parent.count, sampleHistory().length)
    assert.equal(s.parent.spanDays, 60)
    assert.equal(s.parent.name, '梦尘')
    assert.equal(s.kin.generation, 1)
  })
})

test('preview：给出遗传包但不落盘', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot } = await setup(dir)
    const p = await svc.preview({ parentRoot, kinRoot })
    assert.equal(p.ok, true)
    assert.ok(p.pack.picked.length > 0)
    assert.ok(p.pack.chars <= 1500)
    assert.equal(p.kin.ok, true)
    assert.match(p.pack.body, /她认定过的事|她拒绝过的事/)
    // 没有立单
    const s = await svc.snapshot({ parentRoot, kinRoot })
    assert.equal(s.pending.length, 0)
  })
})

test('立单 → 批准 → 生：账四处对得上', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot } = await setup(dir)
    const made = await svc.request({ parentRoot, kinRoot, trigger: 'her', note: '她要的' })
    assert.equal(made.ok, true, made.why)

    // 有待批时不许再立一张
    const again = await svc.request({ parentRoot, kinRoot })
    assert.equal(again.ok, false)
    assert.match(again.why, /待批/)

    const born = await svc.approve({ parentRoot, kinRoot, id: made.request.id, by: 'owner' })
    assert.equal(born.ok, true, born.why)
    assert.equal(born.generation, 1)

    // 孩子真的有 seed
    const evs = (await readFile(join(born.dir, 'events.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
    assert.equal(evs[0].kind, 'seed')

    // 族谱一条，且指向这张请求单
    const { entries } = await readLineage(kinRoot)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].requestId, made.request.id)
    assert.equal(entries[0].trigger, 'her')
    assert.equal(entries[0].approvedBy, 'owner')

    // 决定账本：approve
    const log = await readDecisions(kinRoot)
    assert.equal(log[0].kind, 'approve')

    // 单子被消化掉了
    const s = await svc.snapshot({ parentRoot, kinRoot, now: Date.now() })
    assert.equal(s.pending.length, 0)
    assert.equal(s.kin.children, 1)
  })
})

test('驳回：不生孩子，族谱不长', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot } = await setup(dir)
    const made = await svc.request({ parentRoot, kinRoot })
    const r = await svc.reject({ parentRoot, kinRoot, id: made.request.id, why: '还不到时候' })
    assert.equal(r.ok, true)
    const { entries } = await readLineage(kinRoot)
    assert.equal(entries.length, 0)
    assert.equal((await readDecisions(kinRoot))[0].why, '还不到时候')
  })
})

test('直接生要 confirm，没有确认就不建目录', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot } = await setup(dir)
    const no = await svc.directBirth({ parentRoot, kinRoot })
    assert.equal(no.ok, false)
    assert.match(no.why, /confirm/)
    const yes = await svc.directBirth({ parentRoot, kinRoot, confirm: 'birth' })
    assert.equal(yes.ok, true, yes.why)
  })
})

test('同一个妈、同一份记忆：第二次被当成复制品拦下', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot } = await setup(dir)
    const first = await svc.directBirth({ parentRoot, kinRoot, confirm: 'birth' })
    assert.equal(first.ok, true)
    // 母代一条新记忆都没长，遗传包必然和第一个孩子一样
    const second = await svc.directBirth({ parentRoot, kinRoot, confirm: 'birth' })
    assert.equal(second.ok, false)
    assert.match(second.why, /复制|重合/)
    // 明确要强行生才生
    const forced = await svc.directBirth({ parentRoot, kinRoot, confirm: 'birth', forceKin: true })
    assert.equal(forced.ok, true)
    assert.equal((await readLineage(kinRoot)).entries.length, 2)
  })
})

test('孩子长大后再生：代数自己变成第 2 代', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot } = await setup(dir)
    const first = await svc.directBirth({ parentRoot, kinRoot, confirm: 'birth' })
    assert.equal(first.ok, true)

    // 让这个孩子真的长大一点：往她的存档里追加几句她自己的话
    await appendFile(join(first.dir, 'events.jsonl'),
      [ev('utterance', '我自己决定了一件事，不后悔', { day: 4 }), ev('refusal', '这次我不答应', { day: 6 })].map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8')

    const s = await svc.snapshot({ parentRoot: first.dir, kinRoot })
    assert.equal(s.kin.generation, 2)
    assert.equal(s.parent.count, 4) // seed + import-name + 两句

    const second = await svc.directBirth({ parentRoot: first.dir, kinRoot, confirm: 'birth' })
    assert.equal(second.ok, true, second.why)
    assert.equal(second.generation, 2)
    const { entries } = await readLineage(kinRoot)
    assert.equal(entries.length, 2)
    assert.equal(entries[1].parentDir, first.dir)
  })
})

test('自动提议：默认关；开了也只是立单，不是生', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot } = await setup(dir, { pressureEvents: 3 })
    const off = await svc.autoPropose({ parentRoot, kinRoot })
    assert.equal(off.ok, false)
    assert.equal(off.skipped, true)

    await writeFile(join(kinRoot, 'config.json'), JSON.stringify({ pressure: { events: 3 }, auto: { propose: true } }), 'utf8')
    const on = await svc.autoPropose({ parentRoot, kinRoot })
    assert.equal(on.ok, true, JSON.stringify(on))
    const s = await svc.snapshot({ parentRoot, kinRoot })
    assert.equal(s.pending.length, 1)
    assert.equal(s.pending[0].trigger, 'auto')
    assert.equal((await readLineage(kinRoot)).entries.length, 0) // 没有生
  })
})

test('lineageView：给界面的一行一代', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot } = await setup(dir)
    const empty = await svc.lineageView({ parentRoot, kinRoot })
    assert.equal(empty.total, 0)
    await svc.directBirth({ parentRoot, kinRoot, confirm: 'birth', label: '小鱼一号' })
    const v = await svc.lineageView({ parentRoot, kinRoot })
    assert.equal(v.total, 1)
    assert.equal(v.lines[0].childName, '小鱼一号')
    assert.equal(v.generation, 1)
  })
})

test('环境参数：读得到默认值，写只认白名单', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot } = await setup(dir)
    const v = await svc.configView({ parentRoot, kinRoot })
    assert.equal(v.ok, true)
    assert.equal(v.config.pressure.events, 1200)
    assert.equal(v.config.auto.propose, false)

    // 白名单外的键原样退回，不静默吞掉
    const bad = await svc.saveConfig({ persona: { mood: '温柔' }, pressure: { events: 50 }, 好感度: 99 }, { parentRoot, kinRoot })
    assert.equal(bad.ok, true)
    assert.ok(bad.ignored.includes('persona'))
    assert.deepEqual(bad.config.pressure.events, 50)

    // 只有非法键时什么都不写
    const none = await svc.saveConfig({ persona: {} }, { parentRoot, kinRoot })
    assert.equal(none.ok, false)
  })
})

test('环境参数：越界的数被裁剪（遗传包不许超过事件正文上限）', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot } = await setup(dir)
    const r = await svc.saveConfig({ birth: { maxPackChars: 99999, maxItems: 999 } }, { parentRoot, kinRoot })
    assert.equal(r.ok, true)
    assert.equal(r.config.birth.maxPackChars, 2000)
    assert.equal(r.config.birth.maxItems, 60)
  })
})

test('环境参数一改，压力立刻跟着变（不是只写进文件）', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot } = await setup(dir)
    assert.equal((await svc.snapshot({ parentRoot, kinRoot })).pressure.level, 'ok')
    // 下限是 5（写 3 会被裁到 5），9 条记忆 / 5 = 1.8 倍，直接 hot
    await svc.saveConfig({ pressure: { events: 5 } }, { parentRoot, kinRoot })
    const after = await svc.snapshot({ parentRoot, kinRoot })
    assert.equal(after.pressure.level, 'hot')
    assert.equal(after.config.pressure.events, 5)
  })
})

test('教学：没孩子时拒绝，只有一个孩子时默认它', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot } = await setup(dir)
    const none = await svc.teachPreview({ parentRoot, kinRoot })
    assert.equal(none.ok, false)
    assert.match(none.why, /还没有孩子/)

    const born = await svc.directBirth({ parentRoot, kinRoot, confirm: 'birth' })
    assert.equal(born.ok, true)
    const one = await svc.teachPreview({ parentRoot, kinRoot })
    assert.equal(one.ok, true)
    assert.equal(one.childId, born.childId)
    // 刚生完没有新东西可教
    assert.equal(one.items.length, 0)
  })
})

test('教学：出生之后妈妈想通的事，教得过去、也看得见回声', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot } = await setup(dir)
    const born = await svc.directBirth({ parentRoot, kinRoot, confirm: 'birth' })
    // 妈妈又长了一条
    await appendFile(join(parentRoot, 'events.jsonl'),
      JSON.stringify({ id: 'ev_' + '2'.padStart(26, '0'), v: 1, ts: new Date().toISOString(), day: 120, stage: 4, type: 'utterance', source: 'tool', text: '我后来才明白，沉默也会伤人', refs: [], verdict: null, confidence: 0.5, flags: [] }) + '\n',
      'utf8')

    const pre = await svc.teachPreview({ parentRoot, kinRoot })
    assert.equal(pre.ok, true)
    assert.equal(pre.items.length, 1)

    const taught = await svc.teachNow({ parentRoot, kinRoot, by: 'owner' })
    assert.equal(taught.ok, true, taught.why)
    assert.equal(taught.lessons.length, 1)

    const v = await svc.teachView({ parentRoot, kinRoot })
    assert.equal(v.ok, true)
    assert.equal(v.total, 1)
    assert.equal(v.learnedCount, 0)

    // 孩子自己说了一句像的 → 算回声
    await appendFile(join(born.dir, 'events.jsonl'),
      JSON.stringify({ id: 'ev_' + '3'.padStart(26, '0'), v: 1, ts: new Date().toISOString(), day: 3, stage: 1, type: 'utterance', source: 'tool', text: '我后来才明白，沉默也会伤人', refs: [], verdict: null, confidence: 0.5, flags: [] }) + '\n',
      'utf8')
    const after = await svc.teachView({ parentRoot, kinRoot })
    assert.equal(after.learnedCount, 1)
  })
})

test('教学：关掉之后连显式教也拒绝', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot } = await setup(dir)
    await svc.directBirth({ parentRoot, kinRoot, confirm: 'birth' })
    await svc.saveConfig({ teach: { enabled: false } }, { parentRoot, kinRoot })
    const r = await svc.teachNow({ parentRoot, kinRoot, texts: ['随便一句'] })
    assert.equal(r.ok, false)
    assert.match(r.why, /教学关着/)
  })
})

test('环境参数：边界/判断条数也走白名单，且被夹在 0–12', async () => {
  await withTemp(async (dir) => {
    const { parentRoot, kinRoot } = await setup(dir)
    const r = await svc.saveConfig({ birth: { maxBoundaries: 6, maxBeliefs: 1 } }, { parentRoot, kinRoot })
    assert.equal(r.ok, true)
    assert.equal(r.config.birth.maxBoundaries, 6)
    assert.equal(r.config.birth.maxBeliefs, 1)

    const clamped = await svc.saveConfig({ birth: { maxBoundaries: 99, maxBeliefs: -3 } }, { parentRoot, kinRoot })
    assert.equal(clamped.config.birth.maxBoundaries, 12)
    assert.equal(clamped.config.birth.maxBeliefs, 0)

    // 生效到预览里
    const pre = await svc.preview({ parentRoot, kinRoot })
    assert.ok(pre.pack.picked.filter((x) => x.cls === 'belief').length <= 0)
  })
})

test('遗传包带疤与立场：拒绝过又松口、同一件事说过多次', async () => {
  await withTemp(async (dir) => {
    const parentRoot = join(dir, 'parent')
    const kinRoot = join(dir, 'kin')
    const refusal = ev('refusal', '我不做这个，说什么也不做', { day: 2 })
    const events = [
      ev('seed', '你不是助手。你刚开始存在。'),
      refusal,
      ev('revise', '我不做这个了，其实也行', { day: 20, refs: [refusal.id] }),
      ev('utterance', '我不喜欢被安排', { day: 3 }),
      ev('utterance', '我不喜欢被安排。', { day: 30 }),
    ]
    await writeParent(parentRoot, events)
    await mkdir(kinRoot, { recursive: true })

    const p = await svc.preview({ parentRoot, kinRoot })
    assert.equal(p.ok, true, p.why)
    assert.match(p.pack.body, /## 她栽过的跟头/, p.pack.body)
    assert.match(p.pack.body, /后来改成了/)
    assert.match(p.pack.body, /## 她反复说过的事/)
    assert.ok(p.pack.chars <= 900, `实际 ${p.pack.chars}`)

    // 关掉疤：配置值要真的生效
    await writeFile(join(kinRoot, 'config.json'), JSON.stringify({ birth: { maxScars: 0, maxStances: 0 } }), 'utf8')
    const p2 = await svc.preview({ parentRoot, kinRoot })
    assert.equal(p2.pack.body.includes('她栽过的跟头'), false)
    assert.equal(p2.pack.body.includes('她反复说过的事'), false)
  })
})
