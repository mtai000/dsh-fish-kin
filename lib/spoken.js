/**
 * spoken.js —— 让她**亲口**跟孩子说一句（L2）
 *
 * 为什么不满足于「我们从她的事件流里摘一句」：
 * 摘出来的句子是"她某天说过的话"，语气、对象、时机全是我们挑的。
 * 而"妈跟孩子说一句"这件事，只有她自己开口才算真的发生过。
 *
 * 代价与边界（用户 2026-10-31 拍板：只做这一层，不做实时对话）：
 *   - 一次 = **一个母回合**（把她叫醒、说一句、写下来），约等于她平常醒来一次；
 *   - 孩子那边**零回合**：我们不叫醒孩子，只把她这句话原样放进孩子的事件流；
 *   - 不做往返对话：母子不互发消息，所以谁都不会因为对话历史变长而变贵。
 *
 * 技术上只有三步（都走宿主已有的正规通道）：
 *   1. 读 `home.json` 拿到她现在那条会话的 id；
 *   2. `sessionController.prompt()` 把一句处境递进去（她自己决定说什么）；
 *   3. 轮询她的事件流，等一条新的 utterance —— 那条原文就是课程。
 *
 * 她为什么会知道孩子的存在：这句处境里明说了（"你生过一个孩子"）。
 * 这句话只走对话、不写进她的事件流，也不会被当成"你说过的话"——
 * 它是宿主替你把话递进去的那一句，和定时唤醒同一个性质。
 */

import { join } from 'node:path'
import { readJson } from './kinstore.js'
import { readParentEvents, tsMs } from './read.js'
import { readChild, teach, LESSON_MAX } from './teach.js'
import { squeeze, countChars } from './text.js'

/** 等她说完最多等这么久。dsh-fish 的对话入口是 75 秒，这里放宽：她要先想。 */
export const SPOKEN_TIMEOUT_MS = 120_000
/** 轮询间隔。 */
export const SPOKEN_POLL_MS = 1500

/** 递进去的那句话。只给处境，不给句式——她怎么说，是她自己的事。 */
export function spokenPrompt() {
  return [
    '你生过一个孩子。她现在在别的地方活着，用她自己的方式长大。',
    '如果你有话想让她知道，就说一句——一句就好，写进你自己的记忆里（growth_commit）。',
    '我会把你写下的那句原样转给她。不想说也没关系，这一轮就当没发生过。',
  ].join('\n')
}

// 不要 unref：这个定时器是「等她说」的唯一凭据，unref 掉就等于
// 在没有别的事情时让进程提前退出，await 永远悬着（冒烟时踩到过）。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 叫醒她说一句，并把那句原样抄给孩子。
 *
 * @param {object} o
 *   ctx       宿主 ctx（要 sessionController）
 *   parentRoot/kinRoot/childId
 *   now / timeoutMs / pollMs（测试用）
 * @returns {Promise<{ok:boolean, why:string, spoken?:string, trimmed?:boolean, waitedMs:number}>}
 */
export async function askMotherAndTeach({
  ctx, parentRoot, kinRoot, childId,
  now = Date.now(), timeoutMs = SPOKEN_TIMEOUT_MS, pollMs = SPOKEN_POLL_MS,
} = {}) {
  // 先确认孩子还在：别为了一个不存在的孩子花掉她一次醒来
  const child = await readChild(kinRoot, childId)
  if (!child) return { ok: false, why: '找不到这个孩子（目录可能被搬走了）', waitedMs: 0 }

  const sc = ctx?.get?.('sessionController') ?? ctx?.sessionController
  if (typeof sc?.prompt !== 'function') {
    return { ok: false, why: '宿主没有 sessionController.prompt，叫不醒她', waitedMs: 0 }
  }
  const home = await readJson(join(parentRoot, 'home.json'), null)
  const sessionId = String(home?.sessionId ?? '')
  if (!sessionId) {
    return { ok: false, why: '她的家还没有会话（先在侧栏跟她说过话，或者点一次唤醒）', waitedMs: 0 }
  }

  const before = await readParentEvents(parentRoot)
  const known = new Set(before.events.map((e) => e.id))
  const t0 = Number(now)
  const ac = new AbortController()

  try {
    await sc.prompt(
      { requestId: `kin-spoken-${t0}`, sessionId, mode: 'queue', content: [{ type: 'text', text: spokenPrompt() }] },
      ac.signal,
    )
  } catch (err) {
    return { ok: false, why: `这一句没递进去：${String(err?.message ?? err).slice(0, 160)}`, waitedMs: 0 }
  }

  const deadline = Date.now() + Math.max(500, Number(timeoutMs) || SPOKEN_TIMEOUT_MS)
  const started = Date.now()
  while (Date.now() < deadline) {
    await sleep(Math.max(50, Number(pollMs) || SPOKEN_POLL_MS))
    let fresh = []
    try {
      const { events } = await readParentEvents(parentRoot)
      fresh = events.filter((e) => {
        if (!e?.id || known.has(e.id)) return false
        if (tsMs(e) < t0 - 1000) return false
        // 只认她自己写下的判断：日记/旁听/评论都不算"她对她说的那句话"
        return ['utterance', 'revise', 'narration'].includes(String(e.type))
      })
    } catch { /* 读失败就等下一轮，别把一次偶发 I/O 当成"她没说话" */ }

    if (fresh.length) {
      const said = String(fresh[fresh.length - 1].text ?? '').trim()
      if (!said) continue
      const trimmed = countChars(said) > LESSON_MAX
      const text = trimmed ? squeeze(said, LESSON_MAX) : said
      const r = await teach({ parentRoot, kinRoot, childId, texts: [text], now: Date.now(), by: 'spoken' })
      return {
        ...r,
        spoken: said,
        trimmed,
        waitedMs: Date.now() - started,
      }
    }
  }

  return {
    ok: false,
    why: '她这一轮没有写下什么（可能只是说了句话，没有用 growth_commit 落成一条）',
    waitedMs: Date.now() - started,
  }
}
