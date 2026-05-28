# gons-dashboard

개인 사용자 대시보드 — 도메인을 단계별로 늘려가는 통합 워크스페이스.

## 개요

- **목표**: 개인 생산성을 높이는 통합 대시보드
- **아키텍처**: FSD (Feature-Sliced Design)
- **모노레포**: pnpm workspaces (`apps/` + `packages/`)

## 도메인

| 도메인 | 설명 |
|--------|------|
| Email 분석 | Gmail 폴링 → LLM 분류(important / reply-needed) → 위젯 표시·푸시 |
| Server Infra Monitor | 등록된 Docker host들의 컨테이너 상태·프로젝트 묶음·재시작 액션 |
| Saju (사주) | `packages/saju` 빌더 + Tri-nation (KR/CN/JP) 학파별 narrative |
| Stock Analysis | `packages/stock-analysis` + 페르소나 5명 + consensus + flip 알림 |
| Calendar / Tiger Reading / Fortune Profile | `packages/mcp-calendar` 외 보조 위젯 |

## 기술 스택

- **프레임워크**: Next.js 16 (App Router, RSC + Server Actions, Turbopack)
- **언어**: TypeScript (strict)
- **DB**: PostgreSQL 16 + Drizzle ORM
- **인증**: NextAuth v5 + Drizzle adapter (Google OAuth)
- **스타일링**: Tailwind CSS v4 (라이트 모드 고정)
- **AI**: Anthropic SDK → Claude Code CLI Proxy

## Quick Start

```bash
pnpm install
cp .env.example .env          # 필수 값 채우기
pnpm db:generate              # 스키마 변경 시
pnpm db:migrate               # DB 마이그레이션
pnpm db:seed:hosts            # 호스트 등록
pnpm dev                      # http://localhost:3020
```

## 검증 명령

```bash
pnpm typecheck                # tsc --noEmit
pnpm lint                     # ESLint (FSD boundary 규칙 포함)
pnpm test                     # vitest run
pnpm build                    # production build 검증
```

## 패키지 업데이트

```bash
# 사주 라이브러리
pnpm update @krdn/saju

# LLM Gateway
pnpm update @krdn/llm-gateway
```

> GitHub tarball 의존성 (`github:krdn/<repo>#<tag>`) 은 `package.json` 의 태그를 수동으로 변경한 뒤 `pnpm install` 실행. 자세한 절차는 `docs/RUNBOOK.md` 참조.

## 레포 레이아웃

```
gons-dashboard/
├── apps/
│   ├── dashboard/   # Next.js 앱 (@gons/dashboard)
│   └── cron/        # node-cron 컨테이너 (@gons/cron)
└── packages/
    ├── saju/                # @gons/saju
    ├── stock-analysis/      # @gons/stock-analysis
    ├── mcp-calendar/        # @gons/mcp-calendar
    ├── shared-google/       # @gons/shared-google
    └── shared-mcp-runtime/  # @gons/shared-mcp-runtime
```

## 운영 배포

| 항목 | 값 |
|------|-----|
| 운영 서버 | `192.168.0.5` (docker context `home-server`) |
| 외부 URL | `https://gons.krdn.kr` |
| 이미지 | `ghcr.io/krdn/gons-dashboard:latest`, `ghcr.io/krdn/gons-dashboard-cron:latest` |
| 포트 | app `3020`, postgres `5440`, redis `6390` |

## 문서

- `CLAUDE.md` — 프로젝트 컨텍스트 + Gotcha
- `docs/RUNBOOK.md` — 운영 절차 (시크릿 회전, OAuth 갱신 등)
- `docs/agents/` — Issue tracker, triage labels, 도메인 결정
- `docs/superpowers/` — 설계/계획 산출물
- `TODOS.md` — v0.1 후속 작업 backlog
