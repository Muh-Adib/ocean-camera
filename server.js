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
//   → {t:'hello', role:'phone'|'screen', name?}   first frame, tags the socket
//   phone → hub → screens: {t:'ctl', mx,my,ox,oy,dz}   stick velocities (−1..1)
//                          {t:'hand', p,x,y,o,n}       hand metrics (p=present)
//                          {t:'cam', on}               camera mode toggled
//                          {t:'hb'}                    idle heartbeat (keep-alive)
//   hub → screens: {t:'phone', on}                     phone presence
//   hub → phone:   nothing (fire-and-forget upstream)
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

app.prepare().then(() => {
  const server = createServer((req, res) => handle(req, res))

  // ---------------- WebSocket hub ----------------
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false })
  /** role-tagged live sockets */
  const phones = new Set()
  const screens = new Set()

  const send = (ws, obj) => {
    try { if (ws.readyState === 1) ws.send(JSON.stringify(obj)) } catch { /* dying socket */ }
  }
  /** fan out to every screen; phones never receive control chatter */
  const toScreens = (obj) => { for (const s of screens) send(s, obj) }
  const phoneCount = () => phones.size

  const announcePhones = () => toScreens({ t: 'phone', on: phoneCount() > 0, n: phoneCount() })

  wss.on('connection', (ws, req) => {
    ws.role = null
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
        ;(ws.role === 'phone' ? phones : screens).add(ws)
        announcePhones()
        if (ws.role === 'screen') send(ws, { t: 'phone', on: phoneCount() > 0, n: phoneCount() })
        return
      }

      if (ws.role !== 'phone') return   // screens listen; only phones steer
      // control / hand frames ride straight through to every screen
      if (msg.t === 'ctl' || msg.t === 'hand' || msg.t === 'cam') toScreens(msg)
    })

    ws.on('close', () => {
      phones.delete(ws); screens.delete(ws)
      if (ws.role === 'phone') announcePhones()
    })
    ws.on('error', () => { /* close will follow */ })
  })

  server.on('upgrade', (req, socket, head) => {
    let pathname = '/'
    try { pathname = new URL(req.url, 'http://x').pathname } catch { /* bad url */ }
    if (pathname === '/ws/control') {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
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
