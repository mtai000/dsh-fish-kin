/**
 * lineage.js —— 族谱（只追加，不改写）
 *
 * 族谱只有一种记录：出生。一条一个孩子，写进 `lineage.jsonl`。
 * 为什么不存成一棵树再整体重写：树会被重写，而重写就有"改血统"的可能。
 * 一行一条追加，谁是谁的后代由 `parentDir` 现算——账本永远比快照可信。
 *
 * 「代际」不靠父代自己申报，靠**路径**：如果母代的 root 恰好是族谱里某个
 * 孩子的目录，那她就是那个孩子的后代，代数 +1。这样「把孩子养大再生一个」
 * 会自动发生在第三、第四代，不需要人手动填家谱。
 */

import { appendJsonl, readJsonl } from './kinstore.js'
import { kinPaths } from './locate.js'
import { normPath } from './text.js'
import { fingerprintSimilarity } from './distill.js'

/** 近亲判定线：两份遗传包指纹相似到这个程度，当作同一个底子。 */
export const NEAR_KIN = 0.75

/** 读族谱。坏行跳过（一行坏了不该让血统断掉）。 */
export async function readLineage(kinRoot) {
  const { rows, skipped, exists } = await readJsonl(kinPaths(kinRoot).lineage)
  const entries = rows.filter((r) => r && r.kind === 'birth' && r.childId)
  return { entries, skipped, exists }
}

/** 追加一条出生记录。返回写进去的那条。 */
export async function recordBirth(kinRoot, entry) {
  const row = { v: 1, kind: 'birth', ...entry }
  await appendJsonl(kinPaths(kinRoot).lineage, row)
  return row
}

/** 按路径找「这个 root 是不是族谱里某个孩子」。 */
export function findEntryByDir(entries, dir) {
  const key = normPath(dir)
  if (!key) return null
  // 从后往前找：同一个目录只应该出生一次，万一有重复，取最新的那条
  for (let i = entries.length - 1; i >= 0; i--) {
    if (normPath(entries[i].childDir) === key) return entries[i]
  }
  return null
}

/**
 * 母代是第几代。
 * 母代本身不在族谱里（她是从空白养起来的）就是第 1 代；
 * 她是某个孩子长大的，就是那个孩子的代数 +1。
 */
export function generationOf(entries, parentDir) {
  const parent = findEntryByDir(entries, parentDir)
  if (!parent) return 1
  const g = Number(parent.generation)
  return (Number.isFinite(g) ? Math.max(1, g) : 1) + 1
}

/** 这条母代之前生过几个孩子（按路径认，不按 id）。 */
export function childrenOf(entries, parentDir) {
  const key = normPath(parentDir)
  return entries.filter((e) => normPath(e.parentDir) === key)
}

/** 上一个孩子出生时母代有多少条事件（用来算冷却）。 */
export function lastBirthEvents(entries, parentDir) {
  const kids = childrenOf(entries, parentDir)
  if (!kids.length) return null
  const last = kids[kids.length - 1]
  const n = Number(last.parentEvents)
  return Number.isFinite(n) ? n : null
}

/**
 * 平铺成「族谱行」：给界面用，不在这里排序成树（树是展示层的事）。
 * 每行带上「她是第几代」「她妈生了几个」。
 */
export function flatLines(entries) {
  return entries.map((e) => ({
    childId: e.childId,
    childName: e.childName || '',
    generation: Number(e.generation) || 1,
    parentDir: e.parentDir || '',
    at: e.at || '',
    trigger: e.trigger || '',
    packChars: Number(e.packChars) || 0,
    siblings: childrenOf(entries, e.parentDir).length,
  }))
}

/**
 * 近亲检查：新孩子的遗传包跟族谱里已有的比，太像就拦。
 *
 * 为什么拦「像」而不是拦「同一个妈」：真正的风险不是同一个妈生两次
 * （那只是重建一次），而是两个遗传包几乎一样——那等于把孩子生成了复制品，
 * 而族谱上还写着这是新的一代。
 */
export function kinCheck(entries, fp, { threshold = NEAR_KIN } = {}) {
  let nearest = null
  let best = 0
  for (const e of entries) {
    const s = fingerprintSimilarity(fp, e.fingerprint)
    if (s > best) { best = s; nearest = e }
  }
  const ok = best < threshold
  return {
    ok,
    similarity: Number(best.toFixed(3)),
    threshold,
    nearest: nearest ? { childId: nearest.childId, generation: nearest.generation, at: nearest.at } : null,
    why: ok ? '' : `和族谱里 ${nearest?.childName || nearest?.childId || '某个孩子'} 的遗传包有 ${(best * 100).toFixed(0)}% 重合，这不是新一代，是复制。`,
  }
}
