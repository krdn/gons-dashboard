// Memo 도메인 — entities/memo.
// - memos: 텍스트/음성 메모. 원문(raw_content) + AI 정리본(cleaned_content) 둘 다 보관.
//   음성은 승인해야 저장하므로 DB의 모든 행은 승인 완료 상태.
import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  uuid,
  index,
  uniqueIndex,
  check,
  boolean,
  date,
  integer,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

// memo_categories: 메모 분류 태그 사전. 고정 enum이 아니라 행으로 관리 —
// LLM이 분류 시 새 태그를 생성하면 여기 upsert되어 코드 수정 없이 목록이 늘어난다
// (스펙 2026-07-13-memo-dynamic-categories). is_seed=true는 최초 6종.
export const memoCategories = pgTable(
  "memo_categories",
  {
    // slug — kebab-case 영문. FK 키·필터 파라미터로 안정적.
    id: text("id").primaryKey(),
    // 표시용 한글 라벨.
    labelKo: text("label_ko").notNull(),
    // 시드 6종 여부 — 표시 정렬·삭제 정책용.
    isSeed: boolean("is_seed").notNull().default(false),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    check("memo_categories_slug_format", sql`${t.id} ~ '^[a-z][a-z0-9-]*$' AND length(${t.id}) BETWEEN 1 AND 40`),
    check("memo_categories_label_len", sql`length(${t.labelKo}) BETWEEN 1 AND 20`),
  ],
);

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
    // MemoCategory slug — LLM 자동 분류. null = 미분류. FK로 존재하는 태그만 허용.
    category: text("category").references(() => memoCategories.id, { onDelete: "set null" }),
    // 액션 추출 시도 성공 시각 (0건도 기록). null = 미추출 — 48h 내 생성분만 cron 회수
    // (과거 백필 없음 — 오래된 메모의 상대 날짜는 기준점이 어긋남, 스펙 memo-action-extraction §3).
    actionsExtractedAt: timestamp("actions_extracted_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("memos_user_created_idx").on(t.userId, t.createdAt.desc()),
    check("memos_source_check", sql`${t.source} IN ('voice', 'text', 'agent')`),
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
    // TransformPresetId — 빌트인 프리셋 목록 (커스텀은 DB memo_transform_presets).
    preset: text("preset").notNull(),
    // 생성에 사용한 모델 (감사용).
    model: text("model").notNull(),
    content: text("content").notNull(),
    // 저장 시점 라벨 스냅샷 (null = 코드 라벨 폴백).
    presetLabel: text("preset_label"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memo_transformations_memo_preset_uq").on(t.memoId, t.preset),
    check(
      "memo_transformations_content_not_empty",
      sql`length(${t.content}) > 0`,
    ),
  ],
);

// memo_transform_presets: 빌트인 override(slug=빌트인 id) + 커스텀(slug='c-…').
// 행 없음 = 코드 기본값 (복구 = 행 삭제). 스펙 2026-07-09-memo-preset-settings.
export const memoTransformPresets = pgTable(
  "memo_transform_presets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    label: text("label").notNull(),
    instruction: text("instruction").notNull(),
    fidelityGuard: boolean("fidelity_guard").notNull().default(true),
    // null = 사용자 전체 기본 모델 상속.
    model: text("model").$type<"claude" | "codex" | "gemini">(),
    // 프록시 /v1/models에서 선택한 정확한 모델 ID. null이면 provider별 env 기본값.
    modelId: text("model_id"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memo_transform_presets_user_slug_uq").on(t.userId, t.slug),
    check(
      "memo_transform_presets_slug_format",
      sql`${t.slug} ~ '^[a-z0-9-]{1,40}$'`,
    ),
    check(
      "memo_transform_presets_label_len",
      sql`length(${t.label}) BETWEEN 1 AND 20`,
    ),
    check(
      "memo_transform_presets_instruction_len",
      sql`length(${t.instruction}) BETWEEN 1 AND 2000`,
    ),
    check(
      "memo_transform_presets_model_check",
      sql`${t.model} IS NULL OR ${t.model} IN ('claude', 'codex', 'gemini')`,
    ),
  ],
);

// memo_action_items: 메모에서 LLM이 추출한 할일·일정 제안 (스펙 2026-07-12-memo-action-extraction).
// user_id 비정규화 — 리마인더 cron·목록 조회가 memo JOIN 없이 사용자 스코프 질의.
// 상태 기계는 entities/memo/model/actionItem.ts의 ACTION_ITEM_ALLOWED_FROM이 단일 정의.
export const memoActionItems = pgTable(
  "memo_action_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memoId: uuid("memo_id")
      .notNull()
      .references(() => memos.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    // null = 기한 없음 (리마인더 없음).
    dueAt: timestamp("due_at", { mode: "date" }),
    allDay: boolean("all_day").notNull().default(false),
    status: text("status").notNull().default("proposed"),
    remindedAt: timestamp("reminded_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("memo_action_items_user_status_idx").on(t.userId, t.status),
    check("memo_action_items_kind_check", sql`${t.kind} IN ('todo', 'event')`),
    check(
      "memo_action_items_status_check",
      sql`${t.status} IN ('proposed', 'accepted', 'dismissed', 'done')`,
    ),
    check("memo_action_items_title_len", sql`length(${t.title}) BETWEEN 1 AND 200`),
  ],
);

// memo_digests: 주간 다이제스트 — 창 [직전 일요일 19:00 KST, week_end 일요일 19:00 KST).
// unique(user_id, week_end)가 멱등 키 (스펙 2026-07-12-memo-weekly-digest).
export const memoDigests = pgTable(
  "memo_digests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // 창을 닫는 일요일의 KST 날짜.
    weekEnd: date("week_end", { mode: "string" }).notNull(),
    // memo_count=0(빈 주 marker)이면 '' — push·LLM 없이 재평가만 차단.
    summary: text("summary").notNull(),
    memoCount: integer("memo_count").notNull(),
    // 재부상 메모 id 스냅샷 — FK 없음, 표시 시점에 삭제된 메모는 조용히 생략.
    resurfacedMemoIds: uuid("resurfaced_memo_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("memo_digests_user_week_uq").on(t.userId, t.weekEnd)],
);

// 사용자별 메모 변환 전체 기본 모델. 행 없음도 claude로 해석해 마이그레이션 전 동작을 보존한다.
export const memoTransformSettings = pgTable(
  "memo_transform_settings",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    defaultModel: text("default_model")
      .$type<"claude" | "codex" | "gemini">()
      .notNull()
      .default("claude"),
    defaultModelId: text("default_model_id"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "memo_transform_settings_default_model_check",
      sql`${t.defaultModel} IN ('claude', 'codex', 'gemini')`,
    ),
  ],
);
