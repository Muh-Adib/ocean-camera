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
# persistent JSON mirrors (fish tank, projection settings) live here —
# mount a volume on /app/data to keep them across image upgrades
ENV FISH_TANK_FILE=/app/data/.fish-tank.json
ENV PROJECTION_SETTINGS_FILE=/app/data/.projection-settings.json

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy static public assets
COPY --from=builder /app/public ./public

# Set up prerender cache directory permissions
RUN mkdir .next && chown nextjs:nodejs .next
# writable home for the optional self-signed TLS cert (ENABLE_HTTPS=1)
RUN mkdir .certs && chown nextjs:nodejs .certs
# writable data home: the fish tank + projection settings mirror JSON
# survives container restarts here (process.env.FISH_TANK_FILE points
# into this dir — /app itself stays read-only for the nextjs user)
RUN mkdir data && chown nextjs:nodejs data

# Copy standalone build output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# ------------------------------------------------------------------
# DEPENDENCY COMPLETENESS — the turbopack build's file trace omits
# next/dist/compiled/webpack/* (standalone server never loads webpack
# during the build), but the programmatic `next()` API in our custom
# server.js requires it lazily when reading next.config at boot →
# containers crashed in a loop with:
#   Cannot find module 'next/dist/compiled/webpack/webpack-lib'
# Ship the COMPLETE next package plus its runtime deps from the
# builder stage so every require inside the package always resolves.
# (outputFileTracingIncludes in next.config.ts is the first layer of
# this fix — this copy is the belt-and-suspenders layer.)
# ------------------------------------------------------------------
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/next ./node_modules/next
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@next/env ./node_modules/@next/env
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@swc/helpers ./node_modules/@swc/helpers

# ------------------------------------------------------------------
# PHONE CONTROL IN PRODUCTION — the custom server REPLACES the
# generated standalone server.js. It serves the same Next.js app AND
# owns the WebSocket hub at /ws/control on THE SAME port, so the
# container needs NO extra port for the phone remote (the old image
# ran the generated server, which silently dropped /ws/control —
# phones could never connect in prod).
# `ws` is not traced by the standalone build (only server.js uses it)
# so it is copied explicitly — it is dependency-free.
# ------------------------------------------------------------------
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/node_modules/ws ./node_modules/ws

USER nextjs

# HTTP + WebSocket upgrade share THIS single port (ws rides /ws/control) —
# the container only needs this one port published/reachable.
EXPOSE 3000

# Optional: ENABLE_HTTPS=1 → self-signed TLS on the same port so the
# phone CAMERA works over LAN (getUserMedia requires a secure context).
CMD ["node", "server.js"]
