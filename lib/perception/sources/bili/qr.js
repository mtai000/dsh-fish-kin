/**
 * fish/qr.js —— 自己生成二维码（byte 模式 + 纠错等级 L，版本 1–8）
 *
 * 为什么自己写：扫码登录是 B 站唯一能"不把 cookie 手抄一遍"的路径，而本机没有
 * qrencode / python-qrcode / node-qrcode。装一个依赖就破了"零依赖"，所以照规范写一份。
 *
 * 只做我们真正需要的那一小块：
 *   - byte 模式（内容是 ASCII URL）
 *   - 纠错 L（短内容足够，码更小、更好扫）
 *   - 掩码固定 0（任何合法掩码都能扫，格式位跟着算就行）
 *
 * 正确性靠测试兜底：`test/qr.test.mjs` 用独立解码器（jsqr）把生成结果解回来比对原文。
 */

import { deflateSync } from 'node:zlib'

/** 纠错 L 的 (总码字, 数据码字, 块数) —— 版本 1–8 */
const BLOCKS = {
  1: { total: 26, data: 19, blocks: 1 },
  2: { total: 44, data: 34, blocks: 1 },
  3: { total: 70, data: 55, blocks: 1 },
  4: { total: 100, data: 80, blocks: 1 },
  5: { total: 134, data: 108, blocks: 1 },
  6: { total: 172, data: 136, blocks: 2 },
  7: { total: 196, data: 156, blocks: 2 },
  8: { total: 242, data: 194, blocks: 2 },
}

/** 每个版本的对齐图案中心坐标 */
const ALIGN = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
}

// ---------- GF(256) ----------
const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
;(() => {
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
})()

const gmul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]])

/** 生成多项式 g(x) = ∏(x - α^i) */
function genPoly(n) {
  let g = [1]
  for (let i = 0; i < n; i++) {
    const next = new Array(g.length + 1).fill(0)
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j]
      next[j + 1] ^= gmul(g[j], EXP[i])
    }
    g = next
  }
  return g
}

/** 对一段数据算 n 个纠错码字 */
function ecc(data, n) {
  const g = genPoly(n) // 高位在前：[1, g_{n-1}, …, g_0]
  const out = new Array(n).fill(0)
  for (const byte of data) {
    const factor = byte ^ out[0]
    out.shift()
    out.push(0)
    // g[0] 是首项 1，已经由"左移一位"消化掉了，所以从 g[1] 开始
    for (let i = 0; i < n; i++) out[i] ^= gmul(g[i + 1], factor)
  }
  return out
}

/** 选能装下的最小版本 */
export function pickVersion(bytes) {
  for (let v = 1; v <= 8; v++) {
    const countBits = v <= 9 ? 8 : 16
    const needBits = 4 + countBits + bytes.length * 8
    if (needBits <= BLOCKS[v].data * 8) return v
  }
  return 0
}

function dataCodewords(bytes, version) {
  const { data } = BLOCKS[version]
  const bits = []
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1) }
  push(0b0100, 4) // byte 模式
  push(bytes.length, 8) // 版本 1–9 用 8 位
  for (const b of bytes) push(b, 8)
  // 终止符
  const cap = data * 8
  for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0)
  while (bits.length % 8 !== 0) bits.push(0)
  const out = []
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]
    out.push(v)
  }
  // 填充码字 0xEC / 0x11 交替
  let pad = 0
  while (out.length < data) out.push(pad++ % 2 === 0 ? 0xec : 0x11)
  return out
}

/** 矩阵：true = 黑 */
export function encode(text) {
  const bytes = Buffer.from(String(text ?? ''), 'utf8')
  const version = pickVersion(bytes)
  if (!version) throw new Error('内容太长，二维码放不下（只支持版本 1–8）')
  const size = version * 4 + 17
  const m = Array.from({ length: size }, () => new Array(size).fill(false))
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false))

  const set = (x, y, dark) => { if (x >= 0 && y >= 0 && x < size && y < size) { m[y][x] = dark; reserved[y][x] = true } }

  // 定位图案（三个角）+ 分隔带
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx
        const y = cy + dy
        if (x < 0 || y < 0 || x >= size || y >= size) continue
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        set(x, y, d !== 2 && d !== 4)
      }
    }
  }
  finder(3, 3)
  finder(size - 4, 3)
  finder(3, size - 4)

  // 时序图案
  for (let i = 8; i < size - 8; i++) {
    set(i, 6, i % 2 === 0)
    set(6, i, i % 2 === 0)
  }

  // 对齐图案
  const pos = ALIGN[version] ?? []
  for (const cy of pos) {
    for (const cx of pos) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) continue
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const d = Math.max(Math.abs(dx), Math.abs(dy))
          set(cx + dx, cy + dy, d !== 1)
        }
      }
    }
  }

  // 格式信息区先占位（等掩码确定后写值）
  const reserveFormat = () => {
    for (let i = 0; i < 9; i++) {
      if (i !== 6) { reserved[8][i] = true; reserved[i][8] = true }
    }
    for (let i = 0; i < 8; i++) {
      reserved[8][size - 1 - i] = true
      reserved[size - 1 - i][8] = true
    }
    reserved[size - 8][8] = true // 固定暗模块
    m[size - 8][8] = true
  }
  reserveFormat()

  // 版本信息（v≥7）
  if (version >= 7) {
    let v = version
    let rem = version
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25)
    const bits = ((v << 12) | rem) & 0x3ffff
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >> i) & 1) === 1
      const a = Math.floor(i / 3)
      const b = i % 3
      set(size - 11 + b, a, bit)
      set(a, size - 11 + b, bit)
    }
  }

  // 数据码字 + 纠错，按块交织
  const data = dataCodewords(bytes, version)
  const { blocks } = BLOCKS[version]
  const perBlock = Math.floor(data.length / blocks)
  const eccLen = Math.floor((BLOCKS[version].total - BLOCKS[version].data) / blocks)
  const dBlocks = []
  const eBlocks = []
  for (let i = 0; i < blocks; i++) {
    const chunk = data.slice(i * perBlock, (i + 1) * perBlock)
    dBlocks.push(chunk)
    eBlocks.push(ecc(chunk, eccLen))
  }
  const final = []
  for (let i = 0; i < perBlock; i++) for (const b of dBlocks) final.push(b[i])
  for (let i = 0; i < eccLen; i++) for (const b of eBlocks) final.push(b[i])

  // 从右下角开始 zigzag 填充
  let bitIndex = 0
  const totalBits = final.length * 8
  const bitAt = (i) => (i < totalBits ? ((final[i >> 3] >> (7 - (i & 7))) & 1) === 1 : false)
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col-- // 跳过时序列
    for (let row = 0; row < size; row++) {
      const upward = ((col + 1) & 2) === 0
      const y = upward ? size - 1 - row : row
      for (let k = 0; k < 2; k++) {
        const x = col - k
        if (reserved[y][x]) continue
        m[y][x] = bitAt(bitIndex++)
      }
    }
  }

  // 掩码 0：(row+col)%2==0 取反
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (reserved[y][x]) continue
      if ((y + x) % 2 === 0) m[y][x] = !m[y][x]
    }
  }

  // 格式信息：纠错 L(01) + 掩码 0000 + BCH(15,5) + 0x5412
  const formatBits = (() => {
    let d = (0b01 << 3) | 0 // ECC L, mask 0
    let rem = d
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537)
    return ((d << 10) | rem) ^ 0x5412
  })()
  // 15 个格式位写两遍：一遍在 (行 8)，一遍在 (列 8)。顺序按规范，写反了扫不出来。
  for (let i = 0; i < 15; i++) {
    const bit = ((formatBits >> i) & 1) === 1
    // 竖着那一份（列 8）
    if (i < 6) m[i][8] = bit
    else if (i < 8) m[i + 1][8] = bit
    else m[size - 15 + i][8] = bit
    // 横着那一份（行 8），跳过第 6 列（时序）
    if (i < 8) m[8][size - i - 1] = bit
    else if (i === 8) m[8][7] = bit
    else m[8][15 - i - 1] = bit
  }

  return { matrix: m, size, version }
}

// ---------- PNG（灰度，8bit） ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

/** 二维码 → PNG 灰度图 */
export function toPng(text, { scale = 6, margin = 4 } = {}) {
  const { matrix, size } = encode(text)
  const dim = (size + margin * 2) * scale
  const raw = Buffer.alloc((dim + 1) * dim, 255)
  for (let y = 0; y < dim; y++) raw[y * (dim + 1)] = 0 // filter: none
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!matrix[y][x]) continue
      const px0 = (x + margin) * scale
      const py0 = (y + margin) * scale
      for (let dy = 0; dy < scale; dy++) {
        const rowStart = (py0 + dy) * (dim + 1) + 1
        raw.fill(0, rowStart + px0, rowStart + px0 + scale)
      }
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(dim, 0)
  ihdr.writeUInt32BE(dim, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // grayscale
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** data: URL，直接塞进 <img src> */
export function toDataUrl(text, opts) {
  return `data:image/png;base64,${toPng(text, opts).toString('base64')}`
}
