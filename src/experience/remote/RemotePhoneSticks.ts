// ---------------------------------------------------------------
// RemotePhoneSticks — the double joystick that floats over the
// phone's camera view.
//
// The user asked for ONE thing on the phone: camera on → controls;
// camera off → controls off. The controls themselves are two
// velocity joysticks (like a drone / FPS controller) plus a pinch:
//
//   LEFT stick — MOVE    : right/left = geser samping (X),
//                          up/down    = naik-turun kamera (Y)
//   RIGHT stick — ORBIT  : right/left = sweep the chain (yaw),
//                          up/down    = tilt it (pitch)
//   PINCH on the view    : dolly Z (toward / away)
//   ⟲ button             : glide everything back home
//
// VELOCITY, not position: while a stick is deflected it streams
// small per-tick DELTAS (rate·dt), so the receiving page nudges its
// own live target — a late packet can never yank the camera back to
// a stale value, and pushing into a range limit just saturates
// smoothly. That is what makes the movement feel "smooth, tidak
// patah-patah".
// ---------------------------------------------------------------

export interface StickDelta {
  dyaw?: number
  dpitch?: number
  ddolly?: number
  dmx?: number
  dmy?: number
}

export interface SticksHandle {
  root: HTMLElement
  setVisible: (on: boolean) => void
  start: () => void
  stop: () => void
}

/** axis rates at full deflection */
const STRAFE_RATE = 6.5     // m/s  (MOVE X)
const LIFT_RATE = 4.5       // m/s  (MOVE Y — naik/turun)
const YAW_RATE = 80         // °/s  (orbit)
const PITCH_RATE = 38       // °/s  (tilt)
const DOLLY_PER_PINCH = 9   // m per full pinch-out
const DEADZONE = 0.14
const FLUSH_MS = 33         // ≈30 Hz

const DEAD = 0 // NaN-safe default

function shape(v: number): number {
  const a = Math.abs(v)
  if (a <= DEADZONE) return 0
  const s = (a - DEADZONE) / (1 - DEADZONE)
  return Math.sign(v) * s * s * (3 - 2 * s) // smoothstep for fine control near centre
}

function mkStick(label: string, sub: string, accent: string) {
  const zone = document.createElement('div')
  zone.style.cssText = [
    'position:absolute', 'bottom:26px', 'width:132px', 'height:132px',
    'touch-action:none', 'pointer-events:auto', 'z-index:3',
  ].join(';')

  const base = document.createElement('div')
  base.style.cssText = [
    'position:absolute', 'inset:6px', 'border-radius:50%',
    'background:radial-gradient(circle at 50% 40%, rgba(10,44,66,0.55), rgba(2,14,26,0.7))',
    'border:1.5px solid rgba(110,231,255,0.4)',
    'box-shadow:inset 0 0 22px rgba(0,0,0,0.5), 0 6px 22px rgba(0,0,0,0.4)',
    'backdrop-filter:blur(2px)',
  ].join(';')

  const ring = document.createElement('div')
  ring.style.cssText = [
    'position:absolute', 'inset:26px', 'border-radius:50%',
    `border:1px dashed ${accent}`, 'opacity:0.35',
  ].join(';')

  const knob = document.createElement('div')
  knob.style.cssText = [
    'position:absolute', 'left:50%', 'top:50%', 'width:56px', 'height:56px',
    'margin:-28px 0 0 -28px', 'border-radius:50%',
    `background:radial-gradient(circle at 38% 32%, ${accent}, rgba(20,70,100,0.95) 72%)`,
    'border:1.5px solid rgba(224,247,255,0.65)',
    'box-shadow:0 4px 16px rgba(0,0,0,0.55)',
    'transition:transform 0.14s ease, box-shadow 0.14s ease',
    'will-change:transform',
  ].join(';')

  const cap = document.createElement('div')
  cap.style.cssText = [
    'position:absolute', 'left:0', 'right:0', 'bottom:-20px', 'text-align:center',
    'font-size:8.5px', 'font-weight:700', 'letter-spacing:0.18em', 'color:#9fd7ea',
    'text-shadow:0 1px 4px rgba(0,0,0,0.9)', 'pointer-events:none',
  ].join(';')
  cap.innerHTML = `${label}<span style="display:block;font-weight:500;letter-spacing:0.1em;opacity:0.75;">${sub}</span>`

  zone.append(base, ring, knob, cap)
  return { zone, knob, cap }
}

export function buildSticksOverlay(opts: {
  onDelta: (d: StickDelta) => void
  onReset: () => void
}): SticksHandle {
  const { onDelta, onReset } = opts

  const root = document.createElement('div')
  root.style.cssText = [
    'position:absolute', 'inset:0', 'display:none', 'z-index:2',
    'touch-action:none', 'pointer-events:auto', 'user-select:none', '-webkit-user-select:none',
  ].join(';')

  const left = mkStick('MOVE', 'GESER X · NAIK/TURUN Y', 'rgba(143,230,255,0.9)')
  const right = mkStick('ORBIT', 'SWEEP · TILT', 'rgba(255,214,112,0.85)')
  left.zone.style.left = '20px'
  right.zone.style.right = '20px'
  root.append(left.zone, right.zone)

  // ---- reset button (the only other control — keep it minimal) ----
  const reset = document.createElement('button')
  reset.type = 'button'
  reset.setAttribute('aria-label', 'reset the camera chain')
  reset.style.cssText = [
    'position:absolute', 'top:64px', 'right:16px', 'width:44px', 'height:44px',
    'border-radius:50%', 'appearance:none', 'cursor:pointer', 'z-index:3',
    'border:1.5px solid rgba(255,214,112,0.5)', 'color:#ffd670',
    'background:rgba(2,16,28,0.72)', 'backdrop-filter:blur(3px)',
    'display:flex', 'align-items:center', 'justify-content:center',
    'touch-action:manipulation',
  ].join(';')
  reset.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" style="width:20px;height:20px;">' +
    '<path d="M4.5 9a8 8 0 1 1-1 5.5"/><path d="M4 4.5V9h4.5" opacity="0.75"/></svg>'
  reset.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    try { navigator.vibrate?.(14) } catch { /* no haptics */ }
    onReset()
  })
  root.appendChild(reset)

  // ---------------- stick state ----------------
  interface StickState {
    active: boolean
    pointerId: number
    nx: number
    ny: number
    cx: number
    cy: number
    r: number
  }
  const mkState = (): StickState => ({ active: false, pointerId: -1, nx: 0, ny: 0, cx: 0, cy: 0, r: 60 })

  const bindStick = (
    el: HTMLElement,
    knob: HTMLElement,
    st: StickState,
  ) => {
    const setKnob = () => {
      const px = st.nx * st.r
      const py = st.ny * st.r
      knob.style.transition = st.active ? 'transform 0.05s linear' : 'transform 0.16s ease'
      knob.style.transform = `translate(${px}px, ${py}px)`
      knob.style.boxShadow = st.active
        ? '0 0 22px rgba(110,231,255,0.65), 0 4px 16px rgba(0,0,0,0.55)'
        : '0 4px 16px rgba(0,0,0,0.55)'
    }
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (st.active) return
      const rect = el.getBoundingClientRect()
      st.cx = rect.left + rect.width / 2
      st.cy = rect.top + rect.height / 2
      st.r = rect.width / 2 - 26
      st.active = true
      st.pointerId = e.pointerId
      st.nx = 0
      st.ny = 0
      try { el.setPointerCapture(e.pointerId) } catch { /* stale pointer */ }
      setKnob()
      try { navigator.vibrate?.(8) } catch { /* no haptics */ }
    })
    el.addEventListener('pointermove', (e) => {
      if (!st.active || e.pointerId !== st.pointerId) return
      const dx = (e.clientX - st.cx) / Math.max(1, st.r)
      const dy = (e.clientY - st.cy) / Math.max(1, st.r)
      const len = Math.hypot(dx, dy)
      const k = len > 1 ? 1 / len : 1
      st.nx = Number.isFinite(dx * k) ? dx * k : DEAD
      st.ny = Number.isFinite(dy * k) ? dy * k : DEAD
      setKnob()
    })
    const release = (e: PointerEvent) => {
      if (!st.active || e.pointerId !== st.pointerId) return
      st.active = false
      st.pointerId = -1
      st.nx = 0
      st.ny = 0
      setKnob()
    }
    el.addEventListener('pointerup', release)
    el.addEventListener('pointercancel', release)
  }

  const leftSt = mkState()
  const rightSt = mkState()
  bindStick(left.zone, left.knob, leftSt)
  bindStick(right.zone, right.knob, rightSt)

  // ---------------- pinch → dolly ----------------
  const pinchPts = new Map<number, { x: number; y: number }>()
  let pinchDist = 0

  root.addEventListener('pointerdown', (e) => {
    // any pointer NOT claimed by a stick joins the pinch group
    if (leftSt.pointerId === e.pointerId || rightSt.pointerId === e.pointerId) return
    pinchPts.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinchPts.size === 2) {
      const [a, b] = [...pinchPts.values()]
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
    }
  })
  root.addEventListener('pointermove', (e) => {
    if (!pinchPts.has(e.pointerId)) return
    pinchPts.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinchPts.size === 2 && pinchDist > 0) {
      const [a, b] = [...pinchPts.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (d > 0 && Number.isFinite(d)) {
        pend.ddolly = (pend.ddolly ?? 0) + (d / pinchDist - 1) * DOLLY_PER_PINCH
      }
      pinchDist = d
    }
  })
  const pinchRelease = (e: PointerEvent) => {
    pinchPts.delete(e.pointerId)
    if (pinchPts.size < 2) pinchDist = 0
  }
  root.addEventListener('pointerup', pinchRelease)
  root.addEventListener('pointercancel', pinchRelease)

  // ---------------- 30 Hz velocity flush loop ----------------
  const pend: StickDelta = {}
  let raf = 0
  let last = 0
  let lastFlush = 0

  const tick = (now: number) => {
    raf = requestAnimationFrame(tick)
    if (!last) { last = now; return }
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    if (now - lastFlush < FLUSH_MS) return
    lastFlush = now

    const d: StickDelta = {}
    // LEFT stick — MOVE: stick right = geser kanan (+X), stick up = naik (+Y)
    if (leftSt.active) {
      const sx = shape(leftSt.nx)
      const sy = shape(-leftSt.ny) // screen Y is down-positive; up = naik
      if (sx) d.dmx = sx * STRAFE_RATE * dt
      if (sy) d.dmy = sy * LIFT_RATE * dt
    }
    // RIGHT stick — ORBIT: stick right = look right (yaw−), stick up = tilt up
    if (rightSt.active) {
      const sx = shape(rightSt.nx)
      const sy = shape(-rightSt.ny)
      if (sx) d.dyaw = -sx * YAW_RATE * dt
      if (sy) d.dpitch = sy * PITCH_RATE * dt
    }
    if (pend.ddolly) {
      d.ddolly = (d.ddolly ?? 0) + pend.ddolly
      pend.ddolly = 0
    }
    if (d.dmx || d.dmy || d.dyaw || d.dpitch || d.ddolly) {
      // round small values so packets stay tiny
      if (d.dmx) d.dmx = Math.round(d.dmx * 100) / 100
      if (d.dmy) d.dmy = Math.round(d.dmy * 100) / 100
      if (d.dyaw) d.dyaw = Math.round(d.dyaw * 100) / 100
      if (d.dpitch) d.dpitch = Math.round(d.dpitch * 100) / 100
      if (d.ddolly) d.ddolly = Math.round(d.ddolly * 100) / 100
      onDelta(d)
    }
  }

  return {
    root,
    setVisible(on: boolean) {
      root.style.display = on ? 'block' : 'none'
    },
    start() {
      last = 0
      lastFlush = 0
      if (!raf) raf = requestAnimationFrame(tick)
    },
    stop() {
      if (raf) { cancelAnimationFrame(raf); raf = 0 }
      leftSt.active = false
      rightSt.active = false
      pinchPts.clear()
      pinchDist = 0
      pend.ddolly = 0
    },
  }
}
