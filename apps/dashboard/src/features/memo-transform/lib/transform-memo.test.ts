import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ResolvedPreset } from "./preset-resolver";

const analyzeMock = vi.fn();
const logLlmSpendMock = vi.fn();
vi.mock("@krdn/llm-gateway/gateway", () => ({
  analyzeStructured: (...a: unknown[]) => analyzeMock(...a),
}));
vi.mock("@/shared/lib/llm/anthropic", () => ({
  gatewayDefaults: {
    provider: "claude-cli",
    baseUrl: "http://test",
    apiKey: "k",
  },
  logLlmSpend: (...a: unknown[]) => logLlmSpendMock(...a),
}));
vi.mock("@/shared/lib/llm/draft-reply", () => ({
  isRefusalDraft: (t: string) => t.startsWith("죄송"),
}));
import {
  transformMemoContent,
  TransformResponseSchema,
} from "./transform-memo";

const preset = (over: Partial<ResolvedPreset> = {}): ResolvedPreset => ({
  slug: "tidy",
  label: "정돈",
  instruction: "스타일: 정돈.",
  fidelityGuard: true,
  model: "claude",
  modelId: "claude-sonnet-5",
  minInputLen: 1,
  strictPreserve: true,
  isBuiltin: true,
  isOverridden: false,
  ...over,
});

beforeEach(() => {
  analyzeMock.mockReset();
  logLlmSpendMock.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// vi.mock이 게이트웨이를 대체해도 스키마 검증 자체는 여기서 직접 가드 (mock 함정 회피).
describe("TransformResponseSchema", () => {
  it("정상 content 통과", () => {
    expect(
      TransformResponseSchema.safeParse({ content: "정리된 텍스트" }).success,
    ).toBe(true);
  });
  it("빈 content 거부", () => {
    expect(TransformResponseSchema.safeParse({ content: "" }).success).toBe(
      false,
    );
  });
});

describe("transformMemoContent", () => {
  it("정상 변환은 ok", async () => {
    analyzeMock.mockResolvedValue({
      object: { content: "요약 결과" },
      usage: {},
    });
    const r = await transformMemoContent(
      "원문 ".repeat(50),
      preset({ slug: "summary", strictPreserve: false }),
    );
    expect(r).toEqual({ kind: "ok", content: "요약 결과" });
  });

  it("요약의 대폭 축약도 정상 (60% 규칙 미적용)", async () => {
    analyzeMock.mockResolvedValue({
      object: { content: "짧은 요약" },
      usage: {},
    });
    const r = await transformMemoContent(
      "가".repeat(500),
      preset({ slug: "summary", strictPreserve: false }),
    );
    expect(r.kind).toBe("ok");
  });

  it("tidy의 60% 미만 축약은 degenerate 실패", async () => {
    analyzeMock.mockResolvedValue({
      object: { content: "가".repeat(10) },
      usage: {},
    });
    const r = await transformMemoContent("가".repeat(100), preset());
    expect(r).toEqual({ kind: "failed", reason: "degenerate" });
  });

  it("거절 응답은 refusal 실패", async () => {
    analyzeMock.mockResolvedValue({
      object: { content: "죄송하지만 도와드릴 수 없습니다" },
      usage: {},
    });
    const r = await transformMemoContent(
      "원문 내용입니다 원문 내용입니다",
      preset({ slug: "polish", strictPreserve: false }),
    );
    expect(r).toEqual({ kind: "failed", reason: "refusal" });
  });

  it("LLM 예외는 reason을 llm-error로 뭉갠다 (내부 메시지 비노출)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    analyzeMock.mockRejectedValue(
      new Error("http://internal-gateway:8317 boom"),
    );
    const r = await transformMemoContent(
      "원문 내용입니다 원문 내용입니다",
      preset({ slug: "summary", strictPreserve: false }),
    );
    expect(r).toEqual({ kind: "failed", reason: "llm-error" });
  });

  it("프록시 auth_unavailable은 모델 사용 불가로 구분한다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    analyzeMock.mockRejectedValue(
      new Error(
        "Failed after 3 attempts. Last error: auth_unavailable: no auth available (providers=codex, model=gpt-5.6-luna)",
      ),
    );
    const r = await transformMemoContent(
      "원문 내용입니다 원문 내용입니다",
      preset({
        model: "codex",
        modelId: "gpt-5.6-luna",
        strictPreserve: false,
      }),
    );
    expect(r).toEqual({ kind: "failed", reason: "model-unavailable" });
  });

  it("목록에는 있지만 호출에서 Model not found가 난 모델도 사용 불가로 구분한다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    analyzeMock.mockRejectedValue(new Error("Model not found gpt-5.6-luna"));
    const r = await transformMemoContent(
      "원문 내용입니다 원문 내용입니다",
      preset({
        model: "codex",
        modelId: "gpt-5.6-luna",
        strictPreserve: false,
      }),
    );
    expect(r).toEqual({ kind: "failed", reason: "model-unavailable" });
  });

  it("공백뿐인 출력은 empty-output 실패", async () => {
    analyzeMock.mockResolvedValue({ object: { content: "   " }, usage: {} });
    const r = await transformMemoContent(
      "원문 내용입니다 원문 내용입니다",
      preset({ slug: "summary", strictPreserve: false }),
    );
    expect(r).toEqual({ kind: "failed", reason: "empty-output" });
  });

  it("빈 입력은 LLM 호출 없이 empty-input", async () => {
    expect(await transformMemoContent("   ", preset())).toEqual({
      kind: "failed",
      reason: "empty-input",
    });
    expect(analyzeMock).not.toHaveBeenCalled();
  });

  it("커스텀 프리셋은 metric key가 memo-transform:custom으로 기록된다", async () => {
    analyzeMock.mockResolvedValue({
      object: { content: "결과" },
      usage: { total: 1 },
    });
    await transformMemoContent(
      "원문 내용입니다 원문 내용입니다",
      preset({ slug: "my-custom", isBuiltin: false, strictPreserve: false }),
    );
    expect(logLlmSpendMock).toHaveBeenCalledWith(
      "memo-transform:custom",
      "claude-sonnet-5",
      {
        total: 1,
      },
    );
  });

  it("빌트인 프리셋은 metric key가 memo-transform:<slug>로 기록된다", async () => {
    analyzeMock.mockResolvedValue({
      object: { content: "결과" },
      usage: { total: 1 },
    });
    await transformMemoContent(
      "원문 내용입니다 원문 내용입니다",
      preset({ slug: "summary", strictPreserve: false }),
    );
    expect(logLlmSpendMock).toHaveBeenCalledWith(
      "memo-transform:summary",
      "claude-sonnet-5",
      {
        total: 1,
      },
    );
  });

  it("프리셋에서 선택한 모델 ID를 프록시 호출과 비용 로그에 사용한다", async () => {
    analyzeMock.mockResolvedValue({
      object: { content: "결과" },
      usage: { total: 2 },
    });
    await transformMemoContent(
      "원문 내용입니다 원문 내용입니다",
      preset({ model: "codex", modelId: "gpt-5.4", strictPreserve: false }),
    );
    expect(analyzeMock.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        provider: "claude-cli",
        baseUrl: "http://test",
        model: "gpt-5.4",
      }),
    );
    expect(logLlmSpendMock).toHaveBeenCalledWith(
      "memo-transform:tidy",
      "gpt-5.4",
      {
        total: 2,
      },
    );
  });

  it("fidelityGuard: false면 systemPrompt에 절대 규칙이 포함되지 않는다", async () => {
    analyzeMock.mockResolvedValue({ object: { content: "결과" }, usage: {} });
    await transformMemoContent(
      "원문 내용입니다 원문 내용입니다",
      preset({ fidelityGuard: false, strictPreserve: false }),
    );
    const callArgs = analyzeMock.mock.calls[0];
    const options = callArgs[2] as { systemPrompt: string };
    expect(options.systemPrompt).not.toContain("절대 규칙");
  });
});
