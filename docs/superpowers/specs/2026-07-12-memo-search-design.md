# 메모 검색 기능 설계

- 날짜: 2026-07-12
- 상태: 확정 (사용자 전권 위임 — 설계 판단 Claude)
- 관련: `docs/superpowers/specs/2026-07-09-memo-transform*` (메모 변환 도메인)

## 1. 배경·목표

/memos 페이지는 최신 200개(`LIST_MEMOS_LIMIT`)를 시간순으로 나열만 한다. 메모가
쌓일수록 "예전에 적어둔 그것"을 다시 찾을 수단이 없다 — 검색의 핵심 가치는
**오래된 메모 재발견**이므로, 화면에 이미 로드된 200개만 거르는 방식으로는 부족하다.

**목표**: 제목·원문·정리본·AI 변환본을 대상으로 사용자의 전체 메모를 검색하고,
결과를 기존 MemoCard UI 그대로(편집·삭제·AI 정리 동작 유지) 하이라이트와 함께 보여준다.

## 2. 접근 비교

| 접근 | 장점 | 단점 | 판정 |
|---|---|---|---|
| A. 클라이언트 필터 (로드된 200개) | 구현 최소, 지연 0 | 200개 컷 밖 옛 메모 검색 불가 — 핵심 가치 상실 | 기각 |
| B. **서버 ILIKE 검색 (Server Action)** | 전체 메모 검색, stock-master 전례 재사용, **마이그레이션 0건** | 키 입력마다 서버 왕복 (디바운스로 완화) | **채택** |
| C. tsvector FTS | 랭킹·형태소 | PG 기본 파서는 한국어 형태소 미지원(mecab 필요), 개인 규모에 과잉 | 기각 |

**B 선택 근거**: 개인 대시보드 규모(사용자당 수백 행)에서는
`memos_user_created_idx`(user_id 선행)로 사용자 행만 좁힌 뒤 ILIKE 순차 비교로 충분하다.
stock-master처럼 pg_trgm GIN 인덱스가 필요해지는 임계(수천 행 × 공개 트래픽)와 거리가
멀고, 이 레포는 운영 마이그레이션이 수동 psql이라(드리즐 tracking 미인식) **DDL 없는
설계 자체가 리스크 절감**이다. pg_trgm 확장은 0026에서 이미 생성돼 있으므로, 훗날
느려지면 `memos(title/cleaned/raw) gin_trgm_ops` 인덱스만 추가하면 된다 (코드 불변).

## 3. 검색 시맨틱

- **토큰화**: 공백 분리, 최대 8토큰. 토큰 간 **AND** ("LG 위약금" → 둘 다 포함하는 메모).
- **토큰 매칭**: 토큰별로 `title | raw_content | cleaned_content` ILIKE OR
  `EXISTS(memo_transformations.content ILIKE)` — 변환본(요약·할일 등)은 원문을 재서술할
  수 있어 포함해야 사용자 멘털 모델("카드에서 보이는 모든 텍스트")과 일치한다.
- **LIKE 이스케이프**: `\`, `%`, `_` 를 백슬래시 이스케이프 (PG LIKE 기본 ESCAPE `\`).
- **정렬·상한**: `created_at DESC LIMIT 50` — 메모는 시간 지향 데이터라 최신순이 자연스럽다.
  50개 도달 시 UI에 "최근 50개만 표시" 명시 (침묵 절단 금지).
- **쿼리 가드**: trim 후 1~100자. 빈 쿼리는 검색 비활성(원래 목록 표시).

## 4. 아키텍처 (FSD)

```
entities/memo
├── model/search.ts          # tokenizeSearchQuery, escapeLike (순수 — client/server 공용)
├── api/memoRepo.ts          # + searchMemos(userId, query)  [server]
├── server.ts                # + searchMemos, tokenizeSearchQuery export
└── client.ts                # + tokenizeSearchQuery export
└── ui/MemoCard.tsx          # + highlightTerms?: string[] (제목·본문 하이라이트)

features/memo-search          # 신설
├── api/searchMemosAction.ts # "use server" — auth → searchMemos. 읽기 전용(revalidate 없음)
├── client.ts                # searchMemosAction re-export (RPC 경계만 — barrel seam 패턴)
└── ui/SearchableMemoList.tsx# 검색바 + (비활성: MemoList 원본 / 활성: 결과 MemoList)

features/memo-manage/ui/MemoList.tsx  # + highlightTerms?, onMutated? (편집/삭제 성공 후 콜백)

shared/ui/Highlighted.tsx    # <mark> 하이라이트 순수 컴포넌트 + splitByTerms 헬퍼

widgets/memo/ui/MemoWidget.tsx        # MemoList → SearchableMemoList 교체
```

- features→features(memo-search→memo-manage)는 이 레포의 의도적 허용 예외.
- server-only 함수는 barrel에 섞지 않는다(Gotcha #7) — memo-search의 client.ts는
  Server Action만 re-export, UI는 경로 직접 import(레포 관례).

### 데이터 흐름

1. 페이지는 지금처럼 memos(200) + 전체 transformations + presets를 서버에서 로드.
2. 검색어 입력 → 300ms 디바운스 → `searchMemosAction(q)` → `Memo[]` (≤50).
3. `transformationsByMemo` 맵은 **사용자 전체** 변환본이므로 200개 밖 검색 결과에도 유효.
4. 검색 중 편집·삭제 성공 시 `onMutated` → 같은 쿼리 재검색 (클라 상태 신선도 유지).
   — 목록 모드에서는 기존처럼 `revalidatePath`가 서버 props를 갱신하므로 콜백 불필요.
5. 응답 순서 역전 방지: 요청 시퀀스 번호로 stale 응답 폐기.

## 5. UI/UX 상세

배치: composer 아래·목록 위. 페이지 narrow 폭 그대로.

**검색바** (`role="search"`)
- input `type="search"`(WebKit 기본 × 숨김), placeholder `메모 검색 — 제목·내용·변환본`,
  좌측 🔍 (이모지 — 기존 아이콘 어휘 🎙✍⚙ 와 일치), 우측: 진행 스피너 + × 지우기 버튼.
- 스타일: `rounded-lg border-neutral-200 text-sm` — MemoList 편집 폼 입력과 동일 톤.
- 키보드: `ESC` 지우기(IME 조합 중 무시 — `isComposing` 가드), `/` 전역 포커스
  (다른 입력 필드에 포커스 없을 때만).

**상태 머신** (query.trim() 비면 항상 idle)
| 상태 | 표시 |
|---|---|
| idle | 원본 200개 목록 (기존 그대로) |
| 첫 검색 중 | "검색 중…" (이전 결과 없음일 때만) |
| 재검색 중 | 이전 결과 유지 + 입력창 스피너 (레이아웃 점프 방지) |
| 결과 있음 | `N개 결과` 카운트(aria-live=polite) + 하이라이트된 MemoCard 목록 |
| 결과 없음 | `‘{q}’와 일치하는 메모가 없습니다` + 힌트 문구 |
| 실패 | `검색에 실패했습니다 — 다시 시도해 주세요` (다음 입력에서 자동 재시도) |

**하이라이트**
- 토큰별 대소문자 무시 `<mark>` (`bg-amber-200/70` — 라이트 모드 고정 팔레트에 안전).
- 제목 + 현재 보이는 본문 뷰(정리본/원문/변환본 칩 전환 모두)에 적용 —
  변환본에서만 일치한 경우 사용자가 칩을 눌러 확인하는 흐름과 일치.
- 결과 카드는 일반 카드와 동일 기능(AI 정리·편집·삭제) 유지.

## 6. 에러 처리

- 액션: 비로그인 throw(기존 관례), repo 실패는 `{kind:"failed"}` — UI가 실패 문구 표시.
- 클라: 액션 reject도 동일 처리. stale 응답은 시퀀스 가드로 무시.
- 서버: 길이·토큰 수 가드로 폭주 쿼리 차단. 읽기 전용이라 부작용 없음.

## 7. 테스트 계획

1. `model/search.test.ts` — 토큰화(공백·중복·8개 컷), escapeLike(`% _ \`) 순수 유닛.
2. `shared/ui/Highlighted.test.tsx` — 매칭 분절, 대소문자, 겹치는 토큰(긴 토큰 우선), 빈 terms.
3. `memoRepo.test.ts` 추가 — searchMemos 통합(TEST_DATABASE_URL): AND 시맨틱, 변환본 매칭,
   타인 메모 배제, 이스케이프 문자, 정렬.
4. `SearchableMemoList.test.tsx` — jsdom: 디바운스 후 액션 호출, 결과/빈/실패 상태 렌더,
   ESC 클리어, idle 복귀 (fake timers + 액션 모듈 mock).
5. 액션 유닛 — auth 가드, 길이 가드 (`memoManageActions.test.ts` 관례).

## 8. 비범위 (YAGNI)

- 페이지네이션·무한 스크롤 (50개 상한 명시로 대체)
- 검색어 URL 동기화 (개인 도구 — 공유 링크 수요 없음, RSC 재실행 왕복 회피)
- pg_trgm 인덱스 (임계 도달 시 DDL만 추가)
- 대시보드 홈 RecentMemos 위젯 검색 (페이지 전용)
- 형태소·유사도 랭킹
