// Memo 도메인 — entities/memo.
// - memos: 텍스트/음성 메모. 원문(raw_content) + AI 정리본(cleaned_content) 둘 다 보관.
//   음성은 승인해야 저장하므로 DB의 모든 행은 승인 완료 상태.
import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uuid, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { users } from "./auth";

export const memos = pgTable(
  "memos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // 'voice' | 'text' — CHECK 제약으로 강제 (drizzle enum 아님).
    source: text("source").notNull(),
    // 자동 파생 시에도 저장 시점에 확정값을 넣는다 (목록 렌더 단순화).
    title: text("title").notNull(),
    // 음성: 받아쓰기 원문 / 텍스트: 입력 그대로. 생성 후 immutable.
    rawContent: text("raw_content").notNull(),
    // 음성: AI 클린업본 / 텍스트: raw와 동일. 편집 대상.
    cleanedContent: text("cleaned_content").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("memos_user_created_idx").on(t.userId, t.createdAt.desc()),
    check("memos_source_check", sql`${t.source} IN ('voice', 'text')`),
    check("memos_raw_not_empty", sql`length(${t.rawContent}) > 0`),
    check("memos_cleaned_not_empty", sql`length(${t.cleanedContent}) > 0`),
  ],
);

// memo_transformations: 저장된 메모의 스타일 변환본 (요약·할일 등).
// 메모당 프리셋당 1개 — 재생성은 UNIQUE(memo_id, preset) upsert로 교체.
// 원문(raw)·정리본(cleaned)은 불변, 변환본은 병존 (스펙 2026-07-09-memo-transform).
export const memoTransformations = pgTable(
  "memo_transformations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memoId: uuid("memo_id")
      .notNull()
      .references(() => memos.id, { onDelete: "cascade" }),
    // TransformPresetId — CHECK 제약으로 강제 (entities/memo/model/types.ts와 동기).
    preset: text("preset").notNull(),
    // 생성에 사용한 모델 (감사용).
    model: text("model").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memo_transformations_memo_preset_uq").on(t.memoId, t.preset),
    check(
      "memo_transformations_preset_check",
      sql`${t.preset} IN ('tidy', 'polish', 'summary', 'structured', 'todos', 'journal', 'email')`,
    ),
    check("memo_transformations_content_not_empty", sql`length(${t.content}) > 0`),
  ],
);
