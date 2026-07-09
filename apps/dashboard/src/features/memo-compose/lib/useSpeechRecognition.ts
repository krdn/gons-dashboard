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
  const isSupported = getRecognitionCtor() !== null;

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    setError(null);
    setRawTranscript("");
    setInterim("");
    const rec = new Ctor();
    rec.lang = "ko-KR";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: SpeechRecognitionEvent) => {
      setRawTranscript((prev) => {
        const { finalText, interim: itm } = accumulateFinal(prev, e);
        setInterim(itm);
        return finalText;
      });
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
      }
    };
    wantRecordingRef.current = true;
    recRef.current = rec;
    rec.start();
    setIsRecording(true);
  }, []);

  const stop = useCallback(() => {
    wantRecordingRef.current = false;
    recRef.current?.stop();
    setIsRecording(false);
    setInterim("");
  }, []);

  const reset = useCallback(() => {
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
