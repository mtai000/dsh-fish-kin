/**
 * routes.js —— 网页控制台
 *
 * 一个自带的页面，不碰 dsh-fish 的界面，也不往宿主里塞 client bundle：
 * 一个控制台页 + 几个 JSON 接口，装上插件、重启之后访问 `/dsh-fish-kin` 就能用。
 *
 *   GET  /                 控制台
 *   GET  /api/state        记忆压力 / 族谱 / 待批
 *   GET  /api/preview      这一次会带走什么（不落盘）
 *   POST /api/request      立一张待批的单子
 *   POST /api/approve      批准（真的生）
 *   POST /api/reject       驳回
 *   POST /api/birth        主人直接要一个（要 confirm）
 *   GET  /api/lineage      族谱
 *   GET  /api/config       环境参数（阈值、继承开关、教学开关）
 *   POST /api/config       改环境参数（写白名单，别的一律退回）
 *   GET  /api/teach        课表 + 孩子学得怎么样 + 该教什么（?childId=）
 *   POST /api/teach        教一课（不传 text 就按候选自动取）
 *   GET  /api/child/<id>/handover  那个孩子的接生单（纯文本，可下载）
 *
 * 规则和 dsh-fish 的观测台一致：这里**不能改她**。能改的只有我们自己的
 * 环境参数（阈值、继承不继承称呼），没有一格能让人"把她调成别的性格"。
 */

import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as svc from './service.js'
import { listApprovals, readApproval, decideApproval, consumeApproval } from './fish/approvals.js'
import { ensureWorkspaceHomes, HOME_DIR } from './fish/store.js'
import { loadPolicy, forget, grantOnce, persist } from './fish/permissions.js'
import { workspacesOf } from './fish/restrict.js'
import { loadConfig as loadFishConfig, saveConfig as saveFishConfig } from './fish/wake.js'
import { childPaths, familyRoot as resolveFamilyRoot, familySource, setFamilyRoot } from './locate.js'

const PREFIX = '/dsh-fish-kin'
const HERE = dirname(fileURLToPath(import.meta.url))
const MAX_BODY = 64 * 1024

let pageCache = null
async function page() {
  if (pageCache) return pageCache
  pageCache = await fs.readFile(join(HERE, 'console.html'), 'utf8')
  return pageCache
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function sendText(res, code, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(text)
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > MAX_BODY) throw new Error('body too large')
    chunks.push(c)
  }
  if (!chunks.length) return {}
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error('body must be JSON')
  }
}

/**
 * 路由表。每一项都是 `(body, ctx) => Promise<{code, json|text}>`。
 * 单独抽出来是为了能不起 HTTP 就直接测（test/routes.test.mjs 用假 req/res）。
 */
export function makeApi(deps = {}) {
  const base = { ...deps }
  return {
    state: async () => {
      const s = await svc.snapshot(base)
      return { code: 200, json: { ok: true, ...s } }
    },
    preview: async () => ({ code: 200, json: { ok: true, ...(await svc.preview(base)) } }),
    request: async (body) => {
      const r = await svc.request({
        ...base,
        trigger: 'owner',
        note: String(body?.note ?? ''),
        label: String(body?.label ?? ''),
        forceKin: body?.forceKin === true,
      })
      return { code: r.ok ? 200 : 409, json: r }
    },
    approve: async (body) => {
      const id = String(body?.id ?? '')
      if (!/^req_[0-9A-Z]{26}$/.test(id)) return { code: 400, json: { ok: false, why: '缺少合法的请求单 id' } }
      const r = await svc.approve({ ...base, id, by: 'owner', label: String(body?.label ?? '') })
      return { code: r.ok ? 200 : 409, json: { ...r, handover: r.ok ? r.handover : '' } }
    },
    reject: async (body) => {
      const id = String(body?.id ?? '')
      if (!/^req_[0-9A-Z]{26}$/.test(id)) return { code: 400, json: { ok: false, why: '缺少合法的请求单 id' } }
      const r = await svc.reject({ ...base, id, by: 'owner', why: String(body?.why ?? '') })
      return { code: r.ok ? 200 : 409, json: r }
    },
    birth: async (body) => {
      const r = await svc.directBirth({
        ...base,
        confirm: String(body?.confirm ?? ''),
        by: 'owner',
        label: String(body?.label ?? ''),
        forceKin: body?.forceKin === true,
      })
      return { code: r.ok ? 200 : (r.why?.includes('confirm') ? 400 : 409), json: { ...r, handover: r.ok ? r.handover : '' } }
    },
    lineage: async () => {
      const v = await svc.lineageView(base)
      // raw 里带指纹（64 个数），页面用不上，别往下发
      const { raw, ...rest } = v
      return { code: 200, json: { ok: true, ...rest } }
    },
    config: async () => ({ code: 200, json: await svc.configView(base) }),
    /** 她自己的环境参数（唤醒、B站、配额、兴趣点、工具白名单）。 */
    fishConfig: async () => {
      const root = base.parentRoot ?? svc.resolveRoots(base).parentRoot
      const config = await loadFishConfig(root)
      return { code: 200, json: { ok: true, root, config } }
    },
    saveFishConfig: async (body) => {
      const root = base.parentRoot ?? svc.resolveRoots(base).parentRoot
      const patch = body?.patch && typeof body.patch === 'object' ? body.patch : body
      const r = await saveFishConfig(patch, root)
      return { code: 200, json: r }
    },
    /** 她在哪个工作区（家族工作区，所有东西都在里面）。 */
    workspace: async () => {
      const env = base.env ?? process.env
      const family = base.familyRoot || resolveFamilyRoot({ env })
      return {
        code: 200,
        json: {
          ok: true,
          familyRoot: family,
          source: base.familyRoot ? 'config' : familySource({ env }),
          fishRoot: join(family, 'fish'),
          kinRoot: family,
        },
      }
    },
    /** 换一个工作区（只写指针文件，数据不搬；下次启动生效）。 */
    setWorkspace: async (body) => {
      const env = base.env ?? process.env
      const dir = String(body?.path ?? '').trim()
      const r = await setFamilyRoot(dir, { env })
      return { code: r.ok ? 200 : 400, json: { ...r, restartRequired: true } }
    },





    /** 立刻叫她一声（不等生物钟）。 */
    fishWake: async () => {
      const fish = base.ctx?.get?.('fish') ?? null
      if (!fish?.wake) return { code: 503, json: { ok: false, why: '她现在不在（插件没起来或 fishMode=external）' } }
      const r = await fish.wake({ force: true })
      return { code: r.ok ? 200 : 409, json: r }
    },
    /** 待批准：她每次想用某个工具都会来这里问一次。 */
    approvals: async () => {
      const root = base.parentRoot ?? svc.resolveRoots(base).parentRoot
      const { pending, expired } = await listApprovals(root)
      return { code: 200, json: { ok: true, pending, expired } }
    },
    /**
     * 决定一张工具许可单。
     * action: allow-once | allow-always | deny-once | deny-always
     */
    decideTool: async (body) => {
      const id = String(body?.id ?? '')
      const action = String(body?.action ?? '')
      if (!id.startsWith('ap_')) return { code: 400, json: { ok: false, why: 'approval id 要以 ap_ 开头' } }
      if (!['allow-once', 'allow-always', 'deny-once', 'deny-always'].includes(action)) {
        return { code: 400, json: { ok: false, why: 'action 只能是 allow-once / allow-always / deny-once / deny-always' } }
      }
      const root = base.parentRoot ?? svc.resolveRoots(base).parentRoot
      const a = await readApproval(root, id)
      if (!a) return { code: 404, json: { ok: false, why: '这张单子不存在（批过/过期了）' } }
      const tool = String(a?.payload?.tool ?? '')
      if (!tool) return { code: 400, json: { ok: false, why: '这张单子没有工具名' } }
      if (action === 'allow-once') grantOnce(root, tool)
      else if (action === 'allow-always') persist(root, tool, 'allow')
      else if (action === 'deny-always') persist(root, tool, 'deny')
      await decideApproval(root, id, { verdict: action.startsWith('allow') ? 'approve' : 'reject', by: 'owner', why: action })
      await consumeApproval(root, id)
      return { code: 200, json: { ok: true, tool, action } }
    },
    /** 当前许可策略（永久允许 / 永久禁止 / 待生效的一次性）。 */
    permissions: async () => {
      const root = base.parentRoot ?? svc.resolveRoots(base).parentRoot
      return { code: 200, json: { ok: true, ...loadPolicy(root) } }
    },
    /** 撤销一条永久设置。 */
    forgetTool: async (body) => {
      const root = base.parentRoot ?? svc.resolveRoots(base).parentRoot
      return { code: 200, json: { ok: true, ...forget(root, String(body?.tool ?? '')) } }
    },
    /** 她在哪些目录算"在家"。 */
    workspaces: async () => {
      const root = base.parentRoot ?? svc.resolveRoots(base).parentRoot
      const cfg = await loadFishConfig(root)
      return {
        code: 200,
        json: {
          ok: true,
          workspaces: cfg.workspaces ?? [],
          visits: cfg.visits ?? [],
          effective: workspacesOf(root),
          dirName: HOME_DIR,
          home: workspacesOf(root)[0] ?? '',
        },
      }
    },
    saveWorkspaces: async (body) => {
      const root = base.parentRoot ?? svc.resolveRoots(base).parentRoot
      const patch = {}
      if (Array.isArray(body?.workspaces)) patch.workspaces = body.workspaces
      if (Array.isArray(body?.visits)) patch.visits = body.visits
      const r = await saveFishConfig(patch, root)
      let made = []
      // 只有"家"会建屋子；串门不写任何东西
      if (r.ok) { try { made = await ensureWorkspaceHomes(root, r.config?.workspaces ?? []) } catch { /* ignore */ } }
      return {
        code: r.ok ? 200 : 400,
        json: {
          ok: r.ok,
          workspaces: r.config?.workspaces ?? [],
          visits: r.config?.visits ?? [],
          homes: made,
          dirName: HOME_DIR,
          why: r.why,
        },
      }
    },
    teach: async (_body, { childId } = {}) => {
      const id = String(childId ?? '')
      const view = await svc.teachView({ ...base, childId: id })
      const candidates = await svc.teachPreview({ ...base, childId: id })
      return { code: 200, json: { ok: true, childId: view.childId || id, view, candidates } }
    },
    /** 让她亲口说一句（会真的叫醒她一次，可能要等一两分钟）。 */
    spoken: async (body) => {
      const r = await svc.spokenTeach({
        ...base,
        childId: String(body?.childId ?? ''),
        timeoutMs: Number(body?.timeoutMs) || undefined,
      })
      return { code: r.ok ? 200 : 409, json: r }
    },
    teachNow: async (body) => {
      const texts = Array.isArray(body?.texts)
        ? body.texts
        : (typeof body?.text === 'string' && body.text.trim() ? [body.text] : [])
      const r = await svc.teachNow({
        ...base,
        childId: String(body?.childId ?? ''),
        texts,
        by: 'owner',
      })
      return { code: r.ok ? 200 : 400, json: r }
    },
    saveConfig: async (body) => {
      const patch = body?.patch && typeof body.patch === 'object' ? body.patch : body
      const r = await svc.saveConfig(patch, base)
      return { code: r.ok ? 200 : 400, json: r }
    },
    handover: async (_body, { childId } = {}) => {
      const id = String(childId ?? '')
      if (!/^kin_[0-9A-Z]{26}$/.test(id)) return { code: 400, json: { ok: false, why: '孩子 id 不像话' } }
      const cp = childPaths(base.kinRoot ?? svc.resolveRoots(base).kinRoot, id)
      try {
        const text = await fs.readFile(cp.handover, 'utf8')
        return { code: 200, text }
      } catch {
        return { code: 404, json: { ok: false, why: '这个孩子没有接生单（目录可能被搬走了）' } }
      }
    },
  }
}

/**
 * 注册路由。返回 dispose。
 *
 * 宿主没有 webServer 服务时**什么都不注册**（返回空 dispose），
 * 插件其余功能（工具、产房）照常——控制台没有不该导致整个插件不可用。
 */
export function registerKinRoutes(ctx, deps = {}) {
  const webServer = ctx?.get?.('webServer') ?? ctx?.webServer
  const api = makeApi({ ...deps, ctx })
  const disposeAll = []
  const guard = (fn) => async (req, res) => {
    try {
      await fn(req, res)
    } catch (err) {
      try { sendJson(res, 500, { ok: false, why: String(err?.message ?? err).slice(0, 300) }) } catch { /* 头已经发出去了 */ }
    }
  }

  const handler = guard(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname.replace(/\/+$/, '') || PREFIX
    const tail = path.slice(PREFIX.length) || '/'

    if (tail === '/' || tail === '') {
      const html = await page()
      return sendText(res, 200, html, 'text/html; charset=utf-8')
    }

    if (tail === '/api/state') return apply(res, await api.state())
    if (tail === '/api/preview') return apply(res, await api.preview())
    if (tail === '/api/lineage') return apply(res, await api.lineage())
    if (tail === '/api/approvals') return apply(res, await api.approvals())
    if (tail === '/api/fish-config' && req.method !== 'POST') return apply(res, await api.fishConfig())
    if (tail === '/api/permissions' && req.method !== 'POST') return apply(res, await api.permissions())
    if (tail === '/api/workspaces' && req.method !== 'POST') return apply(res, await api.workspaces())
    if (tail === '/api/workspace' && req.method !== 'POST') return apply(res, await api.workspace())

    if (tail.startsWith('/api/child/') && tail.endsWith('/handover')) {
      const childId = tail.slice('/api/child/'.length, -'/handover'.length)
      return apply(res, await api.handover({}, { childId }))
    }

    // 同一个路径两个语义：GET 读环境参数 / 看课表，POST 写。
    if (tail === '/api/config' && req.method !== 'POST') return apply(res, await api.config())
    if (tail === '/api/teach' && req.method !== 'POST') {
      return apply(res, await api.teach({}, { childId: url.searchParams.get('childId') || '' }))
    }

    const posts = {
      '/api/request': api.request,
      '/api/approve': api.approve,
      '/api/reject': api.reject,
      '/api/birth': api.birth,
      '/api/config': api.saveConfig,
      '/api/teach': api.teachNow,
      '/api/teach/spoken': api.spoken,
      '/api/approvals/decide': api.decideTool,
      '/api/permissions/forget': api.forgetTool,
      '/api/workspaces': api.saveWorkspaces,
      '/api/workspace': api.setWorkspace,
      '/api/fish-config': api.saveFishConfig,

    }
    const fn = posts[tail]
    if (fn) {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, why: '只接受 POST' })
      const body = await readBody(req)
      return apply(res, await fn(body))
    }

    return sendJson(res, 404, { ok: false, why: '没有这个接口' })
  })

  function apply(res, out) {
    if (!out) return sendJson(res, 500, { ok: false, why: '空响应' })
    if (typeof out.text === 'string' && !out.json) return sendText(res, out.code ?? 200, out.text)
    return sendJson(res, out.code ?? 200, out.json ?? { ok: false, why: '空响应' })
  }

  try {
    const d = webServer?.register?.({ kind: 'prefix', path: PREFIX, handler })
    if (typeof d === 'function') disposeAll.push(d)
    else if (d && typeof d.dispose === 'function') disposeAll.push(() => d.dispose())
  } catch (err) {
    console.warn('[dsh-fish-kin] 控制台路由没挂上', err?.message ?? err)
  }

  return () => {
    for (const d of disposeAll) { try { d() } catch { /* ignore */ } }
  }
}

export { PREFIX }
