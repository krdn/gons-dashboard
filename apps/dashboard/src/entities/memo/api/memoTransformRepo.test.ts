import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { db } from "@/shared/lib/db/client";
import { memos, memoTransformations, users } from "@/shared/lib/db/schema";
import { eq } from "drizzle-orm";
import { createMemo } from "./memoRepo";
import { upsertTransformation, listTransformationsByUser } from "./memoTransformRepo";

const USER_ID = "00000000-0000-0000-0000-000000000abd";
const OTHER_ID = "00000000-0000-0000-0000-000000000abe";

beforeAll(async () => {
  await db
    .insert(users)
    .values([
      { id: USER_ID, email: "memo-transform-test@example.com" },
      { id: OTHER_ID, email: "memo-transform-other@example.com" },
    ])
    .onConflictDoNothing();
});
afterEach(async () => {
  await db.delete(memos).where(eq(memos.userId, USER_ID));
  await db.delete(memos).where(eq(memos.userId, OTHER_ID));
});

const base = { userId: USER_ID, source: "text" as const, title: "제목", rawContent: "원문", cleanedContent: "원문" };

describe("memoTransformRepo", () => {
  it("같은 (memo, preset) 재저장은 교체한다 (새 행 아님)", async () => {
    const memo = await createMemo(base);
    const first = await upsertTransformation({ memoId: memo.id, preset: "summary", model: "m1", content: "v1" });
    const second = await upsertTransformation({ memoId: memo.id, preset: "summary", model: "m2", content: "v2" });
    expect(second.id).toBe(first.id);
    const list = await listTransformationsByUser(USER_ID);
    expect(list).toHaveLength(1);
    expect(list[0].content).toBe("v2");
    expect(list[0].model).toBe("m2");
  });

  it("다른 preset은 병존한다", async () => {
    const memo = await createMemo(base);
    await upsertTransformation({ memoId: memo.id, preset: "summary", model: "m", content: "요약" });
    await upsertTransformation({ memoId: memo.id, preset: "todos", model: "m", content: "- [ ] 할일" });
    expect(await listTransformationsByUser(USER_ID)).toHaveLength(2);
  });

  it("listTransformationsByUser는 소유자 것만 반환한다", async () => {
    const mine = await createMemo(base);
    const others = await createMemo({ ...base, userId: OTHER_ID });
    await upsertTransformation({ memoId: mine.id, preset: "summary", model: "m", content: "a" });
    await upsertTransformation({ memoId: others.id, preset: "summary", model: "m", content: "b" });
    const list = await listTransformationsByUser(USER_ID);
    expect(list).toHaveLength(1);
    expect(list[0].memoId).toBe(mine.id);
  });

  it("메모 삭제 시 변환본이 cascade 삭제된다", async () => {
    const memo = await createMemo(base);
    await upsertTransformation({ memoId: memo.id, preset: "summary", model: "m", content: "a" });
    await db.delete(memos).where(eq(memos.id, memo.id));
    const rows = await db.select().from(memoTransformations).where(eq(memoTransformations.memoId, memo.id));
    expect(rows).toHaveLength(0);
  });

  it("허용 외 preset은 CHECK 제약으로 거부된다", async () => {
    const memo = await createMemo(base);
    await expect(
      upsertTransformation({ memoId: memo.id, preset: "nope" as never, model: "m", content: "a" }),
    ).rejects.toThrow();
  });
});
