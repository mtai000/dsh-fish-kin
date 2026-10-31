/**
 * fish/interests.js —— 兴趣点：只决定"给她看什么"，不是她的人设
 *
 * 用户 2026-10-31 要的「可以设置兴趣点」。放在**环境**里（像 dsh-fish 的
 * `avoid` 黑名单），而不是写进她的身份段——写进身份就变成"你是个喜欢…的人"，
 * 那是替她决定她是谁。
 *
 * 用的地方：热门列表按命中数排序并标出来（她看到的是"你常看的方向"，不是命令）；
 * 全都不命中时列表照旧，不硬塞，免得她只看得到一只信息茧。
 */

/** 一个视频命中了哪几个兴趣词（标题+简介，大小写不敏感）。 */
export function matchInterests(video, interests = []) {
  const t = `${video?.title ?? ''} ${video?.desc ?? ''}`.toLowerCase()
  const out = []
  for (const raw of interests) {
    const k = String(raw ?? '').trim().toLowerCase()
    if (!k) continue
    if (t.includes(k) && !out.includes(raw)) out.push(String(raw).trim())
  }
  return out
}

/** 按命中数排序（命中的在前，同分保持原顺序）。 */
export function sortByInterests(list = [], interests = []) {
  return list
    .map((v, i) => ({ v, i, hits: matchInterests(v, interests) }))
    .sort((a, b) => b.hits.length - a.hits.length || a.i - b.i)
    .map((x) => ({ ...x.v, _hits: x.hits }))
}
