import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { db } from "@/shared/lib/db/client";
import { memoTransformPresets, users } from "@/shared/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  listPresetsByUser,
  getPresetBySlug,
  upsertPreset,
  insertPreset,
  deletePresetBySlug,
  countCustomPresets,
} from "./memoPresetRepo";

const USER_ID = "00000000-0000-0000-0000-000000000abf";
const OTHER_ID = "00000000-0000-0000-0000-000000000ac0";

beforeAll(async () => {
  await db
    .insert(users)
    .values([
      { id: USER_ID, email: "memo-preset-test@example.com" },
      { id: OTHER_ID, email: "memo-preset-other@example.com" },
    ])
    .onConflictDoNothing();
});
afterEach(async () => {
  await db.delete(memoTransformPresets).where(eq(memoTransformPresets.userId, USER_ID));
  await db.delete(memoTransformPresets).where(eq(memoTransformPresets.userId, OTHER_ID));
});

const customInput = {
  userId: USER_ID,
  slug: "c-abc12345",
  label: "코칭",
  instruction: "스타일: 코칭.",
  fidelityGuard: true,
};

describe("memoPresetRepo", () => {
  it("upsertPreset은 신규 (userId, slug)면 새로 생성한다", async () => {
    const created = await upsertPreset(customInput);
    expect(created.id).toBeDefined();
    expect(created.slug).toBe("c-abc12345");
    expect(created.label).toBe("코칭");
  });

  it("같은 (userId, slug) upsert는 교체한다 (행 1개 유지, updatedAt 갱신)", async () => {
    const first = await upsertPreset(customInput);
    await new Promise((r) => setTimeout(r, 5)); // updatedAt 단조 증가 보장용 (같은 ms 타이 방지)
    const second = await upsertPreset({ ...customInput, label: "냉정", instruction: "스타일: 냉정." });
    expect(second.id).toBe(first.id);
    expect(second.updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime());
    expect(second.label).toBe("냉정");
    const list = await listPresetsByUser(USER_ID);
    expect(list).toHaveLength(1);
  });

  it("getPresetBySlug는 미존재면 null을 반환한다", async () => {
    const result = await getPresetBySlug(USER_ID, "c-nonexistent");
    expect(result).toBeNull();
  });

  it("deletePresetBySlug는 삭제됐으면 true, 미존재면 false를 반환한다", async () => {
    await upsertPreset(customInput);
    const deleted = await deletePresetBySlug(USER_ID, "c-abc12345");
    expect(deleted).toBe(true);
    const deletedAgain = await deletePresetBySlug(USER_ID, "c-abc12345");
    expect(deletedAgain).toBe(false);
  });

  it("countCustomPresets는 빌트인 slug(tidy) 행을 제외하고 c-* 만 센다", async () => {
    await insertPreset({ ...customInput, slug: "c-abc12345" });
    await insertPreset({ ...customInput, slug: "c-def67890", label: "논리" });
    await insertPreset({
      userId: USER_ID,
      slug: "tidy",
      label: "정돈override",
      instruction: "스타일: 정돈.",
      fidelityGuard: true,
    });
    const count = await countCustomPresets(USER_ID);
    expect(count).toBe(2);
  });

  it("listPresetsByUser는 소유자 행만 반환한다", async () => {
    await upsertPreset(customInput);
    await upsertPreset({ ...customInput, userId: OTHER_ID });
    const list = await listPresetsByUser(USER_ID);
    expect(list).toHaveLength(1);
    expect(list[0].userId).toBe(USER_ID);
  });
});
