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
⑤ 실행 인계     → 각 sub-issue → brainstorming/writing-plans → 구현 → PR(Closes #) → 자동 Done
```

### GitHub 객체 매핑

| 관심사 | GitHub 객체 | 명령/API |
|---|---|---|
| 구상 큰 그림 | umbrella 이슈 + Milestone(선택) | `gh issue create`, `gh api .../milestones` |
| Phase/슬라이스 | sub-issues (100개·8단계) | `gh api .../issues/{parent}/sub_issues -f sub_issue_id=<id>` |
| 무엇의 성격 | issue type (Feature/Task/Bug) | `gh api .../orgs/krdn/issue-types`, 이슈 생성 시 `-f type=` |
| 어느 도메인 | 라벨 (기존 유지) | `gh issue edit --add-label` |
| 단계 상태 | Projects Status 필드 | `gh project item-edit` |
| 단계 발전 | "닫으면 자동 Done" 내장 자동화 | Projects 워크플로 (기본 on) |
| 순서·의존성 | 본문 `Depends on #N` + Projects 커스텀 필드 | 본문 텍스트 |

### 핵심 원리

- **구상을 날것으로 정식 이슈화하지 않는다** — ①에서 Projects draft로 잡아, 슬라이스가 확정되면 정식 이슈로 승격(convert to issue).
- **②갭분석을 이슈화 전에 넣는다** — "이미 있는 뼈대 중 뭘 확장하나"를 먼저 적어 슬라이스 범위를 최소로 깎는다. #323이 강력했던 이유.
- **단계 발전은 부수효과** — sub-issue를 `Closes #N`로 닫으면 → Projects 자동 Done → umbrella 진행률 자동 충전. 사람이 상태를 옮기지 않는다.

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
5. **③ 슬라이스 분해**: §3 규칙으로 자름. 각 슬라이스에 `Depends on` 표시.
6. **④ 계층 생성**:
   - issue type 없으면 생성 안내(org 권한 필요) 또는 라벨 폴백.
   - umbrella 이슈 생성(type:Feature) → sub-issue들 생성(type:Task) → `sub_issues` API로 연결(database id 변환) → Milestone·라벨·Projects 추가.
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
