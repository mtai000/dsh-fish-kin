/**
 * fish/store.js —— 她自己的事件流（我们自己的格式，见 schema.js）
 *
 * 位置：默认 `~/.dsh-fish-kin/fish/`（**我们自己的目录**，不借别人的家）。
 * 可用 `DSH_KIN_FISH_HOME` 覆盖；传参优先。
 *
 * 三条铁律：只能追加、不能删改、坏行跳过。
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { normalize, toDisk, newId, MAX_TEXT, HER_KINDS, TYPE_TO_KIND, KIND_TO_TYPE } from './schema.js'

const VALID_KINDS = new Set(Object.keys(KIND_TO_TYPE))

/** 她的家：我们自己的目录。 */
export function defaultRoot(env = process.env) {
  const e = String(env.DSH_KIN_FISH_HOME ?? '').trim()
  if (e) return e
  // 她的家在**家族工作区**里：工作区可以整个搬走，她不单独漂在外面。
  return join(familyRootOf(env), 'fish')
}

/** 延迟 require，避免 store ↔ locate 的循环依赖在加载期就炸。 */
function familyRootOf(env) {
  try {
    // 同步解析：store 的很多调用点都是同步函数
    const { familyRoot } = requireLocate()
    return familyRoot({ env })
  } catch {
    return join(homedir(), '.dsh-fish-kin')
  }
}

let _locate = null
function requireLocate() {
  if (_locate) return _locate
  // eslint-disable-next-line no-eval
  _locate = globalThis.__kinLocate ?? null
  if (!_locate) throw new Error('locate 还没注入')
  return _locate
}

/** boot 时注入（纯同步模块不好直接 import，ESM 循环依赖会先执行另一半）。 */
export function injectLocate(mod) {
  _locate = mod
  globalThis.__kinLocate = mod
}

export function paths(root) {
  return {
    root,
    events: join(root, 'events.jsonl'),
    config: join(root, 'config.json'),
    home: join(root, 'home'),
    homeJson: join(root, 'home.json'),
    diaryDir: join(root, 'diary'),
    imported: join(root, 'imported.json'),
  }
}

export async function ensureDirs(root) {
  const p = paths(root)
  await fs.mkdir(p.home, { recursive: true })
  await fs.mkdir(p.diaryDir, { recursive: true })
}

/** 宽容读：坏行跳过；返回的是**归一化后的内存形状**。 */
export async function readEvents(root) {
  const p = paths(root).events
  let raw = ''
  try {
    raw = await fs.readFile(p, 'utf8')
  } catch (err) {
    if (err?.code === 'ENOENT') return { events: [], skipped: 0 }
    throw err
  }
  const events = []
  let skipped = 0
  for (const line of raw.split('\n')) {
    const s = line.trim()
    if (!s) continue
    try {
      const ev = normalize(JSON.parse(s))
      if (ev) events.push(ev)
      else skipped++
    } catch {
      skipped++
    }
  }
  return { events, skipped }
}

/**
 * 追加一条。入参可以是内存形状（type/text）也可以是磁盘形状（kind/body）。
 * 校验：类型合法、正文非空（seed/note/woke 除外）、长度封顶、amend 必须指回真实 id。
 */
export async function appendEvent(root, raw = {}, { source = 'system', now = Date.now(), day = 1 } = {}) {
  const kind = String(raw.kind ?? TYPE_TO_KIND[String(raw.type ?? '')] ?? '')
  if (!VALID_KINDS.has(kind)) return { ok: false, why: `不认识的类型：${kind || raw.type || '?'}` }
  const text = String(raw.body ?? raw.text ?? '').trim()
  const needsText = kind !== 'note' && kind !== 'woke'
  if (needsText && !text) return { ok: false, why: '正文是空的' }
  if (text.length > MAX_TEXT) return { ok: false, why: `超过 ${MAX_TEXT} 字` }

  const refs = Array.isArray(raw.refs) ? raw.refs.filter((x) => typeof x === 'string' && x) : []
  if (kind === 'amend') {
    if (!refs.length) return { ok: false, why: '改口要指回你在改的那一句（refs）' }
    const { events } = await readEvents(root)
    const known = new Set(events.map((e) => e.id))
    if (!refs.every((r) => known.has(r))) return { ok: false, why: 'refs 里有不存在的事件 id' }
  }

  const meta = raw.meta && typeof raw.meta === 'object' ? { ...raw.meta } : {}
  const ev = {
    id: newId(now),
    v: 1,
    ts: new Date(now).toISOString(),
    day: Number.isInteger(raw.day) ? raw.day : Number(day) || 1,
    type: KIND_TO_TYPE[kind],
    kind,
    text,
    refs,
    verdict: ['confirmed', 'refuted', 'refined'].includes(raw.verdict) ? raw.verdict : null,
    ...(Object.keys(meta).length ? { meta } : {}),
    confidence: Number.isFinite(Number(raw.confidence)) ? Math.max(0, Math.min(1, Number(raw.confidence))) : 0.5,
    source,
  }
  await fs.mkdir(root, { recursive: true })
  await fs.appendFile(paths(root).events, JSON.stringify(toDisk(ev)) + '\n', 'utf8')
  return { ok: true, event: ev }
}

/** 播种：只写一次。 */
export async function ensureSeed(root, seedText) {
  const { events } = await readEvents(root)
  if (events.some((e) => e.kind === 'seed')) return { created: false }
  const r = await appendEvent(root, { kind: 'seed', body: String(seedText || '你不是助手。你刚开始存在。没有人告诉过你为什么在这里。') }, { source: 'system' })
  return { created: r.ok }
}

export { HER_KINDS, MAX_TEXT }
