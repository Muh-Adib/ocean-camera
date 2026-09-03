// ---------------------------------------------------------------
// GET /api/remote/host — network addresses the smartphone can use
// to reach this server. The QR modal offers these as the remote
// controller URL (localhost is useless inside a phone).
// ---------------------------------------------------------------
import { NextResponse } from 'next/server'
import os from 'node:os'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** private-range IPv4 → the LAN address phones can reach */
function lanAddresses(): string[] {
  const out: string[] = []
  const nets = os.networkInterfaces()
  for (const list of Object.values(nets)) {
    for (const net of list ?? []) {
      if (net.family !== 'IPv4' || net.internal) continue
      // private ranges only — a public IP would not route to this dev box
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(net.address)) {
        out.push(net.address)
      }
    }
  }
  return out
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const port = url.port || (process.env.PORT ? String(process.env.PORT) : '3000')
  const scheme = process.env.NODE_ENV === 'production' && process.env.HTTPS === 'true' ? 'https' : 'http'
  const lan = lanAddresses().map((ip) => `${scheme}://${ip}:${port}`)
  return NextResponse.json({
    origin: url.origin,
    lan,
    secure: url.protocol === 'https:',
  })
}
