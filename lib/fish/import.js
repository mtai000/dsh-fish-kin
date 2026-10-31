/**
 * fish/import.js —— 从 dsh-fish 的旧档搬过来（一次性）
 *
 * 用户定的是"格式也自定"，所以这不是"兼容层"，是**搬家**：
 * 读它那一行一条的旧事件，按我们的 schema 重新落盘（新的 fe_ id，原来的 id 记在 origin 里）。
 *
 * 搬什么：seed / 她说的话 / 改口 / 拒绝 / 日记 / 附注；其余类型（narration、heard、voice、
 * dream、ask、absence…）统一降级成 note，并把原类型写进 origin——**不丢，但不再是她的判断**。
 *
 * 不搬：cookie（在 owner.json 里，是凭据不是记忆）、配置、会话 id、观测台数据。
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { normalize, toDisk, newId, KIND_TO_TYPE } from './schema.js'
import { paths, appendEvent, readEvents } from './store.js'

/** 纯函数：一行一条的旧档文本 → 我们的磁盘行（便于测试，不做 IO）。 */
export function convert(rawText, { now = Date.now() } = {}) {
  const rows = []
  let skipped = 0
  const counts = {}
  for (const line of String(rawText ?? '').split('\n')) {
    const s = line.trim()
    if (!s) continue
    let obj = null
    try {
      obj = JSON.parse(s)
    } catch {
      skipped++
      continue
    }
    const ev = normalize(obj)
    if (!ev) {
      skipped++
      continue
    }
    const origin = ev.origin || String(obj.type ?? '')
    // 旧档里"她的判断"只有 utterance/revise/refusal/diary；其余降级成 note
    const keep = ['seed', 'utterance', 'revise', 'refusal', 'diary'].includes(String(obj.type ?? ''))
    const kind = keep ? (ev.kind || 'note') : 'note'
    const ts = ev.ts || new Date(now).toISOString()
    rows.push(toDisk({
      id: newId(now + rows.length),
      v: 1,
      ts,
      day: Number.isInteger(obj.day) ? obj.day : 1,
      type: KIND_TO_TYPE[kind] ?? 'meta',
      text: String(obj.text ?? ''),
      refs: Array.isArray(obj.refs) ? obj.refs : [],
      verdict: obj.verdict ?? null,
      confidence: Number(obj.confidence) || 0.5,
      source: String(obj.source ?? 'system'),
      origin,
    }))
    counts[kind] = (counts[kind] ?? 0) + 1
  }
  return { rows, skipped, counts }
}

/**
 * 执行搬家。目标已有事件时默认拒绝（不覆盖任何人的记忆）。
 *
 * @returns {Promise<{ok:boolean, why:string, count:number, skipped:number, counts:object}>}
 */
export async function importFromDshFish({ from, to, force = false, now = Date.now() } = {}) {
  if (!from || !to) return { ok: false, why: '要给 from 和 to', count: 0, skipped: 0, counts: {} }
  let raw = ''
  try {
    raw = await fs.readFile(join(from, 'events.jsonl'), 'utf8')
  } catch (err) {
    if (err?.code === 'ENOENT') return { ok: false, why: `那边没有 events.jsonl（${from}）`, count: 0, skipped: 0, counts: {} }
    throw err
  }

  const { events } = await readEvents(to)
  if (events.length && !force) {
    return { ok: false, why: '这边已经有她的记忆了，不覆盖（要强行合并就传 force）', count: 0, skipped: 0, counts: {} }
  }

  const { rows, skipped, counts } = convert(raw, { now })
  if (!rows.length) return { ok: false, why: '那边一条能搬的都没有', count: 0, skipped, counts }

  await fs.mkdir(to, { recursive: true })
  await fs.appendFile(paths(to).events, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')

  try {
    await fs.writeFile(paths(to).imported, JSON.stringify({
      from,
      at: new Date(now).toISOString(),
      count: rows.length,
      skipped,
      counts,
    }, null, 2) + '\n', 'utf8')
  } catch { /* 标记写不上不影响记忆已经搬过来了 */ }

  return { ok: true, why: '', count: rows.length, skipped, counts }
}

/** 从她的家找旧档（只在"我们的家还没有记忆"时才自动搬）。 */
export async function maybeAutoImport({ from, to, now = Date.now() } = {}) {
  try {
    const { events } = await readEvents(to)
    if (events.length) return { ok: false, skipped: true, why: '这边已经有记忆了' }
  } catch {
    return { ok: false, skipped: true, why: '读不到目标' }
  }
  const r = await importFromDshFish({ from, to, now })
  return { ...r, skipped: !r.ok }
}

export { appendEvent }
