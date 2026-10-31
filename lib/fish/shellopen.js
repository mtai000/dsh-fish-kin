/**
 * fish/shellopen.js —— 用系统文件管理器打开一个目录
 *
 * 为什么不只是"记住路径"：用户要看她到底住在哪、里面有什么，
 * 最自然是点一下就把文件夹弹出来，而不是复制路径再自己去粘。
 *
 * 只做一件事：把一个**绝对路径**交给系统的 opener。
 * 不 shell 拼接、不执行参数以外的任何东西——路径只作为单个参数传给进程。
 */

import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'

/** 各平台的"用文件管理器打开目录"命令。 */
export function openerFor(platform = process.platform) {
  if (platform === 'win32') return { cmd: 'explorer.exe', args: [] }
  if (platform === 'darwin') return { cmd: 'open', args: [] }
  return { cmd: 'xdg-open', args: [] }
}

const isAbs = (p) => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\')

/**
 * @returns {Promise<{ok:boolean, why:string, path:string}>}
 */
export async function openFolder(path, { spawnImpl = spawn, platform = process.platform } = {}) {
  const p = String(path ?? '').trim().replace(/[\\/]+$/, '')
  if (!p || !isAbs(p)) return { ok: false, why: '要一个绝对路径', path: p }
  try {
    if (!statSync(p).isDirectory()) return { ok: false, why: '这个路径不是目录', path: p }
  } catch {
    return { ok: false, why: '这个目录不存在', path: p }
  }
  const { cmd, args } = openerFor(platform)
  try {
    const child = spawnImpl(cmd, [...args, p], { detached: true, stdio: 'ignore' })
    child?.unref?.()
    return { ok: true, why: '', path: p }
  } catch (err) {
    return { ok: false, why: `打不开：${String(err?.message ?? err).slice(0, 120)}`, path: p }
  }
}
