// entities/autopilot-cycle — Zod 입력 스키마.
// cron 라우트(POST /api/cron/autopilot-cycle)가 본문 검증에 사용.
// cycle.workflow.js 반환 합집합(no-candidate / gate-failed / 정상 PR)을 수용하므로
// 선정·PR 필드는 모두 optional/nullable.
// 입력 JSON 키는 `date` — recordCycle 이 DB 컬럼 runAt 에 매핑한다 (CLAUDE.md 매핑 주의).
import { z } from "zod";

const BacklogCandidate = z.object({
  title: z.string(),
  score: z.number(),
  dedupKey: z.string(),
});

const DebateEntry = z.object({
  title: z.string(),
  owner: z.string(),
  score: z.number(),
  changeType: z.string(),
  dedupKey: z.string(),
  crossReview: z
    .array(
      z.object({
        challenge: z.string(),
        severity: z.enum(["low", "medium", "high"]),
        wouldBlock: z.boolean(),
      }),
    )
    .default([]),
  verdicts: z
    .array(
      z.object({
        valueScore: z.number(),
        safetyScore: z.number(),
        feasibilityScore: z.number(),
        reasoning: z.string(),
      }),
    )
    .default([]),
});

export const AutopilotCycleInput = z.object({
  id: z.string().min(1),
  date: z.string().datetime({ offset: true }),
  mode: z.string().min(1),
  deployFlag: z.enum(["on", "off"]).optional(),
  candidateCount: z.number().int().min(0),

  selected: z
    .object({
      title: z.string(),
      owner: z.string().optional(),
      score: z.number().optional(),
      changeType: z.string().optional(),
    })
    .nullable()
    .optional(),

  prUrl: z.string().url().nullable().optional(),
  merged: z.boolean().optional(),
  needsHuman: z.boolean().optional(),
  reason: z.string().nullable().optional(),

  backlogTop3: z.array(BacklogCandidate).default([]),
  debate: z
    .object({
      selected: DebateEntry.nullable(),
      backlogTop3: z.array(DebateEntry).default([]),
    })
    .nullable()
    .optional(),
});

export type AutopilotCycleInput = z.infer<typeof AutopilotCycleInput>;
