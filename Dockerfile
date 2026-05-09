# gons-dashboard — multi-stage build
# Next.js 16 standalone output → 작은 production 이미지

# ---- Stage 1: deps (의존성 캐시 레이어) ----
FROM node:24-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
COPY pnpm-workspace.yaml* ./
RUN pnpm install --frozen-lockfile --prod=false

# ---- Stage 2: build ----
FROM node:24-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
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
    ALLOWLIST_EMAILS=build@placeholder.local

RUN pnpm build

# ---- Stage 3: runner (production) ----
FROM node:24-alpine AS runner
WORKDIR /app

# Asia/Seoul 타임존 강제 — node-cron의 KST 8AM 정확성에 결정적
ENV TZ=Asia/Seoul
RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/Asia/Seoul /etc/localtime && \
    echo "Asia/Seoul" > /etc/timezone

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3020

# Non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001 -G nodejs

# Next.js standalone output (next.config.ts에서 output: 'standalone' 필요)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle

USER nextjs
EXPOSE 3020

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD wget --quiet --spider http://localhost:3020/api/health || exit 1

CMD ["node", "server.js"]
