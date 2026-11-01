/** bili/settings.js —— 把 bili 配置挂在她的 config.json 上（唯一设置来源）。 */

import { loadConfig as loadFishConfig, saveConfig as saveFishConfig } from '../fish/wake.js'
import { normalize, merge } from './config.js'

export async function loadBili(root) {
  const fish = await loadFishConfig(root)
  return normalize(fish?.bili)
}

export async function saveBili(root, patch) {
  const current = await loadBili(root)
  const next = merge(current, patch)
  const r = await saveFishConfig({ bili: next }, root)
  return { ok: r.ok !== false, bili: normalize(r?.config?.bili ?? next), why: r?.why ?? '' }
}
