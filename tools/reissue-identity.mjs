/**
 * tools/reissue-identity.mjs —— 把老身份证换成 `ds-fish-` + 年月日 + 4 位编码的新编号
 *
 * 用法：
 *   node tools/reissue-identity.mjs                 # 默认父代（<家族>/fish）
 *   node tools/reissue-identity.mjs <鱼的家目录>     # 父代或某个孩子
 *   node tools/reissue-identity.mjs --move-cdda-memory
 *
 * ⚠️ CDDA 按 identityId 分记忆目录（`$DSH_HOME/cdda-duty/memory/<id>`）。
 *    换号后旧目录不会自动跟过去；加 `--move-cdda-memory` 会顺手把那个目录改名。
 *    改名失败/旧目录不存在都会说清楚，不猜。
 *
 * 旧编号会保留在 identity.json 的 `legacyId` 里。
 */
import { existsSync, readdirSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { familyRoot } from '../lib/locate.js'
import { reissueIdentity, readIdentity } from '../lib/identity.js'

const argv = process.argv.slice(2)
const moveMemory = argv.includes('--move-cdda-memory')
const explicit = argv.find((a) => !a.startsWith('--'))
const fishRoot = explicit
  ? explicit
  : (String(process.env.DSH_KIN_FISH_HOME || '').trim() || join(familyRoot(), 'fish'))

const before = await readIdentity(fishRoot)
if (!before) {
  console.error(`这个目录里没有可读的身份证：${fishRoot}/identity.json`)
  process.exit(1)
}
console.log(`鱼的家：${fishRoot}`)
console.log(`旧编号：${before.identityId}`)

// 同一家族里已经有的编号（父代 + 孩子们）不能再发一次
const usedIds = []
try {
  const family = dirname(fishRoot.replace(/[\\/]+$/, ''))
  const parentId = await readIdentity(join(family, 'fish'))
  if (parentId) usedIds.push(parentId.identityId)
  for (const name of readdirSync(join(family, 'children'))) {
    const id = await readIdentity(join(family, 'children', name))
    if (id) usedIds.push(id.identityId)
  }
} catch { /* 不在标准家族目录里就只保证自己 */ }

const r = await reissueIdentity(fishRoot, { usedIds })
if (!r.ok) {
  console.error(`没换成：${r.why}`)
  process.exit(1)
}
if (!r.changed) {
  console.log('已经是新格式（ds-fish- + 年月日 + 4 位编码），不用换。')
  process.exit(0)
}
console.log(`新编号：${r.identity.identityId}（旧编号已记在 legacyId）`)

const stateDir = join(String(process.env.DSH_HOME || '').trim() || join(homedir(), '.dsh'), 'cdda-duty')
const oldMem = join(stateDir, 'memory', before.identityId)
const newMem = join(stateDir, 'memory', r.identity.identityId)
if (!existsSync(oldMem)) {
  console.log(`CDDA 记忆：没找到旧目录 ${oldMem}（没在 CDDA 里用过就不用管）`)
} else if (!moveMemory) {
  console.log(`⚠️ CDDA 记忆还在旧目录：${oldMem}`)
  console.log(`   想一起搬：node tools/reissue-identity.mjs ${JSON.stringify(fishRoot)} --move-cdda-memory`)
} else if (existsSync(newMem)) {
  console.log(`⚠️ 新记忆目录已经存在，没动：${newMem}`)
} else {
  try {
    await rename(oldMem, newMem)
    console.log(`CDDA 记忆：${oldMem} → ${newMem}`)
  } catch (e) {
    console.error(`CDDA 记忆改名失败：${String(e?.message ?? e)}`)
    console.error(`   旧目录还在：${oldMem}`)
  }
}
