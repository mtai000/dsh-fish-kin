/**
 * perception/ask.js —— 她要对外做事之前的"立单"入口（工具 fish_ask）
 *
 * 为什么需要它：她的工具面里只有读类工具；行动类工具即使出现，也会被守卫拦住——
 * 除非她手里有一张**批准过的限时通行证**。这张单子就是她"开口"的地方。
 *
 * 规矩：
 *   - 只能为**配置里声明过**的 act 工具立单（不能凭空要求调用任意工具）；
 *   - 立单不执行、不联网，只落一张 <她家>/approvals/<id>.json；
 *   - 批不批是主人那边的事（fish_kin / 设置页）。
 */

import { defineTool } from '../tool.js'
import { toJsonSchema } from '../toolschema.js'
import { createApproval, listApprovals } from '../fish/approvals.js'

const OUT = {
  schema: {
    type: 'object',
    properties: { ok: { type: 'boolean' }, note: { type: 'string' } },
    required: ['ok', 'note'],
  },
  render: (_a, out) => [{ type: 'text', text: String(out?.note ?? '') }],
}

/** 从已启用的 source 清单里找：这个工具属于哪个源、是不是 act 类。 */
function findActTool(sources, tool) {
  for (const s of sources ?? []) {
    if (!Array.isArray(s?.act) || !s.act.includes(tool)) continue
    return s
  }
  return null
}

export function registerAskTool(ctx, { root, sources = [], log = () => {} } = {}) {
  if (!ctx?.tools?.register) return () => {}
  const d = ctx.tools.register(defineTool({
    name: 'fish_ask',
    description:
      '想在外面做一件事（发评论、发私信、去游戏里走一步……）之前，先用它立一张单等他点头。' +
      '只能点你确实能用的工具。立单不等于做了；他同意之后你再动手。',
    parameters: toJsonSchema({
      type: 'object',
      properties: {
        action: { type: 'string', required: true, enum: ['request', 'check'], description: 'request=立单；check=看看有没有在等的单子。' },
        tool: { type: 'string', required: false, description: 'request 时必填：你想用的那个工具名。' },
        why: { type: 'string', required: false, description: 'request 时可选：一句话说明为什么想做。' },
        args: { type: 'object', required: false, description: 'request 时可选：调用时要带的参数（原样记着，审批后由你自己带过去）。' },
      },
    }),
    output: OUT,
    execute: async (args) => {
      const action = String(args?.action ?? 'request')
      if (action === 'check') {
        const { pending } = await listApprovals(root)
        const mine = pending.filter((a) => a.kind === 'source-act')
        if (!mine.length) return { ok: true, note: '没有在等的单子。' }
        return { ok: true, note: '在等的：' + mine.map((a) => `${a.title}`).join('；') }
      }

      const tool = String(args?.tool ?? '').trim()
      if (!tool) return { ok: false, note: '要给一个工具名。' }
      const src = findActTool(sources, tool)
      if (!src) return { ok: false, note: '我不能做这件事。' }

      const why = String(args?.why ?? '').trim().slice(0, 200)
      const made = await createApproval(root, {
        kind: 'source-act',
        title: `${src.title}：${tool}`,
        detail: why,
        payload: { source: src.id, tool, args: args?.args && typeof args.args === 'object' ? args.args : {} },
      })
      if (!made.ok) return { ok: false, note: `没立成：${made.why}` }
      log(`她立了一张行动单：${tool}（${made.approval.id}）`)
      return { ok: true, note: '我立好了，等他点头。' }
    },
  }))
  return typeof d === 'function' ? d : () => {}
}
