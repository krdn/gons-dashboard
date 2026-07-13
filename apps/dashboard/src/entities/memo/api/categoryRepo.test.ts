import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/shared/lib/db/client";
import { memoCategories } from "@/shared/lib/db/schema";
import { listCategories, upsertCategory } from "./categoryRepo";

// 통합 테스트 — TEST_DATABASE_URL 필요. DB 미연결 시 ECONNREFUSED로 skip 취급.
describe("categoryRepo", () => {
  beforeEach(async () => {
    // 비-시드 태그만 정리 (시드는 마이그레이션이 보장).
    await db.delete(memoCategories).where(eq(memoCategories.isSeed, false));
  });

  it("upsertCategory는 새 태그를 등록한다", async () => {
    await upsertCategory("meeting-log", "회의록");
    const rows = await listCategories();
    expect(rows.find((r) => r.id === "meeting-log")?.labelKo).toBe("회의록");
  });

  it("upsertCategory는 멱등 — 기존 id는 라벨을 덮어쓰지 않는다", async () => {
    await upsertCategory("meeting-log", "회의록");
    await upsertCategory("meeting-log", "다른라벨");
    const rows = await listCategories();
    expect(rows.find((r) => r.id === "meeting-log")?.labelKo).toBe("회의록");
  });

  it("listCategories는 시드를 먼저 반환한다", async () => {
    await upsertCategory("meeting-log", "회의록");
    const rows = await listCategories();
    const seedCount = rows.filter((r) => r.isSeed).length;
    // 시드가 앞쪽 seedCount개를 차지.
    expect(rows.slice(0, seedCount).every((r) => r.isSeed)).toBe(true);
  });
});
