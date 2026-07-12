import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { memoActionItems, memos, users } from "@/shared/lib/db/schema";
import { createMemo } from "./memoRepo";
import {
  insertActionItemsAndMark,
  listActionItemsByUser,
  updateActionItemStatus,
  listDueReminders,
  markActionItemReminded,
} from "./memoActionItemRepo";

// 다른 테스트 파일과 다른 고정 UUID — 병렬 파일 간 간섭 방지.
const USER_ID = "00000000-0000-0000-0000-000000000ac1";
const OTHER_USER = "00000000-0000-0000-0000-000000000ac2";

beforeAll(async () => {
  await db
    .insert(users)
    .values([
      { id: USER_ID, email: "memo-action-test@example.com" },
      { id: OTHER_USER, email: "memo-action-other@example.com" },
    ])
    .onConflictDoNothing();
});
afterEach(async () => {
  await db.delete(memos).where(eq(memos.userId, USER_ID)); // action items는 FK cascade
  await db.delete(memos).where(eq(memos.userId, OTHER_USER));
});

async function makeMemo(userId = USER_ID) {
  return createMemo({ userId, source: "text", title: "메모", rawContent: "본문", cleanedContent: "본문" });
}

const todo = { kind: "todo" as const, title: "위약금 문의", dueAt: null, allDay: false };

describe("insertActionItemsAndMark", () => {
  it("항목 삽입 + actions_extracted_at 마킹이 함께 이뤄진다", async () => {
    const memo = await makeMemo();
    expect(memo.actionsExtractedAt).toBeNull();

    const count = await insertActionItemsAndMark(memo.id, USER_ID, [todo]);
    expect(count).toBe(1);

    const [row] = await db.select().from(memos).where(eq(memos.id, memo.id));
    expect(row.actionsExtractedAt).not.toBeNull();
    const items = await listActionItemsByUser(USER_ID, ["proposed"]);
    expect(items.map((i) => i.title)).toEqual(["위약금 문의"]);
  });

  it("0건도 마킹한다 (재평가 차단)", async () => {
    const memo = await makeMemo();
    await insertActionItemsAndMark(memo.id, USER_ID, []);
    const [row] = await db.select().from(memos).where(eq(memos.id, memo.id));
    expect(row.actionsExtractedAt).not.toBeNull();
  });

  it("무효 kind는 CHECK 제약으로 트랜잭션 전체가 거부된다 (마킹도 롤백)", async () => {
    const memo = await makeMemo();
    await expect(
      insertActionItemsAndMark(memo.id, USER_ID, [
        { ...todo, kind: "meeting" as never },
      ]),
    ).rejects.toThrow();
    const [row] = await db.select().from(memos).where(eq(memos.id, memo.id));
    expect(row.actionsExtractedAt).toBeNull();
  });
});

describe("updateActionItemStatus — 상태 기계 + 소유권", () => {
  async function makeItem(status = "proposed") {
    const memo = await makeMemo();
    const rows = await db
      .insert(memoActionItems)
      .values({ memoId: memo.id, userId: USER_ID, ...todo, status })
      .returning();
    return rows[0];
  }

  it("proposed → accepted → done 정상 전이", async () => {
    const item = await makeItem();
    expect((await updateActionItemStatus(USER_ID, item.id, "accepted"))?.status).toBe("accepted");
    expect((await updateActionItemStatus(USER_ID, item.id, "done"))?.status).toBe("done");
  });

  it("불법 전이는 null — proposed에서 바로 done 불가", async () => {
    const item = await makeItem();
    expect(await updateActionItemStatus(USER_ID, item.id, "done")).toBeNull();
  });

  it("타인 항목은 null (소유 격리)", async () => {
    const item = await makeItem();
    expect(await updateActionItemStatus(OTHER_USER, item.id, "accepted")).toBeNull();
  });

  it("종단 상태(dismissed)에서 이동 불가", async () => {
    const item = await makeItem("dismissed");
    expect(await updateActionItemStatus(USER_ID, item.id, "accepted")).toBeNull();
    expect(await updateActionItemStatus(USER_ID, item.id, "done")).toBeNull();
  });
});

describe("listDueReminders / markActionItemReminded", () => {
  const NOW = new Date("2026-07-12T13:00:00Z");
  const past = new Date("2026-07-12T10:00:00Z");
  const future = new Date("2026-07-13T10:00:00Z");

  async function makeItemWith(over: Partial<typeof memoActionItems.$inferInsert>) {
    const memo = await makeMemo();
    const rows = await db
      .insert(memoActionItems)
      .values({ memoId: memo.id, userId: USER_ID, ...todo, ...over })
      .returning();
    return rows[0];
  }

  it("수락됨+기한 도래+미발송만 대상 — 상태·기한·발송 여부 조합 필터", async () => {
    const due = await makeItemWith({ status: "accepted", dueAt: past });
    await makeItemWith({ status: "accepted", dueAt: future }); // 미도래
    await makeItemWith({ status: "proposed", dueAt: past }); // 미수락
    await makeItemWith({ status: "accepted", dueAt: null }); // 기한 없음
    await makeItemWith({ status: "accepted", dueAt: past, remindedAt: past }); // 이미 발송

    const targets = (await listDueReminders(NOW, 100)).filter((i) => i.userId === USER_ID);
    expect(targets.map((i) => i.id)).toEqual([due.id]);
  });

  it("markActionItemReminded 후 대상에서 빠진다", async () => {
    const due = await makeItemWith({ status: "accepted", dueAt: past });
    await markActionItemReminded(due.id);
    const targets = (await listDueReminders(NOW, 100)).filter((i) => i.userId === USER_ID);
    expect(targets).toEqual([]);
    const [row] = await db
      .select()
      .from(memoActionItems)
      .where(and(eq(memoActionItems.id, due.id), eq(memoActionItems.userId, USER_ID)));
    expect(row.remindedAt).not.toBeNull();
  });
});
