/**
 * identity.js —— 每条鱼的身份证
 *
 * 只做命名空间，不做认证：identityId 用来让 CDDA 把经验写进独立目录；
 * 它不代表权限，也不参与任何授权判断。
 *
 * 编号规则（2026-11-01 主人定）：
 *   前缀 **ds-fish-** + 8 位年月日 + 4 位编码
 *   · 前缀就是字面量 `ds-fish-`（8 个字符，不是 6 位数字）
 *   · 年月日是**本地日期**（生成那一刻）
 *   · 最后 4 位是编码（进程内递增，随机起点；不是身份证校验位）
 *   · 最终形如 `ds-fish-202611010001`（20 个字符）
 *
 * 旧格式 `fish_` + 26 位 Crockford、以及过渡期的 `330105` + 12 位
 * 仍然能读（老鱼不因为升级就丢身份证）；新生成的一律用 `ds-fish-`。
 * 要把老身份证换成新格式，用 `node tools/reissue-identity.mjs`
 * （旧编号会记在 legacyId 里）。
 */
import { join } from 'node:path'
import { readJson, writeJson } from './kinstore.js'

export const IDENTITY_FILE = 'identity.json'

/** 新身份证前缀（主人 2026-11-01 定；字面量，不是数字区划码）。 */
export const IDENTITY_PREFIX = 'ds-fish-'
export const REGION_CODE = IDENTITY_PREFIX
export const REGION_NAME = '大肥鱼'

/** 老格式：fish_ + 26 位 Crockford。只读兼容。 */
export const LEGACY_IDENTITY_RE = /^fish_[0-9A-Z]{26}$/
/** 过渡格式：330105 + YYYYMMDD + 4 位数字（0.30.1 生成的，仍然认）。 */
export const GONGSHU_IDENTITY_RE = /^330105\d{12}$/
/** 新格式：ds-fish- + YYYYMMDD + 4 位数字。 */
export const NEW_IDENTITY_RE = /^ds-fish-\d{12}$/
/** 读身份证时新旧都认。 */
export const IDENTITY_RE = /^(?:fish_[0-9A-Z]{26}|330105\d{12}|ds-fish-\d{12})$/

export function identityPath(root) {
  return join(root, IDENTITY_FILE)
}

function pad(n, w = 2) {
  return String(n).padStart(w, '0')
}

/** 同一天、同一个进程里递增，避免连续生成撞号；随机起点让不同进程不挤在一起。 */
let seq = Math.floor(Math.random() * 10000)

/**
 * 生成一个新身份证号：ds-fish- + YYYYMMDD + 4 位编码。
 * @param {number} now
 * @returns {string} ds-fish- + 8 位年月日 + 4 位编码
 */
export function newIdentityId(now = Date.now()) {
  const d = new Date(Number.isFinite(Number(now)) ? Number(now) : Date.now())
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  seq = (seq + 1) % 10000
  return `${IDENTITY_PREFIX}${date}${pad(seq, 4)}`
}

/** 拆开新身份证：{ region, date: 'YYYY-MM-DD', code }；老格式返回 null。 */
export function identityParts(identityId) {
  const s = String(identityId ?? '')
  if (!NEW_IDENTITY_RE.test(s)) return null
  const body = s.slice(IDENTITY_PREFIX.length)
  return {
    prefix: IDENTITY_PREFIX,
    date: `${body.slice(0, 4)}-${body.slice(4, 6)}-${body.slice(6, 8)}`,
    code: body.slice(8, 12),
  }
}

function valid(x) {
  return x && typeof x === 'object' && IDENTITY_RE.test(String(x.identityId || ''))
}

/** 读身份证；不存在/坏掉返回 null，不抛。 */
export async function readIdentity(root) {
  const x = await readJson(identityPath(root), null)
  return valid(x) ? {
    v: 1,
    identityId: String(x.identityId),
    childId: x.childId ?? null,
    parentId: x.parentId ?? null,
    lineageId: String(x.lineageId || x.identityId),
    generation: Number.isInteger(Number(x.generation)) ? Number(x.generation) : 1,
    createdAt: String(x.createdAt || ''),
    ...(x.legacyId ? { legacyId: String(x.legacyId) } : {}),
    ...(x.reissuedAt ? { reissuedAt: String(x.reissuedAt) } : {}),
  } : null
}

/**
 * 确保 root 有身份证：已有就保留，没有就生成。
 * 父代/子代都走这一条；子代参数决定 parentId/lineageId/childId/generation。
 *
 * @param {object} opts.usedIds 已占用的编号（同一家族里已经有的），避免同一天撞号
 */
export async function ensureIdentity(root, {
  parentId = null, lineageId = null, childId = null, generation = 1, now = Date.now(), usedIds = [],
} = {}) {
  const cur = await readIdentity(root)
  if (cur) return { ok: true, created: false, identity: cur }

  let identityId = newIdentityId(now)
  const used = new Set((Array.isArray(usedIds) ? usedIds : []).map(String))
  for (let i = 0; i < 50 && used.has(identityId); i++) identityId = newIdentityId(now)

  const identity = {
    v: 1,
    identityId,
    childId: childId ?? null,
    parentId: parentId ?? null,
    lineageId: lineageId || identityId,
    generation: Math.max(1, Number(generation) || 1),
    createdAt: new Date(now).toISOString(),
  }
  await writeJson(identityPath(root), identity)
  return { ok: true, created: true, identity }
}

/**
 * 把老身份证换成 `ds-fish-` 新格式。
 *
 * ⚠️ CDDA 那边按 identityId 分目录（`memory/<identityId>`）；换号之后旧记忆目录
 * 不会自动搬。所以这是**显式**工具，不在启动时偷偷做。
 * 旧编号保留在 `legacyId` 里，方便自己搬记忆目录时对照。
 */
export async function reissueIdentity(root, { now = Date.now(), usedIds = [] } = {}) {
  const cur = await readIdentity(root)
  if (!cur) return { ok: false, why: '这个目录里没有可读的身份证' }
  if (NEW_IDENTITY_RE.test(cur.identityId)) {
    return { ok: true, changed: false, identity: cur, why: '已经是新格式' }
  }
  const raw = (await readJson(identityPath(root), null)) || {}
  let identityId = newIdentityId(now)
  const used = new Set((Array.isArray(usedIds) ? usedIds : []).map(String))
  for (let i = 0; i < 50 && (used.has(identityId) || identityId === cur.identityId); i++) identityId = newIdentityId(now)
  const identity = {
    ...raw,
    v: 1,
    identityId,
    childId: cur.childId,
    parentId: cur.parentId,
    lineageId: cur.lineageId === cur.identityId ? identityId : cur.lineageId,
    generation: cur.generation,
    createdAt: cur.createdAt || raw.createdAt || new Date(now).toISOString(),
    legacyId: cur.legacyId || cur.identityId,
    reissuedAt: new Date(now).toISOString(),
  }
  await writeJson(identityPath(root), identity)
  return { ok: true, changed: true, previousId: cur.identityId, identity: await readIdentity(root) }
}
