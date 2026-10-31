/**
 * tools/verify.mjs —— 装好没有（零依赖，插件没加载也能跑）
 *
 * 用法：node D:\dsh\dsh-fish-kin\tools\verify.mjs
 *
 * 只读不写。检查 6 件事：
 *   1. profile 里两条依赖在不在、bundles 里有没有它们
 *   2. dsh-fish 的 junction 是否还指着源码目录
 *   3. 两个包能不能真的 import（入口能加载）
 *   4. 她的存档（~/.dsh-fish）有没有事件
 *   5. 我们的 fishMode 默认是 external 还是 embedded
 *   6. 有没有遗留的"止血"配置（wake.enabled=false）
 */

import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

const HOME = homedir()
const PROFILES = join(HOME, '.dsh', 'profiles')
const FISH_HOME = process.env.DSH_KIN_FISH_HOME || join(HOME, '.dsh-fish-kin', 'fish')

const ok = (m) => console.log('  ✓ ' + m)
const warn = (m) => console.log('  ! ' + m)
const bad = (m) => console.log('  ✗ ' + m)

function profileDir() {
  for (const name of ['desktop', 'web', 'headless']) {
    const d = join(PROFILES, name)
    if (existsSync(join(d, 'package.json'))) return d
  }
  return ''
}

const prof = profileDir()
if (!prof) {
  bad('找不到任何 DSH profile（~/.dsh/profiles/*/package.json）')
  process.exit(1)
}
console.log('profile:', prof)

const pkg = JSON.parse(readFileSync(join(prof, 'package.json'), 'utf8'))
const deps = pkg.dependencies ?? {}
const bundles = pkg?.dsh?.profile?.bundles ?? []

console.log('\n[1] 依赖登记')
// dsh-fish 现在是**可选**的：不装才对（用户明确不依赖别人的实现）
if (deps['dsh-fish']) warn(`dsh-fish 还装着 = ${deps['dsh-fish']}（当前默认 embedded，其实不需要它）`)
else ok('没有装 dsh-fish（嵌入式运行时，自己养鱼）')
for (const name of ['dsh-fish-kin']) {
  if (deps[name]) ok(`${name} = ${deps[name]}`)
  else bad(`${name} 不在 dependencies 里`)
  if (bundles.includes('dsh-fish-kin')) ok('dsh-fish-kin 在 bundles 里')
  else bad('dsh-fish-kin 不在 dsh.profile.bundles 里（不会被加载）')
}

console.log('\n[2] 装进去的副本')
for (const name of ['dsh-fish-kin']) {
  const dir = join(prof, 'node_modules', name)
  if (!existsSync(join(dir, 'package.json'))) { bad(`${name} 目录里没有 package.json`); continue }
  const v = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version
  let kind = ''
  try { kind = lstatSync(dir).isSymbolicLink() ? '（junction/link → 源码）' : '（本地副本）' } catch { /* ignore */ }
  ok(`${name}@${v}${kind}`)
}

console.log('\n[3] 入口能不能加载')
for (const name of ['dsh-fish-kin']) {
  const entry = join(prof, 'node_modules', name, 'lib', 'index.js')
  if (!existsSync(entry)) { bad(`${name} 没有 lib/index.js`); continue }
  try {
    const m = await import(pathToFileURL(entry).href)
    ok(`${name} 入口 OK｜name=${m.name}｜inject=${(m.inject ?? []).join(',')}`)
  } catch (err) {
    bad(`${name} 入口加载失败：${String(err?.message ?? err).slice(0, 120)}`)
  }
}

console.log('\n[4] 她的存档')
const ev = join(FISH_HOME, 'events.jsonl')
if (!existsSync(ev)) {
  warn(`${FISH_HOME} 还没有 events.jsonl（第一次启动 dsh-fish 后会建）`)
} else {
  const lines = readFileSync(ev, 'utf8').split('\n').filter((l) => l.trim())
  ok(`${ev}｜${lines.length} 条事件`)
  try {
    const first = JSON.parse(lines[0])
    ok(`第一条：kind=${first.kind ?? first.type}｜${String(first.body ?? first.text ?? '').slice(0, 40)}`)
  } catch { warn('第一条读不出来') }
}

console.log('\n[5] 我们的 fishMode')
const ourEntry = join(prof, 'node_modules', 'dsh-fish-kin', 'lib', 'index.js')
if (existsSync(ourEntry)) {
  const src = readFileSync(ourEntry, 'utf8')
  const m = /DSH_FISH_MODE \?\? '(\w+)'/.exec(src)
  if (m) console.log(`  默认 fishMode = ${m[1]}${m[1] === 'embedded' ? '（自己的运行时，正确）' : '（依赖外部 dsh-fish）'}`)
  else warn('没找到 fishMode 的默认值')
}

console.log('\n[6] 遗留的止血配置')
const cfg = join(FISH_HOME, 'config.json')
if (!existsSync(cfg)) {
  ok('没有 config.json（dsh-fish 会用它的默认）')
} else {
  try {
    const c = JSON.parse(readFileSync(cfg, 'utf8'))
    if (c?.wake?.enabled === false) warn('生物钟关着（wake.enabled=false）——想让她自己醒，改成 true')
    else ok('config.json 没有止血残留')
  } catch { warn('config.json 读不出来') }
}

console.log('\n完成。要看到她的记忆，还得在宿主里重启一次（bundle 层要重新组装）。')
