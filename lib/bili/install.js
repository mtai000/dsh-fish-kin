/**
 * bili/install.js —— 安装/探测 B 站后端需要的 Python 环境
 *
 * 跟 dsh-bili-scroll 一样：**起完就返回，不等装完**（装 venv 可能几分钟，
 * 把一次工具调用挂住会让整个会话僵住）。进度写进 `<家>/bili/install.log`。
 *
 * 优先用 uv（能自己拉 Python），没有就退回系统 python -m venv。
 * 依赖走国内镜像：清华 → 中科大 → 阿里云。
 */

import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { biliPaths, normalize } from './config.js'
import { saveBili } from './settings.js'
import { defaultAsrPython, defaultVenvPython, pythonFor, resetClient } from './runtime.js'
import { ensureUv } from './uvfetch.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REQUIREMENTS = join(HERE, 'requirements.txt')

export const VENV_DEPS = ['bilibili_api', 'mcp', 'qrcode']

const installing = new Set()
const installingAsr = new Set()
const probeCache = new Map()

export function logTo(file, text) {
  try {
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, String(text), 'utf8')
  } catch { /* 日志写不进去不能影响安装 */ }
}

export function appendInstall(root, text) {
  logTo(biliPaths(root).installLog, text)
}

export function appendAsr(root, text) {
  logTo(biliPaths(root).asrLog, text)
}

function run(cmd, args, { cwd, env, sink, timeoutMs = 0 } = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args, {
        cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...(env || {}) },
      })
    } catch (e) {
      sink?.(`起不来 ${cmd}：${e?.message ?? e}\n`)
      return resolve(1)
    }
    let done = false
    const finish = (code) => { if (done) return; done = true; resolve(code) }
    const timer = timeoutMs ? setTimeout(() => { try { child.kill() } catch { /* ignore */ } finish(124) }, timeoutMs) : null
    const w = (b) => sink?.(String(b))
    child.stdout?.on('data', w)
    child.stderr?.on('data', w)
    child.on('error', (e) => { sink?.(`起不来 ${cmd}：${e?.message ?? e}\n`); finish(1) })
    child.on('exit', (code) => { if (timer) clearTimeout(timer); finish(typeof code === 'number' ? code : 1) })
  })
}

export function probeCmd(cmd, args = ['--version']) {
  return run(cmd, args, { timeoutMs: 8000 }).then((c) => c === 0)
}

export function probeModules(python, modules = VENV_DEPS, timeoutMs = 15000) {
  const key = `${python}|${modules.join(',')}`
  const hit = probeCache.get(key)
  if (hit && Date.now() - hit.at < 30_000) return Promise.resolve(hit)
  const code = `import ${modules.join(', ')}; print('ok')`
  return run(python, ['-c', code], { timeoutMs }).then((c) => {
    const r = { ok: c === 0, at: Date.now(), python }
    probeCache.set(key, r)
    return r
  })
}

export function venvPythonOf(root, config) {
  const cfg = normalize(config)
  if (cfg.pythonPath && existsSync(cfg.pythonPath)) return cfg.pythonPath
  return defaultVenvPython(root)
}

export async function venvState(root, config) {
  const cfg = normalize(config)
  let py = venvPythonOf(root, cfg)
  // 没有 venv 时也认系统 Python（有些用户把依赖装在全局；MCP 的 pythonFor 也是这么选的）
  if (!existsSync(py)) py = pythonFor(root, cfg)
  const probe = await probeModules(py, VENV_DEPS)
  return {
    ready: probe.ok,
    python: py,
    missing: probe.ok ? [] : VENV_DEPS.slice(),
    reason: probe.ok ? '' : (existsSync(py) ? '依赖 import 不过' : '还没建 venv'),
  }
}

export async function asrState(root, config) {
  const cfg = normalize(config)
  const py = cfg.asrPython && existsSync(cfg.asrPython) ? cfg.asrPython : defaultAsrPython(root)
  if (!existsSync(py)) return { ready: false, python: py, reason: '还没建转写环境' }
  const probe = await probeModules(py, ['faster_whisper', 'yt_dlp'])
  return { ready: probe.ok, python: py, reason: probe.ok ? '' : 'faster-whisper / yt-dlp 没装齐' }
}

async function findUv(root) {
  if (await probeCmd('uv')) return 'uv'
  const p = biliPaths(root)
  const bundled = join(p.bin, process.platform === 'win32' ? 'uv.exe' : 'uv')
  if (existsSync(bundled)) return bundled
  appendInstall(root, '\n这台机器上没有 uv —— 我下一份放进她自己的家（单文件、免管理员、约 15–32MB）…\n')
  const got = await ensureUv({ dir: p.bin, log: (m) => appendInstall(root, m + '\n') })
  return got || ''
}

const PACKAGES_MIRRORS = [
  'https://pypi.tuna.tsinghua.edu.cn/simple',
  'https://mirrors.ustc.edu.cn/pypi/simple',
  'https://mirrors.aliyun.com/pypi/simple',
]

/** 先试 uv，再试 venv 自己的 pip；每个镜像都试一遍。 */
async function installRequirements(root, { python, venv, uv, reqFile, sink, extraArgs = [] }) {
  for (const mirror of PACKAGES_MIRRORS) {
    sink(`\n—— 镜像：${mirror}\n`)
    if (uv) {
      const c = await run(uv, ['pip', 'install', '--python', python, '-i', mirror, ...extraArgs, '-r', reqFile], { cwd: biliPaths(root).home, sink, env: uvEnv(root), timeoutMs: 10 * 60_000 })
      if (c === 0) return 0
    }
    const c2 = await run(python, ['-m', 'pip', 'install', '-i', mirror, ...extraArgs, '-r', reqFile], { cwd: biliPaths(root).home, sink, env: uvEnv(root), timeoutMs: 10 * 60_000 })
    if (c2 === 0) return 0
  }
  return 1
}

function uvEnv(root) {
  const p = biliPaths(root)
  return {
    UV_CACHE_DIR: join(p.home, 'uv-cache'),
    UV_TOOL_DIR: join(p.home, 'uv-tools'),
    UV_PYTHON_INSTALL_DIR: join(p.home, 'uv-python'),
  }
}

/** 点「安装依赖」：建主 venv + 装 4 个包。起完立即返回。 */
export function startInstall(root, config) {
  const key = String(root)
  if (installing.has(key)) return { ok: true, busy: true, log: biliPaths(root).installLog, hint: '正在装，别重复点' }
  installing.add(key)
  const p = biliPaths(root)
  mkdirSync(p.home, { recursive: true })
  appendInstall(root, `\n=== ${new Date().toISOString()} 开始安装 B 站后端依赖 ===\n`)
  ;(async () => {
    try {
      const uv = await findUv(root)
      const venvPy = defaultVenvPython(root)
      const sysPy = normalize(config).pythonPath || (process.platform === 'win32' ? 'python' : 'python3')
      if (!existsSync(venvPy)) {
        if (uv) {
          appendInstall(root, `建 venv：${p.venv}（uv，优先 Python 3.12）\n`)
          let c = await run(uv, ['venv', '--seed', '--python', '3.12', p.venv], { sink: (m) => appendInstall(root, m), env: uvEnv(root), timeoutMs: 5 * 60_000 })
          if (c !== 0) {
            appendInstall(root, '\n（uv 带 --python 3.12 没成 —— 退回 uv 默认 Python）\n')
            c = await run(uv, ['venv', '--seed', p.venv], { sink: (m) => appendInstall(root, m), env: uvEnv(root), timeoutMs: 5 * 60_000 })
          }
        } else if (await probeCmd(sysPy)) {
          appendInstall(root, `建 venv：${p.venv}（python -m venv）\n`)
          await run(sysPy, ['-m', 'venv', p.venv], { sink: (m) => appendInstall(root, m), timeoutMs: 5 * 60_000 })
        }
      }
      if (!existsSync(venvPy)) {
        appendInstall(root, '\n⛔ 建 venv 失败：这台机器上没有可用的 uv 或 Python。\n')
        appendInstall(root, '   办法：装 uv（https://docs.astral.sh/uv/，单文件）或 Python 3.10+（勾 Add to PATH），再点一次。\n')
        return
      }
      const code = await installRequirements(root, { python: venvPy, venv: p.venv, uv, reqFile: REQUIREMENTS, sink: (m) => appendInstall(root, m) })
      let ok = false
      if (code === 0 && existsSync(venvPy)) {
        appendInstall(root, '\n自检：真的 import 一次…\n')
        ok = (await probeModules(venvPy, VENV_DEPS, 30_000)).ok
        appendInstall(root, ok ? '自检：依赖 import 通过 ✓\n' : '自检：依赖 import 失败 ✗（上面那段是原因）\n')
        if (ok) {
          const r = await saveBili(root, { pythonPath: venvPy })
          appendInstall(root, `已把 pythonPath 设为 ${venvPy}${r.ok ? '' : '（保存失败：' + r.why + '）'}\n`)
          resetClient(root)
        }
      }
      appendInstall(root, `=== 结束（exit ${code}，venvReady=${ok}）===\n`)
    } catch (e) {
      appendInstall(root, `\n装依赖崩了：${e?.stack ?? e}\n`)
    } finally {
      installing.delete(key)
    }
  })()
  return { ok: true, started: true, log: p.installLog, hint: '正在后台装 —— 进度在下面的日志里' }
}

/** 点「安装转写依赖」：独立 venv + faster-whisper + yt-dlp + 预下模型。 */
export function startAsrInstall(root, config) {
  const key = String(root)
  if (installingAsr.has(key)) return { ok: true, busy: true, log: biliPaths(root).asrLog, hint: '正在装转写依赖，别重复点' }
  installingAsr.add(key)
  const p = biliPaths(root)
  mkdirSync(p.asrTmp, { recursive: true })
  appendAsr(root, `\n=== ${new Date().toISOString()} 开始装本地转写依赖 ===\n`)
  ;(async () => {
    try {
      const cfg = normalize(config)
      const uv = await findUv(root)
      const py = defaultAsrPython(root)
      const sysPy = process.platform === 'win32' ? 'python' : 'python3'
      if (!existsSync(py)) {
        if (uv) {
          appendAsr(root, `建转写 venv：${p.asrVenv}（uv，优先 Python 3.12）\n`)
          let c = await run(uv, ['venv', '--seed', '--python', '3.12', p.asrVenv], { sink: (m) => appendAsr(root, m), env: uvEnv(root), timeoutMs: 5 * 60_000 })
          if (c !== 0) c = await run(uv, ['venv', '--seed', p.asrVenv], { sink: (m) => appendAsr(root, m), env: uvEnv(root), timeoutMs: 5 * 60_000 })
        } else if (await probeCmd(sysPy)) {
          appendAsr(root, `建转写 venv：${p.asrVenv}（python -m venv）\n`)
          await run(sysPy, ['-m', 'venv', p.asrVenv], { sink: (m) => appendAsr(root, m), timeoutMs: 5 * 60_000 })
        }
      }
      if (!existsSync(py)) {
        appendAsr(root, '\n⛔ 建转写环境失败：没有 uv / Python。先点上面的「安装依赖」。\n')
        return
      }
      const req = join(p.home, 'asr-requirements.txt')
      try {
        // av 必须 <17：faster-whisper 1.2 会调 av.open(metadata_errors=…)，av 17+ 不认
        const { writeFileSync } = await import('node:fs')
        writeFileSync(req, ['faster-whisper', 'yt-dlp', 'av>=12,<17'].join('\n') + '\n', 'utf8')
      } catch { /* ignore */ }
      appendAsr(root, '装 faster-whisper + yt-dlp + av（走国内镜像）…\n')
      const code = await installRequirements(root, { python: py, venv: p.asrVenv, uv, reqFile: req, sink: (m) => appendAsr(root, m) })
      if (code !== 0) {
        appendAsr(root, '\n装包失败 —— 看上面的报错。\n')
        return
      }
      // 预下模型：第一次转写别卡在下载上
      const model = cfg.transcribe.model
      mkdirSync(p.hfCache, { recursive: true })
      appendAsr(root, `\n下 Whisper 模型「${model}」（缓存在 ${p.hfCache}，几百 MB，只需要一次）…\n`)
      const code2 = await run(py, ['-c',
        'import os,sys;os.environ["HF_HUB_DISABLE_XET"]="1";from faster_whisper import WhisperModel;WhisperModel(sys.argv[1], device="cpu", compute_type="int8");print("模型就绪")',
        model], { cwd: p.home, sink: (m) => appendAsr(root, m), env: { HF_ENDPOINT: process.env.BILI_DUTY_HF_ENDPOINT || 'https://hf-mirror.com', HF_HOME: p.hfCache, HF_HUB_DISABLE_XET: '1' }, timeoutMs: 30 * 60_000 })
      appendAsr(root, `=== 结束（装包 exit ${code}，模型 exit ${code2}）===\n`)
      const r = await saveBili(root, { asrPython: py, asrCache: p.hfCache })
      if (r.ok) appendAsr(root, `已记下 asrPython=${py}\n`)
    } catch (e) {
      appendAsr(root, `\n装转写依赖崩了：${e?.stack ?? e}\n`)
    } finally {
      installingAsr.delete(key)
    }
  })()
  return { ok: true, started: true, log: p.asrLog, hint: '正在后台装转写依赖（要下几百 MB 模型，慢一点正常）' }
}

export function installState(root) {
  return { installing: installing.has(String(root)), installingAsr: installingAsr.has(String(root)) }
}

export function tail(file, n = 1800) {
  try { return readFileSync(file, 'utf8').slice(-n) } catch { return '' }
}

export function removeQuiet(file) {
  try { rmSync(file, { force: true }) } catch { /* ignore */ }
}

export { run as runProcess, uvEnv }
