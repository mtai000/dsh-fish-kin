/**
 * fish/approvals.js —— 她要对外做的事，先放这儿等人点头
 *
 * 为什么要这一层：她可以在外部世界做事（发一条评论、去游戏里走一步），但**做不做，
 * 得主人同意**。这跟生物（生育）那边是同一个原则：她只能开口/立单，执行权在人手里。
 *
 * 存法：`<她家>/approvals/<id>.json`，一天过期；决定追加进 `<她家>/approvals.jsonl`
 * （只追加，出问题能查是谁批的）。执行由 execute.js 做——这里只管"批没批"。
 */

import { promises as fs } from 'node:fs'
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { appendJsonl, readJsonl, writeJson } from '../kinstore.js'
import { paths } from './store.js'

export const KINDS = Object.freeze(['tool-call'])
export const TTL_MS = 24 * 60 * 60 * 1000

export function approvalsDir(root) {
  return join(String(root), 'approvals')
}
export function approvalsLog(root) {
  return join(String(root), 'approvals.jsonl')
}

function idOf(n = Date.now()) {
  return 'ap_' + String(n).toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase()
}

/**
 * 立一张待批准的单子。
 * @param {object} o { kind, title, detail, payload, ttlMs, now }
 */
export async function createApproval(root, { kind, title = '', detail = '', payload = {}, ttlMs = TTL_MS, now = Date.now() } = {}) {
  if (!KINDS.includes(kind)) return { ok: false, why: `不认识的类型：${kind}`, approval: null }
  const id = idOf(now)
  const row = {
    v: 1,
    id,
    kind,
    title: String(title).slice(0, 80),
    detail: String(detail).slice(0, 400),
    payload,
    at: new Date(now).toISOString(),
    expiresAt: new Date(now + Math.max(60_000, Number(ttlMs) || TTL_MS)).toISOString(),
  }
  await fs.mkdir(approvalsDir(root), { recursive: true })
  await writeJson(join(approvalsDir(root), `${id}.json`), row)
  return { ok: true, why: '', approval: row }
}

/**
 * 同步立单（守卫是同步回调，不能 await）。
 * 同一条工具 10 分钟内已有待批的，就不重复立——她连着调十次只该吵你一次。
 */
export function createApprovalSync(root, { kind, title = '', detail = '', payload = {}, ttlMs = TTL_MS, now = Date.now() } = {}) {
  if (!KINDS.includes(kind)) return { ok: false, why: `不认识的类型：${kind}`, approval: null }
  try {
    const tool = String(payload?.tool ?? '')
    if (tool) {
      const dir = approvalsDir(root)
      if (existsSync(dir)) {
        for (const name of readdirSync(dir)) {
          if (!name.endsWith('.json')) continue
          try {
            const row = JSON.parse(readFileSync(join(dir, name), 'utf8'))
            if (row?.kind === kind && row?.payload?.tool === tool && Date.parse(String(row.expiresAt)) > now) {
              return { ok: true, why: '', approval: row, existing: true }
            }
          } catch { /* ignore */ }
        }
      }
    }
    const id = idOf(now)
    const row = {
      v: 1,
      id,
      kind,
      title: String(title).slice(0, 80),
      detail: String(detail).slice(0, 400),
      payload,
      at: new Date(now).toISOString(),
      expiresAt: new Date(now + Math.max(60_000, Number(ttlMs) || TTL_MS)).toISOString(),
    }
    mkdirSync(approvalsDir(root), { recursive: true })
    writeFileSync(join(approvalsDir(root), `${id}.json`), JSON.stringify(row, null, 2) + String.fromCharCode(10), 'utf8')
    return { ok: true, why: '', approval: row }
  } catch (err) {
    return { ok: false, why: String(err?.message ?? err).slice(0, 160), approval: null }
  }
}

/** 列还没过期的单子（顺手清过期的，并记一笔）。 */
export async function listApprovals(root, { now = Date.now() } = {}) {
  const dir = approvalsDir(root)
  let names = []
  try {
    names = await fs.readdir(dir)
  } catch (err) {
    if (err?.code === 'ENOENT') return { pending: [], expired: 0 }
    throw err
  }
  const pending = []
  let expired = 0
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const file = join(dir, name)
    let row = null
    try {
      row = JSON.parse(await fs.readFile(file, 'utf8'))
    } catch { await fs.rm(file, { force: true }).catch(() => {}); continue }
    if (!row?.id) { await fs.rm(file, { force: true }).catch(() => {}); continue }
    if (Date.parse(String(row.expiresAt)) <= now) {
      expired++
      await appendJsonl(approvalsLog(root), { v: 1, kind: 'expire', id: row.id, at: new Date(now).toISOString() })
      await fs.rm(file, { force: true }).catch(() => {})
      continue
    }
    pending.push(row)
  }
  pending.sort((a, b) => String(a.at).localeCompare(String(b.at)))
  return { pending, expired }
}

export async function readApproval(root, id) {
  if (!/^ap_[0-9A-Za-z]{4,32}$/.test(String(id ?? ''))) return null
  try {
    return JSON.parse(await fs.readFile(join(approvalsDir(root), `${id}.json`), 'utf8'))
  } catch {
    return null
  }
}

/**
 * 裁决。approve 只把单子**取走并返回**；source-act 会在 execute.js 里变成一张限时通行证。
 */
export async function decideApproval(root, id, { verdict, by = 'owner', why = '', now = Date.now() } = {}) {
  if (!['approve', 'reject'].includes(verdict)) return { ok: false, why: 'verdict 只能是 approve / reject', approval: null }
  const row = await readApproval(root, id)
  if (!row) return { ok: false, why: '没有这张单子（批过/驳过/过期了）', approval: null }
  if (Date.parse(String(row.expiresAt)) <= now) return { ok: false, why: '这张单子过期了，让她再说一次', approval: null }

  await appendJsonl(approvalsLog(root), {
    v: 1, kind: verdict, id: row.id, at: new Date(now).toISOString(), by: String(by).slice(0, 40), why: String(why).slice(0, 200),
    approvalKind: row.kind, title: row.title,
  })
  if (verdict === 'reject') {
    await fs.rm(join(approvalsDir(root), `${row.id}.json`), { force: true }).catch(() => {})
    return { ok: true, why: '', approval: row, rejected: true }
  }
  return { ok: true, why: '', approval: row, rejected: false }
}

/** 批准并执行完之后，把单子收走。 */
export async function consumeApproval(root, id) {
  await fs.rm(join(approvalsDir(root), `${id}.json`), { force: true }).catch(() => {})
}

/** 决定账本（给控制台看）。 */
export async function readDecisions(root, { limit = 50 } = {}) {
  const { rows } = await readJsonl(approvalsLog(root))
  return rows.slice(-limit).reverse()
}

export { paths }
