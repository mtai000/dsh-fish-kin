/**
 * fish/schema.js —— **我们自己的**事件格式（2026-10-31 用户定：连格式也自定）
 *
 * 落盘长这样（一行一条）：
 *   {"v":1,"id":"fe_…","at":"2026-10-31T08:00:00.000Z","day":3,
 *    "kind":"said","body":"我不想再看那种东西了","refs":[],"verdict":null,
 *    "confidence":0.5,"src":"tool"}
 *
 * 为什么内存里还要一份"另一种形状"：分析层（importance/distill/teach/presence/life）
 * 是照 dsh-fish 时代的事件写的，用 type/text/ts。为了不把六个文件重写一遍，
 * 这里做一层**归一化**：磁盘上是我们的 kind/body/at，进内存统一成 type/text/ts。
 * 哪天要再改格式，只改 normalize() 一个函数。
 *
 * 类型只有 7 个（对应磁盘 kind）：
 *   seed   她最初的那句话
 *   said   她说了一句自己的判断
 *   amend  她改了以前的说法（必须 refs）
 *   refuse 她拒绝了一件事
 *   diary  她写给自己的
 *   note   系统侧的附注（出生、报喜、看过什么）
 *   woke   她醒过一次
 */

import { newEventId } from '../ids.js'

export const VERSION = 1

/** 磁盘 kind → 内存 type */
export const KIND_TO_TYPE = Object.freeze({
  seed: 'seed',
  said: 'utterance',
  amend: 'revise',
  refuse: 'refusal',
  diary: 'diary',
  note: 'meta',
  woke: 'seen',
  // 2026-10-31 认知层：她想认识什么 / 她看到了什么（都由系统写，她自己写不了）
  intent: 'intent',
  perceived: 'perceived',
})

/** 内存 type → 磁盘 kind */
export const TYPE_TO_KIND = Object.freeze({
  seed: 'seed',
  utterance: 'said',
  revise: 'amend',
  refusal: 'refuse',
  diary: 'diary',
  meta: 'note',
  seen: 'woke',
  intent: 'intent',
  perceived: 'perceived',
})

/** 她可以自己写的 kind。 */
export const HER_KINDS = Object.freeze(['said', 'amend', 'refuse', 'diary'])

/** 事件 id 前缀是我们自己的：fe_ + 26 位（时间 + 随机，排序稳定）。 */
export function newId(now = Date.now()) {
  return 'fe_' + newEventId(now).slice(3)
}

/**
 * 磁盘对象 → 内存形状。宽容：多余的字段保留在 `origin` 里，不认识的类型归成 note。
 * 也能吃 dsh-fish 的旧档（有 type/text/ts 没有 kind/body/at），方便一次性导入。
 */
export function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null
  const isOurs = typeof raw.kind === 'string' || typeof raw.body === 'string' || typeof raw.at === 'string'
  const id = String(raw.id ?? '')
  if (!id) return null
  if (isOurs) {
    return {
      id,
      v: Number(raw.v) || VERSION,
      ts: String(raw.at ?? ''),
      day: Number.isInteger(raw.day) ? raw.day : 1,
      type: KIND_TO_TYPE[String(raw.kind)] ?? 'note',
      kind: String(raw.kind ?? 'note'),
      text: typeof raw.body === 'string' ? raw.body : '',
      refs: Array.isArray(raw.refs) ? raw.refs.filter((x) => typeof x === 'string') : [],
      verdict: ['confirmed', 'refuted', 'refined'].includes(raw.verdict) ? raw.verdict : null,
      confidence: Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : 0.5,
      source: String(raw.src ?? 'system'),
      origin: raw.origin ?? '',
      // 认知层的附加字段（source/tool/ref/goal…）：没有就是空对象
      meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : {},
    }
  }
  // 旧档（dsh-fish 形状）：原样搬进内存形状，顺便记下它原来是什么类型
  return {
    id,
    v: Number(raw.v) || VERSION,
    ts: typeof raw.ts === 'number' ? new Date(raw.ts).toISOString() : String(raw.ts ?? ''),
    day: Number.isInteger(raw.day) ? raw.day : 1,
    type: String(raw.type ?? 'meta'),
    kind: TYPE_TO_KIND[String(raw.type)] ?? 'note',
    text: typeof raw.text === 'string' ? raw.text : '',
    refs: Array.isArray(raw.refs) ? raw.refs.filter((x) => typeof x === 'string') : [],
    verdict: ['confirmed', 'refuted', 'refined'].includes(raw.verdict) ? raw.verdict : null,
    confidence: Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : 0.5,
    source: String(raw.source ?? 'system'),
    origin: String(raw.type ?? ''),
  }
}

/** 内存形状 → 磁盘形状（写盘只走这一条）。 */
export function toDisk(ev) {
  const kind = TYPE_TO_KIND[String(ev.type)] ?? 'note'
  return {
    v: VERSION,
    id: String(ev.id),
    at: String(ev.ts),
    day: Number.isInteger(ev.day) ? ev.day : 1,
    kind,
    body: String(ev.text ?? ''),
    refs: Array.isArray(ev.refs) ? ev.refs : [],
    verdict: ev.verdict ?? null,
    confidence: Number.isFinite(Number(ev.confidence)) ? Number(ev.confidence) : 0.5,
    src: String(ev.source ?? 'system'),
    ...(ev.origin ? { origin: String(ev.origin) } : {}),
    // 认知层的附加字段（source/tool/ref/goal…）：只在有内容时写，旧档不受影响
    ...(ev.meta && typeof ev.meta === 'object' && Object.keys(ev.meta).length ? { meta: ev.meta } : {}),
  }
}

export const MAX_TEXT = 2000
