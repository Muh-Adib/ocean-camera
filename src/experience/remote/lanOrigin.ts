// ---------------------------------------------------------------
// lanOrigin — a PHONE-REACHABLE origin for QR / deep links.
//
// Problem this solves: the projection machine normally opens the
// show as http://localhost:3000/output. Every QR and session link
// built from location.origin then encoded "localhost" — which on
// the SCANNING phone means the phone itself. The page never loaded
// and the remote seemed broken ("connection failure") even though
// the hub, the studio and the wall were all perfectly healthy.
//
// The fix: when the current page lives on a loopback hostname, ask
// OUR server (/api/lan) for its real LAN IPv4 + bound port and use
// `http://<lan-ip>:<port>` instead. Pages already browsed via a LAN
// IP / tunnel domain keep their own origin untouched.
//
// Usage: producers render an URL SYNCHRONOUSLY first (never block
// the first paint) and re-draw once `phoneOrigin()` resolves:
//
//   let url = buildUrl(syncOrigin())          // instant, maybe wrong
//   phoneOrigin().then((base) => {            // ~a few ms later
//     url = buildUrl(base); redraw()
//   })
// ---------------------------------------------------------------

let cached: Promise<string> | null = null

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1' || h === '[::1]'
}

/**
 * The origin phones should open. Resolves to location.origin unless
 * this page is on a loopback host AND the server reports a LAN IP.
 */
export function phoneOrigin(): Promise<string> {
  if (!cached) {
    cached = (async () => {
      const origin = window.location.origin
      if (!isLoopbackHost(window.location.hostname)) return origin
      try {
        const ctrl = new AbortController()
        const kill = window.setTimeout(() => ctrl.abort(), 2500)
        const res = await fetch('/api/lan', { cache: 'no-store', signal: ctrl.signal })
        window.clearTimeout(kill)
        if (!res.ok) return origin
        const data = await res.json() as { ip?: string | null; port?: string | null }
        if (!data.ip || !/^\d+\.\d+\.\d+\.\d+$/.test(data.ip)) return origin
        const port = data.port || '3000'
        // an explicit non-default port must ride along; server.js binds
        // 0.0.0.0 so the same port serves every interface
        return `http://${data.ip}${port && port !== '80' ? `:${port}` : ''}`
      } catch {
        return origin
      }
    })()
  }
  return cached
}
