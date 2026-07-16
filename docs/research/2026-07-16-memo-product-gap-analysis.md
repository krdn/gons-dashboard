# 메모 도메인 종합 분석 — UI/UX·기능 갭·시각화 설계 (2026-07-16)

> 분석 방법: 멀티에이전트 워크플로 17개 (코드 정독 7 영역 + 유사 제품 웹 리서치 6 테마 + 갭 분석 렌즈 3 + 완결성 비평 1).
> 렌즈 간 중복·상충은 비평 결과에 따라 이 문서에서 단일 로드맵으로 수렴함.
> 관련 선행 결정: 벡터 DB/그래프 DB 마이그레이션 기각 (2026-07-12) — 본 문서의 시각화 설계는 그 결정의 3단계
> ("메모 링크가 필요할 때 PG 조인 테이블로 시작") 진입에 해당한다.

## 1. 요약 (TL;DR)

- **강점**: 캡처(음성+AI 정리) → LLM 변환 프리셋 → 자동 분류 → 액션 추출 → 주간 다이제스트 → 인사이트로 이어지는
  자동화 파이프라인은 AI-native PKM 제품군 기준으로도 상위권. "미리보기 → 명시 승인" 모델은 Mem 1.0의 전면
  자동화 실패를 반증 사례로 갖는 업계 표준 패턴이라 **유지**가 맞다.
- **최대 전략 갭**: **쌓인 메모의 재발견(resurfacing·연결) 축이 전무**하다. 관계 표현이 스키마에 0개
  (memos.category 단일 FK뿐), 유사/관련 메모·백링크 등가물·시간 기반 재노출("N개월 전 오늘")·메모 단위
  리마인더 모두 부재. PKM 유저가 캡처 앱(Keep 등)을 떠나는 1순위 원인이 정확히 이 축이다.
- **즉시 고칠 신뢰 손상 4건(P0)**: ① 확인 없는 1클릭 하드 삭제(cascade 동반 소멸), ② LLM 오분류를 정정할 수단
  전무, ③ 카테고리 필터가 post-LIMIT 클라이언트 필터라 false-empty(레포 자체 교훈 "post-LIMIT .filter는 버그"와
  동일 패턴), ④ 목록 200건 캡의 무통보 절단.
- **시각화 결론**: 전역 그래프·수동 [[위키링크]]는 **만들지 않는다**(200+ 노트 hairball·개인 사용자가 유지 못 하는
  구조 — 커뮤니티 검증 합의). 대신 **LLM 엔티티 추출 → "관련 메모 top-5" 리스트 → (사용 신호 확인 후) 로컬
  1-hop 그래프 → (300건+ 후) 클러스터 조감** 순의 단계적 경로. 임베딩 API가 없는 스택 제약은 LLM 엔티티
  추출 + pg_trgm으로 우회하며, 기존 classifyMemo Haiku 호출에 합승하면 한계 비용이 거의 0이다.

## 2. 현재 상태 진단

### 2.1 기능 인벤토리 (구현 완료)

| 축 | 구현 | 비고 |
|---|---|---|
| 캡처 | 음성(Web Speech ko-KR, 승인-후-저장) + 텍스트 | 음성 초안 localStorage 보존 |
| AI 정리 | cleanup(원문 불변 + 정리본 병존) | 4,000자 컷, 모델 하드코딩(claude-sonnet-5) |
| 변환 | 빌트인 7 프리셋 + 커스텀/override, 3-provider 모델 선택 | 메모당 프리셋당 1본 upsert 교체 |
| 분류 | Haiku 동적 카테고리(참조 테이블 + FK, LLM이 신규 태그 upsert) | after() + cron sweep 2단 |
| 액션 | LLM 추출(todo/event) + 상태기계 + web-push 리마인더 | 48h 창, claim-first 트랜잭션 |
| 다이제스트 | 주간(KST 일 19:00 창) + 시간 가중 무작위 재부상 2건 | UNIQUE(user, week_end) 멱등 |
| 검색 | ILIKE 토큰 AND·필드 OR, 하이라이트+일치 뷰 자동 전환 | 인덱스 없음, 50건 캡 |
| 인사이트 | /memos/insights — streak·히트맵·퍼널·분포 | 매 요청 전량 인메모리 집계 |
| 구조 문서 | /memos/architecture — 정적 75노드 그래프 | 엣지 데이터는 있으나 **선을 그리지 않음** |

DB 7테이블: memos, memo_categories, memo_transformations, memo_transform_presets, memo_action_items,
memo_digests, memo_transform_settings.

### 2.2 구조적 한계 (코드에서 확인)

- **관계·태그 표현 0**: 다중 태그(N:M), 메모 간 링크, 유사도 어느 것도 없음. 카테고리는 메모당 1값.
- **검색 인덱스 전무**: tsvector/pg_trgm/pgvector 없음. pg_trgm GIN은 주석·스펙에 "임계 도달 시"로 예고만.
- **하드 삭제 + 버전 이력 없음**: deleteMemo는 즉시 cascade. 변환본 재생성도 이전 판 영구 소실.
- **페이지네이션 없음**: 목록 200캡·검색 50캡, "더 보기" 경로 없음.
- **오분류 정정 불가**: LLM 자동 분류 단일 경로. 수동 지정·재분류 UI 없음(설계 문서도 "v1로 지속" 자인).
- **모델 하드코딩 3곳**: cleanup·액션 추출·다이제스트가 'claude-sonnet-5' 리터럴 — resolveLatestModel 관례
  위반, 프록시 모델 소멸(gpt-5.3-codex 전례) 시 매일 실패 루프.
- **리마인더 단발**: reminded_at 1회 기록, 스누즈·반복·미구독자 폴백 없음.
- **첨부·이미지·오디오 원본 없음**: 본문 text만. 음성도 전사 텍스트만 보관.
- **카테고리 필터 false-empty**: 클라이언트 .filter가 LIMIT 컷 이후 적용.
- **iOS 모바일 음성 절벽**: Web Speech 불안정 → 사실상 텍스트 탭 강제.

## 3. 유사 제품 비교 — 테마별 핵심 교훈

| 테마 (제품) | 이 대시보드에 유효한 교훈 |
|---|---|
| 네트워크형 노트 (Obsidian·Logseq·Roam) | 전역 그래프 = "more fun to look at than navigate" (200+ 노트 hairball). **로컬 그래프(1-2 hop)는 크기 무관 유용**. 백링크 가치 조건 = 시간축 캡처 데이터 + **노트 하단 상시 노출**(Roam). unlinked mentions가 Aha 모먼트의 원천. daily notes("구조 고민 없이 붓고 사후 조직화")가 3앱 공통 승리 패턴 — 자동 분류가 있는 이 대시보드와 정확히 맞물림. 경고: PKM 실천자 60%가 지식 작업보다 시스템 가꾸기에 시간을 씀. |
| 객체 기반 노트 (Notion·Anytype·Capacities) | 개인 사용자의 전형적 실패 곡선: 열정적 셋업 → 2~6주 → 붕괴. **살아남는 구조 = 시간축 진입점(Today/This Week) + 자동 채움 속성 + 저마찰 캡처**, 버려지는 구조 = 다속성·다DB·카테고리 중심. 2025-26 트렌드: "사용자가 구조 유지" → "AI가 유지 비용 대납". AI Q&A(출처 인용)가 축적 노트의 재발견을 여는 유일한 규모-비례 기능 축. |
| 퀵 캡처 (Keep·Apple Notes·Simplenote) | **10초·원탭 캡처 임계**가 유지율(=파이프라인 입력량)을 결정. 캡처와 회수는 다른 문제 — Keep은 100+ 노트에서 회수가 무너져 이탈. **pin + archive 2단 라이프사이클**이 목록을 얇게 유지. 리마인더는 메모 문맥 안에 있어야 쓰임(Keep→Tasks 이관 반발). 음성 캡처+자동 전사는 표준이 됨. |
| AI-native (Mem·Reflect·Tana·Heptabase) | 검증된 것: semantic search 표준화, 맥락 기반 resurfacing(Mem Heads Up), cross-note synthesis(Reflect, 100+ 노트부터). **과장이었던 것: 전면 자동 self-organizing(Mem 1.0 실패)** → "제안 + 사용자 확인 + 롤백"으로 후퇴. AI가 노트를 편집하면 버전 히스토리가 필수가 됨. Tana supertag는 학습비용 5-10h — 개인 도구는 스키마 최소가 승리. MCP 노출(Heptabase 2025-12)이 표준 배관화. |
| 시각화 기법 | 수백 노드 = d3-force/순수 SVG로 충분(react-force-graph는 수천부터). **그래프보다 top-N 리스트가 사용 빈도 높음**(Smart Connections 78만 DL). 레이아웃은 요청 시점이 아닌 배치 사전 계산(이 레포의 build-time snapshot 관례와 일치). 임베딩 2D 프로젝션은 거리 해석 유도 UI 금지. 캘린더 히트맵 = 습관 추적 + "그 날로 점프" 이중 용도. |
| LLM 노트 기능 | 검색 정석 = 2-stage(빠른 retrieval → 소수 후보 LLM rerank). **임베딩 없이 semantic 연결을 얻는 실용 패턴 = LLM 엔티티 추출(LightRAG류 경량화) → 엔티티 공유 = related 엣지**. resurfacing 2계열: Readwise식 decay / Napkin식 serendipity("주기 재계산으로 옛 메모가 새 연결 획득"). chat-with-notes는 개인 규모에선 keyword retrieval + long-context 주입으로 충분, 출처 인용은 UX 필수. |

## 4. 통합 로드맵 (렌즈 3개 + 비평 조정 후)

우선순위: P0 = 즉시(신뢰 회복·저비용), P1 = 다음(재발견 축 개통), P2 = 사용 신호 확인 후, P3 = 보류/조건부.
비평(critic)이 지적한 렌즈 간 중복 7건은 병합, 과잉 설계 경고 5건은 강등 반영.

### P0 — 신뢰 손상 복구 + 최저비용 재발견 (전부 S~M)

| # | 항목 | 종류 | 규모 | 핵심 근거 |
|---|---|---|---|---|
| 1 | 삭제 확인 2-click(버튼 전환 "삭제→정말 삭제?") | 수정 | S | 도메인 유일의 비가역 1클릭 + cascade. UI만으로 완결 |
| 2 | 카테고리 수동 정정(배지→드롭다운) + updateMemoCategoryAction | 추가 | S | Mem 1.0 교훈 "자동 + 정정 가능". 스키마 변경 0 |
| 3 | 카테고리 필터 서버 WHERE 이동 | 수정 | S | false-empty 버그. email-settings 교훈과 동일 패턴 |
| 4 | pin + archive 라이프사이클(pinned_at·archived_at 2컬럼) | 추가 | M | 두 렌즈 독립 수렴. 삭제 완충 + 200캡 지연 + 목록 경량화 동시 해결 (Keep 검증 패턴) |
| 5 | 'On this day' 위젯 + 다이제스트 serendipity 섹션 | 추가 | S | LLM 0·날짜 쿼리만으로 재발견 축 즉시 개통 |
| 6 | 메모 데이터 내보내기(Markdown/JSON dump) | 추가 | S | critic 지적 — 하드 삭제+버전 없음 구조에서 1인 도구 최대 단일 실패점. compose+env 실종 사고 전례 |
| 7 | Non-goal 명문화: 전역 그래프·수동 위키링크·임베딩(pgvector) 미도입 + 재논의 트리거(메모 1,000건+, 연결 오탐 반복 불만, 프록시 임베딩 endpoint 추가) | 유지 | S | 후속 세션 재논쟁 차단. 2026-07-12 기각 결정과 일관 |

### P1 — 재발견·연결 축 개통 (시각화 1단계 포함)

| # | 항목 | 종류 | 규모 | 핵심 근거 |
|---|---|---|---|---|
| 8 | **LLM 엔티티 추출 파이프라인(memo_entities)** — classifyMemo 응답 스키마에 entities 합승 | 추가 | M | 임베딩 없이 의미 연결을 얻는 유일한 실용 경로(LightRAG류). 한계 비용 ≈ 0. ⚠️ 스키마 단일화(아래 §5.2) + classify cron 백필 구멍 보정 + 분류 정확도 회귀 eval 필수 |
| 9 | **'관련 메모 top-5' 패널** — 카드 하단 상시 노출, 근거 배지("'프로젝트X' 공유") 필수 | 추가 | M | 그래프 전에 리스트로 실효성 검증(Smart Connections·Roam 배치 교훈). 초기엔 on-demand self-join(수백 건 규모 충분 — memo_links 캐시는 보류) |
| 10 | 목록 keyset 페이지네이션('더 보기' 버튼) | 추가 | M | 200캡 무통보 절단 해소. 기존 (user_id, created_at) 인덱스 그대로 |
| 11 | 전역 퀵 캡처('n' 모달) + 작성 폼 Ctrl+Enter·피드백 개선 | 추가 | M | 10초 캡처 임계. 본문만 치고 Enter — 분류는 LLM 사후 처리와 정확히 맞물림. PWA share target은 2단계 |
| 12 | 메모 단위 리마인더("N일 후 다시 보기", remind_at 컬럼) | 추가 | M | 리마인더는 메모 문맥 안에. 기존 cron 라우트에 targetSelect 합류 — 신규 cron 불필요 |
| 13 | 다이제스트 carry-over(미완료 액션 이월 + at-risk 롤업) | 수정 | S | 두 스펙이 서로 "후속 통합" 예고한 유일한 교차 항목 — 이미 합의된 다음 스텝 |
| 14 | 시간 버킷 헤더(오늘/이번 주/이전) — SearchableMemoList에 단일 구현 | 추가 | S | 생존 구조 최대 공통분모 = 시간축 진입점. 렌즈 간 구현 위치 상충은 검색·필터와 같은 화면으로 단일화 |
| 15 | LLM 모델 하드코딩 3곳(cleanup·추출·다이제스트) → resolveLatestModel 전환 | 수정 | S | 모델 ID 소멸 시 매일 실패 루프(전례 있음). 운영 리스크 제거 |

### P2 — 사용 신호 확인 후

| # | 항목 | 게이트 조건 |
|---|---|---|
| 16 | **로컬 그래프 위젯**(현재 메모 중심 1-hop, 노드 ≤15, 순수 SVG radial — §5.3) | P1 관련 메모 패널의 클릭이 실제 발생 |
| 17 | pg_trgm GIN 인덱스 + 유사도 보조 신호 + 검색 서버 필터 통합 (LLM rerank는 보류) | 검색 지연 체감 또는 관련 메모 오탐 관측 |
| 18 | 재부상 단일 트랙 개선(카테고리 다양성 → carry-over → 엔티티 연결 가중) — resurface.ts 3갈래 수정 경합을 순차로 | P0 #5 배포 후 |
| 19 | 액션 아이템 기한 인라인 편집 + dismissed 복구 전이 + optimistic update | 스펙 예고분 |
| 20 | 접근성·모바일 마감(44px 터치 타깃, aria-live, tablist) + 메모 서브내비 탭 | — |
| 21 | 인사이트 히트맵 요일 고정 + 셀 클릭 → 해당 날짜 목록 점프 | — |
| 22 | 메모 도메인 LLM 예산 가드(saju의 assertBudgetOk+logSpend 이중 장치 이식) | 신규 LLM 호출(엔티티 등) 추가 시 |

### P3 — 보류 (조건부 재평가)

| 항목 | 재평가 트리거 |
|---|---|
| Ask my memos(Q&A, retrieval+long-context+출처 인용) | 코퍼스 100건+ & 관련 메모 기능 정착. **프롬프트 인젝션 방어(본문≠지시) 필수 포함** |
| memo_links 엣지 캐시 테이블 + 일일 cron | on-demand self-join이 실제로 느려질 때 (critic이 P1→보류 강등) |
| 클러스터 조감 뷰(엔티티 동시출현 기반, 인사이트 블록) | 메모 300건+ & 로컬 그래프 사용 신호. 카테고리 분포 도넛과 중복 주의 |
| 메모 MCP 도구(packages/mcp-memo) | Claude Code에서 메모 접근 수요가 실제 반복 관측 |
| 첨부·이미지·오디오 원본 보관 | 이미지 캡처 요구 반복 관측. 오브젝트 스토리지 신설 필요 |
| 모바일 음성 대안(MediaRecorder+서버 전사) | iOS 캡처 수요 관측 |
| 본문 혼합형 체크리스트('- [ ]' 토글 + 액션 양방향 동기화) | 수요 관측 |

## 5. 메모 시각화·연관 관계 — 상세 설계

### 5.1 엣지 생성 방법 비교

| 방법 | 품질 | 비용 | 판정 |
|---|---|---|---|
| 수동 [[위키링크]] | 높음(의도 반영) | 사용자 유지 규율 — **개인이 유지 못 하는 대표 구조** | ❌ 기각 |
| 카테고리 공유 | 너무 굵음(메모당 1값) | 0 | 보조 가중치만 |
| 시간 인접성 | 단독으론 잡음 | 0 | 타이브레이커만 |
| pg_trgm 유사도 | 표면 어휘 겹침만 | DDL 1건 | 보조 신호(P2) — 검색 개선과 이중 용도 |
| **LLM 엔티티·키워드 추출** | **의미 기반 — 임베딩 없는 유일한 실용 경로** | 기존 분류 호출 합승 시 ≈ 0 | ✅ **주 신호(P1)** |
| pgvector 임베딩 | 최고 | 임베딩 공급자 선결(프록시에 없음) | ❌ 보류(재논의 트리거 명문화) |

추천 조합: **엔티티 overlap(주) + pg_trgm(보조) + 카테고리/시간(가중치)**. 모든 엣지에 "왜 연결됐는지"
근거를 상시 표기한다 — 설명 불가능한 선은 장식이다.

### 5.2 저장 설계 (단일 스펙 — 렌즈 간 불일치 수렴)

```sql
-- P1: 엣지 원료
CREATE TABLE memo_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memo_id uuid NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- cron 스코프 비정규화 (액션 아이템 관례)
  entity text NOT NULL,          -- 소문자 정규화
  kind text NOT NULL,            -- CHECK: 'person'|'project'|'concept'|'place'|'etc' (5종으로 통일)
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(memo_id, entity)
);
CREATE INDEX ON memo_entities (user_id, entity);
-- 엔티티 상한: 메모당 최대 5개 (LLM 프롬프트에서 강제 — 8개 아님, 난립 방지 우선)
-- memo_links 캐시 테이블은 P3 보류 — on-demand self-join이 느려질 때 도입
```

주의(critic 검증 사항):
- **classify cron 백필 구멍**: memo-classify sweep은 `category IS NULL`만 대상 → 기분류 메모에 엔티티가
  영원히 안 닿음. sweep 조건에 "엔티티 미추출" OR 조건을 추가하거나 1회성 백필 스크립트 필요.
  (엔티티는 액션 추출과 달리 상대 날짜 문제가 없어 과거 전체 백필이 안전.)
- **분류 정확도 회귀 가드**: 분류 프롬프트에 엔티티 추출을 합승시키면 Haiku 분류 정확도 회귀 가능 —
  이메일 분류 eval 하네스 패턴의 경량판(golden set 스냅샷)을 함께 추가.

### 5.3 렌더링 설계

- **widgets/memo-architecture의 WorkflowGraph는 재사용 불가**: 엣지 데이터(from/to)가 있는데도 선을 그리지
  않는 고정 5열 CSS grid. 동적 노드 수 + 가중 엣지를 수용할 수 없음.
- **이식할 것**: NodeDetailPanel(클릭→하단 상세), aria-pressed 칩 필터, stale 선택 해제 인터랙션 골격.
- **로컬 그래프(P2)**: 외부 의존성 0의 순수 SVG. 서버에서 radial 배치 계산(중심 고정, 이웃을 score 내림차순
  각도 배치 — 순수 함수라 단위 테스트 가능). 엣지 굵기 = score, hover 시 공유 엔티티 라벨, 노드 ≤15.
  진입점은 관련 메모 패널의 "그래프로 보기" 토글 — **리스트가 기본, 그래프는 opt-in**.
- **전역 그래프는 만들지 않음** (P0 #7 non-goal).

### 5.4 "예쁜 장난감" 방지 장치 4개

1. 그래프보다 **리스트를 먼저** 출시하고, 관련 메모 클릭 신호가 없으면 그래프 미착수 (출시 게이트).
2. 전역 그래프·수동 위키링크 미도입을 스펙 non-goal로 명문화 (재논의 트리거 포함).
3. 모든 엣지에 근거(공유 엔티티·유사도) 상시 표기 — 설명 가능성.
4. 링크 데이터의 **두 번째 소비처 확보**: 주간 다이제스트 재부상을 "이번 주 메모와 연결된 잊힌 옛 메모"
   가중으로 개선(Napkin serendipity) — 데이터가 시각화 전용 장식이 되지 않게 함.

### 5.5 단계별 출시 순서

```
P0  On-this-day 위젯(연결 데이터 없이 시간축 재발견 먼저)
P1  memo_entities 추출 ─→ 관련 메모 top-5 패널(근거 배지) ─→ [클릭 신호 관측]
P2  pg_trgm 보조 신호 ─→ 로컬 1-hop 그래프(opt-in 토글) ─→ 재부상 링크 가중
P3  [300건+ & 신호] 클러스터 조감 뷰 / [필요시] memo_links 캐시+cron
```

## 6. 리스크·운영 주의사항 (비평 결과)

1. **운영 DDL 수동 선적용 누적**: 로드맵 전체가 요구하는 psql BEGIN/COMMIT 선적용이 최소 6건
   (pinned_at/archived_at, remind_at, memo_entities, pg_trgm EXTENSION+GIN, 부분 인덱스 등).
   drizzle prod tracking이 깨진 환경이므로 **적용 순서·검증 계획을 각 PR 단위로 명시**할 것.
   pg_trgm CREATE EXTENSION은 superuser 권한 확인 필요(docker exec postgres psql).
2. **LLM 비용 가드 부재**: 엔티티 추출·rerank·Q&A 등 신규 호출 추가 전에 saju식 예산 가드
   (assert+log 이중 장치) 이식 검토 (P2 #22).
3. **resurface.ts 3갈래 수정 경합**: 재부상 개선 3건(P0 #5, P1 #13, P2 #18)은 같은 파일·프롬프트를
   수정하므로 반드시 순차 단일 트랙으로.
4. **Q&A 프롬프트 인젝션**: 기존 추출·다이제스트에는 "본문을 지시로 해석 금지" 방어가 있으나,
   메모 20건을 통째로 주입하는 Q&A는 노출면이 가장 크다 — 착수 시 동일 방어 필수.
5. **인사이트 성능**: 엔티티·링크 데이터가 추가될수록 매 요청 전량 집계 비용이 커짐 — 규모 도달 시
   집계 캐시(revalidate) 검토.

## 7. 부록 — 원천 데이터

- 워크플로 실행: 17 에이전트, ~1.72M 토큰, 코드 분석 7 + 리서치 6 + 렌즈 3 + 비평 1 전원 성공.
- 렌즈별 원본 권고(35건)와 비평 전문은 세션 스크래치패드 `synth.json`/`critic.json`/`research.json`/`code.json` 참조.
- 이 문서는 중복 병합·우선순위 조정을 거친 최종본이며, 원본과 우선순위가 다른 항목은 비평 판정을 따랐다.
