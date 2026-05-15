"use client";

import { useState, useTransition } from "react";
import { TigerCompatibilityCard } from "@/widgets/tiger-cards";
import { TigerErrorPanel } from "@/entities/tiger-reading/ui/TigerErrorPanel";
import type { PlayMCPCompatibilityResult } from "@/entities/tiger-reading";
import { fetchCompatibilityAction } from "./actions";

interface ProfileSlim { id: string; nickname: string; relation: string; }

export function CompatibilityPicker({ profiles }: { profiles: ProfileSlim[] }) {
  const [aId, setAId] = useState(profiles[0].id);
  const [bId, setBId] = useState(profiles[1].id);
  const [result, setResult] = useState<{
    payload: PlayMCPCompatibilityResult; nickname1: string; nickname2: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function trigger() {
    setError(null); setResult(null);
    startTransition(async () => {
      const r = await fetchCompatibilityAction(aId, bId);
      if (r.ok && r.payload && r.nickname1 && r.nickname2) {
        setResult({ payload: r.payload, nickname1: r.nickname1, nickname2: r.nickname2 });
      } else {
        setError(r.error ?? "unknown error");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-4">
        <label className="block text-sm">
          <span className="text-gray-700">사람 1</span>
          <select value={aId} onChange={(e) => setAId(e.target.value)} className="mt-1 rounded border px-2 py-1.5">
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.nickname} ({p.relation})</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-gray-700">사람 2</span>
          <select value={bId} onChange={(e) => setBId(e.target.value)} className="mt-1 rounded border px-2 py-1.5">
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.nickname} ({p.relation})</option>)}
          </select>
        </label>
        <button
          type="button"
          onClick={trigger}
          disabled={pending || aId === bId}
          className="rounded bg-amber-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {pending ? "분석 중..." : "궁합 보기"}
        </button>
      </div>
      {error && <TigerErrorPanel body={error} showRetry onRetry={trigger} />}
      {result && (
        <TigerCompatibilityCard
          payload={result.payload}
          nickname1={result.nickname1}
          nickname2={result.nickname2}
        />
      )}
    </div>
  );
}
