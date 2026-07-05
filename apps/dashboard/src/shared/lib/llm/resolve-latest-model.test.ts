import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// env mock — 폴백값을 결정적으로 고정.
vi.mock("@/shared/config/env", () => ({
  env: {
    ANTHROPIC_BASE_URL: "http://proxy.test",
    ANTHROPIC_API_KEY: "k",
    SAJU_LLM_MODEL_CLAUDE: "fallback-opus",
    SAJU_LLM_MODEL_CODEX: "fallback-gpt",
    SAJU_LLM_MODEL_GEMINI: "fallback-gemini",
  },
}));

vi.mock("@/shared/lib/log", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// 각 테스트가 fresh 모듈(캐시 초기화)을 얻도록 동적 import + resetModules.
async function freshResolve() {
  vi.resetModules();
  const mod = await import("./resolve-latest-model");
  return mod.resolveLatestModel;
}

function mockModelsResponse(ids: string[]) {
  return {
    ok: true,
    json: async () => ({ data: ids.map((id) => ({ id })) }),
  } as Response;
}

describe("resolveLatestModel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("프록시 목록에서 tier 최신 안정 모델을 선택한다", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockModelsResponse(["claude-opus-4-6", "claude-opus-4-8", "gpt-5.5"]),
    );
    const resolveLatestModel = await freshResolve();
    expect(await resolveLatestModel("opus")).toBe("claude-opus-4-8");
  });

  it("fetch 가 !ok 면 env 폴백을 반환하고 캐시하지 않는다", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, statusText: "x" } as Response);
    const resolveLatestModel = await freshResolve();
    expect(await resolveLatestModel("gpt")).toBe("fallback-gpt");

    // 캐시 안 함 → 다음 호출이 다시 fetch 하고, 이번엔 성공하면 실제 값 반환
    fetchMock.mockResolvedValueOnce(mockModelsResponse(["gpt-5.5"]));
    expect(await resolveLatestModel("gpt")).toBe("gpt-5.5");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fetch 가 throw 하면 env 폴백을 반환한다", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network"));
    const resolveLatestModel = await freshResolve();
    expect(await resolveLatestModel("gemini-pro")).toBe("fallback-gemini");
  });

  it("매칭 후보 0건이면 env 폴백을 반환한다", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockModelsResponse(["claude-sonnet-5", "gemini-2.5-flash"]),
    );
    const resolveLatestModel = await freshResolve();
    expect(await resolveLatestModel("opus")).toBe("fallback-opus");
  });

  it("성공 결과는 캐시되어 두 번째 호출이 fetch 를 다시 하지 않는다", async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(mockModelsResponse(["claude-opus-4-8"]));
    const resolveLatestModel = await freshResolve();
    expect(await resolveLatestModel("opus")).toBe("claude-opus-4-8");
    expect(await resolveLatestModel("opus")).toBe("claude-opus-4-8");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
