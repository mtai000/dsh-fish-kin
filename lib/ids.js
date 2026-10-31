/**
 * ids.js —— 事件 id 生成
 *
 * 为什么要跟 dsh-fish 的 id 长得一模一样（`ev_` + 26 位 Crockford）：
 *   dsh-fish 的 `idTime()` 直接按这 10 位时间字符反解时间，观测台也按它排序。
 *   子代的第一条事件是我们亲手写进 `events.jsonl` 的，格式一旦对不上，
 *   她那条 seed 在母插件里就会显示成 1970 年、排序跑到最前面。
 *
 * 实现刻意与 dsh-fish `lib/schema.js` 的 newId 逐条对齐（同毫秒内递增），
 * 但两份代码互不 import —— 本插件只依赖「事件流格式」，不依赖它的源码。
 */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

let lastMs = 0
let lastRand = null

/** ULID 兼容：10 位时间 + 16 位随机。同毫秒内保证递增。 */
export function newEventId(now = Date.now()) {
  let ms = Number.isFinite(Number(now)) ? Math.floor(Number(now)) : Date.now()
  if (ms <= lastMs) ms = lastMs
  let rand
  if (ms === lastMs && lastRand) rand = bump(lastRand)
  else rand = randomPart()
  lastMs = ms
  lastRand = rand
  return 'ev_' + encodeTime(ms) + rand
}

/** 本插件自己的记录 id（请求单、族谱条目）。与事件 id 分开，免得被当成她的事件。 */
export function newId(prefix = 'kin') {
  const body = newEventId().slice(3)
  return `${prefix}_${body}`
}

/** 从事件 id 反解时间（毫秒）。解不出来返回 0，不抛。 */
export function idTime(id) {
  const body = String(id ?? '').replace(/^ev_/, '').slice(0, 10)
  let t = 0
  for (const ch of body) {
    const idx = CROCKFORD.indexOf(ch)
    if (idx < 0) return 0
    t = t * 32 + idx
  }
  return t
}

/** id 是否是我们能认的形状。 */
export function isEventId(id) {
  return typeof id === 'string' && /^ev_[0-9A-Z]{26}$/.test(id)
}

function encodeTime(ms) {
  let s = ''
  let t = ms
  for (let i = 0; i < 10; i++) {
    s = CROCKFORD[t % 32] + s
    t = Math.floor(t / 32)
  }
  return s
}

function randomPart() {
  let s = ''
  for (let i = 0; i < 16; i++) s += CROCKFORD[Math.floor(Math.random() * 32)]
  return s
}

function bump(prev) {
  const arr = prev.split('')
  for (let i = arr.length - 1; i >= 0; i--) {
    const idx = CROCKFORD.indexOf(arr[i])
    if (idx < 31) { arr[i] = CROCKFORD[idx + 1]; return arr.join('') }
    arr[i] = '0'
  }
  return randomPart()
}
