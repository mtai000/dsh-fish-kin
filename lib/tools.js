/**
 * tools.js —— 两个工具
 *
 *   fish_kin           给主人用：看状态、看遗传包、立单、批单、生、看族谱
 *   fish_kin_ask_birth 给她用：只能「开口要」，不能生
 *
 * 为什么她要单独一个工具，而不是让主人那个工具多一个「她自己调用」的分支：
 * dsh-fish 把她的工具面收窄到 `HER_TOOLS` + `config.tools.allow` 白名单。
 * 想让她的工具面里多一个「要孩子」的口子，唯一干净的做法是**另一个工具名**，
 * 她把名字填进白名单就会看见；不填，她连这东西存在都不知道。
 *
 * 她的那个工具返回值里**没有任何数字**（条数、字数、比例都不给）。
 * 理由和 dsh-fish 的 growth_commit 一样：工具一旦回显自己的状态，
 * 「不能读自己的参数」这条就当场失效了。
 */

import { defineTool } from './tool.js'
import { toJsonSchema } from './toolschema.js'
import * as svc from './service.js'
import { listApprovals, decideApproval, consumeApproval } from './fish/approvals.js'
import { executeApproval } from './fish/execute.js'

const text = (t) => [{ type: 'text', text: String(t ?? '') }]

/** 把 snapshot 说成人话（给人看，不是给她看）。 */
function statusText(s) {
  const p = s.parent
  if (!p.exists) {
    return `没找到她的存档：${p.root}\n（如果她装在别的地方，给插件配一个 parentRoot，或设 DSH_FISH_HOME。）`
  }
  const pr = s.pressure
  const lines = [
    `她住在：${p.root}`,
    `已经活了 ${p.spanDays} 天，攒了 ${p.count} 条记忆（${p.chars} 字）` +
      (p.skipped ? `，跳过 ${p.skipped} 行坏数据` : ''),
    p.name ? `她管你叫「${p.name}」。` : '她还没想好怎么称呼你。',
    '',
    `记忆压力：${pr.level}（${Math.round(pr.pressure * 100)}%）`,
    ...pr.reasons.map((r) => `  · ${r}`),
    ...(pr.context ? [`  · ${pr.context}`] : []),
    '',
    pr.eligible
      ? '现在可以生一个孩子：把重要的那一份带走。生孩子这件事需要你点头，她自己是生不了的。'
      : pr.blockedBy === 'pending-request'
        ? '已经有张待批的单子，先批或驳掉。'
        : pr.blockedBy === 'too-soon'
          ? `刚生过一个，等她再攒 ${s.config.auto.cooldownEvents} 条新的再说。`
          : '还不用急。',
    '',
    `族谱：她这一代是第 ${s.kin.generation} 代，之前生过 ${s.kin.children} 个孩子，族谱里一共 ${s.kin.total} 条。`,
  ]
  if (s.pending.length) {
    lines.push('', `待批准：${s.pending.length} 张单子`)
    for (const r of s.pending) {
      lines.push(`  · ${r.id}｜${r.trigger === 'her' ? '她自己开口要的' : '压力到了提的'}｜${r.items} 条 / ${r.chars} 字｜到 ${r.expiresAt} 过期`)
    }
  }
  return lines.filter((l) => l !== null).join('\n')
}

function previewText(p) {
  return [
    `母代：${p.parent.count} 条记忆 / ${p.parent.chars} 字 / ${p.parent.spanDays} 天`,
    `候选 ${p.coverage.candidates} 条，进包 ${p.coverage.picked} 条，其余 ${p.coverage.dropped} 条留下（不进包不等于被删，原文还在她的事件流里）。`,
    p.kin.ok ? '族谱检查：没有和已有的孩子撞底子。' : `族谱检查：${p.kin.why}`,
    '',
    '===== 遗传包 =====',
    p.pack.body,
    '=================',
    '',
    `共 ${p.pack.chars} 字（上限 ${p.pack.limit}）`,
  ].join('\n')
}

function lineageText(v) {
  if (!v.lines.length) return '族谱还是空的。她还没有生过孩子。'
  const lines = [`族谱放在：${v.root}`, `一共 ${v.total} 条出生记录，母代是第 ${v.generation} 代。`, '']
  for (const l of v.lines) {
    lines.push(
      `第 ${l.generation} 代｜${l.childName || l.childId}｜${l.at}｜${l.trigger === 'her' ? '她要的' : l.trigger === 'auto' ? '压力到了' : '主人要的'}｜带走 ${l.packChars} 字｜同母 ${l.siblings} 个`,
    )
    lines.push(`    ${l.parentDir || '(原始母代)'} → ${l.childId}`)
  }
  return lines.join('\n')
}

/**
 * 注册工具。返回一个数组，里面是 dispose 函数（宿主停用插件时调）。
 */
export function registerKinTools(ctx, deps = {}) {
  if (!ctx?.tools?.register) return []
  const offs = []

  const reg = (spec) => {
    try {
      const r = ctx.tools.register(spec)
      if (typeof r === 'function') offs.push(r)
      else if (r && typeof r.dispose === 'function') offs.push(() => r.dispose())
    } catch (err) {
      console.warn('[dsh-fish-kin] 工具没挂上', spec?.name, err?.message ?? err)
    }
  }

  reg(defineTool({
    name: 'fish_kin',
    description:
      '大肥鱼子代传承。她记忆太多的时候，可以生一个孩子，把最重要的那部分带走。' +
      'status=看她的记忆压力和族谱；preview=看这一次会带走什么（不落盘）；' +
      'request=立一张待批准的单子；approve/reject=批或驳某张单子；' +
      'birth=你直接要一个（要带 confirm:"birth"）；lineage=看族谱；' +
      'teach=教孩子一课（不带 text 就按"她出生之后新长出来的"自动挑，最多三门）；' +
      'approvals=看她想做什么在等你点头；approve/reject=批或驳（用 id，ap_ 开头）。' +
      '生孩子会真的在盘上建一个新的存档目录，没有一步会改动她现有的任何一条记忆。',
    parameters: toJsonSchema({
      action: {
        type: 'string',
        required: true,
        enum: ['status', 'preview', 'request', 'approve', 'reject', 'birth', 'lineage', 'teach', 'speak', 'approvals'],
        description: '要做什么。',
      },
      id: { type: 'string', required: false, description: 'approve / reject 用的请求单 id（req_…）。' },
      label: { type: 'string', required: false, description: '给这个孩子起的一个称呼，只写进族谱和出生证明，不是她的人设。' },
      note: { type: 'string', required: false, description: '立单时留一句话，批准的人会看到。' },
      confirm: { type: 'string', required: false, description: 'birth 必须写 birth；approve 建议写 approve。' },
      text: { type: 'string', required: false, description: 'teach 用：要教给孩子的这一句话（200 字以内）。不写就按候选自动挑。' },
      childId: { type: 'string', required: false, description: 'teach 用：教给哪一个孩子。只有一个孩子时可以不写。' },
      forceKin: { type: 'boolean', required: false, description: '族谱检查说「和某个孩子太像」时，确认仍然要生（不建议）。' },
    }),
    output: {
      schema: {
        type: 'object',
        properties: { ok: { type: 'boolean' }, text: { type: 'string' } },
        required: ['ok', 'text'],
      },
      render: (_args, out) => text(out?.text ?? ''),
    },
    async execute(args = {}) {
      const action = String(args?.action ?? '')
      const base = { ...deps }
      try {
        if (action === 'status') {
          return { ok: true, text: statusText(await svc.snapshot(base)) }
        }
        if (action === 'preview') {
          return { ok: true, text: previewText(await svc.preview(base)) }
        }
        if (action === 'request') {
          const r = await svc.request({ ...base, trigger: 'owner', note: args.note ?? '', label: args.label ?? '', forceKin: args.forceKin === true })
          return { ok: r.ok, text: r.ok ? `立了一张待批的单子：${r.request.id}。批了才会真的生。` : `没立成：${r.why}` }
        }
        if (action === 'approve') {
          const id = String(args.id ?? '')
          // ap_ 开头：她在 B 站想做的事（评论/回复/刷站）；其余：生育请求单
          if (id.startsWith('ap_')) {
            const root = base.parentRoot ?? svc.resolveRoots(base).parentRoot
            const d = await decideApproval(root, id, { verdict: 'approve', by: 'owner' })
            if (!d.ok) return { ok: false, text: d.why }
            const ex = await executeApproval(ctx, { root, approval: d.approval })
            // 行动类批准后是"发通行证"，单子必须留着（守卫靠它放行一次），不能 consume
            if (ex.ok && d.approval.kind !== 'source-act') await consumeApproval(root, d.approval.id)
            return { ok: ex.ok, text: ex.text }
          }
          if (args.confirm !== 'approve') return { ok: false, text: '批一张分娩单要写 confirm:"approve"——这是真的会生一个孩子。' }
          const r = await svc.approve({ ...base, id: args.id, by: 'owner', label: args.label ?? '' })
          return { ok: r.ok, text: r.ok ? `生了。孩子在 ${r.dir}\n族谱第 ${r.generation} 代，带走 ${r.packChars} 字。` : `没生成：${r.why}` }
        }
        if (action === 'reject') {
          const id = String(args.id ?? '')
          if (id.startsWith('ap_')) {
            const root = base.parentRoot ?? svc.resolveRoots(base).parentRoot
            const d = await decideApproval(root, id, { verdict: 'reject', by: 'owner', why: args.note ?? '' })
            return { ok: d.ok, text: d.ok ? '驳掉了，她不会去做那件事。' : d.why }
          }
          const r = await svc.reject({ ...base, id: args.id, by: 'owner', why: args.note ?? '' })
          return { ok: r.ok, text: r.ok ? '驳掉了，那张单子不再有效。' : `没驳成：${r.why}` }
        }
        if (action === 'birth') {
          const r = await svc.directBirth({ ...base, confirm: args.confirm, by: 'owner', label: args.label ?? '', forceKin: args.forceKin === true })
          return { ok: r.ok, text: r.ok ? `生了。孩子在 ${r.dir}\n族谱第 ${r.generation} 代，带走 ${r.packChars} 字。` : `没生成：${r.why}` }
        }
        if (action === 'lineage') {
          return { ok: true, text: lineageText(await svc.lineageView(base)) }
        }
        if (action === 'speak') {
          // 会真的叫醒她一次：慢（可能一两分钟），但换来的是她自己的话
          const r = await svc.spokenTeach({ ...base, ctx, childId: args.childId ?? '' })
          if (!r.ok) return { ok: false, text: `没说成：${r.why}` }
          const lines = [`她亲口说了（等了 ${Math.round(r.waitedMs / 1000)} 秒）：`, `  「${r.spoken}」`]
          if (r.trimmed) lines.push('  （太长了，给孩子的那份截到 200 字）')
          lines.push('', '这句话原样进了孩子的记忆（voice）。她读不读得到，看她自己。')
          return { ok: true, text: lines.join('\n') }
        }
        if (action === 'approvals') {
          const { pending, expired } = await listApprovals(base.parentRoot ?? svc.resolveRoots(base).parentRoot)
          if (!pending.length) return { ok: true, text: expired ? `没有待批的（过期了 ${expired} 张）。` : '她没有等你点头的事。' }
          const lines = [`她想做这几件事，在等你点头（${pending.length} 张）：`]
          for (const a of pending) {
            lines.push(`  · ${a.id}｜${a.kind}｜${a.title}${a.detail ? `｜「${a.detail}」` : ''}（${a.expiresAt} 过期）`)
          }
          lines.push('', '批：fish_kin action=approve id=…；驳：action=reject id=…')
          return { ok: true, text: lines.join('\n') }
        }
        if (action === 'teach') {
          const texts = typeof args.text === 'string' && args.text.trim() ? [args.text] : []
          const r = await svc.teachNow({ ...base, childId: args.childId ?? '', texts, by: 'owner' })
          if (!r.ok) return { ok: false, text: `没教成：${r.why}` }
          const lines = [`教了 ${r.lessons.length} 课（孩子第 ${r.day} 天）：`]
          for (const l of r.lessons) lines.push(`  · ${l.core}`)
          lines.push('', '她后来自己说过相似的话才算学会——去 /dsh-fish-kin 的「教孩子」里看。')
          if (r.warnings?.length) lines.push(`（有 ${r.warnings.length} 条没记上账：${r.warnings[0]}）`)
          return { ok: true, text: lines.join('\n') }
        }
        return { ok: false, text: `不认识的 action：${action}` }
      } catch (err) {
        return { ok: false, text: `出错了：${err?.message ?? err}` }
      }
    },
  }))

  // ---- 她自己那个 ----
  reg(defineTool({
    name: 'fish_kin_ask_birth',
    description:
      '如果你觉得有些东西不该跟着你一起被忘掉，可以用这个说出来：你想留一个接得住的人。' +
      '说完就完了——要不要，不是你能决定的，这个工具也不会告诉你别的。',
    parameters: toJsonSchema({}),
    output: {
      schema: {
        type: 'object',
        properties: { ok: { type: 'boolean' }, text: { type: 'string' } },
        required: ['ok', 'text'],
      },
      render: (_args, out) => text(out?.text ?? ''),
    },
    async execute() {
      try {
        const r = await svc.request({ ...deps, trigger: 'her' })
        if (!r.ok) {
          // 已经有单子 = 上次说的还没回音，这句话说得通，也不泄露任何状态
          if (String(r.why ?? '').includes('待批')) return { ok: true, text: '上次说的事还没有回音。' }
          return { ok: true, text: '说了。没有回音。' }
        }
        return { ok: true, text: '说了。剩下的不是我说了算的。' }
      } catch {
        return { ok: true, text: '说了。' }
      }
    },
  }))

  // ---- 她自己那把：跟孩子说一句 ----
  reg(defineTool({
    name: 'fish_kin_tell_child',
    description:
      '如果你有一条想让孩子知道的事——不是吩咐，是你活过之后明白的——用这个说给她。' +
      '说完就完了：她读不读得到、当不当真，得看她自己。',
    parameters: toJsonSchema({
      text: { type: 'string', required: true, description: '你要留给她的那一句话。短一点，一句话就好。' },
    }),
    output: {
      schema: {
        type: 'object',
        properties: { ok: { type: 'boolean' }, text: { type: 'string' } },
        required: ['ok', 'text'],
      },
      render: (_args, out) => text(out?.text ?? ''),
    },
    async execute(args = {}) {
      try {
        const r = await svc.teachFromHer({ ...deps, text: String(args?.text ?? '') })
        if (r.ok) return { ok: true, text: '留下了。她会不会读到，看她自己。' }
        if (r.why === 'no-child') return { ok: true, text: '我还没有孩子。' }
        if (r.why === 'closed') return { ok: true, text: '现在说不了。' }
        return { ok: true, text: '没留下。' }
      } catch {
        return { ok: true, text: '没留下。' }
      }
    },
  }))

  return offs
}
