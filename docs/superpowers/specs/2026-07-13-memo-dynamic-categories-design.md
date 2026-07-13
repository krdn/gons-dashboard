# 메모 카테고리 완전 동적화 (LLM 자율 태그 생성)

- **날짜**: 2026-07-13
- **도메인**: Memo
- **선행**: `2026-07-12-memo-category-tagging` (고정 6종 분류 도입)
- **목표**: 새 메모가 기존 태그로 잘 분류되지 않을 때, LLM이 **코드 수정·재배포 없이** 새 태그를 만들어 즉시 사용·필터·표시할 수 있게 한다.

## 1. 문제

현재 카테고리 6종(`idea/todo/journal/reference/draft/etc`)이 **세 곳에 하드코딩**되어 새 태그 추가에 코드 수정 + DB 배포가 필요하다:

1. `entities/memo/model/category.ts` — TS 리터럴 튜플 `MEMO_CATEGORY_IDS` (`z.enum`·타입 가드에 사용)
2. DB `memos_category_check` CHECK 제약 (마이그레이션 0041) — 6종 화이트리스트
3. `entities/memo/api/classifyMemo.ts` — LLM 프롬프트에 6종 텍스트 박힘 + `z.enum(MEMO_CATEGORY_IDS)`

추가로 UI(`SearchableMemoList`·`MemoCard`)가 정적 배열 `MEMO_CATEGORY_IDS`를 순회해 필터 칩·배지를 그린다.

## 2. 핵심 전환: 닫힌 enum → 열린 DB 사전

카테고리를 코드 상수가 아니라 **`memo_categories` 참조 테이블의 행**으로 만든다. LLM이 분류 시 기존 태그 목록을 받아 재사용을 강하게 우선하되, 정말 안 맞으면 새 slug+한글 라벨을 생성하고, 그 태그가 DB에 없으면 자동 등록(upsert)한다.

### 2.1 slug + label 분리

- **`id`(slug)**: 영문 kebab-case (`meeting-log`). FK 키·필터 파라미터·URL로 안정적. 한글 띄어쓰기 변주(`회의록` vs `회의 록`)로 인한 중복 태그 사고 방지.
- **`label_ko`**: 표시용 한글 (`회의록`). 칩·배지에 노출.

LLM이 둘 다 생성하되, slug는 `^[a-z][a-z0-9-]*$` 형식을 프롬프트+Zod로 강제한다.

### 2.2 난립 억제 (기존 태그 강하게 우선)

분류 프롬프트에 **현재 전체 태그 목록(slug+label)을 동적 주입**하고, "기존 태그 중 하나가 조금이라도 맞으면 반드시 재사용, 정말 어느 것에도 안 맞을 때만 새 태그 제안"을 강하게 지시한다. 새 태그는 최후 수단.

## 3. 데이터 모델

### 3.1 새 테이블 `memo_categories`

```
id          text PRIMARY KEY            -- slug (kebab-case)
label_ko    text NOT NULL              -- 표시 라벨
is_seed     boolean NOT NULL DEFAULT false  -- 시드 6종 여부 (표시 정렬·삭제 정책용)
created_at  timestamptz NOT NULL DEFAULT now()
```

- 시드 6종 INSERT: `idea/todo/journal/reference/draft/etc` + 기존 한글 라벨, `is_seed=true`.
- 전역 사전 (사용자별 아님) — 개인 대시보드라 태그를 사용자 간 공유해도 무해하고, 단일 사용자 환경이다.

### 3.2 `memos.category` 제약 변경

- `memos_category_check` CHECK 제약 **DROP**.
- `memos.category` → `memo_categories(id)` **FK 추가** (`ON DELETE SET NULL`). NULL 허용 유지(미분류).
  - FK로 "존재하는 태그만 허용"은 유지되지만 목록은 데이터로 확장 가능 — 이것이 "코드 수정 없이"의 기술적 핵심.

### 3.3 마이그레이션 순서 (운영 주의)

DDL이라 CLAUDE.md Gotcha·memory(`drizzle-kit-migrate-prod-broken`) 규칙 적용 — **운영 DB에 psql BEGIN/COMMIT로 선적용 후 이미지 배포**.

1. `CREATE TABLE memo_categories` + 시드 6종 INSERT
2. `ALTER TABLE memos DROP CONSTRAINT memos_category_check`
3. `ALTER TABLE memos ADD CONSTRAINT memos_category_fk FOREIGN KEY (category) REFERENCES memo_categories(id) ON DELETE SET NULL`

Drizzle 스키마(`schema.ts`)에 `memoCategories` 테이블 + `memos.category` FK 관계를 반영해 `db:generate` spurious diff를 막는다.

## 4. 코드 변경

### 4.1 `entities/memo/model/category.ts` — 상수를 시드 정의로 강등

- `MEMO_CATEGORY_IDS`/`MEMO_CATEGORY_LABELS`는 **시드 데이터 정의**로만 유지 (DB 시드 소스 + fallback). 이름을 `SEED_MEMO_CATEGORIES`로 바꿔 의미를 명확히 한다.
- `MemoCategory` 닫힌 유니온 타입 → `type MemoCategory = string` 로 완화 (slug).
- `isMemoCategory`(닫힌 타입 가드) 제거. 대신 slug 형식 검증 `isValidCategorySlug(value): value is string` (`^[a-z][a-z0-9-]*$`, 길이 상한) 추가 — LLM 출력 방어.

### 4.2 카테고리 리포지토리 — `entities/memo/api/categoryRepo.ts` (신규)

```ts
listCategories(): Promise<MemoCategoryRow[]>          // 전체, 시드 먼저 + created_at
upsertCategory(id, labelKo): Promise<void>           // ON CONFLICT DO NOTHING (라벨은 최초 등록만)
```

`listCategories`는 서버 컴포넌트가 필터 칩·배지 라벨 맵을 만들 때 사용.

### 4.3 `entities/memo/api/classifyMemo.ts` — 2단계 동적 분류

- Zod 스키마: `z.object({ category: z.string().regex(SLUG_RE), labelKo: z.string().min(1).max(20) })`.
- 프롬프트: 고정 6종 텍스트 제거. 대신 **현재 태그 목록을 런타임 주입**:
  ```
  기존 태그(가능하면 반드시 재사용):
  - idea (아이디어)
  - todo (할 일)
  ... (DB에서 로드)
  기존 태그 중 하나라도 맞으면 그 slug를 그대로 써라.
  정말 어느 것에도 맞지 않을 때만 새 태그를 제안:
  {"category":"kebab-case-영문-slug","labelKo":"짧은 한글 라벨"}
  ```
- `classifyAndPersistMemoCategory` 흐름:
  1. `listCategories()`로 현재 목록 로드 → 프롬프트 구성.
  2. LLM 호출 → `{category, labelKo}`.
  3. slug 형식 재검증 (실패 시 `etc` fallback).
  4. `upsertCategory(category, labelKo)` — 새 태그면 등록, 기존이면 no-op.
  5. `setMemoCategory(memo.id, category)`.
  - 순서 중요: **upsert(4)가 setMemoCategory(5)보다 먼저** — FK 위반 방지.

### 4.4 `entities/memo/api/memoRepo.ts`

- `setMemoCategory(id, category: string)` — 타입 `MemoCategory`(이제 string) 유지, 시그니처 그대로 동작.

### 4.5 UI — 정적 배열 → 서버 로드 목록

**서버(페이지)**: `/memos` 페이지(서버 컴포넌트)가 `listCategories()`를 로드해 `SearchableMemoList`에 `categories: {id, labelKo}[]` prop으로 전달.

**`SearchableMemoList.tsx`**:
- `MEMO_CATEGORY_IDS`/`MEMO_CATEGORY_LABELS` import 제거.
- 필터 칩을 `props.categories`로 순회 렌더.
- 라벨 조회를 `categories`에서 만든 `Map<id, labelKo>`로 (statusText·빈 상태 메시지).
- 현재 표시 중인 메모에 없는 카테고리는 칩을 숨길지/보일지 → **전체 등록 태그를 모두 칩으로 표시** (사용자가 필터 존재를 인지). 개인 규모라 칩 개수 부담 낮음.

**`MemoCard.tsx`**: 배지 라벨을 정적 `MEMO_CATEGORY_LABELS[category]`에서 조회 → prop으로 받은 라벨 맵 또는 category slug fallback. (MemoCard는 개별 카드라 라벨 맵을 상위에서 주입받거나, 최소 slug 그대로 표시.)

## 5. 에러 처리 / 폴백

- **LLM이 형식 위반 slug 반환**: Zod regex 실패 → catch → `etc`로 저장 (기존 `llm-unavailable`과 동일한 안전 강등).
- **DB 조회 실패로 태그 목록 없음**: `SEED_MEMO_CATEGORIES` fallback으로 프롬프트 구성 (최소 6종 재사용은 보장).
- **FK 위반**: upsert 선행으로 구조적으로 불가능. 방어적으로 setMemoCategory 실패 시 로그.
- **삭제된 카테고리 참조**: FK `ON DELETE SET NULL`로 메모는 미분류로 복귀 (cron이 재분류).

## 6. 테스트

- `category.test.ts`: `isValidCategorySlug` — 유효/무효 slug 케이스.
- `classifyMemo.test.ts`: 스키마 regex 검증 (유효 slug 통과, 대문자·공백·한글 slug 거부). 프롬프트에 주입된 목록 반영 확인.
- `categoryRepo.test.ts` (통합, TEST_DATABASE_URL): upsert 멱등, listCategories 정렬.
- `SearchableMemoList.test.tsx`: `categories` prop 기반 칩 렌더, 동적 태그 필터링.
- `MemoCard.test.tsx`: 동적 slug 배지 라벨 표시.

## 7. 범위 밖 (YAGNI)

- 태그 수동 편집/이름변경/병합 UI — 이번 범위 밖. LLM 자율 + 사용자는 관찰만.
- 태그 개수 상한/폭주 하드캡 — "기존 우선" 프롬프트로 억제 충분하다고 판단. 실제 난립 관측 시 후속.
- 사용자별 태그 사전 — 단일 사용자 환경이라 전역으로 충분.

## 8. 배포 체크리스트

1. 운영 DB에 psql로 §3.3 DDL 3단계 선적용 (BEGIN/COMMIT).
2. `pnpm typecheck && pnpm lint && pnpm test && cd apps/dashboard && pnpm build` (features barrel seam·build 필수).
3. PR → CI → 이미지 빌드 → digest 핀 배포 → health/route 검증.
