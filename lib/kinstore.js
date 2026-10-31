/**
 * kinstore.js —— 产房自己的读写（原子写 + 只追加的账本）
 *
 * 三条我们自己守的规矩：
 *   1. 我们写自己的目录，**从不改母代的任何一行**。母代那边只有一种写：
 *      在 `events.jsonl` 末尾追加一条 `meta` 报喜（可关），这是 dsh-fish
 *      契约允许的唯一动作（事件流只追加）。
 *   2. 族谱 `lineage.jsonl` 同样只追加。删一条等于伪造血统。
 *   3. 配置是**环境参数**（阈值、是否继承称呼），不是人格。和 dsh-fish 一样，
 *      这里放的每一个键都能回答「它改的是她吗」——答案都是不能。
 */

import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { kinPaths } from './locate.js'

/** 原子写：写 tmp 再 rename（同盘 rename 是原子的，断电不会留半行）。 */
export async function writeAtomic(file, text, mode) {
  await fs.mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  await fs.writeFile(tmp, text, 'utf8')
  if (mode) await fs.chmod(tmp, mode).catch(() => {})
  await fs.rename(tmp, file)
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (err) {
    if (err?.code === 'ENOENT') return fallback
    if (err instanceof SyntaxError) {
      await fs.rename(file, `${file}.corrupt.${Date.now()}`).catch(() => {})
      return fallback
    }
    throw err
  }
}

export async function writeJson(file, value, mode) {
  await writeAtomic(file, JSON.stringify(value, null, 2) + '\n', mode)
}

/**
 * 追加一行 JSON。用 `appendFile` 的 `a` 旗标：单次 write 小于 PIPE_BUF 时
 * 追加是原子的，两个进程同时写也不会交叉（族谱可能被多个实例写）。
 */
export async function appendJsonl(file, value) {
  await fs.mkdir(dirname(file), { recursive: true })
  const line = JSON.stringify(value) + '\n'
  await fs.appendFile(file, line, 'utf8')
}

/** 宽容读 JSONL：坏行跳过并计数，不让一行坏数据把整份族谱读没。 */
export async function readJsonl(file) {
  let raw = ''
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch (err) {
    if (err?.code === 'ENOENT') return { rows: [], skipped: 0, exists: false }
    throw err
  }
  const rows = []
  let skipped = 0
  for (const line of raw.split('\n')) {
    const s = line.trim()
    if (!s) continue
    try {
      const obj = JSON.parse(s)
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) rows.push(obj)
      else skipped++
    } catch {
      skipped++
    }
  }
  return { rows, skipped, exists: true }
}

/** 只删自己的临时产物（产房没有「删除"她的东西"」这条路）。 */
export async function removeQuiet(file) {
  await fs.rm(file, { force: true, recursive: true }).catch(() => {})
}

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

/**
 * 默认参数。**全部是环境参数**：
 *   pressure  —— 什么时候该提醒（记忆压力），不是她的性格
 *   birth     —— 生孩子这个动作怎么做（继承不继承称呼/工具、要不要报喜）
 *   auto      —— 要不要在她攒到阈值时自己提一嘴（仍需要主人批准）
 */
export const DEFAULTS = Object.freeze({
  pressure: {
    // 一条事件是她说的一句/写的一段。真实养到几百条就很长了；
    // 默认 1200 条是「明显该分家」的量级，不是「刚好卡着」。
    events: 1200,
    // 中文按字数算（不是字节）：一局 40 万字几乎不可能还全是高价值记忆。
    chars: 400_000,

  },
  birth: {
    // 继承称呼：她管你叫什么，这是关系事实，不是人格。默认继承。
    inheritName: true,
    // 继承工具白名单（并集，不会挤掉孩子自己的工具）。
    inheritTools: true,
    // 往母代事件流末尾追加一条 meta 报喜。只追加，不改任何一条旧记录。
    notifyParent: true,
    // 遗传包上限。压薄之后默认 900：她"是谁"的那一段要给她自己留位置。
    // （dsh-fish 的 seed 段是和「现在」「不能做的」一起每轮必现的，
    //  塞满 1500 就等于把她一辈子的说明书印在脸上。）
    maxPackChars: 900,
    // thin 模式下要不要带判断。关掉就只剩边界+称呼。
    inheritBeliefs: true,
    // 「妈妈的影子有多重」：最多抄几条边界、几条判断、几段改口、几条立场过去（0 = 不带）。
    maxBoundaries: 5,
    maxBeliefs: 3,
    // 疤（她拒绝过又自己松了口）与立场（说过不止一次）：字数最省、也最像"一个人"。
    maxScars: 2,
    maxStances: 2,
    // 日记默认不带：太私密，也最容易让孩子去模仿妈妈的语气。
    includeDiary: false,
    // 孩子一次最多继承几条「她认定的事」
    maxItems: 24,
  },
  auto: {
    // 默认关：插件不主动写盘。开了也只是「提一个请求」，真正生仍要主人批准。
    propose: false,
    // 两次提议之间至少又长出多少条事件（防止天天弹同一条）
    cooldownEvents: 200,
  },
  // 「她记得有孩子」这一段写到多细：
  //   none    只有"有孩子"
  //   memory  加一句她攒下了多少条记忆（默认；**不按天数**）
  //   teach   再加一句"你教过她几件事"
  // 孩子的原话永远不写进这一段。
  presence: {
    detail: 'memory',
  },
  teach: {
    // 出生之后的继续教学。关掉就只剩出生时那一次蒸馏。
    enabled: true,
    // 一次最多教几门（和 teach.js 的 LESSONS_PER_BATCH 同口径）
    perBatch: 3,
  },
})

const clone = (v) => JSON.parse(JSON.stringify(v))

function mergeDeep(base, patch) {
  if (patch === null || patch === undefined) return base
  if (Array.isArray(base) || typeof base !== 'object') return patch
  const out = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) && v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = mergeDeep(base[k], v)
    } else {
      out[k] = v
    }
  }
  return out
}

/** 数值裁剪：配置坏掉时不能让她「一直处在该分家」的状态。 */
function clampInt(v, lo, hi, dflt) {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt
}

function sanitize(cfg) {
  const out = clone(cfg)
  out.pressure.events = clampInt(out.pressure.events, 5, 1_000_000, DEFAULTS.pressure.events)
  out.pressure.chars = clampInt(out.pressure.chars, 10_000, 100_000_000, DEFAULTS.pressure.chars)
  out.birth.maxPackChars = clampInt(out.birth.maxPackChars, 200, 2000, DEFAULTS.birth.maxPackChars)
  out.birth.inheritBeliefs = out.birth.inheritBeliefs !== false
  out.birth.maxBoundaries = clampInt(out.birth.maxBoundaries, 0, 12, DEFAULTS.birth.maxBoundaries)
  out.birth.maxScars = clampInt(out.birth.maxScars, 0, 12, DEFAULTS.birth.maxScars)
  out.birth.maxStances = clampInt(out.birth.maxStances, 0, 12, DEFAULTS.birth.maxStances)
  out.birth.includeDiary = out.birth.includeDiary === true
  out.birth.maxBeliefs = clampInt(out.birth.maxBeliefs, 0, 12, DEFAULTS.birth.maxBeliefs)
  out.birth.maxItems = clampInt(out.birth.maxItems, 3, 60, DEFAULTS.birth.maxItems)
  out.birth.inheritName = out.birth.inheritName !== false
  out.birth.inheritTools = out.birth.inheritTools !== false
  out.birth.notifyParent = out.birth.notifyParent !== false
  out.auto.propose = out.auto.propose === true
  out.auto.cooldownEvents = clampInt(out.auto.cooldownEvents, 10, 100_000, DEFAULTS.auto.cooldownEvents)
  const detail = String(out.presence?.detail ?? '')
  // 老配置的 age（按天数）映射到 memory（按记忆）
  const normalized = detail === 'age' ? 'memory' : detail
  out.presence = { detail: ['none', 'memory', 'teach'].includes(normalized) ? normalized : 'memory' }
  out.teach = out.teach && typeof out.teach === 'object' ? out.teach : {}
  out.teach.enabled = out.teach.enabled !== false
  out.teach.perBatch = clampInt(out.teach.perBatch, 1, 5, DEFAULTS.teach.perBatch)
  return out
}

export async function loadConfig(root) {
  const p = kinPaths(root).config
  const raw = await readJson(p, null)
  const merged = mergeDeep(clone(DEFAULTS), raw && typeof raw === 'object' ? raw : {})
  return { config: sanitize(merged), path: p, missing: raw === null }
}

/** 部分更新：只覆盖传进来的键，其余保持。 */
export async function updateConfig(patch, root) {
  const { config } = await loadConfig(root)
  const next = sanitize(mergeDeep(config, patch ?? {}))
  await writeJson(kinPaths(root).config, next)
  return next
}
