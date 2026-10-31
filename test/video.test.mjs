/**
 * video.test.mjs —— 看画面（ffmpeg 抽帧 + 封面兜底）
 *
 * 本机没有 ffmpeg 也要测：用假的 spawn 验参数、验 PNG 魔数校验、验失败原因说人话。
 * 这两条都是 dsh-fish 真机上踩过的坑：
 *   1. 输出交给 ffmpeg 写盘会被沙箱拒（所以走 stdout，我们自己写）
 *   2. ffmpeg 把报错写进 stdout 时，不校验魔数就会把一段文字当图存下来
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withTemp } from './_fixture.mjs'
import { detectFfmpeg, grabTile, saveCover, outPath } from '../lib/fish/video.js'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

function fakeSpawn({ stdout = '', stderr = '', code = 0, error = null, args = null } = {}) {
  return (bin, argv) => {
    const p = new EventEmitter()
    p.stdout = new EventEmitter()
    p.stderr = new EventEmitter()
    p.kill = () => {}
    if (args) args.push({ bin, argv })
    setImmediate(() => {
      if (error) { p.emit('error', new Error(error)); return }
      if (stdout) p.stdout.emit('data', Buffer.from(stdout))
      if (stderr) p.stderr.emit('data', Buffer.from(stderr))
      p.emit('close', code)
    })
    return p
  }
}

test('探测：有 ffmpeg / 没有 ffmpeg 都说清楚', async () => {
  const ok = await detectFfmpeg({ spawnImpl: fakeSpawn({ stdout: 'ffmpeg version 6.1\n' }), fresh: true })
  assert.equal(ok.ok, true)
  assert.match(ok.version, /ffmpeg version 6\.1/)

  const no = await detectFfmpeg({ spawnImpl: fakeSpawn({ error: 'spawn ffmpeg ENOENT' }), fresh: true })
  assert.equal(no.ok, false)
  assert.match(no.why, /没有 ffmpeg/)
})

test('抽帧：走 stdout、校验 PNG、自己写盘', async () => {
  await withTemp(async (dir) => {
    const calls = []
    const out = join(dir, 'out', 'BV1.png')
    const r = await grabTile({ url: 'https://example.com/x.m4s', out, duration: 90, spawnImpl: fakeSpawn({ stdout: PNG, args: calls }) })
    assert.equal(r.ok, true, r.why)
    assert.equal(r.bytes, PNG.length)
    assert.equal(r.frames, 9)

    const buf = await readFile(out)
    assert.deepEqual(buf, PNG)

    // 参数：从 http 拉流、tile 滤镜、输出走 image2pipe
    const argv = calls[0].argv
    assert.equal(argv.includes('-i'), true)
    assert.equal(argv[argv.indexOf('-i') + 1], 'https://example.com/x.m4s')
    assert.match(argv[argv.indexOf('-vf') + 1], /tile=3x3/)
    assert.equal(argv.includes('image2pipe'), true)
    assert.equal(argv[argv.length - 1], '-')
  })
})

test('抽帧：stdout 不是 PNG（比如一段报错）就不落盘', async () => {
  await withTemp(async (dir) => {
    const out = join(dir, 'out', 'bad.png')
    const r = await grabTile({ url: 'https://x/y', out, spawnImpl: fakeSpawn({ stdout: 'Error: something failed\n', code: 1 }) })
    assert.equal(r.ok, false)
    assert.match(r.why, /不是 PNG|没有吐出图/)
    await assert.rejects(readFile(out))
  })
})

test('抽帧：没有地址就明确说没有', async () => {
  const r = await grabTile({ url: '', out: '/tmp/x.png' })
  assert.equal(r.ok, false)
  assert.match(r.why, /没有可用的视频地址/)
})

test('封面兜底：存下来；失败说清楚', async () => {
  await withTemp(async (dir) => {
    const out = join(dir, 'out', 'BV1.jpg')
    const ok = await saveCover({ picUrl: 'https://i0.hdslb.com/x.jpg', out, fetchImpl: async () => ({ ok: true, arrayBuffer: async () => PNG }) })
    assert.equal(ok.ok, true, ok.why)
    const bad = await saveCover({ picUrl: 'https://i0.hdslb.com/x.jpg', out: join(dir, 'o2.jpg'), fetchImpl: async () => ({ ok: false, status: 403 }) })
    assert.equal(bad.ok, false)
    assert.match(bad.why, /403/)
  })
})

test('输出路径只留安全字符', () => {
  const p = outPath('/r', 'BV1../xx?y', 'png')
  assert.equal(p.includes('..'), false)
  assert.ok(p.endsWith('BV1xxy.png'), p)
  assert.ok(p.includes('out'))
})

test('复用：看过的同一条不再抽帧（省 token 第一招）', async () => {
  const { cachedWatchPath } = await import('../lib/fish/video.js')
  const { mkdir, utimes, writeFile } = await import('node:fs/promises')
  await withTemp(async (root) => {
    assert.equal(await cachedWatchPath(root, 'BV1xx411c7mD', 7), null)

    const p = outPath(root, 'BV1xx411c7mD', 'png')
    await mkdir(join(root, 'out'), { recursive: true })
    await writeFile(p, PNG)

    const hit = await cachedWatchPath(root, 'BV1xx411c7mD', 7)
    assert.equal(hit.kind, 'watch')
    assert.equal(hit.path, p)

    // 过期：7 天前
    const old = (Date.now() - 8 * 86_400_000) / 1000
    await utimes(p, old, old)
    assert.equal(await cachedWatchPath(root, 'BV1xx411c7mD', 7), null)

    // 关掉复用
    assert.equal(await cachedWatchPath(root, 'BV1xx411c7mD', 0), null)
  })
})

test('事件去重：同一条视频只留一行 note', async () => {
  const { noteOnce } = await import('../lib/fish/index.js')
  const { readEvents } = await import('../lib/fish/store.js')
  await withTemp(async (root) => {
    assert.equal(await noteOnce(root, 'bili-watch:BV1x'), true)
    assert.equal(await noteOnce(root, 'bili-watch:BV1x'), false)
    const { events } = await readEvents(root)
    assert.equal(events.filter((e) => e.text === 'bili-watch:BV1x').length, 1)
  })
})

test('看画面的预算可调：帧数与缩放都收在配置里', async () => {
  const { loadConfig, DEFAULTS } = await import('../lib/fish/wake.js')
  await withTemp(async (root) => {
    const cfg = await loadConfig(root)
    assert.deepEqual(cfg.bili.watch, DEFAULTS.bili.watch)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(root, 'config.json'), JSON.stringify({ bili: { watch: { cols: 2, rows: 2, scale: 240, reuseDays: 0 } } }), 'utf8')
    const c2 = await loadConfig(root)
    assert.deepEqual(c2.bili.watch, { cols: 2, rows: 2, scale: 240, reuseDays: 0 })
    // 越界值被夹住
    await writeFile(join(root, 'config.json'), JSON.stringify({ bili: { watch: { cols: 99, rows: -1, scale: 5000 } } }), 'utf8')
    const c3 = await loadConfig(root)
    assert.deepEqual(c3.bili.watch, { cols: 3, rows: 1, scale: 720, reuseDays: 7 })
  })
})
