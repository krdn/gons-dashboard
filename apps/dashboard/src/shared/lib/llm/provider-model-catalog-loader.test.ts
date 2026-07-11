import { describe, expect, it, vi } from "vitest";
import {
  createProviderModelCatalogLoader,
  type ProviderModelCatalogPolicy,
} from "./provider-model-catalog-loader";

const defaults = {
  claude: "claude-sonnet-5",
  codex: "gpt-5.5",
  gemini: "gemini-2.5-pro",
};

function policy(
  overrides: Partial<ProviderModelCatalogPolicy> = {},
): ProviderModelCatalogPolicy {
  return { defaults, defaultMode: "always", ...overrides };
}

describe("createProviderModelCatalogLoader", () => {
  it("always는 기본값을 앞에 두고 live 모델을 분류·중복 제거·정렬한다", async () => {
    const load = createProviderModelCatalogLoader(async () => [
      "claude-opus-4-8",
      "claude-opus-4-8",
      "gpt-5.4",
      "o3-pro",
      "gemini-3.1-pro",
    ]);
    await expect(load(policy())).resolves.toEqual({
      source: "live",
      catalog: {
        claude: ["claude-sonnet-5", "claude-opus-4-8"],
        codex: ["gpt-5.5", "o3-pro", "gpt-5.4"],
        gemini: ["gemini-2.5-pro", "gemini-3.1-pro"],
      },
    });
  });

  it("source-failure-only의 live 결과에는 기본값을 강제 삽입하지 않는다", async () => {
    const load = createProviderModelCatalogLoader(async () => [
      "claude-opus-4-8",
      "gpt-5.4",
      "gemini-3.1-pro",
    ]);
    const result = await load(policy({ defaultMode: "source-failure-only" }));
    expect(result).toEqual({
      source: "live",
      catalog: {
        claude: ["claude-opus-4-8"],
        codex: ["gpt-5.4"],
        gemini: ["gemini-3.1-pro"],
      },
    });
  });

  it("source 예외와 유효 모델 없는 응답은 기본값 fallback이다", async () => {
    const report = vi.fn();
    const offline = createProviderModelCatalogLoader(async () => {
      throw new Error("offline secret body");
    }, report);
    await expect(offline(policy())).resolves.toMatchObject({
      source: "fallback",
      catalog: {
        claude: ["claude-sonnet-5"],
        codex: ["gpt-5.5"],
        gemini: ["gemini-2.5-pro"],
      },
    });
    expect(report).toHaveBeenCalledWith({ reason: "connection" });

    const empty = createProviderModelCatalogLoader(async () => ["other-model"]);
    await expect(empty(policy())).resolves.toMatchObject({
      source: "fallback",
    });
  });

  it("allow를 원격 모델과 fallback 기본값에 적용한다", async () => {
    const load = createProviderModelCatalogLoader(async () => [
      "claude-haiku-4-5",
      "claude-opus-4-8",
    ]);
    const result = await load(
      policy({
        allow: { claude: (id) => !id.toLowerCase().includes("haiku") },
      }),
    );
    expect(result.catalog.claude).toEqual([
      "claude-sonnet-5",
      "claude-opus-4-8",
    ]);
  });

  it("source-failure-only fallback에서도 allow가 기본값에 적용된다", async () => {
    const load = createProviderModelCatalogLoader(async () => {
      throw new Error("offline");
    });
    const result = await load(
      policy({
        defaultMode: "source-failure-only",
        allow: { claude: () => false },
      }),
    );
    expect(result.source).toBe("fallback");
    expect(result.catalog.claude).toEqual([]);
  });

  it("정적 정책 오류는 source 호출 전에 실패한다", async () => {
    const source = vi.fn(async () => ["claude-opus-4-8"]);
    const load = createProviderModelCatalogLoader(source);
    const cases: Array<[ProviderModelCatalogPolicy, RegExp]> = [
      [
        policy({ defaults: { ...defaults, claude: "" } }),
        /claude default model/,
      ],
      [
        policy({ defaults: { ...defaults, claude: "gpt-5.5" } }),
        /claude default model/,
      ],
      [
        {
          ...policy(),
          defaultMode:
            "unsupported" as ProviderModelCatalogPolicy["defaultMode"],
        },
        /Unsupported defaultMode/,
      ],
      [policy({ allow: { claude: () => false } }), /rejected by allow policy/],
      [
        policy({
          allow: {
            claude: () => {
              throw new Error("default allow exploded");
            },
          },
        }),
        /default allow exploded/,
      ],
    ];

    for (const [invalidPolicy, message] of cases) {
      source.mockClear();
      await expect(load(invalidPolicy)).rejects.toThrow(message);
      expect(source).not.toHaveBeenCalled();
    }
  });

  it("원격 모델에 대한 allow 예외를 fallback으로 숨기지 않는다", async () => {
    const load = createProviderModelCatalogLoader(async () => [
      "claude-opus-4-8",
    ]);
    await expect(
      load(
        policy({
          allow: {
            claude: (id) => {
              if (id.includes("opus")) throw new Error("bad policy");
              return true;
            },
          },
        }),
      ),
    ).rejects.toThrow("bad policy");
  });
});
