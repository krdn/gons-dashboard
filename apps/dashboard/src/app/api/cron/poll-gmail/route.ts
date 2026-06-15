// Cron 15분마다 트리거 — 설정 동기화 주기에 따라 due인 사용자만 sync.
//
// 셰이프: createCronHandler factory. perTarget에서 isSyncDue로 due 판정.
// 설정 syncIntervalMinutes(기본 60) 미경과 사용자는 skipped-not-due.
import { ne, eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { users } from "@/shared/lib/db/schema";
import { createCronHandler } from "@/shared/lib/cron/createCronHandler";
import { syncInbox } from "@/features/gmail-sync";
import { getEmailSettings, isSyncDue } from "@/entities/email-settings";

export const dynamic = "force-dynamic";

interface PollPayload {
  kind: string;
  classifiedCount?: number;
  skippedCount?: number;
}

export const POST = createCronHandler({
  name: "poll-gmail",
  targetSelect: async () =>
    db
      .select({
        id: users.id,
        email: users.email,
        lastSyncAt: users.lastSyncAt,
      })
      .from(users)
      .where(eq(users.oauthState, "active")),
  getId: (u) => u.id,
  getLabel: (u) => u.email,
  perTarget: async (u): Promise<PollPayload> => {
    const settings = await getEmailSettings(u.id);
    if (!isSyncDue(new Date(), u.lastSyncAt, settings.syncIntervalMinutes)) {
      return { kind: "skipped-not-due" };
    }
    const result = await syncInbox(u.id);
    return {
      kind: result.kind,
      classifiedCount: result.classifiedCount,
      skippedCount: result.skippedCount,
    };
  },
  concurrency: 5,
  extra: async () => {
    const reauth = await db
      .select({ id: users.id })
      .from(users)
      .where(ne(users.oauthState, "active"))
      .then((r) => r.length);
    return { reauthRequired: reauth };
  },
});
