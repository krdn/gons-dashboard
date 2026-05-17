"use client";

// 학파별 LifetimeFrame 카드 — 격국·용신·hints 표시 + "더 자세히 보기" 시 narrative fetch.
//
// fetch 경로: GET /api/saju/lifetime/[profileId]/narrative?school=<schoolKey>
//   - 응답: { narrativeText, sections, citations, modelId, generatedAt, fromCache, school }
//   - 에러: 401 / 404 / 422 / 429 / 500
//
// 429 RATE_LIMIT UX (Polish D):
//   - 응답 body 의 retryAfterMs 를 사용해 카운트다운 (mm:ss) 표시
//   - 카운트다운 동안 retry 버튼 disabled, 0 도달 시 "다시 시도" 로 활성화
//   - unmount / 재호출 시 setInterval cleanup
//
// LifetimeFrame.{formatGyeokguk, yongshin, careerHints, relationshipHints, healthHints, cautions}
// 는 모두 packages/saju/src/core/extendedTypes.ts 에서 보장된 shape. yongshin 만 optional.

import { useEffect, useRef, useState } from "react";
import type { LifetimeFrame } from "@gons/saju";
import { toUserMessage } from "../lib/errorMessage";

type SchoolKey = "ko" | "cn-ziping" | "cn-mangpai" | "jp";

interface Props {
  profileId: string;
  schoolKey: SchoolKey;
  frame: LifetimeFrame;
}

function formatRetryRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const mm = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, "0");
  const ss = (totalSec % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

export function LifetimeFrameCard({ profileId, schoolKey, frame }: Props) {
  const [narrative, setNarrative] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 429 RATE_LIMIT 응답을 받았을 때 retry 가능 시각 (epoch ms). null = rate-limit 상태 아님.
  const [retryAt, setRetryAt] = useState<number | null>(null);
  // 카운트다운 표시용 현재 시각 (epoch ms). render 중 Date.now() 호출 금지(react-hooks/purity)
  // + effect body 동기 setState 금지(set-state-in-effect) → fetchNarrative 이벤트 핸들러에서
  // setRetryAt 과 같이 초기화하고, useEffect 안의 setInterval 콜백에서만 갱신.
  const [nowMs, setNowMs] = useState<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (retryAt === null) return;
    tickRef.current = setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      if (now >= retryAt) {
        setRetryAt(null);
      }
    }, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [retryAt]);

  const fetchNarrative = async () => {
    // 새 시도 전 stale rate-limit 정리.
    setRetryAt(null);
    setNowMs(null);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/saju/lifetime/${profileId}/narrative?school=${schoolKey}`,
      );
      if (!res.ok) {
        const data = (await res.json()) as {
          error?: string;
          retryAfterMs?: number;
        };
        if (res.status === 429 && typeof data.retryAfterMs === "number") {
          // 카운트다운 분기 — error state 는 비워 두고 JSX 의 rateLimited 분기에서 메시지 표시.
          // nowMs 는 setRetryAt 과 같이 초기화해서 첫 렌더부터 정확한 잔여시간 표시.
          const now = Date.now();
          setNowMs(now);
          setRetryAt(now + data.retryAfterMs);
          return;
        }
        // raw stable code 를 그대로 throw — catch 에서 한국어 매핑.
        throw new Error(data.error ?? "INTERNAL_ERROR");
      }
      const data = (await res.json()) as { narrativeText: string };
      setNarrative(data.narrativeText);
    } catch (err) {
      const rawCode = err instanceof Error ? err.message : null;
      setError(toUserMessage(rawCode));
    } finally {
      setLoading(false);
    }
  };

  const retryRemainingMs =
    retryAt !== null && nowMs !== null ? Math.max(0, retryAt - nowMs) : 0;
  const rateLimited = retryAt !== null && retryRemainingMs > 0;

  return (
    <div className="border rounded p-4 space-y-2">
      <div className="font-bold">격국: {frame.formatGyeokguk.name}</div>
      <div className="text-sm text-gray-700">{frame.formatGyeokguk.reasoning}</div>
      {frame.yongshin && (
        <div className="text-sm">
          용신: {frame.yongshin.element} — {frame.yongshin.reasoning}
        </div>
      )}
      <div className="text-sm space-y-1">
        <div>직업: {frame.careerHints.join(" · ")}</div>
        <div>관계: {frame.relationshipHints.join(" · ")}</div>
        <div>건강: {frame.healthHints.join(" · ")}</div>
        <div>주의: {frame.cautions.join(" · ")}</div>
      </div>
      {narrative ? (
        <div className="whitespace-pre-wrap text-sm">{narrative}</div>
      ) : (
        <button
          type="button"
          onClick={fetchNarrative}
          disabled={loading || rateLimited}
          className="text-blue-600 text-sm disabled:text-gray-400"
        >
          {loading
            ? "분석 중…"
            : rateLimited
              ? `${formatRetryRemaining(retryRemainingMs)} 후 재시도 가능`
              : retryAt !== null
                ? "다시 시도"
                : "더 자세히 보기"}
        </button>
      )}
      {rateLimited && (
        <div className="text-amber-700 text-sm" role="status" aria-live="polite">
          분당 요청 한도 초과 — {formatRetryRemaining(retryRemainingMs)} 후 다시 시도해주세요.
        </div>
      )}
      {error && !rateLimited && (
        <div className="text-red-600 text-sm" role="alert">{error}</div>
      )}
    </div>
  );
}
