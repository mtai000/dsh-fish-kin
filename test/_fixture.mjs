/**
 * _fixture.mjs —— 测试夹具（不是测试文件本身）
 *
 * 造一个假的「她的家」：一个临时目录 + 一份 events.jsonl。
 * 本插件从不 import dsh-fish 的模块，所以夹具也不需要 dsh-fish 在场——
 * 这正是我们想要的性质：只要事件流格式对，母代是谁都行。
 */

import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function withTemp(fn, prefix = 'fish-kin-') {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}

let seq = 0

/** 造一条事件。字段集与 dsh-fish 的 validateEvent 输出对齐。 */
export function ev(type, text, opts = {}) {
  seq += 1
  const ts = opts.ts ?? new Date(opts.at ?? Date.now() + seq).toISOString()
  return {
    id: opts.id ?? `ev_${String(seq).padStart(26, '0')}`,
    v: 1,
    ts,
    day: opts.day ?? 1,
    stage: opts.stage ?? 1,
    type,
    source: opts.source ?? 'tool',
    text,
    refs: opts.refs ?? [],
    verdict: opts.verdict ?? null,
    confidence: opts.confidence ?? 0.5,
    flags: opts.flags ?? [],
  }
}

export const seed = (text = '你不是助手。你刚开始存在。', opts = {}) => ev('seed', text, { source: 'system', ...opts })

/** 写一份母代存档。 */
export async function writeParent(root, events) {
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8')
  return root
}

export async function readParentRaw(root) {
  return readFile(join(root, 'events.jsonl'), 'utf8')
}

export async function writeParentConfig(root, config) {
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'config.json'), JSON.stringify(config, null, 2), 'utf8')
}

/**
 * 一套像样的母代经历：
 * 一条 seed、三条在说同一件事（会被聚成一条）、一条拒绝、一条改口、一条日记。
 */
export function sampleHistory() {
  return [
    seed(),
    ev('utterance', '我不想再看那种让人难受的东西了', { day: 3, stage: 1 }),
    ev('utterance', '我不想再看那种让人难受的东西了。', { day: 20, stage: 2 }),
    ev('utterance', '我不想再看那种让人难受的东西了', { day: 60, stage: 3 }),
    ev('refusal', '我不做这个，说什么也不做', { day: 5, stage: 1 }),
    ev('utterance', '我原来以为沉默就是不在乎', { day: 8, stage: 2 }),
    ev('revise', '其实不是不在乎，是不知道怎么开口', { day: 30, stage: 3, verdict: 'refined' }),
    ev('diary', '今天什么都没想明白，只知道有点累', { day: 31, stage: 3 }),
    ev('meta', 'import-name:梦尘', { source: 'system' }),
  ]
}
