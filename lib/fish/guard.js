/**
 * fish/guard.js —— 她写出去的东西过一遍筛子（秘密与"改自己"）
 *
 * 这一层只管**文字**，不管工具（工具由 restrict.js 管）。两道：
 *   1. **秘密**：`sk-…`、`Bearer …`、`SESSDATA=`、长 base64 —— 一律不让写进事件流。
 *      理由很直接：事件流会被备份、会被分享、会被我们的族谱读；凭据一旦写进去就洗不掉。
 *   2. **改自己**：她当然可以改口（amend），但不能靠一句话重写自己的人格。
 *      命中只**记录、不拦截**（那是她自己的话，拦了就是篡改），但要留痕。
 *
 * 刻意不做：内容过滤、政治/情绪分析、"说得对不对"。我们只挡凭据。
 */

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{16,}/,
  /Bearer\s+[A-Za-z0-9._-]{12,}/i,
  /(?:SESSDATA|bili_jct|access_token|api[_-]?key)\s*[=:]\s*[A-Za-z0-9%._-]{1,}/i,
  /[A-Za-z0-9+/]{80,}={0,2}/,
]

/** 一句话里有没有凭据。 */
export function looksLikeSecret(text) {
  const s = String(text ?? '')
  return SECRET_PATTERNS.some((re) => re.test(s))
}

/** 把命中的凭据打码（日志用，绝不把原样写出去）。 */
export function scrub(text) {
  let s = String(text ?? '')
  s = s.replace(/sk-[A-Za-z0-9_-]{16,}/g, 'sk-***')
  s = s.replace(/(Bearer\s+)[A-Za-z0-9._-]{12,}/gi, '$1***')
  s = s.replace(/((?:SESSDATA|bili_jct|access_token|api[_-]?key)\s*[=:]\s*)[A-Za-z0-9%._-]+/gi, '$1***')
  s = s.replace(/[A-Za-z0-9+/]{80,}={0,2}/g, '***')
  return s
}

/** 她是不是在试着"把自己改成另一个人"。只记录，不拦。 */
export function looksLikeSelfRewrite(text) {
  const s = String(text ?? '')
  return /(把我|替我|给你自己)(改|调|设|换)(得|成|一下)|(修改|重设|改写)你(自己)?的?(性格|设定|参数|人设)|你以后(要|应该)?(更|别那么)(外向|内向|黏人|冷淡|活泼|安静)/.test(s)
}

/**
 * 她提交一段文字时的总闸。
 * @returns {{ok:boolean, why:string, secret:boolean, selfMod:boolean}}
 */
export function screenHerWrite(text) {
  const s = String(text ?? '')
  const secret = looksLikeSecret(s)
  return {
    ok: !secret,
    why: secret ? '这段里有凭据（密钥/令牌/cookie 之类），不能写进记忆' : '',
    secret,
    selfMod: looksLikeSelfRewrite(s),
  }
}
