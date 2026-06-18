// 캐시-cron 셰이프 모듈 — 세 cron route(`poll-gmail`, `morning-digest`, `generate-daily-fortunes`)가
// 공유하는 시퀀스를 단일 factory 로 묶는다.
//
// 시퀀스 (불변, 이 순서 고정):
//   1. verifyCronBearer(request)        → 실패 시 401 즉시 반환 (targetSelect/perTarget/extra 미호출)
//   2. targetSelect()                   → Target[] (drizzle query 자유)
//   3. per-target work + 부분 실패 격리 → concurrency 옵션 (기본 1=순차)
//   4. extra() (optional)               → cron-specific 글로벌 카운트
//   5. NextResponse.json (envelope)     → 완전 강제 셰이프
//
// 응답 envelope (강제):
//   { name, runAt, timezone, total, succeeded, failed, results: [{id,label?,status,payload?,error?}], extra? }
//
// 격리 정책:
//   - per-target throw → results[].status='error' + 200자 절단 메시지. 다른 target 진행 막지 않음.
//   - targetSelect 자체 throw 는 catch 안 함 (운영 fatal — 500).
//   - extra() throw 도 catch 안 함 (fatal).
//
// 두 번째 인증 방식(예: HMAC) 이 필요해지면 `bearerCheck?` 옵션으로 inject. 현재 YAGNI.

import "server-only";
import { NextResponse } from "next/server";
import { verifyCronBearer } from "@/shared/lib/auth/cron";
import { logger } from "@/shared/lib/log";

const ERROR_MAX_LEN = 200;

export interface CronHandlerDefinition<TTarget, TPayload> {
  /** Cron 이름 — envelope `name` 슬롯 + 로그 prefix. */
  name: string;
  /** 활성 대상 select. drizzle 쿼리 자유. */
  targetSelect: () => Promise<TTarget[]>;
  /** Target → id 추출. envelope results[].id 슬롯. */
  getId: (target: TTarget) => string;
  /** Target → 사람 친화 label (예: email). optional. envelope results[].label 슬롯. */
  getLabel?: (target: TTarget) => string;
  /** Per-target 작업. throw → status='error' + 200자 절단 메시지. */
  perTarget: (target: TTarget) => Promise<TPayload>;
  /** 동시성. 기본 1 (순차). LLM cron 은 2~3, push 는 10 권장. */
  concurrency?: number;
  /**
   * Per-target transient 재시도. opt-in (미지정 시 재시도 없음 — 기존 동작).
   * 알림 발송(digest/stock) cron 은 재시도 시 이중 발송이라 opt-in 으로 두고
   * 멱등(idempotent) cron(일진 — chart_id+for_date unique index) 만 활성화한다.
   * `shouldRetry` 로 재시도 불가 에러(예: BudgetExceededError)를 caller(app 레이어)
   * 가 주입 — shared 는 도메인 무지 유지 (FSD: shared → features import 금지).
   */
  retry?: {
    /** 총 시도 횟수 (재시도 포함). 1 이면 재시도 없음. */
    maxAttempts: number;
    /** 시도 간 지연(ms). transient blip 해소용 — 짧게(LLM 호출이 길어 cron 요청이 오래 열림). */
    backoffMs: number;
    /** true 면 재시도 / false 면 즉시 error 격리. 미지정 시 모든 에러 재시도. */
    shouldRetry?: (err: unknown) => boolean;
  };
  /** 글로벌 카운트 (target 단위 아닌 통계). envelope `extra` 슬롯. */
  extra?: () => Promise<Record<string, unknown>>;
}

export interface CronResultItem<TPayload> {
  id: string;
  label?: string;
  status: "ok" | "error";
  payload?: TPayload;
  error?: string;
}

export interface CronEnvelope<TPayload> {
  name: string;
  runAt: string;
  timezone: string;
  total: number;
  succeeded: number;
  failed: number;
  results: CronResultItem<TPayload>[];
  extra?: Record<string, unknown>;
}

/** Per-target throw → 200자 절단 메시지로 변환. */
function truncatedError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.length > ERROR_MAX_LEN ? raw.slice(0, ERROR_MAX_LEN) : raw;
}

type RetryPolicy = NonNullable<CronHandlerDefinition<unknown, unknown>["retry"]>;

/**
 * fn 을 retry 정책대로 시도. 마지막 시도 실패 또는 shouldRetry=false 면 throw.
 * 재시도 사이에만 backoff (마지막 시도 후 대기 없음).
 */
async function runWithRetry<T>(fn: () => Promise<T>, retry: RetryPolicy): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(retry.maxAttempts));
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const retryable = retry.shouldRetry ? retry.shouldRetry(err) : true;
      if (!retryable || attempt === maxAttempts) throw err;
      if (retry.backoffMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retry.backoffMs));
      }
    }
  }
  throw lastError;
}

/** Concurrency 만큼 worker 풀로 fan-out. 순서 보존. */
async function fanOut<TTarget, TPayload>(
  targets: TTarget[],
  concurrency: number,
  work: (target: TTarget, index: number) => Promise<CronResultItem<TPayload>>,
): Promise<CronResultItem<TPayload>[]> {
  if (targets.length === 0) return [];
  const limit = Math.max(1, Math.floor(concurrency));
  if (limit === 1) {
    // 순차 — 진단·재현 용이.
    const out: CronResultItem<TPayload>[] = [];
    for (let i = 0; i < targets.length; i += 1) {
      out.push(await work(targets[i], i));
    }
    return out;
  }
  // 병렬 worker 풀 — 결과는 input 순서 보존.
  const results: CronResultItem<TPayload>[] = new Array(targets.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, targets.length) }, async () => {
    while (true) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= targets.length) return;
      results[i] = await work(targets[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export function createCronHandler<TTarget, TPayload>(
  def: CronHandlerDefinition<TTarget, TPayload>,
): (request: Request) => Promise<NextResponse> {
  return async function cronHandler(request: Request) {
    // 1. bearer 검사 — 실패 시 즉시 401, targetSelect/perTarget/extra 미호출.
    if (!verifyCronBearer(request)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // 2. 활성 대상 select. throw 는 catch 안 함 (운영 fatal).
    const targets = await def.targetSelect();

    // 3. per-target work + 부분 실패 격리. concurrency 옵션 (기본 1).
    const results = await fanOut<TTarget, TPayload>(
      targets,
      def.concurrency ?? 1,
      async (target): Promise<CronResultItem<TPayload>> => {
        const id = def.getId(target);
        const label = def.getLabel?.(target);
        const base: CronResultItem<TPayload> = label != null
          ? { id, label, status: "ok" }
          : { id, status: "ok" };
        try {
          const payload = def.retry
            ? await runWithRetry(() => def.perTarget(target), def.retry)
            : await def.perTarget(target);
          return { ...base, payload };
        } catch (err) {
          // envelope는 HTTP 200이라 cron 컨테이너 로그엔 'OK 200'만 남고 개별 target
          // 에러는 2000자 절단 body에 묻힌다. target별 1줄 warn으로 jq 집계 가능하게.
          logger.warn(`cron/${def.name}`, "target-failed", {
            id,
            ...(label != null ? { label } : {}),
            error: truncatedError(err),
          });
          return { ...base, status: "error", error: truncatedError(err) };
        }
      },
    );

    // 4. extra (optional). throw 는 catch 안 함 (fatal).
    const extra = def.extra ? await def.extra() : undefined;

    // 5. envelope.
    const succeeded = results.filter((r) => r.status === "ok").length;
    const failed = results.length - succeeded;
    const envelope: CronEnvelope<TPayload> = {
      name: def.name,
      runAt: new Date().toISOString(),
      timezone: process.env.TZ ?? "(unset)",
      total: results.length,
      succeeded,
      failed,
      results,
      ...(extra !== undefined ? { extra } : {}),
    };
    if (failed > 0) {
      logger.warn(def.name, "partial-failure", { total: results.length, failed });
    }
    return NextResponse.json(envelope);
  };
}
