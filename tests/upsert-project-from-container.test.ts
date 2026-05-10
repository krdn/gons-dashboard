import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/lib/db/client", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(() => ({
          returning: vi.fn(async () => [
            {
              id: "p-uuid",
              hostId: "h-uuid",
              composeProject: "gons-dashboard",
              displayName: "gons-dashboard",
              description: null,
              category: null,
              url: null,
              isPinned: false,
              isHidden: false,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ]),
        })),
      })),
    })),
  },
}));

import { upsertProjectFromContainer } from "@/entities/project/api/upsertProjectFromContainer";
import { db } from "@/shared/lib/db/client";

describe("upsertProjectFromContainer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("화이트리스트에 있는 (host, compose) → DB insert 실행 + Project 반환", async () => {
    const result = await upsertProjectFromContainer({
      hostId: "h-uuid",
      hostName: "home-server",
      composeProject: "gons-dashboard",
    });
    expect(result).not.toBeNull();
    expect(result?.composeProject).toBe("gons-dashboard");
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("화이트리스트 외 compose → DB insert 없음 + null 반환", async () => {
    const result = await upsertProjectFromContainer({
      hostId: "h-uuid",
      hostName: "home-server",
      composeProject: "n8n",
    });
    expect(result).toBeNull();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("등록 안 된 host → DB insert 없음 + null 반환", async () => {
    const result = await upsertProjectFromContainer({
      hostId: "h-uuid",
      hostName: "unknown-host",
      composeProject: "gons-dashboard",
    });
    expect(result).toBeNull();
    expect(db.insert).not.toHaveBeenCalled();
  });
});
