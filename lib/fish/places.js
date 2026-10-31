/**
 * fish/places.js —— 「这儿是不是她家」的唯一判定
 *
 * 为什么单独拎出来：身份段（identity.js）和工具闸门（restrict.js）都必须用同一套规则，
 * 否则会出现"她记得自己是谁，但工具不问她"这种半截状态。
 *
 * 2026-10-31 修：用户的会话在 `D:\大肥鱼的家\大肥鱼的家`，而旧判据只认配置里登记的路径，
 * 于是身份没挂上、模型按默认身份回答"我是通用编码代理"。
 * 现在规则是**四选一**，任一命中就算她在家：
 *   1. 插件自己的屋子（`<她的存档>/大肥鱼的家`，或老档的 `home/`）
 *   2. 配置里的每个工作区本身
 *   3. 配置里每个工作区里的「大肥鱼的家」
 *   4. **目录名就叫「大肥鱼的家」**（用户自己建的也算——她搬进去了就是她的家）
 */

import { readFileSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { HOME_DIR } from './store.js'

export const HOME_NAME = HOME_DIR

function norm(p, normPath) {
  const s = String(p ?? '')
  return normPath ? normPath(s) : s.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

function readCfg(root) {
  try { return JSON.parse(readFileSync(join(String(root), 'config.json'), 'utf8')) } catch { return {} }
}

/** 她自己的屋子（跟 store.paths().home 一致，含老档回退）。 */
function ownHome(root, normPath) {
  const base = join(String(root))
  const modern = join(base, HOME_DIR)
  const legacy = join(base, 'home')
  try { if (existsSync(modern)) return modern } catch { /* ignore */ }
  try { if (existsSync(legacy)) return legacy } catch { /* ignore */ }
  return modern
}

/**
 * 这个目录是不是"她在家"。
 * @param {string} root 她的存档根
 * @param {string} cwd 会话工作目录
 * @param {(s:string)=>string} [normPath] 归一化函数（Windows 下会转小写）
 */
export function isHerPlace(root, cwd, normPath = null) {
  const got = norm(cwd, normPath)
  if (!got) return false

  // 4) 目录本身就叫「大肥鱼的家」——用户自己建的也算
  if (norm(basename(String(cwd).replace(/[\\/]+$/, '')), normPath) === norm(HOME_DIR, normPath)) return true

  const cfg = readCfg(root)
  const list = [ownHome(root, normPath)]
  for (const w of cfg?.workspaces ?? []) {
    if (typeof w !== 'string' || !w.trim()) continue
    list.push(w, join(w, HOME_DIR))
  }
  for (const v of cfg?.visits ?? []) {
    if (typeof v === 'string' && v.trim()) list.push(v)
  }
  return list.some((x) => norm(x, normPath) === got)
}
