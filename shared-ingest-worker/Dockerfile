# syntax=docker/dockerfile:1
# Build context: repository root (hermes-stack). Runs the shared-vault ingest worker (Node + tsx).
FROM node:24-bookworm-slim
WORKDIR /app
COPY hermes-chat/package.json hermes-chat/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
  if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY hermes-chat .
ENV NODE_ENV=production
CMD ["npm", "run", "ingest-worker"]
