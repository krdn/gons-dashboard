import { describe, it, expect } from "vitest";
import { accumulateFinal } from "./speechResultReducer";

// SpeechRecognitionResult 최소 형태 mock.
function mk(transcript: string, isFinal: boolean) {
  return { 0: { transcript }, isFinal, length: 1 };
}

describe("accumulateFinal — resultIndex부터 isFinal만 누적", () => {
  it("final 결과만 finalText에 append한다", () => {
    const prev = "안녕하세요. ";
    const event = { resultIndex: 0, results: [mk("반갑습니다.", true)] };
    const { finalText, interim } = accumulateFinal(prev, event);
    expect(finalText).toBe("안녕하세요. 반갑습니다.");
    expect(interim).toBe("");
  });
  it("interim 결과는 별도 버퍼로 두고 finalText에 안 넣는다", () => {
    const event = { resultIndex: 0, results: [mk("말하는중", false)] };
    const { finalText, interim } = accumulateFinal("", event);
    expect(finalText).toBe("");
    expect(interim).toBe("말하는중");
  });
  it("resultIndex부터만 순회해 중복 누적을 막는다", () => {
    // resultIndex=1이면 index 0은 이미 처리됨 → 건너뛴다.
    const event = { resultIndex: 1, results: [mk("이미처리", true), mk("새결과", true)] };
    const { finalText } = accumulateFinal("기존. ", event);
    expect(finalText).toBe("기존. 새결과");
  });
});
