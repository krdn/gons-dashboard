# `gon:plan-issues` 스킬 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **✅ 구현 완료 (2026-07-21).** 이 계획은 실행됐고 스킬이 배포됐다(`~/.claude/skills/gon:plan-issues/`,
> repo `krdn/gon-claude`). **진실 소스는 배포된 스킬 파일**이다 — Codex 2라운드 리뷰(APPROVED)로
> 아래 예시 이후 반영된 변경이 있다: ① `link-sub-issue.sh`의 `sub_issue_id`는 `-F`(정수) 전송
> (`-f` 문자열은 HTTP 422) + 멱등 GET `--paginate` + 정수 가드(Task 1 코드 반영됨). ② SKILL.md
> 4단계는 A(계획)→B(dry-run 종료)→C(승인 게이트)→D(단건/umbrella 분리 생성)로 재구성(Task 3 반영됨).
> ③ REFERENCE.md는 issue-type 조회 실패를 삼키지 않고(404만 라벨 폴백) TOP 7 표를 "spec §2.6 캐시
> 스냅샷(원본=spec, 런타임 재읽기)"으로 명시 — 이 세부는 **배포된 REFERENCE.md를 정본**으로 본다.

**Goal:** 구상을 받아 갭분석→수직슬라이스 분해→GitHub 계층(umbrella + sub-issues + Projects) 생성까지 자동화하는 조직화 전용 스킬을 만든다.

**Architecture:** `~/.claude/skills/gon:plan-issues/` 디렉토리에 SKILL.md(실행 지시서, ~100줄) + REFERENCE.md(상세 명령·결정트리) + scripts/link-sub-issue.sh(결정적 연산: number→database id 변환 + sub_issues POST). 스킬은 프롬프트 기반이라 "테스트"는 스크립트의 셸 단위 검증 + dry-run 스모크로 한다.

**Tech Stack:** Markdown(SKILL.md/REFERENCE.md), Bash(gh CLI, jq), GitHub REST API(sub_issues, issue-types).

## Global Constraints

- **설계 스펙**: `docs/superpowers/specs/2026-07-21-idea-to-github-hierarchy-methodology-design.md` (커밋 f4807ed). 모든 §참조는 이 문서.
- **스킬 위치**: `~/.claude/skills/gon:plan-issues/` (프로젝트 레포 밖, 글로벌 스킬).
- **얇게 유지 (advisor 교정)**: SKILL.md ~100줄 이내, 주입 체크리스트 TOP 7 이내. 넘으면 안티패턴 신호.
- **stale 값 금지**: 파일 경로·카운트·이슈 번호를 SKILL.md에 리터럴로 박지 않는다. Gotcha·TOP 7은 **런타임 스캔**으로 주입 (CLAUDE.md·spec §2.6를 읽어서).
- **프론트매터 컨벤션**: 기존 gon: 스킬 정합 — `context: fork`, 한국어 트리거, `<CRITICAL>` 실행 지시서 톤. **model 미명시**(세션 상속 — 갭분석은 코드 추론 필요, haiku 부족).
- **gh 실측 제약 (2026-07-21, gh 2.45.0)**:
  - `gh issue create`는 `--type` 미지원 → issue type은 `gh api graphql` 또는 라벨 폴백.
  - sub_issue 연결은 **database id** 필요(`{sub_issue_id: <id>}`), `gh issue create`는 number만 반환 → id 조회 2단계.
  - `project` scope 없으면 `gh project` 전부 실패 → 스킬이 사전 감지 후 안내.
- **시크릿 금지**: 이슈 본문 작성 시 env/key/pem 값 유출 방지(삭제된 save-issue의 민감파일 필터 패턴 흡수).
- **검증**: 스크립트는 `bash -n`(구문) + dry-run 실행. 실제 이슈 생성은 사용자 승인 후에만.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `~/.claude/skills/gon:plan-issues/SKILL.md` | 실행 지시서 — 5단계 흐름, 규모 분기, scope 사전점검. ~100줄. |
| `~/.claude/skills/gon:plan-issues/REFERENCE.md` | 상세 — TOP 7 주입 방식, sub_issues API, gh project 명령, 결정 트리, 에러 표. |
| `~/.claude/skills/gon:plan-issues/scripts/link-sub-issue.sh` | 결정적 연산 — parent number + child number → child database id 조회 → sub_issues POST. 멱등. |

---

## Task 1: 스킬 디렉토리 + 결정적 스크립트 (link-sub-issue.sh)

**Files:**
- Create: `~/.claude/skills/gon:plan-issues/scripts/link-sub-issue.sh`

**Interfaces:**
- Produces: `link-sub-issue.sh <owner/repo> <parent_number> <child_number>` — child의 database id를 조회해 parent의 sub_issues에 POST. 이미 연결돼 있으면 멱등(중복 방지). 성공 시 `linked <child> -> <parent>` 출력, 실패 시 non-zero exit.

- [ ] **Step 1: 스크립트 작성**

```bash
#!/usr/bin/env bash
# parent 이슈에 child 이슈를 sub-issue로 연결 (멱등).
# 사용법: link-sub-issue.sh <owner/repo> <parent_number> <child_number>
set -euo pipefail

REPO="${1:?owner/repo required}"
PARENT="${2:?parent issue number required}"
CHILD="${3:?child issue number required}"

for n in "$PARENT" "$CHILD"; do
  case "$n" in ''|*[!0-9]*) echo "error: 이슈 번호는 양의 정수여야 함: '$n'" >&2; exit 1;; esac
done

# child 의 database id 조회 (sub_issues API 는 number 가 아닌 id 를 요구)
CHILD_ID=$(gh api "repos/${REPO}/issues/${CHILD}" --jq '.id')
case "$CHILD_ID" in ''|*[!0-9]*) echo "error: child #${CHILD} database id 조회 실패(값='$CHILD_ID')" >&2; exit 1;; esac

# 이미 연결돼 있으면 skip (멱등). GET 을 조건식 밖에서 실행해 실패를 삼키지 않음.
# --paginate 로 100개 초과 sub-issue 도 전부 조회 (설계상 최대 100).
EXISTING=$(gh api --paginate "repos/${REPO}/issues/${PARENT}/sub_issues" --jq '.[].number')
if printf '%s\n' "$EXISTING" | grep -Fqx -- "$CHILD"; then
  echo "already-linked ${CHILD} -> ${PARENT}"
  exit 0
fi

# -F (typed field): sub_issue_id 는 integer 를 요구 — -f(string) 는 HTTP 422 로 거부됨
gh api --method POST "repos/${REPO}/issues/${PARENT}/sub_issues" \
  -F "sub_issue_id=${CHILD_ID}" >/dev/null
echo "linked ${CHILD} -> ${PARENT}"
```

> **⚠️ 리뷰 반영 (Codex)**: sub_issue_id 는 `-F`(정수)로 보낸다 — `-f`(문자열)는 HTTP 422
> "not of type integer" 로 거부됨(임시 이슈 end-to-end 로 실측). 멱등 GET 은 조건식 밖에서
> 실행(실패 삼킴 방지)하고 `--paginate`로 전량 조회, PARENT·CHILD·CHILD_ID 정수 가드 필수.

- [ ] **Step 2: 실행 권한 + 구문 검증**

Run: `chmod +x ~/.claude/skills/gon:plan-issues/scripts/link-sub-issue.sh && bash -n ~/.claude/skills/gon:plan-issues/scripts/link-sub-issue.sh && echo SYNTAX-OK`
Expected: `SYNTAX-OK` (구문 오류 없음)

- [ ] **Step 3: 인자 누락 시 실패 확인 (가드 동작)**

Run: `~/.claude/skills/gon:plan-issues/scripts/link-sub-issue.sh 2>&1 | head -1; echo "exit=$?"`
Expected: `owner/repo required` 류 메시지 + non-zero (set -u 가드 동작)

- [ ] **Step 4: 커밋** (스킬은 글로벌이라 별도 git이 없으면 이 step은 skip — 홈 dotfiles가 git이면 커밋)

```bash
cd ~/.claude 2>/dev/null && git rev-parse --git-dir >/dev/null 2>&1 \
  && git add skills/gon:plan-issues/scripts/link-sub-issue.sh \
  && git commit -m "feat(skill): gon:plan-issues link-sub-issue 스크립트" \
  || echo "홈 dotfiles git 아님 — 커밋 skip"
```

---

## Task 2: REFERENCE.md (상세 — 런타임 주입 소스·API·결정 트리)

**Files:**
- Create: `~/.claude/skills/gon:plan-issues/REFERENCE.md`

**Interfaces:**
- Consumes: Task 1의 `link-sub-issue.sh`.
- Produces: SKILL.md가 참조하는 상세 문서. TOP 7 주입 방식·gh 명령 카탈로그·에러 표를 담아 SKILL.md를 얇게 유지.

- [ ] **Step 1: REFERENCE.md 작성**

> **⚠️ 발췌본 주의**: 아래 코드펜스는 초기 초안이며 Codex 리뷰로 개선된 부분이 있다
> (issue-type 조회는 HTTP 404만 라벨 폴백하고 401/5xx는 중단, 명령 카탈로그에 단건·중복방지
> 항목 추가, TOP 7 표는 "spec §2.6 캐시 스냅샷" 명시). **정본은 배포된
> `~/.claude/skills/gon:plan-issues/REFERENCE.md`** — 이 예시를 그대로 복사하지 말 것.

````markdown
# gon:plan-issues — 상세 레퍼런스

## TOP 7 수용조건 주입 (런타임 스캔)

각 슬라이스(sub-issue) 본문에 삽입할 수용조건은 **하드코딩하지 않고** 다음을 런타임에 읽어 구성한다:
- 프로젝트 spec `docs/superpowers/specs/2026-07-21-idea-to-github-hierarchy-methodology-design.md` §2.6 표
- `CLAUDE.md` Gotcha 카탈로그 (해당 슬라이스에 관련된 항목만)

슬라이스 성격별로 관련 항목만 넣는다(작은 표면 원칙). 매핑:
| 슬라이스가 건드리는 것 | 주입할 수용조건 |
|---|---|
| env/시크릿 추가 | #1 4곳 동기화 |
| 배포 수반 | #2 CI success≠배포 (digest/health/route≠404/restarts=0) |
| 발송·삭제·외부 I/O | #3 비가역=별도 try+자동클릭 금지 |
| drizzle 스키마 | #4 DDL psql 선적용 (to_regclass 대조) |
| features/entities barrel | #5 server/client 분리 + pnpm build |
| 테스트 추가 | #6 단일 경로 "N passed" 확인 |
| (전체) 병합 전 | #7 Codex APPROVED 전 auto-merge 금지 |

게이트 형식은 항상 `[명령] → [기대 관찰값] → [실패 시 의미]`.

## GitHub 계층 생성 명령 카탈로그

```bash
# 1. issue type — gh issue create 는 --type 미지원. 라벨 폴백 또는 graphql.
#    org issue-types 존재 확인. ★HTTP 상태 실판별: 404(미설정)만 라벨 폴백,
#    401/5xx 등 실제 오류는 삼키지 말고 중단 (배포된 REFERENCE.md 가 정본):
# --include 로 상태줄+본문을 한 번에 받아 재조회 없이 처리(2차 호출 실패 무시 방지).
# 상태는 에러 텍스트가 아니라 실제 HTTP 상태 코드(상태줄 3자리)로 분기.
RESP=$(gh api --include /orgs/krdn/issue-types 2>&1)
CODE=$(printf '%s\n' "$RESP" | sed -n 's#^HTTP/[0-9.]* \([0-9]\{3\}\).*#\1#p' | head -1)
TYPES=""   # ★case 진입 전 초기화 — 어떤 폴백 경로(404·기타)든 이전 시도의 stale 값을 물려받지 않음
case "$CODE" in
  200) # 헤더/본문 경계(첫 빈 줄) 이후 본문만 떼어 그 자리서 파싱 — 재조회 없음.
       # jq -e: 빈 본문·malformed·빈 배열이면 non-zero → 200이라도 타입을 못 뽑았으면 라벨 폴백.
       BODY=$(printf '%s\n' "$RESP" | awk 'f{print} /^\r?$/{f=1}')
       if TYPES=$(printf '%s' "$BODY" | jq -e -r '.[].name'); then
         : # $TYPES 확보 → 이슈에 지정
       else
         TYPES=""   # jq 부분 출력 후 실패 시 부분값이 남지 않도록 명시 무효화
         echo "issue-types 200 이나 본문이 비었거나 malformed(타입 0) → 라벨 폴백(type:feature/type:task)" >&2
       fi ;;
  404) echo "issue-types 미설정(404) → 라벨 폴백(type:feature/type:task)" >&2 ;;
  *)   echo "issue-types 조회 실패(HTTP ${CODE:-?}) — 인증·네트워크 확인 후 중단" >&2; exit 1 ;;
esac

# 2. umbrella 이슈 생성 (본문 파일로)
gh issue create --repo krdn/gons-dashboard --title "<제목>" --body-file /tmp/umbrella.md

# 3. sub-issue 생성 후 연결 (Task 1 스크립트)
CHILD=$(gh issue create --repo krdn/gons-dashboard --title "<슬라이스>" --body-file /tmp/slice.md | grep -oP '\d+$')
~/.claude/skills/gon:plan-issues/scripts/link-sub-issue.sh krdn/gons-dashboard <PARENT> "$CHILD"

# 4. Milestone (선택)
gh api repos/krdn/gons-dashboard/milestones -f title="<릴리스>" 2>/dev/null

# 5. Projects — project scope 필요
gh project item-add <PROJECT_NUM> --owner krdn --url <issue_url>
```

## Projects 세팅 (최초 1회)

```bash
gh auth refresh -s project                                  # 사용자 액션 (! 명령)
gh project create --owner krdn --title "gons-dashboard roadmap"
gh project link <NUM> --owner krdn --repo gons-dashboard
# 내장 자동화 "이슈 닫힘 → Done" 은 기본 on — 별도 설정 불필요
```

## 완료 게이트 + auto-merge 규칙 (spec §8)

병합 전: typecheck+lint 둘 다 → `cd apps/dashboard && pnpm build` → 새 테스트 "N passed" →
Server Action 변경 시 dev dogfood smoke → **Codex APPROVED** → APPROVED **후에만** auto-merge.

## 에러 처리

| 상황 | 감지 | 조치 |
|---|---|---|
| project scope 없음 | `gh auth status`에 `project` 없음 | `gh auth refresh -s project` 안내(사용자 `!` 명령). 계층 이슈까지는 진행, Projects만 skip |
| issue-types 미설정 | `/orgs/krdn/issue-types` 404 | 라벨 폴백(`type:feature`/`type:task`) |
| sub_issues 연결 실패 | 스크립트 non-zero | parent/child number 확인, id 조회 실패 시 이슈 존재 확인 |
| 중복 계층 재실행 | title 매칭 | 기존 이슈 있으면 재생성 말고 링크만 |
````

- [ ] **Step 2: 파일 존재 + 핵심 섹션 확인**

Run: `grep -cE '^## ' ~/.claude/skills/gon:plan-issues/REFERENCE.md`
Expected: `5` 이상 (TOP 7 주입 / 명령 카탈로그 / Projects 세팅 / 완료 게이트 / 에러 처리)

- [ ] **Step 3: 커밋** (홈 dotfiles git이면)

```bash
cd ~/.claude 2>/dev/null && git rev-parse --git-dir >/dev/null 2>&1 \
  && git add skills/gon:plan-issues/REFERENCE.md \
  && git commit -m "docs(skill): gon:plan-issues REFERENCE" \
  || echo "커밋 skip"
```

---

## Task 3: SKILL.md (실행 지시서, ~100줄)

**Files:**
- Create: `~/.claude/skills/gon:plan-issues/SKILL.md`

**Interfaces:**
- Consumes: Task 1(스크립트), Task 2(REFERENCE.md).
- Produces: 스킬 진입점. `/gon:plan-issues` 트리거 시 로드되는 실행 지시서.

- [ ] **Step 1: SKILL.md 작성**

```markdown
---
name: gon:plan-issues
description: 구상을 GitHub 계층(umbrella + sub-issues + Projects)으로 조직·단계화하는 스킬. 갭분석→수직슬라이스 분해→이슈 계층 생성까지 자동화. "/gon:plan-issues", "구상 이슈화", "이슈로 쪼개줘", "단계 나눠줘", "로드맵 만들어줘", "sub-issue 만들어줘" 요청 시 사용.
argument-hint: "[구상 텍스트 | --single | --umbrella | --dry-run]"
context: fork
allowed-tools: [Bash, Read, Write, Edit, Grep, Glob, AskUserQuestion, WebFetch]
---

# 구상 → GitHub 계층 단계화 (gon:plan-issues)

<CRITICAL>
이 문서는 실행 지시서다. 구상을 GitHub 계층으로 **조직화**만 한다.
상세 spec/plan·구현은 하지 않는다 — 그건 brainstorming→writing-plans 파이프라인 담당.
방법론 근거: docs/superpowers/specs/2026-07-21-idea-to-github-hierarchy-methodology-design.md
</CRITICAL>

## 0단계: scope 사전 점검

`gh auth status`로 `project` scope 확인. 없으면 사용자에게 `! gh auth refresh -s project`
안내(계층 이슈까지는 진행, Projects만 skip). 프로젝트 루트는 `git rev-parse --show-toplevel`.

## 1단계: 구상 수집 + 규모 판정

구상 텍스트를 받는다($ARGUMENTS 또는 대화). 시크릿(env/key/pem 값)이 섞였으면 제거.
`--dry-run` 여부를 **여기서 먼저 판정**한다 — dry-run이면 이후 어떤 GitHub 객체(draft·이슈·Projects 항목)도 만들지 않고 4단계에서 계획만 출력한다.
**규모 판정**: 갭분석 후 수직 슬라이스가 **2개 이상이면 umbrella**, 1개면 단건.
`--single`/`--umbrella`로 강제 가능. (구상의 Projects draft 캡처는 4단계 승인 후 수행 — 여기서 만들지 않는다.)

## 2단계: 갭 분석 (이슈화 전 필수)

Grep/Glob/Read로 코드베이스를 스캔해 "재사용 자산 표(자산│위치│역할) + 빠진 축"을 만든다.
운영/외부 의존 구상은 **착수 전 실측**(spec §3.1) — 실제 값 프로브 후 "설계를 바꾼 사실" 기록.

## 3단계: 수직 슬라이스 분해

각 슬라이스가 4조건 만족: ①DB→UI 관통(관찰 가능한 변화) ②독립 배포성 ③단일 PR ④명시 의존성.
수평 레이어("스키마만"/"UI만")·다중 도메인 혼합 금지. 선행 필요 시 `Depends on #N`.
각 슬라이스에 **TOP 7 중 관련 항목만** 수용조건으로 주입 (REFERENCE.md 매핑, 런타임 스캔).
각 슬라이스에 **불변식 자문**(spec §3.1): "이 값 제약/필드가 핵심 결과를 전부-아니면-전무로 무효화하는가?" — 값 조정이 아니라 구조를 바꿔야 할 케이스 조기 식별.

## 4단계: 계층 생성 (승인 게이트 우선 — 비가역)

**A. 계획 출력** — 만들 것을 먼저 텍스트로 보여준다: umbrella 제목/단건 이슈 제목, 슬라이스(sub-issue) 목록, 주입될 수용조건, 라벨·Milestone·Projects 여부, 의존성.

**B. dry-run이면 여기서 종료** — `--dry-run`은 A까지만 하고 GitHub 객체를 하나도 만들지 않는다.

**C. 승인 게이트** — dry-run이 아니면 A 결과를 AskUserQuestion으로 승인받는다. **승인 전에는 draft·이슈·Projects 항목을 하나도 만들지 않는다.**

**D. 승인 후 생성** (REFERENCE.md 명령 카탈로그대로):
- **단건(--single/슬라이스 1개)**: 이슈 1개 생성 → 도메인 라벨 + issue type(있으면)/라벨 폴백 + (scope 있으면)Projects 항목. **sub-issue 연결·Milestone은 생략.**
- **umbrella(슬라이스 2개 이상)**:
  1. umbrella 이슈 생성(본문=재사용표+갭분석+슬라이스 목록, "이 이슈 읽어 Phase 1부터 착수" 진입 지시).
  2. 각 슬라이스 sub-issue 생성 → `scripts/link-sub-issue.sh`로 연결.
  3. 도메인 라벨 + issue type/라벨 폴백 + Milestone(선택) + (scope 있으면)Projects 항목 추가.

## 5단계: 인계 출력

생성된 계층 요약 + 각 sub-issue에 "`/brainstorming`으로 상세화 → writing-plans" 안내.
umbrella 완료 후 회고→기존 채널 라우팅은 spec §9 참조.

## 상세

명령 카탈로그·TOP 7 주입 매핑·Projects 세팅·에러 표: [REFERENCE.md](REFERENCE.md).
```

- [ ] **Step 2: 줄 수 확인 (얇게 유지 — Global Constraint)**

Run: `wc -l ~/.claude/skills/gon:plan-issues/SKILL.md`
Expected: 100줄 이하 (넘으면 상세를 REFERENCE.md로 이동)

- [ ] **Step 3: 프론트매터 유효성 + description 트리거 확인**

Run: `head -6 ~/.claude/skills/gon:plan-issues/SKILL.md | grep -E 'name:|description:|argument-hint:'`
Expected: 3줄 모두 출력 (name/description/argument-hint 존재)

- [ ] **Step 4: 커밋** (홈 dotfiles git이면)

```bash
cd ~/.claude 2>/dev/null && git rev-parse --git-dir >/dev/null 2>&1 \
  && git add skills/gon:plan-issues/SKILL.md \
  && git commit -m "feat(skill): gon:plan-issues SKILL 실행 지시서" \
  || echo "커밋 skip"
```

---

## Task 4: 스킬 로드 스모크 검증 (실제 이슈 생성 없이)

**Files:** (없음 — 검증 전용)

**Interfaces:**
- Consumes: Task 1·2·3 전부.

- [ ] **Step 1: 스킬이 목록에 인식되는지 확인**

Run: `ls ~/.claude/skills/gon:plan-issues/ && echo "---" && ls ~/.claude/skills/gon:plan-issues/scripts/`
Expected: `SKILL.md  REFERENCE.md` + `link-sub-issue.sh`

- [ ] **Step 2: dry-run 경로 스모크 — scope 감지 동작 확인**

Run: `gh auth status 2>&1 | grep -oE "'project'|Token scopes.*" | head -1`
Expected: `project` scope 유무가 출력됨 (스킬 0단계가 이 판정을 씀 — 없으면 안내 경로, 있으면 Projects 경로)

- [ ] **Step 3: link 스크립트 멱등성 실검증 (읽기 전용 — 기존 #323에 이미 붙은 게 없음 확인)**

Run: `gh api repos/krdn/gons-dashboard/issues/323/sub_issues --jq 'length'`
Expected: `0` (아직 sub 없음 — 스크립트가 새로 연결할 때 중복 아님을 보장하는 baseline)

- [ ] **Step 4: 최종 커밋** (홈 dotfiles git이면 — 스모크는 파일 변경 없어 no-op일 수 있음)

```bash
echo "스모크 검증 완료 — 스킬 3파일 배치·scope 감지·멱등 baseline 확인"
```

---

## Self-Review

**1. Spec coverage** (spec §4 스킬 설계 → task 매핑):
- §4.2 프론트매터 → Task 3 Step 1 ✓
- §4.3 5단계 실행 흐름 → Task 3 Step 1 (0~5단계) ✓
- §4.4 삭제 스킬 패턴 흡수(민감파일 필터) → Task 3 1단계 시크릿 제거 ✓
- §4.5 파일 구조(SKILL/REFERENCE/scripts) → Task 1·2·3 ✓
- §2.6 TOP 7 주입 → Task 2 REFERENCE 매핑 표 + Task 3 3단계 ✓
- §8 완료 게이트+auto-merge → Task 2 REFERENCE ✓
- §5 Projects 세팅 → Task 2 REFERENCE ✓
- §9 자기진화 → Task 3 5단계에서 spec §9 참조(스킬 범위 밖이라 링크만) ✓
- gh 실측 제약(--type 미지원, database id) → Global Constraints + Task 1 스크립트 ✓

**2. Placeholder scan**: TBD/TODO 없음. 모든 스크립트·명령 실체 포함 ✓

**3. Type consistency**: `link-sub-issue.sh <owner/repo> <parent> <child>` 시그니처가 Task 1 정의 ↔ Task 2 카탈로그 ↔ Task 4 검증에서 일치 ✓

갭 없음.
