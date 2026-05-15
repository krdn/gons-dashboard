# 호(虎) 상담 영역 — PlayMCP 1FATE 전용 신규 영역 설계

**작성일**: 2026-05-15
**상태**: Draft → 사용자 리뷰 대기
**범위**: v0.1
**관련**: PlayMCP MCP 서버 #261 (`신년운세 & 사주/궁합 - 정통 명리학 by 1FATE`)

---

## 1. 목적과 배경

### 1.1 동기

PlayMCP 1FATE 도구 4개 (`analyze_saju`, `get_year_fortune`, `get_daily_fortune`, `check_compatibility`) 를 활용해 호(虎) 페르소나 기반 사주 상담 영역을 신설한다. 기존 `saju-reading` 영역 (`packages/saju` 결정적 계산 + `claude-opus-4-7` 해설) 은 그대로 보존하며, 두 시스템을 **완전 독립**으로 운영한다.

### 1.2 PlayMCP 검증 사실 (1차 호출 + 메타데이터)

| 항목 | 사실 |
|---|---|
| MCP 서버 ID | 261 |
| 공식 이름 | 신년운세 & 사주/궁합 - 정통 명리학 by 1FATE |
| `identifyName` | `1fate` |
| 인증 (도구 레벨) | `authConfigSummary.type: "NONE"` |
| 인증 (게이트웨이) | OAuth2 + OTT(One Time Token) 교환 흐름 필수 |
| 도구 개수 | 4개 |
| 응답 형식 | 구조화 JSON (`result.{profile, type_summary_*, personality, element_tendency, life_hints, suggested_narrative_*}`) |
| 응답 미포함 데이터 | 4기둥 8글자, 십신, 격국, 용신, 12운성, 신살, 대운표 |
| 정통성 주장 | 자평진전·적천수·명리정종 기반, 만세력 100% 검증, 12운성 120케이스, 신살 48종, 격국 20종, 용신 3법, 진태양시 163,400 도시, 천문 라이브러리 대운 |
| 운영 트래픽 | 누적 173회 / 월 51회 (신생) |
| 검증된 결함 | **응답 cross-talk** — 연속 호출 시 직전 응답 데이터가 다음 응답에 leak (1차 호출 실증) |

### 1.3 비목표 (v0.1)

- 기존 `fortune_profiles` / `saju_*` 테이블 통합 또는 마이그레이션
- 기존 `/fortune` 영역 UI/라우트 변경
- PlayMCP daily 자동 cron 백필 (사용자 진입 시 lazy 호출만)
- 사용자별 PlayMCP OAuth 계정 분리 (운영 컨테이너 단위 단일 세션)
- 토큰 단가 추적 (`llm_spend_log` 미사용)
- `packages/mcp-1fate` 별도 monorepo 패키지화 (A 토폴로지 선택, 단일 FSD 슬라이스)

### 1.4 성공 기준

1. `/tiger/[profileId]` 진입 시 4 카드 (분석/연운/일진/궁합) 가 모두 정상 렌더
2. cross-talk 검증 게이트가 1차 실증 fixture 응답에서 leak 감지
3. 기존 `/fortune` 영역 회귀 0건
4. PlayMCP 호출 실패 시 운영자 알림 + 사용자 페르소나 일관 에러 메시지
5. 운영 진단 페이지에서 토큰 만료·cross-talk 빈도·도구별 성공률 확인 가능

---

## 2. 결정 사항 (Brainstorming 산출)

| # | 항목 | 결정 | 근거 |
|---|---|---|---|
| 1 | 영역 정체성 | 호(虎) 페르소나 상담 챔 | PlayMCP 강점 (내러티브) 활용 |
| 2 | v0.1 카드 범위 | 4개 전부 (analyze/year/daily/compat) | 사용자 결정 |
| 3 | 운영 호출 경로 | mcporter + OTT 교환 (PlayMCP 공식 게이트웨이 OAuth) | `/llms/mcp-connection-guide.md` |
| 4 | 기존 saju 와의 관계 | 완전 독립 이중 시스템 (profile도 미공유) | 사용자 결정 |
| 5 | 라우트 + 메뉴명 | `/tiger` + "호(虎) 상담" | 사용자 결정 |
| 6 | 캐시 정책 | DB 영구 캐시 + `inputHash` 불일치 시 무효화 | 기존 `saju_*` 패턴 일치 |
| 7 | Cross-talk 회피 | 응답 검증 게이트 (4단 검사 + LRU) | 1차 호출 실증 |
| 8 | 구현 토폴로지 | A. 단일 FSD 슬라이스 (apps/dashboard 내부) | 메모리 `workspace-package-dockerfile-gotcha` 회피, PlayMCP 신뢰도 검증 우선 |

---

## 3. 아키텍처

### 3.1 디렉토리 구조 (A 토폴로지)

```
apps/dashboard/src/
├── app/tiger/                                      # 신규 라우트
│   ├── page.tsx                                    # 프로필 목록 + 4 카드 진입점
│   ├── [profileId]/page.tsx                        # 호 상담 결과 페이지
│   ├── compatibility/page.tsx                      # 궁합 진입 (프로필 2개 선택)
│   ├── manage/page.tsx                             # playmcp_profiles CRUD
│   └── admin/diagnostics/page.tsx                  # 운영자 진단 (ADMIN_EMAILS 가드)
├── features/
│   ├── tiger-profile-manage/                       # playmcp_profiles CRUD
│   │   ├── api/                                    # createProfile, updateProfile, deleteProfile
│   │   ├── ui/                                     # ProfileForm, ProfileList
│   │   ├── model/                                  # 타입, Zod schemas
│   │   └── index.ts
│   └── tiger-consult/                              # PlayMCP 호출·검증·캐시
│       ├── api/
│       │   ├── analyzeProfile.ts                   # analyze_saju 진입점
│       │   ├── yearlyInsight.ts                    # get_year_fortune
│       │   ├── dailyFortune.ts                     # get_daily_fortune
│       │   └── compatibility.ts                    # check_compatibility
│       ├── lib/
│       │   ├── playmcp-client.ts                   # OAuth + 호출 (p-limit 1)
│       │   ├── playmcp-credentials.ts              # accessToken refresh + DB IO
│       │   ├── validate.ts                         # cross-talk 게이트 (4단)
│       │   ├── cache.ts                            # getOrFetch (UPSERT)
│       │   ├── hash.ts                             # inputHash 계산
│       │   └── errors.ts                           # L1~L5 에러 분류
│       └── index.ts
├── entities/
│   └── tiger-reading/
│       ├── ui/                                     # TigerNarrative, TigerCard 등 dumb
│       ├── model/types.ts                          # PlayMCP 응답 타입
│       └── index.ts
└── widgets/
    └── tiger-cards/                                # 4 카드 조합
        ├── ui/TigerAnalysisCard.tsx
        ├── ui/TigerYearlyCard.tsx
        ├── ui/TigerDailyCard.tsx
        ├── ui/TigerCompatibilityCard.tsx
        └── index.ts
```

### 3.2 의존성 방향

```
app/tiger/*  →  widgets/tiger-cards  →  features/tiger-consult  →  entities/tiger-reading  →  shared/*
                                     →  features/tiger-profile-manage
```

ESLint `eslint-plugin-boundaries` 룰로 강제. 기존 `features/saju-reading`, `features/fortune-profile-manage`, `entities/*` 와 **import 0**.

### 3.3 시퀀스 (analyze_saju 예시)

```
[사용자] 클릭 "사주 분석" 카드 in /tiger/[profileId]
    │
    ▼
[RSC] app/tiger/[profileId]/page.tsx
    │  · profile 조회 (playmcp_profiles)
    ▼
[features/tiger-consult/api/analyzeProfile.ts]
    │  · cache.getOrFetch({ table:'analysis', key:{profileId}, inputHash, fetcher, validator })
    ▼
[lib/cache.ts]
    │  · SELECT playmcp_analysis WHERE profile_id=? AND input_hash=?
    │  · hit → return payload (fromCache: true)
    │  · miss → call fetcher
    ▼
[lib/playmcp-client.ts]
    │  · ensureAccessToken() — token refresh 자동 (만료 5분 전)
    │  · p-limit(1) 직렬화 + 1.5s jitter
    │  · POST playmcp gateway /mcp tool=1fate-analyze_saju
    │  · timeout 30s
    ▼
[lib/validate.ts]
    │  · Check 1: nickname_full 에 birth_date 포함
    │  · Check 2: nickname_full 에 성별 포함
    │  · Check 3: narrative 첫 문단에 nickname_short 포함
    │  · Check 4: LRU(20) 중 다른 profileId 의 동일 nickname 없음
    │  · 실패 시 2초 후 1회 재호출, 재실패 시 L4 에러 throw
    ▼
[lib/cache.ts]
    │  · UPSERT playmcp_analysis ON CONFLICT (profile_id) UPDATE
    ▼
[widgets/tiger-cards/ui/TigerAnalysisCard.tsx]
    · suggested_narrative_ko + life_hints 칩 + element_tendency 배지 렌더
```

---

## 4. 데이터 모델

### 4.1 마이그레이션 번호

다음 마이그레이션 = **0010** (현재 0009 = saju Phase 3). 단일 마이그레이션으로 6개 테이블 + 보조 함수 생성.

### 4.2 테이블 정의

#### `playmcp_profiles`
```sql
CREATE TABLE playmcp_profiles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname      text NOT NULL,                 -- 호 narrative 검증용
  relation      text NOT NULL,                 -- 'self'|'spouse'|'child'|'parent'|'sibling'|'relative'|'friend'|'other'
  birth_date    text NOT NULL,                 -- 'YYYY-MM-DD'
  calendar      text NOT NULL DEFAULT 'solar', -- 'solar'|'lunar'
  gender        text NOT NULL,                 -- 'male'|'female'
  birth_time    text,                          -- 'HH:MM' (선택)
  birth_city    text,                          -- 선택 (진태양시 보정)
  input_hash    text NOT NULL,                 -- sha256(birth_date|calendar|gender|birth_time|birth_city)
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX playmcp_profiles_user_idx ON playmcp_profiles(user_id);
```

#### `playmcp_analysis`
```sql
CREATE TABLE playmcp_analysis (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    uuid NOT NULL REFERENCES playmcp_profiles(id) ON DELETE CASCADE,
  input_hash    text NOT NULL,
  payload       jsonb NOT NULL,                -- PlayMCP analyze_saju result 전체
  validated_at  timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX playmcp_analysis_profile_idx ON playmcp_analysis(profile_id);
```

#### `playmcp_yearly`
```sql
CREATE TABLE playmcp_yearly (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    uuid NOT NULL REFERENCES playmcp_profiles(id) ON DELETE CASCADE,
  year          integer NOT NULL,
  input_hash    text NOT NULL,
  payload       jsonb NOT NULL,                -- PlayMCP get_year_fortune result
  validated_at  timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX playmcp_yearly_profile_year_idx ON playmcp_yearly(profile_id, year);
```

#### `playmcp_daily`
```sql
CREATE TABLE playmcp_daily (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      uuid NOT NULL REFERENCES playmcp_profiles(id) ON DELETE CASCADE,
  for_date_kst    date NOT NULL,               -- 호출 시각의 KST 날짜
  input_hash      text NOT NULL,
  payload         jsonb NOT NULL,
  validated_at    timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX playmcp_daily_profile_date_idx ON playmcp_daily(profile_id, for_date_kst);
CREATE INDEX playmcp_daily_date_idx ON playmcp_daily(for_date_kst);
```
**보관 정책**: 영구 저장. PlayMCP는 "오늘만" 가능 — 과거 row 재취득 불가하므로 prune 안 함.

#### `playmcp_compatibility`
```sql
CREATE TABLE playmcp_compatibility (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile1_id   uuid NOT NULL REFERENCES playmcp_profiles(id) ON DELETE CASCADE,
  profile2_id   uuid NOT NULL REFERENCES playmcp_profiles(id) ON DELETE CASCADE,
  input_hash1   text NOT NULL,                 -- profile1 시점 hash
  input_hash2   text NOT NULL,                 -- profile2 시점 hash
  payload       jsonb NOT NULL,
  validated_at  timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (profile1_id < profile2_id)            -- 순서 무관 키
);
CREATE UNIQUE INDEX playmcp_compat_pair_idx ON playmcp_compatibility(profile1_id, profile2_id);
```
**application code**: INSERT 전 `[a, b].sort()` 강제.

#### `playmcp_credentials`
```sql
CREATE TABLE playmcp_credentials (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token_enc      bytea NOT NULL,        -- pgcrypto: pgp_sym_encrypt(token, PG_ENCRYPTION_KEY)
  refresh_token_enc     bytea NOT NULL,
  access_expires_at     timestamptz NOT NULL,
  refresh_expires_at    timestamptz NOT NULL,
  client_id             text NOT NULL,         -- PlayMCP 공개 client_id (가이드 고정값)
  updated_at            timestamptz NOT NULL DEFAULT now()
);
-- 단일 row 강제는 application 측 (CHECK constraint 으로는 단일성 강제 불가)
```

### 4.3 무효화 규칙

| 변경 | 무효화 대상 |
|---|---|
| `playmcp_profiles.birth_date` (또는 calendar/gender/birth_time/birth_city) 수정 | 같은 profile_id 의 analysis/yearly/daily/compat row의 `input_hash` 불일치 → 다음 조회 시 자동 재호출 |
| `playmcp_profiles` 삭제 | CASCADE — 4 캐시 테이블 row 동시 삭제 |
| 두 profile 중 한쪽 birth 수정 | compat row의 `input_hash1` 또는 `input_hash2` 불일치 → 재호출 |

---

## 5. PlayMCP 클라이언트 (lib/playmcp-client.ts)

### 5.1 OAuth 흐름

```ts
async function ensureAccessToken(): Promise<string> {
  const cred = await db.select().from(playmcpCredentials).limit(1);
  if (!cred[0]) {
    throw new PlayMCPNotConfiguredError(
      'playmcp_credentials 가 비어 있음. 운영자가 OTT 교환 절차 수행 필요.'
    );
  }
  const now = Date.now();
  if (cred[0].accessExpiresAt.getTime() - now > 5 * 60_000) {
    return decrypt(cred[0].accessTokenEnc);
  }
  // refresh
  return refreshAccessToken(cred[0]);
}
```

### 5.2 초기 등록 절차 (운영자 수동, 1회)

1. PlayMCP 웹에서 도구함에 `1fate` (#261) 추가
2. "OpenClaw와 연결" 클릭 → OTT 발급
3. 운영자가 `pnpm tiger:bootstrap --ott <OTT_VALUE> --i-know-this-is-prod` 실행
   - 스크립트가 `POST /api/v1/auths/otts:exchange` 호출
   - access_token + refresh_token 을 pgcrypto 암호화하여 `playmcp_credentials` INSERT (단일 row)

### 5.3 호출

```ts
const playmcpLimit = pLimit(1);  // 직렬화

async function callTool<T>(toolName: ToolName, params: object): Promise<T> {
  return playmcpLimit(async () => {
    await sleep(1500 + Math.random() * 500);  // 1.5~2.0s jitter
    const token = await ensureAccessToken();
    const response = await fetch('https://playmcp.kakao.com/mcp', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tool: toolName, params }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw mapHttpError(response.status, await response.text());
    }
    return response.json() as Promise<T>;
  });
}
```

**중요**: 실제 PlayMCP 게이트웨이 HTTP 요청 형식(`POST /mcp` 본문 schema)은 mcp-connection-guide.md 가 완전 노출하지 않음. 구현 단계에서 mcporter SDK 또는 PlayMCP discord 문의로 정확한 endpoint·payload 확정 필요. 위 코드는 가정.

---

## 6. Cross-talk 검증 (lib/validate.ts)

### 6.1 4단 검사

```ts
type ValidationResult = { ok: true } | { ok: false; reason: string };

function validateResponse(
  response: PlayMCPAnalysisResult,
  profile: { id: string; nickname: string; birthDate: string; gender: 'male' | 'female' }
): ValidationResult {
  const nick = response?.result?.profile?.nickname_full ?? '';
  const nickShort = response?.result?.profile?.nickname_short ?? '';
  const narrative = response?.result?.suggested_narrative_ko ?? '';

  // Check 1: nickname_full 에 birth_date 포함
  const dateFormats = [
    profile.birthDate,                        // '1967-03-29'
    profile.birthDate.replace(/-/g, '.'),     // '1967.03.29'  (PlayMCP 1차 실증 포맷)
    profile.birthDate.replace(/-/g, '/'),     // '1967/03/29'
  ];
  if (!dateFormats.some(f => nick.includes(f))) {
    return { ok: false, reason: 'birth_date_missing_in_nickname' };
  }

  // Check 2: 성별 일치
  const genderKo = profile.gender === 'male' ? '남자' : '여자';
  if (!nick.includes(genderKo)) {
    return { ok: false, reason: 'gender_mismatch' };
  }

  // Check 3: narrative 본문 일관성
  const firstPara = narrative.split('\n\n')[1] ?? '';
  if (nickShort && !firstPara.includes(nickShort)) {
    return { ok: false, reason: 'narrative_nickname_inconsistent' };
  }

  // Check 4: recency LRU (in-memory, max 20)
  const recent = recentNicknames.get(nick);
  if (recent && recent !== profile.id) {
    return { ok: false, reason: 'duplicate_nickname_different_profile' };
  }
  recentNicknames.set(nick, profile.id);

  return { ok: true };
}
```

### 6.2 궁합 검증

```ts
function validateCompatibility(
  response: PlayMCPCompatibilityResult,
  p1: ProfileLike,
  p2: ProfileLike,
): ValidationResult {
  const narrative = response?.result?.suggested_narrative_ko ?? '';
  const has1 = dateFormats(p1.birthDate).some(f => narrative.includes(f));
  const has2 = dateFormats(p2.birthDate).some(f => narrative.includes(f));
  if (!has1 || !has2) {
    return { ok: false, reason: 'compatibility_one_side_missing' };
  }
  return { ok: true };
}
```

### 6.3 실패 시 흐름

- 1회 재호출 (2초 후) → 재실패 시 `PlayMCPCrossTalkDetectedError` throw
- 운영자 알림 즉시 (`OPS_NOTIFY_EMAIL`)
- DB 저장 안 함 (오염된 payload 영구화 방지)
- 사용자 UX: "호(虎)가 답을 다듬는 중에 문제가 생겼어요. 잠시 후 다시 시도해 주세요."

---

## 7. 에러 분류 (5계층)

| 계층 | 에러 유형 | 사용자 메시지 | 운영자 알림 | 자동 복구 |
|---|---|---|---|---|
| L1 인증 | OAuth token 만료·refresh 실패 | "잠시 후 다시 시도" | 즉시 | refresh 1회 자동 |
| L2 네트워크 | timeout, 5xx, ECONNRESET | "PlayMCP 연결 불안정" + 캐시 폴백 | 5분 내 3회 누적 시 | 30s backoff 1회 재시도 |
| L3 입력 | 400/422 validation 거부 | "프로필 정보 확인 필요" | 없음 | 없음 |
| L4 Cross-talk | validate.ts 실패 | "결과 검증 실패 — 재시도 중" → 실패 시 "서비스 점검 중" | **즉시** | 2초 후 1회 재호출 |
| L5 응답 형식 | JSON schema 미일치 | "예상치 못한 응답 형식" | 즉시 | 없음 |

운영자 알림은 24시간 내 동일 에러 5회 누적 후 억제 (스팸 방지).

---

## 8. 운영자 진단 페이지 (v0.1 포함)

`/tiger/admin/diagnostics` — `ADMIN_EMAILS` 가드.

표시 항목:
- `playmcp_credentials.access_expires_at` 남은 시간 + manual refresh 버튼
- 최근 24h cross-talk 감지 건수 + 최근 5건 상세 (profile_id, tool, reason, timestamp)
- 4 도구별 최근 7일 호출 성공률 (cache miss 호출 기준)
- 수동 cache invalidate 버튼 (profile 단위)

PlayMCP가 51회/월 신생 서비스라 운영 가시성이 필수. 모니터링 부족 시 cross-talk 사고 추적 불가.

---

## 9. UI 컴포넌트 (widgets/tiger-cards)

### 9.1 카드별 데이터 매핑

| 카드 | PlayMCP 응답 필드 | UI 표현 |
|---|---|---|
| TigerAnalysisCard | `suggested_narrative_ko` + `type_summary_ko` + `element_tendency_ko` + `life_hints.*_ko` | 6문단 narrative + 일주 배지 + 오행 칩 + 직업/관계/건강 라벨 |
| TigerYearlyCard | `suggested_narrative_ko` | 5문단 narrative + 연도 선택 드롭다운 (현재년/내년) |
| TigerDailyCard | `suggested_narrative_ko` | 4문단 narrative + "오늘의 한마디" 강조 + 과거 일진 보기 링크 |
| TigerCompatibilityCard | `suggested_narrative_ko` | 6문단 narrative + 두 프로필 nickname 헤더 |

### 9.2 페르소나 일관성

- 모든 카드 헤더에 호(虎) 캐릭터 이미지 또는 이모지
- 로딩 메시지: "호(虎)가 사주를 살펴보고 있습니다..."
- 에러 메시지: "호(虎)가 잠시 답을 못 드리고 있어요"

### 9.3 다국어 (v0.2 검토)

PlayMCP 응답은 ko/en/ja 모두 반환. v0.1은 ko만 표시. v0.2에서 toggle 추가 검토.

### 9.4 Locale-free 포맷팅 (Gotcha #3 회피)

`forDateKst` 표시는 `YYYY-MM-DD` literal 형식 (클라이언트). hydration mismatch 방지.

---

## 10. 테스트 전략

| 레이어 | 비율 | 도구 |
|---|---|---|
| L1 단위 | 60% | Vitest |
| L2 통합 | 25% | Vitest + `TEST_DATABASE_URL` 가드 |
| L3 PlayMCP 모킹 | 12% | MSW + 1차 호출 fixture (1967-03-29 / 1976-12-01 cross-talk leak) |
| L4 실호출 | 3% | 수동 (`pnpm test:playmcp:live`, `PLAYMCP_LIVE=1` 가드, CI 미포함) |

### 10.1 95% 커버리지 강제 모듈
- `lib/validate.ts`
- `lib/playmcp-client.ts`
- `lib/cache.ts`

(나머지 모듈 80% 기본)

### 10.2 Fixture 채취 계획
- 1967-03-29 / 1976-12-01: 1차 호출에서 확보 — `tests/playmcp-fixtures/` 저장
- 나머지 3 도구 (year/daily/compat): spec 승인 후 본인이 추가 실호출하여 채취

---

## 11. 환경 변수 추가

`.env.example` + `shared/config/env.ts` Zod schema 에 추가:

| 변수 | 필수 | 설명 |
|---|---|---|
| `PLAYMCP_GATEWAY_URL` | ✓ | `https://playmcp.kakao.com/mcp` |
| `PLAYMCP_CLIENT_ID` | ✓ | PlayMCP 가이드 공개 client_id |
| `PLAYMCP_BOOTSTRAP_OTT` | (1회만) | 초기 setup script 입력. 사용 후 .env 에서 제거. |

기존 `PG_ENCRYPTION_KEY` 재사용 (token at-rest 암호화).

---

## 12. 배포·운영 절차

### 12.1 운영 배포 순서
1. 마이그레이션 0010 적용 (`pnpm db:migrate --i-know-this-is-prod`)
2. 이미지 빌드·푸시 (GHA `Build & Push Docker Images`)
3. 운영자 1회 setup: PlayMCP 웹 도구함에서 OTT 발급 → `pnpm tiger:bootstrap --ott <VALUE> --i-know-this-is-prod`
4. 컨테이너 교체 (`compose pull && compose up -d app`)
5. `/tiger/admin/diagnostics` 에서 토큰 정상 확인
6. self 프로필 1개로 4 카드 전부 호출 → smoke test

### 12.2 토큰 만료 대응
- access_token: 자동 refresh
- refresh_token 만료: `/tiger/admin/diagnostics` 에 경고 표시 + 운영자 알림. 운영자가 OTT 재발급 후 bootstrap 재실행

---

## 13. 메모리 활용 (Gotcha 회피)

| 메모리 | 적용 |
|---|---|
| `Gotcha #1 — entities barrel client 트리 깨짐` | `entities/tiger-reading/ui/*` 는 깊은 경로 import 강제 |
| `Gotcha #2 — TEST_DATABASE_URL 필수` | 통합 테스트 시 가드 통과 |
| `Gotcha #3 — locale-free 포맷팅` | `forDateKst` literal 포맷 사용 |
| `Gotcha #6 — OAuth scope 자동 회복` | PlayMCP는 본인 NextAuth 와 무관 — N/A |
| `workspace-package-dockerfile-gotcha` | A 토폴로지로 회피 — 신규 패키지 없음 |
| `decision-monorepo-kept-2026-05-15` | A 토폴로지 일치 (polyrepo 미고려) |
| `anthropic-opus-temperature-deprecated` | PlayMCP는 Anthropic SDK 미사용 — N/A |

---

## 14. v0.2 이후 작업 (Out of Scope)

- 다국어 toggle (ko/en/ja)
- 과거 일진 history 페이지 + 차트
- daily cron (self 프로필만 자정 자동 호출)
- `packages/mcp-1fate` 별도 패키지화 (운영 안정성 확인 후 추출)
- 호출당 비용 추적 (`playmcp_call_log` 별도 테이블)
- PlayMCP API 변경 자동 감지 (응답 schema diff)
- 사용자가 Claude Code 안에서 자기 사주 호출하는 stdio MCP 진입점

---

## 15. 리스크와 완화

| 리스크 | 영향 | 완화 |
|---|---|---|
| PlayMCP cross-talk 재발 | 다른 사용자 사주 표시 | 4단 검증 게이트 + LRU + L4 알림 |
| PlayMCP 게이트웨이 endpoint 미문서화 | 구현 단계 blocker | 구현 시작 시 mcporter SDK 코드 분석 또는 PlayMCP discord 문의 |
| OAuth refresh_token 만료 | 서비스 중단 | 진단 페이지 경고 + 운영자 알림 |
| PlayMCP 응답 schema 변경 | L5 에러 폭발 | 수동 `test:playmcp:live` 분기마다 실행 |
| 트래픽 51회/월 신생 서비스 신뢰도 | 운영 사고 | DB 영구 캐시 + 캐시 폴백 + cron 미사용 |
| 1976-12-01 일주 정확도 의심 | 사주 자체가 틀림 | 본인이 책임지지 않음 — PlayMCP 측 데이터. 단, FAQ/주의문구로 "본 분석은 1FATE 엔진 결과이며 디지털 인사이트입니다" 명시 |

---

## 16. 산출물 체크리스트

구현 단계 진입 전 spec 검증:

- [x] 모든 결정 사항이 §2 표에 기록됨
- [x] 마이그레이션 번호 확정 (0010)
- [x] 6개 테이블 schema 명시
- [x] PlayMCP 호출 게이트웨이 형식 가정 명시 (구현 단계 확정 필요 표시)
- [x] Cross-talk 4단 검증 로직 명시
- [x] 5계층 에러 분류 명시
- [x] 환경 변수 명시
- [x] 운영 배포 절차 명시
- [x] 테스트 전략 + 95% 커버리지 모듈 명시
- [x] 메모리 Gotcha 회피 매핑
- [x] v0.2 backlog 분리

---

**다음 단계**: 사용자 spec 리뷰 → 승인 → `writing-plans` 스킬 호출하여 구현 plan 작성.
