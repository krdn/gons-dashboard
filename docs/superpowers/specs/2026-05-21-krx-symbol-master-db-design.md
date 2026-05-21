# KRX 종목 마스터 DB — Design Spec

**Date**: 2026-05-21
**Status**: Approved (브레인스토밍 단계 완료, 구현 plan 작성 예정)
**Owner**: gon
**Related**: PR #113 (한글 검색 정적 맵 hotfix), `docs/superpowers/specs/2026-05-21-stock-analysis-widget-design.md` (v1.0 위젯 spec)

---

## 1. 문제 정의

증권종목 분석 위젯의 한글 종목 검색이 **하드코딩된 50종목 정적 맵**(`packages/stock-analysis/src/adapters/krx-symbols.ts`)에만 의존한다.

**증상**:
- 사용자가 포트폴리오에 "주성엔지니어링" 같은 KOSDAQ 중소형주를 추가하려 하면 검색 결과 0건.
- 신규 종목 누락마다 PR + CI + 배포 필요 → 운영 부담.

**근본 원인**:
- Yahoo Finance `v1/finance/search` 가 한글 쿼리를 헤더/region/lang 무관하게 거부 (`"Invalid Search Query"`).
- PR #113 이 advisor 권고로 우회 fix(정적 맵 50개)를 했으나 본질 해결은 v1.1 후속으로 명시.

**해결 방향**: 공공데이터포털 KRX API로 KOSPI+KOSDAQ+ETF/ETN/리츠 전 종목(~4,000)을 주 1회 cron 으로 DB 시드 → 한글/코드 검색은 DB ILIKE로 즉시 응답.

## 2. 결정 요약

| 항목 | 결정 | 근거 |
|------|------|------|
| 검색 범위 | KOSPI + KOSDAQ + ETF/ETN/리츠 (~3,500–4,000) | 포트폴리오에 ETF 포함 계획 |
| 데이터 출처 | 공공데이터포털 `data.go.kr` "주식시세정보" API | 공식, 무료, 사용자 키 발급 완료 |
| 갱신 주기 | 주 1회 일요일 06:00 KST cron | 신규 상장은 평균 주 단위, 일일 한도(1,000) 의 1% 사용 |
| 검색 알고리즘 | PostgreSQL ILIKE + `pg_trgm` GIN 인덱스, 6자리 코드 정확 매칭 | 4,000 row 규모에서 <5ms |
| Fallback 전략 | DB-only (cron 실패 시 마지막 시드 유지) | 단순·안정. Yahoo 영문 fallback 은 inconsistency 만 추가 |
| Yahoo 심볼 매핑 | API `marketCategory` 기준 자동 조합 (KOSPI→`.KS`, KOSDAQ→`.KQ`) | 응답에 포함된 필드. 이전상장은 cron 이 다음 주에 잡음 |
| 이전상장 처리 | reconcile 자동 UPDATE + audit log | 사용자 portfolio 데이터가 stale 되지 않도록 |

## 3. 아키텍처

### 3.1 데이터 흐름

```
[scheduler.js: cron("0 6 * * 0", TZ=Asia/Seoul)]
        │
        ▼
POST /api/cron/krx-master-sync  (Bearer CRON_BEARER_TOKEN)
        │
        ▼
features/krx-master-sync/api/sync.ts
        │
        ├─► fetch-data-go-kr.ts   페이지네이션 (10 페이지 × ~400 row)
        │   └─► Zod 검증 (model/schema.ts)
        │
        ├─► symbol-mapping.ts     marketCategory → ".KS"/".KQ"
        │
        └─► reconcile.ts          이전상장 감지 + portfolio_holdings UPDATE
                │
                ▼
        [DB transaction]
        ├─ INSERT/UPDATE stock_master
        ├─ UPDATE portfolio_holdings (이전상장 시)
        ├─ DELETE stock_analysis_cache (이전상장 시)
        └─ INSERT stock_symbol_migrations (audit log)
        │
        ▼
응답: { fetched, upserted, delisted, migrations, durationMs }


[사용자 입력 "주성엔지니어링"]
        │
        ▼
GET /api/stock/search?q=주성엔지니어링  (기존 라우트)
        │
        ▼
isHangul(q) || /^\d{6}$/.test(q.trim())
        │
        ├─ true → entities/stock-master/server.ts: searchStockMaster()
        │         └─ stock_master ILIKE '%주성%' WHERE delisted=false LIMIT 10
        │
        └─ false → fetchYahooSearch(q)  (영문/티커, 기존 경로)
        │
        ▼
응답: { results: NormalizedSearchResult[] }
```

### 3.2 FSD 슬라이스 분해

```
apps/dashboard/src/
├── entities/stock-master/
│   ├── server.ts                  # getStockMaster, searchStockMaster
│   ├── model/types.ts             # StockMasterRow 타입
│   └── (index.ts 없음 — server-only entity, client tree 진입 차단)
│
├── features/krx-master-sync/
│   ├── api/
│   │   ├── sync.ts                # syncKrxMaster 전체 orchestrator
│   │   ├── fetch-data-go-kr.ts    # 페이지네이션 fetch
│   │   └── reconcile.ts           # 이전상장 감지 + cascade UPDATE
│   ├── model/schema.ts            # Zod: data.go.kr 응답 검증
│   └── lib/
│       └── symbol-mapping.ts      # marketCategory → .KS/.KQ
│
└── app/api/cron/krx-master-sync/route.ts
```

### 3.3 폐지되는 코드

| 경로 | 처리 |
|------|------|
| `packages/stock-analysis/src/adapters/krx-symbols.ts` | DB 시드 1회 성공 후 삭제 |
| `packages/stock-analysis/src/adapters/yahoo.ts` 의 `isHangul` 분기 | search 라우트 레벨로 이동, 함수 자체는 stock-master entity 로 |
| `packages/stock-analysis/tests/yahoo.test.ts` 의 `isHangul`, `searchKrxSymbols` describe | 통째 삭제 |

폐지는 **DB 시드가 운영에서 정상 동작함이 확인된 PR 이후**에 별도 cleanup PR 로 분리.

## 4. DB 스키마

### 4.1 `stock_master`

종목 마스터. cron 이 주 1회 upsert.

```ts
// shared/lib/db/schema.ts
export const stockMaster = pgTable(
  "stock_master",
  {
    symbol: varchar("symbol", { length: 32 }).primaryKey(),       // "005930.KS"
    krxCode: varchar("krx_code", { length: 6 }).notNull(),         // "005930"
    koreanName: varchar("korean_name", { length: 100 }).notNull(), // "삼성전자"
    englishName: varchar("english_name", { length: 200 }),         // "Samsung Electronics Co Ltd"
    marketCategory: varchar("market_category", { length: 16 }).notNull(), // "KOSPI" | "KOSDAQ"
    securityType: varchar("security_type", { length: 16 }).notNull(),     // "EQUITY"|"ETF"|"ETN"|"REIT"|"SPAC"
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
    delisted: boolean("delisted").notNull().default(false),
  },
  (t) => [
    index("stock_master_krx_code_idx").on(t.krxCode),
    index("stock_master_korean_name_trgm_idx")
      .using("gin", sql`${t.koreanName} gin_trgm_ops`),
    index("stock_master_market_active_idx").on(t.marketCategory, t.delisted),
  ],
);
```

### 4.2 `stock_symbol_migrations`

이전상장 회수 audit log.

```ts
export const stockSymbolMigrations = pgTable(
  "stock_symbol_migrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    krxCode: varchar("krx_code", { length: 6 }).notNull(),
    fromSymbol: varchar("from_symbol", { length: 32 }).notNull(), // "066970.KQ"
    toSymbol: varchar("to_symbol", { length: 32 }).notNull(),     // "066970.KS"
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    affectedHoldings: integer("affected_holdings").notNull().default(0),
    invalidatedCacheRows: integer("invalidated_cache_rows").notNull().default(0),
  },
  (t) => [index("stock_symbol_migrations_detected_idx").on(t.detectedAt.desc())],
);
```

### 4.3 마이그레이션 사전 조건

`pg_trgm` extension 활성화. 운영 postgres 컨테이너는 superuser 로 부팅되므로 멱등 명령 가능:

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

Drizzle 마이그레이션 시작 시 raw SQL 로 실행.

## 5. 컴포넌트 상세

### 5.1 cron 라우트 — `apps/dashboard/src/app/api/cron/krx-master-sync/route.ts`

```ts
import "server-only";
import { NextResponse } from "next/server";
import { syncKrxMaster } from "@/features/krx-master-sync/api/sync";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_BEARER_TOKEN}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const result = await syncKrxMaster();
  return NextResponse.json(result);
}
```

응답 구조:

```ts
type SyncResult = {
  fetched: number;        // API 에서 받은 전체 row
  upserted: number;       // INSERT + UPDATE 합계
  delisted: number;       // 이번 sync 에 없던 → delisted=true 전환
  migrations: number;     // 이전상장 감지 건수
  durationMs: number;
  errors: string[];       // 부분 실패 (per-page) 로그
};
```

### 5.2 scheduler 추가 — `apps/cron/scheduler.js`

```js
// 매주 일요일 06:00 KST — KRX 종목 마스터 갱신
cron.schedule(
  "0 6 * * 0",
  () => { void callCron("/api/cron/krx-master-sync", "krx-master-sync"); },
  { timezone: TIMEZONE },
);
```

### 5.3 검색 라우트 수정 — `apps/dashboard/src/app/api/stock/search/route.ts`

```ts
import { searchStockMaster } from "@/entities/stock-master/server";
import { fetchYahooSearch } from "@gons/stock-analysis";

const q = (searchParams.get("q") ?? "").trim();
if (q.length < 1) return NextResponse.json({ results: [] });

const isHangul = /[가-힯]/.test(q);
const isKrxCode = /^\d{6}$/.test(q);

if (isHangul || isKrxCode) {
  const results = await searchStockMaster(q);
  return NextResponse.json({ results });
}

// 영문/티커 → 기존 Yahoo 경로 (US/Crypto/Commodity)
const results = await fetchYahooSearch(q);
return NextResponse.json({ results });
```

### 5.4 reconcile 로직 (핵심)

```ts
// features/krx-master-sync/api/reconcile.ts
for (const apiRow of fetchedRows) {
  const existing = await db.query.stockMaster.findFirst({
    where: and(
      eq(stockMaster.krxCode, apiRow.krxCode),
      eq(stockMaster.delisted, false),
    ),
  });

  if (!existing) {
    // 신규 상장
    await db.insert(stockMaster).values(apiRow);
    continue;
  }

  if (existing.symbol === apiRow.symbol) {
    // 변경 없음 — lastSyncedAt 갱신
    await db.update(stockMaster)
      .set({ ...apiRow, lastSyncedAt: new Date() })
      .where(eq(stockMaster.symbol, apiRow.symbol));
    continue;
  }

  // 이전상장 감지 (.KQ → .KS 등)
  await db.transaction(async (tx) => {
    await tx.insert(stockMaster).values(apiRow);
    const updated = await tx.update(portfolioHoldings)
      .set({ symbol: apiRow.symbol })
      .where(eq(portfolioHoldings.symbol, existing.symbol))
      .returning();
    const invalidated = await tx.delete(stockAnalysisCache)
      .where(eq(stockAnalysisCache.symbol, existing.symbol))
      .returning();
    await tx.insert(stockSymbolMigrations).values({
      krxCode: apiRow.krxCode,
      fromSymbol: existing.symbol,
      toSymbol: apiRow.symbol,
      affectedHoldings: updated.length,
      invalidatedCacheRows: invalidated.length,
    });
    await tx.update(stockMaster)
      .set({ delisted: true })
      .where(eq(stockMaster.symbol, existing.symbol));
  });
}

// 응답에 없던 active row 는 delisted=true (상장폐지 감지)
const fetchedKrxCodes = new Set(fetchedRows.map((r) => r.krxCode));
await db.update(stockMaster)
  .set({ delisted: true })
  .where(
    and(
      eq(stockMaster.delisted, false),
      notInArray(stockMaster.krxCode, [...fetchedKrxCodes]),
    ),
  );
```

### 5.5 검색 함수 — `entities/stock-master/server.ts`

```ts
import "server-only";
import { db } from "@/shared/lib/db/client";
import { stockMaster } from "@/shared/lib/db/schema";
import { and, eq, ilike, sql } from "drizzle-orm";
import type { NormalizedSearchResult } from "@gons/stock-analysis";

export async function searchStockMaster(q: string): Promise<NormalizedSearchResult[]> {
  const trimmed = q.trim();
  if (trimmed.length === 0) return [];

  const isKrxCode = /^\d{6}$/.test(trimmed);
  const rows = await db
    .select()
    .from(stockMaster)
    .where(
      and(
        eq(stockMaster.delisted, false),
        isKrxCode
          ? eq(stockMaster.krxCode, trimmed)
          : ilike(stockMaster.koreanName, `%${trimmed}%`),
      ),
    )
    .limit(10);

  return rows.map((r) => ({
    symbol: r.symbol,
    displayName: r.koreanName,
    assetClass: "stock",
    market: "KRX",
    exchange: r.marketCategory === "KOSPI" ? "KSE" : "KOSDAQ",
  }));
}
```

## 6. 에러 처리

| 시나리오 | 처리 |
|----------|------|
| `data.go.kr` API 키 만료 (401) | 응답 `{ ok: false, error: "AUTH" }`, ops 알림 (`OPS_NOTIFY_EMAIL`) |
| 일일 호출 한도(1,000회) 초과 | 응답 감지 → 다음 일요일까지 대기 (정상 사용량은 주 10회로 한도의 1%) |
| 페이지네이션 중 일부 실패 | 부분 성공 허용 → `errors[]` 에 기록, 다음 cron 에서 보강 |
| Zod 검증 실패 (스키마 변경) | 첫 row 실패 시 abort + 전체 sync 롤백 |
| 네트워크 timeout | 전체 60s, per-page 10s |
| reconcile 트랜잭션 실패 | per-row try/catch — 한 종목 실패해도 나머지 진행 |
| pg_trgm 미설치 | 마이그레이션 시작 시 `CREATE EXTENSION IF NOT EXISTS pg_trgm` 멱등 실행 |

## 7. 테스트 전략

| 레이어 | 도구 | 케이스 |
|--------|------|--------|
| Zod 스키마 | vitest | API 응답 fixture 3-4개 (정상/필드 누락/타입 mismatch) |
| `fetch-data-go-kr` | vitest + mock fetch | 페이지네이션 종료 조건, 빈 응답, 401, timeout |
| `symbol-mapping` | vitest | KOSPI→.KS, KOSDAQ→.KQ, 알 수 없는 marketCategory→null |
| `reconcile` | vitest + 통합 DB | 신규/변경없음/이전상장/상장폐지 4가지 분기 |
| `searchStockMaster` | vitest + 통합 DB | 한글 substring, 6자리 코드, delisted 제외, limit 10 |
| cron 라우트 | 통합 테스트 | Bearer 인증, 응답 구조 |

통합 테스트는 기존 `TEST_DATABASE_URL` 패턴 사용 (`CLAUDE.md` Gotcha #2).

## 8. 비용 / 성능

| 항목 | 추정 |
|------|------|
| 일요일 cron 소요 시간 | ~15s (페이지네이션 10회 + DB upsert) |
| DB 추가 크기 | stock_master 4,000 row × ~200 bytes + GIN 인덱스 ≈ **~1.3MB** |
| pg_trgm GIN 검색 (`ILIKE '%주성%'`) | <5ms |
| data.go.kr 일일 호출 | 1회/주 × 10페이지 = **주당 10회** (한도의 1%) |
| LLM/외부 API 비용 | **0** (data.go.kr 무료) |

## 9. 리스크 + 완화

| 리스크 | 완화 |
|--------|------|
| data.go.kr API 키 만료 (1년 주기) | ops 알림 + 키 갱신 절차 `docs/RUNBOOK.md` 추가 |
| API 응답 스키마 변경 | Zod fail-fast + 첫 row 실패 시 전체 abort |
| 한글 동음이의 (예: "삼성" → 5개) | UI 에서 종목코드/거래소 부착 (기존 `TickerSearchInput` 그대로 동작) |
| krxCode 재발급 false positive | KRX 규정상 6자리 코드 영구 보장. 안전. |
| ETF 자체청산 후 같은 코드 재사용 | 사례 희박. koreanName 일치 추가 검증으로 완화. |
| pg_trgm 권한 부족 | 운영 postgres 컨테이너 superuser 부팅 (확인됨) |

## 10. Out of Scope (v1.0)

- 종목명 외 펀더멘털 필터 (PER/PBR 기준 추천)
- 즐겨찾기 / 최근 검색
- 외국인 보유율 / 기관 매매 메타데이터
- 한자명/일본어명 매칭
- 종목 비교 차트
- 자동완성 ranking 가중치 (substring + 시가총액 desc 정도면 충분)

## 11. 환경 변수 추가

`.env.example` 및 운영 `.env` 에:

```bash
# 공공데이터포털 KRX "주식시세정보" API 키. 발급: https://www.data.go.kr/
KRX_DATA_GO_KR_API_KEY=
```

`shared/config/env.ts` Zod 스키마에 추가 — required string.

## 12. 출시 범위 + Phase 분해 (제안)

| Phase | 내용 | 검증 |
|-------|------|------|
| 1 | DB 스키마 + pg_trgm 마이그레이션 | typecheck + migration 적용 + 운영 DB 검증 |
| 2 | data.go.kr API 어댑터 + Zod | 단위 테스트, fixture 기반 |
| 3 | sync orchestrator + reconcile | 통합 테스트 (4가지 분기) |
| 4 | cron 라우트 + scheduler 등록 | 운영 1회 수동 트리거 + 응답 확인 |
| 5 | 검색 entity + 라우트 수정 | E2E: "주성엔지니어링" → 결과 표시 → 종목 추가 |
| 6 | 정적 맵 폐지 (cleanup PR) | 시드 1주 운영 후 별도 PR |

각 Phase 는 별도 PR. Phase 1-5 는 한 번에 머지해도 무방 (cron 첫 실행이 검색 활성화 시점).

## 13. CLAUDE.md Gotcha 후보

DB 시드 1주 운영 후 검증되면 `CLAUDE.md` "Gotcha" 섹션에 추가:

- 종목 검색은 한글/코드 → DB, 영문/티커 → Yahoo. 분기 기준은 `isHangul || /^\d{6}$/`.
- 이전상장은 주 1회 cron 이 잡으므로 사용자 수동 조치 불필요.
- 신규 ETF/종목 누락 시 cron 수동 트리거 (`POST /api/cron/krx-master-sync` Bearer 인증) 로 즉시 반영 가능.
