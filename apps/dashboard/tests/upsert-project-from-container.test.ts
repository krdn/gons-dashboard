import { describe, it, expect, vi, beforeEach } from "vitest";

// drizzle 체이닝을 흉내내는 가벼운 mock. insert 결과는 입력값을 그대로 흘려보내
// 어떤 compose project 라도 등록 가능함을 검증할 수 있게 한다.
let lastValues: Record<string, unknown> | null = null;
vi.mock("@/shared/lib/db/client", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn((v: Record<string, unknown>) => {
        lastValues = v;
        return {
          onConflictDoUpdate: vi.fn(() => ({
            returning: vi.fn(async () => [
              {
                id: "p-uuid",
                hostId: v.hostId,
                composeProject: v.composeProject,
                displayName: v.displayName,
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
        };
      }),
    })),
  },
}));

import { upsertProjectFromContainer } from "@/entities/project/api/upsertProjectFromContainer";
import { db } from "@/shared/lib/db/client";

describe("upsertProjectFromContainer (자동 등록)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastValues = null;
  });

  it("hint 목록에 있는 (host, compose) → DB insert 실행 + Project 반환", async () => {
    const result = await upsertProjectFromContainer({
      hostId: "h-uuid",
      hostName: "home-server",
      composeProject: "gons-dashboard",
    });
    expect(result).not.toBeNull();
    expect(result?.composeProject).toBe("gons-dashboard");
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("hint 외 compose 도 자동 등록된다 (화이트리스트 폐지)", async () => {
    const result = await upsertProjectFromContainer({
      hostId: "h-uuid",
      hostName: "home-server",
      composeProject: "n8n",
    });
    expect(result).not.toBeNull();
    expect(result?.composeProject).toBe("n8n");
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("hint 에 없는 host 라도 자동 등록된다", async () => {
    const result = await upsertProjectFromContainer({
      hostId: "h-uuid",
      hostName: "unknown-host",
      composeProject: "anything",
    });
    expect(result).not.toBeNull();
    expect(result?.composeProject).toBe("anything");
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("displayName 의 초기값은 compose key 와 동일", async () => {
    await upsertProjectFromContainer({
      hostId: "h-uuid",
      hostName: "home-server",
      composeProject: "brand-new-stack",
    });
    expect(lastValues).not.toBeNull();
    expect(lastValues?.displayName).toBe("brand-new-stack");
    expect(lastValues?.composeProject).toBe("brand-new-stack");
  });
});
