/**
 * locate.js —— 「母代住在哪、产房放哪、孩子住哪」
 *
 * 母代 root 的解析必须与 dsh-fish 逐条一致，否则我们会去读一个空的旧目录、
 * 算出「她一条记忆都没有」。它的优先级（见 dsh-fish `lib/locate.js`）：
 *   1. 环境变量 `DSH_FISH_HOME`
 *   2. 指针文件 `~/.dsh-fish-location.json` 的 `root`（用户把数据目录搬到别的盘之后）
 *   3. 默认 `~/.dsh-fish`
 *
 * 本插件自己的东西全部放在**另一个**目录（`~/.dsh-fish-kin`），
 * 理由和 dsh-fish 把指针文件放在数据目录外面一样：母代存档是她的记忆，
 * 不是我们的工作区；混在一起会让「重置一局」和「备份一份」都变得不可解释。
 *
 * 所有函数都接受显式的 `{ env, home }`，测试不需要碰真实 HOME。
 */

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const isAbs = (v) =>
  /^[A-Za-z]:[\\/]/.test(v) || v.startsWith('/') || v.startsWith('\\\\')

/** 母代 root 的指针文件路径。 */
export function locationFile({ env = process.env, home = homedir() } = {}) {
  return env.DSH_FISH_LOCATION || join(home, '.dsh-fish-location.json')
}

/** 指针文件里记的位置；读不到、读坏、不是绝对路径，一律返回空串（绝不抛）。 */
export function readLocation({ env = process.env, home = homedir() } = {}) {
  try {
    const obj = JSON.parse(readFileSync(locationFile({ env, home }), 'utf8'))
    const v = String(obj?.root ?? '').trim()
    return v && isAbs(v) ? v : ''
  } catch {
    return ''
  }
}

/** 母代数据目录（她的家）。 */
export function parentRoot({ env = process.env, home = homedir() } = {}) {
  const envRoot = String(env.DSH_FISH_HOME ?? '').trim()
  if (envRoot) return envRoot
  const pointed = readLocation({ env, home })
  if (pointed) return pointed
  return join(home, '.dsh-fish')
}

/** 母代地址是从哪来的（界面上要能说清「我读的是哪个目录」）。 */
export function parentSource({ env = process.env, home = homedir() } = {}) {
  if (String(env.DSH_FISH_HOME ?? '').trim()) return 'env'
  if (readLocation({ env, home })) return 'pointer'
  return 'default'
}

/**
 * 家族工作区：**所有东西都待在这一个目录里**（她的记忆、族谱、孩子、归档、凭据）。
 *
 * 优先级：
 *   1. 环境变量 `DSH_KIN_FAMILY_ROOT`
 *   2. 指针文件 `~/.dsh-fish-kin.json` 的 `familyRoot`（设置里换过目录就写这里）
 *   3. **旧目录 `~/.dsh-fish-kin`**（如果它已经存在——不惊动老用户）
 *   4. 默认 `<home>/大肥鱼家族`
 *
 * 指针文件故意放在工作区**外面**：工作区是可以整个搬走/备份的，
 * 搬家之后指针还在原地，否则就没人知道她搬到哪去了。
 */
export function familyPointer({ env = process.env, home = homedir() } = {}) {
  return env.DSH_KIN_FAMILY_POINTER || join(home, '.dsh-fish-kin.json')
}

export function readFamilyRoot({ env = process.env, home = homedir() } = {}) {
  try {
    const obj = JSON.parse(readFileSync(familyPointer({ env, home }), 'utf8'))
    const v = String(obj?.familyRoot ?? '').trim()
    return v && isAbs(v) ? v : ''
  } catch {
    return ''
  }
}

export function familyRoot({ env = process.env, home = homedir() } = {}) {
  const envRoot = String(env.DSH_KIN_FAMILY_ROOT ?? '').trim()
  if (envRoot) return envRoot
  const pointed = readFamilyRoot({ env, home })
  if (pointed) return pointed
  // 老用户的目录已经在那儿了：继续用它，别在升级后凭空换个地方。
  try {
    if (statSync(join(home, '.dsh-fish-kin')).isDirectory()) return join(home, '.dsh-fish-kin')
  } catch { /* 没有就用新的 */ }
  return join(home, '大肥鱼家族')
}

/** 这个地址是从哪来的（界面上要能说清"我读的是哪个目录、为什么是它"）。 */
export function familySource({ env = process.env, home = homedir() } = {}) {
  if (String(env.DSH_KIN_FAMILY_ROOT ?? '').trim()) return 'env'
  if (readFamilyRoot({ env, home })) return 'pointer'
  try {
    if (statSync(join(home, '.dsh-fish-kin')).isDirectory()) return 'legacy'
  } catch { /* ignore */ }
  return 'default'
}

/** 记下新的工作区（只写指针文件，不动数据）。 */
export async function setFamilyRoot(dir, { env = process.env, home = homedir() } = {}) {
  const v = String(dir ?? '').trim()
  if (!v || !isAbs(v)) return { ok: false, why: '要一个绝对路径' }
  const { mkdir, writeFile } = await import('node:fs/promises')
  const { dirname } = await import('node:path')
  await mkdir(dirname(familyPointer({ env, home })), { recursive: true })
  await writeFile(familyPointer({ env, home }), JSON.stringify({ familyRoot: v, at: new Date().toISOString() }, null, 2) + '\u000a', 'utf8')
  return { ok: true, why: '', familyRoot: v }
}

/** 产房 / 族谱目录 = 家族工作区本身（她的记忆在 `<它>/fish`）。 */
export function kinRoot({ env = process.env, home = homedir() } = {}) {
  const envRoot = String(env.DSH_FISH_KIN_HOME ?? '').trim()
  if (envRoot) return envRoot
  return familyRoot({ env, home })
}

/** 母代那边我们**只读**的几样东西。 */
export function parentPaths(root) {
  return {
    root,
    events: join(root, 'events.jsonl'),
    config: join(root, 'config.json'),
    diaryDir: join(root, 'diary'),
  }
}

/** 我们自己的目录布局。 */
export function kinPaths(root) {
  return {
    root,
    config: join(root, 'config.json'),
    lineage: join(root, 'lineage.jsonl'),
    decisions: join(root, 'decisions.jsonl'),
    // 教学账本（母女之间教过什么、孩子有没有回声）
    teaching: join(root, 'teaching.jsonl'),
    childrenDir: join(root, 'children'),
    pendingDir: join(root, 'pending'),
    tmpDir: join(root, 'tmp'),
  }
}

/** 一条子代的存档目录（它就是那孩子以后的 dsh-fish `root`）。 */
export function childPaths(kinRootPath, childId) {
  const dir = join(kinPaths(kinRootPath).childrenDir, childId)
  return {
    id: childId,
    dir,
    events: join(dir, 'events.jsonl'),
    config: join(dir, 'config.json'),
    home: join(dir, 'home'),
    identity: join(dir, 'identity.json'),
    certificate: join(dir, 'KIN.md'),
    handover: join(dir, '接生单.md'),
  }
}

/** 目录存在吗（不建、不抛）。 */
export function existsSyncDir(dir) {
  try {
    return statSync(dir).isDirectory()
  } catch {
    return false
  }
}
