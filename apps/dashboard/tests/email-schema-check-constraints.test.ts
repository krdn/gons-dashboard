// email 스키마 DB CHECK 제약 — 마이그레이션 술어가 코드 유니온과 1:1 인지 가드.
//
// 감사 §schema #4: severity/classifiedBy/category/importance/userAction/
// reply_language/reply_model/threshold 컬럼이 제약 없는 text() 라 마이그레이션·
// 수동 psql·향후 writer 가 잘못된 값을 넣어도 DB 가 거부 안 하던 문제.
// 0034_windy_aaron_stack.sql 이 10개 ADD CONSTRAINT CHECK 추가.
//
// 이 테스트의 가치 = drift 감지: 코드 유니온에 값을 추가하면서 마이그레이션을
// 안 고치면, 운영에서 새 값 INSERT 가 CHECK 위반으로 거부되는 사고를 빌드 타임에
// 잡는다. DB 불필요 — 마이그레이션 SQL 텍스트를 코드 유니온과 대조하는 순수 테스트.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { REPLY_LANGUAGES } from "@/entities/email-settings/model/types";
import { REPLY_MODEL_KEYS } from "@/entities/email-settings/model/replyModel";

const MIGRATION = readFileSync(
  join(__dirname, "..", "drizzle", "0034_windy_aaron_stack.sql"),
  "utf8",
);

// 마이그레이션의 한 CHECK 술어에서 IN (...) 의 리터럴 값들을 뽑는다.
function constraintValues(constraintName: string): string[] {
  const line = MIGRATION.split("\n").find((l) => l.includes(constraintName));
  if (!line) throw new Error(`constraint not found in migration: ${constraintName}`);
  const m = line.match(/IN \(([^)]+)\)/);
  if (!m) throw new Error(`no IN(...) clause for: ${constraintName}`);
  return m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
}

describe("email 스키마 CHECK 제약 (0034)", () => {
  it("10개 CHECK 제약을 모두 추가한다", () => {
    const adds = MIGRATION.match(/ADD CONSTRAINT/g) ?? [];
    expect(adds).toHaveLength(10);
  });

  // reply_needed — 코드 유니온(entities/email/model/types.ts) 과 1:1
  it("reply_needed.severity = Severity 유니온", () => {
    expect(constraintValues("reply_needed_severity_check").sort()).toEqual(
      ["high", "low", "med"], // Severity = 'high'|'med'|'low'
    );
  });

  it("reply_needed.classified_by = ClassifiedBy 유니온", () => {
    expect(constraintValues("reply_needed_classified_by_check").sort()).toEqual(
      ["deterministic", "llm-haiku"],
    );
  });

  it("reply_needed.user_action = UserAction 유니온", () => {
    expect(constraintValues("reply_needed_user_action_check").sort()).toEqual(
      ["dismissed", "none", "replied"],
    );
  });

  // important_emails
  it("important_emails.category = Category 유니온", () => {
    expect(constraintValues("important_emails_category_check").sort()).toEqual(
      ["money", "notice", "schedule", "security"],
    );
  });

  it("important_emails.importance = ImportantImportance 유니온", () => {
    expect(constraintValues("important_emails_importance_check").sort()).toEqual(
      ["high", "med"],
    );
  });

  it("important_emails.classified_by = ClassifiedBy 유니온 (공유 술어)", () => {
    expect(constraintValues("important_emails_classified_by_check").sort()).toEqual(
      ["deterministic", "llm-haiku"],
    );
  });

  // email_settings — Zod(_schema.ts)·entities/email-settings 유니온과 1:1
  it("email_settings.reply_severity_threshold = ['high','med','low']", () => {
    expect(constraintValues("email_settings_reply_severity_check").sort()).toEqual(
      ["high", "low", "med"],
    );
  });

  it("email_settings.important_threshold = ['high','med']", () => {
    expect(
      constraintValues("email_settings_important_threshold_check").sort(),
    ).toEqual(["high", "med"]);
  });

  // 런타임 const 와 직접 대조 — 유니온이 바뀌면 이 테스트가 새 마이그레이션을 요구.
  it("email_settings.reply_language = REPLY_LANGUAGES 런타임 유니온", () => {
    expect(constraintValues("email_settings_reply_language_check").sort()).toEqual(
      [...REPLY_LANGUAGES].sort(),
    );
  });

  it("email_settings.reply_model = REPLY_MODEL_KEYS 런타임 유니온", () => {
    expect(constraintValues("email_settings_reply_model_check").sort()).toEqual(
      [...REPLY_MODEL_KEYS].sort(),
    );
  });
});
