# Workspace Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 현재 단일 Next.js 프로젝트를 pnpm workspaces 모노레포로 전환하고 모든 코드를 `apps/dashboard/`로 이동. 기능 변경 없음 — DoD는 "기존 typecheck/lint/test/build/deploy가 그대로 통과".

**Architecture:** repo root에 `pnpm-workspace.yaml` + `tsconfig.base.json` 추가. 기존 `src/`, `tests/`, `drizzle/`, `public/`, `next.config.ts`, `vitest.config.ts`, `eslint.config.mjs`, `drizzle.config.ts`, `tsconfig.json`, `next-env.d.ts`, `Dockerfile`, `.dockerignore`, `postcss.config.mjs` 등을 `apps/dashboard/`로 이동. root `package.json`은 workspace 정의만 남기고 모든 의존성·script는 `apps/dashboard/package.json`으로 이전. GitHub Actions 워크플로와 docker-compose 빌드 컨텍스트를 새 경로로 갱신. **이번 plan에서는 packages/는 만들지 않는다** — Calendar 파일럿 plan(plan-B)에서 처음 생성한다.

**Tech Stack:** pnpm 10.28.2 workspaces, TypeScript 5, Next.js 16, Vitest 4, Docker multi-stage build, GitHub Actions

**Prerequisites:** 없음. 이 plan이 plan-B의 prerequisite.

---

## 사전 확인 — 현 레포 사실

이 plan은 다음 현 상태를 전제로 한다:

1. **`pnpm-workspace.yaml`이 이미 존재** — 내용:
   ```yaml
   ignoredBuiltDependencies:
     - sharp
     - unrs-resolver
   ```
   plan은 **신규 작성이 아니라 `packages:` 필드 추가로 확장**한다.

2. **`cron/` 디렉토리가 별도 mini-project로 존재** — 자체 `package.json` (node-cron만 의존), `Dockerfile`, `scheduler.js`. CI는 `ghcr.io/krdn/gons-dashboard-cron:latest`를 build context `./cron`으로 빌드해 compose의 `cron` 서비스가 사용. plan은 이를 `apps/cron/`으로 이동해 monorepo에 정합하게 만든다.

3. **`LICENSE`, `README.md`, `.prettierrc.json`, `.planning/` 등** root에 있음 — 이동하지 않음.

## File Structure

이동 후 레포 형태:

```
gons-dashboard/
├── pnpm-workspace.yaml          (확장 — packages 필드 추가, 기존 ignoredBuiltDependencies 보존)
├── package.json                 (재작성 — workspace root, thin proxy scripts)
├── tsconfig.base.json           (신규 — 공통 compilerOptions)
├── pnpm-lock.yaml               (re-install로 재생성)
├── docker-compose.yml           (cron service의 image → build로 변경 OR tag만 유지 + ci.yml만 갱신)
├── .github/workflows/ci.yml     (app: context=., file=apps/dashboard/Dockerfile / cron: context=apps/cron, file=apps/cron/Dockerfile)
├── docs/                        (그대로)
├── CLAUDE.md                    (그대로)
├── TODOS.md                     (그대로)
├── README.md                    (그대로)
├── LICENSE                      (그대로)
├── .prettierrc.json             (그대로 — repo 전역 prettier 설정)
├── .planning/                   (그대로)
└── apps/
    ├── dashboard/               (모든 dashboard 코드 이전 목적지)
    │   ├── package.json         (현 root package.json의 deps/scripts 이전, name: "@gons/dashboard")
    │   ├── tsconfig.json        (extends ../../tsconfig.base.json)
    │   ├── next.config.ts       (그대로 이동)
    │   ├── next-env.d.ts        (그대로 이동)
    │   ├── vitest.config.ts     (수정 없음 — __dirname 기반 alias가 자동 적응)
    │   ├── eslint.config.mjs    (수정 없음 — 상대 패턴 src/**)
    │   ├── drizzle.config.ts    (수정 없음 — 상대 ./src 경로)
    │   ├── postcss.config.mjs   (그대로 이동)
    │   ├── Dockerfile           (monorepo context용 COPY 경로 갱신)
    │   ├── .dockerignore        (그대로 이동)
    │   ├── .env.example         (그대로 이동)
    │   ├── src/                 (전체 그대로 이동)
    │   ├── tests/               (전체 그대로 이동)
    │   ├── drizzle/             (마이그레이션 파일 그대로 이동)
    │   └── public/              (그대로 이동)
    └── cron/                    (cron 컨테이너 코드 이전 목적지)
        ├── package.json         (현 cron/package.json 그대로, name: "@gons/cron"으로 갱신)
        ├── Dockerfile           (그대로 이동 — node-cron 단일 컨테이너라 monorepo context 불필요)
        └── scheduler.js         (그대로 이동)
```

**이동하지 않는 것**: `.git/`, `node_modules/`, `.next/`, `.env`(사용자 머신 로컬), `docs/`, `CLAUDE.md`, `TODOS.md`, `README.md`, `LICENSE`, `.gitignore`, `.prettierrc.json`, `.planning/`(루트 유지).

---

## Task 1: 사전 검증 — 현재 상태 baseline 캡처

**Files:** (변경 없음, 출력만 기록)

- [ ] **Step 1: 현재 baseline 확인**

Run:
```bash
pnpm typecheck 2>&1 | tail -5
pnpm lint 2>&1 | tail -5
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test 2>&1 | tail -10
```

Expected: 모두 통과 (test는 로컬 DB 미기동 시 통합 일부 ECONNREFUSED 가능 — pure unit만 통과해도 OK, 단 실패 개수를 메모).

- [ ] **Step 2: 현재 디렉토리 트리 기록**

Run:
```bash
ls -1 /home/gon/projects/gon/gons-dashboard/ > /tmp/baseline-root.txt
ls -1 /home/gon/projects/gon/gons-dashboard/src/ > /tmp/baseline-src.txt
cat /tmp/baseline-root.txt
```

Expected: 현재 root에 있는 항목 모두 표시. 이 plan이 끝나면 root는 훨씬 깔끔해야 함(주요 코드 파일은 apps/dashboard/로).

- [ ] **Step 3: 커밋 X (이 task는 검증만)**

이 task는 git change 없음. 다음 task로 진행.

---

## Task 2: pnpm workspaces 설정 확장

**Files:**
- Modify: `pnpm-workspace.yaml` (기존 파일 확장 — 신규 작성 아님)
- Create: `tsconfig.base.json`

**중요**: `pnpm-workspace.yaml`은 이미 존재한다. 기존 내용:
```yaml
ignoredBuiltDependencies:
  - sharp
  - unrs-resolver
```
이 plan은 **이 파일에 `packages:` 필드를 추가**한다. 기존 `ignoredBuiltDependencies`는 보존.

- [ ] **Step 1: pnpm-workspace.yaml에 packages 필드 추가**

Replace the content of `pnpm-workspace.yaml` with:

```yaml
packages:
  - "apps/*"
  - "packages/*"

ignoredBuiltDependencies:
  - sharp
  - unrs-resolver
```

`packages/*`는 plan-B를 위해 미리 선언 — 디렉토리 없어도 pnpm은 무시.

- [ ] **Step 2: tsconfig.base.json 작성**

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true
  }
}
```

(현 `tsconfig.json`의 compilerOptions 중 Next.js plugin·paths를 제외한 공통 부분.)

- [ ] **Step 3: 검증 — pnpm install 무엇도 안 깨는지 확인**

Run:
```bash
pnpm install
```

Expected: 변경된 lockfile은 거의 없거나 없음. 워크스페이스 인식 OK.

- [ ] **Step 4: 커밋**

```bash
git add pnpm-workspace.yaml tsconfig.base.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
chore(workspace): pnpm workspaces 기반 모노레포 골격 추가

apps/*, packages/* 워크스페이스 선언과 공통 tsconfig.base.json. 코드 이동은
다음 커밋에서 별도 처리하여 git rename 감지가 깔끔하게 잡히도록 함.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: apps/dashboard/ + apps/cron/ 디렉토리 생성 + 코드 이동

**Files:**
- Create: `apps/dashboard/`, `apps/cron/` (디렉토리)
- Move: `src/`, `tests/`, `drizzle/`, `public/` → `apps/dashboard/`
- Move: dashboard 설정 파일 10개 → `apps/dashboard/`
- Move: `cron/*` → `apps/cron/` (rmdir cron)

`git mv`를 사용해 rename 감지가 동작하게 한다 (review에서 diff를 작게).

- [ ] **Step 1: 디렉토리 생성**

Run:
```bash
mkdir -p apps/dashboard apps/cron
```

- [ ] **Step 2: dashboard 핵심 디렉토리 이동**

Run:
```bash
git mv src apps/dashboard/src
git mv tests apps/dashboard/tests
git mv drizzle apps/dashboard/drizzle
git mv public apps/dashboard/public
```

- [ ] **Step 3: dashboard 설정 파일 이동**

Run:
```bash
git mv next.config.ts apps/dashboard/
git mv next-env.d.ts apps/dashboard/
git mv vitest.config.ts apps/dashboard/
git mv eslint.config.mjs apps/dashboard/
git mv drizzle.config.ts apps/dashboard/
git mv postcss.config.mjs apps/dashboard/
git mv tsconfig.json apps/dashboard/
git mv Dockerfile apps/dashboard/
git mv .dockerignore apps/dashboard/
git mv .env.example apps/dashboard/
```

- [ ] **Step 4: cron 파일들을 apps/cron으로 이동**

Run:
```bash
git mv cron/package.json apps/cron/package.json
git mv cron/Dockerfile apps/cron/Dockerfile
git mv cron/scheduler.js apps/cron/scheduler.js
rmdir cron
```

- [ ] **Step 5: cron/package.json의 name을 @gons/cron으로 갱신**

Edit `apps/cron/package.json` — change the `name` field from `"gons-dashboard-cron"` to `"@gons/cron"`. The rest of the file stays the same:

```json
{
  "name": "@gons/cron",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "node-cron": "^3.0.3"
  }
}
```

- [ ] **Step 6: 상태 확인**

Run:
```bash
git status
ls apps/dashboard/
ls apps/cron/
```

Expected:
- `apps/dashboard/`에 `src/`, `tests/`, `drizzle/`, `public/` 및 dashboard 설정 파일들 존재.
- `apps/cron/`에 `package.json`, `Dockerfile`, `scheduler.js` 존재.
- root에서 `cron/` 사라짐.

- [ ] **Step 7: 커밋 X — 다음 task에서 설정 갱신 후 한꺼번에 검증**

이 task는 파일 이동만. typecheck/lint/test/build는 다음 task의 설정 갱신 후 한 번에 재실행.

---

## Task 4: 이동한 설정 파일들의 경로 갱신

**Files:**
- Modify: `apps/dashboard/tsconfig.json`
- Modify: `apps/dashboard/vitest.config.ts`
- Modify: `apps/dashboard/eslint.config.mjs`
- Modify: `apps/dashboard/drizzle.config.ts`

- [ ] **Step 1: apps/dashboard/tsconfig.json 갱신**

Replace `apps/dashboard/tsconfig.json` contents with:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts",
    "**/*.mts"
  ],
  "exclude": ["node_modules"]
}
```

(공통 compilerOptions은 base에서 상속. Next plugin과 `@/*` paths만 남김.)

- [ ] **Step 2: apps/dashboard/vitest.config.ts 검증**

Run:
```bash
cat apps/dashboard/vitest.config.ts
```

Expected: `path.resolve(__dirname, "src")`이 보임 — `__dirname`이 apps/dashboard로 바뀌므로 이미 정확. **수정 없음.**

- [ ] **Step 3: apps/dashboard/eslint.config.mjs 검증**

이 파일은 `src/**/*.{ts,tsx}` 같은 상대 패턴을 사용 — `apps/dashboard/`에서 실행되면 그대로 작동. **수정 없음.**

- [ ] **Step 4: apps/dashboard/drizzle.config.ts 검증**

이 파일은 `./src/shared/lib/db/schema.ts`, `./drizzle` 상대 경로 사용 — `apps/dashboard/`에서 실행되면 그대로 작동. **수정 없음.**

- [ ] **Step 5: 커밋 X — 다음 task에서 root + apps/dashboard package.json 갱신 후 일괄 검증**

---

## Task 5: root + apps/dashboard package.json 재구성

**Files:**
- Create: `apps/dashboard/package.json`
- Modify: `package.json` (root)

현 root `package.json`에는 모든 deps와 script가 있음. 이를 `apps/dashboard/package.json`으로 이전하고, root는 workspace root용으로 비운다.

- [ ] **Step 1: apps/dashboard/package.json 작성**

Create `apps/dashboard/package.json`:

```json
{
  "name": "@gons/dashboard",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --turbopack -p 3020",
    "build": "next build",
    "start": "next start -p 3020",
    "stop": "lsof -i :3020 -t 2>/dev/null | xargs -r kill -9",
    "lint": "eslint",
    "typecheck": "tsc --noEmit",
    "format": "prettier --write \"src/**/*.{ts,tsx,css,md}\"",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio",
    "db:seed:hosts": "tsx --conditions=react-server src/scripts/seed-hosts.ts",
    "db:seed:projects": "tsx --conditions=react-server src/scripts/seed-projects.ts",
    "db:cleanup-projects": "tsx --conditions=react-server src/scripts/cleanup-projects.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.36.3",
    "@auth/drizzle-adapter": "^1.7.4",
    "@tanstack/react-query": "^5.62.7",
    "dotenv": "^17.4.2",
    "drizzle-orm": "^0.38.3",
    "next": "16.2.6",
    "next-auth": "^5.0.0-beta.25",
    "postgres": "^3.4.5",
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "server-only": "^0.0.1",
    "web-push": "^3.6.7",
    "zod": "^3.24.1",
    "zustand": "^5.0.2"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@testing-library/react": "^16.3.2",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@types/web-push": "^3.6.4",
    "@vitest/ui": "^4.1.5",
    "drizzle-kit": "^0.30.1",
    "eslint": "^9",
    "eslint-config-next": "16.2.6",
    "eslint-plugin-boundaries": "^5.0.1",
    "jsdom": "^29.1.1",
    "prettier": "^3.4.2",
    "prettier-plugin-tailwindcss": "^0.6.9",
    "tailwindcss": "^4",
    "tsx": "^4.21.0",
    "typescript": "^5",
    "vitest": "^4.1.5"
  }
}
```

(현 root package.json의 deps/devDeps/scripts를 그대로 이전. `packageManager` 필드만 root에 남긴다.)

- [ ] **Step 2: root package.json 재작성**

Overwrite `package.json` (repo root):

```json
{
  "name": "gons-dashboard-monorepo",
  "version": "0.1.0",
  "private": true,
  "packageManager": "pnpm@10.28.2",
  "scripts": {
    "dev": "pnpm --filter @gons/dashboard dev",
    "build": "pnpm --filter @gons/dashboard build",
    "start": "pnpm --filter @gons/dashboard start",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "format": "pnpm --filter @gons/dashboard format",
    "db:generate": "pnpm --filter @gons/dashboard db:generate",
    "db:migrate": "pnpm --filter @gons/dashboard db:migrate",
    "db:studio": "pnpm --filter @gons/dashboard db:studio",
    "db:seed:hosts": "pnpm --filter @gons/dashboard db:seed:hosts",
    "db:seed:projects": "pnpm --filter @gons/dashboard db:seed:projects",
    "db:cleanup-projects": "pnpm --filter @gons/dashboard db:cleanup-projects"
  }
}
```

스크립트는 모두 thin proxy — 기존 CLAUDE.md의 `pnpm <command>` 호출 인터페이스를 유지하기 위한 호환층.

- [ ] **Step 3: pnpm install 실행**

Run:
```bash
pnpm install
```

Expected: lockfile이 워크스페이스 구조에 맞게 재생성. `node_modules`가 root와 apps/dashboard 양쪽에 hoisted/local로 자리잡음.

- [ ] **Step 4: typecheck**

Run:
```bash
pnpm typecheck
```

Expected: 통과. 실패하면 path 또는 tsconfig.base.json 상속 문제 — base의 `compilerOptions` 누락 항목 확인.

- [ ] **Step 5: lint**

Run:
```bash
pnpm lint
```

Expected: 통과. 실패하면 eslint.config.mjs의 `tsconfig.json` resolver 경로 — 현재 `"./tsconfig.json"`은 cwd 기준이므로 `pnpm --filter @gons/dashboard lint`로 실행되어야 동작. root `pnpm lint`가 `-r`로 각 패키지 cwd에서 실행하므로 OK.

- [ ] **Step 6: test (로컬 DB 없는 환경)**

Run:
```bash
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test 2>&1 | tail -10
```

Expected: pure unit 테스트 통과. 통합 테스트는 ECONNREFUSED (Task 1 baseline과 동일).

- [ ] **Step 7: build (sanity)**

Run:
```bash
DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder \
REDIS_URL=redis://localhost:6379 \
NEXTAUTH_SECRET=a-placeholder-secret-of-at-least-32-characters \
NEXTAUTH_URL=http://localhost:3020 \
GOOGLE_CLIENT_ID=placeholder \
GOOGLE_CLIENT_SECRET=placeholder \
ANTHROPIC_BASE_URL=http://placeholder \
ANTHROPIC_API_KEY=placeholder \
CRON_BEARER_TOKEN=a-placeholder-cron-token-of-at-least-32-characters \
ALLOWLIST_EMAILS=build@placeholder.local \
ADMIN_EMAILS=build@placeholder.local \
pnpm build
```

Expected: 통과. Next.js standalone 빌드가 `apps/dashboard/.next/standalone/`에 생성.

- [ ] **Step 8: 커밋**

```bash
git add apps/dashboard package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
chore(workspace): 코드 전체를 apps/dashboard로 이동, root는 thin proxy

- apps/dashboard에 src/tests/drizzle/public 및 설정 파일 이전 (git mv 사용)
- apps/dashboard/package.json 신설 (이름: @gons/dashboard) — 기존 deps/scripts 그대로
- apps/dashboard/tsconfig.json: ../../tsconfig.base.json extends
- root package.json: pnpm --filter @gons/dashboard로 thin proxy

기능 변경 없음. typecheck/lint/test/build 그대로 통과.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Dockerfile + docker-compose 빌드 컨텍스트 갱신

**Files:**
- Modify: `apps/dashboard/Dockerfile`
- Modify: `docker-compose.yml`

Dockerfile은 이미 `apps/dashboard/`로 이동됨. 그 안의 COPY 명령들은 build context 기준 상대 경로를 사용 — context를 어디서 시작할지가 핵심.

**선택**: Dockerfile을 monorepo root context로 빌드해 root의 `pnpm-workspace.yaml`과 `tsconfig.base.json`을 함께 COPY해야 함. 그래서 docker-compose는 `context: .`, `dockerfile: apps/dashboard/Dockerfile`.

- [ ] **Step 1: apps/dashboard/Dockerfile 갱신**

Read current `apps/dashboard/Dockerfile`. 주요 변경:
- COPY 명령들을 `apps/dashboard/...`와 root의 `pnpm-workspace.yaml`, `tsconfig.base.json`을 함께 다루도록 갱신.
- `WORKDIR /app`은 유지. monorepo 전체를 `/app`에 복사.
- `pnpm install`은 root에서. `pnpm --filter @gons/dashboard build`로 빌드.
- standalone output은 `apps/dashboard/.next/standalone/`에 생성됨 — runner stage의 COPY 경로 갱신.

Replace `apps/dashboard/Dockerfile` contents:

```dockerfile
# gons-dashboard — monorepo multi-stage build
# Next.js 16 standalone output → 작은 production 이미지
# build context: monorepo root (docker-compose의 context: .)

# ---- Stage 1: deps (의존성 캐시 레이어) ----
FROM node:24-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/dashboard/package.json ./apps/dashboard/
RUN pnpm install --frozen-lockfile --prod=false

# ---- Stage 2: build ----
FROM node:24-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/dashboard/node_modules ./apps/dashboard/node_modules
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/dashboard ./apps/dashboard
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
    ALLOWLIST_EMAILS=build@placeholder.local \
    ADMIN_EMAILS=build@placeholder.local

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

# Next.js standalone output은 apps/dashboard/.next/standalone/ 에 생성됨.
# 이미지에는 standalone 결과만 복사해 크기 최소화.
COPY --from=builder /app/apps/dashboard/.next/standalone ./
COPY --from=builder /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=builder /app/apps/dashboard/public ./apps/dashboard/public

EXPOSE 3020
ENV PORT=3020
ENV HOSTNAME=0.0.0.0

CMD ["node", "apps/dashboard/server.js"]
```

(현 Dockerfile의 stage 3 마지막 부분은 readback해 정확히 비교 — `CMD`가 `node server.js`로 되어 있다면 standalone 출력 위치 차이만큼 갱신.)

- [ ] **Step 2: docker-compose.yml 검토 — 변경 불필요**

현 `docker-compose.yml`은 `image: ghcr.io/krdn/...` 로 prebuilt 이미지를 사용 (compose 자체에서 build하지 않음). 빌드 책임은 GitHub Actions이므로 **docker-compose.yml은 수정 없음**.

readback으로 확인:

Run:
```bash
grep -E "^\s+(build|image):" docker-compose.yml
```

Expected: app, cron 서비스 모두 `image:` 라인만 보이고 `build:` 라인 없음. 만약 `build:` 라인이 보이면 다음 변경:
- `app` 서비스: `build: { context: ., dockerfile: apps/dashboard/Dockerfile }`
- `cron` 서비스: `build: { context: ./apps/cron, dockerfile: Dockerfile }`

- [ ] **Step 3: 로컬 docker 빌드 시험 (선택, 사용자 머신에 docker 있을 때만)**

Run:
```bash
docker build -t gons-dashboard-test -f apps/dashboard/Dockerfile .
docker build -t gons-dashboard-cron-test -f apps/cron/Dockerfile apps/cron
```

Expected: 통과. 실패 시 COPY 경로 또는 standalone 출력 위치 조정.

docker가 없으면 GHA에서 검증되므로 skip.

- [ ] **Step 4: 커밋**

```bash
git add apps/dashboard/Dockerfile
git commit -m "$(cat <<'EOF'
chore(docker): monorepo 빌드 컨텍스트로 dashboard Dockerfile 갱신

build context를 repo root로 변경. pnpm workspace 인스톨, --filter
@gons/dashboard build, standalone 출력 위치(apps/dashboard/.next/standalone)
반영. cron Dockerfile은 apps/cron/ 단독 컨텍스트로 그대로 유지 (변경
없음). docker-compose.yml은 image: 만 참조하므로 변경 없음.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: GitHub Actions 워크플로 갱신

**Files:**
- Modify: `.github/workflows/ci.yml`

현 워크플로는:
- `lint-typecheck` job에서 root scripts (`pnpm lint`, `pnpm typecheck`, `pnpm db:migrate`, `pnpm test`, `pnpm build`)를 호출 → root thin-proxy로 그대로 동작.
- `docker` job에서 두 이미지를 빌드:
  - **app**: `context: .`, `file: ./Dockerfile`
  - **cron**: `context: ./cron`, `file: ./cron/Dockerfile`

이 plan으로 변경되는 것:
- app Dockerfile 위치: `./Dockerfile` → `apps/dashboard/Dockerfile`
- cron Dockerfile 위치: `./cron/Dockerfile` → `apps/cron/Dockerfile`
- cron build context: `./cron` → `./apps/cron`

- [ ] **Step 1: ci.yml readback**

Run:
```bash
cat .github/workflows/ci.yml
```

특히 `Build & push app image`와 `Build & push cron image` 스텝의 `with:` 블록을 확인.

- [ ] **Step 2: Build & push app image step 갱신**

Find:

```yaml
      - name: Build & push app image
        uses: docker/build-push-action@v5
        with:
          context: .
          file: ./Dockerfile
          push: true
```

Replace with:

```yaml
      - name: Build & push app image
        uses: docker/build-push-action@v5
        with:
          context: .
          file: ./apps/dashboard/Dockerfile
          push: true
```

(`context: .`는 monorepo Dockerfile이 root의 `pnpm-workspace.yaml`을 COPY해야 하므로 그대로 유지.)

- [ ] **Step 3: Build & push cron image step 갱신**

Find:

```yaml
      - name: Build & push cron image
        uses: docker/build-push-action@v5
        with:
          context: ./cron
          file: ./cron/Dockerfile
          push: true
```

Replace with:

```yaml
      - name: Build & push cron image
        uses: docker/build-push-action@v5
        with:
          context: ./apps/cron
          file: ./apps/cron/Dockerfile
          push: true
```

(cron은 monorepo workspace 의존성이 없는 mini-project라 context를 자체 디렉토리로 좁힘 — 이미지 크기·빌드 시간 절약.)

- [ ] **Step 4: `lint-typecheck` job의 pnpm 호출 검증 — 변경 불필요**

`pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm db:migrate`, `pnpm test`, `pnpm build` 모두 root thin-proxy scripts로 동작하므로 변경 없음.

(만약 readback 결과 어떤 step이 `cd src/...` 또는 직접 `next build`를 호출하면 그 step만 `working-directory: apps/dashboard` 추가 — 현재 ci.yml에는 그런 step 없음으로 파악되었음.)

- [ ] **Step 5: 커밋**

```bash
git add .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
ci: app/cron Docker 빌드 경로를 monorepo 레이아웃으로 갱신

- app: file=./apps/dashboard/Dockerfile (context는 monorepo root 유지)
- cron: context=./apps/cron, file=./apps/cron/Dockerfile

lint-typecheck job의 pnpm 호출은 root thin-proxy로 동작하므로 변경 없음.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: CLAUDE.md 운영 메모 보강

**Files:**
- Modify: `CLAUDE.md`

`CLAUDE.md`는 `pnpm install`, `pnpm dev`, `pnpm typecheck` 등 root 진입을 가정한다. root proxy scripts 덕에 명령어 자체는 그대로지만, **새 디렉토리 구조**를 한 줄 명시해 미래의 자기 자신/사용자/agent가 헷갈리지 않게 한다.

- [ ] **Step 1: CLAUDE.md에 monorepo 섹션 추가**

Find the "## 기술 스택" 섹션 위(또는 "## Quick Start" 아래)에 새 섹션 삽입:

```markdown
## 레포 레이아웃 (monorepo)

pnpm workspaces 모노레포. dashboard와 cron 컨테이너가 각각 `apps/` 하위 패키지.

```
gons-dashboard/
├── apps/
│   ├── dashboard/   # Next.js 앱 (@gons/dashboard)
│   └── cron/        # node-cron 컨테이너 (@gons/cron) — 매시간 /api/cron/* 호출
└── packages/        # MCP 서버 패키지가 추가될 자리 (plan-B 이후)
```

root의 `pnpm <script>`는 `apps/dashboard`로 위임하는 thin proxy. CLAUDE.md
하위 명령(`pnpm dev`, `pnpm typecheck` 등)은 그대로 동작. 직접 `apps/dashboard/`에
들어가 실행해도 동일하다. cron은 Docker로만 빌드(GHA가 `apps/cron`을 컨텍스트로
`ghcr.io/krdn/gons-dashboard-cron:latest` 푸시).
```

- [ ] **Step 2: 커밋**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(CLAUDE.md): monorepo 레이아웃 섹션 추가

apps/dashboard/ + 향후 packages/ 구조를 한 화면에 명시. root scripts가
thin proxy임을 설명.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: 최종 검증 — DoD 체크

**Files:** (변경 없음)

- [ ] **Step 1: typecheck**

Run:
```bash
pnpm typecheck
```

Expected: PASS, exit 0.

- [ ] **Step 2: lint**

Run:
```bash
pnpm lint
```

Expected: PASS, exit 0.

- [ ] **Step 3: test (로컬 DB 미기동 시나리오)**

Run:
```bash
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test 2>&1 | tail -15
```

Expected: pure unit 테스트는 통과, 통합 테스트는 ECONNREFUSED (Task 1 baseline과 동일 분포).

- [ ] **Step 4: build (placeholder env)**

Run:
```bash
DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder \
REDIS_URL=redis://localhost:6379 \
NEXTAUTH_SECRET=a-placeholder-secret-of-at-least-32-characters \
NEXTAUTH_URL=http://localhost:3020 \
GOOGLE_CLIENT_ID=placeholder \
GOOGLE_CLIENT_SECRET=placeholder \
ANTHROPIC_BASE_URL=http://placeholder \
ANTHROPIC_API_KEY=placeholder \
CRON_BEARER_TOKEN=a-placeholder-cron-token-of-at-least-32-characters \
ALLOWLIST_EMAILS=build@placeholder.local \
ADMIN_EMAILS=build@placeholder.local \
pnpm build
```

Expected: PASS. `apps/dashboard/.next/standalone/server.js` 생성.

- [ ] **Step 5: PR 생성**

```bash
git push -u origin <branch-name>
gh pr create --title "chore: monorepo (pnpm workspaces) 전환 — 코드 apps/dashboard로 이동" --body "$(cat <<'EOF'
## Summary

- pnpm workspaces 모노레포 골격 도입 (apps/* + packages/*)
- 기존 src/, tests/, drizzle/, public/ 및 설정 파일을 apps/dashboard로 이동 (git mv)
- root package.json은 thin proxy로 재구성 — 기존 `pnpm <script>` 인터페이스 유지
- Dockerfile 빌드 컨텍스트를 repo root로 변경, GHA · docker-compose 경로 갱신
- 기능 변경 없음

## Test plan

- [x] pnpm typecheck
- [x] pnpm lint
- [x] pnpm test (pure unit pass; 통합 ECONNREFUSED는 baseline과 동일)
- [x] pnpm build (placeholder env로 standalone 출력 확인)
- [ ] CI green
- [ ] 운영 배포 후 `curl https://gons.krdn.kr/api/health` → {"status":"ok"} (사용자 확인)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: 사용자 게이트**

PR이 머지되고 운영 배포 + health check 통과 확인 후 plan-B 시작.

이 plan은 여기까지. plan-B(`docs/superpowers/plans/2026-05-12-mcp-calendar-pilot.md`)는 이 PR이 머지된 후에 시작.

---

## DoD (Definition of Done)

- [ ] `pnpm typecheck` 통과
- [ ] `pnpm lint` 통과
- [ ] `pnpm test` baseline과 동일 (회귀 없음)
- [ ] `pnpm build` 통과
- [ ] CI workflow green
- [ ] Docker image 빌드 + ghcr push 성공
- [ ] 운영 서버에서 새 이미지로 app·cron 재시작 후 `/api/health` 200
- [ ] PR 머지 — plan-B 시작 가능 상태
