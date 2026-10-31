/**
 * life.js —— 「她活了多少」按**记忆**算，不按日历
 *
 * 2026-10-31 用户的问题：「感觉生命周期不应该按时间算？或许按记忆的情况来计算？」
 *
 * 为什么要改：时间是个坏尺子。一条鱼可以被扔在角落里 200 天，一条事件都没多——
 * 按天数算她已经"老"了，按记忆算她还是个空壳。反过来，有人一天陪她说三十句，
 * 日历只走了一天，但她已经想通了不少事。
 *
 * 所以这里只数**记忆里真有的东西**：
 *   events     她名下的事件总条数（说过的话、拒绝、日记、梦……）
 *   beliefs    其中"她自己的判断"：utterance / revise / narration
 *   boundaries 她拒绝过的事：refusal
 *   diaries    她写下的日记
 *   chars      正文总字数
 *
 * 刻意**不**产出"几岁""第几天"这种换算——那会立刻变回一块日历，
 * 而且会跟 dsh-fish 自己的「你存在了 N 天」打架（那个是按天算的，改不了）。
 * 我们只说事实：她攒下了多少。
 */

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 「她自己的判断」：这三类才是她想出来的东西，旁听和读到的不算。 */
const BELIEF_TYPES = new Set(['utterance', 'revise', 'narration'])

/** 一个孩子目录 -> 她的记忆概况。同步读（system prompt 段要求同步），带 mtime 缓存。 */
const cache = new Map()

export function childMemory(childDir) {
  if (!childDir) return null
  const file = join(String(childDir), 'events.jsonl')
  let st = null
  try {
    st = statSync(file)
  } catch {
    return null
  }
  const hit = cache.get(file)
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.memory

  const memory = { events: 0, beliefs: 0, boundaries: 0, diaries: 0, chars: 0, firstAt: '', lastAt: '' }
  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  for (const line of raw.split('\u000a')) {
    const s = line.trim()
    if (!s) continue
    let ev = null
    try {
      ev = JSON.parse(s)
    } catch {
      continue
    }
    if (!ev || typeof ev !== 'object' || !ev.id) continue
    memory.events++
    const text = typeof ev.text === 'string' ? ev.text : ''
    memory.chars += text.length
    const type = String(ev.type ?? '')
    if (BELIEF_TYPES.has(type)) memory.beliefs++
    else if (type === 'refusal') memory.boundaries++
    else if (type === 'diary') memory.diaries++
    const ts = typeof ev.ts === 'number' ? new Date(ev.ts).toISOString() : String(ev.ts ?? '')
    if (ts) {
      if (!memory.firstAt || ts < memory.firstAt) memory.firstAt = ts
      if (!memory.lastAt || ts > memory.lastAt) memory.lastAt = ts
    }
  }

  cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, memory })
  return memory
}

/**
 * 说给妈妈听的一句：只讲"攒下了多少"，不讲"多大"。
 * 没有记忆时返回空串（调用方自己决定要不要写这一行）。
 */
export function memoryLine(memory) {
  if (!memory || !memory.events) return ''
  const bits = [`她现在攒下了 ${memory.events} 条自己的事`]
  if (memory.beliefs) bits.push(`其中 ${memory.beliefs} 条是她自己的判断`)
  if (memory.boundaries) bits.push(`${memory.boundaries} 条是她不肯做的`)
  return bits.join('，') + '。'
}

/** 给界面用的分档：不是年龄，是"她脑子里现在有多少东西"。 */
export function memoryBand(memory) {
  const n = Number(memory?.beliefs ?? 0)
  if (!memory || !memory.events) return 'blank'
  if (n === 0) return 'listening'
  if (n <= 2) return 'first-thoughts'
  if (n <= 9) return 'own-opinions'
  return 'herself'
}

export const BAND_LABEL = Object.freeze({
  blank: '还是空的',
  listening: '在听，还没说过自己的判断',
  'first-thoughts': '开始有自己的想法了',
  'own-opinions': '有自己的看法了',
  herself: '已经是她自己了',
})
