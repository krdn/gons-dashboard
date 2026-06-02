// 통합 테스트 — TEST_DATABASE_URL 필요. DB 미연결 시 ECONNREFUSED skip OK.
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/shared/lib/db/client";
import { autopilotCycles } from "@/shared/lib/db/schema";
import { eq } from "drizzle-orm";
import { recordCycle } from "@/entities/autopilot-cycle/api/recordCycle";

const base = {
  id: "autopilot-2099-W01",
  date: "2099-01-05T00:00:00.000Z",
  mode: "shadow",
  candidateCount: 3,
  backlogTop3: [{ title: "x", score: 1, dedupKey: "x" }],
};

describe("recordCycle", () => {
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
  });
});
