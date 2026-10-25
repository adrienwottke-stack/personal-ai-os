FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS=--max-old-space-size=1200
RUN npm run build

FROM node:24-bookworm-slim AS app
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3141
RUN groupadd --gid 10001 osapp && useradd --uid 10001 --gid osapp --create-home osapp && mkdir /data && chown osapp:osapp /data
COPY --from=build --chown=osapp:osapp /app/.next/standalone ./
COPY --from=build --chown=osapp:osapp /app/.next/static ./.next/static
COPY --from=build --chown=osapp:osapp /app/public ./public
COPY --from=build --chown=osapp:osapp /app/prisma ./prisma
USER osapp
EXPOSE 3141
CMD ["node","server.js"]

FROM deps AS worker
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates
RUN npm install --global --no-audit --no-fund @openai/codex@0.162.0-alpha.2 && groupadd --gid 10002 runner && useradd --uid 10002 --gid runner --create-home runner && mkdir -p /data /home/runner/.codex && chown -R runner:runner /data /home/runner/.codex
COPY . .
USER runner
ENV AI_CODEX_HOME=/home/runner/.codex DATA_DIR=/data
CMD ["node","--import","tsx","scripts/worker.ts"]

FROM postgres:16-bookworm AS operations
COPY --from=deps /usr/local/ /usr/local/
WORKDIR /app
COPY --from=deps /app /app
COPY . .
CMD ["node","--import","tsx","scripts/backup-loop.ts"]
