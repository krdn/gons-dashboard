import { describe, it, expect } from "vitest";
import { pickLatestModel } from "./pick-latest-model";

// pickLatestModel: /v1/models 의 id 목록에서 tier 별 최신 안정 모델을 고르는 순수 함수.
// 네트워크·캐시 없이 파싱 로직만 검증 — 이번 dated 오독 버그가 테스트로 안 잡힌 근본 해소.

describe("pickLatestModel", () => {
  describe("opus tier", () => {
    it("2-segment dated 모델(claude-opus-4-20250514)을 minor로 오독하지 않고 배제한다", () => {
      // 회귀: 정규식 ^claude-opus-(\d+)-(\d+)$ 가 20250514 를 minor 로 읽어
      // claude-opus-4-8 을 압도하던 버그. dated 는 배제되어야 한다.
      const ids = [
        "claude-opus-4-6",
        "claude-opus-4-7",
        "claude-opus-4-8",
        "claude-opus-4-20250514",
      ];
      expect(pickLatestModel(ids, "opus")).toBe("claude-opus-4-8");
    });

    it("안정 opus 중 (major, minor) 최댓값을 고른다", () => {
      const ids = ["claude-opus-4-6", "claude-opus-4-8", "claude-opus-4-7"];
      expect(pickLatestModel(ids, "opus")).toBe("claude-opus-4-8");
    });

    it("major 가 다르면 major 우선", () => {
      const ids = ["claude-opus-4-8", "claude-opus-5-1"];
      expect(pickLatestModel(ids, "opus")).toBe("claude-opus-5-1");
    });

    it("sonnet/haiku/fable/dated 3-segment 는 모두 무시한다", () => {
      const ids = [
        "claude-sonnet-5",
        "claude-fable-5",
        "claude-opus-4-5-20251101",
        "claude-opus-4-8",
      ];
      expect(pickLatestModel(ids, "opus")).toBe("claude-opus-4-8");
    });

    it("매칭 후보 0건이면 null", () => {
      expect(pickLatestModel(["claude-sonnet-5", "gpt-5.5"], "opus")).toBeNull();
    });
  });

  describe("gpt tier (codex)", () => {
    it("gpt-N.N 최신을 고르고 mini/codex-auto-review/image 는 배제한다", () => {
      const ids = [
        "gpt-5.4",
        "gpt-5.4-mini",
        "gpt-5.5",
        "codex-auto-review",
        "gpt-image-2",
        "gpt-5.3-codex-spark",
      ];
      expect(pickLatestModel(ids, "gpt")).toBe("gpt-5.5");
    });

    it("죽은 gpt-5.3-codex 형식(접미사 있음)은 매칭 안 함", () => {
      const ids = ["gpt-5.3-codex", "gpt-5.4"];
      expect(pickLatestModel(ids, "gpt")).toBe("gpt-5.4");
    });

    it("매칭 후보 0건이면 null", () => {
      expect(pickLatestModel(["gpt-image-2", "codex-auto-review"], "gpt")).toBeNull();
    });
  });

  describe("gemini-pro tier", () => {
    // gemini 는 프록시가 관리하는 gemini-pro-latest alias 를 1순위로 쓴다.
    // 인증 변경(2026-07-06)으로 안정 gemini-N.N-pro 가 사라지고 3.1 은 -preview/-low 로만
    // 존재하게 되어, 프록시가 "현재 최신 pro"로 관리하는 alias 가 가장 견고하다.
    it("gemini-pro-latest alias 가 목록에 있으면 그것을 우선한다", () => {
      const ids = [
        "gemini-3.1-pro-preview",
        "gemini-3.1-pro-low",
        "gemini-flash-latest",
        "gemini-pro-latest",
      ];
      expect(pickLatestModel(ids, "gemini-pro")).toBe("gemini-pro-latest");
    });

    it("alias 는 안정 -pro 버전이 함께 있어도 우선한다(프록시 관리 신뢰)", () => {
      const ids = ["gemini-2.5-pro", "gemini-pro-latest"];
      expect(pickLatestModel(ids, "gemini-pro")).toBe("gemini-pro-latest");
    });

    it("alias 가 없으면 안정 gemini-N.N-pro 최신으로 폴백하고 preview 는 배제한다", () => {
      const ids = ["gemini-2.5-pro", "gemini-3.1-pro-preview", "gemini-3.1-flash-lite-preview"];
      expect(pickLatestModel(ids, "gemini-pro")).toBe("gemini-2.5-pro");
    });

    it("alias 도 안정 -pro 도 없으면 null", () => {
      expect(
        pickLatestModel(["gemini-3.1-pro-preview", "gemini-2.5-flash"], "gemini-pro"),
      ).toBeNull();
    });
  });

  it("빈 목록이면 null", () => {
    expect(pickLatestModel([], "opus")).toBeNull();
  });
});
