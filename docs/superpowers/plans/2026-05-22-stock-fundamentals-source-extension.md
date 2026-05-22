# Stock Analysis DART 펀더멘털 Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** KR 종목의 PBR + 배당수익률 + trailing PER 갭을 DART 공시 trailing 4Q 재무로 자체 계산해 채우고, value/growth 페르소나가 정량 근거를 사용하도록 한다.

**Architecture:** Yahoo (yahoo-finance2) 펀더멘털은 그대로 유지. DART 어댑터를 packages/stock-analysis/src/adapters/dart.ts 에 추가. orchestrator 가 yahoo + DART 를 병렬 fetch 후 mergeSnapshot 헬퍼로 우선순위 머지 (DART trailingPER > yahoo forwardPE, DART 계산 PBR/배당 > yahoo null). prompt_version "v1.0" → "v2" bump 로 cache 자동 무효화. STOCK_FUNDAMENTALS_SOURCES=off 환경변수로 즉시 롤백 가능.

**Tech Stack:** TypeScript, Zod, Vitest, Drizzle ORM (Postgres), `adm-zip` (스크립트 전용 신규 의존성), 기존 yahoo-finance2/zod 유지.

**Related Spec:** `docs/superpowers/specs/2026-05-22-stock-fundamentals-source-extension-design.md`

**Branch:** `feat/stock-dart-fundamentals` (main 에서 새로 생성, PR #119/#120 위에 빌드)

---

## Task 1: 브랜치 생성 + adm-zip devDependency 추가

**Files:**
- Modify: `packages/stock-analysis/package.json`

- [ ] **Step 1: 최신 main pull + 새 브랜치 생성**

```bash
cd /home/gon/projects/gon/gons-dashboard
git checkout main && git pull
git checkout -b feat/stock-dart-fundamentals
```

Expected: "Switched to a new branch 'feat/stock-dart-fundamentals'"

- [ ] **Step 2: adm-zip 추가 (devDependency — 스크립트 전용)**

`packages/stock-analysis/package.json` 의 `devDependencies` 에 추가:

```json
"adm-zip": "^0.5.16",
"@types/adm-zip": "^0.5.7"
```

- [ ] **Step 3: 설치**

```bash
cd /home/gon/projects/gon/gons-dashboard
pnpm install
```

Expected: "+ adm-zip 0.5.x"

- [ ] **Step 4: typecheck 회귀 확인**

```bash
cd /home/gon/projects/gon/gons-dashboard/apps/dashboard && pnpm typecheck
```

Expected: 통과 (0 errors)

- [ ] **Step 5: Commit**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add packages/stock-analysis/package.json pnpm-lock.yaml
git commit -m "chore(stock-analysis): adm-zip devDependency (DART corpCode.xml unzip 용)"
```

---

## Task 2: DART corp_code bootstrap 생성 스크립트

**Files:**
- Create: `packages/stock-analysis/scripts/build-dart-corp-codes.ts`
- Create: `packages/stock-analysis/src/adapters/dart-corp-codes.json`

DART API 의 `corpCode.xml` ZIP 다운로드 → unzip → 6자리 KRX 코드가 있는 회사만 추출 → `{ "<6자리>": "<8자리>" }` JSON 으로 저장하는 1회용 스크립트.

- [ ] **Step 1: 디렉토리 + 파일 생성**

```bash
mkdir -p /home/gon/projects/gon/gons-dashboard/packages/stock-analysis/scripts
```

- [ ] **Step 2: 스크립트 작성**

Create `packages/stock-analysis/scripts/build-dart-corp-codes.ts`:

```ts
// 1회용: DART corpCode.xml 다운로드 → KRX 6자리 코드 매핑 JSON 생성.
// 운영 weekly cron 으로 교체하기 전 bootstrap.
// 실행: DART_OPENAPI_AUTH_KEY=xxx tsx packages/stock-analysis/scripts/build-dart-corp-codes.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import AdmZip from "adm-zip";

const DART_BASE = "https://opendart.fss.or.kr/api";

async function main() {
  const authKey = process.env.DART_OPENAPI_AUTH_KEY;
  if (!authKey) {
    console.error("DART_OPENAPI_AUTH_KEY 환경변수 필수");
    process.exit(1);
  }

  const url = `${DART_BASE}/corpCode.xml?crtfc_key=${encodeURIComponent(authKey)}`;
  console.log(`[1/4] DART corpCode.xml 다운로드: ${url.replace(authKey, "<key>")}`);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`HTTP ${res.status} ${res.statusText}`);
    process.exit(1);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  console.log(`[2/4] ZIP 수신: ${buffer.length} bytes`);

  const zip = new AdmZip(buffer);
  const entry = zip.getEntry("CORPCODE.xml");
  if (!entry) {
    console.error("CORPCODE.xml 항목이 ZIP 에 없음");
    process.exit(1);
  }
  const xml = entry.getData().toString("utf-8");
  console.log(`[3/4] XML 추출: ${xml.length} chars`);

  // 정규식 파싱 — 외부 XML 라이브러리 회피. <list> 블록 안에 corp_code + stock_code.
  const mapping: Record<string, string> = {};
  const listRegex = /<list>([\s\S]*?)<\/list>/g;
  let match: RegExpExecArray | null;
  let total = 0;
  let listed = 0;
  while ((match = listRegex.exec(xml)) !== null) {
    total += 1;
    const block = match[1];
    const corpMatch = block.match(/<corp_code>(\d{8})<\/corp_code>/);
    const stockMatch = block.match(/<stock_code>\s*([\dA-Z]{6})\s*<\/stock_code>/);
    if (!corpMatch || !stockMatch) continue;
    mapping[stockMatch[1]] = corpMatch[1];
    listed += 1;
  }
  console.log(`[4/4] 매핑 ${listed} / ${total} (KRX 상장 + corp_code 보유 회사만)`);

  const outPath = join(
    process.cwd(),
    "packages/stock-analysis/src/adapters/dart-corp-codes.json",
  );
  writeFileSync(outPath, JSON.stringify(mapping, null, 0));
  console.log(`✓ 저장: ${outPath} (${(JSON.stringify(mapping).length / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error("실패:", err);
  process.exit(1);
});
```

- [ ] **Step 3: 스크립트 실행 (운영 DART 키 사용)**

```bash
cd /home/gon/projects/gon/gons-dashboard
# 운영 .env 에서 키 추출 (운영 .env 가 있다면)
DART_OPENAPI_AUTH_KEY="$(ssh gon@192.168.0.5 'grep DART_OPENAPI_AUTH_KEY /home/gon/projects/gon/gons-dashboard/.env | cut -d= -f2-')" \
  pnpm tsx packages/stock-analysis/scripts/build-dart-corp-codes.ts
```

운영 키가 없으면 사용자가 DART 회원가입 후 발급한 키를 환경변수로 전달.

Expected:
```
[1/4] DART corpCode.xml 다운로드: ...
[2/4] ZIP 수신: ~3-5 MB
[3/4] XML 추출: ~30-50 MB chars
[4/4] 매핑 ~2700 / ~110000 (KRX 상장 + corp_code 보유 회사만)
✓ 저장: .../dart-corp-codes.json (~50-80 KB)
```

- [ ] **Step 4: 결과 spot check**

```bash
cd /home/gon/projects/gon/gons-dashboard
node -e "const m=require('./packages/stock-analysis/src/adapters/dart-corp-codes.json'); console.log({samsung:m['005930'], sk_hynix:m['000660'], naver:m['035420'], count:Object.keys(m).length})"
```

Expected: `{ samsung: '00126380', sk_hynix: '00164779', naver: '00266961', count: 2500+ }` (정확한 corp_code 값은 다를 수 있음)

- [ ] **Step 5: Commit (script + 생성된 JSON)**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add packages/stock-analysis/scripts/build-dart-corp-codes.ts \
        packages/stock-analysis/src/adapters/dart-corp-codes.json
git commit -m "feat(stock-analysis): DART corp_code bootstrap JSON + 생성 스크립트

KRX 6자리 → DART 8자리 corp_code 매핑. ZIP 다운로드 + XML 파싱 비용 회피용 정적 commit.
주 1회 갱신 cron 은 별도 PR."
```

---

## Task 3: DART 어댑터 타입 정의 (`dart-types.ts`)

**Files:**
- Create: `packages/stock-analysis/src/adapters/dart-types.ts`

DART API 의 raw 응답 + 정규화된 결과 타입.

- [ ] **Step 1: 파일 생성**

Create `packages/stock-analysis/src/adapters/dart-types.ts`:

```ts
// DART OpenDart 단일회사 주요계정 API 응답 타입.
// 출처: https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS003&apiId=AC00073

import { z } from "zod";

// 응답 상태 코드 (메시지 설명)
export const DART_STATUS = {
  OK: "000",
  NO_DATA: "013",
  RATE_LIMIT: "020",
  KEY_SUSPENDED: "010",
} as const;

// 단일 계정 항목
export const DartAccountItemSchema = z.object({
  rcept_no: z.string(),         // 접수번호 (14자리)
  reprt_code: z.string(),       // 보고서 코드 (11011/11012/11013/11014)
  bsns_year: z.string(),        // 사업연도 (4자리)
  corp_code: z.string(),        // 회사 고유번호 (8자리)
  stock_code: z.string().optional(),
  fs_div: z.enum(["CFS", "OFS"]).optional(), // 연결/별도
  fs_nm: z.string().optional(),
  sj_div: z.string().optional(),             // BS/IS/CIS/CF/SCE
  sj_nm: z.string().optional(),
  account_nm: z.string(),                    // 계정명 (매출액/영업이익/...)
  thstrm_nm: z.string().optional(),          // 당기명 (e.g. "제 57 기 3분기")
  thstrm_amount: z.string().optional(),      // 당기 금액 (쉼표 포함 문자열)
  thstrm_add_amount: z.string().optional(),  // 당기 누적 금액 (3분기까지 합)
  frmtrm_nm: z.string().optional(),          // 전기명
  frmtrm_amount: z.string().optional(),
  bfefrmtrm_amount: z.string().optional(),   // 전전기
  currency: z.string().optional(),
});
export type DartAccountItem = z.infer<typeof DartAccountItemSchema>;

export const DartResponseSchema = z.object({
  status: z.string(),
  message: z.string(),
  list: z.array(DartAccountItemSchema).optional(),
});
export type DartResponse = z.infer<typeof DartResponseSchema>;

// 보고서 코드 (분기 → reprt_code 변환)
export const REPORT_CODES = {
  Q1: "11013",
  HALF: "11012",       // 반기 (Q2 누적)
  Q3: "11014",
  ANNUAL: "11011",     // 사업보고서 (Q4 누적)
} as const;
export type ReportCode = (typeof REPORT_CODES)[keyof typeof REPORT_CODES];

// 정규화된 결과 (orchestrator 에 노출)
export interface DartFinancials {
  krxCode: string;
  corpCode: string;
  reportPeriod: string;           // "2025-Q3" 또는 "2024-사업보고서"
  revenueTrailing4Q: number | null;
  revenueGrowthYoY: number | null;   // %
  operatingProfitTrailing4Q: number | null;
  opMarginPct: number | null;         // %
  eps: number | null;                 // trailing EPS (원)
  bps: number | null;                 // 분기말 BPS (원)
  annualDPS: number | null;           // 연간 주당배당금 (원), 사업보고서에만 존재
  asOf: string;                       // YYYY-MM-DD (가장 최근 공시 접수일자 추정)
}

export class DartError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "DartError";
  }
}
```

- [ ] **Step 2: typecheck**

```bash
cd /home/gon/projects/gon/gons-dashboard/packages/stock-analysis && pnpm typecheck
```

Expected: 통과

- [ ] **Step 3: Commit**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add packages/stock-analysis/src/adapters/dart-types.ts
git commit -m "feat(stock-analysis): DART 응답 타입 + DartError 클래스 정의"
```

---

## Task 4: DART corp_code lookup (failing test → impl)

**Files:**
- Create: `packages/stock-analysis/src/adapters/dart-corp-lookup.ts`
- Create: `packages/stock-analysis/tests/dart-corp-lookup.test.ts`

bootstrap JSON 에서 6자리 KRX 코드를 받아 8자리 corp_code 반환. 누락 시 throw.

- [ ] **Step 1: failing test 작성**

Create `packages/stock-analysis/tests/dart-corp-lookup.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { lookupCorpCode } from "../src/adapters/dart-corp-lookup";
import { DartError } from "../src/adapters/dart-types";

describe("lookupCorpCode", () => {
  it("returns 8-digit corp_code for known KRX symbol (삼성전자)", () => {
    const corp = lookupCorpCode("005930");
    expect(corp).toMatch(/^\d{8}$/);
  });

  it("returns 8-digit corp_code for 035420 (NAVER)", () => {
    const corp = lookupCorpCode("035420");
    expect(corp).toMatch(/^\d{8}$/);
  });

  it("throws DartError for unknown code", () => {
    expect(() => lookupCorpCode("999999")).toThrow(DartError);
    expect(() => lookupCorpCode("999999")).toThrow(/not_listed_in_dart/);
  });

  it("throws DartError for malformed input", () => {
    expect(() => lookupCorpCode("12345")).toThrow(DartError);
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
cd /home/gon/projects/gon/gons-dashboard/packages/stock-analysis && pnpm test tests/dart-corp-lookup.test.ts
```

Expected: FAIL "Cannot find module '../src/adapters/dart-corp-lookup'"

- [ ] **Step 3: 구현**

Create `packages/stock-analysis/src/adapters/dart-corp-lookup.ts`:

```ts
import { DartError } from "./dart-types";
import corpCodes from "./dart-corp-codes.json" with { type: "json" };

// Type assertion — JSON import 의 record 타입은 추론 불충분.
const CORP_MAP = corpCodes as Record<string, string>;

const KRX_CODE_REGEX = /^[\dA-Z]{6}$/;

/**
 * KRX 6자리 (단축코드, 우선주 알파벳 포함) → DART 8자리 corp_code.
 * 누락 시 DartError("not_listed_in_dart") throw.
 */
export function lookupCorpCode(krxCode: string): string {
  if (!KRX_CODE_REGEX.test(krxCode)) {
    throw new DartError(`invalid_krx_code: ${krxCode}`);
  }
  const corp = CORP_MAP[krxCode];
  if (!corp) {
    throw new DartError(`not_listed_in_dart: ${krxCode}`);
  }
  return corp;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd /home/gon/projects/gon/gons-dashboard/packages/stock-analysis && pnpm test tests/dart-corp-lookup.test.ts
```

Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add packages/stock-analysis/src/adapters/dart-corp-lookup.ts \
        packages/stock-analysis/tests/dart-corp-lookup.test.ts
git commit -m "feat(stock-analysis): DART corp_code lookup + 테스트"
```

---

## Task 5: DART 어댑터 본체 — fetchDartFinancials (TDD)

**Files:**
- Create: `packages/stock-analysis/src/adapters/dart.ts`
- Create: `packages/stock-analysis/tests/dart.test.ts`
- Create: `packages/stock-analysis/tests/fixtures/dart-005930-Q3.json`
- Create: `packages/stock-analysis/tests/fixtures/dart-005930-business.json`
- Create: `packages/stock-analysis/tests/fixtures/dart-no-data.json`

가장 최근 가능한 분기 자동 탐지 → trailing 4Q 합산 → EPS/BPS/annualDPS 추출.

- [ ] **Step 1: fixture 캡처 (수동, 1회)**

운영 DART 키로 삼성전자 (corp_code=00126380) 사업보고서 + Q3 응답 1회 캡처:

```bash
cd /home/gon/projects/gon/gons-dashboard
mkdir -p packages/stock-analysis/tests/fixtures

KEY="$(ssh gon@192.168.0.5 'grep DART_OPENAPI_AUTH_KEY /home/gon/projects/gon/gons-dashboard/.env | cut -d= -f2-')"

# 2024 사업보고서 (annual, reprt_code=11011)
curl -s "https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?crtfc_key=$KEY&corp_code=00126380&bsns_year=2024&reprt_code=11011" \
  | jq . > packages/stock-analysis/tests/fixtures/dart-005930-business.json

# 2025 3분기 보고서 (Q3, reprt_code=11014)
curl -s "https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?crtfc_key=$KEY&corp_code=00126380&bsns_year=2025&reprt_code=11014" \
  | jq . > packages/stock-analysis/tests/fixtures/dart-005930-Q3.json

# 자료 없음 케이스 (미래 분기 — 응답이 status="013" 인 fixture)
curl -s "https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?crtfc_key=$KEY&corp_code=00126380&bsns_year=2027&reprt_code=11013" \
  | jq . > packages/stock-analysis/tests/fixtures/dart-no-data.json
```

키가 없으면 사용자가 수동 캡처 후 fixture 만 commit.

- [ ] **Step 2: failing test 작성**

Create `packages/stock-analysis/tests/dart.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchDartFinancials, _resetCircuitForTest } from "../src/adapters/dart";
import { DartError } from "../src/adapters/dart-types";

const FIXTURES = join(__dirname, "fixtures");

const ANNUAL = JSON.parse(readFileSync(join(FIXTURES, "dart-005930-business.json"), "utf-8"));
const Q3 = JSON.parse(readFileSync(join(FIXTURES, "dart-005930-Q3.json"), "utf-8"));
const NO_DATA = JSON.parse(readFileSync(join(FIXTURES, "dart-no-data.json"), "utf-8"));

function mockFetchResponses(responses: Array<{ status: number; body: unknown }>) {
  let call = 0;
  vi.spyOn(global, "fetch").mockImplementation(async () => {
    const r = responses[call] ?? responses[responses.length - 1];
    call += 1;
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
}

describe("fetchDartFinancials", () => {
  beforeEach(() => {
    _resetCircuitForTest();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns Q3 financials when Q3 report is available", async () => {
    mockFetchResponses([{ status: 200, body: Q3 }]);
    const result = await fetchDartFinancials("005930", "test-key");
    expect(result.krxCode).toBe("005930");
    expect(result.reportPeriod).toMatch(/^\d{4}-Q3$/);
    expect(result.eps).not.toBeNull();
    expect(result.bps).not.toBeNull();
    expect(result.revenueTrailing4Q).not.toBeNull();
  });

  it("falls back to ANNUAL when Q3 returns no-data", async () => {
    mockFetchResponses([
      { status: 200, body: NO_DATA },     // Q3 시도 → no data
      { status: 200, body: NO_DATA },     // 반기 시도 → no data
      { status: 200, body: NO_DATA },     // Q1 시도 → no data
      { status: 200, body: ANNUAL },      // 전년도 사업보고서 → hit
    ]);
    const result = await fetchDartFinancials("005930", "test-key");
    expect(result.reportPeriod).toMatch(/사업보고서$/);
    expect(result.eps).not.toBeNull();
  });

  it("throws DartError when corp_code not in bootstrap JSON", async () => {
    await expect(fetchDartFinancials("999999", "test-key")).rejects.toThrow(DartError);
    await expect(fetchDartFinancials("999999", "test-key")).rejects.toThrow(/not_listed_in_dart/);
  });

  it("throws DartError on status=020 (rate limit)", async () => {
    mockFetchResponses([{ status: 200, body: { status: "020", message: "요청 제한 초과" } }]);
    await expect(fetchDartFinancials("005930", "test-key")).rejects.toThrow(DartError);
  });

  it("opens circuit breaker after 5 consecutive failures", async () => {
    mockFetchResponses([{ status: 500, body: {} }]);
    for (let i = 0; i < 5; i++) {
      await expect(fetchDartFinancials("005930", "test-key")).rejects.toThrow();
    }
    // 6번째는 즉시 throw (network call 안 일어남)
    const fetchSpy = global.fetch as ReturnType<typeof vi.fn>;
    const callsBefore = fetchSpy.mock.calls.length;
    await expect(fetchDartFinancials("005930", "test-key")).rejects.toThrow(/circuit/);
    expect(fetchSpy.mock.calls.length).toBe(callsBefore);  // 호출 안 됨
  });
});
```

- [ ] **Step 3: 실패 확인**

```bash
cd /home/gon/projects/gon/gons-dashboard/packages/stock-analysis && pnpm test tests/dart.test.ts
```

Expected: FAIL "Cannot find module '../src/adapters/dart'"

- [ ] **Step 4: 구현**

Create `packages/stock-analysis/src/adapters/dart.ts`:

```ts
import {
  DartError,
  DartResponseSchema,
  REPORT_CODES,
  type DartAccountItem,
  type DartFinancials,
  type ReportCode,
} from "./dart-types";
import { lookupCorpCode } from "./dart-corp-lookup";

const DART_BASE = "https://opendart.fss.or.kr/api";
const TIMEOUT_MS = 8_000;
const CB_FAIL_THRESHOLD = 5;
const CB_COOLDOWN_MS = 30 * 60_000;

interface CircuitState {
  failures: number;
  openedAt: number | null;
}
const cbState: CircuitState = { failures: 0, openedAt: null };

export function _resetCircuitForTest(): void {
  cbState.failures = 0;
  cbState.openedAt = null;
}

interface ReportAttempt {
  year: number;
  reprt: ReportCode;
  label: string;          // "2025-Q3" 같은 reportPeriod 라벨
}

// 현재 시점에서 가장 최근 공시 가능 분기부터 거꾸로 탐색.
// 예: 2026-05 시점 → 2026-Q1 시도 → no data 면 2025-사업보고서, 2025-Q3, ...
function buildAttempts(now: Date = new Date()): ReportAttempt[] {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  let recent: ReportAttempt[];
  // 분기 공시 마감: Q1 (~5/15), 반기 (~8/15), Q3 (~11/15), 사업보고서 (~3/31).
  if (month <= 4) {
    // 작년 사업보고서 (3월말까지 공시) 또는 작년 Q3
    recent = [
      { year: year - 1, reprt: REPORT_CODES.ANNUAL, label: `${year - 1}-사업보고서` },
      { year: year - 1, reprt: REPORT_CODES.Q3, label: `${year - 1}-Q3` },
      { year: year - 1, reprt: REPORT_CODES.HALF, label: `${year - 1}-반기` },
      { year: year - 1, reprt: REPORT_CODES.Q1, label: `${year - 1}-Q1` },
    ];
  } else if (month <= 7) {
    recent = [
      { year, reprt: REPORT_CODES.Q1, label: `${year}-Q1` },
      { year: year - 1, reprt: REPORT_CODES.ANNUAL, label: `${year - 1}-사업보고서` },
      { year: year - 1, reprt: REPORT_CODES.Q3, label: `${year - 1}-Q3` },
      { year: year - 1, reprt: REPORT_CODES.HALF, label: `${year - 1}-반기` },
    ];
  } else if (month <= 10) {
    recent = [
      { year, reprt: REPORT_CODES.HALF, label: `${year}-반기` },
      { year, reprt: REPORT_CODES.Q1, label: `${year}-Q1` },
      { year: year - 1, reprt: REPORT_CODES.ANNUAL, label: `${year - 1}-사업보고서` },
      { year: year - 1, reprt: REPORT_CODES.Q3, label: `${year - 1}-Q3` },
    ];
  } else {
    recent = [
      { year, reprt: REPORT_CODES.Q3, label: `${year}-Q3` },
      { year, reprt: REPORT_CODES.HALF, label: `${year}-반기` },
      { year, reprt: REPORT_CODES.Q1, label: `${year}-Q1` },
      { year: year - 1, reprt: REPORT_CODES.ANNUAL, label: `${year - 1}-사업보고서` },
    ];
  }
  return recent;
}

async function fetchDartReport(
  corpCode: string,
  year: number,
  reprt: ReportCode,
  authKey: string,
): Promise<DartAccountItem[] | null> {
  const url =
    `${DART_BASE}/fnlttSinglAcnt.json?crtfc_key=${encodeURIComponent(authKey)}` +
    `&corp_code=${corpCode}&bsns_year=${year}&reprt_code=${reprt}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      throw new DartError(`HTTP ${res.status}`);
    }
    const json = await res.json();
    const parsed = DartResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new DartError(`schema mismatch: ${parsed.error.message.slice(0, 200)}`);
    }
    const data = parsed.data;
    if (data.status === "013") return null;             // no data → 다음 분기 시도
    if (data.status === "020") throw new DartError("rate_limited", "020");
    if (data.status === "010") throw new DartError("key_suspended", "010");
    if (data.status !== "000") throw new DartError(`dart_status_${data.status}: ${data.message}`, data.status);
    return data.list ?? [];
  } catch (err) {
    clearTimeout(timer);
    throw err instanceof DartError ? err : new DartError(String(err));
  }
}

// 숫자 추출: "85,090,000,000,000" → 85090000000000. 빈/이상 값은 null.
function parseAmount(s: string | undefined): number | null {
  if (!s) return null;
  const cleaned = s.replace(/,/g, "").trim();
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// 계정명 부분 매칭으로 항목 추출. fs_div=CFS (연결재무제표) 우선.
function pickAccount(
  items: DartAccountItem[],
  accountNamePatterns: string[],
): DartAccountItem | null {
  // 연결 우선
  for (const item of items) {
    if (item.fs_div !== "CFS") continue;
    for (const pat of accountNamePatterns) {
      if (item.account_nm.includes(pat)) return item;
    }
  }
  // 연결 없으면 별도
  for (const item of items) {
    if (item.fs_div === "CFS") continue;
    for (const pat of accountNamePatterns) {
      if (item.account_nm.includes(pat)) return item;
    }
  }
  return null;
}

// 단일 보고서에서 EPS/BPS/매출/영업이익 추출
interface ExtractedReport {
  revenue: number | null;
  operatingProfit: number | null;
  eps: number | null;
  bps: number | null;
  annualDPS: number | null;
}

function extractReportMetrics(items: DartAccountItem[], isAnnual: boolean): ExtractedReport {
  const revenueItem = pickAccount(items, ["매출액", "수익(매출액)"]);
  const opItem = pickAccount(items, ["영업이익"]);
  const epsItem = pickAccount(items, ["주당순이익", "주당순손실"]);
  const bpsItem = pickAccount(items, ["주당순자산", "주당장부가치"]);
  const dpsItem = isAnnual ? pickAccount(items, ["주당현금배당금"]) : null;

  // 매출/영업이익: 분기보고서는 누적(thstrm_add_amount), 사업보고서는 당기(thstrm_amount).
  const revenue = isAnnual
    ? parseAmount(revenueItem?.thstrm_amount)
    : parseAmount(revenueItem?.thstrm_add_amount ?? revenueItem?.thstrm_amount);
  const operatingProfit = isAnnual
    ? parseAmount(opItem?.thstrm_amount)
    : parseAmount(opItem?.thstrm_add_amount ?? opItem?.thstrm_amount);

  return {
    revenue,
    operatingProfit,
    eps: parseAmount(epsItem?.thstrm_amount),
    bps: parseAmount(bpsItem?.thstrm_amount),
    annualDPS: parseAmount(dpsItem?.thstrm_amount),
  };
}

function bumpCircuit(err: unknown): void {
  cbState.failures += 1;
  // status=010 (key suspended) 는 즉시 CB open
  if (err instanceof DartError && err.code === "010") {
    cbState.openedAt = Date.now();
    return;
  }
  if (cbState.failures >= CB_FAIL_THRESHOLD) {
    cbState.openedAt = Date.now();
  }
}

function resetCircuit(): void {
  cbState.failures = 0;
  cbState.openedAt = null;
}

export async function fetchDartFinancials(
  krxCode: string,
  authKey: string,
): Promise<DartFinancials> {
  // CB open 체크 (lookupCorpCode 실패 전에 — corp_code 미존재는 정상 케이스라 CB 대상 아님)
  if (cbState.openedAt && Date.now() - cbState.openedAt < CB_COOLDOWN_MS) {
    throw new DartError("circuit_breaker_open");
  }
  if (cbState.openedAt && Date.now() - cbState.openedAt >= CB_COOLDOWN_MS) {
    // half-open
    resetCircuit();
  }

  // corp_code lookup — 누락은 CB 와 무관 (DartError throw, orchestrator 가 null 처리)
  const corpCode = lookupCorpCode(krxCode);

  // 분기 순회: 첫 hit 사용
  const attempts = buildAttempts();
  let chosenItems: DartAccountItem[] | null = null;
  let chosenLabel = "";
  let isAnnual = false;
  for (const att of attempts) {
    try {
      const items = await fetchDartReport(corpCode, att.year, att.reprt, authKey);
      if (items && items.length > 0) {
        chosenItems = items;
        chosenLabel = att.label;
        isAnnual = att.reprt === REPORT_CODES.ANNUAL;
        break;
      }
    } catch (err) {
      bumpCircuit(err);
      throw err;
    }
  }

  if (!chosenItems) {
    // 모든 분기 no-data — 외국법인 등. CB 영향 없음 (서버 정상 응답).
    throw new DartError("no_report_available");
  }

  const metrics = extractReportMetrics(chosenItems, isAnnual);

  // YoY: 같은 보고서의 frmtrm_amount 와 비교
  const revenueItem = pickAccount(chosenItems, ["매출액", "수익(매출액)"]);
  const prevRevenue = isAnnual
    ? parseAmount(revenueItem?.frmtrm_amount)
    : parseAmount(revenueItem?.frmtrm_amount);  // 분기보고서의 frmtrm_amount 도 누적값
  const revenueGrowthYoY =
    metrics.revenue != null && prevRevenue != null && prevRevenue !== 0
      ? ((metrics.revenue - prevRevenue) / prevRevenue) * 100
      : null;

  const opMarginPct =
    metrics.revenue != null && metrics.operatingProfit != null && metrics.revenue !== 0
      ? (metrics.operatingProfit / metrics.revenue) * 100
      : null;

  resetCircuit();  // 성공

  return {
    krxCode,
    corpCode,
    reportPeriod: chosenLabel,
    revenueTrailing4Q: metrics.revenue,                  // 분기 누적 또는 사업보고서 연간
    revenueGrowthYoY,
    operatingProfitTrailing4Q: metrics.operatingProfit,
    opMarginPct,
    eps: metrics.eps,
    bps: metrics.bps,
    annualDPS: metrics.annualDPS,
    asOf: new Date().toISOString().slice(0, 10),
  };
}
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
cd /home/gon/projects/gon/gons-dashboard/packages/stock-analysis && pnpm test tests/dart.test.ts
```

Expected: 5 passed

- [ ] **Step 6: Commit**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add packages/stock-analysis/src/adapters/dart.ts \
        packages/stock-analysis/tests/dart.test.ts \
        packages/stock-analysis/tests/fixtures/dart-005930-Q3.json \
        packages/stock-analysis/tests/fixtures/dart-005930-business.json \
        packages/stock-analysis/tests/fixtures/dart-no-data.json
git commit -m "feat(stock-analysis): DART 어댑터 — 분기 자동 탐지 + trailing 4Q 추출 + CB"
```

---

## Task 6: MarketSnapshot 스키마 확장 + PERSONA_PROMPT_VERSION

**Files:**
- Modify: `packages/stock-analysis/src/schemas/consensus.ts`
- Modify: `packages/stock-analysis/src/personas/index.ts`
- Modify: `packages/stock-analysis/src/index.ts`
- Modify: `packages/stock-analysis/src/client.ts`

- [ ] **Step 1: 기존 schema 테스트가 통과하는지 baseline 확인**

```bash
cd /home/gon/projects/gon/gons-dashboard/packages/stock-analysis && pnpm test
```

Expected: 모든 기존 테스트 pass (이전 task 추가분 9 + 기존)

- [ ] **Step 2: MarketSnapshotSchema 에 7 필드 추가**

`packages/stock-analysis/src/schemas/consensus.ts` 의 `MarketSnapshotSchema` 마지막 필드 `asOf` 직전에 추가:

```ts
export const MarketSnapshotSchema = z.object({
  price: z.number(),
  changePct: z.number(),
  currency: z.string(),
  marketCap: z.number().optional(),
  per: z.number().optional(),
  pbr: z.number().optional(),
  dividendYield: z.number().optional(),
  debtRatio: z.number().optional(),
  rsi14: z.number().optional(),
  ma20: z.number().optional(),
  ma60: z.number().optional(),

  // 신규 — DART trailing 정량 지표
  trailingEPS: z.number().optional(),
  trailingBPS: z.number().optional(),
  revenueGrowthYoY: z.number().optional(),
  opMarginPct: z.number().optional(),

  // 신규 — 데이터 출처 메타
  fundamentalsSource: z.enum(["yahoo+dart", "yahoo", "none"]).optional(),
  fundamentalsAsOf: z.string().optional(),
  dartReportPeriod: z.string().optional(),

  asOf: z.string(),
});
```

- [ ] **Step 3: PERSONA_PROMPT_VERSION 상수 추가**

`packages/stock-analysis/src/personas/index.ts` 마지막에 추가:

```ts
// Cache invalidation key — bump 시 모든 v1 cache row 무시 → 다음 호출에서 재분석.
export const PERSONA_PROMPT_VERSION = "v2";
```

- [ ] **Step 4: index.ts 에 새 export 추가**

`packages/stock-analysis/src/index.ts` 의 personas 섹션 + 새 DART export:

```ts
// Personas + Consensus
export { PERSONA_BUILDERS, PERSONA_PROMPT_VERSION } from "./personas";
export type { PersonaInput, BuiltPrompt, PromptBuilder } from "./personas";
export { buildConsensusPrompt, tallyVerdicts } from "./consensus";

// DART 어댑터
export { fetchDartFinancials } from "./adapters/dart";
export type { DartFinancials } from "./adapters/dart-types";
export { DartError } from "./adapters/dart-types";
```

- [ ] **Step 5: client.ts 에 type 만 노출 (Gotcha #1 — server-only 모듈 회피)**

먼저 `packages/stock-analysis/src/client.ts` 현재 내용 확인:

```bash
cat /home/gon/projects/gon/gons-dashboard/packages/stock-analysis/src/client.ts
```

기존 type export 그룹에 `DartFinancials` 추가 (server-only 모듈인 `dart.ts` 의 함수는 절대 client.ts 에서 export 금지). PersonaKey/MarketSnapshot 옆에 한 줄:

```ts
export type { DartFinancials } from "./adapters/dart-types";
```

- [ ] **Step 6: typecheck + 기존 테스트 회귀 없음 확인**

```bash
cd /home/gon/projects/gon/gons-dashboard/packages/stock-analysis && pnpm typecheck && pnpm test
cd /home/gon/projects/gon/gons-dashboard/apps/dashboard && pnpm typecheck
```

Expected: 양쪽 모두 통과, 기존 테스트 회귀 없음.

- [ ] **Step 7: Commit**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add packages/stock-analysis/src/schemas/consensus.ts \
        packages/stock-analysis/src/personas/index.ts \
        packages/stock-analysis/src/index.ts \
        packages/stock-analysis/src/client.ts
git commit -m "feat(stock-analysis): MarketSnapshot 7 필드 추가 + PERSONA_PROMPT_VERSION=v2

신규 필드: trailingEPS/BPS, revenueGrowthYoY, opMarginPct, fundamentalsSource,
fundamentalsAsOf, dartReportPeriod. 모두 optional 이라 v1 cache row JSONB 와 호환.
prompt_version v2 bump 로 다음 분석부터 자동 재실행."
```

---

## Task 7: value/growth 페르소나 프롬프트 변경

**Files:**
- Modify: `packages/stock-analysis/src/personas/value.ts`
- Modify: `packages/stock-analysis/src/personas/growth.ts`
- Modify: `packages/stock-analysis/tests/personas.test.ts` (회귀 테스트 보강)

- [ ] **Step 1: 기존 personas 테스트 baseline**

```bash
cd /home/gon/projects/gon/gons-dashboard/packages/stock-analysis && pnpm test tests/personas.test.ts
```

Expected: pass (몇 개인지 기록)

- [ ] **Step 2: value.ts 프롬프트 — trailing 지표 항목 추가**

`packages/stock-analysis/src/personas/value.ts` 의 user 프롬프트 부분을 다음으로 교체:

```ts
export const value: PromptBuilder = (input: PersonaInput) => ({
  system: SYSTEM,
  user: `가치 투자 관점 분석: ${input.symbol} (${input.displayName})

펀더멘털 수치 (제공된 값만 사용, 추정 금지):
- 가격: ${input.snapshot.price} ${input.snapshot.currency}
- 시가총액: ${input.snapshot.marketCap ?? "데이터 없음"}
- PER: ${input.snapshot.per ?? "데이터 없음"}
  (기준: ${input.snapshot.fundamentalsSource === "yahoo+dart" ? "DART trailing" : input.snapshot.fundamentalsSource === "yahoo" ? "Yahoo forward" : "—"})
- PBR: ${input.snapshot.pbr ?? "데이터 없음"} (DART 계산)
- 배당수익률: ${input.snapshot.dividendYield ?? "데이터 없음"}% (DART 계산)
- trailing EPS: ${input.snapshot.trailingEPS ?? "데이터 없음"} 원
- trailing BPS: ${input.snapshot.trailingBPS ?? "데이터 없음"} 원
- 매출 YoY: ${input.snapshot.revenueGrowthYoY ?? "데이터 없음"}%
- 영업이익률: ${input.snapshot.opMarginPct ?? "데이터 없음"}%
- DART 기준 분기: ${input.snapshot.dartReportPeriod ?? "—"}

응답 형식:
{
  "persona": "value",
  "verdict": "BUY" | "HOLD" | "SELL",
  "oneLineThesis": "PER X배 / PBR Y배 기준 [저평가/적정/고평가] 판단",
  "narrative": "300-600자. PER 동종업 비교 + 배당 안정성 + 안전마진 계산. PER 출처(trailing/forward)와 DART 기준 분기를 분석에 반영.",
  "keyMetrics": { "fairPER": <number>, "marginOfSafety": "<percent>", "dcfTarget": <number> },
  "risks": ["가치 함정 가능성", "배당 컷 리스크"] (1-5개),
  "modelUsed": "claude" | "codex" | "gemini"
}`,
});
```

- [ ] **Step 3: growth.ts system 프롬프트 한 줄 추가**

`packages/stock-analysis/src/personas/growth.ts` 의 `SYSTEM` 상수 끝에 한 줄 추가:

```ts
const SYSTEM = `당신은 성장주 펀드 매니저입니다 (예: ARK Invest 스타일).
분석 스타일: 매출 성장률, 미래 시장 규모, 디스럽션 시나리오. Gemini 의 검색 도구가 있다면 최신 뉴스/실적을 활용.

엄격한 제약:
- 제공된 가격/시총 수치만 사용. P/E 같은 정량 비율은 보조 지표로 가볍게.
- 검색 도구로 얻은 정보는 narrative 에서 "최근 보고서에 따르면..." 같이 인용 표기. 출처 모호하면 표시 안 함.
- 출력 strict JSON.
- narrative 300-600자 한국어.
- 본 분석은 가상 AI 페르소나 의견이며 투자자문이 아닙니다.
- snapshot.revenueGrowthYoY 가 제공되면 그 수치를 narrative 의 핵심 근거로 사용. 추정/fabrication 금지.`;
```

- [ ] **Step 4: 회귀 테스트 보강 — 새 필드가 프롬프트에 나타나는지**

`packages/stock-analysis/tests/personas.test.ts` 끝에 추가:

```ts
import { PERSONA_BUILDERS } from "../src/personas";
import type { MarketSnapshot } from "../src/schemas/consensus";

describe("value persona prompt — DART fields", () => {
  it("includes trailingEPS/BPS/revenueGrowthYoY when present", () => {
    const snapshot: MarketSnapshot = {
      price: 70000, changePct: 1.2, currency: "KRW", asOf: "2026-05-22T00:00:00Z",
      trailingEPS: 4500, trailingBPS: 55000, revenueGrowthYoY: 12.3, opMarginPct: 9.8,
      fundamentalsSource: "yahoo+dart", dartReportPeriod: "2025-Q3",
      per: 15.5, pbr: 1.27, dividendYield: 2.1, marketCap: 4180000000000,
    };
    const built = PERSONA_BUILDERS.value({
      symbol: "005930.KS",
      displayName: "삼성전자",
      assetClass: "stock",
      market: "KRX",
      snapshot,
      dailyOHLC: [],
    });
    expect(built.user).toContain("trailing EPS: 4500");
    expect(built.user).toContain("trailing BPS: 55000");
    expect(built.user).toContain("매출 YoY: 12.3%");
    expect(built.user).toContain("DART trailing");
    expect(built.user).toContain("2025-Q3");
  });

  it("shows '데이터 없음' when DART fields are undefined", () => {
    const snapshot: MarketSnapshot = {
      price: 70000, changePct: 0, currency: "KRW", asOf: "2026-05-22T00:00:00Z",
      fundamentalsSource: "yahoo",
    };
    const built = PERSONA_BUILDERS.value({
      symbol: "005930.KS",
      displayName: "삼성전자",
      assetClass: "stock",
      market: "KRX",
      snapshot,
      dailyOHLC: [],
    });
    expect(built.user).toContain("trailing EPS: 데이터 없음");
    expect(built.user).toContain("Yahoo forward");
  });
});

describe("growth persona system prompt", () => {
  it("instructs to use revenueGrowthYoY when present", () => {
    const built = PERSONA_BUILDERS.growth({
      symbol: "005930.KS",
      displayName: "삼성전자",
      assetClass: "stock",
      market: "KRX",
      snapshot: { price: 70000, changePct: 0, currency: "KRW", asOf: "" },
      dailyOHLC: [],
    });
    expect(built.system).toContain("revenueGrowthYoY");
    expect(built.system).toContain("fabrication 금지");
  });
});
```

- [ ] **Step 5: 테스트 통과**

```bash
cd /home/gon/projects/gon/gons-dashboard/packages/stock-analysis && pnpm test tests/personas.test.ts
```

Expected: 모든 기존 테스트 + 새 3개 pass

- [ ] **Step 6: Commit**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add packages/stock-analysis/src/personas/value.ts \
        packages/stock-analysis/src/personas/growth.ts \
        packages/stock-analysis/tests/personas.test.ts
git commit -m "feat(stock-analysis): value/growth 페르소나 DART trailing 지표 노출

- value: trailingEPS/BPS/revenueGrowthYoY/opMarginPct + PER 출처/분기 명시
- growth system prompt: revenueGrowthYoY 핵심 근거 사용 + fabrication 금지"
```

---

## Task 8: env.ts + .env.example 확장

**Files:**
- Modify: `apps/dashboard/src/shared/config/env.ts`
- Modify: `apps/dashboard/.env.example`
- Modify: `apps/dashboard/tests/setup.ts` (필요 시)

- [ ] **Step 1: env.ts 에 두 변수 추가**

`apps/dashboard/src/shared/config/env.ts` 의 `schema` 객체에 `KRX_OPENAPI_AUTH_KEY` 정의 직후 추가:

```ts
  // DART OpenAPI (재무제표) — KR 종목 PBR/배당/EPS/BPS overlay
  // 발급: opendart.fss.or.kr 회원가입 → 인증키 발급 (T+1)
  DART_OPENAPI_AUTH_KEY: z
    .string()
    .min(1, "DART OpenAPI key. https://opendart.fss.or.kr/ 에서 발급.")
    .optional(),

  // 펀더멘털 소스 토글 (롤백 스위치)
  // - "yahoo+dart" (기본): yahoo-finance2 + DART overlay
  // - "off": DART 비활성, yahoo-finance2 만 (PR #120 직후 동작)
  STOCK_FUNDAMENTALS_SOURCES: z.enum(["yahoo+dart", "off"]).default("yahoo+dart"),
```

- [ ] **Step 2: .env.example 확인 + 추가**

```bash
cat /home/gon/projects/gon/gons-dashboard/apps/dashboard/.env.example | tail -20
```

KRX_OPENAPI_AUTH_KEY 블록 다음에 추가:

```bash
# ===== DART OpenAPI (재무제표) =====
# 발급: opendart.fss.or.kr 회원가입 → API 인증키 발급 (T+1)
# KR 종목 PBR/배당/trailing EPS/BPS overlay 용 (Yahoo 가 KR 종목엔 null 반환)
DART_OPENAPI_AUTH_KEY=

# 펀더멘털 소스 토글 (롤백)
# - "yahoo+dart" (기본): yahoo-finance2 + DART overlay
# - "off": DART 비활성, yahoo-finance2 만
STOCK_FUNDAMENTALS_SOURCES=yahoo+dart
```

- [ ] **Step 3: tests/setup.ts 점검**

```bash
grep -nE "DART|STOCK_FUND" /home/gon/projects/gon/gons-dashboard/apps/dashboard/tests/setup.ts || echo "(no matches — optional 키이므로 setup 수정 불필요)"
```

setup.ts 가 환경변수를 명시 set 한다면 두 변수 추가. 없으면 패스.

- [ ] **Step 4: dev 부팅 + typecheck 회귀 확인**

```bash
cd /home/gon/projects/gon/gons-dashboard/apps/dashboard && pnpm typecheck
```

Expected: 통과

- [ ] **Step 5: Commit**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/shared/config/env.ts apps/dashboard/.env.example
git commit -m "feat(env): DART_OPENAPI_AUTH_KEY (optional) + STOCK_FUNDAMENTALS_SOURCES 토글

DART 키 없거나 토글이 off 면 orchestrator 가 DART 호출 skip — 운영 부팅 실패 회피.
롤백: STOCK_FUNDAMENTALS_SOURCES=off + compose up -d --force-recreate app."
```

---

## Task 9: mergeSnapshot 헬퍼 + 단위 테스트

**Files:**
- Create: `apps/dashboard/src/features/stock-analysis-server/api/merge-snapshot.ts`
- Create: `apps/dashboard/src/features/stock-analysis-server/api/merge-snapshot.test.ts`

orchestrator 의 snapshot 머지 로직을 분리해서 단위 테스트 가능하게 만듦.

- [ ] **Step 1: failing test 작성**

Create `apps/dashboard/src/features/stock-analysis-server/api/merge-snapshot.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mergeSnapshot } from "./merge-snapshot";
import type {
  NormalizedQuote,
  NormalizedFundamentals,
  DartFinancials,
} from "@gons/stock-analysis";

const baseQuote: NormalizedQuote = {
  symbol: "005930.KS",
  price: 70000,
  changePct: 1.2,
  currency: "KRW",
  fetchedAt: "2026-05-22T08:00:00.000Z",
};

const yahooFund: NormalizedFundamentals = {
  symbol: "005930.KS",
  marketCap: 4_180_000_000_000_000,
  per: 5.5,  // forwardPE
  pbr: undefined,
  dividendYield: undefined,
};

const dartFund: DartFinancials = {
  krxCode: "005930",
  corpCode: "00126380",
  reportPeriod: "2025-Q3",
  revenueTrailing4Q: 250_000_000_000_000,
  revenueGrowthYoY: 12.3,
  operatingProfitTrailing4Q: 25_000_000_000_000,
  opMarginPct: 10,
  eps: 5000,
  bps: 55000,
  annualDPS: 1470,
  asOf: "2026-05-22",
};

describe("mergeSnapshot", () => {
  it("DART trailing EPS present → per = price/eps (DART 우선)", () => {
    const s = mergeSnapshot(baseQuote, yahooFund, dartFund, []);
    expect(s.per).toBeCloseTo(70000 / 5000, 4);  // 14
    expect(s.fundamentalsSource).toBe("yahoo+dart");
    expect(s.trailingEPS).toBe(5000);
    expect(s.dartReportPeriod).toBe("2025-Q3");
  });

  it("DART BPS present → derivedPBR = price/bps", () => {
    const s = mergeSnapshot(baseQuote, yahooFund, dartFund, []);
    expect(s.pbr).toBeCloseTo(70000 / 55000, 4);  // ~1.27
  });

  it("DART annualDPS present → dividendYield = dps/price * 100", () => {
    const s = mergeSnapshot(baseQuote, yahooFund, dartFund, []);
    expect(s.dividendYield).toBeCloseTo((1470 / 70000) * 100, 4);  // ~2.1
  });

  it("DART null EPS → yahoo forwardPE fallback", () => {
    const dartNoEps: DartFinancials = { ...dartFund, eps: null };
    const s = mergeSnapshot(baseQuote, yahooFund, dartNoEps, []);
    expect(s.per).toBe(5.5);
  });

  it("DART entirely null → fundamentalsSource = yahoo, pbr undefined", () => {
    const s = mergeSnapshot(baseQuote, yahooFund, null, []);
    expect(s.fundamentalsSource).toBe("yahoo");
    expect(s.pbr).toBeUndefined();
    expect(s.dividendYield).toBeUndefined();
    expect(s.per).toBe(5.5);
  });

  it("yahoo + DART both null → fundamentalsSource = none", () => {
    const s = mergeSnapshot(baseQuote, null, null, []);
    expect(s.fundamentalsSource).toBe("none");
    expect(s.per).toBeUndefined();
    expect(s.marketCap).toBeUndefined();
  });

  it("guards against EPS <= 0 (적자) → falls back to yahoo forwardPE", () => {
    const dartNegEps: DartFinancials = { ...dartFund, eps: -1500 };
    const s = mergeSnapshot(baseQuote, yahooFund, dartNegEps, []);
    expect(s.per).toBe(5.5);  // DART eps 무시
  });

  it("computes ma20/ma60/rsi14 from closes", () => {
    const closes = Array.from({ length: 100 }, (_, i) => 100 + i);  // 상승 추세
    const s = mergeSnapshot(baseQuote, yahooFund, dartFund, closes);
    expect(s.ma20).toBeGreaterThan(0);
    expect(s.ma60).toBeGreaterThan(0);
    expect(s.rsi14).toBeGreaterThan(50);  // 상승 추세 → RSI 50 이상
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
cd /home/gon/projects/gon/gons-dashboard/apps/dashboard
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test --run src/features/stock-analysis-server/api/merge-snapshot.test.ts
```

Expected: FAIL "Cannot find module './merge-snapshot'"

- [ ] **Step 3: 구현**

Create `apps/dashboard/src/features/stock-analysis-server/api/merge-snapshot.ts`:

```ts
import "server-only";
import type {
  NormalizedQuote,
  NormalizedFundamentals,
  DartFinancials,
  MarketSnapshot,
} from "@gons/stock-analysis";
import {
  simpleMovingAverage,
  relativeStrengthIndex,
  lastFinite,
} from "@/shared/lib/ta/indicators";

/**
 * Yahoo + DART 결과를 우선순위 머지하여 MarketSnapshot 생성.
 * - DART 자체 계산 (trailingPER, derivedPBR, derivedDividendYield) 우선
 * - Yahoo 값 (marketCap, forwardPE) 폴백
 * - 가드: dart.eps > 0 일 때만 trailingPER 사용 (적자 종목 회피)
 */
export function mergeSnapshot(
  quote: NormalizedQuote,
  yahoo: NormalizedFundamentals | null,
  dart: DartFinancials | null,
  closes: number[],
): MarketSnapshot {
  const price = quote.price;

  const trailingPER =
    dart?.eps != null && dart.eps > 0 ? price / dart.eps : undefined;
  const derivedPBR =
    dart?.bps != null && dart.bps > 0 ? price / dart.bps : undefined;
  const derivedDividendYield =
    dart?.annualDPS != null && dart.annualDPS > 0 && price > 0
      ? (dart.annualDPS / price) * 100
      : undefined;

  const fundamentalsSource: "yahoo+dart" | "yahoo" | "none" =
    dart != null ? "yahoo+dart" : yahoo != null ? "yahoo" : "none";

  const fundamentalsAsOf =
    dart?.asOf ?? (yahoo ? new Date().toISOString().slice(0, 10) : undefined);

  return {
    price,
    changePct: quote.changePct,
    currency: quote.currency,
    marketCap: yahoo?.marketCap,
    per: trailingPER ?? yahoo?.per,
    pbr: derivedPBR ?? yahoo?.pbr,
    dividendYield: derivedDividendYield ?? yahoo?.dividendYield,
    trailingEPS: dart?.eps ?? undefined,
    trailingBPS: dart?.bps ?? undefined,
    revenueGrowthYoY: dart?.revenueGrowthYoY ?? undefined,
    opMarginPct: dart?.opMarginPct ?? undefined,
    dartReportPeriod: dart?.reportPeriod ?? undefined,
    fundamentalsSource,
    fundamentalsAsOf,
    ma20: lastFinite(simpleMovingAverage(closes, 20)),
    ma60: lastFinite(simpleMovingAverage(closes, 60)),
    rsi14: lastFinite(relativeStrengthIndex(closes, 14)),
    asOf: quote.fetchedAt,
  };
}
```

- [ ] **Step 4: 테스트 통과**

```bash
cd /home/gon/projects/gon/gons-dashboard/apps/dashboard
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test --run src/features/stock-analysis-server/api/merge-snapshot.test.ts
```

Expected: 8 passed

- [ ] **Step 5: Commit**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/features/stock-analysis-server/api/merge-snapshot.ts \
        apps/dashboard/src/features/stock-analysis-server/api/merge-snapshot.test.ts
git commit -m "feat(stock-analysis): mergeSnapshot 헬퍼 + 단위 테스트 8건

DART 우선 + yahoo fallback 우선순위 머지 로직 분리. 적자 (eps<=0) 가드,
모든 분기 케이스 (yahoo+dart / yahoo / none) 검증."
```

---

## Task 10: orchestrator 통합 — DART 병렬 호출 + promptVersion 전달

**Files:**
- Modify: `apps/dashboard/src/features/stock-analysis-server/api/orchestrator.ts`
- Modify: `apps/dashboard/src/entities/stock-analysis/server.ts` (`PROMPT_VERSION` 제거 + 시그니처 확장)
- Modify: (Step 2 의 grep 결과로 발견되는 호출자 파일들)

- [ ] **Step 1: server.ts 의 upsertAnalysis/getCachedAnalysis 시그니처 수정**

`apps/dashboard/src/entities/stock-analysis/server.ts` 변경:

```ts
// line 22 의 `export const PROMPT_VERSION = "v1.0";` 삭제

// UpsertAnalysisArgs 인터페이스에 promptVersion 추가
export interface UpsertAnalysisArgs {
  symbol: string;
  analysisDate: string;
  userId: string | null;
  personas: Partial<Record<PersonaKey, PersonaAnalysis>>;
  consensus: Consensus;
  marketSnapshot: MarketSnapshot;
  promptVersion: string;  // 신규
}

// upsertAnalysis 본문: PROMPT_VERSION 참조를 args.promptVersion 으로 교체
export async function upsertAnalysis(args: UpsertAnalysisArgs): Promise<void> {
  await db
    .insert(stockAnalysisCache)
    .values({
      symbol: args.symbol,
      analysisDate: args.analysisDate,
      userId: args.userId,
      personas: args.personas,
      consensus: args.consensus,
      marketSnapshot: args.marketSnapshot,
      promptVersion: args.promptVersion,  // 변경
    })
    .onConflictDoUpdate({
      target: [
        stockAnalysisCache.symbol,
        stockAnalysisCache.analysisDate,
        stockAnalysisCache.userId,
      ],
      set: {
        personas: args.personas,
        consensus: args.consensus,
        marketSnapshot: args.marketSnapshot,
        promptVersion: args.promptVersion,  // 변경
        generatedAt: sql`now()`,
      },
    });
}

// getCachedAnalysis 시그니처에 promptVersion 추가 + WHERE 조건
export async function getCachedAnalysis(
  symbol: string,
  analysisDate: string,
  userId: string | null,
  promptVersion: string,  // 신규
): Promise<CachedAnalysisRow | null> {
  const rows = await db
    .select()
    .from(stockAnalysisCache)
    .where(
      and(
        eq(stockAnalysisCache.symbol, symbol),
        eq(stockAnalysisCache.analysisDate, analysisDate),
        eq(stockAnalysisCache.promptVersion, promptVersion),  // 신규
        userId === null
          ? sql`${stockAnalysisCache.userId} IS NULL`
          : eq(stockAnalysisCache.userId, userId),
      ),
    )
    .limit(1);
  if (rows.length === 0) return null;
  // ... 기존 매핑 그대로
}
```

- [ ] **Step 2: getCachedAnalysis / PROMPT_VERSION 호출자 모두 grep**

```bash
cd /home/gon/projects/gon/gons-dashboard
grep -rn "getCachedAnalysis\|PROMPT_VERSION" apps/dashboard/src --include="*.ts"
```

발견되는 각 호출자 파일에:

```ts
import { PERSONA_PROMPT_VERSION } from "@gons/stock-analysis";
```

추가 + 호출부 수정:

```ts
const cached = await getCachedAnalysis(symbol, date, userId, PERSONA_PROMPT_VERSION);
```

(`PROMPT_VERSION` 을 직접 import 하던 곳도 `PERSONA_PROMPT_VERSION` 으로 교체)

- [ ] **Step 3: orchestrator.ts 수정 — DART 통합 + mergeSnapshot 사용**

`apps/dashboard/src/features/stock-analysis-server/api/orchestrator.ts` 전체 import 영역 + analyzeStock 함수 본문 교체:

```ts
import "server-only";
import {
  PERSONA_BUILDERS,
  PERSONA_PROMPT_VERSION,
  PersonaAnalysisSchema,
  ConsensusSchema,
  buildConsensusPrompt,
  tallyVerdicts,
  fetchYahooQuotes,
  fetchYahooFundamentals,
  fetchYahooDailyOHLC,
  fetchDartFinancials,
  type PersonaAnalysis,
  type PersonaKey,
  type Consensus,
  type MarketSnapshot,
} from "@gons/stock-analysis";
import { resolvePersonaModels } from "@/shared/lib/llm/persona-router";
import { upsertAnalysis } from "@/entities/stock-analysis/server";
import type { PortfolioHolding } from "@/entities/portfolio-holding/server";
import { env } from "@/shared/config/env";
import { mergeSnapshot } from "./merge-snapshot";
import { callLlmAndParseWithRetry } from "./llm-call";

const MINIMUM_SUCCESS = 3;
const PERSONA_KEYS: PersonaKey[] = [
  "wallStreet",
  "krExpert",
  "value",
  "growth",
  "technical",
];

export interface AnalyzeStockArgs {
  symbol: string;
  displayName: string;
  assetClass: PortfolioHolding["assetClass"];
  market: string;
  userId: string;
}

export interface AnalyzeStockResult {
  status: "success" | "partial" | "failed";
  personas: Partial<Record<PersonaKey, PersonaAnalysis>>;
  consensus: Consensus | null;
  marketSnapshot: MarketSnapshot | null;
}

// stdout 한 줄 JSON — source 가용성 추적용. 운영에서 grep 모니터링.
function logSnapshotSources(
  symbol: string,
  info: { yahoo: boolean; dart: boolean; source: string | undefined },
): void {
  console.log(
    JSON.stringify({
      level: "info",
      scope: "stock-analysis",
      event: "snapshot-sources",
      ts: new Date().toISOString(),
      symbol,
      ...info,
    }),
  );
}

export async function analyzeStock(
  args: AnalyzeStockArgs,
): Promise<AnalyzeStockResult> {
  // DART 는 KR 종목 + key 있음 + 토글 ON 모두 만족 시에만.
  const isKrx = args.symbol.endsWith(".KS") || args.symbol.endsWith(".KQ");
  const krxCode = isKrx ? args.symbol.replace(/\.(KS|KQ)$/, "") : null;
  const enableDart =
    env.STOCK_FUNDAMENTALS_SOURCES !== "off" &&
    krxCode != null &&
    env.DART_OPENAPI_AUTH_KEY != null;

  // 1. 병렬 fetch — DART 는 wrapped catch (실패 시 null, snapshot 은 yahoo 만)
  const [quotes, yahooFund, dailyOHLC, dartResult] = await Promise.all([
    fetchYahooQuotes([args.symbol]),
    fetchYahooFundamentals(args.symbol).catch(() => null),
    fetchYahooDailyOHLC(args.symbol, "1y").catch(() => []),
    enableDart && krxCode
      ? fetchDartFinancials(krxCode, env.DART_OPENAPI_AUTH_KEY!).catch(() => null)
      : Promise.resolve(null),
  ]);
  if (quotes.length === 0) {
    return {
      status: "failed",
      personas: {},
      consensus: null,
      marketSnapshot: null,
    };
  }

  // 2. mergeSnapshot 으로 우선순위 머지
  const closes = dailyOHLC.map((d) => d.close);
  const snapshot = mergeSnapshot(quotes[0], yahooFund, dartResult, closes);
  logSnapshotSources(args.symbol, {
    yahoo: !!yahooFund,
    dart: !!dartResult,
    source: snapshot.fundamentalsSource,
  });

  // 3. 페르소나별 모델 해석 (user override + default 머지)
  const models = await resolvePersonaModels(args.userId);

  // 4. 펀더멘털 전무 시 value 페르소나 skip — PR #119 유지.
  //    DART 가 있을 수 있으니 trailingEPS/BPS 도 hasFundamentals 신호로 사용.
  const hasFundamentals =
    snapshot.per != null ||
    snapshot.pbr != null ||
    snapshot.marketCap != null ||
    snapshot.dividendYield != null ||
    snapshot.trailingEPS != null ||
    snapshot.trailingBPS != null;
  const activePersonaKeys: PersonaKey[] = hasFundamentals
    ? PERSONA_KEYS
    : PERSONA_KEYS.filter((k) => k !== "value");

  // 5. 활성 페르소나 병렬 호출
  const personaInput = {
    symbol: args.symbol,
    displayName: args.displayName,
    assetClass: args.assetClass,
    market: args.market,
    snapshot,
    dailyOHLC,
  };
  const settled = await Promise.allSettled(
    activePersonaKeys.map(async (key) => {
      const builder = PERSONA_BUILDERS[key];
      const prompt = builder(personaInput);
      const model = models[key];
      const result = await callLlmAndParseWithRetry(
        prompt,
        model.id,
        PersonaAnalysisSchema,
      );
      return { ...result, persona: key, modelUsed: model.name };
    }),
  );

  const personas: Partial<Record<PersonaKey, PersonaAnalysis>> = {};
  const successfulResults: PersonaAnalysis[] = [];
  for (let i = 0; i < activePersonaKeys.length; i++) {
    const r = settled[i];
    if (r.status === "fulfilled") {
      personas[activePersonaKeys[i]] = r.value;
      successfulResults.push(r.value);
    }
  }

  if (successfulResults.length < MINIMUM_SUCCESS) {
    return {
      status: "failed",
      personas,
      consensus: null,
      marketSnapshot: snapshot,
    };
  }

  // 6. 합의 빌더 (기존 그대로)
  const consensusModel = models.consensus;
  const consensusPrompt = buildConsensusPrompt(
    successfulResults,
    consensusModel.name,
  );
  const failedPersonas = PERSONA_KEYS.filter((k) => !personas[k]);
  const successfulPersonaKeys = successfulResults.map((p) => p.persona);
  let consensus: Consensus;
  try {
    consensus = await callLlmAndParseWithRetry(
      consensusPrompt,
      consensusModel.id,
      ConsensusSchema,
    );
  } catch {
    const tally = tallyVerdicts(successfulResults);
    const oneLineConsensus = `5 페르소나 중 ${successfulResults.length}명 성공 — 다수결 합의 결과는 ${tally.majority} (${tally.score}). 합의 빌더 LLM 호출 실패로 폴백 사용.`;
    consensus = {
      verdict: tally.majority,
      score: tally.score,
      oneLineConsensus,
      agreements: [],
      disagreements: [],
      riskRanking: successfulResults.flatMap((p) => p.risks).slice(0, 5),
      modelUsed: consensusModel.name,
      successfulPersonas: successfulPersonaKeys,
      failedPersonas,
    };
    consensus = ConsensusSchema.parse(consensus);
  }

  // 7. DB upsert — promptVersion 전달
  const today = new Date().toISOString().slice(0, 10);
  await upsertAnalysis({
    symbol: args.symbol,
    analysisDate: today,
    userId: null,
    personas,
    consensus,
    marketSnapshot: snapshot,
    promptVersion: PERSONA_PROMPT_VERSION,
  });

  return {
    status:
      successfulResults.length === PERSONA_KEYS.length ? "success" : "partial",
    personas,
    consensus,
    marketSnapshot: snapshot,
  };
}
```

- [ ] **Step 4: typecheck — 모든 PROMPT_VERSION 호출자가 갱신됐는지**

```bash
cd /home/gon/projects/gon/gons-dashboard/apps/dashboard && pnpm typecheck
```

Expected: 통과. 실패 시 `Property 'promptVersion' is missing` 에러로 호출자 식별 → import + 전달 추가.

- [ ] **Step 5: 기존 테스트 회귀 확인**

```bash
cd /home/gon/projects/gon/gons-dashboard/apps/dashboard
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test --run
```

Expected: 모든 테스트 pass

- [ ] **Step 6: Commit**

```bash
cd /home/gon/projects/gon/gons-dashboard
git add apps/dashboard/src/features/stock-analysis-server/api/orchestrator.ts \
        apps/dashboard/src/entities/stock-analysis/server.ts
# Step 2 grep 결과 파일들 — 수정된 파일만 stage
git add -u apps/dashboard/src
git commit -m "feat(stock-analysis): orchestrator DART 통합 + mergeSnapshot 사용 + promptVersion 동적 전달

- DART 는 KR 종목 + key 있음 + 토글 ON 일 때만 병렬 호출 (wrapped catch)
- mergeSnapshot 헬퍼로 yahoo+DART 우선순위 머지 위임
- PERSONA_PROMPT_VERSION 을 upsertAnalysis/getCachedAnalysis 시그니처로 전달
- hasFundamentals 체크에 trailingEPS/BPS 추가 — DART 만 있어도 value 페르소나 활성"
```

---

## Task 11: 전체 검증 — typecheck + lint + test + build

**Files:** (변경 없음 — 검증만)

- [ ] **Step 1: typecheck**

```bash
cd /home/gon/projects/gon/gons-dashboard/apps/dashboard && pnpm typecheck
cd /home/gon/projects/gon/gons-dashboard/packages/stock-analysis && pnpm typecheck
```

Expected: 양쪽 모두 0 errors

- [ ] **Step 2: lint**

```bash
cd /home/gon/projects/gon/gons-dashboard/apps/dashboard && pnpm lint
```

Expected: "No issues found"

- [ ] **Step 3: 전체 테스트**

```bash
cd /home/gon/projects/gon/gons-dashboard/apps/dashboard
TEST_DATABASE_URL="postgres://test:test@127.0.0.1:5999/test_dummy" pnpm test --run --reporter=dot
cd /home/gon/projects/gon/gons-dashboard/packages/stock-analysis && pnpm test --run
```

Expected: 모든 테스트 pass. 신규 추가: dart-corp-lookup (4) + dart (5) + personas DART (3) + merge-snapshot (8) = 20개 추가

- [ ] **Step 4: build (Gotcha #7 — features barrel seam 회귀 확인)**

```bash
cd /home/gon/projects/gon/gons-dashboard/apps/dashboard && pnpm build 2>&1 | tail -15
```

Expected: "✓ Compiled successfully"
실패 시: `Module not found: 'tls' / 'perf_hooks' / 'net'` → client tree 에서 server-only 모듈 import 중. dart.ts import 가 client component 로 새어들어갔는지 grep:

```bash
grep -rn "fetchDartFinancials" apps/dashboard/src --include="*.tsx"
```

- [ ] **Step 5: spot check (커밋 없음)**

GitHub PR 생성 전 마지막 점검 — commit 누락 확인:

```bash
cd /home/gon/projects/gon/gons-dashboard
git status -s
git log --oneline main..HEAD
```

Expected: status clean, ~10개 commit (Task 1-10)

---

## Task 12: PR 생성 + 운영 배포

**Files:** (코드 변경 없음 — git/배포 작업)

- [ ] **Step 1: push + PR 생성**

```bash
cd /home/gon/projects/gon/gons-dashboard
git push -u origin feat/stock-dart-fundamentals

gh pr create --title "feat(stock-analysis): DART 펀더멘털 overlay — PBR/배당/trailing PER 회복" --body "$(cat <<'EOF'
## 배경

PR #120 후 yahoo-finance2 가 KR 종목 펀더멘털을 부분 회복했으나, `priceToBook` (PBR) 과 `dividendYield` 가 여전히 null. trailing PE 도 null 이라 forwardPE 폴백.

이 PR 은 DART 공시 trailing 4Q 재무로 PBR/배당/trailing PER 을 자체 계산해 채움.

## 변경

- **packages/stock-analysis**:
  - `adapters/dart.ts` 신규 — 가장 최근 분기 자동 탐지 + trailing 4Q 추출 + CB
  - `adapters/dart-corp-lookup.ts` + bootstrap JSON (~50KB, KRX 2,700개)
  - `scripts/build-dart-corp-codes.ts` 1회용 생성 스크립트
  - `MarketSnapshotSchema` 에 7 필드 추가 (모두 optional)
  - `PERSONA_PROMPT_VERSION = "v2"` 로 cache 자동 무효화
  - value/growth 페르소나 프롬프트에 trailing 지표 노출
- **apps/dashboard**:
  - `mergeSnapshot` 헬퍼 추출 — DART 우선 + yahoo fallback 우선순위 머지
  - orchestrator: DART 병렬 호출 (wrapped catch) + promptVersion 동적 전달
  - env: `DART_OPENAPI_AUTH_KEY` (optional) + `STOCK_FUNDAMENTALS_SOURCES` 토글
  - `getCachedAnalysis`/`upsertAnalysis` 시그니처에 `promptVersion` 추가

## 회복되는 갭

| 필드 | 이전 (PR #120 후) | 이 PR 후 |
|---|---|---|
| marketCap | ✅ yahoo | ✅ yahoo (변경 없음) |
| per | ⚠️ forward PE | ✅ DART trailing PE (없으면 forward fallback) |
| pbr | ❌ null | ✅ DART price/bps |
| dividendYield | ❌ null | ✅ DART annualDPS/price |
| 신규: trailingEPS/BPS/revenueGrowthYoY/opMarginPct | — | ✅ DART trailing |

## Out of Scope (별도 후속 PR)

- 미국 종목 펀더멘털 (PR 3 — PlayMCP UsStockInfo)
- DART corp_code weekly 갱신 cron
- 외국인/기관 매매동향, 공매도 잔고
- 실시간 catalyst 뉴스 (PlayMCP NaverSearch 통합)

## 테스트

- dart-corp-lookup: 4 passed
- dart (CB 포함): 5 passed
- personas (DART 필드 회귀): 3 passed
- merge-snapshot (모든 분기 케이스): 8 passed
- 전체 회귀: typecheck/lint/test/build 모두 green

## 운영 배포 절차

1. DART 인증키 발급 (opendart.fss.or.kr, T+1)
2. 운영 .env 추가: `DART_OPENAPI_AUTH_KEY=<발급키>` + `STOCK_FUNDAMENTALS_SOURCES=yahoo+dart`
3. PR 머지 + GHA Build 완료 대기
4. `docker --context home-server compose -f $COMPOSE pull app cron && up -d --force-recreate app cron`
5. 005930.KS / 035420.KS / 000660.KS 위젯 PBR/배당 표시 확인 (다음 cron KST 16:30 또는 수동 트리거)

## 롤백

운영 .env: `STOCK_FUNDAMENTALS_SOURCES=off` + 컨테이너 재기동 — yahoo-finance2 만 사용 (PR #120 직후 동작).

## 관련

- Spec: `docs/superpowers/specs/2026-05-22-stock-fundamentals-source-extension-design.md`
- Plan: `docs/superpowers/plans/2026-05-22-stock-fundamentals-source-extension.md`
EOF
)"
```

- [ ] **Step 2: GHA Build 결과 대기**

```bash
gh run watch
```

Expected: Build & Push 모두 success

- [ ] **Step 3: 운영 .env 갱신 (사용자 작업)**

사용자에게 요청: DART 인증키 발급 → 운영 .env 두 줄 추가.

검증:

```bash
ssh gon@192.168.0.5 "grep -E 'DART_OPENAPI|STOCK_FUNDAMENTALS' /home/gon/projects/gon/gons-dashboard/.env"
```

Expected: 두 줄 모두 표시

- [ ] **Step 4: 컨테이너 교체**

```bash
COMPOSE=/home/gon/projects/gon/gons-dashboard/docker-compose.yml
docker --context home-server compose -f $COMPOSE pull app cron
docker --context home-server compose -f $COMPOSE up -d --force-recreate app cron
ssh gon@192.168.0.5 "curl -s http://localhost:3020/api/health"
```

Expected: `{"status":"ok"}`

- [ ] **Step 5: 위젯 검증 (수동)**

브라우저에서 https://gons.krdn.kr 접속 → 증권종목 분석 위젯 → 삼성전자 (005930.KS) 클릭 → 카드 표시:
- 시가총액: 숫자 (yahoo 유지)
- PER: 숫자 + "기준: DART trailing"
- PBR: 숫자 (이전엔 "—")
- 배당수익률: 숫자 % (이전엔 "—")
- value 페르소나: 정상 narrative + DART 분기 인용

cron 트리거 (당일 cache 없으면 lazy 발사):

```bash
curl -sH "Authorization: Bearer <CRON_BEARER_TOKEN>" \
  -X POST https://gons.krdn.kr/api/cron/stock-analyze
```

- [ ] **Step 6: 관측 로그 확인 — fundamentalsSource 분포**

```bash
docker --context home-server logs gons-dashboard-app --since 1h 2>&1 \
  | grep "snapshot-sources" \
  | tail -20
```

Expected: 대부분 `"source":"yahoo+dart"`. `"yahoo"` 가 섞이면 해당 종목 DART 누락 (정상 — 신규 상장 등).
