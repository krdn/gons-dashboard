# 호(虎) 상담 영역 — PlayMCP 1FATE 전용 신규 영역 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PlayMCP MCP #261 (1FATE) 4 도구를 활용한 호 페르소나 사주 상담 영역 (`/tiger`) 신설. 기존 `saju-reading` 영역 완전 보존.

**Architecture:** 단일 FSD 슬라이스(A 토폴로지) — `apps/dashboard/src/{app/tiger, features/tiger-{consult,profile-manage}, entities/tiger-reading, widgets/tiger-cards}`. PlayMCP 게이트웨이 OAuth(mcporter+OTT 교환) + DB 영구 캐시(`playmcp_*` 5테이블) + 응답 cross-talk 검증 게이트(4단 + LRU).

**Tech Stack:** Next.js 16 App Router(RSC + Server Actions) · TypeScript strict · Drizzle ORM · NextAuth v5 · Vitest · MSW · pgcrypto · p-limit · Zod.

**Spec:** `docs/superpowers/specs/2026-05-15-tiger-playmcp-area-design.md`

---

## Phase 0: Foundation — 환경 변수 + DB schema

### Task 0.1: PlayMCP 환경 변수 추가

**Files:**
- Modify: `apps/dashboard/src/shared/config/env.ts`
- Modify: `apps/dashboard/.env.example`

- [ ] **Step 1: env.ts 에 Zod schema 3개 변수 추가**

`apps/dashboard/src/shared/config/env.ts` 의 schema 객체에 다음 항목을 기존 `PG_ENCRYPTION_KEY` 라인 근처에 추가:

```ts
PLAYMCP_GATEWAY_URL: z
  .string()
  .url()
  .default("https://playmcp.kakao.com/mcp"),
PLAYMCP_CLIENT_ID: z
  .string()
  .min(1, "PlayMCP gateway client_id 필수 — 가이드 고정값"),
PLAYMCP_BOOTSTRAP_OTT: z
  .string()
  .optional(),
```

`PG_ENCRYPTION_KEY` 는 이미 optional 인데, PlayMCP 토큰 암호화를 위해 **required 로 승격**:

```ts
PG_ENCRYPTION_KEY: z
  .string()
  .min(32, "openssl rand -hex 32 로 생성. PlayMCP 토큰 + (가능 시) Google refresh 토큰 암호화."),
```

- [ ] **Step 2: .env.example 에 항목 추가**

`apps/dashboard/.env.example` 의 마지막에 섹션 추가:

```env
# === PlayMCP 1FATE (호 상담 영역) ===
PLAYMCP_GATEWAY_URL=https://playmcp.kakao.com/mcp
PLAYMCP_CLIENT_ID=
# 초기 1회 setup 시 OTT 발급 후 입력. tiger:bootstrap 실행 후 .env 에서 제거.
PLAYMCP_BOOTSTRAP_OTT=
```

- [ ] **Step 3: typecheck 통과 확인**

Run: `pnpm typecheck`
Expected: PASS (env 사용처는 아직 없으므로 새 필드만 추가됨, 기존 코드 영향 없음)

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/shared/config/env.ts apps/dashboard/.env.example
git commit -m "feat(tiger): PlayMCP 환경 변수 추가 + PG_ENCRYPTION_KEY required 승격

PlayMCP 1FATE 게이트웨이 OAuth 흐름을 위한 3개 env: GATEWAY_URL,
CLIENT_ID, BOOTSTRAP_OTT (1회용). 토큰 at-rest 암호화를 위해
PG_ENCRYPTION_KEY 를 required 로 승격.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 0.2: Drizzle schema — 6개 신규 테이블

**Files:**
- Modify: `apps/dashboard/src/shared/lib/db/schema.ts:397+` (파일 끝 append)

- [ ] **Step 1: schema.ts 에 playmcp_profiles 추가**

기존 `sajuDailyFortunes` 테이블 정의 다음 (line 396 근처) 에 섹션 헤더 + 테이블 6개 추가:

```ts
/* =========================================================================
 * 호(虎) 상담 영역 — PlayMCP 1FATE (spec: 2026-05-15-tiger-playmcp-area-design.md)
 * - playmcp_profiles      : 호 상담 전용 프로필 (fortune_profiles 와 독립)
 * - playmcp_analysis      : analyze_saju 캐시 (profile_id UNIQUE)
 * - playmcp_yearly        : get_year_fortune 캐시 ((profile_id, year) UNIQUE)
 * - playmcp_daily         : get_daily_fortune 캐시 ((profile_id, for_date_kst) UNIQUE)
 * - playmcp_compatibility : check_compatibility 캐시 (profile1<profile2 CHECK)
 * - playmcp_credentials   : OAuth 토큰 단일 row (pgcrypto 암호화)
 * ========================================================================= */
export const playmcpProfiles = pgTable(
  "playmcp_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    nickname: text("nickname").notNull(),
    relation: text("relation").notNull(),
    birthDate: text("birth_date").notNull(),
    calendar: text("calendar").notNull().default("solar"),
    gender: text("gender").notNull(),
    birthTime: text("birth_time"),
    birthCity: text("birth_city"),
    inputHash: text("input_hash").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("playmcp_profiles_user_idx").on(t.userId)],
);
```

- [ ] **Step 2: playmcp_analysis 추가**

```ts
export const playmcpAnalysis = pgTable(
  "playmcp_analysis",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => playmcpProfiles.id, { onDelete: "cascade" }),
    inputHash: text("input_hash").notNull(),
    payload: jsonb("payload").notNull(),
    validatedAt: timestamp("validated_at", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("playmcp_analysis_profile_idx").on(t.profileId)],
);
```

- [ ] **Step 3: playmcp_yearly 추가**

```ts
export const playmcpYearly = pgTable(
  "playmcp_yearly",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => playmcpProfiles.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    inputHash: text("input_hash").notNull(),
    payload: jsonb("payload").notNull(),
    validatedAt: timestamp("validated_at", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("playmcp_yearly_profile_year_idx").on(t.profileId, t.year),
  ],
);
```

- [ ] **Step 4: playmcp_daily 추가**

```ts
export const playmcpDaily = pgTable(
  "playmcp_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => playmcpProfiles.id, { onDelete: "cascade" }),
    forDateKst: date("for_date_kst").notNull(),
    inputHash: text("input_hash").notNull(),
    payload: jsonb("payload").notNull(),
    validatedAt: timestamp("validated_at", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("playmcp_daily_profile_date_idx").on(t.profileId, t.forDateKst),
    index("playmcp_daily_date_idx").on(t.forDateKst),
  ],
);
```

- [ ] **Step 5: playmcp_compatibility 추가**

```ts
// CHECK (profile1_id < profile2_id) 는 Drizzle ORM 의 sql template 으로
// 마이그레이션 후처리에서 적용한다 (Step 8 의 ALTER TABLE 참조).
export const playmcpCompatibility = pgTable(
  "playmcp_compatibility",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profile1Id: uuid("profile1_id")
      .notNull()
      .references(() => playmcpProfiles.id, { onDelete: "cascade" }),
    profile2Id: uuid("profile2_id")
      .notNull()
      .references(() => playmcpProfiles.id, { onDelete: "cascade" }),
    inputHash1: text("input_hash1").notNull(),
    inputHash2: text("input_hash2").notNull(),
    payload: jsonb("payload").notNull(),
    validatedAt: timestamp("validated_at", { mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("playmcp_compat_pair_idx").on(t.profile1Id, t.profile2Id),
  ],
);
```

- [ ] **Step 6: playmcp_credentials 추가**

```ts
// 단일 row 강제는 application 측에서 (CHECK 제약은 row-level 단일성 강제 불가).
// access_token / refresh_token 은 AES-256-GCM 으로 암호화된 bytea.
export const playmcpCredentials = pgTable("playmcp_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  accessTokenEnc: customType<{ data: Buffer }>({
    dataType() {
      return "bytea";
    },
  })("access_token_enc").notNull(),
  refreshTokenEnc: customType<{ data: Buffer }>({
    dataType() {
      return "bytea";
    },
  })("refresh_token_enc").notNull(),
  accessExpiresAt: timestamp("access_expires_at", { mode: "date" })
    .notNull(),
  refreshExpiresAt: timestamp("refresh_expires_at", { mode: "date" })
    .notNull(),
  clientId: text("client_id").notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});
```

**중요**: `customType` 은 `drizzle-orm/pg-core` 에서 import 해야 한다. schema.ts 의 import 라인에 `customType` 추가:

```ts
import {
  pgTable, uuid, text, timestamp, boolean, jsonb, integer, date, index, uniqueIndex,
  numeric, customType,  // ← 추가
} from "drizzle-orm/pg-core";
```

- [ ] **Step 7: drizzle-kit generate 로 마이그레이션 SQL 생성**

Run: `cd apps/dashboard && pnpm db:generate`
Expected: `apps/dashboard/drizzle/0010_<random>.sql` 파일 생성. 6개 CREATE TABLE + INDEX 포함.

- [ ] **Step 8: 0010 SQL 에 수동 추가 — pgcrypto extension + CHECK 제약**

생성된 `apps/dashboard/drizzle/0010_*.sql` 파일의 **최상단** 에 추가:

```sql
-- PlayMCP 토큰 암호화를 위해. application 측 AES 외에도 추후 pgp_sym_encrypt
-- 가 필요할 수 있어 extension 활성화.
CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
```

**파일 하단** (CREATE TABLE 들 뒤) 에 추가:

```sql
-- 순서 무관 쌍 키: (a,b) 와 (b,a) 가 같은 row 가 되게 application 측 정렬 강제.
ALTER TABLE "playmcp_compatibility"
  ADD CONSTRAINT "playmcp_compat_order_check"
  CHECK (profile1_id < profile2_id);--> statement-breakpoint
```

- [ ] **Step 9: typecheck + lint 통과 확인**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add apps/dashboard/src/shared/lib/db/schema.ts apps/dashboard/drizzle/0010_*.sql apps/dashboard/drizzle/meta/
git commit -m "feat(tiger): DB schema 0010 — playmcp_* 5 테이블 + credentials

호 상담 영역(spec §4) 데이터 모델: playmcp_profiles, _analysis,
_yearly, _daily, _compatibility, _credentials. compatibility 는
CHECK (profile1 < profile2) 로 순서 무관 키 강제. credentials 는
bytea 컬럼 + AES-256-GCM 으로 토큰 at-rest 암호화.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 0.3: 신규 entities/tiger-reading 타입 + 비-UI

**Files:**
- Create: `apps/dashboard/src/entities/tiger-reading/model/types.ts`
- Create: `apps/dashboard/src/entities/tiger-reading/model/playmcp-response.ts`
- Create: `apps/dashboard/src/entities/tiger-reading/index.ts`

- [ ] **Step 1: PlayMCP 응답 타입 작성**

`apps/dashboard/src/entities/tiger-reading/model/playmcp-response.ts`:

```ts
// PlayMCP 1FATE 응답 타입. 1차 호출(1967-03-29 / 1976-12-01) 결과 기반.
// spec §4.2 + 1차 호출 fixture 참조.

export interface PlayMCPProfile {
  nickname_full: string;
  nickname_short: string;
  nickname_short_ja: string;
}

export interface PlayMCPPersonality {
  first_impression_ko: string;
  first_impression_en: string;
  first_impression_ja: string;
  core_trait_ko: string;
  core_trait_en: string;
  core_trait_ja: string;
  strengths_ko: string;
  strengths_en: string;
  strengths_ja: string;
}

export interface PlayMCPHealthDetails {
  balanced: boolean;
  excess: Array<{ element: string; ko: string; en: string; ja: string }>;
  lacking: Array<{ element: string; ko: string; en: string; ja: string }>;
}

export interface PlayMCPLifeHints {
  career_ko: string;
  career_en: string;
  career_ja: string;
  relationship_ko: string;
  relationship_en: string;
  relationship_ja: string;
  health_summary_ko: string;
  health_summary_en: string;
  health_summary_ja: string;
  health_details: PlayMCPHealthDetails;
}

export interface PlayMCPAnalysisResult {
  result: {
    profile: PlayMCPProfile;
    type_summary_ko: string;
    type_summary_en: string;
    type_summary_ja: string;
    personality: PlayMCPPersonality;
    element_tendency_ko: string;
    element_tendency_en: string;
    element_tendency_ja: string;
    supplement_hint_ko: string;
    supplement_hint_en: string;
    supplement_hint_ja: string;
    life_hints: PlayMCPLifeHints;
    suggested_narrative_ko: string;
    suggested_narrative_en: string;
    suggested_narrative_ja: string;
  };
  powered_by?: string;
  _build?: string;
}

// year/daily/compat 응답: 실호출로 형태 확정 필요 (구현 단계 Task 4.x 에서 fixture 채취).
// 우선 analyze 와 동일 모양으로 가정 — narrative 위주.
export interface PlayMCPYearlyResult {
  result: {
    profile: PlayMCPProfile;
    suggested_narrative_ko: string;
    suggested_narrative_en: string;
    suggested_narrative_ja: string;
    [key: string]: unknown;
  };
}

export interface PlayMCPDailyResult {
  result: {
    profile: PlayMCPProfile;
    suggested_narrative_ko: string;
    suggested_narrative_en: string;
    suggested_narrative_ja: string;
    [key: string]: unknown;
  };
}

export interface PlayMCPCompatibilityResult {
  result: {
    profile1: PlayMCPProfile;
    profile2: PlayMCPProfile;
    suggested_narrative_ko: string;
    suggested_narrative_en: string;
    suggested_narrative_ja: string;
    [key: string]: unknown;
  };
}
```

- [ ] **Step 2: DB row 타입 export**

`apps/dashboard/src/entities/tiger-reading/model/types.ts`:

```ts
import type {
  playmcpProfiles,
  playmcpAnalysis,
  playmcpYearly,
  playmcpDaily,
  playmcpCompatibility,
} from "@/shared/lib/db/schema";

export type PlaymcpProfileRow = typeof playmcpProfiles.$inferSelect;
export type PlaymcpProfileInsert = typeof playmcpProfiles.$inferInsert;
export type PlaymcpAnalysisRow = typeof playmcpAnalysis.$inferSelect;
export type PlaymcpYearlyRow = typeof playmcpYearly.$inferSelect;
export type PlaymcpDailyRow = typeof playmcpDaily.$inferSelect;
export type PlaymcpCompatibilityRow = typeof playmcpCompatibility.$inferSelect;

export const RELATION_VALUES = [
  "self",
  "spouse",
  "child",
  "parent",
  "sibling",
  "relative",
  "friend",
  "other",
] as const;
export type Relation = (typeof RELATION_VALUES)[number];

export const GENDER_VALUES = ["male", "female"] as const;
export type Gender = (typeof GENDER_VALUES)[number];

export const CALENDAR_VALUES = ["solar", "lunar"] as const;
export type Calendar = (typeof CALENDAR_VALUES)[number];
```

- [ ] **Step 3: barrel index.ts — Gotcha #1 회피용 부분 export**

`apps/dashboard/src/entities/tiger-reading/index.ts`:

```ts
// 서버 전용 export 가 섞일 때를 대비해 barrel 은 타입 + Zod-friendly 상수만.
// UI 컴포넌트는 깊은 경로로 직접 import 한다 (Gotcha #1).
//   import { TigerNarrative } from "@/entities/tiger-reading/ui/TigerNarrative";
//
// 추후 UI 컴포넌트 추가 시에도 barrel 에 넣지 말 것.
export * from "./model/types";
export * from "./model/playmcp-response";
```

- [ ] **Step 4: typecheck 통과 확인**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/entities/tiger-reading/
git commit -m "feat(tiger): entities/tiger-reading — PlayMCP 응답 타입 + DB row 타입

PlayMCP 1차 호출 결과(1967-03-29) 기반 분석 응답 타입 정의.
year/daily/compat 은 spec §10.2 fixture 채취 후 정확한 형태로 확정.
Gotcha #1 회피: barrel 은 타입만 export, UI 컴포넌트는 깊은 경로 import.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 1: PlayMCP OAuth + 클라이언트

### Task 1.1: AES-256-GCM 토큰 암호화 헬퍼

**Files:**
- Create: `apps/dashboard/src/shared/lib/db/pgcrypto.ts`
- Create: `apps/dashboard/src/shared/lib/db/pgcrypto.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`apps/dashboard/src/shared/lib/db/pgcrypto.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { encryptToken, decryptToken } from "./pgcrypto";

describe("token encryption helpers", () => {
  it("encryptToken returns Buffer with non-empty content", () => {
    const buf = encryptToken("hello", "0".repeat(32));
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("decryptToken roundtrip", () => {
    const key = "test-encryption-key-32-bytes-long!";
    const original = "secret-access-token-abc123";
    const enc = encryptToken(original, key);
    const dec = decryptToken(enc, key);
    expect(dec).toBe(original);
  });

  it("decryptToken with wrong key throws", () => {
    const enc = encryptToken("payload", "0".repeat(32));
    expect(() => decryptToken(enc, "wrong-key-".repeat(4))).toThrow();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test -- src/shared/lib/db/pgcrypto.test.ts`
Expected: FAIL — `Cannot find module './pgcrypto'`

- [ ] **Step 3: pgcrypto 모듈 구현**

`apps/dashboard/src/shared/lib/db/pgcrypto.ts`:

```ts
import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

// AES-256-GCM 으로 application-side 암호화. DB column 은 bytea 만 저장.
// PG_ENCRYPTION_KEY 는 hex 32 bytes 권장 — sha256 으로 정규화.
//
// 포맷: iv(12B) || authTag(16B) || ciphertext
//
// 참고: pgcrypto extension 자체는 마이그레이션의 CREATE EXTENSION 으로
// 활성화하지만, 토큰 암호화는 application 측이 명시적으로 처리. 이유:
// pgp_sym_encrypt 는 키를 SQL 인자로 전달 → query log 노출 위험.

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function deriveKey(input: string): Buffer {
  return createHash("sha256").update(input, "utf8").digest();
}

export function encryptToken(plaintext: string, keyMaterial: string): Buffer {
  const key = deriveKey(keyMaterial);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

export function decryptToken(blob: Buffer, keyMaterial: string): string {
  if (blob.length < IV_LEN + TAG_LEN) {
    throw new Error("decryptToken: blob too short");
  }
  const key = deriveKey(keyMaterial);
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = blob.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test -- src/shared/lib/db/pgcrypto.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/shared/lib/db/pgcrypto.ts apps/dashboard/src/shared/lib/db/pgcrypto.test.ts
git commit -m "feat(tiger): AES-256-GCM 토큰 암호화 헬퍼

PlayMCP access/refresh 토큰을 DB bytea 컬럼에 저장하기 전 application
측 암호화. pgp_sym_encrypt 의 query log 노출 위험 회피. PG_ENCRYPTION_KEY
는 sha256 으로 32 bytes 정규화.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.2: PlayMCP credentials 모듈

**Files:**
- Create: `apps/dashboard/src/features/tiger-consult/lib/playmcp-credentials.ts`
- Create: `apps/dashboard/src/features/tiger-consult/lib/playmcp-credentials.test.ts`
- Create: `apps/dashboard/src/features/tiger-consult/lib/errors.ts`

- [ ] **Step 1: errors.ts 먼저 (의존 모듈)**

`apps/dashboard/src/features/tiger-consult/lib/errors.ts`:

```ts
// PlayMCP 호출의 5계층 에러 분류 (spec §7).

export class PlayMCPNotConfiguredError extends Error {
  readonly code = "L1_NOT_CONFIGURED" as const;
  constructor(message?: string) {
    super(message ?? "playmcp_credentials 미설정. tiger:bootstrap 필요.");
    this.name = "PlayMCPNotConfiguredError";
  }
}

export class PlayMCPAuthError extends Error {
  readonly code = "L1_AUTH" as const;
  readonly recoverable: boolean;
  constructor(message: string, opts?: { recoverable?: boolean }) {
    super(message);
    this.name = "PlayMCPAuthError";
    this.recoverable = opts?.recoverable ?? false;
  }
}

export class PlayMCPNetworkError extends Error {
  readonly code = "L2_NETWORK" as const;
  readonly recoverable = true as const;
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "PlayMCPNetworkError";
  }
}

export class PlayMCPInputError extends Error {
  readonly code = "L3_INPUT" as const;
  readonly recoverable = false as const;
  constructor(message: string, readonly field?: string) {
    super(message);
    this.name = "PlayMCPInputError";
  }
}

export class PlayMCPCrossTalkDetectedError extends Error {
  readonly code = "L4_CROSS_TALK" as const;
  readonly recoverable = false as const;
  constructor(readonly reason: string, readonly tool: string, readonly profileId: string) {
    super(`PlayMCP cross-talk detected: ${reason} (tool=${tool}, profileId=${profileId})`);
    this.name = "PlayMCPCrossTalkDetectedError";
  }
}

export class PlayMCPSchemaError extends Error {
  readonly code = "L5_SCHEMA" as const;
  readonly recoverable = false as const;
  constructor(message: string) {
    super(message);
    this.name = "PlayMCPSchemaError";
  }
}

export type PlayMCPError =
  | PlayMCPNotConfiguredError
  | PlayMCPAuthError
  | PlayMCPNetworkError
  | PlayMCPInputError
  | PlayMCPCrossTalkDetectedError
  | PlayMCPSchemaError;

export function isPlayMCPError(err: unknown): err is PlayMCPError {
  return (
    err instanceof PlayMCPNotConfiguredError ||
    err instanceof PlayMCPAuthError ||
    err instanceof PlayMCPNetworkError ||
    err instanceof PlayMCPInputError ||
    err instanceof PlayMCPCrossTalkDetectedError ||
    err instanceof PlayMCPSchemaError
  );
}
```

- [ ] **Step 2: credentials 테스트 작성**

`apps/dashboard/src/features/tiger-consult/lib/playmcp-credentials.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ensureAccessToken } from "./playmcp-credentials";
import { PlayMCPNotConfiguredError } from "./errors";

// db client 모킹 — limit/select/insert/update 체인.
const mockSelectLimit = vi.fn();
const mockUpdate = vi.fn();
const mockInsert = vi.fn();

vi.mock("@/shared/lib/db/client", () => ({
  db: {
    select: () => ({ from: () => ({ limit: mockSelectLimit }) }),
    insert: () => ({ values: () => ({ returning: mockInsert }) }),
    update: () => ({ set: () => ({ where: mockUpdate }) }),
  },
}));

vi.mock("@/shared/config/env", () => ({
  env: { PG_ENCRYPTION_KEY: "test-key-".repeat(4), PLAYMCP_CLIENT_ID: "test-client" },
}));

beforeEach(() => {
  mockSelectLimit.mockReset();
  mockUpdate.mockReset();
  mockInsert.mockReset();
});

describe("ensureAccessToken", () => {
  it("credentials 미존재 시 PlayMCPNotConfiguredError throw", async () => {
    mockSelectLimit.mockResolvedValue([]);
    await expect(ensureAccessToken()).rejects.toBeInstanceOf(PlayMCPNotConfiguredError);
  });

  it("access_expires_at 이 5분+ 남았으면 기존 token 반환 (refresh 호출 안 함)", async () => {
    const { encryptToken } = await import("@/shared/lib/db/pgcrypto");
    const encrypted = encryptToken("valid-access-token", "test-key-".repeat(4));
    mockSelectLimit.mockResolvedValue([{
      accessTokenEnc: encrypted,
      refreshTokenEnc: encrypted,
      accessExpiresAt: new Date(Date.now() + 10 * 60_000),
      refreshExpiresAt: new Date(Date.now() + 30 * 86400_000),
      clientId: "test-client",
    }]);
    const token = await ensureAccessToken();
    expect(token).toBe("valid-access-token");
  });
});
```

- [ ] **Step 3: 테스트 실행 → 실패 확인**

Run: `pnpm test -- src/features/tiger-consult/lib/playmcp-credentials.test.ts`
Expected: FAIL — `Cannot find module './playmcp-credentials'`

- [ ] **Step 4: playmcp-credentials.ts 구현**

`apps/dashboard/src/features/tiger-consult/lib/playmcp-credentials.ts`:

```ts
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { playmcpCredentials } from "@/shared/lib/db/schema";
import { env } from "@/shared/config/env";
import { encryptToken, decryptToken } from "@/shared/lib/db/pgcrypto";
import { PlayMCPNotConfiguredError, PlayMCPAuthError, PlayMCPNetworkError } from "./errors";

const ACCESS_REFRESH_THRESHOLD_MS = 5 * 60_000; // 5 분

interface RefreshTokenResponse {
  accessToken: { tokenValue: string; expiresAt: string };
  refreshToken: { tokenValue: string; expiresAt: string };
}

export async function ensureAccessToken(): Promise<string> {
  const rows = await db.select().from(playmcpCredentials).limit(1);
  const cred = rows[0];
  if (!cred) {
    throw new PlayMCPNotConfiguredError();
  }
  const now = Date.now();
  if (cred.accessExpiresAt.getTime() - now > ACCESS_REFRESH_THRESHOLD_MS) {
    return decryptToken(cred.accessTokenEnc, env.PG_ENCRYPTION_KEY);
  }
  return refreshAccessToken(cred.id, decryptToken(cred.refreshTokenEnc, env.PG_ENCRYPTION_KEY));
}

async function refreshAccessToken(credId: string, refreshToken: string): Promise<string> {
  // PlayMCP 게이트웨이 토큰 refresh — endpoint 형식은 mcp-connection-guide.md
  // 의 OTT exchange 와 동일 구조 가정. 구현 단계에서 mcporter SDK 분석으로
  // 정확한 경로 확정 필요.
  const url = new URL("/api/v1/auths/tokens:refresh", env.PLAYMCP_GATEWAY_URL).toString();
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new PlayMCPNetworkError("refresh fetch failed", err);
  }
  if (!response.ok) {
    throw new PlayMCPAuthError(
      `refresh token 거부: ${response.status} ${response.statusText}`,
      { recoverable: false },
    );
  }
  const body = (await response.json()) as RefreshTokenResponse;
  const newAccessExpiresAt = new Date(body.accessToken.expiresAt);
  const newRefreshExpiresAt = new Date(body.refreshToken.expiresAt);
  await db
    .update(playmcpCredentials)
    .set({
      accessTokenEnc: encryptToken(body.accessToken.tokenValue, env.PG_ENCRYPTION_KEY),
      refreshTokenEnc: encryptToken(body.refreshToken.tokenValue, env.PG_ENCRYPTION_KEY),
      accessExpiresAt: newAccessExpiresAt,
      refreshExpiresAt: newRefreshExpiresAt,
      updatedAt: new Date(),
    })
    .where(eq(playmcpCredentials.id, credId));
  return body.accessToken.tokenValue;
}

export interface SaveCredentialsInput {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

export async function saveCredentials(input: SaveCredentialsInput): Promise<void> {
  // 단일 row 강제: 기존 row 가 있으면 UPDATE, 없으면 INSERT.
  const existing = await db.select({ id: playmcpCredentials.id }).from(playmcpCredentials).limit(1);
  const values = {
    accessTokenEnc: encryptToken(input.accessToken, env.PG_ENCRYPTION_KEY),
    refreshTokenEnc: encryptToken(input.refreshToken, env.PG_ENCRYPTION_KEY),
    accessExpiresAt: input.accessExpiresAt,
    refreshExpiresAt: input.refreshExpiresAt,
    clientId: env.PLAYMCP_CLIENT_ID,
    updatedAt: new Date(),
  };
  if (existing[0]) {
    await db.update(playmcpCredentials).set(values).where(eq(playmcpCredentials.id, existing[0].id));
  } else {
    await db.insert(playmcpCredentials).values(values);
  }
}

// 운영자 진단 페이지용 노출.
export async function getCredentialsSummary(): Promise<{
  configured: boolean;
  accessExpiresAt?: Date;
  refreshExpiresAt?: Date;
  updatedAt?: Date;
}> {
  const rows = await db
    .select({
      accessExpiresAt: playmcpCredentials.accessExpiresAt,
      refreshExpiresAt: playmcpCredentials.refreshExpiresAt,
      updatedAt: playmcpCredentials.updatedAt,
    })
    .from(playmcpCredentials)
    .limit(1);
  if (!rows[0]) return { configured: false };
  return { configured: true, ...rows[0] };
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm test -- src/features/tiger-consult/lib/playmcp-credentials.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/features/tiger-consult/
git commit -m "feat(tiger): PlayMCP credentials 모듈 — OAuth token refresh + 단일 row

ensureAccessToken: 5분 buffer 로 자동 refresh. saveCredentials:
운영자 bootstrap 시 INSERT 또는 UPDATE (단일 row 강제).
errors.ts 5계층 에러 분류 추가 (L1~L5).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.3: PlayMCP 호출 클라이언트 (p-limit + jitter)

**Files:**
- Create: `apps/dashboard/src/features/tiger-consult/lib/playmcp-client.ts`
- Create: `apps/dashboard/src/features/tiger-consult/lib/playmcp-client.test.ts`

- [ ] **Step 1: p-limit 의존성 추가**

```bash
cd apps/dashboard && pnpm add p-limit
```

확인:

```bash
grep '"p-limit"' apps/dashboard/package.json
```

Expected: 버전 라인 출력.

- [ ] **Step 2: 테스트 작성 — Authorization 헤더 + JSON 응답 검증**

`apps/dashboard/src/features/tiger-consult/lib/playmcp-client.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./playmcp-credentials", () => ({
  ensureAccessToken: vi.fn().mockResolvedValue("test-access-token"),
}));
vi.mock("@/shared/config/env", () => ({
  env: { PLAYMCP_GATEWAY_URL: "https://playmcp.test/mcp" },
}));

beforeEach(() => {
  vi.resetModules();
});

describe("callTool", () => {
  it("Authorization Bearer 헤더 + JSON body 포함", async () => {
    const { callTool } = await import("./playmcp-client");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { profile: { nickname_full: "x" } } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await callTool("1fate-analyze_saju", {
      birth_date: "1990-01-01", gender: "male", calendar: "solar",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer test-access-token");
    const body = JSON.parse(init.body);
    expect(body.tool).toBe("1fate-analyze_saju");
    expect(body.params.birth_date).toBe("1990-01-01");
  });

  it("응답에 result 필드 없으면 SchemaError", async () => {
    const { callTool } = await import("./playmcp-client");
    const { PlayMCPSchemaError } = await import("./errors");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ unexpected: "structure" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      callTool("1fate-analyze_saju", { birth_date: "1990-01-01", gender: "male", calendar: "solar" }),
    ).rejects.toBeInstanceOf(PlayMCPSchemaError);
  });
});
```

- [ ] **Step 3: 테스트 실행 → 실패 확인**

Run: `pnpm test -- src/features/tiger-consult/lib/playmcp-client.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: playmcp-client.ts 구현**

`apps/dashboard/src/features/tiger-consult/lib/playmcp-client.ts`:

```ts
import "server-only";
import pLimit from "p-limit";
import { env } from "@/shared/config/env";
import { ensureAccessToken } from "./playmcp-credentials";
import { PlayMCPNetworkError, PlayMCPAuthError, PlayMCPInputError, PlayMCPSchemaError } from "./errors";

export type ToolName =
  | "1fate-analyze_saju"
  | "1fate-get_year_fortune"
  | "1fate-get_daily_fortune"
  | "1fate-check_compatibility";

// 동시 호출 시 PlayMCP 서버 측 cross-talk 위험 (1차 실증) → concurrency=1.
const playmcpLimit = pLimit(1);

// 1.5~2.0 s jitter — 직전 호출 응답 전부 도달 보장 + 시간 변동성으로
// 캐시 키 충돌 회피.
const JITTER_MIN_MS = 1500;
const JITTER_RANGE_MS = 500;

const CALL_TIMEOUT_MS = 30_000;

export async function callTool<T>(toolName: ToolName, params: Record<string, unknown>): Promise<T> {
  return playmcpLimit(async () => {
    await sleep(JITTER_MIN_MS + Math.random() * JITTER_RANGE_MS);
    const token = await ensureAccessToken();
    const url = env.PLAYMCP_GATEWAY_URL;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tool: toolName, params }),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (err) {
      throw new PlayMCPNetworkError(`PlayMCP fetch failed for ${toolName}`, err);
    }
    if (!response.ok) {
      const bodyText = await response.text().catch(() => "<no body>");
      if (response.status === 401 || response.status === 403) {
        throw new PlayMCPAuthError(`${response.status} ${response.statusText}`, { recoverable: true });
      }
      if (response.status === 400 || response.status === 422) {
        throw new PlayMCPInputError(`${response.status}: ${bodyText.slice(0, 200)}`);
      }
      throw new PlayMCPNetworkError(`${response.status} ${response.statusText}: ${bodyText.slice(0, 200)}`);
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch (err) {
      throw new PlayMCPSchemaError(`응답 JSON parse 실패: ${(err as Error).message}`);
    }
    if (!json || typeof json !== "object" || !("result" in json)) {
      throw new PlayMCPSchemaError(`응답에 result 필드 없음`);
    }
    return json as T;
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm test -- src/features/tiger-consult/lib/playmcp-client.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/features/tiger-consult/lib/playmcp-client.ts apps/dashboard/src/features/tiger-consult/lib/playmcp-client.test.ts apps/dashboard/package.json apps/dashboard/pnpm-lock.yaml
git commit -m "feat(tiger): PlayMCP 호출 클라이언트 — p-limit 1 + 1.5s jitter

cross-talk 회피용 직렬화 + jitter. HTTP 상태별 5계층 에러 매핑
(401/403→L1, 400/422→L3, 5xx→L2, JSON 파싱→L5). 30초 timeout.
gateway endpoint 가정 — mcporter SDK 분석 후 정확한 body schema 확정 필요.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2: 검증 게이트 + 캐시 + 해시

### Task 2.1: inputHash 모듈

**Files:**
- Create: `apps/dashboard/src/features/tiger-consult/lib/hash.ts`
- Create: `apps/dashboard/src/features/tiger-consult/lib/hash.test.ts`

- [ ] **Step 1: 테스트 작성**

`apps/dashboard/src/features/tiger-consult/lib/hash.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeProfileInputHash, computePairInputHash } from "./hash";

describe("computeProfileInputHash", () => {
  it("동일 입력 동일 hash", () => {
    const a = computeProfileInputHash({
      birthDate: "1967-03-29", calendar: "solar", gender: "male",
      birthTime: "05:30", birthCity: "Seoul",
    });
    const b = computeProfileInputHash({
      birthDate: "1967-03-29", calendar: "solar", gender: "male",
      birthTime: "05:30", birthCity: "Seoul",
    });
    expect(a).toBe(b);
  });

  it("birthTime null vs '' vs '05:30' 구분", () => {
    const h1 = computeProfileInputHash({
      birthDate: "1967-03-29", calendar: "solar", gender: "male",
      birthTime: null, birthCity: null,
    });
    const h2 = computeProfileInputHash({
      birthDate: "1967-03-29", calendar: "solar", gender: "male",
      birthTime: "05:30", birthCity: null,
    });
    expect(h1).not.toBe(h2);
  });

  it("gender 다르면 hash 다름", () => {
    const m = computeProfileInputHash({
      birthDate: "1967-03-29", calendar: "solar", gender: "male",
      birthTime: null, birthCity: null,
    });
    const f = computeProfileInputHash({
      birthDate: "1967-03-29", calendar: "solar", gender: "female",
      birthTime: null, birthCity: null,
    });
    expect(m).not.toBe(f);
  });
});

describe("computePairInputHash", () => {
  it("순서 무관 (a,b) == (b,a)", () => {
    const h1 = computePairInputHash("hashA", "hashB");
    const h2 = computePairInputHash("hashB", "hashA");
    expect(h1).toBe(h2);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- src/features/tiger-consult/lib/hash.test.ts`
Expected: FAIL

- [ ] **Step 3: hash.ts 구현**

`apps/dashboard/src/features/tiger-consult/lib/hash.ts`:

```ts
import { createHash } from "node:crypto";

export interface ProfileHashInput {
  birthDate: string;
  calendar: string;
  gender: string;
  birthTime: string | null;
  birthCity: string | null;
}

export function computeProfileInputHash(input: ProfileHashInput): string {
  const parts = [
    input.birthDate,
    input.calendar,
    input.gender,
    input.birthTime ?? "",
    input.birthCity ?? "",
  ];
  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex");
}

export function computePairInputHash(hashA: string, hashB: string): string {
  const [first, second] = [hashA, hashB].sort();
  return createHash("sha256").update(`${first}|${second}`, "utf8").digest("hex");
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm test -- src/features/tiger-consult/lib/hash.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/features/tiger-consult/lib/hash.ts apps/dashboard/src/features/tiger-consult/lib/hash.test.ts
git commit -m "feat(tiger): inputHash + pairHash — birth_* 5필드 sha256 캐시 키"
```

---

### Task 2.2: validate.ts — cross-talk 검증 게이트

**Files:**
- Create: `apps/dashboard/src/features/tiger-consult/lib/validate.ts`
- Create: `apps/dashboard/src/features/tiger-consult/lib/validate.test.ts`
- Create: `apps/dashboard/tests/playmcp-fixtures/analyze-1967-03-29-male.json`
- Create: `apps/dashboard/tests/playmcp-fixtures/analyze-1976-12-01-male-cross-talk.json`

- [ ] **Step 1: 1차 호출 응답을 fixture 로 저장**

`apps/dashboard/tests/playmcp-fixtures/analyze-1967-03-29-male.json`:

본인이 1차 호출에서 받은 1967-03-29 응답 JSON 전체를 그대로 저장 (대화 로그 참조). 시작:

```json
{
  "result": {
    "profile": {
      "nickname_full": "독립적인 깊은바다 양 (1967.03.29, 양력, 남자)",
      "nickname_short": "독립적인 깊은바다 양(남자)",
      "nickname_short_ja": "독립적인 깊은바다 양(남자)"
    },
    "type_summary_ko": "수(水) 양수 - 큰 바다의 기운의 기운을 가진 분이에요."
  }
}
```

(전체 JSON 은 대화 로그의 1차 호출 결과를 그대로 복사. 응답 cross-talk 회귀 검증의 핵심 fixture.)

`apps/dashboard/tests/playmcp-fixtures/analyze-1976-12-01-male-cross-talk.json`:

본인이 1차 호출에서 받은 1976-12-01 응답 JSON 전체. `element_tendency_ko: "水(수) 기운이 강하고..."` 가 leak 된 상태로 보존:

```json
{
  "result": {
    "profile": {
      "nickname_full": "책임감있는 불꽃 용 (1976.12.01, 양력, 남자)",
      "nickname_short": "책임감있는 불꽃 용(남자)",
      "nickname_short_ja": "책임감있는 불꽃 용(남자)"
    },
    "type_summary_ko": "화(火) 음화 - 촛불의 기운의 기운을 가진 분이에요.",
    "element_tendency_ko": "水(수) 기운이 강하고, 金(금) 기운이 부족합니다."
  }
}
```

(이 응답이 cross-talk leak 의 증거 fixture. validate.ts 의 단위 테스트가 이 데이터로 검증한다.)

- [ ] **Step 2: validate.test.ts 작성**

`apps/dashboard/src/features/tiger-consult/lib/validate.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateAnalysisResponse, validateCompatibilityResponse, _resetRecentNicknames } from "./validate";

const fix1967 = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../tests/playmcp-fixtures/analyze-1967-03-29-male.json"), "utf8"),
);
const fix1976 = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../tests/playmcp-fixtures/analyze-1976-12-01-male-cross-talk.json"), "utf8"),
);

const profile1967 = {
  id: "profile-1967",
  nickname: "본인",
  birthDate: "1967-03-29",
  gender: "male" as const,
};
const profile1976 = {
  id: "profile-1976",
  nickname: "친구",
  birthDate: "1976-12-01",
  gender: "male" as const,
};

beforeEach(() => _resetRecentNicknames());

describe("validateAnalysisResponse — Check 1 (birth_date)", () => {
  it("정상: nickname_full 에 1967.03.29 포함 → ok", () => {
    expect(validateAnalysisResponse(fix1967, profile1967)).toEqual({ ok: true });
  });

  it("실패: nickname_full 에 birth_date 미포함", () => {
    const bad = {
      ...fix1967,
      result: {
        ...fix1967.result,
        profile: { ...fix1967.result.profile, nickname_full: "이름만 있고 날짜 없음 (남자)" },
      },
    };
    expect(validateAnalysisResponse(bad, profile1967)).toEqual({
      ok: false,
      reason: "birth_date_missing_in_nickname",
    });
  });
});

describe("validateAnalysisResponse — Check 2 (gender)", () => {
  it("실패: 남자 프로필인데 nickname 에 '여자'", () => {
    const bad = {
      ...fix1967,
      result: {
        ...fix1967.result,
        profile: { ...fix1967.result.profile, nickname_full: "X (1967.03.29, 양력, 여자)" },
      },
    };
    expect(validateAnalysisResponse(bad, profile1967)).toEqual({
      ok: false,
      reason: "gender_mismatch",
    });
  });
});

describe("validateAnalysisResponse — Check 4 (LRU)", () => {
  it("같은 nickname 이 다른 profileId 로 들어오면 실패", () => {
    expect(validateAnalysisResponse(fix1967, profile1967)).toEqual({ ok: true });
    const result = validateAnalysisResponse(fix1967, { ...profile1967, id: "different-profile" });
    expect(result).toEqual({ ok: false, reason: "duplicate_nickname_different_profile" });
  });

  it("같은 nickname + 같은 profileId 는 통과 (재호출 시 정상)", () => {
    expect(validateAnalysisResponse(fix1967, profile1967)).toEqual({ ok: true });
    expect(validateAnalysisResponse(fix1967, profile1967)).toEqual({ ok: true });
  });
});

describe("validateCompatibilityResponse", () => {
  it("실패: narrative 에 한 쪽 birth_date 만 포함", () => {
    const compatResp = {
      result: {
        profile1: fix1967.result.profile,
        profile2: fix1976.result.profile,
        suggested_narrative_ko: "1967.03.29 에 관한 이야기만 있고 1976 은 빠짐",
        suggested_narrative_en: "",
        suggested_narrative_ja: "",
      },
    };
    expect(validateCompatibilityResponse(compatResp, profile1967, profile1976)).toEqual({
      ok: false,
      reason: "compatibility_one_side_missing",
    });
  });

  it("통과: 두 birth_date 모두 narrative 에 포함", () => {
    const compatResp = {
      result: {
        profile1: fix1967.result.profile,
        profile2: fix1976.result.profile,
        suggested_narrative_ko: "1967.03.29 분과 1976.12.01 분의 인연...",
        suggested_narrative_en: "",
        suggested_narrative_ja: "",
      },
    };
    expect(validateCompatibilityResponse(compatResp, profile1967, profile1976)).toEqual({ ok: true });
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm test -- src/features/tiger-consult/lib/validate.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: validate.ts 구현**

`apps/dashboard/src/features/tiger-consult/lib/validate.ts`:

```ts
import type {
  PlayMCPAnalysisResult,
  PlayMCPCompatibilityResult,
} from "@/entities/tiger-reading";

export type ValidationResult = { ok: true } | { ok: false; reason: string };

interface ProfileForValidation {
  id: string;
  nickname: string;
  birthDate: string;
  gender: "male" | "female";
}

// in-memory LRU(20). 컨테이너 재시작 시 리셋. cross-talk 은 짧은 시간 창 안의
// 연속 호출에서 발생하므로 메모리 LRU 로 충분 (spec §6.1 Check 4).
const LRU_MAX = 20;
const recentNicknames = new Map<string, string>();

function rememberNickname(nickname: string, profileId: string): void {
  recentNicknames.delete(nickname);
  recentNicknames.set(nickname, profileId);
  if (recentNicknames.size > LRU_MAX) {
    const oldestKey = recentNicknames.keys().next().value;
    if (oldestKey) recentNicknames.delete(oldestKey);
  }
}

/** 테스트 전용. production 코드에서 호출 금지. */
export function _resetRecentNicknames(): void {
  recentNicknames.clear();
}

function dateFormats(birthDate: string): string[] {
  return [
    birthDate,                           // '1967-03-29'
    birthDate.replace(/-/g, "."),        // '1967.03.29' (PlayMCP 1차 실증 포맷)
    birthDate.replace(/-/g, "/"),        // '1967/03/29'
  ];
}

export function validateAnalysisResponse(
  response: PlayMCPAnalysisResult,
  profile: ProfileForValidation,
): ValidationResult {
  const nick = response?.result?.profile?.nickname_full ?? "";
  const nickShort = response?.result?.profile?.nickname_short ?? "";
  const narrative = response?.result?.suggested_narrative_ko ?? "";

  // Check 1
  if (!dateFormats(profile.birthDate).some((f) => nick.includes(f))) {
    return { ok: false, reason: "birth_date_missing_in_nickname" };
  }
  // Check 2
  const genderKo = profile.gender === "male" ? "남자" : "여자";
  if (!nick.includes(genderKo)) {
    return { ok: false, reason: "gender_mismatch" };
  }
  // Check 3 — narrative 가 있을 때만 검사 (fixture 가 짧을 수 있음)
  if (narrative) {
    const paragraphs = narrative.split("\n\n");
    const firstSubstantive = paragraphs[1] ?? paragraphs[0] ?? "";
    if (nickShort && firstSubstantive && !firstSubstantive.includes(nickShort)) {
      return { ok: false, reason: "narrative_nickname_inconsistent" };
    }
  }
  // Check 4
  const owner = recentNicknames.get(nick);
  if (owner && owner !== profile.id) {
    return { ok: false, reason: "duplicate_nickname_different_profile" };
  }
  rememberNickname(nick, profile.id);
  return { ok: true };
}

export function validateYearlyResponse(
  response: { result: { profile?: { nickname_full?: string }; suggested_narrative_ko?: string } },
  profile: ProfileForValidation,
): ValidationResult {
  // year 응답도 profile 필드를 가정. analyze 와 동일 검사.
  return validateAnalysisResponse(response as PlayMCPAnalysisResult, profile);
}

export function validateDailyResponse(
  response: { result: { profile?: { nickname_full?: string }; suggested_narrative_ko?: string } },
  profile: ProfileForValidation,
): ValidationResult {
  return validateAnalysisResponse(response as PlayMCPAnalysisResult, profile);
}

export function validateCompatibilityResponse(
  response: PlayMCPCompatibilityResult,
  p1: ProfileForValidation,
  p2: ProfileForValidation,
): ValidationResult {
  const narrative = response?.result?.suggested_narrative_ko ?? "";
  const has1 = dateFormats(p1.birthDate).some((f) => narrative.includes(f));
  const has2 = dateFormats(p2.birthDate).some((f) => narrative.includes(f));
  if (!has1 || !has2) {
    return { ok: false, reason: "compatibility_one_side_missing" };
  }
  return { ok: true };
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm test -- src/features/tiger-consult/lib/validate.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/features/tiger-consult/lib/validate.ts apps/dashboard/src/features/tiger-consult/lib/validate.test.ts apps/dashboard/tests/playmcp-fixtures/
git commit -m "feat(tiger): cross-talk 검증 게이트 — 4단 검사 + LRU 20

PlayMCP 1차 호출에서 확인된 cross-talk 결함(1976-12-01 응답에
1967-03-29 element_tendency leak)을 영구 회귀 차단. fixture 로
실제 응답 JSON 2개 저장 — narrative-nickname 일치, LRU 충돌
검증 케이스 6개 통과.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2.3: cache.ts — getOrFetch 모듈

**Files:**
- Create: `apps/dashboard/src/features/tiger-consult/lib/cache.ts`
- Create: `apps/dashboard/src/features/tiger-consult/lib/cache.test.ts`

- [ ] **Step 1: 테스트 작성**

`apps/dashboard/src/features/tiger-consult/lib/cache.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockSelect = vi.fn();
const mockInsert = vi.fn();

vi.mock("@/shared/lib/db/client", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: mockSelect }) }) }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
}));

vi.mock("@/shared/lib/db/schema", () => ({
  playmcpAnalysis: {},
  playmcpYearly: {},
  playmcpDaily: {},
  playmcpCompatibility: {},
}));

beforeEach(() => {
  mockSelect.mockReset();
  mockInsert.mockReset();
});

describe("getOrFetchAnalysis", () => {
  it("DB hit (inputHash 일치): fetcher 호출 안 함", async () => {
    const { getOrFetchAnalysis } = await import("./cache");
    mockSelect.mockResolvedValue([{ profileId: "p1", inputHash: "abc", payload: { result: { x: 1 } } }]);
    const fetcher = vi.fn();
    const validator = vi.fn(() => ({ ok: true }) as const);
    const { payload, fromCache } = await getOrFetchAnalysis({
      profileId: "p1", inputHash: "abc", tool: "1fate-analyze_saju",
      fetcher, validator,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(fromCache).toBe(true);
    expect(payload).toEqual({ result: { x: 1 } });
  });

  it("inputHash 불일치 → fetcher 호출 → UPSERT", async () => {
    const { getOrFetchAnalysis } = await import("./cache");
    mockSelect.mockResolvedValue([{ profileId: "p1", inputHash: "stale", payload: {} }]);
    const fetcher = vi.fn().mockResolvedValue({ result: { fresh: true } });
    const validator = vi.fn(() => ({ ok: true }) as const);
    const { fromCache, payload } = await getOrFetchAnalysis({
      profileId: "p1", inputHash: "fresh-hash", tool: "1fate-analyze_saju",
      fetcher, validator,
    });
    expect(fetcher).toHaveBeenCalled();
    expect(validator).toHaveBeenCalledWith({ result: { fresh: true } });
    expect(fromCache).toBe(false);
    expect(payload).toEqual({ result: { fresh: true } });
  });

  it("validator 실패 → throw, UPSERT 안 함", async () => {
    const { getOrFetchAnalysis } = await import("./cache");
    const { PlayMCPCrossTalkDetectedError } = await import("./errors");
    mockSelect.mockResolvedValue([]);
    const fetcher = vi.fn().mockResolvedValue({ result: { polluted: true } });
    const validator = vi.fn(() => ({ ok: false, reason: "test-reason" }) as const);
    await expect(
      getOrFetchAnalysis({
        profileId: "p1", inputHash: "h", tool: "1fate-analyze_saju",
        fetcher, validator,
      }),
    ).rejects.toBeInstanceOf(PlayMCPCrossTalkDetectedError);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- src/features/tiger-consult/lib/cache.test.ts`
Expected: FAIL

- [ ] **Step 3: cache.ts 구현**

`apps/dashboard/src/features/tiger-consult/lib/cache.ts`:

```ts
import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  playmcpAnalysis,
  playmcpYearly,
  playmcpDaily,
  playmcpCompatibility,
} from "@/shared/lib/db/schema";
import { PlayMCPCrossTalkDetectedError } from "./errors";
import type { ValidationResult } from "./validate";

interface CacheFetchInput<T> {
  profileId: string;
  inputHash: string;
  fetcher: () => Promise<T>;
  validator: (payload: T) => ValidationResult;
  tool: string;
}

interface CacheResult<T> {
  payload: T;
  fromCache: boolean;
}

export async function getOrFetchAnalysis<T>(input: CacheFetchInput<T>): Promise<CacheResult<T>> {
  const existing = await db
    .select()
    .from(playmcpAnalysis)
    .where(eq(playmcpAnalysis.profileId, input.profileId))
    .limit(1);
  if (existing[0] && existing[0].inputHash === input.inputHash) {
    return { payload: existing[0].payload as T, fromCache: true };
  }
  const fresh = await callValidated(input);
  await db
    .insert(playmcpAnalysis)
    .values({
      profileId: input.profileId,
      inputHash: input.inputHash,
      payload: fresh as unknown as object,
      validatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: playmcpAnalysis.profileId,
      set: {
        inputHash: input.inputHash,
        payload: fresh as unknown as object,
        validatedAt: new Date(),
      },
    });
  return { payload: fresh, fromCache: false };
}

interface YearlyInput<T> extends CacheFetchInput<T> {
  year: number;
}

export async function getOrFetchYearly<T>(input: YearlyInput<T>): Promise<CacheResult<T>> {
  const existing = await db
    .select()
    .from(playmcpYearly)
    .where(and(eq(playmcpYearly.profileId, input.profileId), eq(playmcpYearly.year, input.year)))
    .limit(1);
  if (existing[0] && existing[0].inputHash === input.inputHash) {
    return { payload: existing[0].payload as T, fromCache: true };
  }
  const fresh = await callValidated(input);
  await db
    .insert(playmcpYearly)
    .values({
      profileId: input.profileId,
      year: input.year,
      inputHash: input.inputHash,
      payload: fresh as unknown as object,
      validatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [playmcpYearly.profileId, playmcpYearly.year],
      set: { inputHash: input.inputHash, payload: fresh as unknown as object, validatedAt: new Date() },
    });
  return { payload: fresh, fromCache: false };
}

interface DailyInput<T> extends CacheFetchInput<T> {
  forDateKst: string;
}

export async function getOrFetchDaily<T>(input: DailyInput<T>): Promise<CacheResult<T>> {
  const existing = await db
    .select()
    .from(playmcpDaily)
    .where(
      and(
        eq(playmcpDaily.profileId, input.profileId),
        eq(playmcpDaily.forDateKst, input.forDateKst),
      ),
    )
    .limit(1);
  if (existing[0] && existing[0].inputHash === input.inputHash) {
    return { payload: existing[0].payload as T, fromCache: true };
  }
  const fresh = await callValidated(input);
  await db
    .insert(playmcpDaily)
    .values({
      profileId: input.profileId,
      forDateKst: input.forDateKst,
      inputHash: input.inputHash,
      payload: fresh as unknown as object,
      validatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [playmcpDaily.profileId, playmcpDaily.forDateKst],
      set: { inputHash: input.inputHash, payload: fresh as unknown as object, validatedAt: new Date() },
    });
  return { payload: fresh, fromCache: false };
}

interface CompatInput<T> {
  profile1Id: string;
  profile2Id: string;
  inputHash1: string;
  inputHash2: string;
  pairHash: string;
  fetcher: () => Promise<T>;
  validator: (payload: T) => ValidationResult;
  tool: string;
}

export async function getOrFetchCompatibility<T>(input: CompatInput<T>): Promise<CacheResult<T>> {
  if (input.profile1Id >= input.profile2Id) {
    throw new Error("getOrFetchCompatibility: profile1Id must be < profile2Id");
  }
  const existing = await db
    .select()
    .from(playmcpCompatibility)
    .where(
      and(
        eq(playmcpCompatibility.profile1Id, input.profile1Id),
        eq(playmcpCompatibility.profile2Id, input.profile2Id),
      ),
    )
    .limit(1);
  if (existing[0] && existing[0].inputHash1 === input.inputHash1 && existing[0].inputHash2 === input.inputHash2) {
    return { payload: existing[0].payload as T, fromCache: true };
  }
  const fresh = await callValidatedForCompat(input);
  await db
    .insert(playmcpCompatibility)
    .values({
      profile1Id: input.profile1Id,
      profile2Id: input.profile2Id,
      inputHash1: input.inputHash1,
      inputHash2: input.inputHash2,
      payload: fresh as unknown as object,
      validatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [playmcpCompatibility.profile1Id, playmcpCompatibility.profile2Id],
      set: {
        inputHash1: input.inputHash1,
        inputHash2: input.inputHash2,
        payload: fresh as unknown as object,
        validatedAt: new Date(),
      },
    });
  return { payload: fresh, fromCache: false };
}

async function callValidated<T>(input: CacheFetchInput<T>): Promise<T> {
  const fresh = await input.fetcher();
  const result = input.validator(fresh);
  if (!result.ok) {
    throw new PlayMCPCrossTalkDetectedError(result.reason, input.tool, input.profileId);
  }
  return fresh;
}

async function callValidatedForCompat<T>(input: CompatInput<T>): Promise<T> {
  const fresh = await input.fetcher();
  const result = input.validator(fresh);
  if (!result.ok) {
    throw new PlayMCPCrossTalkDetectedError(
      result.reason,
      input.tool,
      `${input.profile1Id}+${input.profile2Id}`,
    );
  }
  return fresh;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test -- src/features/tiger-consult/lib/cache.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/features/tiger-consult/lib/cache.ts apps/dashboard/src/features/tiger-consult/lib/cache.test.ts
git commit -m "feat(tiger): getOrFetch 캐시 모듈 — analysis/yearly/daily/compat

DB 영구 캐시 + inputHash 일치 시 PlayMCP 호출 회피. 불일치 시 fetcher
호출 → validator 통과 → UPSERT. validator 실패 시 throw 하여 오염된
payload 의 DB 영구화 차단. compatibility 는 profile1<profile2 invariant 강제.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3: tiger-profile-manage feature (CRUD)

### Task 3.1: profile-manage _schema + create

**Files:**
- Create: `apps/dashboard/src/features/tiger-profile-manage/api/_schema.ts`
- Create: `apps/dashboard/src/features/tiger-profile-manage/api/createTigerProfile.ts`
- Create: `apps/dashboard/src/features/tiger-profile-manage/api/updateTigerProfile.ts`
- Create: `apps/dashboard/src/features/tiger-profile-manage/api/deleteTigerProfile.ts`
- Create: `apps/dashboard/src/features/tiger-profile-manage/index.ts`

이 Task 는 CRUD 4 파일을 같이 만든다 — barrel 깨짐 없이 한 번에 커밋.

- [ ] **Step 1: _schema.ts 작성**

`apps/dashboard/src/features/tiger-profile-manage/api/_schema.ts`:

```ts
import "server-only";
import { z } from "zod";
import { RELATION_VALUES } from "@/entities/tiger-reading";

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : null))
    .nullable();

export const TigerProfileInput = z.object({
  nickname: z.string().min(1, "닉네임 필수").max(30),
  relation: z.enum(RELATION_VALUES),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 형식"),
  calendar: z.enum(["solar", "lunar"]),
  gender: z.enum(["male", "female"]),
  birthTime: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : null))
    .pipe(z.union([z.literal(null), z.string().regex(/^\d{2}:\d{2}$/, "HH:MM")]))
    .nullable(),
  birthCity: optionalText(50),
});

export type TigerProfileInputT = z.infer<typeof TigerProfileInput>;

export type TigerProfileActionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      code: "UNAUTHORIZED" | "INVALID_INPUT" | "NOT_FOUND" | "DB_ERROR";
      message?: string;
    };
```

- [ ] **Step 2: createTigerProfile.ts**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { playmcpProfiles } from "@/shared/lib/db/schema";
import { computeProfileInputHash } from "@/features/tiger-consult/lib/hash";
import { TigerProfileInput, type TigerProfileActionResult } from "./_schema";

export async function createTigerProfile(formData: FormData): Promise<TigerProfileActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = TigerProfileInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: parsed.error.issues.map((i) => i.message).join(", "),
    };
  }
  const inputHash = computeProfileInputHash(parsed.data);
  try {
    const [row] = await db
      .insert(playmcpProfiles)
      .values({ userId: session.user.id, ...parsed.data, inputHash })
      .returning({ id: playmcpProfiles.id });
    revalidatePath("/tiger");
    revalidatePath("/tiger/manage");
    return { ok: true, id: row.id };
  } catch (err) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: err instanceof Error ? err.message : "DB insert failed",
    };
  }
}
```

- [ ] **Step 3: updateTigerProfile.ts**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { playmcpProfiles } from "@/shared/lib/db/schema";
import { computeProfileInputHash } from "@/features/tiger-consult/lib/hash";
import { TigerProfileInput, type TigerProfileActionResult } from "./_schema";

export async function updateTigerProfile(
  profileId: string,
  formData: FormData,
): Promise<TigerProfileActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };

  const parsed = TigerProfileInput.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: parsed.error.issues.map((i) => i.message).join(", "),
    };
  }
  const inputHash = computeProfileInputHash(parsed.data);
  try {
    const result = await db
      .update(playmcpProfiles)
      .set({ ...parsed.data, inputHash, updatedAt: new Date() })
      .where(and(eq(playmcpProfiles.id, profileId), eq(playmcpProfiles.userId, session.user.id)))
      .returning({ id: playmcpProfiles.id });
    if (!result[0]) return { ok: false, code: "NOT_FOUND" };
    revalidatePath("/tiger");
    revalidatePath(`/tiger/${profileId}`);
    revalidatePath("/tiger/manage");
    return { ok: true, id: result[0].id };
  } catch (err) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: err instanceof Error ? err.message : "DB update failed",
    };
  }
}
```

- [ ] **Step 4: deleteTigerProfile.ts**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { playmcpProfiles } from "@/shared/lib/db/schema";
import type { TigerProfileActionResult } from "./_schema";

export async function deleteTigerProfile(profileId: string): Promise<TigerProfileActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  try {
    const result = await db
      .delete(playmcpProfiles)
      .where(and(eq(playmcpProfiles.id, profileId), eq(playmcpProfiles.userId, session.user.id)))
      .returning({ id: playmcpProfiles.id });
    if (!result[0]) return { ok: false, code: "NOT_FOUND" };
    revalidatePath("/tiger");
    revalidatePath("/tiger/manage");
    return { ok: true, id: result[0].id };
  } catch (err) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: err instanceof Error ? err.message : "DB delete failed",
    };
  }
}
```

- [ ] **Step 5: barrel index.ts**

```ts
export { createTigerProfile } from "./api/createTigerProfile";
export { updateTigerProfile } from "./api/updateTigerProfile";
export { deleteTigerProfile } from "./api/deleteTigerProfile";
export type { TigerProfileActionResult, TigerProfileInputT } from "./api/_schema";
```

- [ ] **Step 6: 전체 typecheck + lint 통과**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/features/tiger-profile-manage/
git commit -m "feat(tiger): tiger-profile-manage CRUD — create/update/delete server actions

userId 검증으로 다른 사용자 row 수정 차단. delete 는 CASCADE 로
analysis/yearly/daily/compat 캐시 자동 정리. inputHash 자동 계산.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4: tiger-consult API 4개

### Task 4.1: KST 헬퍼 + analyzeProfile

**Files:**
- Create: `apps/dashboard/src/features/tiger-consult/lib/kst.ts`
- Create: `apps/dashboard/src/features/tiger-consult/lib/kst.test.ts`
- Create: `apps/dashboard/src/features/tiger-consult/api/analyzeProfile.ts`

- [ ] **Step 1: kst.test.ts**

```ts
import { describe, expect, it, vi, afterEach } from "vitest";
import { computeKstDate, computeKstYear } from "./kst";

afterEach(() => vi.useRealTimers());

describe("computeKstDate", () => {
  it("UTC 23:00 → KST 다음날", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T23:00:00Z"));
    expect(computeKstDate()).toBe("2026-05-16");
  });

  it("UTC 14:00 → KST 같은 날 23:00", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T14:00:00Z"));
    expect(computeKstDate()).toBe("2026-05-15");
  });
});

describe("computeKstYear", () => {
  it("UTC 2025-12-31 16:00 → KST 2026", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-12-31T16:00:00Z"));
    expect(computeKstYear()).toBe(2026);
  });
});
```

- [ ] **Step 2: kst.ts**

```ts
/**
 * KST(Asia/Seoul) 기준 'YYYY-MM-DD' 반환.
 * 'en-CA' locale 은 ISO 8601 형식을 보장. timezone 옵션으로 KST 변환.
 *
 * 클라이언트·서버 일관성: 서버 Node 의 ICU 가 ko-KR 없는 환경이라도 en-CA 는
 * minimal ICU 에 포함됨. Gotcha #3 회피.
 */
export function computeKstDate(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

export function computeKstYear(now: Date = new Date()): number {
  const dateStr = computeKstDate(now);
  return Number.parseInt(dateStr.slice(0, 4), 10);
}
```

- [ ] **Step 3: 테스트 통과**

Run: `pnpm test -- src/features/tiger-consult/lib/kst.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 4: analyzeProfile.ts**

```ts
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { playmcpProfiles } from "@/shared/lib/db/schema";
import type { PlaymcpProfileRow, PlayMCPAnalysisResult } from "@/entities/tiger-reading";
import { callTool } from "../lib/playmcp-client";
import { validateAnalysisResponse } from "../lib/validate";
import { getOrFetchAnalysis } from "../lib/cache";

export interface AnalyzeResult {
  profile: PlaymcpProfileRow;
  payload: PlayMCPAnalysisResult;
  fromCache: boolean;
}

export async function analyzeProfile(profileId: string): Promise<AnalyzeResult> {
  const rows = await db.select().from(playmcpProfiles).where(eq(playmcpProfiles.id, profileId)).limit(1);
  if (!rows[0]) {
    throw new Error(`playmcp_profile not found: ${profileId}`);
  }
  const profile = rows[0];
  const { payload, fromCache } = await getOrFetchAnalysis<PlayMCPAnalysisResult>({
    profileId: profile.id,
    inputHash: profile.inputHash,
    tool: "1fate-analyze_saju",
    fetcher: () =>
      callTool("1fate-analyze_saju", {
        birth_date: profile.birthDate,
        gender: profile.gender,
        birth_time: profile.birthTime,
        birth_city: profile.birthCity,
        calendar: profile.calendar,
      }),
    validator: (p) =>
      validateAnalysisResponse(p, {
        id: profile.id,
        nickname: profile.nickname,
        birthDate: profile.birthDate,
        gender: profile.gender as "male" | "female",
      }),
  });
  return { profile, payload, fromCache };
}
```

- [ ] **Step 5: typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/features/tiger-consult/lib/kst.ts apps/dashboard/src/features/tiger-consult/lib/kst.test.ts apps/dashboard/src/features/tiger-consult/api/analyzeProfile.ts
git commit -m "feat(tiger): KST 헬퍼 + analyzeProfile API — getOrFetch 진입점

en-CA locale 로 'YYYY-MM-DD' 정규화 (Gotcha #3 회피).
analyzeProfile 은 캐시 hit/miss 무관 일관된 인터페이스."
```

---

### Task 4.2: yearlyInsight + dailyFortune + compatibility + barrel

**Files:**
- Create: `apps/dashboard/src/features/tiger-consult/api/yearlyInsight.ts`
- Create: `apps/dashboard/src/features/tiger-consult/api/dailyFortune.ts`
- Create: `apps/dashboard/src/features/tiger-consult/api/compatibility.ts`
- Create: `apps/dashboard/src/features/tiger-consult/index.ts`

- [ ] **Step 1: yearlyInsight.ts**

```ts
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { playmcpProfiles } from "@/shared/lib/db/schema";
import type { PlaymcpProfileRow, PlayMCPYearlyResult } from "@/entities/tiger-reading";
import { callTool } from "../lib/playmcp-client";
import { validateYearlyResponse } from "../lib/validate";
import { getOrFetchYearly } from "../lib/cache";
import { computeKstYear } from "../lib/kst";

export interface YearlyResult {
  profile: PlaymcpProfileRow;
  payload: PlayMCPYearlyResult;
  year: number;
  fromCache: boolean;
}

export async function getYearlyInsight(profileId: string, targetYear?: number): Promise<YearlyResult> {
  const rows = await db.select().from(playmcpProfiles).where(eq(playmcpProfiles.id, profileId)).limit(1);
  if (!rows[0]) {
    throw new Error(`playmcp_profile not found: ${profileId}`);
  }
  const profile = rows[0];
  const year = targetYear ?? computeKstYear();
  const { payload, fromCache } = await getOrFetchYearly<PlayMCPYearlyResult>({
    profileId: profile.id,
    inputHash: profile.inputHash,
    year,
    tool: "1fate-get_year_fortune",
    fetcher: () =>
      callTool("1fate-get_year_fortune", {
        birth_date: profile.birthDate,
        gender: profile.gender,
        birth_time: profile.birthTime,
        birth_city: profile.birthCity,
        calendar: profile.calendar,
        target_year: year,
      }),
    validator: (p) =>
      validateYearlyResponse(p, {
        id: profile.id,
        nickname: profile.nickname,
        birthDate: profile.birthDate,
        gender: profile.gender as "male" | "female",
      }),
  });
  return { profile, payload, year, fromCache };
}
```

- [ ] **Step 2: dailyFortune.ts**

```ts
import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { playmcpProfiles } from "@/shared/lib/db/schema";
import type { PlaymcpProfileRow, PlayMCPDailyResult } from "@/entities/tiger-reading";
import { callTool } from "../lib/playmcp-client";
import { validateDailyResponse } from "../lib/validate";
import { getOrFetchDaily } from "../lib/cache";
import { computeKstDate } from "../lib/kst";

export interface DailyResult {
  profile: PlaymcpProfileRow;
  payload: PlayMCPDailyResult;
  forDateKst: string;
  fromCache: boolean;
}

export async function getDailyFortune(profileId: string): Promise<DailyResult> {
  const rows = await db.select().from(playmcpProfiles).where(eq(playmcpProfiles.id, profileId)).limit(1);
  if (!rows[0]) {
    throw new Error(`playmcp_profile not found: ${profileId}`);
  }
  const profile = rows[0];
  const forDateKst = computeKstDate();
  const { payload, fromCache } = await getOrFetchDaily<PlayMCPDailyResult>({
    profileId: profile.id,
    inputHash: profile.inputHash,
    forDateKst,
    tool: "1fate-get_daily_fortune",
    fetcher: () =>
      callTool("1fate-get_daily_fortune", {
        birth_date: profile.birthDate,
        gender: profile.gender,
        birth_time: profile.birthTime,
        birth_city: profile.birthCity,
        calendar: profile.calendar,
      }),
    validator: (p) =>
      validateDailyResponse(p, {
        id: profile.id,
        nickname: profile.nickname,
        birthDate: profile.birthDate,
        gender: profile.gender as "male" | "female",
      }),
  });
  return { profile, payload, forDateKst, fromCache };
}
```

- [ ] **Step 3: compatibility.ts**

```ts
import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { playmcpProfiles } from "@/shared/lib/db/schema";
import type { PlaymcpProfileRow, PlayMCPCompatibilityResult } from "@/entities/tiger-reading";
import { callTool } from "../lib/playmcp-client";
import { validateCompatibilityResponse } from "../lib/validate";
import { getOrFetchCompatibility } from "../lib/cache";
import { computePairInputHash } from "../lib/hash";

export interface CompatResult {
  profile1: PlaymcpProfileRow;
  profile2: PlaymcpProfileRow;
  payload: PlayMCPCompatibilityResult;
  fromCache: boolean;
}

export async function getCompatibility(aId: string, bId: string): Promise<CompatResult> {
  if (aId === bId) {
    throw new Error("getCompatibility: 같은 profileId 로 호출 불가");
  }
  const rows = await db.select().from(playmcpProfiles).where(inArray(playmcpProfiles.id, [aId, bId]));
  if (rows.length !== 2) {
    throw new Error(`compatibility profile 부분 누락: requested=[${aId},${bId}] found=${rows.length}`);
  }
  const sorted = [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
  const [p1, p2] = sorted;
  const pairHash = computePairInputHash(p1.inputHash, p2.inputHash);

  const { payload, fromCache } = await getOrFetchCompatibility<PlayMCPCompatibilityResult>({
    profile1Id: p1.id,
    profile2Id: p2.id,
    inputHash1: p1.inputHash,
    inputHash2: p2.inputHash,
    pairHash,
    tool: "1fate-check_compatibility",
    fetcher: () =>
      callTool("1fate-check_compatibility", {
        person1_birth_date: p1.birthDate,
        person1_gender: p1.gender,
        person1_birth_time: p1.birthTime,
        person1_calendar: p1.calendar,
        person2_birth_date: p2.birthDate,
        person2_gender: p2.gender,
        person2_birth_time: p2.birthTime,
        person2_calendar: p2.calendar,
      }),
    validator: (resp) =>
      validateCompatibilityResponse(
        resp,
        { id: p1.id, nickname: p1.nickname, birthDate: p1.birthDate, gender: p1.gender as "male" | "female" },
        { id: p2.id, nickname: p2.nickname, birthDate: p2.birthDate, gender: p2.gender as "male" | "female" },
      ),
  });
  return { profile1: p1, profile2: p2, payload, fromCache };
}
```

- [ ] **Step 4: barrel index.ts**

```ts
export { analyzeProfile } from "./api/analyzeProfile";
export { getYearlyInsight } from "./api/yearlyInsight";
export { getDailyFortune } from "./api/dailyFortune";
export { getCompatibility } from "./api/compatibility";
export { computeKstDate, computeKstYear } from "./lib/kst";
export type { AnalyzeResult } from "./api/analyzeProfile";
export type { YearlyResult } from "./api/yearlyInsight";
export type { DailyResult } from "./api/dailyFortune";
export type { CompatResult } from "./api/compatibility";
```

- [ ] **Step 5: 전체 typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/features/tiger-consult/api/ apps/dashboard/src/features/tiger-consult/index.ts
git commit -m "feat(tiger): yearly/daily/compatibility API + tiger-consult barrel

UUID 사전 정렬로 (a,b)/(b,a) 동일 캐시 row 보장. yearly 기본값 현재 KST 연도,
daily 는 오늘 KST 날짜. compatibility 는 profile 2개 inArray 한 번 조회.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5: UI — entities ui + widgets + 라우트

### Task 5.1: TigerNarrative + TigerErrorPanel dumb component

**Files:**
- Create: `apps/dashboard/src/entities/tiger-reading/ui/TigerNarrative.tsx`
- Create: `apps/dashboard/src/entities/tiger-reading/ui/TigerErrorPanel.tsx`

- [ ] **Step 1: TigerNarrative.tsx**

```tsx
// 깊은 경로 import 강제: barrel 에 넣지 말 것 (Gotcha #1).
//
// Pure presentational. PlayMCP suggested_narrative_ko 를 받아 6/5/4 문단으로
// split 후 첫 줄([프로필] 메타) 제거 + 단락별 <p> 렌더.

interface TigerNarrativeProps {
  narrative: string;
  emphasizeFirstParagraph?: boolean;
}

export function TigerNarrative({ narrative, emphasizeFirstParagraph }: TigerNarrativeProps) {
  const paragraphs = narrative
    .split("\n\n")
    .filter((p) => p.trim() !== "" && !p.startsWith("[프로필]"));
  return (
    <div className="space-y-3 text-gray-800">
      {paragraphs.map((p, idx) => (
        <p key={idx} className={emphasizeFirstParagraph && idx === 0 ? "font-medium text-gray-900" : ""}>
          {p}
        </p>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: TigerErrorPanel.tsx**

```tsx
"use client";

interface TigerErrorPanelProps {
  title?: string;
  body: string;
  showRetry?: boolean;
  onRetry?: () => void;
}

export function TigerErrorPanel({
  title = "호(虎)가 잠시 답을 못 드리고 있어요",
  body,
  showRetry = false,
  onRetry,
}: TigerErrorPanelProps) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <p className="font-medium text-amber-900">🐯 {title}</p>
      <p className="mt-2 text-sm text-amber-800">{body}</p>
      {showRetry && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded bg-amber-600 px-3 py-1.5 text-sm text-white hover:bg-amber-700"
        >
          다시 시도
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/entities/tiger-reading/ui/
git commit -m "feat(tiger): TigerNarrative + TigerErrorPanel dumb components"
```

---

### Task 5.2: widgets/tiger-cards 4 카드 + barrel

**Files:**
- Create: `apps/dashboard/src/widgets/tiger-cards/ui/TigerAnalysisCard.tsx`
- Create: `apps/dashboard/src/widgets/tiger-cards/ui/TigerYearlyCard.tsx`
- Create: `apps/dashboard/src/widgets/tiger-cards/ui/TigerDailyCard.tsx`
- Create: `apps/dashboard/src/widgets/tiger-cards/ui/TigerCompatibilityCard.tsx`
- Create: `apps/dashboard/src/widgets/tiger-cards/index.ts`

- [ ] **Step 1: TigerAnalysisCard.tsx**

```tsx
import { TigerNarrative } from "@/entities/tiger-reading/ui/TigerNarrative";
import type { PlayMCPAnalysisResult } from "@/entities/tiger-reading";

interface Props { payload: PlayMCPAnalysisResult; }

export function TigerAnalysisCard({ payload }: Props) {
  const r = payload.result;
  return (
    <article className="rounded-xl border bg-white p-6 shadow-sm">
      <header className="mb-4 flex items-center gap-3">
        <span className="text-2xl">🐯</span>
        <div>
          <h2 className="text-lg font-semibold">사주 분석</h2>
          <p className="text-sm text-gray-600">{r.profile.nickname_short}</p>
        </div>
      </header>
      <section className="mb-4 flex flex-wrap gap-2">
        <span className="rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-900">
          {r.type_summary_ko.split(" - ")[0]}
        </span>
        <span className="rounded-full bg-amber-50 px-3 py-1 text-sm text-amber-900">
          {r.element_tendency_ko}
        </span>
      </section>
      <TigerNarrative narrative={r.suggested_narrative_ko} emphasizeFirstParagraph />
      <section className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <LifeHintCell label="직업" value={r.life_hints.career_ko} />
        <LifeHintCell label="관계" value={r.life_hints.relationship_ko} />
        <LifeHintCell label="건강" value={r.life_hints.health_summary_ko} />
      </section>
    </article>
  );
}

function LifeHintCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border bg-gray-50 p-3">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-sm text-gray-800">{value}</p>
    </div>
  );
}
```

- [ ] **Step 2: TigerYearlyCard.tsx**

```tsx
"use client";

import { TigerNarrative } from "@/entities/tiger-reading/ui/TigerNarrative";
import type { PlayMCPYearlyResult } from "@/entities/tiger-reading";

interface Props {
  payload: PlayMCPYearlyResult;
  year: number;
  availableYears: number[];
  selectedYear: number;
  onYearChange: (year: number) => void;
}

export function TigerYearlyCard({
  payload, year, availableYears, selectedYear, onYearChange,
}: Props) {
  return (
    <article className="rounded-xl border bg-white p-6 shadow-sm">
      <header className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🐯</span>
          <div>
            <h2 className="text-lg font-semibold">신년 인사이트</h2>
            <p className="text-sm text-gray-600">{year}년 한 해의 흐름</p>
          </div>
        </div>
        <select
          value={selectedYear}
          onChange={(e) => onYearChange(Number(e.target.value))}
          className="rounded border px-2 py-1 text-sm"
          aria-label="연도 선택"
        >
          {availableYears.map((y) => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
      </header>
      <TigerNarrative narrative={payload.result.suggested_narrative_ko} />
    </article>
  );
}
```

- [ ] **Step 3: TigerDailyCard.tsx**

```tsx
import { TigerNarrative } from "@/entities/tiger-reading/ui/TigerNarrative";
import type { PlayMCPDailyResult } from "@/entities/tiger-reading";

interface Props { payload: PlayMCPDailyResult; forDateKst: string; }

export function TigerDailyCard({ payload, forDateKst }: Props) {
  return (
    <article className="rounded-xl border bg-white p-6 shadow-sm">
      <header className="mb-4 flex items-center gap-3">
        <span className="text-2xl">🐯</span>
        <div>
          <h2 className="text-lg font-semibold">오늘의 기운</h2>
          {/* locale-free 포맷 — Gotcha #3 회피 */}
          <p className="text-sm text-gray-600">{forDateKst}</p>
        </div>
      </header>
      <TigerNarrative narrative={payload.result.suggested_narrative_ko} />
    </article>
  );
}
```

- [ ] **Step 4: TigerCompatibilityCard.tsx**

```tsx
import { TigerNarrative } from "@/entities/tiger-reading/ui/TigerNarrative";
import type { PlayMCPCompatibilityResult } from "@/entities/tiger-reading";

interface Props {
  payload: PlayMCPCompatibilityResult;
  nickname1: string;
  nickname2: string;
}

export function TigerCompatibilityCard({ payload, nickname1, nickname2 }: Props) {
  return (
    <article className="rounded-xl border bg-white p-6 shadow-sm">
      <header className="mb-4 flex items-center gap-3">
        <span className="text-2xl">🐯</span>
        <div>
          <h2 className="text-lg font-semibold">인연 궁합</h2>
          <p className="text-sm text-gray-600">{nickname1} × {nickname2}</p>
        </div>
      </header>
      <TigerNarrative narrative={payload.result.suggested_narrative_ko} />
    </article>
  );
}
```

- [ ] **Step 5: barrel**

```ts
export { TigerAnalysisCard } from "./ui/TigerAnalysisCard";
export { TigerYearlyCard } from "./ui/TigerYearlyCard";
export { TigerDailyCard } from "./ui/TigerDailyCard";
export { TigerCompatibilityCard } from "./ui/TigerCompatibilityCard";
```

- [ ] **Step 6: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/widgets/tiger-cards/
git commit -m "feat(tiger): 4 widget cards — analysis/yearly/daily/compatibility

페르소나 헤더(🐯), amber 컬러로 기존 /fortune (blue)과 시각 구분.
locale-free YYYY-MM-DD (Gotcha #3 회피)."
```

---

### Task 5.3: /tiger 진입 + /tiger/manage CRUD UI

**Files:**
- Create: `apps/dashboard/src/app/tiger/page.tsx`
- Create: `apps/dashboard/src/app/tiger/manage/page.tsx`
- Create: `apps/dashboard/src/app/tiger/manage/TigerProfileForm.tsx`

- [ ] **Step 1: /tiger/page.tsx**

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { playmcpProfiles } from "@/shared/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function TigerHomePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin");
  const profiles = await db
    .select()
    .from(playmcpProfiles)
    .where(eq(playmcpProfiles.userId, session.user.id))
    .orderBy(playmcpProfiles.createdAt);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">🐯 호(虎) 상담</h1>
        <p className="mt-1 text-sm text-gray-600">
          1FATE 호작엔진이 분석하고, 호(虎)가 풀어드리는 사주 상담입니다.
        </p>
      </header>

      {profiles.length === 0 ? (
        <section className="rounded-xl border bg-white p-8 text-center">
          <p className="text-gray-700">아직 등록된 프로필이 없습니다.</p>
          <Link
            href="/tiger/manage"
            className="mt-4 inline-block rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
          >
            프로필 등록하기
          </Link>
        </section>
      ) : (
        <ul className="space-y-3">
          {profiles.map((p) => (
            <li key={p.id}>
              <Link
                href={`/tiger/${p.id}`}
                className="block rounded-lg border bg-white p-4 transition hover:border-amber-300 hover:bg-amber-50"
              >
                <p className="font-medium">{p.nickname}</p>
                <p className="text-sm text-gray-600">
                  {p.relation} · {p.birthDate} · {p.gender === "male" ? "남자" : "여자"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <nav className="mt-6 flex gap-3 text-sm">
        <Link href="/tiger/manage" className="text-amber-700 underline">프로필 관리</Link>
        <Link href="/tiger/compatibility" className="text-amber-700 underline">인연 궁합</Link>
      </nav>
    </main>
  );
}
```

- [ ] **Step 2: TigerProfileForm.tsx (client)**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createTigerProfile, updateTigerProfile, deleteTigerProfile } from "@/features/tiger-profile-manage";
import { RELATION_VALUES } from "@/entities/tiger-reading";
import type { PlaymcpProfileRow } from "@/entities/tiger-reading";

interface Props {
  mode: "create" | "edit";
  profile?: PlaymcpProfileRow;
}

export function TigerProfileForm({ mode, profile }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    setPending(true); setError(null);
    const result = mode === "create"
      ? await createTigerProfile(formData)
      : await updateTigerProfile(profile!.id, formData);
    setPending(false);
    if (!result.ok) {
      setError(result.message ?? result.code);
      return;
    }
    router.refresh();
  }

  async function onDelete() {
    if (!profile) return;
    if (!confirm(`'${profile.nickname}' 프로필을 삭제할까요? 캐시된 모든 분석이 함께 삭제됩니다.`)) return;
    setPending(true);
    const result = await deleteTigerProfile(profile.id);
    setPending(false);
    if (!result.ok) {
      setError(result.message ?? result.code);
      return;
    }
    router.refresh();
  }

  return (
    <form action={onSubmit} className="space-y-3">
      <Field label="닉네임" name="nickname" defaultValue={profile?.nickname} required />
      <SelectField label="관계" name="relation" defaultValue={profile?.relation ?? "self"} options={[...RELATION_VALUES]} />
      <Field label="생년월일 (YYYY-MM-DD)" name="birthDate" defaultValue={profile?.birthDate} required />
      <SelectField label="달력" name="calendar" defaultValue={profile?.calendar ?? "solar"} options={["solar", "lunar"]} />
      <SelectField label="성별" name="gender" defaultValue={profile?.gender ?? "male"} options={["male", "female"]} />
      <Field label="생시 (HH:MM, 선택)" name="birthTime" defaultValue={profile?.birthTime ?? ""} />
      <Field label="출생 도시 (선택)" name="birthCity" defaultValue={profile?.birthCity ?? ""} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="rounded bg-amber-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">
          {pending ? "처리 중..." : mode === "create" ? "등록" : "수정"}
        </button>
        {mode === "edit" && (
          <button type="button" onClick={onDelete} disabled={pending} className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700">
            삭제
          </button>
        )}
      </div>
    </form>
  );
}

function Field({ label, name, defaultValue, required }: { label: string; name: string; defaultValue?: string | null; required?: boolean }) {
  return (
    <label className="block text-sm">
      <span className="text-gray-700">{label}</span>
      <input name={name} defaultValue={defaultValue ?? ""} required={required} className="mt-1 w-full rounded border px-2 py-1.5" />
    </label>
  );
}

function SelectField({ label, name, defaultValue, options }: { label: string; name: string; defaultValue: string; options: string[] }) {
  return (
    <label className="block text-sm">
      <span className="text-gray-700">{label}</span>
      <select name={name} defaultValue={defaultValue} className="mt-1 w-full rounded border px-2 py-1.5">
        {options.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    </label>
  );
}
```

- [ ] **Step 3: /tiger/manage/page.tsx**

```tsx
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { playmcpProfiles } from "@/shared/lib/db/schema";
import { TigerProfileForm } from "./TigerProfileForm";

export const dynamic = "force-dynamic";

export default async function TigerManagePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin");
  const profiles = await db
    .select()
    .from(playmcpProfiles)
    .where(eq(playmcpProfiles.userId, session.user.id))
    .orderBy(playmcpProfiles.createdAt);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">🐯 프로필 관리</h1>
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">새 프로필 등록</h2>
        <TigerProfileForm mode="create" />
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold">등록된 프로필</h2>
        {profiles.length === 0 ? (
          <p className="text-sm text-gray-600">등록된 프로필이 없습니다.</p>
        ) : (
          <ul className="space-y-3">
            {profiles.map((p) => (
              <li key={p.id} className="rounded border bg-white p-4">
                <details>
                  <summary className="cursor-pointer">
                    <span className="font-medium">{p.nickname}</span>{" "}
                    <span className="text-sm text-gray-600">({p.relation} · {p.birthDate})</span>
                  </summary>
                  <div className="mt-3">
                    <TigerProfileForm mode="edit" profile={p} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 4: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 5: dev 서버 smoke**

Run: `pnpm dev` (별도 터미널)
방문: `http://localhost:3020/tiger`, `http://localhost:3020/tiger/manage`
Expected: 로그인 후 빈 프로필 페이지 + 등록 폼 정상 렌더. PlayMCP 호출 아직 없음.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/app/tiger/page.tsx apps/dashboard/src/app/tiger/manage/
git commit -m "feat(tiger): /tiger 진입 + /tiger/manage CRUD UI

amber 컬러 / 페르소나 헤더로 기존 /fortune(blue)과 시각 구분.
프로필 목록·등록·수정·삭제."
```

---

### Task 5.4: /tiger/[profileId] — analysis 즉시 + lazy 카드

**Files:**
- Create: `apps/dashboard/src/app/tiger/[profileId]/page.tsx`
- Create: `apps/dashboard/src/app/tiger/[profileId]/actions.ts`
- Create: `apps/dashboard/src/app/tiger/[profileId]/LazyCards.tsx`

- [ ] **Step 1: actions.ts**

```ts
"use server";

import { isPlayMCPError } from "@/features/tiger-consult/lib/errors";
import { getYearlyInsight, getDailyFortune } from "@/features/tiger-consult";
import type { PlayMCPYearlyResult, PlayMCPDailyResult } from "@/entities/tiger-reading";

export interface LazyResult<T> {
  ok: boolean;
  payload?: T;
  error?: string;
  extra?: Record<string, unknown>;
}

export async function fetchYearlyAction(profileId: string, year: number): Promise<LazyResult<PlayMCPYearlyResult>> {
  try {
    const r = await getYearlyInsight(profileId, year);
    return { ok: true, payload: r.payload, extra: { year: r.year } };
  } catch (err) {
    return { ok: false, error: isPlayMCPError(err) ? err.message : "yearly fetch failed" };
  }
}

export async function fetchDailyAction(profileId: string): Promise<LazyResult<PlayMCPDailyResult>> {
  try {
    const r = await getDailyFortune(profileId);
    return { ok: true, payload: r.payload, extra: { forDateKst: r.forDateKst } };
  } catch (err) {
    return { ok: false, error: isPlayMCPError(err) ? err.message : "daily fetch failed" };
  }
}
```

- [ ] **Step 2: LazyCards.tsx (client)**

```tsx
"use client";

import { useState, useTransition } from "react";
import { TigerYearlyCard, TigerDailyCard } from "@/widgets/tiger-cards";
import { TigerErrorPanel } from "@/entities/tiger-reading/ui/TigerErrorPanel";
import type { PlayMCPYearlyResult, PlayMCPDailyResult } from "@/entities/tiger-reading";
import { fetchYearlyAction, fetchDailyAction } from "./actions";

interface Props { profileId: string; nickname: string; }

export function LazyCards({ profileId }: Props) {
  return (
    <>
      <YearlySection profileId={profileId} />
      <DailySection profileId={profileId} />
    </>
  );
}

function YearlySection({ profileId }: { profileId: string }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [payload, setPayload] = useState<PlayMCPYearlyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const availableYears = [currentYear, currentYear + 1];

  function trigger(newYear: number) {
    setYear(newYear); setError(null);
    startTransition(async () => {
      const result = await fetchYearlyAction(profileId, newYear);
      if (result.ok && result.payload) setPayload(result.payload);
      else setError(result.error ?? "unknown error");
    });
  }

  if (!payload && !pending && !error) {
    return (
      <section className="rounded-xl border bg-white p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">🐯 신년 인사이트</h3>
          <button
            type="button"
            onClick={() => trigger(year)}
            className="rounded bg-amber-600 px-3 py-1.5 text-sm text-white hover:bg-amber-700"
          >
            보기
          </button>
        </div>
      </section>
    );
  }
  if (pending) return <PendingCard label="호(虎)가 신년 흐름을 살펴보고 있습니다..." />;
  if (error) return <TigerErrorPanel body={error} showRetry onRetry={() => trigger(year)} />;
  if (payload) return (
    <TigerYearlyCard
      payload={payload} year={year} selectedYear={year}
      availableYears={availableYears} onYearChange={trigger}
    />
  );
  return null;
}

function DailySection({ profileId }: { profileId: string }) {
  const [payload, setPayload] = useState<PlayMCPDailyResult | null>(null);
  const [forDateKst, setForDateKst] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function trigger() {
    setError(null);
    startTransition(async () => {
      const result = await fetchDailyAction(profileId);
      if (result.ok && result.payload) {
        setPayload(result.payload);
        setForDateKst((result.extra?.forDateKst as string) ?? "");
      } else {
        setError(result.error ?? "unknown error");
      }
    });
  }

  if (!payload && !pending && !error) {
    return (
      <section className="rounded-xl border bg-white p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">🐯 오늘의 기운</h3>
          <button
            type="button"
            onClick={trigger}
            className="rounded bg-amber-600 px-3 py-1.5 text-sm text-white hover:bg-amber-700"
          >
            보기
          </button>
        </div>
      </section>
    );
  }
  if (pending) return <PendingCard label="호(虎)가 오늘 기운을 살펴보고 있습니다..." />;
  if (error) return <TigerErrorPanel body={error} showRetry onRetry={trigger} />;
  if (payload) return <TigerDailyCard payload={payload} forDateKst={forDateKst} />;
  return null;
}

function PendingCard({ label }: { label: string }) {
  return (
    <section className="rounded-xl border bg-white p-6">
      <p className="text-sm text-gray-700">{label}</p>
    </section>
  );
}
```

- [ ] **Step 3: page.tsx (RSC — analysis 즉시 호출)**

```tsx
import { redirect, notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { playmcpProfiles } from "@/shared/lib/db/schema";
import { analyzeProfile } from "@/features/tiger-consult";
import { TigerAnalysisCard } from "@/widgets/tiger-cards";
import { TigerErrorPanel } from "@/entities/tiger-reading/ui/TigerErrorPanel";
import { isPlayMCPError } from "@/features/tiger-consult/lib/errors";
import { LazyCards } from "./LazyCards";

export const dynamic = "force-dynamic";

export default async function TigerProfilePage({ params }: { params: Promise<{ profileId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin");
  const { profileId } = await params;
  const rows = await db
    .select()
    .from(playmcpProfiles)
    .where(and(eq(playmcpProfiles.id, profileId), eq(playmcpProfiles.userId, session.user.id)))
    .limit(1);
  if (!rows[0]) notFound();
  const profile = rows[0];

  let analysisNode: React.ReactNode;
  try {
    const { payload } = await analyzeProfile(profileId);
    analysisNode = <TigerAnalysisCard payload={payload} />;
  } catch (err) {
    const message = isPlayMCPError(err) ? err.message : "분석 호출 실패";
    analysisNode = <TigerErrorPanel body={message} />;
  }

  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <header>
        <h1 className="text-2xl font-bold">🐯 {profile.nickname}</h1>
        <p className="text-sm text-gray-600">
          {profile.relation} · {profile.birthDate} · {profile.gender === "male" ? "남자" : "여자"}
        </p>
      </header>
      {analysisNode}
      <LazyCards profileId={profileId} nickname={profile.nickname} />
    </main>
  );
}
```

- [ ] **Step 4: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/tiger/[profileId]/
git commit -m "feat(tiger): /tiger/[profileId] — analysis 즉시 + yearly/daily lazy

페이지 진입 시 analyze 1개만 호출, yearly/daily 는 사용자 클릭 시
호출 (동시 PlayMCP 호출 회피 → cross-talk 위험 최소). useTransition
으로 pending UI."
```

---

### Task 5.5: /tiger/compatibility 페이지

**Files:**
- Create: `apps/dashboard/src/app/tiger/compatibility/actions.ts`
- Create: `apps/dashboard/src/app/tiger/compatibility/CompatibilityPicker.tsx`
- Create: `apps/dashboard/src/app/tiger/compatibility/page.tsx`

- [ ] **Step 1: actions.ts**

```ts
"use server";

import { getCompatibility } from "@/features/tiger-consult";
import { isPlayMCPError } from "@/features/tiger-consult/lib/errors";
import type { PlayMCPCompatibilityResult } from "@/entities/tiger-reading";

export interface CompatActionResult {
  ok: boolean;
  payload?: PlayMCPCompatibilityResult;
  nickname1?: string;
  nickname2?: string;
  error?: string;
}

export async function fetchCompatibilityAction(aId: string, bId: string): Promise<CompatActionResult> {
  if (aId === bId) return { ok: false, error: "같은 사람으로는 궁합 분석 불가" };
  try {
    const r = await getCompatibility(aId, bId);
    return { ok: true, payload: r.payload, nickname1: r.profile1.nickname, nickname2: r.profile2.nickname };
  } catch (err) {
    return { ok: false, error: isPlayMCPError(err) ? err.message : "compatibility fetch failed" };
  }
}
```

- [ ] **Step 2: CompatibilityPicker.tsx (client)**

```tsx
"use client";

import { useState, useTransition } from "react";
import { TigerCompatibilityCard } from "@/widgets/tiger-cards";
import { TigerErrorPanel } from "@/entities/tiger-reading/ui/TigerErrorPanel";
import type { PlayMCPCompatibilityResult } from "@/entities/tiger-reading";
import { fetchCompatibilityAction } from "./actions";

interface ProfileSlim { id: string; nickname: string; relation: string; }

export function CompatibilityPicker({ profiles }: { profiles: ProfileSlim[] }) {
  const [aId, setAId] = useState(profiles[0].id);
  const [bId, setBId] = useState(profiles[1].id);
  const [result, setResult] = useState<{
    payload: PlayMCPCompatibilityResult; nickname1: string; nickname2: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function trigger() {
    setError(null); setResult(null);
    startTransition(async () => {
      const r = await fetchCompatibilityAction(aId, bId);
      if (r.ok && r.payload && r.nickname1 && r.nickname2) {
        setResult({ payload: r.payload, nickname1: r.nickname1, nickname2: r.nickname2 });
      } else {
        setError(r.error ?? "unknown error");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4">
        <label className="block text-sm">
          <span className="text-gray-700">사람 1</span>
          <select value={aId} onChange={(e) => setAId(e.target.value)} className="mt-1 rounded border px-2 py-1.5">
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.nickname} ({p.relation})</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-gray-700">사람 2</span>
          <select value={bId} onChange={(e) => setBId(e.target.value)} className="mt-1 rounded border px-2 py-1.5">
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.nickname} ({p.relation})</option>)}
          </select>
        </label>
        <button
          type="button"
          onClick={trigger}
          disabled={pending}
          className="rounded bg-amber-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {pending ? "분석 중..." : "궁합 보기"}
        </button>
      </div>
      {error && <TigerErrorPanel body={error} showRetry onRetry={trigger} />}
      {result && (
        <TigerCompatibilityCard
          payload={result.payload}
          nickname1={result.nickname1}
          nickname2={result.nickname2}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: page.tsx**

```tsx
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { playmcpProfiles } from "@/shared/lib/db/schema";
import { CompatibilityPicker } from "./CompatibilityPicker";

export const dynamic = "force-dynamic";

export default async function CompatibilityPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin");
  const profiles = await db
    .select({ id: playmcpProfiles.id, nickname: playmcpProfiles.nickname, relation: playmcpProfiles.relation })
    .from(playmcpProfiles)
    .where(eq(playmcpProfiles.userId, session.user.id))
    .orderBy(playmcpProfiles.createdAt);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">🐯 인연 궁합</h1>
        <p className="mt-1 text-sm text-gray-600">두 분의 사주를 모두 살펴 호(虎)가 인연을 풀어드립니다.</p>
      </header>
      {profiles.length < 2 ? (
        <p className="rounded border bg-yellow-50 p-4 text-sm text-yellow-900">
          궁합 분석에는 최소 2개의 프로필이 필요합니다. <a className="underline" href="/tiger/manage">프로필 관리</a> 에서 추가해 주세요.
        </p>
      ) : (
        <CompatibilityPicker profiles={profiles} />
      )}
    </main>
  );
}
```

- [ ] **Step 4: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/app/tiger/compatibility/
git commit -m "feat(tiger): /tiger/compatibility — 두 프로필 선택 + 궁합 카드"
```

---

## Phase 6: bootstrap script + 운영자 진단 페이지

### Task 6.1: tiger:bootstrap CLI

**Files:**
- Create: `apps/dashboard/scripts/tiger-bootstrap.ts`
- Modify: `apps/dashboard/package.json`

- [ ] **Step 1: tiger-bootstrap.ts**

`apps/dashboard/scripts/tiger-bootstrap.ts`:

```ts
// 운영자 1회 setup: PlayMCP OTT → access/refresh 토큰 교환 → DB INSERT.
//
// 사용:
//   pnpm tiger:bootstrap --ott <OTT_VALUE> --i-know-this-is-prod
//   또는 .env 의 PLAYMCP_BOOTSTRAP_OTT 사용:
//   I_KNOW_THIS_IS_PROD=1 pnpm tiger:bootstrap

import "dotenv/config";
import { env } from "../src/shared/config/env";
import { saveCredentials } from "../src/features/tiger-consult/lib/playmcp-credentials";

function parseArgs(): { ott?: string; ack: boolean } {
  const args = process.argv.slice(2);
  const out: { ott?: string; ack: boolean } = { ack: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--ott" && args[i + 1]) {
      out.ott = args[++i];
    } else if (args[i] === "--i-know-this-is-prod") {
      out.ack = true;
    }
  }
  return out;
}

function assertProdAck(databaseUrl: string, ack: boolean): void {
  const isProd = /192\.168\.0\.5|gons\.krdn\.kr/.test(databaseUrl);
  if (!isProd) return;
  if (!ack && process.env.I_KNOW_THIS_IS_PROD !== "1") {
    console.error("[ERROR] 운영 DB 향 실행 — --i-know-this-is-prod 또는 I_KNOW_THIS_IS_PROD=1 필요");
    process.exit(1);
  }
}

async function exchangeOtt(ott: string): Promise<{
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}> {
  const url = new URL("/api/v1/auths/otts:exchange", env.PLAYMCP_GATEWAY_URL).toString();
  const response = await fetch(url, {
    method: "POST",
    headers: { accept: "*/*", "Content-Type": "application/json" },
    body: JSON.stringify({ tokenValue: ott }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OTT exchange 실패: ${response.status} ${response.statusText} — ${body}`);
  }
  const data = (await response.json()) as {
    accessToken: { tokenValue: string; expiresAt: string };
    refreshToken: { tokenValue: string; expiresAt: string };
  };
  return {
    accessToken: data.accessToken.tokenValue,
    refreshToken: data.refreshToken.tokenValue,
    accessExpiresAt: new Date(data.accessToken.expiresAt),
    refreshExpiresAt: new Date(data.refreshToken.expiresAt),
  };
}

async function main(): Promise<void> {
  const { ott: cliOtt, ack } = parseArgs();
  const ott = cliOtt ?? env.PLAYMCP_BOOTSTRAP_OTT;
  if (!ott) {
    console.error("[ERROR] OTT 미제공 — --ott <VALUE> 또는 .env PLAYMCP_BOOTSTRAP_OTT 설정");
    process.exit(1);
  }
  const dbUrl = process.env.DATABASE_URL ?? "";
  assertProdAck(dbUrl, ack);

  console.log("[1/3] PlayMCP OTT exchange...");
  const tokens = await exchangeOtt(ott);
  console.log(`  access_expires_at: ${tokens.accessExpiresAt.toISOString()}`);
  console.log(`  refresh_expires_at: ${tokens.refreshExpiresAt.toISOString()}`);

  console.log("[2/3] DB INSERT...");
  await saveCredentials(tokens);

  console.log("[3/3] 완료. /tiger/admin/diagnostics 에서 검증하세요.");
  console.log("");
  console.log("⚠️  .env 의 PLAYMCP_BOOTSTRAP_OTT 값을 즉시 제거하세요 (1회용).");
}

main().catch((err) => {
  console.error("[ERROR]", err);
  process.exit(1);
});
```

- [ ] **Step 2: package.json scripts 추가**

`apps/dashboard/package.json` 의 `"scripts"` 객체에 추가:

```json
"tiger:bootstrap": "tsx scripts/tiger-bootstrap.ts"
```

- [ ] **Step 3: typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/scripts/tiger-bootstrap.ts apps/dashboard/package.json
git commit -m "feat(tiger): tiger:bootstrap CLI — OTT 1회 교환 → credentials INSERT

운영 DB 가드 (--i-know-this-is-prod 또는 I_KNOW_THIS_IS_PROD=1).
exchange 후 .env 의 OTT 즉시 제거 안내."
```

---

### Task 6.2: /tiger/admin/diagnostics 운영자 진단 페이지

**Files:**
- Create: `apps/dashboard/src/app/tiger/admin/diagnostics/page.tsx`

- [ ] **Step 1: page.tsx**

```tsx
import { redirect } from "next/navigation";
import { count } from "drizzle-orm";
import { auth } from "@/shared/lib/auth";
import { db } from "@/shared/lib/db/client";
import { env } from "@/shared/config/env";
import {
  playmcpAnalysis, playmcpYearly, playmcpDaily, playmcpCompatibility,
} from "@/shared/lib/db/schema";
import { getCredentialsSummary } from "@/features/tiger-consult/lib/playmcp-credentials";

export const dynamic = "force-dynamic";

function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const admins = env.ADMIN_EMAILS?.split(",").map((s) => s.trim()) ?? [];
  return admins.includes(email);
}

export default async function TigerDiagnosticsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin");
  if (!isAdmin(session.user.email)) {
    return <main className="mx-auto max-w-3xl p-8"><p>관리자 권한 필요.</p></main>;
  }
  const cred = await getCredentialsSummary();
  const [{ n: nAnalysis }] = await db.select({ n: count() }).from(playmcpAnalysis);
  const [{ n: nYearly }] = await db.select({ n: count() }).from(playmcpYearly);
  const [{ n: nDaily }] = await db.select({ n: count() }).from(playmcpDaily);
  const [{ n: nCompat }] = await db.select({ n: count() }).from(playmcpCompatibility);

  const now = Date.now();
  const accessRemainMin = cred.accessExpiresAt
    ? Math.round((cred.accessExpiresAt.getTime() - now) / 60_000)
    : null;
  const refreshRemainDays = cred.refreshExpiresAt
    ? Math.round((cred.refreshExpiresAt.getTime() - now) / 86400_000)
    : null;

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-bold">🐯 호(虎) 진단</h1>

      <section className="rounded-xl border bg-white p-4">
        <h2 className="mb-3 font-semibold">PlayMCP 자격증명</h2>
        {cred.configured ? (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-gray-600">access_token 남은 시간</dt>
            <dd className={accessRemainMin !== null && accessRemainMin < 30 ? "font-bold text-red-600" : ""}>
              {accessRemainMin} 분
            </dd>
            <dt className="text-gray-600">refresh_token 남은 시간</dt>
            <dd className={refreshRemainDays !== null && refreshRemainDays < 7 ? "font-bold text-red-600" : ""}>
              {refreshRemainDays} 일
            </dd>
            <dt className="text-gray-600">마지막 갱신</dt>
            <dd>{cred.updatedAt?.toISOString().slice(0, 19)}</dd>
          </dl>
        ) : (
          <p className="text-sm text-red-700">
            credentials 미설정. <code>pnpm tiger:bootstrap --ott &lt;OTT&gt;</code> 실행 필요.
          </p>
        )}
      </section>

      <section className="rounded-xl border bg-white p-4">
        <h2 className="mb-3 font-semibold">캐시 row 수</h2>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt>analysis</dt><dd>{nAnalysis}</dd>
          <dt>yearly</dt><dd>{nYearly}</dd>
          <dt>daily</dt><dd>{nDaily}</dd>
          <dt>compatibility</dt><dd>{nCompat}</dd>
        </dl>
      </section>

      <section className="rounded-xl border bg-amber-50 p-4 text-sm text-amber-900">
        ℹ️ cross-talk 감지 통계는 stderr 로그 (Docker logs) 에서 확인:
        <code className="ml-2 rounded bg-amber-100 px-1">grep playmcp_cross_talk_detected</code>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/src/app/tiger/admin/diagnostics/page.tsx
git commit -m "feat(tiger): 운영자 진단 페이지 — credentials TTL + 캐시 row 수

access_token < 30분, refresh_token < 7일 강조 표시. 캐시 4 테이블
row 수 + cross-talk 감지 로그 grep 안내."
```

---

## Phase 7: 통합 테스트 + 운영 배포 smoke

### Task 7.1: DB 통합 테스트 — CASCADE + CHECK

**Files:**
- Create: `apps/dashboard/src/features/tiger-profile-manage/api/tigerProfile.integration.test.ts`

- [ ] **Step 1: 통합 테스트 작성**

```ts
import { describe, expect, it, beforeAll, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  playmcpProfiles, playmcpAnalysis, playmcpYearly, playmcpDaily,
  playmcpCompatibility, users,
} from "@/shared/lib/db/schema";

// 통합 테스트: TEST_DATABASE_URL 설정 필요 (Gotcha #2).
// 실행: TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test

let testUserId: string;

beforeAll(async () => {
  const [u] = await db
    .insert(users)
    .values({ name: "tiger-test", email: `tiger-${Date.now()}@test.local` })
    .returning({ id: users.id });
  testUserId = u.id;
});

afterEach(async () => {
  await db.delete(playmcpProfiles).where(eq(playmcpProfiles.userId, testUserId));
});

describe("playmcp_profiles CASCADE + CHECK", () => {
  it("profile 삭제 시 analysis/yearly/daily 캐시 모두 CASCADE", async () => {
    const [profile] = await db.insert(playmcpProfiles).values({
      userId: testUserId,
      nickname: "test", relation: "self",
      birthDate: "1990-01-01", calendar: "solar", gender: "male",
      birthTime: null, birthCity: null,
      inputHash: "test-hash",
    }).returning();

    await db.insert(playmcpAnalysis).values({
      profileId: profile.id, inputHash: "test-hash", payload: {}, validatedAt: new Date(),
    });
    await db.insert(playmcpYearly).values({
      profileId: profile.id, year: 2026, inputHash: "test-hash", payload: {}, validatedAt: new Date(),
    });
    await db.insert(playmcpDaily).values({
      profileId: profile.id, forDateKst: "2026-05-15", inputHash: "test-hash", payload: {}, validatedAt: new Date(),
    });

    await db.delete(playmcpProfiles).where(eq(playmcpProfiles.id, profile.id));

    const a = await db.select().from(playmcpAnalysis).where(eq(playmcpAnalysis.profileId, profile.id));
    const y = await db.select().from(playmcpYearly).where(eq(playmcpYearly.profileId, profile.id));
    const d = await db.select().from(playmcpDaily).where(eq(playmcpDaily.profileId, profile.id));
    expect(a).toHaveLength(0);
    expect(y).toHaveLength(0);
    expect(d).toHaveLength(0);
  });

  it("compatibility CHECK (profile1 < profile2) — 잘못된 순서 INSERT 시 에러", async () => {
    const [pA] = await db.insert(playmcpProfiles).values({
      userId: testUserId, nickname: "A", relation: "self", birthDate: "1990-01-01",
      calendar: "solar", gender: "male", birthTime: null, birthCity: null, inputHash: "a",
    }).returning();
    const [pB] = await db.insert(playmcpProfiles).values({
      userId: testUserId, nickname: "B", relation: "friend", birthDate: "1991-01-01",
      calendar: "solar", gender: "female", birthTime: null, birthCity: null, inputHash: "b",
    }).returning();
    const [first, second] = [pA.id, pB.id].sort();
    // 정상 INSERT
    await db.insert(playmcpCompatibility).values({
      profile1Id: first, profile2Id: second,
      inputHash1: "a", inputHash2: "b",
      payload: {}, validatedAt: new Date(),
    });
    // 잘못된 순서 — DB CHECK 거부
    await expect(
      db.insert(playmcpCompatibility).values({
        profile1Id: second, profile2Id: first,
        inputHash1: "b", inputHash2: "a",
        payload: {}, validatedAt: new Date(),
      }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 로컬 test DB 띄우기 (없으면)**

Run:
```bash
docker run -d --rm --name gons-test-db -p 5999:5432 \
  -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=test_dummy \
  postgres:16-alpine
```

- [ ] **Step 3: test DB 에 마이그레이션 적용**

Run:
```bash
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
pnpm db:migrate
```

Expected: 0010 까지 적용. `PASS: 0010 ...`

- [ ] **Step 4: 통합 테스트 실행**

Run:
```bash
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" \
pnpm test -- src/features/tiger-profile-manage/api/tigerProfile.integration.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/features/tiger-profile-manage/api/tigerProfile.integration.test.ts
git commit -m "test(tiger): integration — CASCADE 무효화 + CHECK 제약

profile 삭제 시 analysis/yearly/daily 캐시 동시 삭제 검증. compatibility
profile1<profile2 CHECK 가 잘못된 순서 INSERT 거부."
```

---

### Task 7.2: 전체 빌드·테스트 통과 + 회귀 smoke

- [ ] **Step 1: 전체 unit + integration 테스트**

Run: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test`
Expected: 모든 신규 테스트 PASS. 기존 saju-reading / fortune-profile-manage 테스트 회귀 0.

- [ ] **Step 2: 전체 typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 3: production build 검증**

Run: `pnpm build`
Expected: `apps/dashboard/.next/` 생성 성공.

- [ ] **Step 4: dev 서버로 기존 + 신규 페이지 smoke**

Run: `pnpm dev` (별도 터미널)
방문:
- `/` (홈)
- `/fortune` (기존 사주)
- `/fortune/<existing-profileId>` (기존 사주 상세)
- `/tiger` (신규)
- `/tiger/manage` (신규)

Expected: 모두 정상 렌더. 콘솔 에러 0.

- [ ] **Step 5: 체크포인트 commit**

```bash
git commit --allow-empty -m "chore(tiger): Phase 0-7 구현 완료 — 운영 배포 대기

전체 빌드·테스트·기존 영역 회귀 0 확인. 운영 배포는 마이그레이션 0010
적용 → 이미지 빌드 → tiger:bootstrap 실행 → 컨테이너 교체 → smoke test."
```

---

### Task 7.3: PR + CI + 운영 배포 (운영자 수동)

**Files:** 없음 — 운영 절차 체크리스트

- [ ] **Step 1: PR 생성**

Run:
```bash
git push -u origin tiger-playmcp-area
gh pr create --title "feat(tiger): 호(虎) 상담 영역 — PlayMCP 1FATE 전용 신규 영역" \
  --body "$(cat <<'EOF'
## Summary

PlayMCP MCP #261 (1FATE) 4 도구를 활용한 호 페르소나 사주 상담 영역 신설.
기존 saju-reading 영역 완전 보존, /tiger 라우트로 완전 독립 이중 시스템.

- v0.1 카드 4개: analyze / year / daily / compatibility
- 마이그레이션 0010: playmcp_profiles + 4 캐시 테이블 + credentials
- PlayMCP cross-talk 게이트 (4단 검증 + LRU 20)
- mcporter OTT 교환 흐름 + AES-256-GCM 토큰 암호화
- 운영자 진단 페이지 /tiger/admin/diagnostics

Spec: docs/superpowers/specs/2026-05-15-tiger-playmcp-area-design.md
Plan: docs/superpowers/plans/2026-05-15-tiger-playmcp-area.md

## Test plan
- [ ] 모든 unit 테스트 PASS
- [ ] integration 테스트 PASS (TEST_DATABASE_URL 로컬 DB)
- [ ] typecheck PASS
- [ ] lint PASS
- [ ] production build PASS
- [ ] /fortune, /fortune/[id] 기존 페이지 회귀 0
- [ ] /tiger, /tiger/manage, /tiger/compatibility, /tiger/[id] 렌더 정상

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: CI 통과 대기**

Run: `gh run watch`
Expected: Lint & Type Check / Build & Push Docker Images 모두 SUCCESS

- [ ] **Step 3: 운영자 의사결정 후 머지**

```bash
gh pr merge --squash
```

- [ ] **Step 4: 운영 DB 마이그레이션 0010 적용**

운영자 실행:
```bash
DATABASE_URL="postgres://...:.../gons_dashboard" \
pnpm db:migrate --i-know-this-is-prod
```

Expected: `PASS: 0010 ...`

- [ ] **Step 5: PlayMCP 도구함에서 OTT 발급**

운영자 수동 (브라우저):
1. `https://playmcp.kakao.com/toolbox` 로그인
2. 도구함에 `1fate` (#261) 추가
3. "OpenClaw와 연결" 클릭 → 연결 프롬프트 텍스트에서 OTT 값 추출 (`oneTimeToken: ...`)

- [ ] **Step 6: 운영 컨테이너에서 bootstrap 실행**

```bash
docker --context home-server exec gons-dashboard-app \
  sh -c "pnpm tiger:bootstrap --ott <OTT_VALUE> --i-know-this-is-prod"
```

Expected: `[3/3] 완료...`

- [ ] **Step 7: 새 이미지 풀 + 컨테이너 교체**

```bash
COMPOSE=/home/gon/projects/gon/gons-dashboard/docker-compose.yml
docker --context home-server compose -f $COMPOSE pull app
docker --context home-server compose -f $COMPOSE up -d app
```

- [ ] **Step 8: 헬스체크**

```bash
ssh gon@192.168.0.5 "curl -s http://localhost:3020/api/health"
```
Expected: `{"status":"ok"}`

브라우저: `https://gons.krdn.kr/tiger/admin/diagnostics`
Expected: 운영자 계정으로 로그인 후 access/refresh 남은 시간 + 캐시 row 0 표시

- [ ] **Step 9: smoke — self 프로필 1개로 4 카드 검증**

브라우저:
1. `/tiger/manage` → 본인 프로필 등록
2. `/tiger/[id]` → analysis 카드 렌더 + yearly/daily "보기" 버튼 클릭 → 정상 렌더
3. 두 번째 프로필 등록 → `/tiger/compatibility` → 두 프로필 선택 → 궁합 렌더

Expected: 모든 카드 narrative 한국어 정상. cross-talk 에러 0.

- [ ] **Step 10: .env 정리**

`PLAYMCP_BOOTSTRAP_OTT` 값을 운영 .env 에서 즉시 제거 (1회용).

---

## 자체 리뷰 체크리스트 (구현 완료 후)

- [ ] spec §1.4 성공 기준 5개 모두 검증됨
- [ ] spec §2 결정 사항 8개 모두 코드로 반영됨
- [ ] spec §6.1 cross-talk 4단 검사가 fixture 회귀 차단
- [ ] spec §7 5계층 에러 매핑이 errors.ts 와 일치
- [ ] spec §13 Gotcha 회피 5건 모두 적용 확인
- [ ] 기존 fortune-* / saju-* import 0 (ESLint boundary 통과)
- [ ] 운영 진단 페이지에서 토큰 + 캐시 row + 가이드 확인 가능
