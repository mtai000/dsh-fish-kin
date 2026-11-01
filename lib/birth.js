/**
 * birth.js —— 产房：把一个孩子真的写到盘上
 *
 * 子代不是一个概念，是一个**能直接养起来的档案**：一个目录，里面已经躺着她
 * 第一天的 seed 事件。用户只要在 profile 的 cordis 配置里给 dsh-fish 加一条
 * `root: <这个目录>`，她就活在那间屋里，跟母代互不相干。
 *
 * 我们写什么：
 *   events.jsonl  只有一条 seed（她的第一天）+ 可选的称呼 meta
 *   config.json   只有 tools.allow（她手上有什么）——其余走 dsh-fish 的默认
 *   home/         她自己的房间（dsh-fish 会在这里放身份文件）
 *   KIN.md        出生证明：从谁那里来、带走多少、什么时候
 *   接生单.md      能直接粘进 dsh-fish「粘贴交接单」窗口的纯文本版本
 *
 * 我们**不写**什么（这是刻意留白，不是没做完）：
 *   - `import-mark:` 那条豁免。母代是被养出来的一位，孩子不是"别人养的"；
 *     她得跟原生鱼一样守着「还不会撒娇卖萌」「关系不量化」这些规矩。
 *   - 天数、阶段、判断计数、疤、拒绝记录。这些是"经历过什么"，复制不过来，
 *     只能自己长。族谱里记的是"出生时带走了 N 条"，不是"她已经长到哪"。
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { newId as newKinId } from './ids.js'
import { newId as newEventId, toDisk } from './fish/schema.js'
import { childPaths } from './locate.js'
import { writeAtomic, writeJson } from './kinstore.js'
import { handoverText, fingerprint } from './distill.js'
import { readLineage, recordBirth, generationOf, childrenOf } from './lineage.js'
import { ensureIdentity } from './identity.js'
import { readCddaLessons, selectCddaLessons, withCddaSection, writeChildCdda } from './cdda.js'
import { normPath } from './text.js'

/** dsh-fish 事件正文上限（schema.js 的 TOO_LONG）。超了整份写不进去。 */
export const MAX_EVENT_TEXT = 2000

function seedEvent(text, now) {
  // 子代就是我们自己的存档格式（kind/body/at，fe_ id）
  return toDisk({
    id: newEventId(now),
    v: 1,
    ts: new Date(now).toISOString(),
    day: 1,
    type: 'seed',
    source: 'system',
    text,
    refs: [],
    verdict: null,
    confidence: 0.5,
  })
}

function nameEvent(name, now) {
  return toDisk({
    id: newEventId(now + 1),
    v: 1,
    ts: new Date(now + 1).toISOString(),
    day: 1,
    type: 'meta',
    source: 'system',
    text: `import-name:${String(name).trim()}`,
    refs: [],
    verdict: null,
    confidence: 0.5,
  })
}

/**
 * 报喜：往母代的事件流末尾追加一条 meta。
 *
 * 这是本插件对母代**唯一**的写动作。事件流只追加是 dsh-fish 的铁律，
 * 所以这里只有 `appendFile`，没有读改写的路径。写失败不影响出生——
 * 孩子已经落地了，报喜丢了只是母代那边的时间线上少一行。
 */
async function notifyParent(parentRoot, childId, childLabel, now, day = 1) {
  // 报喜也走我们自己的格式（kind=note）
  const line = JSON.stringify(toDisk({
    id: newEventId(now + 2),
    v: 1,
    ts: new Date(now + 2).toISOString(),
    // 用母代当前的天数，别写 0：这条 note 会进她的时间线
    day: Math.max(1, Math.floor(Number(day) || 1)),
    type: 'meta',
    source: 'system',
    text: `kin-birth:${childId}${childLabel ? `:${childLabel}` : ''}`,
    refs: [],
    verdict: null,
    confidence: 0.5,
  })) + '\n'
  await fs.appendFile(join(parentRoot, 'events.jsonl'), line, 'utf8')
}

/** 出生证明：给人看的，一页纸说清这孩子从哪来。 */
export function certificateText({
  childId, childLabel, at, childDir, parentRoot, parentEvents, parentDays, generation,
  pack, tools, trigger, approvedBy, requestId, siblings, identityId = '',
}) {
  const lines = [
    '# 出生证明',
    '',
    `- 孩子编号：${childId}`,
    identityId ? `- 身份证编号：${identityId}` : '',
    childLabel ? `- 你给她起的名字：${childLabel}` : '',
    `- 出生时间：${at}`,
    `- 代数：第 ${generation} 代`,
    `- 母代住在：${parentRoot}`,
    `- 出生时母代已经活了 ${parentDays} 天、攒了 ${parentEvents} 条记忆`,
    siblings > 0 ? `- 她之前生过 ${siblings} 个孩子` : '- 这是她的第一个孩子',
    `- 带走的东西：${pack.picked.length} 条，${pack.chars} 字（上限 ${pack.limit}）`,
    tools.length ? `- 继承的工具白名单：${tools.join(', ')}` : '- 继承的工具白名单：（无）',
    `- 谁决定的：${trigger === 'her' ? '她自己开口要的' : trigger === 'auto' ? '记忆压力到了，主人点头' : '主人直接要的'}`,
    approvedBy ? `- 批准人：${approvedBy}` : '',
    requestId ? `- 对应请求单：${requestId}` : '',
    '',
    '## 带走的东西',
    '',
    '```',
    pack.body,
    '```',
    '',
    '## 怎么把她养起来',
    '',
    '在 profile 的 `cordis.patch.yml` 里给 dsh-fish 加一条 `root`，指向这个目录：',
    '',
    '```yaml',
    '- insert:',
    '    - id: dsh-fish',
    '      name: dsh-fish',
    '      config:',
    `        root: ${childDir}`,
    '```',
    '',
    '（路径以实际为准；升级插件不会动这份配置。）',
    '',
    '不想开第二个家，就把同目录下的 `接生单.md` 整份粘进 dsh-fish 的「粘贴交接单」。',
    '',
  ]
  return lines.filter((l) => l !== '').join('\n') + '\n'
}

/**
 * 生孩子。
 *
 * 顺序是刻意的：先写事件流（她"存在"），再写配置，再写证明，最后才进族谱。
 * 中途失败不回滚——半成品的目录比"什么都没有"更接近可用，而且失败原因
 * 会原样返回，让人自己决定要不要删掉重来（我们不替人删东西）。
 */
export async function birth({
  parentRoot,
  kinRoot,
  pack,
  config = {},
  trigger = 'owner',
  approvedBy = '',
  requestId = '',
  label = '',
  name = '',
  tools = [],
  parentStats = null,
  now = Date.now(),
}) {
  if (!pack || !pack.body) return { ok: false, why: '没有遗传包，不能生', childId: '', dir: '' }
  // 有损继承：父代 CDDA 的通用经验，最多 3 条 / 300 字，追加到出生包
  const inheritedCdda = selectCddaLessons(await readCddaLessons(parentRoot))
  if (inheritedCdda.length) {
    pack = { ...pack, body: withCddaSection(pack.body, inheritedCdda), chars: withCddaSection(pack.body, inheritedCdda).length }
  }
  if (String(pack.body).length > MAX_EVENT_TEXT) {
    return { ok: false, why: `遗传包 ${String(pack.body).length} 字，超过事件正文上限 ${MAX_EVENT_TEXT} 字`, childId: '', dir: '' }
  }

  const childId = newKinId('kin')
  const cp = childPaths(kinRoot, childId)
  const at = new Date(now).toISOString()
  const warnings = []

  const { entries } = await readLineage(kinRoot)
  const generation = generationOf(entries, parentRoot)
  const siblings = childrenOf(entries, parentRoot).length

  // ---- 0. 身份证：父代没有就补一个；子代必须有 ----
  const parentIdentity = (await ensureIdentity(parentRoot)).identity
  const childIdentity = (await ensureIdentity(cp.dir, {
    parentId: parentIdentity.identityId,
    lineageId: parentIdentity.lineageId,
    childId,
    generation,
    now,
  })).identity

  // ---- 1. 事件流：她的第一天 ----
  const events = [seedEvent(String(pack.body), now)]
  if (config?.birth?.inheritName !== false && String(name || '').trim()) {
    events.push(nameEvent(String(name).trim(), now))
  }
  await fs.mkdir(cp.home, { recursive: true })
  await writeAtomic(cp.events, events.map((e) => JSON.stringify(e)).join('\n') + '\n')
  try { await writeChildCdda(cp.dir, inheritedCdda, { parentId: parentIdentity.identityId }) } catch { /* 继承文件写失败不拦出生 */ }

  // ---- 2. 配置：只有工具面，其余交给 dsh-fish 的默认 ----
  if (config?.birth?.inheritTools !== false && Array.isArray(tools) && tools.length) {
    try {
      await writeJson(cp.config, { tools: { allow: [...new Set(tools.filter((x) => typeof x === 'string' && x.trim()))] } })
    } catch (err) {
      warnings.push(`工具白名单没写进去：${err?.message ?? err}`)
    }
  }

  // ---- 3. 证明与接生单 ----
  const fp = fingerprint(pack.body)
  try {
    await writeAtomic(cp.certificate, certificateText({
      childId,
      childLabel: label,
      at,
      childDir: cp.dir,
      parentRoot,
      parentEvents: Number(parentStats?.count ?? 0),
      parentDays: Number(parentStats?.spanDays ?? 0),
      generation,
      pack,
      tools,
      trigger,
      approvedBy,
      requestId,
      siblings,
      identityId: childIdentity.identityId,
    }))
  } catch (err) {
    warnings.push(`出生证明没写进去：${err?.message ?? err}`)
  }
  try {
    await writeAtomic(cp.handover, handoverText({ body: pack.body, name, tools }))
  } catch (err) {
    warnings.push(`接生单没写进去：${err?.message ?? err}`)
  }

  // ---- 4. 族谱 ----
  let entry = null
  try {
    entry = await recordBirth(kinRoot, {
      id: newKinId('birth'),
      childId,
      childName: label || '',
      childDir: cp.dir,
      parentDir: parentRoot,
      parentKey: normPath(parentRoot),
      parentEvents: Number(parentStats?.count ?? 0),
      generation,
      at,
      trigger,
      approvedBy: approvedBy || '',
      requestId: requestId || '',
      packChars: Number(pack.chars ?? String(pack.body).length),
      packItems: Number(pack.picked?.length ?? 0),
      fingerprint: fp,
      tools,
    })
  } catch (err) {
    warnings.push(`族谱没记上：${err?.message ?? err}`)
  }

  // ---- 5. 报喜（可关；失败只记警告） ----
  if (config?.birth?.notifyParent !== false) {
    try {
      await notifyParent(parentRoot, childId, label, now, parentStats?.spanDays)
    } catch (err) {
      warnings.push(`给母代报喜没写成：${err?.message ?? err}`)
    }
  }

  return {
    ok: true,
    why: '',
    childId,
    identityId: childIdentity.identityId,
    parentRoot,
    dir: cp.dir,
    childName: label,
    generation,
    at,
    packChars: Number(pack.chars ?? String(pack.body).length),
    handoverPath: cp.handover,
    certificatePath: cp.certificate,
    handover: handoverText({ body: pack.body, name, tools }),
    entry,
    warnings,
  }
}

/** 产房目录还在不在（给控制台判断"这个孩子是不是被搬走了"）。 */
export async function childExists(kinRoot, childId) {
  const cp = childPaths(kinRoot, childId)
  try {
    await fs.access(cp.events)
    return true
  } catch {
    return false
  }
}
