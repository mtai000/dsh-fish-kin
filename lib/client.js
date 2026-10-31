/**
 * client.js —— 设置页里的「大肥鱼·传承」（分页签）
 *
 * 照 dsh-bili-scroll 的做法：**页签 + 每组一块 + 改完点保存**。
 * 页面：她 / 生物钟 / B 站 / 传承 / 进阶。
 *
 * 红线不变：没有一格指向她本人——没有人格、没有关系数值、没有"让她听话"的开关。
 * 改的都是**生长环境**（几点醒、能看什么、几次、继承多少、要不要报喜）。
 */

const MODULE = ({
  id: 'dsh-fish-kin',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { createElement: h, useCallback, useEffect, useState } = React

    const KIN = '/dsh-fish-kin'
    const OBS = '/dsh-fish-obs'
    const TABS = ['她', '生物钟', 'B 站', '传承', '进阶']
// 设置页里的示例草稿（与 lib/fish/seed.js 的 CUTE_TEXT 同义；客户端不能 require 服务端模块）
const EXAMPLE_STYLE = '句子还短，常常一句话就停住；好奇，看到没见过的会先"诶？"一下；会用「呀」「呢」「欸」这类小尾巴，也会把词叠起来说。'

    const S = {
      wrap: { display: 'flex', flexDirection: 'column', gap: 12, color: 'var(--dsw-alias-label-primary)' },
      h2: { margin: 0, fontSize: 16, fontWeight: 500, lineHeight: '24px' },
      sub: { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: 12.5, lineHeight: '19px' },
      tabs: { display: 'flex', gap: 6, flexWrap: 'wrap' },
      tab: { border: '.5px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'inherit', borderRadius: 999, padding: '3px 12px', cursor: 'pointer', fontSize: 12.5 },
      tabOn: { border: '.5px solid var(--dsw-alias-border-l2)', background: 'color-mix(in srgb, currentColor 12%, transparent)', color: 'inherit', borderRadius: 999, padding: '3px 12px', cursor: 'pointer', fontSize: 12.5 },
      card: { border: '.5px solid var(--dsw-alias-border-l2)', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 },
      h3: { margin: 0, fontSize: 12, fontWeight: 600, letterSpacing: '.06em', color: 'var(--dsw-alias-label-tertiary)' },
      row: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 13, lineHeight: '20px' },
      col: { display: 'flex', flexDirection: 'column', gap: 10 },
      btn: { border: '.5px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'inherit', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: 12.5 },
      btnPri: { border: '.5px solid var(--dsw-alias-border-l2)', background: 'color-mix(in srgb, currentColor 10%, transparent)', color: 'inherit', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: 12.5 },
      input: { border: '.5px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'inherit', borderRadius: 6, padding: '3px 8px', fontSize: 12.5, width: 76 },
      inputSm: { border: '.5px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'inherit', borderRadius: 6, padding: '3px 8px', fontSize: 12.5, width: 56 },
      wide: { border: '.5px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'inherit', borderRadius: 6, padding: '4px 8px', fontSize: 12.5, width: '100%' },
      mono: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 },
      dim: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12.5 },
    }

    async function req(path, init) {
      const r = await fetch(path, init)
      try { return await r.json() } catch { return { ok: false, why: 'HTTP ' + r.status } }
    }
    const post = (path, body) => req(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })

    function Num({ value, onChange, min = 0, max = 999, step = 1 }) {
      return h('input', {
        style: S.inputSm, type: 'number', min, max, step,
        value: Number.isFinite(Number(value)) ? Number(value) : 0,
        onChange: (e) => onChange(Number(e.target.value)),
      })
    }
    function Check({ checked, onChange, label }) {
      return h('label', { style: S.row },
        h('input', { type: 'checkbox', checked: checked !== false, onChange: (e) => onChange(e.target.checked) }),
        h('span', null, label))
    }

    function KinSection() {
      const [tab, setTab] = useState('她')
      const [fish, setFish] = useState(null)
      const [approvals, setApprovals] = useState([])
      const [owner, setOwner] = useState(null)
      const [f, setF] = useState(null)
      const [k, setK] = useState(null)
      const [interests, setInterests] = useState('')
      const [tools, setTools] = useState('')
      const [topics, setTopics] = useState('')
      const [exclude, setExclude] = useState('')
      const [offNow, setOffNow] = useState(null)
      const [ws, setWs] = useState(null)
      const [wsPath, setWsPath] = useState('')
      const [styleText, setStyleText] = useState('')
      const [styleBlank, setStyleBlank] = useState(false)
      const [report, setReport] = useState(null)
      const [qr, setQr] = useState(null)
      const [qrStatus, setQrStatus] = useState('')
      const [msg, setMsg] = useState('')

      const refresh = useCallback(async () => {
        const [s, a, c, kc, o] = await Promise.all([
          req(OBS + '/api/state').catch(() => null),
          req(KIN + '/api/approvals').catch(() => null),
          req(KIN + '/api/fish-config').catch(() => null),
          req(KIN + '/api/config').catch(() => null),
          req(KIN + '/api/owner').catch(() => null),
        ])
        if (s?.ok) setFish(s)
        const off = await req(KIN + '/api/fish/offpeak').catch(() => null)
        if (off?.ok) setOffNow(off)
        const w = await req(KIN + '/api/workspace').catch(() => null)
        if (w?.ok) { setWs(w); setWsPath(w.familyRoot) }
        if (c?.ok) {
          const st = c.config?.style
          if (st && typeof st === 'object') { setStyleText(String(st.text ?? '')); setStyleBlank(st.preset === 'none') }
          else { setStyleText(''); setStyleBlank(String(st ?? 'cute') === 'none') }
        }
        if (a?.ok) setApprovals(a.pending ?? [])
        if (c?.ok) {
          setF(c.config)
          setInterests((c.config?.bili?.interests ?? []).join('、'))
          setTools((c.config?.tools?.allow ?? []).join(', '))
          setTopics((c.config?.bili?.prefs?.topics ?? []).join('、'))
          setExclude((c.config?.bili?.prefs?.exclude ?? []).join('、'))
        }
        if (kc?.ok) setK(kc.config)
        if (o?.ok) setOwner(o)
      }, [])

      useEffect(() => { refresh() }, [refresh])

      const patchF = (part) => setF((cur) => ({ ...(cur ?? {}), ...part }))
      const patchBili = (part) => setF((cur) => ({ ...(cur ?? {}), bili: { ...(cur?.bili ?? {}), ...part } }))
      const patchWatch = (part) => setF((cur) => ({ ...(cur ?? {}), bili: { ...(cur?.bili ?? {}), watch: { ...(cur?.bili?.watch ?? {}), ...part } } }))
      const patchWake = (part) => setF((cur) => ({ ...(cur ?? {}), wake: { ...(cur?.wake ?? {}), ...part } }))
      const patchK = (group, part) => setK((cur) => ({ ...(cur ?? {}), [group]: { ...(cur?.[group] ?? {}), ...part } }))

      const saveFish = useCallback(async (patch) => {
        const r = await post(KIN + '/api/fish-config', { patch })
        setMsg(r?.ok ? '存好了，下一轮生效' : (r?.why ?? '没存成'))
        if (r?.ok) { setF(r.config); await refresh() }
      }, [refresh])

      const saveKin = useCallback(async (patch) => {
        const r = await post(KIN + '/api/config', patch)
        setMsg(r?.ok ? '存好了' : (r?.why ?? '没存成'))
        if (r?.ok) { setK(r.config); await refresh() }
      }, [refresh])

      const wakeNow = useCallback(async () => {
        const r = await post(KIN + '/api/fish/wake', {})
        setMsg(r?.ok ? '叫醒她了' : (r?.why ?? '叫不醒'))
        await refresh()
      }, [refresh])

      const decide = useCallback(async (id, verdict) => {
        const r = await post(KIN + '/api/approvals/' + verdict, { id })
        setMsg(r?.ok ? (verdict === 'approve' ? (r.text || '办了') : '驳掉了') : (r?.why || r?.text || '没成'))
        await refresh()
      }, [refresh])

      const bili = f?.bili ?? {}
      const wake = f?.wake ?? {}
      const w = { videos: 3, scrollPerDay: 1, commentPerDay: 2, replyPerDay: 2, ...bili }
      const watch = { cols: 3, rows: 3, scale: 360, reuseDays: 7, ...(bili.watch ?? {}) }
      const prefs = { topics: [], exclude: [], searchSort: 'hot', ...(bili.prefs ?? {}) }
      const offpeak = { mode: 'propose', windows: ['noon', 'night'], ...(bili.offpeak ?? {}) }
      const interact = { onlyOnTopic: false, ...(bili.interact ?? {}) }
      const dm = { mode: 'propose', uid: '', daily: false, ...(bili.dm ?? {}) }
      const splitWords = (x) => String(x ?? '').split(/[、,，\s]+/).map((t) => t.trim()).filter(Boolean).slice(0, 8)
      const birth = k?.birth ?? {}
      const pressure = k?.pressure ?? {}
      const teach = k?.teach ?? {}
      const presence = k?.presence ?? {}
      const auto = k?.auto ?? {}
      const win = wake.window ?? ['09:00', '23:00']
      const startQr = useCallback(async () => {
        const r = await req(KIN + '/api/fish/login/qr').catch((e) => ({ ok: false, why: String(e?.message ?? e) }))
        if (!r?.ok) { setQrStatus(r?.why ?? '拿不到二维码'); return }
        setQr(r)
        setQrStatus('用 B 站 App 扫这张码')
        let tries = 0
        const timer = setInterval(async () => {
          tries += 1
          if (tries > 90) { clearInterval(timer); setQrStatus('二维码过期了，再点一次'); setQr(null); return }
          const p = await req(KIN + '/api/fish/login/poll?key=' + encodeURIComponent(r.key)).catch(() => null)
          if (!p) return
          if (p.status === 'scanned') setQrStatus('扫到了，在手机上点「确认登录」')
          if (p.status === 'expired') { clearInterval(timer); setQr(null); setQrStatus('过期了，再点一次') }
          if (p.status === 'done') {
            clearInterval(timer); setQr(null)
            setQrStatus('登录成功' + (p.name ? '：' + p.name : ''))
            await refresh()
          }
          if (p.status === 'error') { clearInterval(timer); setQrStatus(p.why || '登录失败') }
        }, 2000)
      }, [refresh])

      const tabBtn = (name) => h('button', {
        key: name, style: tab === name ? S.tabOn : S.tab, onClick: () => { setTab(name); setMsg('') },
      }, name)

      const card = (title, children) => h('div', { style: S.card }, h('h3', { style: S.h3 }, title), children)

      const pageHer = h('div', { style: S.col },
        card('她现在', h('div', { style: S.col },
          fish
            ? h('div', { style: S.row },
                h('span', null, '第 ' + fish.day + ' 天'),
                h('span', null, '阶段：' + (fish.growth?.name ?? '-')),
                h('span', null, '判断 ' + (fish.counts?.beliefs ?? 0)),
                h('span', null, '拒绝 ' + (fish.counts?.refusals ?? 0)),
                h('span', null, '日记 ' + (fish.counts?.diaries ?? 0)),
                h('span', null, '事件 ' + (fish.counts?.events ?? 0) + ' / ' + (fish.counts?.chars ?? 0) + ' 字'))
            : h('p', { style: S.dim }, '读不到她的状态（重启过一次了吗？）'),
          fish?.quota ? h('p', { style: S.dim }, '今天：' + fish.quota) : null,
          h('div', { style: S.row },
            h('button', { style: S.btnPri, onClick: wakeNow }, '叫醒她一次'),
            h('button', { style: S.btn, onClick: refresh }, '刷新'),
            h('span', { style: S.dim }, '立刻递一句处境给她，不等生物钟（花她一个回合）')))),
        card('待批准（B 站上的事）', approvals.length
          ? h('div', { style: S.col }, approvals.map((a) => h('div', { key: a.id, style: { ...S.row, justifyContent: 'space-between' } },
              h('div', null,
                h('div', null, a.title || a.kind),
                a.detail ? h('div', { style: S.dim }, '「' + a.detail + '」') : null,
                h('div', { style: { ...S.dim, ...S.mono } }, a.id)),
              h('div', { style: { display: 'flex', gap: 6 } },
                h('button', { style: S.btnPri, onClick: () => decide(a.id, 'approve') }, '批准'),
                h('button', { style: S.btn, onClick: () => decide(a.id, 'reject') }, '驳回')))))
          : h('p', { style: S.dim }, '她没有等你点头的事。')),
        card('最近的事', fish?.recent?.length
          ? h('div', { style: S.col }, fish.recent.slice(0, 6).map((e, i) => h('div', { key: i, style: S.row },
              h('span', { style: S.dim }, new Date(e.at).toLocaleString('zh-CN', { hour12: false })),
              h('span', { style: S.mono }, e.kind),
              h('span', { style: { flex: 1 } }, String(e.text).slice(0, 60)))))
          : h('p', { style: S.dim }, '还没有事件。')))

      const pageWake = h('div', { style: S.col },
        card('生物钟', h('div', { style: S.col },
          Check({ checked: wake.enabled !== false, onChange: (v) => patchWake({ enabled: v }), label: '开着（关掉她就只在你找她时存在）' }),
          h('div', { style: S.row }, h('span', null, '每天醒'), Num({ value: wake.perDay ?? 2, min: 0, max: 6, onChange: (v) => patchWake({ perDay: v }) }), h('span', null, '次')),
          h('div', { style: S.row }, h('span', null, '时间窗'),
            h('input', { style: S.input, value: win[0], onChange: (e) => patchWake({ window: [e.target.value, win[1]] }) }),
            h('span', null, '–'),
            h('input', { style: S.input, value: win[1], onChange: (e) => patchWake({ window: [win[0], e.target.value] }) })),
          h('p', { style: S.dim }, '按记忆算压力、不按日历；这条改的是她醒来的节奏，不是她的年纪。'),
          h('div', { style: S.row }, h('button', { style: S.btnPri, onClick: () => saveFish({ wake: { enabled: wake.enabled !== false, perDay: Number(wake.perDay ?? 2), window: win } }) }, '保存')))))

      const pageBili = h('div', { style: S.col },
        card('登录（要在 B 站说话才需要，看视频不用）', h('div', { style: S.col },
          owner?.logged
            ? h('div', { style: { ...S.row, justifyContent: 'space-between' } },
                h('div', null,
                  h('div', null, '已登录' + (owner.name ? '：' + owner.name : '')),
                  h('div', { style: { ...S.dim, ...S.mono } }, owner.cookie)),
                h('div', { style: { display: 'flex', gap: 6 } },
                  h('button', { style: S.btn, onClick: startQr }, '换一个号')))
            : null,
          qr
            ? h('div', { style: S.col },
                h('img', { src: qr.qr, alt: '登录二维码', style: { width: 220, height: 220, imageRendering: 'pixelated', background: '#fff', borderRadius: 8 } }),
                h('p', { style: S.dim }, qrStatus))
            : h('div', { style: S.row },
                h('button', { style: S.btnPri, onClick: startQr }, owner?.logged ? '扫码换号' : '扫码登录'),
                h('span', { style: S.dim }, qrStatus || '用 B 站 App 扫，登录成功会自动存下来（owner.json，0600）')),
          h('p', { style: S.dim }, '不想扫码也可以命令行：node tools/set-cookie.mjs "SESSDATA=…; bili_jct=…; DedeUserID=…"；清掉用 --clear。'))),

        card('看', h('div', { style: S.col },
          Check({ checked: bili.enabled !== false, onChange: (v) => patchBili({ enabled: v }), label: '允许她去 B 站（关掉连看都不行）' }),
          h('div', { style: S.row }, h('span', null, '每天看'), Num({ value: w.videos, min: 1, max: 10, onChange: (v) => patchBili({ videos: v }) }), h('span', null, '条')),
          h('div', { style: S.row }, h('span', null, '画面'),
            Num({ value: watch.cols, min: 1, max: 3, onChange: (v) => patchWatch({ cols: v }) }), h('span', null, '×'),
            Num({ value: watch.rows, min: 1, max: 3, onChange: (v) => patchWatch({ rows: v }) }),
            h('span', null, '每帧宽'), Num({ value: watch.scale, min: 160, max: 720, step: 20, onChange: (v) => patchWatch({ scale: v }) }), h('span', null, 'px'),
            h('span', null, '复用'), Num({ value: watch.reuseDays, min: 0, max: 30, onChange: (v) => patchWatch({ reuseDays: v }) }), h('span', null, '天')),
          h('p', { style: S.dim }, '帧数越少、缩得越小越省 token；同一条视频 7 天内不重复抽帧。'))),
        card('说（都要你点头）', h('div', { style: S.col },
          Check({ checked: bili.write !== false, onChange: (v) => patchBili({ write: v }), label: '允许她在网上说话（关掉连单都不立）' }),
          h('div', { style: S.row },
            h('span', null, '刷站'), Num({ value: w.scrollPerDay, min: 0, max: 12, onChange: (v) => patchBili({ scrollPerDay: v }) }), h('span', null, '次/天'),
            h('span', null, '评论'), Num({ value: w.commentPerDay, min: 0, max: 20, onChange: (v) => patchBili({ commentPerDay: v }) }), h('span', null, '条/天'),
            h('span', null, '回复'), Num({ value: w.replyPerDay, min: 0, max: 20, onChange: (v) => patchBili({ replyPerDay: v }) }), h('span', null, '条/天')),
          h('div', { style: S.row }, h('span', { style: { minWidth: 88 } }, '兴趣点'),
            h('input', { style: { ...S.wide, flex: 1 }, type: 'text', value: interests, placeholder: '人工智能、独立游戏（逗号或、分开）', onChange: (e) => setInterests(e.target.value) })),
          h('p', { style: S.dim }, '兴趣点只影响排序与标注，一条都不裁，也不进她的身份。'))),

        card('偏好（看什么、避开什么）', h('div', { style: S.col },
          h('div', { style: S.row }, h('span', { style: { minWidth: 88 } }, '想看的话题'),
            h('input', { style: { ...S.wide, flex: 1 }, value: topics, placeholder: '人工智能、独立游戏、手工（逗号或、分开）', onChange: (e) => setTopics(e.target.value) })),
          h('div', { style: S.row }, h('span', { style: { minWidth: 88 } }, '避开的话题'),
            h('input', { style: { ...S.wide, flex: 1 }, value: exclude, placeholder: '吵架、营销号', onChange: (e) => setExclude(e.target.value) })),
          h('div', { style: S.row }, h('span', null, '搜索排序'), h('select', {
            style: { ...S.input, width: 120 }, value: prefs.searchSort, onChange: (e) => patchBili({ prefs: { ...prefs, searchSort: e.target.value } }),
          }, h('option', { value: 'hot' }, '按热度'), h('option', { value: 'new' }, '按最新'))),
          h('p', { style: S.dim }, '避开的也不会消失：排到最后并标「避开的」——她能不能看，不是由黑名单替她决定的。'))),

        card('互动', h('div', { style: S.col },
          Check({ checked: interact.onlyOnTopic === true, onChange: (v) => patchBili({ interact: { ...interact, onlyOnTopic: v } }), label: '只在命中兴趣的视频下，才建议她说话' }),
          h('p', { style: S.dim }, '评论/回复仍然要立单等你批；这条只是少给她一些"想说话"的场合。'))),

        card('私信（把结果发给你，不是找人聊天）', h('div', { style: S.col },
          h('div', { style: S.row }, h('span', null, '投递'), h('select', {
            style: { ...S.input, width: 200 }, value: dm.mode, onChange: (e) => patchBili({ dm: { ...dm, mode: e.target.value } }),
          },
            h('option', { value: 'off' }, '不发私信'),
            h('option', { value: 'propose' }, '立单，等你批准'),
            h('option', { value: 'auto' }, '直接发（你已同意）'))),
          h('div', { style: S.row }, h('span', { style: { minWidth: 88 } }, '收件人 UID'),
            h('input', { style: { ...S.wide, flex: 1 }, value: dm.uid, placeholder: '数字 UID（B 站个人空间的 uid）', onChange: (e) => patchBili({ dm: { ...dm, uid: e.target.value } }) }),
            h('span', null, '每天最多'), Num({ value: bili.dmPerDay ?? 1, min: 0, max: 10, onChange: (v) => patchBili({ dmPerDay: v }) })),
          Check({ checked: dm.daily === true, onChange: (v) => patchBili({ dm: { ...dm, daily: v } }), label: '谷时把「今天在 B 站做了什么」当简报发过去' }),
          h('p', { style: S.dim }, 'B 站对「陌生人私信」会限流，也可能不弹提醒；接口回成功但没有回执（msg_key）时会当成没送到。'))),

        card('谷时自动刷（参考 dsh-bili-scroll 的口径）', h('div', { style: S.col },
          h('div', { style: S.row }, h('span', null, '模式'), h('select', {
            style: { ...S.input, width: 190 }, value: offpeak.mode, onChange: (e) => patchBili({ offpeak: { ...offpeak, mode: e.target.value } }),
          },
            h('option', { value: 'off' }, '关（只在你叫她时）'),
            h('option', { value: 'propose' }, '到点立单（仍要你批）'),
            h('option', { value: 'on' }, '到点直接叫她（你已同意）'))),
          h('div', { style: S.row }, h('span', null, '窗口'),
            h('label', null, h('input', {
              type: 'checkbox', checked: (offpeak.windows ?? []).includes('noon'),
              onChange: (e) => patchBili({ offpeak: { ...offpeak, windows: e.target.checked ? [...new Set([...(offpeak.windows ?? []), 'noon'])] : (offpeak.windows ?? []).filter((x) => x !== 'noon') } }),
            }), ' 中午 12:00–14:00'),
            h('label', null, h('input', {
              type: 'checkbox', checked: (offpeak.windows ?? []).includes('night'),
              onChange: (e) => patchBili({ offpeak: { ...offpeak, windows: e.target.checked ? [...new Set([...(offpeak.windows ?? []), 'night'])] : (offpeak.windows ?? []).filter((x) => x !== 'night') } }),
            }), ' 夜间 18:00–09:00')),
          h('p', { style: S.dim }, '工作日 9–12 / 14–18 是高峰，不跑；周末全天算谷时（北京时间固定 +8）。' + (offNow ? ' 现在：' + offNow.text + ' · ' + offNow.why : '')),
          h('p', { style: S.dim }, '一天最多触发一次，且必须还有刷站配额；propose 模式立的单照样 24 小时过期。'))),
        h('div', { style: S.row }, h('button', {
          style: S.btnPri,
          onClick: () => saveFish({
            bili: {
              enabled: bili.enabled !== false, write: bili.write !== false, videos: Number(w.videos),
              scrollPerDay: Number(w.scrollPerDay), commentPerDay: Number(w.commentPerDay), replyPerDay: Number(w.replyPerDay),
              interests: interests.split(/[、,，\s]+/).map((x) => x.trim()).filter(Boolean).slice(0, 8),
              watch: { cols: Number(watch.cols), rows: Number(watch.rows), scale: Number(watch.scale), reuseDays: Number(watch.reuseDays) },
              // 这三组以前漏在保存载荷外面（页面上有、点保存却没提交），现在一起带上
              prefs: { topics: splitWords(topics), exclude: splitWords(exclude), searchSort: prefs.searchSort },
              interact: { onlyOnTopic: interact.onlyOnTopic === true },
              offpeak: { mode: offpeak.mode, windows: offpeak.windows ?? [] },
              dm: { mode: dm.mode, uid: String(dm.uid ?? '').trim(), daily: dm.daily === true },
              dmPerDay: Number(bili.dmPerDay ?? 1),
            },
          }),
        }, '保存 B 站设置')))

      const pageKin = h('div', { style: S.col },
        card('什么时候提醒她分家', h('div', { style: S.col },
          h('div', { style: S.row }, h('span', { style: { minWidth: 88 } }, '记忆条数'), Num({ value: pressure.events ?? 1200, min: 50, max: 100000, step: 50, onChange: (v) => patchK('pressure', { events: v }) }), h('span', { style: S.dim }, '条')),
          h('div', { style: S.row }, h('span', { style: { minWidth: 88 } }, '记忆字数'), Num({ value: pressure.chars ?? 400000, min: 10000, max: 100000000, step: 10000, onChange: (v) => patchK('pressure', { chars: v }) }), h('span', { style: S.dim }, '字')),
          h('p', { style: S.dim }, '两项取最大值；天数不算压力（扔在角落 200 天、记忆没长，就不该被催）。'),
          Check({ checked: auto.propose === true, onChange: (v) => patchK('auto', { propose: v }), label: '到阈值自动替你立一张待批单（仍要你点头才生）' }),
          h('div', { style: S.row }, h('button', { style: S.btnPri, onClick: () => saveKin({ pressure: { events: Number(pressure.events), chars: Number(pressure.chars) }, auto: { propose: auto.propose === true, cooldownEvents: Number(auto.cooldownEvents ?? 200) } }) }, '保存')))),

        card('生下来的孩子带走多少', h('div', { style: S.col },
          h('div', { style: S.row },
            h('span', null, '边界'), Num({ value: birth.maxBoundaries ?? 5, min: 0, max: 12, onChange: (v) => patchK('birth', { maxBoundaries: v }) }), h('span', null, '条'),
            h('span', null, '判断'), Num({ value: birth.maxBeliefs ?? 3, min: 0, max: 12, onChange: (v) => patchK('birth', { maxBeliefs: v }) }), h('span', null, '条'),
            h('span', null, '总字数'), Num({ value: birth.maxPackChars ?? 900, min: 200, max: 2000, step: 50, onChange: (v) => patchK('birth', { maxPackChars: v }) })),
          h('div', { style: S.row },
            h('span', null, '疤'), Num({ value: birth.maxScars ?? 2, min: 0, max: 12, onChange: (v) => patchK('birth', { maxScars: v }) }), h('span', null, '条'),
            h('span', null, '立场'), Num({ value: birth.maxStances ?? 2, min: 0, max: 12, onChange: (v) => patchK('birth', { maxStances: v }) }), h('span', null, '条')),
          Check({ checked: birth.includeDiary === true, onChange: (v) => patchK('birth', { includeDiary: v }), label: '带她的一句日记（默认不带：太私密，也容易让孩子模仿她的语气）' }),
          Check({ checked: birth.inheritBeliefs !== false, onChange: (v) => patchK('birth', { inheritBeliefs: v }), label: '带上那几条判断（关掉只剩边界+称呼）' }),
          Check({ checked: birth.inheritName !== false, onChange: (v) => patchK('birth', { inheritName: v }), label: '继承她管你叫的称呼' }),
          Check({ checked: birth.notifyParent !== false, onChange: (v) => patchK('birth', { notifyParent: v }), label: '孩子出生时在她事件流里报喜一行' }),
          h('h3', { style: S.h3 }, '教孩子'),
          Check({ checked: teach.enabled !== false, onChange: (v) => patchK('teach', { enabled: v }), label: '允许出生之后继续教' }),
          h('div', { style: S.row }, h('span', null, '一次最多'), Num({ value: teach.perBatch ?? 3, min: 1, max: 5, onChange: (v) => patchK('teach', { perBatch: v }) }), h('span', null, '课')),
          h('h3', { style: S.h3 }, '她记得孩子多少'),
          h('div', { style: S.row }, h('span', null, '详略'), h('select', {
            style: { ...S.input, width: 150 }, value: presence.detail ?? 'memory',
            onChange: (e) => patchK('presence', { detail: e.target.value }),
          },
            h('option', { value: 'none' }, '只知道有孩子'),
            h('option', { value: 'memory' }, '加上她攒了多少'),
            h('option', { value: 'teach' }, '再加教过几件'))),
          h('p', { style: S.dim }, '孩子的原话永远不进这一段。'),
          h('div', { style: S.row }, h('button', {
            style: S.btnPri,
            onClick: () => saveKin({
              birth: {
                inheritName: birth.inheritName !== false, inheritBeliefs: birth.inheritBeliefs !== false,
                notifyParent: birth.notifyParent !== false, maxPackChars: Number(birth.maxPackChars ?? 700),
                maxBoundaries: Number(birth.maxBoundaries ?? 5), maxBeliefs: Number(birth.maxBeliefs ?? 3),
                maxScars: Number(birth.maxScars ?? 2), maxStances: Number(birth.maxStances ?? 2),
                includeDiary: birth.includeDiary === true,
                maxItems: Number(birth.maxItems ?? 24),
              },
              teach: { enabled: teach.enabled !== false, perBatch: Number(teach.perBatch ?? 3) },
              presence: { detail: presence.detail ?? 'memory' },
            }),
          }, '保存传承设置'))))) 

      const pageAdv = h('div', { style: S.col },
        card('工具白名单（额外放行）', h('div', { style: S.col },
          h('input', { style: S.wide, type: 'text', value: tools, placeholder: 'schedule_create, read_image（逗号分隔；核心两个不用写）', onChange: (e) => setTools(e.target.value) }),
          h('p', { style: S.dim }, '她默认只有 fish_commit / fish_bili；名字写错不会静默失效，收窄会自动退回核心两项。'),
          h('div', { style: S.row }, h('button', { style: S.btnPri, onClick: () => saveFish({ tools: { allow: tools.split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean) } }) }, '保存白名单')))),
        card('起点风格（只影响下一局）', h('div', { style: S.col },
          h('p', { style: S.dim }, '你写什么，她就以什么口吻开始。不写就用内置示例；勾「留白」就只给她处境。'),
          h('textarea', {
            style: { ...S.wide, minHeight: 72, resize: 'vertical', lineHeight: '1.6' },
            value: styleText,
            placeholder: '例如：说话软软的，句子短，爱用叠字；看到没见过的会先"诶？"一下。',
            onChange: (e) => { setStyleText(e.target.value); patchF({ style: { preset: styleBlank ? 'none' : 'cute', text: e.target.value } }) },
          }),
          h('div', { style: S.row },
            h('label', null, h('input', {
              type: 'checkbox', checked: styleBlank,
              onChange: (e) => { setStyleBlank(e.target.checked); patchF({ style: { preset: e.target.checked ? 'none' : 'cute', text: styleText } }) },
            }), ' 留白（不要任何风格）'),
            h('button', {
              style: S.btn,
              onClick: () => { setStyleText(EXAMPLE_STYLE); patchF({ style: { preset: 'cute', text: EXAMPLE_STYLE } }) },
            }, '填入示例'),
            h('button', {
              style: S.btn, onClick: () => { setStyleText(''); patchF({ style: { preset: styleBlank ? 'none' : 'cute', text: '' } }) },
            }, '清空')),
          h('p', { style: S.dim }, 'seed 不可篡改：这里只影响下一次播种。要换现有的她，命令行跑 tools/fresh-start.mjs（旧档归档，不删）。'),
          h('div', { style: S.row }, h('button', {
            style: S.btnPri,
            onClick: () => saveFish({ style: { preset: styleBlank ? 'none' : 'cute', text: styleText } }),
          }, '保存风格')))),
        card('她在哪（工作区）', h('div', { style: S.col },
          h('div', { style: S.row },
            h('span', { style: { minWidth: 88 } }, '工作区'),
            h('span', { style: { ...S.mono, wordBreak: 'break-all', flex: 1 } }, ws ? ws.familyRoot : '（读不到）'),
            h('span', { style: S.dim }, ws ? ({ env: '环境变量', pointer: '你设置的', legacy: '旧目录（升级沿用）', default: '默认' }[ws.source] || ws.source) : '')),
          h('p', { style: S.dim }, '她的记忆、族谱、孩子、归档、凭据都在这个目录里。搬家：node tools/migrate-workspace.mjs "<新路径>"（复制+核对+写指针，旧目录不删）。'),
          h('div', { style: S.row },
            h('input', {
              style: { ...S.wide, flex: 1 }, value: wsPath, placeholder: 'D:\我的东西\大肥鱼家族',
              onChange: (e) => setWsPath(e.target.value),
            }),
            h('button', {
              style: S.btnPri,
              onClick: async () => {
                const r = await post(KIN + '/api/workspace', { path: wsPath })
                setMsg(r?.ok ? '指针写好了：重启 DSH 生效（数据没搬，要用命令搬）' : (r?.why ?? '没写成'))
              },
            }, '换工作区')),
          h('p', { style: S.dim }, '这里只改"以后去哪找她"，不搬数据。要连数据一起搬，用上面的命令。'))),

        card('今天的报告', h('div', { style: S.col },
          h('div', { style: S.row },
            h('button', {
              style: S.btnPri,
              onClick: async () => {
                const r = await req(KIN + '/api/fish/report').catch((e) => ({ ok: false, why: String(e?.message ?? e) }))
                setReport(r?.ok ? r.text : ('读不到报告：' + (r?.why ?? '')))
              },
            }, report === null ? '看今天的报告' : '重新生成'),
            h('span', { style: S.dim }, '她今天批了几张、看了几条、说过什么、谷时跑没跑——只读汇总。')),
          report !== null ? h('pre', { style: { ...S.mono, whiteSpace: 'pre-wrap', margin: 0, maxHeight: 260, overflow: 'auto' } }, report) : null)),

        card('两扇窗（只读）', h('div', { style: S.col },
          h('div', { style: { ...S.mono, wordBreak: 'break-all' } }, location.origin + OBS),
          h('div', { style: S.dim }, '观测台：她的身份原文、记忆折叠、工具面、守卫、最近的事'),
          h('div', { style: { ...S.mono, wordBreak: 'break-all' } }, location.origin + KIN),
          h('div', { style: S.dim }, '传承控制台：族谱、生育、教学'))))

      const pages = { 她: pageHer, 生物钟: pageWake, 'B 站': pageBili, 传承: pageKin, 进阶: pageAdv }

      return h('div', { style: S.wrap },
        h('div', null,
          h('h2', { style: S.h2 }, '大肥鱼 · 传承'),
          h('p', { style: S.sub }, '她住在这个插件自己的运行时里。这里只有环境参数——没有人格、没有关系数值、没有能让她听话的开关。')),
        h('div', { style: S.tabs }, TABS.map(tabBtn)),
        pages[tab],
        msg ? h('p', { style: S.dim }, msg) : null)
    }

    const inject = ['slots']
    const NAMES = { nav: '大肥鱼·传承' }

    function apply(ctx) {
      ctx.effect(
        () => ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: 'dsh-fish-kin', order: 8, label: () => NAMES.nav },
            KinSection,
          ), 'dsh-fish-kin: settings section'),
        'dsh-fish-kin: settings section',
      )
    }

    exports.apply = apply
    exports.inject = inject
    exports.KinSection = KinSection
    return module.exports
  },
})

// 浏览器里由宿主的模块加载器接手；在 Node 里被 import（测试、自检）时什么都不做。
if (typeof window !== 'undefined' && window.__ModuleLoader__?.load) {
  window.__ModuleLoader__.load(MODULE)
}
