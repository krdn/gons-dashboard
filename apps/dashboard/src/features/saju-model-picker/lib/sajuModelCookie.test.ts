import { describe, expect, it } from "vitest";
import {
  parseSajuModelPreference,
  resolveSajuModelSelection,
  serializeSajuModelPreference,
} from "./sajuModelCookie";

const DEFAULTS = {
  claude: "claude-opus-4-8",
  codex: "gpt-5.5",
  gemini: "gemini-2.5-pro",
};

describe("parseSajuModelPreference", () => {
  it("직렬화한 선택을 그대로 되읽는다", () => {
    const pref = { modelKey: "claude", modelId: "claude-opus-5" } as const;
    expect(parseSajuModelPreference(serializeSajuModelPreference(pref))).toEqual(
      pref,
    );
  });

  it("공급사만 저장된 값은 modelId 없이 읽는다", () => {
    expect(parseSajuModelPreference("gemini|")).toEqual({
      modelKey: "gemini",
      modelId: null,
    });
  });

  it("공급사와 어긋나는 모델 ID 는 통째로 버린다", () => {
    expect(parseSajuModelPreference("gemini|claude-opus-5")).toBeNull();
  });

  it("형식이 깨진 쿠키는 버린다", () => {
    expect(parseSajuModelPreference("claude-opus-5")).toBeNull();
    expect(parseSajuModelPreference("unknown|claude-opus-5")).toBeNull();
    expect(parseSajuModelPreference("claude|not a model id")).toBeNull();
    expect(parseSajuModelPreference(undefined)).toBeNull();
  });
});

describe("resolveSajuModelSelection", () => {
  it("URL param 이 쿠키보다 우선한다", () => {
    // 공유 링크의 명시적 ?modelId= 를 내 쿠키가 덮어쓰면 안 된다.
    expect(
      resolveSajuModelSelection({
        rawModelKey: "claude",
        rawModelId: "claude-sonnet-5",
        cookieValue: "claude|claude-opus-5",
        defaults: DEFAULTS,
      }),
    ).toEqual({ modelKey: "claude", modelId: "claude-sonnet-5" });
  });

  it("URL param 이 없으면 쿠키에 저장된 선택을 복원한다", () => {
    // 회귀: /fortune/<id> 링크로 재진입해도 선택이 유지돼야 한다.
    expect(
      resolveSajuModelSelection({
        rawModelKey: undefined,
        rawModelId: undefined,
        cookieValue: "claude|claude-opus-5",
        defaults: DEFAULTS,
      }),
    ).toEqual({ modelKey: "claude", modelId: "claude-opus-5" });
  });

  it("공급사가 URL 로 바뀌면 다른 공급사의 쿠키 모델을 쓰지 않는다", () => {
    expect(
      resolveSajuModelSelection({
        rawModelKey: "gemini",
        rawModelId: undefined,
        cookieValue: "claude|claude-opus-5",
        defaults: DEFAULTS,
      }),
    ).toEqual({ modelKey: "gemini", modelId: DEFAULTS.gemini });
  });

  it("공급사만 지정한 URL 은 같은 공급사 쿠키 모델을 물려받지 않는다", () => {
    // ?model=claude 는 "claude 기본값" 을 뜻한다. 수신자의 개인 쿠키 모델이
    // 링크가 담은 의도를 조용히 대체하면 안 된다.
    expect(
      resolveSajuModelSelection({
        rawModelKey: "claude",
        rawModelId: undefined,
        cookieValue: "claude|claude-opus-5",
        defaults: DEFAULTS,
      }),
    ).toEqual({ modelKey: "claude", modelId: DEFAULTS.claude });
  });

  it("유효하지 않은 ?model= 은 쿠키 선택을 무효화하지 않는다", () => {
    // parseSajuModelKey 는 미지의 값을 기본 공급사로 폴백하므로 여기서 걸러야 한다.
    // 오타 하나가 저장된 공급사를 통째로 날리면 안 된다.
    expect(
      resolveSajuModelSelection({
        rawModelKey: "bogus",
        rawModelId: undefined,
        cookieValue: `gemini|${DEFAULTS.gemini}`,
        defaults: DEFAULTS,
      }),
    ).toEqual({ modelKey: "gemini", modelId: DEFAULTS.gemini });
  });

  it("?modelId= 만 있으면 공급사를 그 모델에서 도출한다", () => {
    // 같은 링크가 수신자 쿠키에 따라 다르게 열리면 안 된다 —
    // 쿠키가 다른 공급사여도 URL 의 modelId 가 공급사까지 결정한다.
    expect(
      resolveSajuModelSelection({
        rawModelKey: undefined,
        rawModelId: "claude-sonnet-5",
        cookieValue: "claude|claude-opus-5",
        defaults: DEFAULTS,
      }),
    ).toEqual({ modelKey: "claude", modelId: "claude-sonnet-5" });

    expect(
      resolveSajuModelSelection({
        rawModelKey: undefined,
        rawModelId: "claude-sonnet-5",
        cookieValue: `gemini|${DEFAULTS.gemini}`,
        defaults: DEFAULTS,
      }),
    ).toEqual({ modelKey: "claude", modelId: "claude-sonnet-5" });
  });

  it("공급사가 모호한 modelId 는 쿠키와 무관하게 같은 결과로 떨어진다", () => {
    // codex 판정만 부분 문자열(`includes("codex")`)이라 "gemini-codex-x" 는
    // gemini·codex 양쪽에 걸린다. 배열 순서로 정하면 gemini 모델이 codex 로
    // 렌더되고, 쿠키로 정하면 같은 링크가 수신자마다 다르게 열린다 — 둘 다 피한다.
    const withGemini = resolveSajuModelSelection({
      rawModelKey: undefined,
      rawModelId: "gemini-codex-x",
      cookieValue: `gemini|${DEFAULTS.gemini}`,
      defaults: DEFAULTS,
    });
    const withCodex = resolveSajuModelSelection({
      rawModelKey: undefined,
      rawModelId: "gemini-codex-x",
      cookieValue: `codex|${DEFAULTS.codex}`,
      defaults: DEFAULTS,
    });

    expect(withGemini).toEqual(withCodex);
    expect(withGemini).toEqual({ modelKey: "claude", modelId: DEFAULTS.claude });
  });

  it("URL·쿠키 모두 없으면 registry 기본값을 쓴다", () => {
    expect(
      resolveSajuModelSelection({
        rawModelKey: undefined,
        rawModelId: undefined,
        cookieValue: undefined,
        defaults: DEFAULTS,
      }),
    ).toEqual({ modelKey: "claude", modelId: DEFAULTS.claude });
  });

  it("공급사와 어긋나는 URL 모델 ID 는 기본값으로 폴백한다", () => {
    expect(
      resolveSajuModelSelection({
        rawModelKey: "gemini",
        rawModelId: "claude-opus-5",
        cookieValue: undefined,
        defaults: DEFAULTS,
      }),
    ).toEqual({ modelKey: "gemini", modelId: DEFAULTS.gemini });
  });

  it("search param 이 배열이면 첫 값으로 해석한다", () => {
    expect(
      resolveSajuModelSelection({
        rawModelKey: ["gemini"],
        rawModelId: ["gemini-2.5-flash"],
        cookieValue: undefined,
        defaults: DEFAULTS,
      }),
    ).toEqual({ modelKey: "gemini", modelId: "gemini-2.5-flash" });
  });
});
