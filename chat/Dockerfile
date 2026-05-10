# syntax=docker/dockerfile:1
# Multi-stage production image for HermesChat (Next.js standalone).
# Build context: ./hermes-chat (see docker-compose service `chat`).
# Requires BuildKit (DOCKER_BUILDKIT=1, default on modern Docker) for cache mounts.

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# PWA / Open Graph absolute URLs (Cloudflare hostname). Override at build: docker compose build --build-arg NEXT_PUBLIC_SITE_URL=...
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3100
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
# Bust cached JS/HTML after UI changes (pass at build: BUILD_ID=$(date +%s) docker compose build chat).
ARG NEXT_PUBLIC_APP_BUILD_ID=
ENV NEXT_PUBLIC_APP_BUILD_ID=$NEXT_PUBLIC_APP_BUILD_ID
# Web Push (client subscribe). Optional at build; business-test passes per-tenant keys via compose build args.
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY=
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY
# Loopback / odd ports: set "true" so Serwist does not intercept navigations (avoids sw no-response flakes).
ARG NEXT_PUBLIC_DISABLE_SERWIST=
ENV NEXT_PUBLIC_DISABLE_SERWIST=$NEXT_PUBLIC_DISABLE_SERWIST
# Reserved shared-wiki slug for organization library uploads (must match server HERMES_ORG_GLOBAL_SLUG).
ARG NEXT_PUBLIC_HERMES_ORG_GLOBAL_SLUG=org-global
ENV NEXT_PUBLIC_HERMES_ORG_GLOBAL_SLUG=$NEXT_PUBLIC_HERMES_ORG_GLOBAL_SLUG
RUN if [ "$NEXT_PUBLIC_DISABLE_SERWIST" = "true" ]; then \
      rm -f public/sw.js public/sw.js.map && rm -f public/swe-worker-*.js || true; \
    fi
RUN --mount=type=cache,target=/app/.next/cache \
    npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3100
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs nextjs \
  && apt-get update \
  && apt-get install -y --no-install-recommends gosu zstd \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Next may emit .env* into standalone; remove so container env (Compose) is authoritative.
RUN rm -f .env .env.local .env.production .env.development 2>/dev/null || true
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

COPY --from=builder /app/scripts ./scripts
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3100
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "server.js"]
