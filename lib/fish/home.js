/**
 * fish/home.js —— 她的屋子：一条工作区会话，cwd 指向 `<root>/home`
 *
 * 为什么要单独给她一个 cwd：不能让她站在自己的 `events.jsonl` 旁边——那等于
 * 让她 `cat` 一下就读到全部历史。给她一个空房间，状态库是父目录。
 *
 * 会话 id 记在 `<root>/home.json`（只读一次、复用）。宿主的 `sessionController.create`
 * 只接受 `{cwd}` 或 `{workspaceId}` 二者之一；我们给 cwd，让它自己挂个工作区。
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { paths } from './store.js'

async function readHome(root) {
  try {
    return JSON.parse(await fs.readFile(paths(root).homeJson, 'utf8'))
  } catch {
    return null
  }
}

async function writeHome(root, value) {
  const p = paths(root)
  const tmp = `${p.homeJson}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  await fs.rename(tmp, p.homeJson)
}

const WS_TITLE = '大肥鱼的家'

function readRegistry(ctx) {
  try { return ctx?.get?.('workspaceRegistry') ?? ctx?.workspaceRegistry ?? null } catch { return null }
}

function pathKey(p) {
  const s = String(p ?? '').replace(/\\/g, '/').replace(/\+$/, '')
  return process.platform === 'win32' ? s.toLowerCase() : s
}

/**
 * 在宿主里找到/创建"大肥鱼的家"这个**工作区**（侧栏可见）。
 *
 * 宿主接口（dsh-fish 在本机核过）：
 *   ctx.get('workspaceRegistry').list() / .create(dir, title)
 *   Workspace 上有 setTitle(title)；registry 本身没有 update/rename
 * 会话必须用 `{ workspaceId }` 建才会挂进工作区——用 `{ cwd }` 建的会话不会出现在侧栏。
 */
export async function ensureWorkspace(ctx, { root = '', log = () => {} } = {}) {
  const dir = paths(root).home
  await fs.mkdir(dir, { recursive: true })
  const reg = readRegistry(ctx)
  if (!reg?.create) return { ok: false, why: '宿主没有 workspaceRegistry 服务', dir, wsId: '' }

  let ws = null
  try {
    const list = typeof reg.list === 'function' ? reg.list() : []
    ws = (list ?? []).find((w) => w && w.path && pathKey(w.path) === pathKey(dir)) ?? null
  } catch { /* list 不可用就直接 create */ }

  let renamed = false
  if (ws && String(ws.title ?? '') !== WS_TITLE) {
    try {
      if (typeof ws.setTitle === 'function') { await ws.setTitle(WS_TITLE); renamed = true }
      else if (typeof reg.rename === 'function') { await reg.rename(ws.id ?? ws.workspaceId, WS_TITLE); renamed = true }
    } catch { /* 改不动就保持原名 */ }
  }

  if (!ws) {
    try { ws = await reg.create(dir, WS_TITLE) } catch (err) {
      return { ok: false, why: `建工作区失败：${String(err?.message ?? err).slice(0, 120)}`, dir, wsId: '' }
    }
  }
  const wsId = String(ws?.id ?? ws?.workspaceId ?? '')
  if (!wsId) return { ok: false, why: '宿主返回的工作区没有 id', dir, wsId: '' }
  log(renamed ? '工作区已改名为「大肥鱼的家」' : '工作区「大肥鱼的家」就位')
  return { ok: true, why: '', dir, wsId, created: !ws, renamed }
}

/**
 * 保证她有一条能说话的会话。
 * @returns {Promise<{ok:boolean, sessionId:string, why:string, reused:boolean}>}
 */
export async function ensureHome(ctx, { root, log = () => {} } = {}) {
  const p = paths(root)
  await fs.mkdir(p.home, { recursive: true })
  const saved = await readHome(root)
  const sc = ctx?.get?.('sessionController') ?? ctx?.sessionController
  if (!sc) return { ok: false, sessionId: '', why: '宿主没有 sessionController', reused: false }

  const savedId = String(saved?.sessionId ?? '')
  if (savedId) {
    // 还在工作区的会话清单里吗（宿主机重启后可能是旧 id）
    try {
      if (typeof sc.list === 'function') {
        const list = await sc.list({})
        const ids = flattenIds(list)
        if (ids.size === 0 || ids.has(savedId)) return { ok: true, sessionId: savedId, why: '', reused: true }
      } else {
        return { ok: true, sessionId: savedId, why: '', reused: true }
      }
    } catch { return { ok: true, sessionId: savedId, why: '', reused: true } }
  }

  if (typeof sc.create !== 'function') return { ok: false, sessionId: '', why: '宿主没有 sessionController.create', reused: false }
  try {
    // 先挂工作区（这样侧栏能看到「大肥鱼的家」）；宿主没有 registry 就退回 cwd
    const ws = await ensureWorkspace(ctx, { root, log })
    const created = await (async () => {
      if (ws.ok && ws.wsId) {
        try { return await sc.create({ workspaceId: ws.wsId }) } catch (err) {
          log(`用工作区建会话失败（${String(err?.message ?? err).slice(0, 80)}），退回 cwd`)
        }
      }
      return sc.create({ cwd: p.home })
    })()
    const id = String(created?.sessionId ?? created?.id ?? created?.header?.id ?? '')
    if (!id) return { ok: false, sessionId: '', why: '建了会话但拿不到 id', reused: false }
    if (typeof sc.rename === 'function') {
      await sc.rename({ sessionId: id, title: '跟大肥鱼说话' }).catch(() => {})
    }
    await writeHome(root, {
      ...(saved ?? {}),
      sessionId: id,
      workspaceId: ws?.ok ? ws.wsId : (saved?.workspaceId ?? ''),
      createdAt: new Date().toISOString(),
      cwd: p.home,
    })
    log(`给她建了一间屋子（${id}）`)
    return { ok: true, sessionId: id, why: '', reused: false }
  } catch (err) {
    return { ok: false, sessionId: '', why: `建会话失败：${String(err?.message ?? err).slice(0, 160)}`, reused: false }
  }
}

/** 从宿主的会话清单里捞出所有 id（结构不确定，宽容地挖）。 */
function flattenIds(list) {
  const ids = new Set()
  const walk = (v, depth = 0) => {
    if (depth > 4 || v == null) return
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return }
    if (typeof v === 'object') {
      if (typeof v.sessionId === 'string') ids.add(v.sessionId)
      if (typeof v.id === 'string' && v.id.startsWith('session-')) ids.add(v.id)
      for (const [k, val] of Object.entries(v)) {
        if (k === 'header' && val && typeof val === 'object' && typeof val.id === 'string') ids.add(val.id)
        else walk(val, depth + 1)
      }
    }
  }
  walk(list)
  return ids
}

/** 往她那条会话里递一句话（唤醒/对话都走这里）。 */
export async function sayToHer(ctx, { root, text, mode = 'queue' } = {}) {
  const sc = ctx?.get?.('sessionController') ?? ctx?.sessionController
  if (typeof sc?.prompt !== 'function') return { ok: false, why: '宿主没有 sessionController.prompt' }
  const home = await ensureHome(ctx, { root })
  if (!home.ok) return { ok: false, why: home.why }
  try {
    await sc.prompt(
      { requestId: `fish-${Date.now()}`, sessionId: home.sessionId, mode, content: [{ type: 'text', text: String(text ?? '') }] },
      new AbortController().signal,
    )
    return { ok: true, sessionId: home.sessionId }
  } catch (err) {
    return { ok: false, why: String(err?.message ?? err).slice(0, 160) }
  }
}

export { readHome, writeHome }
