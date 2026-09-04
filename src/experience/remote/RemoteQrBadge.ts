// ---------------------------------------------------------------
// RemoteQrBadge — the small always-on QR for the /output screen.
//
// Until a phone actually connects, the projector page shows a
// compact QR in the corner: scan it → the controller opens. The
// badge sizes itself with vmin so it stays SMALL and follows the
// screen size on any projector resolution, fades out the moment a
// phone streams hands / pings its pad, and comes back by itself
// when the phone leaves. Tapping it opens the full REMOTE QR
// modal (URL row, LAN candidates, live connection status).
//
// With the WebSocket relay up, presence is INSTANT: the /ws room
// fanout pushes "phone joined/left" the moment it happens, so the
// badge hides/shows in real time — the hands/pad polling below is
// only the fallback for SSE-only phones.
// ---------------------------------------------------------------

import { pickRemoteBase, remoteModalOpen } from './RemoteQR'
import { subscribeRemotePresence } from './remotePresenceBus'

const ROOM = new URLSearchParams(window.location.search).get('room') || 'ocean'

export interface RemoteQrBadgeHandle {
  dispose: () => void
}

export function mountRemoteQrBadge(parent: HTMLElement): RemoteQrBadgeHandle {
  const badge = document.createElement('div')
  badge.id = 'remote-qr-badge'
  badge.setAttribute('role', 'button')
  badge.setAttribute('aria-label', 'Scan to control the ocean from a phone')
  badge.title = 'Scan to control — tap for options'
  badge.style.cssText = [
    'position:fixed', 'right:14px', 'bottom:14px', 'z-index:9400',
    'display:flex', 'flex-direction:column', 'align-items:center', 'gap:5px',
    'cursor:pointer', 'opacity:0', 'transition:opacity 0.4s ease',
    'user-select:none', '-webkit-user-select:none',
  ].join(';')

  const tile = document.createElement('div')
  tile.style.cssText = [
    'width:clamp(64px, 11vmin, 112px)', 'height:clamp(64px, 11vmin, 112px)',
    'padding:5px', 'box-sizing:border-box', 'border-radius:10px',
    'background:rgba(244,251,255,0.94)', 'box-shadow:0 8px 28px rgba(0,0,0,0.45)',
    'border:1px solid rgba(110,231,255,0.5)', 'overflow:hidden',
  ].join(';')
  const img = document.createElement('img')
  img.alt = ''
  img.draggable = false
  img.style.cssText = 'display:block;width:100%;height:100%;image-rendering:pixelated;opacity:0;transition:opacity 0.3s ease;'
  tile.appendChild(img)

  const label = document.createElement('div')
  label.style.cssText = [
    'font-size:clamp(7px, 1.3vmin, 10px)', 'font-weight:700', 'letter-spacing:0.22em',
    'color:#bfe8f6', 'text-shadow:0 1px 6px rgba(0,0,0,0.8)', 'white-space:nowrap',
  ].join(';')
  label.textContent = 'SCAN TO CONTROL'

  badge.append(tile, label)
  parent.appendChild(badge)

  let disposed = false
  let pollTimer = 0

  // render the QR once — the target URL does not change while running
  void (async () => {
    const base = await pickRemoteBase()
    if (disposed) return
    const url = `${base.replace(/\/$/, '')}/remote?room=${encodeURIComponent(ROOM)}`
    try {
      const QR = (await import('qrcode')).default
      const dataUrl = await QR.toDataURL(url, {
        width: 224, margin: 1,
        color: { dark: '#04202f', light: '#f4fbff' },
        errorCorrectionLevel: 'M',
      })
      if (!disposed) {
        img.src = dataUrl
        img.style.opacity = '1'
      }
    } catch { /* QR lib failed — the badge still opens the modal */ }
  })()

  badge.addEventListener('click', () => {
    void import('./RemoteQR').then((m) => m.openRemoteQR(document.body))
  })

  const setShown = (shown: boolean) => {
    badge.style.opacity = shown ? '1' : '0'
    badge.style.pointerEvents = shown ? 'auto' : 'none'
  }

  // WebSocket presence — the fast path (phone joined/left the room)
  let wsPhones = 0
  let lastLiveAt = 0
  const unsubPresence = subscribeRemotePresence((p) => {
    wsPhones = p.phones
    if (wsPhones > 0) lastLiveAt = Date.now()
    setShown(wsPhones === 0 && !remoteModalOpen())
  })

  // a phone counts as connected while it streams hands (camera mode)
  // OR while its pad pings (buttons / view mode) — polling fallback
  const poll = async () => {
    if (disposed) return
    if (wsPhones > 0) return   // the socket already knows better
    try {
      const [handsRes, cmdRes] = await Promise.all([
        fetch(`/api/remote/hands?room=${encodeURIComponent(ROOM)}`),
        fetch(`/api/remote/cmd?room=${encodeURIComponent(ROOM)}`).catch(() => null),
      ])
      let live = false
      if (handsRes.ok) {
        const data = await handsRes.json() as { live?: boolean }
        live = !!data.live
      }
      if (!live && cmdRes && cmdRes.ok) {
        const data = await cmdRes.json() as { padLive?: boolean }
        live = !!data.padLive
      }
      if (live) lastLiveAt = Date.now()
      // hidden while the full modal is open (it shows the big QR anyway);
      // hold the hidden state ~1 s after the last live beat so a poll
      // gap never makes the badge flicker back mid-show
      setShown(!live && Date.now() - lastLiveAt > 1000 && !remoteModalOpen())
    } catch { /* server hiccup — keep the last state */ }
  }
  void poll()
  pollTimer = window.setInterval(poll, 1500)

  return {
    dispose() {
      disposed = true
      unsubPresence()
      window.clearInterval(pollTimer)
      badge.remove()
    },
  }
}
