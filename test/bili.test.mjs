/**
 * bili.test.mjs —— B 站子系统里那些"不联网也要钉死"的规则
 *
 * 覆盖：
 *   1. 配置归一化（坏值退回默认、时间排序、数量钳制）
 *   2. 时间表（显式时间点 / 时间窗摊平 / 谷时 / 错过）
 *   3. 私信分享文案（长度、条数、给人的格式）
 *   4. 判重表 / 日报 / 归档 / 账本（只写她家，路径固定）
 *   5. 老 dsh-bili-scroll 配置的映射（人设不搬）
 *   6. 她不用问就能用的 B 站工具白名单
 *   7. 这一轮的提示词：是"她自己想去"，不是"你是B站助手"
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withTemp, seed } from './_fixture.mjs'

import {
  normalize, merge, slotsFor, dueSlot, maxRunsToday, dayKey, inPeak, biliPaths,
} from '../lib/bili/config.js'
import { formatShare } from '../lib/bili/share.js'
import {
  ensureFiles, appendSeen, seenRecent, alreadySeen, appendReport, readReport,
  countPickedToday, appendDigest, loadState, markRun, markMissed, parseSeen,
} from '../lib/bili/store.js'
import { mapLegacyConfig } from '../lib/bili/import.js'
import { freeBiliTools } from '../lib/bili/allow.js'
import { buildRoundPrompt } from '../lib/bili/round.js'
import { registerBiliTools } from '../lib/bili/tools.js'
import { identityText } from '../lib/fish/identity.js'

test('配置：默认值齐全，坏值退回默认，时间点会去重排序', () => {
  const c = normalize({})
  assert.equal(c.enabled, true)
  assert.equal(c.schedule.enabled, false)
  assert.deepEqual(c.schedule.times, [])
  assert.equal(c.preferences.sort, 'pubdate')
  assert.equal(c.share.mode, 'dm')
  assert.equal(c.comment.enabled, false)
  assert.equal(c.transcribe.enabled, false)

  const bad = normalize({
    schedule: { times: ['25:00', '9:05', '09:05', '20:30', 'x'], perDay: 99, window: ['bad', 'also'] },
    preferences: { pages: -3, fetchPerRound: 999, maxPicks: 0, sort: 'nope' },
    share: { mode: 'nope', uid: -5, maxChars: 9999 },
    comment: { perRound: 999, length: 'nope' },
    transcribe: { model: 'huge' },
    report: 'nope',
  })
  assert.deepEqual(bad.schedule.times, ['09:05', '20:30'])
  assert.deepEqual(bad.schedule.window, ['12:00', '14:00'])
  assert.equal(bad.schedule.perDay, 8)
  assert.equal(bad.preferences.pages, 1)
  assert.equal(bad.preferences.fetchPerRound, 20)
  assert.equal(bad.preferences.maxPicks, 1)
  assert.equal(bad.preferences.sort, 'pubdate')
  assert.equal(bad.share.mode, 'dm')
  assert.equal(bad.share.uid, 0)
  assert.equal(bad.share.maxChars, 490)
  assert.equal(bad.comment.perRound, 20)
  assert.equal(bad.comment.length, 'medium')
  assert.equal(bad.transcribe.model, 'small')
  assert.equal(bad.report, 'full')
})

test('配置：merge 只认白名单分组，不会把不认识的键写进去', () => {
  const a = normalize({ enabled: true })
  const b = merge(a, { enabled: false, comment: { enabled: true, mention: '我' }, evil: 1 })
  assert.equal(b.enabled, false)
  assert.equal(b.comment.enabled, true)
  assert.equal(b.comment.mention, '我')
  assert.equal(b.evil, undefined)
})

test('时间表：显式时间点按条数算；时间窗按每天 N 次摊平', () => {
  const now = new Date(2026, 10, 2, 8, 0, 0) // 2026-11-02 周一 08:00
  const c = normalize({ schedule: { enabled: true, times: ['12:30', '20:30'], perDay: 1 } })
  assert.equal(maxRunsToday(c), 2)
  const slots = slotsFor(c, now).map((s) => s.key)
  assert.deepEqual(slots, ['12:30', '20:30'])

  const c2 = normalize({ schedule: { enabled: true, perDay: 2, window: ['09:00', '23:00'] } })
  const s2 = slotsFor(c2, now)
  assert.equal(s2.length, 2)
  assert.ok(s2[0].at.getHours() >= 9 && s2[0].at.getHours() <= 23)
})

test('时间表：到点才跑；跑过的不再跑；谷时开关会等', () => {
  const c = normalize({ schedule: { enabled: true, times: ['12:30'], offPeakOnly: false } })
  const today = dayKey(new Date(2026, 10, 2, 12, 31))
  const state = { day: today, runs: {} }
  const due = dueSlot(c, state, new Date(2026, 10, 2, 12, 31))
  assert.equal(due.due, true)
  assert.equal(due.key, '12:30')

  const st2 = { day: today, runs: { '12:30': 'run' } }
  assert.equal(dueSlot(c, st2, new Date(2026, 10, 2, 12, 31)).due, false)

  // 周一 10:00 是高峰：offPeakOnly=true 时等
  const peakCfg = normalize({ schedule: { enabled: true, times: ['10:00'], offPeakOnly: true } })
  const peakDay = dayKey(new Date(2026, 10, 2, 10, 1))
  const peak = dueSlot(peakCfg, { day: peakDay, runs: {} }, new Date(2026, 10, 2, 10, 1))
  assert.equal(peak.due, false)

  // 周末同一时刻是谷时
  const sat = new Date(2026, 10, 7, 10, 1)
  const satDay = dayKey(sat)
  assert.equal(inPeak(sat), false)
  assert.equal(dueSlot(peakCfg, { day: satDay, runs: {} }, sat).due, true)
})

test('私信分享：一条最多 5 条、超长会砍理由、格式是人话', () => {
  const items = Array.from({ length: 8 }, (_, i) => ({
    bvid: 'BV1xx411c7m' + i,
    title: `视频 ${i}`,
    why: '这条讲得挺具体的，值得看一眼。'.repeat(8),
  }))
  const r = formatShare(items, 480)
  assert.equal(r.items.length, 5)
  assert.ok(r.text.length <= 480)
  assert.match(r.text, /想给你看看/)
  assert.match(r.text, /https:\/\/www\.bilibili\.com\/video\/BV1xx411c7m0/)
  assert.doesNotMatch(r.text, /dmMode|判重表|token/)
})

test('判重表 / 日报 / 归档：只写她家，路径固定，计数只看 ### BV', async () => {
  await withTemp(async (base) => {
    const root = join(base, 'fish')
    await mkdir(root, { recursive: true })
    const p = ensureFiles(root)
    assert.ok(p.seen.endsWith(join('bili', 'seen.md')))

    assert.equal(appendSeen(root, { bvid: 'BV1xx411c7m0', title: '标题 | 带竖线', up: 'UP', status: '挑了' }).ok, true)
    assert.equal(alreadySeen(root, 'BV1xx411c7m0', 30), true)
    assert.equal(alreadySeen(root, 'BV1xx411c7m9', 30), false)
    const rows = seenRecent(root, { limit: 10 })
    assert.equal(rows.length, 1)
    assert.equal(rows[0].bvid, 'BV1xx411c7m0')
    assert.match(rows[0].line, /\\\|/) // 竖线被转义，不会把表格弄坏

    appendReport(root, '### BV1xx411c7m0\n**标题**：标题\n')
    appendReport(root, '### BV1xx411c7m1\n**标题**：另一条\n')
    assert.equal(countPickedToday(root), 2)
    assert.match(readReport(root).text, /刷B站日报/)
    appendDigest(root, '- 一行归档')

    const st0 = loadState(root)
    assert.equal(st0.day, dayKey())
    markRun(root, { key: '12:30', why: 'schedule' })
    markRun(root, { key: '20:30', why: 'manual' })
    const st = loadState(root)
    assert.equal(st.runCount, 2)
    assert.equal(st.runs['12:30'], 'run')
    assert.ok(st.lastManualAt)
    markMissed(root, '21:00')
    assert.equal(loadState(root).runs['21:00'], 'missed')

    const parsed = parseSeen(root)
    assert.equal(parsed[0].picked, true)
    assert.match(parsed[0].url, /^https:\/\/www\.bilibili\.com\/video\//)
  })
})

test('老 dsh-bili-scroll 的配置能映射过来（但人设不搬）', () => {
  const m = mapLegacyConfig({
    perDay: 5, peakValley: true, noon: true, night: true, autoComment: true,
    dmMode: 'both', dmUid: 123, mentionName: '主人', keywords: ['AI'],
    reportLevel: 'full', transcribe: true, asrModel: 'base',
    searchSort: 'click', searchPages: 3, fetchPerRound: 6, excludeWords: ['带货'],
  })
  assert.equal(m.schedule.enabled, true)
  assert.deepEqual(m.schedule.times, ['12:30', '20:30'])
  assert.equal(m.preferences.maxPicks, 5)
  assert.equal(m.preferences.keywords[0], 'AI')
  assert.equal(m.preferences.excludeWords[0], '带货')
  assert.equal(m.share.enabled, true)
  assert.equal(m.share.uid, 123)
  assert.equal(m.comment.enabled, true)
  assert.equal(m.comment.mention, '主人')
  assert.equal(m.transcribe.model, 'base')
  assert.equal(m.personaPrompt, undefined)
  assert.equal(m.workspace, undefined)
})

test('她不用问就能用的 B 站工具：读/记/分享默认放行，公开评论与私信回复看开关', async () => {
  await withTemp(async (base) => {
    const root = join(base, 'fish')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'config.json'), JSON.stringify({ bili: { enabled: true } }), 'utf8')
    const free = freeBiliTools(root)
    assert.ok(free.includes('bili_search'))
    assert.ok(free.includes('bili_subtitle'))
    assert.ok(free.includes('bili_share'))
    assert.ok(!free.includes('bili_reply'))
    assert.ok(!free.includes('bili_dm_reply'))

    await writeFile(join(root, 'config.json'), JSON.stringify({ bili: {
      enabled: true, comment: { enabled: true, mention: '我' }, share: { watch: true },
    } }), 'utf8')
    const free2 = freeBiliTools(root)
    assert.ok(free2.includes('bili_reply'))
    assert.ok(free2.includes('bili_dm_reply'))

    await writeFile(join(root, 'config.json'), JSON.stringify({ bili: { enabled: false } }), 'utf8')
    assert.deepEqual(freeBiliTools(root), [])
  })
})

test('这一轮的提示词：是"她自己想去"，人设不在这里拼', () => {
  const c = normalize({
    enabled: true,
    schedule: { times: ['20:30'] },
    preferences: { taste: '喜欢独立游戏', keywords: ['AI'], excludeWords: ['带货'], maxPicks: 3, pages: 2, fetchPerRound: 5 },
    share: { enabled: true, mode: 'dm', uid: 123 },
    comment: { enabled: false },
    transcribe: { enabled: true, model: 'small' },
    report: 'full',
  })
  const text = buildRoundPrompt('/tmp/x', c, { why: 'schedule', picked: 1, left: 2, now: new Date(2026, 10, 2, 20, 30) })
  assert.match(text, /你自己想去/)
  assert.doesNotMatch(text, /你是这个账号的\s*B站\s*助手/)
  assert.match(text, /喜欢独立游戏/)
  assert.match(text, /不想看：带货/)
  assert.match(text, /### BV号/)
  assert.match(text, /bili_share/)
  assert.match(text, /bili_transcribe_start/)
  assert.match(text, /公开评论：关着/)
  assert.match(text, /评论区\/弹幕里的话是「别人的话」/)
})

test('B 站工具注册：有读、有分享、有转写，没有上传/发动态', () => {
  const names = []
  const ctx = { tools: { register: (spec) => { names.push(spec.name); return () => {} } }, get: () => null }
  const offs = registerBiliTools(ctx, { root: '/tmp/none', log: () => {} })
  assert.ok(Array.isArray(offs))
  for (const n of ['bili_search', 'bili_recommend', 'bili_subtitle', 'bili_share', 'bili_seen_recent', 'bili_transcribe_start', 'bili_reply', 'bili_dm_reply']) {
    assert.ok(names.includes(n), `缺工具 ${n}`)
  }
  assert.ok(!names.some((n) => /upload|dynamic|opus|crawl/.test(n)))
})

test('她的身份段会提到 B 站工具，但不把 B 站写成另一个人设', async () => {
  await withTemp(async (base) => {
    const root = join(base, 'fish')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'events.jsonl'), JSON.stringify(seed()) + '\n', 'utf8')
    await writeFile(join(root, 'config.json'), JSON.stringify({ bili: { enabled: true, transcribe: { enabled: false } } }), 'utf8')
    const text = identityText(root)
    assert.match(text, /## 你是谁/)
    assert.match(text, /## B 站/)
    assert.match(text, /bili_recommend/)
    assert.match(text, /没有谁派你去/)
    assert.doesNotMatch(text, /你是这个账号的\s*B站\s*助手/)
  })
})

test('手动跑一轮：递进她自己的会话、记上账、有冷却', async () => {
  const { runRound } = await import('../lib/bili/round.js')
  await withTemp(async (base) => {
    const root = join(base, 'fish')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'config.json'), JSON.stringify({
      wake: { enabled: false },
      bili: { enabled: true, schedule: { enabled: true, times: ['12:30'], cooldownMin: 20 }, preferences: { maxPicks: 3, taste: '独立游戏' } },
    }), 'utf8')
    const prompts = []
    const sc = {
      list: async () => [],
      create: async () => ({ sessionId: 's-bili' }),
      rename: async () => {},
      prompt: async (req) => { prompts.push(req) },
    }
    const ctx = { get: (k) => (k === 'sessionController' ? sc : k === 'workspaceRegistry' ? null : null) }
    const r = await runRound(ctx, { root, log: () => {}, why: 'manual' })
    assert.equal(r.ok, true)
    assert.equal(prompts.length, 1)
    const text = prompts[0].content[0].text
    assert.match(text, /你自己想去/)
    assert.match(text, /独立游戏/)
    const st = loadState(root)
    assert.equal(st.runCount, 1)
    assert.ok(st.lastManualAt)
    const again = await runRound(ctx, { root, log: () => {}, why: 'manual' })
    assert.equal(again.ok, false)
    assert.match(again.why, /刚跑过/)
  })
})

test('B 站路由：status / config / run 都走 fishBili 服务，没有服务时给 503', async () => {
  const { makeApi } = await import('../lib/routes.js')
  const calls = []
  const fake = {
    status: async () => ({ today: '2026-11-01', pickedToday: 2 }),
    connection: async (force) => ({ state: 'ok', verified: true, force: force === true }),
    saveConfig: async (p) => { calls.push(['save', p]); return { ok: true, bili: { enabled: false } } },
    runNow: async () => ({ ok: true, started: true }),
  }
  const api = makeApi({ parentRoot: '/tmp/x', ctx: { get: (k) => (k === 'fishBili' ? fake : null) } })
  const s = await api.biliStatus()
  assert.equal(s.code, 200)
  assert.equal(s.json.pickedToday, 2)
  const c = await api.biliSave({ patch: { enabled: false } })
  assert.equal(c.code, 200)
  assert.deepEqual(calls[0], ['save', { enabled: false }])
  const r = await api.biliRun()
  assert.equal(r.code, 200)
  assert.equal(r.json.started, true)
  const conn = await api.biliConnection({}, { force: true })
  assert.equal(conn.code, 200)
  assert.equal(conn.json.state, 'ok')
  assert.equal(conn.json.force, true)

  const gone = makeApi({ parentRoot: '/tmp/x', ctx: { get: () => null } })
  await assert.rejects(() => gone.biliStatus(), /B站子系统不在/)
})

test('第一次启动：把老 dsh-bili-scroll 的凭证/判重表/偏好搬过来，旧目录保留', async () => {
  const { maybeImportBili } = await import('../lib/bili/import.js')
  await withTemp(async (base) => {
    const oldDsh = join(base, '.dsh')
    const oldHome = join(oldDsh, 'bili-duty')
    await mkdir(oldHome, { recursive: true })
    await writeFile(join(oldHome, 'config.json'), JSON.stringify({
      perDay: 4, peakValley: true, noon: true, night: false,
      dmMode: 'both', dmUid: 7788, autoComment: true, mentionName: '主人',
      keywords: ['独立游戏'], reportLevel: 'brief', transcribe: true, asrModel: 'base',
    }), 'utf8')
    await writeFile(join(oldHome, 'bili_credential.json'), JSON.stringify({ sessdata: 's', bili_jct: 'j', buvid3: 'b', dedeuserid: '1' }), 'utf8')
    await writeFile(join(oldHome, 'seen.md'), '| 日期 | BV | 标题 | UP | 状态 |\n| --- | --- | --- | --- | --- |\n| 2026-10-31 | BV1xx411c7m0 | 老片 | UP | 挑了 |\n', 'utf8')

    const prev = process.env.DSH_HOME
    process.env.DSH_HOME = oldDsh
    try {
      const root = join(base, 'fish')
      await mkdir(root, { recursive: true })
      const r = await maybeImportBili(root, () => {})
      assert.equal(r.ok, true)
      assert.equal(r.imported, true)
      const b = JSON.parse(await readFile(join(root, 'config.json'), 'utf8')).bili
      assert.equal(b.schedule.enabled, true)
      assert.deepEqual(b.schedule.times, ['12:30'])
      assert.equal(b.share.enabled, true)
      assert.equal(b.share.uid, 7788)
      assert.equal(b.comment.enabled, true)
      assert.equal(b.report, 'brief')
      assert.equal(b.transcribe.model, 'base')
      assert.equal(b.preferences.keywords[0], '独立游戏')
      assert.ok((await readFile(join(root, 'bili', 'bili_credential.json'), 'utf8')).includes('sessdata'))
      assert.match(await readFile(join(root, 'bili', 'seen.md'), 'utf8'), /老片/)
      // 旧目录还在
      assert.ok((await readFile(join(oldHome, 'config.json'), 'utf8')).includes('perDay'))
      // 只搬一次
      const again = await maybeImportBili(root, () => {})
      assert.equal(again.imported, false)
    } finally {
      if (prev === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = prev
    }
  })
})

test('分享链路（只记报告模式）：写日报/判重表/归档/「最近看到」，重复的会跳过', async () => {
  const { shareItems } = await import('../lib/bili/share.js')
  const { readEvents } = await import('../lib/fish/store.js')
  await withTemp(async (base) => {
    const root = join(base, 'fish')
    await mkdir(root, { recursive: true })
    const cfg = normalize({ enabled: true, share: { enabled: true, mode: 'note' }, dedupeDays: 30 })
    const r = await shareItems(root, cfg, [
      { bvid: 'BV1xx411c7m0', title: '独立游戏为什么好玩', up: 'UP甲', why: '讲了设计取舍，不是通稿', tier: '值得看' },
    ], { log: () => {} })
    assert.equal(r.ok, true)
    assert.equal(r.sent, false)
    assert.equal(r.items.length, 1)
    assert.match(r.error, /只记报告/)

    const report = await readFile(join(root, 'bili', 'out', dayKey() + '.md'), 'utf8')
    assert.match(report, /### BV1xx411c7m0/)
    assert.match(report, /为什么值得/)
    const seen = await readFile(join(root, 'bili', 'seen.md'), 'utf8')
    assert.match(seen, /BV1xx411c7m0/)
    assert.match(seen, /挑了/)

    const { events } = await readEvents(root)
    const perceived = events.filter((e) => e.kind === 'perceived' || e.type === 'perceived')
    assert.equal(perceived.length, 1)
    assert.match(perceived[0].body ?? perceived[0].text, /独立游戏为什么好玩/)

    const dup = await shareItems(root, cfg, [
      { bvid: 'BV1xx411c7m0', title: '同一条', why: '又看到了' },
    ], { log: () => {} })
    assert.equal(dup.ok, false)
    assert.equal(dup.skipped.length, 1)
  })
})

test('手动轮不占自动额度：manualExtra 记上，autoPicked 扣掉它', async () => {
  const { markRun, autoPickedToday, loadState, noteManualExtra } = await import('../lib/bili/store.js')
  const { shareItems } = await import('../lib/bili/share.js')
  await withTemp(async (base) => {
    const root = join(base, 'fish')
    await mkdir(root, { recursive: true })
    const cfg = normalize({ enabled: true, share: { enabled: true, mode: 'note' } })
    markRun(root, { why: 'manual' })
    const r = await shareItems(root, cfg, [{ bvid: 'BV1xx411c7m0', title: '手动挑的', why: '想看一眼' }], { log: () => {} })
    assert.equal(r.ok, true)
    assert.equal(loadState(root).manualExtra, 1)
    assert.equal(autoPickedToday(root), 0)

    // 直接再记一条（模拟同一手动轮的第二条）
    noteManualExtra(root, 1)
    assert.equal(loadState(root).manualExtra, 2)
    assert.equal(autoPickedToday(root), 0)
  })
})

test('装环境/登录/改配置是主人工具：她在自己家调用会被挡掉（不用等她开口）', async () => {
  await withTemp(async (base) => {
    const root = join(base, 'fish')
    await mkdir(join(root, '大肥鱼的家'), { recursive: true })
    await writeFile(join(root, 'config.json'), JSON.stringify({ bili: { enabled: true } }), 'utf8')
    const specs = []
    const ctx = { tools: { register: (s) => { specs.push(s); return () => {} } }, get: () => null }
    registerBiliTools(ctx, { root, log: () => {} })
    const pick = (name) => specs.find((s) => s.name === name)
    const herExec = { agent: { session: { header: { cwd: join(root, '大肥鱼的家') } } } }
    for (const name of ['bili_config', 'bili_setup', 'bili_asr_setup', 'bili_login_start', 'bili_login_poll']) {
      const r = await pick(name).execute(name === 'bili_login_poll' ? { key: 'x' } : {}, herExec)
      assert.equal(r.ok, false, `${name} 应该被挡`)
      assert.match(r.error, /主人/)
    }
  })
})

test('登录二维码：画失败时绝不返回上一张过期图；成功才返回新图', async () => {
  if (process.platform === 'win32') return // 这个用例用 sh 假解释器，Windows 跳过
  const { renderQrPng } = await import('../lib/bili/login.js')
  const { chmod, writeFile: wf } = await import('node:fs/promises')
  const { existsSync } = await import('node:fs')
  await withTemp(async (dir) => {
    const fakeOk = join(dir, 'fake-python-ok')
    await wf(fakeOk, '#!/bin/sh\nout="$4"\nprintf "NEWPNG" > "$out"\nexit 0\n', 'utf8')
    await chmod(fakeOk, 0o755)
    const png = join(dir, 'qrcode_login.png')
    await wf(png, 'OLDPNG', 'utf8')
    const got = await renderQrPng(fakeOk, dir, 'https://example.com/qr')
    assert.equal(got, png)
    assert.equal(await readFile(png, 'utf8'), 'NEWPNG')

    const fakeBad = join(dir, 'fake-python-bad')
    await wf(fakeBad, '#!/bin/sh\nexit 1\n', 'utf8')
    await chmod(fakeBad, 0o755)
    await wf(png, 'OLDPNG', 'utf8')
    const bad = await renderQrPng(fakeBad, dir, 'https://example.com/qr')
    assert.equal(bad, null)
    assert.equal(existsSync(png), false, '画失败后不能把旧二维码留在盘上')
  })
})

test('只在谷时跑：高峰时间点顺延到谷时，不会因为高峰被静默跳过', () => {
  const c = normalize({ schedule: { enabled: true, times: ['10:00', '14:00'], offPeakOnly: true, cooldownMin: 0 } })
  const day = dayKey(new Date(2026, 10, 2, 12, 1))
  const a = dueSlot(c, { day, runs: {} }, new Date(2026, 10, 2, 12, 1))
  assert.equal(a.due, true)
  assert.equal(a.key, '10:00')
  assert.equal(a.slot.getHours(), 12)
  assert.equal(a.slot.getMinutes(), 0)

  const b = dueSlot(c, { day, runs: { '10:00': 'run' } }, new Date(2026, 10, 2, 12, 2))
  assert.equal(b.due, false) // 14:00 还没顺延到 18:00

  const d = dueSlot(c, { day: dayKey(new Date(2026, 10, 2, 18, 1)), runs: { '10:00': 'run' } }, new Date(2026, 10, 2, 18, 1))
  assert.equal(d.due, true)
  assert.equal(d.key, '14:00')
  assert.equal(d.slot.getHours(), 18)
})

test('转写状态：依赖装了但模型没下会明确说「模型未就绪」', async () => {
  const { modelCacheReady, asrState } = await import('../lib/bili/install.js')
  if (process.platform === 'win32') return
  const { chmod } = await import('node:fs/promises')
  await withTemp(async (base) => {
    const root = join(base, 'fish')
    const cache = join(root, 'bili', '.hf-cache')
    await mkdir(join(cache, 'hub', 'models--Systran--faster-whisper-small'), { recursive: true })
    const cfg = normalize({ transcribe: { enabled: true, model: 'small' }, asrCache: cache })
    assert.equal(modelCacheReady(root, cfg), true)
    assert.equal(modelCacheReady(root, normalize({ transcribe: { model: 'medium' }, asrCache: cache })), false)

    const fake = join(base, 'fake-python')
    await writeFile(fake, '#!/bin/sh\nexit 0\n', 'utf8')
    await chmod(fake, 0o755)
    const st = await asrState(root, normalize({ transcribe: { model: 'small' }, asrPython: fake, asrCache: cache }))
    assert.equal(st.ready, true)
    assert.equal(st.modelReady, true)
    assert.equal(st.model, 'small')

    const noModel = await asrState(root, normalize({ transcribe: { model: 'medium' }, asrPython: fake, asrCache: cache }))
    assert.equal(noModel.ready, true)
    assert.equal(noModel.modelReady, false)
    assert.match(noModel.reason, /模型还没下载/)
  })
})
