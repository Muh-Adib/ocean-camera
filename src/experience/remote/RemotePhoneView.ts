// ---------------------------------------------------------------
// RemotePhoneView — the VIEW half of the phone controller.
//
// Moves the CAMERA CHAIN on every output page: all projection
// cameras swing as ONE motion around the center camera (pivot),
// exactly like turning your head at the center of the room. The
// 270° linked sweep keeps every span-locked wall edge connected,
// so the projected picture never breaks while it moves.
//
// Controls (one thumb):
//   · orbit pad — drag left/right to sweep the chain (yaw),
//     up/down to tilt it (pitch); relative grab, streamed ~18 Hz
//   · yaw slider + viewpoint chips — snap anywhere on the 270°
//     linked range (chips every 45°)
//   · DOLLY slider — glide the whole chain toward / away
//   · AUTO ORBIT — hands-free ping-pong sweep across the range
//   · RESET — glide back to the saved poses
//
// Everything streams as 'view' commands over /api/remote/cmd —
// the same relay as the BUTTONS pad, so every ocean page (studio
// + every /output, any machine) applies the same target and the
// eased motion stays continuous — no cuts, no patah.
// ---------------------------------------------------------------

/** camera-chain view command — streamed from the orbit pad/sliders */
export interface ViewPayload {
  yaw?: number
  pitch?: number
  dolly?: number
  auto?: boolean
  speed?: number
  reset?: boolean
}

export interface ViewHandle {
  root: HTMLElement
  start: () => void
  stop: () => void
}

const BTN_CSS = [
  'appearance:none', 'border:1px solid rgba(110,231,255,0.3)', 'border-radius:16px',
  'background:linear-gradient(165deg, rgba(12,56,86,0.92), rgba(4,24,42,0.94))',
  'color:#dff3fb', 'display:flex', 'flex-direction:column', 'align-items:center',
  'justify-content:center', 'gap:4px', 'cursor:pointer', 'min-height:44px',
  'box-shadow:0 6px 18px rgba(0,0,0,0.35)', 'padding:8px 4px',
  'transition:transform 0.08s ease, border-color 0.12s ease, box-shadow 0.12s ease',
  'touch-action:manipulation', 'user-select:none', '-webkit-user-select:none',
].join(';')

const RANGE_TRACK = 'linear-gradient(90deg, rgba(110,231,255,0.14), rgba(110,231,255,0.3), rgba(110,231,255,0.14))'

let rangeStylesInjected = false
/** one shared <style> for the touch sliders (webkit + moz thumbs) */
function ensureRangeStyles() {
  if (rangeStylesInjected) return
  rangeStylesInjected = true
  const style = document.createElement('style')
  style.textContent = `
    .rv-range { appearance:none; -webkit-appearance:none; width:100%; height:30px; background:transparent; cursor:pointer; margin:0; padding:0; }
    .rv-range::-webkit-slider-runnable-track { height:8px; border-radius:999px; background:${RANGE_TRACK}; }
    .rv-range::-webkit-slider-thumb { -webkit-appearance:none; width:26px; height:26px; border-radius:50%;
      margin-top:-9px; background:radial-gradient(circle at 38% 32%, #9fe8ff, #3fa6cc 68%, #2a7ba0);
      box-shadow:0 3px 10px rgba(0,0,0,0.45); border:1px solid rgba(159,232,255,0.6); }
    .rv-range::-moz-range-track { height:8px; border-radius:999px; background:${RANGE_TRACK}; }
    .rv-range::-moz-range-thumb { width:26px; height:26px; border-radius:50%; border:1px solid rgba(159,232,255,0.6);
      background:radial-gradient(circle at 38% 32%, #9fe8ff, #3fa6cc 68%, #2a7ba0); }`
  document.head.appendChild(style)
}

function pressLook(btn: HTMLElement, on: boolean) {
  btn.style.transform = on ? 'translateY(1.5px) scale(0.985)' : ''
  btn.style.borderColor = on ? 'rgba(140,240,255,0.75)' : 'rgba(110,231,255,0.3)'
}

export function buildViewStage(opts: {
  room: string
  sendView: (v: ViewPayload) => Promise<boolean>
  setStatus: (text: string, color: string) => void
  buzz: (ms?: number) => void
}): ViewHandle {
  const { room, sendView, setStatus, buzz } = opts

  const root = document.createElement('div')
  root.style.cssText = [
    'position:absolute', 'inset:0', 'display:none', 'flex-direction:column',
    'padding:12px 14px 8px', 'gap:10px', 'overflow:hidden',
  ].join(';')
  ensureRangeStyles()

  // ---------------- live chain state (readout, pad, sliders all sync) ------
  let curYaw = 0
  let curPitch = 0
  let curDolly = 0
  let autoOn = false

  // ---------------- header readout ----------------
  const readout = document.createElement('div')
  readout.style.cssText = 'flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;' +
    'padding:8px 12px;border-radius:12px;background:rgba(2,16,28,0.65);border:1px solid rgba(110,231,255,0.18);'
  const yawVal = document.createElement('span')
  yawVal.style.cssText = 'font-size:13px;font-weight:700;letter-spacing:0.08em;color:#8fe6ff;'
  yawVal.textContent = 'YAW +0.0°'
  const pitchVal = document.createElement('span')
  pitchVal.style.cssText = 'font-size:11px;letter-spacing:0.08em;color:#7fa8bb;'
  pitchVal.textContent = 'PITCH +0.0°'
  const pivotNote = document.createElement('span')
  pivotNote.style.cssText = 'font-size:9px;letter-spacing:0.1em;color:#5f8ba0;text-align:right;line-height:1.45;'
  pivotNote.innerHTML = 'PIVOT · CENTER CAM<br>270° LINKED SWEEP'
  readout.append(yawVal, pitchVal, pivotNote)

  // ---------------- orbit pad ----------------
  const pad = document.createElement('div')
  pad.style.cssText = [
    'flex:1', 'min-height:110px', 'border-radius:20px', 'position:relative', 'touch-action:none',
    'background:radial-gradient(120% 100% at 50% 42%, rgba(16,66,98,0.85), rgba(3,18,32,0.92))',
    'border:1.5px solid rgba(110,231,255,0.32)',
    'box-shadow:inset 0 0 24px rgba(0,0,0,0.45), 0 8px 24px rgba(0,0,0,0.35)',
    'overflow:hidden',
  ].join(';')
  const padHint = document.createElement('div')
  padHint.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'gap:6px;font-size:10px;letter-spacing:0.16em;color:#5f8ba0;text-align:center;pointer-events:none;transition:opacity 0.15s ease;'
  padHint.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" style="width:30px;height:30px;">' +
    '<path d="M3 12h18M12 3v18" opacity="0.4"/><circle cx="12" cy="12" r="4.2"/></svg>' +
    '<span>DRAG TO ORBIT THE CHAIN</span><span style="font-size:8.5px;opacity:0.8;">ONE MOTION · ALL CAMERAS FOLLOW</span>'
  const crosshair = document.createElement('div')
  crosshair.style.cssText = 'position:absolute;left:50%;top:50%;width:34px;height:34px;border-radius:50%;' +
    'transform:translate(-50%,-50%);border:1.5px solid rgba(140,240,255,0.55);box-shadow:0 0 16px rgba(110,231,255,0.3);' +
    'pointer-events:none;opacity:0;transition:opacity 0.12s ease;'
  pad.append(padHint, crosshair)

  let dragging = false
  let baseYaw = 0
  let basePitch = 0
  let startX = 0
  let startY = 0
  let lastSend = 0
  const DEG_PER_PX_YAW = 0.28
  const DEG_PER_PX_PITCH = 0.14

  const paintReadout = () => {
    const f = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}°`
    yawVal.textContent = `YAW ${f(curYaw)}`
    pitchVal.textContent = `PITCH ${f(curPitch)}${curDolly ? ` · DOLLY ${f(curDolly)}` : ''}`
  }

  const sendMove = (force = false) => {
    const now = performance.now()
    if (!force && now - lastSend < 55) return
    lastSend = now
    curYaw = baseYaw
    curPitch = basePitch
    paintReadout()
    paintSliders()
    void sendView({ yaw: Math.round(curYaw * 10) / 10, pitch: Math.round(curPitch * 10) / 10 })
  }

  const onPadMove = (e: PointerEvent) => {
    if (!dragging) return
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    curYaw = Math.max(-135, Math.min(135, baseYaw + dx * DEG_PER_PX_YAW))
    curPitch = Math.max(-30, Math.min(30, basePitch - dy * DEG_PER_PX_PITCH))
    baseYaw = curYaw
    basePitch = curPitch
    startX = e.clientX
    startY = e.clientY
    crosshair.style.left = `${50 + (curYaw / 135) * 42}%`
    crosshair.style.top = `${50 - (curPitch / 30) * 34}%`
    sendMove(true)
  }

  const padDown = (e: PointerEvent) => {
    e.preventDefault()
    dragging = true
    autoOn = false
    paintAuto()
    try { pad.setPointerCapture(e.pointerId) } catch { /* stale pointer id */ }
    startX = e.clientX
    startY = e.clientY
    crosshair.style.left = '50%'
    crosshair.style.top = '50%'
    crosshair.style.opacity = '1'
    padHint.style.opacity = '0'
    pad.style.borderColor = 'rgba(140,240,255,0.7)'
    buzz(10)
    setStatus('CHAIN LIVE', '#7bffb2')
  }

  const padUp = () => {
    if (!dragging) return
    dragging = false
    crosshair.style.opacity = '0'
    padHint.style.opacity = '1'
    pad.style.borderColor = 'rgba(110,231,255,0.32)'
    sendMove(true)
    setStatus('VIEW PAD READY', '#7fd4ee')
  }

  pad.addEventListener('pointerdown', padDown)
  pad.addEventListener('pointermove', onPadMove)
  pad.addEventListener('pointerup', padUp)
  pad.addEventListener('pointercancel', padUp)

  // ---------------- viewpoint chips (270° linked range, every 45°) ----------------
  const chips = document.createElement('div')
  chips.style.cssText = 'flex:none;display:grid;grid-template-columns:repeat(7,1fr);gap:6px;'
  const chipValues = [-135, -90, -45, 0, 45, 90, 135]
  for (const v of chipValues) {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.textContent = v > 0 ? `+${v}°` : `${v}°`
    chip.setAttribute('aria-label', `sweep viewpoint to ${v} degrees`)
    chip.style.cssText = BTN_CSS + ';min-height:40px;font-size:11px;font-weight:700;letter-spacing:0.05em;' +
      'border-radius:12px;color:#9fe0f2;'
    chip.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      pressLook(chip, true)
      buzz(10)
      autoOn = false
      paintAuto()
      curYaw = v
      paintReadout()
      paintSliders()
      setStatus(`SENT · VIEW ${v > 0 ? '+' : ''}${v}°`, '#7bffb2')
      void sendView({ yaw: v }).then((ok) => {
        if (!ok) setStatus('OFFLINE — server unreachable', '#ff8f8f')
      })
    })
    const relax = () => pressLook(chip, false)
    chip.addEventListener('pointerup', relax)
    chip.addEventListener('pointercancel', relax)
    chip.addEventListener('pointerleave', relax)
    chips.appendChild(chip)
  }

  // ---------------- sliders ----------------
  const mkSlider = (label: string, min: number, max: number, step: number, apply: (v: number) => ViewPayload) => {
    const row = document.createElement('div')
    row.style.cssText = 'flex:none;display:flex;align-items:center;gap:10px;'
    const lab = document.createElement('span')
    lab.style.cssText = 'font-size:9.5px;font-weight:700;letter-spacing:0.12em;color:#7fa8bb;width:44px;flex:none;'
    lab.textContent = label
    const input = document.createElement('input')
    input.type = 'range'
    input.className = 'rv-range'
    input.min = String(min)
    input.max = String(max)
    input.step = String(step)
    input.value = '0'
    let syncing = false
    input.addEventListener('input', () => {
      if (syncing) return
      const v = parseFloat(input.value)
      if (!Number.isFinite(v)) return
      autoOn = false
      paintAuto()
      void sendView(apply(v))
    })
    row.append(lab, input)
    return {
      row,
      set value(v: number) {
        syncing = true
        input.value = String(Math.round(v / step) * step)
        requestAnimationFrame(() => { syncing = false })
      },
    }
  }

  const yawSlider = mkSlider('YAW', -135, 135, 1, (v) => ({ yaw: v }))
  const pitchSlider = mkSlider('PITCH', -30, 30, 1, (v) => ({ pitch: v }))
  const dollySlider = mkSlider('DOLLY', -8, 8, 0.5, (v) => ({ dolly: v }))

  const paintSliders = () => {
    yawSlider.value = curYaw
    pitchSlider.value = curPitch
    dollySlider.value = curDolly
  }

  // ---------------- bottom row: auto + reset ----------------
  const bottom = document.createElement('div')
  bottom.style.cssText = 'flex:none;display:grid;grid-template-columns:2fr 1fr;gap:8px;'

  const autoBtn = document.createElement('button')
  autoBtn.type = 'button'
  autoBtn.setAttribute('aria-label', 'auto orbit — sweep the chain across the linked range automatically')
  autoBtn.style.cssText = BTN_CSS + ';flex-direction:row;gap:10px;min-height:48px;'
  autoBtn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:20px;height:20px;">' +
    '<path d="M4 12a8 8 0 1 1 2.3 5.7"/><path d="M4 21v-4.5H8.5" opacity="0.7"/></svg>' +
    '<span style="font-size:12px;font-weight:700;letter-spacing:0.14em;">AUTO ORBIT</span>' +
    '<span data-badge style="margin-left:auto;font-size:9.5px;letter-spacing:0.1em;color:#6d94a8;">OFF</span>'
  const paintAuto = () => {
    const b = autoBtn.querySelector('[data-badge]') as HTMLElement | null
    if (b) {
      b.textContent = autoOn ? 'ON' : 'OFF'
      b.style.color = autoOn ? '#7bffb2' : '#6d94a8'
    }
    autoBtn.style.borderColor = autoOn ? 'rgba(123,255,178,0.55)' : 'rgba(110,231,255,0.3)'
  }
  autoBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    pressLook(autoBtn, true)
    buzz(14)
    autoOn = !autoOn
    paintAuto()
    setStatus(autoOn ? 'SENT · AUTO ORBIT ON' : 'SENT · AUTO ORBIT OFF', '#7bffb2')
    void sendView({ auto: autoOn }).then((ok) => {
      if (!ok) setStatus('OFFLINE — server unreachable', '#ff8f8f')
    })
  })
  const autoRelax = () => pressLook(autoBtn, false)
  autoBtn.addEventListener('pointerup', autoRelax)
  autoBtn.addEventListener('pointercancel', autoRelax)

  const resetBtn = document.createElement('button')
  resetBtn.type = 'button'
  resetBtn.setAttribute('aria-label', 'reset the chain back to the saved poses')
  resetBtn.style.cssText = BTN_CSS + ';min-height:48px;color:#ffd670;'
  resetBtn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="width:20px;height:20px;">' +
    '<circle cx="12" cy="12" r="7.5"/><path d="M12 8.5V12l2.5 2" opacity="0.7"/></svg>' +
    '<span style="font-size:11.5px;font-weight:700;letter-spacing:0.14em;">RESET</span>'
  resetBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    pressLook(resetBtn, true)
    buzz(14)
    autoOn = false
    paintAuto()
    curYaw = 0
    curPitch = 0
    curDolly = 0
    paintReadout()
    paintSliders()
    setStatus('SENT · CHAIN RESET', '#7bffb2')
    void sendView({ reset: true }).then((ok) => {
      if (!ok) setStatus('OFFLINE — server unreachable', '#ff8f8f')
    })
  })
  const resetRelax = () => pressLook(resetBtn, false)
  resetBtn.addEventListener('pointerup', resetRelax)
  resetBtn.addEventListener('pointercancel', resetRelax)

  bottom.append(autoBtn, resetBtn)

  root.append(readout, pad, chips, yawSlider.row, pitchSlider.row, dollySlider.row, bottom)

  // ---------------- host poll: keep sliders honest with the real chain ----------------
  let pollTimer = 0
  let pingTimer = 0

  async function pollHost() {
    try {
      const res = await fetch(`/api/remote/cmd?room=${encodeURIComponent(room)}`)
      if (!res.ok) return
      const data = await res.json() as {
        host?: { chain?: { yaw?: number; pitch?: number; dolly?: number; auto?: boolean } } | null
      }
      const chain = data.host?.chain
      if (!chain) return
      if (!dragging) {
        if (typeof chain.yaw === 'number') curYaw = chain.yaw
        if (typeof chain.pitch === 'number') curPitch = chain.pitch
        if (typeof chain.dolly === 'number') curDolly = chain.dolly
        if (typeof chain.auto === 'boolean') { autoOn = chain.auto; paintAuto() }
        paintReadout()
        paintSliders()
      }
    } catch { /* server hiccup — keep last readout */ }
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
      setStatus('VIEW PAD READY', '#7fd4ee')
    },
    stop() {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = 0 }
      if (pingTimer) { clearInterval(pingTimer); pingTimer = 0 }
      padUp()
    },
  }
}
