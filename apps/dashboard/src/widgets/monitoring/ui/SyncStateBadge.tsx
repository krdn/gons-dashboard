// 동기화 상태 배지 — "데이터 없음"과 "동기화가 죽어 낡음"을 구분해 보여준다.
import { type SyncDisplayState } from "@/entities/github-activity/client";

const LABEL: Record<SyncDisplayState, string | null> = {
  "disabled-empty": "동기화 비활성",
  "disabled-stale": "동기화 비활성 (이전 데이터)",
  error: "동기화 오류",
  empty: "아직 동기화된 적 없음",
  stale: "데이터 낡음",
  ok: null,
};

const TONE: Record<SyncDisplayState, string> = {
  "disabled-empty": "bg-neutral-100 text-neutral-600",
  "disabled-stale": "bg-neutral-100 text-neutral-600",
  error: "bg-red-100 text-red-700",
  empty: "bg-neutral-100 text-neutral-600",
  stale: "bg-amber-100 text-amber-700",
  ok: "",
};

export function SyncStateBadge({
  state,
  detail,
}: {
  state: SyncDisplayState;
  detail?: string | null;
}) {
  const label = LABEL[state];
  if (label == null) return null;
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${TONE[state]}`} title={detail ?? undefined}>
      {label}
    </span>
  );
}
