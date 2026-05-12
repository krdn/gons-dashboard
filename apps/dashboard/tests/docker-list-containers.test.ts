import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRunDocker = vi.fn();
vi.mock("@/shared/lib/docker/runDocker", () => ({
  runDocker: (ctx: string, args: string[]) => mockRunDocker(ctx, args),
}));

let listContainers: typeof import("@/shared/lib/docker/listContainers").listContainers;

const HOST_ID = "11111111-1111-1111-1111-111111111111";

beforeEach(async () => {
  mockRunDocker.mockReset();
  ({ listContainers } = await import("@/shared/lib/docker/listContainers"));
});

const NDJSON_TWO = [
  JSON.stringify({
    ID: "abc",
    Names: "news-prod-api",
    State: "running",
    Status: "Up 3 days",
    Image: "img:1",
    Ports: "0.0.0.0:8000->8000/tcp",
    Labels: "com.docker.compose.project=news-prod,com.docker.compose.service=api",
    CreatedAt: "2026-05-07 10:23:11 +0900 KST",
  }),
  JSON.stringify({
    ID: "def",
    Names: "voice-api",
    State: "exited",
    Status: "Exited (0) 5d ago",
    Image: "img:2",
    Ports: "",
    Labels: "com.docker.compose.project=voice",
    CreatedAt: "2026-05-01 09:00:00 +0900 KST",
  }),
].join("\n") + "\n";

describe("listContainers", () => {
  it("--all --no-trunc --format json 으로 호출", async () => {
    mockRunDocker.mockResolvedValue("");
    await listContainers({ context: "home-server", hostId: HOST_ID });
    expect(mockRunDocker).toHaveBeenCalledWith("home-server", [
      "container", "ls", "--all", "--no-trunc", "--format", "{{json .}}",
    ]);
  });

  it("NDJSON 두 줄을 두 개의 ContainerSummary로 매핑", async () => {
    mockRunDocker.mockResolvedValue(NDJSON_TWO);
    const list = await listContainers({ context: "home-server", hostId: HOST_ID });
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe("news-prod-api");
    expect(list[1].state).toBe("exited");
  });

  it("빈 출력은 빈 배열", async () => {
    mockRunDocker.mockResolvedValue("");
    const list = await listContainers({ context: "home-server", hostId: HOST_ID });
    expect(list).toEqual([]);
  });

  it("malformed line 1개는 skip하고 warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockRunDocker.mockResolvedValue("not-json\n" + NDJSON_TWO);
    const list = await listContainers({ context: "home-server", hostId: HOST_ID });
    expect(list).toHaveLength(2);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
