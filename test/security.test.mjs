/**
 * security.test.mjs —— 她的工具闸门（每个工具都先问你）
 *
 * 2026-10-31 定案：不再"收窄到两个工具"，也不再"接感知源"。
 * 她看得见宿主的工具，但**每一次调用都要过你**：
 *   允许一次 / 永远允许 / 拒绝本次 / 永久禁止
 *
 * 这里钉四件事：
 *   1. 只有在她的工作区里（她自己屋子 + 配置的 workspaces）才挂闸门
 *   2. 陌生工具 → 拦下并立一张待批单，不执行
 *   3. 永久禁止 → 直接"做不到"；永久允许 → 放行
 *   4. 一次性许可用掉就没了；fish_commit 不用问
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { withTemp } from './_fixture.mjs'
import { registerRestrict, workspacesOf } from '../lib/fish/restrict.js'
import { grantOnce, persist, loadPolicy } from '../lib/fish/permissions.js'
import { listApprovals } from '../lib/fish/approvals.js'

function fakeAgent(cwd) {
  const calls = { guard: [] }
  return {
    calls,
    agent: {
      session: { header: { cwd, id: 'sess-' + Math.random().toString(36).slice(2) } },
      ctx: {
        tools: { guard: (fn) => { calls.guard.push(fn); return () => {} } },
        effect: () => {},
      },
    },
  }
}

function setup(root) {
  let onCreated = null
  const ctx = { on: (name, fn) => { if (name === 'agent/created') onCreated = fn; return () => {} } }
  registerRestrict(ctx, { root, log: () => {} })
  return onCreated
}

test('闸门只挂在她的工作区里', async () => {
  await withTemp(async (root) => {
    const onCreated = setup(root)
    const other = fakeAgent(join(root, 'elsewhere'))
    onCreated({ agent: other.agent })
    assert.equal(other.calls.guard.length, 0, '别的目录不该挂')

    const mine = fakeAgent(join(root, 'home'))
    onCreated({ agent: mine.agent })
    assert.equal(mine.calls.guard.length, 1, '她的屋子要挂')
  })
})

test('配置里的 workspaces 也算"在家"', async () => {
  await withTemp(async (root) => {
    const extra = join(root, 'proj')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'config.json'), JSON.stringify({ workspaces: [extra] }), 'utf8')
    const ws = workspacesOf(root)
    assert.ok(ws.some((x) => x.includes('home')))
    assert.ok(ws.some((x) => x.includes('proj')), ws.join(','))

    const onCreated = setup(root)
    const a = fakeAgent(extra)
    onCreated({ agent: a.agent })
    assert.equal(a.calls.guard.length, 1)
  })
})

test('陌生工具：拦下 + 立单，绝不执行', async () => {
  await withTemp(async (root) => {
    const onCreated = setup(root)
    const f = fakeAgent(join(root, 'home'))
    onCreated({ agent: f.agent })
    const guard = f.calls.guard[0]

    const out = guard({ name: 'shell' })
    assert.match(out, /先问他一声/)
    const { pending } = await listApprovals(root)
    assert.equal(pending.length, 1)
    assert.equal(pending[0].kind, 'tool-call')
    assert.equal(pending[0].payload.tool, 'shell')

    // 再问一次不会堆一堆单子
    guard({ name: 'shell' })
    assert.equal((await listApprovals(root)).pending.length, 1)
  })
})

test('永久禁止 / 永久允许 / 一次性 / 免问工具', async () => {
  await withTemp(async (root) => {
    const onCreated = setup(root)
    const f = fakeAgent(join(root, 'home'))
    onCreated({ agent: f.agent })
    const guard = f.calls.guard[0]

    persist(root, 'shell', 'deny')
    assert.equal(guard({ name: 'shell' }), '这件事我做不到。')

    persist(root, 'read_file', 'allow')
    assert.equal(guard({ name: 'read_file' }), undefined)

    assert.equal(guard({ name: 'fish_commit' }), undefined, '她自己的写入口不用问')

    // 一次性：第一次过，第二次又要问
    grantOnce(root, 'web_search')
    assert.equal(guard({ name: 'web_search' }), undefined)
    assert.match(guard({ name: 'web_search' }), /先问他一声/)

    const p = loadPolicy(root)
    assert.deepEqual(p.alwaysAllow, ['read_file'])
    assert.deepEqual(p.alwaysDeny, ['shell'])
  })
})
