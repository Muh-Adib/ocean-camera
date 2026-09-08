# syntax=docker/dockerfile:1

# Base image with Bun
FROM oven/bun:1-alpine AS base

# 1. Install dependencies
FROM base AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

# Copy dependency specifications
COPY package.json bun.lock ./
COPY prisma ./prisma/

ENV DATABASE_URL="file:./dev.db"

RUN bun install --frozen-lockfile
RUN bun run prisma generate

# 2. Build the application
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV DATABASE_URL="file:./dev.db"

RUN bun run build

# 3. Production runner with lightweight Node.js
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy static public assets
COPY --from=builder /app/public ./public

# Custom server: owns the WebSocket hub at /ws/control (phone remote).
# The standalone bundle ships its OWN server.js WITHOUT any WebSocket
# endpoint — running it is why phones could not connect in production
# containers ("error koneksi dengan phone"). Overwrite it with ours.
COPY --from=builder /app/server.js ./server.js
# `ws` is required by the custom server but is not traced into the
# standalone node_modules (only the app's imports are traced).
COPY --from=builder /app/node_modules/ws ./node_modules/ws

# Set up prerender cache directory permissions
RUN mkdir .next && chown nextjs:nodejs .next

# Copy standalone build output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Re-assert the WS-capable server AFTER the standalone copy (the standalone
# bundle also contains a server.js that would otherwise win the copy race)
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/node_modules/ws ./node_modules/ws

USER nextjs

# HTTP + WebSocket upgrade share THIS single port (ws rides /ws/control) —
# the container only needs this one port published/reachable.
EXPOSE 3000

CMD ["node", "server.js"]
