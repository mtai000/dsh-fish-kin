/**
 * identity.js —— 每条鱼的身份证
 *
 * 只做命名空间，不做认证：identityId 是一个稳定的随机编号，用来让 CDDA
 * 把经验写进独立目录；它不代表权限，也不参与任何授权判断。
 */
import { join } from 'node:path'
import { newId } from './ids.js'
import { readJson, writeJson } from './kinstore.js'

export const IDENTITY_FILE = 'identity.json'
export const IDENTITY_RE = /^fish_[0-9A-Z]{26}$/

export function identityPath(root) {
  return join(root, IDENTITY_FILE)
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
  } : null
}

/**
 * 确保 root 有身份证：已有就保留，没有就生成。
 * 父代/子代都走这一条；子代参数决定 parentId/lineageId/childId/generation。
 */
export async function ensureIdentity(root, {
  parentId = null, lineageId = null, childId = null, generation = 1, now = Date.now(),
} = {}) {
  const cur = await readIdentity(root)
  if (cur) return { ok: true, created: false, identity: cur }
  const identityId = newId('fish')
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
