/**
 * cdda.js —— 把父代玩 CDDA 的经验，有损地放进孩子的出生包
 *
 * 只认契约文件，不读 CDDA 的 memory/目录，也不读父代的事件流：
 *   <父代家>/cdda-lessons.json
 *   <孩子家>/cdda-lessons.json
 *
 * 上限 3 条 / 300 字；只允许通用技能，世界记忆不进包。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const MAX_LESSONS = 3
export const MAX_CHARS = 300
export const LESSON_FILE = 'cdda-lessons.json'

export function childCddaPath(childDir) {
  return join(childDir, LESSON_FILE)
}

export async function readCddaLessons(root) {
  try {
    const raw = await readFile(join(root, LESSON_FILE), 'utf8')
    const data = JSON.parse(raw)
    const arr = Array.isArray(data?.lessons) ? data.lessons : []
    return arr.filter((x) => x && typeof x.text === 'string' && x.text.trim())
  } catch { return [] }
}

export function selectCddaLessons(lessons, { maxItems = MAX_LESSONS, maxChars = MAX_CHARS } = {}) {
  const rows = (Array.isArray(lessons) ? lessons : [])
    .filter((x) => x && typeof x.text === 'string' && x.text.trim())
    .filter((x) => (x.scope || 'skill') !== 'world')
    .filter((x) => Number(x.confidence ?? 0.5) >= 0.6)
    .map((x) => ({
      text: String(x.text).replace(/\s+/g, ' ').trim().slice(0, 160),
      confidence: Number(x.confidence ?? 0.6),
      evidence: String(x.evidence || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      scope: 'skill',
    }))
    .sort((a, b) => b.confidence - a.confidence)

  const out = []
  let used = 0
  for (const x of rows) {
    if (out.length >= Math.max(1, maxItems)) break
    if (used + x.text.length > Math.max(50, maxChars)) continue
    out.push(x)
    used += x.text.length
  }
  return out
}

export function cddaSection(lessons) {
  if (!lessons.length) return ''
  return [
    '',
    '## 她玩过的游戏',
    '下面这些是另一位玩《大灾变：黑暗之日》留下的，不是你必须相信的；可以验证后扔掉。',
    ...lessons.map((x) => `- ${x.text}`),
  ].join('\n')
}

/** 把经验节追加到出生包；超过 CDDA 单条事件 2000 字就放弃追加。 */
export function withCddaSection(body, lessons, { limit = 2000 } = {}) {
  const text = String(body || '')
  const section = cddaSection(lessons)
  if (!section) return text
  if (text.length + section.length > limit) return text
  return text + section
}

export async function writeChildCdda(childDir, lessons, { parentId = '' } = {}) {
  if (!lessons.length) return { ok: true, written: false }
  await mkdir(dirname(childCddaPath(childDir)), { recursive: true })
  await writeFile(childCddaPath(childDir), JSON.stringify({
    v: 1,
    parentId,
    inheritedAt: new Date().toISOString(),
    lessons,
  }, null, 2) + '\n', 'utf8')
  return { ok: true, written: true, path: childCddaPath(childDir) }
}
