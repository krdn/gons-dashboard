// eval fixture·결과 타입 — 순수 (LLM·DB 의존 없음).
// fixture는 합성 데이터만 (실제 개인 메일 X). spec 2026-06-17 §4.
import { z } from "zod";

// ── 답장 트랙 fixture ──────────────────────────────────────────────
// input은 ThreadInput과 구조 호환 (receivedAt은 fixture에서 생략 → 로드 시 채움).
export const ReplyFixtureSchema = z.object({
  id: z.string().min(1),
  /** 케이스 군 — A: 키워드+필요, B: 암시적 필요, C: 키워드 있으나 junk. */
  kind: z.enum(["A", "B", "C"]),
  input: z.object({
    subject: z.string(),
    snippet: z.string(),
    lastSenderEmail: z.string(),
    lastSenderName: z.string().optional(),
    ownerEmail: z.string(),
    lastSenderIsOwner: z.boolean(),
  }),
  expect: z.object({
    needsReply: z.boolean(),
    severity: z.enum(["high", "med", "low"]).optional(),
  }),
});
export type ReplyFixture = z.infer<typeof ReplyFixtureSchema>;

// ── 중요 트랙 fixture ──────────────────────────────────────────────
export const ImportantFixtureSchema = z.object({
  id: z.string().min(1),
  input: z.object({
    subject: z.string(),
    fromName: z.string().nullable(),
    fromEmail: z.string(),
    snippet: z.string(),
    receivedAtKst: z.string(),
  }),
  signals: z.object({
    hasListUnsubscribe: z.boolean(),
    hasListId: z.boolean(),
    precedence: z.string().nullable(),
    fromHeader: z.string().nullable(),
  }),
  expect: z.object({
    isMailingList: z.boolean(),
    category: z.enum(["money", "security", "schedule", "notice", "none"]).optional(),
    importance: z.enum(["high", "med"]).optional(),
  }),
});
export type ImportantFixture = z.infer<typeof ImportantFixtureSchema>;

export const ReplyFixtureArraySchema = z.array(ReplyFixtureSchema);
export const ImportantFixtureArraySchema = z.array(ImportantFixtureSchema);

// ── thresholds.json 스키마 (null = 베이스라인 미확정) ──────────────
export const ThresholdsSchema = z.object({
  replyDeterministic: z.object({ recall: z.number().nullable() }),
  replyLlm: z.object({
    precision: z.number().nullable(),
    recall: z.number().nullable(),
  }),
  importantLlm: z.object({
    categoryMacroF1: z.number().nullable(),
    importanceAccuracy: z.number().nullable(),
  }),
});
export type Thresholds = z.infer<typeof ThresholdsSchema>;
