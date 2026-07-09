# 메모 AI 정리 프리셋 설정 — 설계 스펙

- **날짜**: 2026-07-09
- **상태**: 설계 승인됨 (접근 A + 전용 페이지 UI)
- **선행 스펙**: `2026-07-09-memo-transform-design.md` (프리셋 7종 + 변환본 병존)

## 1. 목적

메모 스타일 변환(transform)의 프리셋별 프롬프트를 사용자가 설정할 수 있게 한다.

- 기본 프리셋 7종(정돈·매끄럽게·요약·구조화·할 일 추출·일기체·이메일 초안)의 스타일 지시를 **편집**할 수 있고, **언제든 기본값으로 복구**할 수 있다.
- 사용자가 **커스텀 프리셋을 추가**(자유 페르소나·역할 부여 포함)하고 수정·삭제할 수 있다.

**범위 제외 (사용자 확정)**: 음성 받아쓰기 정리(cleanup, `cleanup-transcript.ts`)는 뜻 보존 안전장치와 강결합이라 설정 대상이 아니다 — 고정 유지.

## 2. 저장 모델 — 코드 기본값 + DB override/custom 병합 (접근 A)

기본 7종의 원본(source of truth)은 지금처럼 코드(`features/memo-transform/lib/prompts.ts`)에 유지한다.

| 상태 | DB | 해석 |
|---|---|---|
| 기본 프리셋 (미수정) | 행 없음 | 코드 기본값 사용 — 배포로 기본 프롬프트가 개선되면 자동 반영 |
| 기본 프리셋 (수정됨) | slug가 빌트인 ID인 override 행 | 행의 instruction·fidelity_guard 사용 |
| 기본값 복구 | override 행 **DELETE** | 자동으로 코드 기본값 폴백 |
| 커스텀 프리셋 | slug가 `c-*`인 행 | 행 자체가 정의 (수정·삭제 자유) |

`email_settings`의 "행 없으면 코드 기본값" 패턴의 확장. drift가 원천적으로 불가능하다.

기각한 대안: 7종 전부 DB 시드(접근 B) — 기본 프롬프트 개선 배포가 기존 사용자에게 반영되지 않고, 코드-DB drift 감시가 필요.

## 3. 데이터 모델

### 3.1 신규 테이블 `memo_transform_presets`

```
id             uuid PK defaultRandom
user_id        uuid NOT NULL FK → users(id) ON DELETE CASCADE
slug           text NOT NULL   -- 빌트인 override: 'tidy' 등 그대로 / 커스텀: 'c-<랜덤8자>' (서버 생성)
label          text NOT NULL   -- 칩·목록 표시명
instruction    text NOT NULL   -- 2층 스타일 지시
fidelity_guard boolean NOT NULL DEFAULT true  -- 원문 충실 가드 적용 여부
created_at / updated_at timestamp NOT NULL DEFAULT now()

UNIQUE(user_id, slug)
CHECK slug ~ '^[a-z0-9-]{1,40}$'
CHECK length(label) BETWEEN 1 AND 20
CHECK length(instruction) BETWEEN 1 AND 2000
```

- **빌트인 판별**: `slug ∈ TRANSFORM_PRESET_IDS` → override. 아니면 커스텀. kind 컬럼 불필요.
- **빌트인 override 편집 가능 필드**: `instruction`, `fidelity_guard`만. 라벨·메타(`minInputLen`, `strictPreserve`)는 코드 값 고정 (칩 일관성 + 축약 감지 안전장치 보존). override 행의 label 컬럼에는 코드 라벨을 복사 저장해 조회를 단일화하되, 렌더·해석은 항상 코드 라벨을 우선한다.
- **커스텀 프리셋 메타 고정값**: `minInputLen=1`, `strictPreserve=false` (UI 비노출, YAGNI).
- 커스텀 slug는 서버가 생성: `c-` + UUID 앞 8자. 빌트인 ID와 충돌 불가(빌트인은 `c-` 접두사 없음).

### 3.2 기존 `memo_transformations` 변경

1. `memo_transformations_preset_check` (7종 하드코딩 CHECK) **제거** — 커스텀 slug 허용.
2. `preset_label` text **NULL 허용** 컬럼 추가 — 저장 시점 라벨 스냅샷. 백필 불필요.
   - 렌더 폴백 체인: `presetLabel ?? TRANSFORM_PRESET_LABELS[slug] ?? slug`
   - 효과: 커스텀 프리셋을 나중에 삭제해도 기존 변환본 칩이 계속 정상 렌더.

## 4. 프롬프트 조립 — 2층 → 3층

```
[1층: 하드 계약 — 코드 고정, 편집 불가]
개인 메모를 아래 지시에 따라 변환하는 작업입니다.
응답은 반드시 JSON: {"content": "변환된 전체 텍스트"}

[2층: 원문 충실 가드 — fidelity_guard=true일 때만 삽입]
절대 규칙:
- 고유명사·숫자·날짜를 임의로 바꾸지 않는다.
- 원문에 없는 내용을 추가하지 않는다.
- 판단·평가·조언·안전 문구를 넣지 않는다.
- 한국어 메모는 한국어로 유지한다.

[3층: 스타일 지시 — 편집 대상]
(빌트인 기본값 또는 사용자 instruction)
```

설계 판단:

- 기존 1층의 "당신은 개인 메모를 지정된 스타일로 정리하는 도구입니다" 페르소나 선언을 **페르소나 중립 문구로 교체** — 커스텀 프리셋의 자유 역할 부여("너는 커리어 코치야")가 고정층과 싸우지 않게 한다.
- **JSON 계약은 1층(편집 불가)에 유지** — 사용자가 프롬프트를 아무리 바꿔도 Zod 파싱 파이프라인이 깨지지 않는다.
- 가드 해제 시 언어 제약도 풀림 — "영어 이메일 초안" 같은 프리셋 가능(의도된 유연성).
- 빌트인 7종은 fidelity_guard 기본 on. 커스텀도 생성 기본값 on, 해제 가능.

## 5. 서버 계층 (FSD)

```
entities/memo/
  api/memoPresetRepo.ts            # 신규 — presets CRUD (memoTransformRepo 옆)
  server.ts                        # memoPresetRepo export 추가
features/memo-transform/lib/
  preset-resolver.ts (server-only) # 신규
    listPresetCatalog(userId)      # 빌트인7(override 병합) + 커스텀. 정렬: 빌트인 고정순 → 커스텀 생성순
    resolvePreset(userId, slug)    # → ResolvedPreset | null
  transform-memo.ts                # transformMemoContent(input, resolved) — resolved 기반 3층 조립로 변경
  prompts.ts                       # HARD_CONTRACT / FIDELITY_GUARD / PRESET_INSTRUCTIONS(기본값)로 재구성
features/memo-preset-manage/       # 신규 feature (email-settings-manage 미러)
  api/
    savePresetAction               # 빌트인 override upsert / 커스텀 UPDATE (Zod + auth)
    resetPresetAction              # override 행 DELETE (빌트인만)
    createPresetAction             # 커스텀 생성 (slug 서버 생성)
    deletePresetAction             # 커스텀만 삭제 허용 (빌트인 slug 거부)
    previewPresetAction            # 저장 없이 초안 instruction+가드+샘플 텍스트로 LLM 실행 (DB 무접촉)
                                   #   샘플 텍스트 Zod max 4,000자 (transform MAX_INPUT과 동일)
  ui/                              # 설정 페이지 컴포넌트
  client.ts                        # Server Action만 re-export (barrel seam — Gotcha #7)
```

```ts
interface ResolvedPreset {
  slug: string;
  label: string;
  instruction: string;
  fidelityGuard: boolean;
  minInputLen: number;      // 빌트인: 코드 메타 / 커스텀: 1
  strictPreserve: boolean;  // 빌트인: 코드 메타 / 커스텀: false
  isBuiltin: boolean;
  isOverridden: boolean;    // 빌트인 + override 행 존재
}
```

기존 코드 변경점:

- `transformMemoAction`: `isTransformPresetId` 정적 검증 → `resolvePreset` 동적 검증. `minInputLen`도 resolved에서.
- `saveTransformationAction`: `preset_label` 스냅샷 저장 추가.
- 해석은 매 호출 DB 조회 — override 저장 직후 다음 변환부터 즉시 반영. 캐시 없음(개인 규모).
- 모든 액션 에러 reason은 고정 문자열(내부 정보 클라이언트 비노출 — 기존 패턴 유지).

## 6. UI/UX — `/memos/settings` 전용 페이지

`app/(dashboard)/memos/settings/page.tsx` (RSC: auth + 카탈로그 로드) → client 컴포넌트.

### 6.1 레이아웃

- **데스크톱**: 2컬럼 master-detail (좌: 프리셋 목록 ~280px / 우: 편집기).
- **모바일**: 목록 ↔ 편집 스택 전환 (선택 시 편집 뷰로, ← 로 목록 복귀).
- 헤더: `← 메모` 복귀 링크 + "AI 정리 스타일 설정" 제목.
- `/memos` 페이지 헤더에 ⚙ 설정 진입 링크 추가.

### 6.2 목록 (master)

- 섹션 2개: **기본 프리셋** (7종 고정순) / **내 프리셋** (생성순) + `[+ 새 프리셋]` 버튼.
- 항목: 라벨 + 상태 배지(`기본` / `수정됨` / `커스텀`) + instruction 1줄 미리보기.
- 미저장 변경이 있는 상태에서 다른 항목 선택 시 confirm.

### 6.3 편집기 (detail)

| 요소 | 빌트인 | 커스텀 |
|---|---|---|
| 라벨 input | read-only | 편집 가능 (1~20자) |
| 스타일 지시 textarea | 편집 가능 (max 2,000자, 남은 글자 수 표시) | 동일 |
| 기본 프롬프트 보기 (접이식) | `수정됨`일 때 노출 — 복구 전 비교용 | 없음 |
| 원문 충실 가드 토글 | 있음 (기본 on) + 한 줄 설명 | 동일 |
| 기본값 복구 버튼 | `수정됨`일 때만 (confirm 후 resetPresetAction) | 없음 |
| 삭제 버튼 | 없음 | 있음 (confirm — "기존 변환본은 보존됩니다") |
| 테스트 패널 | 샘플 텍스트 textarea(예시 프리필) + `▶ 테스트 실행` → 결과/실패 사유 미리보기 | 동일 |
| 저장 | 명시적 저장 버튼 — dirty일 때만 활성 (자동저장 아님) | 동일 |

### 6.4 기존 UI 변경

- **TransformDialog**: 하드코딩 7종 → 서버 page가 로드한 카탈로그를 props로 받아 동적 렌더. `too-short` 비활성 판정도 카탈로그의 `minInputLen` 사용.
- **MemoCard** 칩: 라벨 = 스냅샷 폴백 체인. 정렬 = 빌트인 고정순 → 커스텀은 라벨 사전순. (현재 코드는 커스텀 slug가 `indexOf=-1`이라 맨 앞에 끼어드는 잠재 버그 — 함께 수정.)

## 7. 에러 처리 / 엣지 케이스

| 상황 | 동작 |
|---|---|
| 커스텀 프리셋 삭제 | 기존 변환본 보존 (라벨 스냅샷 렌더), 재생성만 불가 (카탈로그에서 제외) |
| 삭제된 프리셋으로 변환 시도 (열린 다이얼로그 등) | `resolvePreset` null → `invalid` 반환 |
| 테스트 실행 실패 | 미리보기 영역에 고정 문자열 사유 표시 |
| 빈/초과 instruction | Zod 거부 + 인라인 에러 |
| 빌트인 slug로 delete/create 시도 | 액션이 거부 (`invalid`) |
| 기존 저장된 변환본 | 마이그레이션 후 그대로 유효 (`preset_label` null → 코드 라벨 폴백) |

## 8. 마이그레이션·배포

1. drizzle schema 수정 → `pnpm db:generate`.
2. 운영: **psql BEGIN/COMMIT 수동 적용** (drizzle-kit migrate 운영 broken — 기존 절차).
   - `CREATE TABLE memo_transform_presets ...`
   - `ALTER TABLE memo_transformations DROP CONSTRAINT memo_transformations_preset_check;`
   - `ALTER TABLE memo_transformations ADD COLUMN preset_label text;`
3. 순서: **운영 DDL 먼저 → 이미지 배포** (DDL은 구 코드와 호환: CHECK 제거·nullable 컬럼 추가·신 테이블은 구 코드에 무해).

## 9. 테스트

- `preset-resolver`: 병합(override 우선)·정렬·빌트인 폴백·커스텀 메타 고정값 unit.
- 프롬프트 3층 조립: 가드 on/off, 하드 계약 항상 포함 unit.
- 액션: Zod 경계값(라벨 20자·instruction 2,000자), auth, 빌트인 delete 거부, 커스텀 reset 거부.
- `MemoCard`: 커스텀 칩 라벨 폴백·정렬 (jsdom).
- `TransformDialog`: 동적 카탈로그 렌더 (기존 테스트 갱신).
- 신규 테스트 파일은 단일 경로 실행으로 "N passed" 확인 (vitest include 함정).
- PR 전 `pnpm build` 1회 (features barrel seam 검증 — Gotcha #7).

## 10. Non-goals (v1)

- cleanup(받아쓰기 정리) 프롬프트 설정 — 범위 제외 확정
- 프리셋별 모델 선택 (전 프리셋 `claude-sonnet-5` 유지)
- 빌트인 라벨·메타(minInputLen/strictPreserve) 편집
- 프리셋 정렬 커스터마이징, 내보내기/공유, 다국어
