/**
 * fish/restrict.js —— 她的工具闸门（每个工具都先问你）
 *
 * 2026-10-31 定案（替代原来的"收窄 + 感知源 + 通行证"）：
 *   她可以看见宿主的工具，但**每一次调用都要先过你**：
 *     允许一次 / 永远允许 / 拒绝本次 / 永久禁止
 *
 * 这里的实现只有一件事：给她的会话挂一个守卫。
 *   - 永久禁止 → 「这件事我做不到。」
 *   - 永久允许 / 一次性 → 直接放行
 *   - 其余 → 放一张待批单，并告诉她"已经问了，等他说了再做"
 *
 * 守卫是**同步**回调，所以策略与待批单都走同步读写（文件很小）。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normPath } from '../text.js'
import { decide } from './permissions.js'
import { createApprovalSync } from './approvals.js'
import { paths, HOME_DIR } from './store.js'

/** 永久禁止 / 拒绝本次 时她听到的话。 */
const DENY_TEXT = '这件事我做不到。'
/** 已经替你问了：让她等，而不是反复重试。 */
const ASK_TEXT = '这件事要先问他一声。我已经问了，等他说了再做。'

function joinHome(root) {
  return String(root ?? '').replace(/[\\/]+$/, '') + '/home'
}

/** 她在哪些目录里算"在家"：她自己的屋子 + 配置里的 workspaces。 */
export function workspacesOf(root) {
  const list = [joinHome(root)]
  try {
    const raw = JSON.parse(readFileSync(join(String(root), 'config.json'), 'utf8'))
    const ws = raw?.workspaces
    if (Array.isArray(ws)) {
      for (const w of ws) {
        if (typeof w !== 'string' || !w.trim()) continue
        // 工作区本身，以及她主动建在里面的屋子，都算"在家"
        list.push(w.trim())
        list.push(join(w.trim(), HOME_DIR))
      }
    }
  } catch { /* 没有配置 */ }
  return [...new Set(list.map((x) => normPath(x)))]
}

/**
 * 给她的会话挂闸门。
 */
export function registerRestrict(ctx, { root, log = () => {}, onResult = () => {} } = {}) {
  if (typeof ctx?.on !== 'function') return () => {}
  const mine = new Set(workspacesOf(root))
  const attached = new Set()

  const attach = (agent) => {
    const cwd = String(agent?.session?.header?.cwd ?? agent?.header?.cwd ?? agent?.session?.cwd ?? '')
    const got = normPath(cwd)
    if (!got || !mine.has(got)) return false
    const sid = String(agent?.session?.header?.id ?? agent?.session?.id ?? '') || 'unknown'
    if (attached.has(sid)) return false
    const tools = agent?.ctx?.tools
    if (!tools) return false

    let guardOk = false
    if (typeof tools.guard === 'function') {
      try {
        const off = tools.guard((exec) => {
          const name = String(exec?.name ?? '')
          if (!name) return undefined
          const verdict = decide(root, name)
          if (verdict === 'allow') return undefined
          if (verdict === 'deny') {
            try { onResult({ blocked: (agent.__kinBlocked = (agent.__kinBlocked || 0) + 1), tool: name, verdict }) } catch { /* ignore */ }
            return DENY_TEXT
          }
          // ask：立一张待批单（同一条工具 10 分钟内不重复立）
          try {
            const made = createApprovalSync(root, {
              kind: 'tool-call',
              title: `想用 ${name}`,
              detail: '',
              payload: { tool: name },
            })
            log(`她要问一次：${name}（${made.ok ? made.approval.id : made.why}）`)
            try { onResult({ asked: name, id: made.ok ? made.approval.id : '' }) } catch { /* ignore */ }
          } catch (err) {
            log(`立单失败：${String(err?.message ?? err).slice(0, 120)}`)
          }
          return ASK_TEXT
        })
        try { agent.ctx.effect?.(() => off) } catch { /* 挂不上就靠父级 */ }
        guardOk = true
      } catch (err) {
        log(`闸门没挂上：${String(err?.message ?? err).slice(0, 120)}`)
      }
    }
    attached.add(sid)
    log(`她在 ${got} 里，工具闸门已挂${guardOk ? '' : '（失败）'}`)
    return true
  }

  const off = ctx.on('agent/created', ({ agent } = {}) => { try { attach(agent) } catch { /* ignore */ } })
  const off2 = ctx.on('session/event', (e) => {
    try { if (e?.agent) attach(e.agent) } catch { /* ignore */ }
  })
  return () => {
    try { off?.() } catch { /* ignore */ }
    try { off2?.() } catch { /* ignore */ }
  }
}

/** 她自己的工具（无条件放行，不用问）。 */
export const HER_TOOLS = Object.freeze(['fish_commit'])
