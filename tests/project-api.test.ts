import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/shared/lib/db/client";
import { hosts, projects } from "@/shared/lib/db/schema";
import { getProjects } from "@/entities/project/api/getProjects";
import { upsertProjectFromContainer } from "@/entities/project/api/upsertProjectFromContainer";

let hostId: string;

beforeEach(async () => {
  await db.delete(projects);
  await db.delete(hosts);
  const [h] = await db
    .insert(hosts)
    .values({ name: "home-server", dockerContext: "home-server" })
    .returning({ id: hosts.id });
  hostId = h.id;
});

describe("project api", () => {
  it("getProjects: hidden 제외, pinned 우선, 알파벳 정렬", async () => {
    await db.insert(projects).values([
      { hostId, composeProject: "z-app", displayName: "Z App" },
      { hostId, composeProject: "a-app", displayName: "A App" },
      { hostId, composeProject: "pinned", displayName: "Pinned", isPinned: true },
      { hostId, composeProject: "hidden", displayName: "Hidden", isHidden: true },
    ]);
    const list = await getProjects(hostId);
    expect(list.map((p) => p.composeProject)).toEqual(["pinned", "a-app", "z-app"]);
  });

  it("upsertProjectFromContainer: 신규는 생성", async () => {
    const p = await upsertProjectFromContainer({
      hostId,
      composeProject: "news-prod",
    });
    expect(p.displayName).toBe("news-prod");
    expect(p.hostId).toBe(hostId);
  });

  it("upsertProjectFromContainer: 기존은 update_at만 갱신, displayName 보존", async () => {
    await db.insert(projects).values({
      hostId,
      composeProject: "news-prod",
      displayName: "뉴스 서비스 (운영)",
    });
    const p = await upsertProjectFromContainer({
      hostId,
      composeProject: "news-prod",
    });
    expect(p.displayName).toBe("뉴스 서비스 (운영)");
  });
});
