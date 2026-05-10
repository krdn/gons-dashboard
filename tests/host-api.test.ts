import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/shared/lib/db/client";
import { hosts } from "@/shared/lib/db/schema";
import { getHosts } from "@/entities/host/api/getHosts";
import { getHostByName } from "@/entities/host/api/getHostByName";

describe("host api", () => {
  beforeEach(async () => {
    await db.delete(hosts);
  });

  it("getHosts: isActive만 반환, 이름 오름차순", async () => {
    await db.insert(hosts).values([
      { name: "z-host", dockerContext: "z", isActive: true },
      { name: "a-host", dockerContext: "a", isActive: true },
      { name: "inactive", dockerContext: "i", isActive: false },
    ]);
    const list = await getHosts();
    expect(list.map((h) => h.name)).toEqual(["a-host", "z-host"]);
  });

  it("getHostByName: 일치하는 호스트 반환", async () => {
    await db.insert(hosts).values({
      name: "home-server",
      dockerContext: "home-server",
      description: "192.168.0.5",
    });
    const h = await getHostByName("home-server");
    expect(h).not.toBeNull();
    expect(h!.dockerContext).toBe("home-server");
  });

  it("getHostByName: 없으면 null", async () => {
    const h = await getHostByName("nope");
    expect(h).toBeNull();
  });
});
