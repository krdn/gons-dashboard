import { describe, it, expect } from "vitest";
import { parseContainer } from "@/shared/lib/docker/parseContainer";

const HOST_ID = "11111111-1111-1111-1111-111111111111";

const SAMPLE = {
  ID: "abc123def456",
  Names: "news-prod-api",
  State: "running",
  Status: "Up 3 days",
  Image: "ghcr.io/krdn/news-api:latest",
  Ports: "0.0.0.0:8000->8000/tcp",
  Labels:
    "com.docker.compose.project=news-prod,com.docker.compose.service=api,maintainer=gon",
  CreatedAt: "2026-05-07 10:23:11 +0900 KST",
};

describe("parseContainer", () => {
  it("정상 입력을 ContainerSummary로 매핑한다", () => {
    const c = parseContainer(SAMPLE, HOST_ID);
    expect(c.id).toBe("abc123def456");
    expect(c.name).toBe("news-prod-api");
    expect(c.hostId).toBe(HOST_ID);
    expect(c.composeProject).toBe("news-prod");
    expect(c.composeService).toBe("api");
    expect(c.state).toBe("running");
    expect(c.statusText).toBe("Up 3 days");
    expect(c.image).toBe("ghcr.io/krdn/news-api:latest");
  });

  it("compose 라벨 없으면 composeProject/Service가 null", () => {
    const c = parseContainer(
      { ...SAMPLE, Labels: "maintainer=gon" },
      HOST_ID,
    );
    expect(c.composeProject).toBeNull();
    expect(c.composeService).toBeNull();
  });

  it("Labels가 빈 문자열이어도 안전하게 동작", () => {
    const c = parseContainer({ ...SAMPLE, Labels: "" }, HOST_ID);
    expect(c.composeProject).toBeNull();
  });

  it("Ports를 PortMapping[]으로 파싱", () => {
    const c = parseContainer(SAMPLE, HOST_ID);
    expect(c.ports).toEqual([
      { host: "0.0.0.0", hostPort: 8000, container: 8000, protocol: "tcp" },
    ]);
  });

  it("State가 enum 외 값이면 throw", () => {
    expect(() =>
      parseContainer({ ...SAMPLE, State: "zombie" }, HOST_ID),
    ).toThrow();
  });

  it("uptimeSeconds는 Status가 'Up Xd'면 추정, 아니면 null", () => {
    expect(parseContainer({ ...SAMPLE, Status: "Up 3 days" }, HOST_ID).uptimeSeconds)
      .toBe(3 * 86_400);
    expect(parseContainer({ ...SAMPLE, Status: "Exited (0) 5d ago" }, HOST_ID).uptimeSeconds)
      .toBeNull();
  });
});
