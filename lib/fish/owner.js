/**
 * fish/owner.js —— 登录凭据（只在本地，0600）
 *
 * 为什么单独一个文件、而不是塞进 config.json：
 *   config 会被备份、被分享、被我们的族谱页读；cookie 一旦混进去就等于把登录权
 *   一起分享出去了。这里单独存，权限 0600（只有当前用户能读），备份提示里会点名。
 *
 * 存什么：cookie 串（含 SESSDATA / bili_jct）、mid、昵称、什么时候存的。
 * 不存：密码、二维码、任何能反推账号的东西。
 * 日志：**永远不打原文**，只打 `SESSDATA=***` 这种打码版（走 guard.scrub）。
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { scrub } from './guard.js'

export function ownerFile(root) {
  return join(String(root), 'owner.json')
}

/** 读凭据（坏文件当没有）。 */
export async function readOwner(root) {
  try {
    const raw = await fs.readFile(ownerFile(root), 'utf8')
    const o = JSON.parse(raw)
    if (!o || typeof o !== 'object') return null
    return {
      cookie: String(o.cookie ?? ''),
      mid: String(o.mid ?? ''),
      name: String(o.name ?? ''),
      savedAt: String(o.savedAt ?? ''),
    }
  } catch {
    return null
  }
}

/**
 * 存凭据。**先写临时文件再改名**，权限 0600。
 * @returns {Promise<{ok:boolean, why:string, name:string, mid:string}>}
 */
export async function writeOwner(root, { cookie, mid = '', name = '', now = Date.now() } = {}) {
  const c = String(cookie ?? '').trim()
  if (!c) return { ok: false, why: 'cookie 是空的', name: '', mid: '' }
  if (!/(?:^|;\s*)SESSDATA=/i.test(c) && !/(?:^|;\s*)bili_jct=/i.test(c)) {
    return { ok: false, why: '这串里没有 SESSDATA / bili_jct，不像 B 站登录 cookie', name: '', mid: '' }
  }
  await fs.mkdir(String(root), { recursive: true })
  const file = ownerFile(root)
  const tmp = `${file}.${process.pid}.tmp`
  const payload = { cookie: c, mid: String(mid ?? ''), name: String(name ?? ''), savedAt: new Date(now).toISOString() }
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  try { await fs.chmod(tmp, 0o600) } catch { /* Windows 上没有意义，忽略 */ }
  await fs.rename(tmp, file)
  try { await fs.chmod(file, 0o600) } catch { /* ignore */ }
  return { ok: true, why: '', name: payload.name, mid: payload.mid }
}

/** 删凭据（重新登录/退出用）。 */
export async function clearOwner(root) {
  await fs.rm(ownerFile(root), { force: true }).catch(() => {})
}

/** 给界面/日志看的摘要：只有昵称、mid 和打码的 cookie。 */
export function ownerSummary(o) {
  if (!o || !o.cookie) return { logged: false, name: '', mid: '', cookie: '' }
  return { logged: true, name: o.name, mid: o.mid, cookie: scrub(o.cookie).slice(0, 80) }
}
