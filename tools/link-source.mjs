/**
 * tools/link-source.mjs —— 把任意插件接成感知源（只改配置，不写代码）
 *
 * 装好一个插件之后，看它暴露了哪些工具，然后把它们登记成"她的一个世界"：
 *
 *   node tools/link-source.mjs --id bili --title "看 B 站" \
 *     --read bili_search,bili_hot --act bili_comment --budget 3
 *
 *   node tools/link-source.mjs --id cdda --title "去游戏里走走" \
 *     --read cdda_observe --act cdda_move --budget 1
 *
 *   node tools/link-source.mjs --list
 *
 * 这个脚本**不认识任何插件**：工具名全由你填。同一个 id 再跑一次就是覆盖。
 */
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const { linkSource, listSources } = await import(pathToFileURL(join(HERE, '..', 'lib', 'perception', 'link.js')).href)
const root = process.env.DSH_KIN_FISH_HOME || join(homedir(), '.dsh-fish-kin', 'fish')

const args = process.argv.slice(2)
const get = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? String(args[i + 1] ?? '') : ''
}
if (args.includes('--list') || args.length === 0) {
  const list = await listSources(root)
  if (!list.length) console.log('还没接任何源。用 --id/--read/--act 接一个。')
  for (const s of list) {
    console.log(`${s.id}  ${s.title}  adapter=${s.adapter}  read=[${s.read.join(',')}] act=[${s.act.join(',')}] budget=${s.budget?.perDay ?? '-'}`)
  }
  process.exit(0)
}

const id = get('--id')
const read = get('--read')
const act = get('--act')
if (!id || (!read && !act)) {
  console.error('至少要有 --id 和 --read 或 --act。')
  process.exit(1)
}
const r = await linkSource(root, { id, title: get('--title'), read, act, budget: get('--budget') || null, summaryMax: get('--summary') || null })
if (!r.ok) {
  console.error('没接上：', r.why)
  process.exit(1)
}
console.log(`接上了：${r.source.id}（${r.source.title}）read=[${r.source.read.join(',')}] act=[${r.source.act.join(',')}]`)
console.log('重启 DSH 之后，她的工具面里就会出现这些读类工具；行动类要先过大肥鱼的审批。')
