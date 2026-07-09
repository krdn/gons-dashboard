"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { accumulateFinal } from "./speechResultReducer";

export type SpeechError = "not-allowed" | "no-speech" | "network" | "aborted" | "unknown";

// 브라우저 벤더 프리픽스 대응.
function getRecognitionCtor(): (new () => SpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  return (window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null) as never;
}

export function useSpeechRecognition() {
  const [isRecording, setIsRecording] = useState(false);
  const [rawTranscript, setRawTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<SpeechError | null>(null);
  const recRef = useRef<SpeechRecognition | null>(null);
  const wantRecordingRef = useRef(false); // onend 자동 재시작 판단용.
  const rawTranscriptRef = useRef(""); // onresult 순수성 확보용 — updater 밖에서 setInterim 호출하기 위한 현재값 보관.
  const stopResolverRef = useRef<(() => void) | null>(null); // stop() 대기자 — onend에서 resolve.
  const isSupported = getRecognitionCtor() !== null;

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    setError(null);
    rawTranscriptRef.current = "";
    setRawTranscript("");
    setInterim("");
    const rec = new Ctor();
    rec.lang = "ko-KR";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: SpeechRecognitionEvent) => {
      const { finalText, interim: itm } = accumulateFinal(rawTranscriptRef.current, e);
      rawTranscriptRef.current = finalText;
      setRawTranscript(finalText);
      setInterim(itm);
    };
    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      const code = e.error;
      if (code === "not-allowed" || code === "no-speech" || code === "network" || code === "aborted") {
        setError(code);
      } else {
        setError("unknown");
      }
      if (code === "not-allowed" || code === "aborted") wantRecordingRef.current = false;
    };
    rec.onend = () => {
      // 브라우저가 임의 종료했지만 사용자가 아직 녹음 중이면 재시작 (debounce).
      if (wantRecordingRef.current) {
        setTimeout(() => {
          if (wantRecordingRef.current) {
            try {
              rec.start();
            } catch {
              /* 이미 시작됨 등 — 무시 */
            }
          }
        }, 250);
      } else {
        setIsRecording(false);
        // stop() 대기자에게 최종 transcript 확정 시점(onend)을 알린다.
        stopResolverRef.current?.();
        stopResolverRef.current = null;
      }
    };
    wantRecordingRef.current = true;
    recRef.current = rec;
    rec.start();
    setIsRecording(true);
  }, []);

  // 마지막 발화의 final 결과는 stop() 호출 뒤 onend 전에 도착한다 — 즉시 상태를 읽으면
  // 끝 문장이 유실된다 (Codex P2). onend까지 기다린 최종 transcript를 resolve.
  const stop = useCallback((): Promise<string> => {
    wantRecordingRef.current = false;
    setIsRecording(false);
    setInterim("");
    const rec = recRef.current;
    if (!rec) return Promise.resolve(rawTranscriptRef.current);
    return new Promise<string>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        stopResolverRef.current = null;
        resolve(rawTranscriptRef.current);
      };
      stopResolverRef.current = finish;
      // onend 미발화 브라우저 방어 — 2초 상한.
      window.setTimeout(finish, 2_000);
      try {
        rec.stop();
      } catch {
        finish();
      }
    });
  }, []);

  const reset = useCallback(() => {
    rawTranscriptRef.current = "";
    setRawTranscript("");
    setInterim("");
    setError(null);
  }, []);

  useEffect(() => {
    return () => {
      wantRecordingRef.current = false;
      recRef.current?.stop();
    };
  }, []);

  return { isSupported, isRecording, rawTranscript, interim, error, start, stop, reset };
}
