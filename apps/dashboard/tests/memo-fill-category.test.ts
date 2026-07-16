// fillMemoCategoryWithTag 트랜잭션 통합 테스트 — 경합 패자의 rollback이 방금
// 등록한 신규 태그까지 원복하는지(전역 카테고리 사전의 고아 태그 오염 방지)는
// mock으로 검증할 수 없어 실 DB로 확인한다.
// 프리픽스는 고정(런별 Date.now() 금지) — 크래시로 afterAll을 못 탄 실행의
// user·태그 잔재를 beforeAll 정리가 자가 치유하고, 잔재 누적·email unique 충돌을 막는다.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { users, memos, memoCategories } from "@/shared/lib/db/schema";
import { fillMemoCategoryWithTag, setMemoCategoryOwned } from "@/entities/memo/server";

const PREFIX = "fillcat-test";
const EMAIL = `${PREFIX}@test.local`;
const MANUAL_TAG = `${PREFIX}-manual`;

let userId: string;

async function cleanupFixtures() {
  await db.delete(users).where(eq(users.email, EMAIL)); // cascade — memos 동반 삭제
  await db.delete(memoCategories).where(like(memoCategories.id, `${PREFIX}%`));
}

async function insertMemo(): Promise<string> {
  const rows = await db
    .insert(memos)
    .values({
      userId,
      source: "text",
      title: `${PREFIX} 제목`,
      rawContent: "본문",
      cleanedContent: "본문",
    })
    .returning({ id: memos.id });
  return rows[0].id;
}

async function tagExists(id: string): Promise<boolean> {
  const rows = await db.select({ id: memoCategories.id }).from(memoCategories).where(eq(memoCategories.id, id));
  return rows.length > 0;
}

beforeAll(async () => {
  await cleanupFixtures();
  const rows = await db.insert(users).values({ email: EMAIL }).returning({ id: users.id });
  userId = rows[0].id;
  // 수동 정정용 태그 사전 등록 (setMemoCategoryOwned는 FK상 존재 태그만 가능).
  await db.insert(memoCategories).values({ id: MANUAL_TAG, labelKo: "수동", isSeed: false });
});

afterAll(cleanupFixtures);

describe("fillMemoCategoryWithTag — 태그 등록+채움 단일 트랜잭션", () => {
  it("미분류 메모를 채우고 신규 태그를 등록한다", async () => {
    const memoId = await insertMemo();
    const tag = `${PREFIX}-win`;

    const filled = await fillMemoCategoryWithTag(memoId, tag, "승자");

    expect(filled).toBe(true);
    const memo = await db.select({ category: memos.category }).from(memos).where(eq(memos.id, memoId));
    expect(memo[0].category).toBe(tag);
    expect(await tagExists(tag)).toBe(true);
  });

  it("수동 정정이 선행되면 false — 신규 태그도 rollback되어 고아가 남지 않는다", async () => {
    const memoId = await insertMemo();
    // LLM 응답 대기 중 사용자가 수동 정정한 상황 재현.
    expect(await setMemoCategoryOwned(userId, memoId, MANUAL_TAG)).toBe(true);
    const lateTag = `${PREFIX}-late`;

    const filled = await fillMemoCategoryWithTag(memoId, lateTag, "늦은분류");

    expect(filled).toBe(false);
    const memo = await db.select({ category: memos.category }).from(memos).where(eq(memos.id, memoId));
    expect(memo[0].category).toBe(MANUAL_TAG); // 사용자 선택 유지
    expect(await tagExists(lateTag)).toBe(false); // 핵심 — 버려진 분류의 태그 원복
  });

  it("기존 태그로 승리해도 라벨은 최초 등록본을 유지한다 (onConflictDoNothing)", async () => {
    const memoId = await insertMemo();

    const filled = await fillMemoCategoryWithTag(memoId, MANUAL_TAG, "다른라벨");

    expect(filled).toBe(true);
    const rows = await db
      .select({ labelKo: memoCategories.labelKo })
      .from(memoCategories)
      .where(eq(memoCategories.id, MANUAL_TAG));
    expect(rows[0].labelKo).toBe("수동");
  });

  it("기존 태그로 패배해도 그 태그는 남는다 (rollback은 이번 INSERT만 원복)", async () => {
    const memoId = await insertMemo();
    expect(await setMemoCategoryOwned(userId, memoId, MANUAL_TAG)).toBe(true);

    const filled = await fillMemoCategoryWithTag(memoId, MANUAL_TAG, "라벨무시");

    expect(filled).toBe(false);
    expect(await tagExists(MANUAL_TAG)).toBe(true); // 사전 존재 태그는 DO NOTHING이라 무영향
  });
});
