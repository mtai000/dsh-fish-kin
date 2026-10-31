/**
 * tools/migrate-workspace.mjs —— 把整个家族搬到新工作区
 *
 * 为什么是"复制"而不是"移动"：搬家用 mv 最省事，但也最不可逆——
 * 复制完、核对完条数，再让你自己删旧的。旧目录一直是完整的。
 *
 * 用法：
 *   node tools/migrate-workspace.mjs "D:\我的东西\大肥鱼家族"
 *   node tools/migrate-workspace.mjs "..." --dry-run
 *
 * 它只做三件事：
 *   1. 把当前工作区整份复制到新目录（新目录必须不存在或为空）
 *   2. 核对：事件流条数、族谱代数、孩子目录数
 *   3. 写指针文件 `~/.dsh-fish-kin.json`，下次启动生效
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const locate = await import(pathToFileURL(join(HERE, '..', 'lib', 'locate.js')).href)

const args = process.argv.slice(2)
const dry = args.includes('--dry-run')
const target = args.find((a) => !a.startsWith('--')) ?? ''

if (!target) {
  const env = process.env
  console.log('用法: node tools/migrate-workspace.mjs "<新工作区的绝对路径>" [--dry-run]')
  console.log('现在的工作区:', locate.familyRoot({ env }), '（来源:', locate.familySource({ env }) + '）')
  process.exit(0)
}

if (!/^[A-Za-z]:[\\/]/.test(target) && !target.startsWith('/')) {
  console.error('要一个绝对路径。')
  process.exit(1)
}

const env = process.env
const from = locate.familyRoot({ env })
if (from === target) {
  console.log('新工作区就是当前的，不用搬。')
  process.exit(0)
}

async function countStats(root) {
  const out = { events: 0, lineage: 0, children: 0, approvals: 0 }
  try {
    const raw = await fs.readFile(join(root, 'fish', 'events.jsonl'), 'utf8')
    out.events = raw.split('\n').filter(Boolean).length
  } catch { /* 没有 */ }
  try {
    const raw = await fs.readFile(join(root, 'lineage.jsonl'), 'utf8')
    out.lineage = raw.split('\n').filter(Boolean).length
  } catch { /* 没有 */ }
  try {
    const kids = await fs.readdir(join(root, 'children'))
    out.children = kids.length
  } catch { /* 没有 */ }
  try {
    const ap = await fs.readdir(join(root, 'fish', 'approvals'))
    out.approvals = ap.filter((x) => x.endsWith('.json')).length
  } catch { /* 没有 */ }
  return out
}

const before = await countStats(from)
console.log('从:', from)
console.log('  ', JSON.stringify(before))
console.log('到:', target)

let empty = true
try {
  const entries = await fs.readdir(target)
  empty = entries.length === 0
} catch { /* 不存在，正好 */ }
if (!empty) {
  console.error('目标目录里已经有东西了。换一个空目录，或者先手动清空。')
  process.exit(1)
}

if (dry) {
  console.log('（dry-run：没有复制，也没有写指针）')
  process.exit(0)
}

await fs.mkdir(target, { recursive: true })
await fs.cp(from, target, { recursive: true, force: false, errorOnExist: false })

const after = await countStats(target)
console.log('复制完:', JSON.stringify(after))
if (after.events !== before.events || after.lineage !== before.lineage || after.children !== before.children) {
  console.error('核对不通过：条数对不上，指针没有写。旧目录保持原样。')
  process.exit(1)
}

const set = await locate.setFamilyRoot(target, { env })
if (!set.ok) {
  console.error('指针没写成：', set.why)
  process.exit(1)
}
console.log('')
console.log('搬完了，指针已写入:', locate.familyPointer({ env }))
console.log('旧目录还在:', from, '（确认没问题再自己删）')
console.log('重启 DSH 之后生效。')
