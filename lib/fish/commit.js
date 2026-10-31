/**
 * fish/commit.js —— 她唯一的写入口（工具 fish_commit）
 *
 * 规矩只有三条，全部由代码保证，不靠提示词：
 *   1. **只能新增**。没有 update / delete / reset。
 *   2. **不回显状态**。返回值里没有第几天、没有几条判断——否则她就有了读自己数值的通道。
 *   3. **只能写 HER_TYPES**。seed / meta / seen 是系统侧写的，她编不出来。
 */

import { defineTool } from '../tool.js'
import { toJsonSchema } from '../toolschema.js'
import { HER_KINDS, appendEvent, readEvents } from './store.js'
import { TYPE_TO_KIND } from './schema.js'
import { screenHerWrite } from './guard.js'
import { derive } from './derive.js'

const OUT = {
  schema: {
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      id: { type: 'string', description: '这条记录的 id（改口时要用它）' },
      note: { type: 'string' },
    },
    required: ['ok', 'id', 'note'],
  },
  // 回执只描述机器状态，不写成她能接续的句子（不然她会把回执当自己的话）
  render: (_a, out) => [{ type: 'text', text: String(out?.note ?? '') }],
}

export function registerCommit(ctx, { root, log = () => {}, report = () => {} } = {}) {
  if (!ctx?.tools?.register) return () => {}
  const d = ctx.tools.register(defineTool({
    name: 'fish_commit',
    description:
      '把你此刻想说的话留下来。只能新增，不能修改或删除。' +
      '想改以前的说法，用 type=revise 并用 refs 指向原来那条的 id。' +
      '这个工具不会告诉你你的任何状态。没什么想说的就不要调用。',
    parameters: toJsonSchema({
      type: {
        type: 'string',
        required: true,
        enum: ['utterance', 'revise', 'refusal', 'diary'],
        description: 'utterance=一句你自己的判断；revise=改写旧的那句（必须带 refs）；refusal=你拒绝了什么；diary=今天写下的日记。',
      },
      text: { type: 'string', required: true, description: '你要留下的话，2000 字以内。不要写成汇报。' },
      refs: { type: 'array', required: false, items: { type: 'string' }, description: 'type=revise 时必填：被改写那条的 id。' },
      verdict: { type: 'string', required: false, enum: ['confirmed', 'refuted', 'refined'], description: 'revise 专用：原来那句还成立/被推翻/被修正。' },
      confidence: { type: 'number', required: false, description: '你有多确定，0–1。' },
    }),
    output: OUT,
    async execute(args = {}) {
      try {
        // 她只能写这四种；seed/meta/seen 是系统侧的，编不出来
        if (!HER_KINDS.includes(TYPE_TO_KIND[String(args?.type ?? '')] ?? '')) {
          return { ok: false, id: '', note: '(这种记录轮不到你写)' }
        }
        const screen = screenHerWrite(args?.text)
        if (!screen.ok) {
          try { report({ kind: 'reject' }) } catch { /* ignore */ }
          return { ok: false, id: '', note: `(没写进去：${screen.why})` }
        }
        if (screen.selfMod) {
          try { report({ kind: 'selfMod' }) } catch { /* ignore */ }
          log('她写了一句"改自己"的话（只记录，不拦）')
        }
        const { events } = await readEvents(root)
        const day = derive(events).day
        const r = await appendEvent(root, args, { source: 'tool', day })
        if (!r.ok) return { ok: false, id: '', note: `没写进去：${r.why}` }
        return { ok: true, id: r.event.id, note: '(已记下)' }
      } catch (err) {
        log(`她写失败了：${String(err?.message ?? err).slice(0, 160)}`)
        return { ok: false, id: '', note: '没写进去。' }
      }
    },
  }))
  return typeof d === 'function' ? d : () => {}
}
