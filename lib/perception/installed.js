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
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 插件自己的包名（用来在扫描结果里标出"这一条是本插件"）。 */
const SELF = 'dsh-fish-kin'

/**
 * 猜一个插件暴露了哪些工具。
 * 只在 `defineTool(` 之后的 200 字符内找 `name: '...'`，避免把参数名也抓进来。
 */
export function guessToolNames(source = '') {
  const out = []
  const re = /defineTool\s*\(\s*\{/g
  let m
  while ((m = re.exec(source))) {
    const slice = source.slice(m.index, m.index + 400)
    const nm = /name:\s*['"]([a-z][a-z0-9_]{1,63})['"]/.exec(slice)
    if (nm && !out.includes(nm[1])) out.push(nm[1])
  }
  return out
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
  const root = baseDir || join(HERE, '..', '..')
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
