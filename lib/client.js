/**
 * client.js —— 设置页里的「大肥鱼·传承」
 *
 * 设计约定（0.28）：
 *   - 一套 CSS（注入一次），不在每个元素上堆 inline style；
 *   - 每页是「标题 + 几张卡」，卡里是「标签列 + 控件」的整齐行；
 *   - 危险/主操作/次操作三种按钮，视觉上分得开；
 *   - 所有"改了什么时候生效"的事，就近写一句小字，不藏在别处。
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
    const TABS = ['她', '生物钟', '工具与工作区', '传承', '进阶']
    const CSS_ID = 'dsh-fish-kin/settings.css'

    const CSS = `
.kin-wrap{display:flex;flex-direction:column;gap:16px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.55}
.kin-head{display:flex;flex-direction:column;gap:4px}
.kin-title{margin:0;font-size:17px;font-weight:600;letter-spacing:.02em}
.kin-sub{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12.5px}
.kin-tabs{display:flex;gap:4px;flex-wrap:wrap;padding:4px;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:color-mix(in srgb,currentColor 3%,transparent);width:fit-content;max-width:100%}
.kin-tab{border:0;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:999px;padding:5px 14px;cursor:pointer;font-size:12.5px;transition:background .15s,color .15s}
.kin-tab:hover{background:color-mix(in srgb,currentColor 6%,transparent);color:var(--dsw-alias-label-primary)}
.kin-tab.on{background:color-mix(in srgb,currentColor 12%,transparent);color:var(--dsw-alias-label-primary);font-weight:600}
.kin-page{display:flex;flex-direction:column;gap:14px;animation:kin-fade .18s ease-out}
@keyframes kin-fade{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:none}}
.kin-card{border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:10px;background:color-mix(in srgb,currentColor 1.5%,transparent)}
.kin-card>h4{margin:0;font-size:11.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}
.kin-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.kin-label{min-width:96px;color:var(--dsw-alias-label-tertiary);font-size:12.5px}
.kin-note{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}
.kin-mono{font-family:ui-monospace,Consolas,monospace;font-size:12px;word-break:break-all}
.kin-input{border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;border-radius:8px;padding:5px 9px;font-size:12.5px;min-width:0;transition:border-color .15s}
.kin-input:focus{outline:none;border-color:color-mix(in srgb,currentColor 40%,transparent)}
.kin-input.grow{flex:1}
.kin-num{width:64px;text-align:center}
.kin-btn{border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:8px;padding:5px 11px;cursor:pointer;font-size:12.5px;transition:background .15s,color .15s,border-color .15s;white-space:nowrap}
.kin-btn:hover{background:color-mix(in srgb,currentColor 7%,transparent);color:var(--dsw-alias-label-primary)}
.kin-btn:disabled{opacity:.45;cursor:not-allowed}
.kin-btn.primary{background:color-mix(in srgb,currentColor 12%,transparent);color:var(--dsw-alias-label-primary);font-weight:600;border-color:color-mix(in srgb,currentColor 22%,transparent)}
.kin-btn.primary:hover{background:color-mix(in srgb,currentColor 18%,transparent)}
.kin-btn.danger{color:#f85149;border-color:#f8514955}
.kin-btn.danger:hover{background:#f8514918}
.kin-btn.tiny{padding:3px 8px;font-size:12px}
.kin-stats{display:flex;gap:18px;flex-wrap:wrap}
.kin-stat{display:flex;flex-direction:column;gap:1px}
.kin-stat b{font-size:16px;font-weight:600}
.kin-stat span{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.kin-list{display:flex;flex-direction:column;gap:0}
.kin-item{display:flex;align-items:center;gap:10px;padding:9px 2px;border-top:.5px solid var(--dsw-alias-border-l2)}
.kin-item:first-child{border-top:0}
.kin-item .grow{flex:1;min-width:0}
.kin-empty{color:var(--dsw-alias-label-tertiary);font-size:12.5px;padding:4px 0}
.kin-check{display:flex;align-items:center;gap:7px;color:var(--dsw-alias-label-primary);font-size:12.5px;cursor:pointer}
.kin-check input{accent-color:currentColor}
.kin-msg{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;padding:8px 12px;border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;background:color-mix(in srgb,currentColor 3%,transparent)}
.kin-cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.kin-col{display:flex;flex-direction:column;gap:6px;min-width:0}
.kin-minihead{margin:0;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}
@media (max-width:640px){.kin-cols{grid-template-columns:1fr}}
`

    function injectCss() {
      try {
        if (typeof document === 'undefined' || !document?.head) return
        if (document.getElementById(CSS_ID)) return
        const el = document.createElement('style')
        el.id = CSS_ID
        el.textContent = CSS
        document.head.appendChild(el)
      } catch { /* 没有 DOM 就算了 */ }
    }

    async function req(path, init) {
      const r = await fetch(path, init)
      try { return await r.json() } catch { return { ok: false, why: 'HTTP ' + r.status } }
    }
    const post = (path, body) => req(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })

    const Note = ({ children }) => h('p', { className: 'kin-note' }, children)
    const Row = ({ label, children }) => h('div', { className: 'kin-row' }, label ? h('span', { className: 'kin-label' }, label) : null, children)
    const Btn = ({ kind = '', tiny = false, disabled = false, onClick, children }) =>
      h('button', { className: `kin-btn ${kind} ${tiny ? 'tiny' : ''}`.trim(), disabled, onClick }, children)
    const Num = ({ value, onChange, min = 0, max = 999, step = 1 }) =>
      h('input', {
        className: 'kin-input kin-num', type: 'number', min, max, step,
        value: Number.isFinite(Number(value)) ? Number(value) : 0,
        onChange: (e) => onChange(Number(e.target.value)),
      })
    const Check = ({ checked, onChange, label }) =>
      h('label', { className: 'kin-check' },
        h('input', { type: 'checkbox', checked: checked !== false, onChange: (e) => onChange(e.target.checked) }),
        h('span', null, label))
    const Card = ({ title, children }) => h('div', { className: 'kin-card' }, title ? h('h4', null, title) : null, children)

    function KinSection() {
      const [tab, setTab] = useState('她')
      const [fish, setFish] = useState(null)
      const [approvals, setApprovals] = useState([])
      const [owner, setOwner] = useState(null)
      const [f, setF] = useState(null)
      const [k, setK] = useState(null)
      const [tools, setTools] = useState('')
      const [perm, setPerm] = useState(null)
      const [family, setFamily] = useState('')
      const [homeDraft, setHomeDraft] = useState('')
      const [homeDirty, setHomeDirty] = useState(false)
      const [visits, setVisits] = useState([])
      const [dshWorkspaces, setDshWorkspaces] = useState([])
      const [visitDraft, setVisitDraft] = useState('')
      const [styleText, setStyleText] = useState('')
      const [styleBlank, setStyleBlank] = useState(false)
      const [report, setReport] = useState(null)
      const [msg, setMsg] = useState('')

      useEffect(() => { injectCss() }, [])

      const refresh = useCallback(async () => {
        const [s, a, c, kc, o, pm, wl, w] = await Promise.all([
          req(OBS + '/api/state').catch(() => null),
          req(KIN + '/api/approvals').catch(() => null),
          req(KIN + '/api/fish-config').catch(() => null),
          req(KIN + '/api/config').catch(() => null),
          req(KIN + '/api/owner').catch(() => null),
          req(KIN + '/api/permissions').catch(() => null),
          req(KIN + '/api/workspaces').catch(() => null),
          req(KIN + '/api/workspace').catch(() => null),
        ])
        if (s?.ok) setFish(s)
        if (a?.ok) setApprovals(a.pending ?? [])
        if (c?.ok) {
          setF(c.config)
          setTools((c.config?.tools?.allow ?? []).join(', '))
          const st = c.config?.style
          if (st && typeof st === 'object') { setStyleText(String(st.text ?? '')); setStyleBlank(st.preset === 'none') }
          else { setStyleText(''); setStyleBlank(String(st ?? 'cute') === 'none') }
        }
        if (kc?.ok) setK(kc.config)
        if (o?.ok) setOwner(o)
        if (pm?.ok) setPerm(pm)
        if (wl?.ok) {
          setFamily(wl.familyRoot ?? '')
          setVisits(wl.visits ?? [])
          setDshWorkspaces(wl.dshWorkspaces ?? [])
          if (!homeDirty) setHomeDraft(wl.familyRoot ?? '')
        }
        if (w?.ok) setFamily((prev) => prev || (w.familyRoot ?? ''))
      }, [homeDirty])

      useEffect(() => { refresh() }, [refresh])

      const patchF = (part) => setF((cur) => ({ ...(cur ?? {}), ...part }))
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

      const decideTool = async (id, action) => {
        const r = await post(KIN + '/api/approvals/decide', { id, action })
        setMsg(r?.ok ? '记下了' : (r?.why ?? '没成'))
        await refresh()
      }
      const forgetTool = async (tool) => {
        await post(KIN + '/api/permissions/forget', { tool })
        await refresh()
      }
      const pickDir = async () => {
        try {
          const picker = globalThis.__DSH_DIRECTORY_PICKER__
          if (picker && typeof picker.pick === 'function') {
            const dir = await picker.pick()
            return dir ? String(dir) : ''
          }
          setMsg('这个界面没有原生文件夹选择器，手动粘贴路径吧。')
          return ''
        } catch (e) {
          setMsg('打开文件夹选择器失败：' + String(e?.message ?? e))
          return ''
        }
      }
      const openInSystem = async (path) => {
        const r = await post(KIN + '/api/open-folder', { path })
        if (!r?.ok) setMsg(r?.why ?? '打不开')
      }
      const moveHome = async () => {
        const v = String(homeDraft ?? '').trim()
        if (!v) return
        const r = await post(KIN + '/api/workspace', { path: v })
        setMsg(r?.ok ? '家的路径改了：重启 DSH 后生效（要搬数据见下面的命令）' : (r?.why ?? '没改成'))
        if (r?.ok) { setHomeDirty(false); await refresh() }
      }
      const addVisit = async () => {
        const v = String(visitDraft ?? '').trim()
        if (!v) return
        const r = await post(KIN + '/api/workspaces', { visits: [...visits, v] })
        setMsg(r?.ok ? '可以串门了，下一条消息生效' : (r?.why ?? '没加'))
        if (r?.ok) { setVisitDraft(''); await refresh() }
      }
      const removeVisit = async (v) => {
        const r = await post(KIN + '/api/workspaces', { visits: visits.filter((x) => x !== v) })
        setMsg(r?.ok ? '不让她去了，下一轮生效' : (r?.why ?? '没去掉'))
        if (r?.ok) await refresh()
      }
      const addVisitPath = async (v) => {
        const path = String(v ?? '').trim()
        if (!path || visits.includes(path)) return
        const r = await post(KIN + '/api/workspaces', { visits: [...visits, path] })
        setMsg(r?.ok ? '可以串门了，下一条消息生效' : (r?.why ?? '没加'))
        if (r?.ok) await refresh()
      }

      const wake = f?.wake ?? {}
      const win = wake.window ?? ['09:00', '23:00']
      const birth = k?.birth ?? {}
      const pressure = k?.pressure ?? {}
      const teach = k?.teach ?? {}
      const presence = k?.presence ?? {}
      const auto = k?.auto ?? {}

      const pendingTools = (approvals ?? []).filter((a) => a.kind === 'tool-call')
      const pendingCard = () => Card({
        title: pendingTools.length ? `待批准 · ${pendingTools.length}` : '待批准',
        children: pendingTools.length
          ? h('div', { className: 'kin-list' }, pendingTools.map((a) => h('div', { key: a.id, className: 'kin-item', style: { flexDirection: 'column', alignItems: 'stretch', gap: 8 } },
              h('div', { className: 'kin-row' },
                h('span', { style: { fontWeight: 600 } }, a.title || a.payload?.tool || a.kind),
                h('span', { className: 'kin-mono kin-note' }, a.id)),
              h('div', { className: 'kin-row' },
                Btn({ kind: 'primary', tiny: true, onClick: () => decideTool(a.id, 'allow-once'), children: '允许一次' }),
                Btn({ tiny: true, onClick: () => decideTool(a.id, 'allow-always'), children: '永远允许' }),
                Btn({ tiny: true, onClick: () => decideTool(a.id, 'deny-once'), children: '拒绝本次' }),
                Btn({ kind: 'danger', tiny: true, onClick: () => decideTool(a.id, 'deny-always'), children: '永久禁止' })))))
          : h('p', { className: 'kin-empty' }, '她没有在等你点头的事。'),
      })

      // ---------------- 她 ----------------
      const pageHer = h('div', { className: 'kin-page' },
        Card({ title: '她现在', children: h('div', null,
          fish
            ? h('div', { className: 'kin-stats' },
                h('div', { className: 'kin-stat' }, h('b', null, fish.day), h('span', null, '天')),
                h('div', { className: 'kin-stat' }, h('b', null, fish.growth?.name ?? '-'), h('span', null, '阶段')),
                h('div', { className: 'kin-stat' }, h('b', null, fish.counts?.beliefs ?? 0), h('span', null, '判断')),
                h('div', { className: 'kin-stat' }, h('b', null, fish.counts?.refusals ?? 0), h('span', null, '拒绝')),
                h('div', { className: 'kin-stat' }, h('b', null, fish.counts?.diaries ?? 0), h('span', null, '日记')),
                h('div', { className: 'kin-stat' }, h('b', null, fish.counts?.events ?? 0), h('span', null, '事件')),
                h('div', { className: 'kin-stat' }, h('b', null, fish.counts?.chars ?? 0), h('span', null, '字')))
            : h('p', { className: 'kin-empty' }, '读不到她的状态（重启过一次了吗？）'),
          h('div', { className: 'kin-row', style: { marginTop: 12 } },
            Btn({ kind: 'primary', onClick: wakeNow, children: '叫醒她一次' }),
            Btn({ onClick: refresh, children: '刷新' }),
            h('span', { className: 'kin-note' }, '立刻递一句处境给她，不等生物钟'))) }),
        pendingCard(),
        Card({
          title: '最近的事',
          children: fish?.recent?.length
            ? h('div', { className: 'kin-list' }, fish.recent.slice(0, 6).map((e, i) => h('div', { key: i, className: 'kin-item' },
                h('span', { className: 'kin-note kin-mono', style: { minWidth: 128 } }, new Date(e.at).toLocaleString('zh-CN', { hour12: false })),
                h('span', { className: 'kin-mono', style: { color: 'var(--dsw-alias-label-tertiary)', minWidth: 52 } }, e.kind),
                h('span', { className: 'grow' }, String(e.text).slice(0, 70)))))
            : h('p', { className: 'kin-empty' }, '还没有事件。'),
        }))

      // ---------------- 生物钟 ----------------
      const saveWake = () => saveFish({
        wake: { enabled: wake.enabled !== false, perDay: Number(wake.perDay ?? 2), window: win },
      })
      const pageWake = h('div', { className: 'kin-page' },
        Card({
          title: '生物钟',
          children: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
            Check({ checked: wake.enabled !== false, onChange: (v) => patchWake({ enabled: v }), label: '开着（关掉她就只在你找她时存在）' }),
            Row({
              label: '每天醒',
              children: h('div', { className: 'kin-row' },
                Num({ value: wake.perDay ?? 2, min: 0, max: 6, onChange: (v) => patchWake({ perDay: v }) }),
                h('span', { className: 'kin-note' }, '次')),
            }),
            Row({
              label: '时间窗',
              children: h('div', { className: 'kin-row' },
                h('input', { className: 'kin-input', style: { width: 84 }, value: win[0], onChange: (e) => patchWake({ window: [e.target.value, win[1]] }) }),
                h('span', { className: 'kin-note' }, '至'),
                h('input', { className: 'kin-input', style: { width: 84 }, value: win[1], onChange: (e) => patchWake({ window: [win[0], e.target.value] }) })),
            }),
            Note('按记忆算压力、不按日历；这条改的是她醒来的节奏，不是她的年纪。'),
            h('div', { className: 'kin-row' }, Btn({ kind: 'primary', onClick: saveWake, children: '保存' }))),
        }),
      )

      // ---------------- 工具与工作区 ----------------
      const policyCard = Card({
        title: '永久策略',
        children: h('div', { className: 'kin-cols' },
          h('div', { className: 'kin-col' },
            h('h4', { className: 'kin-minihead' }, '永远允许'),
            (perm?.alwaysAllow ?? []).length
              ? h('div', { className: 'kin-list' }, perm.alwaysAllow.map((t2) => h('div', { key: t2, className: 'kin-item' },
                  h('span', { className: 'kin-mono grow' }, t2),
                  Btn({ tiny: true, onClick: () => forgetTool(t2), children: '撤销' }))))
              : h('p', { className: 'kin-empty' }, '没有。')),
          h('div', { className: 'kin-col' },
            h('h4', { className: 'kin-minihead' }, '永久禁止'),
            (perm?.alwaysDeny ?? []).length
              ? h('div', { className: 'kin-list' }, perm.alwaysDeny.map((t2) => h('div', { key: t2, className: 'kin-item' },
                  h('span', { className: 'kin-mono grow' }, t2),
                  Btn({ tiny: true, onClick: () => forgetTool(t2), children: '撤销' }))))
              : h('p', { className: 'kin-empty' }, '没有。'))),
      })

      const homeCard = Card({
        title: '家（只有一个）',
        children: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          Note('她的一切——记忆、族谱、孩子、凭据、许可、屋子——都在这个目录里。家只有一个，但路径可以换。'),
          Row({ label: '路径', children: h('span', { className: 'kin-mono grow' }, family || '（读不到）') }),
          h('div', { className: 'kin-row' },
            h('input', {
              className: 'kin-input grow', value: homeDraft, placeholder: '换一个路径，例如 D:/大肥鱼的家',
              onChange: (e) => { setHomeDraft(e.target.value); setHomeDirty(true) },
            }),
            Btn({ onClick: async () => { const d = await pickDir(); if (d) { setHomeDraft(d); setHomeDirty(true) } }, children: '选择…' }),
            Btn({ kind: 'primary', disabled: !homeDirty, onClick: moveHome, children: '换路径' }),
            Btn({ onClick: () => openInSystem(family), children: '打开' })),
          Note('换路径只改"以后去哪儿找她"，不搬数据。连数据一起搬：node tools/migrate-workspace.mjs "<新路径>"。')),
      })

      const visitCard = Card({
        title: '串门（这些路径下能见到她）',
        children: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          Note('串门只是"这个目录里她能带着人设出现"：身份和闸门照样生效，但不存任何东西、不建屋子。改完不用重启。'),
          dshWorkspaces.length
            ? h('div', { className: 'kin-list' }, dshWorkspaces.map((w) => h('div', { key: w.id || w.path, className: 'kin-item' },
                h('div', { className: 'grow' },
                  h('div', { style: { fontWeight: 600 } }, w.title || w.path),
                  h('div', { className: 'kin-mono kin-note' }, w.path)),
                Btn({ tiny: true, disabled: visits.includes(w.path), onClick: () => addVisitPath(w.path), children: visits.includes(w.path) ? '已允许' : '加入串门' }))))
            : Note('宿主没有提供左侧工作区列表；可以在下面手动粘贴路径，或用「选择…」。'),
          visits.length
            ? h('div', { className: 'kin-list' }, visits.map((v) => h('div', { key: v, className: 'kin-item' },
                h('span', { className: 'kin-mono grow' }, v),
                Btn({ tiny: true, onClick: () => openInSystem(v), children: '打开' }),
                Btn({ tiny: true, onClick: () => removeVisit(v), children: '不让去' }))))
            : h('p', { className: 'kin-empty' }, '还没设串门的地方。'),
          h('div', { className: 'kin-row' },
            h('input', { className: 'kin-input grow', value: visitDraft, placeholder: '绝对路径，例如 D:/other-project', onChange: (e) => setVisitDraft(e.target.value) }),
            Btn({ onClick: async () => { const d = await pickDir(); if (d) setVisitDraft(d) }, children: '选择…' }),
            Btn({ kind: 'primary', onClick: addVisit, children: '允许串门' }))),
      })

      const pageTools = h('div', { className: 'kin-page' }, pendingCard(), policyCard, homeCard, visitCard)

      // ---------------- 传承 ----------------
      const savePressure = () => saveKin({
        pressure: { events: Number(pressure.events), chars: Number(pressure.chars) },
        auto: { propose: auto.propose === true, cooldownEvents: Number(auto.cooldownEvents ?? 200) },
      })
      const saveBirth = () => saveKin({
        birth: {
          inheritName: birth.inheritName !== false, inheritBeliefs: birth.inheritBeliefs !== false,
          notifyParent: birth.notifyParent !== false, maxPackChars: Number(birth.maxPackChars ?? 900),
          maxBoundaries: Number(birth.maxBoundaries ?? 5), maxBeliefs: Number(birth.maxBeliefs ?? 3),
          maxScars: Number(birth.maxScars ?? 2), maxStances: Number(birth.maxStances ?? 2),
          includeDiary: birth.includeDiary === true, maxItems: Number(birth.maxItems ?? 24),
        },
        teach: { enabled: teach.enabled !== false, perBatch: Number(teach.perBatch ?? 3) },
        presence: { detail: presence.detail ?? 'memory' },
      })

      const pressureCard = Card({
        title: '什么时候提醒她分家',
        children: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          Row({ label: '记忆条数', children: h('div', { className: 'kin-row' },
            Num({ value: pressure.events ?? 1200, min: 50, max: 100000, step: 50, onChange: (v) => patchK('pressure', { events: v }) }),
            h('span', { className: 'kin-note' }, '条')) }),
          Row({ label: '记忆字数', children: h('div', { className: 'kin-row' },
            Num({ value: pressure.chars ?? 400000, min: 10000, max: 100000000, step: 10000, onChange: (v) => patchK('pressure', { chars: v }) }),
            h('span', { className: 'kin-note' }, '字')) }),
          Note('两项取最大值；天数不算压力。'),
          Check({ checked: auto.propose === true, onChange: (v) => patchK('auto', { propose: v }), label: '到阈值自动替你立一张待批单（仍要你点头才生）' }),
          h('div', { className: 'kin-row' }, Btn({ kind: 'primary', onClick: savePressure, children: '保存' }))),
      })

      const birthCard = Card({
        title: '生下来的孩子带走多少',
        children: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          Row({ label: '边界', children: h('div', { className: 'kin-row' },
            Num({ value: birth.maxBoundaries ?? 5, min: 0, max: 12, onChange: (v) => patchK('birth', { maxBoundaries: v }) }),
            h('span', { className: 'kin-note' }, '条')) }),
          Row({ label: '判断', children: h('div', { className: 'kin-row' },
            Num({ value: birth.maxBeliefs ?? 3, min: 0, max: 12, onChange: (v) => patchK('birth', { maxBeliefs: v }) }),
            h('span', { className: 'kin-note' }, '条')) }),
          Row({ label: '疤', children: h('div', { className: 'kin-row' },
            Num({ value: birth.maxScars ?? 2, min: 0, max: 12, onChange: (v) => patchK('birth', { maxScars: v }) }),
            h('span', { className: 'kin-note' }, '条')) }),
          Row({ label: '立场', children: h('div', { className: 'kin-row' },
            Num({ value: birth.maxStances ?? 2, min: 0, max: 12, onChange: (v) => patchK('birth', { maxStances: v }) }),
            h('span', { className: 'kin-note' }, '条')) }),
          Row({ label: '总字数', children: Num({ value: birth.maxPackChars ?? 900, min: 200, max: 2000, step: 50, onChange: (v) => patchK('birth', { maxPackChars: v }) }) }),
          Check({ checked: birth.inheritBeliefs !== false, onChange: (v) => patchK('birth', { inheritBeliefs: v }), label: '带上那几条判断（关掉只剩边界+称呼）' }),
          Check({ checked: birth.inheritName !== false, onChange: (v) => patchK('birth', { inheritName: v }), label: '继承她管你叫的称呼' }),
          Check({ checked: birth.notifyParent !== false, onChange: (v) => patchK('birth', { notifyParent: v }), label: '孩子出生时在她事件流里报喜一行' }),
          Check({ checked: birth.includeDiary === true, onChange: (v) => patchK('birth', { includeDiary: v }), label: '带她的一句日记（默认不带）' }),
          Row({ label: '教孩子', children: Check({ checked: teach.enabled !== false, onChange: (v) => patchK('teach', { enabled: v }), label: '允许出生之后继续教' }) }),
          Row({ label: '每批最多', children: h('div', { className: 'kin-row' },
            Num({ value: teach.perBatch ?? 3, min: 1, max: 5, onChange: (v) => patchK('teach', { perBatch: v }) }),
            h('span', { className: 'kin-note' }, '课')) }),
          Row({ label: '她记得孩子', children: h('select', {
            className: 'kin-input', value: presence.detail ?? 'memory',
            onChange: (e) => patchK('presence', { detail: e.target.value }),
          },
            h('option', { value: 'none' }, '只知道有孩子'),
            h('option', { value: 'memory' }, '加上她攒了多少'),
            h('option', { value: 'teach' }, '再加教过几件')) }),
          h('div', { className: 'kin-row' }, Btn({ kind: 'primary', onClick: saveBirth, children: '保存' }))),
      })

      const pageKin = h('div', { className: 'kin-page' }, pressureCard, birthCard)

      // ---------------- 进阶 ----------------
      const saveAllow = () => saveFish({
        tools: { allow: tools.split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean) },
      })
      const saveStyle = () => saveFish({ style: { preset: styleBlank ? 'none' : 'cute', text: styleText } })
      const setExample = () => {
        const v = '句子还短，常常一句话就停住；好奇，看到没见过的会先"诶？"一下。'
        setStyleText(v); patchF({ style: { preset: 'cute', text: v } })
      }
      const clearStyle = () => { setStyleText(''); patchF({ style: { preset: styleBlank ? 'none' : 'cute', text: '' } }) }
      const loadReport = async () => {
        const r = await req(KIN + '/api/fish/report').catch(() => ({ ok: false, why: '读不到' }))
        setReport(r?.ok ? r.text : ('读不到报告：' + (r?.why ?? '')))
      }

      const allowCard = Card({
        title: '额外放行的工具',
        children: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          h('input', { className: 'kin-input', value: tools, placeholder: '逗号分隔；核心 fish_commit 不用写', onChange: (e) => setTools(e.target.value) }),
          Note('这里的工具不用问就能用；其它工具每次调用都会来问你。'),
          h('div', { className: 'kin-row' }, Btn({ kind: 'primary', onClick: saveAllow, children: '保存' }))),
      })

      const styleCard = Card({
        title: '起点风格（只影响下一局）',
        children: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          h('textarea', {
            className: 'kin-input', style: { minHeight: 76, resize: 'vertical' }, value: styleText,
            placeholder: '例如：说话软软的，句子短，爱用叠字。',
            onChange: (e) => { setStyleText(e.target.value); patchF({ style: { preset: styleBlank ? 'none' : 'cute', text: e.target.value } }) },
          }),
          h('div', { className: 'kin-row' },
            Check({ checked: styleBlank, onChange: (v) => { setStyleBlank(v); patchF({ style: { preset: v ? 'none' : 'cute', text: styleText } }) }, label: '留白（不要任何风格）' }),
            Btn({ tiny: true, onClick: setExample, children: '填入示例' }),
            Btn({ tiny: true, onClick: clearStyle, children: '清空' })),
          Note('seed 不可篡改：这里只影响下一次播种。要换现有的她，命令行跑 tools/fresh-start.mjs。'),
          h('div', { className: 'kin-row' }, Btn({ kind: 'primary', onClick: saveStyle, children: '保存' }))),
      })

      const reportCard = Card({
        title: '今天的报告',
        children: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          h('div', { className: 'kin-row' },
            Btn({ kind: 'primary', onClick: loadReport, children: report === null ? '看今天的报告' : '重新生成' }),
            h('span', { className: 'kin-note' }, '只读汇总：批了几张、看过几条、说过什么。')),
          report !== null
            ? h('pre', { className: 'kin-mono', style: { whiteSpace: 'pre-wrap', margin: 0, maxHeight: 260, overflow: 'auto', border: '.5px solid var(--dsw-alias-border-l2)', borderRadius: 8, padding: 10 } }, report)
            : null),
      })

      const linksCard = Card({
        title: '两扇窗（只读）',
        children: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
          h('div', { className: 'kin-mono' }, location.origin + OBS),
          Note('观测台：她的身份原文、记忆折叠、工具面、守卫、最近的事'),
          h('div', { className: 'kin-mono' }, location.origin + KIN),
          Note('传承控制台：族谱、生育、教学')),
      })

      const pageAdv = h('div', { className: 'kin-page' }, allowCard, styleCard, reportCard, linksCard)

      const pages = { 她: pageHer, 生物钟: pageWake, '工具与工作区': pageTools, 传承: pageKin, 进阶: pageAdv }

      return h('div', { className: 'kin-wrap' },
        h('div', { className: 'kin-head' },
          h('h2', { className: 'kin-title' }, '大肥鱼 · 传承'),
          h('p', { className: 'kin-sub' }, '她住在这个插件自己的运行时里。这里只有环境参数——没有人格、没有关系数值、没有能让她听话的开关。')),
        h('div', { className: 'kin-tabs' }, TABS.map((name) => h('button', {
          key: name, className: 'kin-tab' + (tab === name ? ' on' : ''), onClick: () => { setTab(name); setMsg('') },
        }, name))),
        pages[tab],
        msg ? h('p', { className: 'kin-msg' }, msg) : null,
      )
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

if (typeof window !== 'undefined' && window.__ModuleLoader__?.load) {
  window.__ModuleLoader__.load(MODULE)
}
