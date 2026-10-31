/**
 * fish/observe.js —— 观测台（只读）
 *
 * 只在出问题时救命的三个问题：
 *   1. 她这一轮**实际看到**的身份段是什么？（不是我们以为的那份）
 *   2. 哪些话摆出来了、哪些被折了？（折叠是渲染层的判断，得能核对）
 *   3. 工具面收窄到底有没有挂上？守卫挡过几次？
 *
 * 不给"改"：这里一个能改她东西的按钮都没有。改环境参数去插件控制台。
 */

import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readEvents, paths } from './store.js'
import { derive } from './derive.js'
import { identityText } from './identity.js'
import { memoryView } from './memory.js'
import { stageOf, stancesOf, scarsOf } from './growth.js'
import { loadConfig } from './wake.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PREFIX = '/dsh-fish-obs'
let pageCache = null

async function page() {
  if (pageCache) return pageCache
  pageCache = await fs.readFile(join(HERE, 'obs.html'), 'utf8')
  return pageCache
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

/** 汇总她此刻的全部可观测事实。不写盘。 */
export async function fishState(root, state = {}) {
  const { events, skipped } = await readEvents(root)
  const m = derive(events)
  const mv = memoryView(events)
  const config = await loadConfig(root)
  let home = null
  try { home = JSON.parse(await fs.readFile(paths(root).homeJson, 'utf8')) } catch { /* 还没建 */ }
  return {
    ok: true,
    root,
    day: m.day,
    name: m.name,
    counts: {
      events: m.eventCount,
      beliefs: m.beliefCount,
      refusals: m.refusalCount,
      diaries: m.diaryCount,
      chars: m.chars,
      skipped,
    },
    lastAt: m.lastAt,
    identity: identityText(root),
    memory: {
      shown: mv.shown.map((x) => ({ text: x.text, times: x.times, amended: x.amended, score: x.score })),
      folded: mv.folded,
      shownRefusals: mv.shownRefusals.map((x) => x.text),
      foldedRefusals: mv.foldedRefusals,
      totalBeliefs: mv.total,
    },
    perception: {
      intents: (m.intents ?? []).slice(-10).map((e) => ({ at: e.ts, text: String(e.text), source: String(e.meta?.source ?? '') })),
      perceived: (m.perceived ?? []).slice(-10).map((e) => ({ at: e.ts, text: String(e.text), source: String(e.meta?.source ?? ''), ref: String(e.meta?.ref ?? '') })),
      sources: (config.perception?.sources ?? []).map((s) => ({ id: s.id, title: s.title, adapter: s.adapter, enabled: s.enabled })),
    },
    growth: (() => {
      const g = stageOf(events)
      return { stage: g.stage, name: g.name, pending: g.pending, stances: stancesOf(events), scars: scarsOf(events) }
    })(),
    tools: state.tools ?? null,
    guard: state.guard ?? null,
    config,
    home: home ? { sessionId: home.sessionId ?? '', wakes: Array.isArray(home.wakes) ? home.wakes.slice(-10) : [] } : null,
    recent: events.slice(-20).reverse().map((e) => ({ at: e.ts, kind: e.kind, text: String(e.text ?? '').slice(0, 160), src: e.source })),
  }
}

/** 注册观测台。没有 webServer 就静默返回空 dispose。 */
export function registerObserve(ctx, { root, state = {}, log = () => {} } = {}) {
  const webServer = ctx?.get?.('webServer') ?? ctx?.webServer
  if (typeof webServer?.register !== 'function') return () => {}

  const handler = async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const tail = url.pathname.replace(/\/+$/, '').slice(PREFIX.length) || '/'
      if (tail === '/' || tail === '') {
        const html = await page()
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(html)
        return
      }
      if (tail === '/api/state') {
        sendJson(res, 200, await fishState(root, state))
        return
      }
      sendJson(res, 404, { ok: false, why: '没有这个接口' })
    } catch (err) {
      try { sendJson(res, 500, { ok: false, why: String(err?.message ?? err).slice(0, 200) }) } catch { /* 头已发出 */ }
    }
  }

  try {
    const d = webServer.register({ kind: 'prefix', path: PREFIX, handler })
    const off = typeof d === 'function' ? d : (d && typeof d.dispose === 'function' ? () => d.dispose() : () => {})
    log(`观测台挂在 ${PREFIX}`)
    return off
  } catch (err) {
    log(`观测台没挂上：${String(err?.message ?? err).slice(0, 120)}`)
    return () => {}
  }
}

export { PREFIX }
