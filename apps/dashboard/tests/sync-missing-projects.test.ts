// syncMissingProjects — observed vs known dedup → upsert 검증.
//
// upsertProjectFromContainer 만 mock 해서 호출 패턴·결과 정리만 검증.
// DB 통합은 기존 upsert-project-from-container 테스트 책임.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/entities/project/api/upsertProjectFromContainer", () => ({
  upsertProjectFromContainer: vi.fn(),
}));

import { upsertProjectFromContainer } from "@/entities/project/api/upsertProjectFromContainer";
import { syncMissingProjects } from "@/entities/project/api/syncMissingProjects";
import type { Project } from "@/entities/project/model/types";

const upsert = upsertProjectFromContainer as ReturnType<typeof vi.fn>;

function fakeProject(composeProject: string, over: Partial<Project> = {}): Project {
  return {
    id: `p-${composeProject}`,
    hostId: "host-1",
    composeProject,
    displayName: composeProject,
    description: null,
    category: null,
    url: null,
    isPinned: false,
    isHidden: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as Project;
}

beforeEach(() => {
  upsert.mockReset();
});

describe("syncMissingProjects", () => {
  it("unknown 0개 → upsert 미호출, [] 반환", async () => {
    const result = await syncMissingProjects({
      hostId: "h1",
      hostName: "home",
      observed: ["app-a", "app-b"],
      knownComposeKeys: ["app-a", "app-b"],
    });
    expect(result).toEqual([]);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("knownComposeKeys 에 hidden 포함 → dedup 정확 (thrash 방지)", async () => {
    // hidden=true 인 'app-c' 도 known 에 있음 → unknown 으로 분류되지 않아야 함.
    const result = await syncMissingProjects({
      hostId: "h1",
      hostName: "home",
      observed: ["app-c"],
      knownComposeKeys: ["app-a", "app-c"], // app-c hidden
    });
    expect(result).toEqual([]);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("observed 의 중복은 dedup 후 upsert 1회만", async () => {
    upsert.mockResolvedValue(fakeProject("new-x"));
    const result = await syncMissingProjects({
      hostId: "h1",
      hostName: "home",
      observed: ["new-x", "new-x", "new-x"],
      knownComposeKeys: [],
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith({
      hostId: "h1",
      hostName: "home",
      composeProject: "new-x",
    });
    expect(result).toHaveLength(1);
  });

  it("upsert null 반환분은 결과에서 제외", async () => {
    upsert
      .mockResolvedValueOnce(fakeProject("a"))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(fakeProject("c"));
    const result = await syncMissingProjects({
      hostId: "h1",
      hostName: "home",
      observed: ["a", "b", "c"],
      knownComposeKeys: [],
    });
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.composeProject)).toEqual(["a", "c"]);
  });

  it("observed 와 known 의 차집합만 upsert", async () => {
    upsert.mockResolvedValue(fakeProject("new-1"));
    await syncMissingProjects({
      hostId: "h1",
      hostName: "home",
      observed: ["existing", "new-1", "existing"],
      knownComposeKeys: ["existing", "another"],
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ composeProject: "new-1" }),
    );
  });
});
