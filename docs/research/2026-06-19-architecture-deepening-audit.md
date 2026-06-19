# 아키텍처 deepening 감사 (2026-06-19)

`/improve-codebase-architecture` 스킬 실행 결과. gons-dashboard 코드베이스의 **deepening 기회** —
shallow 모듈을 deep하게 만들거나, 깊은 모듈의 4중 복제를 factory로 수렴시키는 리팩터링 후보.

## 방법

- 6개 차원 병렬 탐색(effort high) → 21개 후보 발견
- 각 후보를 적대적 검증(deletion test + 두-어댑터 원칙, 코드 직접 재확인)
- 검증 결과: **confirmed 9 / downgraded 8 / rejected 0** (기준점 4개는 검증 제외)
- 어휘: 도메인=`CONTEXT.md`, 아키텍처=LANGUAGE.md (Module/Interface/Depth/Seam/Adapter/Leverage/Locality)

## 통합된 deepening 후보 (사용자 선택 대기)

탐색이 잡은 17개 발견을 distinct 후보로 통합. 같은 사실을 여러 각도에서 본 발견은 하나로 묶음.

### 후보 1 — Tri-nation narrative 캐시-생성 모듈 4중 복제 (HIGH)

- **통합한 발견**: #4 + #9(커널) + #11 + #13 + #17
- **Files**: `features/saju-{lifetime,yearly,monthly,daily}-tri/api/narrative-server.ts` (218~242 LOC × 4)
- **Problem**: 4개 narrative-server가 동일한 6단계 시퀀스(frameHash → cache findFirst →
  schoolSpecific null self-heal → `assertSajuBudgetOk` → `callXxxLlmAndParseWithRetry`(ZodError 1회 재시도) →
  `logSajuSpend` → `onConflictDoUpdate` UPSERT)를 함수명·로그프리픽스만 바꿔 복붙. retry wrapper만 48줄×4=192줄
  byte-identical. 각 narrative-server는 **deep하지만**(인라인하면 route 핸들러로 복잡도 재출현), 그 deep behavior가
  **4벌 병행 복제**된 상태.
- **Solution**: `createSajuTriCache`(frame 레이어, `shared/lib/saju/getOrBuildSajuTriCache.ts`)가 이미 정착시킨
  thin-factory/thick-adapter 패턴을 **narrative 레이어로 미러**. caller(4개)는 per-adapter 변이점만 제공:
  cache 테이블·where 추가컬럼(forDate / year+month / year), Zod schema, prompt, maxOutputTokens(8192/6144/4096/4096).
  cache+budget+retry+spend+upsert는 factory에 묻힘.
- **Benefits**: Locality — retry/budget 정책 변경이 4곳→1곳. Leverage — 새 timeframe 추가 시 adapter만.
  테스트 — factory 인터페이스에서 retry/budget을 한 번 검증, 4벌 평행 테스트 불필요.
- **검증 정정**: "shallow 4 caller"가 아니라 "4벌 복제된 deep orchestration". `cachedReading`은 비-saju caller용
  + retry 없는 단일 호출이라 조상이 아님 — 새 narrative factory 필요. `MAX_NARRATIVE_TOKENS` 차이는 drift 아니라
  의도적 content-length config.

### 후보 2 — Tri 4학파 탭 상태머신 headless 훅 부재 (HIGH)

- **통합한 발견**: #12 + #5(RSC 셸 측면)
- **Files**: `features/saju-{daily,monthly,yearly,lifetime}-tri/ui/Tri*Tabs.tsx` (287~384 LOC × 4),
  `widgets/saju-tri-*/` RSC 셸 4종
- **Problem**: 4개 Tabs 컴포넌트가 동일한 상태머신을 복제 — `NarrativeState`/`NarrativeCache` 초기화,
  `anyRetryAt` reduce, 탭 전환 시 lazy fetch 트리거가 byte-parallel. RSC 셸 4종도 `.then` discriminated union
  `(ok:true)|(ok:false,error)` 패턴과 section 마크업이 동형.
- **Solution**: 상태머신을 headless 훅(`useTriNarrativeTabs` 류)으로 추출 — fetch 트리거·retry 추적·캐시를 훅이
  묻고, 4개 Tabs는 학파별 탭 구성(4 vs 5 TABS)·frame 타입·ComposeView 행만 제공.
- **Benefits**: Locality — 탭 fetch/retry 로직이 1곳. 테스트 — 상태머신을 컴포넌트 렌더 없이 훅 단위로 검증.
- **검증 정정 (downgrade 70%)**: 훅 반환 surface가 넓으면(28멤버) project 정의상 shallow. 진짜 이득은
  test-isolation + locality이지 depth 아님. Tabs의 구조적 차이(4 vs 5 탭)는 의도적 변이라 셸만 추출.
  "#164 회귀가 여기서 발생" 주장은 **거짓** — #164는 ReplyModalBody(이메일)였음.

### 후보 3 — saju errorMessage 매퍼 4종 (✅ 해소 — Phase 3 노트 supersede, PR 미할당)

- **발견**: #6
- **Files**: `features/saju-{daily,monthly,yearly,lifetime}-tri/lib/errorMessage.ts`,
  `shared/lib/saju/errorMessage.ts`(신설)
- **Problem**: 4개 슬라이스의 `toUserMessage()` 함수 + `PREFIX_MAP` + 공통 EXACT 5키가 byte-identical 복제.
  slice 고유 EXACT 키(INVALID_DATE/YEAR/MONTH)만 divergence.
- **⚠️ 옛 결정과 충돌 → supersede**: 옛 monthly/yearly 주석이 두 이유로 의도적 복제 유지 —
  (1) "에러 코드 집합 분기 가능성"(divergence), (2) "shared/lib 추출 시 의존성 결합"(coupling).
  → **후보 1(#182, createNarrativeCache)이 4개 timeframe feature 가 `shared/lib/saju` 모듈에 의존하는
  선례를 정착**시켜 location 정당성을 확립, 이유 (2)를 supersede. 이유 (1)은 설계가 그대로 존중 —
  slice 고유 키는 caller 가 `sliceMap` 으로 주입해 로컬 유지(centralize 안 함).
- **실증**: divergence 가 실제로 일어난 건 slice 고유 EXACT 키뿐. 함수·PREFIX·공통 5키는 안정적이라
  ADR 의 fear 가 그 부분엔 발현되지 않았음.
- **결과**: `shared/lib/saju/errorMessage.ts` 의 `toUserMessage(code, sliceMap?)` 가 정책·공통키·PREFIX·
  fallback 소유. 4개 slice 는 자기 고유 키만 주입하는 thin wrapper(callsite 시그니처 `toUserMessage(code)` 보존).
  stale 주석 4개 정정, shared 테스트 19개 + lifetime 위임 테스트 4개.
- **Benefits**: Locality — prefix-match 정책·공통키·테스트 1곳. slice divergence 는 로컬 유지(ADR 존중).

### 후보 4 — krw 단가표·환산 경로 이중화 (HIGH)

- **발견**: #10
- **Files**: `shared/lib/llm/llm-client.ts:6-14`, `shared/lib/llm/pricing.ts:10-20`
- **Problem**: `PRICING_USD_PER_M`·`OPUS_PRICING`(15/75)·`USD_TO_KRW`(1380)·`pricingFor()`가 두 파일에 평행 복제.
  `pricing.ts`가 superset(gemini-2.5-pro, gpt-5.3-codex 추가), `llm-client.ts`는 2모델만.
- **Solution**: `llm-client.ts`가 `pricing.ts`를 단일 출처로 import. 단가 추가가 1곳.
- **Benefits**: Locality — 단가/환율 갱신이 1곳. drift 위험 제거(현재 llm-client가 신규 모델 단가 누락).
- **검증 정정**: 누락은 현재 기능 갭 아님(llm-client는 2모델만 다룸). 하지만 단일 출처화는 미래 drift 차단.

### 후보 5 — tiger-reading 엔티티 barrel seam 미완성 (HIGH)

- **발견**: #1
- **Files**: `entities/tiger-reading/index.ts`, UI 컴포넌트 7개 깊은경로 callsite
  (`widgets/tiger-cards/ui/*` 4 + `app/tiger/*` 3)
- **Problem**: container/project가 server.ts+client.ts seam으로 해소한 "혼재 통증"이 tiger-reading에선
  해소 대신 **깊은경로 우회를 주석으로 영구화**(index.ts:2-4 "UI는 깊은 경로로, barrel에 넣지 말 것").
  barrel 인터페이스가 정직하지 못함 — caller가 "타입은 barrel, 컴포넌트는 깊은경로"라는 숨은 위치 제약을 외워야 함.
  AI 탐색 시 barrel만 읽으면 TigerNarrative 존재를 못 찾음.
- **Solution**: container/project가 정착시킨 entity barrel seam을 미러. client 안전 표면(타입·상수·`use client` UI)을
  `client.ts` 단일 진입점으로 수렴. 7개 깊은경로 callsite가 `@/entities/tiger-reading/client`로 수렴.
- **Benefits**: Leverage — barrel 하나로 슬라이스 public surface 전체. Locality — "어디에 넣을지" 주석 강제 제거.
  AI 탐색가능성 — 단일 읽기로 public surface 파악.
- **검증**: server-only export 없으니 client.ts만으로 충분. 두-어댑터 충족(타입 barrel + 깊은 UI 경로).

### 후보 6 — fortune-profile 엔티티 barrel seam (HIGH)

- **발견**: #3
- **Files**: `entities/fortune-profile/index.ts`(9줄), server callsite 5 + client callsite 4(깊은경로 우회)
- **Problem**: server-only API와 client가 쓰는 타입이 혼재. server 5곳은 barrel 사용,
  client 4곳(`use client`)은 `model/types` 깊은경로 우회. 같은 상수 `RELATION_LABEL`을 server(SajuDetailHeader)는
  barrel, client(FortuneProfileCard)는 깊은경로로 import.
- **Solution**: email-settings 패턴 미러 — server.ts/client.ts 분리. **+ index.ts barrel에 `import "server-only"`
  추가**(검증자 정정: client.ts만으론 build 누수 감지 안 됨, barrel-level 마커 필요).
- **Benefits**: Leverage — client가 단일 barrel. Locality — server-only 누수를 build가 진입점에서 감지.

### 후보 7 — 프로필/설정 CRUD 액션 envelope + Zod 헬퍼 (MEDIUM)

- **발견**: #19
- **Files**: `features/fortune-profile-manage/_schema.ts`, `features/tiger-profile-manage/_schema.ts`
- **Problem**: `optionalText(max)` 헬퍼·`birthTime` Zod 파이프·`ActionResult` 타입 리터럴이 byte-identical 복제.
- **Solution**: Zod 헬퍼와 `ActionResult` 타입을 shared로 추출.
- **검증 정정 (downgrade)**: envelope drift의 일부(code-세트 차이)는 profile upsert vs lookup ownership **도메인
  차이에서 나온 정당한 변이**. "code 형태가 더 표현력 있다"는 주장은 코드에 미반영 — caller는 `message ?? code`로
  display만 함. 진짜 benefit은 "일관성"(하나의 형태)이지 "표현력" 아님. 순수 cosmetic drift만 추출 대상.

### 후보 8 — ReplyModalBody 상태머신 추출 (MEDIUM)

- **발견**: #7
- **Files**: `widgets/email-digest/ui/ReplyModalBody.tsx` (475 LOC, 최대 파일)
- **Problem**: draft 편집 상태머신(race-guard `requestIdRef` stale-response 체크 110-113, edited/dirty 추적,
  tone-buffer 독립 관리)과 표현이 한 컴포넌트에 융합.
- **Solution**: 상태/오케스트레이션을 훅으로 추출, 컴포넌트는 표현에 집중(container/presentational 분리).
- **검증 정정 (downgrade)**: 훅 반환 surface가 넓으면(~28멤버) project 정의상 shallow — depth 아님. 진짜 이득은
  test-isolation + locality(race-guard를 렌더 없이 검증). "deep 모듈로 AI 탐색" 프레임은 과장.

### 후보 9 — email-digest / important-emails 카드 헤더 셸 (MEDIUM)

- **발견**: #8
- **Files**: `widgets/email-digest/`, `widgets/important-emails/` (각 app/page.tsx에서 1회 사용)
- **Problem**: auth 가드 + settings 조회 + settings-dialog 헤더 셸이 두 카드에 평행 복제.
- **검증 정정 (downgrade)**: caller가 각 1곳뿐. auth 가드는 page.tsx redirect로 이미 처리되는 중복 안전장치,
  `getEmailSettings`는 `React cache()`로 감싸져 텍스트 중복이지 동작 중복 아님. "#167이 동시에 건드림" 주장 거짓
  (#167은 ImportantEmailsCard만). 추출 가치 낮음 — 셸 패턴만 공유 컴포넌트화.

### 후보 10 — email 엔티티 타입 colocation (LOW)

- **발견**: #2 (검증 후 LOW로 강등)
- **Files**: `entities/email/api/getReplyNeeded.ts:16`, `getImportantEmails.ts:21`, `model/types.ts`
- **검증 정정**: barrel seam 미진단. `import type`는 server-only를 erase하므로 build 통과(검증됨). 진짜 리팩터는
  더 작음 — `ReplyNeededItem`/`ImportantEmailItem` 타입을 server-only API 파일에서 `model/types.ts`로 이동(colocation).
  tiger/fortune 같은 full seam 불필요.

## 조사했으나 deepening 기회 아님 (커버리지 투명성)

- **#14 모델 라우팅 seam**: 깊은 behavior는 이미 `shared/lib/llm/resolve-claude-model.ts`(111줄)에 중앙화.
  persona-router/saju-model-registry의 modelIdByName은 얇은 3-way dispatch. 깊게 만들 게 없음.
- **#18 features barrel server/client seam 누수**(container-actions·saju-monthly/daily-tri): 3개 barrel이 client UI +
  server-only 혼재는 사실이나, `use client` 컴포넌트가 이미 FSD 깊은경로 import로 hazard 회피 중 → proposed seam은 virtual.
- **#15 stock orchestrator**: shallow 펼침 아니라 정당한 deep 모듈 — 현상 유지.
- **#16 saju 학파 narrative ↔ stock 페르소나 analysis**: 개념적 isomorphism일 뿐, 공통 깊은 모듈 아님(LLM 정책 상이).
- **#20 stock-* 분석 액션**: 평행 복붙 아니라 진짜 분기 behavior.
- **#21 container-actions `_runAction`**: 올바른 깊은 모듈 + 정당한 RPC 어댑터 — positive 기준점.

## 다음 단계

사용자가 후보를 고르면 step 3(grilling)에서 인터페이스 설계. 후보 1(tri narrative factory)이
`createSajuTriCache` precedent로 가장 근거 강함.
