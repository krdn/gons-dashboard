"use client";

import { useState, useTransition } from "react";
import { TigerYearlyCard, TigerDailyCard } from "@/widgets/tiger-cards";
import { TigerErrorPanel } from "@/entities/tiger-reading/ui/TigerErrorPanel";
import type { PlayMCPYearlyResult, PlayMCPDailyResult } from "@/entities/tiger-reading";
import { fetchYearlyAction, fetchDailyAction } from "./actions";

interface Props { profileId: string; nickname: string; }

export function LazyCards({ profileId }: Props) {
  return (
    <>
      <YearlySection profileId={profileId} />
      <DailySection profileId={profileId} />
    </>
  );
}

function YearlySection({ profileId }: { profileId: string }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [payload, setPayload] = useState<PlayMCPYearlyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const availableYears = [currentYear, currentYear + 1];

  function trigger(newYear: number) {
    setYear(newYear); setError(null);
    startTransition(async () => {
      const result = await fetchYearlyAction(profileId, newYear);
      if (result.ok && result.payload) setPayload(result.payload);
      else setError(result.error ?? "unknown error");
    });
  }

  if (!payload && !pending && !error) {
    return (
      <section className="rounded-xl border bg-white p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">🐯 신년 인사이트</h3>
          <button
            type="button"
            onClick={() => trigger(year)}
            className="rounded bg-amber-600 px-3 py-1.5 text-sm text-white hover:bg-amber-700"
          >
            보기
          </button>
        </div>
      </section>
    );
  }
  if (pending) return <PendingCard label="호(虎)가 신년 흐름을 살펴보고 있습니다..." />;
  if (error) return <TigerErrorPanel body={error} showRetry onRetry={() => trigger(year)} />;
  if (payload) return (
    <TigerYearlyCard
      payload={payload} year={year} selectedYear={year}
      availableYears={availableYears} onYearChange={trigger}
    />
  );
  return null;
}

function DailySection({ profileId }: { profileId: string }) {
  const [payload, setPayload] = useState<PlayMCPDailyResult | null>(null);
  const [forDateKst, setForDateKst] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function trigger() {
    setError(null);
    startTransition(async () => {
      const result = await fetchDailyAction(profileId);
      if (result.ok && result.payload) {
        setPayload(result.payload);
        setForDateKst((result.extra?.forDateKst as string) ?? "");
      } else {
        setError(result.error ?? "unknown error");
      }
    });
  }

  if (!payload && !pending && !error) {
    return (
      <section className="rounded-xl border bg-white p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">🐯 오늘의 기운</h3>
          <button
            type="button"
            onClick={trigger}
            className="rounded bg-amber-600 px-3 py-1.5 text-sm text-white hover:bg-amber-700"
          >
            보기
          </button>
        </div>
      </section>
    );
  }
  if (pending) return <PendingCard label="호(虎)가 오늘 기운을 살펴보고 있습니다..." />;
  if (error) return <TigerErrorPanel body={error} showRetry onRetry={trigger} />;
  if (payload) return <TigerDailyCard payload={payload} forDateKst={forDateKst} />;
  return null;
}

function PendingCard({ label }: { label: string }) {
  return (
    <section className="rounded-xl border bg-white p-6">
      <p className="text-sm text-gray-700">{label}</p>
    </section>
  );
}
