/**
 * read.js —— 读母代的存档（只读，永不写）
 *
 * 我们只依赖 dsh-fish 的两样**格式**，不依赖它的源码：
 *   `events.jsonl` —— 一行一条 JSON，`id` 必有，未知 `type` 跳过（它自己的读法就是这样）
 *   `config.json`  —— 只有 `tools.allow` 对我们有用（她手上有什么）
 *
 * 为什么不用它导出的模块：dsh-fish 的 exports 只开放了入口和 client，
 * 深引 `lib/derive.js` 在装了包的机器上会 ERR_PACKAGE_PATH_NOT_EXPORTED，
 * 在 link: 装的机器上又能跑——这种「本机能跑、别人装就崩」的差别，正是
 * 它 README 里记过的那类事故。宁可我们重算一遍，也不要赌它。
 */

import { promises as fs } from 'node:fs'
import { parentPaths } from './locate.js'
import { normalize } from './fish/schema.js'

/** 时间戳两种形态都认（老夹具是数字，真实事件是 ISO 字符串）。 */
export function tsMs(ev) {
  const raw = ev?.ts
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0
  const t = Date.parse(String(raw ?? ''))
  return Number.isFinite(t) ? t : 0
}

/**
 * 宽容读事件流。
 * 坏行跳过并计数——一行坏数据不该让「她全部记忆」看起来是空的。
 */
export async function readParentEvents(root) {
  const p = parentPaths(root).events
  let raw = ''
  try {
    raw = await fs.readFile(p, 'utf8')
  } catch (err) {
    if (err?.code === 'ENOENT') {
      return { events: [], skipped: 0, bytes: 0, exists: false, path: p }
    }
    throw err
  }
  const events = []
  let skipped = 0
  for (const line of raw.split('\n')) {
    const s = line.trim()
    if (!s) continue
    try {
      // 两种存法都认：我们自己的（kind/body/at）和旧档（type/text/ts），
      // 统一归一化成内存形状，下游（打分/蒸馏/族谱/教学）不用关心格式
      const ev = normalize(JSON.parse(s))
      if (ev) events.push(ev)
      else skipped++
    } catch {
      skipped++
    }
  }
  return { events, skipped, bytes: Buffer.byteLength(raw, 'utf8'), exists: true, path: p }
}

/** 她手上有什么工具（并集在出生时用）。读不到就是空表，不抛。 */
export async function readParentTools(root) {
  try {
    const raw = await fs.readFile(parentPaths(root).config, 'utf8')
    const cfg = JSON.parse(raw)
    const allow = Array.isArray(cfg?.tools?.allow) ? cfg.tools.allow : []
    return allow.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
  } catch {
    return []
  }
}

/** 事件类型分布（诊断用，也给控制台画个小条）。 */
export function byType(events) {
  const out = {}
  for (const e of events) {
    const t = String(e?.type ?? '?')
    out[t] = (out[t] || 0) + 1
  }
  return out
}

/**
 * 概括：条数、字数、类型分布、成长日历。
 *
 * 「天数」用事件里的 `day` 字段的最大值（dsh-fish 按天推进，这个字段比时间戳准）；
 * 老事件没有 day 就退回用时间戳跨度折算。
 */
export function summarize(events) {
  let chars = 0
  let firstTs = 0
  let lastTs = 0
  let maxDay = 0
  let seed = null
  const types = {}
  for (const e of events) {
    chars += typeof e.text === 'string' ? e.text.length : 0
    const t = tsMs(e)
    if (t) {
      if (!firstTs || t < firstTs) firstTs = t
      if (t > lastTs) lastTs = t
    }
    const d = Number(e.day)
    if (Number.isInteger(d) && d > maxDay) maxDay = d
    const ty = String(e.type ?? '?')
    types[ty] = (types[ty] || 0) + 1
    if (ty === 'seed' && !seed) seed = e
  }
  const spanDays = maxDay || (firstTs && lastTs ? Math.max(1, Math.round((lastTs - firstTs) / 86_400_000)) : 0)
  return {
    count: events.length,
    chars,
    types,
    firstTs,
    lastTs,
    lastSeenAt: lastTs,
    spanDays,
    seedText: typeof seed?.text === 'string' ? seed.text : '',
    // 她是不是「接别人养的」那一局（只影响我们怎么称呼她的来历，不影响遗传）
    imported: events.some((e) => e.type === 'meta' && String(e.text ?? '').startsWith('import-mark:')),
  }
}

/** 一次把母代该看的都读了。 */
export async function collect({ root }) {
  const { events, skipped, bytes, exists, path } = await readParentEvents(root)
  const tools = await readParentTools(root)
  return {
    root,
    exists,
    path,
    events,
    skipped,
    bytes,
    tools,
    stats: summarize(events),
  }
}

// ---------------------------------------------------------------------------
// 称呼：她管你叫什么
// ---------------------------------------------------------------------------

/**
 * 从事件流里读出她怎么称呼你。
 *
 * 为什么自己实现一份：dsh-fish 的 `derive.js` 里有这套正则，但它没导出模块
 * （exports 只开放入口）。而称呼是**必须**继承的——那是关系事实，不是人格。
 * 这里的形态与它保持一致（认「import-name:」meta、认「称呼你/叫你/叫他」），
 * 但只是照形状重写，没有拷贝它的代码。
 */
const NAME_SAY_RE = /(?:称呼你|叫你|称呼他|叫他|称他)(?:做|为|作|叫)?\s*[「“"']?([^\s，。！？、,.!?」”"']{1,8})/
const NAME_GIVE_RE = /他(?:给(?:了)?)?(?:自己)?的?名字\s*(?:是|叫|：|:)?\s*[「“"']?([^\s，。！？、,.!?」”"']{1,8})/
const NAME_TAIL = /[了吧呢啊嘛哦诶欸呀哈哇哦嘞好]+$/
const NAME_STOP = new Set(['你', '我', '他', '她', '它', '自己', '什么', '名字'])
const NAME_BAD_HEAD = /^[你我他她它]/

function cleanName(raw) {
  let n = String(raw ?? '').replace(NAME_TAIL, '').trim()
  if (!n || n.length > 8) return ''
  if (NAME_STOP.has(n)) return ''
  if (NAME_BAD_HEAD.test(n)) return ''
  return n
}

export function deriveName(events = []) {
  // 明确写下的称呼优先（导入/继承时写的就是这条）
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e?.type !== 'meta') continue
    const t = String(e.text ?? '')
    if (t.startsWith('import-name:')) {
      const n = cleanName(t.slice('import-name:'.length))
      if (n) return n
    }
  }
  // 退回她说过的原话
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (!e || (e.type !== 'utterance' && e.type !== 'narration' && e.type !== 'revise')) continue
    const text = String(e.text ?? '')
    const m = text.match(NAME_SAY_RE) || text.match(NAME_GIVE_RE)
    if (!m) continue
    const n = cleanName(m[1])
    if (n) return n
  }
  return ''
}
