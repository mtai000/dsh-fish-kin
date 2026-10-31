/**
 * safety.test.mjs —— 这个仓库自己的硬约束
 *
 * 有几条不是"代码正确性"，而是"这插件还是不是那个东西"：
 *   1. 零依赖（多挂一个包就可能把宿主正在用的旧核心拖进依赖树）
 *   2. 不许 import 宿主的 `@deepseek-ai/dsh-tools`
 *   3. 对母代只有一种写：往 events.jsonl 末尾追加（绝不 writeFile 覆盖）
 *   4. 界面文案里不出现男字旁的他
 *   5. 不许有"改人格"的入口（好感度、亲密度、性格滑条那一套）
 *   6. 控制台不加载任何外部资源（一个自带页面，不往网上要东西）
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

async function libFiles() {
  const names = await readdir(join(ROOT, 'lib'))
  return names.filter((n) => n.endsWith('.js'))
}

test('三个依赖字段必须永远是空的', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  assert.deepEqual(pkg.dependencies, {})
  assert.deepEqual(pkg.peerDependencies ?? {}, {})
  assert.deepEqual(pkg.devDependencies ?? {}, {})
})

test('不许 import 宿主的工具包（link: 装会静默降级、npm 装会整批失败）', async () => {
  for (const f of await libFiles()) {
    const src = await readFile(join(ROOT, 'lib', f), 'utf8')
    assert.equal(src.includes('@deepseek-ai/dsh-tools'), false, `${f} 里出现了 dsh-tools`)
  }
})

test('对母代只有追加：birth.js 里没有 writeFile', async () => {
  const src = await readFile(join(ROOT, 'lib', 'birth.js'), 'utf8')
  assert.ok(src.includes('fs.appendFile'), '报喜应该是追加')
  assert.equal(/fs\.writeFile\s*\(/.test(src), false, '不该出现 writeFile')
  // 我们自己的文件走 writeAtomic（写 tmp 再 rename），也不是覆盖她的事件流
  assert.ok(src.includes('writeAtomic'))
})

test('控制台的文案不用男字旁的他', async () => {
  const html = await readFile(join(ROOT, 'lib', 'console.html'), 'utf8')
  assert.equal(/他(?!们)/.test(html), false, 'console.html 里出现了男字旁的他')
})

test('没有任何"改人格"的入口：不许出现好感度 / 亲密度 / 性格滑条', async () => {
  const forbidden = ['好感度', '亲密度', '感情值', '性格滑条', '人格设定', '人设输入']
  const targets = [...(await libFiles()).map((f) => join(ROOT, 'lib', f)), join(ROOT, 'lib', 'console.html')]
  for (const file of targets) {
    const src = await readFile(file, 'utf8')
    for (const word of forbidden) {
      // 注释里也不许出现：这些词出现的地方只可能是"我们又在做养成面板了"
      assert.equal(src.includes(word), false, `${file} 里出现了「${word}」`)
    }
  }
})

test('控制台不加载任何外部资源', async () => {
  const html = await readFile(join(ROOT, 'lib', 'console.html'), 'utf8')
  assert.equal(/(src|href)\s*=\s*["']https?:/i.test(html), false)
  assert.equal(/@import\s+url\(/i.test(html), false)
  assert.equal(/fonts\.googleapis/.test(html), false)
})

test('所有 lib 模块都能 import（没有半截文件）', async () => {
  for (const f of await libFiles()) {
    const mod = await import(new URL(`../lib/${f}`, import.meta.url))
    assert.equal(typeof mod, 'object', f)
  }
})

test('插件入口的形状：name / VERSION / inject 是数组', async () => {
  const mod = await import(new URL('../lib/index.js', import.meta.url))
  assert.equal(mod.name, 'dsh-fish-kin')
  assert.match(mod.VERSION, /^\d+\.\d+\.\d+$/)
  assert.ok(Array.isArray(mod.inject))
  assert.deepEqual([...mod.inject].sort(), ['sessionController', 'tools', 'webServer'])
  assert.equal(typeof mod.apply, 'function')
})

test('入口能挂在一个空 ctx 上而不炸（宿主服务缺了也只是少个功能）', async () => {
  const mod = await import(new URL('../lib/index.js', import.meta.url))
  // 用临时目录：以前这里写死仓库根，测试会把 events.jsonl 留在工作区里
  const { mkdtemp } = await import('node:fs/promises')
  const os = await import('node:os')
  const dir = await mkdtemp(join(os.tmpdir(), 'kin-safety-'))
  const off = mod.apply({}, { parentRoot: join(dir, 'parent'), kinRoot: join(dir, 'kin'), fishMode: 'external' })
  assert.equal(typeof off, 'function')
  off()
})
