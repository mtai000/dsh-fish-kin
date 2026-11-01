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
    const { createElement: h, useCallback, useEffect, useRef, useState } = React

    const KIN = '/dsh-fish-kin'
    const OBS = '/dsh-fish-obs'
    const TABS = ['她', '生物钟', 'B站', '工具与工作区', '传承', '进阶']
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
.bili-page{max-width:none;gap:12px}
.bili-hero-wrap{display:flex;flex-direction:column;gap:14px}
.bili-hero{display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap}
.bili-hero-main{display:flex;flex-direction:column;gap:14px;flex:1;min-width:280px}
.bili-status{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.bili-status b{font-size:22px;font-weight:650;letter-spacing:.01em}
.bili-sub{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12.5px;line-height:1.55;min-height:18px}
.bili-dot{width:10px;height:10px;border-radius:50%;flex:none;background:color-mix(in srgb,currentColor 25%,transparent)}
.bili-dot.good{background:#3fb950;box-shadow:0 0 0 4px #3fb95022}
.bili-dot.wait{background:#58a6ff;box-shadow:0 0 0 4px #58a6ff22;animation:bili-pulse 1.7s ease-in-out infinite}
.bili-dot.warn{background:#d29922;box-shadow:0 0 0 4px #d2992222}
.bili-dot.bad{background:#f85149;box-shadow:0 0 0 4px #f8514922}
.bili-dot.idle{background:color-mix(in srgb,currentColor 28%,transparent)}
@keyframes bili-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(.82)}}
.bili-steps{display:flex;gap:6px;flex-wrap:wrap}
.bili-step{font-size:11.5px;line-height:1.4;padding:4px 10px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.bili-step.done{color:#3fb950;border-color:#3fb95055;background:#3fb95010}
.bili-step.now{color:var(--dsw-alias-label-primary);border-color:color-mix(in srgb,currentColor 35%,transparent);background:color-mix(in srgb,currentColor 8%,transparent);font-weight:600}
.bili-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.bili-badge{font-size:10.5px;line-height:1.4;padding:2px 8px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);background:color-mix(in srgb,currentColor 4%,transparent)}
.bili-qr{display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px;border:.5px solid var(--dsw-alias-border-l2);border-radius:14px;background:#fff;box-shadow:0 10px 30px #0000001f;flex:none}
.bili-qr img{width:220px;height:220px;display:block;image-rendering:pixelated;border-radius:6px}
.bili-qr-hint{max-width:220px;text-align:center;color:#333;font-size:12px;line-height:1.45}
.bili-qr .kin-row{justify-content:center}
.bili-qr .kin-btn{color:#333;border-color:#0002}
.bili-qr .kin-btn:hover{background:#0000000d;color:#111}
.bili-stat-strip{display:flex;gap:22px;flex-wrap:wrap;padding:10px 12px;border-radius:10px;border:.5px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,currentColor 2.5%,transparent)}
.bili-stat{display:flex;flex-direction:column;gap:1px;min-width:64px}
.bili-stat b{font-size:15px;font-weight:600}
.bili-stat span{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.bili-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.bili-form{display:flex;flex-direction:column;gap:0}
.bili-field{display:flex;gap:12px;align-items:flex-start;padding:9px 0;border-top:.5px solid var(--dsw-alias-border-l2)}
.bili-field:first-child{border-top:0;padding-top:0}
.bili-field-label{width:84px;flex:none;padding-top:5px;font-size:12.5px;color:var(--dsw-alias-label-tertiary)}
.bili-field-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.bili-field-body>.kin-input,.bili-form>textarea{width:100%;box-sizing:border-box}
.bili-three>.kin-input{width:100%}
.bili-inline{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.bili-three{display:flex;flex-wrap:wrap;gap:8px}
.bili-three>*{flex:1 1 120px;min-width:0}
.bili-note{font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.bili-hint{margin:6px 0 2px}
.bili-summary{font-size:12px;line-height:1.5;padding:8px 10px;margin-bottom:8px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,currentColor 3%,transparent);color:var(--dsw-alias-label-secondary)}
.bili-divider{height:.5px;background:var(--dsw-alias-border-l2);margin:8px 0}
.bili-save{display:flex;justify-content:flex-end;padding-top:10px}
.bili-toggle-row{display:flex;gap:12px;align-items:center;padding:9px 0;border-top:.5px solid var(--dsw-alias-border-l2)}
.bili-toggle-row:first-child{border-top:0;padding-top:0}
.bili-toggle-text{flex:1;min-width:0}
.bili-toggle-label{font-size:13px}
.bili-toggle-note{font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-tertiary);margin-top:1px}
.bili-sw{width:36px;height:20px;border-radius:999px;border:0;padding:0;position:relative;flex:none;cursor:pointer;background:color-mix(in srgb,currentColor 20%,transparent);transition:background .15s}
.bili-sw i{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s;box-shadow:0 1px 2px #0003}
.bili-sw.on{background:#3b82f6}
.bili-sw.on i{left:18px}
.bili-sw:disabled{opacity:.45;cursor:default}
.bili-mono{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;word-break:break-all}
.bili-grow{flex:1;min-width:0}
.bili-envline{margin:7px 0}
.bili-pre{margin:6px 0 0;padding:8px 9px;border-radius:8px;max-height:160px;overflow:auto;font-size:11px;line-height:15px;white-space:pre-wrap;word-break:break-all;background:color-mix(in srgb,currentColor 3%,transparent);color:var(--dsw-alias-label-tertiary)}
.bili-seen-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
.bili-seen-card{display:flex;flex-direction:column;overflow:hidden;border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;background:color-mix(in srgb,currentColor 2%,transparent);color:inherit;text-decoration:none;transition:border-color .12s,background .12s}
.bili-seen-card:hover{border-color:color-mix(in srgb,currentColor 30%,transparent);background:color-mix(in srgb,currentColor 5%,transparent)}
.bili-seen-cover{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:color-mix(in srgb,currentColor 6%,transparent)}
.bili-seen-body{display:flex;flex-direction:column;gap:4px;padding:9px 11px;min-width:0}
.bili-seen-title{font-size:12.5px;line-height:1.4;font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.bili-seen-meta{font-size:11px;line-height:1.45;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bili-seen-status{font-size:11px;line-height:1.45;color:var(--dsw-alias-label-tertiary)}
.bili-seen-status.picked{color:#3fb950}
.bili-seen-status.skipped{color:var(--dsw-alias-label-tertiary)}
@media (max-width:720px){.bili-hero{flex-direction:column}.bili-qr{align-self:center}.bili-hero-main{width:100%}}
@media (max-width:560px){.bili-field{flex-direction:column;gap:4px}.bili-field-label{width:auto;padding-top:0}}
.bili-seen-view{padding:18px 22px 26px;max-width:1100px;width:100%;box-sizing:border-box;margin:0 auto;display:flex;flex-direction:column;gap:14px;color:var(--dsw-alias-label-primary)}
.bili-seen-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.bili-seen-h{margin:0;font-size:16px;font-weight:600;letter-spacing:.01em}
.bili-seen-sub{margin:4px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
@media (max-width:640px){.bili-seen-view{padding:14px 14px 22px}.bili-seen-grid{grid-template-columns:1fr}}
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

    function BiliSeenView() {
      const [data, setData] = useState(null)
      const [err, setErr] = useState('')
      const load = useCallback(async () => {
        try {
          const r = await req(KIN + '/api/bili/seen')
          if (r?.ok) { setData(r); setErr('') }
          else setErr(r?.why || '读不到刷过的视频')
        } catch (e) { setErr(String(e?.message ?? e)) }
      }, [])
      useEffect(() => {
        injectCss()
        load()
        const t = setInterval(load, 60_000)
        return () => clearInterval(t)
      }, [load])
      const items = data?.items ?? []
      return h('div', { className: 'bili-seen-view' },
        h('div', { className: 'bili-seen-head' },
          h('div', null,
            h('h3', { className: 'bili-seen-h' }, '刷过的视频'),
            h('p', { className: 'bili-seen-sub' }, data
              ? `最近 ${items.length} 条${data.pickedToday ? ` · 今天挑到 ${data.pickedToday} 条` : ''}`
              : '读取中…')),
          h('button', { className: 'kin-btn tiny', onClick: load }, '刷新')),
        err ? h('p', { className: 'kin-msg' }, err) : null,
        items.length
          ? h('div', { className: 'bili-seen-grid' }, items.map((v) => h('a', {
              key: `${v.day}-${v.bvid}`,
              className: 'bili-seen-card',
              href: v.url, target: '_blank', rel: 'noreferrer',
            },
              h('img', {
                className: 'bili-seen-cover',
                src: `${KIN}/api/bili/cover?bvid=${encodeURIComponent(v.bvid)}`,
                alt: '', loading: 'lazy',
                onError: (e) => { e.target.style.visibility = 'hidden' },
              }),
              h('div', { className: 'bili-seen-body' },
                h('div', { className: 'bili-seen-title' }, v.title || v.bvid),
                h('div', { className: 'bili-seen-meta' }, `${v.day} · ${v.up || v.bvid}`),
                h('div', { className: `bili-seen-status ${v.picked ? 'picked' : 'skipped'}` }, v.status || '')))))
          : h('p', { className: 'kin-empty' }, data ? '还没刷过。设一个时间，或点「现在逛一轮」。' : '读取中…'),
      )
    }

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
      const [bili, setBili] = useState(null)
      const [biliBusy, setBiliBusy] = useState('')
      const [qrKey, setQrKey] = useState('')
      const [qrAt, setQrAt] = useState(0)
      const [qrPhase, setQrPhase] = useState('')
      const [loginMsg, setLoginMsg] = useState('')
      const [conn, setConn] = useState(null)
      const [connBusy, setConnBusy] = useState(false)
      const [biliReport, setBiliReport] = useState('')
      const [timesText, setTimesText] = useState('')
      const [kwText, setKwText] = useState('')
      const [exText, setExText] = useState('')
      const [msg, setMsg] = useState('')
      const loginPolling = useRef(false)
      const autoQrTried = useRef(false)

      useEffect(() => { injectCss() }, [])

      const refresh = useCallback(async () => {
        const [s, a, c, kc, o, pm, wl, w, bl] = await Promise.all([
          req(OBS + '/api/state').catch(() => null),
          req(KIN + '/api/approvals').catch(() => null),
          req(KIN + '/api/fish-config').catch(() => null),
          req(KIN + '/api/config').catch(() => null),
          req(KIN + '/api/owner').catch(() => null),
          req(KIN + '/api/permissions').catch(() => null),
          req(KIN + '/api/workspaces').catch(() => null),
          req(KIN + '/api/workspace').catch(() => null),
          req(KIN + '/api/bili/status').catch(() => null),
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
        if (bl?.ok) setBili(bl)
      }, [homeDirty])

      useEffect(() => { refresh() }, [refresh])

      const checkConnection = useCallback(async (force = false) => {
        setConnBusy(true)
        try {
          const r = await req(KIN + '/api/bili/connection' + (force ? '?force=1' : '')).catch(() => null)
          if (r?.ok) { setConn(r); return r }
          return null
        } finally { setConnBusy(false) }
      }, [])

      useEffect(() => { checkConnection(false) }, [checkConnection])

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

      const saveBili = useCallback(async (patch) => {
        const r = await post(KIN + '/api/bili/config', { patch })
        setMsg(r?.ok ? 'B 站设置存好了，下一轮生效' : (r?.why ?? '没存成'))
        if (r?.ok) await refresh()
      }, [refresh])

      const biliGo = async (path, label) => {
        setBiliBusy(label)
        const r = await post(KIN + path, {}).catch((e) => ({ ok: false, why: String(e?.message ?? e) }))
        setBiliBusy('')
        if (path === '/api/bili/login/start' && !r?.ok) {
          const why = r?.why || r?.error || '登录请求失败：检查网络或后端日志'
          setLoginMsg(why); setMsg(why)
        } else if (path === '/api/bili/login/start' && r?.ok && r.key) {
          if (r.hasQr === false) {
            setQrPhase('')
            const why = r.hint || '二维码没画出来（qrcode 没装好）—— 先点「安装依赖」，再来扫码。'
            setLoginMsg(why); setMsg(why)
          } else {
            setQrKey(r.key); setQrAt(Date.now()); setQrPhase('waiting')
            const tip = '二维码已生成：手机 B站 → 我的 → 扫一扫（确认时选「记住我 / 长期」）'
            setLoginMsg(tip); setMsg(tip)
          }
        } else if (path === '/api/bili/run') {
          setMsg(r?.started ? '已经把「去逛逛」递进她的会话了；挑到什么会写进下面。' : (r?.why || r?.error || '没递出去'))
        } else if (path === '/api/bili/test') {
          setMsg(r?.ok ? ('测好了：' + (r.steps || []).join(' / ')) : (r?.error || r?.why || '没通过'))
          if (r?.ok) await checkConnection(true)
        } else {
          setMsg(r?.ok ? (r.hint || r.why || '好了') : (r?.why || r?.error || '没成'))
        }
        await refresh()
        return r
      }

      const pollLogin = async (silent = false) => {
        if (!qrKey || loginPolling.current) return
        loginPolling.current = true
        try {
          const r = await post(KIN + '/api/bili/login/poll', { key: qrKey }).catch(() => null)
          if (!r) return
          if (r.state === 'ok') {
            setQrKey(''); setQrPhase('')
            if (r.connection) setConn(r.connection)
            else await checkConnection(true)
            const tip = r.warning ? ('登录成功，但验证没通过：' + r.warning) : '登录成功，已经连上 B 站'
            setLoginMsg(tip); setMsg(tip)
            await refresh()
            return
          }
          if (r.state === 'expired') {
            setQrKey(''); setQrPhase('expired')
            const tip = '二维码过期了，再点一次「扫码登录」'
            setLoginMsg(tip); setMsg(tip)
            return
          }
          if (r.state === 'scanned') {
            setQrPhase('scanned')
            const tip = '扫到了，等手机确认…'
            setLoginMsg(tip); if (!silent) setMsg(tip)
          } else {
            const tip = r.state === 'waiting' ? '还没扫（二维码在右上角）' : (r.message || r.why || '等扫码…')
            if (!silent) { setLoginMsg(tip); setMsg(tip) }
          }
        } finally { loginPolling.current = false }
      }

      // 第一次打开 B站 页、环境就绪且还没登录：直接把二维码亮出来（登录优先）
      useEffect(() => {
        if (!bili || qrKey || bili.loggedIn || !bili.env?.ready) return
        if (autoQrTried.current) return
        autoQrTried.current = true
        biliGo('/api/bili/login/start', 'login')
      }, [bili?.loggedIn, bili?.env?.ready, qrKey])

      // 装依赖是后台任务：开着的时候每 3 秒刷新一次，装好就自动去扫码
      useEffect(() => {
        if (!bili?.env?.installing && !bili?.env?.asrInstalling) return
        const t = setInterval(() => { refresh().catch(() => {}) }, 3000)
        return () => clearInterval(t)
      }, [bili?.env?.installing, bili?.env?.asrInstalling, refresh])

      const loadBiliReport = async () => {
        try {
          const resp = await fetch(KIN + '/api/bili/report')
          if (!resp.ok) { setBiliReport('今天还没有日报。'); return }
          const text = await resp.text()
          setBiliReport(text || '今天还没有日报。')
        } catch { setBiliReport('读不到日报。') }
      }

      useEffect(() => {
        if (!bili?.config) return
        setTimesText((bili.config.schedule?.times ?? []).join(', '))
        setKwText((bili.config.preferences?.keywords ?? []).join('\n'))
        setExText((bili.config.preferences?.excludeWords ?? []).join('\n'))
      }, [bili?.config?.schedule?.times, bili?.config?.preferences?.keywords, bili?.config?.preferences?.excludeWords])

      useEffect(() => {
        if (!qrKey) return
        let stop = false
        const t = setInterval(() => { if (!stop) pollLogin(true) }, 2500)
        return () => { stop = true; clearInterval(t) }
      }, [qrKey])

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

      // ---------------- B 站 ----------------
      const bCfg = bili?.config ?? {}
      const bSch = bCfg.schedule ?? {}
      const bPref = bCfg.preferences ?? {}
      const bShare = bCfg.share ?? {}
      const bComment = bCfg.comment ?? {}
      const bAsr = bCfg.transcribe ?? {}
      const bEnv = bili?.env ?? {}
      const patchB = (part) => setBili((cur) => ({ ...(cur ?? {}), config: { ...(cur?.config ?? {}), ...part } }))
      const patchBGroup = (group, part) => setBili((cur) => ({
        ...(cur ?? {}),
        config: { ...(cur?.config ?? {}), [group]: { ...((cur?.config ?? {})[group] ?? {}), ...part } },
      }))
      const splitLines = (v) => String(v ?? '').split(/[\n,，]+/).map((x) => x.trim()).filter(Boolean)

      const saveBiliSchedule = () => saveBili({
        enabled: bCfg.enabled !== false,
        schedule: {
          ...bSch,
          enabled: bSch.enabled === true,
          times: splitLines(timesText).filter((x) => /^\d{1,2}:\d{2}$/.test(x)),
          window: bSch.window ?? ['12:00', '14:00'],
          perDay: Number(bSch.perDay ?? 1),
          offPeakOnly: bSch.offPeakOnly === true,
        },
      })
      const saveBiliPrefs = () => saveBili({
        preferences: {
          ...bPref,
          taste: String(bPref.taste ?? ''),
          keywords: splitLines(kwText),
          excludeWords: splitLines(exText),
          sort: bPref.sort ?? 'pubdate',
          pages: Number(bPref.pages ?? 2),
          fetchPerRound: Number(bPref.fetchPerRound ?? 8),
          maxPicks: Number(bPref.maxPicks ?? 5),
        },
        report: bCfg.report ?? 'full',
      })
      const saveBiliShare = () => saveBili({
        share: {
          ...bShare,
          enabled: bShare.enabled !== false,
          mode: bShare.mode ?? 'dm',
          uid: Number(bShare.uid ?? 0),
          watch: bShare.watch === true,
          watchMinutes: Number(bShare.watchMinutes ?? 3),
          replyPerDay: Number(bShare.replyPerDay ?? 20),
        },
        comment: {
          ...bComment,
          enabled: bComment.enabled === true,
          mention: String(bComment.mention ?? ''),
          perRound: Number(bComment.perRound ?? 1),
          length: bComment.length ?? 'medium',
          replyToComments: bComment.replyToComments === true,
          replyPerRound: Number(bComment.replyPerRound ?? 1),
        },
      })
      const saveBiliAsr = () => saveBili({
        transcribe: { enabled: bAsr.enabled === true, model: bAsr.model ?? 'small' },
      })

      const loggedIn = bili?.loggedIn === true || conn?.loggedIn === true
      const connState = !bili
        ? 'loading'
        : qrKey
          ? (qrPhase === 'scanned' ? 'qr-scanned' : 'qr-waiting')
          : (qrPhase === 'expired'
            ? 'qr-expired'
            : (conn?.state || (loggedIn ? 'unverified' : (bEnv.ready ? 'no-credential' : 'no-env'))))
      const CONN_VIEW = {
        ok: ['已连接', 'good'],
        unverified: ['凭证已保存，待验证', 'warn'],
        'no-credential': ['未登录', 'idle'],
        'no-env': ['环境未就绪', 'warn'],
        expired: ['登录已失效', 'bad'],
        error: ['连接检测失败', 'bad'],
        'qr-waiting': ['等待扫码', 'wait'],
        'qr-scanned': ['已扫码，等手机确认', 'wait'],
        'qr-expired': ['二维码过期', 'warn'],
        loading: ['读取状态…', 'wait'],
      }
      const [connText, connTone] = CONN_VIEW[connState] || ['未连接', 'idle']
      const connDetail = (() => {
        if (connState === 'loading') return '正在读取 B 站环境与登录状态'
        if (connState === 'ok') return [conn?.nickname, conn?.mid ? `UID ${conn.mid}` : ''].filter(Boolean).join(' · ') || '凭证有效'
        if (connState === 'unverified') return connBusy ? '正在问 B 站验证这张凭证…' : '点「检测连接」确认凭证还能用'
        if (connState === 'no-credential') return bEnv.ready ? '点下面的「扫码登录」，手机 B站 扫一下' : '先安装依赖，再扫码登录'
        if (connState === 'no-env') return conn?.message || '凭证在，但 B 站后端还没装好'
        if (connState === 'expired') return conn?.message || '重新扫码就能接上'
        if (connState === 'error') return conn?.message || '点「检测连接」重试'
        if (connState === 'qr-waiting') return '手机 B站 → 我的 → 扫一扫'
        if (connState === 'qr-scanned') return '在手机上点确认（选「记住我 / 长期」）'
        if (connState === 'qr-expired') return '再点一次「扫码登录」'
        return ''
      })()
      const step1Done = bEnv.ready === true
      const step2Done = loggedIn
      const step3Done = connState === 'ok'
      const step = (n, label, done, now) => h('span', {
        className: `bili-step${done ? ' done' : now ? ' now' : ''}`,
      }, `${done ? '✓' : n} ${label}`)

      const Toggle = ({ on, onChange, disabled }) => h('button', {
        type: 'button',
        className: `bili-sw${on ? ' on' : ''}`,
        disabled: Boolean(disabled),
        'aria-pressed': on ? 'true' : 'false',
        onClick: () => { if (!disabled) onChange(!on) },
      }, h('i'))
      const ToggleRow = ({ label, note, on, onChange, disabled }) => h('div', { className: 'bili-toggle-row' },
        h('div', { className: 'bili-toggle-text' },
          h('div', { className: 'bili-toggle-label' }, label),
          note ? h('div', { className: 'bili-toggle-note' }, note) : null),
        h(Toggle, { on, onChange, disabled }))
      const Field = ({ label, children }) => h('div', { className: 'bili-field' },
        h('span', { className: 'bili-field-label' }, label),
        h('div', { className: 'bili-field-body' }, children))

      const connButtons = []
      if (!bili) {
        connButtons.push(Btn({ disabled: true, children: '读取状态…' }))
      } else if (!step1Done) {
        connButtons.push(Btn({
          kind: 'primary', disabled: biliBusy === 'setup',
          onClick: () => biliGo('/api/bili/setup', 'setup'),
          children: biliBusy === 'setup' ? '安装中…' : '① 安装依赖',
        }))
      } else if (!loggedIn) {
        connButtons.push(Btn({
          kind: 'primary', disabled: biliBusy === 'login' || !step1Done,
          onClick: () => biliGo('/api/bili/login/start', 'login'),
          children: biliBusy === 'login' ? '出码中…' : '② 扫码登录',
        }))
      } else {
        connButtons.push(Btn({
          kind: 'primary', disabled: connBusy,
          onClick: () => checkConnection(true),
          children: connBusy ? '检测中…' : '检测连接',
        }))
        connButtons.push(Btn({
          disabled: biliBusy === 'login',
          onClick: () => biliGo('/api/bili/login/start', 'login'),
          children: '重新扫码',
        }))
      }

      const biliLoginCard = Card({
        children: h('div', { className: 'bili-hero-wrap' },
          h('div', { className: 'bili-hero' },
            h('div', { className: 'bili-hero-main' },
              h('div', { className: 'bili-status' },
                h('span', { className: `bili-dot ${connTone}` }),
                h('b', null, connText),
                conn?.nickname ? h('span', { className: 'bili-badge' }, conn.nickname) : null,
                conn?.mid ? h('span', { className: 'bili-badge' }, `UID ${conn.mid}`) : null),
              h('p', { className: 'bili-sub' }, connDetail),
              bili ? h('div', { className: 'bili-steps' },
                step(1, '装依赖', step1Done, !step1Done),
                step(2, '扫码登录', step2Done, step1Done && !step2Done),
                step(3, '已连接', step3Done, step2Done && !step3Done)) : null,
              h('div', { className: 'bili-actions' }, ...connButtons),
              loginMsg ? h('p', { className: 'kin-msg' }, loginMsg) : null,
              Note('凭证只存在她自己的家里；扫码成功后会自动向 B 站确认一次，确认失败也会如实告诉你。')),
            qrKey ? h('div', { className: 'bili-qr' },
              h('img', { src: `${KIN}/api/bili/qr?t=${qrAt}`, alt: 'B站登录二维码' }),
              h('div', { className: 'bili-qr-hint' }, connState === 'qr-scanned' ? '扫到了，在手机上点确认' : '手机 B站 → 我的 → 扫一扫'),
              h('div', { className: 'kin-row' },
                Btn({ tiny: true, onClick: () => pollLogin(false), children: '我扫了，查一下' }),
                Btn({ tiny: true, onClick: () => { setQrKey(''); setQrPhase(''); setLoginMsg('') }, children: '收起' }))) : null),
          h('div', { className: 'bili-stat-strip' },
            h('div', { className: 'bili-stat' }, h('b', null, bili?.pickedToday ?? 0), h('span', null, '今天挑到')),
            h('div', { className: 'bili-stat' }, h('b', null, bili?.runs ?? 0), h('span', null, '今天跑了几轮')),
            h('div', { className: 'bili-stat' }, h('b', null, bEnv.ready ? '就绪' : '未装'), h('span', null, '运行环境')),
            h('div', { className: 'bili-stat' }, h('b', null, bili?.nextRunAt ? new Date(bili.nextRunAt).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '自动关着'), h('span', null, '下一次')),
            h('div', { className: 'bili-stat' }, h('b', null, bili?.running ? '在逛' : '空闲'), h('span', null, '此刻'))),
          h('div', { className: 'bili-toolbar' },
            Btn({ kind: 'primary', onClick: () => biliGo('/api/bili/run', 'run'), disabled: Boolean(biliBusy), children: biliBusy === 'run' ? '递过去了…' : '现在逛一轮' }),
            Btn({ onClick: refresh, children: '刷新' }),
            Btn({ onClick: loadBiliReport, children: '看今天的日报' }),
            Note('她不是另起一个「B站助手」——这一轮就是她自己，人设用的是大肥鱼的身份段。'))),
      })

      const validDraftTimes = splitLines(timesText).filter((x) => /^\d{1,2}:\d{2}$/.test(x))
      const hasTimes = validDraftTimes.length > 0
      const scheduleSummary = (() => {
        const times = validDraftTimes
        const win = bSch.window ?? ['12:00', '14:00']
        const base = times.length
          ? `每天按 ${times.join(' / ')} 跑`
          : `每天 ${bSch.perDay ?? 1} 轮，在 ${win[0]}–${win[1]} 里摊平`
        return bSch.offPeakOnly === true ? `${base}；到点正好高峰就顺延到谷时` : base
      })()

      const biliScheduleCard = Card({
        title: '什么时候逛',
        children: h('div', { className: 'bili-form' },
          h('div', { className: 'bili-summary' }, scheduleSummary),
          ToggleRow({
            label: '允许她用 B 站', note: '总开关，跟登录无关；关掉后她看不到这些工具',
            on: bCfg.enabled !== false, onChange: (v) => patchB({ enabled: v }),
          }),
          ToggleRow({
            label: '自动逛', note: '关着就只能手动「现在逛一轮」',
            on: bSch.enabled === true, onChange: (v) => patchBGroup('schedule', { enabled: v }),
          }),
          Field({ label: '时间点', children: h('input', {
            className: 'kin-input', value: timesText, placeholder: '例如 12:30, 20:30（留空就用下面的时间窗）',
            onChange: (e) => setTimesText(e.target.value),
          }) }),
          hasTimes
            ? h('div', { className: 'bili-note bili-hint' }, '填了时间点就按这些点跑；下面的时间窗/每天几轮不参与。')
            : [
                h(Field, { key: 'window', label: '时间窗', children: h('div', { className: 'bili-inline' },
                  h('input', { className: 'kin-input', style: { width: 74 }, value: (bSch.window ?? ['12:00', '14:00'])[0], onChange: (e) => patchBGroup('schedule', { window: [e.target.value, (bSch.window ?? ['12:00', '14:00'])[1]] }) }),
                  h('span', { className: 'bili-note' }, '至'),
                  h('input', { className: 'kin-input', style: { width: 74 }, value: (bSch.window ?? ['12:00', '14:00'])[1], onChange: (e) => patchBGroup('schedule', { window: [(bSch.window ?? ['12:00', '14:00'])[0], e.target.value] }) }),
                  h('span', { className: 'bili-note' }, '每天'),
                  Num({ value: bSch.perDay ?? 1, min: 0, max: 8, onChange: (v) => patchBGroup('schedule', { perDay: v }) }),
                  h('span', { className: 'bili-note' }, '轮')) }),
                h('div', { key: 'hint', className: 'bili-note bili-hint' }, '没填时间点：在时间窗里摊平每天几轮。'),
              ],
          ToggleRow({
            label: '高峰时段顺延', note: '到点正好是高峰就顺延到谷时；其它设置照常生效',
            on: bSch.offPeakOnly === true, onChange: (v) => patchBGroup('schedule', { offPeakOnly: v }),
          }),
          Field({ label: '防手滑', children: h('div', { className: 'bili-inline' },
            Num({ value: bSch.cooldownMin ?? 20, min: 0, max: 180, onChange: (v) => patchBGroup('schedule', { cooldownMin: v }) }),
            h('span', { className: 'bili-note' }, '分钟内不重复跑')) }),
          h('div', { className: 'bili-save' }, Btn({ kind: 'primary', onClick: saveBiliSchedule, children: '保存' }))),
      })

      const biliPrefsCard = Card({
        title: '口味与挑选',
        children: h('div', { className: 'bili-form' },
          h('textarea', {
            className: 'kin-input', style: { minHeight: 76, resize: 'vertical' }, value: bPref.taste ?? '',
            placeholder: '例如：喜欢 AI / 独立游戏 / 手作；不爱看十分钟以上的资讯复读和标题党。',
            onChange: (e) => patchBGroup('preferences', { taste: e.target.value }),
          }),
          Field({ label: '关注', children: h('textarea', {
            className: 'kin-input', style: { minHeight: 58, resize: 'vertical' }, value: kwText,
            placeholder: '一行一个；留空就刷首页推荐流',
            onChange: (e) => setKwText(e.target.value),
          }) }),
          Field({ label: '避开', children: h('textarea', {
            className: 'kin-input', style: { minHeight: 52, resize: 'vertical' }, value: exText,
            placeholder: '一行一个：标题 / UP / 简介里出现就整条跳过',
            onChange: (e) => setExText(e.target.value),
          }) }),
          Field({ label: '挑选', children: h('div', { className: 'bili-three' },
            h('select', { className: 'kin-input', value: bPref.sort ?? 'pubdate', onChange: (e) => patchBGroup('preferences', { sort: e.target.value }) },
              h('option', { value: 'pubdate' }, '最新'),
              h('option', { value: 'click' }, '播放'),
              h('option', { value: 'dm' }, '弹幕'),
              h('option', { value: 'totalrank' }, '综合')),
            Num({ value: bPref.pages ?? 2, min: 1, max: 5, onChange: (v) => patchBGroup('preferences', { pages: v }) }),
            Num({ value: bPref.fetchPerRound ?? 8, min: 1, max: 20, onChange: (v) => patchBGroup('preferences', { fetchPerRound: v }) })) }),
          Field({ label: '每天最多', children: h('div', { className: 'bili-inline' },
            Num({ value: bPref.maxPicks ?? 5, min: 1, max: 10, onChange: (v) => patchBGroup('preferences', { maxPicks: v }) }),
            h('span', { className: 'bili-note' }, '条（自动轮到这个数就收；手动轮可以再多）')) }),
          Field({ label: '日报', children: h('select', {
            className: 'kin-input', value: bCfg.report ?? 'full', onChange: (e) => patchB({ report: e.target.value }),
          },
            h('option', { value: 'full' }, '完整'),
            h('option', { value: 'brief' }, '薄版'),
            h('option', { value: 'off' }, '不写日报')) }),
          h('div', { className: 'bili-save' }, Btn({ kind: 'primary', onClick: saveBiliPrefs, children: '保存' }))),
      })

      const biliShareCard = Card({
        title: '分享与说话',
        children: h('div', { className: 'bili-form' },
          ToggleRow({
            label: '允许分享挑中的视频', note: '挑中后写日报、判重表，并私信给你',
            on: bShare.enabled !== false, onChange: (v) => patchBGroup('share', { enabled: v }),
          }),
          Field({ label: '投递', children: h('div', { className: 'bili-inline' },
            h('select', { className: 'kin-input', value: bShare.mode ?? 'dm', onChange: (e) => patchBGroup('share', { mode: e.target.value }) },
              h('option', { value: 'dm' }, '私信给我'),
              h('option', { value: 'note' }, '只写日报'),
              h('option', { value: 'off' }, '不分享')),
            h('input', { className: 'kin-input', style: { width: 126 }, type: 'number', value: Number(bShare.uid ?? 0), onChange: (e) => patchBGroup('share', { uid: Number(e.target.value) || 0 }) }),
            h('span', { className: 'bili-note' }, 'UID，0 = 登录账号自己')) }),
          ToggleRow({
            label: '读主人发来的私信', note: '只回主人本人；默认关',
            on: bShare.watch === true, onChange: (v) => patchBGroup('share', { watch: v }),
          }),
          Field({ label: '查私信', children: h('div', { className: 'bili-inline' },
            Num({ value: bShare.watchMinutes ?? 3, min: 1, max: 60, onChange: (v) => patchBGroup('share', { watchMinutes: v }) }),
            h('span', { className: 'bili-note' }, '分钟一次 · 每天最多回'),
            Num({ value: bShare.replyPerDay ?? 20, min: 0, max: 100, onChange: (v) => patchBGroup('share', { replyPerDay: v }) }),
            h('span', { className: 'bili-note' }, '条')) }),
          h('div', { className: 'bili-divider' }),
          ToggleRow({
            label: '公开评论并 @ 我', note: '默认关；开了会拿你的号说话',
            on: bComment.enabled === true, onChange: (v) => patchBGroup('comment', { enabled: v }),
          }),
          Field({ label: '@ 谁', children: h('input', {
            className: 'kin-input', value: bComment.mention ?? '', placeholder: 'B站昵称；留空 = 不发评论',
            onChange: (e) => patchBGroup('comment', { mention: e.target.value }),
          }) }),
          Field({ label: '评论', children: h('div', { className: 'bili-three' },
            Num({ value: bComment.perRound ?? 1, min: 0, max: 20, onChange: (v) => patchBGroup('comment', { perRound: v }) }),
            h('select', { className: 'kin-input', value: bComment.length ?? 'medium', onChange: (e) => patchBGroup('comment', { length: e.target.value }) },
              h('option', { value: 'short' }, '短'),
              h('option', { value: 'medium' }, '中'),
              h('option', { value: 'long' }, '长')),
            Num({ value: bComment.replyPerRound ?? 1, min: 0, max: 5, onChange: (v) => patchBGroup('comment', { replyPerRound: v }) })) }),
          ToggleRow({
            label: '回复直接回我评论的人', note: '只回你那条下面；每轮最多几条',
            on: bComment.replyToComments === true, onChange: (v) => patchBGroup('comment', { replyToComments: v }),
          }),
          h('div', { className: 'bili-save' }, Btn({ kind: 'primary', onClick: saveBiliShare, children: '保存' }))),
      })

      const biliAsrCard = Card({
        title: '没字幕的视频',
        children: h('div', { className: 'bili-form' },
          ToggleRow({
            label: '本地转写', note: '没字幕的视频用本机 Whisper 转文字',
            on: bAsr.enabled === true, onChange: (v) => patchBGroup('transcribe', { enabled: v }),
          }),
          Field({ label: '模型', children: h('select', {
            className: 'kin-input', value: bAsr.model ?? 'small', onChange: (e) => patchBGroup('transcribe', { model: e.target.value }),
          },
            h('option', { value: 'tiny' }, 'tiny（最快，最不准）'),
            h('option', { value: 'base' }, 'base'),
            h('option', { value: 'small' }, 'small（默认）'),
            h('option', { value: 'medium' }, 'medium（更准更慢）')) }),
          h('div', { className: 'bili-inline bili-envline' },
            h('span', { className: 'bili-note' }, bEnv.asrReady ? '转写环境就绪' : `还没装好：${bEnv.asrReason || '未安装'}`),
            Btn({ onClick: () => biliGo('/api/bili/asr-setup', 'asr-setup'), disabled: Boolean(biliBusy), children: biliBusy === 'asr-setup' ? '在装…' : '安装转写依赖' })),
          Note('只打开开关不够，还要装一次依赖（独立 venv + faster-whisper + yt-dlp，会下几百 MB 模型）。'),
          h('pre', { className: 'bili-pre' }, (bili?.asrTail || '').slice(-900) || '（转写日志空）'),
          h('div', { className: 'bili-save' }, Btn({ kind: 'primary', onClick: saveBiliAsr, children: '保存' }))),
      })

      const biliEnvCard = Card({
        title: '环境与日志',
        children: h('div', { className: 'bili-form' },
          h('div', { className: 'bili-inline bili-envline' },
            h('span', { className: 'bili-mono bili-grow' }, bEnv.ready ? `环境就绪：${bEnv.python}` : (bEnv.installing ? '正在装依赖…' : '环境未就绪')),
            Btn({ onClick: () => biliGo('/api/bili/setup', 'setup'), disabled: Boolean(biliBusy), children: biliBusy === 'setup' ? '在装…' : '安装 / 重装依赖' }),
            Btn({ onClick: () => biliGo('/api/bili/test', 'test'), children: '测一下' })),
          Note('装依赖只动她自己家（Dsh 的 bili 目录）；凭证不上传任何地方。'),
          h('pre', { className: 'bili-pre' }, (bili?.installTail || '').slice(-900) || '（安装日志空）')),
      })

      const pageBili = h('div', { className: 'kin-page bili-page' }, biliLoginCard, biliScheduleCard, biliPrefsCard, biliShareCard, biliAsrCard, biliEnvCard)

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
        try {
          const resp = await fetch(KIN + '/api/bili/report')
          if (!resp.ok) { setReport('今天还没有日报。'); return }
          setReport((await resp.text()) || '今天还没有日报。')
        } catch { setReport('读不到日报。') }
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
        title: '今天的 B 站日报',
        children: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          h('div', { className: 'kin-row' },
            Btn({ kind: 'primary', onClick: loadReport, children: report === null ? '看今天的报告' : '重新生成' }),
            h('span', { className: 'kin-note' }, '只读；和「B站」页签里的日报是同一份。')),
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

      const pages = { 她: pageHer, 生物钟: pageWake, B站: pageBili, '工具与工作区': pageTools, 传承: pageKin, 进阶: pageAdv }

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
      ctx.effect(
        () => ctx.slots.inject('conversation.view', () =>
          ctx.slots.register(
            { name: 'conversation.view', id: 'bili-seen', order: -10, label: () => '刷过的视频' },
            BiliSeenView,
          ), 'dsh-fish-kin: bili seen view'),
        'dsh-fish-kin: bili seen view',
      )
    }

    exports.apply = apply
    exports.inject = inject
    exports.KinSection = KinSection
    exports.BiliSeenView = BiliSeenView
    return module.exports
  },
})

if (typeof window !== 'undefined' && window.__ModuleLoader__?.load) {
  window.__ModuleLoader__.load(MODULE)
}
