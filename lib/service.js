/**
 * service.js —— 把「读母代 → 蒸馏 → 评估 → 请求 → 出生」串成一条线
 *
 * 工具层（tools.js）和网页层（routes.js）都只调这里，不许自己拼流程。
 * 理由很实际：这条链上有五个会写盘的点（请求单、孩子目录、族谱、决定账本、
 * 母代那条报喜），分散在两处实现，早晚会出现「按钮生的孩子没有族谱」这种账。
 */

import { parentRoot as resolveParentRoot, kinRoot as resolveKinRoot } from './locate.js'
import { collect, deriveName } from './read.js'
import { rank } from './importance.js'
import { composePack, fingerprint } from './distill.js'
import { assess } from './pressure.js'
import { loadConfig, updateConfig } from './kinstore.js'
import { readLineage, generationOf, childrenOf, lastBirthEvents, kinCheck, flatLines, NEAR_KIN } from './lineage.js'
import { listRequests, createRequest, decide, consume } from './pending.js'
import { birth } from './birth.js'
import * as teachMod from './teach.js'
import * as spokenMod from './spoken.js'

/** 两个目录一次解析。显式传进来的参数优先（测试与多实例用）。 */
export function resolveRoots(opts = {}) {
  const env = opts.env ?? process.env
  const home = opts.home
  return {
    parentRoot: opts.parentRoot || resolveParentRoot(home ? { env, home } : { env }),
    kinRoot: opts.kinRoot || resolveKinRoot(home ? { env, home } : { env }),
  }
}

/**
 * 一眼看全：母代多大、压力几档、族谱几代、有没有待批的单子。
 * 这个函数**不写盘**（除了清理过期请求单——那是我们自己的待批文件）。
 */
export async function snapshot(opts = {}) {
  const { parentRoot, kinRoot } = resolveRoots(opts)
  const now = Number(opts.now ?? Date.now())
  const { config } = await loadConfig(kinRoot)
  const parent = await collect({ root: parentRoot })
  const { entries } = await readLineage(kinRoot)
  const pend = await listRequests(kinRoot, { now })
  const last = lastBirthEvents(entries, parentRoot)
  const pressure = assess({
    stats: parent.stats,
    bytes: parent.bytes,
    config,
    pending: pend.requests.length,
    lastBirthEvents: last,
  })
  return {
    parent: {
      root: parentRoot,
      exists: parent.exists,
      count: parent.stats.count,
      chars: parent.stats.chars,
      spanDays: parent.stats.spanDays,
      types: parent.stats.types,
      skipped: parent.skipped,
      imported: parent.stats.imported,
      tools: parent.tools,
      name: deriveName(parent.events),
      lastSeenAt: parent.stats.lastSeenAt,
    },
    kin: {
      root: kinRoot,
      generation: generationOf(entries, parentRoot),
      children: childrenOf(entries, parentRoot).length,
      total: entries.length,
    },
    pressure,
    pending: pend.requests.map(requestSummary),
    expired: pend.expired,
    config,
    now,
  }
}

function requestSummary(r) {
  return {
    id: r.id,
    at: r.at,
    expiresAt: r.expiresAt,
    trigger: r.trigger,
    note: r.note,
    chars: r.pack?.chars ?? 0,
    items: Array.isArray(r.pack?.picked) ? r.pack.picked.length : 0,
    label: r.label || '',
  }
}

/**
 * 粗看一眼遗传包（不落盘、不立单）。控制台和 `preview` 动作都用它。
 */
export async function preview(opts = {}) {
  const { parentRoot, kinRoot } = resolveRoots(opts)
  const now = Number(opts.now ?? Date.now())
  const { config } = await loadConfig(kinRoot)
  const parent = await collect({ root: parentRoot })
  const ranked = rank(parent.events, { maxItems: config.birth.maxItems })
  const name = config.birth.inheritName ? deriveName(parent.events) : ''
  const tools = config.birth.inheritTools ? parent.tools : []
  const pack = composePack(ranked.items, {
    name,
    maxChars: config.birth.maxPackChars,
    // 压薄是默认：只留边界 + 最多两条判断。想"更像她"的人可以改配置。
    thin: config.birth.seedMode !== 'full',
    keepBeliefs: config.birth.inheritBeliefs !== false,
    maxBoundaries: config.birth.maxBoundaries,
    maxBeliefs: config.birth.maxBeliefs,
  })
  const fp = fingerprint(pack.body)
  const { entries } = await readLineage(kinRoot)
  const kin = kinCheck(entries, fp)
  const byCls = {}
  for (const it of pack.picked) byCls[it.cls] = (byCls[it.cls] || 0) + 1
  return {
    ok: true,
    parent: {
      root: parentRoot,
      exists: parent.exists,
      count: parent.stats.count,
      chars: parent.stats.chars,
      spanDays: parent.stats.spanDays,
      skipped: parent.skipped,
    },
    pack,
    name,
    tools,
    kin,
    coverage: {
      candidates: ranked.candidates,
      dropped: ranked.dropped,
      picked: pack.picked.length,
      byCls,
    },
    generatedAt: new Date(now).toISOString(),
  }
}

/**
 * 立一张待批准的单子。
 *
 * 谁都能触发（她自己、阈值、主人），但**没有一条路能绕过主人**——
 * 这个函数只产出 pending 文件，孩子要等 approve 才存在。
 */
export async function request(opts = {}) {
  const { parentRoot, kinRoot } = resolveRoots(opts)
  const now = Number(opts.now ?? Date.now())
  const snap = await snapshot({ parentRoot, kinRoot, now })
  if (snap.pending.length) {
    return { ok: false, why: '已经有一张待批的单子了，先批或驳掉再立新的', request: snap.pending[0] }
  }
  const pre = await preview({ parentRoot, kinRoot, now })
  if (!pre.pack.picked.length) {
    return { ok: false, why: '她还什么都没说过，没有可以带走的东西' }
  }
  if (!pre.kin.ok && opts.forceKin !== true) {
    return { ok: false, why: pre.kin.why, kin: pre.kin }
  }
  const made = await createRequest(kinRoot, {
    trigger: opts.trigger ?? 'owner',
    note: opts.note ?? '',
    label: opts.label ?? '',
    name: pre.name,
    tools: pre.tools,
    pack: pre.pack,
    now,
  })
  if (!made.ok) return made
  return { ok: true, why: '', request: requestSummary(made.request), kin: pre.kin, pack: pre.pack }
}

/**
 * 批准：把请求单里那份遗传包**原样**生下来。
 *
 * 注意这里不重新蒸馏。主人在界面上看到的是哪份，生下来的就是哪份——
 * 重新算一遍会让"最近几天的对话"悄悄改写遗产，那不是他批的东西。
 */
export async function approve(opts = {}) {
  const { parentRoot, kinRoot } = resolveRoots(opts)
  const now = Number(opts.now ?? Date.now())
  const id = String(opts.id ?? '')
  const decided = await decide(kinRoot, id, { verdict: 'approve', by: opts.by ?? '', now })
  if (!decided.ok) return decided
  const r = decided.request
  // 这里不调 snapshot()：它会顺手清理过期的请求单，而我们正在用这张单子。
  // 需要的东西只有两样——配置和母代此刻的统计。
  const { config } = await loadConfig(kinRoot)
  const parent = await collect({ root: parentRoot })

  const pack = {
    body: String(r.pack.body),
    chars: Number(r.pack.chars ?? String(r.pack.body).length),
    limit: Number(r.pack.limit ?? 1500),
    picked: Array.isArray(r.pack.picked) ? r.pack.picked : [],
  }
  const made = await birth({
    parentRoot,
    kinRoot,
    pack,
    config,
    trigger: r.trigger || 'owner',
    approvedBy: opts.by ?? '',
    requestId: r.id,
    label: opts.label || r.label || '',
    name: r.name || '',
    tools: r.tools || [],
    parentStats: parent.stats,
    now: now + 1,
  })
  if (made.ok) await consume(kinRoot, r.id)
  return { ...made, requestId: r.id, generation: made.generation ?? 1 }
}

/** 驳回：记一笔理由，删掉待批文件。孩子不存在，族谱不新增。 */
export async function reject(opts = {}) {
  const { kinRoot } = resolveRoots(opts)
  const now = Number(opts.now ?? Date.now())
  return decide(kinRoot, String(opts.id ?? ''), { verdict: 'reject', by: opts.by ?? '', why: opts.why ?? '', now })
}

/**
 * 主人直接要一个（不经请求单）。
 *
 * 仍然要求 `confirm: 'birth'`：生孩子会真的在盘上多一个家，没有确认就等于
 * 一个手滑能在别人的插件目录里建档案。
 */
export async function directBirth(opts = {}) {
  if (opts.confirm !== 'birth') {
    return { ok: false, why: '这是真的会建一个孩子的目录。要生就把 confirm 写成 birth。' }
  }
  const { parentRoot, kinRoot } = resolveRoots(opts)
  const now = Number(opts.now ?? Date.now())
  const pre = await preview({ parentRoot, kinRoot, now })
  if (!pre.pack.picked.length) return { ok: false, why: '她还什么都没说过，没有可以带走的东西' }
  if (!pre.kin.ok && opts.forceKin !== true) return { ok: false, why: pre.kin.why, kin: pre.kin }
  const { config } = await loadConfig(kinRoot)
  const parent = await collect({ root: parentRoot })
  return birth({
    parentRoot,
    kinRoot,
    pack: pre.pack,
    config,
    trigger: opts.trigger ?? 'owner',
    approvedBy: opts.by ?? '',
    label: opts.label ?? '',
    name: pre.name,
    tools: pre.tools,
    parentStats: parent.stats,
    now,
  })
}

/** 族谱视图：一行一代，加一句"她现在在哪"。 */
export async function lineageView(opts = {}) {
  const { parentRoot, kinRoot } = resolveRoots(opts)
  const { entries, skipped } = await readLineage(kinRoot)
  return {
    ok: true,
    root: kinRoot,
    total: entries.length,
    skipped,
    generation: generationOf(entries, parentRoot),
    nearKinThreshold: NEAR_KIN,
    lines: flatLines(entries),
    raw: entries,
  }
}

/** 自动提议：只在 `config.auto.propose` 打开时由定时器调用。只为「催一句」，不能生。 */
export async function autoPropose(opts = {}) {
  const { parentRoot, kinRoot } = resolveRoots(opts)
  const now = Number(opts.now ?? Date.now())
  const { config } = await loadConfig(kinRoot)
  if (!config.auto.propose) return { ok: false, skipped: true, why: 'auto.propose 关着' }
  const snap = await snapshot({ parentRoot, kinRoot, now })
  if (!snap.pressure.eligible) return { ok: false, skipped: true, why: snap.pressure.blockedBy || 'not-eligible' }
  const made = await request({ parentRoot, kinRoot, now, trigger: 'auto', note: snap.pressure.headline })
  return { ok: made.ok, skipped: !made.ok, made }
}

// ---------------------------------------------------------------------------
// 环境参数（控制台唯一能改的东西）
// ---------------------------------------------------------------------------

/**
 * 允许改的键——**白名单**，不是黑名单。
 *
 * 为什么做成白名单：这层是唯一一个从网页进来的写入口。黑名单（"不许写 persona"）
 * 只要有人后来加了一个键就漏；白名单是"没在这里出现过的一律丢掉"，
 * 而这里出现的每一个都是环境参数（阈值、继承开关），没有一个是她本人。
 */
export const CONFIG_KEYS = Object.freeze({
  pressure: ['events', 'chars', 'days'],
  birth: ['inheritName', 'inheritTools', 'notifyParent', 'maxPackChars', 'maxItems', 'inheritBeliefs', 'seedMode', 'maxBoundaries', 'maxBeliefs'],
  auto: ['propose', 'cooldownEvents'],
  presence: ['detail'],
  teach: ['enabled', 'perBatch'],
})

/** 读环境参数（控制台用）。 */
export async function configView(opts = {}) {
  const { kinRoot } = resolveRoots(opts)
  const { config, path, missing } = await loadConfig(kinRoot)
  return { ok: true, root: kinRoot, path, missing, keys: CONFIG_KEYS, config }
}

/**
 * 改环境参数。只收白名单里的键，其余原样退回（`ignored`），不静默当没发生。
 *
 * 数值会在 kinstore 的 sanitize 里裁剪（比如 maxPackChars 不许超过 2000），
 * 因为超过 2000 的遗传包会被 dsh-fish 整条拒收——那是"孩子生不出来"的静默故障。
 */
export async function saveConfig(patch, opts = {}) {
  const { kinRoot } = resolveRoots(opts)
  const src = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}
  const clean = {}
  const ignored = []
  for (const [group, value] of Object.entries(src)) {
    const allowed = CONFIG_KEYS[group]
    if (!allowed) { ignored.push(group); continue }
    if (!value || typeof value !== 'object' || Array.isArray(value)) { ignored.push(group); continue }
    for (const [k, v] of Object.entries(value)) {
      if (!allowed.includes(k)) { ignored.push(`${group}.${k}`); continue }
      clean[group] = clean[group] ?? {}
      clean[group][k] = v
    }
  }
  if (!Object.keys(clean).length) {
    return { ok: false, why: '没有可写的字段（只认记忆压力和继承开关，别的一律不改）', ignored }
  }
  const config = await updateConfig(clean, kinRoot)
  return { ok: true, why: '', config, ignored }
}


// ---------------------------------------------------------------------------
// 母女教学（出生之后的继续传承）
// ---------------------------------------------------------------------------

/**
 * 该教什么：妈妈教过之后新长出来的那几条。
 *
 * 不传 childId 时，如果她只有一个孩子就默认那一个（"妈，跟她说说话"这种语气），
 * 有多个孩子时必须点名——我们不去猜她想教给哪个。
 */
export async function teachPreview(opts = {}) {
  const { parentRoot, kinRoot } = resolveRoots(opts)
  const { config } = await loadConfig(kinRoot)
  if (config.teach?.enabled === false) return { ok: false, why: '教学关着（config.teach.enabled）', items: [] }
  const childId = await pickChild({ parentRoot, kinRoot, childId: opts.childId })
  if (!childId) return { ok: false, why: '她还没有孩子，或者有不止一个——请点名是哪一个', items: [] }
  const r = await teachMod.candidates({ parentRoot, kinRoot, childId, limit: config.teach?.perBatch, now: opts.now })
  return { ...r, childId }
}

/** 教一课。`texts` 给了就教这句，没给就按候选自动取（最多 3 门）。 */
export async function teachNow(opts = {}) {
  const { parentRoot, kinRoot } = resolveRoots(opts)
  const { config } = await loadConfig(kinRoot)
  if (config.teach?.enabled === false) return { ok: false, why: '教学关着（config.teach.enabled）', lessons: [] }
  const childId = await pickChild({ parentRoot, kinRoot, childId: opts.childId })
  if (!childId) return { ok: false, why: '她还没有孩子，或者有不止一个——请点名是哪一个', lessons: [] }

  let texts = Array.isArray(opts.texts) ? opts.texts.filter((x) => typeof x === 'string') : []
  if (!texts.length) {
    const pre = await teachMod.candidates({ parentRoot, kinRoot, childId, limit: config.teach?.perBatch, now: opts.now })
    if (!pre.ok) return { ...pre, lessons: [] }
    texts = pre.items.map((i) => i.text)
    if (!texts.length) return { ok: false, why: '她出生之后还没长出新的、值得单独教的认知', lessons: [], childId }
  }
  const r = await teachMod.teach({ parentRoot, kinRoot, childId, texts, now: opts.now, by: opts.by ?? '' })
  return { ...r, childId }
}

/** 孩子学得怎么样（每一课后面跟一句她后来自己说的话）。 */
export async function teachView(opts = {}) {
  const { kinRoot } = resolveRoots(opts)
  const childId = await pickChild({ ...resolveRoots(opts), childId: opts.childId, kinRoot })
  if (!childId) return { ok: false, why: '她还没有孩子，或者有不止一个——请点名是哪一个', lessons: [] }
  return teachMod.view({ kinRoot, childId, now: opts.now })
}

/**
 * 她**亲口**说一句（L2）。
 *
 * 只做这一层：一次 = 一个母回合；孩子那边零回合（我们只把她的原话放进去）。
 * 不做往返对话——那会让两边上下文一起涨，用户 2026-10-31 明确先不做。
 */
export async function spokenTeach(opts = {}) {
  const { parentRoot, kinRoot } = resolveRoots(opts)
  const { config } = await loadConfig(kinRoot)
  if (config.teach?.enabled === false) return { ok: false, why: '教学关着（config.teach.enabled）', waitedMs: 0 }
  const childId = await pickChild({ parentRoot, kinRoot, childId: opts.childId })
  if (!childId) return { ok: false, why: '她还没有孩子，或者有不止一个——请点名是哪一个', waitedMs: 0 }
  const r = await spokenMod.askMotherAndTeach({
    ctx: opts.ctx,
    parentRoot,
    kinRoot,
    childId,
    now: opts.now,
    timeoutMs: opts.timeoutMs,
    pollMs: opts.pollMs,
  })
  return { ...r, childId }
}

/** 只有一个孩子时默认它；否则返回空（让人点名）。 */
async function pickChild({ parentRoot, kinRoot, childId } = {}) {
  if (childId) return String(childId)
  const { entries } = await readLineage(kinRoot)
  const mine = childrenOf(entries, parentRoot)
  return mine.length === 1 ? mine[0].childId : ''
}

/**
 * 她自己那把「跟孩子说一句」。
 *
 * 只能教给**自己的孩子**，而且只在她只有一个孩子时默认那一个——
 * 她看不见孩子的 id，也不该被要求先读一遍族谱才能当妈。
 */
export async function teachFromHer(opts = {}) {
  const { parentRoot, kinRoot } = resolveRoots(opts)
  const { config } = await loadConfig(kinRoot)
  if (config.teach?.enabled === false) return { ok: false, why: 'closed', lessons: [] }
  const text = String(opts.text ?? '').trim()
  if (!text) return { ok: false, why: 'empty', lessons: [] }
  const childId = await pickChild({ parentRoot, kinRoot })
  if (!childId) return { ok: false, why: 'no-child', lessons: [] }
  if (!(await teachMod.isOwnChild({ parentRoot, kinRoot, childId }))) return { ok: false, why: 'not-mine', lessons: [] }
  const r = await teachMod.teach({ parentRoot, kinRoot, childId, texts: [text], now: opts.now, by: 'her' })
  return { ...r, childId }
}
