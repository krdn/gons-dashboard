// 캐시-리딩 모듈 — 사주 리딩 3종(섹션 리딩 / 세운 / 일진)이 공유하는 단일 책임 모듈.
//
// 시퀀스 (불변, 이 순서 고정):
//   1. cache.read by where()  → row 존재 + row.model 일치 + row.promptVersion 일치 시 hit
//   2. assertSajuBudgetOk     → 초과 시 BudgetExceededError 위로 propagate
//   3. callLlm(prompt)        → 기본 callSajuLlm, 단위 테스트 시 caller 가 inject 가능
//   4. validator(rawBody)     → throw 시 caller 에게 그대로 propagate (재시도 없음)
//   5. logSajuSpend           → validate 성공 후에만 기록 ("validated outputs only")
//   6. UPSERT                 → caller 가 toRow + conflictTarget 제공
//
// Cache hit 정의:
//   row 존재 + row.model === env.SAJU_LLM_MODEL + row.promptVersion === input.promptVersion.
//   둘 중 하나라도 mismatch 면 miss (drift 종류 구분 없음 — 어차피 재생성).
//
// 재시도 정책:
//   모듈은 retry 모름. validate throw / LLM throw / BudgetExceededError 모두 그대로 propagate.
//   caller (예: 일진) 가 try/catch 로 재시도 정책 직접 처리.
//
// 의존성:
//   db, callSajuLlm, assertSajuBudgetOk, logSajuSpend, env.SAJU_LLM_MODEL, env.SAJU_LLM_DAILY_BUDGET_KRW
//   는 모두 모듈 *내부* 에서 직접 import. caller 는 모름.
//   두 번째 production caller (non-saju feature) 가 생기면 callSajuLlm 을 정식 port 로 승격하고
//   shared/lib/llm/cached.ts 로 모듈 이동 (현재는 Q7(c) 결정 — One adapter = hypothetical seam).

import "server-only";
import type { SQL } from "drizzle-orm";
import type { PgTable, PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/shared/lib/db/client";
import { env } from "@/shared/config/env";
import { callSajuLlm } from "./llm-client";
import { assertSajuBudgetOk, logSajuSpend } from "./budget";

/** raw body 를 도메인 데이터로 변환. throw → caller 가 잡음 (재시도 등). */
type Validator<TData> = (rawBody: string) => TData;

/** UPSERT row 매핑. (data, meta) → INSERT/UPDATE set 컬럼. caller-specific. */
type ToRow<TData> = (
  data: TData,
  meta: { model: string; promptVersion: string },
) => Record<string, unknown>;

export interface CachedReadingInput<TTable extends PgTable, TData> {
  /** 캐시 테이블. `model`, `promptVersion` 컬럼 필수. */
  table: TTable;
  /** 캐시 키 — composite condition (chartId + section/year/forDate 등). */
  where: SQL;
  /** ON CONFLICT target — 같은 unique index 의 컬럼 셋. */
  conflictTarget: PgColumn[];
  /** 프롬프트 — 결정적 계산은 caller 가 미리 끝내서 넘긴다. */
  prompt: { system: string; user: string; maxTokens: number };
  /** 프롬프트 버전 — model 과 함께 cache 무효화 키. */
  promptVersion: string;
  /** raw body → 도메인 데이터. 기본 identity (TData=string 일 때만 안전). 일진은 JSON+Zod. */
  validator?: Validator<TData>;
  /** UPSERT row 매핑. */
  toRow: ToRow<TData>;
  /** cache hit 시 row → data 추출. 기본 row.body (string). 일진은 row.payload. */
  fromRow?: (row: TTable["$inferSelect"]) => TData;
  /** 단위 테스트용 escape hatch. 미지정 시 callSajuLlm 직접 호출. */
  callLlm?: typeof callSajuLlm;
}

export interface CachedReadingResult<TData> {
  data: TData;
  cached: boolean;
}

/** 일반형 — 일진처럼 structured payload 가 필요한 caller. */
export async function cachedReading<TTable extends PgTable, TData>(
  input: CachedReadingInput<TTable, TData>,
): Promise<CachedReadingResult<TData>> {
  const model = env.SAJU_LLM_MODEL;
  const validator = input.validator ?? ((s: string) => s as unknown as TData);
  const fromRow =
    input.fromRow ??
    ((row: TTable["$inferSelect"]) => (row as { body: string }).body as unknown as TData);
  const callLlm = input.callLlm ?? callSajuLlm;

  // 1. cache.read
  const [cached] = await db
    .select()
    .from(input.table as PgTable)
    .where(input.where)
    .limit(1);

  if (
    cached &&
    (cached as { model: string }).model === model &&
    (cached as { promptVersion: string }).promptVersion === input.promptVersion
  ) {
    return { data: fromRow(cached as TTable["$inferSelect"]), cached: true };
  }

  // 2. 예산 가드 (cache miss 시에만)
  await assertSajuBudgetOk(env.SAJU_LLM_DAILY_BUDGET_KRW);

  // 3. LLM 호출
  const llm = await callLlm({
    system: input.prompt.system,
    user: input.prompt.user,
    maxTokens: input.prompt.maxTokens,
  });

  // 4. validate (throw → propagate; spend 미기록)
  const data = validator(llm.body);

  // 5. spend log (validate 성공 후에만)
  await logSajuSpend({
    model: llm.model,
    inputTokens: llm.inputTokens,
    outputTokens: llm.outputTokens,
    krw: llm.krw,
  });

  // 6. UPSERT
  const row = input.toRow(data, { model: llm.model, promptVersion: input.promptVersion });
  await db
    .insert(input.table as PgTable)
    // drizzle 의 InsertValue<TTable> 는 generic 으로 좁히기 어려워 Record 로 받음.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .values(row as any)
    .onConflictDoUpdate({
      target: input.conflictTarget,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set: { ...row, createdAt: new Date() } as any,
    });

  return { data, cached: false };
}

/** 공통 case sugar — markdown body, validator/fromRow/toRow 기본값. 섹션 리딩, 세운에 사용. */
export interface CachedMarkdownInput<TTable extends PgTable> {
  table: TTable;
  where: SQL;
  conflictTarget: PgColumn[];
  prompt: { system: string; user: string; maxTokens: number };
  promptVersion: string;
  /** body/model/promptVersion 외 컬럼 — caller-specific (chartId, section, yearStem 등). */
  extraColumns: Record<string, unknown>;
  callLlm?: typeof callSajuLlm;
}

export async function cachedMarkdownReading<TTable extends PgTable>(
  input: CachedMarkdownInput<TTable>,
): Promise<CachedReadingResult<string>> {
  return cachedReading<TTable, string>({
    table: input.table,
    where: input.where,
    conflictTarget: input.conflictTarget,
    prompt: input.prompt,
    promptVersion: input.promptVersion,
    validator: (s) => s,
    fromRow: (row) => (row as { body: string }).body,
    toRow: (body, meta) => ({
      ...input.extraColumns,
      body,
      model: meta.model,
      promptVersion: meta.promptVersion,
    }),
    callLlm: input.callLlm,
  });
}
