/**
 * perception/installed.js —— 扫描当前 profile 里装了哪些 DSH 插件
 *
 * 为什么需要：以前接一个源要你手打工具名。既然插件就在同一个 profile 的
 * node_modules 里，那就直接列出来让你勾。
 *
 * 两条边界，必须说清：
 *   1. **工具名是"推测"**：我们读它的 index.js 找 `name: 'xxx'`，标 suggest。
 *      真正准的是宿主自己的工具清单（probe.js），拿得到就以那个为准。
 *   2. **只读**：这个模块只读 package.json / index.js，不加载、不执行别人的代码。
 */

import { promises as fs } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 插件自己的包名（用来在扫描结果里标出"这一条是本插件"）。 */
const SELF = 'dsh-fish-kin'

/**
 * 猜一个插件暴露了哪些工具。
 *
 * 0.21.x 的坑：只认 `defineTool(`，而真实插件多写 `ctx.tools.register({ name })`，
 * 结果五个插件全扫成"没扫到"。这里认三种写法，并且**只认"注册调用"附近的 name**，
 * 不去抓普通对象里的 name（否则参数名、配置键全会被当成工具）。
 */
const CALL_RE = /(?:defineTool|registerTool|tools\s*\.\s*register)\s*\(/g

export function guessToolNames(source = '') {
  const out = []
  const text = String(source ?? '')
  for (const m of text.matchAll(CALL_RE)) {
    // 注册调用之后的一小段里找 name（不要求配对到右括号：对象可能很长）
    const slice = text.slice(m.index, m.index + 300)
    const nm = /name:\s*['"]([a-z][a-z0-9_]{1,63})['"]/.exec(slice)
    if (nm && !out.includes(nm[1])) out.push(nm[1])
  }
  return out
}

/** 一个包里哪些文件可能写着工具定义（跳过 node_modules / dist 里的压缩产物）。 */
async function jsFilesUnder(dir, out = [], depth = 0) {
  if (depth > 4 || out.length > 400) return out
  let entries = []
  try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === 'dist') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) await jsFilesUnder(p, out, depth + 1)
    else if ((e.name.endsWith('.js') || e.name.endsWith('.mjs')) && out.length <= 400) out.push(p)
  }
  return out
}

/**
 * 从本文件位置往上找到 `node_modules`。
 *
 * 0.21.0 的坑：写成了 `join(HERE,'..','..')`，从 `lib/perception` 只退到
 * `dsh-fish-kin/lib`——扫的是插件自己，当然一个别的插件都看不到。
 * 现在按"往上找名字叫 node_modules 的那一层"来定位，不再数层级。
 */
export function resolveNodeModules(startDir = HERE) {
  let dir = startDir
  for (let i = 0; i < 8; i++) {
    if (basename(dir) === 'node_modules') return dir
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  // 兜底：正常布局是 .../node_modules/<包>/lib/perception
  return dirname(dirname(dirname(startDir)))
}

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch { return null }
}

/**
 * 列出 profile 的 node_modules 里的 DSH 插件。
 * @param {object} o { baseDir?: string } baseDir 默认从本文件位置推（profile/node_modules）
 * @returns {Promise<{baseDir:string, plugins:Array}>}
 */
export async function listInstalledPlugins({ baseDir = '' } = {}) {
  // lib/perception/installed.js → ../../ → node_modules
  const root = baseDir || resolveNodeModules()
  const plugins = []
  let entries = []
  try { entries = await fs.readdir(root, { withFileTypes: true }) } catch { return { baseDir: root, plugins } }

  const dirs = []
  for (const e of entries) {
    if (!e.isDirectory()) continue
    if (e.name.startsWith('.')) continue
    if (e.name.startsWith('@')) {
      try {
        for (const sub of await fs.readdir(join(root, e.name), { withFileTypes: true })) {
          if (sub.isDirectory()) dirs.push(join(e.name, sub.name))
        }
      } catch { /* ignore */ }
      continue
    }
    dirs.push(e.name)
  }

  for (const rel of dirs) {
    const pkg = await readJson(join(root, rel, 'package.json'))
    if (!pkg?.name) continue
    const bare = String(pkg.name).replace(/^@[^/]+\//, '')
    const isDsh = pkg.dsh || bare.startsWith('dsh-') || pkg.keywords?.includes('dsh-plugin')
    if (!isDsh) continue
    if (pkg.name === SELF) continue
    // 入口有三种常见写法：package.json 的 main / exports["."] / 默认 index.js
    const entryCandidates = [
      pkg.main,
      typeof pkg.exports === 'string' ? pkg.exports : pkg.exports?.['.'],
      'index.js',
      'lib/index.js',
      'dist/index.js',
    ].filter((x) => typeof x === 'string' && x)
    let source = ''
    for (const c of entryCandidates) {
      try {
        source = await fs.readFile(join(root, rel, c), 'utf8')
        break
      } catch { /* 下一个 */ }
    }
    // 入口文件之外也扫一遍（插件常把工具拆在 lib/**）——有上限，不递归 node_modules
    const extra = await jsFilesUnder(join(root, rel))
    let joined = source
    for (const f of extra.slice(0, 400)) {
      try { joined += '\u000a' + await fs.readFile(f, 'utf8') } catch { /* ignore */ }
    }
    source = joined
    plugins.push({
      name: String(pkg.name),
      version: String(pkg.version ?? ''),
      description: String(pkg.description ?? '').slice(0, 120),
      hasClient: Boolean(pkg.dsh?.client),
      tools: guessToolNames(source),
      toolsCertain: false,
    })
  }
  plugins.sort((a, b) => a.name.localeCompare(b.name))
  return { baseDir: root, plugins }
}

/** 插件包名 → 感知源 id（dsh-bili-scroll → bili_scroll）。 */
export function sourceIdOf(pkgName) {
  return String(pkgName ?? '')
    .replace(/^@[^/]+\//, '')
    .replace(/^dsh-/, '')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
    .slice(0, 32) || 'source'
}
