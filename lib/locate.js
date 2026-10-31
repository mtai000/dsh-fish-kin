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

/** 产房 / 族谱目录。刻意与母代分居。 */
export function kinRoot({ env = process.env, home = homedir() } = {}) {
  const envRoot = String(env.DSH_FISH_KIN_HOME ?? '').trim()
  if (envRoot) return envRoot
  return join(home, '.dsh-fish-kin')
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
