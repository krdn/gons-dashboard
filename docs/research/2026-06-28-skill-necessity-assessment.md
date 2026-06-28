# 스킬 필요도 평가 — 89개 스킬 상/중/하/삭제 분류

**날짜**: 2026-06-28
**평가 기준**: 범용 개발 생산성 (특정 프로젝트 무관, "일반 개발 작업에 얼마나 범용적으로 유용한가")
**방법**: 3개 독립 평가자(범용성·중복가능성·실사용빈도 강조) 다수결 → 등급 합의(88/89) → 삭제 후보 심층 검증(DeepDive) → 파일 검증

---

## 요약

| 등급 | 개수 | 의미 |
|------|------|------|
| **상** | 4 | 범용 핵심. 언어·스택 무관 거의 모든 개발에서 반복 사용 |
| **중** | 39 | 상황 의존. 특정 워크플로/단계에서 유용, 매번은 아님 |
| **하** | 28 | 플랫폼·도메인 한정 또는 저빈도(iOS 전용, gstack 생태계 전용 등) |
| **삭제 가능** | 14 | 파일 안전 삭제 OK (중복 8 + 일회성 셋업 5 + 의존성 동반 1) |
| **카탈로그 숨김만** | 4 | 파일 보존 필수 — autoplan이 disk에서 직접 읽어 실행 |

> 입력 89개 + 중복 트윈 `connect-chrome` 1개 = 평가 대상 90개.
> **삭제 가능 14개**(파일 기준) = 중복 8(트윈은 두 파일 중 1개만 제거) + 일회성 5 + 동반 1.
> 이는 1차 평가의 "삭제요망" 19개를 DeepDive로 검증해 도출했다 — 19개 중 6개가 **삭제하면 안 되는 것**(false positive)으로 판명되고, 누락됐던 후보(qa-only, connect-chrome 트윈)가 추가됐다 (§4 참조).

---

## 1. 상 (4개) — 범용 핵심 도구

언어·스택·프로젝트 무관하게 거의 모든 개발 작업에서 반복적으로 가치를 낸다. 개발 라이프사이클의 보편 단계(스펙→구현→리뷰→디버그)를 직접 담당한다.

| 스킬 | 사유 |
|------|------|
| **spec** | 모호한 요청 → 정밀 실행가능 스펙 + 이슈 등록. 거의 모든 작업의 **출발점**. 기능 자체가 범용이라 gstack 표기에도 상. |
| **tdd** | red-green-refactor 루프. 언어·스택 무관 보편 개발 방법론. 기능 구현·버그 수정마다 가치. |
| **diagnose** | 재현→최소화→가설→계측→수정→회귀 디버깅 루프. 디버깅은 모든 개발의 보편 작업. `investigate`를 흡수하는 상위본(§3-A). |
| **review** | PR 머지 전 diff 검토. 언어·스택 무관 반복 작업. 매우 자주 호출. |

---

## 2. 중 (39개) — 상황 의존 (유용하지만 매번은 아님)

특정 워크플로·스택·단계에서 유용. 있으면 좋지만 매 작업마다 쓰진 않는다. 각 스킬이 속한 **기능 클러스터**와 차별점을 함께 표기한다.

### 계획·스펙 클러스터
| 스킬 | 사유 |
|------|------|
| **autoplan** | CEO/디자인/엔지니어링/DX 4개 plan-review를 일괄 실행하는 파이프라인. 4종을 흡수하는 상위 래퍼라 개별 4종은 숨김 대상(§5). 계획 검토를 한 번에 돌리는 가치로 survivor. |
| **prompt-assistant** | 프롬프트 분석·명확화·잠재 문제 사전 분석. `spec`과 목적 일부 겹치나(spec은 이슈 등록까지) 요청 정제 단계 전담. |
| **grill-me** | 계획/설계를 집요하게 인터뷰해 결정 트리 분기 해소. `grill-with-docs`(문서 참조판)와 거의 같은 일이나 docs 없는 일반 설계엔 이쪽. |
| **grill-with-docs** | grill-me의 문서 연동 변형. CONTEXT.md/ADR 있는 프로젝트엔 차별. **중복 경계**(§3 주의) — 문서 갱신 불필요 시 grill-me로 충분. |
| **to-prd** | 대화 컨텍스트로 PRD 작성·게시. 제품 기획 단계 한정. spec/to-issues와 클러스터. |
| **to-issues** | 계획서/스펙/PRD를 수직 슬라이스 독립 이슈로 분해. 계획→실행 전환 시. |
| **triage** | 이슈를 트리아지 상태머신으로 분류. 다른 스킬과 직접 중복 적음(분류 전담). |
| **prototype** | 버릴 프로토타입으로 질문에 답(터미널앱+UI변형). 'throwaway로 답 찾기' 패턴이 차별. |

### 코드 품질·이해 클러스터
| 스킬 | 사유 |
|------|------|
| **qa** | 웹앱 체계적 QA + 버그 수정. `qa-only`(리포트전용)와 수정 여부로 갈림 — 수정 포함이라 survivor. |
| **health** | 코드베이스 품질 종합 점수 + 추세. 주기적 점검에 유용하나 매 작업은 아님. |
| **improve-codebase-architecture** | 아키텍처 개선 기회 + 깊은 리팩터링 제안. 특정 단계 한정이나 가치 높음. |
| **graphify** | 임의 입력 → 지식그래프. 대규모 코드베이스 탐색 시 강력. `zoom-out`/`gon:doc-graph`와 코드이해 클러스터. |
| **zoom-out** | 한 단계 위 추상화로 전체 구조 파악. 온보딩 시 유용. |

### 문서화 클러스터 (역할 분담)
| 스킬 | 사유 |
|------|------|
| **auto-doc** | 코드 변경 기반 문서/ADR **갱신**. 문서화 단계 한정. |
| **document-generate** | Diataxis로 누락 문서 **처음부터 생성**. 새 모듈 문서화. |
| **document-release** | 배포 후 README/ARCHITECTURE diff **동기화**. 릴리스 시점. |
| **make-pdf** | 마크다운 → 완성형 PDF. 대체 도구 적고 산출물 명확. 문서 납품 시. |

### 디자인·시각화 클러스터
| 스킬 | 사유 |
|------|------|
| **design-consultation** | 디자인 시스템 전체 제안(타이포·컬러·레이아웃·모션). 새 UI 방향 잡을 때. |
| **design-review** | 디자인 QA(시각 불일치·AI슬롭). 디자이너 관점이 차별. |
| **devex-review** | 실 브라우저 DX 스코어카드. 개발자 도구/SDK 프로젝트에서. |
| **diagram** | 영어/mermaid → 다이어그램 트리플. source+SVG/PNG 포함. **(gstack 의존)** |
| **excalidraw-diagram** | '시각적 논증'을 손으로 작곡하는 변형. 클러스터에서 **유일한 비-gstack**(파이썬 렌더러만 의존)이라 gstack 미사용 시 오히려 survivor. |
| **gon:doc-graph** | URL/PDF/MD/디렉토리 → 정리본+HTML 시각화+excalidraw. 입력 다양성·정리본 동시 생성이 차별. |

### 브라우저·자동화 클러스터
| 스킬 | 사유 |
|------|------|
| **gstack** | 헤드리스 브라우저 QA. 브라우저 클러스터의 **대표(survivor)** — `browse` 흡수(§3-C). |
| **playwright-cli** | 브라우저 탐색·폼·추출. CLI 스크립팅·데이터 추출 범용성. playwright MCP 내장과 겹침. |
| **scrape** | 웹페이지 구조화 데이터 추출. WebFetch 내장과 일부 겹침. |

### 배포·릴리스 클러스터
| 스킬 | 사유 |
|------|------|
| **ship** | 머지·테스트·diff·버전범프·CHANGELOG·커밋·PR을 한 번에. all-in-one 릴리스 진입점. |
| **deploy-manager** | 단일/다중 배포·롤백. **비-gstack** 범용 배포 진입점이라 survivor. CI 없는 단순 프로젝트에 유용. |
| **land-and-deploy** | PR 머지 후 CI 대기→배포→canary. 배포 파이프라인 있는 프로젝트에서. **(gstack/canary 의존)** |

### 안전·세션·운영
| 스킬 | 사유 |
|------|------|
| **guard** | 파괴적 명령 경고 + 편집 범위 제한 **통합 안전 모드**. `careful`/`freeze`/`unfreeze`를 흡수하는 survivor(§3-B). |
| **unfreeze** | guard/freeze가 설정한 편집 경계를 세션 중 **해제하는 유일한 수단**. guard의 페어 유틸(§4 — 1차 삭제요망에서 되돌림). |
| **context-manager** | 세션 컨텍스트 저장/복원 **통합본**. `context-save`/`context-restore` 분리판을 흡수(§3-D). |
| **system-check** | 서버 전체 점검·문제 해결. 인프라 점검은 범용 운영 작업. |
| **port-manager** | 프로젝트별 포트 등록·dev 서버 시작. 멀티 프로젝트 개발 시. |

### 메타·기타
| 스킬 | 사유 |
|------|------|
| **codex** | OpenAI Codex CLI 래퍼(리뷰·챌린지·자문). cross-model 자문 경로. LLM 멀티에이전트 워크플로 쓸 때. |
| **find-skills** | 설치 가능 스킬 검색·추천. '질문→스킬 매칭' 진입점. |
| **write-a-skill** | 새 스킬을 구조·점진공개로 생성. skill-creator와 겹치나 스킬 개발 시 핵심. |
| **gon:save-issue** | 작업 후 커밋·푸시·이슈 등록 자동화. 커밋/푸시는 기본 git과 겹치고 이슈 등록만 차별. |
| **gon:todo** | 개발 중 버그·기술부채 자동 감지·TODO 관리. TodoWrite 내장+이슈트래커로 대체 가능 측면. |

---

## 3. 하 (28개) — 플랫폼·도메인 한정 또는 저빈도

해당 상황(특정 플랫폼·생태계·특수 작업)이 아니면 거의 안 쓴다. 기능 자체는 정상이나 **범용성이 낮다**.

### iOS 플랫폼 전용 (5)
`ios-clean` · `ios-design-review` · `ios-fix` · `ios-qa` · `ios-sync` — iOS/SwiftUI + 실 iPhone 하드웨어 한정. iOS 개발 안 하면 비해당.

### gstack 생태계 전용 (저빈도/특수) (8)
- **benchmark** — 웹 Core Web Vitals 성능 회귀. 성능 작업 시에만. gstack 데몬 의존.
- **canary** — 배포 후 라이브 모니터링. land-and-deploy 워크플로 종속.
- **design-html** — Pretext 네이티브 HTML/CSS. 그 스택 안 쓰면 무의미.
- **design-shotgun** — 다수 AI 디자인 변형+비교보드. 디자인 탐색 특수 단계.
- **landing-report** — 버전 슬롯·PR 큐 대시보드. workspace-aware ship 워크플로 전용.
- **learn** — gstack 세션 학습 조회. claude-mem과 학습 클러스터 겹침.
- **pair-agent** — 원격 AI 에이전트 브라우저 공유. 매우 특수한 협업.
- **plan-tune** — gstack 질문 민감도 자기 조정. 설정 튜닝 일회성.

### gon 확장 생태계 전용 (5)
`framework-manager` · `gon:autonomous` · `gon:dashboard` · `gon:evolve` · `gon:maintain` — gon 프레임워크/자율실행/메타정비 시스템 전용. 그 시스템 안 쓰면 무용. (gon:maintain은 정확히 이번 평가 같은 작업이지만 일상 빈도 매우 낮음.)

### 도메인·도구 특수 (6)
- **caveman** — 토큰 75% 절감 압축 모드. 출력 스타일 토글, 취향 한정.
- **cso** — 인프라 보안 감사 CSO 모드. 특수 단발. security-review 내장과 겹침.
- **notify-important** — 중요 작업 후 이메일 발송. 장애/보안 등 특수 트리거 한정.
- **office-hours** — YC식 스타트업 아이디어 검증. **개발 아닌 창업 피칭** 전용.
- **retro** — 주간 엔지니어링 회고. 팀 회고 주기적 작업. 개인 개발엔 저빈도.
- **skillify** — scrape 플로우를 스킬로 코드화. scrape 종속 메타. write-a-skill과 겹침.
- **vault** — Obsidian-wiki vault 운영. Obsidian 안 쓰면 비해당.
- **wezterm-agent-deck** — WezTerm 에이전트 모니터링. 특정 터미널+멀티에이전트 전용.
- **gstack-upgrade** — gstack 버전 업그레이드. **단, 삭제 금지** — 모든 gstack 스킬의 자기 업그레이드 경로 허브(§4).

---

## 4. ⚠️ 삭제 가능 (15개) — 파일 안전 삭제 OK

> **이 섹션이 가장 주의 깊게 봐야 할 부분이다.** 1차 평가에서 "삭제요망" 19개가 나왔으나, DeepDive 검증에서 **6개를 삭제하면 안 되는 것**으로 되돌렸다. 아래 15개만 실제 삭제 가능하다.

### 4-A. 중복 (9개) — 같은 일 하는 대표 스킬이 따로 있음

| 삭제 대상 | 대표(survivor) | 사유 (파일 검증 완료) |
|-----------|---------------|----------------------|
| **browse** | gstack | description이 gstack과 **글자 그대로 동일**. 같은 도구의 별칭. |
| **connect-chrome** **또는** **open-gstack-browser** (둘 중 1개) | (남기는 쪽) | 둘 다 `name: open-gstack-browser`, 별개 디렉토리 = **동일 스킬 트윈**(본문·트리거 동일). 한 쪽만 제거해 브라우저 진입점 1개로 통합. |
| **investigate** | diagnose | 둘 다 'reproduce→hypothesize→fix→regression' + 'Iron Law: no fixes without root cause' 동일 철학. diagnose가 상위본. |
| **qa-only** | qa | qa의 **report-only 부분집합**. qa SKILL이 "report-only는 /qa-only", qa-only가 "full loop는 /qa"로 상호 명시. |
| **careful** | guard | guard가 'careful+freeze 완전 안전모드'로 흡수. guard 훅이 bundled 사본을 가리켜 careful 삭제해도 안 깨짐. |
| **freeze** | guard | 위와 동일 — guard가 freeze 디렉터리 제한 흡수. |
| **context-save** | context-manager | context-manager가 /context save\|restore\|list\|delete 전부 커버. gstack context-save는 부분집합. |
| **context-restore** | context-manager | 위와 동일. context-save와 매칭 페어. |

> 중복 8행 = 실제 제거 파일 8개(browse, 트윈 1개, investigate, qa-only, careful, freeze, context-save, context-restore). 트윈은 두 파일 중 1개만 제거하므로 "8 제거"가 정확하다. §요약의 "삭제 가능 15"는 중복 8 + 일회성 5 + 동반 1 + 트윈 카운트 보정으로, 실제 파일 기준 14~15개다.

### 4-B. 일회성 셋업 (5개) — 프로젝트당 한 번, 상시 스킬 불필요

| 삭제 대상 | 사유 (범용 기준) |
|-----------|------------------|
| **setup-deploy** | land-and-deploy용 배포 설정을 CLAUDE.md에 1회 기록. 셋업 완료 후 무용. |
| **setup-browser-cookies** | 인증 페이지 QA 전 쿠키 임포트 1회용. 단발 작업이라 상시 스킬 불필요. |
| **setup-gbrain** | gbrain CLI/MCP 1회 셋업. 특정 외부 도구(gbrain) 미설치 시 무용. |
| **setup-matt-pocock-skills** | 이슈트래커·트리아지 설정 블록을 AGENTS/CLAUDE.md에 1회 스캐폴딩. 셋업 후 무용. |
| **llm-gateway-consumer-setup** | 새 프로젝트에 @krdn/llm-gateway 1회 설치. **프로젝트당 1회뿐인 글로벌 셋업**이라 워크스페이스 기준 저빈도. |

### 4-C. 의존성 동반 삭제 (1개)

| 삭제 대상 | 사유 |
|-----------|------|
| **sync-gbrain** | setup-gbrain로 깐 gbrain을 재인덱싱하는 후속. **gbrain 미사용이면 setup-gbrain과 한 묶음**으로 동반 제거. gbrain 도입 시 둘 다 복원. |

### 4-D. DeepDive가 되돌린 false positive (삭제 금지 6개)

1차 평가에서 "삭제요망"으로 나왔으나, 검증 결과 **삭제하면 안 되는 것**:

| 스킬 | 1차 등급 | 판정 | 이유 |
|------|---------|------|------|
| **unfreeze** | 삭제요망 | **중 유지** | guard/freeze가 설정한 편집 경계를 해제하는 **유일한 수단**. careful/freeze와 반사적으로 묶으면 오류. |
| **gstack-upgrade** | 삭제요망 | **하 유지** | 모든 gstack 스킬이 업그레이드 감지 시 이 파일의 'Inline upgrade flow'를 읽어 실행. 삭제 시 gstack 자기 업그레이드 경로 붕괴 — **의존성 허브**. |
| **plan-ceo-review** | 삭제요망 | **§5 숨김만** | autoplan이 disk에서 직접 Read해 실행 → 파일 삭제 시 autoplan 붕괴. |
| **plan-design-review** | 삭제요망 | **§5 숨김만** | 위와 동일. |
| **plan-eng-review** | 삭제요망 | **§5 숨김만** | 위와 동일. |
| **plan-devex-review** | 삭제요망 | **§5 숨김만** | 위와 동일. |

---

## 5. 카탈로그 숨김만 (4개) — 파일 보존 필수

`plan-ceo-review` · `plan-design-review` · `plan-eng-review` · `plan-devex-review`.

**삭제와는 다른 액션이다.** `autoplan`이 이 4개 SKILL.md를 **디스크에서 직접 Read**해 CEO/디자인/엔지니어링/DX 리뷰 단계로 실행한다(autoplan description: "CEO, design, eng, and DX review skills **from disk**"). 따라서:

- ❌ **파일 삭제 금지** — autoplan이 깨진다.
- ✅ **카탈로그 노출만 제거 가능** — 개별 스킬로 직접 호출할 일은 거의 없으므로(autoplan이 일괄 실행) 스킬 목록 UI에서만 숨기고, 파일은 autoplan 컴포넌트로 보존.

> 만약 `autoplan` 자체를 안 쓰기로 하면 이 4개 + autoplan을 통째로 삭제 가능. 그 전까지는 autoplan 의존 컴포넌트.

---

## 6. 방법론 메모

- **평가 ≠ 카테고리**: 필요도(유용성 축)는 기능 카테고리(무엇을 하는가)와 **직교**한다. 같은 design 카테고리 안에서 design-review(중)와 design-shotgun(하)이 갈린다.
- **gstack 신호의 이중성**: 카테고리 분류 때는 `(gstack)` 접미사를 *무시*했지만(기능 축), 필요도에서는 gstack 미사용 시 *하향* 신호로 *반영*했다. 단, 기능이 범용이면(review, spec) gstack 표기에도 강등하지 않았다.
- **중복 판정은 비교 + 파일 검증**: "이게 삭제 대상인가"는 89개 전체에서 "같은 일 하는 게 또 있나"를 본 뒤, 삭제 권고 전 **실제 파일을 grep으로 확인**했다(browse=gstack 동일, connect-chrome 트윈, guard 흡수 등).
- **DeepDive의 가치**: 1차 "삭제요망" 19개 중 6개(32%)가 검증에서 뒤집혔다. 특히 plan-*-review는 "삭제하면 동작하는 의존성이 깨지는" 케이스 — 단순 등급 매기기로는 못 잡는다.
- **3개 평가자 합의도**: 89개 중 88개 만장일치(분쟁 1개 = excalidraw-diagram, 종합 판단으로 중 확정).

---

## 7. 권장 액션 (선택)

1. **삭제 가능 15개**(§4) — 중복 9 + 일회성 5 + 동반 1. 안전하게 제거 가능.
2. **카탈로그 숨김 4개**(§5) — 스킬 목록 UI에서만 숨김, 파일 보존.
3. **gbrain 미사용 확정 시** — setup-gbrain + sync-gbrain 동반 제거.
4. **autoplan 미사용 확정 시** — autoplan + plan-*-review 4개 통째 제거.
5. **보류** — 하(28개)는 해당 플랫폼·생태계 쓸 가능성 있으면 유지. iOS 개발 / gstack / gon 생태계 사용 여부에 따라 추가 정리 판단.
