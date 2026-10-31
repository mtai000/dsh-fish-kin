/**
 * bili.test.mjs —— B 站写与搜索（凭据、签名、风控）
 *
 * 这一层守的是"能说话，但别把账号说没了"：
 *   1. 凭据单独存、0600、日志里只有打码版
 *   2. 搜索必须带 wbi 签名（w_rid），没有密钥就明确失败
 *   3. 发评论：没登录 / 没 csrf / 风控中 一律不发
 *   4. 写被风控之后进写冷却，且不影响读
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stat, readFile } from 'node:fs/promises'
import { withTemp } from './_fixture.mjs'

const load = (f) => import(`../lib/fish/${f}`)

test('凭据：写进去是 0600，读回来还是那串，摘要里打码', async () => {
  const { writeOwner, readOwner, ownerSummary, ownerFile } = await load('owner.js')
  await withTemp(async (root) => {
    const cookie = 'SESSDATA=abcdef123456; bili_jct=deadbeef; DedeUserID=42'
    const w = await writeOwner(root, { cookie, name: '小鱼', mid: '42' })
    assert.equal(w.ok, true, w.why)

    const o = await readOwner(root)
    assert.equal(o.cookie, cookie)
    assert.equal(o.name, '小鱼')

    const s = ownerSummary(o)
    assert.equal(s.logged, true)
    assert.equal(s.cookie.includes('abcdef123456'), false, '摘要里不该有原文')
    assert.match(s.cookie, /\*\*\*/)

    const st = await stat(ownerFile(root))
    if (process.platform === 'win32') {
      assert.ok(st.isFile(), 'Windows 上 chmod 是空操作，至少文件要在')
    } else {
      assert.equal(st.mode & 0o777, 0o600, '权限必须是 0600')
    }
  })
})

test('凭据：不像 cookie 的串直接拒收', async () => {
  const { writeOwner, readOwner } = await load('owner.js')
  await withTemp(async (root) => {
    assert.equal((await writeOwner(root, { cookie: '随便一句' })).ok, false)
    assert.equal((await writeOwner(root, { cookie: '' })).ok, false)
    assert.equal(await readOwner(root), null)
  })
})

test('签名：参数排序 + md5，结果稳定且带 w_rid', async () => {
  const { signQuery, mixinKey } = await load('bili.js')
  const mk = mixinKey('7cd084941338484aae1ad9425b84077c', '4932caff0ff746eab6f01bf08b70ac45')
  assert.equal(mk.length, 32)
  const q1 = signQuery({ b: 2, a: 1 }, mk, 1700000000)
  const q2 = signQuery({ a: 1, b: 2 }, mk, 1700000000)
  assert.equal(q1, q2, '参数顺序不该影响签名')
  assert.match(q1, /^a=1&b=2&wts=1700000000&w_rid=[0-9a-f]{32}$/)
})

test('搜索：带 w_rid 发出去；拿不到密钥就明确失败', async () => {
  const { createBiliClient } = await load('bili.js')
  const urls = []
  const fetchImpl = async (url) => {
    urls.push(String(url))
    if (String(url).includes('/x/web-interface/nav')) {
      const payload = { code: 0, data: { isLogin: false, wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png' } } }
      return { status: 200, json: async () => payload, text: async () => JSON.stringify(payload) }
    }
    if (String(url).includes('finger/spi')) return { status: 200, json: async () => ({ data: { b_3: 'b3' } }), text: async () => '{}' }
    if (String(url).includes('/search/type')) {
      return { status: 200, json: async () => ({}), text: async () => JSON.stringify({ code: 0, data: { result: [{ bvid: 'BV1aa', title: '<em class="keyword">猫</em>和窗台', owner: { name: 'UP' }, stat: { view: 3 } }] } }) }
    }
    return { status: 200, json: async () => ({}), text: async () => JSON.stringify({ code: 0, data: {} }) }
  }
  const c = createBiliClient({ fetchImpl, minIntervalMs: 0, jitterMs: 0 })
  const r = await c.search('猫')
  assert.equal(r.ok, true)
  assert.equal(r.data[0].title, '猫和窗台', '标题里的高亮标签要去掉')
  const searchUrl = urls.find((u) => u.includes('/search/type'))
  assert.match(searchUrl, /w_rid=[0-9a-f]{32}/)
  assert.match(searchUrl, /wts=\d+/)
})

test('发评论：没登录 / 没 csrf 都不发', async () => {
  const { createBiliClient } = await load('bili.js')
  const anonymous = createBiliClient({ fetchImpl: async () => { throw new Error('不该发请求') }, minIntervalMs: 0, jitterMs: 0 })
  const r1 = await anonymous.replyAdd(123, '说一句话')
  assert.equal(r1.ok, false)
  assert.equal(r1.code, 'NOT_LOGIN')

  const noCsrf = createBiliClient({ cookie: 'SESSDATA=abc', fetchImpl: async () => { throw new Error('不该发请求') }, minIntervalMs: 0, jitterMs: 0 })
  const r2 = await noCsrf.replyAdd(123, '说一句话')
  assert.equal(r2.ok, false)
  assert.equal(r2.code, 'NO_CSRF')
})

test('发评论：成功一次；被风控后进写冷却，读不受影响', async () => {
  const { createBiliClient } = await load('bili.js')
  let mode = 'ok'
  const bodies = []
  const fetchImpl = async (url, opts) => {
    if (String(url).includes('/x/v2/reply/add')) {
      bodies.push(String(opts?.body ?? ''))
      if (mode === 'risk') return { status: 200, json: async () => ({}), text: async () => JSON.stringify({ code: -412, message: '被拦截' }) }
      return { status: 200, json: async () => ({}), text: async () => JSON.stringify({ code: 0, data: { rpid: 999 } }) }
    }
    return { status: 200, json: async () => ({}), text: async () => JSON.stringify({ code: 0, data: { list: [] } }) }
  }
  const c = createBiliClient({ cookie: 'SESSDATA=abc; bili_jct=tok123', fetchImpl, minIntervalMs: 0, jitterMs: 0 })
  const ok = await c.replyAdd(42, '一句真话')
  assert.equal(ok.ok, true)
  assert.equal(ok.data.rpid, 999)
  assert.match(bodies[0], /csrf=tok123/)

  mode = 'risk'
  const risked = await c.replyAdd(42, '再来一句')
  assert.equal(risked.ok, false)
  assert.equal(risked.code, -412)

  const blocked = await c.replyAdd(42, '第三句')
  assert.equal(blocked.ok, false)
  assert.equal(blocked.code, 'COOLDOWN')

  // 读不受写冷却影响
  assert.equal(c.cooling('read'), false)
  assert.equal(c.cooling('write'), true)
})

test('发评论：太长直接拒，不发请求', async () => {
  const { createBiliClient } = await load('bili.js')
  const c = createBiliClient({ cookie: 'SESSDATA=abc; bili_jct=tok', fetchImpl: async () => { throw new Error('不该发') }, minIntervalMs: 0, jitterMs: 0 })
  const r = await c.replyAdd(1, '字'.repeat(1001))
  assert.equal(r.ok, false)
  assert.equal(r.code, 'TOO_LONG')
})

test('她的工具：comment 只立单，不当场发（要等主人点头）', async () => {
  const { registerBiliTool } = await load('index.js')
  await withTemp(async (root) => {
    const specs = []
    const ctx = { tools: { register: (s) => { specs.push(s); return () => {} } } }
    registerBiliTool(ctx, { root, log: () => {} })
    const tool = specs[0]
    const r = await tool.execute({ action: 'comment', bvid: 'BV1xx411c7mD', text: '一句' })
    assert.equal(r.ok, true, r.text)
    assert.match(r.text, /等他点头/)

    // 单子真的立了，而且没有联网、没有落任何 bili-said
    const { listApprovals } = await import('../lib/fish/approvals.js')
    const { pending } = await listApprovals(root)
    assert.equal(pending.length, 1)
    assert.equal(pending[0].kind, 'bili-comment')
    assert.equal(pending[0].payload.text, '一句')
  })
})

test('她的工具：参数里有 search 和 comment', async () => {
  const { registerBiliTool } = await load('index.js')
  await withTemp(async (root) => {
    const specs = []
    const ctx = { tools: { register: (s) => { specs.push(s); return () => {} } } }
    registerBiliTool(ctx, { root, log: () => {} })
    const en = specs[0].parameters.properties.action.enum
    assert.deepEqual([...en].sort(), ['comment', 'dm', 'look', 'popular', 'reply', 'scroll', 'search', 'watch'])
  })
})

test('弹幕：解析 XML、实体还原、按时间铺开采样', async () => {
  const { parseDanmaku, sampleDanmaku } = await load('bili.js')
  const xml = [
    '<i><d p="1.2,1,25,16777215,0,0,0,0">来了</d>',
    '<d p="5.0,1,25,16777215,0,0,0,0">这段 &amp; 真好</d>',
    '<d p="9.9,1,25,16777215,0,0,0,0">' + '太'.repeat(60) + '</d>',
    '<d p="20.0,1,25,16777215,0,0,0,0">最后一句话</d></i>',
  ].join('')
  const list = parseDanmaku(xml)
  assert.equal(list.length, 4)
  assert.equal(list[1].text, '这段 & 真好')
  assert.equal(list[0].t, 1.2)

  // 长到 60 字的会被采样过滤掉
  const picked = sampleDanmaku(list, 3)
  assert.equal(picked.length, 3)
  assert.ok(picked.every((x) => x.text.length <= 40))
  assert.equal(picked[0].text, '来了')
  assert.equal(picked[picked.length - 1].text, '最后一句话')
})

test('弹幕：没有 cid 就明确说，不发请求', async () => {
  const { createBiliClient } = await load('bili.js')
  const c = createBiliClient({ fetchImpl: async () => { throw new Error('不该发请求') }, minIntervalMs: 0, jitterMs: 0 })
  const r = await c.danmaku(0)
  assert.equal(r.ok, false)
  assert.equal(r.code, 'NO_CID')
})
