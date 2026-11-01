/**
 * bili/allow.js —— 她不用问就能用的 B 站工具
 *
 * 只放"读 + 记 + 分享"：
 *   · 读：搜索 / 推荐 / 字幕 / 评论 / 详情 / 弹幕 / 封面 / 帧 / 判重 / 日报
 *   · 记：判重表 / 日报（路径由宿主定死，不接受参数）
 *   · 分享：bili_share —— 发不发私信由设置里的 share.mode 决定
 * 公开评论（bili_reply）与私信回复（bili_dm_reply）只在对应开关打开时才放行；
 * 装环境 / 扫码登录 / 改配置这些主人工具**永远不自动放行**。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const BILI_FREE_READ = Object.freeze([
  'bili_search',
  'bili_recommend',
  'bili_subtitle',
  'bili_comments',
  'bili_video_info',
  'bili_danmaku',
  'bili_cover',
  'bili_frames',
  'bili_seen_recent',
  'bili_replies',
  'bili_report_read',
  'bili_today',
  'bili_status',
  'bili_whoami',
  'bili_transcribe_start',
  'bili_transcribe_result',
])

export const BILI_FREE_WRITE = Object.freeze([
  'bili_seen_append',
  'bili_report_append',
  'bili_share',
])

/** 同步读一下她的 bili 配置（守卫生卫是同步回调）。 */
export function biliConfigSync(root) {
  try { return JSON.parse(readFileSync(join(String(root), 'config.json'), 'utf8'))?.bili ?? {} } catch { return {} }
}

export function freeBiliTools(root) {
  const cfg = biliConfigSync(root)
  if (cfg?.enabled === false) return []
  const out = new Set([...BILI_FREE_READ, ...BILI_FREE_WRITE])
  if (cfg?.comment?.enabled === true && String(cfg?.comment?.mention ?? '').trim()) out.add('bili_reply')
  if (cfg?.share?.watch === true) out.add('bili_dm_reply')
  return [...out]
}

export function isFreeBiliTool(root, name) {
  return freeBiliTools(root).includes(String(name ?? ''))
}
