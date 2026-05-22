// DART OpenAPI 어댑터 — KR 종목 EPS / BPS / DPS / 매출 / 영업이익 추출.
//
// 핵심 3 endpoint 병렬 호출 (단일 보고서 선택 후):
//   1) alotMatter          — 주당현금배당금(DPS) + (연결)주당순이익(EPS)
//   2) stockTotqySttus     — 발행주식수 (보통주 distb_stock_co) → BPS 계산 분모
//   3) fnlttSinglAcnt      — 자본총계 (BPS 분자) + 매출액/영업이익 (마진/성장률)
//
// 보고서 선택 전략 — 사업보고서 우선 시도 (DPS 는 사업보고서에만 존재).
// 사업보고서 미공시 시 직전 분기 (Q3 → 반기 → Q1) 거슬러 시도하되 DPS=null 로 진행.
//
// CB: 5 회 연속 실패 → 30분 차단. status=010 (key suspended) 는 즉시 차단.
// corp_code 누락 (DartError "not_listed_in_dart") 은 CB 와 무관 — orchestrator 가 null 처리.

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
  label: string;
}

// 사업보고서 우선 (DPS 보유). 시점에 따라 작년 사업보고서 → 올해 분기 순.
function buildAttempts(now: Date = new Date()): ReportAttempt[] {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const prev = year - 1;
  const annualPrev: ReportAttempt = {
    year: prev,
    reprt: REPORT_CODES.ANNUAL,
    label: `${prev}-사업보고서`,
  };
  if (month <= 4) {
    return [
      annualPrev,
      { year: prev, reprt: REPORT_CODES.Q3, label: `${prev}-Q3` },
      { year: prev, reprt: REPORT_CODES.HALF, label: `${prev}-반기` },
      { year: prev, reprt: REPORT_CODES.Q1, label: `${prev}-Q1` },
    ];
  }
  if (month <= 7) {
    return [
      annualPrev,
      { year, reprt: REPORT_CODES.Q1, label: `${year}-Q1` },
      { year: prev, reprt: REPORT_CODES.Q3, label: `${prev}-Q3` },
      { year: prev, reprt: REPORT_CODES.HALF, label: `${prev}-반기` },
    ];
  }
  if (month <= 10) {
    return [
      annualPrev,
      { year, reprt: REPORT_CODES.HALF, label: `${year}-반기` },
      { year, reprt: REPORT_CODES.Q1, label: `${year}-Q1` },
      { year: prev, reprt: REPORT_CODES.Q3, label: `${prev}-Q3` },
    ];
  }
  return [
    annualPrev,
    { year, reprt: REPORT_CODES.Q3, label: `${year}-Q3` },
    { year, reprt: REPORT_CODES.HALF, label: `${year}-반기` },
    { year, reprt: REPORT_CODES.Q1, label: `${year}-Q1` },
  ];
}

interface DartGenericResponse {
  status: string;
  message: string;
  list?: unknown[];
}

// HTTP wrapper — DART 상태 코드 처리.
async function dartGet(
  endpoint: string,
  params: Record<string, string>,
): Promise<DartGenericResponse | null> {
  const search = new URLSearchParams(params).toString();
  const url = `${DART_BASE}/${endpoint}.json?${search}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new DartError(`HTTP ${res.status}`);
    const json = (await res.json()) as DartGenericResponse;
    if (json.status === "013") return null; // no data — caller decides fallback
    if (json.status === "020") throw new DartError("rate_limited", "020");
    if (json.status === "010") throw new DartError("key_suspended", "010");
    if (json.status !== "000")
      throw new DartError(
        `dart_status_${json.status}: ${json.message}`,
        json.status,
      );
    return json;
  } catch (err) {
    clearTimeout(timer);
    throw err instanceof DartError ? err : new DartError(String(err));
  }
}

function parseAmount(s: string | undefined | null): number | null {
  if (!s) return null;
  const cleaned = s.replace(/,/g, "").trim();
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// fnlttSinglAcnt 의 list 에서 account_nm 부분 매칭 + CFS 우선.
function pickAccount(
  items: DartAccountItem[],
  patterns: string[],
): DartAccountItem | null {
  for (const item of items) {
    if (item.fs_div !== "CFS") continue;
    for (const pat of patterns) if (item.account_nm.includes(pat)) return item;
  }
  for (const item of items) {
    if (item.fs_div === "CFS") continue;
    for (const pat of patterns) if (item.account_nm.includes(pat)) return item;
  }
  return null;
}

// alotMatter row shape (배당에 관한 사항).
interface AlotRow {
  se?: string; // "(연결)주당순이익(원)", "주당 현금배당금(원)" 등
  stock_knd?: string; // "보통주" / "우선주" / null
  thstrm?: string; // 당기
  frmtrm?: string; // 전기
}

// stockTotqySttus row shape.
interface SharesRow {
  se?: string; // "보통주" / "우선주" / "합계"
  distb_stock_co?: string; // 유통주식수
}

function extractEpsFromAlot(rows: AlotRow[]): number | null {
  // "주당순이익" 포함. (연결)/별도 prefix 무관. 보통주 우선.
  const candidates = rows.filter(
    (r) => typeof r.se === "string" && r.se.includes("주당순이익"),
  );
  const common = candidates.find((r) => r.stock_knd === "보통주");
  const pick = common ?? candidates[0] ?? null;
  return pick ? parseAmount(pick.thstrm) : null;
}

function extractDpsFromAlot(rows: AlotRow[]): number | null {
  // "주당 현금배당금" / "주당현금배당금" 둘 다 허용. 보통주 우선.
  const candidates = rows.filter(
    (r) => typeof r.se === "string" && /주당\s*현금배당금/.test(r.se),
  );
  const common = candidates.find((r) => r.stock_knd === "보통주");
  const pick = common ?? candidates[0] ?? null;
  return pick ? parseAmount(pick.thstrm) : null;
}

function extractCommonSharesFromTotqy(rows: SharesRow[]): number | null {
  const common = rows.find((r) => r.se === "보통주");
  if (!common) return null;
  return parseAmount(common.distb_stock_co ?? null);
}

function bumpCircuit(err: unknown): void {
  cbState.failures += 1;
  if (err instanceof DartError && err.code === "010") {
    cbState.openedAt = Date.now();
    return;
  }
  if (cbState.failures >= CB_FAIL_THRESHOLD) cbState.openedAt = Date.now();
}

function resetCircuit(): void {
  cbState.failures = 0;
  cbState.openedAt = null;
}

interface ReportBundle {
  accountList: DartAccountItem[];
  alotList: AlotRow[];
  sharesList: SharesRow[];
  label: string;
  isAnnual: boolean;
}

async function tryFetchBundle(
  corpCode: string,
  attempt: ReportAttempt,
  authKey: string,
): Promise<ReportBundle | null> {
  const params: Record<string, string> = {
    crtfc_key: authKey,
    corp_code: corpCode,
    bsns_year: String(attempt.year),
    reprt_code: attempt.reprt,
  };
  // 3 endpoint 병렬. alotMatter / stockTotqySttus 는 분기보고서에 없을 수 있으니
  // 개별 null 허용. fnlttSinglAcnt 는 핵심이라 null 이면 이 보고서 skip.
  let acctRes: DartGenericResponse | null;
  let alotRes: DartGenericResponse | null = null;
  let sharesRes: DartGenericResponse | null = null;
  try {
    [acctRes, alotRes, sharesRes] = await Promise.all([
      dartGet("fnlttSinglAcnt", params),
      dartGet("alotMatter", params).catch(() => null),
      dartGet("stockTotqySttus", params).catch(() => null),
    ]);
  } catch (err) {
    bumpCircuit(err);
    throw err;
  }
  if (!acctRes || !Array.isArray(acctRes.list) || acctRes.list.length === 0) {
    return null;
  }
  const parsedItems: DartAccountItem[] = [];
  for (const raw of acctRes.list) {
    const parsed =
      DartResponseSchema.shape.list.unwrap().element.safeParse(raw);
    if (parsed.success) parsedItems.push(parsed.data);
  }
  return {
    accountList: parsedItems,
    alotList: (alotRes?.list as AlotRow[] | undefined) ?? [],
    sharesList: (sharesRes?.list as SharesRow[] | undefined) ?? [],
    label: attempt.label,
    isAnnual: attempt.reprt === REPORT_CODES.ANNUAL,
  };
}

export async function fetchDartFinancials(
  krxCode: string,
  authKey: string,
): Promise<DartFinancials> {
  if (cbState.openedAt && Date.now() - cbState.openedAt < CB_COOLDOWN_MS) {
    throw new DartError("circuit_breaker_open");
  }
  if (cbState.openedAt && Date.now() - cbState.openedAt >= CB_COOLDOWN_MS) {
    resetCircuit();
  }

  const corpCode = lookupCorpCode(krxCode);

  const attempts = buildAttempts();
  let bundle: ReportBundle | null = null;
  for (const att of attempts) {
    bundle = await tryFetchBundle(corpCode, att, authKey);
    if (bundle) break;
  }
  if (!bundle) throw new DartError("no_report_available");

  const revenueItem = pickAccount(bundle.accountList, [
    "매출액",
    "수익(매출액)",
  ]);
  const opItem = pickAccount(bundle.accountList, ["영업이익"]);
  const equityItem = pickAccount(bundle.accountList, ["자본총계"]);

  const revenue = bundle.isAnnual
    ? parseAmount(revenueItem?.thstrm_amount)
    : parseAmount(
        revenueItem?.thstrm_add_amount ?? revenueItem?.thstrm_amount,
      );
  const prevRevenue = parseAmount(revenueItem?.frmtrm_amount);
  const operatingProfit = bundle.isAnnual
    ? parseAmount(opItem?.thstrm_amount)
    : parseAmount(opItem?.thstrm_add_amount ?? opItem?.thstrm_amount);
  const equity = parseAmount(equityItem?.thstrm_amount);

  const revenueGrowthYoY =
    revenue != null && prevRevenue != null && prevRevenue !== 0
      ? ((revenue - prevRevenue) / prevRevenue) * 100
      : null;
  const opMarginPct =
    revenue != null && operatingProfit != null && revenue !== 0
      ? (operatingProfit / revenue) * 100
      : null;

  const eps = extractEpsFromAlot(bundle.alotList);
  const annualDPS = bundle.isAnnual
    ? extractDpsFromAlot(bundle.alotList)
    : null;

  const shares = extractCommonSharesFromTotqy(bundle.sharesList);
  const bps =
    equity != null && shares != null && shares > 0 ? equity / shares : null;

  resetCircuit();

  return {
    krxCode,
    corpCode,
    reportPeriod: bundle.label,
    revenueTrailing4Q: revenue,
    revenueGrowthYoY,
    operatingProfitTrailing4Q: operatingProfit,
    opMarginPct,
    eps,
    bps,
    annualDPS,
    asOf: new Date().toISOString().slice(0, 10),
  };
}
