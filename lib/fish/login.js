/**
 * fish/login.js —— B 站扫码登录（照 dsh-bili-scroll 的流程）
 *
 * 流程就三步（它的 `bili_login` / `bili_login_check` 也是这个）：
 *   1. 要一张二维码：`/x/passport-login/web/qrcode/generate` → `{url, qrcode_key}`
 *   2. 轮询：`/x/passport-login/web/qrcode/poll?qrcode_key=…`
 *        code 0     = 登录成功，成功后的 `data.url` **查询串里就带着 cookie**
 *        86101      = 还没扫
 *        86090      = 扫了，等确认
 *        86038      = 过期
 *   3. 把 cookie 写进 owner.json（0600），再用 nav 校验一次、顺手拿昵称
 *
 * 二维码图是我们自己画的（qr.js），不引第三方、也不把登录链接发给任何外部服务。
 */

import { writeOwner, readOwner } from './owner.js'
import { toDataUrl } from './qr.js'
import { createBiliClient } from './bili.js'

const API = 'https://passport.bilibili.com'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const STATUS = {
  0: 'done',
  86101: 'waiting',
  86090: 'scanned',
  86038: 'expired',
}

/** 从登录成功返回的 URL 查询串里抠出 cookie。 */
export function cookieFromUrl(url) {
  const q = String(url ?? '')
  const pick = (k) => {
    const m = new RegExp(`[?&]${k}=([^&]*)`).exec(q)
    return m ? decodeURIComponent(m[1]) : ''
  }
  const parts = []
  for (const k of ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5', 'sid']) {
    const v = pick(k)
    if (v) parts.push(`${k}=${v}`)
  }
  return parts.join('; ')
}

async function getJson(fetchImpl, url) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), 12_000)
  try {
    const r = await fetchImpl(url, {
      signal: ctl.signal,
      headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/', accept: 'application/json' },
    })
    return JSON.parse(await r.text())
  } finally {
    clearTimeout(t)
  }
}

/**
 * 生成一张二维码。
 * @returns {Promise<{ok:boolean, key:string, qr:string, url:string, why:string}>}
 */
export async function startLogin({ fetchImpl = globalThis.fetch } = {}) {
  try {
    const j = await getJson(fetchImpl, `${API}/x/passport-login/web/qrcode/generate`)
    const d = j?.data ?? {}
    if (j?.code !== 0 || !d.qrcode_key || !d.url) return { ok: false, key: '', qr: '', url: '', why: `拿不到二维码：${j?.message ?? j?.code ?? '未知'}` }
    return { ok: true, key: String(d.qrcode_key), url: String(d.url), qr: toDataUrl(d.url, { scale: 6 }), why: '' }
  } catch (err) {
    return { ok: false, key: '', qr: '', url: '', why: String(err?.message ?? err).slice(0, 160) }
  }
}

/**
 * 轮询一次。
 * @returns {Promise<{ok:boolean, status:'waiting'|'scanned'|'expired'|'done'|'error', name:string, why:string}>}
 */
export async function pollLogin(root, key, { fetchImpl = globalThis.fetch, log = () => {} } = {}) {
  try {
    const j = await getJson(fetchImpl, `${API}/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(key)}`)
    const status = STATUS[j?.code] ?? 'error'
    if (status !== 'done') {
      const why = j?.message || (status === 'expired' ? '二维码过期了，重新生成一张' : '')
      return { ok: status !== 'error', status, name: '', why: String(why ?? '') }
    }
    // 成功：cookie 在 data.url 的查询串里
    const cookie = cookieFromUrl(j?.data?.url ?? '')
    if (!cookie) return { ok: false, status: 'error', name: '', why: '登录成功但没拿到 cookie' }
    const saved = await writeOwner(root, { cookie })
    if (!saved.ok) return { ok: false, status: 'error', name: '', why: saved.why }
    // 顺手校验 + 拿昵称
    let name = ''
    let mid = ''
    try {
      const c = createBiliClient({ cookie, log, fetchImpl })
      const nav = await c.nav()
      if (nav.ok) { name = nav.data.name; mid = nav.data.mid }
      if (name || mid) await writeOwner(root, { cookie, name, mid })
    } catch { /* 校验失败不影响已存下的 cookie */ }
    return { ok: true, status: 'done', name, why: '' }
  } catch (err) {
    return { ok: false, status: 'error', name: '', why: String(err?.message ?? err).slice(0, 160) }
  }
}

/** 现在存着的登录凭据（打码摘要由 owner.js 给）。 */
export async function loginStatus(root) {
  const o = await readOwner(root)
  return { logged: Boolean(o?.cookie), name: o?.name ?? '', mid: o?.mid ?? '' }
}
