/**
 * perception/probe.js —— "接上了吗"：配置里写的工具名，宿主里到底有没有
 *
 * 宿主不一定提供"列出全部工具"的接口。所以这里只做**探测**，不假装知道：
 *   - 能列出来 → 逐个标 ok / missing（明确、可执行）；
 *   - 列不出来 → 全部标 unknown，并直接说"宿主不提供工具清单，无法预检"。
 *
 * 这比"等她真调用时才发现没接上"好，又不会给出假的绿灯。
 */

/**
 * 试着从宿主拿到工具名清单。
 * @returns {Promise<{supported:boolean, names:string[]|null, why:string}>}
 */
export async function probeHostTools(ctx) {
  const svc = ctx?.get?.('tools') ?? ctx?.tools ?? null
  if (!svc) return { supported: false, names: null, why: '拿不到 tools 服务' }

  const attempts = [
    ['list', () => svc.list?.()],
    ['all', () => svc.all?.()],
    ['names', () => svc.names?.()],
    ['registry.list', () => svc.registry?.list?.()],
  ]
  for (const [label, fn] of attempts) {
    try {
      const r = await fn()
      const names = normalizeNames(r)
      if (names) return { supported: true, names, why: `via ${label}` }
    } catch { /* 换下一个 */ }
  }
  return { supported: false, names: null, why: '宿主没有可用的工具清单接口' }
}

function normalizeNames(r) {
  if (!r) return null
  if (Array.isArray(r)) {
    const names = r.map((x) => (typeof x === 'string' ? x : x?.name)).filter((x) => typeof x === 'string' && x)
    return names.length ? names : null
  }
  if (Array.isArray(r.names)) return normalizeNames(r.names)
  if (Array.isArray(r.tools)) return normalizeNames(r.tools)
  return null
}

/**
 * 给每个源的工具标状态。
 * @param {Array} sources registry 归一后的源
 * @param {string[]|null} names 宿主工具名（null=不知道）
 */
export function markSources(sources = [], names = null) {
  const set = names ? new Set(names) : null
  return (sources ?? []).map((s) => {
    const mark = (tool) => (!set ? 'unknown' : set.has(tool) ? 'ok' : 'missing')
    return {
      id: s.id,
      title: s.title,
      enabled: s.enabled !== false,
      adapter: s.adapter,
      budget: s.budget,
      summaryMax: s.summaryMax,
      read: (s.read ?? []).map((t) => ({ tool: t, status: s.adapter === 'builtin' ? 'builtin' : mark(t) })),
      act: (s.act ?? []).map((t) => ({ tool: t, status: s.adapter === 'builtin' ? 'builtin' : mark(t) })),
    }
  })
}
