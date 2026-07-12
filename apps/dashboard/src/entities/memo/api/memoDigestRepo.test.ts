import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { memoDigests, users } from "@/shared/lib/db/schema";
import { insertDigest, hasDigest, getLatestDigest } from "./memoDigestRepo";

// memoRepo.test.ts 와 다른 고정 UUID — 병렬 테스트 파일 간 간섭 방지.
const USER_ID = "00000000-0000-0000-0000-000000000d16";

beforeAll(async () => {
  await db
    .insert(users)
    .values({ id: USER_ID, email: "memo-digest-test@example.com" })
    .onConflictDoNothing();
});
afterEach(async () => {
  await db.delete(memoDigests).where(eq(memoDigests.userId, USER_ID));
});

const base = {
  userId: USER_ID,
  weekEnd: "2026-07-05",
  summary: "지난주 요약",
  memoCount: 3,
  resurfacedMemoIds: [] as string[],
};

describe("memoDigestRepo", () => {
  it("insertDigest 왕복 — weekEnd·uuid[] 보존", async () => {
    const ids = ["00000000-0000-4000-8000-000000000001"];
    const row = await insertDigest({ ...base, resurfacedMemoIds: ids });
    expect(row?.weekEnd).toBe("2026-07-05");
    expect(row?.resurfacedMemoIds).toEqual(ids);
    expect(row?.memoCount).toBe(3);
  });

  it("같은 (user, weekEnd) 중복 삽입은 null (멱등 — 동시 실행 방어)", async () => {
    await insertDigest(base);
    const dup = await insertDigest({ ...base, summary: "다른 요약" });
    expect(dup).toBeNull();
    // 원본이 보존된다
    const latest = await getLatestDigest(USER_ID);
    expect(latest?.summary).toBe("지난주 요약");
  });

  it("hasDigest — 있으면 true, 없으면 false", async () => {
    expect(await hasDigest(USER_ID, "2026-07-05")).toBe(false);
    await insertDigest(base);
    expect(await hasDigest(USER_ID, "2026-07-05")).toBe(true);
    expect(await hasDigest(USER_ID, "2026-07-12")).toBe(false);
  });

  it("getLatestDigest는 weekEnd 최신 행을 반환한다", async () => {
    await insertDigest({ ...base, weekEnd: "2026-06-28", summary: "옛날" });
    await insertDigest({ ...base, weekEnd: "2026-07-05", summary: "최신" });
    const latest = await getLatestDigest(USER_ID);
    expect(latest?.summary).toBe("최신");
  });

  it("다이제스트 없는 사용자는 null", async () => {
    expect(await getLatestDigest("00000000-0000-0000-0000-000000000fff")).toBeNull();
  });
});
