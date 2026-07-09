import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { db } from "@/shared/lib/db/client";
import { memos } from "@/shared/lib/db/schema";
import { users } from "@/shared/lib/db/schema";
import { eq } from "drizzle-orm";
import { createMemo, listMemos, getMemo, updateMemo, deleteMemo } from "./memoRepo";

const USER_ID = "00000000-0000-0000-0000-000000000abc";

beforeAll(async () => {
  // 테스트 유저 확보 (FK 충족). 존재하면 무시.
  await db.insert(users).values({ id: USER_ID, email: "memo-test@example.com" }).onConflictDoNothing();
});
afterEach(async () => {
  await db.delete(memos).where(eq(memos.userId, USER_ID));
});

describe("memoRepo", () => {
  const base = { userId: USER_ID, source: "text" as const, title: "제목", rawContent: "원문", cleanedContent: "원문" };

  it("createMemo → getMemo 왕복", async () => {
    const created = await createMemo(base);
    const fetched = await getMemo(USER_ID, created.id);
    expect(fetched?.title).toBe("제목");
  });

  it("listMemos는 최신순으로 소유자 것만 반환한다", async () => {
    await createMemo({ ...base, title: "첫번째" });
    await createMemo({ ...base, title: "두번째" });
    const list = await listMemos(USER_ID);
    expect(list.length).toBe(2);
    expect(list[0].createdAt.getTime()).toBeGreaterThanOrEqual(list[1].createdAt.getTime());
  });

  it("getMemo는 다른 유저 메모에 null (소유 격리)", async () => {
    const created = await createMemo(base);
    const other = await getMemo("00000000-0000-0000-0000-000000000fff", created.id);
    expect(other).toBeNull();
  });

  it("updateMemo는 cleaned/title만 바꾸고 raw는 보존한다", async () => {
    const created = await createMemo(base);
    const updated = await updateMemo(USER_ID, created.id, { title: "수정", cleanedContent: "수정본" });
    expect(updated?.title).toBe("수정");
    expect(updated?.cleanedContent).toBe("수정본");
    expect(updated?.rawContent).toBe("원문"); // immutable
  });

  it("updateMemo는 다른 유저 메모를 못 바꾼다", async () => {
    const created = await createMemo(base);
    const result = await updateMemo("00000000-0000-0000-0000-000000000fff", created.id, { title: "x", cleanedContent: "x" });
    expect(result).toBeNull();
  });

  it("deleteMemo는 소유자 것만 삭제한다", async () => {
    const created = await createMemo(base);
    expect(await deleteMemo("00000000-0000-0000-0000-000000000fff", created.id)).toBe(false);
    expect(await deleteMemo(USER_ID, created.id)).toBe(true);
    expect(await getMemo(USER_ID, created.id)).toBeNull();
  });

  it("빈 content는 CHECK 제약으로 거부된다", async () => {
    await expect(createMemo({ ...base, rawContent: "", cleanedContent: "" })).rejects.toThrow();
  });
});
