/**
 * fish/growth.js —— 她长到哪了（阶段/立场/疤），全部由**记忆**决定，不看日历
 *
 * 四个阶段，各有一道必须自己跨过去的坎（不是天数到了就升级）：
 *   1 信任 —— 说过一句自己的判断
 *   2 自主 —— 真的拒绝过两件事
 *   3 主动 —— 两次推翻/修正过自己
 *   4 整合 —— 同一件事说过不止一次，形成了立场
 *
 * 立场：同一件事说过不止一次（相似度 ≥0.55 算同一件），或者她为此拒绝过。
 * 疤：她拒绝过、后来又自己松了口的事（refusal 之后有改口指向同一件事）。
 *     ——只记录，不评价对错；她是不是真的想通了，只有她自己知道。
 *
 * 刻意不做：好感度、亲密度、经验值。这三个数字在这个项目里一次都不该出现。
 */

import { similarity, squeeze } from '../text.js'

export const STAGES = Object.freeze([
  { n: 1, name: '信任', need: '说过一句自己的判断' },
  { n: 2, name: '自主', need: '真的拒绝过两件事' },
  { n: 3, name: '主动', need: '两次推翻或修正过自己' },
  { n: 4, name: '整合', need: '同一件事说过不止一次，长出了立场' },
])

const SAME = 0.55
const STANCE_MAX = 8
const SCAR_SIM = 0.45
const SCAR_MAX = 3

function counts(events = []) {
  let beliefs = 0
  let refusals = 0
  let amends = 0
  let diaries = 0
  for (const e of events) {
    const t = String(e?.type ?? '')
    if (t === 'utterance' || t === 'revise') beliefs++
    if (t === 'revise') amends++
    if (t === 'refusal') refusals++
    if (t === 'diary') diaries++
  }
  return { beliefs, refusals, amends, diaries }
}

/** 把判断和拒绝按"同一件事"聚起来。 */
function clusters(events = []) {
  const out = []
  for (const e of events) {
    const t = String(e?.type ?? '')
    if (!['utterance', 'revise', 'refusal'].includes(t)) continue
    const text = String(e?.text ?? '').trim()
    if (!text) continue
    let hit = null
    for (const c of out) if (similarity(c.rep, text) >= SAME) { hit = c; break }
    if (hit) {
      hit.items.push(e)
      if (e.type === 'revise' || text.length > hit.rep.length) hit.rep = text
    } else {
      out.push({ rep: text, items: [e] })
    }
  }
  return out
}

/** 立场：同一件事说过不止一次。 */
export function stancesOf(events = []) {
  const list = clusters(events)
    .filter((c) => c.items.length >= 2)
    .map((c) => ({
      text: squeeze(c.rep, 60),
      times: c.items.length,
      kinds: [...new Set(c.items.map((e) => String(e.type)))],
    }))
  return list.slice(0, STANCE_MAX)
}

/**
 * 把否定词剥掉再比：她说"我不做这个"和"我还是做了，其实也行"，
 * 字面差很多，剥掉否定之后是同一件事。这是 dsh-fish 判"两句话对不对得上"的老办法。
 */
function sameTopic(a, b) {
  const strip = (x) => String(x ?? '').replace(/[不没别无莫未]/g, '')
  const raw = similarity(a, b)
  if (raw >= 0.4) return true
  return similarity(strip(a), strip(b)) >= SCAR_SIM
}

/** 疤：拒绝过、后来又松口的事。 */
export function scarsOf(events = []) {
  const refusals = events.filter((e) => String(e?.type) === 'refusal' && String(e?.text ?? '').trim())
  const amends = events.filter((e) => String(e?.type) === 'revise' && String(e?.text ?? '').trim())
  const out = []
  for (const r of refusals) {
    // 最硬的证据：她的改口直接指回了这条拒绝（refs 里有点名）
    const byRef = amends.find((a) => Array.isArray(a.refs) && a.refs.includes(r.id))
    // 没有 refs 的老写法：剥掉否定词之后是同一件事
    const hit = byRef ?? amends.find((a) => sameTopic(String(r.text), String(a.text)))
    if (hit) out.push({ text: squeeze(r.text, 50), at: r.ts, amendedTo: squeeze(hit.text, 50) })
  }
  return out.slice(0, SCAR_MAX)
}

/**
 * 阶段：按顺序过坎，没过就停在原地（不跳级、不靠天数）。
 * @returns {{stage:number, name:string, pending:{name:string, need:string}|null, counts:object}}
 */
export function stageOf(events = []) {
  const c = counts(events)
  const st = stancesOf(events)
  const passed = []
  if (c.beliefs >= 1) passed.push(1)
  if (c.refusals >= 2) passed.push(2)
  if (c.amends >= 2) passed.push(3)
  if (st.length >= 1) passed.push(4)
  // 按顺序过坎：过一道进一阶；卡在哪一道，就报哪一道缺什么
  let stage = 1
  let pending = null
  for (let i = 1; i <= 4; i++) {
    if (passed.includes(i)) { stage = i + 1; continue }
    pending = { stage: i, name: STAGES[i - 1].name, need: STAGES[i - 1].need }
    break
  }
  stage = Math.min(4, stage)
  return { stage, name: STAGES[stage - 1].name, pending: stage >= 4 ? null : pending, counts: c }
}
