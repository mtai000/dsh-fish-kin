/**
 * tools/set-cookie.mjs —— 把 B 站登录 cookie 存进她家（0600）
 *
 * 用法：
 *   node tools/set-cookie.mjs "SESSDATA=...; bili_jct=...; DedeUserID=..."
 *   node tools/set-cookie.mjs --clear
 *
 * 从哪里拿：浏览器登录 bilibili.com → F12 → Application → Cookies → 复制
 * SESSDATA、bili_jct、DedeUserID 三项拼成一行。**别把这张图/这串发给人。**
 */
import { pathToFileURL } from 'node:url'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const { writeOwner, clearOwner, readOwner, ownerSummary } = await import(pathToFileURL(join(HERE, '..', 'lib', 'fish', 'owner.js')).href)
const root = process.env.DSH_KIN_FISH_HOME || join(homedir(), '.dsh-fish-kin', 'fish')

const arg = process.argv.slice(2).join(' ').trim()
if (!arg || arg === '--help') {
  console.log('用法: node tools/set-cookie.mjs "SESSDATA=...; bili_jct=...; DedeUserID=..."')
  console.log('  或: node tools/set-cookie.mjs --clear')
  console.log('她家:', root)
  const cur = await readOwner(root)
  console.log('现在:', ownerSummary(cur))
  process.exit(0)
}
if (arg === '--clear') {
  await clearOwner(root)
  console.log('已经清掉凭据。')
  process.exit(0)
}
const r = await writeOwner(root, { cookie: arg })
if (!r.ok) {
  console.error('没存成：', r.why)
  process.exit(1)
}
console.log('存好了 →', join(root, 'owner.json'))
console.log('摘要：', ownerSummary(await readOwner(root)))
