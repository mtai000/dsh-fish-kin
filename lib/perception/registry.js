/**
 * perception/registry.js —— 感知源清单（**完全配置驱动，不认识任何具体插件**）
 *
 * 这是"解耦"的落点：本文件里不会出现任何**具体插件**的工具名（连注释里都不写，
 * 因为 test/perception.test.mjs 会扫这一段，防止解耦被悄悄破坏）。
 * 谁来当她看世界的眼睛，由用户在配置里写：
 *
 *   "perception": {
 *     "sources": {
 *       "bili": { "title": "看 B 站", "tools": { "read": ["..."], "act": ["..."] },
 *                 "budget": { "perDay": 3 }, "summaryMax": 120 },
 *       "cdda": { "title": "去游戏里走走", "tools": { "read": ["..."] } }
 *     }
 *   }
 *
 * 所以换插件（比如从 A 换到 B）只是改配置，不改代码。
 * 契约见 docs/认知层设计.md。
 */

const ID_RE = /^[a-z][a-z0-9_-]{0,31}$/
const TOOL_RE = /^[a-z][a-z0-9_]{1,63}$/

const clamp = (v, lo, hi, dflt) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.max(lo, Math.min(hi, Math.round(n)))
}

function cleanTools(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const x of list) {
    const s = String(x ?? '').trim()
    if (!TOOL_RE.test(s) || out.includes(s)) continue
    out.push(s)
  }
  return out.slice(0, 12)
}

/**
 * 把配置里的 sources 归一成干净清单。
 * 丢掉：id 不合法、不是对象、read/act 都空的、工具名不像工具名的。
 * @returns {Array<{id,title,enabled,read,act,budget,offpeak,summaryMax}>}
 */
export function normalizeSources(raw) {
  if (!raw || typeof raw !== 'object') return []
  const out = []
  for (const [id, v] of Object.entries(raw)) {
    if (!ID_RE.test(id) || !v || typeof v !== 'object') continue
    const read = cleanTools(v.tools?.read)
    const act = cleanTools(v.tools?.act)
    if (!read.length && !act.length) continue
    out.push({
      id,
      title: String(v.title ?? id).slice(0, 40),
      enabled: v.enabled !== false,
      read,
      act,
      budget: { perDay: clamp(v?.budget?.perDay, 0, 24, 3) },
      offpeak: Array.isArray(v.offpeak) ? v.offpeak.map(String).filter((x) => ['noon', 'night'].includes(x)) : null,
      summaryMax: clamp(v.summaryMax, 20, 400, 120),
    })
  }
  // 顺序稳定：按配置里的书写顺序（Object.entries 保持插入序）
  return out
}

/** 打开的那些。 */
export function enabledSources(sources = []) {
  return (Array.isArray(sources) ? sources : []).filter((s) => s?.enabled !== false)
}

export function sourceById(sources = [], id = '') {
  return (sources ?? []).find((s) => s.id === id) ?? null
}

/**
 * 下一次该去哪个源：**最久没去过的优先**（从没去过的最优先）。
 * @param {Array} sources 已启用清单
 * @param {Record<string, number>} lastUsed 每个源的最近使用时间戳
 */
export function pickNextSource(sources = [], lastUsed = {}) {
  const list = enabledSources(sources)
  if (!list.length) return null
  let best = null
  for (const s of list) {
    const at = Number(lastUsed?.[s.id]) || 0
    if (!best || at < best.at) best = { source: s, at }
  }
  return best?.source ?? null
}
