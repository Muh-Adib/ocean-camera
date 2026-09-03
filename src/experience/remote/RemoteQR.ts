// ---------------------------------------------------------------
// RemoteQR — "control the ocean from your phone" modal.
//
// Shows a QR code that opens /remote on a smartphone: the phone
// tracks BOTH hands with its camera and streams them to this
// server, so every ocean page (studio or /output, any machine)
// follows the swim in real time.
//
// The QR URL must be reachable FROM THE PHONE:
//   · if this page itself is not localhost → use this origin
//   · on localhost → offer the machine's LAN address instead
//     (fetched from /api/remote/host), with copy buttons
// When the page is plain http (LAN dev), the phone will refuse the
// camera — an explicit hint tells the operator how to get https.
// ---------------------------------------------------------------

const ROOM = new URLSearchParams(window.location.search).get('room') || 'ocean'

let modal: HTMLElement | null = null
let pollTimer = 0
let chosenUrl = ''
let qrImg: HTMLImageElement | null = null
let urlInput: HTMLInputElement | null = null
let statusEl: HTMLElement | null = null

export function remotePageUrl(base: string): string {
  return `${base.replace(/\/$/, '')}/remote?room=${encodeURIComponent(ROOM)}`
}

export async function openRemoteQR(parent: HTMLElement) {
  if (modal) { closeRemoteQR(); return }

  const wrap = document.createElement('div')
  wrap.id = 'remote-qr-modal'
  wrap.setAttribute('role', 'dialog')
  wrap.setAttribute('aria-label', 'Smartphone remote control QR code')
  wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(1,10,18,0.72);backdrop-filter:blur(6px);'

  const card = document.createElement('div')
  card.style.cssText = [
    'position:relative', 'width:min(400px, calc(100vw - 32px))',
    'padding:22px 22px 18px', 'border-radius:14px',
    'background:linear-gradient(160deg, rgba(6,42,66,0.96), rgba(3,20,34,0.97))',
    'border:1px solid rgba(110,231,255,0.28)', 'box-shadow:0 24px 80px rgba(0,0,0,0.55)',
    'color:#dff3fb', 'font-family:system-ui,sans-serif', 'text-align:center',
  ].join(';')

  card.innerHTML = `
    <div style="font-size:12px;letter-spacing:0.16em;color:#7fd4ee;">SMARTPHONE REMOTE</div>
    <h3 style="margin:6px 0 2px;font-size:17px;font-weight:600;">Control the ocean with your phone</h3>
    <p style="margin:0 0 12px;font-size:12px;line-height:1.55;color:#9fc9da;">
      Scan with your phone — its camera tracks <b>both hands</b>, or switch to
      the <b>BUTTONS</b> pad (feed, burst, shark, joystick…). Everything reacts
      in real time, on this screen and on every output page.
    </p>
    <div class="rq-img-wrap" style="display:flex;justify-content:center;margin:4px 0 10px;">
      <div style="padding:10px;background:#f4fbff;border-radius:10px;display:inline-block;">
        <img alt="QR code to the phone controller" style="display:block;width:212px;height:212px;image-rendering:pixelated;" />
      </div>
    </div>
    <div class="rq-urlrow" style="display:flex;gap:6px;align-items:center;">
      <input readonly spellcheck="false"
        style="flex:1;min-width:0;font-size:11px;padding:8px 10px;border-radius:8px;border:1px solid rgba(110,231,255,0.25);background:rgba(2,16,28,0.75);color:#bfe8f6;" />
      <button class="rq-copy pm-btn pm-btn-sm" type="button">COPY</button>
    </div>
    <div class="rq-alt" style="margin-top:8px;display:flex;flex-direction:column;gap:4px;"></div>
    <div class="rq-status" style="margin-top:10px;font-size:11px;letter-spacing:0.08em;color:#8fd8ef;"></div>
    <div class="rq-warn" style="display:none;margin-top:8px;font-size:11px;line-height:1.55;padding:8px 10px;border-radius:8px;background:rgba(255,190,90,0.12);border:1px solid rgba(255,190,90,0.35);color:#ffd670;text-align:left;"></div>
    <button class="rq-close pm-btn pm-btn-sm" type="button" style="position:absolute;top:10px;right:10px;">✕</button>
  `
  wrap.appendChild(card)
  parent.appendChild(wrap)
  modal = wrap

  const close = () => closeRemoteQR()
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close() })
  card.querySelector('.rq-close')?.addEventListener('click', close)
  const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }
  window.addEventListener('keydown', onEsc, true)

  qrImg = card.querySelector('.rq-img-wrap img')
  urlInput = card.querySelector('.rq-urlrow input')
  statusEl = card.querySelector('.rq-status')
  const altBox = card.querySelector('.rq-alt') as HTMLElement
  const warnBox = card.querySelector('.rq-warn') as HTMLElement

  const setStatus = (live: boolean, hands: number) => {
    if (!statusEl) return
    statusEl.textContent = live
      ? hands > 0
        ? `● PHONE CONNECTED — ${hands} hand${hands === 1 ? '' : 's'} streaming`
        : '● PHONE CONNECTED — pad / camera active'
      : '○ WAITING FOR PHONE — scan the code to connect'
    statusEl.style.color = live ? '#7bffb2' : '#8fd8ef'
  }
  setStatus(false, 0)

  // ---- candidate URLs: this origin first, then LAN addresses ----
  const candidates: string[] = []
  const here = window.location.origin
  candidates.push(here)

  try {
    const res = await fetch('/api/remote/host')
    if (res.ok) {
      const info = await res.json() as { lan?: string[] }
      for (const lan of info.lan ?? []) if (!candidates.includes(lan)) candidates.push(lan)
    }
  } catch { /* host endpoint unavailable — origin alone is fine */ }

  // localhost as the QR target is useless on a phone — prefer a LAN URL
  const isLocal = (u: string) => /^(http:\/\/(localhost|127\.0\.0\.1)|https:\/\/(localhost|127\.0\.0\.1))/.test(u)
  const phoneable = candidates.filter((c) => !isLocal(c))
  const pickDefault = phoneable[0] ?? candidates[0]

  const renderQr = async (base: string) => {
    chosenUrl = remotePageUrl(base)
    if (urlInput) urlInput.value = chosenUrl
    try {
      const QR = (await import('qrcode')).default
      const dataUrl = await QR.toDataURL(chosenUrl, {
        width: 424, margin: 1,
        color: { dark: '#04202f', light: '#f4fbff' },
        errorCorrectionLevel: 'M',
      })
      if (qrImg) qrImg.src = dataUrl
    } catch { /* QR lib failed — the COPY row still carries the URL */ }
  }

  for (const base of candidates) {
    const label = isLocal(base) ? `${base} (this computer)` : base
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'pm-btn pm-btn-sm'
    chip.style.cssText = 'font-size:10px;padding:5px 8px;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
    chip.textContent = label
    chip.addEventListener('click', () => void renderQr(base))
    altBox.appendChild(chip)
  }

  card.querySelector('.rq-copy')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(chosenUrl) } catch {
      // clipboard API can be blocked — select the input instead
      urlInput?.select()
      document.execCommand('copy')
    }
  })

  // secure-context warning: phone cameras need https (or localhost)
  if (!window.isSecureContext) {
    warnBox.style.display = 'block'
    warnBox.textContent =
      'This page is not HTTPS. Phones block the camera on insecure origins — ' +
      'run the app with `npm run dev:https` and scan its QR, or open the app through its HTTPS link.'
  }

  await renderQr(pickDefault)

  // ---- live connection status (shared server state, zero coupling) ----
  // a phone counts as connected while it streams hands (camera mode)
  // OR while its button pad pings (buttons mode)
  const poll = async () => {
    try {
      const [handsRes, cmdRes] = await Promise.all([
        fetch(`/api/remote/hands?room=${encodeURIComponent(ROOM)}`),
        fetch(`/api/remote/cmd?room=${encodeURIComponent(ROOM)}`).catch(() => null),
      ])
      let live = false
      let hands = 0
      if (handsRes.ok) {
        const data = await handsRes.json() as { live?: boolean; snapshot?: { hands?: unknown[] } }
        live = !!data.live
        hands = data.snapshot?.hands?.length ?? 0
      }
      if (!live && cmdRes && cmdRes.ok) {
        const data = await cmdRes.json() as { padLive?: boolean }
        live = !!data.padLive
      }
      setStatus(live, hands)
    } catch { /* server hiccup — keep the last state */ }
  }
  void poll()
  pollTimer = window.setInterval(poll, 1200)
}

export function closeRemoteQR() {
  window.clearInterval(pollTimer)
  pollTimer = 0
  modal?.remove()
  modal = null
  qrImg = null
  urlInput = null
  statusEl = null
}

export function remoteModalOpen(): boolean {
  return !!modal
}
