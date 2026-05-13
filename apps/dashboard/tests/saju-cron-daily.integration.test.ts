// /api/cron/generate-daily-fortunes 통합 테스트.
//
// 검증:
//   - bearer 누락/오답 → 401
//   - 정상 bearer + 활성 프로필×차트 → 200, succeeded ≥ 1, saju_daily_fortunes row 추가
//
// LLM 호출은 callSajuLlm/budget을 mock — DB & generateDailyFortune 흐름만 검증.
// 환경변수는 vi.hoisted로 imports 이전에 보장(env.ts는 Zod로 모듈 로드 시 frozen).

/* eslint-disable @typescript-eslint/no-explicit-any -- integration test fixtures */

import { vi } from "vitest";

const TEST_BEARER = vi.hoisted(() => {
  // env.ts는 모듈 로드 시 Zod로 process.env를 한 번에 파싱한다.
  // beforeEach에서 process.env를 바꿔도 이미 frozen된 env 객체에는 영향 없음.
  const cron = "test-cron-bearer-token-padded-aaaaaaaaaa";
  process.env.CRON_BEARER_TOKEN ??= cron;
  process.env.ADMIN_EMAILS ??= "krdn.net@gmail.com";
  process.env.NEXTAUTH_SECRET ??= "test-secret-at-least-32-chars-padded!!";
  process.env.NEXTAUTH_URL ??= "http://localhost:3020";
  process.env.GOOGLE_CLIENT_ID ??= "test-google-client-id";
  process.env.GOOGLE_CLIENT_SECRET ??= "test-google-client-secret";
  process.env.ANTHROPIC_BASE_URL ??= "http://localhost:8317";
  process.env.ANTHROPIC_API_KEY ??= "test-anthropic-key";
  process.env.MCP_DASHBOARD_TOKEN ??= "test-mcp-token-aaaaaaaaaaaaaaaaaaaaaaaa";
  process.env.ALLOWLIST_EMAILS ??= "krdn.net@gmail.com";
  return process.env.CRON_BEARER_TOKEN as string;
});

vi.mock("@/features/saju-reading/lib/llm-client", () => ({
  callSajuLlm: vi.fn().mockResolvedValue({
    body: JSON.stringify({
      summary: "테스트 일진",
      overallScore: 3,
      scores: [
        { label: "재물", score: 3, note: "..." },
        { label: "일", score: 3, note: "..." },
        { label: "관계", score: 3, note: "..." },
        { label: "건강", score: 3, note: "..." },
        { label: "학습", score: 3, note: "..." },
      ],
      hourly: Array.from({ length: 8 }, (_, i) => ({
        range: `${String(5 + i * 2).padStart(2, "0")}–${String(7 + i * 2).padStart(2, "0")}`,
        vibe: "...",
      })),
      recommendations: ["..."],
      cautions: ["..."],
      remedy: { colors: ["청"], directions: ["북"], foods: ["..."], items: ["..."] },
      closing: "...",
    }),
    inputTokens: 1000,
    outputTokens: 500,
    krw: 100,
    model: "claude-opus-4-7",
  }),
}));

vi.mock("@/features/saju-reading/lib/budget", () => ({
  assertSajuBudgetOk: vi.fn().mockResolvedValue(undefined),
  logSajuSpend: vi.fn().mockResolvedValue(undefined),
  BudgetExceededError: class extends Error {},
}));

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import {
  fortuneProfiles,
  sajuCharts,
  sajuDailyFortunes,
  users,
} from "@/shared/lib/db/schema";

const TEST_USER_ID = "00000000-0000-0000-0000-000000099991";
const TEST_PROFILE_ID = "00000000-0000-0000-0000-000000099992";
const TEST_CHART_ID = "00000000-0000-0000-0000-000000099993";

describe("/api/cron/generate-daily-fortunes integration", () => {
  beforeAll(async () => {
    await db
      .insert(users)
      .values({
        id: TEST_USER_ID,
        email: "saju-cron-test@example.com",
      })
      .onConflictDoNothing();
    await db
      .insert(fortuneProfiles)
      .values({
        id: TEST_PROFILE_ID,
        userId: TEST_USER_ID,
        name: "테스트",
        relation: "self",
        birthDate: "1967-03-29",
        birthTime: "05:30",
        calendar: "solar",
        gender: "male",
        birthCity: null,
        isActive: true,
      })
      .onConflictDoNothing();
    await db
      .insert(sajuCharts)
      .values({
        id: TEST_CHART_ID,
        profileId: TEST_PROFILE_ID,
        inputHash: "test-hash",
        yearStem: "丁",
        yearBranch: "未",
        monthStem: "癸",
        monthBranch: "卯",
        dayStem: "壬",
        dayBranch: "辰",
        hourStem: "癸",
        hourBranch: "卯",
        elements: { wood: 2, fire: 1, earth: 2, metal: 0, water: 3 },
        strength: "strong",
        tenGods: {},
        pattern: "傷官格",
        yongSin: ["fire", "earth"],
        giSin: ["earth", "water"],
        majorFortunes: [],
      } as any)
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await db.delete(sajuCharts).where(eq(sajuCharts.id, TEST_CHART_ID));
    await db
      .delete(fortuneProfiles)
      .where(eq(fortuneProfiles.id, TEST_PROFILE_ID));
    await db.delete(users).where(eq(users.id, TEST_USER_ID));
  });

  it("bearer 토큰 없이 호출 → 401", async () => {
    const { POST } = await import(
      "@/app/api/cron/generate-daily-fortunes/route"
    );
    const res = await POST(
      new Request("http://localhost/api/cron/generate-daily-fortunes", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("올바른 토큰 → 활성 프로필 × 오늘 일진 생성 + saju_daily_fortunes row 추가", async () => {
    const { POST } = await import(
      "@/app/api/cron/generate-daily-fortunes/route"
    );
    const res = await POST(
      new Request("http://localhost/api/cron/generate-daily-fortunes", {
        method: "POST",
        headers: { authorization: `Bearer ${TEST_BEARER}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.succeeded).toBeGreaterThanOrEqual(1);

    const rows = await db
      .select()
      .from(sajuDailyFortunes)
      .where(eq(sajuDailyFortunes.chartId, TEST_CHART_ID));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].dayStem).toBeDefined();
    expect(rows[0].payload).toBeDefined();

    // cleanup
    await db
      .delete(sajuDailyFortunes)
      .where(eq(sajuDailyFortunes.chartId, TEST_CHART_ID));
  });
});
