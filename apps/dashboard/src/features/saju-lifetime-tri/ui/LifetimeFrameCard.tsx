"use client";

// 학파별 LifetimeFrame 카드 — 격국·용신·hints 표시 + "더 자세히 보기" 시 narrative fetch.
//
// fetch 경로: GET /api/saju/lifetime/[profileId]/narrative?school=<schoolKey>
//   - 응답: { narrativeText, sections, citations, modelId, generatedAt, fromCache, school }
//   - 에러: 401 / 404 / 422 / 429 / 500 — error.message 표시
//
// LifetimeFrame.{formatGyeokguk, yongshin, careerHints, relationshipHints, healthHints, cautions}
// 는 모두 packages/saju/src/core/extendedTypes.ts 에서 보장된 shape. yongshin 만 optional.

import { useState } from "react";
import type { LifetimeFrame } from "@gons/saju";
import { toUserMessage } from "../lib/errorMessage";

type SchoolKey = "ko" | "cn-ziping" | "cn-mangpai" | "jp";

interface Props {
  profileId: string;
  schoolKey: SchoolKey;
  frame: LifetimeFrame;
}

export function LifetimeFrameCard({ profileId, schoolKey, frame }: Props) {
  const [narrative, setNarrative] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNarrative = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/saju/lifetime/${profileId}/narrative?school=${schoolKey}`,
      );
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
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
          disabled={loading}
          className="text-blue-600 text-sm"
        >
          {loading ? "분석 중…" : "더 자세히 보기"}
        </button>
      )}
      {error && <div className="text-red-600 text-sm">{error}</div>}
    </div>
  );
}
