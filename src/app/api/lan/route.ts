// ---------------------------------------------------------------
// /api/lan — the phone-reachable host of THIS server.
//
// The projection machine usually browses its own show as
// http://localhost:3000/… — but a QR built from location.origin
// then tells the PHONE to open "localhost" (itself). Every scanned
// invitation silently failed: the phone either never loaded the
// remote page or connected to nothing — the operator saw it as
// "phone control cannot connect".
//
// This endpoint reports the server's real LAN IPv4 + the port the
// custom server (server.js) is bound to, so QR links can point at
// an address phones on the same Wi-Fi can actually reach. Only
// loopback pages need it; a page already browsed via a LAN IP or
// tunnel domain keeps its own origin.
// ---------------------------------------------------------------
import { networkInterfaces } from 'os'

export const dynamic = 'force-dynamic'

/** best phone-reachable IPv4 of this machine (private ranges first) */
function bestLanIp(): string | null {
  const nets = networkInterfaces()
  const picked: { addr: string; rank: number }[] = []
  for (const list of Object.values(nets)) {
    for (const net of list ?? []) {
      if (net.internal) continue
      if (net.family !== 'IPv4') continue
      const addr = net.address
      // rank private ranges ahead of anything exotic, but accept any
      const rank = addr.startsWith('192.168.') ? 3
        : /^10\./.test(addr) ? 2
        : /^172\.(1[6-9]|2\d|3[01])\./.test(addr) ? 2
        : 1
      picked.push({ addr, rank })
    }
  }
  if (!picked.length) return null
  picked.sort((a, b) => b.rank - a.rank)
  return picked[0].addr
}

export async function GET() {
  const port = process.env.PORT || '3000'
  const ip = bestLanIp()
  return Response.json(
    { ip, port, lan: ip ? `${ip}:${port}` : null },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
