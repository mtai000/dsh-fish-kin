/**
 * login.test.mjs —— B 站扫码登录（照 dsh-bili-scroll 的三步）
 *
 * 1. generate → qrcode_key + url
 * 2. poll → waiting / scanned / expired / done
 * 3. done 时 **cookie 在 data.url 的查询串里**，解析出来存 owner.json（0600），再用 nav 补昵称
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { withTemp } from './_fixture.mjs'
import { cookieFromUrl, startLogin, pollLogin } from '../lib/fish/login.js'
import { readOwner, ownerFile } from '../lib/fish/owner.js'

const fake = (payload, { onUrl } = {}) => async (url) => {
  if (onUrl) onUrl(String(url))
  return { status: 200, text: async () => JSON.stringify(payload) }
}

test('cookie 解析：从登录成功后的 URL 查询串里抠', () => {
  const url = 'https://passport.biligame.com/crossDomain?DedeUserID=42&DedeUserID__ckMd5=abc&Expires=1&SESSDATA=xyz%2C123&bili_jct=tok&gourl=https%3A%2F%2Fwww.bilibili.com'
  const c = cookieFromUrl(url)
  assert.match(c, /SESSDATA=xyz,123/)
  assert.match(c, /bili_jct=tok/)
  assert.match(c, /DedeUserID=42/)
  assert.equal(cookieFromUrl(''), '')
  assert.equal(cookieFromUrl(null), '')
})

test('生成二维码：拿到 key 与可直接显示的数据 URL', async () => {
  const seen = []
  const r = await startLogin({
    fetchImpl: fake({ code: 0, data: { url: 'https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=K1', qrcode_key: 'K1' } }, { onUrl: (u) => seen.push(u) }),
  })
  assert.equal(r.ok, true, r.why)
  assert.equal(r.key, 'K1')
  assert.match(r.qr, /^data:image\/png;base64,/)
  assert.match(seen[0], /qrcode\/generate/)
})

test('生成失败：说清楚原因，不返回空图', async () => {
  const r = await startLogin({ fetchImpl: fake({ code: -1, message: '被挡了' }) })
  assert.equal(r.ok, false)
  assert.match(r.why, /被挡了/)
  assert.equal(r.qr, '')
})

test('轮询：还没扫 / 扫了待确认 / 过期', async () => {
  await withTemp(async (root) => {
    assert.equal((await pollLogin(root, 'K', { fetchImpl: fake({ code: 86101 }) })).status, 'waiting')
    assert.equal((await pollLogin(root, 'K', { fetchImpl: fake({ code: 86090 }) })).status, 'scanned')
    const exp = await pollLogin(root, 'K', { fetchImpl: fake({ code: 86038, message: '二维码已过期' }) })
    assert.equal(exp.status, 'expired')
    assert.equal(await readOwner(root), null, '没登成功不该写凭据')
  })
})

test('轮询成功：cookie 落盘 0600，昵称补上', async () => {
  await withTemp(async (root) => {
    const url = 'https://passport.biligame.com/crossDomain?DedeUserID=42&SESSDATA=sess%3D1&bili_jct=csrf'
    const done = await pollLogin(root, 'K', {
      fetchImpl: async (u) => {
        if (String(u).includes('/qrcode/poll')) {
          return { status: 200, text: async () => JSON.stringify({ code: 0, data: { url } }) }
        }
        // nav（用 cookie 校验）
        return { status: 200, text: async () => JSON.stringify({ code: 0, data: { isLogin: true, uname: '小鱼', mid: 42 } }) }
      },
    })
    assert.equal(done.status, 'done', done.why)
    assert.equal(done.name, '小鱼')
    const o = await readOwner(root)
    assert.match(o.cookie, /SESSDATA=sess=1/)
    assert.equal(o.name, '小鱼')
    assert.equal(o.mid, '42')
    if (process.platform !== 'win32') assert.equal((await stat(ownerFile(root))).mode & 0o777, 0o600)
  })
})

test('轮询成功但没 cookie：明确失败，不写空凭据', async () => {
  await withTemp(async (root) => {
    const r = await pollLogin(root, 'K', { fetchImpl: fake({ code: 0, data: { url: 'https://x/?nothing=1' } }) })
    assert.equal(r.ok, false)
    assert.match(r.why, /没拿到 cookie/)
    assert.equal(await readOwner(root), null)
    // 文件不该存在
    await assert.rejects(readFile(ownerFile(root)))
  })
})

test('网络炸了也不抛', async () => {
  const r = await pollLogin('/x', 'K', { fetchImpl: async () => { throw new Error('ECONNRESET') } })
  assert.equal(r.ok, false)
  assert.match(r.why, /ECONNRESET/)
})
