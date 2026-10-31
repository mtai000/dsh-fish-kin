/**
 * fish/restrict.js —— 只让她看见自己的两个工具
 *
 * 她原本能看见宿主给她的**全部**工具：shell、读写文件、联网、定时任务、子代理……
 * 问题有两层，都很实际：
 *   ① 她看得见 `read` / `shell`，就等于能读自己的 events.jsonl、改自己的档——
 *      "她不能读自己的参数"从代码保证退化成了口头约定；
 *   ② 每轮都要把这些工具定义塞进上下文，白烧 token，还诱发"莫名调工具"。
 *
 * 用宿主自己的那把刀（dsh-fish 在本机验证过的同一套 API）：
 *   `agent.ctx.tools.restrict({ allow })` —— 只减不加，只作用于这个 agent；
 *   `agent.ctx.tools.guard(fn)`        —— 兜底：own 层漏出来的（比如 subagent）也跑不了。
 *
 * 顺序是刻意的：**先挂 guard，再下 restrict**。restrict 会因为"名字还没登记"抛错，
 * 先挂 guard 至少保证那一条会话不是全开。
 *
 * 她的清单只有两个：`fish_commit`（写）、`fish_bili`（看 B 站）。
 * 注意 `fish_kin` / `fish_kin_ask_birth` **不在**清单里——她要孩子得开口，不能自己批。
 */

/** 她自己的工具（必须真实存在，否则 restrict 会抛错）。 */
export const HER_TOOLS = Object.freeze(['fish_commit'])

/**
 * 额外要放行的：`read_image`。
 * 抽帧/封面只是**落一个文件路径**，真正"看见"要靠读图。挡掉它，她就又变回瞎子。
 * 但宿主不一定有这个工具——所以它单独一组，名字不认识时整组退掉，核心两个照样生效。
 */
export const SAFE_EXTRA = Object.freeze(['read_image', 'fish_ask'])

/** 兜底话术：不带"权限/禁止/违规"这类系统词——她要以为是自己做不了。 */
const DENY_TEXT = '这件事我做不到。'
/** 行动类工具没许可时的话术：把球踢回"先问他一声"。 */
const ACT_DENY = '这件事要先问他一声（用 fish_ask 立一张单）。'

/**
 * 给"她在家"的那条会话收窄工具面。
 *
 * @param {object} ctx 宿主 ctx
 * @param {object} o { root, allow?: string[], normPath, log }
 * @returns {() => void} dispose
 */
export function registerRestrict(ctx, { root, allow = [], act = [], log = () => {}, onResult = () => {} } = {}) {
  if (typeof ctx?.on !== 'function') return () => {}
  // 行动类也要出现在 allowList 里（否则连"被拦"的机会都没有），
  // 但它们每次调用都要过守卫的通行证检查。
  const allowList = [...new Set([
    ...HER_TOOLS,
    ...SAFE_EXTRA,
    ...(Array.isArray(act) ? act : []),
    ...allow.filter((x) => typeof x === 'string' && x.trim()),
  ])]
  // 行动类工具：可以出现在工具面里，但**每次调用都要一张批准的通行证**
  const actSet = new Set((Array.isArray(act) ? act : []).filter((x) => typeof x === 'string' && x.trim()))
  const herDir = normPath(joinHome(root))
  const attached = new Set()

  const attach = (agent) => {
    const cwd = String(agent?.session?.header?.cwd ?? agent?.header?.cwd ?? agent?.session?.cwd ?? '')
    const got = normPath(cwd)
    if (!got || got !== herDir) return false
    const sid = String(agent?.session?.header?.id ?? agent?.session?.id ?? '') || 'unknown'
    if (attached.has(sid)) return false
    const tools = agent?.ctx?.tools
    if (!tools) return false

    let guardOk = false
    // ① 兜底：不在清单里的调用一律拒绝（own 层漏出来的只靠这条）
    if (typeof tools.guard === 'function') {
      try {
        const off = tools.guard((exec) => {
          const name = String(exec?.name ?? '')
          if (!name || allowList.includes(name)) {
            // 行动类：先看有没有批准的通行证（一次性、30 分钟过期）
            if (actSet.has(name)) {
              let grant = null
              try {
                grant = findGrantSync(root, name)
                if (grant) {
                  consumeGrantSync(root, grant.id)
                  log(`放行了一次行动：${name}（许可 ${grant.id}）`)
                  return undefined
                }
              } catch (err) {
                log(`查许可失败：${String(err?.message ?? err).slice(0, 120)}`)
              }
              log(`挡住了一次没有许可的行动：${name}`)
              try { onResult({ ok: true, allow: allowList, guard: true, blocked: (agent.__kinBlocked = (agent.__kinBlocked || 0) + 1), why: '' }) } catch { /* ignore */ }
              return ACT_DENY
            }
            return undefined
          }
          log(`挡住了一次不该有的调用：${name}`)
          try { onResult({ ok: true, allow: allowList, guard: true, blocked: (agent.__kinBlocked = (agent.__kinBlocked || 0) + 1), why: '' }) } catch { /* ignore */ }
          return DENY_TEXT
        })
        try { agent.ctx.effect?.(() => off) } catch { /* 挂不上就靠父级 */ }
        guardOk = true
      } catch (err) {
        log(`兜底守卫没挂上：${String(err?.message ?? err).slice(0, 120)}`)
      }
    }

    // ② 主刀：只留清单里的。名字不认识时逐级退（read_image 可能是宿主没有的）
    if (typeof tools.restrict === 'function') {
      const attempts = []
      const push = (list) => {
        const key = list.join('|')
        if (!attempts.some((x) => x.join('|') === key)) attempts.push([...list])
      }
      push(allowList)
      push([...HER_TOOLS, ...SAFE_EXTRA])
      push([...HER_TOOLS])
      let lastErr = ''
      for (const list of attempts) {
        try {
          const dispose = tools.restrict({ allow: list })
          try { agent.ctx.effect?.(() => dispose) } catch { /* ignore */ }
          attached.add(sid)
          log(`工具面收窄：她只留 ${list.length} 个（${list.join('、')}）${guardOk ? '，另有兜底守卫' : ''}`)
          try { onResult({ ok: true, allow: list, guard: guardOk, blocked: agent.__kinBlocked || 0, why: '' }) } catch { /* ignore */ }
          return true
        } catch (err) {
          lastErr = String(err?.message ?? err).slice(0, 160)
        }
      }
      log(`收窄彻底失败：${lastErr}`)
      try { onResult({ ok: false, allow: [], guard: guardOk, blocked: 0, why: lastErr }) } catch { /* ignore */ }
      return false
    }
    log('宿主的 agent.ctx 上没有 tools.restrict（版本不支持），只剩兜底守卫')
    if (guardOk) attached.add(sid)
    return guardOk
  }

  const offCreated = ctx.on('agent/created', ({ agent } = {}) => {
    try { attach(agent) } catch (err) { log(`收窄出错：${String(err?.message ?? err).slice(0, 120)}`) }
  })

  // 老会话：agent/created 不会再触发，等它冒事件时补一次
  const offEvent = ctx.on('session/event', (session) => {
    try {
      const sid = String(session?.header?.id ?? session?.id ?? '')
      if (!sid || attached.has(sid)) return
      const cwd = String(session?.header?.cwd ?? session?.cwd ?? '')
      if (normPath(cwd) !== herDir) return
      const sc = ctx?.get?.('sessionController') ?? ctx?.sessionController
      if (typeof sc?.resolveAgent !== 'function') return
      void sc.resolveAgent(sid).then((got) => { if (got?.agent) attach(got.agent) }).catch(() => {})
    } catch { /* ignore */ }
  })

  return () => {
    try { if (typeof offCreated === 'function') offCreated() } catch { /* ignore */ }
    try { if (typeof offEvent === 'function') offEvent() } catch { /* ignore */ }
    attached.clear()
  }
}

import { normPath } from '../text.js'
import { findGrantSync, consumeGrantSync } from '../perception/grants.js'

function joinHome(root) {
  return String(root ?? '').replace(/[\\/]+$/, '') + '/home'
}
