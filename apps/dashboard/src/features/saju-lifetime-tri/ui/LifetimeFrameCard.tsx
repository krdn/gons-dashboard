"use client";

// 학파별 LifetimeFrame 카드 (단독 사용용) — 격국·용신·hints 표시 + "더 자세히 보기" 시 narrative fetch.
//
// 시각 마크업과 카운트다운 표시는 LifetimeFrameView 에 위임 (Polish G).
// 자체 state 로 narrative fetch / 429 retryAt / loading / error 관리 + AbortController.
//
// fetch 경로: GET /api/saju/lifetime/[profileId]/narrative?school=<schoolKey>
//   - 응답: { narrativeText, sections, citations, modelId, generatedAt, fromCache, school }
//   - 에러: 401 / 404 / 422 / 429 / 500
//
// 사용처: /fortune/[profileId]/lifetime/[school] 학파별 단독 라우트.
// TriNationTabs 는 학파 전환 race condition 방지를 위해 자체적으로 lift-up 한 state +
// AbortController + LifetimeFrameView 사용 — 이 컴포넌트 사용 안 함.

import { useEffect, useRef, useState } from "react";
import type { LifetimeFrame } from "@gons/saju";
import type {
  LifetimeNarrativeSections,
  SchoolSpecific,
} from "@/shared/lib/db/schema";
import { LifetimeFrameView } from "./LifetimeFrameView";
import { toUserMessage } from "../lib/errorMessage";

interface NarrativePayload {
  narrativeText: string;
  sections: LifetimeNarrativeSections;
  schoolSpecific: SchoolSpecific;
  citations: string[];
  modelId: string;
}

type SchoolKey = "ko" | "cn-ziping" | "cn-mangpai" | "jp";

interface Props {
  profileId: string;
  schoolKey: SchoolKey;
  frame: LifetimeFrame;
}

export function LifetimeFrameCard({ profileId, schoolKey, frame }: Props) {
  const [narrative, setNarrative] = useState<NarrativePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 429 RATE_LIMIT 응답을 받았을 때 retry 가능 시각 (epoch ms). null = rate-limit 상태 아님.
  const [retryAt, setRetryAt] = useState<number | null>(null);
  // 카운트다운 표시용 현재 시각 (epoch ms). render 중 Date.now() 호출 금지(react-hooks/purity)
  // + effect body 동기 setState 금지(set-state-in-effect) → fetchNarrative 이벤트 핸들러에서
  // setRetryAt 과 같이 초기화하고, useEffect 안의 setInterval 콜백에서만 갱신.
  const [nowMs, setNowMs] = useState<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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

  // unmount 시 진행 중 fetch abort.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const fetchNarrative = () => {
    // 기존 진행 중 fetch 취소 (재호출 시 race condition 방지).
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // 새 시도 전 stale rate-limit 정리.
    setRetryAt(null);
    setNowMs(null);
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const res = await fetch(
          `/api/saju/lifetime/${profileId}/narrative?school=${schoolKey}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          const data = (await res.json()) as {
            error?: string;
            retryAfterMs?: number;
          };
          if (res.status === 429 && typeof data.retryAfterMs === "number") {
            const now = Date.now();
            setNowMs(now);
            setRetryAt(now + data.retryAfterMs);
            setLoading(false);
            return;
          }
          throw new Error(data.error ?? "INTERNAL_ERROR");
        }
        const data = (await res.json()) as NarrativePayload & {
          fromCache: boolean;
          modelId: string;
          promptVersion: number;
        };
        setNarrative({
          narrativeText: data.narrativeText,
          sections: data.sections,
          schoolSpecific: data.schoolSpecific,
          citations: data.citations,
          modelId: data.modelId,
        });
        setLoading(false);
      } catch (err) {
        // AbortError 는 의도된 취소 — 에러 표시하지 않음.
        if (err instanceof DOMException && err.name === "AbortError") return;
        const rawCode = err instanceof Error ? err.message : null;
        setError(toUserMessage(rawCode));
        setLoading(false);
      }
    })();
  };

  const retryRemainingMs =
    retryAt !== null && nowMs !== null ? Math.max(0, retryAt - nowMs) : 0;

  return (
    <LifetimeFrameView
      frame={frame}
      school={schoolKey}
      narrative={narrative}
      loading={loading}
      error={error}
      retryRemainingMs={retryRemainingMs}
      onFetch={fetchNarrative}
    />
  );
}
