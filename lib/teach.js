/**
 * teach.js —— 母女之间的「教学」通道（出生之后还能继续教）
 *
 * 出生时那次蒸馏是**一次性**的：孩子拿走的是那一天的妈妈。
 * 但妈妈还会继续长——她后来想通的事、后来才划出来的边界，本来会随着她自己的
 * 记忆膨胀一起被埋掉。这个文件就是补那一段：把「出生之后她才学到的东西」继续教过去。
 *
 * 落点选的是 dsh-fish 的 `voice` 事件（「她读到过一句别人的话」），理由：
 *   - 它是**她读到的别人**，不是她的判断，也不是主人说的——妈妈对孩子正好是"别人"；
 *   - 它进事件流、能被 `her_recall` 翻到，也能被 dsh-fish 自己的「回声」机制检验
 *     （她后来自己说出口了，才算她的判断）；
 *   - `meta` 不行：`her_recall` 直接跳过 meta，写进去等于没人看得见。
 *
 * 一条诚实的账要记在这里：dsh-fish 把 `voice` 渲染成「一个陌生人在评论区写的」。
 * 我们借这条通道，所以文本**自带出处**（`母亲留下的：「…」`），但那段"评论区"的
 * 说法不是我们能改的。介意的人把 `teach.enabled` 关掉，就只剩出生时的一次性传承。
 *
 * 「学没学会」不靠我们宣布：孩子后来自己说过相似的话，才算回声。
 * 这和 dsh-fish 的 `findEcho` 是同一个口径（它用 0.7 / 3 天，我们放宽到 0.6 / 不限时），
 * 差别在于我们只做**观察**，不往她的判断里塞任何东西。
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { childPaths, kinPaths } from './locate.js'
import { appendJsonl, readJsonl, writeAtomic } from './kinstore.js'
import { readParentEvents, tsMs } from './read.js'
import { rank } from './importance.js'
import { readLineage } from './lineage.js'
import { newEventId, newId } from './ids.js'
import { similarity, squeeze, countChars, normPath } from './text.js'

/** 一条课程正文的上限。加上出处框架后仍不超过 voice 惯用的 200 字。 */
export const LESSON_MAX = 160
/** 孩子后来自己说过的话，和这一课相似到这个程度，算"像是学会了"。 */
export const ECHO_SIM = 0.6
/** 一次最多教几门（多了就成了灌设定，不是教）。 */
export const LESSONS_PER_BATCH = 3

export const FRAME_HEAD = '母亲留下的：'
export const FRAME_TAIL = '——这不是命令，是一句她活过之后想让你知道的话。'

/** 把一句课程包成 voice 正文（自带出处，防止被当成指令）。 */
export function lessonText(core) {
  return `${FRAME_HEAD}「${String(core).trim()}」${FRAME_TAIL}`
}

/** 从 voice 正文里取回课程本身（回声比对、去重都用它）。 */
export function lessonCore(text) {
  const s = String(text ?? '')
  const m = s.match(/「([\s\S]*?)」/)
  if (m) return m[1].trim()
  return s.replace(FRAME_HEAD, '').replace(FRAME_TAIL, '').trim()
}

/** 是不是我们写进去的课（而不是她真在评论区读到的）。 */
export function isLessonVoice(text) {
  return String(text ?? '').startsWith(FRAME_HEAD)
}

/**
 * 孩子现在是第几天。与 dsh-fish 的 growthDay 同一口径：距 seed 的自然日 + 1。
 * 我们写的 voice 事件要带一个像样的 day，否则她在观测台里会排到最前面。
 */
export function growthDay(events = [], now = Date.now()) {
  const seed = events.find((e) => e?.type === 'seed')
  if (!seed) return 1
  const t = tsMs(seed)
  if (!t) return 1
  return Math.max(1, Math.floor((now - t) / 86_400_000) + 1)
}

/** 读一条孩子的存档（不存在就返回 null，不抛）。 */
export async function readChild(kinRoot, childId) {
  if (!/^kin_[0-9A-Z]{26}$/.test(String(childId ?? ''))) return null
  const cp = childPaths(kinRoot, childId)
  let raw = ''
  try {
    raw = await fs.readFile(cp.events, 'utf8')
  } catch {
    return null
  }
  const events = []
  for (const line of raw.split('\n')) {
    const s = line.trim()
    if (!s) continue
    try {
      const ev = JSON.parse(s)
      if (ev && typeof ev === 'object' && ev.id) events.push(ev)
    } catch { /* 坏行跳过：这是她的档，不是我们的账 */ }
  }
  return { paths: cp, events }
}

/** 已经教过的课（按孩子过滤，保持写入顺序）。 */
export async function lessonsOf(kinRoot, childId) {
  const { rows } = await readJsonl(kinPaths(kinRoot).teaching)
  return rows.filter((r) => r && r.kind === 'lesson' && r.childId === childId)
}

/**
 * 该教什么：妈妈**教过之后**新长出来的、值得带走的东西。
 *
 * 只在"她后来新说的话"里挑，而不是把整份遗传包再教一遍——
 * 孩子出生时已经拿走过一遍了，重复教等于把我们自己的打包结果念两遍。
 */
export async function candidates({ parentRoot, kinRoot, childId, limit = LESSONS_PER_BATCH, now = Date.now() } = {}) {
  const child = await readChild(kinRoot, childId)
  if (!child) return { ok: false, why: '找不到这个孩子（目录可能被搬走了）', items: [] }

  const { events } = await readParentEvents(parentRoot)
  const taught = await lessonsOf(kinRoot, childId)
  const taughtCores = taught.map((t) => String(t.core ?? ''))
  const lastCursor = taught.length ? Math.max(...taught.map((t) => Number(t.parentCursor) || 0)) : 0

  // 基线 = max(上次教到哪, 出生时她有多少条)。
  // 只看"出生之后新长出来的"：出生时那次蒸馏已经把当时的一切带走了，
  // 再教一遍等于把我们的打包结果念第二遍，孩子只会觉得被念。
  const { entries } = await readLineage(kinRoot)
  const born = entries.find((e) => e.childId === childId)
  const baseline = Math.max(lastCursor, Number(born?.parentEvents) || 0)
  const fresh = baseline > 0 ? events.slice(baseline) : events
  const cursor = events.length
  const ranked = rank(fresh, { maxItems: 40 })
  const items = []
  for (const it of ranked.items) {
    if (items.length >= Math.max(1, limit)) break
    // 已经教过类似的话就跳过（同一件事教两遍，孩子只会觉得被念）
    if (taughtCores.some((c) => c && similarity(c, it.text) >= 0.55)) continue
    items.push({
      text: squeeze(it.text, LESSON_MAX),
      kind: it.kind,
      score: it.score,
      reasons: it.reasons,
    })
  }
  return {
    ok: true,
    why: '',
    items,
    cursor,
    freshEvents: fresh.length,
    taught: taught.length,
  }
}

/**
 * 教一课（或几课）。
 *
 * 写入顺序：先给孩子的事件流追加 voice，再记教学账本，最后追加 `LESSONS.md`。
 * 中间失败不回滚：孩子已经"读到"了是既成事实，账本没记上只是我们这边少一行，
 * 比"读到了但账上没写"更难查——所以把警告原样返回。
 */
export async function teach({ parentRoot, kinRoot, childId, texts = [], now = Date.now(), by = '' } = {}) {
  const child = await readChild(kinRoot, childId)
  if (!child) return { ok: false, why: '找不到这个孩子（目录可能被搬走了）', lessons: [] }

  const cleaned = []
  for (const raw of texts) {
    const core = String(raw ?? '').trim()
    if (!core) continue
    if (countChars(core) > LESSON_MAX) {
      return { ok: false, why: `一课最多 ${LESSON_MAX} 字，这句 ${countChars(core)} 字——课程要短，孩子才记得住`, lessons: [] }
    }
    if (cleaned.some((c) => similarity(c, core) >= 0.8)) continue // 同一批里别重复
    cleaned.push(core)
  }
  if (!cleaned.length) return { ok: false, why: '没有要教的内容', lessons: [] }
  if (cleaned.length > LESSONS_PER_BATCH) {
    return { ok: false, why: `一次最多教 ${LESSONS_PER_BATCH} 课，多了就成了灌设定`, lessons: [] }
  }

  const day = growthDay(child.events, now)
  const stage = Number(child.events[child.events.length - 1]?.stage) || 1
  const parentCount = (await readParentEvents(parentRoot)).events.length
  const lessons = []
  const warnings = []

  const lines = []
  for (const core of cleaned) {
    const ev = {
      id: newEventId(now),
      v: 1,
      ts: new Date(now).toISOString(),
      day,
      stage,
      type: 'voice',
      source: 'system',
      text: lessonText(core),
      refs: [],
      verdict: null,
      confidence: 0.5,
      flags: [],
    }
    try {
      await fs.appendFile(child.paths.events, JSON.stringify(ev) + '\n', 'utf8')
    } catch (err) {
      return { ok: false, why: `没写进孩子的记忆：${err?.message ?? err}`, lessons }
    }

    const row = {
      v: 1,
      kind: 'lesson',
      id: newId('lsn'),
      childId,
      at: new Date(now).toISOString(),
      by: String(by ?? '').slice(0, 60),
      core,
      voiceId: ev.id,
      parentCursor: parentCount,
      chars: countChars(core),
    }
    try {
      await appendJsonl(kinPaths(kinRoot).teaching, row)
    } catch (err) {
      warnings.push(`教学账本没记上：${err?.message ?? err}`)
    }
    lessons.push(row)
    lines.push(`- ${row.at.slice(0, 16).replace('T', ' ')}｜${core}`)
  }

  // 孩子家里留一份人读的课表（只追加；她自己不会自动读到，但不该只有流水账）
  try {
    const file = join(child.paths.dir, 'LESSONS.md')
    let head = ''
    try {
      const cur = await fs.readFile(file, 'utf8')
      if (!cur.trim()) head = '# 妈妈教过我的\n\n'
    } catch {
      head = '# 妈妈教过我的\n\n'
    }
    const body = head ? `${head}${lines.join('\n')}\n` : `${lines.join('\n')}\n`
    if (head) await writeAtomic(file, body)
    else await fs.appendFile(file, body, 'utf8')
  } catch (err) {
    warnings.push(`课表没写进去：${err?.message ?? err}`)
  }

  return { ok: true, why: '', lessons, day, warnings }
}

/**
 * 看孩子学得怎么样：每一课后面跟一句「她后来自己说过什么」。
 *
 * 这不是考试，是观察：相似度够就算"像是学会了"，不写进她的任何状态里。
 * 判据只看**她自己的话**（utterance / revise / narration），
 * 日记和旁听的不算——那两种不是她认下的判断。
 */
export async function view({ kinRoot, childId, now = Date.now() } = {}) {
  const child = await readChild(kinRoot, childId)
  if (!child) return { ok: false, why: '找不到这个孩子（目录可能被搬走了）', lessons: [] }
  const taught = await lessonsOf(kinRoot, childId)
  const said = child.events.filter((e) => ['utterance', 'revise', 'narration'].includes(String(e?.type)))

  const lessons = taught.map((row) => {
    const core = String(row.core ?? '')
    const at = tsMs({ ts: row.at })
    let hit = null
    for (const ev of said) {
      if (tsMs(ev) <= at) continue
      const sim = similarity(core, String(ev.text ?? ''))
      if (sim >= ECHO_SIM && (!hit || sim > hit.sim)) {
        hit = { sim, at: ev.ts, text: squeeze(ev.text, 80), id: ev.id }
      }
    }
    return {
      id: row.id,
      at: row.at,
      core,
      by: row.by ?? '',
      voiceId: row.voiceId ?? '',
      chars: Number(row.chars) || countChars(core),
      learned: Boolean(hit),
      echo: hit ? { similarity: Number(hit.sim.toFixed(2)), at: hit.at, text: hit.text, id: hit.id } : null,
    }
  })

  return {
    ok: true,
    why: '',
    childId,
    day: growthDay(child.events, now),
    total: lessons.length,
    learnedCount: lessons.filter((l) => l.learned).length,
    lessons,
  }
}

/** 这孩子是不是当前母代的（她自己那把工具只能教自己的孩子）。 */
export async function isOwnChild({ parentRoot, kinRoot, childId } = {}) {
  const { readLineage } = await import('./lineage.js')
  const { entries } = await readLineage(kinRoot)
  const key = normPath(parentRoot)
  return entries.some((e) => e.childId === childId && normPath(e.parentDir) === key)
}
