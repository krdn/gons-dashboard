// 통합 테스트 — TEST_DATABASE_URL 필요. 미명시 시 describe.skip (로컬 DB 미기동 환경 안전).
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/shared/lib/db/client";
import { autopilotCycles } from "@/shared/lib/db/schema";
import { eq } from "drizzle-orm";
import { recordCycle } from "@/entities/autopilot-cycle/api/recordCycle";

const skipIfNoDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const base = {
  id: "autopilot-2099-W01",
  date: "2099-01-05T00:00:00.000Z",
  mode: "shadow",
  candidateCount: 3,
  backlogTop3: [{ title: "x", score: 1, dedupKey: "x" }],
};

skipIfNoDb("recordCycle", () => {
  beforeEach(async () => {
    await db.delete(autopilotCycles).where(eq(autopilotCycles.id, base.id));
  });

  it("같은 id로 두 번 호출해도 1 row이며 값이 갱신된다 (멱등 upsert)", async () => {
    await recordCycle({ ...base, candidateCount: 3 });
    await recordCycle({ ...base, candidateCount: 7, mode: "autonomous" });

    const rows = await db.select().from(autopilotCycles).where(eq(autopilotCycles.id, base.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].candidateCount).toBe(7);
    expect(rows[0].mode).toBe("autonomous");
    // 이 task의 핵심 매핑(date→runAt): 두 호출 모두 같은 date를 쓰므로 갱신 후에도 그 값 유지.
    expect(rows[0].runAt).toEqual(new Date("2099-01-05T00:00:00.000Z"));
  });
});
