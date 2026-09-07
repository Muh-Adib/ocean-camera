// ---------------------------------------------------------------
// server.js — custom Next.js server + the phone-control WebSocket
// hub ("use ws" — the remote link the projection site relies on).
//
// The ocean app needs real-time control from a smartphone: the QR
// shown on /output opens /control-mobile, which talks WebSocket on
// THE SAME port (so LAN / tunnel URLs just work). Next.js route
// handlers cannot upgrade sockets, so we own the HTTP server here
// and hand everything that is not /ws/* to Next.js untouched.
//
// Hub protocol (JSON text frames):
//   → {t:'hello', role:'phone'|'screen', name?, session?}   first frame, tags the socket
//     session (optional) isolates rooms/venues: control frames only fan out
//     to screens of the SAME session (default 'main'), so a second show on
//     the same LAN can never steal another show's phone.
//   phone → hub → screens: {t:'ctl', mx,my,ox,oy,dz}   stick velocities (−1..1)
//                          {t:'hand', p,x,y,o,n}       hand metrics (p=present)
//                          {t:'cam', on}               camera mode toggled
//                          {t:'hb'}                    idle heartbeat (keep-alive)
//   hub → screens: {t:'phone', on}                     phone presence
//   hub → phone:   {t:'room', screens}                 screens listening in this
//                                                      session (0 = nothing to steer)
// Every socket gets ping/pong liveness + a 15 s sweep; phones also
// expire after 22 s of TOTAL silence (crashed tabs / half-open Wi-Fi
// sockets would otherwise be counted as connected forever and the
// wall QR would never come back).
// ---------------------------------------------------------------
const { createServer } = require('http')
const next = require('next')
const { WebSocketServer } = require('ws')

const port = parseInt(process.env.PORT || '3000', 10)
const dev = process.env.NODE_ENV !== 'production'
const app = next({ dev, hostname: '0.0.0.0', port })
const handle = app.getRequestHandler()

const cleanSession = (v) => {
  const s = typeof v === 'string' ? v.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) : ''
  return s || 'main'
}

app.prepare().then(() => {
  const server = createServer((req, res) => handle(req, res))

  // ---------------- WebSocket hub ----------------
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false })
  /** role-tagged live sockets, grouped per session for isolation */
  const phonesBySession = new Map()   // session → Set<ws>
  const screensBySession = new Map()  // session → Set<ws>
  const group = (map, key) => {
    let g = map.get(key)
    if (!g) { g = new Set(); map.set(key, g) }
    return g
  }

  const send = (ws, obj) => {
    try { if (ws.readyState === 1) ws.send(JSON.stringify(obj)) } catch { /* dying socket */ }
  }
  /** fan out to every screen OF THE SAME SESSION; phones never receive control chatter */
  const toScreens = (session, obj) => {
    const g = screensBySession.get(session)
    if (g) for (const s of g) send(s, obj)
  }
  const phoneCount = (session) => (phonesBySession.get(session) || new Set()).size
  const screenCount = (session) => (screensBySession.get(session) || new Set()).size

  const announcePhones = (session) =>
    toScreens(session, { t: 'phone', on: phoneCount(session) > 0, n: phoneCount(session) })

  /**
   * phones get room occupancy: {t:'room', screens}. A phone showing
   * "connected" while NO screen of its session is listening used to be
   * indistinguishable from a dead link — the operator (and the guest
   * holding the phone) read it as "connection failure" when in fact the
   * screen tab was closed or joined a different session.
   */
  const announceRooms = (session) => {
    const g = phonesBySession.get(session)
    if (g) for (const p of g) send(p, { t: 'room', screens: screenCount(session) })
  }

  wss.on('connection', (ws, req) => {
    ws.role = null
    ws.session = 'main'
    ws.alive = true
    ws.lastSeen = Date.now()
    ws.on('pong', () => { ws.alive = true })

    ws.on('message', (raw) => {
      ws.lastSeen = Date.now()          // any frame proves the phone is alive
      let msg
      try { msg = JSON.parse(String(raw)) } catch { return }
      if (!msg || typeof msg.t !== 'string') return

      // first frame tags the socket — anything before it is ignored
      if (!ws.role) {
        if (msg.t !== 'hello') return
        ws.role = msg.role === 'phone' ? 'phone' : 'screen'
        ws.session = cleanSession(msg.session)
        ;(ws.role === 'phone'
          ? group(phonesBySession, ws.session)
          : group(screensBySession, ws.session)).add(ws)
        if (ws.role === 'phone') {
          // the joining phone gets the room truth immediately
          send(ws, { t: 'room', screens: screenCount(ws.session) })
          announcePhones(ws.session)
        } else {
          announcePhones(ws.session)
          announceRooms(ws.session)   // phones: a screen just joined their session
          send(ws, { t: 'phone', on: phoneCount(ws.session) > 0, n: phoneCount(ws.session) })
        }
        return
      }

      if (ws.role !== 'phone') return   // screens listen; only phones steer
      // control / hand frames ride straight through to every screen of the SAME session
      if (msg.t === 'ctl' || msg.t === 'hand' || msg.t === 'cam') toScreens(ws.session, msg)
    })

    ws.on('close', () => {
      const map = ws.role === 'phone' ? phonesBySession : screensBySession
      const g = map.get(ws.session)
      if (g) {
        g.delete(ws)
        if (!g.size) map.delete(ws.session)
      }
      if (ws.role === 'phone') announcePhones(ws.session)
      else announceRooms(ws.session)   // phones: a screen left their session
    })
    ws.on('error', () => { /* close will follow */ })
  })

  const upgradeHandler = typeof app.getUpgradeHandler === 'function' ? app.getUpgradeHandler() : null

  server.on('upgrade', (req, socket, head) => {
    let pathname = '/'
    try { pathname = new URL(req.url, 'http://x').pathname } catch { /* bad url */ }
    if (pathname === '/ws/control') {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
    } else if (upgradeHandler) {
      upgradeHandler(req, socket, head)
    } else {
      socket.destroy()   // no other WS endpoints exist
    }
  })

  // liveness sweep — drop sockets the OS lost silently (projector sleep,
  // phone walked out of Wi-Fi, crashed tab). Pong-based for everyone, plus
  // a hard idle expiry for PHONES: a silent phone is a GONE phone — if it
  // were counted forever, the wall QR would never come back on its own.
  const beat = setInterval(() => {
    const now = Date.now()
    for (const ws of wss.clients) {
      const idleFor = now - (ws.lastSeen || now)
      if (ws.role === 'phone' && idleFor > 22000) {
        try { ws.terminate() } catch { /* close follows */ }
        continue
      }
      if (!ws.alive) { try { ws.terminate() } catch { /* noop */ } continue }
      ws.alive = false
      try { ws.ping() } catch { /* noop */ }
    }
  }, 5000)
  beat.unref()

  server.listen(port, '0.0.0.0', () => {
    console.log(`> ocean server ready on http://0.0.0.0:${port} (${dev ? 'dev' : 'prod'}) — ws at /ws/control`)
  })
})
