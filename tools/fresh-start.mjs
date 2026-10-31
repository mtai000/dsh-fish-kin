/**
 * tools/fresh-start.mjs —— 重开一局（把旧档归档，不删）
 *
 * 为什么需要它：seed 是不可变的（这是整个项目的地基）。所以「换成可爱天真的起点」
 * 这件事只对**新播种的鱼**生效——现有这条鱼要换，只能重开一局。
 *
 * 用法：
 *   node tools/fresh-start.mjs --style cute   # 归档旧档，用可爱天真重新播种
 *   node tools/fresh-start.mjs --style none   # 同上，但起点是空白
 *
 * 旧档会挪到 <她家>/archive/<时间戳>/，**不删除**；要反悔就把它挪回来。
 */
import { promises as fs } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = join(HERE, '..', 'lib', 'fish')
const load = (f) => import(pathToFileURL(join(LIB, f)).href)

const args = process.argv.slice(2)
const styleArg = (() => {
  const i = args.indexOf('--style')
  return i >= 0 ? String(args[i + 1] ?? 'cute') : ''
})()
if (!styleArg) {
  console.log('用法: node tools/fresh-start.mjs --style cute|none')
  console.log('  会把她的事件流归档到 <她家>/archive/<时间戳>/，然后用这个风格重新播种。')
  process.exit(0)
}
const style = ['cute', 'none'].includes(styleArg) ? styleArg : 'cute'
const root = process.env.DSH_KIN_FISH_HOME || join(homedir(), '.dsh-fish-kin', 'fish')

const { readEvents, ensureSeed } = await load('store.js')
const { seedText } = await load('seed.js')
const { saveConfig, loadConfig } = await load('wake.js')

const { events } = await readEvents(root)
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const dir = join(root, 'archive', stamp)
await fs.mkdir(dir, { recursive: true })
for (const f of ['events.jsonl', 'home.json', 'owner.json', 'approvals.jsonl', 'imported.json']) {
  try { await fs.rename(join(root, f), join(dir, f)) } catch { /* 没有就算了 */ }
}
await saveConfig({ style }, root)
const cfg = await loadConfig(root)
await ensureSeed(root, seedText(cfg.style))
await fs.writeFile(join(dir, 'README.txt'), `归档于 ${new Date().toISOString()}\n原来的 ${events.length} 条记忆在这里；要恢复就把文件挪回 ${root}\n`, 'utf8')
console.log('归档到：', dir)
console.log('原来的记忆：', events.length, '条')
console.log('重新播种：', cfg.style)
