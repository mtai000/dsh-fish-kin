/**
 * fish/offpeak.js —— 谷时（参考 dsh-bili-scroll 的口径）
 *
 * 官方定价按**北京时间**：工作日 9–12、14–18 是高峰，其余（含整个周末）都是谷时。
 * 两个坑它踩过、这里直接绕开：
 *   1. 不能读本机时区 —— 部署在 UTC 机器上会整整差 8 小时；中国无夏令时，固定 +8 即可。
 *   2. 必须判周末 —— 只看小时的话，周六上午会被误判成高峰。
 *
 * 这里的谷时只干一件事：到点了替她**立一张刷站单**（mode=propose，还要你点头），
 * 或者在你明确打开 mode=on 时替她叫醒一次。它不替她挑视频，也不越过配额。
 */

import { join } from 'node:path'
import { dayKey } from './quota.js'

const OFFSET_MIN = 8 * 60 // 北京时间固定 +8
/** 高峰（工作日）：[起, 止) 小时 */
const PEAK = [[9, 12], [14, 18]]
/** 谷时窗口的名字（只是给界面看的） */
export const WINDOWS = {
  noon: { label: '中午谷时', start: '12:00', end: '14:00' },
  night: { label: '夜间谷时', start: '18:00', end: '09:00' },
}

/** 按北京时间拆出 星期/时/分（不依赖本机时区）。 */
export function beijing(now = Date.now()) {
  const d = new Date(Number(now) + OFFSET_MIN * 60_000)
  return { day: d.getUTCDay(), h: d.getUTCHours(), m: d.getUTCMinutes() }
}

/**
 * 现在是不是谷时。
 * @param {number|Date} now
 * @param {{weekendCovers?: boolean, windows?: string[]}} opts
 *   weekendCovers=true（默认）：周末全天算谷时；
 *   windows：只认这些窗口（默认 noon+night，等价于"除高峰外"）。
 */
export function isOffPeak(now = Date.now(), { weekendCovers = true, windows = ['noon', 'night'] } = {}) {
  const t = now instanceof Date ? now.getTime() : Number(now)
  const { day, h } = beijing(t)
  if (weekendCovers && (day === 0 || day === 6)) return true
  const hour = h
  for (const name of windows) {
    if (name === 'noon' && hour >= 12 && hour < 14) return true
    if (name === 'night' && (hour >= 18 || hour < 9)) return true
  }
  return false
}

/**
 * 谷时定时器：每 10 分钟看一眼，到点只做一件事。
 *
 * mode=propose（默认）：替你立一张刷站单——**仍然要你点头**。
 * mode=on：你已经在设置里同意了，到点直接把她叫醒（仍受每日配额约束）。
 * 一天最多触发一次（`<她家>/offpeak.json` 记 day）。
 */
/**
 * 谷时简报私信。
 * 照 dsh-bili-scroll 的"投递方式"：私信是把这一轮的结果发给主人，不是她随便找人聊天。
 * propose 模式立单等人批；auto 模式直接发（用户已在设置里同意）。
 */
async function sendDailyBrief(cfg, { root, t, log = () => {} } = {}) {
  const dm = cfg?.bili?.dm
  if (!dm || dm.mode === 'off' || dm.daily !== true || !dm.uid) return
  try {
    const { buildReport } = await import('./report.js')
    const rep = await buildReport(root, { now: t })
    const text = String(rep.text || '').slice(0, 900)
    if (!text) return
    if (dm.mode === 'propose') {
      const { createApproval } = await import('./approvals.js')
      const made = await createApproval(root, {
        kind: 'bili-dm',
        title: '谷时简报私信',
        detail: text.slice(0, 120) + '…',
        payload: { receiver: dm.uid, text },
      })
      if (made.ok) log(`谷时简报立单：${made.approval.id}`)
      return
    }
    const { createBiliClient } = await import('./bili.js')
    const { readOwner } = await import('./owner.js')
    const o = await readOwner(root)
    const c = createBiliClient({ cookie: o?.cookie ?? '', log })
    const r = await c.sendDm({ receiverId: dm.uid, content: text })
    log(r.ok ? '谷时简报私信发出去了' : `谷时简报私信没发出去：${r.message}`)
  } catch (err) {
    log(`谷时简报失败：${String(err?.message ?? err).slice(0, 120)}`)
  }
}

export function startOffpeakLoop(ctx, { root, log = () => {}, intervalMs = 10 * 60_000, now = () => Date.now() } = {}) {
  let timer = null
  let stopped = false
  let marker = ''

  async function tick() {
    if (stopped) return
    try {
      const t = now()
      const { loadConfig } = await import('./wake.js')
      const cfg = await loadConfig(root)
      const mode = cfg.bili.offpeak.mode
      if (mode === 'off') return
      if (!cfg.bili.enabled) return
      if (!isOffPeak(t, { windows: cfg.bili.offpeak.windows })) return
      const key = dayKey(t)
      if (marker === key) return
      try {
        const fs = await import('node:fs/promises')
        const f = join(String(root), 'offpeak.json')
        const raw = JSON.parse(await fs.readFile(f, 'utf8'))
        if (String(raw?.day ?? '') === key) { marker = key; return }
      } catch { /* 没记过 */ }

      // 谷时简报：把今天在 B 站做了什么私信给主人（propose=立单 / auto=直接发）
      await sendDailyBrief(cfg, { root, t, log })

      const { checkQuota } = await import('./quota.js')
      const q = await checkQuota(root, 'bili-scroll', cfg.bili.scrollPerDay, t)
      if (!q.ok) return

      const stamp = whyOffPeak(t, { windows: cfg.bili.offpeak.windows })
      if (mode === 'propose') {
        const { createApproval } = await import('./approvals.js')
        const made = await createApproval(root, {
          kind: 'bili-scroll',
          title: '谷时到了，想去刷一会儿',
          detail: `${stamp.why}（${stamp.text}）；批了我就去看。`,
          payload: {},
        }, )
        if (made.ok) log(`谷时立单：${made.approval.id}`)
      } else {
        const { sayToHer } = await import('./home.js')
        const r = await sayToHer(ctx, { root, text: '现在是谷时，可以去 B 站刷一会儿。' })
        log(r.ok ? '谷时叫醒她' : `谷时叫不醒：${r.why}`)
      }
      marker = key
      try {
        const fs = await import('node:fs/promises')
        await fs.mkdir(String(root), { recursive: true })
        await fs.writeFile(join(String(root), 'offpeak.json'), JSON.stringify({ day: key, at: new Date(t).toISOString(), mode }), 'utf8')
      } catch { /* ignore */ }
    } catch (err) {
      log(`谷时检查失败：${String(err?.message ?? err).slice(0, 120)}`)
    }
  }

  tick()
  timer = setInterval(tick, intervalMs)
  timer?.unref?.()
  return () => { stopped = true; if (timer) clearInterval(timer) }
}

/** 一句话说明为什么现在是/不是谷时（给界面与日志）。 */
export function whyOffPeak(now = Date.now(), opts = {}) {
  const { day, h } = beijing(now)
  const dows = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const off = isOffPeak(now, opts)
  const why = off
    ? (day === 0 || day === 6 ? '周末，全天谷时' : (h >= 12 && h < 14 ? '中午谷时' : '夜间谷时'))
    : '工作日高峰（9–12 / 14–18），不跑'
  return { off, why, text: `${dows[day]} ${String(h).padStart(2, '0')}:${String(new Date(Number(now) + OFFSET_MIN * 60_000).getUTCMinutes()).padStart(2, '0')}（北京时间）` }
}
