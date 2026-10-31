/**
 * fish/execute.js —— 批了之后才真正动手
 *
 * approvals.js 只决定"批没批"，这里才碰 B 站 / 叫醒她。分开的好处：
 * 批单这个动作永远不会因为"网络失败"而变成"批了但没做"，也不会因为重试发两遍。
 */

import { createBiliClient } from '../perception/sources/bili/bili.js'
import { readOwner } from '../perception/sources/bili/owner.js'
import { sayToHer } from './home.js'
import { appendEvent, readEvents } from './store.js'
import { derive } from './derive.js'

async function clientFor(root, log = () => {}) {
  const o = await readOwner(root).catch(() => null)
  return createBiliClient({ cookie: o?.cookie ?? '', log })
}

async function noteOnce(root, body) {
  try {
    const { events } = await readEvents(root)
    if (events.some((e) => String(e.text ?? '') === body)) return false
    await appendEvent(root, { kind: 'note', body }, { source: 'system', day: derive(events).day })
    return true
  } catch {
    return false
  }
}

/**
 * 执行一张批准过的单子。
 * @returns {Promise<{ok:boolean, text:string}>}
 */
export async function executeApproval(ctx, { root, approval, log = () => {}, client = null } = {}) {
  const a = approval
  if (!a?.kind) return { ok: false, text: '这张单子没有类型' }
  const p = a.payload ?? {}

  if (a.kind === 'bili-comment') {
    const c = client ?? await clientFor(root, log)
    const v = await c.view(p.bvid)
    if (!v.ok) return { ok: false, text: `没找到那条视频：${v.message}` }
    const r = await c.replyAdd(v.data.aid, p.text)
    if (!r.ok) return { ok: false, text: `没发出去：${r.message}` }
    await noteOnce(root, `bili-said:${p.bvid}:${r.data?.rpid ?? ''}`)
    return { ok: true, text: `发出去了（${p.bvid}）` }
  }

  if (a.kind === 'bili-reply') {
    const c = client ?? await clientFor(root, log)
    const v = await c.view(p.bvid)
    if (!v.ok) return { ok: false, text: `没找到那条视频：${v.message}` }
    const r = await c.replyToComment(v.data.aid, { root: p.root, parent: p.parent, message: p.text })
    if (!r.ok) return { ok: false, text: `没回出去：${r.message}` }
    await noteOnce(root, `bili-replied:${p.bvid}:${r.data?.rpid ?? ''}`)
    return { ok: true, text: `回出去了（${p.bvid}）` }
  }

  if (a.kind === 'bili-dm') {
    const c = client ?? await clientFor(root, log)
    const r = await c.sendDm({ receiverId: p.receiver, content: p.text })
    if (!r.ok) return { ok: false, text: `没发出去：${r.message}` }
    await noteOnce(root, `bili-dm:${p.receiver}:${r.data?.msg_key ?? ''}`)
    return { ok: true, text: '私信发出去了。' }
  }

  if (a.kind === 'bili-scroll') {
    // 刷站不替她看：把她叫醒，让她自己决定看什么（一次回合）
    const said = await sayToHer(ctx, { root, text: '他点头了。你可以去 B 站看看。' })
    if (!said.ok) return { ok: false, text: `叫不醒她：${said.why}` }
    await noteOnce(root, 'bili-scroll:ok')
    return { ok: true, text: '叫醒她了，让她自己看。' }
  }

  return { ok: false, text: `不认识的单子：${a.kind}` }
}
