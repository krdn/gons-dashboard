// @vitest-environment jsdom
// stop() 타이밍 회귀 가드 — 마지막 발화의 final 결과는 stop() 호출 뒤 onend 전에
// 도착한다. 즉시 값을 읽으면 끝 문장이 유실된다 (Codex P2).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSpeechRecognition } from "./useSpeechRecognition";

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  constructor() {
    FakeRecognition.instances.push(this);
  }
}

beforeEach(() => {
  FakeRecognition.instances = [];
  (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).SpeechRecognition;
  vi.useRealTimers();
});

function finalResult(text: string) {
  return { 0: { transcript: text }, isFinal: true, length: 1 };
}

describe("useSpeechRecognition.stop — 최종 transcript 대기", () => {
  it("stop()은 onend까지 기다려 늦게 도착한 final을 포함한다", async () => {
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => result.current.start());
    const rec = FakeRecognition.instances[0];
    act(() => rec.onresult!({ resultIndex: 0, results: [finalResult("첫 문장 ")] }));

    let stopPromise!: Promise<string>;
    act(() => {
      stopPromise = result.current.stop();
    });
    // stop() 직후, 브라우저가 마지막 발화를 확정해 final이 늦게 도착하는 경로.
    act(() => rec.onresult!({ resultIndex: 1, results: [finalResult("첫 문장 "), finalResult("끝 문장")] }));
    act(() => rec.onend!());
    expect(await stopPromise).toBe("첫 문장 끝 문장");
  });

  it("onend 전에는 resolve되지 않는다", async () => {
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => result.current.start());
    const rec = FakeRecognition.instances[0];
    let resolved: string | null = null;
    act(() => {
      void result.current.stop().then((t) => {
        resolved = t;
      });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(resolved).toBeNull();
    act(() => rec.onend!());
    await act(async () => {
      await Promise.resolve();
    });
    expect(resolved).toBe("");
  });

  it("onend 미발화 시 2초 타임아웃으로 resolve한다 (방어)", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => result.current.start());
    const rec = FakeRecognition.instances[0];
    act(() => rec.onresult!({ resultIndex: 0, results: [finalResult("문장")] }));
    let resolved: string | null = null;
    act(() => {
      void result.current.stop().then((t) => {
        resolved = t;
      });
    });
    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    expect(resolved).toBe("문장");
  });

  it("녹음 시작 전 stop은 빈 문자열로 즉시 resolve한다", async () => {
    const { result } = renderHook(() => useSpeechRecognition());
    expect(await result.current.stop()).toBe("");
  });
});
