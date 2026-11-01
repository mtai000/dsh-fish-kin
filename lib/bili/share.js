/**
 * bili/share.js —— 「看到有意思的东西会私信分享」
 *
 * 她挑中几条之后调 `bili_share`：宿主负责
 *   ① 拼一条**干净的人话**私信（标题 + 链接 + 一句话理由，500 字以内）
 *   ② 发到设置里指定的 UID（0 = 登录账号自己）
 *   ③ 顺手写日报 / 判重表 / 归档，并把这条记进她的事件流（「最近看到」）
 *
 * 私信失败不能让整轮白跑：报告与判重表照样落，返回里说清楚没发出去。
 */

import { appendEvent, readEvents } from '../fish/store.js'
import { derive } from '../fish/derive.js'
import { callMcp } from './runtime.js'
import { appendDigest, appendReport, appendSeen, alreadySeen, noteManualExtra, loadState, markDmSent } from './store.js'
import { loadCred } from './dm.js'
import { dayKey } from './config.js'
import { scrub } from '../fish/guard.js'

const clip = (s, n) => scrub(String(s ?? '').replace(/\s+/g, ' ').trim()).slice(0, n)
const normItems = (items, max = 5) => {
  const out = []
  for (const raw of Array.isArray(items) ? items : []) {
    const bvid = (/BV[0-9A-Za-z]{10}/.exec(String(raw?.bvid ?? raw?.url ?? '')) || [])[0]
    if (!bvid) continue
    out.push({
      bvid,
      title: clip(raw?.title, 80) || bvid,
      up: clip(raw?.up, 40),
      why: clip(raw?.why, 160),
      tier: clip(raw?.tier, 20),
      url: `https://www.bilibili.com/video/${bvid}`,
    })
    if (out.length >= max) break
  }
  return out
}

/** 把一条/几条拼成一条私信；超长时先砍理由、再砍条目。 */
export function formatShare(items, maxChars = 480) {
  const list = normItems(items)
  const header = '在 B 站逛到几条，想给你看看：'
  const build = (arr, whyLimit) => {
    const lines = [header]
    arr.forEach((it, i) => {
      lines.push('')
      lines.push(`${i + 1}. ${it.title}`)
      lines.push(it.url)
      if (it.why && whyLimit > 0) lines.push(clip(it.why, whyLimit))
    })
    return lines.join('\n').trim()
  }
  let whyLimit = 80
  let text = build(list, whyLimit)
  while (text.length > maxChars && whyLimit > 12) {
    whyLimit -= 12
    text = build(list, whyLimit)
  }
  while (text.length > maxChars && list.length > 1) {
    list.pop()
    text = build(list, whyLimit)
  }
  if (text.length > maxChars) text = text.slice(0, Math.max(0, maxChars - 1)) + '…'
  return { text, items: list }
}

export function ownerUidFallback(root) {
  const cred = loadCred(root)
  return Number(cred?.dedeuserid) || 0
}

/** 用 MCP 发一条私信。返回 {ok, error}。 */
export async function sendDm(root, config, uid, text) {
  const to = Number(uid) || 0
  if (!to) return { ok: false, error: '不知道私信发给谁（设置里填 UID，或先登录）' }
  if (!String(text ?? '').trim()) return { ok: false, error: '私信是空的' }
  try {
    const r = await callMcp(root, config, 'bili_send_message', { receiver_uid: to, text: String(text) })
    const obj = typeof r === 'string' ? (() => { try { return JSON.parse(r) } catch { return { raw: r } } })() : (r || {})
    if (obj.success === true || obj.ok === true) return { ok: true, uid: to, raw: obj }
    return { ok: false, error: String(obj.error || obj.message || '接口没有给投递回执') }
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) }
  }
}

async function perceive(root, items) {
  try {
    const { events } = await readEvents(root)
    const day = derive(events).day
    for (const it of items) {
      const body = `在B站看到《${clip(it.title, 60)}》（${it.bvid}）${it.why ? `—— ${clip(it.why, 120)}` : ''}`
      await appendEvent(root, { kind: 'perceived', body, meta: { source: 'bili', ref: it.bvid, url: it.url } }, { source: 'system', day })
    }
  } catch { /* 记不进「最近看到」不影响分享 */ }
}

/** 把挑中的写进报告 / 判重表 / 归档。 */
export function recordPicked(root, items, { delivered = false, report = true } = {}) {
  for (const it of items) {
    try {
      if (report) appendReport(root, [
        `### ${it.bvid}`,
        `**标题**：${it.title}`,
        it.up ? `**UP**：${it.up}` : '',
        it.tier ? `**档位**：${it.tier}` : '',
        `**为什么值得**：${it.why || '（没写理由）'}`,
        `链接：${it.url}`,
        '',
      ].filter(Boolean).join('\n'))
      appendSeen(root, { bvid: it.bvid, title: it.title, up: it.up, status: delivered ? '挑了 · 已投递' : '挑了 · 只记报告' })
      appendDigest(root, `${dayKey()} · ${it.bvid} · ${clip(it.title, 60)} · ${it.up || ''} · ${it.tier || '挑了'} · ${clip(it.why, 80)} · ${it.url}`)
    } catch { /* 单条写失败不影响别的 */ }
  }
}

/**
 * 主入口：她挑中的条目 → 私信 + 记录。
 * @returns {{ok:boolean, sent:boolean, items:Array, text:string, error:string, skipped:Array}}
 */
export async function shareItems(root, config, items, { log = () => {}, force = false } = {}) {
  const cfg = config
  const maxChars = Number(cfg?.share?.maxChars) || 480
  const incoming = normItems(items, 5)
  const skipped = []
  const picked = []
  for (const it of incoming) {
    if (!force && alreadySeen(root, it.bvid, cfg?.dedupeDays)) { skipped.push({ ...it, why: '最近看过' }); continue }
    picked.push(it)
  }
  if (!picked.length) {
    return { ok: false, sent: false, items: [], text: '', skipped, error: '这几条最近都看过了，没有新的' }
  }
  const { text, items: sendItems } = formatShare(picked, maxChars)
  let sent = false
  let error = ''
  let uid = 0
  if (cfg?.share?.enabled !== false && cfg?.share?.mode === 'dm') {
    const st0 = loadState(root)
    const last = st0.lastDmAt ? Date.parse(st0.lastDmAt) : 0
    if (last && Date.now() - last < 5 * 60_000) {
      error = '刚发过一条私信，这一轮不再重复发（防止手滑/刷屏）'
    } else {
    uid = Number(cfg?.share?.uid) || ownerUidFallback(root)
    const r = await sendDm(root, cfg, uid, text)
    sent = r.ok
    if (!r.ok) {
      error = r.error
      // 被长度/风控拒一次：砍到 300 字以内重试一次，别原样无脑重试
      if (text.length > 300) {
        const shortText = formatShare(sendItems, 300).text
        const r2 = await sendDm(root, cfg, uid, shortText)
        if (r2.ok) { sent = true; error = ''; log(`私信被拒后精简重发成功（原 ${text.length} 字）`) }
        else error = r2.error || error
      }
      if (!sent) log(`私信没发出去：${error}`)
    }
    if (sent) { try { markDmSent(root) } catch { /* ignore */ } }
    }
  } else if (cfg?.share?.enabled === false) {
    error = '分享关着（只记报告）'
  } else if (cfg?.share?.mode === 'off') {
    error = '分享关着（只记报告）'
  } else if (cfg?.share?.mode === 'note') {
    error = '当前是「只记报告」模式'
  }
  recordPicked(root, sendItems, { delivered: sent, report: cfg?.report !== 'off' })
  try { noteManualExtra(root, sendItems.length) } catch { /* ignore */ }
  // 无论私信成没成，都记进「最近看到」——她确实看过
  await perceive(root, sendItems)
  return {
    ok: true,
    sent,
    items: sendItems,
    text,
    error,
    skipped,
    uid,
    hint: sent
      ? `已私信给 UID ${uid}（${sendItems.length} 条），报告和判重表也写好了。`
      : `已写进报告 / 判重表${sendItems.length} 条；私信没发出去：${error}。别再原样重试。`,
  }
}

/** 只记「看过」，不分享（跳过的视频也值得留一行）。 */
export async function markSkipped(root, config, item, reason = '跳过') {
  const bv = (/BV[0-9A-Za-z]{10}/.exec(String(item?.bvid ?? item?.url ?? '')) || [])[0]
  if (!bv) return { ok: false, why: 'bvid 不对' }
  const title = clip(item?.title, 80)
  const up = clip(item?.up, 40)
  appendSeen(root, { bvid: bv, title, up, status: `跳过${reason ? ' · ' + clip(reason, 20) : ''}` })
  appendDigest(root, `${dayKey()} · ${bv} · ${title} · ${up} · 跳过 · ${clip(reason, 100)}`)
  return { ok: true, bvid: bv }
}

export { normItems }
