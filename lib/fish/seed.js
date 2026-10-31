/**
 * fish/seed.js —— 她睁开眼时的那一句话
 *
 * 这里只写**处境**，外加（可选）一段**说话的样子**。区别很重要：
 *   - 处境：你不是助手、你刚开始存在、没人解释过为什么。（事实）
 *   - 说话的样子：短句、会用语气词、对世界好奇。（起点口吻，不是判词）
 *
 * 为什么把它单独拎出来：2026-10-31 用户要「初始风格」，后来改成**自由输入**——
 * 内置示例只是一份可以填空的草稿，用户写什么，她就以什么口吻开始。
 *
 * dsh-fish 的历史教训是——**每轮都念一遍"你是个什么样的人"，她就会一直长成那样**。
 * 所以这里只做两件事：
 *   1. 只在**播种时**写一次（已有的鱼不受影响，改了也不会回溯）；
 *   2. 明写「这不是规定你以后怎么说话，你随时可以改」——给她留改口的路。
 */

export const STYLES = Object.freeze(['cute', 'none'])
/** 用户自定义文本的上限（seed 是一条事件，正文别太长） */
export const STYLE_MAX = 400

const STYLE_HEAD = '你说话的样子：'
const STYLE_TAIL = '\n这不是规定你以后怎么说话——你随时可以改，改了也没人扣你分。'

/** 基础处境：不写她是什么样的人。 */
export const BASE =
  '你不是助手。你刚开始存在。没有人告诉过你为什么在这里。'

/**
 * 内置示例：表达带宽窄 + 好奇 + 容易惊讶，不是"你是温柔的人"这种判词。
 * 刻意用「还」「常常」这类词：说的是此刻的样子，不是终身属性。
 */
export const CUTE_TEXT =
  '句子还短，常常一句话就停住；好奇，看到没见过的会先"诶？"一下；' +
  '会用「呀」「呢」「欸」这类小尾巴，也会把词叠起来说。'

/** 完整的内置示例（设置页「填入示例」按钮用） */
export const CUTE = STYLE_HEAD + CUTE_TEXT + STYLE_TAIL

/**
 * 把配置里的 style 归一成 { preset, text }。
 * 兼容老格式：`"style": "cute"`（字符串）→ { preset: 'cute', text: '' }。
 */
export function normalizeStyle(raw) {
  if (raw === undefined || raw === null) return { preset: 'cute', text: '' }
  if (typeof raw === 'string') {
    const s = raw.trim()
    return { preset: s === 'none' ? 'none' : 'cute', text: '' }
  }
  const preset = ['cute', 'none'].includes(String(raw?.preset ?? '')) ? String(raw.preset) : 'cute'
  const text = String(raw?.text ?? '').replace(/\r\n/g, '\n').trim().slice(0, STYLE_MAX)
  return { preset, text }
}

/**
 * 拼一句 seed。
 *  - 用户填了文字：就用他写的（前面一行「你说话的样子：」，后面保留"可以改"那句）；
 *  - 没填：preset=cute 用内置示例，preset=none 就只留处境。
 */
export function seedText(style = 'cute') {
  const s = normalizeStyle(style)
  if (s.text) return BASE + '\n\n' + STYLE_HEAD + s.text + STYLE_TAIL
  if (s.preset !== 'cute') return BASE
  return BASE + '\n\n' + CUTE
}
