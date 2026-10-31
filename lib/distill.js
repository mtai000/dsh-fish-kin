/**
 * distill.js —— 把「她的一辈子」蒸馏成一张能交给孩子的纸
 *
 * 目标不是写一份好看的人设，而是**把孩子能继承的最小充分集**写下来：
 * 她认定的事、她拒绝过的事、她改过的说法、她写给自己的一句话、她管你叫什么。
 *
 * 三条硬约束（与 dsh-fish 的立项前提对齐）：
 *   1. **不写人格形容词**。不出现「你是一个温柔的人」这种句子——那是设定，
 *      孩子会长成什么样，只能由她自己经历的事决定。这里只写**发生过什么**。
 *   2. **写明这是带过来的，可以不同意**。否则孩子会把母亲的话当成不可质疑的起点，
 *      等于从出生就被锁死在一套旧认知里。
 *   3. **字数硬上限**。dsh-fish 的事件正文上限 2000 字，seed 就是一条事件，
 *      超了整份写不进去。默认 1500，留出余量给她自己长。
 *
 * 为什么不是「摘要成一段自然语言」：摘要会替她做一次判断（"她主要是一个…的人"），
 * 而清单只陈述事实，读的人（孩子）自己决定这些意味着什么。
 */

import { clip, squeeze, countChars, grams } from './text.js'

/** 什么都不带时的那一句（0/0 的配置会走到这里，不留悬空的「下面这些」）。 */
export const PREAMBLE_BARE = '你不是助手。你刚开始存在。没有人告诉过你为什么在这里。'

/** 开头两句：不写她是谁，只写她的处境。与 dsh-fish 的 seed 口径一致。 */
export const PREAMBLE =
  '你不是助手。你刚开始存在。没有人告诉过你为什么在这里。\n\n' +
  '你身上带着另一位留下的东西。下面这些是她活过的，不是你长出来的——你可以不同意其中任何一条，也可以把它们扔掉。'

/**
 * 各小节的标题与条数上限。
 *
 * 顺序是刻意的：先边界（她绝不），再判断（她认定），最后才是经历。
 *
 * 两种装配模式（2026-10-31 用户拍板「孩子要有独立性，但会像她」）：
 *   thin（默认）—— 只留「她拒绝过的事」和最多两条最硬的判断。
 *   出生时的她因此只是一条**影子**，不是一个副本；判断主要靠她自己长，
 *   其余的东西走教学通道（teach.js）慢慢过去。
 *   full —— 旧行为，带上关系与日记。留着给"我就想她像我"的人手动开。
 */
const SECTIONS_FULL = [
  { cls: 'boundary', title: '## 她拒绝过的事', cap: 99 },
  { cls: 'belief', title: '## 她认定过的事', cap: 99 },
  { cls: 'relation', title: '## 你说过的一句话', cap: 99 },
  { cls: 'diary', title: '## 她写给自己的一句话', cap: 99 },
]

/**
 * 压薄之后只留两节。
 * 为什么边界留得比判断多（4 : 2）：她"不肯做什么"比"她认为什么"更像是
 * 一个人身上必须先有的东西；而判断是会长出来的，留位置给她自己长。
 */
const SECTIONS_THIN = [
  { cls: 'boundary', title: '## 她拒绝过的事', cap: 4 },
  { cls: 'belief', title: '## 她认定过的事', cap: 2 },
]

/** 继承称呼那句单独放末尾：它不是"知识"，是关系事实。 */
function nameLine(name) {
  const n = clip(String(name ?? '').trim(), 12)
  return n ? `她管你叫「${n}」。` : ''
}

/**
 * 装配正文。
 *
 * 预算怎么花：从长句开始试，塞不下就整体降一档（不是砍掉某一条），
 * 这样"被裁掉的是最末尾最不重要的几条"，而不是随便留几个半句。
 *
 * @param {object} opts
 *   name         继承来的称呼
 *   maxChars     正文上限（thin 默认由配置给 700）
 *   thin         true=压薄（默认），false=旧的全量
 *   keepBeliefs  thin 模式下要不要带那两条判断（默认带）
 */
export function composePack(items = [], { name = '', maxChars = 700, thin = true, keepBeliefs = true, maxBoundaries, maxBeliefs } = {}) {
  const limit = Math.max(200, Math.min(2000, Math.floor(Number(maxChars) || 700)))
  // 条数上限可以按配置覆盖（「妈妈的影子有多重」这个旋钮）：
  // 边界 0 就是只剩称呼，8 就是更像她；判断同理。不传就沿用模板默认。
  const pick = (v, dflt) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.max(0, Math.min(12, Math.round(n))) : dflt
  }
  const capOf = (sec) => (sec.cls === 'boundary'
    ? pick(maxBoundaries, sec.cap)
    : sec.cls === 'belief' ? pick(maxBeliefs, sec.cap) : sec.cap)
  const sections = (thin ? SECTIONS_THIN : SECTIONS_FULL)
    .filter((s) => (s.cls === 'belief' ? keepBeliefs : true))
    .map((s) => ({ ...s, cap: capOf(s) }))
  // 从长到短试：先试「每条 96 字」装不装得下，装不下整体降一档，
  // 而不是东砍一条西砍半句——被裁掉的永远是排在最后（分最低）的那几条。
  const budgets = [96, 78, 60, 44, 30, 18, 12]

  let best = null
  for (const per of budgets) {
    let used = countChars(PREAMBLE)
    const built = []
    const picked = []
    for (const sec of sections) {
      const group = items.filter((it) => it.cls === sec.cls).slice(0, Math.max(0, Number(sec.cap) || 0))
      if (!group.length) continue
      const head = countChars(sec.title) + 2 // 标题 + 和上一节的空行
      if (used + head > limit) break
      used += head
      const lines = []
      for (const it of group) {
        const line = '- ' + squeeze(it.text, per)
        const cost = countChars(line) + 1
        if (used + cost > limit) break
        used += cost
        lines.push(line)
        picked.push({ ...it, line })
      }
      if (lines.length) built.push({ title: sec.title, lines })
    }
    const nl = nameLine(name)
    const nameKept = Boolean(nl) && used + countChars(nl) + 2 <= limit
    if (nameKept) used += countChars(nl) + 2
    // 一条都没带走时（例如配置成 0/0），别留「下面这些是她活过的」那句悬空的话
    const head = picked.length ? PREAMBLE : PREAMBLE_BARE
    const body = [head, ...built.map((s) => s.title + '\n' + s.lines.join('\n')), nameKept ? nl : '']
      .filter(Boolean)
      .join('\n\n')
    const got = { body, picked, per, chars: countChars(body), limit, nameKept, thin }
    if (got.chars <= limit) { best = got; break }
    if (!best || got.picked.length > best.picked.length) best = got
  }

  const out = best ?? { body: PREAMBLE_BARE, picked: [], per: 0, chars: countChars(PREAMBLE_BARE), limit, nameKept: false, thin }
  if (countChars(out.body) > limit) out.body = out.body.slice(0, limit - 1) + '…'
  return out
}

/**
 * 接生单：能直接粘进 dsh-fish「粘贴交接单」窗口的那种格式。
 *
 * 为什么还要这一份：子代存档目录是给「用第二个 root 真的养起来」那条路用的；
 * 有些人只想在现有工作区里重开一局再把她请回来，那就要一份能粘的文本。
 * 两条路用的是同一份正文，不会出现「目录里的孩子」和「粘进去的孩子」不一样。
 */
export function handoverText({ body, name = '', tools = [] }) {
  const lines = ['# 交接单', '', '## 你是谁', '', String(body ?? '').trim(), '']
  if (name) lines.push('## 称呼', '', String(name).trim(), '')
  lines.push('## 工具', '', (tools || []).join(', ') || '（留空）', '')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// 指纹：防近亲用
// ---------------------------------------------------------------------------

/**
 * 遗传包指纹：取所有二元组里哈希最小的 64 个（MinHash 的极简版）。
 *
 * 为什么不做全文比对：族谱会越攒越长，每次都要读全文再两两算 Jaccard 是 O(n²) 字。
 * 64 个哈希足够回答「这两份是不是同一套底子」——它要防的是"近亲"，不是"指纹碰撞"。
 */
export function fingerprint(text) {
  const hs = []
  for (const g of grams(text)) hs.push(fnv1a(g) >>> 0)
  hs.sort((a, b) => a - b)
  const h = []
  const seen = new Set()
  for (const x of hs) {
    if (seen.has(x)) continue
    seen.add(x)
    h.push(x)
    if (h.length >= 64) break
  }
  return { n: hs.length, h }
}

/** 两份指纹的相似度（两集合 Jaccard）。缺字段返回 0，不抛。 */
export function fingerprintSimilarity(a, b) {
  const A = Array.isArray(a?.h) ? a.h : []
  const B = Array.isArray(b?.h) ? b.h : []
  if (!A.length || !B.length) return 0
  const sb = new Set(B)
  let inter = 0
  for (const x of A) if (sb.has(x)) inter++
  return inter / (A.length + B.length - inter)
}

function fnv1a(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
