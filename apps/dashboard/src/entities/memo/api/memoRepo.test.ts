import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { db } from "@/shared/lib/db/client";
import { memos, memoTransformations } from "@/shared/lib/db/schema";
import { users } from "@/shared/lib/db/schema";
import { eq } from "drizzle-orm";
import { createMemo, listMemos, getMemo, updateMemo, deleteMemo, searchMemos } from "./memoRepo";

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

describe("searchMemos", () => {
  const OTHER_USER = "00000000-0000-0000-0000-000000000fff";

  it("제목·원문·정리본 어디서든 매칭한다", async () => {
    await createMemo({ userId: USER_ID, source: "text", title: "인터넷 해지", rawContent: "본문A", cleanedContent: "본문A" });
    await createMemo({ userId: USER_ID, source: "voice", title: "제목B", rawContent: "위약금 십칠만원", cleanedContent: "정리본B" });
    await createMemo({ userId: USER_ID, source: "text", title: "제목C", rawContent: "본문C", cleanedContent: "페르소나 설정 기법" });

    expect((await searchMemos(USER_ID, "해지")).memos.map((m) => m.title)).toEqual(["인터넷 해지"]);
    expect((await searchMemos(USER_ID, "위약금")).memos.map((m) => m.title)).toEqual(["제목B"]);
    expect((await searchMemos(USER_ID, "페르소나")).memos.map((m) => m.title)).toEqual(["제목C"]);
  });

  it("토큰 간 AND — 서로 다른 필드에 걸쳐도 한 메모 안에서 모두 일치해야 한다", async () => {
    await createMemo({ userId: USER_ID, source: "text", title: "LG유플러스", rawContent: "위약금 문의", cleanedContent: "위약금 문의" });
    await createMemo({ userId: USER_ID, source: "text", title: "LG전자", rawContent: "세탁기", cleanedContent: "세탁기" });

    const { memos: hits } = await searchMemos(USER_ID, "LG 위약금");
    expect(hits.map((m) => m.title)).toEqual(["LG유플러스"]);
  });

  it("AI 변환본 내용으로도 매칭한다", async () => {
    const memo = await createMemo({ userId: USER_ID, source: "text", title: "회의", rawContent: "회의록", cleanedContent: "회의록" });
    await db.insert(memoTransformations).values({
      memoId: memo.id, preset: "todos", model: "claude-sonnet-5", content: "할일: 견적서 발송",
    });

    expect((await searchMemos(USER_ID, "견적서")).memos.map((m) => m.id)).toEqual([memo.id]);
  });

  it("다른 유저 메모는 검색되지 않는다 (소유 격리)", async () => {
    await createMemo({ userId: USER_ID, source: "text", title: "공유어휘", rawContent: "x", cleanedContent: "x" });
    expect((await searchMemos(OTHER_USER, "공유어휘")).memos).toEqual([]);
  });

  it("LIKE 메타문자는 리터럴로 매칭한다", async () => {
    await createMemo({ userId: USER_ID, source: "text", title: "할인 100%", rawContent: "x", cleanedContent: "x" });
    await createMemo({ userId: USER_ID, source: "text", title: "할인 100원", rawContent: "x", cleanedContent: "x" });

    const { memos: hits } = await searchMemos(USER_ID, "100%");
    expect(hits.map((m) => m.title)).toEqual(["할인 100%"]);
  });

  it("최신순으로 정렬한다", async () => {
    await createMemo({ userId: USER_ID, source: "text", title: "먼저", rawContent: "공통어", cleanedContent: "공통어" });
    await createMemo({ userId: USER_ID, source: "text", title: "나중", rawContent: "공통어", cleanedContent: "공통어" });

    const { memos: hits } = await searchMemos(USER_ID, "공통어");
    expect(hits.length).toBe(2);
    expect(hits[0].createdAt.getTime()).toBeGreaterThanOrEqual(hits[1].createdAt.getTime());
  });

  it("빈 쿼리는 빈 결과", async () => {
    await createMemo({ userId: USER_ID, source: "text", title: "아무거나", rawContent: "x", cleanedContent: "x" });
    expect(await searchMemos(USER_ID, "   ")).toEqual({ memos: [], truncated: false });
  });

  it("상한 초과 시 truncated=true, 정확히 상한이면 false (센티널 +1 조회)", async () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({
      userId: USER_ID,
      source: "text",
      title: `대량 ${i}`,
      rawContent: "센티널검증",
      cleanedContent: "센티널검증",
    }));
    await db.insert(memos).values(rows);

    const over = await searchMemos(USER_ID, "센티널검증");
    expect(over.memos.length).toBe(50);
    expect(over.truncated).toBe(true);

    await db.delete(memos).where(eq(memos.title, "대량 50"));
    const exact = await searchMemos(USER_ID, "센티널검증");
    expect(exact.memos.length).toBe(50);
    expect(exact.truncated).toBe(false);
  });
});
