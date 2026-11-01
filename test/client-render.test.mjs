/**
 * client-render.test.mjs —— 设置页组件必须能渲染（0.20.0 翻过一次车）
 *
 * 背景：删内建 B 站时，顺带删掉了组件里给「生物钟」「传承」用的派生变量
 * （wake / win / birth / pressure / …），组件一渲染就抛 ReferenceError，
 * 宿主那边看到的就是**设置页空白**——构建、语法检查、单元测试全都发现不了，
 * 因为它们不会真的把组件跑起来。
 *
 * 这个测试用一个极小的 React 假实现把组件跑一遍：
 *   - 所有页签的树都是**急切构建**的，所以跑一次就覆盖全部页签；
 *   - 谁删了变量、写错了名字，这里立刻炸。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

function loadClient() {
  const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
    useEffect: () => {},
    useCallback: (f) => f,
    useRef: (v) => ({ current: v }),
  }
  let mod = null
  const window = { __ModuleLoader__: { load: (m) => { mod = m } } }
  const ctx = {
    window,
    require: () => React,
    location: { origin: 'http://127.0.0.1:1' },
    fetch: async () => ({ json: async () => ({ ok: false }) }),
    console,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
  }
  vm.createContext(ctx)
  vm.runInContext(src, ctx)
  assert.ok(mod, '模块没有被注册到 __ModuleLoader__')
  return mod.factory(() => React)
}

function walkCount(t) {
  if (t == null || typeof t !== 'object') return 0
  return 1 + (t.children ?? []).reduce((n, c) => n + walkCount(c), 0)
}

test('设置页组件能渲染（不会因为少个变量就空白）', () => {
  const exports = loadClient()
  assert.equal(typeof exports.KinSection, 'function')
  const tree = exports.KinSection()
  assert.ok(tree, '组件返回空')
  assert.ok(walkCount(tree) > 10, '渲染出来的节点太少，八成是某个页签炸了')
})

test('「刷过的视频」会话视图能渲染', () => {
  const exports = loadClient()
  assert.equal(typeof exports.BiliSeenView, 'function')
  const tree = exports.BiliSeenView()
  assert.ok(tree, '会话视图返回空')
  assert.ok(walkCount(tree) > 3, '会话视图节点太少')
})

test('组件导出了宿主需要的 apply / inject', () => {
  const exports = loadClient()
  assert.equal(typeof exports.apply, 'function')
  assert.deepEqual([...exports.inject], ['slots'])
})
