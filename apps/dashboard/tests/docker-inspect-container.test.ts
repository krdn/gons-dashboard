import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRunDocker = vi.fn();
vi.mock("@/shared/lib/docker/runDocker", () => ({
  runDocker: (ctx: string, args: string[]) => mockRunDocker(ctx, args),
}));

let inspectContainer: typeof import("@/shared/lib/docker/inspectContainer").inspectContainer;
type ContainerSummary = import("@/shared/lib/docker").ContainerSummary;

const HOST_ID = "11111111-1111-1111-1111-111111111111";

const BASE: ContainerSummary = {
  id: "abc",
  name: "news-api",
  hostId: HOST_ID,
  composeProject: "news-prod",
  composeService: "api",
  state: "running",
  statusText: "Up 3 days",
  uptimeSeconds: 3 * 86_400,
  image: "img:1",
  ports: [],
  createdAt: "2026-05-07",
};

beforeEach(async () => {
  mockRunDocker.mockReset();
  ({ inspectContainer } = await import("@/shared/lib/docker/inspectContainer"));
});

const minimalInspect = (overrides: Record<string, unknown> = {}) => [
  {
    Id: "abc",
    Name: "/news-api",
    State: { Status: "running" },
    RestartCount: 0,
    Image: "sha256:abcdef",
    Config: {
      Image: "img:1",
      Env: ["NODE_ENV=production", "API_KEY=supersecret", "PORT=8000"],
      Labels: { "com.docker.compose.project": "news-prod" },
    },
    Mounts: [
      { Type: "bind", Source: "/data", Destination: "/app/data" },
    ],
    ...overrides,
  },
];

describe("docker.inspectContainer", () => {
  it("정상 입력 → ContainerInspect (envMasked, mounts, imageDigest 포함)", async () => {
    mockRunDocker.mockResolvedValue(JSON.stringify(minimalInspect()));
    const r = await inspectContainer("home-server", "abc", BASE);
    expect(r.restartCount).toBe(0);
    expect(r.imageDigest).toBe("sha256:abcdef");
    expect(r.mounts).toEqual([
      { source: "/data", target: "/app/data", type: "bind" },
    ]);
    // env 마스킹: API_KEY → ***, NODE_ENV/PORT → 평문
    const env = Object.fromEntries(r.envMasked.map((e) => [e.key, e.value]));
    expect(env.API_KEY).toBe("***");
    expect(env.NODE_ENV).toBe("production");
    expect(env.PORT).toBe("8000");
  });

  it("Image가 sha256:로 시작하지 않으면 imageDigest는 null", async () => {
    mockRunDocker.mockResolvedValue(
      JSON.stringify(minimalInspect({ Image: "nginx:latest" })),
    );
    const r = await inspectContainer("home-server", "abc", BASE);
    expect(r.imageDigest).toBeNull();
  });

  it("Labels가 null이어도 안전하게 빈 객체 처리", async () => {
    mockRunDocker.mockResolvedValue(
      JSON.stringify(
        minimalInspect({
          Config: {
            Image: "img:1",
            Env: [],
            Labels: null,
          },
        }),
      ),
    );
    const r = await inspectContainer("home-server", "abc", BASE);
    expect(r.labels).toEqual({});
  });

  it("inspect가 빈 배열을 반환하면 throw", async () => {
    mockRunDocker.mockResolvedValue("[]");
    await expect(
      inspectContainer("home-server", "abc", BASE),
    ).rejects.toThrow(/empty/);
  });
});
