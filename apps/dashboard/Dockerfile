# gons-dashboard — monorepo multi-stage build
# Next.js 16 standalone output → 작은 production 이미지
# build context: monorepo root (docker-compose의 context: .)

# ---- Stage 1: deps (의존성 캐시 레이어) ----
# workspace packages의 package.json을 함께 복사해야 pnpm이 workspace symlink를
# 생성한다. 누락 시 next build가 @gons/* import를 "module not found"로 실패.
FROM node:24-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/dashboard/package.json ./apps/dashboard/
COPY packages/shared-google/package.json ./packages/shared-google/
COPY packages/shared-mcp-runtime/package.json ./packages/shared-mcp-runtime/
COPY packages/mcp-calendar/package.json ./packages/mcp-calendar/
COPY packages/stock-analysis/package.json ./packages/stock-analysis/
RUN pnpm install --frozen-lockfile --prod=false

# ---- Stage 2: build ----
FROM node:24-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/dashboard/node_modules ./apps/dashboard/node_modules
COPY --from=deps /app/packages/shared-google/node_modules ./packages/shared-google/node_modules
COPY --from=deps /app/packages/shared-mcp-runtime/node_modules ./packages/shared-mcp-runtime/node_modules
COPY --from=deps /app/packages/mcp-calendar/node_modules ./packages/mcp-calendar/node_modules
COPY --from=deps /app/packages/stock-analysis/node_modules ./packages/stock-analysis/node_modules
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/dashboard ./apps/dashboard
COPY packages ./packages
ENV NEXT_TELEMETRY_DISABLED=1

# 빌드 타임 환경 변수 placeholder.
# Zod env validation이 page-data-collection 단계에서 import 체인을 타고 실행되므로,
# 빌드 시 비어 있으면 Failed to collect page data로 실패함. 실제 값은 컨테이너 런타임에
# docker-compose가 주입한다. ci.yml의 lint-typecheck job과 동일한 placeholder.
ENV DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder \
    REDIS_URL=redis://localhost:6379 \
    NEXTAUTH_SECRET=a-placeholder-secret-of-at-least-32-characters \
    NEXTAUTH_URL=http://localhost:3020 \
    GOOGLE_CLIENT_ID=placeholder \
    GOOGLE_CLIENT_SECRET=placeholder \
    ANTHROPIC_BASE_URL=http://placeholder \
    ANTHROPIC_API_KEY=placeholder \
    CRON_BEARER_TOKEN=a-placeholder-cron-token-of-at-least-32-characters \
    MCP_DASHBOARD_TOKEN=a-placeholder-mcp-token-of-at-least-32-characters \
    ALLOWLIST_EMAILS=build@placeholder.local \
    ADMIN_EMAILS=build@placeholder.local \
    PG_ENCRYPTION_KEY=a-placeholder-pg-encryption-key-of-at-least-32-chars \
    PLAYMCP_CLIENT_ID=placeholder-playmcp-client-id \
    KRX_OPENAPI_AUTH_KEY=placeholder-krx-key

RUN pnpm --filter @gons/dashboard build

# ---- Stage 3: runner (production) ----
FROM node:24-alpine AS runner
WORKDIR /app

# Asia/Seoul 타임존 강제 — node-cron의 KST 8AM 정확성에 결정적
# docker-cli — server-monitor가 호스트 /var/run/docker.sock을 통해 호스트 docker daemon 호출
ENV TZ=Asia/Seoul
RUN apk add --no-cache tzdata docker-cli && \
    cp /usr/share/zoneinfo/Asia/Seoul /etc/localtime && \
    echo "Asia/Seoul" > /etc/timezone

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3020
# 0.0.0.0 바인드 (Next.js standalone 기본은 hostname 사용 — 내부 localhost healthcheck 실패 방지)
ENV HOSTNAME=0.0.0.0

# Non-root user
# docker group GID 988 — 운영 호스트(192.168.0.5)의 docker group과 매칭.
# 마운트된 /var/run/docker.sock(소유: root:docker, 0660)에 nextjs 사용자가 접근 가능하도록.
RUN addgroup -g 1001 -S nodejs && \
    addgroup -g 988 docker && \
    adduser -S nextjs -u 1001 -G nodejs && \
    addgroup nextjs docker

# Next.js standalone output은 apps/dashboard/.next/standalone/ 에 생성됨.
# 이미지에는 standalone 결과만 복사해 크기 최소화.
COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/public ./apps/dashboard/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/drizzle ./apps/dashboard/drizzle

USER nextjs
EXPOSE 3020

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD wget --quiet --spider http://127.0.0.1:3020/api/health || exit 1

CMD ["node", "apps/dashboard/server.js"]
