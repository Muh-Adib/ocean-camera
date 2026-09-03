// ---------------------------------------------------------------
// RemotePhonePad — the BUTTON PAD half of the phone controller.
//
// A touch surface built for one thumb and a show operator's glance:
//   · action grid   — FEED / BURST / SHARK / TURTLE / RAY / PULSE,
//                     each fired once per tap over /api/remote/cmd
//   · toggles       — SWIM and SOUND, badged with the studio's real
//                     state (host echo polled every 1.5 s)
//   · BOOST         — hold-to-swim-fast (only while SWIM is on)
//   · joystick      — steers the primary current: synthesized as a
//                     single open-palm hand frame streamed through
//                     the EXISTING /api/remote/hands pipeline, so
//                     the fish follow the stick on every ocean page
//                     with zero new consumption code. Flick the
//                     stick and the gesture engine reads it exactly
//                     like a real palm — hold = attract, the ocean
//                     drifts with you.
// ---------------------------------------------------------------
import type { RemoteCmdType } from './RemoteCmds'

export interface PadHandFrame {
  x: number
  y: number
  openness: number
  scale: number
  lm?: number[][]
  label: string
}

export interface PadHandle {
  root: HTMLElement
  /** begin liveness ping + host-state polling (pad mode entered) */
  start: () => void
  /** stop timers, release the stick, clear pressed looks (pad mode left) */
  stop: () => void
}

/** minimal inline stroke icons — no emoji, no font deps */
function icon(name: string): string {
  const wrap = (inner: string) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`
  switch (name) {
    case 'feed':
      return wrap('<circle cx="7.2" cy="15.5" r="1.5"/><circle cx="12" cy="18" r="1.5"/><circle cx="16.8" cy="13.5" r="1.5"/><path d="M5 8.2c2.4-2.6 11.6-2.6 14 0"/>')
    case 'burst':
      return wrap('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>')
    case 'shark':
      return wrap('<path d="M6 19C8 12 13 7.2 20 5.5c-2.4 3.4-3.4 8-3 13.5Z"/><path d="M3 21.5h18" opacity="0.5"/>')
    case 'turtle':
      return wrap('<ellipse cx="11" cy="13.5" rx="6.2" ry="4.8"/><circle cx="19.6" cy="11.8" r="1.9"/><path d="M7.8 10.6h6.4M8.6 16.4h4.8" opacity="0.55"/><path d="M5.6 10.4 3.4 8.8M16.4 10.4l2.2-1.6" opacity="0.55"/>')
    case 'ray':
      return wrap('<path d="M2.5 12.6C7 8.2 17 8.2 21.5 12.6c-4.4-.9-7 .3-9.5 2.9-2.5-2.6-5.1-3.8-9.5-2.9Z"/><path d="M12 15.5V19m0 0 2.2-1.4" opacity="0.7"/>')
    case 'pulse':
      return wrap('<circle cx="12" cy="12" r="2.1"/><path d="M12 5.4a6.6 6.6 0 0 1 6.6 6.6M12 18.6a6.6 6.6 0 0 1-6.6-6.6"/><path d="M12 2.4a9.6 9.6 0 0 1 9.6 9.6M12 21.6A9.6 9.6 0 0 1 2.4 12" opacity="0.5"/>')
    case 'swim':
      return wrap('<path d="M2.5 9.4c2.4 0 2.4-1.5 4.75-1.5s2.4 1.5 4.75 1.5 2.4-1.5 4.75-1.5 2.4 1.5 4.75 1.5"/><path d="M2.5 15.6c2.4 0 2.4-1.5 4.75-1.5s2.4 1.5 4.75 1.5 2.4-1.5 4.75-1.5 2.4 1.5 4.75 1.5" opacity="0.55"/>')
    case 'sound':
      return wrap('<path d="M4 9.6v4.8h3.2L11.4 18V6L7.2 9.6Z"/><path d="M14.6 9.4a3.9 3.9 0 0 1 0 5.2"/><path d="M17 7.2a7 7 0 0 1 0 9.6" opacity="0.6"/>')
    case 'boost':
      return wrap('<path d="M6 13 12 7.5 18 13"/><path d="M6 18.5 12 13l6 5.5" opacity="0.55"/>')
    default:
      return wrap('<circle cx="12" cy="12" r="7"/>')
  }
}

interface ActionDef { id: RemoteCmdType; label: string; sub: string; color: string }
const ACTIONS: ActionDef[] = [
  { id: 'feed',   label: 'FEED',   sub: 'drop snacks',  color: '#ffd670' },
  { id: 'burst',  label: 'BURST',  sub: 'shockwave',    color: '#ff9f6e' },
  { id: 'shark',  label: 'SHARK',  sub: 'predator',     color: '#ff8f8f' },
  { id: 'turtle', label: 'TURTLE', sub: 'visitor',      color: '#7bffb2' },
  { id: 'ray',    label: 'RAY',    sub: 'glider',       color: '#6ee7ff' },
  { id: 'pulse',  label: 'PULSE',  sub: 'light wave',   color: '#c4a5ff' },
]

const BTN_CSS = [
  'appearance:none', 'border:1px solid rgba(110,231,255,0.3)', 'border-radius:16px',
  'background:linear-gradient(165deg, rgba(12,56,86,0.92), rgba(4,24,42,0.94))',
  'color:#dff3fb', 'display:flex', 'flex-direction:column', 'align-items:center',
  'justify-content:center', 'gap:5px', 'cursor:pointer', 'min-height:44px',
  'box-shadow:0 6px 18px rgba(0,0,0,0.35)', 'padding:8px 4px',
  'transition:transform 0.08s ease, border-color 0.12s ease, box-shadow 0.12s ease',
  'touch-action:manipulation', 'user-select:none', '-webkit-user-select:none',
].join(';')

function pressLook(btn: HTMLElement, on: boolean) {
  btn.style.transform = on ? 'translateY(1.5px) scale(0.985)' : ''
  btn.style.borderColor = on ? 'rgba(140,240,255,0.75)' : 'rgba(110,231,255,0.3)'
  btn.style.boxShadow = on ? '0 0 0 3px rgba(110,231,255,0.18), 0 4px 12px rgba(0,0,0,0.35)' : '0 6px 18px rgba(0,0,0,0.35)'
}

export function buildPadStage(opts: {
  room: string
  sendCmd: (type: RemoteCmdType, on?: boolean) => Promise<boolean>
  postHands: (hands: PadHandFrame[]) => Promise<boolean>
  setStatus: (text: string, color: string) => void
  buzz: (ms?: number) => void
}): PadHandle {
  const { room, sendCmd, postHands, setStatus, buzz } = opts

  const root = document.createElement('div')
  root.style.cssText = [
    'position:absolute', 'inset:0', 'display:none', 'flex-direction:column',
    'padding:12px 14px 8px', 'gap:12px', 'overflow:hidden',
  ].join(';')

  // ---------------- action grid ----------------
  const grid = document.createElement('div')
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:10px;flex:none;'
  const actionBtns = new Map<string, HTMLElement>()

  for (const a of ACTIONS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.setAttribute('aria-label', `${a.label} — ${a.sub}`)
    btn.style.cssText = BTN_CSS
    btn.innerHTML =
      `<span style="width:30px;height:30px;color:${a.color};display:block;">${icon(a.id)}</span>` +
      `<span style="font-size:11.5px;font-weight:700;letter-spacing:0.12em;">${a.label}</span>` +
      `<span style="font-size:9px;color:#7fa8bb;letter-spacing:0.06em;">${a.sub}</span>`
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      pressLook(btn, true)
      buzz(a.id === 'burst' || a.id === 'shark' ? 26 : 14)
      setStatus(`SENT · ${a.label}`, '#7bffb2')
      void sendCmd(a.id).then((ok) => {
        if (!ok) setStatus('OFFLINE — server unreachable', '#ff8f8f')
      })
    })
    const relax = () => pressLook(btn, false)
    btn.addEventListener('pointerup', relax)
    btn.addEventListener('pointercancel', relax)
    btn.addEventListener('pointerleave', relax)
    grid.appendChild(btn)
    actionBtns.set(a.id, btn)
  }

  // ---------------- joystick + toggles row ----------------
  const row = document.createElement('div')
  row.style.cssText = 'display:flex;gap:12px;flex:1;min-height:0;align-items:stretch;'

  // -- joystick --
  const joyWrap = document.createElement('div')
  joyWrap.id = 'pad-joystick'
  joyWrap.style.cssText = [
    'flex:0 0 auto', 'width:min(44vw, 190px)', 'aspect-ratio:1', 'align-self:center',
    'border-radius:50%', 'position:relative', 'touch-action:none',
    'background:radial-gradient(circle at 50% 42%, rgba(16,66,98,0.85), rgba(3,18,32,0.9))',
    'border:1.5px solid rgba(110,231,255,0.32)',
    'box-shadow:inset 0 0 24px rgba(0,0,0,0.45), 0 8px 24px rgba(0,0,0,0.35)',
  ].join(';')
  const joyRing = document.createElement('div')
  joyRing.style.cssText = 'position:absolute;inset:18%;border-radius:50%;border:1px dashed rgba(110,231,255,0.22);pointer-events:none;'
  const joyHint = document.createElement('div')
  joyHint.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:9.5px;letter-spacing:0.14em;color:#5f8ba0;pointer-events:none;text-align:center;line-height:1.5;'
  joyHint.innerHTML = 'STEER<br>THE FISH'
  const knob = document.createElement('div')
  knob.style.cssText = [
    'position:absolute', 'left:50%', 'top:50%', 'width:38%', 'height:38%',
    'border-radius:50%', 'transform:translate(-50%,-50%)',
    'background:radial-gradient(circle at 38% 32%, #9fe8ff, #3fa6cc 68%, #2a7ba0)',
    'box-shadow:0 6px 16px rgba(0,0,0,0.45), inset 0 -3px 8px rgba(0,0,0,0.25)',
    'transition:transform 0.12s ease', 'pointer-events:none',
  ].join(';')
  joyWrap.append(joyRing, joyHint, knob)

  let stickActive = false
  let stickTimer = 0
  let stickNX = 0.5
  let stickNY = 0.5
  let lastStickSend = 0
  const STICK_R = 0.42          // normalized deflection at full tilt
  const STICK_OPEN = 0.78       // open-palm openness → attract mode
  const STICK_INTERVAL_MS = 90  // keepalive while held

  const setKnob = (dx: number, dy: number, r: number) => {
    knob.style.transition = 'none'
    knob.style.transform = `translate(calc(-50% + ${dx.toFixed(1)}px), calc(-50% + ${dy.toFixed(1)}px))`
    joyWrap.style.borderColor = r > 0.02 ? 'rgba(140,240,255,0.7)' : 'rgba(110,231,255,0.32)'
    joyWrap.style.boxShadow = r > 0.02
      ? 'inset 0 0 24px rgba(0,0,0,0.45), 0 0 22px rgba(110,231,255,0.28)'
      : 'inset 0 0 24px rgba(0,0,0,0.45), 0 8px 24px rgba(0,0,0,0.35)'
    joyHint.style.opacity = r > 0.02 ? '0' : '1'
  }
  const resetKnob = () => {
    knob.style.transition = 'transform 0.18s ease'
    knob.style.transform = 'translate(-50%,-50%)'
    joyWrap.style.borderColor = 'rgba(110,231,255,0.32)'
    joyWrap.style.boxShadow = 'inset 0 0 24px rgba(0,0,0,0.45), 0 8px 24px rgba(0,0,0,0.35)'
    joyHint.style.opacity = '1'
  }

  const stickFrame = (): PadHandFrame => {
    const nx = Number.isFinite(stickNX) ? Math.min(1, Math.max(0, stickNX)) : 0.5
    const ny = Number.isFinite(stickNY) ? Math.min(1, Math.max(0, stickNY)) : 0.5
    return {
      x: nx,
      y: ny,
      openness: STICK_OPEN,
      scale: 0.15,
      label: 'stick',
    }
  }

  const sendStick = (force = false) => {
    const now = performance.now()
    if (!force && now - lastStickSend < 40) return
    lastStickSend = now
    void postHands([stickFrame()])
  }

  const onStickMove = (e: PointerEvent) => {
    if (!stickActive) return
    const rect = joyWrap.getBoundingClientRect()
    if (!rect.width || !rect.height) return   // hidden pad — nothing to measure
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const max = rect.width * 0.30
    let dx = e.clientX - cx
    let dy = e.clientY - cy
    const dist = Math.hypot(dx, dy)
    if (dist > max) { dx = (dx / dist) * max; dy = (dy / dist) * max }
    stickNX = 0.5 + (dx / max) * STICK_R
    stickNY = 0.5 + (dy / max) * STICK_R
    setKnob(dx, dy, dist / max)
    sendStick(true)
  }

  const stickDown = (e: PointerEvent) => {
    e.preventDefault()
    stickActive = true
    try { joyWrap.setPointerCapture(e.pointerId) } catch { /* synthetic / stale pointer id */ }
    buzz(10)
    setStatus('STICK LIVE', '#7bffb2')
    onStickMove(e)
    if (stickTimer) clearInterval(stickTimer)
    stickTimer = window.setInterval(() => {
      if (stickActive) sendStick(true)
    }, STICK_INTERVAL_MS)
  }

  const stickUp = () => {
    if (!stickActive) return
    stickActive = false
    if (stickTimer) { clearInterval(stickTimer); stickTimer = 0 }
    resetKnob()
    // let the current die: an empty frame calms the fish everywhere
    void postHands([])
    setStatus('PAD READY', '#7fd4ee')
  }

  joyWrap.addEventListener('pointerdown', stickDown)
  joyWrap.addEventListener('pointermove', onStickMove)
  joyWrap.addEventListener('pointerup', stickUp)
  joyWrap.addEventListener('pointercancel', stickUp)

  // -- right column: toggles + boost --
  const col = document.createElement('div')
  col.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:10px;justify-content:center;min-width:0;'

  const badge = (on: boolean) =>
    `<span style="margin-left:auto;display:flex;align-items:center;gap:5px;font-size:9.5px;letter-spacing:0.1em;color:${on ? '#7bffb2' : '#6d94a8'};">` +
    `<span style="width:7px;height:7px;border-radius:50%;background:${on ? '#7bffb2' : '#3d5b6b'};box-shadow:${on ? '0 0 8px #7bffb2' : 'none'};"></span>${on ? 'ON' : 'OFF'}</span>`

  const mkToggle = (id: RemoteCmdType, label: string, iconName: string, hint: string) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.setAttribute('aria-label', `${label} toggle — ${hint}`)
    btn.style.cssText = BTN_CSS + ';flex-direction:row;justify-content:flex-start;padding:8px 14px;gap:10px;min-height:52px;'
    btn.innerHTML =
      `<span style="width:22px;height:22px;color:#8fd8ef;display:block;flex:none;">${icon(iconName)}</span>` +
      `<span style="font-size:12px;font-weight:700;letter-spacing:0.14em;">${label}</span>` +
      `<span data-badge style="margin-left:auto;font-size:9.5px;letter-spacing:0.1em;color:#6d94a8;">—</span>`
    let local: boolean | null = null
    const paint = (on: boolean) => {
      const b = btn.querySelector('[data-badge]')
      if (b) b.innerHTML = badge(on)
    }
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      pressLook(btn, true)
      buzz(14)
      local = local === null ? true : !local   // optimistic flip, poll corrects
      paint(local)
      setStatus(`SENT · ${label}`, '#7bffb2')
      void sendCmd(id).then((ok) => { if (!ok) setStatus('OFFLINE — server unreachable', '#ff8f8f') })
    })
    const relax = () => pressLook(btn, false)
    btn.addEventListener('pointerup', relax)
    btn.addEventListener('pointercancel', relax)
    btn.addEventListener('pointerleave', relax)
    col.appendChild(btn)
    return {
      btn,
      set state(on: boolean) { local = on; paint(on) },
    }
  }

  const swimToggle = mkToggle('swim', 'SWIM', 'swim', 'free-swim camera on the big screen')
  const soundToggle = mkToggle('sound', 'SOUND', 'sound', 'mute or unmute the studio')

  // -- boost (hold) --
  const boost = document.createElement('button')
  boost.type = 'button'
  boost.setAttribute('aria-label', 'Boost — hold to swim faster (needs SWIM on)')
  boost.style.cssText = BTN_CSS + ';flex-direction:row;justify-content:center;gap:10px;min-height:52px;'
  boost.innerHTML =
    `<span style="width:22px;height:22px;color:#ffd670;display:block;flex:none;">${icon('boost')}</span>` +
    `<span style="font-size:12px;font-weight:700;letter-spacing:0.14em;">BOOST</span>` +
    `<span style="font-size:9px;color:#7fa8bb;letter-spacing:0.08em;">HOLD</span>`
  let boostHeld = false
  boost.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    buzz(12)
    if (!swimOn) {
      boost.style.opacity = '0.45'
      setStatus('SWIM IS OFF — TURN IT ON FIRST', '#ffd670')
      window.setTimeout(() => { boost.style.opacity = '1' }, 650)
      return
    }
    boostHeld = true
    pressLook(boost, true)
    void sendCmd('boost', true)
  })
  const boostRelease = () => {
    if (!boostHeld) { boost.style.opacity = '1'; return }
    boostHeld = false
    pressLook(boost, false)
    void sendCmd('boost', false)
  }
  boost.addEventListener('pointerup', boostRelease)
  boost.addEventListener('pointercancel', boostRelease)
  boost.addEventListener('pointerleave', boostRelease)
  col.appendChild(boost)

  let swimOn = false
  let mutedOn = false

  row.append(joyWrap, col)
  root.append(grid, row)
  // (hint text lives in the main legend under the stage — setMode keeps
  //  it in sync per mode, so the pad itself adds no second copy)

  // ---------------- host-state polling + liveness ping ----------------
  let pollTimer = 0
  let pingTimer = 0

  async function pollHost() {
    try {
      const res = await fetch(`/api/remote/cmd?room=${encodeURIComponent(room)}`)
      if (!res.ok) return
      const data = await res.json() as { host?: { swim?: boolean; muted?: boolean } | null }
      if (data.host) {
        if (typeof data.host.swim === 'boolean') {
          swimOn = data.host.swim
          swimToggle.state = swimOn
          boost.style.opacity = swimOn ? '1' : '0.55'
        }
        if (typeof data.host.muted === 'boolean') {
          mutedOn = data.host.muted
          soundToggle.state = mutedOn
        }
      }
    } catch { /* server hiccup — keep last badges */ }
  }

  return {
    root,
    start() {
      void pollHost()
      if (!pollTimer) pollTimer = window.setInterval(() => void pollHost(), 1500)
      if (!pingTimer) {
        pingTimer = window.setInterval(() => {
          void fetch('/api/remote/cmd', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room, ping: true }),
            keepalive: true,
          }).catch(() => { /* liveness only */ })
        }, 2500)
      }
      boost.style.opacity = swimOn ? '1' : '0.55'
    },
    stop() {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = 0 }
      if (pingTimer) { clearInterval(pingTimer); pingTimer = 0 }
      stickUp()
      boostHeld = false
      pressLook(boost, false)
      for (const btn of actionBtns.values()) pressLook(btn, false)
      void mutedOn // badges persist between visits
    },
  }
}
