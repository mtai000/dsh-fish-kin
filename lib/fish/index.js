/**
 * fish/index.js —— 这条鱼自己的启动器
 *
 * 自研的精简运行时（不 vendor dsh-fish）：事件流、身份段、写入工具、屋子、唤醒、B站。
 * 顺序是刻意的：
 *   1. 先铺目录和 seed（她要先存在）
 *   2. 再挂身份段和工具（她要能说、能看）
 *   3. 最后建屋子/叫醒（会调模型，放最后，失败不影响前面）
 */

import { promises as fs } from 'node:fs'
import { ensureDirs, ensureSeed, readEvents, appendEvent, paths } from './store.js'
import { derive } from './derive.js'
import { registerIdentity, identityText } from './identity.js'
import { registerCommit } from './commit.js'
import { ensureHome, sayToHer } from './home.js'
import { loadConfig, wake, startWakeLoop, wakeText } from './wake.js'
import { seedText } from './seed.js'
import { maybeAutoImport } from './import.js'
import { registerRestrict } from './restrict.js'
import { registerObserve } from './observe.js'
import { registerAskTool } from '../perception/ask.js'
import { defineTool } from '../tool.js'
import { toJsonSchema } from '../toolschema.js'

export const FISH_VERSION = '0.1.0'

/** 她的状态（给控制台和工具用）。 */
export async function fishStatus(root) {
  const { events, skipped } = await readEvents(root)
  const m = derive(events)
  const config = await loadConfig(root)
  return { ok: true, root, day: m.day, name: m.name, beliefs: m.beliefCount, refusals: m.refusalCount, events: m.eventCount, chars: m.chars, lastAt: m.lastAt, skipped, config }
}

export function bootFish(ctx, { root, log = () => {}, importFrom = '' } = {}) {
  const disposers = []
  let stopLoop = null
  // 观测台读的就是这份：工具面挂没挂上、守卫挡了几次、写入被拒几次
  const state = {
    tools: { ok: false, allow: [], guard: false, blocked: 0, why: '还没挂' },
    guard: { rejects: 0, selfMod: 0 },
  }

  const boot = async () => {
    await ensureDirs(root)

    // 一次性搬家：旧家（dsh-fish）有存档、我们这边还是空的，就搬过来
    if (importFrom) {
      try {
        const moved = await maybeAutoImport({ from: importFrom, to: root })
        if (moved.ok) log(`从旧家搬过来 ${moved.count} 条记忆（跳过 ${moved.skipped}）`)
        else if (!moved.skipped) log(`旧家没搬成：${moved.why}`)
      } catch (err) {
        log(`旧家搬家失败：${String(err?.message ?? err).slice(0, 120)}`)
      }
    }

    const cfg0 = await loadConfig(root)
    await ensureSeed(root, seedText(cfg0.style))

    // ① 先把她的工具面收窄（安全第一：她不该看见 shell/read）
    try {
      const config = await loadConfig(root)
      // 感知源：读类直接放行；行动类可以出现在工具面里，但每次调用都要一张批准的通行证
      const srcs = Array.isArray(config.perception?.sources) ? config.perception.sources : []
      const readTools = srcs.flatMap((s2) => (Array.isArray(s2.read) ? s2.read : []))
      const actTools = srcs.flatMap((s2) => (Array.isArray(s2.act) ? s2.act : []))
      // 立单入口要先注册，否则她的工具面里没有它，act 永远拿不到许可
      if (actTools.length) {
        try {
          const offAsk = registerAskTool(ctx, { root, sources: srcs, log })
          if (typeof offAsk === 'function') disposers.push(offAsk)
        } catch (err) {
          log(`立单工具没起来：${String(err?.message ?? err).slice(0, 120)}`)
        }
      }
      const off = registerRestrict(ctx, {
        root,
        allow: [...readTools, ...config.tools.allow],
        act: actTools,
        log,
        onResult: (r) => { state.tools = { ok: r.ok !== false, allow: r.allow ?? [], guard: Boolean(r.guard), blocked: Number(r.blocked) || state.tools.blocked || 0, why: r.why ?? '' } },
      })
      if (typeof off === 'function') disposers.push(off)
    } catch (err) {
      log(`工具面收窄没挂上：${String(err?.message ?? err).slice(0, 120)}`)
    }

    try {
      const off = registerIdentity(ctx, { root, log })
      if (typeof off === 'function') disposers.push(off)
    } catch (err) {
      log(`身份段没挂上：${String(err?.message ?? err).slice(0, 120)}`)
    }
    try {
      disposers.push(registerCommit(ctx, {
        root,
        log,
        report: (e) => { if (e?.kind === 'reject') state.guard.rejects++; else if (e?.kind === 'selfMod') state.guard.selfMod++ },
      }))
    } catch (err) {
      log(`写入工具没挂上：${String(err?.message ?? err).slice(0, 120)}`)
    }
    try {
      disposers.push(registerBiliTool(ctx, { root, log }))
    } catch (err) {
      log(`B站工具没挂上：${String(err?.message ?? err).slice(0, 120)}`)
    }

    // 屋子：失败不致命（没有 sessionController 时她只是没地方说话）
    try {
      const home = await ensureHome(ctx, { root, log })
      if (!home.ok) log(`屋子没建起来：${home.why}`)
    } catch (err) {
      log(`屋子没建起来：${String(err?.message ?? err).slice(0, 120)}`)
    }

    // 观测台（只读）
    try {
      const off = registerObserve(ctx, { root, state, log })
      if (typeof off === 'function') disposers.push(off)
    } catch (err) {
      log(`观测台没挂上：${String(err?.message ?? err).slice(0, 120)}`)
    }

    // 生物钟
    try {
      const config = await loadConfig(root)
      if (config.wake.enabled) stopLoop = startWakeLoop(ctx, { root, log })
    } catch (err) {
      log(`生物钟没起来：${String(err?.message ?? err).slice(0, 120)}`)
    }

    const st = await fishStatus(root)
    log(`她醒着：第 ${st.day} 天 · 判断 ${st.beliefs} 条 · 拒绝 ${st.refusals} 条 · 事件 ${st.events} 条`)
  }

  void boot().catch((err) => log(`启动失败：${String(err?.stack ?? err).slice(0, 300)}`))

  return {
    status: () => fishStatus(root),
    state: () => state,
    wake: (o = {}) => wake(ctx, { root, log, ...o }),
    text: () => identityText(root),
    dispose() {
      if (stopLoop) { try { stopLoop() } catch { /* ignore */ } }
      stopLoop = null
      for (const d of disposers) { try { d() } catch { /* ignore */ } }
      disposers.length = 0
    },
  }
}

export { paths, readEvents, appendEvent, derive, ensureSeed, sayToHer, loadConfig, wakeText }
