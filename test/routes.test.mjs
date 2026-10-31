/**
 * routes.test.mjs —— 网页控制台的后端
 *
 * 用假的 webServer / req / res 跑，不需要起 HTTP，也不需要宿主。
 * 守的是「每个接口的失败都是显式的」：缺参数 400、没有这个接口 404、
 * 生孩子没 confirm 400——不做静默失败。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { registerKinRoutes, makeApi, PREFIX } from '../lib/routes.js'
import { withTemp, writeParent, sampleHistory } from './_fixture.mjs'

function fakeRes() {
  return {
    code: 0,
    headers: {},
    body: '',
    writeHead(code, headers) { this.code = code; Object.assign(this.headers, headers ?? {}) },
    end(b) { this.body += b == null ? '' : String(b) },
  }
}

function fakeReq(method, url, body) {
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body), 'utf8')
    },
  }
}

async function harness(dir) {
  await writeParent(join(dir, 'parent'), sampleHistory())
  const registered = []
  const ctx = {
    get: () => ({ register: (ex) => { registered.push(ex); return () => { registered[0].disposed = true } } }),
  }
  const dispose = registerKinRoutes(ctx, { parentRoot: join(dir, 'parent'), kinRoot: join(dir, 'kin') })
  const handler = registered[0].handler
  const call = async (method, path, body) => {
    const res = fakeRes()
    await handler(fakeReq(method, PREFIX + path, body), res)
    return res
  }
  return { registered, handler, call, dispose, ctx }
}

test('注册一条前缀路由，dispose 能摘掉', async () => {
  await withTemp(async (dir) => {
    const h = await harness(dir)
    assert.equal(h.registered.length, 1)
    assert.equal(h.registered[0].kind, 'prefix')
    assert.equal(h.registered[0].path, PREFIX)
    h.dispose()
    assert.equal(h.registered[0].disposed, true)
  })
})

test('GET / 给控制台页面', async () => {
  await withTemp(async (dir) => {
    const h = await harness(dir)
    const res = await h.call('GET', '/')
    assert.equal(res.code, 200)
    assert.match(res.headers['content-type'], /text\/html/)
    assert.match(res.body, /大肥鱼/)
    assert.match(res.body, /记忆压力/)
  })
})

test('GET /api/state 返回 JSON', async () => {
  await withTemp(async (dir) => {
    const h = await harness(dir)
    const res = await h.call('GET', '/api/state')
    assert.equal(res.code, 200)
    const body = JSON.parse(res.body)
    assert.equal(body.ok, true)
    assert.equal(body.parent.count, sampleHistory().length)
    assert.ok(body.pressure.level)
  })
})

test('GET /api/preview 与 /api/lineage', async () => {
  await withTemp(async (dir) => {
    const h = await harness(dir)
    const p = JSON.parse((await h.call('GET', '/api/preview')).body)
    assert.equal(p.ok, true)
    assert.ok(p.pack.body.length > 0)
    const v = JSON.parse((await h.call('GET', '/api/lineage')).body)
    assert.equal(v.ok, true)
    assert.equal(v.total, 0)
    assert.equal(v.raw, undefined) // 指纹不外发
  })
})

test('POST /api/birth 没有 confirm 是 400', async () => {
  await withTemp(async (dir) => {
    const h = await harness(dir)
    const res = await h.call('POST', '/api/birth', {})
    assert.equal(res.code, 400)
    assert.match(JSON.parse(res.body).why, /confirm/)
  })
})

test('POST /api/request → state 里出现待批 → approve 生下来', async () => {
  await withTemp(async (dir) => {
    const h = await harness(dir)
    const made = JSON.parse((await h.call('POST', '/api/request', { label: '小鱼' })).body)
    assert.equal(made.ok, true)
    const s = JSON.parse((await h.call('GET', '/api/state')).body)
    assert.equal(s.pending.length, 1)

    const born = JSON.parse((await h.call('POST', '/api/approve', { id: s.pending[0].id })).body)
    assert.equal(born.ok, true, born.why)
    assert.match(born.dir, /children/)

    const after = JSON.parse((await h.call('GET', '/api/state')).body)
    assert.equal(after.pending.length, 0)
    assert.equal(after.kin.children, 1)
  })
})

test('POST /api/reject 需要合法 id', async () => {
  await withTemp(async (dir) => {
    const h = await harness(dir)
    assert.equal((await h.call('POST', '/api/reject', { id: '乱写' })).code, 400)
    const made = JSON.parse((await h.call('POST', '/api/request', {})).body)
    const s = JSON.parse((await h.call('GET', '/api/state')).body)
    const r = await h.call('POST', '/api/reject', { id: s.pending[0].id, why: '再等等' })
    assert.equal(r.code, 200)
    assert.equal(JSON.parse(r.body).ok, true)
    assert.ok(made.ok)
  })
})

test('接生单接口：合法的孩子拿得到纯文本，乱写 id 是 400', async () => {
  await withTemp(async (dir) => {
    const h = await harness(dir)
    assert.equal((await h.call('GET', '/api/child/乱写/handover')).code, 400)
    const born = JSON.parse((await h.call('POST', '/api/birth', { confirm: 'birth' })).body)
    assert.equal(born.ok, true, born.why)
    const id = born.childId
    const res = await h.call('GET', `/api/child/${id}/handover`)
    assert.equal(res.code, 200)
    assert.match(res.body, /## 你是谁/)
  })
})

test('未知接口 404，GET 打 POST 接口 405', async () => {
  await withTemp(async (dir) => {
    const h = await harness(dir)
    assert.equal((await h.call('GET', '/api/nope')).code, 404)
    assert.equal((await h.call('GET', '/api/birth')).code, 405)
  })
})

test('没有 webServer 的宿主：不注册也不抛', () => {
  const off = registerKinRoutes({}, {})
  assert.equal(typeof off, 'function')
  off()
})

test('makeApi 单独可用（不起 HTTP 也能测）', async () => {
  await withTemp(async (dir) => {
    const api = makeApi({ parentRoot: join(dir, 'parent'), kinRoot: join(dir, 'kin') })
    const out = await api.state()
    assert.equal(out.code, 200)
    assert.equal(out.json.ok, true)
  })
})

test('GET /api/config 读得到，POST /api/config 存得下', async () => {
  await withTemp(async (dir) => {
    const h = await harness(dir)
    const cfg = JSON.parse((await h.call('GET', '/api/config')).body)
    assert.equal(cfg.ok, true)
    assert.equal(cfg.config.pressure.events, 1200)

    const saved = JSON.parse((await h.call('POST', '/api/config', { pressure: { events: 42 } })).body)
    assert.equal(saved.ok, true)
    assert.equal(saved.config.pressure.events, 42)

    const after = JSON.parse((await h.call('GET', '/api/config')).body)
    assert.equal(after.config.pressure.events, 42)

    // 白名单外的东西写不进去
    const bad = await h.call('POST', '/api/config', { persona: { mood: '温柔' } })
    assert.equal(bad.code, 400)
  })
})

test('教学接口：GET 看课表，POST 教一句', async () => {
  await withTemp(async (dir) => {
    const h = await harness(dir)
    const born = JSON.parse((await h.call('POST', '/api/birth', { confirm: 'birth' })).body)
    assert.equal(born.ok, true, born.why)

    const empty = JSON.parse((await h.call('GET', '/api/teach?childId=' + born.childId)).body)
    assert.equal(empty.ok, true)
    assert.equal(empty.view.total, 0)

    const taught = JSON.parse((await h.call('POST', '/api/teach', { childId: born.childId, text: '沉默也会伤人' })).body)
    assert.equal(taught.ok, true, taught.why)

    const after = JSON.parse((await h.call('GET', '/api/teach?childId=' + born.childId)).body)
    assert.equal(after.view.total, 1)
    assert.match(after.view.lessons[0].core, /沉默也会伤人/)
    assert.equal(after.view.lessons[0].learned, false)

    // 太长的一句：400
    const tooLong = await h.call('POST', '/api/teach', { childId: born.childId, text: '字'.repeat(200) })
    assert.equal(tooLong.code, 400)
  })
})

test('让她亲口说一句：POST /api/teach/spoken 走通（假的 sessionController）', async () => {
  await withTemp(async (dir) => {
    await writeParent(join(dir, 'parent'), sampleHistory())
    await import('node:fs/promises').then((fs) =>
      fs.writeFile(join(dir, 'parent', 'home.json'), JSON.stringify({ sessionId: 'sess-9' }), 'utf8'))

    let prompted = 0
    const sc = {
      async prompt(req) {
        prompted++
        const row = {
          id: 'ev_' + '5'.padStart(26, '0'), v: 1, ts: new Date().toISOString(), day: 90, stage: 4,
          type: 'utterance', source: 'tool', text: '我希望你别学我沉默', refs: [], verdict: null, confidence: 0.5, flags: [],
        }
        setTimeout(() => {
          import('node:fs/promises').then((fs) =>
            fs.appendFile(join(dir, 'parent', 'events.jsonl'), JSON.stringify(row) + '\n', 'utf8')).catch(() => {})
        }, 10)
      },
    }
    const ctx = {
      get: (k) => (k === 'sessionController' ? sc : null),
    }
    const api = makeApi({ parentRoot: join(dir, 'parent'), kinRoot: join(dir, 'kin'), ctx })
    const born = (await api.birth({ confirm: 'birth' })).json
    assert.equal(born.ok, true, born.why)

    const r = await api.spoken({ childId: born.childId, timeoutMs: 600 })
    assert.equal(r.code, 200, JSON.stringify(r.json))
    assert.equal(r.json.ok, true, r.json.why)
    assert.equal(r.json.spoken, '我希望你别学我沉默')
    assert.equal(prompted, 1)
  })
})

test('她自己的环境参数：GET 读、POST 写（设置页用）', async () => {
  await withTemp(async (dir) => {
    const h = await harness(dir)
    const got = JSON.parse((await h.call('GET', '/api/fish-config')).body)
    assert.equal(got.ok, true)
    assert.equal(got.config.bili.scrollPerDay, 1)

    const saved = JSON.parse((await h.call('POST', '/api/fish-config', {
      patch: { bili: { scrollPerDay: 3, interests: ['人工智能'] } },
    })).body)
    assert.equal(saved.ok, true)
    assert.equal(saved.config.bili.scrollPerDay, 3)
    assert.deepEqual(saved.config.bili.interests, ['人工智能'])

    const again = JSON.parse((await h.call('GET', '/api/fish-config')).body)
    assert.equal(again.config.bili.scrollPerDay, 3)
  })
})

test('待批准：GET 列表；批 id 不对时 400', async () => {
  await withTemp(async (dir) => {
    const h = await harness(dir)
    const list = JSON.parse((await h.call('GET', '/api/approvals')).body)
    assert.equal(list.ok, true)
    assert.deepEqual(list.pending, [])

    const bad = await h.call('POST', '/api/approvals/approve', { id: 'xx' })
    assert.equal(bad.code, 400)
  })
})

test('登录状态：没登录时 logged=false，cookie 不外泄', async () => {
  await withTemp(async (dir) => {
    const h = await harness(dir)
    const r = JSON.parse((await h.call('GET', '/api/owner')).body)
    assert.equal(r.ok, true)
    assert.equal(r.logged, false)
    assert.equal(r.cookie, '')
  })
})

test('叫醒她：fish 不在时明确 503，不假装成功', async () => {
  await withTemp(async (dir) => {
    const h = await harness(dir)
    const r = await h.call('POST', '/api/fish/wake', {})
    assert.equal(r.code, 503)
    assert.match(JSON.parse(r.body).why, /她现在不在/)
  })
})

test('报告接口：今天什么都没做也有一句人话', async () => {
  await withTemp(async (dir) => {
    const h = await harness(dir)
    const r = JSON.parse((await h.call('GET', '/api/fish/report')).body)
    assert.equal(r.ok, true)
    assert.match(r.text, /她今天在 B 站/)
    assert.match(r.text, /今天还什么都没做|看过画面/)
  })
})

test('谷时状态接口：给出北京时间与是否谷时', async () => {
  await withTemp(async (dir) => {
    const h = await harness(dir)
    const r = JSON.parse((await h.call('GET', '/api/fish/offpeak')).body)
    assert.equal(r.ok, true)
    assert.match(r.text, /北京时间/)
    assert.equal(typeof r.off, 'boolean')
    assert.equal(r.mode, 'propose')
  })
})

test('感知源接口：列出 / 接上 / 停用 / 断开', async () => {
  await withTemp(async (dir) => {
    const h = await harness(dir)
    const empty = JSON.parse((await h.call('GET', '/api/sources')).body)
    assert.equal(empty.ok, true)
    assert.deepEqual(empty.sources, [])

    const linked = JSON.parse((await h.call('POST', '/api/sources', {
      id: 'cdda', title: '去游戏里走走', read: 'observe_game', act: 'move', budget: 1,
    })).body)
    assert.equal(linked.ok, true, linked.why)

    const listed = JSON.parse((await h.call('GET', '/api/sources')).body)
    assert.equal(listed.sources.length, 1)
    assert.equal(listed.sources[0].id, 'cdda')
    assert.equal(listed.sources[0].adapter, 'external')

    await h.call('POST', '/api/sources/toggle', { id: 'cdda', enabled: false })
    const off = JSON.parse((await h.call('GET', '/api/sources')).body)
    assert.equal(off.sources[0].enabled, false)

    await h.call('POST', '/api/sources/remove', { id: 'cdda' })
    const gone = JSON.parse((await h.call('GET', '/api/sources')).body)
    assert.equal(gone.sources.length, 0)
  })
})
