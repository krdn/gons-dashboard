# GitHub 기능이 gon+Claude 협업에 실제로 도움이 되는가 — 실측 분석

- 날짜: 2026-07-21
- 유형: 연구 리포트 (우리 실측 기반)
- 질문: "기능 추가·수정을 처리할 때 GitHub Issues·Actions·Wiki·Discussions·Projects 등 모든 기능을 활용하면 협업이 향상되는가?"
- 방법: 이 레포의 실제 사용 흔적(git 458커밋·PR 227·이슈 114·Actions 5워크플로·라벨·Wiki/Discussions/Projects 활성 여부)을 계량하고, 이미 정립된 우리 협업 방법론 문서·메모리와 대조. 웹 일반론이 아니라 **이 레포에서 무엇이 실제로 쓰였나**가 근거.

---

## 0. 결론 요약 (TL;DR)

**"모든 기능을 켜자"는 틀린 질문이다.** 실측이 주는 답은 명확하다: gon+Claude 협업에서 기능의 가치는 하나의 렌즈로 갈린다 —

> **에이전트가 git tree / `gh` CLI로 직접 닿을 수 있는가, 그리고 사람이 손으로 하던 추적을 줄여주는가? 아니면 에이전트가 못 닿는 곳으로 컨텍스트를 파편화시키는가?**

이 렌즈로 판정하면:

| 기능 | 판정 | 한 줄 근거 |
|---|---|---|
| **PR + CI** | 🟢 이미 척추 | PR 227건(223 머지)·CI 13× green. 모든 작업이 이미 여기를 통과. 진짜 협업 축. |
| **Issues (설계 기준 문서형)** | 🟢 고가치, 저활용 | #323 같은 umbrella 이슈가 durable 작업 명세로 강력. 그러나 실제 그렇게 쓴 건 극소수. |
| **Actions (CI/배포)** | 🟢 필수 | lint→test→build→Docker push. 없으면 배포 불가. |
| **Actions (auto-merge/labeler)** | 🟡 정교하나 양날 | auto-merge가 리뷰를 앞지르는 레이스를 반복 유발(메모리 4건). |
| **Actions (auto-update-llm-gateway)** | 🟢 실사용 확인 | 릴리스 감지→자동 PR. 2회 실행(성공 1). 의존성 유지보수 자동화. |
| **Actions (CI 안의 Claude)** | 🔴 실사용 0 | `@claude` 멘션 트리거 — 15번 실행 전부 skip. 인프라만 하드닝, 워크플로 모델 불일치. |
| **Labels / Triage** | 🟡 부분 유효 | 도메인 라벨은 유효. 트리아지 라벨(`ready-for-agent` 등)은 3건만 사용. |
| **Milestones** | ⚪ 미사용, 니치 약함 | 0개. 개인 단일 개발자라 릴리스 기간 묶음의 필요가 약함. |
| **Wiki** | 🔴 켜졌으나 빈 껍데기 | `has_wiki:true`지만 실제 페이지 0(clone "not found"). `docs/`가 이미 그 역할. |
| **Discussions** | 🔴 미사용, 구조적 부적합 | 0건. 비동기 다자 토론 도구인데 협업자가 2명(1인+에이전트)이라 니치 없음. |
| **Projects v2** | 🟡 잠재 고가치, 미도입 | scope 미보유로 미연결. 단계 추적을 자동화할 유일한 후보 — 단, 오버헤드 주의. |

**핵심 통찰 3가지:**

1. **이미 답의 절반은 구축돼 있다.** PR+CI+Codex 리뷰 게이트가 협업의 척추다. "새 기능을 더 켜면 나아지나"의 답은 대체로 "아니오, 이미 핵심은 돌고 있다"이다.
2. **"켜짐"과 "쓰임"은 다르다.** Wiki·CI-안-Claude는 켜져 있지만 안 쓰인다. 기능 존재가 곧 가치가 아니다 — **워크플로 모델에 맞아야** 가치가 된다.
3. **에이전트가 못 닿는 곳은 함정이다.** Wiki(별도 git repo)·Discussions(API로만)는 컨텍스트를 에이전트 시야 밖으로 흩뜨린다. 반대로 `docs/`·Issues·PR은 에이전트가 매 세션 읽고 쓰는 표면이라 협업을 증폭한다.

---

## 1. 실측 데이터 (2026-07-21 기준)

레포 생성 2026-05-08 → 약 2.5개월. 전량 최근 3개월 내 활동(458커밋 전부).

```
커밋       458   (feat 179 / fix 112 / docs 86 / refactor 36 / chore 21 / ci 8 / test 4 …)
PR         227   (MERGED 223, CLOSED 4)  → 거의 모든 변경이 PR을 통과
이슈       114   (전부 CLOSED)
  ├ automated+chore 라벨: 101건  ← 비활성화된 auto-issue 훅의 잡음 ("~변경 (자동 생성)")
  ├ 임시검증(#336~341):    6건   ← plan-issues sub-issue 검증 잔재 (정리 후보)
  └ 사람이 만든 실질 이슈:   ~7건  (#323 #333 #145 #143 #133 #307 #309)
Actions    5 워크플로 (ci / auto-merge / labeler / claude-llm / auto-update-llm-gateway)
  ├ CI:          13× success
  ├ claude-llm:  15× skipped (전부)  ← @claude 멘션 없음
  ├ auto-merge:   1× success
  ├ labeler:      1× success
  └ auto-update-llm-gateway: 2× (성공 1·실패 1, 2026-07-12) ← repository_dispatch 실사용
Wiki         has_wiki:true 이지만 wiki.git = "Repository not found" → 페이지 0
Discussions  has_discussions:true 이지만 discussions = 0건
Projects     has_projects:true 이지만 토큰에 read:project scope 없음 → 미연결·미사용
Milestones   0개 (측정: gh api .../milestones → length 0)
Closes키워드  227 PR 중 Closes/Fixes/Resolves #N 사용: 4건 (나머지는 참조 전용 (#N) + 수동 종료)
```

**가장 중요한 방법론적 관측: "활성 플래그"와 "실제 사용"을 절대 혼동하지 말 것.**
Wiki·Discussions·Projects 모두 레포 설정상 `true`지만, 실제 콘텐츠는 0이다. GitHub UI에서 탭이 보인다고 그 기능이 협업에 기여하는 건 아니다.

---

## 2. 이미 답이 나온 축 — Issues + Projects (기존 spec 인용)

Issues의 계층화(sub-issue)와 Projects를 통한 단계 추적은 **이번에 새로 연구할 필요가 없다**. 2026-07-21 같은 날 작성된 spec이 삼중 실증 분석으로 이미 답했다:

> **참조**: [`docs/superpowers/specs/2026-07-21-idea-to-github-hierarchy-methodology-design.md`](../superpowers/specs/2026-07-21-idea-to-github-hierarchy-methodology-design.md)
> 근거 소스: merged PR 60개 · spec 62/plan 53 · 프로젝트 메모리 120건 (병렬 분석, 같은 결론 수렴)

그 spec의 판정을 요약하면:

- **umbrella 이슈("설계 기준 문서"형, #323 패턴)는 고가치다.** 갭분석 표 + Phase 분해를 담은 이슈는 에이전트가 매 세션 읽어와 착수하는 durable 명세가 된다. 실제로 관제 시스템(#323)이 이 방식으로 8단계·6PR을 무리 없이 굴렸다.
- **그러나 sub-issue·issue-type·Milestone은 미활용**이었고, Phase를 이슈 본문 텍스트로만 표현해 진행률·의존성·단계 전환을 사람이 손으로 추적했다. `gon:plan-issues` 스킬이 이 갭을 자동화하도록 설계됨.
- **Projects v2는 "단계 발전을 구현의 부수효과로" 만드는 유일한 후보** — "이슈 닫힘 → 자동 Done" 내장 자동화. 단 아직 scope 미보유로 미도입.

**이 리포트의 기여는 그 spec이 다루지 않은 나머지 축**(Actions·Wiki·Discussions·Milestones·Labels)에 집중한다.

---

## 3. 기능별 심층 판정 (delta 분석)

각 기능을 §0의 렌즈로 통과시킨다.

### 3.1 🟢 PR + CI — 이미 협업의 척추 (가장 정직한 답)

사용자가 나열한 화려한 기능들이 아니라, **이미 돌고 있는 이것이 진짜 답**이다.

- **227 PR / 223 머지.** 458커밋 중 거의 전부가 PR 경로. 즉 우리 협업은 이미 "브랜치 → PR → CI green → 리뷰 → 머지" 파이프라인 위에 있다.
- **CI(`ci.yml`)가 심장**: `pnpm install → @krdn/saju build → lint → typecheck → db:migrate → test → build → (main push 시) Docker 빌드·GHCR 푸시`. 메모리의 "배포 검증 4단계", "CI success ≠ 배포"가 전부 이 파이프라인 위에서 성립.
- **에이전트 접근성 만점**: 나(Claude)는 `gh pr create`, `gh run watch`, `gh pr checks`로 이 축을 직접 조작·관측한다. 사람 추적 오버헤드를 대폭 줄인다.

**판정: 새로 켤 것 없음. 이미 최적 활용 중.** 개선 여지는 "PR 본문에 `Closes #N` 일관 사용"(실측: 전체 227 PR 중 4건만) 정도 — 그러면 이슈 자동 종료·Projects 자동 Done과 연결된다. 나머지는 제목 참조 전용 `(#N)` + 수동 종료다(회피 이유는 §3.3b auto-merge 레이스).

### 3.2 🟢 Issues — "설계 기준 문서"로 쓸 때만 고가치

- **강점(실측)**: #323처럼 갭분석+Phase를 담은 umbrella 이슈는 에이전트에게 완벽한 진입점이다. "이 이슈를 읽고 Phase 1부터 착수하라"가 성립한다. #133·#143·#145 같은 버그 이슈도 재현조건·근본원인을 담아 durable했다.
- **약점(실측)**: **114개 이슈 중 101개가 자동 생성 잡음**이었다. 커밋마다 이슈를 만드는 훅(`precommit-auto-issue-hook`, 메모리에 "7개 레포 rename 비활성" 기록)이 레포를 오염시켰고 이미 비활성화됨. → **교훈: 이슈는 "사람이 의도를 담아 만든 것"만 가치. 자동 양산은 순수 잡음.**
- **에이전트 접근성**: `gh issue view/create/edit`로 완전 접근. 컨텍스트 파편화 없음.

**판정: 🟢 — 단, "설계 기준 문서" 규율로만.** `gon:plan-issues` 스킬이 이 규율(갭분석→수직 슬라이스→계층)을 강제하는 게 정확한 방향.

### 3.3 Actions — 세 얼굴로 나뉜다

Actions는 단일 판정이 불가능하다. 실제 5개 워크플로가 서로 다른 가치를 가진다.

#### 3.3a 🟢 CI/배포 파이프라인 (`ci.yml`) — 필수

위 §3.1 참조. 협업의 척추. 논의 불필요.

#### 3.3b 🟡 auto-merge (`auto-merge.yml`) — 정교하지만 양날의 검

- CI green 시 App 토큰으로 native auto-merge를 켜는 정교한 장치. App 토큰을 쓰는 이유가 주석에 명시: GITHUB_TOKEN으로 머지하면 `github-actions[bot]` attribution → push 워크플로 재귀 방지 규칙에 걸려 **Docker 빌드가 억제**된다. 이걸 우회하려 App identity가 필수.
- **그런데 실측상 이게 반복 사고원**: 메모리 4건(`autom't-races-post-approval-fix-push`, `gh-pr-automerge-behind-flow` 등)이 "auto-merge가 Codex 리뷰 완료를 앞질러 미봉책을 main에 유입"시킨 레이스를 기록(#302→#303, #315→#316). spec §8이 아예 규칙으로 명문화: **"Codex APPROVED 전 auto-merge 금지."**

**판정: 🟡 — 유용하나 리뷰 게이트와 경합. 규율(APPROVED 후에만 enable)이 없으면 순손해.** hookify로 물리 차단하는 게 spec의 후속 제안.

#### 3.3c 🔴 CI 안의 Claude (`claude-llm.yml`) — 실사용 0, 워크플로 모델 불일치

- **advisor 지적으로 확인한 핵심 발견**: 이 워크플로는 `@claude` 멘션이 이슈/PR/코멘트에 있을 때만 실행된다(`if: contains(..., '@claude')`). **15번 실행 전부 skip** = 아무도 `@claude`를 부른 적이 없다. 그런데 #306·#308·#311 커밋은 이 워크플로를 실제로 하드닝(Bearer 헤더·권한·로그 검증)했다 — **인프라는 정성껏 지었으나 실사용은 0.**
- **왜인가**: 우리 협업 모델은 "CI 안에서 Claude를 호출"이 아니라 "**로컬에서 Claude Code(지금 이 세션)와 직접 협업 + Codex 리뷰 게이트**"다. CI 안 Claude가 할 일을 로컬 Claude가 이미 다 한다. 둘은 경쟁 모델이고, 이 레포는 후자를 택했다.

**판정: 🔴 — 기능이 있다고 가치가 아니다. 워크플로 모델과 안 맞으면 유지비만 든다.** 유지할지(원격/모바일에서 `@claude`로 부를 미래 대비) 아니면 정리할지는 사용자 판단. 현재로선 순수 미사용 자산.

#### 3.3d 🟢 auto-update-llm-gateway / 🟡 labeler

- `auto-update-llm-gateway`: `@krdn/llm-gateway` 새 릴리스를 `repository_dispatch`로 감지 → tag 검증 → package.json 갱신 → typecheck → 자동 PR. **실측상 실사용됨**(2회, 2026-07-12, 성공 1·실패 1 — 초기 셋업 후 안정). 의존성 유지보수를 에이전트/사람 둘 다 손 떼게 함. 🟢. (여기도 auto-merge와 같은 App-토큰 재귀 함정을 주석 67-70에서 실측·회피 — GITHUB_TOKEN으로 PR 생성 시 재귀 방지 규칙이 CI를 억제, #292에서 확인.)
- `labeler`: 경로 기반 PR 라벨 자동 부착. 1회 성공 기록. 저비용이나 저효과(개인 레포라 라벨 필터링 수요 약함). 🟡, 무해.

### 3.4 🟡 Labels / Triage — 도메인 라벨만 유효

- **도메인 라벨**(email/stock/saju/infra): issue-type과 직교하게 유지되며 유효. `gon:plan-issues`가 계승.
- **트리아지 라벨**(`needs-triage`/`ready-for-agent`/`ready-for-human` 등, `docs/agents/triage-labels.md`에 정의): 실측상 `ready-for-agent` 2건·`ready-for-human` 1건뿐. **다자·비동기 트리아지 흐름을 전제로 설계됐으나, 협업자가 2명(1인+에이전트)이라 트리아지 큐 자체가 거의 필요 없다.** 정의는 정교하나 실사용 미미.

**판정: 🟡 — 도메인 라벨 유지, 트리아지 라벨은 오버빌드. 실제 큐가 생기면 그때 활성.**

### 3.5 ⚪ Milestones — 미사용, 니치 약함

- 0개. **구조적 이유**: Milestone은 "릴리스/스프린트 기간에 이슈를 묶는" 도구다. 이 레포는 지속 배포(PR 머지 → 즉시 배포)라 릴리스 경계가 없고, 스프린트를 끊는 팀도 없다. umbrella 이슈가 "무엇을 묶나"를 이미 담당.
- spec은 Milestone을 "선택"으로만 뒀다 — 정확한 판단.

**판정: ⚪ — 도입 근거 약함. umbrella 이슈로 충분.**

### 3.6 🔴 Wiki — 켜졌으나 빈 껍데기, `docs/`가 이미 대체

- `has_wiki:true`지만 `git ls-remote .../gons-dashboard.wiki.git` = **"Repository not found"** → 페이지 0.
- **구조적 부적합(이 리포트의 가장 중요한 판정)**: Wiki는 **별도 git 저장소**다. 에이전트는 매 세션 메인 레포를 clone/read하지만 wiki repo는 시야 밖이다. 즉 Wiki에 지식을 넣으면 **에이전트가 못 닿는 곳으로 컨텍스트를 파편화**시킨다.
- 반대로 이 레포는 지식을 `docs/`(CLAUDE.md·docs/agents·docs/superpowers·docs/research)에 둔다. **메인 트리 안이라 에이전트가 매번 읽고, PR로 함께 버전 관리되고, 코드와 같은 리뷰를 받는다.** Wiki의 모든 강점을 `docs/`가 더 잘 제공한다.

**판정: 🔴 — 도입 금지 권장. `docs/`가 전면 우위. Wiki는 켜져 있어도 쓰지 말 것(혹은 설정에서 off).**

### 3.7 🔴 Discussions — 구조적으로 부적합

- 0건. **구조적 이유**: Discussions는 **비동기 다자 토론**(Q&A, 아이디어, 공지) 도구다. 오픈소스 커뮤니티나 다인 팀에서 빛난다. 이 레포의 협업자는 gon(1인) + Claude/Codex(에이전트)다. 토론은 **이 대화 세션 자체**에서 실시간으로 일어나고, 결정은 spec·메모리·CONTEXT.md로 수렴한다.
- 에이전트 접근성도 나쁨: Discussions는 GraphQL API로만 접근되고 git tree에 없다 → 또 하나의 파편화 지점.

**판정: 🔴 — 니치 없음. 다인 협업자가 생기기 전엔 무의미.**

### 3.8 🟡 Projects v2 — 유일하게 "새로 도입할 가치가 있는" 후보 (조건부)

- 현재 scope(`read:project`) 미보유로 미연결. **잠재 가치는 실재한다**: 단계 상태(Todo/In Progress/Done)를 보드로 시각화하고, "이슈 닫힘 → 자동 Done"으로 진행률을 사람 개입 없이 충전. spec §5가 세팅 절차를 정리해둠.
- **그러나 오버헤드 경고**: 협업자 1인 + 에이전트 조합에서 칸반 보드의 "여러 사람이 카드를 옮기며 상태 공유"라는 본래 가치의 절반은 소멸한다. 남는 순가치는 **① umbrella 진행률 자동 집계, ② 구상 캡처용 draft issue(레포 오염 없이 아이디어 보관)** 두 가지.
- 이 두 가치가 오버헤드(scope 추가·보드 유지·필드 세팅)를 넘는지는 실사용 1~2 사이클로 검증할 문제.

**판정: 🟡 — 나열된 미도입 기능 중 유일하게 검증 착수 가치. 단 "칸반이니까 좋다"가 아니라 위 2가지 순가치로만 정당화.** `gon:plan-issues` 스킬이 이미 이걸 전제로 설계됨.

#### 3.8a 파일럿 착수 (2026-07-22, 사용자 승인 하에 실행)

리포트의 조건부 판정을 실사용으로 검증하기 위해 파일럿 보드를 실제로 세팅함:

- **보드**: [gons-dashboard roadmap (#16)](https://github.com/users/krdn/projects/16), 레포 연결 완료.
- **필드**: `Status`(Todo/In Progress/Done, 기본) + `Domain`(email/stock/saju/infra/memo/monitoring/catalog/platform, 커스텀) + 내장 `Sub-issues progress`·`Parent issue`.
- **자동화 6종 전부 on**: `Item closed`(→Done), `Auto-add sub-issues`, `Pull request merged/linked` 등. → **당초 우려한 "수동 칸반 관리 오버헤드"의 상당 부분이 내장 자동화로 상쇄됨**을 확인. 사람이 카드를 옮길 일이 거의 없음.
- **세 용도 실증**: ① draft 항목 생성 → 레포 이슈 오염 0 확인(구상 보관함 작동), ② #342를 보드 편입 + Status=Todo·Domain=infra 세팅(단계 추적·로드맵 가시화 작동).

**파일럿에서 나온 실측 오버헤드 1건 (스킬 설계에 반영 필요)**: 새로 만든 보드는 `projectV2.items` **집계 쿼리가 eventual consistency로 지연**된다 — 항목 추가 직후 `gh project item-list`가 `totalCount:0`을 반환하지만 `node(id:)` 단일 조회로는 즉시 실재가 확인됨(오래된 보드 #12는 정상). → `gon:plan-issues`가 항목 추가 후 검증할 때 `item-list` 카운트를 신뢰하면 오탐. **node 조회 또는 짧은 재시도로 검증**해야 함.

**자동화 실증 (2026-07-22 확인)**: #342 편입 후 `Status=Todo`만 세팅했는데, 이슈가 CLOSED되자 자동화가 **사람 개입 없이 Status를 Done으로 자동 전환**함(전체 조회로 확인: `#342 → Status=Done Domain=infra`). → Projects의 핵심 순가치("이슈 닫힘 → 진행률 자동 충전")가 정량 검증됨. `Sub-issues progress` 내장 필드가 umbrella에서 이 자동 Done들을 합산하므로 "상태 수동 이동" 오버헤드가 실제로 제거됨.

> 진단 교훈(스킬 반영): `gh project item-list`의 `totalCount`는 **Done/닫힌 항목을 활성 목록에서 필터 제외**한다. #342가 Done이 되자 `totalCount=1`(draft만)로 나와 "항목 사라짐"으로 오판할 뻔했으나, `node(id:)` 직접조회로 보드에 실재함이 확인됨. **집계 카운트를 신뢰하기 전에 필터(닫힘 제외·consistency 지연)를 의심할 것.**

**남은 검증(정성)**: "도메인 로드맵 뷰를 실제로 자주 열어보게 되는가"는 자동화로 증명 불가 — 며칠 실사용으로 "보드를 여는 습관이 붙나"만이 🟡 → 🟢(도입 확정)/🔴(오버헤드 초과) 최종 판정을 낸다.

---

## 4. 종합 — "모든 기능 활용"이 아니라 "맞는 기능 심화"

사용자 질문("모든 기능을 활용하면 향상되는가")에 대한 정직한 답:

> **아니다. "모든 기능 활용"은 오히려 컨텍스트를 파편화시켜 협업을 저하시킬 수 있다.**
> 실측이 가리키는 건 **켜기가 아니라 심화**다 — 이미 척추인 PR+CI+Issues를 규율 있게 쓰고, 미도입 기능은 "에이전트 접근성 × 추적 오버헤드 절감"을 통과하는 것만 선별.

### 왜 "모든 기능"이 틀렸나 — 파편화 비용

에이전트 협업의 숨은 비용은 **컨텍스트가 어디에 사는가**다. 지식이 여러 GitHub 표면(Wiki·Discussions·Projects·Issues·docs)에 흩어지면:
- 에이전트는 매 세션 그 전부를 재수집해야 하고(토큰·시간),
- 어떤 표면은 아예 못 닿아(Wiki repo, Discussions GraphQL) 결정이 유실되고,
- 사람도 "그 결정 어디 적었더라"를 겪는다.

**단일 진실 소스(git tree 안의 `docs/` + Issues + PR)가 다면 활용보다 강하다.**

### 우리 협업의 진짜 척추 (실측 확정)

```
구상 → (umbrella) Issue = 설계 기준 문서
     → docs/superpowers/specs, plans = 상세 설계 (git tree 안)
     → 브랜치 → 구현 (로컬 Claude Code)
     → PR → CI(ci.yml) green
     → Codex 리뷰 게이트 = APPROVED
     → 머지 → Docker 빌드/푸시 → 배포 검증 4단계
     → 회고 → CLAUDE.md Gotcha / 메모리로 수렴
```

GitHub 기능들은 이 파이프라인을 **증폭할 때만** 가치가 있다. 파이프라인 밖의 별도 표면(Wiki·Discussions)은 이탈이다.

---

## 5. 권장 사항 (실행은 별도 승인 후 — 이 리포트는 분석만)

우선순위 순. 각 항목은 제안이며, 이 리포트 작성으로 자동 실행하지 않았다.

1. **[검증 착수] Projects v2 1사이클 파일럿** — scope 추가(`gh auth refresh -s project`) → 다음 umbrella 구상에 `gon:plan-issues`로 보드 연결 → "진행률 자동 집계 + 구상 draft 캡처" 2가치가 오버헤드를 넘는지 실사용으로 판정. **넘지 않으면 미련 없이 접는다.**
2. **[규율] PR 본문 `Closes #N` 일관화** — 실측: 전체 227 PR 중 4건뿐. 단 spec의 경고 유지: auto-merge 레이스 차단을 위해 **Codex APPROVED 후에만** auto-merge. (hookify 물리 차단이 후속 후보.)
3. **[정리] 임시검증 이슈 #336~341 닫기/삭제** — plan-issues sub-issue 검증 잔재. 레포 위생.
4. **[결정] `claude-llm.yml` 거취** — 실사용 0. (a) 원격/모바일 `@claude` 미래 대비로 유지, (b) 미사용 자산으로 정리. 유지비 낮으니 (a) 무해하나, "쓰지 않는 걸 안다"는 명시가 중요.
5. **[비도입 확정] Wiki·Discussions·Milestones** — 도입하지 않음을 명시적 결정으로. `docs/`·Issues·umbrella가 각각 전면 대체. 다인 협업자가 생기면 Discussions만 재검토.
6. **[유지] 트리아지 라벨은 정의만 보존, 강제하지 않음** — 실제 트리아지 큐가 생기기 전엔 오버헤드.

---

## 6. 한 문장 결론

> gon+Claude 협업에서 GitHub의 가치는 **기능 개수가 아니라 "에이전트가 git tree/`gh`로 닿고 사람 추적을 줄이는 단일 파이프라인(Issues→PR→CI→리뷰→배포)"의 심화**에 있다. Wiki·Discussions·Milestones는 이 조합에 니치가 없고(컨텍스트 파편화 위험), Projects v2만이 조건부 검증 가치를 가지며, 나머지(PR·CI·설계기준 Issue)는 이미 최적에 가깝게 돌고 있다.
