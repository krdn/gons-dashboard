// 사용자 email 설정 조회 — row 없으면 EMAIL_SETTINGS_DEFAULTS.
// 위젯/cron/분류기의 단일 진실 소스(spec 불변식).
import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { emailSettings } from "@/shared/lib/db/schema";
import type { Severity, ImportantImportance } from "@krdn/email";
import {
  EMAIL_SETTINGS_DEFAULTS,
  type EmailSettings,
  type ReplyLanguage,
} from "../model/types";

export const getEmailSettings = cache(
  async (userId: string): Promise<EmailSettings> => {
    const [row] = await db
      .select()
      .from(emailSettings)
      .where(eq(emailSettings.userId, userId))
      .limit(1);

    if (!row) return { ...EMAIL_SETTINGS_DEFAULTS };

    return {
      replyNeededLimit: row.replyNeededLimit,
      importantLimit: row.importantLimit,
      windowDays: row.windowDays,
      replySeverityThreshold: row.replySeverityThreshold as Severity,
      importantThreshold: row.importantThreshold as ImportantImportance,
      categories: row.categories,
      llmReplyEnabled: row.llmReplyEnabled,
      llmImportantEnabled: row.llmImportantEnabled,
      syncIntervalMinutes: row.syncIntervalMinutes,
      digestEnabled: row.digestEnabled,
      digestHourKst: row.digestHourKst,
      replyLanguage: row.replyLanguage as ReplyLanguage,
    };
  },
);
