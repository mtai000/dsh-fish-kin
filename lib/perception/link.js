/**
 * perception/link.js —— 把一个外部插件"接"成感知源
 *
 * 解耦的最后一环：接入任何插件都只是往 `perception.sources` 写一段配置，
 * 本仓库里不会因此多出任何针对那个插件的代码。
 *
 * 工具名从哪来：装好插件后，看它暴露的工具（比如它的 README 或设置页）。
 * 这里不猜、也不内置任何名字。
 */

import { saveConfig } from '../fish/wake.js'
import { normalizeSources } from './registry.js'

/**
 * @param {object} o { id, title, read?, act?, budget?, summaryMax? }
 */
export async function linkSource(root, { id = '', title = '', read = [], act = [], budget = null, summaryMax = null } = {}) {
  const srcId = String(id ?? '').trim()
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(srcId)) return { ok: false, why: 'id 要小写字母开头、只用字母数字下划线（如 bili / cdda）' }
  const source = {
    title: String(title ?? srcId).trim() || srcId,
    enabled: true,
    adapter: 'external',
    tools: {
      read: (Array.isArray(read) ? read : String(read).split(/[,，\s]+/)).map((x) => String(x).trim()).filter(Boolean),
      act: (Array.isArray(act) ? act : String(act).split(/[,，\s]+/)).map((x) => String(x).trim()).filter(Boolean),
    },
  }
  if (budget) source.budget = { perDay: Number(budget) }
  if (summaryMax) source.summaryMax = Number(summaryMax)

  const [checked] = normalizeSources({ [srcId]: source })
  if (!checked) return { ok: false, why: '这个源没有可用的工具名（read/act 都空，或名字不合法）' }

  const r = await saveConfig({ perception: { sources: { [srcId]: source } } }, root)
  if (!r.ok) return { ok: false, why: r.why }
  const saved = (r.config.perception.sources ?? []).find((s) => s.id === srcId)
  return { ok: true, why: '', source: saved ?? checked }
}

/** 启停一个源（只改配置）。 */
export async function setSourceEnabled(root, id, enabled) {
  const { loadConfig } = await import('../fish/wake.js')
  const cfg = await loadConfig(root)
  const cur = (cfg.perception.sources ?? []).find((s) => s.id === id)
  if (!cur) return { ok: false, why: `没有这个源：${id}` }
  const raw = {
    title: cur.title,
    adapter: cur.adapter,
    enabled: enabled === true,
    tools: { read: cur.read, act: cur.act },
    budget: cur.budget,
    summaryMax: cur.summaryMax,
  }
  const r = await saveConfig({ perception: { sources: { [id]: raw } } }, root)
  return { ok: r.ok, why: r.why, config: r.config }
}

/** 断掉一个源（从配置里删掉这个键；不碰宿主里的任何东西）。 */
export async function removeSource(root, id) {
  const { loadConfig } = await import('../fish/wake.js')
  const cfg = await loadConfig(root)
  if (!(cfg.perception.sources ?? []).some((s) => s.id === id)) return { ok: false, why: `没有这个源：${id}` }
  const fs = await import('node:fs/promises')
  const { join } = await import('node:path')
  const file = join(String(root), 'config.json')
  let raw = {}
  try { raw = JSON.parse(await fs.readFile(file, 'utf8')) ?? {} } catch { raw = {} }
  if (raw.perception?.sources && raw.perception.sources[id] !== undefined) {
    delete raw.perception.sources[id]
    await fs.writeFile(file, JSON.stringify(raw, null, 2) + '\u000a', 'utf8')
  }
  const after = await loadConfig(root)
  return { ok: true, why: '', config: after }
}

/** 列出已接上的源（给命令行看）。 */
export async function listSources(root) {
  const { loadConfig } = await import('../fish/wake.js')
  const cfg = await loadConfig(root)
  return cfg.perception.sources ?? []
}
