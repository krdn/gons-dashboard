# gons-dashboard

개인 사용자 대시보드. 다양한 기능을 필요할 때 단계별로 추가합니다.

## 프로젝트 개요

- **목표**: 개인 생산성을 높이는 통합 대시보드
- **첫 기능**: Email 분석 (요약, 중요한 메시지 식별, 답변해야 할 메시지 추출)
- **확장 방향**: 점진적으로 도메인을 늘려갑니다 (캘린더, 할 일, 노트 등)
- **아키텍처**: FSD (Feature-Sliced Design)
- **문서 언어**: 한국어 (코드 자체는 영어)

## 기술 스택 (예정)

세부 사항은 첫 기능을 설계할 때 확정하지만, 기본 방향:

- **프레임워크**: Next.js (App Router)
- **언어**: TypeScript
- **패키지 매니저**: pnpm
- **스타일링**: Tailwind CSS + shadcn/ui (또는 동등한 디자인 시스템)
- **상태 관리**: TanStack Query (서버 상태) + Zustand (클라이언트 상태)
- **검증**: Zod
- **테스트**: Vitest + Playwright

## FSD 아키텍처

`~/.claude/rules/fsd-architecture.md`의 규칙을 따릅니다. 이 프로젝트는 다음 조건이 충족되어 FSD를 적용합니다:

- 기능이 점진적으로 늘어남 (Email → Calendar → Tasks → ...)
- 도메인이 명확히 분리됨 (각 기능이 독립적인 비즈니스 영역)
- 장기 유지보수 예상

### 레이어 구조

```
src/
├── app/                  # Next.js App Router (라우팅 + 레이아웃)
├── widgets/              # 조합 컴포넌트 (DashboardHeader, EmailDigest 등)
├── features/             # 기능 단위 (email-analysis, ...)
│   └── <feature-name>/
│       ├── ui/
│       ├── model/
│       ├── api/
│       └── lib/
├── entities/             # 비즈니스 엔티티 (email, message, ...)
│   └── <entity-name>/
│       ├── ui/
│       ├── model/
│       └── api/
└── shared/               # 공유 리소스 (UI, lib, api, config)
```

### 의존성 방향

`app → widgets → features → entities → shared` (상위만 하위 참조)

각 슬라이스는 `index.ts`로 public API를 노출합니다.

## Agent skills

### Issue tracker

이 저장소의 이슈와 PRD는 GitHub Issues에 저장됩니다 (`krdn/gons-dashboard`). `gh` CLI를 사용합니다. 자세한 내용은 `docs/agents/issue-tracker.md` 참고.

### Triage labels

표준 5종 레이블(`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`)을 그대로 사용합니다. 자세한 내용은 `docs/agents/triage-labels.md` 참고.

### Domain docs

단일 컨텍스트 레이아웃입니다 (`CONTEXT.md` + `docs/adr/`가 저장소 루트). 자세한 내용은 `docs/agents/domain.md` 참고.

## AI 호출 정책

Anthropic SDK를 사용하되 직접 Anthropic API가 아닌 **Claude Code CLI Proxy**를 향한다.

```typescript
// shared/lib/llm/anthropic.ts
import Anthropic from '@anthropic-ai/sdk';
import { env } from '@/shared/config/env';

export const anthropic = new Anthropic({
  baseURL: env.LLM_PROXY_BASE_URL,  // 예: http://192.168.0.5:8317
  apiKey: env.LLM_PROXY_API_KEY,
});
```

| 환경 변수 | 설명 |
|-----------|------|
| `LLM_PROXY_BASE_URL` | 프록시 엔드포인트 URL |
| `LLM_PROXY_API_KEY` | 프록시 인증 시크릿 (Zod 검증, 절대 커밋 금지) |

실제 값은 `.env` (gitignore됨)에 보관. 신규 클론 시 `.env.example`을 복사해 채운다. **시크릿은 어떤 형태로도 저장소에 커밋하지 않는다 — README, 주석, 마크다운 포함.**
