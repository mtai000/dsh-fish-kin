/**
 * perception/grants.js —— 行动许可（批准过的单子 = 一张限时通行证）
 *
 * 为什么不用"插件代调外部工具"：宿主没有稳定的工具调用入口，
 * 靠猜 API 去调别的插件工具，迟早会在某个版本上静默失败。
 *
 * 所以这里换个方向：**她自己去调**，我们只管发通行证。
 *   - 她调 `act` 类工具 → 守卫先看有没有匹配的许可；
 *   - 没有 → 拒绝，并提示她用 `fish_ask` 立单；
 *   - 有 → 放行一次，同时把许可用掉（一次性，30 分钟过期）。
 *
 * 这样"执行权"真的在对方插件手里，我们只决定"批没批"。
 */

import { promises as fs } from 'node:fs'
import { readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { approvalsDir, listApprovals } from '../fish/approvals.js'

export const GRANT_TTL_MS = 30 * 60_000

/** 把一张已批准的单子写成通行证（只改这一张，不碰别的）。 */
export async function grantFromApproval(root, approval, { now = Date.now() } = {}) {
  const id = String(approval?.id ?? '')
  if (!id) return { ok: false, why: '没有单号' }
  const payload = approval.payload ?? {}
  const row = {
    ...approval,
    approvedAt: new Date(now).toISOString(),
    grantExpiresAt: new Date(now + GRANT_TTL_MS).toISOString(),
    grant: { source: String(payload.source ?? ''), tool: String(payload.tool ?? ''), args: payload.args ?? {} },
  }
  await fs.mkdir(approvalsDir(root), { recursive: true })
  await fs.writeFile(join(approvalsDir(root), `${id}.json`), JSON.stringify(row, null, 2) + '\n', 'utf8')
  return { ok: true, why: '', grant: row.grant }
}

/**
 * 找一张还没用掉的许可。
 * @returns {Promise<object|null>} 匹配的许可（含 id）
 */
export async function findGrant(root, toolName, { now = Date.now() } = {}) {
  const { pending } = await listApprovals(root, { now })
  for (const a of pending) {
    if (a?.kind !== 'source-act') continue
    const g = a.grant
    if (!g || g.tool !== String(toolName)) continue
    if (Date.parse(String(a.grantExpiresAt ?? '')) <= now) continue
    return a
  }
  return null
}

/**
 * 同步版：守卫是同步回调，不能 await，所以直接读目录。
 * （审批目录很小，每次调用扫一遍没关系。）
 */
export function findGrantSync(root, toolName, { now = Date.now() } = {}) {
  let names = []
  try { names = readdirSync(approvalsDir(root)) } catch { return null }
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      const row = JSON.parse(readFileSync(join(approvalsDir(root), name), 'utf8'))
      if (row?.kind !== 'source-act' || !row.grant) continue
      if (row.grant.tool !== String(toolName)) continue
      if (Date.parse(String(row.grantExpiresAt ?? '')) <= now) continue
      return row
    } catch { /* 坏文件当没有 */ }
  }
  return null
}

/** 同步用掉一张许可。 */
export function consumeGrantSync(root, id) {
  try { rmSync(join(approvalsDir(root), `${String(id)}.json`), { force: true }) } catch { /* ignore */ }
}

/** 用掉一张许可（一次性）。 */
export async function consumeGrant(root, id) {
  await fs.rm(join(approvalsDir(root), `${String(id)}.json`), { force: true }).catch(() => {})
}
