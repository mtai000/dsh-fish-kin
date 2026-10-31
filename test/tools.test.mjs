/**
 * tools.test.mjs —— 两个工具
 *
 * 守的是「她不能生孩子，只能开口」这条边界：
 *   fish_kin          主人用（status/preview/request/approve/reject/birth/lineage）
 *   fish_kin_ask_birth 她用的，只有一个动作，返回值里不许有任何数字
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { registerKinTools } from '../lib/tools.js'
import { withTemp, writeParent, sampleHistory } from './_fixture.mjs'

function fakeCtx() {
  const specs = []
  const closed = []
  return {
    specs,
    closed,
    tools: {
      register(spec) {
        specs.push(spec)
        return () => closed.push(spec.name)
      },
    },
  }
}

async function ctxFor(dir) {
  const ctx = fakeCtx()
  const offs = registerKinTools(ctx, { parentRoot: join(dir, 'parent'), kinRoot: join(dir, 'kin') })
  await writeParent(join(dir, 'parent'), sampleHistory())
  return { ctx, offs, dispose: () => offs.forEach((f) => f()) }
}

test('注册三个工具，dispose 能把它们摘掉', async () => {
  await withTemp(async (dir) => {
    const { ctx, dispose } = await ctxFor(dir)
    const names = ctx.specs.map((s) => s.name).sort()
    assert.deepEqual(names, ['fish_kin', 'fish_kin_ask_birth', 'fish_kin_tell_child'])
    dispose()
    assert.equal(ctx.closed.length, 3)
  })
})

test('参数是标准 JSON Schema（不是简写 DSL）', async () => {
  await withTemp(async (dir) => {
    const { ctx } = await ctxFor(dir)
    for (const spec of ctx.specs) {
      assert.equal(spec.parameters.type, 'object')
      assert.equal(typeof spec.parameters.properties, 'object')
      assert.ok(!('required' in (spec.parameters.properties.action ?? {})), '属性上不该留 required')
    }
    const kin = ctx.specs.find((s) => s.name === 'fish_kin')
    assert.deepEqual(kin.parameters.required, ['action'])
    assert.ok(kin.parameters.properties.action.enum.includes('birth'))
    assert.ok(kin.parameters.properties.action.enum.includes('teach'))
  })
})

test('status：说清她在哪、多少条、能不能生', async () => {
  await withTemp(async (dir) => {
    const { ctx } = await ctxFor(dir)
    const kin = ctx.specs.find((s) => s.name === 'fish_kin')
    const out = await kin.execute({ action: 'status' })
    assert.equal(out.ok, true)
    assert.match(out.text, /她住在/)
    assert.match(out.text, /条记忆/)
    assert.match(out.text, /记忆压力/)
  })
})

test('preview：把遗传包整份给出来', async () => {
  await withTemp(async (dir) => {
    const { ctx } = await ctxFor(dir)
    const kin = ctx.specs.find((s) => s.name === 'fish_kin')
    const out = await kin.execute({ action: 'preview' })
    assert.equal(out.ok, true)
    assert.match(out.text, /遗传包/)
    assert.match(out.text, /她认定过的事|她拒绝过的事/)
  })
})

test('birth 没有 confirm 就不生', async () => {
  await withTemp(async (dir) => {
    const { ctx } = await ctxFor(dir)
    const kin = ctx.specs.find((s) => s.name === 'fish_kin')
    const out = await kin.execute({ action: 'birth' })
    assert.equal(out.ok, false)
    assert.match(out.text, /confirm/)
    // 没生成任何东西
    const st = await kin.execute({ action: 'lineage' })
    assert.match(st.text, /空/)
  })
})

test('request → approve 走通，approve 也要 confirm', async () => {
  await withTemp(async (dir) => {
    const { ctx } = await ctxFor(dir)
    const kin = ctx.specs.find((s) => s.name === 'fish_kin')
    const made = await kin.execute({ action: 'request' })
    assert.equal(made.ok, true)
    const id = (made.text.match(/req_[0-9A-Z]{26}/) || [])[0]
    assert.ok(id)

    const noConfirm = await kin.execute({ action: 'approve', id })
    assert.equal(noConfirm.ok, false)

    const born = await kin.execute({ action: 'approve', id, confirm: 'approve' })
    assert.equal(born.ok, true, born.text)
    assert.match(born.text, /生了/)
  })
})

test('不认识的动作给一句人话，不抛', async () => {
  await withTemp(async (dir) => {
    const { ctx } = await ctxFor(dir)
    const kin = ctx.specs.find((s) => s.name === 'fish_kin')
    const out = await kin.execute({ action: '乱写' })
    assert.equal(out.ok, false)
    assert.match(out.text, /不认识的 action/)
  })
})

test('她那把工具：只说"说了"，不泄露任何数字', async () => {
  await withTemp(async (dir) => {
    const { ctx } = await ctxFor(dir)
    const her = ctx.specs.find((s) => s.name === 'fish_kin_ask_birth')
    const out = await her.execute({})
    assert.equal(out.ok, true)
    assert.doesNotMatch(out.text, /[0-9]/, `不该出现数字：${out.text}`)
    assert.ok(out.text.length > 2)
  })
})

test('她那把工具立的是 her 来源的单子（主人仍要批）', async () => {
  await withTemp(async (dir) => {
    const { ctx } = await ctxFor(dir)
    const her = ctx.specs.find((s) => s.name === 'fish_kin_ask_birth')
    await her.execute({})
    const kin = ctx.specs.find((s) => s.name === 'fish_kin')
    const st = await kin.execute({ action: 'status' })
    assert.match(st.text, /她自己开口要的/)
  })
})

test('没有 tools 服务的宿主：返回空数组，不抛', () => {
  assert.deepEqual(registerKinTools({}, {}), [])
  assert.deepEqual(registerKinTools(null, {}), [])
})

test('teach 动作：没孩子时说清没教成，有孩子时教得下去', async () => {
  await withTemp(async (dir) => {
    const { ctx } = await ctxFor(dir)
    const kin = ctx.specs.find((s) => s.name === 'fish_kin')

    const none = await kin.execute({ action: 'teach', text: '沉默也会伤人' })
    assert.equal(none.ok, false)
    assert.match(none.text, /没教成/)

    const born = await kin.execute({ action: 'birth', confirm: 'birth' })
    assert.equal(born.ok, true, born.text)

    const taught = await kin.execute({ action: 'teach', text: '沉默也会伤人' })
    assert.equal(taught.ok, true, taught.text)
    assert.match(taught.text, /教了 1 课/)
    assert.match(taught.text, /沉默也会伤人/)
  })
})

test('她那把「跟孩子说一句」：没孩子/有孩子都给一句人话，且不带数字', async () => {
  await withTemp(async (dir) => {
    const { ctx } = await ctxFor(dir)
    const her = ctx.specs.find((s) => s.name === 'fish_kin_tell_child')
    const kin = ctx.specs.find((s) => s.name === 'fish_kin')

    const none = await her.execute({ text: '沉默也会伤人' })
    assert.equal(none.ok, true)
    assert.match(none.text, /还没有孩子/)
    assert.doesNotMatch(none.text, /[0-9]/)

    await kin.execute({ action: 'birth', confirm: 'birth' })
    const said = await her.execute({ text: '沉默也会伤人' })
    assert.equal(said.ok, true)
    assert.doesNotMatch(said.text, /[0-9]/)
    assert.match(said.text, /留下了/)

    // 账本上这条是"她自己要教的"
    const v = await new Promise(async (resolve) => {
      const { teachView } = await import('../lib/service.js')
      resolve(await teachView({ parentRoot: join(dir, 'parent'), kinRoot: join(dir, 'kin') }))
    })
    assert.equal(v.total, 1)
    assert.equal(v.lessons[0].by, 'her')
  })
})

test('她要在 B 站做事：列单子 → 批准 → 才执行', async () => {
  const { createApproval } = await import('../lib/fish/approvals.js')
  await withTemp(async (dir) => {
    const parentRoot = join(dir, 'parent')
    const kinRoot = join(dir, 'kin')
    let prompted = ''
    const prompts = []
    const specs = []
    const ctx = {
      tools: { register: (s) => { specs.push(s); return () => {} } },
      get: (k) => (k === 'sessionController' ? {
        async list() { return [{ sessionId: 's1' }] },
        async create() { return { sessionId: 's1' } },
        async rename() {},
        async prompt(req) { prompted = req.content[0].text; prompts.push(prompted) },
      } : null),
    }
    registerKinTools(ctx, { parentRoot, kinRoot })
    const kin = specs.find((s) => s.name === 'fish_kin')

    const made = await createApproval(parentRoot, { kind: 'bili-scroll', title: '想刷一会儿', payload: {} })
    const list = await kin.execute({ action: 'approvals' })
    assert.equal(list.ok, true)
    assert.match(list.text, /等你点头/)
    assert.ok(list.text.includes(made.approval.id))

    const ap = await kin.execute({ action: 'approve', id: made.approval.id })
    assert.equal(ap.ok, true, ap.text)
    assert.match(prompts.join(''), /点头/)

    // 批准过的单子消失了
    const after = await kin.execute({ action: 'approvals' })
    assert.match(after.text, /没有等你点头的事|过期/)
  })
})

test('她自己不能批自己的单子（工具面里没有 fish_kin）', async () => {
  const { HER_TOOLS } = await import('../lib/fish/restrict.js')
  assert.equal(HER_TOOLS.includes('fish_kin'), false)
})
