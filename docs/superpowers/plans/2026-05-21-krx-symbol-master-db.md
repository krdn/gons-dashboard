# KRX 종목 마스터 DB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 공공데이터포털 KRX API 로 KOSPI/KOSDAQ/ETF/리츠 ~4,000 종목을 주 1회 cron 으로 DB 시드하여, 한글/6자리코드 종목 검색을 정적 맵 50개에서 DB 마스터 전수 검색으로 확장한다.

**Architecture:** Drizzle `stock_master` 테이블 (pg_trgm GIN 인덱스) 에 data.go.kr "주식시세정보" API 응답을 주 1회 일요일 06:00 KST cron 으로 upsert. `/api/stock/search` 라우트는 한글/6자리코드 입력 시 DB ILIKE 조회, 영문/티커는 기존 Yahoo 경로 유지. 이전상장(.KQ→.KS) 감지 시 `portfolio_holdings` 자동 UPDATE + audit log.

**Tech Stack:** Drizzle ORM, PostgreSQL 16 (pg_trgm extension), Next.js 16 App Router, Zod, vitest, node-cron, TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-05-21-krx-symbol-master-db-design.md`

---

## File Structure

| 경로 | 책임 | 신규/수정 |
|------|------|-----------|
| `apps/dashboard/drizzle/0XXX_*.sql` | pg_trgm CREATE + stock_master + stock_symbol_migrations 마이그레이션 | 신규 (auto-generated) |
| `apps/dashboard/src/shared/lib/db/schema.ts` | Drizzle 스키마에 두 테이블 추가 | 수정 |
| `apps/dashboard/src/shared/config/env.ts` | `KRX_DATA_GO_KR_API_KEY` Zod required 추가 | 수정 |
| `apps/dashboard/.env.example` | 신규 환경변수 placeholder | 수정 |
| `apps/dashboard/src/features/krx-master-sync/model/schema.ts` | data.go.kr 응답 Zod 스키마 | 신규 |
| `apps/dashboard/src/features/krx-master-sync/lib/symbol-mapping.ts` | marketCategory → .KS/.KQ + securityType 정규화 | 신규 |
| `apps/dashboard/src/features/krx-master-sync/api/fetch-data-go-kr.ts` | 페이지네이션 fetch | 신규 |
| `apps/dashboard/src/features/krx-master-sync/api/reconcile.ts` | 신규/변경없음/이전상장/상장폐지 4분기 처리 | 신규 |
| `apps/dashboard/src/features/krx-master-sync/api/sync.ts` | orchestrator (fetch → reconcile → 결과 집계) | 신규 |
| `apps/dashboard/src/entities/stock-master/model/types.ts` | `StockMasterRow` 타입 | 신규 |
| `apps/dashboard/src/entities/stock-master/server.ts` | `searchStockMaster` 함수 | 신규 |
| `apps/dashboard/src/app/api/cron/krx-master-sync/route.ts` | Bearer 인증 + syncKrxMaster 호출 | 신규 |
| `apps/dashboard/src/app/api/stock/search/route.ts` | 한글/6자리 분기 추가 | 수정 |
| `apps/cron/scheduler.js` | 일요일 06:00 KST cron 등록 | 수정 |
| `apps/dashboard/src/features/krx-master-sync/__tests__/*` | 단위/통합 테스트 | 신규 |
| `packages/stock-analysis/src/adapters/krx-symbols.ts` | (Phase 7 별도 PR 에서 폐지) | (보류) |

---

## Phase 1: DB 스키마 + pg_trgm 마이그레이션

### Task 1.1: env.ts 에 KRX API 키 Zod 추가

**Files:**
- Modify: `apps/dashboard/src/shared/config/env.ts`
- Modify: `apps/dashboard/.env.example`

- [ ] **Step 1: 현재 env.ts 의 CRON_BEARER_TOKEN 위치 확인**

Run:
```bash
grep -n "CRON_BEARER_TOKEN" apps/dashboard/src/shared/config/env.ts
```
Expected: 한 줄 출력 (Zod 스키마 정의 라인 번호 확보).

- [ ] **Step 2: env.ts 에 KRX_DATA_GO_KR_API_KEY 추가**

`CRON_BEARER_TOKEN` 정의 바로 아래에 다음을 추가:

```ts
KRX_DATA_GO_KR_API_KEY: z
  .string()
  .min(1, "공공데이터포털 KRX API 키. https://www.data.go.kr/ 에서 발급."),
```

- [ ] **Step 3: .env.example 에 placeholder 추가**

파일 끝(혹은 LLM 그룹 근처)에 다음 블록 추가:

```bash
# 공공데이터포털 KRX "주식시세정보" API 키
# 발급 절차: data.go.kr 회원가입 → 금융위원회 주식시세정보 활용신청 (승인 1-3일)
KRX_DATA_GO_KR_API_KEY=
```

- [ ] **Step 4: typecheck 통과 확인**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/shared/config/env.ts apps/dashboard/.env.example
git commit -m "feat(stock-analysis): KRX_DATA_GO_KR_API_KEY env 추가"
```

### Task 1.2: Drizzle 스키마에 두 테이블 추가

**Files:**
- Modify: `apps/dashboard/src/shared/lib/db/schema.ts`

- [ ] **Step 1: schema.ts 의 stockConsensusFlips 정의 끝 위치 확인**

Run:
```bash
grep -n "stockConsensusFlips\|stockAnalysisRuns" apps/dashboard/src/shared/lib/db/schema.ts | head -5
```
Expected: stockConsensusFlips 와 stockAnalysisRuns 위치 출력. 새 테이블은 stockAnalysisRuns 끝 다음에 추가.

- [ ] **Step 2: stockMaster + stockSymbolMigrations 추가**

`stockAnalysisRuns` 정의 끝(약 1080 라인 부근) 바로 다음에 추가:

```ts
/* =========================================================================
 * KRX 종목 마스터 — entities/stock-master + features/krx-master-sync
 * 한글 검색을 위한 종목 마스터. 주 1회 일요일 06:00 KST cron 으로 갱신.
 * pg_trgm GIN 인덱스로 ILIKE '%주성%' <5ms.
 * ========================================================================= */
export const stockMaster = pgTable(
  "stock_master",
  {
    symbol: text("symbol").primaryKey(), // "005930.KS", "036930.KQ"
    krxCode: text("krx_code").notNull(), // "005930"
    koreanName: text("korean_name").notNull(), // "삼성전자"
    englishName: text("english_name"), // "Samsung Electronics Co Ltd"
    marketCategory: text("market_category").notNull(), // 'KOSPI' | 'KOSDAQ'
    securityType: text("security_type").notNull(), // 'EQUITY' | 'ETF' | 'ETN' | 'REIT' | 'SPAC'
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    delisted: boolean("delisted").notNull().default(false),
  },
  (t) => [
    index("stock_master_krx_code_idx").on(t.krxCode),
    // pg_trgm GIN — ILIKE '%주성%' 빠른 검색 (4,000 row 에서 <5ms)
    index("stock_master_korean_name_trgm_idx").using(
      "gin",
      sql`${t.koreanName} gin_trgm_ops`,
    ),
    index("stock_master_market_active_idx").on(t.marketCategory, t.delisted),
  ],
);

// 이전상장 회수 audit log. 예: 066970.KQ → 066970.KS (엘앤에프 KOSDAQ→KOSPI 이전).
export const stockSymbolMigrations = pgTable(
  "stock_symbol_migrations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    krxCode: text("krx_code").notNull(),
    fromSymbol: text("from_symbol").notNull(),
    toSymbol: text("to_symbol").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    affectedHoldings: integer("affected_holdings").notNull().default(0),
    invalidatedCacheRows: integer("invalidated_cache_rows").notNull().default(0),
  },
  (t) => [
    index("stock_symbol_migrations_detected_idx").on(t.detectedAt.desc()),
  ],
);
```

- [ ] **Step 3: typecheck 통과 확인**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: drizzle-kit generate 로 마이그레이션 SQL 생성**

Run: `cd apps/dashboard && pnpm db:generate`
Expected: `apps/dashboard/drizzle/0XXX_*.sql` 신규 파일 + `apps/dashboard/drizzle/meta/_journal.json` 갱신.

만약 "snapshot id collision" 에러면 memory note `drizzle-snapshot-id-collision.md` 참고 — 충돌 entry 의 `0XXX_snapshot.json` 의 `id` (새 UUID) + `prevId` (직전 entry id) 두 줄만 수정.

- [ ] **Step 5: 생성된 SQL 검토 + pg_trgm CREATE 수동 추가**

Drizzle 은 extension 자동 생성 안 함. 신규 SQL 파일 맨 위에 멱등 명령 추가:

```sql
-- pg_trgm: ILIKE '%주성%' 빠른 검색용 GIN 인덱스 사전 조건
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- (그 아래는 drizzle-kit 가 생성한 CREATE TABLE / CREATE INDEX)
```

- [ ] **Step 6: 로컬 typecheck 재확인 (스키마 export 추가 누락 없는지)**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit (마이그레이션 SQL 포함)**

```bash
git add apps/dashboard/src/shared/lib/db/schema.ts apps/dashboard/drizzle/
git commit -m "feat(stock-analysis): stock_master + stock_symbol_migrations 테이블 + pg_trgm"
```

---

## Phase 2: data.go.kr API 어댑터 + Zod

### Task 2.1: Zod 스키마 작성

**Files:**
- Create: `apps/dashboard/src/features/krx-master-sync/model/schema.ts`
- Create: `apps/dashboard/src/features/krx-master-sync/__tests__/schema.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/dashboard/src/features/krx-master-sync/__tests__/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DataGoKrItemSchema, DataGoKrResponseSchema } from "../model/schema";

describe("DataGoKrItemSchema", () => {
  it("정상 item parse", () => {
    const r = DataGoKrItemSchema.parse({
      srtnCd: "005930",
      isinCd: "KR7005930003",
      itmsNm: "삼성전자",
      mrktCtg: "KOSPI",
      basDt: "20260521",
    });
    expect(r.srtnCd).toBe("005930");
    expect(r.mrktCtg).toBe("KOSPI");
  });

  it("필수 필드 누락 시 throw", () => {
    expect(() =>
      DataGoKrItemSchema.parse({ srtnCd: "005930" }),
    ).toThrow();
  });

  it("mrktCtg 가 KOSPI/KOSDAQ 외 값이면 throw", () => {
    expect(() =>
      DataGoKrItemSchema.parse({
        srtnCd: "005930",
        isinCd: "KR7005930003",
        itmsNm: "삼성전자",
        mrktCtg: "KONEX",
        basDt: "20260521",
      }),
    ).toThrow();
  });
});

describe("DataGoKrResponseSchema", () => {
  it("정상 응답 parse + items 추출", () => {
    const r = DataGoKrResponseSchema.parse({
      response: {
        header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
        body: {
          numOfRows: 2,
          pageNo: 1,
          totalCount: 4000,
          items: {
            item: [
              {
                srtnCd: "005930",
                isinCd: "KR7005930003",
                itmsNm: "삼성전자",
                mrktCtg: "KOSPI",
                basDt: "20260521",
              },
              {
                srtnCd: "036930",
                isinCd: "KR7036930007",
                itmsNm: "주성엔지니어링",
                mrktCtg: "KOSDAQ",
                basDt: "20260521",
              },
            ],
          },
        },
      },
    });
    expect(r.response.body.totalCount).toBe(4000);
    expect(r.response.body.items.item).toHaveLength(2);
  });

  it("에러 응답 (resultCode != 00) 도 parse 통과 (호출부에서 분기)", () => {
    const r = DataGoKrResponseSchema.parse({
      response: {
        header: { resultCode: "30", resultMsg: "SERVICE KEY IS NOT REGISTERED ERROR." },
        body: { numOfRows: 0, pageNo: 1, totalCount: 0, items: { item: [] } },
      },
    });
    expect(r.response.header.resultCode).toBe("30");
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `pnpm --filter @gons/dashboard vitest run src/features/krx-master-sync/__tests__/schema.test.ts`
Expected: FAIL with "Cannot find module '../model/schema'"

- [ ] **Step 3: 스키마 구현**

Create `apps/dashboard/src/features/krx-master-sync/model/schema.ts`:

```ts
import { z } from "zod";

// data.go.kr "금융위원회 주식시세정보" - getStockPriceInfo 응답 schema.
// 필드명은 공식 명세를 따른다 (srtnCd=종목코드, itmsNm=종목명, mrktCtg=시장구분).
// 응답은 일별 시세도 포함하나 우리는 마스터 정보만 필요.
export const DataGoKrItemSchema = z.object({
  srtnCd: z.string().regex(/^\d{6}$/, "6자리 종목코드"),
  isinCd: z.string().min(1),
  itmsNm: z.string().min(1), // 한글 종목명
  mrktCtg: z.enum(["KOSPI", "KOSDAQ"]), // KONEX 등은 v1.0 out of scope → throw
  basDt: z.string().regex(/^\d{8}$/, "YYYYMMDD"),
  // 일별 시세 필드들은 마스터 sync 에서 사용 안 함 — optional 로 허용
  clpr: z.string().optional(),
  vs: z.string().optional(),
  fltRt: z.string().optional(),
  mkp: z.string().optional(),
  hipr: z.string().optional(),
  lopr: z.string().optional(),
  trqu: z.string().optional(),
  trPrc: z.string().optional(),
  lstgStCnt: z.string().optional(),
  mrktTotAmt: z.string().optional(),
});

export type DataGoKrItem = z.infer<typeof DataGoKrItemSchema>;

export const DataGoKrResponseSchema = z.object({
  response: z.object({
    header: z.object({
      resultCode: z.string(),
      resultMsg: z.string(),
    }),
    body: z.object({
      numOfRows: z.number(),
      pageNo: z.number(),
      totalCount: z.number(),
      items: z.object({
        item: z.array(DataGoKrItemSchema),
      }),
    }),
  }),
});

export type DataGoKrResponse = z.infer<typeof DataGoKrResponseSchema>;
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `pnpm --filter @gons/dashboard vitest run src/features/krx-master-sync/__tests__/schema.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/features/krx-master-sync/model/schema.ts apps/dashboard/src/features/krx-master-sync/__tests__/schema.test.ts
git commit -m "feat(stock-analysis): data.go.kr 응답 Zod 스키마"
```

### Task 2.2: symbol-mapping 유틸

**Files:**
- Create: `apps/dashboard/src/features/krx-master-sync/lib/symbol-mapping.ts`
- Create: `apps/dashboard/src/features/krx-master-sync/__tests__/symbol-mapping.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/dashboard/src/features/krx-master-sync/__tests__/symbol-mapping.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  toYahooSymbol,
  inferSecurityType,
} from "../lib/symbol-mapping";

describe("toYahooSymbol", () => {
  it("KOSPI → .KS", () => {
    expect(toYahooSymbol("005930", "KOSPI")).toBe("005930.KS");
  });
  it("KOSDAQ → .KQ", () => {
    expect(toYahooSymbol("036930", "KOSDAQ")).toBe("036930.KQ");
  });
});

describe("inferSecurityType", () => {
  it("종목명에 ETF 키워드 포함 → ETF", () => {
    expect(inferSecurityType("KODEX 200")).toBe("ETF");
    expect(inferSecurityType("TIGER 미국S&P500")).toBe("ETF");
    expect(inferSecurityType("ARIRANG 코스피")).toBe("ETF");
  });
  it("리츠 → REIT", () => {
    expect(inferSecurityType("롯데리츠")).toBe("REIT");
    expect(inferSecurityType("이지스밸류리츠")).toBe("REIT");
  });
  it("ETN 키워드 → ETN", () => {
    expect(inferSecurityType("신한 코스피200 ETN")).toBe("ETN");
  });
  it("스팩 → SPAC", () => {
    expect(inferSecurityType("미래에셋스팩4호")).toBe("SPAC");
  });
  it("일반 종목 → EQUITY", () => {
    expect(inferSecurityType("삼성전자")).toBe("EQUITY");
    expect(inferSecurityType("주성엔지니어링")).toBe("EQUITY");
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `pnpm --filter @gons/dashboard vitest run src/features/krx-master-sync/__tests__/symbol-mapping.test.ts`
Expected: FAIL with "Cannot find module '../lib/symbol-mapping'"

- [ ] **Step 3: 구현**

Create `apps/dashboard/src/features/krx-master-sync/lib/symbol-mapping.ts`:

```ts
// 공공데이터 API 는 6자리 코드 + KOSPI/KOSDAQ marketCategory 만 제공.
// Yahoo 심볼은 KOSPI=".KS", KOSDAQ=".KQ" 접미사 필요.
export function toYahooSymbol(
  krxCode: string,
  marketCategory: "KOSPI" | "KOSDAQ",
): string {
  const suffix = marketCategory === "KOSPI" ? ".KS" : ".KQ";
  return `${krxCode}${suffix}`;
}

// API 응답에는 securityType 필드가 없어 종목명에서 추론.
// 우선순위: REIT > ETN > SPAC > ETF > EQUITY
export type SecurityType = "EQUITY" | "ETF" | "ETN" | "REIT" | "SPAC";

const ETF_PREFIXES = [
  "KODEX",
  "TIGER",
  "ARIRANG",
  "ACE",
  "KBSTAR",
  "HANARO",
  "SOL",
  "PLUS",
  "RISE",
  "WOORI",
  "마이티",
  "히어로즈",
];

export function inferSecurityType(koreanName: string): SecurityType {
  const upper = koreanName.toUpperCase();
  if (koreanName.includes("리츠")) return "REIT";
  if (upper.includes("ETN")) return "ETN";
  if (koreanName.includes("스팩")) return "SPAC";
  for (const p of ETF_PREFIXES) {
    if (upper.startsWith(p.toUpperCase() + " ") || upper.startsWith(p.toUpperCase())) {
      return "ETF";
    }
  }
  return "EQUITY";
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `pnpm --filter @gons/dashboard vitest run src/features/krx-master-sync/__tests__/symbol-mapping.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/features/krx-master-sync/lib/symbol-mapping.ts apps/dashboard/src/features/krx-master-sync/__tests__/symbol-mapping.test.ts
git commit -m "feat(stock-analysis): symbol-mapping 유틸 (KOSPI/KOSDAQ → Yahoo 심볼, securityType 추론)"
```

### Task 2.3: fetch-data-go-kr 페이지네이션

**Files:**
- Create: `apps/dashboard/src/features/krx-master-sync/api/fetch-data-go-kr.ts`
- Create: `apps/dashboard/src/features/krx-master-sync/__tests__/fetch-data-go-kr.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

Create `apps/dashboard/src/features/krx-master-sync/__tests__/fetch-data-go-kr.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchAllKrxItems } from "../api/fetch-data-go-kr";

function mockResponse(body: unknown, opts: { ok?: boolean; status?: number } = {}) {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    statusText: "OK",
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function makeItem(srtnCd: string, mrktCtg: "KOSPI" | "KOSDAQ", itmsNm: string) {
  return {
    srtnCd,
    isinCd: `KR7${srtnCd}000`,
    itmsNm,
    mrktCtg,
    basDt: "20260521",
  };
}

function makePage(items: ReturnType<typeof makeItem>[], pageNo: number, totalCount: number) {
  return {
    response: {
      header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
      body: { numOfRows: items.length, pageNo, totalCount, items: { item: items } },
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("fetchAllKrxItems", () => {
  it("페이지네이션: 2페이지에 걸쳐 전체 fetch", async () => {
    const page1 = makePage(
      Array.from({ length: 1000 }, (_, i) =>
        makeItem(String(i).padStart(6, "0"), "KOSPI", `종목${i}`),
      ),
      1,
      1500,
    );
    const page2 = makePage(
      Array.from({ length: 500 }, (_, i) =>
        makeItem(String(1000 + i).padStart(6, "0"), "KOSDAQ", `종목${1000 + i}`),
      ),
      2,
      1500,
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(page1))
      .mockResolvedValueOnce(mockResponse(page2));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchAllKrxItems("test-key");
    expect(result.items).toHaveLength(1500);
    expect(result.errors).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("HTTP 401 → errors 배열에 기록 + 빈 items 반환", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockResponse({}, { ok: false, status: 401 }),
    ) as unknown as typeof fetch;
    const result = await fetchAllKrxItems("bad-key");
    expect(result.items).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/401/);
  });

  it("resultCode != 00 → errors 기록", async () => {
    const errBody = {
      response: {
        header: { resultCode: "30", resultMsg: "SERVICE KEY IS NOT REGISTERED ERROR." },
        body: { numOfRows: 0, pageNo: 1, totalCount: 0, items: { item: [] } },
      },
    };
    global.fetch = vi.fn().mockResolvedValue(mockResponse(errBody)) as unknown as typeof fetch;
    const result = await fetchAllKrxItems("test-key");
    expect(result.items).toEqual([]);
    expect(result.errors[0]).toMatch(/SERVICE KEY/);
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `pnpm --filter @gons/dashboard vitest run src/features/krx-master-sync/__tests__/fetch-data-go-kr.test.ts`
Expected: FAIL with "Cannot find module '../api/fetch-data-go-kr'"

- [ ] **Step 3: 구현**

Create `apps/dashboard/src/features/krx-master-sync/api/fetch-data-go-kr.ts`:

```ts
import "server-only";
import {
  DataGoKrResponseSchema,
  type DataGoKrItem,
} from "../model/schema";

const ENDPOINT =
  "https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo";
const NUM_OF_ROWS = 1000;
const PER_PAGE_TIMEOUT_MS = 10_000;
const MAX_PAGES = 20; // safety cap — 정상 사용량 ~4 페이지

export interface FetchResult {
  items: DataGoKrItem[];
  errors: string[];
}

// 페이지네이션으로 전체 KRX 종목 fetch.
// API 가 "오늘 일자 시세" 를 함께 반환하므로 basDt 미지정 (서버 기본 = 영업일).
export async function fetchAllKrxItems(apiKey: string): Promise<FetchResult> {
  const items: DataGoKrItem[] = [];
  const errors: string[] = [];

  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
    const url =
      `${ENDPOINT}?serviceKey=${encodeURIComponent(apiKey)}` +
      `&numOfRows=${NUM_OF_ROWS}&pageNo=${pageNo}&resultType=json`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PER_PAGE_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        errors.push(`page ${pageNo}: HTTP ${res.status} ${res.statusText}`);
        return { items, errors }; // 인증 실패는 다음 페이지도 같음 → abort
      }
      const json = await res.json();
      const parsed = DataGoKrResponseSchema.safeParse(json);
      if (!parsed.success) {
        errors.push(`page ${pageNo}: schema mismatch: ${parsed.error.message}`);
        return { items, errors };
      }
      if (parsed.data.response.header.resultCode !== "00") {
        errors.push(
          `page ${pageNo}: API error ${parsed.data.response.header.resultCode} ${parsed.data.response.header.resultMsg}`,
        );
        return { items, errors };
      }
      const pageItems = parsed.data.response.body.items.item;
      items.push(...pageItems);
      const total = parsed.data.response.body.totalCount;
      if (items.length >= total || pageItems.length < NUM_OF_ROWS) {
        break; // 전체 수집 완료
      }
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`page ${pageNo}: ${msg}`);
      return { items, errors };
    }
  }

  return { items, errors };
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `pnpm --filter @gons/dashboard vitest run src/features/krx-master-sync/__tests__/fetch-data-go-kr.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/features/krx-master-sync/api/fetch-data-go-kr.ts apps/dashboard/src/features/krx-master-sync/__tests__/fetch-data-go-kr.test.ts
git commit -m "feat(stock-analysis): data.go.kr 페이지네이션 fetch + 에러 처리"
```

---

## Phase 3: sync orchestrator + reconcile

### Task 3.1: reconcile 로직 (단위 + 통합 테스트)

**Files:**
- Create: `apps/dashboard/src/features/krx-master-sync/api/reconcile.ts`
- Create: `apps/dashboard/src/features/krx-master-sync/__tests__/reconcile.integration.test.ts`

> 통합 테스트라 `TEST_DATABASE_URL` 필요 (CLAUDE.md Gotcha #2). 로컬 실행:
> ```bash
> docker run -d --rm --name gons-test-db -p 5999:5432 \
>   -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=test_dummy \
>   postgres:16-alpine
> docker exec gons-test-db psql -U test test_dummy -c "CREATE EXTENSION pg_trgm"
> TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm --filter @gons/dashboard vitest run src/features/krx-master-sync/__tests__/reconcile.integration.test.ts
> ```
> CI 는 통합 DB 없이도 통과해야 함 → 테스트 안에서 `process.env.TEST_DATABASE_URL` 없으면 skip.

- [ ] **Step 1: 통합 테스트 작성 (4분기 케이스)**

Create `apps/dashboard/src/features/krx-master-sync/__tests__/reconcile.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  stockMaster,
  stockSymbolMigrations,
  portfolioHoldings,
  stockAnalysisCache,
  users,
} from "@/shared/lib/db/schema";
import { reconcileStockMaster } from "../api/reconcile";

const skipIfNoDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

skipIfNoDb("reconcileStockMaster — 4분기 처리", () => {
  let userId: string;

  beforeAll(async () => {
    // pg_trgm + 스키마 마이그레이션 사전 적용 필요 (로컬 docker)
    await db.execute(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  });

  beforeEach(async () => {
    // 테이블 초기화 (FK 순서 주의)
    await db.delete(stockAnalysisCache);
    await db.delete(portfolioHoldings);
    await db.delete(stockSymbolMigrations);
    await db.delete(stockMaster);
    await db.delete(users);
    const [u] = await db
      .insert(users)
      .values({ email: "test@test.com" })
      .returning();
    userId = u.id;
  });

  it("신규 종목 → INSERT", async () => {
    const result = await reconcileStockMaster([
      {
        symbol: "036930.KQ",
        krxCode: "036930",
        koreanName: "주성엔지니어링",
        englishName: null,
        marketCategory: "KOSDAQ",
        securityType: "EQUITY",
      },
    ]);
    expect(result.upserted).toBe(1);
    expect(result.migrations).toBe(0);
    const rows = await db.select().from(stockMaster);
    expect(rows).toHaveLength(1);
    expect(rows[0].koreanName).toBe("주성엔지니어링");
  });

  it("변경 없음 → lastSyncedAt 만 갱신", async () => {
    await db.insert(stockMaster).values({
      symbol: "005930.KS",
      krxCode: "005930",
      koreanName: "삼성전자",
      marketCategory: "KOSPI",
      securityType: "EQUITY",
    });
    const before = await db.select().from(stockMaster).where(eq(stockMaster.symbol, "005930.KS"));
    const beforeTs = before[0].lastSyncedAt.getTime();

    // 1ms 보장 위해 sleep
    await new Promise((r) => setTimeout(r, 5));

    const result = await reconcileStockMaster([
      {
        symbol: "005930.KS",
        krxCode: "005930",
        koreanName: "삼성전자",
        englishName: null,
        marketCategory: "KOSPI",
        securityType: "EQUITY",
      },
    ]);
    expect(result.upserted).toBe(1);
    expect(result.migrations).toBe(0);
    const after = await db.select().from(stockMaster).where(eq(stockMaster.symbol, "005930.KS"));
    expect(after[0].lastSyncedAt.getTime()).toBeGreaterThan(beforeTs);
  });

  it("이전상장: 066970.KQ → 066970.KS, portfolio_holdings UPDATE + cache 삭제 + migration log", async () => {
    await db.insert(stockMaster).values({
      symbol: "066970.KQ",
      krxCode: "066970",
      koreanName: "엘앤에프",
      marketCategory: "KOSDAQ",
      securityType: "EQUITY",
    });
    await db.insert(portfolioHoldings).values({
      userId,
      symbol: "066970.KQ",
      assetClass: "stock",
      market: "KR",
      displayName: "엘앤에프",
      quantity: "10",
      avgCost: "150000",
    });
    await db.insert(stockAnalysisCache).values({
      symbol: "066970.KQ",
      analysisDate: "2026-05-21",
      userId: null,
      personas: {},
      consensus: {},
      marketSnapshot: {},
      promptVersion: "v1",
    });

    const result = await reconcileStockMaster([
      {
        symbol: "066970.KS",
        krxCode: "066970",
        koreanName: "엘앤에프",
        englishName: null,
        marketCategory: "KOSPI",
        securityType: "EQUITY",
      },
    ]);

    expect(result.migrations).toBe(1);
    const ks = await db.select().from(stockMaster).where(eq(stockMaster.symbol, "066970.KS"));
    const kq = await db.select().from(stockMaster).where(eq(stockMaster.symbol, "066970.KQ"));
    expect(ks).toHaveLength(1);
    expect(ks[0].delisted).toBe(false);
    expect(kq[0].delisted).toBe(true);

    const holdings = await db.select().from(portfolioHoldings);
    expect(holdings[0].symbol).toBe("066970.KS");

    const cache = await db.select().from(stockAnalysisCache);
    expect(cache).toHaveLength(0);

    const log = await db.select().from(stockSymbolMigrations);
    expect(log[0].fromSymbol).toBe("066970.KQ");
    expect(log[0].toSymbol).toBe("066970.KS");
    expect(log[0].affectedHoldings).toBe(1);
    expect(log[0].invalidatedCacheRows).toBe(1);
  });

  it("상장폐지: 응답에 없던 active row → delisted=true", async () => {
    await db.insert(stockMaster).values([
      {
        symbol: "005930.KS",
        krxCode: "005930",
        koreanName: "삼성전자",
        marketCategory: "KOSPI",
        securityType: "EQUITY",
      },
      {
        symbol: "999999.KQ",
        krxCode: "999999",
        koreanName: "상장폐지예정",
        marketCategory: "KOSDAQ",
        securityType: "EQUITY",
      },
    ]);
    const result = await reconcileStockMaster([
      {
        symbol: "005930.KS",
        krxCode: "005930",
        koreanName: "삼성전자",
        englishName: null,
        marketCategory: "KOSPI",
        securityType: "EQUITY",
      },
    ]);
    expect(result.delisted).toBe(1);
    const delistedRows = await db
      .select()
      .from(stockMaster)
      .where(eq(stockMaster.delisted, true));
    expect(delistedRows[0].symbol).toBe("999999.KQ");
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm --filter @gons/dashboard vitest run src/features/krx-master-sync/__tests__/reconcile.integration.test.ts`
Expected: FAIL with "Cannot find module '../api/reconcile'"
(DB 미가동이면 skip 떨어짐 — Step 3 으로 진행)

- [ ] **Step 3: 구현**

Create `apps/dashboard/src/features/krx-master-sync/api/reconcile.ts`:

```ts
import "server-only";
import { and, eq, notInArray } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  stockMaster,
  stockSymbolMigrations,
  portfolioHoldings,
  stockAnalysisCache,
} from "@/shared/lib/db/schema";

export interface ReconcileInput {
  symbol: string; // "036930.KQ"
  krxCode: string;
  koreanName: string;
  englishName: string | null;
  marketCategory: "KOSPI" | "KOSDAQ";
  securityType: "EQUITY" | "ETF" | "ETN" | "REIT" | "SPAC";
}

export interface ReconcileResult {
  upserted: number;
  delisted: number;
  migrations: number;
  errors: string[];
}

export async function reconcileStockMaster(
  rows: ReconcileInput[],
): Promise<ReconcileResult> {
  const errors: string[] = [];
  let upserted = 0;
  let migrations = 0;

  for (const row of rows) {
    try {
      const [existing] = await db
        .select()
        .from(stockMaster)
        .where(
          and(
            eq(stockMaster.krxCode, row.krxCode),
            eq(stockMaster.delisted, false),
          ),
        )
        .limit(1);

      if (!existing) {
        // 신규 상장
        await db.insert(stockMaster).values({
          symbol: row.symbol,
          krxCode: row.krxCode,
          koreanName: row.koreanName,
          englishName: row.englishName,
          marketCategory: row.marketCategory,
          securityType: row.securityType,
        });
        upserted++;
        continue;
      }

      if (existing.symbol === row.symbol) {
        // 변경 없음 — 메타 + lastSyncedAt 갱신
        await db
          .update(stockMaster)
          .set({
            koreanName: row.koreanName,
            englishName: row.englishName,
            marketCategory: row.marketCategory,
            securityType: row.securityType,
            lastSyncedAt: new Date(),
          })
          .where(eq(stockMaster.symbol, row.symbol));
        upserted++;
        continue;
      }

      // 이전상장 감지 (.KQ → .KS 등)
      await db.transaction(async (tx) => {
        await tx.insert(stockMaster).values({
          symbol: row.symbol,
          krxCode: row.krxCode,
          koreanName: row.koreanName,
          englishName: row.englishName,
          marketCategory: row.marketCategory,
          securityType: row.securityType,
        });
        const updated = await tx
          .update(portfolioHoldings)
          .set({ symbol: row.symbol, updatedAt: new Date() })
          .where(eq(portfolioHoldings.symbol, existing.symbol))
          .returning();
        const invalidated = await tx
          .delete(stockAnalysisCache)
          .where(eq(stockAnalysisCache.symbol, existing.symbol))
          .returning();
        await tx.insert(stockSymbolMigrations).values({
          krxCode: row.krxCode,
          fromSymbol: existing.symbol,
          toSymbol: row.symbol,
          affectedHoldings: updated.length,
          invalidatedCacheRows: invalidated.length,
        });
        await tx
          .update(stockMaster)
          .set({ delisted: true })
          .where(eq(stockMaster.symbol, existing.symbol));
      });
      upserted++;
      migrations++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${row.symbol}: ${msg}`);
    }
  }

  // 응답에 없던 active row → delisted=true (상장폐지)
  const fetchedKrxCodes = rows.map((r) => r.krxCode);
  let delisted = 0;
  if (fetchedKrxCodes.length > 0) {
    const result = await db
      .update(stockMaster)
      .set({ delisted: true })
      .where(
        and(
          eq(stockMaster.delisted, false),
          notInArray(stockMaster.krxCode, fetchedKrxCodes),
        ),
      )
      .returning();
    delisted = result.length;
  }

  return { upserted, delisted, migrations, errors };
}
```

- [ ] **Step 4: 통합 테스트 실행 — 통과 확인 (로컬 test DB 가동 시)**

Run: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm --filter @gons/dashboard vitest run src/features/krx-master-sync/__tests__/reconcile.integration.test.ts`
Expected: PASS (4 tests) — DB 미가동이면 skip OK

- [ ] **Step 5: typecheck 통과 확인**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/features/krx-master-sync/api/reconcile.ts apps/dashboard/src/features/krx-master-sync/__tests__/reconcile.integration.test.ts
git commit -m "feat(stock-analysis): reconcile (신규/변경없음/이전상장/상장폐지 4분기)"
```

### Task 3.2: sync orchestrator

**Files:**
- Create: `apps/dashboard/src/features/krx-master-sync/api/sync.ts`
- Create: `apps/dashboard/src/features/krx-master-sync/__tests__/sync.test.ts`

- [ ] **Step 1: 단위 테스트 작성**

Create `apps/dashboard/src/features/krx-master-sync/__tests__/sync.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../api/fetch-data-go-kr", () => ({
  fetchAllKrxItems: vi.fn(),
}));
vi.mock("../api/reconcile", () => ({
  reconcileStockMaster: vi.fn(),
}));
vi.mock("@/shared/config/env", () => ({
  env: { KRX_DATA_GO_KR_API_KEY: "test-key" },
}));

import { fetchAllKrxItems } from "../api/fetch-data-go-kr";
import { reconcileStockMaster } from "../api/reconcile";
import { syncKrxMaster } from "../api/sync";

afterEach(() => vi.restoreAllMocks());

describe("syncKrxMaster", () => {
  it("정상 흐름: fetch → reconcile → 결과 집계", async () => {
    vi.mocked(fetchAllKrxItems).mockResolvedValue({
      items: [
        {
          srtnCd: "036930",
          isinCd: "KR7036930007",
          itmsNm: "주성엔지니어링",
          mrktCtg: "KOSDAQ",
          basDt: "20260521",
        },
      ],
      errors: [],
    });
    vi.mocked(reconcileStockMaster).mockResolvedValue({
      upserted: 1,
      delisted: 0,
      migrations: 0,
      errors: [],
    });

    const result = await syncKrxMaster();
    expect(result.fetched).toBe(1);
    expect(result.upserted).toBe(1);
    expect(result.delisted).toBe(0);
    expect(result.migrations).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(reconcileStockMaster).toHaveBeenCalledWith([
      expect.objectContaining({
        symbol: "036930.KQ",
        krxCode: "036930",
        koreanName: "주성엔지니어링",
        marketCategory: "KOSDAQ",
        securityType: "EQUITY",
      }),
    ]);
  });

  it("fetch 가 0건 + 에러 → reconcile 호출 안 함, errors 반환", async () => {
    vi.mocked(fetchAllKrxItems).mockResolvedValue({
      items: [],
      errors: ["page 1: HTTP 401 Unauthorized"],
    });
    const result = await syncKrxMaster();
    expect(result.fetched).toBe(0);
    expect(result.upserted).toBe(0);
    expect(result.errors).toContain("page 1: HTTP 401 Unauthorized");
    expect(reconcileStockMaster).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `pnpm --filter @gons/dashboard vitest run src/features/krx-master-sync/__tests__/sync.test.ts`
Expected: FAIL with "Cannot find module '../api/sync'"

- [ ] **Step 3: 구현**

Create `apps/dashboard/src/features/krx-master-sync/api/sync.ts`:

```ts
import "server-only";
import { env } from "@/shared/config/env";
import { fetchAllKrxItems } from "./fetch-data-go-kr";
import { reconcileStockMaster, type ReconcileInput } from "./reconcile";
import { toYahooSymbol, inferSecurityType } from "../lib/symbol-mapping";

export interface SyncResult {
  fetched: number;
  upserted: number;
  delisted: number;
  migrations: number;
  durationMs: number;
  errors: string[];
}

export async function syncKrxMaster(): Promise<SyncResult> {
  const startedAt = Date.now();
  const errors: string[] = [];

  const fetchResult = await fetchAllKrxItems(env.KRX_DATA_GO_KR_API_KEY);
  errors.push(...fetchResult.errors);

  if (fetchResult.items.length === 0) {
    return {
      fetched: 0,
      upserted: 0,
      delisted: 0,
      migrations: 0,
      durationMs: Date.now() - startedAt,
      errors,
    };
  }

  // API item → reconcile input 변환 + 중복 제거
  // (같은 krxCode 가 페이지 경계에서 두 번 올 수 있음)
  const seen = new Set<string>();
  const rows: ReconcileInput[] = [];
  for (const item of fetchResult.items) {
    if (seen.has(item.srtnCd)) continue;
    seen.add(item.srtnCd);
    rows.push({
      symbol: toYahooSymbol(item.srtnCd, item.mrktCtg),
      krxCode: item.srtnCd,
      koreanName: item.itmsNm,
      englishName: null, // API 에 영문명 필드 없음
      marketCategory: item.mrktCtg,
      securityType: inferSecurityType(item.itmsNm),
    });
  }

  const reconcileResult = await reconcileStockMaster(rows);
  errors.push(...reconcileResult.errors);

  return {
    fetched: fetchResult.items.length,
    upserted: reconcileResult.upserted,
    delisted: reconcileResult.delisted,
    migrations: reconcileResult.migrations,
    durationMs: Date.now() - startedAt,
    errors,
  };
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `pnpm --filter @gons/dashboard vitest run src/features/krx-master-sync/__tests__/sync.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: typecheck + lint 통과 확인**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/features/krx-master-sync/api/sync.ts apps/dashboard/src/features/krx-master-sync/__tests__/sync.test.ts
git commit -m "feat(stock-analysis): syncKrxMaster orchestrator (fetch + 중복제거 + reconcile)"
```

---

## Phase 4: cron 라우트 + scheduler 등록

### Task 4.1: API route + scheduler

**Files:**
- Create: `apps/dashboard/src/app/api/cron/krx-master-sync/route.ts`
- Modify: `apps/cron/scheduler.js`

- [ ] **Step 1: 기존 cron 라우트 Bearer 검증 패턴 확인**

Run:
```bash
grep -rn "CRON_BEARER_TOKEN\|authorization" apps/dashboard/src/app/api/cron/ | head -10
```
Expected: 기존 cron 라우트들의 Bearer 검증 패턴 라인. 같은 패턴 재사용.

- [ ] **Step 2: route.ts 구현**

Create `apps/dashboard/src/app/api/cron/krx-master-sync/route.ts`:

```ts
import "server-only";
import { NextResponse } from "next/server";
import { env } from "@/shared/config/env";
import { syncKrxMaster } from "@/features/krx-master-sync/api/sync";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${env.CRON_BEARER_TOKEN}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const result = await syncKrxMaster();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
```

- [ ] **Step 3: scheduler.js 에 cron 추가**

`apps/cron/scheduler.js` 의 stock-analyze cron 다음에 추가:

```js
// 매주 일요일 06:00 KST — KRX 종목 마스터 갱신
cron.schedule(
  "0 6 * * 0",
  () => {
    void callCron("/api/cron/krx-master-sync", "krx-master-sync");
  },
  { timezone: TIMEZONE },
);
```

그리고 `console.log("[cron] 스케줄 등록 완료. ...")` 요약 문자열에 `, krx-master=0 6 * * 0 KST` 추가.

- [ ] **Step 4: typecheck + lint 통과 확인**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 5: production build 확인**

Run: `cd apps/dashboard && pnpm build`
Expected: PASS — 라우트 목록에 `/api/cron/krx-master-sync` 포함 확인.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/src/app/api/cron/krx-master-sync/route.ts apps/cron/scheduler.js
git commit -m "feat(stock-analysis): krx-master-sync cron 라우트 + scheduler 등록"
```

---

## Phase 5: 검색 entity + 라우트 분기

### Task 5.1: stock-master entity 검색 함수

**Files:**
- Create: `apps/dashboard/src/entities/stock-master/model/types.ts`
- Create: `apps/dashboard/src/entities/stock-master/server.ts`
- Create: `apps/dashboard/src/entities/stock-master/__tests__/server.integration.test.ts`

- [ ] **Step 1: 타입 정의**

Create `apps/dashboard/src/entities/stock-master/model/types.ts`:

```ts
import type { InferSelectModel } from "drizzle-orm";
import type { stockMaster } from "@/shared/lib/db/schema";

export type StockMasterRow = InferSelectModel<typeof stockMaster>;
```

- [ ] **Step 2: 통합 테스트 작성**

Create `apps/dashboard/src/entities/stock-master/__tests__/server.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { db } from "@/shared/lib/db/client";
import { stockMaster } from "@/shared/lib/db/schema";
import { searchStockMaster } from "../server";

const skipIfNoDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

skipIfNoDb("searchStockMaster", () => {
  beforeAll(async () => {
    await db.execute(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  });

  beforeEach(async () => {
    await db.delete(stockMaster);
    await db.insert(stockMaster).values([
      { symbol: "005930.KS", krxCode: "005930", koreanName: "삼성전자", marketCategory: "KOSPI", securityType: "EQUITY" },
      { symbol: "005935.KS", krxCode: "005935", koreanName: "삼성전자우", marketCategory: "KOSPI", securityType: "EQUITY" },
      { symbol: "036930.KQ", krxCode: "036930", koreanName: "주성엔지니어링", marketCategory: "KOSDAQ", securityType: "EQUITY" },
      { symbol: "000000.KQ", krxCode: "000000", koreanName: "상장폐지테스트", marketCategory: "KOSDAQ", securityType: "EQUITY", delisted: true },
    ]);
  });

  it("한글 substring 매칭", async () => {
    const r = await searchStockMaster("주성");
    expect(r).toHaveLength(1);
    expect(r[0].symbol).toBe("036930.KQ");
  });

  it("한글 substring — 다건 (삼성)", async () => {
    const r = await searchStockMaster("삼성");
    expect(r.length).toBeGreaterThanOrEqual(2);
    expect(r.some((x) => x.symbol === "005930.KS")).toBe(true);
    expect(r.some((x) => x.symbol === "005935.KS")).toBe(true);
  });

  it("6자리 코드 정확 매칭", async () => {
    const r = await searchStockMaster("036930");
    expect(r).toHaveLength(1);
    expect(r[0].displayName).toBe("주성엔지니어링");
  });

  it("delisted=true 는 제외", async () => {
    const r = await searchStockMaster("상장폐지");
    expect(r).toEqual([]);
  });

  it("빈 쿼리 → 빈 결과", async () => {
    expect(await searchStockMaster("")).toEqual([]);
    expect(await searchStockMaster("   ")).toEqual([]);
  });
});
```

- [ ] **Step 3: 테스트 실행 — 실패 확인**

Run: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm --filter @gons/dashboard vitest run src/entities/stock-master/__tests__/server.integration.test.ts`
Expected: FAIL with "Cannot find module '../server'" (또는 DB 미가동 시 skip)

- [ ] **Step 4: 구현**

Create `apps/dashboard/src/entities/stock-master/server.ts`:

```ts
import "server-only";
import { and, eq, ilike, sql } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { stockMaster } from "@/shared/lib/db/schema";
import type { NormalizedSearchResult } from "@gons/stock-analysis";

const LIMIT = 10;

export async function searchStockMaster(
  query: string,
): Promise<NormalizedSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const isKrxCode = /^\d{6}$/.test(trimmed);
  const condition = isKrxCode
    ? eq(stockMaster.krxCode, trimmed)
    : ilike(stockMaster.koreanName, `%${trimmed}%`);

  const rows = await db
    .select()
    .from(stockMaster)
    .where(and(eq(stockMaster.delisted, false), condition))
    .orderBy(sql`length(${stockMaster.koreanName})`, stockMaster.koreanName)
    .limit(LIMIT);

  return rows.map((r) => ({
    symbol: r.symbol,
    displayName: r.koreanName,
    assetClass: "stock",
    market: "KRX",
    exchange: r.marketCategory === "KOSPI" ? "KSE" : "KOSDAQ",
  }));
}
```

> 정렬: `length(koreanName) ASC, koreanName ASC` — 짧은 이름(=정확 매칭에 가까운) 먼저, 같은 길이는 사전순. v1.0 ranking 충분.

- [ ] **Step 5: 통합 테스트 실행 — 통과 확인 (로컬 test DB 가동 시)**

Run: `TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm --filter @gons/dashboard vitest run src/entities/stock-master/__tests__/server.integration.test.ts`
Expected: PASS (5 tests) — DB 미가동이면 skip OK

- [ ] **Step 6: typecheck 통과 확인**

Run: `cd apps/dashboard && pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/src/entities/stock-master/
git commit -m "feat(stock-analysis): stock-master entity + searchStockMaster (한글/코드 검색)"
```

### Task 5.2: search 라우트 분기 추가

**Files:**
- Modify: `apps/dashboard/src/app/api/stock/search/route.ts`

- [ ] **Step 1: 현재 route.ts 내용 재확인**

Run:
```bash
cat apps/dashboard/src/app/api/stock/search/route.ts
```
Expected: 현재는 Yahoo 만 호출하는 짧은 라우트.

- [ ] **Step 2: 분기 로직 추가 — 파일 전체 교체**

`apps/dashboard/src/app/api/stock/search/route.ts` 전체:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/shared/lib/auth";
import { fetchYahooSearch } from "@gons/stock-analysis";
import { searchStockMaster } from "@/entities/stock-master/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 1) {
    return NextResponse.json({ results: [] });
  }

  // 한글 또는 6자리 숫자코드 → KRX 마스터 DB 검색 (Yahoo 한글 우회)
  const isHangul = /[가-힯]/.test(q);
  const isKrxCode = /^\d{6}$/.test(q);
  if (isHangul || isKrxCode) {
    const results = await searchStockMaster(q);
    return NextResponse.json({ results });
  }

  // 영문/티커 → 기존 Yahoo 경로 (US/Crypto/Commodity)
  try {
    const results = await fetchYahooSearch(q);
    return NextResponse.json({ results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { error: "Yahoo search failed", detail: msg },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 3: typecheck + lint + build 통과 확인**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/app/api/stock/search/route.ts
git commit -m "feat(stock-analysis): /api/stock/search 한글/6자리코드 분기 추가"
```

---

## Phase 6: 배포 + 운영 시드 + 검증

### Task 6.1: PR 생성 + CI

- [ ] **Step 1: 브랜치 생성 + push**

```bash
git checkout -b feat/krx-symbol-master-db
git push -u origin feat/krx-symbol-master-db
```

- [ ] **Step 2: PR 생성**

```bash
gh pr create --title "feat(stock-analysis): KRX 종목 마스터 DB (v1.1)" --body "$(cat <<'EOF'
## Summary

한글 종목 검색을 정적 맵 50개 → 공공데이터포털 KRX API 시드 ~4,000 종목으로 확장.

## 변경 사항

- 신규 테이블: \`stock_master\`, \`stock_symbol_migrations\` (pg_trgm GIN 인덱스)
- 신규 cron: \`POST /api/cron/krx-master-sync\` (일요일 06:00 KST)
- 신규 FSD: \`entities/stock-master\`, \`features/krx-master-sync\`
- 수정: \`/api/stock/search\` 한글/6자리코드 분기 추가
- 신규 env: \`KRX_DATA_GO_KR_API_KEY\`

## Test plan

- [x] Phase 1: env Zod + 스키마 + pg_trgm 마이그레이션
- [x] Phase 2: Zod / symbol-mapping / fetch (단위 테스트)
- [x] Phase 3: reconcile (통합 4분기 테스트) + sync orchestrator
- [x] Phase 4: cron 라우트 + scheduler
- [x] Phase 5: 검색 entity + 라우트 분기
- [ ] 배포 후: 운영 .env 갱신 → 마이그레이션 적용 → 수동 cron 트리거 → DB 시드 확인 → 브라우저 E2E (\"주성엔지니어링\")

Spec: \`docs/superpowers/specs/2026-05-21-krx-symbol-master-db-design.md\`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: CI watch**

Run: `gh pr checks --watch --interval 15`
Expected: Lint & Type Check + Build & Push Docker Images 모두 PASS

### Task 6.2: 운영 배포 + 마이그레이션

- [ ] **Step 1: PR 머지**

```bash
gh pr merge --squash --delete-branch
git checkout main && git pull --ff-only
```

- [ ] **Step 2: main 의 Build & Push 워크플로 대기**

Run: `gh run list --branch main --limit 1` 으로 run ID 확인 후 `gh run watch <ID>`.

- [ ] **Step 3: 운영 .env 에 KRX_DATA_GO_KR_API_KEY 추가**

운영 서버 .env (`/home/gon/projects/gon/gons-dashboard/.env`) 에 다음 한 줄 추가:

```bash
KRX_DATA_GO_KR_API_KEY=<사용자_발급_키>
```

(시크릿 — 대화에 평문 노출 금지. 사용자에게 ssh 직접 추가 요청.)

- [ ] **Step 4: app + cron 컨테이너 교체**

```bash
COMPOSE=/home/gon/projects/gon/gons-dashboard/docker-compose.yml
docker --context home-server compose -f $COMPOSE pull app cron
docker --context home-server compose -f $COMPOSE up -d app cron
```

- [ ] **Step 5: DB 마이그레이션 적용**

dashboard 컨테이너 안에서:

```bash
docker --context home-server exec gons-dashboard-app sh -c "cd apps/dashboard && pnpm db:migrate"
```

Expected: `0XXX_*.sql` 적용 + `stock_master` / `stock_symbol_migrations` 테이블 생성 + pg_trgm extension 활성화.

검증:
```bash
ssh gon@192.168.0.5 "docker exec gons-dashboard-postgres psql -U gons gons_dashboard -c '\\dt stock_*'"
```
Expected: stock_master, stock_symbol_migrations 포함.

- [ ] **Step 6: health 확인**

Run: `curl -s https://gons.krdn.kr/api/health`
Expected: `{"status":"ok",...}`

### Task 6.3: 첫 cron 수동 트리거 + 시드 검증

- [ ] **Step 1: 수동 트리거**

```bash
CRON_TOKEN=$(ssh gon@192.168.0.5 "sudo grep '^CRON_BEARER_TOKEN=' /home/gon/projects/gon/gons-dashboard/.env | cut -d= -f2-")
curl -X POST https://gons.krdn.kr/api/cron/krx-master-sync \
  -H "authorization: Bearer $CRON_TOKEN"
```
Expected: `{"ok":true,"fetched":3500-4000,"upserted":3500-4000,"delisted":0,"migrations":0,"durationMs":...}`

- [ ] **Step 2: DB 시드 확인**

```bash
ssh gon@192.168.0.5 "docker exec gons-dashboard-postgres psql -U gons gons_dashboard -c \"
  SELECT COUNT(*) FROM stock_master WHERE delisted = false;
  SELECT symbol, korean_name, market_category FROM stock_master WHERE korean_name LIKE '%주성%';
\""
```
Expected:
- COUNT(*) ≥ 3,500
- 주성엔지니어링 → 036930.KQ KOSDAQ

- [ ] **Step 3: 브라우저 E2E (사용자 안내)**

사용자 단계:
1. https://gons.krdn.kr 로그인 → 포트폴리오 설정 모달
2. "주성엔지니어링" 타이핑 → dropdown 결과 확인
3. 선택 → 수량 입력 → 추가 → portfolio 테이블 row 생성
4. 메인 대시보드 → 분석 카드 lazy fetch → 합의 결과 표시 확인

- [ ] **Step 4: Phase 6 완료 보고**

사용자 E2E 확인 완료 시 Phase 6 commit log 정리.

---

## Phase 7: 정적 맵 폐지 (별도 cleanup PR — 시드 1주 운영 후)

### Task 7.1: krx-symbols.ts + yahoo.ts 한글 분기 제거

**Files:**
- Delete: `packages/stock-analysis/src/adapters/krx-symbols.ts`
- Modify: `packages/stock-analysis/src/adapters/yahoo.ts`
- Modify: `packages/stock-analysis/tests/yahoo.test.ts`

> **전제 조건**: Phase 6 의 첫 cron 시드 후 최소 1주 운영, 한글 검색이 운영에서 정상 동작함이 확인되어야 함.

- [ ] **Step 1: yahoo.ts 의 한글 분기 + import 삭제**

`packages/stock-analysis/src/adapters/yahoo.ts` 수정 — 다음 import 삭제:

```ts
// 삭제할 라인:
import { searchKrxSymbols, isHangul } from "./krx-symbols";
```

`fetchYahooSearch` 함수 안에서 한글 분기 블록 통째 삭제:

```ts
// 삭제할 블록:
if (isHangul(trimmed)) {
  return searchKrxSymbols(trimmed);
}
```

- [ ] **Step 2: krx-symbols.ts 파일 삭제**

```bash
rm packages/stock-analysis/src/adapters/krx-symbols.ts
```

- [ ] **Step 3: yahoo.test.ts 에서 KRX 관련 테스트 삭제**

`packages/stock-analysis/tests/yahoo.test.ts` 에서:
- `import { isHangul, searchKrxSymbols } from "../src/adapters/krx-symbols";` 라인 삭제
- `describe("isHangul / searchKrxSymbols", ...)` 블록 통째 삭제
- `describe("fetchYahooSearch — 한글 분기 (로컬 폴백)", ...)` 블록 통째 삭제

- [ ] **Step 4: 패키지 테스트 실행 — 통과 확인**

Run: `pnpm --filter @gons/stock-analysis test`
Expected: 모든 테스트 PASS (KRX 관련 7개 사라지고 나머지 34개 통과)

- [ ] **Step 5: dashboard typecheck + lint + build 통과 확인**

Run: `cd apps/dashboard && pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS

- [ ] **Step 6: Commit + PR**

```bash
git checkout -b chore/remove-krx-static-map
git add -A packages/stock-analysis/
git commit -m "chore(stock-analysis): KRX 정적 맵 폐지 (DB 마스터로 대체)"
git push -u origin chore/remove-krx-static-map
gh pr create --title "chore(stock-analysis): KRX 정적 맵 폐지" --body "Phase 7 cleanup. Phase 6 시드 1주 운영 후 진행. 한글 검색은 stock_master DB ILIKE 가 담당."
```

---

## Self-Review

**1. Spec coverage**:

| Spec 섹션 | Plan task |
|-----------|-----------|
| §2 결정 요약 | Phase 1-6 전반 |
| §3.1 데이터 흐름 | Task 3.2 (orchestrator), 4.1 (cron), 5.2 (search 분기) |
| §3.2 FSD 슬라이스 | Task 2.1/2.2/2.3/3.1/3.2 (features), 5.1 (entities) |
| §3.3 폐지 코드 | Phase 7 |
| §4.1 stock_master | Task 1.2 |
| §4.2 stock_symbol_migrations | Task 1.2 |
| §4.3 pg_trgm | Task 1.2 Step 5 |
| §5.1 cron 라우트 | Task 4.1 |
| §5.2 scheduler | Task 4.1 Step 3 |
| §5.3 search 라우트 | Task 5.2 |
| §5.4 reconcile | Task 3.1 |
| §5.5 검색 함수 | Task 5.1 |
| §6 에러 처리 | Task 2.3 (fetch errors), 3.1 (reconcile try/catch), 4.1 (route 500) |
| §7 테스트 전략 | Task 2.1/2.2/2.3 (단위), 3.1/5.1 (통합) |
| §11 env 추가 | Task 1.1 |
| §12 Phase 분해 | Phase 1-7 |

모든 spec 섹션이 task 로 매핑됨.

**2. Placeholder scan**: "TBD" / "TODO" / "implement later" 검색 → 없음. 모든 step 에 코드/명령 명시.

**3. Type consistency**:
- `ReconcileInput` (Task 3.1) ↔ `syncKrxMaster` 의 `rows: ReconcileInput[]` (Task 3.2) ↔ `reconcileStockMaster` 호출 — 동일 타입
- `SyncResult` (Task 3.2) ↔ cron route 응답 (Task 4.1) — 일관
- `NormalizedSearchResult` (entities/stock-master/server.ts) ↔ existing `@gons/stock-analysis` 패키지 import — 동일 타입
- `securityType` enum: `"EQUITY" | "ETF" | "ETN" | "REIT" | "SPAC"` — symbol-mapping.ts, reconcile.ts, schema comment 일치

이슈 없음.
