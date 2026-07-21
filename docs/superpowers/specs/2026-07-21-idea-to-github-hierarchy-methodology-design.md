# 구상 → GitHub 계층 단계화 방법론 + `gon:plan-issues` 스킬 설계 스펙

- 날짜: 2026-07-21
- 유형: 방법론 정립 + 재사용 스킬 신설
- 사용자 결정:
  - 단계화 축 = **수직 슬라이스 우선** (DB→UI 관통, 작은 범위, 빠른 배포)
  - GitHub 전체 기능 활용 (**Projects v2 도입** 포함)
  - 산출물 = 대화 설명 + **레포 문서**로 저장 + **스킬화**
  - 스킬 범위 = **조직화 전용 단일 스킬** (캐처·완료기록 비포함)
  - 스킬 모델 = **상위 모델 상속** (model 미명시)
  - Projects 세팅 = **이 spec 확정 후** 수행
- 선행 정리: `gon:save-issue`·`gon:todo` 스킬 삭제 (`~/.claude/_archive/2026-07-21-deleted-skills/` 백업) — 새 스킬과의 니치 중복 제거

---

## 0. 결론 요약

- **문제**: 이 레포는 구상을 이슈로 옮길 때 두 가지 규모 패턴(단건 spec 1개 / #323형 umbrella)을 쓰지만, 큰 구상의 "Phase 분해"를 **이슈 본문 텍스트로만** 표현한다. GitHub의 계층 기능(sub-issues·issue types·Projects)이 이미 사용 가능한데도 미활용이라, 진행률·의존성·단계 전환을 **사람이 손으로 추적**한다.
- **핵심 전환**: "텍스트 Phase" → **GitHub 네이티브 계층 객체**. umbrella 이슈(sub-issues 100개·8단계 중첩) + issue type(Feature/Task, 도메인 라벨과 직교) + Projects v2(Status 필드 + "닫으면 자동 Done" 자동화)로, 단계 발전이 구현의 부수효과로 일어나게 한다.
- **방법론의 축**: 각 단계 = **수직 슬라이스** = 배포 가능한 최소 가치. 슬라이스 하나 = sub-issue 하나 = spec/plan 하나 = PR 하나.
- **자동화 지점**: 이 방법론을 `gon:plan-issues` 스킬로 캡슐화 — 구상을 받아 갭분석→슬라이스 분해→GitHub 계층 생성까지 자동. 상세 구현(spec/plan)은 기존 `brainstorming → writing-plans` 파이프라인으로 인계.

---

## 1. 현재 상태 진단 (근거)

### 이미 있는 자산 (재사용 대상)

| 자산 | 위치 | 방법론에서의 역할 |
|---|---|---|
| 이슈 트래커 컨벤션 (제목/본문 규칙, 트리아지 라벨) | `docs/agents/issue-tracker.md`, `triage-labels.md` | 이슈 생성 규범 — 그대로 계승 |
| umbrella 이슈 "설계 기준 문서" 패턴 | #323 본문 (0. 결론 → 1. 갭분석 표 → Phase 분해) | **재사용 자산 표 + 빠진 축** 구조를 스킬이 자동 생성 |
| spec/plan 파이프라인 | `docs/superpowers/specs/`, `plans/` | 슬라이스별 상세화 인계처 |
| brainstorming → writing-plans 스킬 | superpowers 플러그인 | 각 sub-issue의 상세 설계 담당 |
| 도메인 라벨 (email/stock/saju/infra) | GitHub 레포 라벨 | issue type과 **직교**하게 유지 |

### 빠진 것 (이 방법론이 채우는 것)

1. **sub-issues 미사용** — #323은 텍스트 Phase. `POST /repos/{owner}/{repo}/issues/{parent}/sub_issues` (payload: `{sub_issue_id: <database id, number 아님>}`) 로 계층화 가능하나 안 씀. 진행률 자동 집계·Projects parent 그룹핑 손실.
2. **issue types 미설정** — org 레벨 404. Task/Bug/Feature 기본형 미생성. 라벨에 성격이 뒤섞임.
3. **Milestone 0개** — 릴리스/기간 묶음 없음.
4. **Projects v2 미연결** — 토큰에 `project` scope 없음. 보드 없음 → Status/단계 추적 수동.
5. **구상 캡처 지점 부재** — 날것 구상을 담을 곳이 없어 바로 정식 이슈로 만들어짐(레포 오염).

---

## 2. 방법론 — 5단계 파이프라인

```
① 구상 캡처     → Projects draft issue (레포 오염 없이 아이디어 보관)
② 갭 분석+재사용 → umbrella 이슈 본문에 "재사용 자산 표 + 빠진 축" (#323 강점 계승)
③ 수직 슬라이스  → 각 슬라이스 = sub-issue 1개 = 배포 가능한 최소 가치
④ 계층 생성     → umbrella(type:Feature) + sub-issues(type:Task) + Milestone + Projects
⑤ 실행 인계     → 각 sub-issue → brainstorming/writing-plans → 구현 → PR → 이슈 종료 → 자동 Done
```

> **실측 정정 (2026-07-21 PR 이력 분석)**: 이 레포는 60개 PR 중 2건만 `Closes/Fixes`
> 자동 종료 키워드를 쓰고, 나머지는 제목의 참조 전용 `(#NNN)` + 수동 종료다. 회피
> 이유는 auto-merge가 Codex 리뷰 완료를 앞질러 미봉책을 main에 유입시킨 레이스(#302→#303,
> #315→#316)로 추정된다. 그래서 방법론은 이 워크어라운드를 제도화하지 않고 **근본**을
> 규칙으로 삼는다 — "Codex APPROVED 전 auto-merge 금지"(§8). Projects의 "이슈 닫힘 →
> Done" 자동화는 이슈가 **어떻게 닫히든** 성립하므로, `Closes` 키워드 유무와 무관하게
> 진행률 자동 충전은 유지된다.

### GitHub 객체 매핑

| 관심사 | GitHub 객체 | 명령/API |
|---|---|---|
| 구상 큰 그림 | umbrella 이슈 + Milestone(선택) | `gh issue create`, `gh api .../milestones` |
| Phase/슬라이스 | sub-issues (100개·8단계) | `gh api .../issues/{parent}/sub_issues -F sub_issue_id=<id>` (⚠️ `-F` 정수 — `-f` 문자열은 HTTP 422) |
| 무엇의 성격 | issue type (Feature/Task/Bug) | `gh api .../orgs/krdn/issue-types` (조회). `gh issue create`는 `--type` 미지원 → 라벨 폴백 또는 graphql |
| 어느 도메인 | 라벨 (기존 유지) | `gh issue edit --add-label` |
| 단계 상태 | Projects Status 필드 | `gh project item-edit` |
| 단계 발전 | "닫으면 자동 Done" 내장 자동화 | Projects 워크플로 (기본 on) |
| 순서·의존성 | 본문 `Depends on #N` + Projects 커스텀 필드 | 본문 텍스트 |

### 핵심 원리

- **구상을 날것으로 정식 이슈화하지 않는다** — ①에서 Projects draft로 잡아, 슬라이스가 확정되면 정식 이슈로 승격(convert to issue).
- **②갭분석을 이슈화 전에 넣는다** — "이미 있는 뼈대 중 뭘 확장하나"를 먼저 적어 슬라이스 범위를 최소로 깎는다. #323이 강력했던 이유.
- **단계 발전은 부수효과** — sub-issue가 닫히면(`Closes` 키워드든 수동 종료든) → Projects "닫힘→Done" 자동화 → umbrella 진행률 자동 충전. 사람이 상태를 옮기지 않는다.

---

## 2.5. 실증 근거 — 재작업은 어디서 오는가 (2026-07-21 삼중 분석)

세 독립 소스(merged PR 60개 · spec 62/plan 53 · 프로젝트 메모리 120건)를 병렬 분석한
결과가 **같은 결론으로 수렴**했다. 이 방법론의 모든 체크포인트는 이 데이터에 앵커링된다.

- **feat의 약 30%가 즉시 fix를 유발** (6개 클러스터: #268→#274, #294→#297/#298,
  #299→#300, #302→#303, #324→#326, #330→#331). 원인은 "구현 실수"가 아니라
  **이슈/spec 단계에 수용조건이 없어서** — 전부 좌측이동(shift-left) 가능.
- **재작업을 가장 많이 막은 것은 정교한 구조가 아니라 값싼 관찰 가능한 게이트 한 줄**.
  `Gotcha #7`("PR 전 `pnpm build` 1회")이 spec/plan에서 **67회 재인용** — 코퍼스 최다.
- **최강 spec 요소 = "착수 전 실측"**. monitoring phase3/4는 설계를 *쓰기 전에* 운영
  서버를 프로브해 설계를 뒤엎었다(sudoers 안 → `NoNewPrivileges` 실측 → 전면 전환).
- **무손실 인계 장치 = plan의 Self-Review 표** (Spec coverage 표 + 회귀 가드 대응표).
- **배포 함정 8건이 단일 근본원인으로 수렴**: 운영 `.env`/`compose`가 git-미동기 정적
  파일 + 명시 나열 → 새 env·시크릿·digest가 조용히 drift.
- **"값 조정" fix는 재수정 위험, "불변식" fix는 종결** (reason-length 이중수정 교훈:
  #144 max(80) → #145 제약 자체 제거).

### 방법론이 스스로에게 적용하는 원칙 (advisor 교정)

위 발견("값싼 게이트 + 작은 표면 + 실측이 이긴다")은 **이 방법론 자신에게도 적용**된다.
과잉설계를 막는 방법론이 스스로 과잉설계되면 자기모순이다. 따라서:

- 스킬 SKILL.md는 **~100줄 이내**, 주입 체크리스트는 **TOP 7 이내**.
- 모든 게이트는 `[명령] → [기대 관찰값] → [실패 시 의미]` 형식.
- 새 축적기(METHODOLOGY.md 무한 append)를 짓지 않는다 — **진화 = 두꺼워짐이 아니라 수렴**(§9).
- 스킬에 파일 경로·카운트 같은 stale 값을 리터럴로 박지 않고 **런타임 스캔**으로 주입.

---

## 2.6. 수용조건 템플릿 — `gon:plan-issues`가 각 슬라이스에 주입하는 TOP 7

실증 TOP 7. 각 슬라이스(sub-issue) 본문에 해당되는 항목만 수용조건으로 자동 삽입한다.
관련 없는 항목은 넣지 않는다(작은 표면 원칙).

| # | 체크포인트 | 게이트 형식 `[명령]→[관찰값]→[실패 의미]` | 트리거 조건 |
|---|---|---|---|
| 1 | **신규 env/시크릿 = 4곳 동기화** | `docker exec <c> env \| grep <KEY>` → 값 출력 → 없으면 compose environment 블록 누락(부팅 실패) | env 변수·비번 회전 추가 시 |
| 2 | **CI success ≠ 배포** | 배포 후 digest 일치 + `/api/health`=ok + 보호 route≠404 + restarts=0 | 배포를 수반하는 모든 슬라이스 |
| 3 | **비가역 액션 = 별도 try + 자동클릭 금지** | 발송/삭제 뒤 bookkeeping 실패해도 ok 반환하는 테스트 → 통과 → 없으면 double-send 위험 | 발송·결제·삭제·외부 I/O |
| 4 | **스키마 변경 = DDL 운영 psql 선적용→이미지** | `to_regclass('<obj>')` 대조 → 존재 확인 → 카운터 추론 금지 | drizzle 스키마 변경 시 |
| 5 | **server/client seam = server.ts/client.ts 분리** | `cd apps/dashboard && pnpm build` → 성공 → 실패 시 client가 server-only import(Gotcha #7) | features/entities barrel 신설·변경 |
| 6 | **로컬 green 불신** | 새 테스트 단일 경로 실행 → "N passed" 눈으로 확인 → "0 passed"면 include 밖 조용한 skip | 테스트 추가 시 |
| 7 | **리뷰=Codex 게이트 + 순수함수 테스트** | Codex APPROVED → 받고 → **APPROVED 전 auto-merge 금지**(레이스 차단) | 모든 슬라이스 병합 전 |

---

## 3. 수직 슬라이스 경계 규칙

슬라이스 하나(sub-issue 하나)는 다음을 **모두** 만족해야 한다:

1. **관통성**: DB(있으면)→entity→feature→widget→UI까지 한 줄로 관통해, 배포 시 화면/동작에 **관찰 가능한 변화**가 있다.
2. **독립 배포성**: 다른 슬라이스가 미완이어도 이 슬라이스만으로 PR·배포·롤백이 가능하다.
3. **단일 PR 크기**: 리뷰 가능한 1 PR로 끝난다. 넘치면 더 쪼갠다.
4. **명시적 의존성**: 선행 슬라이스가 필요하면 본문에 `Depends on #N`. 순환 의존 금지.

**자르지 말아야 할 곳** (안티패턴):
- 수평 레이어로 자르기 ("스키마만" / "UI만") — 중간 슬라이스에 사용자 가치가 없음. (단, 대규모 데이터 모델이 먼저 확정돼야 하는 예외는 umbrella 본문에 근거를 적고 선행 슬라이스로 명시.)
- 한 슬라이스에 다중 도메인 섞기 — 라벨·리뷰 경계가 흐려짐.

### 3.1 슬라이스 분해 전 필수 두 가지 (실증 최강 요소)

1. **착수 전 실측** (코퍼스 최강 요소, monitoring phase3/4 근거) — 운영 환경/외부 시스템/
   코드베이스에 의존하는 구상은, 슬라이스를 자르기 *전에* 실제 값을 프로브한다. 프로브
   결과를 umbrella 본문 "0.5 착수 전 실측" 표에 적고, 그 사실이 **설계를 어떻게 바꿨는지**
   기록. 프로브 불가 시 "가정 명시"로 대체(#331 Redis maxmemory 미검증 단정 교훈).
2. **불변식 자문** (reason-length 이중수정 교훈) — 각 슬라이스에 대해 "이 값 제약/필드가
   핵심 결과를 전부-아니면-전무로 무효화하는가?"를 자문. 값 조정(max 40→80)이 아니라
   구조(스키마 분리·판별 유니온)를 바꿔야 종결되는 케이스를 조기 식별.

---

## 4. `gon:plan-issues` 스킬 설계

### 4.1 니치 (삭제된 스킬과의 관계)

- 삭제됨: `gon:todo`(로컬 backlog.json 캐처), `gon:save-issue`(완료 후 커밋→푸시→이슈).
- 신설: `gon:plan-issues` — **작업 시작 전** 구상을 GitHub 계층으로 조직·단계화. 생애주기의 서로 다른 지점이라 중복 아님.
- 범위 경계: 조직화까지만. 각 sub-issue의 상세 spec/plan·구현은 기존 `brainstorming → writing-plans` 파이프라인이 담당.

### 4.2 프론트매터 (기존 gon: 스킬 컨벤션 정합)

```yaml
name: gon:plan-issues
description: 구상을 GitHub 계층(umbrella + sub-issues + Projects)으로 조직·단계화하는 스킬.
  갭분석→수직슬라이스 분해→이슈 계층 생성까지 자동화. "/gon:plan-issues", "구상 이슈화",
  "이슈로 쪼개줘", "단계 나눠줘", "로드맵 만들어줘", "sub-issue 만들어줘" 요청 시 사용.
argument-hint: "[구상 텍스트 | --single | --umbrella | --dry-run]"
context: fork
allowed-tools: [Bash, Read, Write, Edit, Grep, Glob, AskUserQuestion, WebFetch]
# model 미명시 → 세션 모델 상속 (갭분석은 코드 추론 필요, haiku 부족)
```

### 4.3 실행 흐름 (스킬 본문 골격)

1. **scope 사전 점검**: `gh auth status`로 `project` scope 확인. 없으면 → `gh auth refresh -s project` 안내(사용자 액션 `!` 명령) 후 중단/대기.
2. **규모 분기** (결정 트리):
   - `--single` 또는 소규모 판정 → 이슈 1개 + Projects 항목 추가. umbrella/sub 없음. (오버헤드 최소)
   - `--umbrella` 또는 대규모 판정 → full 계층.
3. **① 구상 캡처**: 구상 텍스트를 Projects draft로 (`gh project item-create`).
4. **② 갭 분석**: 코드베이스 스캔(Grep/Glob/Read) → "재사용 자산 표 + 빠진 축" 생성 → umbrella 본문 초안.
5. **③ 슬라이스 분해**: §3 규칙으로 자름. 각 슬라이스에 `Depends on` + 불변식 자문(§3.1) 표시.
6. **④ 계층 생성 (승인 게이트 우선 — 비가역)**: 계획을 먼저 텍스트로 출력 → `--dry-run`이면
   여기서 종료(GitHub 객체 0 생성) → 아니면 AskUserQuestion 승인 → **승인 후에만** draft·이슈·Projects
   생성. 구상의 Projects draft 캡처(①)도 이 승인 뒤에 수행한다. 생성 시:
   - issue type 조회 실패는 삼키지 않음 — 404(미설정)만 라벨 폴백, 401/5xx는 알림.
   - **단건**: 이슈 1개 + 라벨 + Projects 항목(sub·Milestone 생략).
   - **umbrella**: umbrella 이슈 → sub-issue들 → `sub_issues` API 연결(`-F` 정수 id 변환) → Milestone·라벨·Projects.
7. **⑤ 인계 출력**: 생성된 계층 요약 + 각 sub-issue에 "이 이슈는 `/brainstorming`으로 상세화하세요" 안내.

### 4.4 삭제된 스킬에서 흡수할 좋은 패턴

- `save-issue`의 **민감파일 필터**(env/key/pem) — draft 승격·본문 작성 시 시크릿 유출 방지.
- `save-issue`의 **라벨 안전 추가**(존재 확인 후 add, 실패 무시) 패턴.
- `save-issue`의 **에러 처리 표**(auth/권한/scope) — Projects scope·issue type 권한 케이스 추가.
- `todo`의 **프로젝트 루트 판별**(`git rev-parse --show-toplevel`).

### 4.5 스킬 파일 구조

```
~/.claude/skills/gon:plan-issues/
├── SKILL.md              # 실행 지시서 (<100줄 목표, 넘으면 분할)
├── REFERENCE.md          # sub_issues API·gh project 명령·결정 트리 상세 (선택)
└── scripts/
    └── link-sub-issue.sh # number→database id 변환 + sub_issues POST (결정적 연산)
```

`link-sub-issue.sh`는 결정적 연산(number→id 변환, API 호출)이라 스크립트로 분리 — 매번 생성하는 것보다 신뢰성↑, 토큰↓.

---

## 5. Projects v2 세팅 (spec 확정 후 수행)

1. `gh auth refresh -s project` (사용자 액션 — `!` 명령으로).
2. `gh project create --owner krdn --title "gons-dashboard roadmap"`.
3. Status 필드 확인(기본: Todo/In Progress/Done) + 필요 시 커스텀 필드(Domain, Slice order).
4. 내장 자동화 확인: "이슈 닫힘 → Done", "PR 머지 → Done" (기본 on).
5. `gh project link` 로 레포 연결.
6. (선택) Auto-add 워크플로: 특정 라벨 이슈 자동 편입.

---

## 6. 테스트 / 검증 전략

- **스킬 dry-run**: `--dry-run`으로 실제 이슈 생성 없이 계획(umbrella 제목·슬라이스 목록·라벨·의존성)만 출력.
- **슬라이스 경계 자체 검증**: 각 슬라이스가 §3의 4조건을 만족하는지 스킬이 체크리스트로 확인 후 사용자에게 표시.
- **멱등성**: 이미 존재하는 이슈/계층에 재실행 시 중복 생성하지 않도록 title 매칭 가드.
- **scope 부재 처리**: `project` scope 없을 때 명확히 안내하고 계층 이슈까지는 진행(Projects만 skip).

---

## 7. 규모별 결정 트리 (요약)

```
구상 규모?
├─ 단건 (파일 몇 개, 1 PR로 끝)        → 이슈 1개 + spec/plan 1개. Projects 항목만 추가.
│                                        umbrella·sub-issue 안 만듦 (오버헤드 회피).
└─ 큰 구상 (다중 도메인 / 여러 슬라이스) → umbrella(Feature) + sub-issues(Task)
                                          + Milestone + Projects 보드 full.
```

경계 판정 기준: **수직 슬라이스가 2개 이상 나오면 umbrella**. 1개면 단건.

---

## 8. 완료 게이트 + auto-merge 규칙 (재작업·레이스 차단)

각 슬라이스가 "완료"로 선언되려면 아래를 순서대로 통과한다. 이건 §2.6 TOP 7의 병합 시점 적용이다.

1. **로컬 게이트**: `pnpm typecheck && pnpm lint` (둘 다 — lint가 seam·purity 위반 담당) →
   `cd apps/dashboard && pnpm build` (Gotcha #7) → 새 테스트 단일 경로 "N passed" 확인.
2. **Server Action 변경 시**: dev 서버 dogfood smoke (build가 `"use server"` 런타임
   ReferenceError를 못 잡음).
3. **Codex 리뷰 게이트**: `~/.claude/scripts/codex-review.sh`로 정적 리뷰 → **APPROVED**.
4. **⚠️ auto-merge 규칙**: **Codex APPROVED를 받기 전에는 auto-merge를 걸지 않는다.**
   실증(#302→#303, #315→#316)상 auto-merge가 리뷰 완료를 앞질러 미봉책을 main에 유입시킨
   레이스가 반복됐다. APPROVED 후에만 `gh pr merge --auto` 또는 수동 머지.
5. **PR 본문**: `Closes #<sub-issue>` + spec/plan 경로 역링크(추적성). 이슈 닫힘 → Projects
   자동 Done → umbrella 진행률 자동 충전.
6. **배포 검증**(배포 수반 시): §2.6 #2 4종 사후검증.

## 9. 자기진화 — 회고를 기존 채널로 수렴시킨다

**요구**: 이 방식으로 한 작업이 쌓이며 방법론이 계속 업그레이드된다. **원칙**(advisor 교정):
새 무한-축적기를 짓지 않는다. 진화 = 두꺼워짐이 아니라 **수렴**. 실증상 가장 효과적인
아티팩트는 이미 존재한다 — `CLAUDE.md` Gotcha 카탈로그(#7×67, #2×33)와 hookify block.

### 회고 트리거 & 3신호 수집

umbrella가 완료되면(모든 sub-issue Done) 스킬이 회고를 유도해 3신호를 수집한다:
1. **feat→fix 쌍** — `gh pr list`에서 이 umbrella 관련 feat 직후 fix를 찾아 "첫 배포가
   놓친 것" 1줄. (재작업 계보)
2. **spec의 "사용자 결정" + "착수 전 실측이 뒤엎은 설계"** — 확정된 판단.
3. **feedback 메모리** — 이번 작업에서 얻은 "일하는 방식" 교정.

### 라우팅 규율 (가지치기 포함)

수집된 각 교훈을 **성격에 따라 기존 채널로 라우팅**한다. 새 문서에 쌓지 않는다:

| 교훈 성격 | 라우팅 목적지 | 승격 조건 |
|---|---|---|
| **반복되는(≥2회) 구조적 함정** | `CLAUDE.md` Gotcha 카탈로그 (번호 부여) | 2회 이상 재발 확인 시 |
| **모델까지 강제할 반복 사고** | hookify `permissionDecision: deny` block | warn으로 안 되는 물리 차단 필요 시 |
| **일회성 시점 관측** | 프로젝트 메모리 (memory/*.md) | 재사용 가치 있으나 반복 아님 |
| **도메인 어휘 변화** | `CONTEXT.md` | 새 개념·용어 확정 시 |
| **§2.6 TOP 7을 바꿀 프로세스 교훈** | **이 spec §2.6 표** (cap + prune) | 아래 규율 |

### §2.6 TOP 7의 cap + prune 규율

- **cap**: TOP 7은 항상 **최대 7개**. 8번째가 들어오면 가장 덜 재발한 항목을 CLAUDE.md
  Gotcha로 강등(삭제 아님, 이동).
- **prune**: hookify block으로 물리 차단된 항목은 TOP 7에서 제거(중복 방어 불필요).
- 이 규율이 "진화 = 수렴"을 강제한다. 표가 커지려 하면 그 자체가 안티패턴 신호.

이로써 루프가 닫힌다: 회고 → 기존 채널 수렴 → 다음 구상의 `gon:plan-issues`가 CLAUDE.md
Gotcha + §2.6 TOP 7을 런타임 스캔해 주입 → 재작업 좌측이동. **문서가 진화하면 스킬 동작이
자동 진화**한다(주입 소스가 곧 진화 대상).

---

## 10. 추가 제안 (실증에서 도출)

방법론의 효과를 높이는 보조 장치. 채택 여부는 사용자 판단:

1. **umbrella 이슈 = "설계 기준 문서"로 운영** (#323 강점 성문화) — 본문에 "이 이슈를
   읽어와 Phase 1부터 착수하라"는 진입 지시를 넣어 이슈→구현 연결을 사람 개입 없이 성립.
2. **`--dry-run` 기본 권장** — 실제 이슈 생성 전 계획(umbrella 제목·슬라이스 목록·의존성·
   주입될 수용조건)만 출력해 사용자 승인. 잘못된 계층의 비가역 생성 방지.
3. **plan Self-Review 표 강제** (무손실 인계 결정적 장치) — 각 슬라이스가 writing-plans로
   갈 때 "Spec coverage 표 + 회귀 가드 대응표"를 plan 필수 섹션으로. spec→plan 유실 차단.
4. **hookify 게이트 후보**: "Codex APPROVED 없이 `gh pr merge --auto`" 감지 시 warn —
   auto-merge 레이스를 도구 레벨에서 물리 차단(§8.4의 규칙을 코드화).
