/**
 * fish/video.js —— 真的"看画面"：用 ffmpeg 抽几帧拼一张
 *
 * 路线照 dsh-fish 验过的那套（B 站给 DASH 地址，ffmpeg 能直接从 http 拉流并 seek）：
 *   playurl → ffmpeg -ss … -i <url> -vf "scale,tile=3x3" → 一张 PNG → read_image 看
 *
 * 两个坑，都是它踩过我们直接照抄的：
 *   1. **不要把输出路径交给 ffmpeg**：沙箱只允许插件进程自己写盘，ffmpeg 子进程写会被拒，
 *      现象是"playurl 正常、却一帧都取不到"。所以走 stdout（image2pipe），我们收字节自己写。
 *   2. **必须校验 PNG 魔数**：ffmpeg 出错时会把报错写进 stdout，不校验就会把一段文字当图存下来。
 *
 * 本机没有 ffmpeg 时**不装可怜**：明确说"本机没装 ffmpeg"，并退回封面图（如果拿得到）。
 */

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47])

let ffCache = null

/** 本机有没有 ffmpeg（一次探测，结果缓存；可注入 spawnImpl 做测试）。 */
export async function detectFfmpeg({ spawnImpl = spawn, fresh = false } = {}) {
  if (ffCache && !fresh) return ffCache
  ffCache = await new Promise((resolve) => {
    let done = false
    const finish = (v) => { if (!done) { done = true; resolve(v) } }
    try {
      const p = spawnImpl('ffmpeg', ['-version'], { stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      p.stdout?.on?.('data', (b) => { out += String(b) })
      p.on?.('error', () => finish({ ok: false, bin: 'ffmpeg', why: '没有 ffmpeg（装一个，或 PATH 里找不到）' }))
      p.on?.('close', (code) => {
        const first = out.split('\n')[0] ?? ''
        finish(code === 0 ? { ok: true, bin: 'ffmpeg', version: first.trim(), why: '' } : { ok: false, bin: 'ffmpeg', why: `ffmpeg 退出码 ${code}` })
      })
      setTimeout(() => finish({ ok: false, bin: 'ffmpeg', why: '探测超时' }), 5000).unref?.()
    } catch (err) {
      finish({ ok: false, bin: 'ffmpeg', why: String(err?.message ?? err) })
    }
  })
  return ffCache
}

/**
 * 从远程视频里抽 9 帧拼一张图。
 *
 * @param {object} o { url, out, cols, rows, offsets, duration, spawnImpl, timeoutMs }
 * @returns {Promise<{ok:boolean, why:string, path:string, bytes:number}>}
 */
export async function grabTile({
  url, out, cols = 3, rows = 3, scale = 360, duration = 0, spawnImpl = spawn, timeoutMs = 120_000,
} = {}) {
  if (!url) return { ok: false, why: '没有可用的视频地址', path: '', bytes: 0 }
  if (!out) return { ok: false, why: '没给输出路径', path: '', bytes: 0 }

  // 均匀取 count 个时间点（不知道时长就从头开始按 10 秒一格）
  const count = Math.max(1, Math.min(9, cols * rows))
  const span = duration > 0 ? duration : count * 10
  const start = duration > 0 ? Math.min(span * 0.05, 5) : 0
  const take = Math.max(2, span * 0.9)
  const vf = `fps=${(count / Math.max(1, take)).toFixed(4)},scale=${Math.max(120, Math.round(scale))}:-2,tile=${cols}x${rows}:padding=4:margin=4:color=white`

  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-ss', String(Math.floor(start)),
    '-i', url,
    '-t', String(Math.floor(take)),
    '-vf', vf,
    '-frames:v', '1',
    '-f', 'image2pipe', '-vcodec', 'png', '-',
  ]

  const r = await new Promise((resolve) => {
    const chunks = []
    const errs = []
    let done = false
    const finish = (v) => { if (!done) { done = true; clearTimeout(t) ; resolve(v) } }
    let p
    try {
      p = spawnImpl('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      resolve({ code: -1, buf: Buffer.alloc(0), err: String(err?.message ?? err) })
      return
    }
    const t = setTimeout(() => { try { p.kill?.() } catch { /* ignore */ } finish({ code: -2, buf: Buffer.concat(chunks), err: '超时' }) }, timeoutMs)
    p.stdout?.on?.('data', (b) => chunks.push(Buffer.from(b)))
    p.stderr?.on?.('data', (b) => { if (errs.length < 20) errs.push(String(b)) })
    p.on?.('error', (e) => finish({ code: -1, buf: Buffer.concat(chunks), err: String(e?.message ?? e) }))
    p.on?.('close', (code) => finish({ code, buf: Buffer.concat(chunks), err: errs.join('').slice(0, 400) }))
  })

  const buf = r.buf ?? Buffer.alloc(0)
  if (buf.length < 8) return { ok: false, why: `ffmpeg 退出码 ${r.code} 且没有吐出图：${r.err || '无输出'}`, path: '', bytes: 0 }
  if (!buf.subarray(0, 4).equals(PNG_MAGIC)) {
    return { ok: false, why: `ffmpeg 输出不是 PNG（退出码 ${r.code}）：${r.err || String(buf.subarray(0, 80))}`, path: '', bytes: buf.length }
  }
  await fs.mkdir(dirname(out), { recursive: true })
  await fs.writeFile(out, buf)
  return { ok: true, why: '', path: out, bytes: buf.length, frames: count }
}

/** 只有封面时退一步：把封面图存下来（不算"看过画面"，但至少看得见。 */
export async function saveCover({ picUrl, out, fetchImpl = globalThis.fetch, timeoutMs = 12_000 } = {}) {
  if (!picUrl || !out) return { ok: false, why: '没有封面地址', path: '' }
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetchImpl(picUrl, { signal: ctl.signal, headers: { referer: 'https://www.bilibili.com/', 'user-agent': 'Mozilla/5.0' } })
    if (!r.ok) return { ok: false, why: `封面下载失败 HTTP ${r.status}`, path: '' }
    const buf = Buffer.from(await r.arrayBuffer())
    await fs.mkdir(dirname(out), { recursive: true })
    await fs.writeFile(out, buf)
    return { ok: true, why: '', path: out, bytes: buf.length }
  } catch (err) {
    return { ok: false, why: `封面下载失败：${String(err?.message ?? err)}`, path: '' }
  } finally {
    clearTimeout(t)
  }
}

/**
 * 之前看过吗？返回可复用的路径（没有/过期就 null）。
 * 省 token 的第一招：同一条视频不重复抽帧，她也不用重复读同一张图。
 */
export async function cachedWatchPath(root, bvid, reuseDays = 7, now = Date.now()) {
  const ms = Math.max(0, Number(reuseDays) || 0) * 86_400_000
  if (!ms) return null
  for (const [ext, kind] of [['png', 'watch'], ['jpg', 'cover']]) {
    const p = outPath(root, bvid, ext)
    try {
      const st = await fs.stat(p)
      if (now - st.mtimeMs <= ms) return { path: p, kind }
    } catch { /* 没看过 */ }
  }
  return null
}

/** 她"看过的东西"放哪：`<root>/out/` 下，按 bvid 命名。 */
export function outPath(root, bvid, ext = 'png') {
  const safe = String(bvid ?? 'x').replace(/[^0-9A-Za-z]/g, '').slice(0, 24) || 'x'
  return join(String(root), 'out', `${safe}.${ext}`)
}
