/**
 * text.js —— 纯文本工具（不读盘、不碰配置）
 *
 * 与 dsh-fish 的关系：它 `lib/derive.js` 里有一个 `similarity()`，但那个函数
 * 按「两句话是不是同一件事」调过参（剥否定、按标点切分）。遗传包要的是
 * **另一件事**：判断两段话值不值得合并成一条「她反复说过的事」。口径不同，
 * 所以这里重写一份，并把自己的口径写清楚，不冒充它那一份。
 */

/** 归一化：全角标点、空白、大小写。只用于比较，不用于展示。 */
export function norm(s) {
  return String(s ?? '')
    .replace(/\s+/g, '')
    .replace(/[，。！？、；：""''「」『』（）()【】\[\]…—~～·,\.!?;:"'`]/g, '')
    .toLowerCase()
}

/** 字符二元组。单字文本退回单字集合，保证「不要」和「不想」也有可比性。 */
export function grams(s) {
  const t = norm(s)
  if (t.length <= 1) return new Set(t ? [t] : [])
  const out = new Set()
  for (let i = 0; i + 1 < t.length; i++) out.add(t.slice(i, i + 2))
  return out
}

/**
 * 相似度：二元组 Jaccard，0–1。
 *
 * 为什么不用编辑距离：她的一句话常是「我不想再看这种视频了」vs「这种视频我不想看」，
 * 语序换了编辑距离就崩，而「是不是同一件事」看的是词面重合。
 */
export function similarity(a, b) {
  return similaritySets(grams(a), grams(b))
}

/**
 * 已经算好二元组时的版本。聚类里每个事件只算一次 grams，
 * 不要为每次比较重新构造 Set（1500 条记忆时会差出十倍时间）。
 */
export function similaritySets(A, B) {
  if (!A || !B || !A.size || !B.size) return 0
  let inter = 0
  const [small, big] = A.size <= B.size ? [A, B] : [B, A]
  for (const g of small) if (big.has(g)) inter++
  const denom = A.size + B.size - inter
  if (denom <= 0) return 0
  return inter / denom
}

/** 按字符裁断（中文一个字算一个），超长补省略号。 */
export function clip(s, n) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  const max = Math.max(1, Math.floor(Number(n) || 0))
  if (t.length <= max) return t
  return t.slice(0, Math.max(1, max - 1)) + '…'
}

/** 取第一句（按中文句读切），用来把长段落压成一条子弹。 */
export function firstSentence(s) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  const m = t.match(/^[\s\S]*?[。！？!?]/)
  return (m ? m[0] : t).trim()
}

/** 字数（按字符，不按字节——预算用的是中文「字」，不是 UTF-8 字节）。 */
export function countChars(s) {
  return String(s ?? '').length
}

/** 去掉开头的序号 / 列表符号 / 引号，让摘出来的句子能直接排在一起。 */
export function tidyLine(s) {
  return String(s ?? '')
    .replace(/^\s*[-*·•]\s*/, '')
    .replace(/^\s*\d+[.、)]\s*/, '')
    .replace(/^["'「『]+|["'」』]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 把一段候选句子压到 n 字以内，尽量在句号处断。
 * 遗传包的字数预算是硬上限（seed 事件上限 2000 字），所以这个函数必须可预测。
 */
export function squeeze(s, n) {
  const t = tidyLine(s)
  const max = Math.max(1, Math.floor(Number(n) || 0))
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const stop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('；'), cut.lastIndexOf('，'))
  const head = stop > Math.floor(max * 0.4) ? cut.slice(0, stop) : cut
  return head.replace(/[，；]$/, '') + '…'
}

/** 路径统一成可比形态（Windows 大小写不敏感、斜杠方向不一）。 */
export function normPath(p) {
  return String(p ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** 指代过滤器：把「他」这类男字旁的字词换掉，界面文案统一用「你」。 */
export function deHe(s) {
  return String(s ?? '').replace(/(?<!其)他(?!们|人)/g, '你')
}
