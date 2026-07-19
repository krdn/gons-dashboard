// check_results status 공용 표시 + detail(jsonb) 안전 접근자 — Phase 2 보드 3종 공유.
import { type LatestCheck } from "@/entities/monitoring/server";

export const CHECK_STATUS_STYLE: Record<
  string,
  { color: string; label: string }
> = {
  ok: { color: "var(--color-severity-ok)", label: "정상" },
  warning: { color: "var(--color-warn)", label: "경고" },
  critical: { color: "var(--color-severity-high)", label: "위험" },
  unknown: { color: "var(--color-text-muted)", label: "관찰 불가" },
};

export function checkStatusStyle(status: string): {
  color: string;
  label: string;
} {
  return (
    CHECK_STATUS_STYLE[status] ?? {
      color: "var(--color-text-muted)",
      label: status,
    }
  );
}

export function detailNum(check: LatestCheck, key: string): number | null {
  const v = check.detail?.[key];
  return typeof v === "number" ? v : null;
}

export function detailStr(check: LatestCheck, key: string): string | null {
  const v = check.detail?.[key];
  return typeof v === "string" ? v : null;
}

export function detailBool(check: LatestCheck, key: string): boolean | null {
  const v = check.detail?.[key];
  return typeof v === "boolean" ? v : null;
}

/** 문자열 배열 detail (Phase 3 — 포트 목록·fail2ban jail 목록). */
export function detailArr(check: LatestCheck, key: string): string[] | null {
  const v = check.detail?.[key];
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? v : null;
}
