# gons-autopilot — 주간 자율 업그레이드 시스템 설계

- **작성일**: 2026-06-02
- **상태**: 승인됨 (브레인스토밍 완료, 구현 계획 대기)
- **목표**: gons-dashboard를 매주 1회 AI 주도로 정밀 리서치 → 전문가 에이전트 토론으로 최상위 업그레이드 1건 선정 → 무인 구현·머지·배포·검증·롤백까지 멈춤 없이 자동 발전시킨다.

## 1. 배경 & 핵심 제약

gons-dashboard는 운영 중인 실서비스다 (`https://gons.krdn.kr`, prod DB `192.168.0.5:5440`). 무인 자동화의 안전성이 곧 운영 안정성이다. 메모리에 기록된 사고 이력이 설계 제약을 만든다:

- **CI Build success ≠ 운영 배포** — PR 머지 + GHA 빌드 성공만으로 배포 완료가 아니다. image SHA 비교 → compose pull/up → `/api/health` + route 응답까지 확인해야 한다.
- **prod compose+env 실종 다운** — 빈 env로 재생성 시 Zod 검증 실패로 운영 다운.
- **compose up postgres recreate 비밀번호 drift** — `compose up -d app`이 의존성 chain으로 postgres까지 recreate → 인증 실패. `--no-deps` 강제 필요.
- **timestamptz::date IMMUTABLE 아님 / drizzle migrate 운영 broken** — DB 마이그레이션은 특히 위험.

결론: 무인 배포는 **자동 검증(health+smoke) + 자동 롤백 + 보호 경로(protected paths)** 3중 안전망을 전제로만 허용한다.

### 1.1 결정된 요구사항 (브레인스토밍 합의)

| # | 결정 | 내용 |
|---|------|------|
| D1 | 자율 경계 | **완전 무인** 머지·배포 (가장 공격적 — 안전망으로 상쇄) |
| D2 | 배포 가드 | **Health check + 자동 롤백** (실패 시 이전 SHA로 자동 복구) |
| D3 | 리서치 범위 | 의존성·보안 / 코드품질·리팩터 / 신규 도메인·기능 / 업계 트렌드 / **UI/UX 최대치** (전 영역) |
| D4 | 주간 처리량 | **최상위 1건만 집중** (넓게 리서치 → 깊게 1건 실행, 나머지는 backlog) |
| D5 | 실행 환경 | **Claude Code /schedule 원격 에이전트** (클라우드) + **온프렘 실행기** (배포 전담) |
| D6 | 자율 등급 | **전부 완전 무인** — 기능·UI 전면개편까지 무인 (단 protected paths 제외) |

### 1.2 핵심 아키텍처 제약 — 배포 경계 분리

Claude Code `/schedule` 원격 에이전트는 Anthropic 클라우드에서 돈다 (그래서 사용자 PC가 꺼져도 동작). 그러나 배포·헬스체크·롤백은 전부 `docker --context home-server` → `192.168.0.5` (사설 LAN)로만 가능하다. 클라우드 에이전트는 이 사설망에 닿을 수 없다.

→ 기존 선례 `auto-update-llm-gateway.yml`이 **PR 생성에서 멈추는** 이유가 정확히 이것이다. 이 레포에서 자동 배포하는 워크플로는 아직 없으며, compose pull/up은 현재 사람이 수동 실행한다.

**따라서 루프를 배포 경계에서 둘로 쪼갠다:**

```
┌─ 클라우드 영역 (Claude Code /schedule 원격 에이전트, 매주 cron) ──────┐
│  1. 리서치  — 5인 전문가 병렬 fan-out                                 │
│  2. 토론    — 제안 → 상호 비판 → 합의 점수 → 최상위 1건 선정          │
│  3. 구현    — 브랜치에서 TDD + typecheck/lint/build 그린까지          │
│  4. PR → 자동 머지 (GitHub 공개망이라 클라우드에서 가능)             │
└──────────────────────────────────────────────────────────────────────┘
                 │ main 머지 → GHA(ci.yml)가 ghcr 이미지 빌드·push
                 ▼
┌─ 온프렘 영역 (192.168.0.5, apps/cron 확장 — docker socket 접근) ──────┐
│  5. 배포    — 새 이미지 SHA 감지 → compose up --no-deps               │
│  6. 검증    — /api/health + 핵심 라우트 smoke test                    │
│  7. 롤백/알림 — 실패 시 이전 SHA 자동 롤백 + 이슈·푸시 알림           │
└───────────────────────────────────────────────────────────────────────┘
```

이으는 끈: **main 머지 → GHA 이미지 빌드 → 온프렘이 새 SHA 폴링**. 안전망(health+rollback)이 운영 서버 자체에 있어 더 견고하다. 참고: Server Infra Monitor 도메인에 이미 docker 제어(재시작+감사로그) 인프라가 있어 온프렘 실행기가 그 패턴을 재사용한다.

## 2. 전문가 패널 (5인)

각 에이전트는 **읽기 전용 리서치 + 구조화된 후보 제출**만 한다 (코드 수정 권한 없음 — 구현은 별도 페이즈). Workflow 스크립트 안에서 `agent(prompt, {agentType, schema: CANDIDATE_SCHEMA})`로 스폰된다.

| 에이전트 | 기반 agentType | 리서치 도구 | 후보 예시 |
|---|---|---|---|
| **dependency-security** | `security-reviewer` | `pnpm outdated`, `pnpm audit`, Context7, 웹검색 CVE | "Next.js 16.x 보안패치", "drizzle deprecated API 이전" |
| **code-architect** | `code-architect` | Grep/Glob FSD 경계 스캔, `knip`/`ts-prune`, 빌드 산출물 | "features barrel seam 위반 정리", "800줄 초과 파일 분해" |
| **product-strategist** | `planner` | TODOS.md·CLAUDE.md·domain.md 정독, 백로그 점수화 | "TODOS #2 Eval CI 회귀검증", "할 일 도메인 1차 위젯" |
| **trend-researcher** | `researcher` | WebSearch/Exa 업계 동향, GitHub 트렌드 | "TanStack Query 마이그레이션 가치", "RSC 신패턴" |
| **ux-designer** | `frontend-design` 스킬 | 라이브 사이트 스크린샷(Playwright), 디자인 트렌드 | "대시보드 시각 계층 개편", "의도적 디자인 방향" |

각자 매주 후보를 1~3건씩 낸다.

## 3. 토론 프로토콜 (3 라운드)

"전문가들이 서로 질문/답변으로 결정"을 라운드 2(challenge↔defense)와 라운드 3(judge panel)으로 구현한다. 단순 점수 합산이 아니라 **반박을 견딘 후보**가 이긴다.

### 라운드 1: 제안 (parallel fan-out)
5인 병렬 → 각자 후보 N건 제출. 후보 스키마:
```
CANDIDATE = {
  id, owner, title, rationale,
  impact: 1-5, effort: 1-5, risk: 1-5,
  changeType: "deps" | "security" | "refactor" | "feature" | "ui" | "perf",
  protectedPathTouch: boolean,
  dbMigration: boolean,
  dedupKey: string          // backlog 중복 제안 방지
}
```

### 라운드 2: 상호 비판 (adversarial cross-examination)
전체 후보 풀을 모든 전문가에게 회람. 각 전문가가 자기 전문 영역 관점에서 타 후보를 검증:
- security가 ux 후보의 의존성 추가 위험 지적
- architect가 product 후보의 FSD 경계 영향 평가
- 각 후보에 challenge(반론) + defense(원작성자 1턴 방어) → `crossReview[]` 누적

### 라운드 3: 합의 점수 (judge panel)
3명의 독립 judge가 서로 다른 lens(가치 / 안전 / 실현성)로 비판 이력 포함해 채점 → 가중 평균:
```
score = impact*0.4 + (6-risk)*0.35 + (6-effort)*0.25 - protectedPathPenalty - dbMigrationPenalty
```
최상위 1건 선정. 나머지는 `backlog.json`에 누적(다음 주 재경쟁 + dedup).

## 4. 구현 페이즈

선정된 1건은 구현 단계로 넘어가 `gsd-executor`/`coder` 계열 에이전트가 구현한다:

1. 브랜치 생성: `autopilot/YYYY-WW-<slug>` (항상 최신 main에서 분기)
2. TDD: 테스트 먼저(RED) → 구현(GREEN) → 리팩터
3. **게이트** (Gotcha #7 — build 필수): `pnpm typecheck && pnpm lint && (cd apps/dashboard && pnpm build)`
4. 게이트 실패 시 최대 2회 자가수정 재시도. 그래도 실패면 사이클 abort + 이슈 기록 (배포 안 함)

## 5. 무인 배포·롤백 (온프렘 실행기)

### 5.1 Protected Paths — 자율 머지 차단 경로

자기수정 시스템의 최대 위험: 나쁜 사이클이 롤백·헬스·배포·가드 코드 자체를 수정해 안전망을 제거하는 것. 다음 경로를 건드리는 PR은 **무인 모드에서도 자동 머지 차단 → `needs-human` 라벨 + 머지 보류**:

```
.github/workflows/**                  # CI·배포 파이프라인
apps/cron/**                          # 온프렘 실행기·롤백 로직
scripts/autopilot/**                  # autopilot 자체 코드
docs/superpowers/specs/*autopilot*    # 이 설계 문서
.env* / **/secrets/**                 # 시크릿
docker-compose.yml                    # 운영 compose
apps/dashboard/src/app/api/health/**  # 헬스체크 (롤백 판정 기준)
**/schema.ts / drizzle/**             # DB 마이그레이션 (prod 오염 위험)
```

- 후보 스키마의 `protectedPathTouch` / `dbMigration` 플래그로 라운드 1부터 표시 → 점수 페널티.
- **DB 마이그레이션 후보는 무인 머지에서 항상 제외** (prod DB 오염 사고 이력). 선정돼도 `needs-human`.

### 5.2 무인 배포 시퀀스

```
main 머지 → GHA(ci.yml)가 ghcr.io/krdn/gons-dashboard:latest 빌드·push
                              │
온프렘 deploy-watcher가 5분 주기 폴링:
  1. ghcr의 새 digest 감지 (현재 running digest와 비교)
  2. 배포 전 현재 digest를 last-known-good.json에 기록 ★ (롤백 보장)
  3. docker --context home-server compose pull app
  4. compose up -d --no-deps app           (Gotcha — postgres recreate 방지)
  5. 헬스 게이트 (최대 90초 폴링):
       · GET /api/health == {"status":"ok"}
       · 핵심 라우트 smoke: /login(200), /stocks(200), /api/cron/*(401)
  6a. 통과 → deploy-log 기록 + 성공 푸시 알림
  6b. 실패 → 자동 롤백:
       · last-known-good digest로 compose up -d --no-deps app
       · 재-헬스체크
       · GitHub 이슈 자동 생성(실패 로그 첨부) + 긴급 web-push 알림
       · 다음 사이클까지 해당 SHA 배포 차단 (중복 롤백 방지)
```

★ 메모리의 "배포≠빌드성공", "compose recreate 비밀번호 drift", "prod env 실종" 사고를 모두 가드.

### 5.3 안전 승격 경로 (첫 가동)

처음부터 무인 배포로 직행하지 않는다:
- **1~2주차: shadow 모드** — 전체 사이클 돌되 PR만 생성, 머지·배포 안 함. consensus 품질을 사람이 검수하며 프롬프트 튜닝.
- **3주차~: autonomous** — 검증되면 `AUTOPILOT_MODE=autonomous`로 전환, 완전 무인 머지·배포.
- 모드는 환경변수 한 줄로 토글. 사고 시 즉시 shadow로 강등.

### 5.4 사람 작업 충돌 규칙

- autopilot 브랜치는 항상 최신 main에서 분기.
- PR 머지 직전 main과 rebase 충돌 검사 → 충돌이면 자동 머지 보류(`needs-human`).
- 레포 루트에 `.autopilot-pause` 파일 존재 시 사이클 skip (수동 일시정지 스위치).

## 6. 파일 구조

```
scripts/autopilot/                      # autopilot 코어 (protected path)
├── cycle.workflow.js                   # 메인 Workflow 스크립트 (리서치→토론→구현→PR)
├── schemas.js                          # CANDIDATE / CROSS_REVIEW / VERDICT JSON 스키마
├── experts/                            # 전문가 프롬프트 (5개 .md)
│   ├── dependency-security.md
│   ├── code-architect.md
│   ├── product-strategist.md
│   ├── trend-researcher.md
│   └── ux-designer.md
├── protected-paths.json                # 무인 머지 차단 경로 목록
└── README.md                           # 운영 가이드

apps/cron/                              # 온프렘 배포 실행기 (protected path)
├── scheduler.js                        # (기존) — autopilot deploy-watcher 등록 추가
└── autopilot/
    ├── deploy-watcher.js               # ghcr digest 폴링 + 배포·검증·롤백
    ├── health-gate.js                  # /api/health + smoke test
    └── last-known-good.json            # 롤백용 good digest (gitignore)

docs/superpowers/
├── specs/2026-06-02-gons-autopilot-design.md   # 이 문서
└── plans/2026-06-02-gons-autopilot-plan.md     # 구현 계획 (writing-plans 단계)

autopilot-log.json                      # 사이클 이력 (append-only)
backlog.json                            # 미선정 후보 누적 (재경쟁 + dedup)
```

## 7. 상태 저장 (모두 git-tracked, append-only)

- **`autopilot-log.json`** — 사이클별: 날짜(ISO-8601 KST `+09:00`), 사이클 ID(`autopilot-YYYYMMDD-HHmmss`), 후보 수, 토론 요약, 선정 후보, PR URL, 머지/배포/롤백 결과. `/gon:evolve`의 evolution-log 패턴 차용.
- **`backlog.json`** — 미선정 후보 누적 (다음 주 재경쟁 + dedupKey로 중복 방지).
- **`last-known-good.json`** — 롤백 기준 digest (온프렘, gitignore). 필드: `{ digest, recordedAt(ISO-8601 KST), deployedSha }`.

## 8. 관측 & 제어 (사람의 개입 지점)

무인이지만 "지금 뭘 하는지/했는지"는 투명해야 한다:
- **매주 요약 알림**: 사이클 끝나면 web-push + GitHub 이슈로 "이번 주 선정/구현/배포 결과 + 다음 후보 top3" 발송.
- **`.autopilot-pause`**: 레포 루트에 파일 있으면 사이클 skip.
- **`AUTOPILOT_MODE`**: `shadow`(PR만) / `autonomous`(무인 배포) 토글.

## 9. 구현 순서 (검증 가능한 단계)

| # | 단계 | 검증 |
|---|------|------|
| 1 | 스펙·계획 문서 작성 + 커밋 | 파일 존재, 사람 리뷰 승인 |
| 2 | 스키마 + 전문가 프롬프트 5개 | 스키마 valid, 프롬프트 dry-run 1회 |
| 3 | cycle.workflow.js (리서치+토론) | shadow 1회 → 후보·토론·선정 로그 정상 |
| 4 | 구현 페이즈 + PR 생성 로직 | 더미 후보로 PR 생성 + 게이트 통과 |
| 5 | protected-paths 가드 + dedup | 보호경로 후보가 needs-human 받는지 |
| 6 | 온프렘 deploy-watcher + health-gate | 수동 트리거: 배포→health→의도적 실패→롤백 재현 |
| 7 | /schedule 주간 cron 등록 | cron 1회 발화 → 전체 사이클 e2e |
| 8 | shadow 2주 → autonomous 승격 | 사람 검수 후 모드 전환 |

6번(롤백 재현)과 8번(shadow 검수)이 무인 배포 전 필수 관문이다.

## 10. 범위 외 (YAGNI)

- 사이클 이력 대시보드 위젯 — autopilot이 스스로 만들 첫 후보가 될 수 있으므로 초기 범위에서 제외.
- 멀티 후보 동시 처리 — D4에 따라 주당 1건 집중.
- HMAC cron 토큰 업그레이드 — TODOS #1, autopilot 범위 외.
