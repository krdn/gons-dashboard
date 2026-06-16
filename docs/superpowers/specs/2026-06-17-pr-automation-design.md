# PR 자동화 (라벨러 + 자동 병합) — 설계 문서

작성일: 2026-06-17
브랜치: (구현 시 `feat/pr-automation`)
범위: PR 파일경로 자동 라벨링 + CI green 조건 자동 병합

## 1. 배경 & 목표

현재 PR 처리는 전부 수동이다 — 라벨 부여, CI 확인, 병합 모두 사람이 한다.
자동화 인프라 선례는 `auto-update-llm-gateway.yml`(라이브러리 업데이트 자동 PR) 하나뿐이고,
branch protection·auto-merge·labeler·CODEOWNERS는 없다.

**목표**: ① PR에 파일경로 기반 도메인 라벨 자동 부여, ② CI 통과 시 자동 병합.

**범위 밖 (의도적 제외)**: self-hosted runner 기반 Claude PR 리뷰 — 위험·노력 최대인데
산출물은 정보성 코멘트뿐이고, 로컬 `/code-review`·subagent 리뷰가 이미 더 강하게 대체한다.
필요 시 별도 spec.

## 2. 사실 확인 (설계 전제 — 검증 완료)

이 설계는 다음 검증된 사실 위에 선다:

1. **main push ≠ 운영 배포.** CI의 `docker` 잡은 ghcr에 이미지 **build+push만** 하고 멈춘다
   (`ci.yml:111-160`). 실제 배포는 사람이 `docker --context home-server compose pull/up`을 수동 실행.
   워크플로에 ssh/compose/deploy 자동화 없음. → **자동 병합 = 자동 이미지 빌드이지 자동 배포 아님.
   사람의 수동 deploy가 안전 체크포인트로 남는다.**
2. **CI는 이미 test+build를 돈다.** `lint-typecheck` 잡이 lint → typecheck → db:migrate →
   **test → build (sanity)**까지 수행 (`ci.yml`). PR #140이 이 전체를 green 통과 (eval Layer 1 16건 포함).
   → "CI에 테스트 추가" 작업 불필요.
3. **레포 설정**: squash 머지 허용됨, **auto_merge 현재 비활성(켜야 함)**, delete_branch_on_merge 비활성,
   **main branch protection 없음(새로 생성)**.
4. **CI 잡 status check 이름**: `Lint & Type Check` (jobs.lint-typecheck.name). branch protection의
   required check 이름은 정확히 이것이어야 한다 — 틀리면 영영 머지 안 됨.

## 3. 아키텍처 — 2개 독립 조각

```
.github/
├── labeler.yml                  # (a) 경로 → 라벨 매핑
└── workflows/
    ├── labeler.yml              # (a) actions/labeler 호출
    └── auto-merge.yml           # (b) native auto-merge 활성화
```

+ 레포 설정 변경 (gh api, 코드 아님): branch protection 생성 + auto_merge·delete_branch 활성화.

| | (a) 파일경로 라벨러 | (b) 자동 병합 |
|---|---|---|
| 트리거 | `pull_request_target` | `pull_request` (opened/ready_for_review/synchronize/reopened) |
| 게이트 | 없음 (라벨만) | 기존 CI(`Lint & Type Check`) green |
| 머지 주체 | — | **GitHub native auto-merge** (워크플로 GITHUB_TOKEN 아님) |
| 위험 | 0 (코드 실행 없음) | 낮음 (배포는 수동 체크포인트) |

## 4. (a) 파일경로 라벨러

### 4.1 `.github/labeler.yml`

`actions/labeler@v5` 형식 (v5는 `changed-files`/`any-glob-to-any-file` 구조):

```yaml
email:
  - changed-files:
      - any-glob-to-any-file:
          - "apps/dashboard/src/**/email*/**"
          - "apps/dashboard/src/**/*email*"
saju:
  - changed-files:
      - any-glob-to-any-file:
          - "packages/saju/**"
          - "apps/dashboard/src/**/saju*/**"
stock:
  - changed-files:
      - any-glob-to-any-file:
          - "packages/stock-analysis/**"
          - "apps/dashboard/src/**/stock*/**"
infra:
  - changed-files:
      - any-glob-to-any-file:
          - "apps/dashboard/src/**/docker/**"
          - "apps/dashboard/src/**/container*/**"
          - "apps/dashboard/src/**/host*/**"
          - "docker-compose.yml"
mcp:
  - changed-files:
      - any-glob-to-any-file:
          - "packages/mcp-*/**"
          - "packages/shared-*/**"
ci:
  - changed-files:
      - any-glob-to-any-file:
          - ".github/**"
docs:
  - changed-files:
      - any-glob-to-any-file:
          - "docs/**"
          - "**/*.md"
```

### 4.2 `.github/workflows/labeler.yml`

```yaml
name: PR Labeler
on:
  pull_request_target:
    types: [opened, synchronize, reopened]
permissions:
  contents: read
  pull-requests: write
jobs:
  label:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/labeler@v5
        with:
          sync-labels: true
```

- `pull_request_target`: fork PR에도 라벨 권한 부여. 라벨러는 PR 코드를 실행하지 않으므로 안전
  (base 컨텍스트의 workflow·labeler.yml만 사용).
- `sync-labels: true`: 경로 안 맞으면 라벨 자동 제거 + 레포에 없는 라벨 자동 생성.

## 5. (b) 자동 병합

### 5.1 레포 설정 (gh api — 코드 아님, 구현 시 1회 실행)

```bash
# auto_merge + delete_branch_on_merge 활성화
gh api -X PATCH repos/krdn/gons-dashboard \
  -F allow_auto_merge=true -F delete_branch_on_merge=true

# main branch protection: CI green만 required (review 불요 = 전면 자동)
gh api -X PUT repos/krdn/gons-dashboard/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["Lint & Type Check"] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}
JSON
```

- `contexts: ["Lint & Type Check"]` — 정확한 CI 잡 name (§2.4).
- `required_pull_request_reviews: null` — 사람 승인 불요 (사용자 결정: 전면 자동, CI green=병합).
- `enforce_admins: false` — 긴급 시 admin 수동 병합 가능 (탈출구).
- `strict: true` — 머지 전 base 최신 반영 요구.

### 5.2 `.github/workflows/auto-merge.yml`

```yaml
name: Auto-merge
on:
  pull_request:
    types: [opened, ready_for_review, reopened, synchronize]
permissions:
  contents: write
  pull-requests: write
jobs:
  enable-auto-merge:
    runs-on: ubuntu-latest
    # draft 제외 + fork 제외 (본인 PR만)
    if: >-
      github.event.pull_request.draft == false &&
      github.event.pull_request.head.repo.full_name == github.repository
    steps:
      - name: Enable native auto-merge
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: gh pr merge --auto --squash "${{ github.event.pull_request.number }}"
        # 'gh pr merge --auto'는 GitHub native auto-merge를 켤 뿐 직접 머지하지 않는다.
        # 실제 머지는 GitHub이 CI green 시 수행 → main push가 docker-build 워크플로를 정상 트리거.
```

### 5.3 트리거 함정 (핵심)

워크플로가 `GITHUB_TOKEN`으로 **직접** 머지하면, 그 push는 docker-build 워크플로를
**트리거하지 않는다** (GitHub의 토큰-루프 방지). 그러면 PR은 머지되는데 이미지가 안 빌드된다.
→ `gh pr merge --auto`로 **native auto-merge를 켜기만** 하고, 실제 머지는 GitHub이 수행하게 한다.
native 머지는 GitHub 계정 attribution이라 push 워크플로가 정상 발동.

## 6. 에러 처리 / 엣지

| 상황 | 처리 |
|---|---|
| Draft PR | `if: draft == false` 가드 → 건너뜀. ready 표시 시 발동 (= 머지 약속) |
| Fork PR | `head.repo.full_name == github.repository` 가드 → 제외 |
| CI 실패 | native auto-merge가 대기 → green 안 되면 머지 안 함. PR 열린 채 유지 |
| 이미 auto-merge 켜진 PR | `gh pr merge --auto` idempotent → no-op |
| required check 이름 불일치 | 영영 머지 안 됨 → §2.4 정확한 이름(`Lint & Type Check`) 사용 |
| 긴급 수동 개입 | `enforce_admins: false`라 admin이 protection 우회 머지 가능 |

## 7. 검증 (YAML 설정이라 실제 동작 검증)

1. **라벨러**: 워크플로 머지 후 PR #140(eval 파일 = ci/docs/email 경로)에 재트리거 →
   `ci`/`docs`/`email` 라벨 자동 부여 확인.
2. **자동 병합 end-to-end**: 사소한 검증 PR을 draft로 열고 → ready 표시 → CI green 후
   자동 머지 확인. **그리고 main push가 docker-build를 트리거하는지 확인** (native 머지 핵심 검증).
3. **branch protection**: `gh api .../branches/main/protection`로 설정 확인, required check 이름 일치.

## 8. 롤백

- 자동 병합 문제 시: `gh api -X PATCH ... -F allow_auto_merge=false` 또는 auto-merge.yml 비활성화.
- branch protection 제거: `gh api -X DELETE .../branches/main/protection`.
- 모두 즉시 가역, 코드 변경 없음.

## 9. 보안

- 라벨러 `pull_request_target`은 코드 실행 없음 + base 컨텍스트 → fork 악용 불가.
- 자동 병합은 본인 non-fork PR만 (fork 가드). GITHUB_TOKEN 권한 최소 (contents/pull-requests).
- 시크릿 커밋 없음 (전부 GitHub 제공 토큰).

## 10. 성공 기준

1. PR 생성 시 도메인 라벨 자동 부여.
2. non-draft 본인 PR이 CI green 시 자동 squash 병합 + 브랜치 자동 삭제.
3. 자동 병합 후 main push가 docker-build 워크플로 정상 트리거 (이미지 빌드됨).
4. draft PR·CI 실패 PR은 자동 병합 안 됨.
