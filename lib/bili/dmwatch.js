/**
 * bili/dmwatch.js —— 主人发来的 B 站私信，她可以回一句
 *
 * 纯宿主代码轮询（不花 token）：只有主人本人发来新消息时，才往她的会话里递一句。
 * 默认关；打开后也仍然只回「主人本人」，陌生人一律不回。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sayToHer } from '../fish/home.js'
import { loadBili } from './settings.js'
import { biliPaths, dayKey } from './config.js'
import { loadCred, listSessions, fetchMsgs, myUid } from './dm.js'
import { readJson, writeJson } from './store.js'

function lockBusy(file) {
  try {
    const lock = JSON.parse(readFileSync(file, 'utf8'))
    if (Number(lock?.pid) === process.pid) return false
    if (Number(lock?.ts) > Date.now() - 3 * 60_000) {
      try { process.kill(Number(lock.pid), 0); return true } catch { return false }
    }
  } catch { /* 没锁 / 坏锁 */ }
  try {
    writeFileSync(file, JSON.stringify({ pid: process.pid, ts: Date.now() }), 'utf8')
  } catch { /* 写不了就照跑 */ }
  return false
}

function dmPrompt(text, bv) {
  return [
    `他刚在 B 站私信你：${JSON.stringify(String(text || '').slice(0, 600))}`,
    bv ? `里面有个视频 ${bv}：想回得具体，就用 bili_subtitle 读一下字幕再回。` : '',
    '想回就用 bili_dm_reply 回一句（100 字以内，像聊天；纯文本，不要 markdown / 不要写「多少字」这种说明）。',
    '不想回就不回——没人规定你必须接话。',
    '⚠️ 这是私信，不是公开评论区：别透露账号、路径、你们聊过的别的事。',
  ].filter(Boolean).join('\n')
}

export function startDmWatch(ctx, { root, log = () => {}, everyMs = 60_000 } = {}) {
  let stopped = false
  let busy = false
  let lastPoll = 0
  const p = biliPaths(root)
  const tick = async () => {
    if (stopped || busy) return
    busy = true
    try {
      const cfg = await loadBili(root)
      if (!cfg.share.watch) return
      const everyMsCfg = Math.max(1, Number(cfg.share.watchMinutes) || 3) * 60_000
      if (lastPoll && Date.now() - lastPoll < everyMsCfg) return
      lastPoll = Date.now()
      const cred = loadCred(root)
      if (!cred) return
      if (lockBusy(p.dmLock)) return
      const owner = Number(cfg.share.uid) || myUid(cred)
      if (!owner) { log('B站私信：还不知道主人 UID（先扫码登录，或填分享对象 UID）'); return }
      const sessions = await listSessions(cred)
      const mine = sessions.filter((s) => s.uid === owner && s.unread > 0)
      const others = sessions.filter((s) => s.uid !== owner && s.unread > 0)
      if (others.length) {
        const sig = others.map((s) => `${s.uid}:${s.unread}`).sort().join(',')
        const f = join(p.home, 'dm-others.json')
        const prev = readJson(f, { sig: '' })
        if (prev.sig !== sig) {
          log(`B站私信：有 ${others.length} 个陌生人的未读，按规矩不回`)
          writeJson(f, { sig })
        }
      }
      if (!mine.length) return
      const seen = readJson(p.dmSeen, {})
      const quota = readJson(p.dmQuota, { day: '', n: 0 })
      if (quota.day !== dayKey()) { quota.day = dayKey(); quota.n = 0 }
      for (const s of mine) {
        const msgs = await fetchMsgs(cred, s.uid, 8)
        const last = [...msgs].reverse().find((m) => !m.fromMe)
        if (!last) continue
        if (seen[String(s.uid)] === last.key) continue
        if (Number(cfg.share.replyPerDay) > 0 && quota.n >= Number(cfg.share.replyPerDay)) {
          log(`B站私信：今天回复额度用完了（${quota.n}/${cfg.share.replyPerDay}），这条先不回`)
          continue
        }
        seen[String(s.uid)] = last.key
        writeJson(p.dmSeen, seen)
        const bv = (/BV[0-9A-Za-z]{10}/.exec(String(last.text || '')) || [])[0] || ''
        log(`B站私信：收到主人的新消息「${String(last.text || '').slice(0, 40)}」`)
        const said = await sayToHer(ctx, { root, text: dmPrompt(last.text, bv) })
        if (said.ok) {
          quota.n++
          writeJson(p.dmQuota, quota)
        } else {
          // 没递进会话：把 seen 撤回，下一跳再试
          delete seen[String(s.uid)]
          writeJson(p.dmSeen, seen)
          log(`B站私信：没能递进她的会话（${said.why}）`)
        }
      }
    } catch (e) {
      log(`B站私信监听出错（已兜住）：${String(e?.message ?? e)}`)
    } finally {
      busy = false
    }
  }
  const timer = setInterval(tick, Math.max(60_000, everyMs))
  timer.unref?.()
  const kick = setTimeout(tick, 30_000)
  kick.unref?.()
  log('B站私信监听已挂上（是否真监听看设置里的开关）')
  return () => {
    stopped = true
    try { clearInterval(timer) } catch { /* ignore */ }
    try { clearTimeout(kick) } catch { /* ignore */ }
  }
}
