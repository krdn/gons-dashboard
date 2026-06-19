import "server-only";
import { sql, and, eq, gte, lt } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { llmSpendLog } from "@/shared/lib/db/schema";

export class BudgetExceededError extends Error {
  constructor(public spentKrw: number, public budgetKrw: number) {
    super(`saju LLM budget exceeded: ${spentKrw}/${budgetKrw} KRW today (KST)`);
    this.name = "BudgetExceededError";
  }
}

function todayKstRange(): { start: Date; end: Date } {
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const kstMidnight = new Date(Date.UTC(
    kstNow.getUTCFullYear(),
    kstNow.getUTCMonth(),
    kstNow.getUTCDate(),
  ));
  const start = new Date(kstMidnight.getTime() - 9 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

async function getTodaySajuSpendKrw(): Promise<number> {
  const { start, end } = todayKstRange();
  const [row] = await db
    .select({ total: sql<string>`COALESCE(SUM(${llmSpendLog.krw}), 0)` })
    .from(llmSpendLog)
    .where(and(
      eq(llmSpendLog.feature, "saju"),
      gte(llmSpendLog.createdAt, start),
      lt(llmSpendLog.createdAt, end),
    ));
  return Number(row?.total ?? 0);
}

export async function assertSajuBudgetOk(budgetKrw: number): Promise<void> {
  const spent = await getTodaySajuSpendKrw();
  if (spent >= budgetKrw) throw new BudgetExceededError(spent, budgetKrw);
}

export async function logSajuSpend(input: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  krw: number;
}): Promise<void> {
  await db.insert(llmSpendLog).values({
    feature: "saju",
    model: input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    krw: input.krw.toString(),
  });
}
