// LLM 비용 집계 (이슈 #323 §I) — KST 일/월 경계.
//
// ⚠️ 집계 범위는 **사주뿐**이다. llm_spend_log 에 INSERT 하는 경로가
// logSajuSpend 하나뿐이라(이메일·메모의 logLlmSpend 는 구조화 로그에만 남긴다),
// 이 테이블을 "전체 LLM 비용"으로 읽으면 대부분을 누락한다. 전체 비용 통합은
// Phase 4 항목이다. 위젯 제목에도 범위를 밝힌다.
import "server-only";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { llmSpendLog } from "@/shared/lib/db/schema";
import { kstDayRange, kstMonthRange } from "@/shared/lib/kst-range";

export interface LlmSpendSummary {
  todayKrw: number;
  monthKrw: number;
  /** 오늘의 모델별 내역 — 비용이 튄 원인을 바로 보기 위함. */
  todayByModel: { model: string; krw: number; calls: number }[];
}

async function sumKrw(start: Date, end: Date): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(${llmSpendLog.krw}), 0)` })
    .from(llmSpendLog)
    .where(
      and(
        eq(llmSpendLog.feature, "saju"),
        gte(llmSpendLog.createdAt, start),
        lt(llmSpendLog.createdAt, end),
      ),
    );
  return Number(row?.total ?? 0);
}

export async function getSajuLlmSpend(now: Date): Promise<LlmSpendSummary> {
  const day = kstDayRange(now);
  const month = kstMonthRange(now);

  const [todayKrw, monthKrw, byModel] = await Promise.all([
    sumKrw(day.start, day.end),
    sumKrw(month.start, month.end),
    db
      .select({
        model: llmSpendLog.model,
        krw: sql<string>`COALESCE(SUM(${llmSpendLog.krw}), 0)`,
        calls: sql<number>`COUNT(*)::int`,
      })
      .from(llmSpendLog)
      .where(
        and(
          eq(llmSpendLog.feature, "saju"),
          gte(llmSpendLog.createdAt, day.start),
          lt(llmSpendLog.createdAt, day.end),
        ),
      )
      .groupBy(llmSpendLog.model)
      .orderBy(sql`SUM(${llmSpendLog.krw}) DESC`),
  ]);

  return {
    todayKrw,
    monthKrw,
    todayByModel: byModel.map((r) => ({
      model: r.model,
      krw: Number(r.krw),
      calls: r.calls,
    })),
  };
}
