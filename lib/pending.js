/**
 * pending.js —— 待批准的生育请求
 *
 * 为什么会存在「请求」这一层：用户要的是「她可以主动请求，也可以到点提醒，
 * 但最后得我点头」。所以整条链路上有三个角色：
 *
 *   她   —— 只能**开口**（工具 `fish_kin_ask_birth`），连"能不能生"都判断不了
 *   阈值 —— 只能**提醒**（pressure.js 的 hot），自己不写任何东西
 *   主人 —— 唯一能**执行**的人（批准时才会真的落盘一个孩子）
 *
 * 请求单落盘在 `<kinroot>/pending/`，一份一个文件。批准/驳回之后文件被移走，
 * 决定本身追加进 `decisions.jsonl`——账本只追加，出生证明里带着 requestId，
 * 所以「这个孩子是哪张单子批下来的」永远查得回去。
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { kinPaths } from './locate.js'
import { appendJsonl, readJson, readJsonl, writeAtomic } from './kinstore.js'
import { newId } from './ids.js'

/** 请求单寿命：一天。过期不是错误——她可以再说一次，人也可以当没看见。 */
export const TTL_MS = 24 * 60 * 60 * 1000

function requestFile(kinRoot, id) {
  return join(kinPaths(kinRoot).pendingDir, `${id}.json`)
}

/**
 * 建一张请求单。
 *
 * 请求单里**存的是当时那份遗传包的正文**，不是"再算一次的参数"。
 * 理由：主人看到的就是她要带走的东西，批准之后必须原样落地；
 * 如果批准时重新蒸馏一遍，最近几天的对话就会悄悄改写遗产——那不是他批的东西。
 */
export async function createRequest(kinRoot, {
  trigger = 'auto',
  note = '',
  pack,
  label = '',
  name = '',
  tools = [],
  now = Date.now(),
  ttlMs = TTL_MS,
} = {}) {
  if (!pack?.body) return { ok: false, why: '没有遗传包，不能立请求单', id: '' }
  const id = newId('req')
  const row = {
    v: 1,
    id,
    kind: 'birth-request',
    at: new Date(now).toISOString(),
    expiresAt: new Date(now + Math.max(60_000, Number(ttlMs) || TTL_MS)).toISOString(),
    trigger,
    note: String(note ?? '').slice(0, 400),
    label: String(label ?? '').slice(0, 40),
    name: String(name ?? '').slice(0, 20),
    tools: Array.isArray(tools) ? tools.slice(0, 40) : [],
    pack: {
      body: String(pack.body),
      chars: Number(pack.chars ?? String(pack.body).length),
      limit: Number(pack.limit ?? 1500),
      picked: Array.isArray(pack.picked)
        ? pack.picked.slice(0, 40).map((p) => ({ text: String(p.text ?? ''), kind: p.kind, score: p.score, reasons: p.reasons }))
        : [],
    },
  }
  await fs.mkdir(kinPaths(kinRoot).pendingDir, { recursive: true })
  await writeAtomic(requestFile(kinRoot, id), JSON.stringify(row, null, 2) + '\n')
  return { ok: true, why: '', id, request: row }
}

/** 列出还没过期的请求单。过期的顺手清理（只删我们自己的待批文件）。 */
export async function listRequests(kinRoot, { now = Date.now() } = {}) {
  const dir = kinPaths(kinRoot).pendingDir
  let names = []
  try {
    names = await fs.readdir(dir)
  } catch (err) {
    if (err?.code === 'ENOENT') return { requests: [], expired: 0 }
    throw err
  }
  const requests = []
  let expired = 0
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const file = join(dir, name)
    const row = await readJson(file, null)
    if (!row || !row.id) { await fs.rm(file, { force: true }).catch(() => {}); continue }
    if (Date.parse(String(row.expiresAt)) <= now) {
      expired++
      await appendJsonl(kinPaths(kinRoot).decisions, {
        v: 1, kind: 'expire', id: row.id, at: new Date(now).toISOString(),
      })
      await fs.rm(file, { force: true }).catch(() => {})
      continue
    }
    requests.push(row)
  }
  requests.sort((a, b) => String(a.at).localeCompare(String(b.at)))
  return { requests, expired }
}

/** 读一张请求单（过期了也算读到，由调用方决定）。 */
export async function readRequest(kinRoot, id) {
  if (!/^req_[0-9A-Z]{26}$/.test(String(id ?? ''))) return null
  return readJson(requestFile(kinRoot, id), null)
}

/**
 * 裁决。
 *   approve —— 把请求单原样交回去，由调用方执行 birth（这里不碰孩子）
 *   reject  —— 记一笔理由，删掉请求单
 * 两个动作都往 decisions.jsonl 追加一行，和 lineage.jsonl 一样只增不改。
 */
export async function decide(kinRoot, id, { verdict, by = '', why = '', now = Date.now() } = {}) {
  if (verdict !== 'approve' && verdict !== 'reject') {
    return { ok: false, why: 'verdict 只能是 approve 或 reject', request: null }
  }
  const row = await readRequest(kinRoot, id)
  if (!row) return { ok: false, why: '没有这张请求单（可能已经批过、驳过，或过期了）', request: null }
  // 过期的单子不能批：一天没人理，说明当时那份遗产已经不该按原样生了。
  // 重新立一张会按她现在的样子重算——这才是对的默认。
  if (Date.parse(String(row.expiresAt)) <= Number(now)) {
    return { ok: false, why: '这张单子已经过期了。要生就重新立一张（会按她现在的样子重新蒸馏）。', request: null }
  }

  await appendJsonl(kinPaths(kinRoot).decisions, {
    v: 1,
    kind: verdict,
    id: row.id,
    at: new Date(now).toISOString(),
    by: String(by ?? '').slice(0, 60),
    why: String(why ?? '').slice(0, 400),
    trigger: row.trigger,
    chars: row.pack?.chars ?? 0,
  })
  if (verdict === 'reject') await fs.rm(requestFile(kinRoot, row.id), { force: true }).catch(() => {})
  return { ok: true, why: '', request: row }
}

/** 批准之后：把请求单从待批目录里拿走（不删历史，历史在 decisions.jsonl）。 */
export async function consume(kinRoot, id) {
  await fs.rm(requestFile(kinRoot, id), { force: true }).catch(() => {})
}

/** 决定账本（给控制台看"批过什么、驳过什么"）。 */
export async function readDecisions(kinRoot, { limit = 50 } = {}) {
  const { rows } = await readJsonl(kinPaths(kinRoot).decisions)
  return rows.slice(-limit).reverse()
}
