/**
 * index.js —— 插件入口
 *
 * 生命周期：
 *   apply  → 解析两个目录 → 注册工具 → 注册控制台路由 →（可选）起一个「该提醒了」的定时器
 *   dispose → 全停：注销工具、注销路由、停定时器。停用插件 = 零后台活动。
 *
 * 两件事刻意**不**做：
 *   1. 不在启动时读她的事件流。她的存档可能很大，而插件启动慢会拖住宿主；
 *      所有读盘都发生在你真的点了「看一眼遗传包」或「生」的时候。
 *   2. 不在启动时自己生孩子。自动提议是「提一张单子」，默认关，开了也仍然要主人批准。
 *
 * `inject` 只写两个服务：`tools`（注册工具）和 `webServer`（挂控制台）。
 * dsh-fish 那边记过一条教训——`inject` 里写了一个宿主没有的服务，
 * 整个插件会在 import 阶段被静默跳过，连日志都没有。所以这里只写必须的，
 * 且两处注册都单独 try/catch：少一个服务只少一个功能，不该让插件整个不生效。
 */

import { parentRoot as resolveParentRoot, kinRoot as resolveKinRoot, familyRoot as resolveFamilyRoot, familySource as resolveFamilySource } from './locate.js'
import { injectLocate } from './fish/store.js'
import * as locate from './locate.js'
import { loadConfig } from './kinstore.js'
import { registerKinTools } from './tools.js'
import { registerKinRoutes } from './routes.js'
import { autoPropose } from './service.js'
import { registerPresence } from './presence.js'
import { bootFish } from './fish/index.js'
import { defaultRoot as fishDefaultRoot } from './fish/store.js'

export const name = 'dsh-fish-kin'
export const VERSION = '0.21.0'

/** 一个数组写全，不要拆成对象（拆了会后者覆盖前者）。 */
export const inject = ['tools', 'webServer', 'sessionController']

/** 自动提议的检查间隔：只在她攒得越来越多时才有意义，没必要勤。 */
const AUTO_INTERVAL_MS = 10 * 60 * 1000

export function apply(ctx, baseConfig = {}) {
  const env = process.env

  // 一条鱼住在哪：
  //   embedded（默认，2026-10-31 用户定「不依赖别人的实现」）—— 住我们自己的目录，运行时也是我们的
  //   external —— 只做传承，她由外部装的 dsh-fish 提供
  const fishMode = String(baseConfig.fishMode ?? process.env.DSH_FISH_MODE ?? 'embedded').trim() || 'embedded'
  // 家族工作区：所有东西都在里面（她的记忆在 <工作区>/fish）
  try { injectLocate(locate) } catch { /* 注入失败就退回旧默认 */ }
  const family = String(baseConfig.familyRoot ?? '').trim() || resolveFamilyRoot({ env })
  const fishRoot = String(baseConfig.fishRoot ?? '').trim() || fishDefaultRoot(env)
  // 母代（= 她的家）在 embedded 模式下就是我们的 fishRoot；external 才去解析 dsh-fish 的位置
  const parent = baseConfig.parentRoot || (fishMode === 'external' ? resolveParentRoot({ env }) : fishRoot)
  const kin = baseConfig.kinRoot || resolveKinRoot({ env })
  const deps = { parentRoot: parent, kinRoot: kin, fishRoot, familyRoot: family, env }
  const disposers = []
  let timer = null

  const log = (...a) => {
    try { console.info('[dsh-fish-kin]', ...a) } catch { /* ignore */ }
  }
  let fish = null

  function boot() {
    log(`${VERSION} 起来了｜母代：${parent}｜产房：${kin}｜fish=${fishMode}`)

    // ---- 先把她本人起起来（embedded）----
    // 顺序摆在最前：后面所有东西都假设"她会说话、会写"
    if (fishMode !== 'external') {
      try {
        // 旧家（dsh-fish 的档）只当"一次性搬家来源"：我们的家里还没有记忆时才搬
        const importFrom = String(
          baseConfig.importFrom ?? (fishMode === 'external' ? '' : resolveParentRoot({ env })),
        ).trim()
        fish = bootFish(ctx, { root: parent, log, importFrom })
        disposers.push(() => fish.dispose())
      } catch (err) {
        log('她没起来：' + (err?.message ?? err))
      }
    }

    // ---- 工具 ----
    try {
      const offs = registerKinTools(ctx, deps)
      for (const off of offs) disposers.push(off)
    } catch (err) {
      log('工具注册失败（控制台照常可用）：' + (err?.message ?? err))
    }

    // ---- 控制台 ----
    try {
      const off = registerKinRoutes(ctx, deps)
      if (typeof off === 'function') disposers.push(off)
    } catch (err) {
      log('控制台路由注册失败（工具照常可用）：' + (err?.message ?? err))
    }

    // ---- 让她一直记得自己有孩子（system prompt 段）----
    // 不写事件：meta 她看不见、utterance 是伪造她的话、heard 是替你说话。
    // 走身份通道 = 每轮都在、不进对话历史、她不会"突然忘了"。
    try {
      const off = registerPresence(ctx, { parentRoot: parent, kinRoot: kin, log })
      if (typeof off === 'function') disposers.push(off)
    } catch (err) {
      log('「她有孩子」这一段没挂上：' + (err?.message ?? err))
    }

    // ---- 自动提议（默认关）----
    // 只有配置里 `auto.propose: true` 才会走进来。它做的事只有一件：
    // 到了阈值就替你立一张待批的单子。它**不会**自己生孩子。
    loadConfig(kin)
      .then(({ config }) => {
        if (!config.auto.propose) return
        log('自动提议开着：到阈值会替你立一张待批的单子，仍然要你点头才生')
        timer = setInterval(async () => {
          try {
            const r = await autoPropose(deps)
            if (r.ok) log('提醒过了：立了一张待批的单子')
          } catch (err) {
            log('自动提议失败：' + (err?.message ?? err))
          }
        }, AUTO_INTERVAL_MS)
        timer.unref?.()
      })
      .catch((err) => log('读配置失败：' + (err?.message ?? err)))

    // ---- 给别的插件留个口子（宿主支持 provide 才有）----
    try {
      if (typeof ctx?.provide === 'function') {
        ctx.provide('fish', { status: () => fish?.status?.() ?? null, wake: (o) => fish?.wake?.(o) ?? null })
        ctx.provide('fishKin', {
          snapshot: () => import('./service.js').then((m) => m.snapshot(deps)),
          preview: () => import('./service.js').then((m) => m.preview(deps)),
        })
      }
    } catch { /* 没有就算了，不影响任何功能 */ }
  }

  boot()

  return () => {
    if (timer) clearInterval(timer)
    timer = null
    for (const off of disposers) {
      try { off() } catch { /* ignore */ }
    }
    disposers.length = 0
    log('停了')
  }
}


/**
 * 认知规划器（P0）：每 30 分钟看一次，到了设定的小时且今天还没有意图，就写一条。
 *
 * 它**不执行**任何事——只把"今天想去哪儿看看"留在事件流里。
 * 真正的执行（调用外部插件的工具）在 P3 之后由她自己在回合里发起，
 * 那时才有工具面与审批；现在写意图是为了让"规划"先有落点。
 */
function startPlanner(root, log = () => {}, deps = {}) {
  const { readEvents, appendEvent, derive, loadConfig } = deps
  let timer = null
  let stopped = false
  async function tick() {
    if (stopped) return
    try {
      const cfg = await loadConfig(root)
      const now = Date.now()
      const hour = new Date(now).getHours()
      if (hour < Number(cfg.perception?.plan?.hour ?? 10)) return
      const { events } = await readEvents(root)
      const r = plan({ events, config: cfg, now })
      for (const it of r.intents ?? []) {
        const w = await appendEvent(root, { kind: 'intent', body: it.body, meta: { source: it.source, goal: it.goal } }, { source: 'system', day: derive(events).day })
        if (w.ok) log(`规划：${it.body}`)
      }
    } catch (err) {
      log(`规划失败：${String(err?.message ?? err).slice(0, 120)}`)
    }
  }
  tick()
  timer = setInterval(tick, 30 * 60_000)
  timer?.unref?.()
  return () => { stopped = true; if (timer) clearInterval(timer) }
}
