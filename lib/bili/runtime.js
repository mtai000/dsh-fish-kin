/**
 * bili/runtime.js —— 插件内部的 Python MCP 客户端（宿主侧自己起，不挂进 profile）
 *
 * 为什么要自己起：B 站的能力（搜索 / 字幕 / 评论 / 私信 / 转写 / 看画面）都在
 * `vendor/mcp_server.py` 里，宿主只把其中一部分包成 dsh 工具；模型看不到整台 MCP。
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { McpClient } from './mcp.js'
import { biliPaths, normalize } from './config.js'

const clients = new Map()

export function defaultVenvPython(root) {
  const p = biliPaths(root)
  return process.platform === 'win32'
    ? join(p.venv, 'Scripts', 'python.exe')
    : join(p.venv, 'bin', 'python')
}

export function defaultAsrPython(root) {
  const p = biliPaths(root)
  return process.platform === 'win32'
    ? join(p.asrVenv, 'Scripts', 'python.exe')
    : join(p.asrVenv, 'bin', 'python')
}

export function pythonFor(root, config) {
  const cfg = normalize(config)
  if (cfg.pythonPath && existsSync(cfg.pythonPath)) return cfg.pythonPath
  const built = defaultVenvPython(root)
  if (existsSync(built)) return built
  return process.platform === 'win32' ? 'python' : 'python3'
}

export function asrPythonFor(root, config) {
  const cfg = normalize(config)
  if (cfg.asrPython && existsSync(cfg.asrPython)) return cfg.asrPython
  return defaultAsrPython(root)
}

function envFor(root, config) {
  const cfg = normalize(config)
  const p = biliPaths(root)
  return {
    BILI_DUTY_HOME: p.home,
    BILI_DUTY_ASR_MODEL: cfg.transcribe.model,
    BILI_DUTY_ASR_PYTHON: cfg.asrPython || '',
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    HF_ENDPOINT: process.env.BILI_DUTY_HF_ENDPOINT || 'https://hf-mirror.com',
    HF_HOME: cfg.asrCache && existsSync(cfg.asrCache) ? cfg.asrCache : p.hfCache,
    HF_HUB_DISABLE_XET: '1',
  }
}

/** 取（或新建）一个常驻的 MCP 客户端。同一个 root + python 复用。 */
export function getClient(root, config, log = () => {}) {
  const p = biliPaths(root)
  const py = pythonFor(root, config)
  const key = `${root}|${py}`
  const old = clients.get(key)
  if (old) return old
  const client = new McpClient({
    command: py,
    args: [p.mcpServer],
    cwd: p.home,
    env: envFor(root, config),
    log,
  })
  client.__key = key
  clients.set(key, client)
  return client
}

/** 调一个 MCP 工具。把"环境没装好"的错误翻成人话。 */
export async function callMcp(root, config, name, args = {}, opts = {}) {
  const p = biliPaths(root)
  if (!existsSync(p.mcpServer)) {
    throw new Error('B 站后端脚本还没铺好（重启一次 dsh 会自动铺；或者设置页点「安装依赖」）')
  }
  const client = getClient(root, config)
  try {
    return await client.call(name, args, opts)
  } catch (err) {
    const msg = String(err?.message ?? err)
    if (/ENOENT|not found|No such file|不是内部或外部命令/i.test(msg)) {
      throw new Error(`找不到 Python 解释器（${pythonFor(root, config)}）。去设置 → 大肥鱼 → B站 点「安装依赖」，或手动填 pythonPath。`)
    }
    if (/ModuleNotFoundError|No module named/i.test(msg)) {
      throw new Error(`B 站依赖没装齐：${msg}。去设置 → 大肥鱼 → B站 点「安装依赖」。`)
    }
    throw err
  }
}

/** 取原始结果（含图片块）。 */
export async function callMcpRaw(root, config, name, args = {}, opts = {}) {
  const p = biliPaths(root)
  if (!existsSync(p.mcpServer)) throw new Error('B 站后端脚本还没铺好（重启一次 dsh）')
  const client = getClient(root, config)
  return client.callRaw(name, args, opts)
}

export function stopClients() {
  for (const c of clients.values()) {
    try { c.stop() } catch { /* ignore */ }
  }
  clients.clear()
}

/** 配置改了 pythonPath / 模型之后，把旧客户端收掉。 */
export function resetClient(root) {
  for (const [key, c] of clients) {
    if (key.startsWith(`${root}|`)) {
      try { c.stop() } catch { /* ignore */ }
      clients.delete(key)
    }
  }
}
