// Cron 매시간 트리거 — 모든 활성 사용자의 inbox sync.
//
// 셰이프: createCronHandler factory 위임 (bearer / 부분 실패 격리 / envelope 모듈에 묻힘).
// caller 책임: 활성 대상 select, per-user work, concurrency 정책, extra(reauth) 카운트.
import { ne, eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { users } from "@/shared/lib/db/schema";
import { createCronHandler } from "@/shared/lib/cron/createCronHandler";
import { syncInbox } from "@/features/gmail-sync";

export const dynamic = "force-dynamic";

export const POST = createCronHandler({
  name: "poll-gmail",
  targetSelect: async () =>
    db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.oauthState, "active")),
  getId: (u) => u.id,
  getLabel: (u) => u.email,
  perTarget: async (u) => {
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
