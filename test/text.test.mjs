/**
 * text.test.mjs —— 相似度、裁剪、路径归一
 *
 * 相似度是「同一件事被说了几次」的唯一判据。它错一次，遗传包里就会
 * 多出一条重复的"知识"或者少掉一条她真的一直在说的事。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { similarity, squeeze, clip, normPath, countChars, firstSentence, tidyLine } from '../lib/text.js'

test('同句相似度为 1（标点与空白不影响）', () => {
  assert.equal(similarity('我不想再看这种视频了', '我不想再看这种视频了。'), 1)
  assert.equal(similarity(' 我不想 再看这种视频了 ', '我不想再看这种视频了'), 1)
})

test('换语序仍然是同一件事', () => {
  assert.ok(similarity('我不想再看这种视频了', '这种视频我不想看') > 0.4)
})

test('不相干的两句不该被合并', () => {
  assert.ok(similarity('今天什么都没想明白', '我不做这个，说什么也不做') < 0.1)
  assert.equal(similarity('', '任意'), 0)
})

test('squeeze 不超过给定字数，且尽量断在句读', () => {
  const long = '我不想再看那种让人难受的东西了，真的不想了。后面还有一句。'
  const out = squeeze(long, 12)
  assert.ok(countChars(out) <= 12)
  assert.ok(out.endsWith('…') || out.length <= 12)
  assert.equal(squeeze('短句', 40), '短句')
})

test('clip / firstSentence / tidyLine', () => {
  assert.equal(clip('abcdef', 3), 'ab…')
  assert.equal(firstSentence('第一句。第二句。'), '第一句。')
  assert.equal(tidyLine('- 「我不想看」'), '我不想看')
  assert.equal(countChars('中文'), 2)
})

test('normPath 抹平盘符大小写与斜杠方向', () => {
  assert.equal(normPath('D:\\DSH\\fish\\'), normPath('d:/dsh/fish'))
  assert.notEqual(normPath('D:/a'), normPath('D:/b'))
})
