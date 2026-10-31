/**
 * fish/derive.js —— 把事件流算成「此刻的她」（纯函数，不读盘、不写盘）
 *
 * 自研版的取舍：**只留三条**——第几天、她怎么称呼你、她说过什么。
 * 不做四阶段、不做疤、不做立场清单：那是 dsh-fish（26k 行、1001 条测试）的活儿，
 * 我们这条鱼要的是"能长大、能被继承"，不是一次把它的十年补完。
 *
 * 但有一条必须守住：**判断只来自她自己说出口的话**（utterance/revise），
 * 别人说的、她读到的、我们写的，都不算。
 */

const DAY_MS = 86_400_000

/** 从 seed 的时间起算第几天（不因没互动暂停，也不回退）。 */
export function dayOf(events, now = Date.now()) {
  const seed = events.find((e) => e?.type === 'seed')
  const t = seed ? Date.parse(String(seed.ts ?? '')) : NaN
  if (!Number.isFinite(t)) return 1
  return Math.max(1, Math.floor((now - t) / DAY_MS) + 1)
}

const NAME_SAY = /(?:叫你|称呼你|叫他|称呼他)(?:做|为|作|叫)?\s*[「“"']?([^\s，。！？,.!?」”"']{1,8})/
const NAME_META = /^import-name:(.+)$/

/** 她怎么称呼你：她说过的话最优先，其次是我们替她记下的。 */
export function nameOf(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e?.type !== 'meta') continue
    const m = String(e.text ?? '').match(NAME_META)
    if (m) return m[1].trim().slice(0, 8)
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (!['utterance', 'revise'].includes(String(e?.type))) continue
    const m = String(e.text ?? '').match(NAME_SAY)
    if (m) {
      const n = m[1].replace(/[了吧呢啊嘛哦诶欸呀哈哇哦嘞好]+$/, '').trim()
      if (n && !['你', '我', '他', '她', '自己'].includes(n)) return n
    }
  }
  return ''
}

/** 她的判断：越近越靠后（不聚类、不排序——这条鱼还小，先老实按时间）。 */
export function beliefsOf(events, limit = 8) {
  const list = events.filter((e) => ['utterance', 'revise'].includes(String(e?.type)) && String(e.text ?? '').trim())
  return list.slice(-Math.max(1, limit))
}

/** 最近想去认识什么（认知层 intent）。 */
export function intentsOf(events, limit = 10) {
  return events.filter((e) => String(e?.type) === 'intent' && String(e.text ?? '').trim()).slice(-Math.max(1, limit))
}

/** 最近看到了什么（外部插件回报的 perceived）。 */
export function perceivedOf(events, limit = 10) {
  return events.filter((e) => String(e?.type) === 'perceived' && String(e.text ?? '').trim()).slice(-Math.max(1, limit))
}

export function refusalsOf(events, limit = 6) {
  return events.filter((e) => String(e?.type) === 'refusal' && String(e.text ?? '').trim()).slice(-Math.max(1, limit))
}

/**
 * 一次算全。
 * `stage` 不做——我们只用"活了几天"和"攒了多少"这两个事实。
 */
export function derive(events = [], now = Date.now()) {
  const seed = events.find((e) => e?.type === 'seed')
  const beliefs = beliefsOf(events)
  const refusals = refusalsOf(events)
  const diaries = events.filter((e) => String(e?.type) === 'diary')
  const intents = intentsOf(events)
  const perceived = perceivedOf(events)
  const last = events[events.length - 1]
  return {
    day: dayOf(events, now),
    name: nameOf(events),
    seed: String(seed?.text ?? ''),
    beliefs,
    refusals,
    diaryCount: diaries.length,
    intents,
    perceived,
    intentCount: events.filter((e) => String(e?.type) === 'intent').length,
    perceivedCount: events.filter((e) => String(e?.type) === 'perceived').length,
    beliefCount: events.filter((e) => ['utterance', 'revise'].includes(String(e?.type))).length,
    refusalCount: events.filter((e) => String(e?.type) === 'refusal').length,
    eventCount: events.length,
    chars: events.reduce((n, e) => n + (typeof e.text === 'string' ? e.text.length : 0), 0),
    lastAt: last?.ts ?? '',
  }
}
