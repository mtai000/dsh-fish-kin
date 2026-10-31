/**
 * workspace.test.mjs —— 家族工作区
 *
 * 用户 2026-10-31 要的：不要写死在 D 盘、要能自己设置一个「大肥鱼家族」工作区，
 * 所有东西都待在里面，别污染别处。
 *
 * 钉住四条：
 *   1. 解析顺序：环境变量 > 指针文件 > 旧目录（老用户不惊动）> 默认
 *   2. 换工作区只写指针，不搬数据
 *   3. 她的家在 <工作区>/fish，族谱就是工作区本身
 *   4. 工作区里没有任何东西写到外面
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { familyRoot, familySource, setFamilyRoot, familyPointer, kinRoot } from '../lib/locate.js'
import { defaultRoot, injectLocate } from '../lib/fish/store.js'
import * as locate from '../lib/locate.js'

test('默认工作区：<home>/大肥鱼家族', async () => {
  const home = await mkdtemp(join(tmpdir(), 'kin-home-'))
  // 没有旧目录时用新默认
  assert.equal(familyRoot({ env: {}, home }), join(home, '大肥鱼家族'))
  assert.equal(familySource({ env: {}, home }), 'default')
})

test('老用户不惊动：旧目录存在就继续用它', async () => {
  const home = await mkdtemp(join(tmpdir(), 'kin-home2-'))
  await mkdir(join(home, '.dsh-fish-kin'), { recursive: true })
  assert.equal(familyRoot({ env: {}, home }), join(home, '.dsh-fish-kin'))
  assert.equal(familySource({ env: {}, home }), 'legacy')
})

test('指针文件优先，环境变量最高', async () => {
  const home = await mkdtemp(join(tmpdir(), 'kin-home3-'))
  await mkdir(join(home, '.dsh-fish-kin'), { recursive: true })
  await writeFile(familyPointer({ env: {}, home }), JSON.stringify({ familyRoot: join(home, '家族A') }), 'utf8')
  assert.equal(familyRoot({ env: {}, home }), join(home, '家族A'))
  assert.equal(familySource({ env: {}, home }), 'pointer')
  assert.equal(familyRoot({ env: { DSH_KIN_FAMILY_ROOT: 'D:/fam' }, home }), 'D:/fam')
  assert.equal(familySource({ env: { DSH_KIN_FAMILY_ROOT: 'D:/fam' }, home }), 'env')
})

test('换工作区：只写指针，拒绝相对路径', async () => {
  const home = await mkdtemp(join(tmpdir(), 'kin-home4-'))
  const bad = await setFamilyRoot('relative/path', { env: {}, home })
  assert.equal(bad.ok, false)
  const ok = await setFamilyRoot(join(home, '新家族'), { env: {}, home })
  assert.equal(ok.ok, true)
  assert.equal(familyRoot({ env: {}, home }), join(home, '新家族'))
  const raw = JSON.parse(await readFile(familyPointer({ env: {}, home }), 'utf8'))
  assert.match(raw.at, /^\d{4}-/)
})

test('她的家在 <工作区>/fish，族谱就是工作区', async () => {
  const home = await mkdtemp(join(tmpdir(), 'kin-home5-'))
  await setFamilyRoot(join(home, '家族B'), { env: {}, home })
  // store.defaultRoot 走注入的 locate；这里用显式 env 覆盖，不碰真实 HOME
  injectLocate(locate)
  assert.equal(kinRoot({ env: {}, home }), join(home, '家族B'))
  assert.equal(defaultRoot({ DSH_KIN_FAMILY_ROOT: join(home, '家族B') }), join(home, '家族B', 'fish'))
})

test('她的屋子叫「大肥鱼的家」，老档的 home/ 继续用', async () => {
  const { paths, ensureDirs, HOME_DIR } = await import('../lib/fish/store.js')
  const home = await mkdtemp(join(tmpdir(), 'kin-house-'))

  assert.equal(HOME_DIR, '大肥鱼的家')
  assert.equal(paths(join(home, 'fish')).home, join(home, 'fish', HOME_DIR))

  await ensureDirs(join(home, 'fish'))
  const { stat } = await import('node:fs/promises')
  assert.ok(await stat(join(home, 'fish', HOME_DIR)).then(() => true), '她自己建了屋子')

  // 老档：已经存在的 home/ 不被强行搬家
  await mkdir(join(home, 'old', 'home'), { recursive: true })
  assert.equal(paths(join(home, 'old')).home, join(home, 'old', 'home'))
})

test('她会主动在每个"在家"目录里建一个「大肥鱼的家」', async () => {
  const { ensureWorkspaceHomes, HOME_DIR } = await import('../lib/fish/store.js')
  const base = await mkdtemp(join(tmpdir(), 'kin-ws-'))
  const w1 = join(base, 'proj-a')
  const w2 = join(base, 'proj-b')
  const made = await ensureWorkspaceHomes(join(base, 'fish'), [w1, w2])
  assert.equal(made.length, 2)
  for (const w of [w1, w2]) {
    const st = await import('node:fs/promises').then((m) => m.stat(join(w, HOME_DIR)))
    assert.ok(st.isDirectory())
  }
})

test('串门：她可以去、但不住下', async () => {
  const { loadConfig, saveConfig } = await import('../lib/fish/wake.js')
  const { registerRestrict, visitsOf } = await import('../lib/fish/restrict.js')
  const { isHerHome } = await import('../lib/fish/identity.js')
  const { ensureWorkspaceHomes, HOME_DIR } = await import('../lib/fish/store.js')
  const { existsSync } = await import('node:fs')

  const base = await mkdtemp(join(tmpdir(), 'kin-visit-'))
  const root = join(base, 'fish')
  const guest = join(base, 'guest-proj')
  await mkdir(root, { recursive: true })
  await mkdir(guest, { recursive: true })
  await writeFile(join(root, 'config.json'), JSON.stringify({ visits: [guest] }), 'utf8')

  const cfg = await loadConfig(root)
  assert.deepEqual(cfg.visits, [guest])
  // visitsOf 归一化过（Windows 上会转小写、统一斜杠）
  assert.equal(visitsOf(root).length, 1)
  assert.ok(visitsOf(root)[0].endsWith('guest-proj'))

  // 串门目录不建屋子
  await ensureWorkspaceHomes(root, [])
  assert.equal(existsSync(join(guest, HOME_DIR)), false)

  // 闸门在串门目录里也挂
  let onCreated = null
  const ctx = { on: (n, fn) => { if (n === 'agent/created') onCreated = fn; return () => {} } }
  registerRestrict(ctx, { root, log: () => {} })
  const calls = []
  onCreated({ agent: { session: { header: { cwd: guest, id: 's1' } }, ctx: { tools: { guard: (fn) => { calls.push(fn); return () => {} } }, effect: () => {} } } })
  assert.equal(calls.length, 1, '串门目录也要挂闸门')

  // 串门时她也还是她（身份段照挂）
  assert.equal(isHerHome({ session: { header: { cwd: guest } } }, root), true)

  // 保存后读得回
  await saveConfig({ visits: [join(base, 'another')] }, root)
  assert.deepEqual((await loadConfig(root)).visits, [join(base, 'another')])
})

test('她会在侧栏建一个「大肥鱼的家」工作区，并用 workspaceId 开会话', async () => {
  const { ensureHome, ensureWorkspace } = await import('../lib/fish/home.js')
  const base = await mkdtemp(join(tmpdir(), 'kin-ws3-'))
  const root = join(base, 'fish')
  await mkdir(root, { recursive: true })

  const made = []
  const renames = []
  const registry = {
    list: () => made,
    create: async (dir, title) => {
      const ws = { id: 'ws_1', path: dir, title, setTitle: async (t) => { ws.title = t; renames.push(t) } }
      made.push(ws)
      return ws
    },
  }
  const created = []
  const sc = {
    list: async () => [],
    create: async (opts) => { created.push(opts); return { sessionId: 's1' } },
    rename: async () => {},
  }
  const ctx = { get: (k) => (k === 'workspaceRegistry' ? registry : k === 'sessionController' ? sc : null) }

  const ws = await ensureWorkspace(ctx, { root, log: () => {} })
  assert.equal(ws.ok, true, ws.why)
  assert.equal(ws.wsId, 'ws_1')
  assert.equal(made[0].title, '大肥鱼的家')

  const home = await ensureHome(ctx, { root, log: () => {} })
  assert.equal(home.ok, true, home.why)
  assert.equal(created.length, 1)
  assert.equal(created[0].workspaceId, 'ws_1', '必须用 workspaceId 开会话，侧栏才看得见')
  assert.equal(created[0].cwd, undefined)

  const { readHome } = await import('../lib/fish/home.js')
  assert.equal((await readHome(root)).workspaceId, 'ws_1')
})

test('宿主没有 workspaceRegistry 时退回 cwd 建会话（不阻断）', async () => {
  const { ensureHome } = await import('../lib/fish/home.js')
  const base = await mkdtemp(join(tmpdir(), 'kin-ws4-'))
  const root = join(base, 'fish')
  await mkdir(root, { recursive: true })
  const created = []
  const sc = { list: async () => [], create: async (o) => { created.push(o); return { sessionId: 's2' } }, rename: async () => {} }
  const ctx = { get: (k) => (k === 'sessionController' ? sc : null) }
  const r = await ensureHome(ctx, { root, log: () => {} })
  assert.equal(r.ok, true)
  assert.ok(created[0].cwd && String(created[0].cwd).includes('大肥鱼的家'))
})

test('任何叫「大肥鱼的家」的目录都算她在家（用户自己建的也算）', async () => {
  const { isHerHome } = await import('../lib/fish/identity.js')
  const { normPath } = await import('../lib/text.js')
  const base = await mkdtemp(join(tmpdir(), 'kin-place-'))
  const root = join(base, 'fish')
  await mkdir(root, { recursive: true })

  const at = (cwd) => isHerHome({ session: { header: { cwd } } }, root, normPath)
  const bs = String.fromCharCode(92)
  // 用户在 D 盘自己建的那个
  assert.equal(at('D:' + bs + '大肥鱼的家' + bs + '大肥鱼的家'), true)
  // 它爹也叫这个名字——同样算她在家（工作区本身）
  assert.equal(at('D:' + bs + '大肥鱼的家'), true)
  // 别的地方不是她家
  assert.equal(at('D:' + bs + 'somewhere' + bs + 'else'), false)
  // 她自己的屋子仍然是
  assert.equal(at(join(root, '大肥鱼的家')), true)
})

test('删掉串门后，老 workspaces 不许把它"复活"', async () => {
  const { saveConfig, loadConfig } = await import('../lib/fish/wake.js')
  const { readFile } = await import('node:fs/promises')
  const base = await mkdtemp(join(tmpdir(), 'kin-legacy-'))
  const root = join(base, 'fish')
  await mkdir(root, { recursive: true })
  // 老配置：只有 workspaces
  await writeFile(join(root, 'config.json'), JSON.stringify({ workspaces: [join(base, 'old-proj')] }), 'utf8')
  assert.equal((await loadConfig(root)).visits.length, 1, '兼容：老的 workspaces 当作串门读')

  // 用户点了"不让去"
  await saveConfig({ visits: [] }, root)
  assert.equal((await loadConfig(root)).visits.length, 0, '删掉就不该复活')

  const raw = JSON.parse(await readFile(join(root, 'config.json'), 'utf8'))
  assert.equal(raw.workspaces, undefined, '老字段应从文件里清掉')
})
