/**
 * fish/permissions.js —— 工具许可策略（每个工具都要先问你）
 *
 * 用户 2026-10-31 定：不要"接源"，也不要我们自己判断哪个是读哪个是做。
 * 她要调用任何外部工具时，**都由她自己来问**，你四个选择：
 *
 *   允许一次   → 只放行这一次（一次性）
 *   永远允许   → 写进 alwaysAllow，以后不再问
 *   拒绝本次   → 这一次不给（下次还会问）
 *   永久禁止   → 写进 alwaysDeny，以后直接"我做不到"
 *
 * 这个模块只做**策略与账本**，不含任何外部插件知识；守卫是同步回调，
 * 所以这里提供同步读写（文件很小）。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { isFreeBiliTool } from '../bili/allow.js'

const FILE = 'permissions.json'

export function permissionsFile(root) {
  return join(String(root), FILE)
}

/** 读策略（坏文件当空）。 */
export function loadPolicy(root) {
  try {
    const raw = JSON.parse(readFileSync(permissionsFile(root), 'utf8'))
    return {
      alwaysAllow: Array.isArray(raw?.alwaysAllow) ? raw.alwaysAllow.map(String) : [],
      alwaysDeny: Array.isArray(raw?.alwaysDeny) ? raw.alwaysDeny.map(String) : [],
      once: raw?.once && typeof raw.once === 'object' ? raw.once : {},
    }
  } catch {
    return { alwaysAllow: [], alwaysDeny: [], once: {} }
  }
}

export function savePolicy(root, policy) {
  const p = {
    alwaysAllow: [...new Set(policy?.alwaysAllow ?? [])],
    alwaysDeny: [...new Set(policy?.alwaysDeny ?? [])],
    once: policy?.once ?? {},
  }
  mkdirSync(String(root), { recursive: true })
  writeFileSync(permissionsFile(root), JSON.stringify(p, null, 2) + '\u000a', 'utf8')
  return p
}

/** 她自己的工具：不用问。 */
export const FREE_TOOLS = Object.freeze(['fish_commit'])

/**
 * 同步裁决：allow / deny / ask
 * 顺序：永久禁止 → 永久允许 → 一次性（用完作废）→ 要问
 */
export function decide(root, tool, { now = Date.now() } = {}) {
  const name = String(tool ?? '')
  if (!name) return 'deny'
  if (FREE_TOOLS.includes(name)) return 'allow'
  const policy = loadPolicy(root)
  // 主人显式"永久禁止"的，连 B 站自动放行也要让路
  if (policy.alwaysDeny.includes(name)) return 'deny'
  // B 站：读/记/分享由她直接用；公开评论、私信回复看设置里的开关
  if (name.startsWith('bili_') && isFreeBiliTool(root, name)) return 'allow'
  if (policy.alwaysAllow.includes(name)) return 'allow'
  const until = Number(policy.once?.[name] ?? 0)
  if (until > now) {
    const { [name]: _drop, ...rest } = policy.once
    savePolicy(root, { ...policy, once: rest })
    return 'allow'
  }
  return 'ask'
}

/** 记一次"允许一次"（默认 30 分钟有效，用掉即作废）。 */
export function grantOnce(root, tool, { ttlMs = 30 * 60_000, now = Date.now() } = {}) {
  const policy = loadPolicy(root)
  policy.once = { ...(policy.once ?? {}), [String(tool)]: now + ttlMs }
  savePolicy(root, policy)
  return policy
}

/** 永久允许 / 永久禁止（会把同名的另一侧清掉）。 */
export function persist(root, tool, verdict) {
  const name = String(tool ?? '')
  const policy = loadPolicy(root)
  if (verdict === 'allow') {
    policy.alwaysAllow = [...new Set([...policy.alwaysAllow, name])]
    policy.alwaysDeny = policy.alwaysDeny.filter((x) => x !== name)
  } else if (verdict === 'deny') {
    policy.alwaysDeny = [...new Set([...policy.alwaysDeny, name])]
    policy.alwaysAllow = policy.alwaysAllow.filter((x) => x !== name)
  }
  if (policy.once?.[name]) delete policy.once[name]
  savePolicy(root, policy)
  return policy
}

/** 撤销一条永久设置。 */
export function forget(root, tool) {
  const name = String(tool ?? '')
  const policy = loadPolicy(root)
  policy.alwaysAllow = policy.alwaysAllow.filter((x) => x !== name)
  policy.alwaysDeny = policy.alwaysDeny.filter((x) => x !== name)
  if (policy.once?.[name]) delete policy.once[name]
  savePolicy(root, policy)
  return policy
}
