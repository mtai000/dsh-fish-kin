/**
 * fish/execute.js —— 批准之后做什么
 *
 * 只剩一种：`source-act`。批准它不是"我们替你执行"，而是**发一张限时通行证**——
 * 她自己去调外部插件的工具，守卫凭这张单放行一次。
 *
 * 内建 B 站已经从本插件移除，所以这里没有任何网络调用、没有任何凭据。
 */

import { grantFromApproval } from '../perception/grants.js'

export async function executeApproval(ctx, { root, approval, log = () => {} } = {}) {
  const a = approval
  if (a?.kind === 'source-act') {
    const g = await grantFromApproval(root, a)
    if (!g.ok) return { ok: false, text: `没发成通行证：${g.why}` }
    log(`发了通行证：${g.grant?.tool ?? ''}`)
    return { ok: true, text: '通行证给他了（30 分钟内有效，一次）。' }
  }
  return { ok: false, text: `不认识的单子：${a?.kind ?? '?'}` }
}
